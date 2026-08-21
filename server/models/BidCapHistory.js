import mongoose from "mongoose";

// ─────────────────────────────────────────────────────────────
// Phase 27 §4/§14 — Bid Cap change history. Same shape/rules as
// BudgetHistory.js (see that file's header) but for bid_amount.
//
// entityType will in practice always be "adset" — Meta's Graph API only
// exposes an editable bid cap at the ad set level (see Phase 27 plan's
// "Bid Cap scoping" note), but the field is kept generic in case a
// campaign-level equivalent ever becomes available.
// ─────────────────────────────────────────────────────────────

const bidCapHistorySchema = new mongoose.Schema(
  {
    tokenId: { type: mongoose.Schema.Types.ObjectId, ref: "Token", required: true, index: true },
    accountId: { type: String, trim: true, default: "", index: true },
    entityType: { type: String, enum: ["campaign", "adset"], required: true, index: true },
    entityId: { type: String, required: true, trim: true, index: true },
    entityName: { type: String, trim: true, default: "" },

    previousBidAmount: { type: Number, default: null },
    newBidAmount: { type: Number, default: null },
    changeAmount: { type: Number, default: null },
    changePercent: { type: Number, default: null },
    bidStrategy: { type: String, trim: true, default: "" },

    source: { type: String, enum: ["App", "Meta Ads Manager"], required: true },
    changedBy: { type: String, trim: true, default: "" },
    changedAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

bidCapHistorySchema.index({ entityType: 1, entityId: 1, changedAt: -1 });
bidCapHistorySchema.index({ accountId: 1, changedAt: -1 });

export default mongoose.models.BidCapHistory || mongoose.model("BidCapHistory", bidCapHistorySchema);
