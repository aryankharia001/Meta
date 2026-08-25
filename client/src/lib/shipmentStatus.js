// Phase 34 — client-side mirror of server/services/trafleadSyncService.js's
// bucketShipmentStatus()/SHIPMENT_STATUS_BUCKET_MAP. Kept as a single
// shared module so every page that displays a shipment status bucket
// (Dashboard, AbandonedCartsPage, AbandonedCartSummaryCard,
// AbandonedCartDailyTable, the Delivered Revenue drill-down) buckets it
// identically — never a second, slightly-different copy of this map.
// The literal status strings themselves come straight from Traflead
// (see the server file's header comment for where they were confirmed)
// and are shown verbatim; bucketing is purely a display grouping.

const BUCKET_MAP = {
  delivered: "delivered",

  cancelled: "cancelled",
  reverse_cancelled: "cancelled",

  rto_initiated: "returned",
  rto_in_transit: "returned",
  rto_out_for_delivery: "returned",
  rto_failed: "returned",
  rto_delivered: "returned",
  rto_shortage: "returned",
  reverse_delivered: "returned",
  reverse_closed: "returned",

  pending_pickup: "pending",
  picked_up: "pending",
  in_transit: "pending",
  out_for_delivery: "pending",
  delivery_failed: "pending",
  delayed: "pending",
  reverse_pending: "pending",
  reverse_out_for_pickup: "pending",
  reverse_picked_up: "pending",
  reverse_in_transit: "pending",
  reverse_out_for_delivery: "pending",
  "": "pending",
};

export function bucketShipmentStatus(status) {
  const s = String(status || "").toLowerCase();
  return BUCKET_MAP[s] || "other";
}

export const BUCKET_LABELS = {
  delivered: "Delivered",
  pending: "Pending",
  cancelled: "Cancelled",
  returned: "Returned",
  other: "Other",
  // Phase 36 §1 — this order's phone-based shipment lookup hasn't run
  // yet (shipmentLookupCheckedAt is still null). Distinct from "pending"
  // (a real, checked-and-current Traflead shipment status) — see
  // shipmentStatusDisplay()/shipmentStatusBadgeTone() below.
  verifying: "Verifying…",
  // A lookup genuinely ran and found no shipped Traflead lead sharing
  // this phone at all — distinct from both "pending" (a real shipment
  // that just hasn't moved yet) and "verifying" (no lookup ran yet).
  not_found: "Not Found",
};

export const BUCKET_STYLES = {
  delivered: "bg-emerald-50 text-emerald-700 border-emerald-200",
  pending: "bg-amber-50 text-amber-700 border-amber-200",
  cancelled: "bg-slate-100 text-slate-500 border-slate-200",
  returned: "bg-orange-50 text-orange-700 border-orange-200",
  other: "bg-rose-50 text-rose-600 border-rose-200",
  verifying: "bg-blue-50 text-blue-600 border-blue-200",
  not_found: "bg-slate-100 text-slate-500 border-slate-200",
};

// Humanizes a literal Traflead shipment.status ("out_for_delivery") for
// display when no shipment exists yet, shows a friendly placeholder.
export function shipmentStatusLabel(status) {
  if (!status) return "No shipment yet";
  return String(status)
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// Phase 35 — how a phone-based shipment match was resolved (or wasn't).
// See server/services/trafleadSyncService.js's pickBestShipmentMatch —
// "order_id" is the strongest (this order's own Order ID/External Order
// ID exactly matched a shipped candidate), "phone" is phone-only
// (ambiguous cases pick the most recently updated shipped lead —
// matchedCandidateCount shows how many candidates existed), "not_found"
// means no shipped Traflead lead shares this phone at all, and
// "invalid_phone" means the stored phone never reduced to a full
// 10-digit number so no lookup was even attempted.
export const MATCH_METHOD_LABELS = {
  order_id: "Matched by Order ID",
  phone: "Matched by Phone",
  not_found: "Not Found",
  invalid_phone: "Invalid Phone",
  // Phase 36 §1 — see BUCKET_LABELS.verifying above; this record's phone
  // lookup simply hasn't run yet, so there's no real match method at all
  // to report — never shown as "Not Found" (which implies a check
  // actually happened and came up empty).
  pending: "Verifying…",
};

export const MATCH_METHOD_STYLES = {
  order_id: "bg-emerald-50 text-emerald-700 border-emerald-200",
  phone: "bg-indigo-50 text-indigo-700 border-indigo-200",
  not_found: "bg-slate-100 text-slate-500 border-slate-200",
  invalid_phone: "bg-rose-50 text-rose-600 border-rose-200",
  pending: "bg-blue-50 text-blue-600 border-blue-200",
};

export function matchMethodLabel(method) {
  return MATCH_METHOD_LABELS[method] || "Not Found";
}

// ─────────────────────────────────────────────────────────────
// Phase 36 §1 — "verify that the Shipment details shown for each order
// are actually matching Traflead ... do not create a separate status
// interpretation that can differ from Traflead." These three helpers are
// the ONE place every surface (AbandonedCartsPage's table + drill-down
// modal, DeliveredRevenuePopup) reads a record's shipment
// status/match-method display from, so they can never drift apart. The
// one thing they add beyond Phase 35 is telling "verified, no shipment
// found" apart from "not verified yet" — both used to render identically
// (matchedShipmentFound: false, matchMethod: "not_found") because a
// never-checked record's DB defaults happen to look the same as a
// checked-and-empty one; shipmentLookupCheckedAt is what actually tells
// them apart. Everything else is shown exactly as Traflead's own literal
// matchedShipmentStatus string, humanized only for casing (see
// shipmentStatusLabel above) — never bucketed/renamed into a different
// word.
export function isVerificationPending(record) {
  return !record?.shipmentLookupCheckedAt;
}

// The match-method value to actually render — "pending" (not the stored
// matchMethod) whenever this record hasn't been checked yet.
export function effectiveMatchMethod(record) {
  return isVerificationPending(record) ? "pending" : record?.matchMethod || "not_found";
}

// The shipment status text to actually render for a record: Traflead's
// own literal current status when a shipment was found, "Not Found" only
// when a lookup genuinely ran and found nothing, or "Verifying…" when no
// lookup has run yet at all.
export function shipmentStatusDisplay(record) {
  if (isVerificationPending(record)) return "Verifying…";
  if (!record?.matchedShipmentFound) return "Not Found";
  return shipmentStatusLabel(record.matchedShipmentStatus);
}

// The BUCKET_STYLES/BUCKET_LABELS key to color the shipment status badge
// with — "verifying" (blue) while pending, else the normal literal-status
// bucket (delivered/pending/cancelled/returned/other).
export function shipmentStatusBadgeTone(record) {
  if (isVerificationPending(record)) return "verifying";
  if (!record?.matchedShipmentFound) return "not_found";
  return bucketShipmentStatus(record.matchedShipmentStatus);
}
