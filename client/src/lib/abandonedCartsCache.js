// Phase 22 — session-lifetime cache for the Abandoned Carts management
// page's full-list fetch (GET /api/abandoned-carts, no since/until —
// see AbandonedCartsPage.jsx), same Map pattern as expensesCache.js /
// productsCache.js. Dashboard.jsx's date-range-scoped fetch is separate
// (it's keyed by since/until, not a single fixed key) and is cached in
// its own dashboardAbandonedCartCache.js right alongside it.

const cache = new Map();

export const ABANDONED_CARTS_CACHE_KEY = "abandonedCarts";

export function getCachedAbandonedCarts() {
  return cache.get(ABANDONED_CARTS_CACHE_KEY) || null;
}

export function setCachedAbandonedCarts(data) {
  cache.set(ABANDONED_CARTS_CACHE_KEY, data);
}
