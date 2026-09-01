import mongoose from "mongoose";

// ─────────────────────────────────────────────────────────────
// Campaign History Phase — Campaign Name History. Meta Campaign ID is
// the permanent identity of a campaign (see campaignIdentity.js); this
// collection is the append-only log of every name that ID has ever been
// observed under, written from the exact same single reconciliation
// path Phase 27/39 already established (services/metaEntitySync.js's
// reconcileEntity()) — never speculatively, only when a real name
// change is detected against the last known MetaEntityState.name.
//
// One row per confirmed rename. Never overwritten, never deleted by
// anything in this app. previousNameNormalized/newNameNormalized use
// the same normalizeCampaignName() every matching call site already
// uses (trim/lowercase/collapse-whitespace) so this collection can
// double as one of the lookup sources the order-matching resolver
// (campaignIdentity.js) consults — "automatically saved historical
// campaign names" per the spec.
//
// Keyed on the real Meta campaign_id (+accountId/tokenId), never on
// name — same "use stable IDs" convention BudgetHistory/BidCapHistory/
// CampaignStatusHistory already established.
// ─────────────────────────────────────────────────────────────

const campaignNameHistorySchema = new mongoose.Schema(
  {
    tokenId: { type: mongoose.Schema.Types.ObjectId, ref: "Token", required: true, index: true },
    accountId: { type: String, trim: true, default: "", index: true },
    campaignId: { type: String, required: true, trim: true, index: true },

    previousName: { type: String, trim: true, default: "" },
    newName: { type: String, required: true, trim: true },
    previousNameNormalized: { type: String, trim: true, default: "", index: true },
    newNameNormalized: { type: String, required: true, trim: true, index: true },

    // Campaign renames in this app only ever come from a fresh Meta read
    // (this app has no "rename campaign" write action) — kept as an enum
    // for forward compatibility/consistency with the other history models
    // rather than hardcoding the value everywhere it's created.
    source: { type: String, enum: ["Meta Ads Manager", "System"], default: "Meta Ads Manager" },

    changedAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

campaignNameHistorySchema.index({ tokenId: 1, campaignId: 1, changedAt: -1 });
campaignNameHistorySchema.index({ tokenId: 1, newNameNormalized: 1 });
campaignNameHistorySchema.index({ tokenId: 1, previousNameNormalized: 1 });

export default mongoose.models.CampaignNameHistory || mongoose.model("CampaignNameHistory", campaignNameHistorySchema);
