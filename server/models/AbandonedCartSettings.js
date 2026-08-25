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

    // DEPRECATED as of Phase 34 (Phase 33's status-based recognition,
    // optionally requiring shipment.status==="delivered", was replaced by
    // pure shipment-delivery recognition), then Phase 35/36 kept revenue
    // shipment-based throughout. Kept only so no historical data is lost
    // — NOT read by Phase 37's cnfRevenueRate below, which is its own
    // field with its own (simpler, single-status, percent-driven) logic
    // rather than a revival of this exact list+boolean shape.
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

    // Phase 37 — Abandoned Cart CNF-Based Revenue. A lead's Traflead
    // `status` reaching "confirmed" ("CNF" in the spec's own shorthand —
    // there is no literal "CNF" value anywhere in Traflead's data; the
    // LEAD_STATUSES enum is processing/approved/cancelled/hold/trash/
    // confirmed, see TrafleadAbandonedCartLead.js's header comment) is
    // the revenue signal now, NOT shipment-delivery status. This percent
    // is a manual, explicit ASSUMPTION of how many of those confirmed
    // leads should be counted as revenue-eligible — e.g. 40 confirmed
    // leads × 50% = 20 orders' worth of revenue counted. Global,
    // backend-persisted setting (same reasoning as the four cost fields
    // above): the same assumption must apply everywhere this is read
    // (Dashboard, Daily, Analytics, Profitability, Campaign Explorer, and
    // this page's own summary), never a per-browser value. Changing it
    // recalculates instantly on next fetch — nothing here is cached
    // beyond the settings document itself. See trafleadSyncService.js's
    // computeAbandonedCartSummary() for the full calculation.
    cnfRevenueRate: { type: Number, default: 50, min: 0, max: 100 },
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
