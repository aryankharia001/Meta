import mongoose from "mongoose";

// ─────────────────────────────────────────────────────────────
// Phase 33 — Exact Traflead Abandoned Cart Data Sync.
//
// One document per Traflead Lead belonging to the "Abandoned Cart" Offer
// in Traflead (trafleadcrm, a separate CRM project — see
// services/trafleadSyncService.js's header comment for the full API
// contract this mirrors). This REPLACES AbandonedCartOrder as the
// source Meta's Abandoned Cart surfaces read from — see
// routes/abandonedCarts.js.
//
// `trafleadLeadId` (Traflead's own Mongo _id for the Lead document) is
// the upsert key — this is the "upsert-not-duplicate keyed on Traflead's
// stable Lead ID" requirement. Every other field is a 1:1 mirror of
// Traflead's own Lead field, using Traflead's own field names and
// Traflead's own literal values — status in particular is stored exactly
// as Traflead has it (processing/approved/cancelled/hold/trash/confirmed
// for `status`, and whatever `shipment.status` Traflead's shipment
// sub-document holds, e.g. "delivered"), never renamed or transformed.
//
// AbandonedCartOrder (Phase 25's model) is left untouched and still
// written to by the existing /abandon-cart-postback webhook (a separate,
// unrelated data source — see that route file's header comment) — this
// is an entirely new, additive collection alongside it, not a
// replacement of that model or its postback route.
// ─────────────────────────────────────────────────────────────

const trafleadAbandonedCartLeadSchema = new mongoose.Schema(
  {
    // ── Identity (upsert key) ──
    trafleadLeadId: { type: String, required: true, unique: true, trim: true, index: true },

    // ── Order / lead identifiers (Traflead's own names) ──
    orderId: { type: String, trim: true, default: "", index: true },
    externalOrderId: { type: String, trim: true, default: "", index: true },
    subOrderId: { type: String, trim: true, default: "" },

    // ── Offer ──
    offerId: { type: String, trim: true, default: "", index: true },
    offerName: { type: String, trim: true, default: "" },

    // ── Status — literal Traflead values, source of truth. Never
    // renamed/transformed. Traflead's LEAD_STATUSES enum is
    // processing|approved|cancelled|hold|trash|confirmed — there is no
    // "delivered" lead status in Traflead; "delivered" only exists as
    // shipment.status below. ──
    status: { type: String, trim: true, default: "", index: true },
    previousStatus: { type: String, trim: true, default: "" },
    lastStatusChange: { type: Date },

    // ── Shipment (subset relevant to delivery-based revenue
    // recognition — mirrors Traflead's Lead.shipment sub-document) ──
    shipmentStatus: { type: String, trim: true, default: "", index: true },
    shipmentDeliveredAt: { type: Date },
    // Phase 34 — IST calendar-day string derived from shipmentDeliveredAt
    // (same convention as orderDateIst below). This is a SEPARATE date
    // axis from orderDateIst/orderDate — a lead ordered on one day and
    // delivered on another keeps both, neither ever overwrites the
    // other. null until shipmentStatus reaches "delivered". Every
    // delivered-date-based revenue read in trafleadSyncService.js
    // filters on this field.
    deliveredDateIst: { type: String, trim: true, default: null, index: true },
    shipmentAwbNumber: { type: String, trim: true, default: "" },
    shipmentCourierName: { type: String, trim: true, default: "" },

    // ── Phase 35 — Abandoned Cart Revenue From Phone-Based Shipment
    // Matching. Completely separate from the shipment* fields above
    // (which mirror THIS SAME Traflead Lead's own embedded shipment
    // sub-doc, Phase 34's source). These `matched*` fields instead hold
    // the result of searching Traflead's full Lead universe by this
    // record's own phone number (see trafleadSyncService.js's
    // searchTrafleadLeadsByPhone/pickBestShipmentMatch/
    // resolveShipmentMatchForLead) — the customer's abandoned-cart
    // request can end up delivered on a DIFFERENT Traflead Lead document
    // (e.g. Traflead's own RTO re-lead flow), so the phone is the bridge
    // between "the order we counted for revenue purposes" (this
    // document, found via orderDateIst — untouched) and "the shipment
    // that tells us whether it was actually delivered" (found via
    // phone). Never overwrites the shipment* fields above; both are kept
    // side by side so either can be inspected independently.
    matchedShipmentFound: { type: Boolean, default: false, index: true },
    matchedShipmentStatus: { type: String, trim: true, default: "", index: true },
    matchedOrderId: { type: String, trim: true, default: "" },
    matchedAwbNumber: { type: String, trim: true, default: "" },
    matchedCourierName: { type: String, trim: true, default: "" },
    // Informational only — Phase 35 explicitly attributes revenue to the
    // SELECTED date range (this lead's own orderDateIst), never to the
    // matched shipment's delivery date. Kept only so the drill-down can
    // show it for the user's own verification.
    matchedDeliveredAt: { type: Date, default: null },
    // How the match was resolved — "order_id" (strongest: this lead's
    // own orderId/externalOrderId exactly matched a shipped candidate's
    // orderId), "phone" (phone-only, picked the most recently updated
    // AWB-bearing candidate when several shared the phone), "not_found"
    // (no shipped Traflead lead shares this phone), "invalid_phone" (the
    // stored phone doesn't normalize to a full 10-digit Indian number,
    // so no lookup was even attempted — never guesses on partial data).
    matchMethod: { type: String, trim: true, default: "not_found", index: true },
    // How many distinct AWB-bearing (i.e. actually shipped) candidates
    // shared this phone number — shown in the drill-down so an
    // ambiguous match (>1) is visibly flagged rather than silently
    // resolved.
    matchedCandidateCount: { type: Number, default: 0 },
    // Last time the phone-based lookup ran for this record (null =
    // never attempted yet). Drives resolveShipmentMatchForLead's
    // oldest-checked-first batch selection — see
    // runShipmentPhoneMatchBatch's header comment for why this is a
    // periodic background sync rather than a live per-page-load call.
    shipmentLookupCheckedAt: { type: Date, default: null, index: true },
    shipmentLookupError: { type: String, trim: true, default: "" },

    // ── Customer ──
    fullName: { type: String, trim: true, default: "" },
    phone: { type: String, trim: true, default: "", index: true },
    alternatePhone: { type: String, trim: true, default: "" },
    email: { type: String, trim: true, default: "" },

    // ── Product / amount ──
    productName: { type: String, trim: true, default: "" },
    quantity: { type: Number, default: 0 },
    price: { type: Number, default: 0 },
    total: { type: Number, default: 0 }, // "Amount"
    currency: { type: String, trim: true, default: "" },
    paymentMode: { type: String, trim: true, default: "" },

    // ── Address ──
    address: { type: String, trim: true, default: "" },
    address2: { type: String, trim: true, default: "" },
    city: { type: String, trim: true, default: "" },
    state: { type: String, trim: true, default: "" },
    district: { type: String, trim: true, default: "" },
    pinCode: { type: String, trim: true, default: "" },
    country: { type: String, trim: true, default: "" },
    landmark: { type: String, trim: true, default: "" },
    nearBy: { type: String, trim: true, default: "" },
    area: { type: String, trim: true, default: "" },
    postOffice: { type: String, trim: true, default: "" },

    // ── Dates/times — orderDate mirrors Traflead's Lead.orderDate
    // (≈ Traflead's createdAt at write time — see the sync service's
    // header comment for why those two are always effectively equal in
    // Traflead's own code). orderDateIst is the IST calendar-day string
    // ("YYYY-MM-DD") derived from trafleadCreatedAt via
    // utils/dateIst.js's toIstDateString(), used for all range filtering
    // here — same lexicographic-range convention every other date field
    // in this app already uses. trafleadCreatedAt/trafleadUpdatedAt are
    // Traflead's own Lead.createdAt/updatedAt (Mongoose timestamps on
    // the TRAFLEAD side) — kept under a `traflead`-prefixed name so they
    // are never confused with this document's OWN createdAt/updatedAt
    // (this collection's Mongoose timestamps, i.e. when Meta last synced
    // this record). ──
    orderDate: { type: Date },
    orderDateIst: { type: String, trim: true, index: true }, // YYYY-MM-DD, IST
    trafleadCreatedAt: { type: Date, index: true },
    trafleadUpdatedAt: { type: Date },

    // ── Attribution — Traflead's own fields, as-is. Traflead has no
    // dedicated "Ad Set"/"Ad ID" fields (confirmed by reading its Lead
    // schema, Joi validation schema, and its own frontend column labels
    // — client/src/components/leads/LeadList.jsx literally labels sub1
    // "Sub1", not "Ad Set"); campaign/medium/webmaster/affiliateId/
    // leadSource/sub1-5 are the full set of attribution fields Traflead
    // has, and are mirrored here under Traflead's own names rather than
    // relabeled into fields Traflead doesn't actually have. ──
    orderSource: { type: String, trim: true, default: "" },
    webmaster: { type: String, trim: true, default: "", index: true },
    externalWebmasterId: { type: String, trim: true, default: "" },
    affiliateId: { type: String, trim: true, default: "" },
    leadSource: { type: String, trim: true, default: "" },
    campaign: { type: String, trim: true, default: "", index: true },
    medium: { type: String, trim: true, default: "" },
    sub1: { type: String, trim: true, default: "" },
    sub2: { type: String, trim: true, default: "" },
    sub3: { type: String, trim: true, default: "" },
    sub4: { type: String, trim: true, default: "" },
    sub5: { type: String, trim: true, default: "" },
    additionalFields: { type: Object, default: {} },

    // ── Flags (mirrored as-is) ──
    isUrgent: { type: Boolean, default: false },
    isTestOrder: { type: Boolean, default: false },

    // ── Ops-local note — the ONE field this app is allowed to write
    // itself (never sent to/from Traflead, never overwritten by a
    // sync). Same purpose as the old AbandonedCartOrder.notes. ──
    notes: { type: String, trim: true, default: "" },

    // Full raw lead object exactly as Traflead's /api/leads-by-offer
    // returned it, untouched — so nothing this model parses out is ever
    // unrecoverable if a field mapping above turns out to need fixing.
    rawTraflead: { type: Object, default: {} },
  },
  { timestamps: true }
);

// Range queries filter by orderDateIst; drill-downs sort by trafleadCreatedAt.
trafleadAbandonedCartLeadSchema.index({ orderDateIst: 1, trafleadCreatedAt: -1 });
trafleadAbandonedCartLeadSchema.index({ status: 1, shipmentStatus: 1 });
trafleadAbandonedCartLeadSchema.index({ campaign: 1, sub1: 1 });
// Phase 35 — runShipmentPhoneMatchBatch's candidate-selection query:
// "not yet resolved to delivered, oldest-checked-first".
trafleadAbandonedCartLeadSchema.index({ matchedShipmentStatus: 1, shipmentLookupCheckedAt: 1 });

export default mongoose.models.TrafleadAbandonedCartLead ||
  mongoose.model("TrafleadAbandonedCartLead", trafleadAbandonedCartLeadSchema);
