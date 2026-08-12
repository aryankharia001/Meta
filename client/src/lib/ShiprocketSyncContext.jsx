import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

// Lives above <Routes> in App.jsx (same pattern the App.jsx comment already
// called for) so a Shiprocket backfill started on the Sync page keeps
// running/polling even after navigating to another page — previously all
// of this state (since/until/force/starting/progress) lived inside
// ShiprocketSyncPage.jsx itself, so leaving that page unmounted the poller
// and the in-progress fetch appeared to just vanish from the UI.
//
// Doesn't change what's called on the backend — same /start, /status,
// /cancel endpoints, same polling cadence — only where the state lives.

const API_BASE = "/api";
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const todayStr = () => new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);

const ShiprocketSyncContext = createContext(null);

export function ShiprocketSyncProvider({ children }) {
  const [since, setSince] = useState("");
  const [until, setUntil] = useState(todayStr());
  const [force, setForce] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState(null); // { checklist, summary, backfill }
  const [activeRange, setActiveRange] = useState(null); // range currently being polled

  const pollRef = useRef(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const pollStatus = useCallback(
    async (rangeSince, rangeUntil) => {
      try {
        const res = await fetch(`${API_BASE}/status?since=${rangeSince}&until=${rangeUntil}`);
        const json = await res.json();
        if (!json.success) throw new Error(json.message || "Status check failed");
        setProgress(json.data);

        if (!json.data.backfill.running) {
          stopPolling();
          setStarting(false);
          setMessage("Fetch complete.");
        }
      } catch (err) {
        setError(err.message);
        stopPolling();
        setStarting(false);
      }
    },
    [stopPolling]
  );

  // Only stops the interval if the whole app unmounts (tab close/refresh) —
  // this provider sits above <Routes>, so switching pages inside the app
  // never triggers this.
  useEffect(() => stopPolling, [stopPolling]);

  const handleStart = useCallback(async () => {
    setError("");
    setMessage("");

    if (!since || !until) {
      setError("Pick both a start and end date.");
      return;
    }
    if (since > until) {
      setError("Start date must be before end date.");
      return;
    }

    setStarting(true);
    setActiveRange({ since, until });
    try {
      const res = await fetch(`${API_BASE}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ since, until, force }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || "Failed to start");

      setMessage(json.message);
      stopPolling();
      pollStatus(since, until); // immediate first check
      pollRef.current = setInterval(() => pollStatus(since, until), 3000);
    } catch (err) {
      setError(err.message);
      setStarting(false);
    }
  }, [since, until, force, pollStatus, stopPolling]);

  const handleCancel = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/cancel`, { method: "POST" });
      const json = await res.json();
      setMessage(json.message || "Cancellation requested.");
    } catch (err) {
      setError(err.message);
    }
  }, []);

  const value = {
    since,
    setSince,
    until,
    setUntil,
    force,
    setForce,
    starting,
    error,
    message,
    progress,
    activeRange,
    handleStart,
    handleCancel,
  };

  return <ShiprocketSyncContext.Provider value={value}>{children}</ShiprocketSyncContext.Provider>;
}

export function useShiprocketSync() {
  const ctx = useContext(ShiprocketSyncContext);
  if (!ctx) {
    throw new Error("useShiprocketSync must be used within a ShiprocketSyncProvider");
  }
  return ctx;
}
