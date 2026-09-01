import express from "express";
import {
  backfillTrafleadRange,
  getBackfillState,
  requestBackfillCancel,
  getTrafleadSyncStatus,
  discoverTrafleadOfferNames,
} from "../services/trafleadSyncService.js";
import TrafleadSyncLog from "../models/TrafleadSyncLog.js";

const router = express.Router();

// Mounted at /api/traflead-sync (behind requireAuth — see index.js).
// Mirrors routes/shiprocketSync.js's start/cancel/status/retry-failed
// shape exactly, pointed at the Traflead Abandoned Cart sync instead.

// ─── POST /api/traflead-sync/start ───────────────────────────
// Kicks off a background sync for the given IST date range. Responds
// immediately — this is the "Meta Date Range -> Fetch Traflead Data"
// step of the refresh flow; poll GET /status to watch it land.
router.post("/start", async (req, res) => {
  const { since, until, force } = req.body || {};
  if (!since || !until) {
    return res.status(400).json({ success: false, message: "since and until are required (YYYY-MM-DD)" });
  }
  if (getBackfillState().running) {
    return res.status(409).json({ success: false, message: "A Traflead sync is already in progress" });
  }

  backfillTrafleadRange(since, until, { force: !!force }).catch((err) => {
    console.error("Traflead sync crashed:", err);
  });

  res.json({
    success: true,
    message: force
      ? `Force re-sync started for ${since} → ${until} (re-fetching every day from Traflead, including already-complete ones)`
      : `Sync started for ${since} → ${until}`,
  });
});

// ─── POST /api/traflead-sync/cancel ──────────────────────────
router.post("/cancel", (req, res) => {
  requestBackfillCancel();
  res.json({ success: true, message: "Cancellation requested — will stop after the current day finishes" });
});

// ─── GET /api/traflead-sync/status ───────────────────────────
router.get("/status", async (req, res) => {
  const { since, until } = req.query;
  if (!since || !until) {
    return res.status(400).json({ success: false, message: "since and until are required (YYYY-MM-DD)" });
  }
  try {
    const status = await getTrafleadSyncStatus(since, until);
    res.json({ success: true, data: status });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── POST /api/traflead-sync/retry-failed ────────────────────
router.post("/retry-failed", async (req, res) => {
  const { since, until } = req.body || {};
  if (!since || !until) {
    return res.status(400).json({ success: false, message: "since and until are required (YYYY-MM-DD)" });
  }
  if (getBackfillState().running) {
    return res.status(409).json({ success: false, message: "A Traflead sync is already in progress" });
  }

  const failedCount = await TrafleadSyncLog.countDocuments({
    date: { $gte: since, $lte: until },
    status: "failed",
  });

  if (failedCount === 0) {
    return res.json({ success: true, message: "No failed days in this range" });
  }

  backfillTrafleadRange(since, until).catch((err) => {
    console.error("Retry-failed Traflead sync crashed:", err);
  });

  res.json({ success: true, message: `Retrying ${failedCount} failed day(s)` });
});

// ─── GET /api/traflead-sync/offers ───────────────────────────
// Diagnostic — lists every offer name Traflead actually has (no date
// filter), so a misconfigured TRAFLEAD_ABANDONED_CART_OFFER_NAME can be
// spotted and fixed from the UI instead of guessed at.
router.get("/offers", async (req, res) => {
  try {
    const offers = await discoverTrafleadOfferNames();
    res.json({ success: true, offers });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
