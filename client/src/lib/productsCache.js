// Phase 18 (part 2) — session-lifetime cache for the Product Costs page
// (GET /api/products), same Map pattern as dashboardCache.js. This list
// isn't scoped by token/account/date — it's one global config list — so
// there's a single fixed cache key rather than a compound one.

const cache = new Map();

export const PRODUCTS_CACHE_KEY = "products";

export function getCachedProducts() {
  return cache.get(PRODUCTS_CACHE_KEY) || null;
}

export function setCachedProducts(data) {
  cache.set(PRODUCTS_CACHE_KEY, data);
}
