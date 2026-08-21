import mongoose from "mongoose";

// ─────────────────────────────────────────────────────────────
// Phase 27 §3/§14 — Budget change history. One row per confirmed budget
// change, whichever direction it came from. A row is only ever created
// AFTER Meta confirms the new value (see services/metaEntitySync.js) —
// never speculatively, never for a rejected/failed App write (§12).
//
// Keyed on the real Meta campaign_id/adset_id (+accountId/tokenId), not
// on entity name, per the "use stable IDs" requirement (§14).
// ─────────────────────────────────────────────────────────────

const budgetHistorySchema = new mongoose.Schema(
  {
    tokenId: { type: mongoose.Schema.Types.ObjectId, ref: "Token", required: true, index: true },
    accountId: { type: String, trim: true, default: "", index: true },
    entityType: { type: String, enum: ["campaign", "adset"], required: true, index: true },
    entityId: { type: String, required: true, trim: true, index: true },
    entityName: { type: String, trim: true, default: "" },

    previousBudget: { type: Number, default: null },
    newBudget: { type: Number, default: null },
    changeAmount: { type: Number, default: null },
    changePercent: { type: Number, default: null },
    budgetType: { type: String, enum: ["daily", "lifetime", null], default: null },

    source: { type: String, enum: ["App", "Meta Ads Manager"], required: true },
    changedBy: { type: String, trim: true, default: "" }, // user email when source = App
    changedAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

budgetHistorySchema.index({ entityType: 1, entityId: 1, changedAt: -1 });
budgetHistorySchema.index({ accountId: 1, changedAt: -1 });

export default mongoose.models.BudgetHistory || mongoose.model("BudgetHistory", budgetHistorySchema);
