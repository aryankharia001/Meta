// Phase 18 (part 2) — session-lifetime cache for the Profitability page's
// 5 tabs (Overview/summary, Campaign Profit, Daily Profit, COD vs
// Prepaid, Product Profitability), same Map-per-domain pattern as
// dashboardCache.js / campaignExplorerCache.js. One Map per tab so a
// cache hit/miss on one tab's data never touches another's — each tab
// already fetches fully independently (own loading/error state) in
// ProfitabilityPage.jsx, this just mirrors that at the storage layer.
//
// All five are keyed by tokenId+accountIds+since+until — none of them
// take the page's `refreshKey` (that's a pure "force a real refetch now"
// signal, not part of "what data to fetch", so it's deliberately not part
// of the cache key; see the per-tab refreshKey-watching effect in
// ProfitabilityPage.jsx that calls the SWR hook's refresh() instead).
// The Hourly Profit modal (opened per-date, from the Daily tab) is a
// drill-down popup, not one of the 5 tabs, and isn't cached here — same
// as the other expense drill-down popups this page already has.

const summaryCache = new Map();
const campaignsCache = new Map();
const dailyCache = new Map();
const codPrepaidCache = new Map();
const productsCache = new Map();

const keyFor = (tokenId, accountIds, since, until) =>
  `${tokenId}|${[...accountIds].sort().join(",")}|${since}|${until}`;

export function getCachedProfitSummary(tokenId, accountIds, since, until) {
  return summaryCache.get(keyFor(tokenId, accountIds, since, until)) || null;
}
export function setCachedProfitSummary(tokenId, accountIds, since, until, data) {
  summaryCache.set(keyFor(tokenId, accountIds, since, until), data);
}

export function getCachedProfitCampaigns(tokenId, accountIds, since, until) {
  return campaignsCache.get(keyFor(tokenId, accountIds, since, until)) || null;
}
export function setCachedProfitCampaigns(tokenId, accountIds, since, until, data) {
  campaignsCache.set(keyFor(tokenId, accountIds, since, until), data);
}

export function getCachedProfitDaily(tokenId, accountIds, since, until) {
  return dailyCache.get(keyFor(tokenId, accountIds, since, until)) || null;
}
export function setCachedProfitDaily(tokenId, accountIds, since, until, data) {
  dailyCache.set(keyFor(tokenId, accountIds, since, until), data);
}

export function getCachedProfitCodPrepaid(tokenId, accountIds, since, until) {
  return codPrepaidCache.get(keyFor(tokenId, accountIds, since, until)) || null;
}
export function setCachedProfitCodPrepaid(tokenId, accountIds, since, until, data) {
  codPrepaidCache.set(keyFor(tokenId, accountIds, since, until), data);
}

export function getCachedProfitProducts(tokenId, accountIds, since, until) {
  return productsCache.get(keyFor(tokenId, accountIds, since, until)) || null;
}
export function setCachedProfitProducts(tokenId, accountIds, since, until, data) {
  productsCache.set(keyFor(tokenId, accountIds, since, until), data);
}

export const profitCacheKey = keyFor;


// Campaign History Phase — exported so invalidateOrderMatchingCaches.js (called after a manual historical
// name mapping is added/edited/deleted) can force this session-
// lifetime cache to refetch instead of continuing to serve an
// order-matching result computed before the mapping existed. Every
// existing getter/setter above is untouched — this only ever clears,
// never reads or writes a value.
export function clearProfitabilityCache() {
  summaryCache.clear();
  campaignsCache.clear();
  dailyCache.clear();
  codPrepaidCache.clear();
  productsCache.clear();
}
