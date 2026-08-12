import { useEffect, useState } from "react";

// ────────────────────────────────────────────────────────────────
// Phase 10 — reusable per-table column preferences: which columns are
// visible and in what order, remembered per-browser under its own
// tableId (never shared across tables — Campaign Explorer's prefs never
// touch Daily's, Matched Orders never touches Unmatched Orders, etc).
//
// Deliberately the same shape/logic as lib/dashboardLayout.js's
// order+hidden+reorder(key,beforeKey)+reset — that hook already proved
// this exact pattern for the Dashboard's KPI cards in Phase 7; this is
// just the generic version any table's column list can use, so every
// retrofitted table (DataTable, Campaign Explorer, Daily, Matched/
// Unmatched, Campaign Orders, Dashboard tables, Analytics leaderboards)
// gets identical show/hide + drag-reorder + reset behavior for free.
//
// `columns` is the table's full, static column definition list
// (each needs a stable `key`); `defaultHiddenKeys` seeds which ones
// start hidden (e.g. campaignExplorerColumns.js's DEFAULT_HIDDEN).
// ────────────────────────────────────────────────────────────────

function storageKey(tableId) {
  return `columnPrefs.${tableId}.v1`;
}

function loadPrefs(tableId, allKeys, defaultHiddenKeys) {
  try {
    const raw = localStorage.getItem(storageKey(tableId));
    if (raw) {
      const parsed = JSON.parse(raw);
      const savedOrder = Array.isArray(parsed.order) ? parsed.order.filter((k) => allKeys.includes(k)) : [];
      const known = new Set(savedOrder);
      // Any column that didn't exist when this was last saved (a later
      // change adding a new column) is appended at the end, so it still
      // shows up instead of silently disappearing.
      const order = [...savedOrder, ...allKeys.filter((k) => !known.has(k))];
      return {
        order,
        hidden: Array.isArray(parsed.hidden) ? parsed.hidden.filter((k) => allKeys.includes(k)) : [...defaultHiddenKeys],
      };
    }
  } catch {
    // fall through to defaults
  }
  return { order: allKeys, hidden: [...defaultHiddenKeys] };
}

export function useColumnPrefs(tableId, columns, defaultHiddenKeys = []) {
  const allKeys = columns.map((c) => c.key);
  const [prefs, setPrefs] = useState(() => loadPrefs(tableId, allKeys, defaultHiddenKeys));

  // Re-sync if the table's own column definition list changes shape
  // (e.g. a differently-scoped tableId is reused for a different
  // columns array between renders) or the tableId itself changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setPrefs(loadPrefs(tableId, allKeys, defaultHiddenKeys));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableId]);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey(tableId), JSON.stringify(prefs));
    } catch {
      // storage unavailable — prefs just won't persist across reloads
    }
  }, [tableId, prefs]);

  const byKey = new Map(columns.map((c) => [c.key, c]));
  const orderedAll = prefs.order.map((k) => byKey.get(k)).filter(Boolean);
  columns.forEach((c) => {
    if (!prefs.order.includes(c.key)) orderedAll.push(c);
  });
  const orderedVisible = orderedAll.filter((c) => !prefs.hidden.includes(c.key));

  const toggleHidden = (key) =>
    setPrefs((p) => ({ ...p, hidden: p.hidden.includes(key) ? p.hidden.filter((k) => k !== key) : [...p.hidden, key] }));

  // Move `key` to sit immediately before `beforeKey` — what a drag-drop
  // of one column header/menu-row onto another maps to.
  const reorder = (key, beforeKey) =>
    setPrefs((p) => {
      if (key === beforeKey) return p;
      const order = p.order.filter((k) => k !== key);
      const idx = order.indexOf(beforeKey);
      if (idx === -1) return p;
      order.splice(idx, 0, key);
      return { ...p, order };
    });

  const reset = () => setPrefs({ order: allKeys, hidden: [...defaultHiddenKeys] });

  const isDefault =
    prefs.hidden.length === defaultHiddenKeys.length &&
    prefs.hidden.every((k) => defaultHiddenKeys.includes(k)) &&
    prefs.order.every((k, i) => k === allKeys[i]);

  return {
    orderedColumns: orderedVisible,
    allColumnsOrdered: orderedAll,
    hidden: prefs.hidden,
    toggleHidden,
    reorder,
    reset,
    isDefault,
  };
}
