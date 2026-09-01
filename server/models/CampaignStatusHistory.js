import mongoose from "mongoose";

// ─────────────────────────────────────────────────────────────
// Phase 39 §1/§2 — Campaign Activity History. Same shape/convention as
// BudgetHistory.js/BidCapHistory.js (see those files' headers) but for
// the campaign's *status* (Active/Paused/Closed), which until now was
// only ever logged as a generic, unstructured ActivityLog row
// (type: "campaign_status_changed") with no dedicated collection to
// reconstruct active/inactive periods from.
//
// One row per confirmed status transition, written from the exact same
// single reconciliation path Phase 27 already established
// (services/metaEntitySync.js's reconcileEntity()) — never speculatively,
// never for a status this app merely guessed at. The very first row for
// an entity is special: either a real Meta-sourced "created"/"activated"
// event (when Meta's own created_time/start_time are available and
// trustworthy) or an honest "tracking_started" row when they aren't —
// see campaignActivity.js's ensureBaseline(). Everything before that
// first row is unknown and must never be inferred (Phase 39 §14).
//
// entityType is kept generic (like BudgetHistory/BidCapHistory) even
// though Phase 39 only ever writes "campaign" rows today, for the same
// forward-compatibility reason those two files already state.
// ─────────────────────────────────────────────────────────────

const campaignStatusHistorySchema = new mongoose.Schema(
  {
    tokenId: { type: mongoose.Schema.Types.ObjectId, ref: "Token", required: true, index: true },
    accountId: { type: String, trim: true, default: "", index: true },
    entityType: { type: String, enum: ["campaign", "adset", "ad"], required: true, index: true },
    entityId: { type: String, required: true, trim: true, index: true },
    entityName: { type: String, trim: true, default: "" },

    // Raw Meta effective_status strings (e.g. "ACTIVE", "PAUSED",
    // "ARCHIVED") — never fabricated, always exactly what Meta reported.
    previousStatus: { type: String, trim: true, default: null },
    newStatus: { type: String, trim: true, default: null },

    // Normalized 3-bucket classification (see campaignActivity.js's
    // statusBucket()) — what every period-reconstruction/order-
    // attribution calculation in this phase actually keys off of,
    // since Meta's raw status vocabulary is wider than Active/Paused/
    // Closed.
    previousBucket: { type: String, enum: ["active", "paused", "closed", null], default: null },
    newBucket: { type: String, enum: ["active", "paused", "closed"], required: true },

    // created | activated | paused | resumed | closed | reactivated |
    // tracking_started — human-facing event label, derived from the
    // previousBucket -> newBucket transition (or the special first-row
    // cases) by activityTypeFor() in campaignActivity.js.
    activityType: {
      type: String,
      // Campaign History Phase — "no_longer_returned" added: written
      // when Meta stops returning this campaign entirely (see
      // MetaEntityState.js's isDeleted/noLongerReturnedAt header comment
      // for the two detection paths). Always paired with newBucket
      // "closed" (a campaign Meta no longer returns isn't delivering),
      // but distinct from a genuine Meta-reported ARCHIVED/DELETED
      // status ("closed") so the Activity Timeline can tell the two
      // apart. Purely additive enum value — every pre-existing value is
      // unchanged.
      enum: ["created", "activated", "paused", "resumed", "closed", "reactivated", "tracking_started", "no_longer_returned"],
      required: true,
    },

    source: { type: String, enum: ["App", "Meta Ads Manager", "System"], required: true },
    changedBy: { type: String, trim: true, default: "" }, // user email when source = App

    message: { type: String, trim: true, default: "" },

    changedAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

campaignStatusHistorySchema.index({ entityType: 1, entityId: 1, changedAt: -1 });
campaignStatusHistorySchema.index({ accountId: 1, changedAt: -1 });

export default mongoose.models.CampaignStatusHistory ||
  mongoose.model("CampaignStatusHistory", campaignStatusHistorySchema);
