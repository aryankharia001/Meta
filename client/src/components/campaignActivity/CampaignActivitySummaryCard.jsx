import { Activity, Calendar, PauseCircle, PlayCircle } from "lucide-react";
import { formatDateTime } from "../../lib/format";
import { activityBucketInfo } from "../../lib/campaignActivityDisplay";

// ────────────────────────────────────────────────────────────────
// Phase 39 §6 — Active/Inactive Summary. Top-of-drawer card: Status,
// Active Time, Inactive Time, Active/Inactive Period counts, Campaign
// Start/End. Purely presentational — every number it shows comes from
// the `summary` object GET /campaign-activity/:tokenId/:campaignId/timeline
// already returns (see campaignActivity.js's getActivitySnapshot()).
// ────────────────────────────────────────────────────────────────

function Stat({ label, value, sub }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className="text-base font-display font-semibold text-slate-800 mt-0.5">{value}</div>
      {sub && <div className="text-xs text-slate-400 mt-0.5">{sub}</div>}
    </div>
  );
}

export default function CampaignActivitySummaryCard({ summary, loading, error }) {
  if (loading) return <div className="text-sm text-slate-400">Loading activity summary…</div>;
  if (error) return <div className="text-sm text-rose-600">{error}</div>;
  if (!summary) return null;

  const bucket = activityBucketInfo(summary.currentBucket);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
            bucket.tone === "emerald" ? "bg-emerald-50 text-emerald-700" : bucket.tone === "rose" ? "bg-rose-50 text-rose-700" : "bg-slate-100 text-slate-600"
          }`}
        >
          {summary.currentBucket === "active" ? <PlayCircle size={13} /> : summary.currentBucket === "closed" ? <Activity size={13} /> : <PauseCircle size={13} />}
          Status: {bucket.label}
        </span>
        {!summary.available && (
          <span className="text-xs text-slate-400">
            Activity tracking just started for this campaign — history will build up from here.
          </span>
        )}
      </div>

      {summary.available && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <Stat label="Active Time" value={summary.activeLabel} />
            <Stat label="Inactive Time" value={summary.inactiveLabel} />
            <Stat label="Active Periods" value={summary.activePeriods} />
            <Stat label="Inactive Periods" value={summary.inactivePeriods} />
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <Stat
              label="Campaign Start"
              value={summary.campaignStart ? formatDateTime(summary.campaignStart) : "Unknown"}
              sub={!summary.campaignStart ? "Not yet observed as Active" : null}
            />
            <Stat
              label="Campaign End"
              value={summary.campaignEnd ? formatDateTime(summary.campaignEnd) : "Ongoing"}
            />
          </div>

          {summary.historicalDataAvailableFrom && (
            <div className="flex items-start gap-1.5 text-xs text-slate-400">
              <Calendar size={13} className="mt-0.5 shrink-0" />
              <span>
                Activity history is tracked from {formatDateTime(summary.historicalDataAvailableFrom)} onward. Meta doesn't
                expose status history before that — anything earlier is shown separately, never guessed.
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
