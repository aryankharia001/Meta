import mongoose from "mongoose";

// Phase 7 — application activity timeline. Purely additive, write-once
// audit trail: dashboard refreshes, manual syncs, notes added/edited,
// saved views created, favorites added/removed, exports completed.
// Nothing reads this to make decisions anywhere else in the app — it's
// a one-way log for the Activity Log page.
const activityLogSchema = new mongoose.Schema(
  {
    type: { type: String, required: true, trim: true, index: true }, // "refresh" | "sync" | "note" | "saved_view" | "favorite" | "export"
    message: { type: String, required: true, trim: true },
    meta: { type: Object, default: {} },
  },
  { timestamps: true }
);

export default mongoose.models.ActivityLog || mongoose.model("ActivityLog", activityLogSchema);
