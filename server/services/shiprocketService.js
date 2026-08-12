import axios from "axios";
import crypto from "crypto-js";
import ShiprocketOrder from "../models/ShiprocketOrder.js";
import ShiprocketSyncLog from "../models/ShiprocketSyncLog.js";
import { todayIstIso, istDayStartUtc, istDayEndUtc } from "../utils/dateIst.js";

const generateHMAC = (payload) =>
  crypto
    .HmacSHA256(JSON.stringify(payload), process.env.SHIPROCKET_API_SECRET)
    .toString(crypto.enc.Base64);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Date helpers ───────────────────────────────────────────

// Returns ["2026-07-01", "2026-07-02", ...] inclusive, one entry per day
function enumerateDays(since, until) {
  const days = [];
  let cursor = new Date(`${since}T00:00:00.000Z`);
  const end = new Date(`${until}T00:00:00.000Z`);
  while (cursor <= end) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

// ─── Shiprocket API calls ───────────────────────────────────

/**
 * Fetch the lightweight order list from Shiprocket for a SINGLE day,
 * paginating through every page until exhausted.
 */
async function fetchShiprocketOrderListForDay(day) {
  // `day` is an IST calendar day (that's the business's operating
  // timezone), so the query window has to be IST midnight-to-midnight, NOT
  // UTC midnight-to-midnight. Getting this wrong silently shifted any order
  // placed between 12:00–5:29 AM IST into the *previous* day's bucket
  // (UTC is 5:30 behind IST), which is how orders/campaigns could look
  // "wrong" for a given date without any error ever being thrown.
  const startDate = istDayStartUtc(day);
  const endDate = istDayEndUtc(day);

  const orders = [];
  let page = 0;
  const limit = 250;

  while (true) {
    const payload = {
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      timestamp: new Date().toISOString(),
      status: "SUCCESS",
      limit,
      page,
    };

    const hmac = generateHMAC(payload);

    const response = await axios.post(
      "https://checkout-api.shiprocket.com/api/v1/custom-platform-order/details/list",
      payload,
      {
        headers: {
          "X-Api-Key": process.env.SHIPROCKET_API_KEY,
          "X-Api-HMAC-SHA256": hmac,
          "Content-Type": "application/json",
        },
      }
    );

    const pageData = response.data?.result?.data || [];
    orders.push(...pageData);

    if (pageData.length < limit) break; // last page reached
    page += 1;
    if (page > 200) break; // safety valve against a runaway loop
  }

  return orders;
}

/**
 * Fetch full order details from your API (same endpoint the cron uses).
 *
 * Retries on ANY error — not just 429 — with exponential backoff (capped
 * at maxDelayMs between attempts). By default maxRetries is Infinity: the
 * function will NOT give up and NOT throw, it just keeps trying until the
 * order is fetched successfully. This is intentional so batch callers
 * never have to skip an order because of a transient error.
 *
 * If you ever want it to give up after N tries (and throw so the caller
 * can decide what to do), pass a finite maxRetries.
 */
async function fetchOrderDetails(
  orderId,
  { maxRetries = Infinity, baseDelayMs = 1000, maxDelayMs = 30000 } = {}
) {
  let attempt = 0;

  while (true) {
    try {
      const response = await axios.get(`https://akravi.com/api/ad/order/${orderId}`);
      return response.data?.result;
    } catch (err) {
      attempt += 1;

      if (attempt > maxRetries) {
        // Only reachable if the caller explicitly set a finite maxRetries.
        throw err;
      }

      const status = err?.response?.status;
      const retryAfterHeader = err?.response?.headers?.["retry-after"];
      const retryAfterMs = retryAfterHeader ? parseFloat(retryAfterHeader) * 1000 : null;
      const backoffMs = Math.min(
        retryAfterMs || baseDelayMs * 2 ** (attempt - 1) + Math.random() * 250,
        maxDelayMs
      );

      console.warn(
        `⚠ Error fetching order ${orderId} (attempt ${attempt}${
          maxRetries === Infinity ? "" : `/${maxRetries}`
        }, status ${status || "network/other"}). Retrying in ${Math.round(backoffMs)}ms`
      );
      await sleep(backoffMs);
    }
  }
}

/**
 * Fetch order details in BATCHES of `batchSize` (default 50): orders
 * WITHIN a batch are fetched ONE BY ONE, strictly sequentially (never
 * concurrently) — with an optional small `delayMs` gap between each one.
 * After a batch of 50 finishes, we pause for `pauseMs` before starting
 * the next batch.
 *
 * Because fetchOrderDetails() retries each order until it succeeds (see
 * above), nothing is ever skipped — the function only returns once every
 * requested order has been fetched.
 */
async function fetchDetailsInBatches(
  orderIds,
  { batchSize = 50, pauseMs = 5000, delayMs = 300 } = {}
) {
  const results = [];
  const totalBatches = Math.ceil(orderIds.length / batchSize);

  for (let i = 0; i < orderIds.length; i += batchSize) {
    const batch = orderIds.slice(i, i + batchSize);
    const batchNumber = i / batchSize + 1;

    console.log(`→ Fetching batch ${batchNumber}/${totalBatches} (${batch.length} orders, one by one)`);

    for (const orderId of batch) {
      const detail = await fetchOrderDetails(orderId);
      if (detail) results.push(detail);
      if (delayMs) await sleep(delayMs);
    }

    const isLastBatch = i + batchSize >= orderIds.length;
    if (!isLastBatch && pauseMs) {
      console.log(`⏸ Batch ${batchNumber} done. Pausing ${pauseMs}ms before next batch`);
      await sleep(pauseMs);
    }
  }

  return results;
}

// ─── Field extraction ───────────────────────────────────────


/**
 * Pull the fields we actually query/report on out of a raw Shiprocket
 * order payload. Ad-attribution data lives in cart_data.custom_attributes;
 * everything else the caller asked for is top-level on the order.
 */
function extractOrderFields(o) {
  const attrs = o?.cart_data?.custom_attributes || {};
  const shipTo = o?.shipping_address || o?.billing_address || {};

  return {
    orderId: String(o.order_id ?? o.id ?? o.platform_order_id ?? ""),
    campaignId: attrs.campaign_id || "",
    campaignName: attrs.utm_campaign || "",
    utmCreative: attrs.utm_creative || "",
    adsetId: attrs.adset_id || "",
    adsetName: attrs.adset_name || "",
    adId: attrs.ad_id || "",
    subid: attrs.subid || attrs._subid || "",
    trackSource: attrs.track_source || "",
    pixel: attrs.pixel || "",
    ip: attrs.ip || attrs.ipv4_address || "",
    phone: o.phone || "",
    email: o.email || "",
    address: {
      firstName: shipTo.first_name || "",
      lastName: shipTo.last_name || "",
      line1: shipTo.line1 || "",
      line2: shipTo.line2 || "",
      landmark: shipTo.landmark || "",
      city: shipTo.city || "",
      state: shipTo.state || "",
      pincode: shipTo.pincode || "",
      country: shipTo.country || "",
    },
    paymentType: o.payment_type || "",
    paymentStatus: o.payment_status || "",
    cartId: o.cart_id || "",
    orderCreatedAt: o.order_created_date ? new Date(o.order_created_date) : null,
    subtotalPrice: parseFloat(o.subtotal_price ?? 0) || 0,
    totalDiscount: parseFloat(o.total_discount ?? 0) || 0,
    totalAmountPayable: parseFloat(o.total_amount_payable ?? o.subtotal_price ?? 0) || 0,
  };
}

// ─── Per-day sync (list → details → persist to Mongo) ──────

/**
 * Syncs a single day: pulls the order list, fetches each order's details
 * in batches of 50 (see fetchDetailsInBatches), upserts them into Mongo,
 * and records the sync log entry. Retries the whole day (with backoff)
 * if something throws — e.g. the list endpoint itself gets rate-limited
 * — instead of giving up.
 *
 * `force: true` re-fetches full details for EVERY order the list endpoint
 * returns for this day, not just ones we don't already have — use this
 * when re-syncing a day on purpose (e.g. to pick up a payment status that
 * changed on Shiprocket's side after the first sync), as opposed to a
 * normal backfill pass where already-stored orders are skipped to save
 * API calls.
 */
async function syncDayWithRetry(day, { maxRetries = 3, baseDelayMs = 2000, force = false } = {}) {
  let attempt = 0;

  while (true) {
    try {
      const listOrders = await fetchShiprocketOrderListForDay(day);

      // Dedupe: the list endpoint can return the same id twice (pagination
      // overlap), and the same order can occasionally land in more than one
      // day's list if Shiprocket's date filter doesn't line up exactly with
      // order_created_date.
      const uniqueOrderIds = [...new Set(listOrders.map((o) => o.id).filter(Boolean))];

      // Skip ids we already have stored (from this day or a previous sync) —
      // saves an API call per duplicate, on top of the DB-level dedup.
      // Under force, skip this check entirely and re-fetch every order.
      let orderIdsToFetch = uniqueOrderIds;
      if (!force) {
        const alreadyStored = await ShiprocketOrder.find(
          { orderId: { $in: uniqueOrderIds.map(String) } },
          { orderId: 1 }
        ).lean();
        const alreadyStoredIds = new Set(alreadyStored.map((d) => d.orderId));
        orderIdsToFetch = uniqueOrderIds.filter((id) => !alreadyStoredIds.has(String(id)));
      }

      const detailedOrders =
        orderIdsToFetch.length > 0 ? await fetchDetailsInBatches(orderIdsToFetch) : [];

      if (detailedOrders.length > 0) {
        const ops = detailedOrders
          .map((o) => {
            const fields = extractOrderFields(o);
            if (!fields.orderId) return null;
            return {
              updateOne: {
                filter: { orderId: fields.orderId },
                update: { $set: { ...fields, orderDate: day, raw: o } },
                upsert: true,
              },
            };
          })
          .filter(Boolean);

        if (ops.length > 0) await ShiprocketOrder.bulkWrite(ops, { ordered: false });
      }

      await ShiprocketSyncLog.findOneAndUpdate(
        { date: day },
        { status: "complete", orderCount: uniqueOrderIds.length, error: "", lastAttemptAt: new Date() },
        { upsert: true }
      );

      return detailedOrders.length;
    } catch (err) {
      const message = err?.response?.data?.message || err.message;

      if (attempt < maxRetries) {
        const backoffMs = baseDelayMs * 2 ** attempt;
        console.warn(
          `⚠ Sync failed for ${day} (attempt ${attempt + 1}/${maxRetries}): ${message}. Retrying in ${backoffMs}ms`
        );
        await sleep(backoffMs);
        attempt += 1;
        continue;
      }

      console.error(`✖ Giving up on ${day} after ${maxRetries} retries: ${message}`);
      await ShiprocketSyncLog.findOneAndUpdate(
        { date: day },
        { status: "failed", error: message, lastAttemptAt: new Date() },
        { upsert: true }
      );
      return 0;
    }
  }
}

// ─── Public API — WRITE PATH (talks to Shiprocket, hits Mongo) ──────
//
// Everything below this line that calls syncDayWithRetry() is the ONLY
// code allowed to talk to the Shiprocket API. Comparison/Orders pages
// must never import fetchShiprocketOrdersInRange or backfillShiprocketRange
// — they should only use the READ PATH functions further down, which are
// pure Mongo reads and never make an outbound HTTP call.

/**
 * @deprecated for request-time reads. This syncs AND reads in one call,
 * which means a page load can trigger live Shiprocket API calls (and
 * 429s) if the requested range includes un-synced days. Kept only for
 * scripts/one-off use. New code should call backfillShiprocketRange()
 * (write) and getStoredShiprocketOrders() (read) separately.
 */
export async function fetchShiprocketOrdersInRange(since, until) {
  const days = enumerateDays(since, until);
  const today = todayIstIso();

  const existingLogs = await ShiprocketSyncLog.find({ date: { $in: days }, status: "complete" }).lean();
  const alreadySynced = new Set(existingLogs.map((l) => l.date).filter((d) => d !== today));

  for (const day of days) {
    if (alreadySynced.has(day)) continue;
    await syncDayWithRetry(day);
  }

  const docs = await ShiprocketOrder.find({ orderDate: { $in: days } }).lean();
  return docs.map((d) => d.raw);
}

// ─── Backfill job state ──────────────────────────────────────────
//
// Single in-memory job tracker. Good enough for a single-process Node app
// (which is what you're running). If you ever move to multiple processes/
// PM2 cluster mode, this state should move into Mongo instead — flag it
// if that ever becomes a problem, it's a quick change.

let backfillState = {
  running: false,
  since: null,
  until: null,
  currentDay: null,
  daysTotal: 0,
  daysDone: 0,
  startedAt: null,
  cancelRequested: false,
  lastError: null,
};

export function getBackfillState() {
  return { ...backfillState };
}

export function requestBackfillCancel() {
  if (backfillState.running) backfillState.cancelRequested = true;
}

/**
 * Populates Mongo for a date range, one day at a time, sequentially.
 * Does NOT return order data — this is a write-only job. Call it once
 * (e.g. "June 1 → today") to backfill history, or on a daily cron to
 * pick up "today" + catch anything that failed.
 *
 * By default, safe to call repeatedly: days already marked "complete" in
 * ShiprocketSyncLog are skipped (except today, which is always re-synced
 * since new orders keep landing). Days marked "failed" are retried.
 *
 * Pass `force: true` to re-sync every day in the range regardless of its
 * current status — including days already marked "complete" — and to
 * re-fetch full details for every order that day, not just new ones
 * (see syncDayWithRetry). Use this when you explicitly want fresh data for
 * a date that was already synced, e.g. to pick up payment status changes.
 *
 * Only one backfill can run at a time — call getBackfillState() to check
 * before starting another.
 */
export async function backfillShiprocketRange(since, until, { force = false } = {}) {
  if (backfillState.running) {
    throw new Error("A backfill is already running");
  }

  const days = enumerateDays(since, until);
  const today = todayIstIso();

  backfillState = {
    running: true,
    since,
    until,
    currentDay: null,
    daysTotal: days.length,
    daysDone: 0,
    startedAt: new Date(),
    cancelRequested: false,
    lastError: null,
  };

  try {
    let alreadySynced = new Set();
    if (!force) {
      const existingLogs = await ShiprocketSyncLog.find({
        date: { $in: days },
        status: "complete",
      }).lean();
      alreadySynced = new Set(existingLogs.map((l) => l.date).filter((d) => d !== today));
    }

    for (const day of days) {
      if (backfillState.cancelRequested) {
        console.log(`⏸ Backfill cancelled at ${day} (${since} → ${until})`);
        break;
      }
      backfillState.currentDay = day;

      if (alreadySynced.has(day)) {
        backfillState.daysDone += 1;
        continue;
      }

      try {
        await syncDayWithRetry(day, { force });
      } catch (err) {
        // syncDayWithRetry already writes a "failed" log entry internally
        // and swallows its own errors — this catch is just a safety net.
        backfillState.lastError = `${day}: ${err.message}`;
        console.error(`✖ Unexpected error backfilling ${day}:`, err);
      }
      backfillState.daysDone += 1;
    }
  } finally {
    backfillState.running = false;
    backfillState.currentDay = null;
  }
}

/**
 * Builds the "checklist" view: one entry per day in the range, sourced
 * entirely from ShiprocketSyncLog (no Shiprocket API calls). Today is
 * reported as "live" rather than "complete" since it keeps accumulating
 * orders throughout the day.
 */
export async function getShiprocketSyncStatus(since, until) {
  const days = enumerateDays(since, until);
  const today = todayIstIso();

  const logs = await ShiprocketSyncLog.find({ date: { $in: days } }).lean();
  const logByDate = new Map(logs.map((l) => [l.date, l]));

  const checklist = days.map((day) => {
    const log = logByDate.get(day);
    if (!log) {
      return { date: day, status: "pending", orderCount: 0, error: "" };
    }
    if (day === today && log.status === "complete") {
      return {
        date: day,
        status: "live",
        orderCount: log.orderCount,
        error: "",
        lastAttemptAt: log.lastAttemptAt,
      };
    }
    return {
      date: day,
      status: log.status, // "complete" | "failed"
      orderCount: log.orderCount,
      error: log.error || "",
      lastAttemptAt: log.lastAttemptAt,
    };
  });

  const summary = {
    total: checklist.length,
    complete: checklist.filter((c) => c.status === "complete").length,
    failed: checklist.filter((c) => c.status === "failed").length,
    pending: checklist.filter((c) => c.status === "pending").length,
    live: checklist.filter((c) => c.status === "live").length,
  };

  return { checklist, summary, backfill: getBackfillState() };
}

// ─── Public API — READ PATH (Mongo only, zero outbound HTTP calls) ──
//
// These are what the Orders page and the comparison/insights page should
// call. They never touch Shiprocket's API, so they can never 429 and are
// as fast as a Mongo query.

/**
 * Pure Mongo read of stored orders for a range, with optional filters.
 * Never calls the Shiprocket API — if a day hasn't been backfilled yet,
 * it's silently absent from the results (check getShiprocketSyncStatus
 * to know what's missing, rather than blocking the request to fetch it).
 */
export async function getStoredShiprocketOrders(since, until, filters = {}) {
  const query = { orderDate: { $gte: since, $lte: until } };

  if (filters.campaignId) query.campaignId = filters.campaignId;
  if (filters.adsetId) query.adsetId = filters.adsetId;
  if (filters.adId) query.adId = filters.adId;
  if (filters.paymentType) query.paymentType = filters.paymentType;

  return ShiprocketOrder.find(query).lean();
}

/**
 * Same shape/logic as summarizeShiprocketOrders, but reads the Mongoose
 * schema's camelCase fields (totalAmountPayable, paymentType, ...)
 * directly instead of the raw Shiprocket payload shape. Use this for
 * anything sourced from getStoredShiprocketOrders().
 */
export function summarizeStoredOrders(orders) {
  const summary = {
    totalOrders: 0,
    totalRevenue: 0,
    totalDiscount: 0,
    codOrders: 0,
    codRevenue: 0,
    prepaidOrders: 0,
    prepaidRevenue: 0,
    avgOrderValue: 0,
  };

  orders.forEach((o) => {
    const amount = o.totalAmountPayable || 0;

    summary.totalOrders += 1;
    summary.totalRevenue += amount;
    summary.totalDiscount += o.totalDiscount || 0;

    if (o.paymentType === "CASH_ON_DELIVERY") {
      summary.codOrders += 1;
      summary.codRevenue += amount;
    } else if (o.paymentType === "PREPAID") {
      summary.prepaidOrders += 1;
      summary.prepaidRevenue += amount;
    }
  });

  summary.totalRevenue = Math.round(summary.totalRevenue * 100) / 100;
  summary.totalDiscount = Math.round(summary.totalDiscount * 100) / 100;
  summary.codRevenue = Math.round(summary.codRevenue * 100) / 100;
  summary.prepaidRevenue = Math.round(summary.prepaidRevenue * 100) / 100;
  summary.avgOrderValue =
    summary.totalOrders > 0
      ? Math.round((summary.totalRevenue / summary.totalOrders) * 100) / 100
      : 0;

  return summary;
}

/**
 * Groups stored orders by campaignId / adsetId / adId so an insights
 * route can attach { orderCount, revenue, codOrders, prepaidOrders } onto
 * each node of the FB campaign→adset→ad hierarchy tree that
 * AdOrderComparison.jsx renders (node.shiprocket).
 */
export function groupStoredOrdersByAttribution(orders) {
  const byCampaign = new Map();
  const byAdset = new Map();
  const byAd = new Map();
  let unattributedCount = 0;
  let unattributedRevenue = 0;

  const bump = (map, key, o) => {
    if (!key) return;
    const cur = map.get(key) || { orderCount: 0, revenue: 0, codOrders: 0, prepaidOrders: 0 };
    cur.orderCount += 1;
    cur.revenue += o.totalAmountPayable || 0;
    if (o.paymentType === "CASH_ON_DELIVERY") cur.codOrders += 1;
    else if (o.paymentType === "PREPAID") cur.prepaidOrders += 1;
    map.set(key, cur);
  };

  orders.forEach((o) => {
    if (!o.campaignId && !o.adsetId && !o.adId) {
      unattributedCount += 1;
      unattributedRevenue += o.totalAmountPayable || 0;
      return;
    }
    bump(byCampaign, o.campaignId, o);
    bump(byAdset, o.adsetId, o);
    bump(byAd, o.adId, o);
  });

  // round revenue on the way out
  for (const map of [byCampaign, byAdset, byAd]) {
    for (const v of map.values()) v.revenue = Math.round(v.revenue * 100) / 100;
  }

  return {
    byCampaign,
    byAdset,
    byAd,
    unattributed: {
      orderCount: unattributedCount,
      revenue: Math.round(unattributedRevenue * 100) / 100,
    },
  };
}

/**
 * Reduce detailed Shiprocket orders into summary metrics for display
 * alongside Facebook insights.
 */
export function summarizeShiprocketOrders(orders) {
  const summary = {
    totalOrders: 0,
    totalRevenue: 0,
    totalDiscount: 0,
    codOrders: 0,
    codRevenue: 0,
    prepaidOrders: 0,
    prepaidRevenue: 0,
    avgOrderValue: 0,
  };

  orders.forEach((o) => {
    const amount = parseFloat(o.total_amount_payable ?? o.subtotal_price ?? 0) || 0;
    const discount = parseFloat(o.total_discount ?? 0) || 0;

    summary.totalOrders += 1;
    summary.totalRevenue += amount;
    summary.totalDiscount += discount;

    if (o.payment_type === "CASH_ON_DELIVERY") {
      summary.codOrders += 1;
      summary.codRevenue += amount;
    } else if (o.payment_type === "PREPAID") {
      summary.prepaidOrders += 1;
      summary.prepaidRevenue += amount;
    }
  });

  summary.totalRevenue = Math.round(summary.totalRevenue * 100) / 100;
  summary.totalDiscount = Math.round(summary.totalDiscount * 100) / 100;
  summary.codRevenue = Math.round(summary.codRevenue * 100) / 100;
  summary.prepaidRevenue = Math.round(summary.prepaidRevenue * 100) / 100;
  summary.avgOrderValue =
    summary.totalOrders > 0
      ? Math.round((summary.totalRevenue / summary.totalOrders) * 100) / 100
      : 0;

  return summary;
}