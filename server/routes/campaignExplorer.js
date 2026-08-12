import express from "express";
import ShiprocketOrder from "../models/ShiprocketOrder.js";
import Token from "../models/Token.js";
import AdAccount from "../models/AdAccount.js";

const router = express.Router();

// ─────────────────────────────────────────────────────────────
// Phase 8 — Campaign Explorer. Entirely new, additive route file
// (mounted at /api/campaign-explorer). Never imports from campaigns.js
// and never touches ShiprocketOrder writes, the sync/backfill jobs, or
// /compare — it reads the exact same two Meta Graph API shapes
// campaigns.js already established (bulk per-account campaign metadata
// via tryFetchCampaigns, bulk per-account insights at level=campaign)
// and the exact same ShiprocketOrder collection, but combines them into
// one row per campaign instead of splitting metadata (Phase 2's
// /:campaignId/details) from finance (/compare). The helpers below are
// deliberately duplicated from campaigns.js rather than imported —
// same "zero coupling to earlier phases" reasoning analytics.js and
// orderDetails.js already used for their own copies of these same
// extraction helpers, so nothing done here can ever change /compare's
// or the campaign drawer's behavior, and nothing they do can ever
// break this route.
// ─────────────────────────────────────────────────────────────

// ── Graph API helpers (duplicated from campaigns.js) ──────────

async function fbGet(urlStr) {
  const res = await fetch(urlStr);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const msg = data.error?.message || `FB API error (${res.status})`;
    throw new Error(msg);
  }
  return data;
}

async function fetchAllPages(url) {
  const results = [];
  let next = url;
  while (next) {
    const data = await fbGet(next);
    results.push(...(data.data || []));
    next = data.paging?.next || null;
  }
  return results;
}

async function tryFetchCampaigns(actId, accessToken) {
  const campaignFields = [
    "id", "name", "objective", "status", "effective_status", "buying_type",
    "daily_budget", "lifetime_budget", "spend_cap",
    "start_time", "stop_time", "created_time", "updated_time",
  ].join(",");

  try {
    const raw = await fetchAllPages(
      `https://graph.facebook.com/v19.0/${actId}/campaigns?fields=${encodeURIComponent(campaignFields)}&limit=200&access_token=${accessToken}`
    );
    if (raw.length > 0) return raw;
  } catch (err) {
    console.log(`Explorer campaign fetch (act) failed for ${actId}: ${err.message}`);
  }

  try {
    const raw = await fetchAllPages(
      `https://graph.facebook.com/v19.0/me/campaigns?fields=${encodeURIComponent(campaignFields)}&limit=200&access_token=${accessToken}`
    );
    if (raw.length > 0) return raw;
  } catch (err) {
    console.log(`Explorer campaign fetch (me) failed: ${err.message}`);
  }

  return [];
}

function findActionValue(list, types) {
  if (!Array.isArray(list)) return null;
  for (const type of types) {
    const hit = list.find((a) => a.action_type === type);
    if (hit && hit.value !== undefined) return Number(hit.value);
  }
  return null;
}

const normalizeCampaignName = (name) =>
  String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

function extractDeliveryStatus(raw) {
  return (
    raw?.shipment_status ||
    raw?.delivery_status ||
    raw?.current_status ||
    raw?.shipments?.[0]?.status ||
    raw?.shipments?.[0]?.delivery_status ||
    null
  );
}

function extractProducts(raw) {
  const items =
    raw?.cart_data?.line_items || raw?.line_items || raw?.products || raw?.items || raw?.cart_data?.products;
  if (!Array.isArray(items) || items.length === 0) return [];
  return items
    .map((i) => i?.name || i?.product_name || i?.title)
    .filter(Boolean);
}

// Six buckets instead of analyticsUtils.js's five — Phase 8 explicitly
// asks for "Processing" split out from "Pending", so this local copy
// diverges from the client-side deliveryBucket() on purpose.
function deliveryBucket6(deliveryStatus) {
  const s = (deliveryStatus || "").toLowerCase();
  if (!s) return "pending";
  if (s.includes("rto")) return "rto";
  if (s.includes("return")) return "returned";
  if (s.includes("cancel")) return "cancelled";
  if (s.includes("deliver") && !s.includes("out for")) return "delivered";
  if (s.includes("process")) return "processing";
  return "pending";
}

// ── Shared: resolve token + account id list (handles "all") ───

async function resolveTokenAndAccounts(tokenId, adAccountIdParam) {
  const token = await Token.findById(tokenId).lean();
  if (!token) {
    const err = new Error("Token not found");
    err.status = 404;
    throw err;
  }

  let accountIds = adAccountIdParam;
  if (!accountIds) {
    const err = new Error("adAccountId is required");
    err.status = 400;
    throw err;
  }
  if (!Array.isArray(accountIds)) accountIds = [accountIds];

  if (accountIds.includes("all")) {
    const accounts = await AdAccount.find({ tokenId }).lean();
    accountIds = accounts.map((a) => a.adAccountId);
  }

  const accountDocs = await AdAccount.find({ tokenId, adAccountId: { $in: accountIds } }).lean();
  const accountNameMap = new Map(accountDocs.map((a) => [a.adAccountId, a.name || a.adAccountId]));

  return { token, accountIds, accountNameMap };
}

// ── Response cache ──────────────────────────────────────────────
// Phase 8's own explicit "Response caching" performance requirement.
// A small in-memory TTL cache scoped to this file only — doesn't touch
// or share state with any of the client-side session caches earlier
// phases already built (campaignDetailsCache.js etc.), and disappears
// on server restart, which is fine: it only exists to absorb repeated
// requests for the same (token, accounts, date range) within a short
// window, e.g. re-opening Campaign Explorer or toggling a filter that
// doesn't change the underlying fetch.
const CACHE_TTL_MS = 45_000;
const responseCache = new Map();

function cacheGet(key) {
  const hit = responseCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    responseCache.delete(key);
    return null;
  }
  return hit.value;
}
function cacheSet(key, value) {
  responseCache.set(key, { value, at: Date.now() });
  // Cheap unbounded-growth guard — this cache is meant to be small and
  // short-lived, not a real store.
  if (responseCache.size > 200) {
    const oldestKey = [...responseCache.keys()][0];
    responseCache.delete(oldestKey);
  }
}

// ── Core: fetch + combine Meta + Shiprocket for a set of accounts ──
async function fetchCombinedCampaigns({ token, accountIds, accountNameMap, since, until }) {
  const insightFields = [
    "campaign_id", "campaign_name", "spend", "impressions", "reach", "clicks",
    "ctr", "cpc", "cpm", "frequency", "actions", "action_values", "purchase_roas",
  ].join(",");

  const metaByCampaignId = new Map(); // campaignId -> { meta, insights, accountId }

  for (const accountId of accountIds) {
    const actId = accountId.startsWith("act_") ? accountId : `act_${accountId}`;

    const [metaList, insightsData] = await Promise.all([
      tryFetchCampaigns(actId, token.accessToken).catch((err) => {
        console.log(`Explorer metadata fetch failed for ${actId}: ${err.message}`);
        return [];
      }),
      fbGet(
        `https://graph.facebook.com/v19.0/${actId}/insights` +
          `?level=campaign&fields=${encodeURIComponent(insightFields)}` +
          `&time_range=${encodeURIComponent(JSON.stringify({ since, until }))}` +
          `&time_increment=all_days&limit=500&access_token=${token.accessToken}`
      ).catch((err) => {
        console.log(`Explorer insights fetch failed for ${actId}: ${err.message}`);
        return { data: [] };
      }),
    ]);

    metaList.forEach((c) => {
      metaByCampaignId.set(String(c.id), {
        meta: c,
        insights: null,
        accountId,
        accountName: accountNameMap.get(accountId) || accountId,
      });
    });

    (insightsData.data || []).forEach((row) => {
      const id = String(row.campaign_id || "");
      if (!id) return;
      const existing = metaByCampaignId.get(id) || {
        meta: { id, name: row.campaign_name },
        accountId,
        accountName: accountNameMap.get(accountId) || accountId,
      };
      existing.insights = row;
      metaByCampaignId.set(id, existing);
    });
  }

  // Orders in range, enriched enough for delivery/product/city/state
  // breakdowns — same field selection Phase 2/3/6 already use.
  const rawOrders = await ShiprocketOrder.find({ orderDate: { $gte: since, $lte: until } })
    .select("orderId orderDate campaignId campaignName totalAmountPayable paymentType paymentStatus orderCreatedAt phone address raw")
    .lean();

  const ordersByCampaignName = new Map();
  rawOrders.forEach((o) => {
    const key = normalizeCampaignName(o.campaignName);
    if (!key) return;
    if (!ordersByCampaignName.has(key)) ordersByCampaignName.set(key, []);
    ordersByCampaignName.get(key).push(o);
  });

  const knownNames = new Set([...metaByCampaignId.values()].map((v) => normalizeCampaignName(v.meta.name)));

  const campaigns = [...metaByCampaignId.values()].map(({ meta, insights, accountId, accountName }) => {
    const campaignId = String(meta.id || "");
    const campaignName = meta.name || insights?.campaign_name || "Untitled Campaign";
    const normalizedName = normalizeCampaignName(campaignName);
    const campaignOrders = ordersByCampaignName.get(normalizedName) || [];

    const spend = Number(insights?.spend || 0);
    const impressions = Number(insights?.impressions || 0);
    const reach = Number(insights?.reach || 0);
    const clicks = Number(insights?.clicks || 0);
    const ctr = Number(insights?.ctr || 0);
    const cpc = Number(insights?.cpc || 0);
    const cpm = Number(insights?.cpm || 0);
    const purchases = findActionValue(insights?.actions, ["purchase", "omni_purchase"]) || 0;
    const purchaseValue = findActionValue(insights?.action_values, ["purchase", "omni_purchase"]) || 0;

    // Campaign's own active window, for "outside selected campaign date
    // range" — an order that name-matched this campaign but happened
    // before it started / after it stopped (per Meta's own schedule).
    const startTime = meta.start_time || null;
    const stopTime = meta.stop_time || null;
    const startBound = startTime ? new Date(startTime) : null;
    const stopBound = stopTime ? new Date(stopTime) : null;

    let matchedOrders = 0;
    let outsideRangeOrders = 0;
    let revenue = 0;
    let codOrders = 0, codRevenue = 0, prepaidOrders = 0, prepaidRevenue = 0;
    const delivery = { delivered: 0, pending: 0, processing: 0, cancelled: 0, returned: 0, rto: 0 };
    const productCounts = new Map();
    const cityCounts = new Map();
    const stateCounts = new Map();
    const phoneOrderCounts = new Map();
    let lastOrderAt = null; // most recent orderCreatedAt among this campaign's orders — feeds the "no orders in last 6h" alert

    campaignOrders.forEach((o) => {
      const amount = Number(o.totalAmountPayable || 0);
      revenue += amount;

      const created = o.orderCreatedAt ? new Date(o.orderCreatedAt) : o.orderDate ? new Date(o.orderDate) : null;
      if (created && !isNaN(created.getTime()) && (!lastOrderAt || created > lastOrderAt)) lastOrderAt = created;
      const withinCampaignWindow =
        (!startBound || !created || created >= startBound) && (!stopBound || !created || created <= stopBound);
      if (withinCampaignWindow) matchedOrders += 1;
      else outsideRangeOrders += 1;

      if (o.paymentType === "PREPAID") {
        prepaidOrders += 1;
        prepaidRevenue += amount;
      } else if (o.paymentType === "CASH_ON_DELIVERY") {
        codOrders += 1;
        codRevenue += amount;
      }

      delivery[deliveryBucket6(extractDeliveryStatus(o.raw))] += 1;

      extractProducts(o.raw).forEach((p) => productCounts.set(p, (productCounts.get(p) || 0) + 1));
      if (o.address?.city) cityCounts.set(o.address.city, (cityCounts.get(o.address.city) || 0) + 1);
      if (o.address?.state) stateCounts.set(o.address.state, (stateCounts.get(o.address.state) || 0) + 1);
      if (o.phone) phoneOrderCounts.set(o.phone, (phoneOrderCounts.get(o.phone) || 0) + 1);
    });

    const totalOrders = campaignOrders.length;
    // New/Returning: same definition Phase 6's Analytics Customer
    // section already established — "returning" means more than one
    // order from that phone within THIS selected range, not lifetime
    // history (no per-order-before-range query needed).
    let newCustomers = 0, returningCustomers = 0;
    phoneOrderCounts.forEach((count) => (count > 1 ? returningCustomers++ : newCustomers++));

    const profit = revenue - spend;
    const roas = spend ? revenue / spend : 0;

    return {
      campaignId,
      campaignName,
      accountId,
      accountName,
      objective: meta.objective || null,
      status: meta.status || null,
      effectiveStatus: meta.effective_status || null,
      buyingType: meta.buying_type || null,
      startTime,
      stopTime,
      createdTime: meta.created_time || null,
      updatedTime: meta.updated_time || null,
      lastOrderAt: lastOrderAt ? lastOrderAt.toISOString() : null,

      spend, reach, impressions, clicks, ctr, cpc, cpm,
      purchases, purchaseValue,
      roas,

      totalOrders,
      matchedOrders,
      unmatchedOrders: 0, // see file header — unmatched is a page-level concept, not per-row
      outsideRangeOrders,
      revenue: Math.round(revenue * 100) / 100,
      aov: totalOrders ? revenue / totalOrders : 0,
      costPerOrder: totalOrders ? spend / totalOrders : 0,
      revenuePerOrder: matchedOrders ? revenue / matchedOrders : 0,
      profit: Math.round(profit * 100) / 100,

      codOrders, codRevenue: Math.round(codRevenue * 100) / 100,
      prepaidOrders, prepaidRevenue: Math.round(prepaidRevenue * 100) / 100,

      delivered: delivery.delivered,
      pending: delivery.pending,
      processing: delivery.processing,
      cancelled: delivery.cancelled,
      returned: delivery.returned,
      rto: delivery.rto,

      newCustomers,
      returningCustomers,

      topProducts: [...productCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, count]) => ({ name, count })),
      topCities: [...cityCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, count]) => ({ name, count })),
      topStates: [...stateCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, count]) => ({ name, count })),
    };
  });

  // Global "truly unmatched" — same classification KpiAnalyticsPopup.jsx
  // already established: an order whose campaign name doesn't match ANY
  // known campaign for these accounts, in-range or not.
  const unmatchedOrders = rawOrders.filter((o) => !knownNames.has(normalizeCampaignName(o.campaignName)));

  return { campaigns, unmatchedOrdersCount: unmatchedOrders.length };
}

// ── GET /:tokenId — main Campaign Explorer list ─────────────────
router.get("/:tokenId", async (req, res) => {
  try {
    const { tokenId } = req.params;
    const { since, until } = req.query;
    if (!since || !until) {
      return res.status(400).json({ success: false, message: "since and until are required" });
    }

    const { token, accountIds, accountNameMap } = await resolveTokenAndAccounts(tokenId, req.query.adAccountId);

    const cacheKey = `list:${tokenId}:${[...accountIds].sort().join(",")}:${since}:${until}`;
    const cached = cacheGet(cacheKey);
    if (cached) return res.json({ ...cached, cached: true });

    const { campaigns, unmatchedOrdersCount } = await fetchCombinedCampaigns({
      token, accountIds, accountNameMap, since, until,
    });

    const totalSpend = campaigns.reduce((s, c) => s + c.spend, 0);
    const totalRevenue = campaigns.reduce((s, c) => s + c.revenue, 0);

    const payload = {
      success: true,
      since,
      until,
      accountIds,
      campaigns,
      summary: {
        totalCampaigns: campaigns.length,
        totalSpend: Math.round(totalSpend * 100) / 100,
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        totalProfit: Math.round((totalRevenue - totalSpend) * 100) / 100,
        averageROAS: totalSpend ? totalRevenue / totalSpend : 0,
        totalOrders: campaigns.reduce((s, c) => s + c.totalOrders, 0),
        unmatchedOrders: unmatchedOrdersCount,
        activeAdAccounts: accountIds.length,
      },
    };

    cacheSet(cacheKey, payload);
    res.json(payload);
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

// ── GET /:tokenId/live — Live Campaign Monitoring (today, IST) ──
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
function todayIso() {
  return new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

router.get("/:tokenId/live", async (req, res) => {
  try {
    const { tokenId } = req.params;
    const { token, accountIds, accountNameMap } = await resolveTokenAndAccounts(tokenId, req.query.adAccountId);

    const today = todayIso();
    const cacheKey = `live:${tokenId}:${[...accountIds].sort().join(",")}:${today}`;
    const cached = cacheGet(cacheKey);
    if (cached) return res.json({ ...cached, cached: true });

    const { campaigns } = await fetchCombinedCampaigns({
      token, accountIds, accountNameMap, since: today, until: today,
    });

    // "Live" = Meta considers it currently deliverable — active or in
    // review, not a hard requirement of having spend yet today.
    const LIVE_STATUSES = new Set(["ACTIVE", "IN_PROCESS", "PENDING_REVIEW"]);
    const liveCampaigns = campaigns.filter((c) => LIVE_STATUSES.has(c.effectiveStatus) || LIVE_STATUSES.has(c.status));

    const totalSpend = liveCampaigns.reduce((s, c) => s + c.spend, 0);
    const totalRevenue = liveCampaigns.reduce((s, c) => s + c.revenue, 0);

    const payload = {
      success: true,
      date: today,
      campaigns: liveCampaigns,
      allCampaigns: campaigns, // for "no orders today" / "receiving orders today" filters, which apply to more than just ACTIVE-status ones
      summary: {
        liveCampaigns: liveCampaigns.length,
        spendToday: Math.round(totalSpend * 100) / 100,
        revenueToday: Math.round(totalRevenue * 100) / 100,
        ordersToday: liveCampaigns.reduce((s, c) => s + c.totalOrders, 0),
        roasToday: totalSpend ? totalRevenue / totalSpend : 0,
        profitToday: Math.round((totalRevenue - totalSpend) * 100) / 100,
        activeAdAccounts: accountIds.length,
      },
    };

    cacheSet(cacheKey, payload);
    res.json(payload);
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

// ── GET /:tokenId/:campaignId/breakdown — lazy expandable-row data ──
router.get("/:tokenId/:campaignId/breakdown", async (req, res) => {
  try {
    const { tokenId, campaignId } = req.params;
    const { campaignName, accountId, since, until } = req.query;
    if (!campaignName || !since || !until) {
      return res.status(400).json({ success: false, message: "campaignName, since and until are required" });
    }

    const token = await Token.findById(tokenId).lean();
    if (!token) return res.status(404).json({ success: false, message: "Token not found" });

    const cacheKey = `breakdown:${tokenId}:${campaignId}:${since}:${until}`;
    const cached = cacheGet(cacheKey);
    if (cached) return res.json({ ...cached, cached: true });

    // Daily spend trend — same time_increment=1 pattern the existing
    // /campaigns/:tokenId/date-range route already uses, just filtered
    // down to this one campaign's rows after the fact.
    let spendByDay = new Map();
    if (accountId) {
      const actId = accountId.startsWith("act_") ? accountId : `act_${accountId}`;
      try {
        const fields = ["campaign_id", "spend"].join(",");
        const url =
          `https://graph.facebook.com/v19.0/${actId}/insights?level=campaign` +
          `&fields=${encodeURIComponent(fields)}` +
          `&time_range=${encodeURIComponent(JSON.stringify({ since, until }))}` +
          `&time_increment=1&limit=500&access_token=${token.accessToken}`;
        const data = await fbGet(url);
        (data.data || []).forEach((row) => {
          if (String(row.campaign_id) === String(campaignId)) {
            spendByDay.set(row.date_start, Number(row.spend || 0));
          }
        });
      } catch (err) {
        console.log(`Explorer breakdown spend-trend fetch failed: ${err.message}`);
      }
    }

    const normalizedTarget = normalizeCampaignName(campaignName);
    const rawOrders = await ShiprocketOrder.find({ orderDate: { $gte: since, $lte: until } })
      .select("orderId orderDate campaignName totalAmountPayable paymentType orderCreatedAt phone address raw")
      .lean();
    const orders = rawOrders.filter((o) => normalizeCampaignName(o.campaignName) === normalizedTarget);

    const byDay = new Map();
    const delivery = { delivered: 0, pending: 0, processing: 0, cancelled: 0, returned: 0, rto: 0 };
    let codOrders = 0, prepaidOrders = 0;
    const productCounts = new Map();
    const cityCounts = new Map();
    const stateCounts = new Map();

    orders.forEach((o) => {
      const day = o.orderDate;
      if (day) {
        const cur = byDay.get(day) || { date: day, orders: 0, revenue: 0 };
        cur.orders += 1;
        cur.revenue += Number(o.totalAmountPayable || 0);
        byDay.set(day, cur);
      }
      if (o.paymentType === "PREPAID") prepaidOrders += 1;
      else if (o.paymentType === "CASH_ON_DELIVERY") codOrders += 1;

      delivery[deliveryBucket6(extractDeliveryStatus(o.raw))] += 1;
      extractProducts(o.raw).forEach((p) => productCounts.set(p, (productCounts.get(p) || 0) + 1));
      if (o.address?.city) cityCounts.set(o.address.city, (cityCounts.get(o.address.city) || 0) + 1);
      if (o.address?.state) stateCounts.set(o.address.state, (stateCounts.get(o.address.state) || 0) + 1);
    });

    const allDays = new Set([...byDay.keys(), ...spendByDay.keys()]);
    const trend = [...allDays]
      .sort()
      .map((date) => ({
        date,
        revenue: Math.round((byDay.get(date)?.revenue || 0) * 100) / 100,
        orders: byDay.get(date)?.orders || 0,
        spend: Math.round((spendByDay.get(date) || 0) * 100) / 100,
      }));

    const payload = {
      success: true,
      since,
      until,
      trend,
      paymentSplit: { cod: codOrders, prepaid: prepaidOrders },
      deliveryDistribution: delivery,
      topProducts: [...productCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, count]) => ({ name, count })),
      topCities: [...cityCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, count]) => ({ name, count })),
      topStates: [...stateCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, count]) => ({ name, count })),
    };

    cacheSet(cacheKey, payload);
    res.json(payload);
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

export default router;
