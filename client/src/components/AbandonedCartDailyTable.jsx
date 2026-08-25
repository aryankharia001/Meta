import { useEffect, useState } from "react";
import { CalendarDays, AlertTriangle } from "lucide-react";
import { fetchAbandonedCartsDaily, fetchAbandonedCarts } from "../lib/api";
import { currency, number, formatDate } from "../lib/format";
import DeliveredRevenuePopup from "./DeliveredRevenuePopup";

// ─────────────────────────────────────────────────────────────
// Phase 34 — Daily tab's per-day Abandoned Cart breakdown:
//   Date | Abandoned Cart Leads | Delivered | Delivered Revenue
// Leads is the order-date cohort for that day; Delivered/Delivered
// Revenue are delivered-date figures for that SAME day (may include
// leads ordered on an earlier day — see GET /api/abandoned-carts/daily).
// Purely additive next to DailyTable's own Shiprocket-order rows — never
// merged into that table or its totals ("zero coupling between phases").
//
// Clicking a row's Delivered Revenue opens the same shipment-level
// drill-down AbandonedCartSummaryCard uses, scoped to just that one day
// (since === until === that row's date) so the popup's own fetch stays
// self-contained rather than threading a huge leads array down from
// this table for every row up front.
// ─────────────────────────────────────────────────────────────

export default function AbandonedCartDailyTable({ since, until, className = "" }) {
  const [days, setDays] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [drilldownDate, setDrilldownDate] = useState(null);
  const [drilldownData, setDrilldownData] = useState(null);
  const [drilldownLoading, setDrilldownLoading] = useState(false);

  useEffect(() => {
    if (!since || !until) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    fetchAbandonedCartsDaily({ since, until })
      .then((res) => !cancelled && setDays(res.days || []))
      .catch((err) => !cancelled && setError(err.message || "Failed to load daily abandoned cart data"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [since, until]);

  const openDrilldown = (date) => {
    setDrilldownDate(date);
    setDrilldownLoading(true);
    setDrilldownData(null);
    fetchAbandonedCarts({ since: date, until: date })
      .then((res) => setDrilldownData(res))
      .catch(() => setDrilldownData({ deliveredLeads: [] }))
      .finally(() => setDrilldownLoading(false));
  };

  if (loading) {
    return <div className={`card h-24 animate-pulse bg-slate-100 ${className}`} />;
  }
  if (error) {
    return (
      <div className={`card flex items-center gap-1.5 text-xs text-rose-600 ${className}`}>
        <AlertTriangle size={12} /> {error}
      </div>
    );
  }
  if (!days || days.length === 0) return null;

  const totals = days.reduce(
    (acc, d) => ({
      leads: acc.leads + d.leads,
      delivered: acc.delivered + d.delivered,
      deliveredRevenue: acc.deliveredRevenue + d.deliveredRevenue,
    }),
    { leads: 0, delivered: 0, deliveredRevenue: 0 }
  );

  return (
    <div className={`card p-0 overflow-hidden ${className}`}>
      <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 px-4 pt-3.5 pb-2">
        <CalendarDays size={13} className="text-rose-500" />
        Abandoned Cart — Daily (synced from Traflead)
      </div>
      <div className="overflow-auto max-h-[420px]">
        <table className="table" style={{ tableLayout: "fixed", width: "max-content", minWidth: "100%" }}>
          <thead>
            <tr>
              <th className="sticky top-0 z-[2] bg-slate-50 text-left">Date</th>
              <th className="sticky top-0 z-[2] bg-slate-50 text-left">Abandoned Cart Leads</th>
              <th className="sticky top-0 z-[2] bg-slate-50 text-left">Delivered</th>
              <th className="sticky top-0 z-[2] bg-slate-50 text-left">Delivered Revenue</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr key={d.date}>
                <td className="font-medium text-slate-700 whitespace-nowrap">{formatDate(d.date)}</td>
                <td className="text-slate-600">{number(d.leads)}</td>
                <td className="text-slate-600">{number(d.delivered)}</td>
                <td>
                  <button
                    type="button"
                    className="text-emerald-700 font-semibold hover:underline disabled:no-underline disabled:text-slate-400 disabled:font-normal"
                    disabled={d.delivered === 0}
                    onClick={() => openDrilldown(d.date)}
                  >
                    {currency(d.deliveredRevenue)}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="font-semibold text-slate-700">Total</td>
              <td className="font-semibold text-slate-700">{number(totals.leads)}</td>
              <td className="font-semibold text-slate-700">{number(totals.delivered)}</td>
              <td className="font-semibold text-emerald-700">{currency(totals.deliveredRevenue)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <DeliveredRevenuePopup
        open={!!drilldownDate}
        since={drilldownDate}
        until={drilldownDate}
        leads={drilldownLoading ? [] : drilldownData?.deliveredLeads || []}
        truncated={drilldownData?.deliveredLeadsTruncated}
        onClose={() => setDrilldownDate(null)}
      />
    </div>
  );
}
