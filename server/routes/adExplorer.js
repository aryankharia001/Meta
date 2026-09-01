import express from "express";
import ShiprocketOrder from "../models/shiprocketorder.js";
import Token from "../models/Token.js";
import AdAccount from "../models/AdAccount.js";
import AdCreativeCache from "../models/AdCreativeCache.js";
import {
  fbGet,
  fetchAllPages,
  actIdOf,
  findActionValue,
  extractDeliveryStatus,
  deliveryBucket6,
  createTtlCache,
  GRAPH_BASE,
} from "../lib/metaGraph.js";
import { getStoredShiprocketOrders, summarizeStoredOrders } from "../services/shiprocketService.js";
// Phase 44 — Campaign Activity History, extended to Ads. Additive
// import only; nothing above is touched.
import { ensureEntityBaselinesBulk } from "../lib/campaignActivity.js";

const router = express.Router();

// ─────────────────────────────────────────────────────────────
// Phase 13 §5/§6/§9 — Ad Explorer + creative details. Entirely new,
// additive route file (mounted at /api/ad-explorer). Same conventions as
// adSetExplorer.js: never writes ShiprocketOrder, joins orders to ads by
// the adId Shiprocket already stores per order (an ID match, never
// name-based, never invented). Creative details are the one thing here
// that's genuinely expensive to keep re-fetching (thumbnails, previews)
// so those are cached in Mongo (AdCreativeCache) with a real TTL — see
// §18.
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

const AD_FIELDS = [
  "id", "name", "adset_id", "adset{id,name}", "campaign_id", "campaign{id,name}",
  "status", "effective_status", "created_time", "updated_time",
  "creative{id,thumbnail_url}",
  // Phase 32 §4 — account_id, straight from Meta on the ad node itself
  // (no extra request). Exposed in /:adId/details below as ad.accountId
  // so AdDrawer.jsx can build a real "Open in Meta Ads Manager" deep
  // link (act=<accountId>) without guessing. Ads have no editable
  // budget/bid_amount/bid_strategy of their own in the Graph API (those
  // live on the Campaign/Ad Set only) — see AdDrawer.jsx's Budget & Bid
  // Cap section, which shows "Not Applicable" rather than fabricating one.
  "account_id",
].join(",");

const AD_INSIGHT_FIELDS = [
  "ad_id", "ad_name", "adset_id", "campaign_id", "campaign_name",
  "spend", "impressions", "reach", "clicks", "ctr", "cpc", "cpm",
  "actions", "action_values",
  // Phase 30 — Hook Rate / Video Views. See extractThreeSecVideoViews()
  // below.
  "video_play_actions",
].join(",");

// Phase 30 — Hook Rate (3-second video views / impressions), duplicated
// byte-identically across campaignExplorer.js/campaigns.js/
// adSetExplorer.js/adExplorer.js so hook rate is genuinely comparable
// Campaign → Ad Set → Ad. See campaignExplorer.js's copy for the full
// explanation. Never falls back to a different metric (e.g.
// video_p25_watched_actions) when the true 3s metric is absent — returns
// null (rendered "N/A" client-side) instead.
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

const CREATIVE_FIELDS = [
  "id", "thumbnail_url", "image_url", "video_id", "body", "title",
  "object_type", "call_to_action_type",
  "object_story_spec", "asset_feed_spec", "effective_object_story_id",
].join(",");

async function fetchAdsForAccount(actId, accessToken) {
  try {
    return await fetchAllPages(
      `${GRAPH_BASE}/${actId}/ads?fields=${encodeURIComponent(AD_FIELDS)}&limit=200&access_token=${accessToken}`
    );
  } catch (err) {
    console.log(`Ad Explorer metadata fetch failed for ${actId}: ${err.message}`);
    return [];
  }
}

async function fetchAdInsightsForAccount(actId, accessToken, since, until) {
  try {
    const data = await fbGet(
      `${GRAPH_BASE}/${actId}/insights?level=ad&fields=${encodeURIComponent(AD_INSIGHT_FIELDS)}` +
        `&time_range=${encodeURIComponent(JSON.stringify({ since, until }))}` +
        `&time_increment=all_days&limit=500&access_token=${accessToken}`
    );
    return data.data || [];
  } catch (err) {
    console.log(`Ad Explorer insights fetch failed for ${actId}: ${err.message}`);
    return [];
  }
}

// Best-effort extraction across the handful of shapes a creative object
// can take (single link ad, video ad, Advantage+ asset_feed_spec ad).
// Never fabricates — a field simply comes back null if none of the
// probed shapes are present.
function extractCreativeDetails(creative) {
  if (!creative) return null;
  const story = creative.object_story_spec || {};
  const linkData = story.link_data || {};
  const videoData = story.video_data || {};
  const feed = creative.asset_feed_spec || {};

  const primaryText =
    creative.body || linkData.message || videoData.message || feed.bodies?.[0]?.text || null;
  const headline =
    creative.title || linkData.name || videoData.title || feed.titles?.[0]?.text || null;
  const description = linkData.description || feed.descriptions?.[0]?.text || null;
  const callToAction =
    creative.call_to_action_type ||
    linkData.call_to_action?.type ||
    videoData.call_to_action?.type ||
    feed.call_to_action_types?.[0] ||
    null;
  const destinationUrl =
    linkData.link ||
    videoData.call_to_action?.value?.link ||
    feed.link_urls?.[0]?.website_url ||
    null;
  const imageUrl = creative.image_url || linkData.picture || null;
  const videoId = creative.video_id || videoData.video_id || feed.videos?.[0]?.video_id || null;

  let adFormat = "image";
  if (videoId) adFormat = "video";
  else if (Array.isArray(linkData.child_attachments) && linkData.child_attachments.length > 0) adFormat = "carousel";
  else if (Object.keys(feed).length > 0) adFormat = "dynamic";
  else if (linkData.link) adFormat = "link";

  return {
    creativeId: creative.id || null,
    thumbnailUrl: creative.thumbnail_url || null,
    imageUrl,
    videoId,
    primaryText,
    headline,
    description,
    callToAction,
    destinationUrl,
    adFormat,
  };
}

const listCache = createTtlCache(45_000);
const resolveCache = createTtlCache(5 * 60_000);

// ── GET /:tokenId — list ads (optionally scoped to a campaign/ad set) ──
router.get("/:tokenId", async (req, res) => {
  try {
    const { tokenId } = req.params;
    const { since, until, campaignId, adsetId } = req.query;
    if (!since || !until) {
      return res.status(400).json({ success: false, message: "since and until are required" });
    }

    const { token, accountIds, accountNameMap } = await resolveTokenAndAccounts(tokenId, req.query.adAccountId);

    const cacheKey = `list:${tokenId}:${[...accountIds].sort().join(",")}:${since}:${until}:${campaignId || ""}:${adsetId || ""}`;
    const cached = listCache.get(cacheKey);
    if (cached) return res.json({ ...cached, cached: true });

    const byAdId = new Map();
    for (const accountId of accountIds) {
      const actId = actIdOf(accountId);
      const [metaList, insightsList] = await Promise.all([
        fetchAdsForAccount(actId, token.accessToken),
        fetchAdInsightsForAccount(actId, token.accessToken, since, until),
      ]);
      metaList.forEach((a) => {
        byAdId.set(String(a.id), { meta: a, insights: null, accountId, accountName: accountNameMap.get(accountId) || accountId });
      });
      insightsList.forEach((row) => {
        const id = String(row.ad_id || "");
        if (!id) return;
        const existing = byAdId.get(id) || {
          meta: { id, name: row.ad_name, adset_id: row.adset_id, campaign_id: row.campaign_id, campaign: { name: row.campaign_name } },
          accountId,
          accountName: accountNameMap.get(accountId) || accountId,
        };
        existing.insights = row;
        byAdId.set(id, existing);
      });
    }

    let ads = [...byAdId.values()];
    if (campaignId) ads = ads.filter((a) => String(a.meta.campaign_id || "") === String(campaignId));
    if (adsetId) ads = ads.filter((a) => String(a.meta.adset_id || "") === String(adsetId));

    // Phase 44 §1/§4/§19 — Campaign Activity History, extended to Ads:
    // seed a MetaEntityState + Ad status-history baseline for any ad in
    // this list not tracked yet. DB-only (reuses `ads`, already fetched
    // above), a no-op once tracked, never blocks/fails this response if
    // it errors. Once seeded, metaEntitySyncCron.js's periodic poll
    // takes over detecting further status changes for it (Ads have no
    // budget/bid-cap of their own to poll).
    await ensureEntityBaselinesBulk({
      tokenId,
      entityType: "ad",
      entities: ads.map(({ meta, accountId }) => ({
        entityId: String(meta.id || ""),
        entityName: meta.name || "",
        status: meta.status || null,
        effectiveStatus: meta.effective_status || null,
        createdTime: meta.created_time || null,
        campaignId: String(meta.campaign_id || ""),
        adsetId: String(meta.adset_id || ""),
        accountId,
      })),
    }).catch((err) => console.log(`Ad activity baseline seeding failed: ${err.message}`));

    const rawOrders = await ShiprocketOrder.find({ orderDate: { $gte: since, $lte: until } })
      .select("orderId adId totalAmountPayable paymentType raw")
      .lean();

    const ordersByAdId = new Map();
    const knownAdIds = new Set(ads.map((a) => String(a.meta.id)));
    let unmatchedOrders = 0;
    rawOrders.forEach((o) => {
      const key = o.adId ? String(o.adId) : "";
      if (!key || !knownAdIds.has(key)) {
        unmatchedOrders += 1;
        return;
      }
      if (!ordersByAdId.has(key)) ordersByAdId.set(key, []);
      ordersByAdId.get(key).push(o);
    });

    const rows = ads.map(({ meta, insights, accountId, accountName }) => {
      const adId = String(meta.id || "");
      const orders = ordersByAdId.get(adId) || [];

      const spend = Number(insights?.spend || 0);
      const impressions = Number(insights?.impressions || 0);
      const purchaseValue = findActionValue(insights?.action_values, ["purchase", "omni_purchase"]) || 0;
      // Phase 30 — Hook Rate / Video Views.
      const threeSecVideoViews = extractThreeSecVideoViews(insights?.actions, insights?.video_play_actions);

      let revenue = 0, codOrders = 0, prepaidOrders = 0;
      const delivery = { delivered: 0, pending: 0, processing: 0, cancelled: 0, returned: 0, rto: 0 };
      orders.forEach((o) => {
        revenue += Number(o.totalAmountPayable || 0);
        if (o.paymentType === "PREPAID") prepaidOrders += 1;
        else if (o.paymentType === "CASH_ON_DELIVERY") codOrders += 1;
        delivery[deliveryBucket6(extractDeliveryStatus(o.raw))] += 1;
      });

      return {
        adId,
        adName: meta.name || insights?.ad_name || "Untitled Ad",
        adsetId: String(meta.adset_id || insights?.adset_id || ""),
        adsetName: meta.adset?.name || null,
        campaignId: String(meta.campaign_id || insights?.campaign_id || ""),
        campaignName: meta.campaign?.name || insights?.campaign_name || null,
        accountId,
        accountName,
        status: meta.status || null,
        effectiveStatus: meta.effective_status || null,
        thumbnailUrl: meta.creative?.thumbnail_url || null,
        createdTime: meta.created_time || null,
        updatedTime: meta.updated_time || null,

        spend,
        impressions,
        reach: Number(insights?.reach || 0),
        clicks: Number(insights?.clicks || 0),
        ctr: Number(insights?.ctr || 0),
        cpc: Number(insights?.cpc || 0),
        cpm: Number(insights?.cpm || 0),
        purchases: findActionValue(insights?.actions, ["purchase", "omni_purchase"]) || 0,
        purchaseValue,
        roas: spend ? purchaseValue / spend : 0,
        // Phase 30 — Video Views / Hook Rate.
        videoViews: threeSecVideoViews,
        hookRate: computeHookRate(threeSecVideoViews, impressions),

        totalOrders: orders.length,
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
      adsetId: adsetId || null,
      ads: rows,
      summary: {
        totalAds: rows.length,
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

// ── GET /:tokenId/by-adset/:adsetId — Ads nested under one ad set,
// fetched directly off the ad set object (no adAccountId needed) — used
// by AdSetDrawer's Ads section and Campaign Explorer's expandable-row
// hierarchy (§4/§10). ────────────────────────────────────────────────
router.get("/:tokenId/by-adset/:adsetId", async (req, res) => {
  try {
    const { tokenId, adsetId } = req.params;
    const { since, until } = req.query;

    const token = await Token.findById(tokenId).lean();
    if (!token) return res.status(404).json({ success: false, message: "Token not found" });

    const cacheKey = `byadset:${tokenId}:${adsetId}:${since || ""}:${until || ""}`;
    const cached = listCache.get(cacheKey);
    if (cached) return res.json({ ...cached, cached: true });

    const [metaList, insightsList] = await Promise.all([
      fetchAllPages(`${GRAPH_BASE}/${adsetId}/ads?fields=${encodeURIComponent(AD_FIELDS)}&limit=200&access_token=${token.accessToken}`).catch((err) => {
        console.log(`Ads-by-adset metadata fetch failed for ${adsetId}: ${err.message}`);
        return [];
      }),
      since && until
        ? fbGet(
            `${GRAPH_BASE}/${adsetId}/insights?level=ad&fields=${encodeURIComponent(AD_INSIGHT_FIELDS)}` +
              `&time_range=${encodeURIComponent(JSON.stringify({ since, until }))}&time_increment=all_days&limit=500&access_token=${token.accessToken}`
          )
            .then((d) => d.data || [])
            .catch((err) => {
              console.log(`Ads-by-adset insights fetch failed for ${adsetId}: ${err.message}`);
              return [];
            })
        : Promise.resolve([]),
    ]);

    const byId = new Map();
    metaList.forEach((a) => byId.set(String(a.id), { meta: a, insights: null }));
    insightsList.forEach((row) => {
      const id = String(row.ad_id || "");
      if (!id) return;
      const existing = byId.get(id) || { meta: { id, name: row.ad_name, adset_id: row.adset_id }, insights: null };
      existing.insights = row;
      byId.set(id, existing);
    });

    const rangeSince = since || "2000-01-01";
    const rangeUntil = until || new Date().toISOString().slice(0, 10);
    const rawOrders = await ShiprocketOrder.find({ orderDate: { $gte: rangeSince, $lte: rangeUntil }, adId: { $ne: "" } })
      .select("adId totalAmountPayable paymentType raw")
      .lean();
    const ordersByAd = new Map();
    rawOrders.forEach((o) => {
      const key = String(o.adId);
      if (!ordersByAd.has(key)) ordersByAd.set(key, []);
      ordersByAd.get(key).push(o);
    });

    const ads = [...byId.values()].map(({ meta, insights }) => {
      const adId = String(meta.id || "");
      const orders = ordersByAd.get(adId) || [];
      const spend = Number(insights?.spend || 0);
      const purchaseValue = findActionValue(insights?.action_values, ["purchase", "omni_purchase"]) || 0;
      let revenue = 0, codOrders = 0, prepaidOrders = 0;
      orders.forEach((o) => {
        revenue += Number(o.totalAmountPayable || 0);
        if (o.paymentType === "PREPAID") prepaidOrders += 1;
        else if (o.paymentType === "CASH_ON_DELIVERY") codOrders += 1;
      });
      return {
        adId,
        adName: meta.name || insights?.ad_name || "Untitled Ad",
        status: meta.status || null,
        effectiveStatus: meta.effective_status || null,
        thumbnailUrl: meta.creative?.thumbnail_url || null,
        spend,
        purchaseValue,
        roas: spend ? purchaseValue / spend : 0,
        totalOrders: orders.length,
        revenue: Math.round(revenue * 100) / 100,
        codOrders,
        prepaidOrders,
      };
    });

    const payload = { success: true, adsetId, ads };
    listCache.set(cacheKey, payload);
    res.json(payload);
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

// ── GET /:tokenId/:adId/details — Ad Drawer ─────────────────────────
router.get("/:tokenId/:adId/details", async (req, res) => {
  try {
    const { tokenId, adId } = req.params;
    const { since, until } = req.query;

    const token = await Token.findById(tokenId).lean();
    if (!token) return res.status(404).json({ success: false, message: "Token not found" });

    let meta = null;
    try {
      meta = await fbGet(`${GRAPH_BASE}/${adId}?fields=${encodeURIComponent(AD_FIELDS)}&access_token=${token.accessToken}`);
    } catch (err) {
      console.log(`Ad details metadata fetch failed for ${adId}: ${err.message}`);
    }

    let insights = null;
    try {
      const timeParam = since && until
        ? `time_range=${encodeURIComponent(JSON.stringify({ since, until }))}&time_increment=all_days`
        : `date_preset=maximum`;
      const data = await fbGet(`${GRAPH_BASE}/${adId}/insights?fields=${encodeURIComponent(AD_INSIGHT_FIELDS)}&${timeParam}&access_token=${token.accessToken}`);
      insights = (data.data || [])[0] || null;
    } catch (err) {
      console.log(`Ad details insights fetch failed for ${adId}: ${err.message}`);
    }

    const rangeSince = since || "2000-01-01";
    const rangeUntil = until || new Date().toISOString().slice(0, 10);
    const orders = await getStoredShiprocketOrders(rangeSince, rangeUntil, { adId });
    const orderSummary = summarizeStoredOrders(orders);
    const delivery = { delivered: 0, pending: 0, processing: 0, cancelled: 0, returned: 0, rto: 0 };
    orders.forEach((o) => { delivery[deliveryBucket6(extractDeliveryStatus(o.raw))] += 1; });

    const spend = Number(insights?.spend || 0);
    const impressionsNum = Number(insights?.impressions || 0);
    const purchaseValue = findActionValue(insights?.action_values, ["purchase", "omni_purchase"]) || 0;
    // Phase 30 — Hook Rate / Video Views.
    const threeSecVideoViews = insights ? extractThreeSecVideoViews(insights.actions, insights.video_play_actions) : null;

    res.json({
      success: true,
      ad: meta
        ? {
            adId: String(meta.id),
            adName: meta.name,
            adsetId: String(meta.adset_id || ""),
            adsetName: meta.adset?.name || null,
            campaignId: String(meta.campaign_id || ""),
            campaignName: meta.campaign?.name || null,
            status: meta.status || null,
            effectiveStatus: meta.effective_status || null,
            thumbnailUrl: meta.creative?.thumbnail_url || null,
            createdTime: meta.created_time || null,
            updatedTime: meta.updated_time || null,
            // Phase 32 §4 — ad account ID, straight from Meta. Powers the
            // "Open in Meta Ads Manager" deep link; null (never guessed)
            // when Meta didn't return it.
            accountId: meta.account_id ? String(meta.account_id) : null,
          }
        : { adId, adName: "Unavailable", metaAvailable: false },
      metaInsights: insights
        ? {
            spend,
            impressions: impressionsNum,
            reach: Number(insights.reach || 0),
            clicks: Number(insights.clicks || 0),
            ctr: Number(insights.ctr || 0),
            cpc: Number(insights.cpc || 0),
            cpm: Number(insights.cpm || 0),
            purchaseValue,
            roas: spend ? purchaseValue / spend : 0,
            // Phase 30 — Video Views / Hook Rate. Shown prominently in
            // AdDrawer.jsx per spec.
            videoViews: threeSecVideoViews,
            hookRate: computeHookRate(threeSecVideoViews, impressionsNum),
          }
        : null,
      orders: {
        totalOrders: orderSummary.totalOrders,
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

// ── GET /:tokenId/:adId/orders — Ad Orders table ───────────────────
router.get("/:tokenId/:adId/orders", async (req, res) => {
  try {
    const { adId } = req.params;
    const since = req.query.since || "2000-01-01";
    const until = req.query.until || new Date().toISOString().slice(0, 10);
    const orders = await getStoredShiprocketOrders(since, until, { adId });
    res.json({ success: true, since, until, orders });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /:tokenId/:adId/creative — cached creative details (§6/§18) ──
router.get("/:tokenId/:adId/creative", async (req, res) => {
  try {
    const { tokenId, adId } = req.params;
    const forceRefresh = req.query.refresh === "1";
    const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h — creatives rarely change once live

    if (!forceRefresh) {
      const cached = await AdCreativeCache.findOne({ adId }).lean();
      if (cached && Date.now() - new Date(cached.fetchedAt).getTime() < CACHE_TTL_MS) {
        return res.json({ success: true, cached: true, creative: cached });
      }
    }

    const token = await Token.findById(tokenId).lean();
    if (!token) return res.status(404).json({ success: false, message: "Token not found" });

    const data = await fbGet(`${GRAPH_BASE}/${adId}?fields=creative{${CREATIVE_FIELDS}}&access_token=${token.accessToken}`);
    const extracted = extractCreativeDetails(data.creative);
    if (!extracted) {
      return res.json({ success: true, cached: false, creative: null, message: "No creative available for this ad" });
    }

    // Best-effort preview permalink — a separate Graph API edge that can
    // fail independently of the creative fetch above (some ad
    // formats/placements don't support every preview format); never lets
    // a preview failure block returning the creative details we do have.
    let previewUrl = null;
    try {
      const previewData = await fbGet(
        `${GRAPH_BASE}/${adId}/previews?ad_format=DESKTOP_FEED_STANDARD&access_token=${token.accessToken}`
      );
      const iframeHtml = previewData.data?.[0]?.body || "";
      const srcMatch = iframeHtml.match(/src="([^"]+)"/);
      previewUrl = srcMatch ? srcMatch[1].replace(/&amp;/g, "&") : null;
    } catch (err) {
      console.log(`Ad preview fetch failed for ${adId}: ${err.message}`);
    }

    const doc = await AdCreativeCache.findOneAndUpdate(
      { adId },
      {
        adId,
        tokenId,
        ...extracted,
        previewUrl,
        raw: data.creative,
        fetchedAt: new Date(),
      },
      { upsert: true, new: true }
    ).lean();

    res.json({ success: true, cached: false, creative: doc });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

// ── GET /:tokenId/resolve — batch id → name/context lookup ─────────
// Used by the Order Drawer and Campaign Orders table so a page full of
// orders can show ad/ad-set names without loading the entire Ad
// Explorer list. Never guesses: an id Meta doesn't return anything for
// (deleted ad, no access, blank id) is simply absent from the response,
// and callers show "Not Available" for it.
router.get("/:tokenId/resolve", async (req, res) => {
  try {
    const { tokenId } = req.params;
    const adIds = (req.query.adIds || "").split(",").map((s) => s.trim()).filter(Boolean);
    const adsetIds = (req.query.adsetIds || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (adIds.length === 0 && adsetIds.length === 0) {
      return res.json({ success: true, ads: [], adsets: [] });
    }

    const token = await Token.findById(tokenId).lean();
    if (!token) return res.status(404).json({ success: false, message: "Token not found" });

    const cacheKey = `resolve:${tokenId}:${adIds.join(",")}:${adsetIds.join(",")}`;
    const cached = resolveCache.get(cacheKey);
    if (cached) return res.json({ ...cached, cached: true });

    const [adsData, adsetsData] = await Promise.all([
      adIds.length
        ? fbGet(
            `${GRAPH_BASE}/?ids=${adIds.join(",")}&fields=id,name,adset_id,adset{name},campaign_id,campaign{name},creative{thumbnail_url}&access_token=${token.accessToken}`
          ).catch((err) => {
            console.log(`Ad resolve failed: ${err.message}`);
            return {};
          })
        : {},
      adsetIds.length
        ? fbGet(`${GRAPH_BASE}/?ids=${adsetIds.join(",")}&fields=id,name,campaign_id,campaign{name}&access_token=${token.accessToken}`).catch((err) => {
            console.log(`Ad set resolve failed: ${err.message}`);
            return {};
          })
        : {},
    ]);

    const ads = Object.values(adsData || {})
      .filter((a) => a && a.id)
      .map((a) => ({
        adId: String(a.id),
        adName: a.name || null,
        adsetId: a.adset_id ? String(a.adset_id) : null,
        adsetName: a.adset?.name || null,
        campaignId: a.campaign_id ? String(a.campaign_id) : null,
        campaignName: a.campaign?.name || null,
        thumbnailUrl: a.creative?.thumbnail_url || null,
      }));
    const adsets = Object.values(adsetsData || {})
      .filter((a) => a && a.id)
      .map((a) => ({
        adsetId: String(a.id),
        adsetName: a.name || null,
        campaignId: a.campaign_id ? String(a.campaign_id) : null,
        campaignName: a.campaign?.name || null,
      }));

    const payload = { success: true, ads, adsets };
    resolveCache.set(cacheKey, payload);
    res.json(payload);
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

export default router;
