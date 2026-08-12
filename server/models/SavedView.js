import mongoose from "mongoose";

// Phase 7 — saved filter combinations ("Today's Performance", "COD
// Orders", ...). `page` scopes a view to where it applies (dashboard,
// analytics, ...) so switching a saved view only ever affects the page
// it was saved from. `filters` is a free-form snapshot of whatever
// filter state that page already manages client-side (date range,
// campaign, payment type, ...) — this collection doesn't need to know
// the shape, it just stores and returns it verbatim.
const savedViewSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    page: { type: String, required: true, trim: true, index: true }, // "dashboard" | "analytics" | ...
    filters: { type: Object, default: {} },
  },
  { timestamps: true }
);

export default mongoose.models.SavedView || mongoose.model("SavedView", savedViewSchema);
