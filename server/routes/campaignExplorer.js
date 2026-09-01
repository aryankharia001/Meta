import express from "express";
import ShiprocketOrder from "../models/shiprocketorder.js";
import Token from "../models/Token.js";
import AdAccount from "../models/AdAccount.js";
// Phase 39 — Campaign Activity History, Active/Inactive Periods & Order
// Attribution. Additive import only, same helpers routes/campaigns.js's
// /compare now also uses — see campaignActivity.js's header. Duplicated
// import here (not re-exported from campaigns.js) per this file's own
// "zero coupling to earlier/sibling phases" convention stated above.
import { ensureBaselinesBulk, getActivitySnapshotsBulk, classifyOrders, computePrimaryRoas, statusBucket } from "../lib/campaignActivity.js";
// Campaign History Phase — additive import only, same shared resolver
// routes/campaigns.js's /compare now also uses (see
// lib/campaignIdentity.js's header). Duplicated import here rather than
// re-exported from campaigns.js, per this file's own "zero coupling to
// earlier/sibling phases" convention stated above — the resolver itself
// is the one deliberate, documented exception to that convention.
import MetaEntityState from "../models/MetaEntityState.js";
import { buildCampaignIdentityResolver, buildSingleCampaignResolver } from "../lib/campaignIdentity.js";

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

// Meta's "you are being throttled, wait and retry" signals — code 4
// (app-level), 17 (user-level, "too many calls"), 32 (page-level),
// 80004 (ad-account level — "There have been too many calls to this
// ad-account. Wait a bit and try again."), 613 (custom/marketing API
// rate limit). Deliberately narrow: every other error (missing object,
// bad token, validation) is NOT retried and throws on the first
// attempt, same as before. Duplicated locally rather than imported from
// lib/metaGraph.js on purpose — this file keeps its own fbGet copy
// exactly as the rest of its header already explains, so nothing here
// couples to, or can be changed by, any other phase's copy.
function isMetaRateLimitError(errData) {
  const code = errData?.code;
  return code === 4 || code === 17 || code === 32 || code === 80004 || code === 613;
}

const RATE_LIMIT_RETRIES = 3;
const RATE_LIMIT_BASE_DELAY_MS = 4000;

function rateLimitDelayMs(attempt) {
  return Math.round(RATE_LIMIT_BASE_DELAY_MS * 2 ** attempt + Math.random() * 1000);
}

async function fbGet(urlStr) {
  for (let attempt = 0; ; attempt += 1) {
    const res = await fetch(urlStr);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
      if (isMetaRateLimitError(data.error) && attempt < RATE_LIMIT_RETRIES) {
        const delayMs = rateLimitDelayMs(attempt);
        console.warn(
          `Meta API rate limit (code ${data.error.code}) — retrying in ${Math.round(delayMs / 1000)}s (attempt ${attempt + 1}/${RATE_LIMIT_RETRIES})`
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
      const msg = data.error?.message || `FB API error (${res.status})`;
      const err = new Error(msg);
      err.fbErrorCode = data.error?.code;
      err.fbErrorSubcode = data.error?.error_subcode;
      throw err;
    }
    return data;
  }
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

// Phase 30 — Hook Rate (3-second video views / impressions). Meta's real
// "3-Second Video Views" number comes back as action_type "video_view"
// on either the `actions` list or the dedicated `video_play_actions`
// field, depending on API version/fields requested — probe both and
// never fall back to a different metric (e.g. video_p25_watched_actions)
// if neither is present, per the explicit "N/A rather than invent a
// value" requirement. Duplicated byte-identically in campaigns.js/
// adSetExplorer.js/adExplorer.js so hook rate is genuinely comparable
// Campaign → Ad Set → Ad — same "zero coupling between phases"
// convention this file's header already established for its other
// helpers.
function extractThreeSecVideoViews(actions, videoPlayActions) {
  const fromVideoPlayActions = findActionValue(videoPlayActions, ["video_view"]);
  if (fromVideoPlayActions !== null) return fromVideoPlayActions;
  const fromActions = findActionValue(actions, ["video_view"]);
  if (fromActions !== null) return fromActions;
  return null;
}

function computeHookRate(threeSecVideoViews, impressions) {
  if (threeSecVideoViews == null || !impressions) return null;
  return (threeSecVideoViews / impressions) * 100;
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

// Phase 11 — same line-item probing as extractProducts() above, but also
// carrying quantity, for the Products/Units Sold columns the redesigned
// Campaign Explorer table now surfaces (same field-probing convention
// dailyReports.js's extractProductLines already established). Additive
// only — doesn't change extractProducts() or anything that reads it.
function extractProductLines(raw) {
  const items =
    raw?.cart_data?.line_items || raw?.line_items || raw?.products || raw?.items || raw?.cart_data?.products;
  if (!Array.isArray(items) || items.length === 0) return [];
  return items.map((i) => ({
    name: i?.name || i?.product_name || i?.title || "Unknown product",
    quantity: i?.quantity != null ? Number(i.quantity) : i?.qty != null ? Number(i.qty) : 1,
  }));
}

// Phase 11 — UI/display-only helper (identical convention to the copy in
// campaigns.js). Meta returns daily_budget/lifetime_budget in the ad
// account's currency's minor unit — divide by 100 for the real amount.
// Never used in spend/revenue/ROAS/matching math anywhere in this file.
function deriveBudget(meta) {
  if (!meta) return { budget: null, budgetType: null };
  if (meta.daily_budget !== undefined && meta.daily_budget !== null && meta.daily_budget !== "") {
    return { budget: Number(meta.daily_budget) / 100, budgetType: "daily" };
  }
  if (meta.lifetime_budget !== undefined && meta.lifetime_budget !== null && meta.lifetime_budget !== "") {
    return { budget: Number(meta.lifetime_budget) / 100, budgetType: "lifetime" };
  }
  return { budget: null, budgetType: null };
}

// Phase 38 — Campaign Bid Cap Fallback to Ad Set, identical convention
// to deriveBudget() above and its copies in campaigns.js/dailyReports.js.
// Meta's Graph API never actually returns bid_amount on a Campaign node
// (only on Ad Sets), so this only ever reads it where present — a safe
// no-op today, kept generic in case Meta's own API surface changes.
function deriveBidCap(meta) {
  if (!meta) return null;
  if (meta.bid_amount !== undefined && meta.bid_amount !== null && meta.bid_amount !== "") {
    return Number(meta.bid_amount) / 100;
  }
  return null;
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
async function fetchCombinedCampaigns({ token, accountIds, accountNameMap, since, until, includeNoLongerReturned = false }) {
  const insightFields = [
    "campaign_id", "campaign_name", "spend", "impressions", "reach", "clicks",
    "ctr", "cpc", "cpm", "frequency", "actions", "action_values", "purchase_roas",
    // Phase 30 — Hook Rate / Video Views. See extractThreeSecVideoViews().
    "video_play_actions",
  ].join(",");

  const metaByCampaignId = new Map(); // campaignId -> { meta, insights, accountId }

  // Phase 38 — Campaign Budget/Bid Cap Fallback to Ad Set. Mirrors the
  // convention campaigns.js's /compare route already established (Phase
  // 36 §4): when a campaign's own Meta-reported budget and/or bid cap is
  // missing, bulk-fetch this account's ad sets once and roll their own
  // budgets/bid caps up into the campaign — never invented, never
  // touching spend/revenue/ROAS/matching. Only ever fetched for accounts
  // that actually have a campaign missing one of these two fields, so
  // accounts where every campaign already has both pay zero extra Graph
  // API cost.
  const adSetBudgetByCampaignId = new Map(); // campaignId -> { dailyTotal, lifetimeTotal, hasDaily, hasLifetime }
  const adSetBidCapByCampaignId = new Map(); // campaignId -> { min, max }

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

    // Phase 39 §4 — bounded auto-tracking: seed a Campaign Activity
    // History baseline for any campaign in this account not tracked
    // yet. DB-only (reuses metaList, already fetched above — no extra
    // Meta call), a no-op once tracked. Never blocks/fails the response
    // if it errors — Activity History is additive, not load-bearing for
    // this route's existing fields.
    await ensureBaselinesBulk({
      tokenId: String(token._id),
      accountId,
      campaigns: metaList.map((c) => ({
        entityId: String(c.id || ""),
        entityName: c.name || "",
        status: c.status || null,
        effectiveStatus: c.effective_status || null,
        createdTime: c.created_time || null,
      })),
    }).catch((err) => console.log(`Campaign activity baseline seeding failed for ${actId}: ${err.message}`));

    // Phase 38 — only bother fetching this account's ad sets when at
    // least one of its campaigns has no genuine campaign-level budget
    // and/or no genuine campaign-level bid cap.
    const campaignIdsNeedingAdSetData = metaList
      .filter((c) => !deriveBudget(c).budget || deriveBidCap(c) === null)
      .map((c) => String(c.id));
    if (campaignIdsNeedingAdSetData.length > 0) {
      const missingSet = new Set(campaignIdsNeedingAdSetData);
      try {
        const adsetList = await fetchAllPages(
          `https://graph.facebook.com/v19.0/${actId}/adsets?fields=${encodeURIComponent("id,campaign_id,daily_budget,lifetime_budget,bid_amount")}&limit=500&access_token=${token.accessToken}`
        );
        adsetList.forEach((a) => {
          const cid = String(a.campaign_id || "");
          // Only campaigns actually missing their own budget/bid cap
          // need a rollup — never overrides a genuine campaign-level
          // value.
          if (!cid || !missingSet.has(cid)) return;
          const { budget: adsetBudget, budgetType: adsetBudgetType } = deriveBudget(a);
          if (adsetBudget !== null) {
            const entry = adSetBudgetByCampaignId.get(cid) || {
              dailyTotal: 0,
              lifetimeTotal: 0,
              hasDaily: false,
              hasLifetime: false,
            };
            if (adsetBudgetType === "daily") {
              entry.dailyTotal += adsetBudget;
              entry.hasDaily = true;
            } else if (adsetBudgetType === "lifetime") {
              entry.lifetimeTotal += adsetBudget;
              entry.hasLifetime = true;
            }
            adSetBudgetByCampaignId.set(cid, entry);
          }
          const adsetBidCap = deriveBidCap(a);
          if (adsetBidCap !== null) {
            const bc = adSetBidCapByCampaignId.get(cid) || { min: adsetBidCap, max: adsetBidCap };
            bc.min = Math.min(bc.min, adsetBidCap);
            bc.max = Math.max(bc.max, adsetBidCap);
            adSetBidCapByCampaignId.set(cid, bc);
          }
        });
      } catch (err) {
        console.log(`Explorer ad set budget/bid cap fallback fetch failed for ${actId}: ${err.message}`);
      }
    }

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

  // Campaign History Phase §9/§10 — deleted / no-longer-returned
  // campaigns, folded into metaByCampaignId (same shape live entries
  // already use: { meta, insights, accountId, accountName }) only when
  // explicitly requested, so every downstream step below (activity
  // snapshots, order matching, delivery/product/city aggregation, the
  // row-shaping return{} at the end of the .map()) handles them through
  // the exact same code live campaigns already go through, rather than
  // a second hand-duplicated row shape. `insights` stays undefined, so
  // spend/impressions/clicks/etc. all naturally compute to 0 — Meta no
  // longer reports insights for a deleted campaign id. meta.isDeleted /
  // meta.noLongerReturnedAt are extra fields deriveBudget()/deriveBidCap()
  // don't look at; the row-shaping code below reads them explicitly.
  if (includeNoLongerReturned) {
    const deletedFilter = { tokenId: String(token._id), entityType: "campaign", isDeleted: true };
    if (accountIds && accountIds.length) deletedFilter.accountId = { $in: accountIds };
    const deletedRows = await MetaEntityState.find(deletedFilter).lean();
    deletedRows.forEach((state) => {
      const id = String(state.entityId);
      if (metaByCampaignId.has(id)) return; // already live this tick — not actually deleted
      metaByCampaignId.set(id, {
        meta: {
          id,
          name: state.name || id,
          status: state.status || null,
          effective_status: state.effectiveStatus || null,
          daily_budget: state.budgetType === "daily" && state.budget !== null && state.budget !== undefined ? Math.round(state.budget * 100) : undefined,
          lifetime_budget: state.budgetType === "lifetime" && state.budget !== null && state.budget !== undefined ? Math.round(state.budget * 100) : undefined,
          bid_amount: state.bidAmount !== null && state.bidAmount !== undefined ? Math.round(state.bidAmount * 100) : undefined,
          isDeleted: true,
          noLongerReturnedAt: state.noLongerReturnedAt || null,
        },
        insights: undefined,
        accountId: state.accountId,
        accountName: accountNameMap.get(state.accountId) || state.accountId,
      });
    });
  }

  // Phase 39 — Campaign Activity snapshots for every campaign about to
  // be returned. ONE bulk query for the whole page, same "bulk, not
  // per-item" principle the Ad Set budget/bid-cap fallback above
  // already established.
  const activitySnapshots = await getActivitySnapshotsBulk({
    tokenId: String(token._id),
    entityIds: [...metaByCampaignId.keys()],
  });

  // Orders in range, enriched enough for delivery/product/city/state
  // breakdowns — same field selection Phase 2/3/6 already use.
  const rawOrders = await ShiprocketOrder.find({ orderDate: { $gte: since, $lte: until } })
    .select("orderId orderDate campaignId campaignName totalAmountPayable paymentType paymentStatus orderCreatedAt phone address raw")
    .lean();

  // Campaign History Phase — spec §21's required direction: order's
  // campaign_name -> current + auto-historical + manual mapping chain ->
  // Campaign ID, not the old "campaign -> name-match -> orders"
  // direction this file used to use (see lib/campaignIdentity.js's
  // header). Also resolves a renamed campaign's pre-rename orders
  // correctly, which the old exact-current-name match could not do.
  const campaignIdentityResolver = await buildCampaignIdentityResolver({
    tokenId: String(token._id),
    accountIds,
    liveCampaigns: [...metaByCampaignId.values()].map(({ meta, accountId }) => ({
      campaignId: meta.id,
      campaignName: meta.name,
      accountId,
    })),
  });

  const ordersByCampaignId = {};
  const orderMatchById = new Map();
  rawOrders.forEach((o) => {
    const match = campaignIdentityResolver.resolve(o);
    orderMatchById.set(o.orderId, match);
    if (match.campaignId) {
      if (!ordersByCampaignId[match.campaignId]) ordersByCampaignId[match.campaignId] = [];
      ordersByCampaignId[match.campaignId].push(o);
    }
  });

  const campaigns = [...metaByCampaignId.values()].map(({ meta, insights, accountId, accountName }) => {
    const campaignId = String(meta.id || "");
    const campaignName = meta.name || insights?.campaign_name || "Untitled Campaign";
    const campaignOrders = ordersByCampaignId[campaignId] || [];

    const spend = Number(insights?.spend || 0);
    const impressions = Number(insights?.impressions || 0);
    const reach = Number(insights?.reach || 0);
    const clicks = Number(insights?.clicks || 0);
    const ctr = Number(insights?.ctr || 0);
    const cpc = Number(insights?.cpc || 0);
    const cpm = Number(insights?.cpm || 0);
    const purchases = findActionValue(insights?.actions, ["purchase", "omni_purchase"]) || 0;
    const purchaseValue = findActionValue(insights?.action_values, ["purchase", "omni_purchase"]) || 0;
    // Phase 30 — Hook Rate / Video Views.
    const threeSecVideoViews = extractThreeSecVideoViews(insights?.actions, insights?.video_play_actions);
    const hookRate = computeHookRate(threeSecVideoViews, impressions);

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
    const distinctProducts = new Set(); // Phase 11 — Products/Units Sold columns
    let unitsSold = 0;

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
      extractProductLines(o.raw).forEach((line) => {
        distinctProducts.add(line.name);
        unitsSold += line.quantity;
      });
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

    // Phase 38 — Campaign Budget/Bid Cap Fallback to Ad Set (see the
    // bulk ad-set fetch above). A genuine campaign-level value always
    // wins; *Source tells the client which one it's looking at so the
    // UI can show a small "Ad Set ... Applied" note without inventing a
    // second field. Never shows "N/A" when an Ad Set-level value can be
    // used instead — only when neither the campaign nor its Ad Sets
    // have one.
    let { budget, budgetType } = deriveBudget(meta);
    let budgetSource = budget !== null && budget !== undefined ? "campaign" : "none";
    if (budgetSource === "none") {
      const sum = adSetBudgetByCampaignId.get(campaignId);
      if (sum && (sum.hasDaily || sum.hasLifetime)) {
        if (sum.hasDaily) {
          budget = sum.dailyTotal;
          budgetType = "daily";
        } else {
          budget = sum.lifetimeTotal;
          budgetType = "lifetime";
        }
        budgetSource = "adsets";
      }
    }

    const campaignBidCap = deriveBidCap(meta);
    let bidCapMin = campaignBidCap !== null ? campaignBidCap : null;
    let bidCapMax = bidCapMin;
    let bidCapSource = bidCapMin !== null ? "campaign" : "none";
    if (bidCapSource === "none") {
      const bc = adSetBidCapByCampaignId.get(campaignId);
      if (bc) {
        bidCapMin = bc.min;
        bidCapMax = bc.max;
        bidCapSource = "adsets";
      }
    }

    // Phase 39 §7/§9/§15 — Campaign Activity attribution, same
    // classifyOrders()/computePrimaryRoas() helpers routes/campaigns.js's
    // /compare now also uses, over this row's own already-matched
    // campaignOrders (nothing re-matched) and its own already-fetched
    // `spend` (already active-period spend by construction — see
    // campaignActivity.js's computePrimaryRoas() header).
    const activitySnapshot = activitySnapshots.get(campaignId) || null;
    const attribution = classifyOrders(campaignOrders, activitySnapshot);
    const primaryRoas = computePrimaryRoas(attribution.active.revenue, spend);

    return {
      campaignId,
      campaignName,
      accountId,
      accountName,
      objective: meta.objective || null,
      status: meta.status || null,
      effectiveStatus: meta.effective_status || null,
      buyingType: meta.buying_type || null,
      budget,
      budgetType,
      budgetSource,
      bidCapMin,
      bidCapMax,
      bidCapSource,
      startTime,
      stopTime,
      createdTime: meta.created_time || null,
      updatedTime: meta.updated_time || null,
      lastOrderAt: lastOrderAt ? lastOrderAt.toISOString() : null,
      // Campaign History Phase §9/§10 — additive fields only. false/null
      // for every live campaign (meta.isDeleted is only ever set on the
      // synthetic entries injected above).
      isDeleted: !!meta.isDeleted,
      noLongerReturnedAt: meta.noLongerReturnedAt || null,

      // Phase 39 §15 — Campaign Activity column group. `roas` below
      // (spend ÷ ALL matched-order revenue in range) stays exactly as
      // every existing caller of this endpoint already reads it;
      // `primaryRoas` is the new active-period-only figure.
      activityTrackingAvailable: !!activitySnapshot?.available,
      activityStatus: activitySnapshot?.currentBucket || statusBucket(meta.effective_status || meta.status),
      activeDays: activitySnapshot?.activeDays ?? null,
      activeHours: activitySnapshot?.activeHours ?? null,
      inactiveDays: activitySnapshot?.inactiveDays ?? null,
      inactiveHours: activitySnapshot?.inactiveHours ?? null,
      activePeriodsCount: activitySnapshot?.activePeriods ?? null,
      inactivePeriodsCount: activitySnapshot?.inactivePeriods ?? null,
      campaignStart: activitySnapshot?.campaignStart || null,
      campaignEnd: activitySnapshot?.campaignEnd || null,
      activePeriodOrders: attribution.active.orders,
      activePeriodRevenue: attribution.active.revenue,
      inactivePeriodOrders: attribution.inactivePaused.orders,
      inactivePeriodRevenue: attribution.inactivePaused.revenue,
      postCampaignOrders: attribution.postCampaign.orders,
      postCampaignRevenue: attribution.postCampaign.revenue,
      historicalUnavailableOrders: attribution.historicalUnavailable.orders,
      historicalUnavailableRevenue: attribution.historicalUnavailable.revenue,
      primaryRoas,

      spend, reach, impressions, clicks, ctr, cpc, cpm,
      purchases, purchaseValue,
      roas,
      // Phase 30 — Video Views / Hook Rate.
      videoViews: threeSecVideoViews,
      hookRate,

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

      totalProductsSold: distinctProducts.size,
      totalUnitsSold: unitsSold,

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
  const unmatchedOrders = rawOrders.filter((o) => !orderMatchById.get(o.orderId)?.campaignId);

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
    // Campaign History Phase §9/§10 — hidden by default, revealed via
    // this explicit opt-in flag (same convention routes/campaigns.js's
    // /compare now uses).
    const includeNoLongerReturned = String(req.query.includeNoLongerReturned) === "true";

    const { token, accountIds, accountNameMap } = await resolveTokenAndAccounts(tokenId, req.query.adAccountId);

    const cacheKey = `list:${tokenId}:${[...accountIds].sort().join(",")}:${since}:${until}:${includeNoLongerReturned}`;
    const cached = cacheGet(cacheKey);
    if (cached) return res.json({ ...cached, cached: true });

    const { campaigns, unmatchedOrdersCount } = await fetchCombinedCampaigns({
      token, accountIds, accountNameMap, since, until, includeNoLongerReturned,
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

    // Campaign History Phase — resolved via the same shared current +
    // auto-historical + manual name chain the list route above uses
    // (buildSingleCampaignResolver — scoped to just this one campaign,
    // so there's no cross-campaign ambiguity), replacing the old exact-
    // current-name-only comparison. See lib/campaignIdentity.js's
    // header.
    const singleResolver = await buildSingleCampaignResolver({
      tokenId,
      campaignId,
      currentName: campaignName,
    });
    const rawOrders = await ShiprocketOrder.find({ orderDate: { $gte: since, $lte: until } })
      .select("orderId orderDate campaignName totalAmountPayable paymentType orderCreatedAt phone address raw")
      .lean();
    const orders = rawOrders.filter((o) => singleResolver.resolve(o).campaignId);

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
