import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ShoppingBag, ExternalLink, AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import { fetchAbandonedCarts } from "../lib/api";
import { currency, number } from "../lib/format";
import DeliveredRevenuePopup from "./DeliveredRevenuePopup";

// ─────────────────────────────────────────────────────────────
// Phase 33 — "wire the synced Traflead Abandoned Cart dataset through
// every downstream Meta surface (Dashboard, Daily, Analytics,
// Profitability, Campaign Explorer)." Dashboard.jsx already has its own
// bespoke, fuller "Complete Cost Breakdown" section wired straight into
// its own Pure Profit math (Phase 25/32) — this component is the SAME
// underlying data source (GET /api/abandoned-carts, i.e. the exact same
// synced TrafleadAbandonedCartLead records) surfaced as a small,
// self-contained, additive card for every page it's embedded on
// (Dashboard, Daily, Analytics, Profitability, Campaign Explorer), none
// of which have (or, per this app's "zero coupling between phases"
// convention, should gain) their own copy of that math. Every page
// embedding this card is reading the literal same dataset Dashboard and
// the Abandoned Carts management page read — never a separate
// computation.
//
// Deliberately does NOT touch Shiprocket-order revenue/profit
// totals on the page it's embedded in — it's an entirely separate,
// side-by-side figure, exactly like Dashboard keeps its own Abandoned
// Cart section additive to (not blended into) its Shiprocket-order
// "Gross Revenue" — so nothing about Meta<->Shiprocket sync, campaign/
// order matching, or existing profitability logic is touched by adding
// this card to a page.
//
// Phase 34 — revenue was shipment-delivered-date based.
//
// Phase 35 — revenue source changed AGAIN: orders are matched to a
// shipment by PHONE NUMBER (not date-filtered), and revenue is
// recognized against the SELECTED date range — never moved to a
// delivery date.
//
// Phase 36 §2/§3 — "Confirmed Revenue" is the spec's own name for the
// figure Phase 35 computed (deliveredRevenue) — relabeled, not recomputed.
//
// Phase 37 — Abandoned Cart CNF-Based Revenue. Revenue recognition moves
// OFF shipment-delivery status and onto the lead's own Traflead `status`
// reaching "confirmed" ("CNF" — the spec's own shorthand; there is no
// literal "CNF" value in Traflead's data, see trafleadSyncService.js's
// isCnfLead()) combined with a manual, settings-configurable percentage
// (CNF Revenue Rate) of how many of those confirmed leads to count as
// revenue-eligible. "Confirmed Revenue" now literally means that — CNF
// Leads × CNF Revenue Rate, using the same average-order-value structure
// the old delivered-revenue figure used — computeAbandonedCartSummary
// exposes it under the same field name (summary.confirmedRevenue) so this
// component (and everywhere else that reads it) picks it up with no
// separate calculation added here. The primary stat grid below now shows
// the full CNF chain explicitly (spec's §5 "do not hide this calculation
// inside the Gross Profit number"); the shipment-matching/delivery figures
// Phase 34/35/36 §1 built are kept, informational only, in their own
// clearly separate row — they still verify real shipment status, they
// just no longer drive revenue on their own.
// ─────────────────────────────────────────────────────────────

export default function AbandonedCartSummaryCard({ since, until, className = "" }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [drilldownOpen, setDrilldownOpen] = useState(false);
  const [breakdownOpen, setBreakdownOpen] = useState(false);

  useEffect(() => {
    if (!since || !until) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    fetchAbandonedCarts({ since, until })
      .then((res) => !cancelled && setData(res))
      .catch((err) => !cancelled && setError(err.message || "Failed to load abandoned cart data"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [since, until]);

  const summary = data?.summary;

  return (
    <div className={`card flex flex-col gap-2.5 ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
          <ShoppingBag size={13} className="text-rose-500" />
          Abandoned Cart (synced from Traflead)
        </div>
        <Link
          to={`/abandoned-carts?since=${since}&until=${until}`}
          className="text-[11px] text-indigo-600 hover:underline flex items-center gap-1"
        >
          View <ExternalLink size={10} />
        </Link>
      </div>

      {loading ? (
        <div className="h-10 animate-pulse bg-slate-100 rounded-lg" />
      ) : error ? (
        <div className="flex items-center gap-1.5 text-[11px] text-rose-600">
          <AlertTriangle size={11} /> {error}
        </div>
      ) : summary ? (
        <>
          {/* Phase 37 — CNF-based revenue, the primary figures. */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-2 text-xs">
            <Stat label="Total Abandoned Cart Orders" sub="placed this period" value={number(summary.totalOrders ?? summary.orders)} />
            <Stat label="CNF / Confirmed Leads" sub="status = confirmed" value={number(summary.cnfLeadsCount)} />
            <Stat label="CNF Revenue Rate" sub="configurable" value={`${number(summary.cnfRevenueRate)}%`} />
            <Stat label="Revenue Counted" sub="CNF × rate" value={number(summary.cnfRevenueCountedCount)} />
            <Stat label="Confirmed Revenue" sub="CNF-based" value={currency(summary.confirmedRevenue ?? summary.cnfRevenue)} strong />
            <Stat label="Abandoned Cart Profit" sub="revenue − expenses" value={currency(summary.profit)} strong />
          </div>
          <div className="text-[10px] text-slate-400 italic -mt-1">
            Revenue calculated from CNF leads × selected CNF revenue rate.
          </div>

          {/* Phase 34/35/36 §1 — shipment verification, informational only
              as of Phase 37 (kept, no longer a revenue driver). */}
          <div className="rounded-lg border border-slate-100 bg-slate-50/50 p-2.5">
            <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">
              Shipment verification (informational — doesn't affect revenue)
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1.5 text-xs">
              <Stat label="Shipment Matched" sub="phone found a shipment" value={number(summary.matched)} muted />
              <Stat label="Delivered" sub="shipment confirmed delivered" value={number(summary.deliveredOrders ?? summary.deliveredCount)} muted />
              <Stat label="Not Delivered" sub="matched, not yet" value={number(summary.notDeliveredMatched)} muted />
              <Stat label="Awaiting Verification" sub="shipment lookup not run yet" value={number(summary.pendingVerification)} muted />
              <Stat
                label="Delivered Revenue"
                sub="shipment-based, info only"
                value={currency(summary.deliveredRevenue)}
                onClick={() => setDrilldownOpen(true)}
                muted
              />
            </div>
          </div>

          <button
            type="button"
            onClick={() => setBreakdownOpen((o) => !o)}
            className="flex items-center justify-between text-[11px] font-medium text-slate-500 hover:text-slate-700 pt-0.5"
          >
            <span>Cost breakdown</span>
            {breakdownOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>

          {breakdownOpen && (
            <div className="rounded-lg border border-slate-100 bg-slate-50/70 p-3 text-xs space-y-1">
              <BreakdownRow label="CNF / Confirmed Leads" value={number(summary.cnfLeadsCount)} />
              <BreakdownRow label="CNF Revenue Rate" value={`${number(summary.cnfRevenueRate)}%`} />
              <BreakdownRow label="Revenue Counted (CNF × Rate)" value={number(summary.cnfRevenueCountedCount)} />
              <BreakdownRow label="Confirmed Revenue" value={currency(summary.confirmedRevenue ?? summary.cnfRevenue)} strong />
              <div className="border-t border-slate-200 my-1.5" />
              <BreakdownRow label="Manufacturing" value={currency(summary.manufacturingExpense)} negative />
              <BreakdownRow label="Packaging" value={currency(summary.packagingExpense)} negative />
              <BreakdownRow label="Shipping" value={currency(summary.shippingExpense)} negative />
              <BreakdownRow label="Miscellaneous" value={currency(summary.miscExpense)} negative />
              <div className="border-t border-slate-200 my-1.5" />
              <BreakdownRow label="Total Expenses" value={currency(summary.totalExpenses)} negative />
              <div className="border-t border-slate-200 my-1.5" />
              <BreakdownRow label="Abandoned Cart Profit" value={currency(summary.profit)} strong highlight />
              <div className="text-[10px] text-slate-400 pt-1">
                Manufacturing/Packaging/Shipping/Misc are per-order costs set on the Abandoned Carts page's Settings panel —
                editable there, applied to the {number(summary.cnfRevenueCountedCount)} Revenue-Counted CNF order
                {summary.cnfRevenueCountedCount === 1 ? "" : "s"} in this period (CNF Leads × CNF Revenue Rate), not the raw
                order or CNF lead count.
              </div>
            </div>
          )}

          <div className="text-[10px] text-slate-400">
            CNF Leads: {number(summary.cnfLeadsCount)} out of {number(summary.totalOrders ?? summary.orders)} total orders in this
            period had a Traflead status of "confirmed." The CNF Revenue Rate is a manual assumption — it changes how much
            revenue is counted, never the actual order or CNF lead counts.
          </div>
          <DeliveredRevenuePopup
            open={drilldownOpen}
            since={since}
            until={until}
            leads={data?.deliveredLeads || []}
            truncated={data?.deliveredLeadsTruncated}
            onClose={() => setDrilldownOpen(false)}
          />
        </>
      ) : (
        <div className="text-[11px] text-slate-400">No data</div>
      )}
    </div>
  );
}

function Stat({ label, value, sub, strong, muted, onClick }) {
  const content = (
    <>
      <div className="text-slate-400 text-[11px]">{label}</div>
      <div className={`truncate ${strong ? "font-semibold text-slate-800" : muted ? "text-slate-500 font-medium" : "text-slate-700 font-medium"}`}>
        {value} {sub && <span className="text-slate-400 font-normal">({sub})</span>}
      </div>
    </>
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className="min-w-0 text-left hover:opacity-80">
        {content}
      </button>
    );
  }
  return <div className="min-w-0">{content}</div>;
}

// Phase 36 §3 — a single line of the Confirmed Revenue → expenses →
// Abandoned Cart Profit breakdown. `negative` prefixes a minus sign
// (expenses are always shown as a deduction, never a bare positive
// number); `highlight` marks the final Abandoned Cart Profit line.
function BreakdownRow({ label, value, strong, negative, highlight }) {
  return (
    <div className={`flex items-center justify-between ${highlight ? "text-emerald-700" : "text-slate-600"}`}>
      <span className={strong ? "font-semibold" : ""}>{label}</span>
      <span className={`font-mono tabular-nums ${strong ? "font-semibold" : ""}`}>
        {negative ? "− " : ""}
        {value}
      </span>
    </div>
  );
}
