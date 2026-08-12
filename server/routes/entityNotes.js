import express from "express";
import EntityNote from "../models/EntityNote.js";

const router = express.Router();

// ─────────────────────────────────────────────────────────────
// Phase 7 — notes on campaigns and customers. Entirely new, additive
// route file (mounted at /api/entity-notes). Orders keep using the
// Phase 4 OrderNote collection/routes untouched — this is only for the
// two entity types that didn't have notes before.
// ─────────────────────────────────────────────────────────────

router.get("/:entityType/:entityId", async (req, res) => {
  try {
    const { entityType, entityId } = req.params;
    const notes = await EntityNote.find({ entityType, entityId }).sort({ createdAt: -1 }).lean();
    res.json({
      success: true,
      notes: notes.map((n) => ({ id: String(n._id), text: n.text, author: n.author || null, createdAt: n.createdAt, updatedAt: n.updatedAt })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/:entityType/:entityId", async (req, res) => {
  try {
    const { entityType, entityId } = req.params;
    const { text, author } = req.body || {};
    if (!text || !text.trim()) {
      return res.status(400).json({ success: false, message: "Note text is required" });
    }
    const note = await EntityNote.create({ entityType, entityId, text: text.trim(), author: author || null });
    res.json({ success: true, note: { id: String(note._id), text: note.text, author: note.author || null, createdAt: note.createdAt, updatedAt: note.updatedAt } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put("/notes/:noteId", async (req, res) => {
  try {
    const { text, author } = req.body || {};
    if (!text || !text.trim()) {
      return res.status(400).json({ success: false, message: "Note text is required" });
    }
    const update = { text: text.trim() };
    if (author !== undefined) update.author = author || null;
    const note = await EntityNote.findByIdAndUpdate(req.params.noteId, update, { new: true });
    if (!note) return res.status(404).json({ success: false, message: "Note not found" });
    res.json({ success: true, note: { id: String(note._id), text: note.text, author: note.author || null, createdAt: note.createdAt, updatedAt: note.updatedAt } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete("/notes/:noteId", async (req, res) => {
  try {
    const deleted = await EntityNote.findByIdAndDelete(req.params.noteId);
    if (!deleted) return res.status(404).json({ success: false, message: "Note not found" });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
