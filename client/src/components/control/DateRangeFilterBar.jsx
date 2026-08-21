import { useState } from "react";
import { todayIso, shiftDays } from "../../lib/dateIst";

// Phase 27 §6/§7 — shared date-range + exact-time filter bar, the first
// real extraction of the Today/Yesterday/Last N Days preset pattern
// that's otherwise duplicated inline in LiveCampaignsPage.jsx and
// AbandonedCartsPage.jsx (neither of those files is touched — this is a
// new, additive component used only by the Phase 27 control panel).
//
// `value` is { since, until, exactFrom, exactUntil, useExact }. Presets
// set since/until (calendar days); "Custom" and "Exact time" let the
// caller pick precise boundaries — everything downstream (timeline,
// hourly view) respects whichever mode is active.
function startOfMonthIso() {
  const today = todayIso();
  return `${today.slice(0, 7)}-01`;
}

const PRESETS = [
  { key: "today", label: "Today", range: () => ({ since: todayIso(), until: todayIso() }) },
  { key: "yesterday", label: "Yesterday", range: () => ({ since: shiftDays(todayIso(), -1), until: shiftDays(todayIso(), -1) }) },
  { key: "7d", label: "Last 7 Days", range: () => ({ since: shiftDays(todayIso(), -6), until: todayIso() }) },
  { key: "30d", label: "Last 30 Days", range: () => ({ since: shiftDays(todayIso(), -29), until: todayIso() }) },
  { key: "month", label: "This Month", range: () => ({ since: startOfMonthIso(), until: todayIso() }) },
];

export default function DateRangeFilterBar({ value, onChange }) {
  const [mode, setMode] = useState(value?.useExact ? "exact" : "preset");
  const [activePreset, setActivePreset] = useState("7d");

  function applyPreset(preset) {
    setActivePreset(preset.key);
    setMode("preset");
    onChange({ ...preset.range(), useExact: false, exactFrom: null, exactUntil: null });
  }

  function applyCustom(since, until) {
    setActivePreset("custom");
    onChange({ since, until, useExact: false, exactFrom: null, exactUntil: null });
  }

  function applyExact(exactFrom, exactUntil) {
    setMode("exact");
    onChange({ since: null, until: null, useExact: true, exactFrom, exactUntil });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {PRESETS.map((p) => (
        <button
          key={p.key}
          type="button"
          className={`btn btn-sm ${mode === "preset" && activePreset === p.key ? "btn-primary" : "btn-secondary"}`}
          onClick={() => applyPreset(p)}
        >
          {p.label}
        </button>
      ))}
      <button
        type="button"
        className={`btn btn-sm ${activePreset === "custom" && mode === "preset" ? "btn-primary" : "btn-secondary"}`}
        onClick={() => setActivePreset("custom")}
      >
        Custom Range
      </button>
      <button type="button" className={`btn btn-sm ${mode === "exact" ? "btn-primary" : "btn-secondary"}`} onClick={() => setMode("exact")}>
        Exact Time
      </button>

      {activePreset === "custom" && mode === "preset" && (
        <span className="flex items-center gap-1.5">
          <input
            type="date"
            className="input input-sm"
            value={value?.since || todayIso()}
            onChange={(e) => applyCustom(e.target.value, value?.until || todayIso())}
          />
          <span className="text-slate-400 text-xs">to</span>
          <input
            type="date"
            className="input input-sm"
            value={value?.until || todayIso()}
            onChange={(e) => applyCustom(value?.since || todayIso(), e.target.value)}
          />
        </span>
      )}

      {mode === "exact" && (
        <span className="flex items-center gap-1.5 flex-wrap">
          <input
            type="datetime-local"
            className="input input-sm"
            value={value?.exactFrom || `${todayIso()}T00:00`}
            onChange={(e) => applyExact(e.target.value, value?.exactUntil || `${todayIso()}T23:59`)}
          />
          <span className="text-slate-400 text-xs">to</span>
          <input
            type="datetime-local"
            className="input input-sm"
            value={value?.exactUntil || `${todayIso()}T23:59`}
            onChange={(e) => applyExact(value?.exactFrom || `${todayIso()}T00:00`, e.target.value)}
          />
        </span>
      )}
    </div>
  );
}
