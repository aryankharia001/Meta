import mongoose from "mongoose";

// ─────────────────────────────────────────────────────────────
// Phase 27 — internal "last known from Meta" snapshot per campaign/ad
// set. Not shown to the user directly; this is the baseline the sync
// reconciler (services/metaEntitySync.js) diffs each fresh Meta read
// against to detect changes (whether made from the App or directly in
// Meta Ads Manager) and to know which entities the periodic cron should
// even bother polling (only entities that already have a row here —
// i.e. ones the app has actually shown a drawer for or synced once —
// rather than every campaign on the ad account).
//
// Purely additive, new collection. Never read by any pre-Phase-27 route.
// Keyed on the real Meta entity ID (never the name) plus tokenId, per
// the "use stable IDs" requirement.
// ─────────────────────────────────────────────────────────────

const metaEntityStateSchema = new mongoose.Schema(
  {
    tokenId: { type: mongoose.Schema.Types.ObjectId, ref: "Token", required: true, index: true },
    accountId: { type: String, trim: true, default: "", index: true },
    entityType: { type: String, enum: ["campaign", "adset"], required: true },
    entityId: { type: String, required: true, trim: true },
    name: { type: String, trim: true, default: "" },

    budget: { type: Number, default: null },
    budgetType: { type: String, enum: ["daily", "lifetime", null], default: null },

    bidAmount: { type: Number, default: null },
    bidStrategy: { type: String, trim: true, default: "" },

    status: { type: String, trim: true, default: "" },
    effectiveStatus: { type: String, trim: true, default: "" },

    lastSyncedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

metaEntityStateSchema.index({ tokenId: 1, entityType: 1, entityId: 1 }, { unique: true });

export default mongoose.models.MetaEntityState || mongoose.model("MetaEntityState", metaEntityStateSchema);
