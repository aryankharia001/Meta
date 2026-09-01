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
    entityType: { type: String, enum: ["campaign", "adset", "ad"], required: true },
    entityId: { type: String, required: true, trim: true },
    name: { type: String, trim: true, default: "" },

    // Phase 44 — additive linkage fields, populated when known: an
    // ad set row's parent campaign id, and an ad row's parent ad set +
    // campaign id. Never required, never backfilled for pre-Phase-44
    // rows — used only for the Campaign Activity hourly hierarchy
    // (grouping an ad set/ad under its campaign) and the Campaign
    // Budget Fallback-at-an-hour calculation (summing a campaign's own
    // tracked ad sets' budget history when the campaign itself has no
    // direct budget). Absent/blank for pre-Phase-44 campaign rows.
    campaignId: { type: String, trim: true, default: "" },
    adsetId: { type: String, trim: true, default: "" },

    budget: { type: Number, default: null },
    budgetType: { type: String, enum: ["daily", "lifetime", null], default: null },

    bidAmount: { type: Number, default: null },
    bidStrategy: { type: String, trim: true, default: "" },

    status: { type: String, trim: true, default: "" },
    effectiveStatus: { type: String, trim: true, default: "" },

    lastSyncedAt: { type: Date, default: Date.now },

    // Campaign History Phase — deleted/no-longer-returned tracking.
    // isDeleted/noLongerReturnedAt are set when Meta stops returning this
    // entity (a direct-ID fetch fails with Meta's "object does not exist"
    // signal, or a bulk account-level campaign list no longer includes
    // it — see services/metaEntitySync.js's reconcileEntity() and
    // services/metaEntitySyncCron.js's runDeletedCampaignDetectionPass()).
    // The row itself, and every history collection keyed on this
    // entityId, is NEVER deleted when this flips true — only ever
    // flagged, per the "never destroy history" requirement. If the
    // entity reappears later, isDeleted/noLongerReturnedAt reset to
    // false/null (a reversible flag, not a tombstone).
    //
    // lastSeenAt is updated every time this entity is actually observed
    // (a successful per-ID reconcile, or present in a bulk list pass) —
    // distinct from lastSyncedAt above, which also updates on a
    // successful reconcile but is unrelated to the deleted-detection
    // bulk pass, which never fetches full entity details.
    isDeleted: { type: Boolean, default: false },
    noLongerReturnedAt: { type: Date, default: null },
    lastSeenAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

metaEntityStateSchema.index({ tokenId: 1, entityType: 1, entityId: 1 }, { unique: true });

export default mongoose.models.MetaEntityState || mongoose.model("MetaEntityState", metaEntityStateSchema);
