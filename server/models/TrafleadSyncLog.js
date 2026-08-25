import mongoose from "mongoose";

// Same shape/purpose as ShiprocketSyncLog — one document per IST
// calendar day the Traflead abandoned-cart sync has attempted, so a
// backfill can skip days already known "complete" and retry only
// "failed" ones. See services/trafleadSyncService.js.
const TrafleadSyncLogSchema = new mongoose.Schema(
  {
    date: { type: String, required: true, unique: true, index: true }, // YYYY-MM-DD, IST
    status: {
      type: String,
      enum: ["complete", "failed"],
      default: "complete",
    },
    leadCount: { type: Number, default: 0 },
    offerMatched: { type: String, default: "" }, // the offerName Traflead returned that we matched as "Abandoned Cart"
    error: { type: String, default: "" },
    lastAttemptAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

const TrafleadSyncLog =
  mongoose.models?.TrafleadSyncLog || mongoose.model("TrafleadSyncLog", TrafleadSyncLogSchema);

export default TrafleadSyncLog;
