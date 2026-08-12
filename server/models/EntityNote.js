import mongoose from "mongoose";

// Phase 7 — notes on campaigns and customers (orders already have their
// own OrderNote collection from Phase 4, left untouched). Same
// entityType/entityId identification pattern as Favorite.js:
// campaignId for campaigns, phone number for customers.
const entityNoteSchema = new mongoose.Schema(
  {
    entityType: { type: String, required: true, enum: ["campaign", "customer"], index: true },
    entityId: { type: String, required: true, trim: true, index: true },
    text: { type: String, required: true, trim: true },
    author: { type: String, trim: true, default: null },
  },
  { timestamps: true }
);

export default mongoose.models.EntityNote || mongoose.model("EntityNote", entityNoteSchema);
