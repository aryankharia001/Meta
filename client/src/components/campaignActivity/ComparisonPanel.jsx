import { useEffect, useState } from "react";
import { X, GitCompareArrows, AlertTriangle, ArrowRight } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, ReferenceLine, Legend } from "recharts";
import { ChartCard, StyledTooltip, CHART_COLORS } from "../analytics/chartKit";
import { currency, number, multiplier } from "../../lib/format";
import { fetchCampaignActivityCompare } from "../../lib/api";
import { hourRangeLabel, budgetText } from "./activityFormat";

// ─────────────────────────────────────────────────────────────────────
// Phase 44 §23-§30 — Campaign Before/After Comparison Window. A
// self-contained overlay (same fixed-overlay chrome as HourOrdersPopup,
// so it looks and behaves like every other drill-down popup in this
// app), opened from a "Compare" action on a campaign/ad set/ad's own
// 24-hour table. Entirely driven by GET /campaign-activity/:tokenId/
// compare, which itself just re-sums that same entity's already-
// computed hourly report (spec §30 — never a separate/approximate
// fetch) — this component owns no aggregation logic of its own beyond
// the four derived-metric % changes the endpoint doesn't already return
// (Cost/Revenue per Order, Prepaid/COD %), computed with the exact same
// pctChange rule the backend uses for its own metrics.
// ─────────────────────────────────────────────────────────────────────

const CORE_METRIC_LABELS = {
  spend: "Spend",
  orders: "Orders",
  prepaidOrders: "Prepaid Orders",
  codOrders: "COD Orders",
  revenue: "Revenue",
  roas: "ROAS",
  budget: "Budget",
  bidCap: "Bid Cap",
};
const CURRENCY_METRICS = new Set(["spend", "revenue", "budget", "bidCap", "costPerOrder", "revenuePerOrder"]);
const MULTIPLIER_METRICS = new Set(["roas"]);
const PERCENT_METRICS = new Set(["prepaidPct", "codPct"]);

function formatMetricValue(metric, value) {
  if (value === null || value === undefined) return "—";
  if (CURRENCY_METRICS.has(metric)) return currency(value);
  if (MULTIPLIER_METRICS.has(metric)) return multiplier(value);
  if (PERCENT_METRICS.has(metric)) return `${Number(value).toFixed(2)}%`;
  return number(value);
}

// Same rule as pctChange() in campaignActivityReport.js — before === 0
// yields null (undefined percentage) unless after is also 0 (genuinely
// unchanged, 0%). Reimplemented client-side only for the four derived
// metrics the /compare endpoint doesn't already carry a changePercent
// for; every other metric's % change comes straight from the server.
function localPctChange(before, after) {
  const b = Number(before || 0);
  const a = Number(after || 0);
  if (b === 0) return a === 0 ? 0 : null;
  return Math.round(((a - b) / b) * 10000) / 100;
}

function ChangeCell({ value }) {
  if (value === null || value === undefined) return <span className="text-slate-300">—</span>;
  if (value === 0) return <span className="text-slate-400 text-xs font-medium">0.00%</span>;
  const good = value > 0;
  return (
    <span className={`text-xs font-semibold ${good ? "text-emerald-600" : "text-rose-600"}`}>
      {good ? "+" : ""}
      {value.toFixed(2)}%
    </span>
  );
}

function HourInput({ label, value, onChange, max = 23 }) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-slate-500">
      {label}
      <input
        type="number"
        min={0}
        max={max}
        className="input !py-1 !text-xs w-16"
        value={value}
        onChange={(e) => onChange(Math.max(0, Math.min(max, Number(e.target.value) || 0)))}
      />
    </label>
  );
}

export default function ComparisonPanel({ open, tokenId, entityType, entityId, campaignId, campaignName, entityName, date, defaultBoundaryHour, onClose }) {
  const [beforeStart, setBeforeStart] = useState(0);
  const [beforeEnd, setBeforeEnd] = useState(11);
  const [afterStart, setAfterStart] = useState(12);
  const [afterEnd, setAfterEnd] = useState(23);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const runCompare = (bs, be, as, ae) => {
    if (bs > be || as > ae) {
      setError("Each window's start hour must be at or before its end hour.");
      return;
    }
    setLoading(true);
    setError("");
    fetchCampaignActivityCompare(tokenId, {
      entityType,
      entityId,
      campaignId,
      campaignName,
      date,
      beforeStart: bs,
      beforeEnd: be,
      afterStart: as,
      afterEnd: ae,
    })
      .then((data) => setResult(data))
      .catch((err) => setError(err.message || "Failed to build comparison"))
      .finally(() => setLoading(false));
  };

  // Spec §26 — default the boundary to wherever a Budget/Bid Cap change
  // actually happened this day (passed in by the caller, which already
  // has the hourly rows loaded) instead of an arbitrary midday split;
  // falls back to a plain noon split when nothing changed today.
  useEffect(() => {
    if (!open) return;
    const boundary = defaultBoundaryHour ?? 12;
    const bEnd = Math.max(0, Math.min(23, boundary - 1));
    const aStart = Math.max(0, Math.min(23, boundary));
    setBeforeStart(0);
    setBeforeEnd(bEnd);
    setAfterStart(aStart);
    setAfterEnd(23);
    setResult(null);
    setError("");
    runCompare(0, bEnd, aStart, 23);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, entityType, entityId, date, defaultBoundaryHour]);

  if (!open) return null;

  const derivedRows = result
    ? [
        { metric: "costPerOrder", label: "Cost per Order", before: result.before.costPerOrder, after: result.after.costPerOrder },
        { metric: "revenuePerOrder", label: "Revenue per Order", before: result.before.revenuePerOrder, after: result.after.revenuePerOrder },
        { metric: "prepaidPct", label: "Prepaid %", before: result.before.prepaidPct, after: result.after.prepaidPct },
        { metric: "codPct", label: "COD %", before: result.before.codPct, after: result.after.codPct },
      ]
    : [];

  const chartData = result ? result.timeline.map((t) => ({ name: hourRangeLabel(t.hour), Spend: t.spend, Revenue: t.revenue })) : [];
  const boundaryLabel = result ? hourRangeLabel(result.after.window.startHour) : null;

  return (
    <>
      <div className="fixed inset-0 z-[46] bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-[56] flex items-start sm:items-center justify-center p-0 sm:p-6">
        <div
          className="bg-slate-50 w-full sm:max-w-5xl sm:rounded-2xl shadow-2xl h-full sm:h-auto sm:max-h-[90vh] flex flex-col overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between gap-3">
            <div className="min-w-0 flex items-center gap-2.5">
              <span className="flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-md shadow-indigo-500/30 shrink-0">
                <GitCompareArrows size={16} />
              </span>
              <div className="min-w-0">
                <h2 className="font-display font-bold text-base text-slate-800 truncate">Before / After Comparison</h2>
                <p className="text-xs text-slate-400 truncate">
                  {entityName || "—"} · {date}
                </p>
              </div>
            </div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={onClose} title="Close">
              <X size={14} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
            {error && (
              <div className="flex items-center gap-2 text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">
                <AlertTriangle size={14} /> {error}
              </div>
            )}

            <div className="card !p-4">
              <div className="flex flex-wrap items-end gap-4">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Before</span>
                  <HourInput label="From" value={beforeStart} onChange={setBeforeStart} />
                  <HourInput label="To" value={beforeEnd} onChange={setBeforeEnd} />
                </div>
                <ArrowRight size={16} className="text-slate-300 mb-1.5" />
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">After</span>
                  <HourInput label="From" value={afterStart} onChange={setAfterStart} />
                  <HourInput label="To" value={afterEnd} onChange={setAfterEnd} />
                </div>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => runCompare(beforeStart, beforeEnd, afterStart, afterEnd)}
                  disabled={loading}
                >
                  {loading ? "Comparing…" : "Compare"}
                </button>
              </div>
            </div>

            {result && (
              <>
                {/* Spec §26 — what actually changed at the boundary */}
                <div className="card !p-4 bg-indigo-50/50 border-indigo-100">
                  <div className="text-xs font-semibold text-indigo-700 uppercase tracking-wide mb-2">What Changed</div>
                  {!result.changes.budget && !result.changes.bidCap ? (
                    <div className="text-sm text-slate-500">No Budget or Bid Cap change was recorded between these two windows.</div>
                  ) : (
                    <div className="flex flex-wrap gap-6">
                      {result.changes.budget && (
                        <div className="text-sm text-slate-700">
                          <span className="text-slate-400">Budget: </span>
                          {budgetText(result.changes.budget.from)} <ArrowRight size={12} className="inline mx-1 text-slate-400" />{" "}
                          <strong>{budgetText(result.changes.budget.to)}</strong>
                        </div>
                      )}
                      {result.changes.bidCap && (
                        <div className="text-sm text-slate-700">
                          <span className="text-slate-400">Bid Cap: </span>
                          {result.changes.bidCap.from === null ? "—" : currency(result.changes.bidCap.from)}{" "}
                          <ArrowRight size={12} className="inline mx-1 text-slate-400" />{" "}
                          <strong>{result.changes.bidCap.to === null ? "—" : currency(result.changes.bidCap.to)}</strong>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Spec §25/§28 — side-by-side metrics + all % change variants */}
                <div className="card p-0 overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-100 text-sm font-semibold text-slate-700">Side-by-Side Metrics</div>
                  <div className="overflow-auto">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Metric</th>
                          <th className="num">Before ({result.before.window.label})</th>
                          <th className="num">After ({result.after.window.label})</th>
                          <th className="num">% Change</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.comparison.map((row) => (
                          <tr key={row.metric}>
                            <td className="font-medium text-slate-700">{CORE_METRIC_LABELS[row.metric] || row.metric}</td>
                            <td className="num">{formatMetricValue(row.metric, row.before)}</td>
                            <td className="num">{formatMetricValue(row.metric, row.after)}</td>
                            <td className="num">
                              <ChangeCell value={row.changePercent} />
                            </td>
                          </tr>
                        ))}
                        {derivedRows.map((row) => (
                          <tr key={row.metric}>
                            <td className="font-medium text-slate-700">{row.label}</td>
                            <td className="num">{formatMetricValue(row.metric, row.before)}</td>
                            <td className="num">{formatMetricValue(row.metric, row.after)}</td>
                            <td className="num">
                              <ChangeCell value={localPctChange(row.before, row.after)} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Spec §29 — visual timeline with the boundary marked */}
                <ChartCard title="Hourly Spend & Revenue" height={260}>
                  <LineChart data={chartData} margin={{ top: 5, right: 16, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={2} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <StyledTooltip formatter={(v) => currency(v)} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {boundaryLabel && (
                      <ReferenceLine x={boundaryLabel} stroke="#f43f5e" strokeDasharray="4 4" label={{ value: "Boundary", fontSize: 10, fill: "#f43f5e", position: "top" }} />
                    )}
                    <Line type="monotone" dataKey="Spend" stroke={CHART_COLORS[0]} strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="Revenue" stroke={CHART_COLORS[2]} strokeWidth={2} dot={false} />
                  </LineChart>
                </ChartCard>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
