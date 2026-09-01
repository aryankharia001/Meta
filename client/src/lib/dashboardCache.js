// Phase 18 (part 2) — session-lifetime cache for the Dashboard's main
// /compare fetch, same Map pattern as campaignExplorerCache.js /
// analyticsCache.js. Keyed by tokenId+accountIds+since+until, mirroring
// fetchLiveCampaigns' own params. Dashboard previously had zero
// client-side caching (every visit re-fetched and blanked to a loading
// skeleton) — this is the storage layer the new useSwr hook (lib/useSwr.js)
// wraps to give it real stale-while-revalidate behavior.

const cache = new Map();

const keyFor = (tokenId, accountIds, since, until) =>
  `${tokenId}|${[...accountIds].sort().join(",")}|${since}|${until}`;

export function getCachedDashboard(tokenId, accountIds, since, until) {
  return cache.get(keyFor(tokenId, accountIds, since, until)) || null;
}

export function setCachedDashboard(tokenId, accountIds, since, until, data) {
  cache.set(keyFor(tokenId, accountIds, since, until), data);
}

export const dashboardCacheKey = keyFor;


// Campaign History Phase — exported so invalidateOrderMatchingCaches.js (called after a manual historical
// name mapping is added/edited/deleted) can force this session-
// lifetime cache to refetch instead of continuing to serve an
// order-matching result computed before the mapping existed. Every
// existing getter/setter above is untouched — this only ever clears,
// never reads or writes a value.
export function clearDashboardCache() {
  cache.clear();
}
