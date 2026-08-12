import express from "express";
import ShiprocketOrder from "../models/shiprocketorder.js";
import ShiprocketSyncLog from "../models/ShiprocketSyncLog.js";
import { backfillShiprocketRange, getBackfillState } from "../services/shiprocketService.js";
import { todayIstIso } from "../utils/dateIst.js";

const router = express.Router();

// ─────────────────────────────────────────────────────────────
// Phase 5 — Live Sync backend
// ─────────────────────────────────────────────────────────────
//
// Entirely new, additive route file (mounted at /api/live-sync in
// index.js). Does NOT reimplement or replace any part of the Meta ↔
// Shiprocket sync/matching pipeline — the actual work of talking to
// Shiprocket and upserting orders is 100% delegated to the existing,
// untouched backfillShiprocketRange()/syncDayWithRetry() write path
// (same function the manual "Start Fetch" button and the 30-minute
// cron already call). This route only:
//
//   1. Snapshots which orderIds exist for "today" before the call,
//   2. Calls the existing sync function (unmodified),
//   3. Snapshots again after, and diffs the two to report how many
//      orders were genuinely new this cycle.
//
// "Updated orders" are intentionally always 0 here: syncDayWithRetry
// already skips re-fetching full details for any orderId already
// stored (by design, to avoid hammering Shiprocket/akravi.com with
// redundant calls every 10 seconds — see its comments). Detecting a
// changed payment status etc. would require re-fetching full details
// for every order on every cycle, which would both violate the
// "incremental only" / "avoid unnecessary API requests" requirements
// of this phase AND duplicate/second-guess the rate-limit-safe
// batching logic that already exists there. So: honestly reported as
// 0 rather than faked. The manual Refresh button gets you newly
// *created* orders instantly — same safe path, just triggered by a
// click instead of a timer.
//
// Campaign ↔ order matching itself is untouched: this route never
// reads or writes campaignId/campaignName matching — that still lives
// entirely in campaigns.js's /compare route, which the frontend
// re-queries (via the existing fetchLiveCampaigns/fetchOrdersDetailed
// calls) after this endpoint reports new data landed.

async function snapshotToday(today) {
  const docs = await ShiprocketOrder.find({ orderDate: today })
    .select("orderId campaignId campaignName totalAmountPayable paymentType orderCreatedAt")
    .lean();
  return docs;
}

router.post("/run", async (req, res) => {
  const today = todayIstIso();

  if (getBackfillState().running) {
    return res.json({
      success: true,
      alreadyRunning: true,
      message: "Sync already in progress.",
      syncedAt: null,
    });
  }

  try {
    const before = await snapshotToday(today);
    const beforeIds = new Set(before.map((d) => d.orderId));

    await backfillShiprocketRange(today, today);

    const after = await snapshotToday(today);
    const newDocs = after.filter((d) => !beforeIds.has(d.orderId));

    const log = await ShiprocketSyncLog.findOne({ date: today }).lean();
    const failed = log?.status === "failed";

    res.json({
      success: true,
      alreadyRunning: false,
      syncedAt: new Date(),
      ordersProcessed: after.length,
      newOrders: newDocs.length,
      updatedOrders: 0,
      failedOrders: failed ? 1 : 0,
      syncError: failed ? log.error || "Sync failed" : null,
      newOrderRecords: newDocs.map((d) => ({
        orderId: d.orderId,
        campaignId: d.campaignId || null,
        campaignName: d.campaignName || null,
        totalAmountPayable: d.totalAmountPayable,
        paymentType: d.paymentType || null,
        orderDate: today,
      })),
    });
  } catch (err) {
    // "A backfill is already running" is a benign race (upfront check
    // above vs. the 30-min cron or another request starting between the
    // check and this call) — treat it the same as the upfront check
    // rather than surfacing it as a real sync failure.
    if (/already running/i.test(err.message || "")) {
      return res.json({
        success: true,
        alreadyRunning: true,
        message: "Sync already in progress.",
        syncedAt: null,
      });
    }
    console.error("Live sync failed:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
