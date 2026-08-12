import { X, Download, GitCompareArrows } from "lucide-react";
import { currency, number, percent, multiplier } from "../../lib/format";

// Phase 8 — Campaign Comparison. A focused, read-only side-by-side view
// of whatever campaigns are currently selected in ExplorerTable —
// takes the already-fetched, already-combined rows as-is, no new
// fetches. Metrics list matches the spec exactly.

const METRICS = [
  { key: "spend", label: "Spend", format: currency },
  { key: "revenue", label: "Revenue", format: currency },
  { key: "profit", label: "Profit", format: currency },
  { key: "roas", label: "ROAS", format: multiplier },
  { key: "totalOrders", label: "Orders", format: number },
  { key: "codOrders", label: "COD Orders", format: number },
  { key: "prepaidOrders", label: "Prepaid Orders", format: number },
  { key: "delivered", label: "Delivered Orders", format: number },
  { key: "aov", label: "Avg Order Value", format: currency },
  { key: "costPerOrder", label: "Cost Per Order", format: currency },
  { key: "ctr", label: "CTR", format: percent },
  { key: "cpc", label: "CPC", format: currency },
  { key: "cpm", label: "CPM", format: currency },
];

function toCsvValue(v) {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function downloadCsv(filename, rows) {
  const csv = rows.map((r) => r.map(toCsvValue).join(",")).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function ComparisonPanel({ campaigns, onClose }) {
  const exportComparison = () => {
    const rows = [["Metric", ...campaigns.map((c) => c.campaignName)], ...METRICS.map((m) => [m.label, ...campaigns.map((c) => m.format(c[m.key]))])];
    downloadCsv("campaign-comparison.csv", rows);
  };

  // Best value per metric row gets a subtle highlight — "higher is
  // better" for everything except Cost Per Order/CPC/CPM, where lower
  // spend-efficiency numbers are the win.
  const LOWER_IS_BETTER = new Set(["costPerOrder", "cpc", "cpm"]);
  const bestFor = (key) => {
    if (campaigns.length < 2) return null;
    const values = campaigns.map((c) => Number(c[key] || 0));
    return LOWER_IS_BETTER.has(key) ? Math.min(...values.filter((v) => v > 0)) ?? Math.min(...values) : Math.max(...values);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-4 bg-slate-900/50 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-5xl max-h-[85vh] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <GitCompareArrows size={16} className="text-slate-400" />
            <h2 className="font-display font-bold text-slate-800">Campaign Comparison</h2>
            <span className="text-xs text-slate-400">({campaigns.length} selected)</span>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" className="btn btn-secondary btn-sm" onClick={exportComparison}>
              <Download size={13} /> Export CSV
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
              <X size={14} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-5">
          <table className="table">
            <thead className="sticky top-0 z-[1] bg-white">
              <tr>
                <th className="sticky left-0 bg-white z-[2]">Metric</th>
                {campaigns.map((c) => (
                  <th key={c.campaignId} className="min-w-[160px]">
                    {c.campaignName}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {METRICS.map((m) => {
                const best = bestFor(m.key);
                return (
                  <tr key={m.key}>
                    <td className="sticky left-0 bg-white font-medium text-slate-600">{m.label}</td>
                    {campaigns.map((c) => (
                      <td key={c.campaignId} className={best !== null && Number(c[m.key] || 0) === best ? "font-semibold text-emerald-600" : ""}>
                        {m.format(c[m.key])}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
