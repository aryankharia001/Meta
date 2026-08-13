import express from "express";
import Token from "../models/Token.js";
import { recordActivity } from "../lib/activityLog.js";

const router = express.Router();

// ─── Token CRUD ───────────────────────────────────────────────
// Pure CRUD around the existing Token model. Nothing here touches the
// Shiprocket sync, order fetching, or campaign/order matching — this only
// lets tokens be managed (added/renamed/removed) instead of hardcoded in
// the client or inserted by hand into Mongo.

// GET /api/tokens — list all tokens (accessToken masked for display)
router.get("/", async (req, res) => {
  try {
    const tokens = await Token.find().sort({ createdAt: -1 }).lean();
    res.json({ success: true, data: tokens });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/tokens/:id — single token
router.get("/:id", async (req, res) => {
  try {
    const token = await Token.findById(req.params.id).lean();
    if (!token) {
      return res.status(404).json({ success: false, message: "Token not found" });
    }
    res.json({ success: true, data: token });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/tokens — create
router.post("/", async (req, res) => {
  try {
    const { accessToken, label, note } = req.body || {};
    if (!accessToken || !accessToken.trim()) {
      return res.status(400).json({ success: false, message: "accessToken is required" });
    }

    const token = await Token.create({
      accessToken: accessToken.trim(),
      label: (label || "").trim(),
      note: (note || "").trim(),
    });

    // Phase 14 §6/§7 §Security — logs that a token was added and its
    // label, NEVER the accessToken value itself.
    await recordActivity({
      user: req.user?.email,
      type: "meta_token_added",
      message: `Added Meta Access Token${token.label ? ` (${token.label})` : ""}`,
      entityType: "token",
      entityId: String(token._id),
    });

    res.status(201).json({ success: true, data: token });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: "This access token already exists" });
    }
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/tokens/:id — update
router.put("/:id", async (req, res) => {
  try {
    const { accessToken, label, note } = req.body || {};
    const update = {};
    if (accessToken !== undefined) {
      if (!accessToken.trim()) {
        return res.status(400).json({ success: false, message: "accessToken cannot be empty" });
      }
      update.accessToken = accessToken.trim();
    }
    if (label !== undefined) update.label = label.trim();
    if (note !== undefined) update.note = note.trim();

    const token = await Token.findByIdAndUpdate(req.params.id, update, {
      new: true,
      runValidators: true,
    });

    if (!token) {
      return res.status(404).json({ success: false, message: "Token not found" });
    }

    await recordActivity({
      user: req.user?.email,
      type: "meta_token_updated",
      message: `Updated Meta Access Token${token.label ? ` (${token.label})` : ""}`,
      entityType: "token",
      entityId: String(token._id),
    });

    res.json({ success: true, data: token });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: "This access token already exists" });
    }
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/tokens/:id — delete (cascades linked AdAccounts via the
// model's findOneAndDelete pre-hook)
router.delete("/:id", async (req, res) => {
  try {
    const token = await Token.findByIdAndDelete(req.params.id);
    if (!token) {
      return res.status(404).json({ success: false, message: "Token not found" });
    }

    await recordActivity({
      user: req.user?.email,
      type: "meta_token_deleted",
      message: `Deleted Meta Access Token${token.label ? ` (${token.label})` : ""}`,
      entityType: "token",
      entityId: String(token._id),
    });

    res.json({ success: true, message: "Token deleted" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
