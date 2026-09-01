// Phase 18 (part 2) — session-lifetime cache for the "Orders" testing
// page (OrdersTesting.jsx, GET /api/orders/orders), same Map pattern as
// dashboardCache.js. This endpoint takes only since/until — no tokenId,
// no ad accounts — so the key is just the date range.

const cache = new Map();

const keyFor = (since, until) => `${since}|${until}`;

export function getCachedOrdersReport(since, until) {
  return cache.get(keyFor(since, until)) || null;
}

export function setCachedOrdersReport(since, until, data) {
  cache.set(keyFor(since, until), data);
}

export const ordersReportCacheKey = keyFor;


// Campaign History Phase — exported so invalidateOrderMatchingCaches.js (called after a manual historical
// name mapping is added/edited/deleted) can force this session-
// lifetime cache to refetch instead of continuing to serve an
// order-matching result computed before the mapping existed. Every
// existing getter/setter above is untouched — this only ever clears,
// never reads or writes a value.
export function clearOrdersTestingCache() {
  cache.clear();
}
