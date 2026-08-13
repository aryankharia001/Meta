import mongoose from "mongoose";

// Phase 7 — application activity timeline. Purely additive, write-once
// audit trail: dashboard refreshes, manual syncs, notes added/edited,
// saved views created, favorites added/removed, exports completed.
// Nothing reads this to make decisions anywhere else in the app — it's
// a one-way log for the Activity Log page.
//
// Phase 14 §6/§7 — extended with `user`/`entityType`/`entityId` so the
// completed Activity Log can show "who did what to which thing", and a
// wider `type` vocabulary (auth/meta/logistics/order/campaign/product/
// user actions). All three new fields are optional so every pre-Phase-14
// entry (which only ever set type/message/meta) still reads back fine —
// nothing about how existing callers write to this collection changes.
// SECURITY: never store passwords, API secrets, Meta access tokens, or
// logistics tokens in `message` or `meta` — see server/lib/activityLog.js.
const activityLogSchema = new mongoose.Schema(
  {
    type: { type: String, required: true, trim: true, index: true },
    message: { type: String, required: true, trim: true },
    meta: { type: Object, default: {} },
    // Display name / email of whoever performed the action. Free text
    // (not a ref) on purpose — keeps this collection readable even if a
    // user is later deleted, and keeps it decoupled from AuthUser.
    user: { type: String, trim: true, default: "", index: true },
    entityType: { type: String, trim: true, default: "", index: true }, // "order" | "campaign" | "token" | "logistics_token" | "user" | "product" | ...
    entityId: { type: String, trim: true, default: "", index: true },
  },
  { timestamps: true }
);

export default mongoose.models.ActivityLog || mongoose.model("ActivityLog", activityLogSchema);
