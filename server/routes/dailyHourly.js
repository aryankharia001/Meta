import express from "express";
import ShiprocketOrder from "../models/shiprocketorder.js";
import Token from "../models/Token.js";
import AdAccount from "../models/AdAccount.js";
import { fbGet, actIdOf, extractDeliveryStatus, deliveryBucket6, createTtlCache, GRAPH_BASE } from "../lib/metaGraph.js";
// Campaign History Phase — additive import only, same shared resolver
// campaigns.js/campaignExplorer.js/dailyReports.js now also use (see
// lib/campaignIdentity.js's header). Duplicated import here rather than
// re-exported from those files, per this file's own "zero coupling to
// earlier phases" convention stated below.
import { buildCampaignIdentityResolver, buildSingleCampaignResolver } from "../lib/campaignIdentity.js";

const router = express.Router();

// ─────────────────────────────────────────────────────────────
// Phase 15 — Daily Hourly Intelligence & Date Drill-Down. Entirely new,
// additive route file (mounted at /api/daily-hourly). Never writes
// ShiprocketOrder, never imports from dailyReports.js/hourly.js/
// campaignExplorer.js — same "zero coupling between phases" convention
// every phase since Phase 8 has used, so nothing here can ever change
// the existing Daily report, the existing (single-campaign) Hourly
// Panel, or Campaign Explorer's behavior, and nothing they do can ever
// break this route.
//
// What this route adds that hourly.js doesn't: hourly.js's account-
// level scope already returns per-hour totals across every campaign in
// an account, but it has no idea WHICH campaign/ad set/ad drove a given
// hour — it only reports matched/unmatched order counts. This route
// re-derives that breakdown itself (grouping the same day's orders by
// hour, then by campaign/ad set/ad) so the Daily page can show "Top
// Campaign / Top Ad Set / Top Ad" per hour and the full
// Hour → Campaign → Ad Set → Ad hierarchy the spec asks for, entirely
// from data already stored — no guessing.
//
// Campaign matching follows dailyReports.js's exact established rule
// (Campaign History Phase): the order's campaign_name is resolved
// through the shared current + auto-historical + manual mapping chain
// (lib/campaignIdentity.js) to a Campaign ID, never by the raw
// campaignId Shiprocket stores per order (that field comes from a UTM
// parameter, not guaranteed to equal Meta's real campaign id — the same
// reason dailyReports.js/campaignExplorer.js never trust it directly).
// Ad set / ad matching follows adSetExplorer.js/adExplorer.js/hourly.js's
// rule instead: by the adsetId/adId Shiprocket already stores per order,
// an ID match, never invented. An order with no adsetId/adId is surfaced
// as "Unmatched" (§14) rather than guessed at.
// ─────────────────────────────────────────────────────────────

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
function istHourOf(dateVal) {
  if (!dateVal) return null;
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return null;
  return new Date(d.getTime() + IST_OFFSET_MS).getUTCHours();
}
function pad2(n) {
  return String(n).padStart(2, "0");
}
function hourLabel(h) {
  return `${pad2(h)}:00–${pad2(h)}:59`;
}

const normalizeCampaignName = (name) => String(name || "").trim().toLowerCase().replace(/\s+/g, " ");

// ── Graph helpers (duplicated locally — same convention as
// dailyReports.js/hourly.js) ─────────────────────────────────────────

async function tryFetchCampaigns(actId, accessToken) {
  const fields = "id,name,status,effective_status";
  try {
    const data = await fbGet(`${GRAPH_BASE}/${actId}/campaigns?fields=${encodeURIComponent(fields)}&limit=200&access_token=${accessToken}`);
    return data.data || [];
  } catch (err) {
    console.log(`Daily-hourly campaign fetch failed for ${actId}: ${err.message}`);
    return [];
  }
}

// Meta's real hourly ad-spend breakdown, summed across every selected
// account — same breakdown key hourly.js already uses
// (hourly_stats_aggregated_by_advertiser_time_zone), duplicated here so
// this route never depends on hourly.js's internals.
async function fetchHourlySpendForAccounts(accountIds, accessToken, date) {
  const fields = "spend,impressions,clicks,actions,action_values";
  const breakdown = "hourly_stats_aggregated_by_advertiser_time_zone";
  const timeRange = encodeURIComponent(JSON.stringify({ since: date, until: date }));
  const byHour = new Map();
  let any = false;
  let lastError = null;
  for (const accountId of accountIds || []) {
    try {
      const data = await fbGet(
        `${GRAPH_BASE}/${actIdOf(accountId)}/insights?level=account&fields=${encodeURIComponent(fields)}&breakdowns=${breakdown}&time_range=${timeRange}&limit=500&access_token=${accessToken}`
      );
      const rows = data.data || [];
      if (rows.length) any = true;
      rows.forEach((row) => {
        const label = row.hourly_stats_aggregated_by_advertiser_time_zone || "";
        const hour = parseInt(String(label).slice(0, 2), 10);
        if (isNaN(hour) || hour < 0 || hour > 23) return;
        const cur = byHour.get(hour) || { spend: 0 };
        cur.spend += Number(row.spend || 0);
        byHour.set(hour, cur);
      });
    } catch (err) {
      lastError = err.message;
      console.log(`Daily-hourly spend fetch failed for ${accountId}: ${err.message}`);
    }
  }
  return { available: any, byHour, error: any ? null : lastError };
}

// Batched id -> {name, thumbnailUrl} resolve for whichever ad set/ad ids
// actually appear in this day's orders — never fetches the full account
// ad-set/ad list, and never guesses a name for an id Meta doesn't return
// anything for (deleted/no-access ids just stay unresolved, shown as
// their raw id, same "no fake data" rule §14 asks for).
async function resolveIds(accessToken, ids, fields) {
  const out = new Map();
  const unique = [...new Set((ids || []).filter(Boolean).map(String))];
  const CHUNK = 50;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    try {
      const data = await fbGet(`${GRAPH_BASE}/?ids=${chunk.join(",")}&fields=${encodeURIComponent(fields)}&access_token=${accessToken}`);
      Object.values(data || {}).forEach((obj) => {
        if (obj && obj.id) out.set(String(obj.id), obj);
      });
    } catch (err) {
      console.log(`Daily-hourly id resolve failed: ${err.message}`);
    }
  }
  return out;
}

function extractProductLines(raw) {
  const items = raw?.cart_data?.line_items || raw?.line_items || raw?.products || raw?.items || raw?.cart_data?.products;
  if (!Array.isArray(items) || items.length === 0) return [];
  return items.map((i) => ({
    name: i?.name || i?.product_name || i?.title || "Unknown product",
    quantity: i?.quantity != null ? Number(i.quantity) : i?.qty != null ? Number(i.qty) : 1,
  }));
}

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
  return { token, accountIds };
}

// Resolves the REAL Meta campaign for an order by name-matching, same
// rule as dailyReports.js. Returns null (never a bogus id) if the
// order's campaignName doesn't match any campaign the selected accounts
// actually have — the caller labels those "Unmatched" rather than
// guessing.
function matchCampaign(order, resolver) {
  // Campaign History Phase — resolved via the shared current + auto-
  // historical + manual mapping chain (see lib/campaignIdentity.js's
  // header) instead of exact-current-name-only, so a renamed campaign's
  // pre-rename orders still match here.
  const match = resolver.resolve(order);
  if (match.campaignId) {
    return { campaignId: match.campaignId, campaignName: match.currentName || order.campaignName, isUnmatched: false };
  }
  return { campaignId: null, campaignName: order.campaignName || "Unmatched", isUnmatched: true };
}

// Builds a sorted-by-orders breakdown array from a Map(key -> {..., orders: []}).
function toSortedBreakdown(map, shape) {
  return [...map.values()]
    .map(shape)
    .sort((a, b) => b.orders - a.orders || b.revenue - a.revenue);
}

function orderStats(orders) {
  let revenue = 0,
    codOrders = 0,
    prepaidOrders = 0;
  orders.forEach((o) => {
    revenue += Number(o.totalAmountPayable || 0);
    if (o.paymentType === "PREPAID") prepaidOrders += 1;
    else if (o.paymentType === "CASH_ON_DELIVERY") codOrders += 1;
  });
  return { orders: orders.length, revenue: Math.round(revenue * 100) / 100, codOrders, prepaidOrders };
}

const summaryCache = createTtlCache(45_000);

// ── GET /:tokenId/summary — whole-day, all-campaigns hourly intelligence ──
router.get("/:tokenId/summary", async (req, res) => {
  try {
    const { tokenId } = req.params;
    const { date } = req.query;
    if (!date) return res.status(400).json({ success: false, message: "date is required (YYYY-MM-DD)" });

    const { token, accountIds } = await resolveTokenAndAccounts(tokenId, req.query.adAccountId);

    const cacheKey = `${tokenId}:${date}:${[...accountIds].sort().join(",")}`;
    const cached = summaryCache.get(cacheKey);
    if (cached) return res.json({ ...cached, cached: true });

    // ── Known campaigns for this token's selected accounts ──
    const campaignMeta = new Map(); // realId -> {name, accountId}
    for (const accountId of accountIds) {
      const list = await tryFetchCampaigns(actIdOf(accountId), token.accessToken);
      list.forEach((c) => campaignMeta.set(String(c.id), { name: c.name, accountId }));
    }
    const campaignIdentityResolver = await buildCampaignIdentityResolver({
      tokenId,
      accountIds,
      liveCampaigns: [...campaignMeta.entries()].map(([id, v]) => ({
        campaignId: id,
        campaignName: v.name,
        accountId: v.accountId,
      })),
    });

    // ── Meta hourly spend, summed across the selected accounts ──
    const { available: metaHourlyAvailable, byHour: spendByHour, error: metaHourlyError } = await fetchHourlySpendForAccounts(
      accountIds,
      token.accessToken,
      date
    );

    // ── This day's orders, once ──
    const dayOrders = await ShiprocketOrder.find({ orderDate: date })
      .select("orderId orderCreatedAt campaignId campaignName adsetId adId totalAmountPayable paymentType raw")
      .lean();

    // ── Resolve ad set / ad names for whichever ids appear today ──
    const adsetIdsToday = dayOrders.map((o) => o.adsetId).filter(Boolean);
    const adIdsToday = dayOrders.map((o) => o.adId).filter(Boolean);
    const [adsetMap, adMap] = await Promise.all([
      resolveIds(token.accessToken, adsetIdsToday, "id,name"),
      resolveIds(token.accessToken, adIdsToday, "id,name,creative{thumbnail_url}"),
    ]);

    // ── Per-order enrichment (matched campaign + resolved names) ──
    const enriched = dayOrders.map((o) => {
      const match = matchCampaign(o, campaignIdentityResolver);
      const adset = o.adsetId ? adsetMap.get(String(o.adsetId)) : null;
      const ad = o.adId ? adMap.get(String(o.adId)) : null;
      return {
        ...o,
        hour: istHourOf(o.orderCreatedAt),
        matchedCampaignId: match.campaignId,
        matchedCampaignName: match.campaignName,
        campaignIsUnmatched: match.isUnmatched,
        adsetName: adset?.name || null,
        adName: ad?.name || null,
        adThumbnailUrl: ad?.creative?.thumbnail_url || null,
      };
    });

    // ── Group per hour ──
    const hours = [];
    for (let h = 0; h < 24; h++) {
      const ordersInHour = enriched.filter((o) => o.hour === h);
      const spend = Math.round((spendByHour.get(h)?.spend || 0) * 100) / 100;
      const stats = orderStats(ordersInHour);

      let delivered = 0,
        pending = 0,
        rto = 0;
      ordersInHour.forEach((o) => {
        const bucket = deliveryBucket6(extractDeliveryStatus(o.raw));
        if (bucket === "delivered") delivered += 1;
        else if (bucket === "rto") rto += 1;
        else pending += 1; // pending/processing/cancelled/returned all roll into "Pending", same hourly.js convention
      });

      // Campaign -> Ad Set -> Ad nesting, counts only (drill-down for
      // actual order rows happens via /:tokenId/hour-orders).
      const campaignMap = new Map();
      ordersInHour.forEach((o) => {
        const key = o.matchedCampaignId || `unmatched:${o.matchedCampaignName}`;
        if (!campaignMap.has(key)) {
          campaignMap.set(key, { campaignId: o.matchedCampaignId, campaignName: o.matchedCampaignName, isUnmatched: o.campaignIsUnmatched, orders: [], adsets: new Map() });
        }
        const c = campaignMap.get(key);
        c.orders.push(o);
        const adsetKey = o.adsetId || "unmatched";
        if (!c.adsets.has(adsetKey)) {
          c.adsets.set(adsetKey, { adsetId: o.adsetId || null, adsetName: o.adsetId ? o.adsetName || o.adsetId : "Unmatched", orders: [], ads: new Map() });
        }
        const as = c.adsets.get(adsetKey);
        as.orders.push(o);
        const adKey = o.adId || "unmatched";
        if (!as.ads.has(adKey)) {
          as.ads.set(adKey, { adId: o.adId || null, adName: o.adId ? o.adName || o.adId : "Unmatched", thumbnailUrl: o.adThumbnailUrl || null, orders: [] });
        }
        as.ads.get(adKey).orders.push(o);
      });

      const campaignBreakdown = toSortedBreakdown(campaignMap, (c) => ({
        campaignId: c.campaignId,
        campaignName: c.campaignName,
        isUnmatched: c.isUnmatched,
        ...orderStats(c.orders),
        adsets: toSortedBreakdown(c.adsets, (as) => ({
          adsetId: as.adsetId,
          adsetName: as.adsetName,
          ...orderStats(as.orders),
          ads: toSortedBreakdown(as.ads, (a) => ({
            adId: a.adId,
            adName: a.adName,
            thumbnailUrl: a.thumbnailUrl,
            ...orderStats(a.orders),
          })),
        })),
      }));

      // Flat, hour-wide ad-set/ad breakdowns (not scoped to the top
      // campaign) — §8/§9 ask for "the top ad set/ad this hour", not
      // "the top ad set within the top campaign this hour".
      const adsetFlat = new Map();
      const adFlat = new Map();
      ordersInHour.forEach((o) => {
        const asKey = o.adsetId || "unmatched";
        if (!adsetFlat.has(asKey)) adsetFlat.set(asKey, { adsetId: o.adsetId || null, adsetName: o.adsetId ? o.adsetName || o.adsetId : "Unmatched", orders: [] });
        adsetFlat.get(asKey).orders.push(o);
        const adKey = o.adId || "unmatched";
        if (!adFlat.has(adKey)) adFlat.set(adKey, { adId: o.adId || null, adName: o.adId ? o.adName || o.adId : "Unmatched", thumbnailUrl: o.adThumbnailUrl || null, orders: [] });
        adFlat.get(adKey).orders.push(o);
      });
      const adsetBreakdown = toSortedBreakdown(adsetFlat, (as) => ({ adsetId: as.adsetId, adsetName: as.adsetName, ...orderStats(as.orders) }));
      const adBreakdown = toSortedBreakdown(adFlat, (a) => ({ adId: a.adId, adName: a.adName, thumbnailUrl: a.thumbnailUrl, ...orderStats(a.orders) }));

      hours.push({
        hour: h,
        label: hourLabel(h),
        orders: stats.orders,
        codOrders: stats.codOrders,
        prepaidOrders: stats.prepaidOrders,
        revenue: stats.revenue,
        spend,
        roas: spend ? Math.round((stats.revenue / spend) * 100) / 100 : 0,
        delivered,
        pending,
        rto,
        topCampaign: campaignBreakdown[0] || null,
        topAdSet: adsetBreakdown[0] || null,
        topAd: adBreakdown[0] || null,
        campaigns: campaignBreakdown,
      });
    }

    // ── Day-level summary ──
    const totals = orderStats(enriched);
    const totalSpend = Math.round(hours.reduce((s, h) => s + h.spend, 0) * 100) / 100;
    let deliveredTotal = 0,
      pendingTotal = 0,
      rtoTotal = 0;
    hours.forEach((h) => {
      deliveredTotal += h.delivered;
      pendingTotal += h.pending;
      rtoTotal += h.rto;
    });

    const highestSellingHour = hours.reduce((best, h) => (!best || h.orders > best.orders ? h : best), null);
    const highestRevenueHour = hours.reduce((best, h) => (!best || h.revenue > best.revenue ? h : best), null);

    const dayCampaignMap = new Map();
    const dayAdsetMap = new Map();
    const dayAdMap = new Map();
    enriched.forEach((o) => {
      const cKey = o.matchedCampaignId || `unmatched:${o.matchedCampaignName}`;
      if (!dayCampaignMap.has(cKey)) dayCampaignMap.set(cKey, { campaignId: o.matchedCampaignId, campaignName: o.matchedCampaignName, isUnmatched: o.campaignIsUnmatched, orders: [] });
      dayCampaignMap.get(cKey).orders.push(o);

      const asKey = o.adsetId || "unmatched";
      if (!dayAdsetMap.has(asKey)) dayAdsetMap.set(asKey, { adsetId: o.adsetId || null, adsetName: o.adsetId ? o.adsetName || o.adsetId : "Unmatched", orders: [] });
      dayAdsetMap.get(asKey).orders.push(o);

      const adKey = o.adId || "unmatched";
      if (!dayAdMap.has(adKey)) dayAdMap.set(adKey, { adId: o.adId || null, adName: o.adId ? o.adName || o.adId : "Unmatched", thumbnailUrl: o.adThumbnailUrl || null, orders: [] });
      dayAdMap.get(adKey).orders.push(o);
    });
    const dayTopCampaign = toSortedBreakdown(dayCampaignMap, (c) => ({ campaignId: c.campaignId, campaignName: c.campaignName, isUnmatched: c.isUnmatched, ...orderStats(c.orders) }))[0] || null;
    const dayTopAdSet = toSortedBreakdown(dayAdsetMap, (as) => ({ adsetId: as.adsetId, adsetName: as.adsetName, ...orderStats(as.orders) }))[0] || null;
    const dayTopAd = toSortedBreakdown(dayAdMap, (a) => ({ adId: a.adId, adName: a.adName, thumbnailUrl: a.thumbnailUrl, ...orderStats(a.orders) }))[0] || null;

    const payload = {
      success: true,
      date,
      accountIds,
      metaHourlyAvailable,
      metaHourlyError: metaHourlyAvailable ? null : metaHourlyError,
      hours,
      summary: {
        totalOrders: totals.orders,
        codOrders: totals.codOrders,
        codRevenue: Math.round(enriched.filter((o) => o.paymentType === "CASH_ON_DELIVERY").reduce((s, o) => s + Number(o.totalAmountPayable || 0), 0) * 100) / 100,
        prepaidOrders: totals.prepaidOrders,
        prepaidRevenue: Math.round(enriched.filter((o) => o.paymentType === "PREPAID").reduce((s, o) => s + Number(o.totalAmountPayable || 0), 0) * 100) / 100,
        revenue: totals.revenue,
        spend: totalSpend,
        roas: totalSpend ? Math.round((totals.revenue / totalSpend) * 100) / 100 : 0,
        delivered: deliveredTotal,
        pending: pendingTotal,
        rto: rtoTotal,
        highestSellingHour: highestSellingHour && highestSellingHour.orders > 0 ? highestSellingHour : null,
        highestRevenueHour: highestRevenueHour && highestRevenueHour.revenue > 0 ? highestRevenueHour : null,
        topCampaign: dayTopCampaign,
        topAdSet: dayTopAdSet,
        topAd: dayTopAd,
      },
    };

    summaryCache.set(cacheKey, payload);
    res.json(payload);
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

// ── GET /:tokenId/hour-orders — drill-down into one hour (optionally
// further scoped to a campaign/ad set/ad node from the hierarchy, or a
// COD/Prepaid/delivery-status filter) §3/§12 ─────────────────────────
router.get("/:tokenId/hour-orders", async (req, res) => {
  try {
    const { tokenId } = req.params;
    const { date, hour, campaignId, campaignName, adsetId, adId, paymentType, deliveryBucket } = req.query;
    if (!date || hour === undefined) {
      return res.status(400).json({ success: false, message: "date and hour are required" });
    }
    const h = Number(hour);

    const token = await Token.findById(tokenId).lean();
    if (!token) return res.status(404).json({ success: false, message: "Token not found" });

    const dayOrders = await ShiprocketOrder.find({ orderDate: date }).lean();
    let scoped = dayOrders.filter((o) => istHourOf(o.orderCreatedAt) === h);

    if (adId) scoped = scoped.filter((o) => String(o.adId || "") === String(adId));
    else if (adsetId) scoped = scoped.filter((o) => String(o.adsetId || "") === String(adsetId));
    else if (campaignId || campaignName) {
      // Campaign History Phase — scoped via the shared current + auto-
      // historical + manual mapping chain (see lib/campaignIdentity.js's
      // header) whenever a campaignId is available (the normal case —
      // /summary above always returns one for a matched campaign), so a
      // renamed campaign's pre-rename orders still land in this
      // drill-down. Falls back to the old exact-name comparison only if
      // a caller somehow supplies just a campaignName with no id.
      if (campaignId) {
        const singleResolver = await buildSingleCampaignResolver({ tokenId, campaignId, currentName: campaignName || "" });
        scoped = scoped.filter((o) => singleResolver.resolve(o).campaignId);
      } else {
        const normalized = normalizeCampaignName(campaignName);
        scoped = normalized ? scoped.filter((o) => normalizeCampaignName(o.campaignName) === normalized) : scoped;
      }
    }
    if (paymentType) scoped = scoped.filter((o) => o.paymentType === paymentType);
    if (deliveryBucket) {
      scoped = scoped.filter((o) => {
        const bucket = deliveryBucket6(extractDeliveryStatus(o.raw));
        // "pending" filter also catches "processing", same fold used
        // throughout this route and hourly.js's own hourly grid.
        if (deliveryBucket === "pending") return bucket === "pending" || bucket === "processing";
        return bucket === deliveryBucket;
      });
    }

    // Resolve ad set / ad names for just what's in this filtered set —
    // small, scoped, same batched approach as /summary.
    const adsetIds = scoped.map((o) => o.adsetId).filter(Boolean);
    const adIds = scoped.map((o) => o.adId).filter(Boolean);
    const [adsetMap, adMap] = await Promise.all([
      resolveIds(token.accessToken, adsetIds, "id,name"),
      resolveIds(token.accessToken, adIds, "id,name"),
    ]);

    const orders = scoped
      .map((o) => {
        const customerName = [o.address?.firstName, o.address?.lastName].filter(Boolean).join(" ").trim() || null;
        const lines = extractProductLines(o.raw);
        const adset = o.adsetId ? adsetMap.get(String(o.adsetId)) : null;
        const ad = o.adId ? adMap.get(String(o.adId)) : null;
        return {
          orderId: o.orderId,
          orderCreatedAt: o.orderCreatedAt,
          customerName,
          phone: o.phone || null,
          totalAmountPayable: o.totalAmountPayable,
          paymentType: o.paymentType || null,
          campaignId: o.campaignId || null,
          campaignName: o.campaignName || null,
          adsetId: o.adsetId || null,
          adsetName: adset?.name || (o.adsetId ? o.adsetId : null),
          adId: o.adId || null,
          adName: ad?.name || (o.adId ? o.adId : null),
          product: lines.map((l) => l.name).join(", ") || null,
          productQuantity: lines.reduce((s, l) => s + l.quantity, 0),
          deliveryStatus: extractDeliveryStatus(o.raw),
          deliveryBucket: deliveryBucket6(extractDeliveryStatus(o.raw)),
        };
      })
      .sort((a, b) => new Date(b.orderCreatedAt || 0) - new Date(a.orderCreatedAt || 0));

    res.json({ success: true, date, hour: h, orders });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

export default router;
