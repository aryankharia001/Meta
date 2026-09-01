// Phase 18 (part 2) — session-lifetime cache for the Daily page's
// GET /api/daily/:tokenId fetch, same Map pattern as dashboardCache.js.
// Keyed by tokenId+accountIds+since+until, mirroring fetchDailyReport's
// own params.

const cache = new Map();

const keyFor = (tokenId, accountIds, since, until) =>
  `${tokenId}|${[...accountIds].sort().join(",")}|${since}|${until}`;

export function getCachedDailyReport(tokenId, accountIds, since, until) {
  return cache.get(keyFor(tokenId, accountIds, since, until)) || null;
}

export function setCachedDailyReport(tokenId, accountIds, since, until, data) {
  cache.set(keyFor(tokenId, accountIds, since, until), data);
}

export const dailyReportCacheKey = keyFor;


// Campaign History Phase — exported so invalidateOrderMatchingCaches.js (called after a manual historical
// name mapping is added/edited/deleted) can force this session-
// lifetime cache to refetch instead of continuing to serve an
// order-matching result computed before the mapping existed. Every
// existing getter/setter above is untouched — this only ever clears,
// never reads or writes a value.
export function clearDailyReportCache() {
  cache.clear();
}
