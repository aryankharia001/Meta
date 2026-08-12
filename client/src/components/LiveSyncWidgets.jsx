import { useEffect, useRef, useState } from "react";
import { CircleCheck, CircleAlert, Loader2, ChevronDown, Bell, X } from "lucide-react";
import { useLiveSync } from "../lib/LiveSyncContext";

// ────────────────────────────────────────────────────────────────
// Phase 5 — Sync Status pill + Data Freshness badge + live
// notification toast. Purely presentational: everything they show
// comes from LiveSyncContext, which itself never touches campaign/
// order data — these components don't either.
// ────────────────────────────────────────────────────────────────

function timeAgo(date) {
  if (!date) return null;
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"} ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"} ago`;
}

// ─── Data Freshness badge ──────────────────────────────────────
// "Fresh Data" / "Updated Xs ago" / "Updated Xm ago" / "Stale Data
// (5+ minutes)". Ticks on its own 1s interval so the rest of the
// dashboard never re-renders just because a clock is running.
export function DataFreshnessBadge() {
  const { lastSyncAt } = useLiveSync();
  const [, forceTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  if (!lastSyncAt) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-slate-400 px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-200">
        <Loader2 size={11} className="animate-spin" /> Checking freshness…
      </span>
    );
  }

  const seconds = Math.floor((Date.now() - lastSyncAt.getTime()) / 1000);
  const stale = seconds >= 300;

  let label;
  if (seconds < 15) label = "Fresh Data";
  else if (seconds < 60) label = `Updated ${seconds}s ago`;
  else if (seconds < 300) label = `Updated ${Math.floor(seconds / 60)}m ago`;
  else label = "Stale Data (5+ minutes)";

  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border ${
        stale
          ? "bg-amber-50 border-amber-200 text-amber-700"
          : "bg-emerald-50 border-emerald-200 text-emerald-700"
      }`}
      title={`Last sync: ${lastSyncAt.toLocaleTimeString()}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${stale ? "bg-amber-500" : "bg-emerald-500"}`} />
      {label}
    </span>
  );
}

// ─── Sync Status pill + popover ────────────────────────────────
// 🟢 Synced 12 seconds ago / 🟡 Syncing... / 🔴 Sync Failed. Click to
// expand the detail breakdown (orders processed / new / updated /
// failed) — same data LiveSyncContext already tracks for the toast.
export function SyncStatusIndicator() {
  const { status, lastSyncAt, lastResult, lastError, manualRefresh, busyMessage } = useLiveSync();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const [, forceTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const cfg =
    status === "syncing"
      ? { dot: "bg-amber-500 animate-pulse", text: "Syncing…", cls: "text-amber-600" }
      : status === "error"
      ? { dot: "bg-rose-500", text: "Sync Failed", cls: "text-rose-600" }
      : lastSyncAt
      ? { dot: "bg-emerald-500", text: `Synced ${timeAgo(lastSyncAt)}`, cls: "text-emerald-600" }
      : { dot: "bg-slate-300", text: "Waiting for first sync…", cls: "text-slate-400" };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-200 hover:bg-slate-100 transition-colors"
      >
        <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
        <span className={`font-medium ${cfg.cls}`}>{cfg.text}</span>
        <ChevronDown size={12} className={`text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {busyMessage && (
        <div className="absolute right-0 mt-1 text-[11px] text-amber-600 bg-amber-50 border border-amber-200 rounded-md px-2 py-1 whitespace-nowrap z-30">
          {busyMessage}
        </div>
      )}

      {open && (
        <div className="absolute right-0 mt-2 w-72 bg-white border border-slate-200 rounded-xl shadow-xl p-4 z-30">
          <div className="flex items-center gap-2 mb-3">
            {status === "syncing" ? (
              <Loader2 size={15} className="animate-spin text-amber-500" />
            ) : status === "error" ? (
              <CircleAlert size={15} className="text-rose-500" />
            ) : (
              <CircleCheck size={15} className="text-emerald-500" />
            )}
            <span className="font-display font-semibold text-sm text-slate-800">Live Sync Status</span>
          </div>

          <div className="space-y-2 text-xs">
            <Row label="Last Successful Sync" value={lastSyncAt ? lastSyncAt.toLocaleTimeString() : "—"} />
            <Row
              label="Current Status"
              value={status === "syncing" ? "Syncing…" : status === "error" ? "Sync Failed" : "Synced"}
              valueClass={status === "error" ? "text-rose-600 font-medium" : status === "syncing" ? "text-amber-600 font-medium" : "text-emerald-600 font-medium"}
            />
            <Row label="Orders Processed" value={lastResult?.ordersProcessed ?? "—"} />
            <Row label="New Orders" value={lastResult?.newOrders ?? "—"} />
            <Row label="Updated Orders" value={lastResult?.updatedOrders ?? "—"} />
            <Row
              label="Failed Orders"
              value={lastResult?.failedOrders ?? 0}
              valueClass={lastResult?.failedOrders > 0 ? "text-rose-600 font-medium" : ""}
            />
          </div>

          {(status === "error" || lastResult?.syncError) && (
            <div className="mt-3 text-[11px] text-rose-600 bg-rose-50 border border-rose-200 rounded-md px-2 py-1.5">
              {lastError || lastResult?.syncError || "Sync failed"}
            </div>
          )}

          <button
            type="button"
            className="btn btn-secondary btn-sm w-full mt-3"
            onClick={() => manualRefresh()}
            disabled={status === "syncing"}
          >
            <Loader2 size={12} className={status === "syncing" ? "animate-spin" : "hidden"} />
            {status === "syncing" ? "Syncing…" : "Retry now"}
          </button>

          <p className="text-[10px] text-slate-400 mt-2 leading-snug">
            Auto-syncs every 10 seconds in the background. Existing data stays on screen while syncing.
          </p>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, valueClass = "" }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-slate-400">{label}</span>
      <span className={`text-slate-700 ${valueClass}`}>{value}</span>
    </div>
  );
}

// ─── Live notification toast ───────────────────────────────────
// Mounted once at App root so it fires no matter which page the user
// is on. Auto-dismisses; clicking it triggers a manual refresh of
// whatever's currently open (same as pressing "Refresh Now") and
// dismisses immediately.
export function LiveSyncToast() {
  const { notification, dismissNotification, manualRefresh } = useLiveSync();

  if (!notification) return null;

  return (
    <div className="fixed bottom-5 right-5 z-[90] animate-[fadeIn_0.2s_ease-out]">
      <div className="flex items-start gap-3 bg-slate-900 text-white rounded-xl shadow-2xl px-4 py-3 max-w-sm cursor-pointer hover:bg-slate-800 transition-colors">
        <span
          className="flex-1 flex items-start gap-2.5 text-sm"
          onClick={() => {
            manualRefresh();
            dismissNotification();
          }}
        >
          <Bell size={15} className="text-emerald-400 shrink-0 mt-0.5" />
          {notification.message}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            dismissNotification();
          }}
          className="text-slate-400 hover:text-white shrink-0"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
