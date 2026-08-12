// Session-lifetime cache for the campaign drawer (Phase 2 "Performance"
// requirement: fetch details only when a campaign is opened, cache the
// response, reuse it on reopen, avoid unnecessary requests).
//
// A plain module-level Map is enough here — it lives for as long as the
// SPA tab is open (resets on a hard refresh, same as everything else in
// this app that isn't in localStorage), and every consumer imports the
// same module instance so it's shared across pages without any Context
// wiring.

const cache = new Map();

const keyFor = (tokenId, campaignId, accountId, since, until) =>
  [tokenId, campaignId, accountId || "", since, until].join("::");

export function getCachedCampaignDetails(tokenId, campaignId, accountId, since, until) {
  return cache.get(keyFor(tokenId, campaignId, accountId, since, until)) || null;
}

export function setCachedCampaignDetails(tokenId, campaignId, accountId, since, until, data) {
  cache.set(keyFor(tokenId, campaignId, accountId, since, until), data);
}

export function clearCampaignDetailsCache() {
  cache.clear();
}
