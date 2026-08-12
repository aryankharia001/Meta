import express from "express";
import SavedView from "../models/SavedView.js";

const router = express.Router();

// ─────────────────────────────────────────────────────────────
// Phase 7 — Saved Filters & Views. Entirely new, additive route file
// (mounted at /api/saved-views). Reads/writes only the new SavedView
// collection — never touches how any page's filters actually work,
// just stores/returns snapshots of them.
// ─────────────────────────────────────────────────────────────

router.get("/", async (req, res) => {
  try {
    const { page } = req.query;
    const query = page ? { page } : {};
    const views = await SavedView.find(query).sort({ createdAt: -1 }).lean();
    res.json({
      success: true,
      views: views.map((v) => ({ id: String(v._id), name: v.name, page: v.page, filters: v.filters || {}, createdAt: v.createdAt })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/", async (req, res) => {
  try {
    const { name, page, filters } = req.body || {};
    if (!name || !name.trim() || !page) {
      return res.status(400).json({ success: false, message: "name and page are required" });
    }
    const view = await SavedView.create({ name: name.trim(), page, filters: filters || {} });
    res.json({ success: true, view: { id: String(view._id), name: view.name, page: view.page, filters: view.filters, createdAt: view.createdAt } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const { name, filters } = req.body || {};
    const update = {};
    if (name !== undefined) {
      if (!name.trim()) return res.status(400).json({ success: false, message: "name cannot be empty" });
      update.name = name.trim();
    }
    if (filters !== undefined) update.filters = filters;
    const view = await SavedView.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!view) return res.status(404).json({ success: false, message: "Saved view not found" });
    res.json({ success: true, view: { id: String(view._id), name: view.name, page: view.page, filters: view.filters, createdAt: view.createdAt } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const deleted = await SavedView.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ success: false, message: "Saved view not found" });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
