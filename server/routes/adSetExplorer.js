import express from "express";
import ShiprocketOrder from "../models/shiprocketorder.js";
import Token from "../models/Token.js";
import AdAccount from "../models/AdAccount.js";
import {
  fbGet,
  fetchAllPages,
  actIdOf,
  findActionValue,
  deriveBudget,
  extractDeliveryStatus,
  deliveryBucket6,
  createTtlCache,
  GRAPH_BASE,
} from "../lib/metaGraph.js";
import { getStoredShiprocketOrders, summarizeStoredOrders } from "../services/shiprocketService.js";
// Phase 44 — Campaign Activity History, extended to Ad Sets. Additive
// import only; nothing above is touched. See campaignActivity.js's own
// header for ensureEntityBaselinesBulk()'s contract (a generic sibling
// of Phase 39's campaign-only ensureBaselinesBulk()).
import { ensureEntityBaselinesBulk } from "../lib/campaignActivity.js";

const router = express.Router();

// ─────────────────────────────────────────────────────────────
// Phase 13 §4/§10 — Ad Set Explorer. Entirely new, additive route file
// (mounted at /api/adset-explorer). Never imports from campaigns.js or
// campaignExplorer.js and never writes to ShiprocketOrder — only reads
// it via the existing read-path helpers in shiprocketService.js
// (getStoredShiprocketOrders/summarizeStoredOrders), the same functions
// the Shiprocket sync's own doc comments already earmarked for "each
// node of the FB campaign→adset→ad hierarchy tree" a future phase would
// build. Orders are joined to ad sets by the adsetId Shiprocket already
// stores per order (from cart_data.custom_attributes) — an ID match,
// never a name/string match, and never invented if absent.
// ─────────────────────────────────────────────────────────────

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

const ADSET_FIELDS = [
  "id", "name", "campaign_id", "campaign{id,name}", "status", "effective_status",
  "daily_budget", "lifetime_budget", "start_time", "end_time",
  "optimization_goal", "billing_event", "bid_strategy",
  // Phase 27 — additive field. bid_amount is Meta's actual "Bid Cap"
  // value (minor units, same convention as daily_budget/lifetime_budget
  // — see deriveBudget()). Nothing existing reads this field yet, so
  // adding it to the fetch list changes no current behavior; it lets
  // AdSetDrawer.jsx's new Budget & Bid Cap Control section show a real
  // current bid cap instead of just the bid_strategy name.
  "bid_amount",
  // Phase 32 §2/§4 — account_id, straight from Meta on the ad set node
  // itself (no extra request). Exposed in /:adsetId/details below as
  // adset.accountId so AdSetDrawer.jsx can build a real "Open in Meta
  // Ads Manager" deep link (act=<accountId>) without guessing.
  "account_id",
  "targeting", "created_time", "updated_time",
].join(",");

const ADSET_INSIGHT_FIELDS = [
  "adset_id", "adset_name", "campaign_id", "campaign_name",
  "spend", "impressions", "reach", "clicks", "ctr", "cpc", "cpm",
  "actions", "action_values",
  // Phase 30 — Hook Rate / Video Views. See extractThreeSecVideoViews()
  // below.
  "video_play_actions",
].join(",");

// Phase 30 — Hook Rate (3-second video views / impressions), duplicated
// byte-identically across campaignExplorer.js/campaigns.js/
// adSetExplorer.js/adExplorer.js so hook rate is genuinely comparable
// Campaign → Ad Set → Ad — see campaignExplorer.js's copy for the full
// explanation. Kept as a local duplicate here (not added to
// lib/metaGraph.js) even though this file already imports several other
// helpers from there, specifically so the formula can never accidentally
// drift between files via a shared edit. Never falls back to a different
// metric (e.g. video_p25_watched_actions) when the true 3s metric is
// absent — returns null (rendered "N/A" client-side) instead.
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

// Best-effort, display-only summary of a targeting object — never used
// for matching/attribution, purely descriptive text for the Ad Set
// Information panel. Meta's targeting object shape varies a lot; this
// only reads a handful of the most common keys and silently omits
// anything it doesn't recognize rather than guessing.
function summarizeTargeting(targeting) {
  if (!targeting || typeof targeting !== "object") return null;
  const parts = [];
  const ageMin = targeting.age_min;
  const ageMax = targeting.age_max;
  if (ageMin || ageMax) parts.push(`Age ${ageMin ?? "13"}–${ageMax ?? "65+"}`);
  if (Array.isArray(targeting.genders) && targeting.genders.length) {
    parts.push(targeting.genders.length === 1 ? (targeting.genders[0] === 1 ? "Men" : "Women") : "All genders");
  }
  const geo = targeting.geo_locations;
  if (geo) {
    const places = [
      ...(geo.countries || []),
      ...(geo.cities || []).map((c) => c.name).filter(Boolean),
      ...(geo.regions || []).map((r) => r.name).filter(Boolean),
    ];
    if (places.length) parts.push(places.slice(0, 3).join(", "));
  }
  if (Array.isArray(targeting.publisher_platforms) && targeting.publisher_platforms.length) {
    parts.push(targeting.publisher_platforms.join(", "));
  }
  return parts.length ? parts.join(" · ") : null;
}

async function fetchAdSetsForAccount(actId, accessToken) {
  try {
    return await fetchAllPages(
      `${GRAPH_BASE}/${actId}/adsets?fields=${encodeURIComponent(ADSET_FIELDS)}&limit=200&access_token=${accessToken}`
    );
  } catch (err) {
    console.log(`AdSet Explorer metadata fetch failed for ${actId}: ${err.message}`);
    return [];
  }
}

async function fetchAdSetInsightsForAccount(actId, accessToken, since, until) {
  try {
    const data = await fbGet(
      `${GRAPH_BASE}/${actId}/insights?level=adset&fields=${encodeURIComponent(ADSET_INSIGHT_FIELDS)}` +
        `&time_range=${encodeURIComponent(JSON.stringify({ since, until }))}` +
        `&time_increment=all_days&limit=500&access_token=${accessToken}`
    );
    return data.data || [];
  } catch (err) {
    console.log(`AdSet Explorer insights fetch failed for ${actId}: ${err.message}`);
    return [];
  }
}

const listCache = createTtlCache(45_000);

// ── GET /:tokenId — list ad sets (optionally scoped to one campaign) ──
router.get("/:tokenId", async (req, res) => {
  try {
    const { tokenId } = req.params;
    const { since, until, campaignId } = req.query;
    if (!since || !until) {
      return res.status(400).json({ success: false, message: "since and until are required" });
    }

    const { token, accountIds, accountNameMap } = await resolveTokenAndAccounts(tokenId, req.query.adAccountId);

    const cacheKey = `list:${tokenId}:${[...accountIds].sort().join(",")}:${since}:${until}:${campaignId || ""}`;
    const cached = listCache.get(cacheKey);
    if (cached) return res.json({ ...cached, cached: true });

    const byAdsetId = new Map();

    for (const accountId of accountIds) {
      const actId = actIdOf(accountId);
      const [metaList, insightsList] = await Promise.all([
        fetchAdSetsForAccount(actId, token.accessToken),
        fetchAdSetInsightsForAccount(actId, token.accessToken, since, until),
      ]);

      metaList.forEach((a) => {
        byAdsetId.set(String(a.id), {
          meta: a,
          insights: null,
          accountId,
          accountName: accountNameMap.get(accountId) || accountId,
        });
      });
      insightsList.forEach((row) => {
        const id = String(row.adset_id || "");
        if (!id) return;
        const existing = byAdsetId.get(id) || {
          meta: { id, name: row.adset_name, campaign_id: row.campaign_id, campaign: { name: row.campaign_name } },
          accountId,
          accountName: accountNameMap.get(accountId) || accountId,
        };
        existing.insights = row;
        byAdsetId.set(id, existing);
      });
    }

    let adsets = [...byAdsetId.values()];
    if (campaignId) {
      adsets = adsets.filter((a) => String(a.meta.campaign_id || "") === String(campaignId));
    }

    // Phase 44 §1/§4/§19 — Campaign Activity History, extended to Ad
    // Sets: seed a MetaEntityState + Ad Set status-history baseline for
    // any ad set in this list that isn't tracked yet. DB-only (reuses
    // `adsets`, already fetched above — no extra Meta call), a no-op
    // once tracked. Never blocks/fails this response if it errors —
    // Activity History is additive, not load-bearing for this route's
    // existing fields. Once a baseline exists, metaEntitySyncCron.js's
    // periodic poll takes over detecting further budget/bid-cap/status
    // changes for it, exactly like it already does for campaigns.
    await ensureEntityBaselinesBulk({
      tokenId,
      entityType: "adset",
      entities: adsets.map(({ meta, accountId }) => ({
        entityId: String(meta.id || ""),
        entityName: meta.name || "",
        status: meta.status || null,
        effectiveStatus: meta.effective_status || null,
        createdTime: meta.created_time || null,
        campaignId: String(meta.campaign_id || ""),
        accountId,
      })),
    }).catch((err) => console.log(`Ad set activity baseline seeding failed: ${err.message}`));

    // Orders in range, once, then grouped by adsetId — same "fetch once,
    // group by attribution key" shape groupStoredOrdersByAttribution()
    // already established, but done locally here so we can also compute
    // the six-bucket delivery split (that helper only returns
    // orderCount/revenue/codOrders/prepaidOrders).
    const rawOrders = await ShiprocketOrder.find({ orderDate: { $gte: since, $lte: until } })
      .select("orderId adsetId totalAmountPayable paymentType raw")
      .lean();

    const ordersByAdsetId = new Map();
    const knownAdsetIds = new Set(adsets.map((a) => String(a.meta.id)));
    let unmatchedOrders = 0;
    rawOrders.forEach((o) => {
      const key = o.adsetId ? String(o.adsetId) : "";
      if (!key || !knownAdsetIds.has(key)) {
        unmatchedOrders += 1;
        return;
      }
      if (!ordersByAdsetId.has(key)) ordersByAdsetId.set(key, []);
      ordersByAdsetId.get(key).push(o);
    });

    const rows = adsets.map(({ meta, insights, accountId, accountName }) => {
      const adsetId = String(meta.id || "");
      const orders = ordersByAdsetId.get(adsetId) || [];

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

      let revenue = 0, codOrders = 0, prepaidOrders = 0;
      const delivery = { delivered: 0, pending: 0, processing: 0, cancelled: 0, returned: 0, rto: 0 };
      orders.forEach((o) => {
        revenue += Number(o.totalAmountPayable || 0);
        if (o.paymentType === "PREPAID") prepaidOrders += 1;
        else if (o.paymentType === "CASH_ON_DELIVERY") codOrders += 1;
        delivery[deliveryBucket6(extractDeliveryStatus(o.raw))] += 1;
      });

      const { budget, budgetType } = deriveBudget(meta);
      const totalOrders = orders.length;

      return {
        adsetId,
        adsetName: meta.name || insights?.adset_name || "Untitled Ad Set",
        campaignId: String(meta.campaign_id || insights?.campaign_id || ""),
        campaignName: meta.campaign?.name || insights?.campaign_name || null,
        accountId,
        accountName,
        status: meta.status || null,
        effectiveStatus: meta.effective_status || null,
        budget,
        budgetType,
        startTime: meta.start_time || null,
        endTime: meta.end_time || null,
        optimizationGoal: meta.optimization_goal || null,
        billingEvent: meta.billing_event || null,
        bidStrategy: meta.bid_strategy || null,
        targetingSummary: summarizeTargeting(meta.targeting),
        createdTime: meta.created_time || null,
        updatedTime: meta.updated_time || null,

        spend, impressions, reach, clicks, ctr, cpc, cpm,
        purchases, purchaseValue,
        roas: spend ? purchaseValue / spend : 0,
        // Phase 30 — Video Views / Hook Rate.
        videoViews: threeSecVideoViews,
        hookRate,

        totalOrders,
        matchedOrders: totalOrders,
        unmatchedOrders: 0,
        revenue: Math.round(revenue * 100) / 100,
        codOrders, prepaidOrders,
        delivered: delivery.delivered,
        pending: delivery.pending,
        processing: delivery.processing,
        cancelled: delivery.cancelled,
        returned: delivery.returned,
        rto: delivery.rto,
      };
    });

    const payload = {
      success: true,
      since,
      until,
      campaignId: campaignId || null,
      adsets: rows,
      summary: {
        totalAdSets: rows.length,
        totalSpend: Math.round(rows.reduce((s, r) => s + r.spend, 0) * 100) / 100,
        totalRevenue: Math.round(rows.reduce((s, r) => s + r.revenue, 0) * 100) / 100,
        totalOrders: rows.reduce((s, r) => s + r.totalOrders, 0),
        unmatchedOrders,
      },
    };

    listCache.set(cacheKey, payload);
    res.json(payload);
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

// ── GET /:tokenId/by-campaign/:campaignId — Ad Sets nested under one
// campaign, fetched directly off the campaign object (no adAccountId
// needed) — used by CampaignDrawer's Ad Sets section and Campaign
// Explorer's expandable-row hierarchy (§3/§10). ──────────────────────
router.get("/:tokenId/by-campaign/:campaignId", async (req, res) => {
  try {
    const { tokenId, campaignId } = req.params;
    const { since, until } = req.query;

    const token = await Token.findById(tokenId).lean();
    if (!token) return res.status(404).json({ success: false, message: "Token not found" });

    const cacheKey = `bycampaign:${tokenId}:${campaignId}:${since || ""}:${until || ""}`;
    const cached = listCache.get(cacheKey);
    if (cached) return res.json({ ...cached, cached: true });

    const [metaList, insightsList] = await Promise.all([
      fetchAllPages(`${GRAPH_BASE}/${campaignId}/adsets?fields=${encodeURIComponent(ADSET_FIELDS)}&limit=200&access_token=${token.accessToken}`).catch((err) => {
        console.log(`AdSets-by-campaign metadata fetch failed for ${campaignId}: ${err.message}`);
        return [];
      }),
      since && until
        ? fbGet(
            `${GRAPH_BASE}/${campaignId}/insights?level=adset&fields=${encodeURIComponent(ADSET_INSIGHT_FIELDS)}` +
              `&time_range=${encodeURIComponent(JSON.stringify({ since, until }))}&time_increment=all_days&limit=500&access_token=${token.accessToken}`
          )
            .then((d) => d.data || [])
            .catch((err) => {
              console.log(`AdSets-by-campaign insights fetch failed for ${campaignId}: ${err.message}`);
              return [];
            })
        : Promise.resolve([]),
    ]);

    const byId = new Map();
    metaList.forEach((a) => byId.set(String(a.id), { meta: a, insights: null }));
    insightsList.forEach((row) => {
      const id = String(row.adset_id || "");
      if (!id) return;
      const existing = byId.get(id) || { meta: { id, name: row.adset_name, campaign_id: row.campaign_id }, insights: null };
      existing.insights = row;
      byId.set(id, existing);
    });

    const rangeSince = since || "2000-01-01";
    const rangeUntil = until || new Date().toISOString().slice(0, 10);
    const rawOrders = await ShiprocketOrder.find({ orderDate: { $gte: rangeSince, $lte: rangeUntil }, adsetId: { $ne: "" } })
      .select("adsetId totalAmountPayable paymentType raw")
      .lean();
    const ordersByAdset = new Map();
    rawOrders.forEach((o) => {
      const key = String(o.adsetId);
      if (!ordersByAdset.has(key)) ordersByAdset.set(key, []);
      ordersByAdset.get(key).push(o);
    });

    const adsets = [...byId.values()].map(({ meta, insights }) => {
      const adsetId = String(meta.id || "");
      const orders = ordersByAdset.get(adsetId) || [];
      const spend = Number(insights?.spend || 0);
      const impressions = Number(insights?.impressions || 0);
      const purchaseValue = findActionValue(insights?.action_values, ["purchase", "omni_purchase"]) || 0;
      let revenue = 0, codOrders = 0, prepaidOrders = 0;
      orders.forEach((o) => {
        revenue += Number(o.totalAmountPayable || 0);
        if (o.paymentType === "PREPAID") prepaidOrders += 1;
        else if (o.paymentType === "CASH_ON_DELIVERY") codOrders += 1;
      });
      // Phase 31 §2a — each ad set's own budget, same deriveBudget()
      // convention as campaigns.js/campaignExplorer.js, so the drawer can
      // tell a genuine campaign-level budget apart from Advantage+/
      // CBO-off ad-set-level budgeting and, when needed, sum the ad
      // sets' own budgets into a consolidated campaign total. Read-only —
      // never touches Phase 27's budget history/write endpoints.
      const { budget, budgetType } = deriveBudget(meta);
      // Phase 38 — each ad set's own real Meta bid_amount (minor units
      // -> real currency, same convention deriveBudget() already
      // applies), same field ADSET_FIELDS above already fetches for
      // AdSetDrawer's Control section. Additive — lets CampaignDrawer.jsx
      // roll these up into a Campaign Bid Cap fallback when the campaign
      // itself has none, the same way it already does for budget via
      // consolidatedCampaignBudget().
      const bidAmount = meta.bid_amount !== undefined && meta.bid_amount !== null && meta.bid_amount !== "" ? Number(meta.bid_amount) / 100 : null;
      // Phase 30 — Hook Rate / Video Views.
      const threeSecVideoViews = extractThreeSecVideoViews(insights?.actions, insights?.video_play_actions);
      return {
        adsetId,
        adsetName: meta.name || insights?.adset_name || "Untitled Ad Set",
        status: meta.status || null,
        effectiveStatus: meta.effective_status || null,
        budget,
        budgetType,
        bidAmount,
        bidStrategy: meta.bid_strategy || null,
        spend,
        purchaseValue,
        roas: spend ? purchaseValue / spend : 0,
        videoViews: threeSecVideoViews,
        hookRate: computeHookRate(threeSecVideoViews, impressions),
        totalOrders: orders.length,
        revenue: Math.round(revenue * 100) / 100,
        codOrders,
        prepaidOrders,
      };
    });

    const payload = { success: true, campaignId, adsets };
    listCache.set(cacheKey, payload);
    res.json(payload);
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

// ── GET /:tokenId/:adsetId/details — Ad Set Drawer ─────────────────
router.get("/:tokenId/:adsetId/details", async (req, res) => {
  try {
    const { tokenId, adsetId } = req.params;
    const { since, until } = req.query;

    const token = await Token.findById(tokenId).lean();
    if (!token) return res.status(404).json({ success: false, message: "Token not found" });

    let meta = null;
    try {
      meta = await fbGet(`${GRAPH_BASE}/${adsetId}?fields=${encodeURIComponent(ADSET_FIELDS)}&access_token=${token.accessToken}`);
    } catch (err) {
      console.log(`AdSet details metadata fetch failed for ${adsetId}: ${err.message}`);
    }

    let insights = null;
    try {
      const timeParam = since && until
        ? `time_range=${encodeURIComponent(JSON.stringify({ since, until }))}&time_increment=all_days`
        : `date_preset=maximum`;
      const data = await fbGet(
        `${GRAPH_BASE}/${adsetId}/insights?fields=${encodeURIComponent(ADSET_INSIGHT_FIELDS)}&${timeParam}&access_token=${token.accessToken}`
      );
      insights = (data.data || [])[0] || null;
    } catch (err) {
      console.log(`AdSet details insights fetch failed for ${adsetId}: ${err.message}`);
    }

    const rangeSince = since || "2000-01-01";
    const rangeUntil = until || new Date().toISOString().slice(0, 10);
    const orders = await getStoredShiprocketOrders(rangeSince, rangeUntil, { adsetId });
    const orderSummary = summarizeStoredOrders(orders);
    const delivery = { delivered: 0, pending: 0, processing: 0, cancelled: 0, returned: 0, rto: 0 };
    orders.forEach((o) => { delivery[deliveryBucket6(extractDeliveryStatus(o.raw))] += 1; });

    const { budget, budgetType } = deriveBudget(meta);
    const spend = Number(insights?.spend || 0);
    const purchaseValue = findActionValue(insights?.action_values, ["purchase", "omni_purchase"]) || 0;
    // Phase 30 — Hook Rate / Video Views.
    const threeSecVideoViews = insights ? extractThreeSecVideoViews(insights.actions, insights.video_play_actions) : null;

    res.json({
      success: true,
      adset: meta
        ? {
            adsetId: String(meta.id),
            adsetName: meta.name,
            campaignId: String(meta.campaign_id || ""),
            campaignName: meta.campaign?.name || null,
            status: meta.status || null,
            effectiveStatus: meta.effective_status || null,
            budget,
            budgetType,
            // Phase 32 §2 — real Meta bid_amount (minor units -> real
            // currency, same convention deriveBudget() already applies to
            // daily_budget/lifetime_budget above), null when Meta doesn't
            // return one — never a fabricated ₹0. CurrentValuesCard.jsx's
            // Budget & Bid Cap Control section already shows this same
            // value live via a separate endpoint; this lets the drawer's
            // static "Ad Set Information" section show it too.
            bidAmount: meta.bid_amount !== undefined && meta.bid_amount !== null && meta.bid_amount !== "" ? Number(meta.bid_amount) / 100 : null,
            startTime: meta.start_time || null,
            endTime: meta.end_time || null,
            optimizationGoal: meta.optimization_goal || null,
            billingEvent: meta.billing_event || null,
            bidStrategy: meta.bid_strategy || null,
            targetingSummary: summarizeTargeting(meta.targeting),
            createdTime: meta.created_time || null,
            updatedTime: meta.updated_time || null,
            // Phase 32 §4 — ad account ID, straight from Meta. Powers the
            // "Open in Meta Ads Manager" deep link; null (never guessed)
            // when Meta didn't return it.
            accountId: meta.account_id ? String(meta.account_id) : null,
          }
        : { adsetId, adsetName: "Unavailable", metaAvailable: false },
      metaInsights: insights
        ? {
            spend,
            impressions: Number(insights.impressions || 0),
            reach: Number(insights.reach || 0),
            clicks: Number(insights.clicks || 0),
            ctr: Number(insights.ctr || 0),
            cpc: Number(insights.cpc || 0),
            cpm: Number(insights.cpm || 0),
            purchases: findActionValue(insights.actions, ["purchase", "omni_purchase"]) || 0,
            purchaseValue,
            roas: spend ? purchaseValue / spend : 0,
            videoViews: threeSecVideoViews,
            hookRate: computeHookRate(threeSecVideoViews, Number(insights.impressions || 0)),
          }
        : null,
      orders: {
        totalOrders: orderSummary.totalOrders,
        matchedOrders: orderSummary.totalOrders,
        codOrders: orderSummary.codOrders,
        prepaidOrders: orderSummary.prepaidOrders,
        revenue: orderSummary.totalRevenue,
        aov: orderSummary.avgOrderValue,
        ...delivery,
      },
      since: since || null,
      until: until || null,
    });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

// ── GET /:tokenId/:adsetId/orders — Ad Set Orders table ────────────
router.get("/:tokenId/:adsetId/orders", async (req, res) => {
  try {
    const { adsetId } = req.params;
    const since = req.query.since || "2000-01-01";
    const until = req.query.until || new Date().toISOString().slice(0, 10);
    const orders = await getStoredShiprocketOrders(since, until, { adsetId });
    res.json({ success: true, since, until, orders });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
