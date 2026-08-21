import { useEffect, useState } from "react";
import { TrendingUp, TrendingDown, Wallet, Gauge, Activity } from "lucide-react";
import { fetchEntityHistory } from "../../lib/api";
import { currency, formatDateTime, percent } from "../../lib/format";
import BeforeAfterCompare from "./BeforeAfterCompare";

// Phase 27 §3/§4/§5 — unified, clickable Budget + Bid Cap + status
// timeline. Reads from the merged /history endpoint (BudgetHistory +
// BidCapHistory + Activity Log status events for this one entity),
// respects whatever date range is passed in (spec §6/§7).
function iconFor(kind) {
  if (kind === "budget") return Wallet;
  if (kind === "bid_cap") return Gauge;
  return Activity;
}

export default function ActivityTimeline({ level, tokenId, entityId, since, until }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [compareEvent, setCompareEvent] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetchEntityHistory(tokenId, level, entityId, { since, until });
        if (!cancelled) setEvents(res.events || []);
      } catch (err) {
        if (!cancelled) setError(err.response?.data?.message || err.message || "Failed to load activity timeline");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [tokenId, level, entityId, since, until]);

  if (loading) return <div className="text-sm text-slate-400">Loading timeline…</div>;
  if (error) return <div className="text-sm text-rose-600">{error}</div>;
  if (!events.length) return <div className="text-sm text-slate-400">No activity in this range.</div>;

  return (
    <div className="space-y-2">
      {events.map((ev) => {
        const Icon = iconFor(ev.kind);
        const isOpen = expanded === ev.id;
        const increased = ev.to !== null && ev.from !== null && Number(ev.to) > Number(ev.from);
        return (
          <div key={ev.id} className="rounded-lg border border-slate-200 bg-white overflow-hidden">
            <button
              type="button"
              className="w-full flex items-center justify-between gap-3 p-3 text-left hover:bg-slate-50"
              onClick={() => setExpanded(isOpen ? null : ev.id)}
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 shrink-0">
                  <Icon size={16} />
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-700 truncate">{ev.title}</div>
                  <div className="text-xs text-slate-400">{formatDateTime(ev.at)}</div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {(ev.kind === "budget" || ev.kind === "bid_cap") && ev.from !== null && ev.to !== null && (
                  <span className="text-sm text-slate-600">
                    {currency(ev.from)} → {currency(ev.to)}
                  </span>
                )}
                {ev.changeAmount !== undefined && ev.changeAmount !== null && (
                  <span className={`text-xs font-semibold flex items-center gap-0.5 ${increased ? "text-emerald-600" : "text-rose-600"}`}>
                    {increased ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                    {increased ? "+" : ""}
                    {currency(ev.changeAmount)} ({increased ? "+" : ""}
                    {percent(ev.changePercent)})
                  </span>
                )}
              </div>
            </button>

            {isOpen && (
              <div className="border-t border-slate-100 p-3 bg-slate-50 text-sm text-slate-600 space-y-1">
                <div>
                  <span className="text-slate-400">Source: </span>
                  {ev.source}
                  {ev.changedBy ? ` (${ev.changedBy})` : ""}
                </div>
                {ev.message && <div>{ev.message}</div>}
                {(ev.kind === "budget" || ev.kind === "bid_cap") && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm mt-2"
                    onClick={() => setCompareEvent(ev)}
                  >
                    Compare Before vs After
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}

      {compareEvent && (
        <BeforeAfterCompare
          level={level}
          tokenId={tokenId}
          entityId={entityId}
          changeId={compareEvent.id}
          type={compareEvent.kind}
          onClose={() => setCompareEvent(null)}
        />
      )}
    </div>
  );
}
