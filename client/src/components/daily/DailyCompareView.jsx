import { Inbox } from "lucide-react";
import { currency, number, multiplier } from "../../lib/format";
import { formatDayLabel } from "../../lib/dateIst";
import { formatBudget, roasClass } from "../../lib/campaignDisplay";
import { LiveIndicator } from "../CampaignCells";

// ────────────────────────────────────────────────────────────────
// Phase 10 (campaign selection) — "Campaign Comparison Mode". Only
// meaningful once 2+ campaigns are selected in DailyPage's
// CampaignPicker; renders one small side-by-side table per date (metric
// rows down the left, one column per selected campaign — the same
// "Metric | Campaign A | Campaign B" convention Campaign Explorer's own
// ComparisonPanel.jsx already established, just per-date instead of
// range-wide) instead of DailyTable's per-(day,campaign)-row layout.
//
// Every cell opens the exact same drill-down drawer DailyTable's rows
// do — `days` here is already the campaign-filtered data DailyPage
// computed, and each campaign object in `d.campaigns` already carries
// date/campaignId/campaignName/accountId straight from the API
// response, so onOpenRow can be called with it directly, no adapter.
// ────────────────────────────────────────────────────────────────

const COMPARE_METRICS = [
  { key: "budget", label: "Budget", format: (v, c) => formatBudget(c?.budget, c?.budgetType) || "N/A" },
  { key: "spend", label: "Spend", format: currency },
  { key: "orders", label: "Orders", format: number },
  { key: "revenue", label: "Revenue", format: currency },
  { key: "roas", label: "ROAS" },
  { key: "codOrders", label: "COD", format: number },
  { key: "prepaidOrders", label: "Prepaid", format: number },
  { key: "delivered", label: "Delivered", format: number },
  { key: "cancelled", label: "Cancelled", format: number },
  { key: "returned", label: "Returned", format: number },
  { key: "totalProductsSold", label: "Products Sold", format: number },
  { key: "totalUnitsSold", label: "Units Sold", format: number },
];

export default function DailyCompareView({ days, onOpenRow }) {
  if (days.length === 0) {
    return (
      <div className="card flex flex-col items-center justify-center text-center py-14 px-4">
        <span className="flex items-center justify-center w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 mb-3">
          <Inbox size={22} />
        </span>
        <div className="text-sm text-slate-400">No data for the selected campaigns in this date range.</div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {days.map((d) => (
        <div key={d.date} className="card p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/60">
            <h3 className="font-display font-semibold text-sm text-slate-700">{formatDayLabel(d.date)}</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 130 }}>Metric</th>
                  {d.campaigns.map((c) => (
                    <th
                      key={c.campaignId || "unmatched"}
                      className="cursor-pointer select-none hover:text-blue-600"
                      onClick={() => onOpenRow(c)}
                      title="Open this campaign's 24-hour detail for this date"
                    >
                      <span className="inline-flex items-center gap-1.5">
                        <LiveIndicator status={c.effectiveStatus || c.status} />
                        {c.campaignName}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {COMPARE_METRICS.map((m) => (
                  <tr key={m.key}>
                    <td className="font-medium text-slate-600">{m.label}</td>
                    {d.campaigns.map((c) => (
                      <td
                        key={c.campaignId || "unmatched"}
                        className={`row-clickable num ${m.key === "roas" ? roasClass(c.roas) : ""}`}
                        onClick={() => onOpenRow(c)}
                      >
                        {m.key === "roas" ? multiplier(c.roas) : m.format(c[m.key], c)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
