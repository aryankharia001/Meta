import mongoose from "mongoose";

// Phase 4 — internal notes on an order, stored entirely in our own
// database. Deliberately a separate collection from ShiprocketOrder (not
// an embedded array on it) so nothing here ever touches that model, its
// schema, or the sync/upsert logic that writes to it — this is purely
// additive, app-owned data. Never synced to or read from Shiprocket.
// Phase 7 — `author` added as an optional field (existing notes just
// come back with author: null, unchanged from before) so order notes
// carry the same Author/Timestamp/Last-Edited shape the new campaign
// and customer notes (EntityNote, below in this phase) do, without
// touching anything about how existing order notes already work.
const orderNoteSchema = new mongoose.Schema(
  {
    orderId: { type: String, required: true, trim: true, index: true },
    text: { type: String, required: true, trim: true },
    author: { type: String, trim: true, default: null },
  },
  { timestamps: true }
);

export default mongoose.models.OrderNote || mongoose.model("OrderNote", orderNoteSchema);
