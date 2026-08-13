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
    const limit = Math.min(Number(req.query.limit) || 200, 1000);
    // Phase 14 §8 — optional filters: search (type/message/user, simple
    // case-insensitive contains), user, action (=type), entityType, and
    // a date range over createdAt. All purely additive query-string
    // params; omitting all of them reproduces the exact old behavior.
    const query = {};
    if (req.query.user) query.user = req.query.user;
    if (req.query.type) query.type = req.query.type;
    if (req.query.entityType) query.entityType = req.query.entityType;
    if (req.query.since || req.query.until) {
      query.createdAt = {};
      if (req.query.since) query.createdAt.$gte = new Date(`${req.query.since}T00:00:00.000Z`);
      if (req.query.until) query.createdAt.$lte = new Date(`${req.query.until}T23:59:59.999Z`);
    }
    if (req.query.q) {
      const re = new RegExp(String(req.query.q).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      query.$or = [{ message: re }, { user: re }, { type: re }, { entityId: re }];
    }

    const entries = await ActivityLog.find(query).sort({ createdAt: -1 }).limit(limit).lean();
    res.json({
      success: true,
      entries: entries.map((e) => ({
        id: String(e._id),
        type: e.type,
        message: e.message,
        meta: e.meta || {},
        user: e.user || "System",
        entityType: e.entityType || "",
        entityId: e.entityId || "",
        createdAt: e.createdAt,
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/", async (req, res) => {
  try {
    const { type, message, meta, entityType, entityId } = req.body || {};
    if (!type || !message) {
      return res.status(400).json({ success: false, message: "type and message are required" });
    }
    // Phase 14 §7 — every /api route is now behind requireAuth, so
    // req.user is always populated here; the acting user is attributed
    // server-side rather than trusted from the request body.
    const entry = await ActivityLog.create({
      type,
      message,
      meta: meta || {},
      user: req.user?.email || "System",
      entityType: entityType || "",
      entityId: entityId ? String(entityId) : "",
    });
    res.json({
      success: true,
      entry: {
        id: String(entry._id),
        type: entry.type,
        message: entry.message,
        meta: entry.meta,
        user: entry.user,
        entityType: entry.entityType,
        entityId: entry.entityId,
        createdAt: entry.createdAt,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
