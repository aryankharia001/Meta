import mongoose from "mongoose";

// Phase 7 — favorited campaigns/orders/customers. Separate collection,
// same reasoning as OrderNote: purely additive, app-owned data, never
// touches ShiprocketOrder or any sync/matching path. `entityType` +
// `entityId` together identify the favorited thing — campaignId for
// campaigns, orderId for orders, phone number for customers (the same
// identifier Phase 4/6 already use as "the customer" throughout this
// app, since there's no separate Customer collection).
const favoriteSchema = new mongoose.Schema(
  {
    entityType: { type: String, required: true, enum: ["campaign", "order", "customer"], index: true },
    entityId: { type: String, required: true, trim: true, index: true },
    label: { type: String, trim: true, default: "" }, // display name, snapshotted at favorite-time
    meta: { type: Object, default: {} }, // small extra context (e.g. campaignName/accountId) for rendering without a re-fetch
  },
  { timestamps: true }
);

favoriteSchema.index({ entityType: 1, entityId: 1 }, { unique: true });

export default mongoose.models.Favorite || mongoose.model("Favorite", favoriteSchema);
