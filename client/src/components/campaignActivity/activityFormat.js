import { formatBudget, formatBidCapAmount } from "../../lib/campaignDisplay";

// ─────────────────────────────────────────────────────────────────────
// Phase 44 — Campaign Activity History + Hourly ROAS. Small, local
// formatting helpers, deliberately separate from CampaignCells.jsx's
// BudgetCell/BidCapCell: those gate rendering on budgetSource/
// bidCapSource being exactly "campaign" or "adsets" (the real-time Meta
// fallback convention from Phase 36/38), while this feature's own
// report builder (campaignActivityReport.js) tags ad-set-level history
// rows with the source "adset" (singular) — a different but equally
// real provenance, not one of those two strings. Rather than stretch
// that existing enum to also cover this feature, these helpers just
// render the plain reconstructed value: null is always an em dash,
// never invented, exactly like every other convention in this app.
// ─────────────────────────────────────────────────────────────────────

export function budgetText(budget, budgetType) {
  return formatBudget(budget, budgetType) || "—";
}

// Accepts either a {bidCapMin, bidCapMax} pair (campaign-level rows,
// which can be a genuine min–max range across several Ad Sets) or a
// single flat `bidCap` value (Ad Set/Ad child rows, which only ever
// carry one number) — callers pass whichever shape their row has.
export function bidCapRangeText(min, max) {
  if (min === null || min === undefined) return "—";
  if (max === null || max === undefined || max === min) return formatBidCapAmount(min);
  return `${formatBidCapAmount(min)}–${formatBidCapAmount(max)}`;
}

export function bidCapTextForRow(row) {
  if (!row) return "—";
  if (row.bidCapMin !== undefined) return bidCapRangeText(row.bidCapMin, row.bidCapMax);
  return row.bidCap === null || row.bidCap === undefined ? "—" : formatBidCapAmount(row.bidCap);
}

export function hourRangeLabel(hour) {
  const h = String(hour).padStart(2, "0");
  return `${h}:00–${h}:59`;
}

// Generic ascending/descending sort over a flat array of plain-object
// rows — shared by every table in this feature so each one doesn't
// hand-roll its own comparator. String-valued sort keys compare
// case-insensitively; everything else compares numerically.
export function sortRows(rows, key, direction) {
  // Defensive: a caller mid-transition between two views (or a backend
  // response missing its expected array field) can pass undefined/null
  // here — fall back to an empty list instead of throwing "is not
  // iterable" and blanking the whole page.
  const list = Array.isArray(rows) ? [...rows] : [];
  list.sort((a, b) => {
    let x = a[key];
    let y = b[key];
    if (typeof x === "string" || typeof y === "string") {
      x = (x ?? "").toString().toLowerCase();
      y = (y ?? "").toString().toLowerCase();
      if (x < y) return direction === "asc" ? -1 : 1;
      if (x > y) return direction === "asc" ? 1 : -1;
      return 0;
    }
    x = Number(x || 0);
    y = Number(y || 0);
    return direction === "asc" ? x - y : y - x;
  });
  return list;
}
