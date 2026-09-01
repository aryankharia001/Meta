import express from "express";
import { buildActivityTimeline, getActivitySnapshot } from "../lib/campaignActivity.js";
// Phase 44 — Campaign Activity History + Hourly ROAS. Additive imports
// only; nothing above is touched.
import Token from "../models/Token.js";
import AdAccount from "../models/AdAccount.js";
import { createTtlCache } from "../lib/metaGraph.js";
import {
  buildDailyActivityReport,
  buildAccountHourlyReport,
  buildCampaignsForHour,
  buildCampaignsForDay,
  buildEntityHourlyReport,
  buildChildrenForHour,
  buildComparison,
} from "../lib/campaignActivityReport.js";

const router = express.Router();

// ─────────────────────────────────────────────────────────────
// Phase 39 — Campaign Activity History. Entirely new, additive route
// file (mounted at /api/campaign-activity). Backs the Campaign Drawer's
// new "Activity History" timeline + "Active/Inactive Summary"
// sections.
//
// Read-only, pure DB reads (CampaignStatusHistory/BudgetHistory/
// BidCapHistory via campaignActivity.js) — no Meta Graph API calls, so
// opening this section of the drawer is cheap no matter how many times
// it's opened. All the actual writing (baseline seeding + status-change
// recording) happens elsewhere: services/metaEntitySync.js's
// reconcileEntity() (cron ticks + Budget/Bid Cap control actions) and
// the list-endpoint ensureBaseline()/ensureBaselinesBulk() calls in
// routes/campaigns.js and routes/campaignExplorer.js. Nothing here
// writes anything.
//
// The order-attribution numbers (Active/Post-Campaign/Inactive orders
// & revenue, Primary ROAS) are NOT served from here — they're additive
// fields returned directly by the existing /campaigns/:tokenId/compare,
// /campaigns/:tokenId/:campaignId/details, and /campaign-explorer/:tokenId
// endpoints (see campaignActivity.js's classifyOrders()/
// computePrimaryRoas()), since those endpoints already have the matched
// orders and Meta spend figure in hand and re-fetching them here would
// mean a second, redundant round trip for every page that needs them.
// This route only serves what those don't already carry: the full
// event list and period breakdown for the drawer's timeline visual.
// ─────────────────────────────────────────────────────────────

router.get("/:tokenId/:campaignId/timeline", async (req, res) => {
  try {
    const { tokenId, campaignId } = req.params;
    const { since, until } = req.query;

    const [events, snapshot] = await Promise.all([
      buildActivityTimeline({ tokenId, entityId: campaignId, since, until }),
      getActivitySnapshot({ tokenId, entityId: campaignId }),
    ]);

    res.json({
      success: true,
      events,
      periods: snapshot.periods,
      summary: {
        available: snapshot.available,
        currentBucket: snapshot.currentBucket,
        campaignStart: snapshot.campaignStart,
        campaignEnd: snapshot.campaignEnd,
        historicalDataAvailableFrom: snapshot.historicalDataAvailableFrom,
        activeMs: snapshot.activeMs,
        inactiveMs: snapshot.inactiveMs,
        activeLabel: snapshot.activeLabel,
        inactiveLabel: snapshot.inactiveLabel,
        activePeriods: snapshot.activePeriods,
        inactivePeriods: snapshot.inactivePeriods,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// Phase 44 — Campaign Activity History + Hourly ROAS. Additive
// endpoints appended to the same router this file's Phase 39 header
// already documents. All of the actual computation lives in the new
// lib/campaignActivityReport.js (see that file's own header) — this
// file only resolves tokenId/accountId query params (same established
// convention as every other route file) and calls through.
//
// Scope: normal Meta campaign/ad set/ad activity + normal Meta/
// Shiprocket order performance only. Abandoned Cart is completely out
// of scope here (see campaignActivityReport.js's header for why that's
// true by construction, not just by omission).
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
  return { token, accountIds };
}

// Short TTL cache — this is historical data for past hours/days (never
// changes once the day is over) but the current/today's day keeps
// moving, so a short cache still keeps repeated drill-down clicks cheap
// without serving stale data for long. Same pattern/factory hourly.js's
// hourlyCache and dailyHourly.js's summaryCache already use.
const activityCache = createTtlCache(60_000);

function cacheKey(...parts) {
  return parts.join("|");
}

// ── GET /:tokenId/daily — spec §5 ───────────────────────────────────
router.get("/:tokenId/daily", async (req, res) => {
  try {
    const { tokenId } = req.params;
    const { since, until } = req.query;
    if (!since || !until) return res.status(400).json({ success: false, message: "since and until are required" });

    const { token, accountIds } = await resolveTokenAndAccounts(tokenId, req.query.adAccountId);
    const key = cacheKey("daily", tokenId, since, until, [...accountIds].sort().join(","));
    const cached = activityCache.get(key);
    if (cached) return res.json({ ...cached, cached: true });

    const report = await buildDailyActivityReport({ tokenId, accountIds, accessToken: token.accessToken, since, until });
    const payload = { success: true, ...report };
    activityCache.set(key, payload);
    res.json(payload);
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

// ── GET /:tokenId/hourly — account-wide hourly for one day, spec §6 ─
router.get("/:tokenId/hourly", async (req, res) => {
  try {
    const { tokenId } = req.params;
    const { date } = req.query;
    if (!date) return res.status(400).json({ success: false, message: "date is required (YYYY-MM-DD)" });

    const { token, accountIds } = await resolveTokenAndAccounts(tokenId, req.query.adAccountId);
    const key = cacheKey("hourly", tokenId, date, [...accountIds].sort().join(","));
    const cached = activityCache.get(key);
    if (cached) return res.json({ ...cached, cached: true });

    const report = await buildAccountHourlyReport({ tokenId, accountIds, accessToken: token.accessToken, date });
    const payload = { success: true, ...report };
    activityCache.set(key, payload);
    res.json(payload);
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

// ── GET /:tokenId/hourly/campaigns — all campaigns for one hour, §7 ─
router.get("/:tokenId/hourly/campaigns", async (req, res) => {
  try {
    const { tokenId } = req.params;
    const { date, hour } = req.query;
    if (!date || hour === undefined) return res.status(400).json({ success: false, message: "date and hour are required" });

    const { token, accountIds } = await resolveTokenAndAccounts(tokenId, req.query.adAccountId);
    const key = cacheKey("hourly-campaigns", tokenId, date, hour, [...accountIds].sort().join(","));
    const cached = activityCache.get(key);
    if (cached) return res.json({ ...cached, cached: true });

    const report = await buildCampaignsForHour({ tokenId, accountIds, accessToken: token.accessToken, date, hour: Number(hour) });
    const payload = { success: true, ...report };
    activityCache.set(key, payload);
    res.json(payload);
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

// ── GET /:tokenId/day-campaigns — every campaign's whole-day totals,
// spec §17's Campaign-Based exploration mode ────────────────────────
router.get("/:tokenId/day-campaigns", async (req, res) => {
  try {
    const { tokenId } = req.params;
    const { date } = req.query;
    if (!date) return res.status(400).json({ success: false, message: "date is required (YYYY-MM-DD)" });

    const { token, accountIds } = await resolveTokenAndAccounts(tokenId, req.query.adAccountId);
    const key = cacheKey("day-campaigns", tokenId, date, [...accountIds].sort().join(","));
    const cached = activityCache.get(key);
    if (cached) return res.json({ ...cached, cached: true });

    const report = await buildCampaignsForDay({ tokenId, accountIds, accessToken: token.accessToken, date });
    const payload = { success: true, ...report };
    activityCache.set(key, payload);
    res.json(payload);
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

// ── GET /:tokenId/campaign/:campaignId/hourly — single campaign 24h,
// spec §6/§8/§9 ──────────────────────────────────────────────────────
router.get("/:tokenId/campaign/:campaignId/hourly", async (req, res) => {
  try {
    const { tokenId, campaignId } = req.params;
    const { date, campaignName } = req.query;
    if (!date) return res.status(400).json({ success: false, message: "date is required (YYYY-MM-DD)" });

    const { token, accountIds } = await resolveTokenAndAccounts(tokenId, req.query.adAccountId);
    const key = cacheKey("campaign-hourly", tokenId, campaignId, date, campaignName || "");
    const cached = activityCache.get(key);
    if (cached) return res.json({ ...cached, cached: true });

    const report = await buildEntityHourlyReport({
      tokenId,
      entityType: "campaign",
      entityId: campaignId,
      campaignName,
      accountIds,
      accessToken: token.accessToken,
      date,
    });
    const payload = { success: true, ...report };
    activityCache.set(key, payload);
    res.json(payload);
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

// ── GET /:tokenId/campaign/:campaignId/hourly/:hour/adsets — spec §11 ─
router.get("/:tokenId/campaign/:campaignId/hourly/:hour/adsets", async (req, res) => {
  try {
    const { tokenId, campaignId, hour } = req.params;
    const { date } = req.query;
    if (!date) return res.status(400).json({ success: false, message: "date is required (YYYY-MM-DD)" });

    const { token, accountIds } = await resolveTokenAndAccounts(tokenId, req.query.adAccountId);
    const report = await buildChildrenForHour({
      tokenId,
      parentType: "campaign",
      parentId: campaignId,
      accountIds,
      accessToken: token.accessToken,
      date,
      hour: Number(hour),
    });
    res.json({ success: true, ...report });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

// ── GET /:tokenId/adset/:adsetId/hourly — single ad set 24h, spec §12 ─
router.get("/:tokenId/adset/:adsetId/hourly", async (req, res) => {
  try {
    const { tokenId, adsetId } = req.params;
    const { date, campaignId } = req.query;
    if (!date) return res.status(400).json({ success: false, message: "date is required (YYYY-MM-DD)" });

    const { token, accountIds } = await resolveTokenAndAccounts(tokenId, req.query.adAccountId);
    const report = await buildEntityHourlyReport({
      tokenId,
      entityType: "adset",
      entityId: adsetId,
      campaignId,
      accountIds,
      accessToken: token.accessToken,
      date,
    });
    res.json({ success: true, ...report });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

// ── GET /:tokenId/adset/:adsetId/hourly/:hour/ads — spec §11/§13 ────
router.get("/:tokenId/adset/:adsetId/hourly/:hour/ads", async (req, res) => {
  try {
    const { tokenId, adsetId, hour } = req.params;
    const { date } = req.query;
    if (!date) return res.status(400).json({ success: false, message: "date is required (YYYY-MM-DD)" });

    const { token, accountIds } = await resolveTokenAndAccounts(tokenId, req.query.adAccountId);
    const report = await buildChildrenForHour({
      tokenId,
      parentType: "adset",
      parentId: adsetId,
      accountIds,
      accessToken: token.accessToken,
      date,
      hour: Number(hour),
    });
    res.json({ success: true, ...report });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

// ── GET /:tokenId/ad/:adId/hourly — single ad 24h, spec §13 ─────────
router.get("/:tokenId/ad/:adId/hourly", async (req, res) => {
  try {
    const { tokenId, adId } = req.params;
    const { date } = req.query;
    if (!date) return res.status(400).json({ success: false, message: "date is required (YYYY-MM-DD)" });

    const { token, accountIds } = await resolveTokenAndAccounts(tokenId, req.query.adAccountId);
    const report = await buildEntityHourlyReport({
      tokenId,
      entityType: "ad",
      entityId: adId,
      accountIds,
      accessToken: token.accessToken,
      date,
    });
    res.json({ success: true, ...report });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

// ── GET /:tokenId/compare — Before/After Comparison Window, spec
// §23-§30 ────────────────────────────────────────────────────────────
router.get("/:tokenId/compare", async (req, res) => {
  try {
    const { tokenId } = req.params;
    const { entityType, entityId, campaignId, campaignName, date, beforeStart, beforeEnd, afterStart, afterEnd } = req.query;
    if (!entityType || !entityId || !date) {
      return res.status(400).json({ success: false, message: "entityType, entityId and date are required" });
    }
    if (![beforeStart, beforeEnd, afterStart, afterEnd].every((v) => v !== undefined && v !== "" && !isNaN(Number(v)))) {
      return res.status(400).json({ success: false, message: "beforeStart, beforeEnd, afterStart and afterEnd (hour numbers 0-23) are required" });
    }
    if (!["campaign", "adset", "ad"].includes(entityType)) {
      return res.status(400).json({ success: false, message: "entityType must be campaign, adset or ad" });
    }

    const { token, accountIds } = await resolveTokenAndAccounts(tokenId, req.query.adAccountId);
    const result = await buildComparison({
      tokenId,
      entityType,
      entityId,
      campaignId,
      campaignName,
      accountIds,
      accessToken: token.accessToken,
      date,
      beforeStart: Number(beforeStart),
      beforeEnd: Number(beforeEnd),
      afterStart: Number(afterStart),
      afterEnd: Number(afterEnd),
    });
    res.json({ success: true, ...result });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

export default router;
