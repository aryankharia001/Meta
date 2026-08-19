import mongoose from "mongoose";

// ─────────────────────────────────────────────────────────────
// Phase 25 §5 — the configurable abandoned-cart delivery/success
// percentage + the four per-order cost lines (manufacturing/packaging/
// shipping/misc), now GLOBAL settings rather than typed in per daily
// record (that was Phase 22's AbandonedCart.deliveryRate/*Cost, one
// value per date — removed along with the rest of manual daily entry,
// §6). Same singleton pattern as ProfitSettings.js (Phase 16 §18):
// exactly one document ever exists, found/created via
// getOrCreateAbandonedCartSettings() below — never instantiate this
// model with `new` directly from route code.
//
// Genuinely backend-persisted (shared across every browser/user), same
// reasoning as ProfitSettings: a delivery rate assumption used to turn
// real abandoned-cart orders into recognized revenue/expenses has to be
// the same number everywhere it's read (management page's summary AND
// Dashboard's Abandoned Cart card), not a per-browser localStorage
// value.
// ─────────────────────────────────────────────────────────────

const abandonedCartSettingsSchema = new mongoose.Schema(
  {
    // Percentage, e.g. 70 means "70% of abandoned-cart orders are
    // expected to convert into a real, delivered order" — §5's own
    // example (100 carts × ₹500 @ 70% -> ₹35,000 recognized revenue).
    deliveryRate: { type: Number, default: 70, min: 0, max: 100 },
    // Per (expected-delivered) order, same semantics as the old
    // per-record cost fields — see routes/abandonedCarts.js's
    // computeSummary() for how these combine with deliveryRate.
    manufacturingCost: { type: Number, default: 0, min: 0 },
    packagingCost: { type: Number, default: 0, min: 0 },
    shippingCost: { type: Number, default: 0, min: 0 },
    miscCost: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

const AbandonedCartSettings =
  mongoose.models.AbandonedCartSettings || mongoose.model("AbandonedCartSettings", abandonedCartSettingsSchema);

export async function getOrCreateAbandonedCartSettings() {
  let doc = await AbandonedCartSettings.findOne({});
  if (!doc) {
    doc = await AbandonedCartSettings.create({});
  }
  return doc;
}

export default AbandonedCartSettings;
