// Phase 8 — session-lifetime cache for Campaign Explorer, same Map
// pattern as analyticsCache.js / campaignDetailsCache.js. Keyed by
// tokenId+accountIds+since+until for the main list, and by
// tokenId+campaignId+since+until for a single campaign's lazy-loaded
// breakdown — avoids re-fetching Meta insights (the slow part) when a
// user just re-opens the page or re-expands a row they already loaded
// in this session. The server also caches (campaignExplorer.js, 45s
// TTL) — this is the client-side layer on top, same two-tier pattern
// Phase 6's Analytics page already uses (server has none, client does;
// here both exist since Explorer's Graph API calls are heavier).

const listCache = new Map();
const breakdownCache = new Map();
const liveCache = new Map();

const listKey = (tokenId, accountIds, since, until) => `${tokenId}|${[...accountIds].sort().join(",")}|${since}|${until}`;
const breakdownKey = (tokenId, campaignId, since, until) => `${tokenId}|${campaignId}|${since}|${until}`;
const liveKey = (tokenId, accountIds) => `${tokenId}|${[...accountIds].sort().join(",")}`;

export function getCachedExplorerList(tokenId, accountIds, since, until) {
  return listCache.get(listKey(tokenId, accountIds, since, until)) || null;
}
export function setCachedExplorerList(tokenId, accountIds, since, until, data) {
  listCache.set(listKey(tokenId, accountIds, since, until), data);
}

export function getCachedCampaignBreakdown(tokenId, campaignId, since, until) {
  return breakdownCache.get(breakdownKey(tokenId, campaignId, since, until)) || null;
}
export function setCachedCampaignBreakdown(tokenId, campaignId, since, until, data) {
  breakdownCache.set(breakdownKey(tokenId, campaignId, since, until), data);
}

// Live data is intentionally NOT read from cache by default (it's
// "today", meant to be fresh on every live-sync tick) — this is only
// here so the Live section can show last-known data instantly while a
// background refresh is in flight, same "keep stale data on screen
// while refreshing" pattern Phase 5's LiveSyncContext established.
export function getCachedLiveExplorer(tokenId, accountIds) {
  return liveCache.get(liveKey(tokenId, accountIds)) || null;
}
export function setCachedLiveExplorer(tokenId, accountIds, data) {
  liveCache.set(liveKey(tokenId, accountIds), data);
}
