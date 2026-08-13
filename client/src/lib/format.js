// Shared formatting helpers for Phase 2's new components (CampaignDrawer
// and friends). Dashboard.jsx / CampaignComparison.jsx / LiveCampaignsPage.jsx
// keep their own inline formatting exactly as-is — this file is additive,
// nothing existing was changed to use it.

export const currency = (n) =>
  n === null || n === undefined
    ? "N/A"
    : `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const number = (n) => (n === null || n === undefined ? "N/A" : Number(n || 0).toLocaleString("en-IN"));

export const percent = (n) => (n === null || n === undefined ? "N/A" : `${Number(n || 0).toFixed(2)}%`);

export const multiplier = (n) => (n === null || n === undefined ? "N/A" : `${Number(n || 0).toFixed(2)}x`);

export const formatDate = (d) => {
  if (!d) return "N/A";
  const date = new Date(d);
  if (isNaN(date.getTime())) return "N/A";
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

// Time-only formatter (no date portion) — for tables that already show
// Order Date as its own column and want a separate Order Time column
// derived from the same timestamp, rather than repeating the full
// formatDateTime() string in both.
export const formatTime = (d) => {
  if (!d) return "N/A";
  const date = new Date(d);
  if (isNaN(date.getTime())) return "N/A";
  return date.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
};

export const formatDateTime = (d) => {
  if (!d) return "N/A";
  const date = new Date(d);
  if (isNaN(date.getTime())) return "N/A";
  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};
