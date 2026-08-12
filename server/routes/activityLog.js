import express from "express";
import ActivityLog from "../models/ActivityLog.js";

const router = express.Router();

// ─────────────────────────────────────────────────────────────
// Phase 7 — Activity Log. Entirely new, additive route file (mounted
// at /api/activity-log). Write-mostly audit trail triggered from
// existing action points on the frontend (refresh button, note CRUD,
// saved view creation, favorite toggling) — those actions themselves
// are completely unchanged, this just also records that they happened.
// ─────────────────────────────────────────────────────────────

router.get("/", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const entries = await ActivityLog.find({}).sort({ createdAt: -1 }).limit(limit).lean();
    res.json({
      success: true,
      entries: entries.map((e) => ({ id: String(e._id), type: e.type, message: e.message, meta: e.meta || {}, createdAt: e.createdAt })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/", async (req, res) => {
  try {
    const { type, message, meta } = req.body || {};
    if (!type || !message) {
      return res.status(400).json({ success: false, message: "type and message are required" });
    }
    const entry = await ActivityLog.create({ type, message, meta: meta || {} });
    res.json({ success: true, entry: { id: String(entry._id), type: entry.type, message: entry.message, meta: entry.meta, createdAt: entry.createdAt } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
