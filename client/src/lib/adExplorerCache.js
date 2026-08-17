// Phase 18 (part 2) — session-lifetime cache for the Ad Explorer page
// (GET /api/ad-explorer/:tokenId), same Map pattern as
// adSetExplorerCache.js. Keyed by tokenId+accountIds+since+until, plus
// the optional campaignId/adsetId deep-link filters this page can be
// opened with (from an Ad Set Drawer's "View Ads" action) — those change
// what's actually fetched (see fetchAds' params), so they're part of the
// key too.

const cache = new Map();

const keyFor = (tokenId, accountIds, since, until, campaignId, adsetId) =>
  `${tokenId}|${[...accountIds].sort().join(",")}|${since}|${until}|${campaignId || ""}|${adsetId || ""}`;

export function getCachedAdExplorer(tokenId, accountIds, since, until, campaignId, adsetId) {
  return cache.get(keyFor(tokenId, accountIds, since, until, campaignId, adsetId)) || null;
}

export function setCachedAdExplorer(tokenId, accountIds, since, until, campaignId, adsetId, data) {
  cache.set(keyFor(tokenId, accountIds, since, until, campaignId, adsetId), data);
}

export const adExplorerCacheKey = keyFor;
