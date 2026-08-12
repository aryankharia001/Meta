// Session-lifetime cache for the Customer Drawer (Phase 7), same
// pattern as orderDetailsCache.js. Keyed by phone number.

const cache = new Map();

export function getCachedCustomerDetails(phone) {
  return cache.get(phone) || null;
}

export function setCachedCustomerDetails(phone, data) {
  cache.set(phone, data);
}
