import { useShiprocketSync } from "../lib/ShiprocketSyncContext";

/**
 * Page 1 — set a date range and fetch Shiprocket orders into Mongo.
 * Kicks off the backend backfill (which walks the range one day at a
 * time, skipping days already synced) and polls /status so you can watch
 * it move day by day in real time.
 *
 * All the actual state (since/until/force/starting/progress) and polling
 * live in ShiprocketSyncContext, mounted above the router in App.jsx — so
 * navigating to another page and back doesn't lose an in-progress fetch;
 * this component just renders whatever the context currently holds.
 */
export default function ShiprocketFetchOrders() {
  const {
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
    handleStart: startFetch,
    handleCancel,
  } = useShiprocketSync();

  const handleStart = (e) => {
    e.preventDefault();
    startFetch();
  };

  const backfill = progress?.backfill;
  const summary = progress?.summary;
  const pct =
    backfill && backfill.daysTotal > 0
      ? Math.round((backfill.daysDone / backfill.daysTotal) * 100)
      : 0;

  return (
    <div style={styles.page}>
      <h1 style={styles.h1}>Fetch Shiprocket Orders</h1>
      <p style={styles.subtext}>
        Pick a date range. Orders are pulled one day at a time and saved to
        Mongo — days already fetched are skipped automatically, unless you
        check "Force re-sync" below.
      </p>

      <form onSubmit={handleStart} style={styles.form}>
        <label style={styles.label}>
          From
          <input
            type="date"
            value={since}
            max={until || undefined}
            onChange={(e) => setSince(e.target.value)}
            style={styles.input}
          />
        </label>

        <label style={styles.label}>
          To
          <input
            type="date"
            value={until}
            min={since || undefined}
            onChange={(e) => setUntil(e.target.value)}
            style={styles.input}
          />
        </label>

        <label style={styles.checkboxLabel}>
          <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
          Force re-sync (even already-complete days)
        </label>

        <button type="submit" disabled={starting} style={styles.button}>
          {starting ? (force ? "Force re-syncing…" : "Fetching…") : force ? "Force Re-sync" : "Start Fetch"}
        </button>

        {starting && (
          <button type="button" onClick={handleCancel} style={styles.cancelButton}>
            Cancel
          </button>
        )}
      </form>

      {force && (
        <div style={styles.warning}>
          Force re-sync re-fetches full order details for every order on every day in this range, even days already
          marked complete — this is slower and makes more Shiprocket API calls than a normal fetch. Use it when you
          specifically need fresher data for dates you've already synced.
        </div>
      )}

      {error && <div style={styles.error}>{error}</div>}
      {message && !error && <div style={styles.message}>{message}</div>}

      {backfill && backfill.daysTotal > 0 && (
        <div style={styles.progressBox}>
          <div style={styles.progressHeader}>
            <span>
              Day {backfill.daysDone} / {backfill.daysTotal}
              {backfill.currentDay ? ` — currently on ${backfill.currentDay}` : ""}
            </span>
            <span>{pct}%</span>
          </div>
          <div style={styles.progressTrack}>
            <div style={{ ...styles.progressFill, width: `${pct}%` }} />
          </div>

          {summary && (
            <div style={styles.summaryRow}>
              <Stat label="Complete" value={summary.complete} color="#16a34a" />
              <Stat label="Live" value={summary.live} color="#2563eb" />
              <Stat label="Failed" value={summary.failed} color="#dc2626" />
              <Stat label="Pending" value={summary.pending} color="#6b7280" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color }) {
  return (
    <div style={styles.stat}>
      <div style={{ ...styles.statValue, color }}>{value}</div>
      <div style={styles.statLabel}>{label}</div>
    </div>
  );
}

const styles = {
  page: { maxWidth: 680, margin: "0 auto", padding: 32, fontFamily: "'Inter', ui-sans-serif, system-ui, sans-serif" },
  h1: { fontSize: 24, fontWeight: 700, marginBottom: 6, color: "#0f172a", letterSpacing: "-0.01em" },
  subtext: { color: "#64748b", marginBottom: 24, fontSize: 14, lineHeight: 1.6 },
  form: {
    display: "flex",
    alignItems: "flex-end",
    gap: 14,
    flexWrap: "wrap",
    background: "#fff",
    border: "1px solid #e2e8f0",
    borderRadius: 14,
    padding: 20,
    boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04)",
  },
  label: { display: "flex", flexDirection: "column", fontSize: 13, color: "#475569", gap: 6, fontWeight: 500 },
  checkboxLabel: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 13,
    color: "#475569",
    paddingBottom: 9,
  },
  input: {
    padding: "9px 12px",
    borderRadius: 8,
    border: "1px solid #cbd5e1",
    fontSize: 14,
    outline: "none",
    transition: "border-color 0.15s, box-shadow 0.15s",
  },
  button: {
    padding: "10px 20px",
    borderRadius: 8,
    border: "none",
    background: "#2563eb",
    color: "#fff",
    fontSize: 14,
    fontWeight: 500,
    cursor: "pointer",
    transition: "background-color 0.15s",
    boxShadow: "0 1px 2px rgba(37, 99, 235, 0.25)",
  },
  cancelButton: {
    padding: "10px 20px",
    borderRadius: 8,
    border: "1px solid #f43f5e",
    background: "#fff",
    color: "#e11d48",
    fontSize: 14,
    fontWeight: 500,
    cursor: "pointer",
    transition: "background-color 0.15s",
  },
  error: {
    marginTop: 16,
    color: "#e11d48",
    fontSize: 14,
    background: "#fff1f2",
    border: "1px solid #fecdd3",
    borderRadius: 8,
    padding: "10px 14px",
  },
  message: {
    marginTop: 16,
    color: "#059669",
    fontSize: 14,
    background: "#ecfdf5",
    border: "1px solid #a7f3d0",
    borderRadius: 8,
    padding: "10px 14px",
  },
  warning: {
    marginTop: 16,
    padding: "12px 14px",
    borderRadius: 8,
    background: "#fffbeb",
    border: "1px solid #fde68a",
    color: "#92400e",
    fontSize: 13,
    lineHeight: 1.6,
  },
  progressBox: {
    marginTop: 28,
    padding: 20,
    border: "1px solid #e2e8f0",
    borderRadius: 14,
    background: "#fff",
    boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04)",
  },
  progressHeader: { display: "flex", justifyContent: "space-between", fontSize: 13, color: "#475569", marginBottom: 10, fontWeight: 500 },
  progressTrack: { height: 8, background: "#f1f5f9", borderRadius: 999, overflow: "hidden" },
  progressFill: { height: "100%", background: "linear-gradient(90deg, #3b82f6, #2563eb)", transition: "width 0.3s ease", borderRadius: 999 },
  summaryRow: { display: "flex", gap: 24, marginTop: 20 },
  stat: { textAlign: "center", flex: 1 },
  statValue: { fontSize: 22, fontWeight: 700, color: "#0f172a" },
  statLabel: { fontSize: 12, color: "#64748b", marginTop: 2 },
};