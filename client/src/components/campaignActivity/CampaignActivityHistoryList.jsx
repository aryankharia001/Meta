import { useState } from "react";
import { Wallet, Gauge } from "lucide-react";
import { currency, formatDateTime, percent } from "../../lib/format";
import { activityEventLabel, activityEventTone } from "../../lib/campaignActivityDisplay";

// ────────────────────────────────────────────────────────────────
// Phase 39 §5 — Campaign Drill Activity Timeline. A colored-dot list
// (Campaign Activated / Paused / Resumed / Closed / Reactivated, plus
// this campaign's existing Budget/Bid Cap changes merged in) — click an
// event to expand its full details. Fed by GET /campaign-activity/
// :tokenId/:campaignId/timeline's `events` array (already merged/sorted
// server-side by buildActivityTimeline() — see campaignActivity.js).
//
// Deliberately a fresh component rather than a reuse of
// control/ActivityTimeline.jsx, which stays exactly as-is powering the
// existing "Budget & Bid Cap Control" section's own timeline — see that
// section's own header comment in CampaignDrawer.jsx.
// ────────────────────────────────────────────────────────────────

const TONE_CLASSES = {
  emerald: "bg-emerald-500",
  rose: "bg-rose-500",
  slate: "bg-slate-400",
};

function DotIcon({ event }) {
  if (event.kind === "budget") return <Wallet size={13} className="text-white" />;
  if (event.kind === "bid_cap") return <Gauge size={13} className="text-white" />;
  return null;
}

export default function CampaignActivityHistoryList({ events, loading, error }) {
  const [expanded, setExpanded] = useState(null);

  if (loading) return <div className="text-sm text-slate-400">Loading activity history…</div>;
  if (error) return <div className="text-sm text-rose-600">{error}</div>;
  if (!events || !events.length) return <div className="text-sm text-slate-400">No activity recorded in this range.</div>;

  return (
    <div className="space-y-2">
      {events.map((ev) => {
        const isOpen = expanded === ev.id;
        const tone = ev.kind === "status_activity" ? activityEventTone(ev.activityType) : "slate";
        const title = ev.kind === "status_activity" ? activityEventLabel(ev.activityType) : ev.title;

        return (
          <div key={ev.id} className="rounded-lg border border-slate-200 bg-white overflow-hidden">
            <button
              type="button"
              className="w-full flex items-center justify-between gap-3 p-3 text-left hover:bg-slate-50"
              onClick={() => setExpanded(isOpen ? null : ev.id)}
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className={`flex items-center justify-center w-6 h-6 rounded-full shrink-0 ${TONE_CLASSES[tone]}`}>
                  <DotIcon event={ev} />
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-700 truncate">{title}</div>
                  <div className="text-xs text-slate-400">{formatDateTime(ev.at)}</div>
                </div>
              </div>
              {(ev.kind === "budget" || ev.kind === "bid_cap") && ev.from !== null && ev.to !== null && (
                <span className="text-sm text-slate-600 shrink-0">
                  {currency(ev.from)} → {currency(ev.to)}
                </span>
              )}
            </button>

            {isOpen && (
              <div className="border-t border-slate-100 p-3 bg-slate-50 text-sm text-slate-600 space-y-1">
                <div>
                  <span className="text-slate-400">Source: </span>
                  {ev.source}
                  {ev.changedBy ? ` (${ev.changedBy})` : ""}
                </div>
                {ev.kind === "status_activity" && (ev.previousStatus || ev.newStatus) && (
                  <div>
                    <span className="text-slate-400">Status: </span>
                    {ev.previousStatus || "—"} → {ev.newStatus || "—"}
                  </div>
                )}
                {ev.changeAmount !== undefined && ev.changeAmount !== null && (
                  <div>
                    <span className="text-slate-400">Change: </span>
                    {currency(ev.changeAmount)} ({percent(ev.changePercent)})
                  </div>
                )}
                {ev.message && <div>{ev.message}</div>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
