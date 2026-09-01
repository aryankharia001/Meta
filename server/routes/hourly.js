import express from "express";
import ShiprocketOrder from "../models/shiprocketorder.js";
import Token from "../models/Token.js";
import { fbGet, fetchAllPages, actIdOf, findActionValue, extractDeliveryStatus, deliveryBucket6, createTtlCache, GRAPH_BASE } from "../lib/metaGraph.js";
// Campaign History Phase — additive import only, same shared resolver
// campaigns.js/campaignExplorer.js/dailyReports.js/dailyHourly.js now
// also use (see lib/campaignIdentity.js's header). Duplicated import
// here rather than re-exported from those files, per this file's own
// "zero coupling to earlier phases" convention stated below.
import { buildCampaignIdentityResolver, buildSingleCampaignResolver } from "../lib/campaignIdentity.js";

const router = express.Router();

// ─────────────────────────────────────────────────────────────
// Phase 13 §1/§2/§11/§15 — Hourly performance. Entirely new, additive
// route file (mounted at /api/hourly). Never writes ShiprocketOrder,
// never touches the campaign-name matching logic in campaigns.js/
// campaignExplorer.js/dailyReports.js.
//
// Meta side: uses the Insights API's real hourly breakdown —
// `hourly_stats_aggregated_by_advertiser_time_zone` — which Meta itself
// buckets in the ad account's own configured reporting timezone. That's
// what "the existing Meta timezone must be respected" means in practice:
// we don't compute or guess an offset, Meta does the bucketing. As of
// August 2026 Meta requires some ad accounts to explicitly opt in to
// this breakdown in Events Manager/Ads Manager — if an account hasn't,
// the API returns an empty array (not an error). This route surfaces
// that as `metaHourlyAvailable: false` rather than silently showing
// zeroes that look like "no spend that hour".
//
// Order side: bucketed by orderCreatedAt's IST hour, using the exact
// same +05:30 fixed-offset convention every other route in this app
// (dateIst.js, campaignExplorer.js, dailyReports.js) already uses —
// this app doesn't track a per-account Meta timezone separately from
// IST anywhere (see dailyReports.js's own header comment), so this
// route follows the same single-timezone assumption rather than
// inventing a second one. If a connected ad account's Meta timezone
// isn't IST, the Meta-spend column and the order columns in the same
// hour row may not line up perfectly — same caveat that already applies
// to every other page in this app.
//
// Campaign-level scoping resolves via the shared current + auto-
// historical + manual mapping chain (Campaign History Phase — see
// lib/campaignIdentity.js's header), the same established matching rule
// as everywhere else. Ad-set/Ad-level scoping matches by the
// adsetId/adId Shiprocket already stores per order — an ID match,
// consistent with adSetExplorer.js/adExplorer.js.
// ─────────────────────────────────────────────────────────────

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
function istHourOf(dateVal) {
  if (!dateVal) return null;
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return null;
  return new Date(d.getTime() + IST_OFFSET_MS).getUTCHours();
}

const normalizeCampaignName = (name) => String(name || "").trim().toLowerCase().replace(/\s+/g, " ");

function pad2(n) {
  return String(n).padStart(2, "0");
}
function hourLabel(h) {
  return `${pad2(h)}:00–${pad2(h)}:59`;
}

const hourlyCache = createTtlCache(30_000);

// Phase 27 — additive export. Adding an export doesn't change this
// function's behavior for any existing caller in this file; it lets
// server/lib/controlHelpers.js (Phase 27's new hourly-with-controls/
// before-after endpoints) reuse the exact same Meta hourly-spend fetch
// instead of duplicating it, without touching anything below.
export async function fetchHourlySpend({ objectId, accountIds, accessToken, date }) {
  const fields = "spend,impressions,clicks,actions,action_values";
  const breakdown = "hourly_stats_aggregated_by_advertiser_time_zone";
  const timeRange = encodeURIComponent(JSON.stringify({ since: date, until: date }));

  const urls = objectId
    ? [`${GRAPH_BASE}/${objectId}/insights?fields=${encodeURIComponent(fields)}&breakdowns=${breakdown}&time_range=${timeRange}&limit=500&access_token=${accessToken}`]
    : (accountIds || []).map(
        (id) => `${GRAPH_BASE}/${actIdOf(id)}/insights?level=account&fields=${encodeURIComponent(fields)}&breakdowns=${breakdown}&time_range=${timeRange}&limit=500&access_token=${accessToken}`
      );

  const byHour = new Map();
  let any = false;
  let lastError = null;
  for (const url of urls) {
    try {
      const data = await fbGet(url);
      const rows = data.data || [];
      if (rows.length) any = true;
      rows.forEach((row) => {
        const label = row.hourly_stats_aggregated_by_advertiser_time_zone || "";
        const hour = parseInt(String(label).slice(0, 2), 10);
        if (isNaN(hour) || hour < 0 || hour > 23) return;
        const cur = byHour.get(hour) || { spend: 0, impressions: 0, clicks: 0, purchases: 0, purchaseValue: 0 };
        cur.spend += Number(row.spend || 0);
        cur.impressions += Number(row.impressions || 0);
        cur.clicks += Number(row.clicks || 0);
        cur.purchases += findActionValue(row.actions, ["purchase", "omni_purchase"]) || 0;
        cur.purchaseValue += findActionValue(row.action_values, ["purchase", "omni_purchase"]) || 0;
        byHour.set(hour, cur);
      });
    } catch (err) {
      lastError = err.message;
      console.log(`Hourly insights fetch failed: ${err.message}`);
    }
  }
  return { available: any, byHour, error: any ? null : lastError };
}

// Phase 30 — Hook Rate for the Hourly Panel. A separate, local fetch
// (never touching fetchHourlySpend() above, which Phase 27's
// controlHelpers.js depends on for its own before/after and hourly-with-
// controls endpoints) so adding a video-views field here can never
// change Phase 27's behavior. Same "3-second video views" probing as
// campaignExplorer.js/campaigns.js/adSetExplorer.js/adExplorer.js's
// extractThreeSecVideoViews() — duplicated here for the same "zero
// coupling between phases" reason, and byte-identical in formula.
async function fetchHourlyVideoViews({ objectId, accountIds, accessToken, date }) {
  const fields = "impressions,actions,video_play_actions";
  const breakdown = "hourly_stats_aggregated_by_advertiser_time_zone";
  const timeRange = encodeURIComponent(JSON.stringify({ since: date, until: date }));

  const urls = objectId
    ? [`${GRAPH_BASE}/${objectId}/insights?fields=${encodeURIComponent(fields)}&breakdowns=${breakdown}&time_range=${timeRange}&limit=500&access_token=${accessToken}`]
    : (accountIds || []).map(
        (id) => `${GRAPH_BASE}/${actIdOf(id)}/insights?level=account&fields=${encodeURIComponent(fields)}&breakdowns=${breakdown}&time_range=${timeRange}&limit=500&access_token=${accessToken}`
      );

  const byHour = new Map();
  for (const url of urls) {
    try {
      const data = await fbGet(url);
      (data.data || []).forEach((row) => {
        const label = row.hourly_stats_aggregated_by_advertiser_time_zone || "";
        const hour = parseInt(String(label).slice(0, 2), 10);
        if (isNaN(hour) || hour < 0 || hour > 23) return;
        const cur = byHour.get(hour) || { impressions: 0, videoViews: 0, hasVideoData: false };
        cur.impressions += Number(row.impressions || 0);
        const fromVideoPlayActions = findActionValue(row.video_play_actions, ["video_view"]);
        const fromActions = findActionValue(row.actions, ["video_view"]);
        const views = fromVideoPlayActions !== null ? fromVideoPlayActions : fromActions;
        if (views !== null) {
          cur.videoViews += views;
          cur.hasVideoData = true;
        }
        byHour.set(hour, cur);
      });
    } catch (err) {
      console.log(`Hourly video-views fetch failed: ${err.message}`);
    }
  }
  return byHour;
}

// Campaign History Phase — replaces the old normalized-name Set with
// the shared current + auto-historical + manual mapping resolver (see
// lib/campaignIdentity.js's header), built from the same live-campaigns
// fetch this function already did, plus every campaign this app has
// ever tracked for these accounts (via MetaEntityState, folded in
// automatically by buildCampaignIdentityResolver).
async function getAccountCampaignResolver(tokenId, accountIds, accessToken) {
  const liveCampaigns = [];
  for (const accountId of accountIds || []) {
    try {
      const raw = await fetchAllPages(`${GRAPH_BASE}/${actIdOf(accountId)}/campaigns?fields=id,name&limit=200&access_token=${accessToken}`);
      raw.forEach((c) => {
        if (c?.id) liveCampaigns.push({ campaignId: c.id, campaignName: c.name, accountId });
      });
    } catch (err) {
      console.log(`Hourly known-campaign fetch failed for ${accountId}: ${err.message}`);
    }
  }
  return buildCampaignIdentityResolver({ tokenId, accountIds, liveCampaigns });
}

// Resolves the scope (campaign name for campaign-level filtering, the
// Meta object id to request hourly insights for) from whichever of
// campaignId/adsetId/adId was passed — narrowest wins.
async function resolveScope({ tokenId, accessToken, accountIds, campaignId, adsetId, adId }) {
  if (adId) return { level: "ad", objectId: adId, orderFilter: (o) => String(o.adId || "") === String(adId) };
  if (adsetId) return { level: "adset", objectId: adsetId, orderFilter: (o) => String(o.adsetId || "") === String(adsetId) };
  if (campaignId) {
    let campaignName = null;
    try {
      const data = await fbGet(`${GRAPH_BASE}/${campaignId}?fields=name&access_token=${accessToken}`);
      campaignName = data.name || null;
    } catch (err) {
      console.log(`Hourly campaign name lookup failed for ${campaignId}: ${err.message}`);
    }
    // Campaign History Phase — resolved via the shared current + auto-
    // historical + manual mapping chain (see lib/campaignIdentity.js's
    // header), scoped to just this one campaign, so a renamed
    // campaign's pre-rename orders still show in its own hourly view.
    const singleResolver = await buildSingleCampaignResolver({ tokenId, campaignId, currentName: campaignName || "" });
    return {
      level: "campaign",
      objectId: campaignId,
      campaignName,
      orderFilter: (o) => !!singleResolver.resolve(o).campaignId,
    };
  }
  return { level: "account", objectId: null, orderFilter: null };
}

// ── GET /:tokenId — 24-hour breakdown for one calendar day ─────────
router.get("/:tokenId", async (req, res) => {
  try {
    const { tokenId } = req.params;
    const { date, campaignId, adsetId, adId } = req.query;
    if (!date) return res.status(400).json({ success: false, message: "date is required (YYYY-MM-DD)" });

    let accountIds = req.query.adAccountId;
    if (accountIds && !Array.isArray(accountIds)) accountIds = [accountIds];
    if (!accountIds && !campaignId && !adsetId && !adId) {
      return res.status(400).json({ success: false, message: "adAccountId is required when no campaign/ad set/ad is specified" });
    }

    const token = await Token.findById(tokenId).lean();
    if (!token) return res.status(404).json({ success: false, message: "Token not found" });

    const cacheKey = `${tokenId}:${date}:${campaignId || ""}:${adsetId || ""}:${adId || ""}:${(accountIds || []).sort().join(",")}`;
    const cached = hourlyCache.get(cacheKey);
    if (cached) return res.json({ ...cached, cached: true });

    const scope = await resolveScope({ tokenId, accessToken: token.accessToken, accountIds, campaignId, adsetId, adId });
    const { available: metaHourlyAvailable, byHour, error: metaError } = await fetchHourlySpend({
      objectId: scope.objectId,
      accountIds,
      accessToken: token.accessToken,
      date,
    });
    // Phase 30 — Hook Rate, fetched separately from fetchHourlySpend() so
    // Phase 27's controlHelpers.js callers of that function are never
    // affected. Best-effort: an empty Map just means every hour's
    // hookRate/videoViews comes back null below.
    const videoByHour = metaHourlyAvailable
      ? await fetchHourlyVideoViews({ objectId: scope.objectId, accountIds, accessToken: token.accessToken, date })
      : new Map();

    const dayOrders = await ShiprocketOrder.find({ orderDate: date })
      .select("orderId orderCreatedAt campaignName adsetId adId totalAmountPayable paymentType raw")
      .lean();

    let accountResolver = null;
    if (scope.level === "account") {
      accountResolver = await getAccountCampaignResolver(tokenId, accountIds, token.accessToken);
    }

    const scopedOrders = scope.orderFilter ? dayOrders.filter(scope.orderFilter) : dayOrders;

    const hours = [];
    for (let h = 0; h < 24; h++) {
      const metaRow = byHour.get(h) || null;
      const spend = metaRow ? Math.round(metaRow.spend * 100) / 100 : 0;

      const ordersInHour = scopedOrders.filter((o) => istHourOf(o.orderCreatedAt) === h);
      let matchedOrders = ordersInHour.length;
      let unmatchedOrders = 0;
      if (scope.level === "account" && accountResolver) {
        matchedOrders = ordersInHour.filter((o) => !!accountResolver.resolve(o).campaignId).length;
        unmatchedOrders = ordersInHour.length - matchedOrders;
      }

      let revenue = 0, codOrders = 0, prepaidOrders = 0;
      const delivery = { delivered: 0, pending: 0, rto: 0 };
      ordersInHour.forEach((o) => {
        revenue += Number(o.totalAmountPayable || 0);
        if (o.paymentType === "PREPAID") prepaidOrders += 1;
        else if (o.paymentType === "CASH_ON_DELIVERY") codOrders += 1;
        const bucket = deliveryBucket6(extractDeliveryStatus(o.raw));
        if (bucket === "delivered") delivery.delivered += 1;
        else if (bucket === "rto") delivery.rto += 1;
        else delivery.pending += 1; // pending/processing/cancelled/returned all roll into "Pending" for the hourly grid per §1's column list
      });
      revenue = Math.round(revenue * 100) / 100;

      // Phase 30 — Hook Rate for this hour. "N/A" (null) whenever the
      // video-views fetch found no video_view data for this hour, rather
      // than showing a misleading 0%.
      const videoRow = videoByHour.get(h);
      const hookRate = videoRow?.hasVideoData && videoRow.impressions ? (videoRow.videoViews / videoRow.impressions) * 100 : null;

      hours.push({
        hour: h,
        label: hourLabel(h),
        spend,
        orders: ordersInHour.length,
        matchedOrders,
        unmatchedOrders,
        revenue,
        codOrders,
        prepaidOrders,
        delivered: delivery.delivered,
        pending: delivery.pending,
        rto: delivery.rto,
        roas: spend ? Math.round((revenue / spend) * 100) / 100 : 0,
        aov: ordersInHour.length ? Math.round((revenue / ordersInHour.length) * 100) / 100 : 0,
        cpa: ordersInHour.length ? Math.round((spend / ordersInHour.length) * 100) / 100 : 0,
        videoViews: videoRow?.hasVideoData ? videoRow.videoViews : null,
        hookRate,
      });
    }

    const payload = {
      success: true,
      date,
      scope: { level: scope.level, campaignId: campaignId || null, adsetId: adsetId || null, adId: adId || null, campaignName: scope.campaignName || null },
      metaHourlyAvailable,
      metaHourlyError: metaHourlyAvailable ? null : metaError,
      hours,
      summary: {
        totalSpend: Math.round(hours.reduce((s, h) => s + h.spend, 0) * 100) / 100,
        totalOrders: hours.reduce((s, h) => s + h.orders, 0),
        totalRevenue: Math.round(hours.reduce((s, h) => s + h.revenue, 0) * 100) / 100,
      },
    };
    hourlyCache.set(cacheKey, payload);
    res.json(payload);
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

// ── GET /:tokenId/orders — drill down into one specific hour ───────
router.get("/:tokenId/orders", async (req, res) => {
  try {
    const { tokenId } = req.params;
    const { date, hour, campaignId, adsetId, adId, paymentType } = req.query;
    if (!date || hour === undefined) {
      return res.status(400).json({ success: false, message: "date and hour are required" });
    }
    const h = Number(hour);

    const dayOrders = await ShiprocketOrder.find({ orderDate: date }).lean();
    let scoped = dayOrders.filter((o) => istHourOf(o.orderCreatedAt) === h);

    if (adId) scoped = scoped.filter((o) => String(o.adId || "") === String(adId));
    else if (adsetId) scoped = scoped.filter((o) => String(o.adsetId || "") === String(adsetId));
    else if (campaignId) {
      // Campaign History Phase — resolved via the shared current + auto-
      // historical + manual mapping chain (see lib/campaignIdentity.js's
      // header), scoped to just this one campaign — the caller (frontend)
      // already has campaignName from the hourly summary response, so
      // accept it directly here to avoid a second Graph API round trip.
      const campaignName = req.query.campaignName;
      const singleResolver = await buildSingleCampaignResolver({ tokenId, campaignId, currentName: campaignName || "" });
      scoped = scoped.filter((o) => !!singleResolver.resolve(o).campaignId);
    }
    if (paymentType) scoped = scoped.filter((o) => o.paymentType === paymentType);

    res.json({ success: true, date, hour: h, orders: scoped });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
