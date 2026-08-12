// Session-lifetime cache for the Order Drawer (Phase 4), same pattern as
// campaignDetailsCache.js / detailedOrdersCache.js. Keyed purely by
// orderId — an order's own record doesn't depend on the dashboard's date
// range or selected accounts, so reopening the same order anywhere in
// the app (Campaign Drawer, a KPI popup, a customer's order history
// list, ...) reuses one fetch. "Refetch only if the dashboard refreshes"
// (Phase 4 spec) is honored by the drawer's own manual refresh button —
// nothing here auto-invalidates on a timer or on every reopen.

const cache = new Map();

export function getCachedOrderDetails(orderId) {
  return cache.get(orderId) || null;
}

export function setCachedOrderDetails(orderId, data) {
  cache.set(orderId, data);
}

// Notes are the one thing that can change without a full refetch (add/
// edit/delete) — patch the cached copy so closing and reopening the
// drawer for the same order shows the latest notes without a network
// call.
export function patchCachedOrderNotes(orderId, notes) {
  const existing = cache.get(orderId);
  if (existing) cache.set(orderId, { ...existing, notes });
}
