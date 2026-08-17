// Phase 18 (part 2) — session-lifetime cache for the Operating Expenses
// page (GET /api/expenses), same Map pattern as productsCache.js. One
// global config list, single fixed cache key.

const cache = new Map();

export const EXPENSES_CACHE_KEY = "expenses";

export function getCachedExpenses() {
  return cache.get(EXPENSES_CACHE_KEY) || null;
}

export function setCachedExpenses(data) {
  cache.set(EXPENSES_CACHE_KEY, data);
}
