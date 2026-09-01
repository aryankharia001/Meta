import mongoose from "mongoose";

// ─────────────────────────────────────────────────────────────
// Campaign History Phase — Manual Historical Campaign Name Mapping.
// User-managed, permanent association of an old/alternate campaign name
// with a Meta Campaign ID, stored in MongoDB (never localStorage) so it
// survives across sessions/devices — added from the Campaign Drill
// side window's "+ Add Historical Name" control (routes/campaignIdentity.js).
//
// One historical name resolves to exactly one campaign at a time: the
// unique index below is on {tokenId, normalizedName} alone (not
// including campaignId), so re-pointing a name that's already manually
// mapped elsewhere is an explicit reassignment (see the "force" flow in
// routes/campaignIdentity.js) rather than a second, ambiguous row.
// Deleting a mapping only ever removes this row — it must never cascade
// into CampaignNameHistory, ShiprocketOrder, or MetaEntityState.
//
// A manual mapping takes priority over automatic (current-name /
// CampaignNameHistory) matching in campaignIdentity.js's resolver — see
// that file's header for the full priority rule.
// ─────────────────────────────────────────────────────────────

const campaignNameMappingSchema = new mongoose.Schema(
  {
    tokenId: { type: mongoose.Schema.Types.ObjectId, ref: "Token", required: true, index: true },
    accountId: { type: String, trim: true, default: "", index: true },
    campaignId: { type: String, required: true, trim: true, index: true },

    historicalName: { type: String, required: true, trim: true },
    normalizedName: { type: String, required: true, trim: true, index: true },

    note: { type: String, trim: true, default: "" },
    createdBy: { type: String, trim: true, default: "" }, // user email
  },
  { timestamps: true }
);

// One manual mapping per name per token.
campaignNameMappingSchema.index({ tokenId: 1, normalizedName: 1 }, { unique: true });
campaignNameMappingSchema.index({ tokenId: 1, campaignId: 1 });

export default mongoose.models.CampaignNameMapping || mongoose.model("CampaignNameMapping", campaignNameMappingSchema);
