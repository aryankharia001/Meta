// DEPRECATED as of Phase 25 — AbandonedCartsPage.jsx no longer fetches
// "the full list" (a single fixed cache key doesn't fit a
// search/date-range/page-scoped query anymore, now that records are
// real per-order documents rather than a small, config-like list of
// daily totals); it fetches fresh on every filter/page change instead,
// same pattern as Dashboard.jsx's own abandoned-cart summary fetch.
// Nothing imports this file anymore. Left in place, unused, in case a
// future full-list view wants this exact Map-cache pattern back.
//
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
