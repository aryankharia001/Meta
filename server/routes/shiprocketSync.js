import express from "express";
import {
  backfillShiprocketRange,
  getBackfillState,
  requestBackfillCancel,
  getShiprocketSyncStatus,
} from "../services/shiprocketService.js";
import ShiprocketSyncLog from "../models/ShiprocketSyncLog.js";

const router = express.Router();

// ─── POST /api/shiprocket-sync/start ─────────────────────────
// Kicks off a background backfill for the given range. Responds
// immediately — does NOT wait for the backfill to finish. Poll
// GET /status to watch progress.
router.post("/start", async (req, res) => {
  const { since, until, force } = req.body || {};
  if (!since || !until) {
    return res.status(400).json({ success: false, message: "since and until are required (YYYY-MM-DD)" });
  }
  if (getBackfillState().running) {
    return res.status(409).json({ success: false, message: "A backfill is already in progress" });
  }

  // Fire-and-forget on purpose — this can take hours for a large range,
  // and the HTTP request that triggered it shouldn't have to stay open.
  // force=true re-syncs every day in range even if already marked
  // "complete" (see backfillShiprocketRange).
  backfillShiprocketRange(since, until, { force: !!force }).catch((err) => {
    console.error("Backfill crashed:", err);
  });

  res.json({
    success: true,
    message: force
      ? `Force re-sync started for ${since} → ${until} (re-fetching every day, including already-complete ones)`
      : `Backfill started for ${since} → ${until}`,
  });
});

// ─── POST /api/shiprocket-sync/cancel ────────────────────────
// Stops the backfill after the day currently in progress finishes
// (never kills mid-day, so that day's sync log stays consistent).
router.post("/cancel", (req, res) => {
  requestBackfillCancel();
  res.json({ success: true, message: "Cancellation requested — will stop after the current day finishes" });
});

// ─── GET /api/shiprocket-sync/status ─────────────────────────
// The "checklist": one entry per day in range showing complete /
// failed / pending / live, plus whether a backfill is currently running.
router.get("/status", async (req, res) => {
  const { since, until } = req.query;
  if (!since || !until) {
    return res.status(400).json({ success: false, message: "since and until are required (YYYY-MM-DD)" });
  }
  try {
    const status = await getShiprocketSyncStatus(since, until);
    res.json({ success: true, data: status });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── POST /api/shiprocket-sync/retry-failed ──────────────────
// Re-runs only the days marked "failed" in the given range.
// backfillShiprocketRange already skips "complete" days and re-attempts
// anything else, so this is just a convenience wrapper with a clearer
// name + an early "nothing to do" response.
router.post("/retry-failed", async (req, res) => {
  const { since, until } = req.body || {};
  if (!since || !until) {
    return res.status(400).json({ success: false, message: "since and until are required (YYYY-MM-DD)" });
  }
  if (getBackfillState().running) {
    return res.status(409).json({ success: false, message: "A backfill is already in progress" });
  }

  const failedCount = await ShiprocketSyncLog.countDocuments({
    date: { $gte: since, $lte: until },
    status: "failed",
  });

  if (failedCount === 0) {
    return res.json({ success: true, message: "No failed days in this range" });
  }

  backfillShiprocketRange(since, until).catch((err) => {
    console.error("Retry-failed backfill crashed:", err);
  });

  res.json({ success: true, message: `Retrying ${failedCount} failed day(s)` });
});

export default router;