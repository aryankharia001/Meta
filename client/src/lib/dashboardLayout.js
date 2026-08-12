import { useEffect, useState } from "react";

// ────────────────────────────────────────────────────────────────
// Phase 7 — Dashboard Customization. Per-browser layout preference
// (order/hidden/pinned KPI cards), same "no auth = localStorage"
// reasoning as PreferencesContext — scoped to its own hook rather than
// folded into PreferencesContext since only Dashboard.jsx needs it and
// it has its own array-shuffling logic that doesn't belong in the
// generic prefs object. Never touches CARD_DEFS, cardValues, or how
// any card's number is computed — purely a display order/visibility
// layer on top of Dashboard's existing, unchanged cardList.
// ────────────────────────────────────────────────────────────────

const STORAGE_KEY = "dashboardLayout.v1";

function loadLayout(defaultKeys) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const savedOrder = Array.isArray(parsed.order) ? parsed.order : [];
      const known = new Set(savedOrder);
      // Any card key that didn't exist when this was last saved (e.g. a
      // future phase adds a new KPI card) is appended at the end, so it
      // still shows up instead of silently disappearing.
      const order = [...savedOrder, ...defaultKeys.filter((k) => !known.has(k))];
      return {
        order,
        hidden: Array.isArray(parsed.hidden) ? parsed.hidden : [],
        pinned: Array.isArray(parsed.pinned) ? parsed.pinned : [],
        wide: Array.isArray(parsed.wide) ? parsed.wide : [],
      };
    }
  } catch {
    // fall through to defaults
  }
  return { order: defaultKeys, hidden: [], pinned: [], wide: [] };
}

export function useDashboardLayout(defaultKeys) {
  const [layout, setLayout] = useState(() => loadLayout(defaultKeys));

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  }, [layout]);

  const toggleHidden = (key) =>
    setLayout((l) => ({ ...l, hidden: l.hidden.includes(key) ? l.hidden.filter((k) => k !== key) : [...l.hidden, key] }));

  const togglePinned = (key) =>
    setLayout((l) => ({ ...l, pinned: l.pinned.includes(key) ? l.pinned.filter((k) => k !== key) : [...l.pinned, key] }));

  // "Resize" for KPI cards, in a grid layout, means widen a card to
  // span 2 grid columns instead of 1 (a small/wide toggle) rather than
  // freeform pixel resizing — the same discrete-size idea most widget
  // dashboards (Notion, Trello Power-Ups) use for a card grid.
  const toggleWide = (key) =>
    setLayout((l) => ({ ...l, wide: (l.wide || []).includes(key) ? l.wide.filter((k) => k !== key) : [...(l.wide || []), key] }));

  // Move `key` to sit immediately before `beforeKey` in the order array —
  // the operation a drag-and-drop of one card onto another maps to.
  const reorder = (key, beforeKey) =>
    setLayout((l) => {
      if (key === beforeKey) return l;
      const order = l.order.filter((k) => k !== key);
      const idx = order.indexOf(beforeKey);
      if (idx === -1) return l;
      order.splice(idx, 0, key);
      return { ...l, order };
    });

  const reset = () => setLayout({ order: defaultKeys, hidden: [], pinned: [], wide: [] });

  // Applies order + hidden + pinned to an already-computed card list
  // (Dashboard's cardList, values untouched) — pinned cards always float
  // to the front, in their own relative order.
  const arrange = (items) => {
    const byKey = new Map(items.map((i) => [i.key, i]));
    const ordered = layout.order.map((k) => byKey.get(k)).filter(Boolean);
    items.forEach((i) => {
      if (!layout.order.includes(i.key)) ordered.push(i);
    });
    const visible = ordered.filter((i) => !layout.hidden.includes(i.key));
    const pinned = visible.filter((i) => layout.pinned.includes(i.key));
    const rest = visible.filter((i) => !layout.pinned.includes(i.key));
    return [...pinned, ...rest];
  };

  // Same as arrange() but keeps hidden cards too (for the customize
  // panel, which needs to list everything with its show/hide state).
  const arrangeAll = (items) => {
    const byKey = new Map(items.map((i) => [i.key, i]));
    const ordered = layout.order.map((k) => byKey.get(k)).filter(Boolean);
    items.forEach((i) => {
      if (!layout.order.includes(i.key)) ordered.push(i);
    });
    return ordered;
  };

  return { layout, toggleHidden, togglePinned, toggleWide, reorder, reset, arrange, arrangeAll };
}
