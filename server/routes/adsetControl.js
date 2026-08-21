import express from "express";
import Token from "../models/Token.js";
import AdAccount from "../models/AdAccount.js";
import { updateEntityFields, toMinorUnits } from "../lib/metaGraphWrite.js";
import { reconcileEntity } from "../services/metaEntitySync.js";
import { buildTimeline, computeHourlyControl, computeCompare } from "../lib/controlHelpers.js";
import { recordActivity } from "../lib/activityLog.js";

const router = express.Router();

// ─────────────────────────────────────────────────────────────
// Phase 27 — Ad Set Budget & Bid Cap control (mounted fresh at
// /api/adset-control). Mirrors campaignControl.js's endpoints, plus the
// PUT .../bid-cap endpoint (Bid Cap is only editable at the ad set
// level — see that file's header comment for why).
// ─────────────────────────────────────────────────────────────

async function resolveAccountId(tokenId) {
  const accounts = await AdAccount.find({ tokenId }).lean();
  return accounts[0]?.adAccountId || "";
}

router.get("/:tokenId/:adsetId/current", async (req, res) => {
  try {
    const { tokenId, adsetId } = req.params;
    const token = await Token.findById(tokenId).lean();
    if (!token) return res.status(404).json({ success: false, message: "Token not found" });

    const accountId = await resolveAccountId(tokenId);
    const { current } = await reconcileEntity({
      tokenId,
      accountId,
      entityType: "adset",
      entityId: adsetId,
      accessToken: token.accessToken,
    });
    res.json({ success: true, current });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.put("/:tokenId/:adsetId/budget", async (req, res) => {
  try {
    const { tokenId, adsetId } = req.params;
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

    try {
      await updateEntityFields(adsetId, token.accessToken, { [field]: toMinorUnits(budget) });
    } catch (metaErr) {
      return res.status(metaErr.status || 400).json({ success: false, message: metaErr.message, fbErrorCode: metaErr.fbErrorCode });
    }

    const accountId = await resolveAccountId(tokenId);
    const { current, changes } = await reconcileEntity({
      tokenId,
      accountId,
      entityType: "adset",
      entityId: adsetId,
      accessToken: token.accessToken,
      actingUser: req.user.email,
    });

    await recordActivity({
      user: req.user.email,
      type: "adset_budget_updated",
      message: `${req.user.email} updated Ad Set "${current.name}" budget to ${current.budget} (${current.budgetType})`,
      entityType: "adset",
      entityId: adsetId,
      meta: { budget: current.budget, budgetType: current.budgetType },
    });

    res.json({ success: true, current, change: changes.budget });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.put("/:tokenId/:adsetId/bid-cap", async (req, res) => {
  try {
    const { tokenId, adsetId } = req.params;
    const { bidAmount } = req.body;

    if (bidAmount === undefined || bidAmount === null || isNaN(Number(bidAmount)) || Number(bidAmount) <= 0) {
      return res.status(400).json({ success: false, message: "A positive numeric bid amount is required" });
    }

    const token = await Token.findById(tokenId).lean();
    if (!token) return res.status(404).json({ success: false, message: "Token not found" });

    try {
      await updateEntityFields(adsetId, token.accessToken, { bid_amount: toMinorUnits(bidAmount) });
    } catch (metaErr) {
      return res.status(metaErr.status || 400).json({ success: false, message: metaErr.message, fbErrorCode: metaErr.fbErrorCode });
    }

    const accountId = await resolveAccountId(tokenId);
    const { current, changes } = await reconcileEntity({
      tokenId,
      accountId,
      entityType: "adset",
      entityId: adsetId,
      accessToken: token.accessToken,
      actingUser: req.user.email,
    });

    await recordActivity({
      user: req.user.email,
      type: "adset_bid_cap_updated",
      message: `${req.user.email} updated Ad Set "${current.name}" bid cap to ${current.bidAmount}`,
      entityType: "adset",
      entityId: adsetId,
      meta: { bidAmount: current.bidAmount, bidStrategy: current.bidStrategy },
    });

    res.json({ success: true, current, change: changes.bidCap });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.get("/:tokenId/:adsetId/history", async (req, res) => {
  try {
    const { adsetId } = req.params;
    const { since, until } = req.query;
    const events = await buildTimeline({ entityType: "adset", entityId: adsetId, since, until });
    res.json({ success: true, events });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.get("/:tokenId/:adsetId/hourly", async (req, res) => {
  try {
    const { tokenId, adsetId } = req.params;
    const { date } = req.query;
    if (!date) return res.status(400).json({ success: false, message: "date is required (YYYY-MM-DD)" });

    const token = await Token.findById(tokenId).lean();
    if (!token) return res.status(404).json({ success: false, message: "Token not found" });

    const report = await computeHourlyControl({ entityType: "adset", entityId: adsetId, accessToken: token.accessToken, date });
    res.json({ success: true, ...report });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

router.get("/:tokenId/:adsetId/compare", async (req, res) => {
  try {
    const { tokenId, adsetId } = req.params;
    const { changeId, type } = req.query;
    if (!changeId) return res.status(400).json({ success: false, message: "changeId is required" });

    const token = await Token.findById(tokenId).lean();
    if (!token) return res.status(404).json({ success: false, message: "Token not found" });

    const result = await computeCompare({
      entityType: "adset",
      entityId: adsetId,
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
