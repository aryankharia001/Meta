import { formatDateTime } from "../../lib/format";
import { activityBucketInfo } from "../../lib/campaignActivityDisplay";

// ────────────────────────────────────────────────────────────────
// Phase 39 §3 — Active/Inactive Periods. The reconstructed period list
// (see server/lib/campaignActivity.js's buildPeriods()) rendered as a
// simple start → end list, one row per period, oldest first. The last
// period always has end: null from the server — rendered as "Current".
// ────────────────────────────────────────────────────────────────

const DOT_CLASSES = {
  emerald: "bg-emerald-500",
  rose: "bg-rose-500",
  slate: "bg-slate-400",
};

export default function ActivePeriodsBar({ periods, loading, error }) {
  if (loading) return <div className="text-sm text-slate-400">Loading periods…</div>;
  if (error) return <div className="text-sm text-rose-600">{error}</div>;
  if (!periods || !periods.length) return <div className="text-sm text-slate-400">No periods reconstructed yet.</div>;

  return (
    <div className="space-y-1.5">
      {periods.map((p, i) => {
        const info = activityBucketInfo(p.bucket);
        return (
          <div key={i} className="flex items-center gap-2.5 text-sm">
            <span className={`w-2 h-2 rounded-full shrink-0 ${DOT_CLASSES[info.tone]}`} />
            <span className="font-medium text-slate-700 w-16 shrink-0">{info.label}</span>
            <span className="text-slate-500 truncate">
              {formatDateTime(p.start)} → {p.end ? formatDateTime(p.end) : "Current"}
            </span>
          </div>
        );
      })}
    </div>
  );
}
