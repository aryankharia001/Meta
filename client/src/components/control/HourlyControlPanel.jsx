import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { todayIso, shiftDays } from "../../lib/dateIst";
import { fetchEntityHourlyControl } from "../../lib/api";
import { HOURLY_CONTROL_COLUMNS, HOURLY_CONTROL_DEFAULT_HIDDEN } from "../../lib/controlColumns";
import DataTable from "../DataTable";
import { currency } from "../../lib/format";

// Phase 27 §8 — Hourly performance overlaid with the Budget/Bid Cap
// that was active at the start of each hour, plus a mid-hour-change
// marker (never silently relabeling a whole hour when a change lands
// inside it — see server/lib/controlHelpers.js's header comment).
//
// A new wrapper, not a modification of HourlyPanel.jsx/hourly.js — this
// reads from the Phase 27 .../hourly endpoints only.
export default function HourlyControlPanel({ level, tokenId, entityId, tableIdSuffix = "control" }) {
  const today = todayIso();
  const [mode, setMode] = useState("today");
  const [customDate, setCustomDate] = useState(today);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const date = mode === "today" ? today : mode === "yesterday" ? shiftDays(today, -1) : customDate;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetchEntityHourlyControl(tokenId, level, entityId, date);
        if (!cancelled) setReport(res);
      } catch (err) {
        if (!cancelled) setError(err.response?.data?.message || err.message || "Failed to load hourly report");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [tokenId, level, entityId, date]);

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <div className="text-sm font-semibold text-slate-700">Hourly Performance</div>
        <div className="flex items-center gap-1.5">
          <button type="button" className={`btn btn-sm ${mode === "today" ? "btn-primary" : "btn-secondary"}`} onClick={() => setMode("today")}>
            Today
          </button>
          <button
            type="button"
            className={`btn btn-sm ${mode === "yesterday" ? "btn-primary" : "btn-secondary"}`}
            onClick={() => setMode("yesterday")}
          >
            Yesterday
          </button>
          <input
            type="date"
            className="input input-sm"
            value={mode === "custom" ? customDate : date}
            onChange={(e) => {
              setCustomDate(e.target.value);
              setMode("custom");
            }}
          />
        </div>
      </div>

      {loading && <div className="text-sm text-slate-400">Loading…</div>}
      {error && <div className="text-sm text-rose-600">{error}</div>}

      {report && (
        <>
          {!report.metaHourlyAvailable && (
            <div className="flex items-center gap-2 text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-lg p-2 mb-2">
              <AlertTriangle size={14} />
              Meta hourly spend isn't available for this account/day{report.metaHourlyError ? `: ${report.metaHourlyError}` : "."}
            </div>
          )}
          <div className="text-[11px] text-slate-400 mb-2">
            * marks an hour where the Budget or Bid Cap changed partway through — the value shown is what was active at the
            start of the hour.
          </div>
          <DataTable
            tableId={`hourlyControl.${tableIdSuffix}`}
            columns={HOURLY_CONTROL_COLUMNS}
            data={report.hours}
            rowKey={(r) => r.hour}
            defaultHiddenKeys={HOURLY_CONTROL_DEFAULT_HIDDEN}
            emptyMessage="No hourly data for this day."
          />
          <div className="flex items-center gap-4 text-xs text-slate-500 mt-2">
            <span>Total Spend: {currency(report.summary.totalSpend)}</span>
            <span>Total Orders: {report.summary.totalOrders}</span>
            <span>Total Revenue: {currency(report.summary.totalRevenue)}</span>
            <span>Total Profit: {currency(report.summary.totalProfit)}</span>
          </div>
        </>
      )}
    </div>
  );
}
