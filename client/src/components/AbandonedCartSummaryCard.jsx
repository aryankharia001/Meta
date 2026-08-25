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
// self-contained, additive card for the other four pages, which don't
// have (and per this app's "zero coupling between phases" convention,
// shouldn't gain) their own copy of that math. Every page embedding this
// card is reading the literal same dataset Dashboard and the Abandoned
// Carts management page read — never a separate computation.
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
// exact same figure Phase 35 already computes (deliveredRevenue: the sum
// of order prices whose phone-matched shipment currently reads
// Delivered) — relabeled here, not recomputed; computeAbandonedCartSummary
// also exposes it under this literal name (summary.confirmedRevenue) now.
// The stat grid also surfaces Non-Delivered Orders (everything that isn't
// counted as Confirmed Revenue — matched-not-delivered, not-yet-matched,
// AND not-yet-verified, all together) and Awaiting Verification (Phase 36
// §1 — orders whose phone lookup simply hasn't run yet), so "why isn't
// this order's revenue confirmed" is always answerable from this card
// alone. The cost breakdown below is collapsed by default (same
// "compact by default" principle Phase 36 §5 applies to Dashboard's Gross
// Profit) — expanding/collapsing is local component state, never a
// refetch.
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
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-2 text-xs">
            <Stat label="Total Abandoned Cart Orders" sub="placed this period" value={number(summary.totalOrders ?? summary.orders)} />
            <Stat label="Delivered Orders" sub="shipment confirmed delivered" value={number(summary.deliveredOrders ?? summary.deliveredCount)} />
            <Stat label="Non-Delivered Orders" sub="not counted as revenue" value={number(summary.nonDeliveredOrders)} />
            <Stat
              label="Confirmed Revenue"
              sub="delivered orders only"
              value={currency(summary.confirmedRevenue ?? summary.deliveredRevenue)}
              strong
              onClick={() => setDrilldownOpen(true)}
            />
            <Stat label="Shipment Matched" sub="phone found a shipment" value={number(summary.matched)} />
            <Stat label="Awaiting Verification" sub="shipment lookup not run yet" value={number(summary.pendingVerification)} />
            <Stat label="Abandoned Cart Profit" sub="revenue − expenses" value={currency(summary.profit)} strong />
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
              <BreakdownRow label="Confirmed Revenue" value={currency(summary.confirmedRevenue ?? summary.deliveredRevenue)} strong />
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
                Manufacturing/Packaging/Shipping/Misc are per-delivered-order costs set on the Abandoned Carts page's Settings
                panel — editable there, applied to all {number(summary.deliveredOrders ?? summary.deliveredCount)} delivered order
                {(summary.deliveredOrders ?? summary.deliveredCount) === 1 ? "" : "s"} in this period.
              </div>
            </div>
          )}

          <div className="text-[10px] text-slate-400">
            Revenue belongs to this period because the orders were placed in it — shipment status is looked up by phone number,
            independent of any delivery date. {number(summary.unmatched)} order{summary.unmatched === 1 ? "" : "s"} had no matching
            shipment found yet{summary.pendingVerification > 0 ? `, and ${number(summary.pendingVerification)} still awaiting a lookup` : ""}.
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

function Stat({ label, value, sub, strong, onClick }) {
  const content = (
    <>
      <div className="text-slate-400 text-[11px]">{label}</div>
      <div className={`truncate ${strong ? "font-semibold text-slate-800" : "text-slate-700 font-medium"}`}>
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
