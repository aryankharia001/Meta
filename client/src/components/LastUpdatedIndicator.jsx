import { useEffect, useState } from "react";
import { RefreshCw, AlertTriangle } from "lucide-react";

// Phase 18 (part 2) — one shared "Last Updated" indicator, reused by
// every page wired to the new useSwr hook (lib/useSwr.js) instead of
// each page hand-rolling its own "Updated HH:MM" label. Neither
// lib/format.js nor lib/dateIst.js has a relative-time helper, so this
// is its own small, self-contained one — not exported elsewhere, this
// component is the only consumer.
//
// Ticks via a plain setInterval so "Updated 12s ago" keeps counting up
// without the parent page re-rendering — cheap enough for the handful of
// these mounted on any given page at once.

function relativeTime(ms) {
  if (!ms) return null;
  const diffSec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (diffSec < 5) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const min = Math.floor(diffSec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

export default function LastUpdatedIndicator({ lastUpdatedAt, isValidating, backgroundError, className = "" }) {
  const [, tick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => tick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  if (backgroundError) {
    return (
      <span className={`inline-flex items-center gap-1 text-xs text-amber-600 ${className}`} title={backgroundError}>
        <AlertTriangle size={11} /> Unable to refresh — showing last available data
      </span>
    );
  }

  const ts = lastUpdatedAt instanceof Date ? lastUpdatedAt.getTime() : lastUpdatedAt;
  const label = ts ? relativeTime(ts) : null;

  if (!label && !isValidating) return null;

  return (
    <span className={`inline-flex items-center gap-1 text-xs text-slate-400 ${className}`}>
      {isValidating && <RefreshCw size={11} className="animate-spin" />}
      {label ? `Updated ${label}` : "Updating…"}
    </span>
  );
}
