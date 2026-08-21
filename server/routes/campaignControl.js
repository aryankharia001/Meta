import express from "express";
import Token from "../models/Token.js";
import AdAccount from "../models/AdAccount.js";
import { updateEntityFields, toMinorUnits } from "../lib/metaGraphWrite.js";
import { reconcileEntity } from "../services/metaEntitySync.js";
import { buildTimeline, computeHourlyControl, computeCompare } from "../lib/controlHelpers.js";
import { recordActivity } from "../lib/activityLog.js";

const router = express.Router();

// ─────────────────────────────────────────────────────────────
// Phase 27 — Campaign Budget & Bid Cap control (mounted fresh at
// /api/campaign-control). Entirely new, additive route file; nothing in
// campaigns.js/campaignExplorer.js/dailyReports.js is touched or
// imported here except read-only Token/AdAccount lookups (same pattern
// every other route file already uses).
//
// Bid Cap is NOT editable at the campaign level — Meta's Graph API only
// exposes an editable bid amount on ad sets (see adsetControl.js). This
// file's "current" endpoint still reports bidStrategy/bidAmount as
// read-only context where present (e.g. under Campaign Budget
// Optimization Meta sometimes still returns a campaign-level
// bid_strategy), but there's no PUT .../bid-cap here on purpose.
// ─────────────────────────────────────────────────────────────

async function resolveAccountId(tokenId, campaignId) {
  // Best-effort only — used for indexing/reporting, never required for
  // correctness (entityId/tokenId alone are enough to key history rows).
  const accounts = await AdAccount.find({ tokenId }).lean();
  return accounts[0]?.adAccountId || "";
}

router.get("/:tokenId/:campaignId/current", async (req, res) => {
  try {
    const { tokenId, campaignId } = req.params;
    const token = await Token.findById(tokenId).lean();
    if (!token) return res.status(404).json({ success: false, message: "Token not found" });

    const accountId = await resolveAccountId(tokenId, campaignId);
    const { current } = await reconcileEntity({
      tokenId,
      accountId,
      entityType: "campaign",
      entityId: campaignId,
      accessToken: token.accessToken,
    });
    res.json({ success: true, current });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.put("/:tokenId/:campaignId/budget", async (req, res) => {
  try {
    const { tokenId, campaignId } = req.params;
    const { budget, budgetType } = req.body;

    if (budget === undefined || budget === null || isNaN(Number(budget)) || Number(budget) <= 0) {
      return res.status(400).json({ success: false, message: "A positive numeric budget is required" });
    }
    if (!["daily", "lifetime"].includes(budgetType)) {
      return res.status(400).json({ success: false, message: "budgetType must be 'daily' or 'lifetime'" });
    }

    const token = await Token.findById(tokenId).lean();
    if (!token) return res.status(404).json({ success: false, message: "Token not found" });

    const field = budgetType === "daily" ? "daily_budget" : "lifetime_budget";

    // Write to Meta first. If Meta rejects it, nothing below runs — no
    // history row, no DB write, the real Meta error goes straight back
    // to the caller (spec §12).
    try {
      await updateEntityFields(campaignId, token.accessToken, { [field]: toMinorUnits(budget) });
    } catch (metaErr) {
      return res.status(metaErr.status || 400).json({
        success: false,
        message: metaErr.message,
        fbErrorCode: metaErr.fbErrorCode,
      });
    }

    const accountId = await resolveAccountId(tokenId, campaignId);

    // Read back what Meta actually confirmed (never trust the request
    // body as the new source of truth) and let the single reconciler
    // write the history row.
    const { current, changes } = await reconcileEntity({
      tokenId,
      accountId,
      entityType: "campaign",
      entityId: campaignId,
      accessToken: token.accessToken,
      actingUser: req.user.email,
    });

    await recordActivity({
      user: req.user.email,
      type: "campaign_budget_updated",
      message: `${req.user.email} updated Campaign "${current.name}" budget to ${current.budget} (${current.budgetType})`,
      entityType: "campaign",
      entityId: campaignId,
      meta: { budget: current.budget, budgetType: current.budgetType },
    });

    res.json({ success: true, current, change: changes.budget });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.get("/:tokenId/:campaignId/history", async (req, res) => {
  try {
    const { campaignId } = req.params;
    const { since, until } = req.query;
    const events = await buildTimeline({ entityType: "campaign", entityId: campaignId, since, until });
    res.json({ success: true, events });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.get("/:tokenId/:campaignId/hourly", async (req, res) => {
  try {
    const { tokenId, campaignId } = req.params;
    const { date } = req.query;
    if (!date) return res.status(400).json({ success: false, message: "date is required (YYYY-MM-DD)" });

    const token = await Token.findById(tokenId).lean();
    if (!token) return res.status(404).json({ success: false, message: "Token not found" });

    const report = await computeHourlyControl({ entityType: "campaign", entityId: campaignId, accessToken: token.accessToken, date });
    res.json({ success: true, ...report });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.get("/:tokenId/:campaignId/compare", async (req, res) => {
  try {
    const { tokenId, campaignId } = req.params;
    const { changeId, type } = req.query;
    if (!changeId) return res.status(400).json({ success: false, message: "changeId is required" });

    const token = await Token.findById(tokenId).lean();
    if (!token) return res.status(404).json({ success: false, message: "Token not found" });

    const result = await computeCompare({
      entityType: "campaign",
      entityId: campaignId,
      accessToken: token.accessToken,
      changeType: type === "bid_cap" ? "bid_cap" : "budget",
      changeId,
    });
    res.json({ success: true, ...result });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

export default router;
