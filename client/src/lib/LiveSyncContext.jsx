import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { runLiveSync, logActivity } from "./api";

// ────────────────────────────────────────────────────────────────
// Phase 5 — Live Sync context. Mounted once, above <Routes> in
// App.jsx (same pattern as ShiprocketSyncContext / CampaignDrawerContext
// / OrderDrawerContext), so the 10-second poll keeps running no matter
// which page the user is on ("Background Sync" requirement) — it is
// never torn down by navigation, only by the whole app unmounting.
//
// This context ONLY tracks sync status/results and fires a lightweight
// "something new landed" signal (syncVersion). It does not know about,
// and does not touch, any page's own data/state — each page (Dashboard,
// CampaignComparison, LiveCampaignsPage, CampaignDrawer) decides for
// itself, via useLiveSync(), whether a given sync result is relevant to
// what it's currently showing (its own date-range check) and re-runs
// its OWN existing fetch function if so. That keeps every bit of
// "how do we load campaign/order data" logic exactly where it already
// lived in Phases 1–4 — this context never fetches campaign/order data
// itself, only triggers the write-path sync and reports what changed.
// ────────────────────────────────────────────────────────────────

const POLL_MS = 10000;

const LiveSyncContext = createContext(null);

export function LiveSyncProvider({ children }) {
  const [status, setStatus] = useState("idle"); // "idle" | "syncing" | "success" | "error"
  const [lastSyncAt, setLastSyncAt] = useState(null); // last time a sync completed successfully
  const [lastResult, setLastResult] = useState(null); // full payload from the most recent successful run
  const [lastError, setLastError] = useState("");
  const [syncVersion, setSyncVersion] = useState(0); // bumped only when newOrders > 0
  const [notification, setNotification] = useState(null); // { id, message } | null
  const [busyMessage, setBusyMessage] = useState(""); // transient "Sync already in progress." etc.
  // Phase 7 — Notification Center reads this to know a manual "Refresh
  // Now" actually finished (distinct from syncVersion, which only bumps
  // when there were new orders — this bumps every real manual
  // completion so "Sync completed" notifications fire even at 0 new).
  const [manualCompletion, setManualCompletion] = useState(null); // { id, newOrders, failedOrders } | null

  const syncingRef = useRef(false); // client-side lock — belt-and-suspenders alongside the server's own guard
  const notifyTimerRef = useRef(null);
  const busyTimerRef = useRef(null);

  const buildNotificationMessage = (result) => {
    const records = result.newOrderRecords || [];
    if (records.length === 0) return null;

    const byCampaign = new Map();
    records.forEach((r) => {
      const key = r.campaignName || null;
      byCampaign.set(key, (byCampaign.get(key) || 0) + 1);
    });

    if (byCampaign.size === 1) {
      const [name, count] = [...byCampaign.entries()][0];
      if (name) return `Campaign "${name}" received ${count} new order${count > 1 ? "s" : ""}.`;
    }
    return `${records.length} new order${records.length > 1 ? "s" : ""} received.`;
  };

  const runSync = useCallback(async ({ manual = false } = {}) => {
    if (syncingRef.current) {
      if (manual) {
        setBusyMessage("Sync already in progress.");
        clearTimeout(busyTimerRef.current);
        busyTimerRef.current = setTimeout(() => setBusyMessage(""), 3000);
      }
      return;
    }

    syncingRef.current = true;
    setStatus("syncing");

    try {
      const res = await runLiveSync();

      if (res.alreadyRunning) {
        // A backfill (ours, the 30-min cron, or a manual full re-sync from
        // the Sync page) is already running — not an error, just skip this
        // tick. Status reverts to whatever it last successfully was.
        setStatus((prev) => (prev === "syncing" ? "success" : prev));
        if (manual) {
          setBusyMessage("Sync already in progress.");
          clearTimeout(busyTimerRef.current);
          busyTimerRef.current = setTimeout(() => setBusyMessage(""), 3000);
        }
        return;
      }

      setLastResult(res);
      setLastSyncAt(new Date(res.syncedAt));
      setLastError("");
      setStatus(res.failedOrders > 0 ? "error" : "success");

      // Phase 7 — Activity Log. Manual "Refresh Now" clicks are always
      // logged (a deliberate user action); the 10s background poll only
      // logs when it actually found something, so the log doesn't fill up
      // with hundreds of no-op entries over a browsing session.
      if (manual) {
        logActivity(
          "sync",
          res.newOrders > 0 ? `Manual refresh — ${res.newOrders} new order${res.newOrders > 1 ? "s" : ""} found` : "Manual refresh — no new orders",
          { newOrders: res.newOrders, manual: true }
        );
      } else if (res.newOrders > 0) {
        logActivity("sync", `Background sync found ${res.newOrders} new order${res.newOrders > 1 ? "s" : ""}`, {
          newOrders: res.newOrders,
          manual: false,
        });
      }

      if (manual) {
        setManualCompletion({ id: Date.now(), newOrders: res.newOrders || 0, failedOrders: res.failedOrders || 0 });
      }

      if (res.newOrders > 0) {
        setSyncVersion((v) => v + 1);
        const message = buildNotificationMessage(res);
        if (message) {
          const id = Date.now();
          setNotification({ id, message });
          clearTimeout(notifyTimerRef.current);
          notifyTimerRef.current = setTimeout(() => {
            setNotification((cur) => (cur?.id === id ? null : cur));
          }, 6000);
        }
      }
    } catch (err) {
      // Keep whatever dashboard data is already on screen — just flag the
      // sync itself as failed and let the next 10s tick try again.
      setStatus("error");
      setLastError(err.message || "Sync failed");
    } finally {
      syncingRef.current = false;
    }
  }, []);

  // Automatic polling — every 10 seconds, for the lifetime of the app.
  useEffect(() => {
    runSync({ manual: false }); // immediate first check, same as ShiprocketSyncContext's pattern
    const id = setInterval(() => runSync({ manual: false }), POLL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const manualRefresh = useCallback(() => runSync({ manual: true }), [runSync]);

  const dismissNotification = useCallback(() => setNotification(null), []);

  const value = {
    status, // "idle" | "syncing" | "success" | "error"
    lastSyncAt,
    lastResult,
    lastError,
    syncVersion, // bump-only counter; pages diff this against a ref to know "something new happened"
    notification,
    dismissNotification,
    manualCompletion,
    busyMessage,
    manualRefresh,
    isSyncing: status === "syncing",
  };

  return <LiveSyncContext.Provider value={value}>{children}</LiveSyncContext.Provider>;
}

export function useLiveSync() {
  const ctx = useContext(LiveSyncContext);
  if (!ctx) {
    throw new Error("useLiveSync must be used within a LiveSyncProvider");
  }
  return ctx;
}

// Shared helper: does a page's currently selected [since, until] window
// include "today"? Live sync only ever touches today's data (see
// liveSync.js backend comments), so this is the one check every page
// needs to decide whether a given sync result is relevant to what it's
// showing — satisfies "Date Filter Awareness" (don't inject today's
// orders into a Yesterday/past-range view).
export function rangeIncludesToday(since, until, todayStr) {
  return since <= todayStr && until >= todayStr;
}
