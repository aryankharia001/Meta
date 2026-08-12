// Phase 7 — Recently Viewed tracking. localStorage-backed (this app has
// no auth, so "recently viewed" is inherently a per-browser concept —
// same reasoning as PreferencesContext). Recorded from inside
// CampaignDrawer/OrderDrawer/CustomerDrawer's own open-effects
// (additive useEffect, doesn't change what those drawers already do —
// same non-invasive pattern Phase 5 used to subscribe those files to
// LiveSyncContext). A tiny window "event" lets the Dashboard's Recently
// Viewed widget react live without a context provider for something
// this simple.

const STORAGE_KEY = "recentlyViewed.v1";
const MAX_ITEMS = 20;
const EVENT_NAME = "recently-viewed-changed";

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function save(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  window.dispatchEvent(new CustomEvent(EVENT_NAME));
}

export function getRecentlyViewed(type) {
  const list = load();
  return type ? list.filter((item) => item.type === type) : list;
}

// type: "campaign" | "order" | "customer"
export function recordRecentlyViewed(type, id, label, meta = {}) {
  if (!type || !id) return;
  const list = load().filter((item) => !(item.type === type && item.id === id));
  list.unshift({ type, id, label: label || id, meta, viewedAt: new Date().toISOString() });
  save(list.slice(0, MAX_ITEMS));
}

export function clearRecentlyViewed() {
  save([]);
}

export function subscribeRecentlyViewed(callback) {
  window.addEventListener(EVENT_NAME, callback);
  return () => window.removeEventListener(EVENT_NAME, callback);
}
