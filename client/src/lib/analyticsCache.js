// Session-lifetime cache for the Analytics page (Phase 6), same Map
// pattern as campaignDetailsCache.js / detailedOrdersCache.js /
// orderDetailsCache.js. Keyed by tokenId+since+until — the analytics
// endpoint isn't scoped by ad account (orders aren't stored per-account,
// same as everywhere else in this app), so those don't need to be part
// of the key.

const cache = new Map();
const keyOf = (tokenId, since, until) => `${tokenId}|${since}|${until}`;

export function getCachedAnalyticsOrders(tokenId, since, until) {
  return cache.get(keyOf(tokenId, since, until)) || null;
}

export function setCachedAnalyticsOrders(tokenId, since, until, data) {
  cache.set(keyOf(tokenId, since, until), data);
}

// Phase 18 (part 2) — exported so the new useSwr hook (lib/useSwr.js) can
// build the identical string this file uses internally as the page's SWR
// cache key. Additive only — both functions above are untouched.
export const analyticsOrdersCacheKey = keyOf;
