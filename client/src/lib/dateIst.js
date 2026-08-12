// Phase 10 — small shared IST date helpers for the new Daily page and
// its drawer. Every earlier page (Dashboard.jsx, AnalyticsPage.jsx,
// campaigns.js, campaignExplorer.js) already defines this exact
// IST_OFFSET_MS/todayIso/shiftDays trio inline per-file rather than
// import it from a shared module — that's this codebase's established
// "zero coupling" convention, deliberately kept for every one of those
// existing files (not touched here). This file exists only because
// Phase 10 introduces more than one new file (DailyPage + DailyDrawer)
// that need the identical logic, so sharing it between just those two
// new files avoids a third inline copy without touching anything older.

export const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export const todayIso = () => new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);

export const shiftDays = (dateStr, days) => {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

// Every calendar day between since and until, inclusive — same UTC
// walk the backend's enumerateDays() in dailyReports.js uses, kept in
// sync intentionally so the client's day list always matches exactly
// what the server returned rows for.
export function enumerateDays(since, until) {
  const days = [];
  const cur = new Date(`${since}T00:00:00.000Z`);
  const end = new Date(`${until}T00:00:00.000Z`);
  while (cur <= end) {
    days.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return days;
}

export function formatDayLabel(dateStr) {
  if (!dateStr) return "N/A";
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}
