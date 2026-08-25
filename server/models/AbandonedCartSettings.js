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
    // DEPRECATED as of Phase 33, kept only so no historical data is
    // lost — was "% of abandoned-cart orders expected to convert into a
    // real, delivered order". Not read anywhere in revenue math.
    deliveryRate: { type: Number, default: 70, min: 0, max: 100 },

    // DEPRECATED as of Phase 34, kept only so no historical data is
    // lost. Phase 33's status-based recognition (Traflead lead `status`
    // in this list, optionally requiring shipment.status==="delivered")
    // has been replaced entirely: revenue recognition is now purely
    // "shipment.status === 'delivered'" (see trafleadSyncService.js's
    // isDeliveredLead()) attributed to the delivered date, with no
    // settings-configurable lead-status list and no manual percentage —
    // "Actual delivered shipments determine the revenue," per spec.
    recognizedLeadStatuses: {
      type: [String],
      default: ["confirmed"],
    },
    requireShipmentDelivered: { type: Boolean, default: true },

    // Per DELIVERED order (Phase 34 — previously per "recognized" order
    // under Phase 33's status-based rule; the formula itself — cost ×
    // count — is unchanged, only what counts as a countable order has
    // changed since, now driven by Phase 35's phone-matched shipment
    // status). See trafleadSyncService.js's computeAbandonedCartSummary().
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
