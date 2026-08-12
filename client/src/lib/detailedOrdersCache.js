// Session-lifetime cache for the Phase 3 dashboard popups, same pattern
// as campaignDetailsCache.js from Phase 2. Every popup that needs
// order-level detail (Total Orders, Unmatched, Outside Range, COD,
// Prepaid, delivery-status popups) shares ONE cached fetch per
// (token, selected accounts, date range) — opening a second popup, or
// reopening the same one, never re-fetches as long as the dashboard's
// date filter and selected accounts haven't changed.

const cache = new Map();

const keyFor = (tokenId, accountsKey, since, until) => [tokenId, accountsKey, since, until].join("::");

export function getCachedDetailedOrders(tokenId, accountsKey, since, until) {
  return cache.get(keyFor(tokenId, accountsKey, since, until)) || null;
}

export function setCachedDetailedOrders(tokenId, accountsKey, since, until, data) {
  cache.set(keyFor(tokenId, accountsKey, since, until), data);
}
