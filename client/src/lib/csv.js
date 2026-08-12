// Shared CSV export helper for the Phase 3 popups. CampaignDrawer.jsx
// (Phase 2) has its own small inline copy of the same idea — left as-is
// rather than refactored, to avoid touching working Phase 2 code for a
// cosmetic dedupe.

function toCsvValue(v) {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function downloadCsv(filename, rows) {
  const csv = rows.map((r) => r.map(toCsvValue).join(",")).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
