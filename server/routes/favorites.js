import express from "express";
import Favorite from "../models/Favorite.js";

const router = express.Router();

// ─────────────────────────────────────────────────────────────
// Phase 7 — Favorites. Entirely new, additive route file (mounted at
// /api/favorites). Reads/writes only the new Favorite collection.
// ─────────────────────────────────────────────────────────────

router.get("/", async (req, res) => {
  try {
    const { entityType } = req.query;
    const query = entityType ? { entityType } : {};
    const favorites = await Favorite.find(query).sort({ createdAt: -1 }).lean();
    res.json({
      success: true,
      favorites: favorites.map((f) => ({
        id: String(f._id),
        entityType: f.entityType,
        entityId: f.entityId,
        label: f.label || "",
        meta: f.meta || {},
        createdAt: f.createdAt,
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/", async (req, res) => {
  try {
    const { entityType, entityId, label, meta } = req.body || {};
    if (!entityType || !entityId) {
      return res.status(400).json({ success: false, message: "entityType and entityId are required" });
    }
    const favorite = await Favorite.findOneAndUpdate(
      { entityType, entityId },
      { entityType, entityId, label: label || "", meta: meta || {} },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.json({
      success: true,
      favorite: { id: String(favorite._id), entityType: favorite.entityType, entityId: favorite.entityId, label: favorite.label, meta: favorite.meta, createdAt: favorite.createdAt },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete("/:entityType/:entityId", async (req, res) => {
  try {
    const { entityType, entityId } = req.params;
    await Favorite.findOneAndDelete({ entityType, entityId });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
