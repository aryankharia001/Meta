import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Columns3, GripVertical, Eye, EyeOff, RotateCcw, Check } from "lucide-react";

// ────────────────────────────────────────────────────────────────
// Phase 10 — reusable "Columns" button + dropdown: show/hide columns,
// drag to reorder, restore defaults. Pairs with lib/useColumnPrefs.js
// (same drag pattern DashboardCustomizePanel.jsx already established
// for KPI cards in Phase 7 — draggable + onDragOver/onDrop +
// reorder(key, beforeKey)), generalized so every retrofitted table in
// this phase (DataTable, Campaign Explorer, Daily, Matched/Unmatched,
// Campaign Orders, Dashboard tables, Analytics leaderboards) gets
// identical column-customization UX from this one component.
//
// `columns` should be the FULL column list in current display order
// (allColumnsOrdered from useColumnPrefs), each with `key`, `label`,
// and an optional `group` for a grouped-by-section menu (Campaign
// Explorer's ~35 columns use this; simpler tables just omit it).
//
// Several call sites (CampaignDrawer, KpiAnalyticsPopup, Dashboard's
// table cards, etc.) put this button inside a `card ... overflow-hidden`
// or `overflow-auto` wrapper around the table below it — the same
// clipping bug NotificationBell.jsx hit and fixed in Phase 10: an
// absolutely-positioned dropdown is still clipped by any ANCESTOR
// with overflow != visible, so the panel was getting cut off at the
// card's edge instead of floating over the table. Fixed the same way:
// render the panel through a portal onto document.body with fixed
// positioning computed from the button's own bounding rect, so it's
// never a descendant of a scroll/clip container.
// ────────────────────────────────────────────────────────────────

export default function ColumnSettingsMenu({ columns, hidden, toggleHidden, reorder, reset, label = "Columns", align = "right" }) {
  const [open, setOpen] = useState(false);
  const [dragKey, setDragKey] = useState(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const ref = useRef(null);
  const panelRef = useRef(null);

  const PANEL_WIDTH = 288; // w-72

  const updatePosition = () => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    let left = align === "right" ? rect.right - PANEL_WIDTH : rect.left;
    left = Math.max(8, Math.min(left, window.innerWidth - PANEL_WIDTH - 8));
    setPos({ top: rect.bottom + 4, left });
  };

  const toggleOpen = () => {
    if (!open) updatePosition();
    setOpen((o) => !o);
  };

  useEffect(() => {
    if (!open) return;
    const onClick = (e) => {
      if (ref.current?.contains(e.target)) return;
      if (panelRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    updatePosition();
    window.addEventListener("resize", updatePosition);
    return () => window.removeEventListener("resize", updatePosition);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const grouped = columns.some((c) => c.group);
  const groups = grouped
    ? [...new Set(columns.map((c) => c.group || "Other"))].map((g) => ({
        group: g,
        items: columns.filter((c) => (c.group || "Other") === g),
      }))
    : [{ group: null, items: columns }];

  const row = (c) => {
    const isHidden = hidden.includes(c.key);
    return (
      <div
        key={c.key}
        draggable
        onDragStart={() => setDragKey(c.key)}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (dragKey && dragKey !== c.key) reorder(dragKey, c.key);
          setDragKey(null);
        }}
        onDragEnd={() => setDragKey(null)}
        className={`flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50 cursor-grab active:cursor-grabbing ${
          dragKey === c.key ? "opacity-40" : ""
        } ${isHidden ? "opacity-50" : ""}`}
      >
        <GripVertical size={12} className="text-slate-300 shrink-0" />
        <span className="flex-1 truncate text-xs text-slate-700">{c.label}</span>
        <button
          type="button"
          onClick={() => toggleHidden(c.key)}
          className={`p-1 rounded shrink-0 ${isHidden ? "text-slate-300 hover:text-slate-500" : "text-slate-500 hover:text-slate-700"}`}
          title={isHidden ? "Show column" : "Hide column"}
        >
          {isHidden ? <EyeOff size={12} /> : <Eye size={12} />}
        </button>
      </div>
    );
  };

  const panel = open
    ? createPortal(
        <div
          ref={panelRef}
          style={{ top: pos.top, left: pos.left }}
          className="fixed w-72 bg-white border border-slate-200 rounded-lg shadow-lg z-[9999] py-1.5 max-h-96 overflow-y-auto"
        >
          <p className="px-3 pb-1.5 text-[10px] text-slate-400">Drag to reorder · click the eye to show/hide.</p>
          {groups.map((g) => (
            <div key={g.group || "flat"} className="mb-1">
              {g.group && (
                <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{g.group}</div>
              )}
              {g.items.map(row)}
            </div>
          ))}
          <div className="px-3 pt-1.5 mt-1 border-t border-slate-100">
            <button type="button" className="btn btn-secondary btn-sm w-full !justify-center" onClick={reset}>
              <RotateCcw size={12} /> Reset Columns
            </button>
          </div>
        </div>,
        document.body
      )
    : null;

  return (
    <div className="relative" ref={ref}>
      <button type="button" className="btn btn-secondary btn-sm" onClick={toggleOpen}>
        <Columns3 size={13} /> {label}
      </button>
      {panel}
    </div>
  );
}

// Small check-style indicator some call sites use inline (kept exported
// in case a future table wants a non-dropdown column toggle chip) —
// currently unused but harmless/tree-shaken if never imported elsewhere.
export function ColumnAppliedBadge({ isDefault }) {
  if (isDefault) return null;
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-indigo-500">
      <Check size={10} /> Customized
    </span>
  );
}
