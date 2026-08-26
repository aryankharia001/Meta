import { useEffect, useState } from "react";
import { CalendarDays, AlertTriangle } from "lucide-react";
import { fetchAbandonedCartsDaily } from "../lib/api";
import { currency, number, formatDate } from "../lib/format";
import AbandonedCartEventPopup from "./AbandonedCartEventPopup";

// ─────────────────────────────────────────────────────────────
// Phase 34 — Daily tab's per-day Abandoned Cart breakdown.
//
// Phase 40 — columns rebuilt to match the spec's own example table
// exactly: Date | Created | CNF | Delivered | Cancelled | Returned | CNF
// Revenue. Each count is its OWN lifecycle event, bucketed by the date
// THAT event actually happened (see trafleadSyncService.js's
// getAbandonedCartDailyBreakdown) — Created no longer implies CNF/
// Delivered/Cancelled/Returned also happened that same day; an order
// created on one day and confirmed on another shows up in each column on
// its own real date. Every count cell is clickable, opening
// AbandonedCartEventPopup scoped to just that single day + event (the
// popup fetches its own data on open — this table no longer needs to
// pre-fetch a leads array per row).
// ─────────────────────────────────────────────────────────────

export default function AbandonedCartDailyTable({ since, until, className = "" }) {
  const [days, setDays] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [drilldown, setDrilldown] = useState(null); // { date, event } | null

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
      created: acc.created + (d.created ?? d.leads ?? 0),
      cnf: acc.cnf + (d.cnf || 0),
      delivered: acc.delivered + (d.delivered || 0),
      cancelled: acc.cancelled + (d.cancelled || 0),
      returned: acc.returned + (d.returned || 0),
      cnfRevenue: acc.cnfRevenue + (d.cnfRevenue || 0),
    }),
    { created: 0, cnf: 0, delivered: 0, cancelled: 0, returned: 0, cnfRevenue: 0 }
  );

  const Count = ({ date, event, value }) => (
    <button
      type="button"
      className="text-slate-600 font-medium hover:text-indigo-600 hover:underline disabled:no-underline disabled:text-slate-300 disabled:font-normal"
      disabled={!value}
      onClick={() => setDrilldown({ date, event })}
    >
      {number(value)}
    </button>
  );

  return (
    <div className={`card p-0 overflow-hidden ${className}`}>
      <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 px-4 pt-3.5 pb-2">
        <CalendarDays size={13} className="text-rose-500" />
        Abandoned Cart — Daily (synced from Traflead, each event dated by when it actually happened)
      </div>
      <div className="overflow-auto max-h-[420px]">
        <table className="table" style={{ tableLayout: "fixed", width: "max-content", minWidth: "100%" }}>
          <thead>
            <tr>
              <th className="sticky top-0 z-[2] bg-slate-50 text-left">Date</th>
              <th className="sticky top-0 z-[2] bg-slate-50 text-left">Created</th>
              <th className="sticky top-0 z-[2] bg-slate-50 text-left">CNF</th>
              <th className="sticky top-0 z-[2] bg-slate-50 text-left">Delivered</th>
              <th className="sticky top-0 z-[2] bg-slate-50 text-left">Cancelled</th>
              <th className="sticky top-0 z-[2] bg-slate-50 text-left">Returned</th>
              <th className="sticky top-0 z-[2] bg-slate-50 text-left">CNF Revenue</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr key={d.date}>
                <td className="font-medium text-slate-700 whitespace-nowrap">{formatDate(d.date)}</td>
                <td>
                  <Count date={d.date} event="created" value={d.created ?? d.leads ?? 0} />
                </td>
                <td>
                  <Count date={d.date} event="cnf" value={d.cnf || 0} />
                </td>
                <td>
                  <Count date={d.date} event="delivered" value={d.delivered || 0} />
                </td>
                <td>
                  <Count date={d.date} event="cancelled" value={d.cancelled || 0} />
                </td>
                <td>
                  <Count date={d.date} event="returned" value={d.returned || 0} />
                </td>
                <td className="text-emerald-700 font-semibold">{currency(d.cnfRevenue || 0)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="font-semibold text-slate-700">Total</td>
              <td className="font-semibold text-slate-700">{number(totals.created)}</td>
              <td className="font-semibold text-slate-700">{number(totals.cnf)}</td>
              <td className="font-semibold text-slate-700">{number(totals.delivered)}</td>
              <td className="font-semibold text-slate-700">{number(totals.cancelled)}</td>
              <td className="font-semibold text-slate-700">{number(totals.returned)}</td>
              <td className="font-semibold text-emerald-700">{currency(totals.cnfRevenue)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="text-[10px] text-slate-400 px-4 py-2 border-t border-slate-100">
        Daily CNF Revenue is rounded per day (count × CNF Revenue Rate), so the sum of this column across a range may differ
        from the range summary's own total by a unit or two — the range figure is the authoritative one.
      </div>

      <AbandonedCartEventPopup
        open={!!drilldown}
        since={drilldown?.date}
        until={drilldown?.date}
        event={drilldown?.event}
        onClose={() => setDrilldown(null)}
      />
    </div>
  );
}
