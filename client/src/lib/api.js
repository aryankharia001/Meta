import axios from "axios";

const API_BASE = import.meta.env.VITE_API_URL;

export const api = axios.create({
  baseURL: API_BASE,
  headers: { "Content-Type": "application/json" },
  // Phase 14 §3 — required so the browser sends/receives the httpOnly
  // session cookie set by POST /api/auth/login. Every existing call in
  // this file already goes through this one axios instance, so this is
  // the single place this needs to change for auth to work anywhere.
  withCredentials: true,
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    const msg = err.response?.data?.message || err.message || "Something went wrong";
    const wrapped = new Error(msg);
    wrapped.status = err.response?.status;
    // Phase 14 §1/§3 — a 401 from any protected route (session expired,
    // cookie cleared, account disabled mid-session) means we're no
    // longer authenticated. Broadcast it instead of importing
    // AuthContext here (would be a circular import); AuthContext listens
    // and flips back to the Login page. /auth/* is excluded so a wrong-
    // password attempt on the login form itself doesn't trigger this.
    if (err.response?.status === 401 && !String(err.config?.url || "").includes("/auth/")) {
      window.dispatchEvent(new CustomEvent("auth:unauthorized"));
    }
    return Promise.reject(wrapped);
  }
);

// ─── Auth ──────────────────────────────────────────────────
// Phase 14 §1/§3. Kept together, self-contained, at the top of this
// file (same convention as the rest of the app's grouped API helpers
// below) — no other module needs to know these exist except
// AuthContext.jsx.

export async function loginRequest(email, password) {
  const { data } = await api.post("/auth/login", { email, password });
  return data; // { success, user: { id, email, role } }
}

export async function logoutRequest() {
  const { data } = await api.post("/auth/logout");
  return data;
}

export async function fetchCurrentUser() {
  const { data } = await api.get("/auth/me");
  return data; // { success, user }
}

export async function changePasswordRequest(currentPassword, newPassword) {
  const { data } = await api.post("/auth/change-password", { currentPassword, newPassword });
  return data;
}

// ─── User management (admin only) ────────────────────────────

export async function fetchUsers() {
  const { data } = await api.get("/users");
  return data; // { success, users }
}

export async function createUser(payload) {
  const { data } = await api.post("/users", payload);
  return data;
}

export async function updateUser(id, payload) {
  const { data } = await api.patch(`/users/${id}`, payload);
  return data;
}

export async function resetUserPassword(id, newPassword) {
  const { data } = await api.patch(`/users/${id}/password`, { newPassword });
  return data;
}

export async function deleteUser(id) {
  const { data } = await api.delete(`/users/${id}`);
  return data;
}


// Add these alongside your existing fetchCampaigns / fetchTokens functions
// in lib/api.js. They assume the same base-url/response-shape conventions
// (a GET helper returning parsed JSON, and the backend's { success, data }
// envelope) that the rest of that file already uses — adjust the request
// helper name if yours differs.
// ─── Orders ───────────────────────────────────────────────

export async function fetchOrders(params = {}) {
  // Strip empty/undefined filters so they don't show up as ?campaignId=&...
  const cleaned = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== "" && v !== undefined && v !== null)
  );
  const { data } = await api.get("/orders", { params: cleaned });
  return data; // { success, data, pagination }
}

export async function fetchOrderFilterOptions() {
  const { data } = await api.get("/orders/filters/options");
  return data; // { success, data: { campaigns, adsets, adIds } }
}

// ─── Tokens ────────────────────────────────────────────────

export async function fetchTokens() {
  const { data } = await api.get("/tokens");
  return data;
}

export async function createToken(payload) {
  const { data } = await api.post("/tokens", payload);
  return data;
}

export async function updateToken(id, payload) {
  const { data } = await api.put(`/tokens/${id}`, payload);
  return data;
}

export async function deleteToken(id) {
  const { data } = await api.delete(`/tokens/${id}`);
  return data;
}

// ─── Ad Accounts ──────────────────────────────────────────

export async function fetchFbAdAccounts(accessToken) {
  const { data } = await api.get("/fb/adaccounts", { params: { access_token: accessToken } });
  return data;
}

// Ad accounts saved locally in Mongo for this token (from a prior sync).
export async function fetchAdAccounts(tokenId) {
  const { data } = await api.get(`/adaccounts/${tokenId}`);
  return data; // plain array
}

// Live ad accounts pulled straight from the Meta Graph API for this token
// (GET /api/adaccounts/adaccounts/:tokenId) — always current, doesn't rely
// on anything being synced into Mongo first.
export async function fetchLiveAdAccounts(tokenId) {
  const { data } = await api.get(`/adaccounts/adaccounts/${tokenId}`);
  return data; // { success, adAccounts }
}

export async function linkAdAccounts(tokenId, accounts) {
  const { data } = await api.post(`/adaccounts/${tokenId}/adaccounts/bulk`, { accounts });
  return data;
}

export async function addSingleAdAccount(tokenId, account) {
  const { data } = await api.post(`/adaccounts/${tokenId}/adaccounts`, account);
  return data;
}

export async function deleteAdAccount(id) {
  const { data } = await api.delete(`/adaccounts/${id}`);
  return data;
}

// ─── Sync ─────────────────────────────────────────────────

export async function syncAccount(tokenId, adAccountId, includeAds = true) {
  const { data } = await api.post(`/campaigns/sync/${tokenId}`, { adAccountId, includeAds });
  return data;
}

// ─── Campaigns ────────────────────────────────────────────

// since/until (YYYY-MM-DD, IST calendar days) are optional — pass them to
// scope the campaign list down to campaigns actually active during that
// range (see the isActiveInRange filter in server/routes/campaigns.js).
// Omit them and you get every synced campaign, same as before — that's
// what the plain Campaigns.jsx browser page still does.
export async function fetchCampaigns(tokenId, adAccountId, since, until) {
  const params = {};
  if (adAccountId) params.adAccountId = adAccountId;
  if (since) params.since = since;
  if (until) params.until = until;
  const { data } = await api.get(`/campaigns/${tokenId}`, {
    params: Object.keys(params).length ? params : undefined,
  });
  return data;
}

// ─── Insights ─────────────────────────────────────────────

export async function fetchInsights(tokenId, { accountIds, since, until }) {
  const { data } = await api.get(`/insights/${tokenId}`, {
    params: { accountIds, since, until },
  });
  return data;
}

// ─── Order stats / comparison ──────────────────────────────

export async function fetchOrderStats(tokenId, params = {}) {
  const cleaned = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== "" && v !== undefined && v !== null)
  );
  const { data } = await api.get(`/orders/stats/${tokenId}`, { params: cleaned });
  return data; // { success, data }
}

export async function fetchOrderDetails(tokenId, params = {}) {
  const cleaned = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== "" && v !== undefined && v !== null)
  );
  const { data } = await api.get(`/orders/stats/${tokenId}/orders`, { params: cleaned });
  return data; // { success, data: { orders, pagination } }
}

// ─── Live order tracking ────────────────────────────────────
// Order-volume-over-time view (orders 1h/2h/3h ago, hourly breakdown),
// sourced purely from Mongo (the existing 30-min Shiprocket sync) —
// never calls Shiprocket directly.

export async function fetchLiveTracking({ since, until } = {}) {
  const params = {};
  if (since) params.since = since;
  if (until) params.until = until;
  const { data } = await api.get("/orders/live-tracking", {
    params: Object.keys(params).length ? params : undefined,
  });
  return data; // { success, since, until, generatedAt, recent, hourly, totalOrders, totalRevenue }
}

// ─── Live campaign tracking ─────────────────────────────────
// Reuses the existing, already-working GET /campaigns/:tokenId/compare
// endpoint (spend + matched Shiprocket orders per campaign from Meta),
// scoped to a since/until range and polled on an interval — no new
// backend route needed for this.

export async function fetchLiveCampaigns(tokenId, { accountIds, since, until }) {
  const params = new URLSearchParams();
  params.append("since", since);
  params.append("until", until ?? since);
  (Array.isArray(accountIds) ? accountIds : [accountIds]).forEach((id) =>
    params.append("adAccountId", id)
  );
  const { data } = await api.get(`/campaigns/${tokenId}/compare?${params}`);
  return data;
}

// ─── Campaign details (drawer) ──────────────────────────────
// New in Phase 2 — GET /campaigns/:tokenId/:campaignId/details. Fetched
// only when a campaign is opened (see CampaignDrawer.jsx +
// campaignDetailsCache.js), never eagerly. Does not touch/replace
// fetchLiveCampaigns above.

export async function fetchCampaignDetails(tokenId, campaignId, { campaignName, accountId, since, until }) {
  const params = { campaignName, since, until };
  if (accountId) params.accountId = accountId;
  const { data } = await api.get(`/campaigns/${tokenId}/${campaignId}/details`, { params });
  return data; // { success, campaign, metaInsights, orders, since, until }
}

// ─── Orders, detailed (dashboard KPI popups) ────────────────
// New in Phase 3 — GET /campaigns/:tokenId/orders-detailed. Backs the
// dashboard's KPI popups (Total Orders, Unmatched, Outside Range, COD,
// Prepaid, delivery status...). Fetched lazily, once, the first time any
// popup that needs order-level detail is opened — see
// detailedOrdersCache.js — never on dashboard page load.

export async function fetchOrdersDetailed(tokenId, { accountIds, since, until }) {
  const params = new URLSearchParams();
  params.append("since", since);
  params.append("until", until);
  (Array.isArray(accountIds) ? accountIds : [accountIds]).filter(Boolean).forEach((id) =>
    params.append("adAccountId", id)
  );
  const { data } = await api.get(`/campaigns/${tokenId}/orders-detailed?${params}`);
  return data; // { success, orders, knownCampaignNames, since, until }
}

// ─── Order Drawer (Phase 4) ─────────────────────────────────
// New — GET /order-details/:orderId. Fetched lazily, once, the first
// time the Order Drawer opens for a given order — see
// orderDetailsCache.js. Independent of the dashboard's date range/
// selected accounts (an order's own record doesn't change with them),
// so the cache key here is just the order id.

export async function fetchOrderDetailsFull(orderId) {
  const { data } = await api.get(`/order-details/${orderId}`);
  return data; // { success, order, customerHistory, notes }
}

export async function addOrderNote(orderId, text, author) {
  const { data } = await api.post(`/order-details/${orderId}/notes`, { text, author });
  return data; // { success, note }
}

export async function updateOrderNote(noteId, text, author) {
  const { data } = await api.put(`/order-details/notes/${noteId}`, { text, author });
  return data; // { success, note }
}

export async function deleteOrderNote(noteId) {
  const { data } = await api.delete(`/order-details/notes/${noteId}`);
  return data; // { success }
}

// ─── Live Sync (Phase 5) ─────────────────────────────────────
// New — POST /live-sync/run. Delegates entirely to the existing,
// untouched backfillShiprocketRange() write path on the backend (see
// server/routes/liveSync.js) — this just triggers it and reports a
// before/after diff. Called on a timer by LiveSyncContext (every 10s)
// and on-demand by the dashboard's Refresh Now button.

export async function runLiveSync() {
  const { data } = await api.post("/live-sync/run");
  return data; // { success, alreadyRunning, syncedAt, ordersProcessed, newOrders, updatedOrders, failedOrders, syncError, newOrderRecords }
}

// ─── Analytics (Phase 6) ─────────────────────────────────────
// New — GET /analytics/:tokenId/orders. Fetched lazily, once, only when
// the Analytics page is opened (see analyticsCache.js) — never on
// dashboard load. Every analytics section derives its own aggregates
// from this one enriched order list client-side.

export async function fetchAnalyticsOrders(tokenId, { since, until }) {
  const { data } = await api.get(`/analytics/${tokenId}/orders`, { params: { since, until } });
  return data; // { success, since, until, orders }
}

// ─── Favorites (Phase 7) ──────────────────────────────────────

export async function fetchFavorites(entityType) {
  const { data } = await api.get("/favorites", { params: entityType ? { entityType } : undefined });
  return data; // { success, favorites }
}
export async function addFavorite(entityType, entityId, label, meta) {
  const { data } = await api.post("/favorites", { entityType, entityId, label, meta });
  return data; // { success, favorite }
}
export async function removeFavorite(entityType, entityId) {
  const { data } = await api.delete(`/favorites/${entityType}/${encodeURIComponent(entityId)}`);
  return data; // { success }
}

// ─── Saved Views (Phase 7) ────────────────────────────────────

export async function fetchSavedViews(page) {
  const { data } = await api.get("/saved-views", { params: page ? { page } : undefined });
  return data; // { success, views }
}
export async function createSavedView(name, page, filters) {
  const { data } = await api.post("/saved-views", { name, page, filters });
  return data; // { success, view }
}
export async function renameSavedView(id, name) {
  const { data } = await api.put(`/saved-views/${id}`, { name });
  return data; // { success, view }
}
export async function deleteSavedView(id) {
  const { data } = await api.delete(`/saved-views/${id}`);
  return data; // { success }
}

// ─── Entity Notes — campaigns & customers (Phase 7) ───────────
// Orders keep using addOrderNote/updateOrderNote/deleteOrderNote above
// (Phase 4, untouched) — this is only for the two entity types that
// didn't have notes before.

export async function fetchEntityNotes(entityType, entityId) {
  const { data } = await api.get(`/entity-notes/${entityType}/${encodeURIComponent(entityId)}`);
  return data; // { success, notes }
}
export async function addEntityNote(entityType, entityId, text, author) {
  const { data } = await api.post(`/entity-notes/${entityType}/${encodeURIComponent(entityId)}`, { text, author });
  return data; // { success, note }
}
export async function updateEntityNote(noteId, text, author) {
  const { data } = await api.put(`/entity-notes/notes/${noteId}`, { text, author });
  return data; // { success, note }
}
export async function deleteEntityNote(noteId) {
  const { data } = await api.delete(`/entity-notes/notes/${noteId}`);
  return data; // { success }
}

// ─── Activity Log (Phase 7) ───────────────────────────────────

export async function fetchActivityLog(params = {}) {
  const cleaned = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== "" && v !== undefined && v !== null));
  const { data } = await api.get("/activity-log", { params: cleaned });
  return data; // { success, entries }
}
// Phase 14 §7 — entityType/entityId are optional (e.g. "order"/orderId,
// "campaign"/campaignId) so log entries can record which specific thing
// an action touched; `user` is always attributed server-side from the
// logged-in session, never trusted from this call.
export async function logActivity(type, message, meta, entityType, entityId) {
  // Fire-and-forget from the caller's perspective — activity logging
  // should never block or fail the action it's describing.
  return api.post("/activity-log", { type, message, meta, entityType, entityId }).catch(() => {});
}

// ─── Global Search / Command Palette (Phase 7) ────────────────

export async function globalSearch(q) {
  const { data } = await api.get("/search", { params: { q } });
  return data; // { success, orders, campaigns, customers }
}

// ─── Customer Drawer (Phase 7) ─────────────────────────────────

export async function fetchCustomerByPhone(phone) {
  const { data } = await api.get(`/customers/${encodeURIComponent(phone)}`);
  return data; // { success, customer, orders }
}

// ─── Campaign Explorer (Phase 8) ────────────────────────────────
// New, additive routes at /api/campaign-explorer — never touches
// /campaigns/:tokenId/compare or the campaign drawer's own endpoint.

export async function fetchCampaignExplorer(tokenId, { accountIds, since, until }) {
  const params = new URLSearchParams();
  params.append("since", since);
  params.append("until", until ?? since);
  (Array.isArray(accountIds) ? accountIds : [accountIds]).forEach((id) => params.append("adAccountId", id));
  const { data } = await api.get(`/campaign-explorer/${tokenId}?${params}`);
  return data; // { success, since, until, campaigns, summary }
}

export async function fetchLiveCampaignExplorer(tokenId, { accountIds }) {
  const params = new URLSearchParams();
  (Array.isArray(accountIds) ? accountIds : [accountIds]).forEach((id) => params.append("adAccountId", id));
  const { data } = await api.get(`/campaign-explorer/${tokenId}/live?${params}`);
  return data; // { success, date, campaigns, allCampaigns, summary }
}

export async function fetchCampaignBreakdown(tokenId, campaignId, { campaignName, accountId, since, until }) {
  const params = { campaignName, since, until };
  if (accountId) params.accountId = accountId;
  const { data } = await api.get(`/campaign-explorer/${tokenId}/${campaignId}/breakdown`, { params });
  return data; // { success, trend, paymentSplit, deliveryDistribution, topProducts, topCities, topStates }
}

// ─── Daily Reports (Phase 10) ────────────────────────────────────
// New, additive routes at /api/daily — never touches /compare, Campaign
// Explorer, or the campaign drawer's own endpoints.

export async function fetchDailyReport(tokenId, { accountIds, since, until }) {
  const params = new URLSearchParams();
  params.append("since", since);
  params.append("until", until ?? since);
  (Array.isArray(accountIds) ? accountIds : [accountIds]).forEach((id) => params.append("adAccountId", id));
  const { data } = await api.get(`/daily/${tokenId}?${params}`);
  return data; // { success, since, until, days: [{ date, campaigns, totals }], totals }
}

export async function fetchDailyDetail(tokenId, { date, campaignId, campaignName, accountId }) {
  const params = { date, campaignName };
  if (campaignId) params.campaignId = campaignId;
  if (accountId) params.accountId = accountId;
  const { data } = await api.get(`/daily/${tokenId}/detail`, { params });
  return data; // { success, date, campaign, metrics, orders, dayStartIst, dayEndIst }
}

// ─── Ad Set Explorer (Phase 13 §4/§10) ───────────────────────────
// New, additive routes at /api/adset-explorer — never touches
// /campaign-explorer, /daily, or /campaigns' own endpoints.

export async function fetchAdSets(tokenId, { accountIds, since, until, campaignId }) {
  const params = new URLSearchParams();
  params.append("since", since);
  params.append("until", until ?? since);
  if (campaignId) params.append("campaignId", campaignId);
  (Array.isArray(accountIds) ? accountIds : [accountIds]).filter(Boolean).forEach((id) => params.append("adAccountId", id));
  const { data } = await api.get(`/adset-explorer/${tokenId}?${params}`);
  return data; // { success, since, until, adsets, summary }
}

// Ad sets nested under one campaign, fetched directly off the campaign
// object — no adAccountId needed. Used by CampaignDrawer's Ad Sets
// section and any Campaign → Ad Set expandable-row hierarchy.
export async function fetchAdSetsByCampaign(tokenId, campaignId, { since, until } = {}) {
  const params = {};
  if (since) params.since = since;
  if (until) params.until = until;
  const { data } = await api.get(`/adset-explorer/${tokenId}/by-campaign/${campaignId}`, { params });
  return data; // { success, campaignId, adsets }
}

export async function fetchAdSetDetails(tokenId, adsetId, { since, until } = {}) {
  const params = {};
  if (since) params.since = since;
  if (until) params.until = until;
  const { data } = await api.get(`/adset-explorer/${tokenId}/${adsetId}/details`, { params });
  return data; // { success, adset, metaInsights, orders }
}

export async function fetchAdSetOrders(tokenId, adsetId, { since, until } = {}) {
  const params = {};
  if (since) params.since = since;
  if (until) params.until = until;
  const { data } = await api.get(`/adset-explorer/${tokenId}/${adsetId}/orders`, { params });
  return data; // { success, since, until, orders }
}

// ─── Ad Explorer + creative details (Phase 13 §5/§6/§9) ──────────
// New, additive routes at /api/ad-explorer.

export async function fetchAds(tokenId, { accountIds, since, until, campaignId, adsetId }) {
  const params = new URLSearchParams();
  params.append("since", since);
  params.append("until", until ?? since);
  if (campaignId) params.append("campaignId", campaignId);
  if (adsetId) params.append("adsetId", adsetId);
  (Array.isArray(accountIds) ? accountIds : [accountIds]).filter(Boolean).forEach((id) => params.append("adAccountId", id));
  const { data } = await api.get(`/ad-explorer/${tokenId}?${params}`);
  return data; // { success, since, until, ads, summary }
}

// Ads nested under one ad set, fetched directly off the ad set object —
// no adAccountId needed. Used by AdSetDrawer's Ads section.
export async function fetchAdsByAdSet(tokenId, adsetId, { since, until } = {}) {
  const params = {};
  if (since) params.since = since;
  if (until) params.until = until;
  const { data } = await api.get(`/ad-explorer/${tokenId}/by-adset/${adsetId}`, { params });
  return data; // { success, adsetId, ads }
}

export async function fetchAdDetails(tokenId, adId, { since, until } = {}) {
  const params = {};
  if (since) params.since = since;
  if (until) params.until = until;
  const { data } = await api.get(`/ad-explorer/${tokenId}/${adId}/details`, { params });
  return data; // { success, ad, metaInsights, orders }
}

export async function fetchAdOrders(tokenId, adId, { since, until } = {}) {
  const params = {};
  if (since) params.since = since;
  if (until) params.until = until;
  const { data } = await api.get(`/ad-explorer/${tokenId}/${adId}/orders`, { params });
  return data; // { success, since, until, orders }
}

export async function fetchAdCreative(tokenId, adId, { refresh } = {}) {
  const params = {};
  if (refresh) params.refresh = "1";
  const { data } = await api.get(`/ad-explorer/${tokenId}/${adId}/creative`, { params });
  return data; // { success, cached, creative }
}

// Batch id → name/context resolver, used so an orders table full of
// ad/ad-set ids can show names without loading the full Ad Explorer
// list. `adIds`/`adsetIds` are arrays; either may be omitted.
export async function resolveAdAttribution(tokenId, { adIds = [], adsetIds = [] }) {
  const params = {};
  if (adIds.length) params.adIds = adIds.join(",");
  if (adsetIds.length) params.adsetIds = adsetIds.join(",");
  if (!params.adIds && !params.adsetIds) return { success: true, ads: [], adsets: [] };
  const { data } = await api.get(`/ad-explorer/${tokenId}/resolve`, { params });
  return data; // { success, ads, adsets }
}

// ─── Hourly Performance (Phase 13 §1/§2/§11/§15) ──────────────────
// New, additive routes at /api/hourly.

export async function fetchHourlyReport(tokenId, { accountIds, date, campaignId, adsetId, adId } = {}) {
  const params = new URLSearchParams();
  params.append("date", date);
  if (campaignId) params.append("campaignId", campaignId);
  if (adsetId) params.append("adsetId", adsetId);
  if (adId) params.append("adId", adId);
  (Array.isArray(accountIds) ? accountIds : [accountIds]).filter(Boolean).forEach((id) => params.append("adAccountId", id));
  const { data } = await api.get(`/hourly/${tokenId}?${params}`);
  return data; // { success, date, scope, metaHourlyAvailable, hours, summary }
}

export async function fetchHourlyOrders(tokenId, { date, hour, campaignId, campaignName, adsetId, adId, paymentType } = {}) {
  const params = { date, hour };
  if (campaignId) params.campaignId = campaignId;
  if (campaignName) params.campaignName = campaignName;
  if (adsetId) params.adsetId = adsetId;
  if (adId) params.adId = adId;
  if (paymentType) params.paymentType = paymentType;
  const { data } = await api.get(`/hourly/${tokenId}/orders`, { params });
  return data; // { success, date, hour, orders }
}

// ─── Daily Hourly Intelligence (Phase 15) ─────────────────────────
// Whole-day, all-campaigns hourly breakdown for the Daily page's
// per-date drawer — distinct from fetchHourlyReport above, which is
// always scoped to one campaign/ad set/ad (or a single account with no
// campaign/ad-set/ad breakdown). See server/routes/dailyHourly.js.

export async function fetchDailyHourlySummary(tokenId, { date, accountIds } = {}) {
  const params = new URLSearchParams();
  params.append("date", date);
  (Array.isArray(accountIds) ? accountIds : [accountIds]).filter(Boolean).forEach((id) => params.append("adAccountId", id));
  const { data } = await api.get(`/daily-hourly/${tokenId}/summary?${params}`);
  return data; // { success, date, hours, summary }
}

export async function fetchDailyHourOrders(tokenId, { date, hour, campaignId, campaignName, adsetId, adId, paymentType, deliveryBucket } = {}) {
  const params = { date, hour };
  if (campaignId) params.campaignId = campaignId;
  if (campaignName) params.campaignName = campaignName;
  if (adsetId) params.adsetId = adsetId;
  if (adId) params.adId = adId;
  if (paymentType) params.paymentType = paymentType;
  if (deliveryBucket) params.deliveryBucket = deliveryBucket;
  const { data } = await api.get(`/daily-hourly/${tokenId}/hour-orders`, { params });
  return data; // { success, date, hour, orders }
}

// ─── Products — Product Cost Setup (Phase 16 §2) ──────────────────
// New, additive routes at /api/products.

export async function fetchProducts() {
  const { data } = await api.get("/products");
  return data; // { success, products }
}
export async function createProduct(payload) {
  const { data } = await api.post("/products", payload);
  return data; // { success, product }
}
export async function updateProduct(id, payload) {
  const { data } = await api.put(`/products/${id}`, payload);
  return data; // { success, product }
}
export async function deleteProduct(id) {
  const { data } = await api.delete(`/products/${id}`);
  return data; // { success }
}

// ─── Expenses — Operating Expenses (Phase 16 §7/§8/§9/§19) ────────
// New, additive routes at /api/expenses.

export async function fetchExpenses() {
  const { data } = await api.get("/expenses");
  return data; // { success, expenses }
}
export async function createExpense(payload) {
  const { data } = await api.post("/expenses", payload);
  return data; // { success, expense }
}
export async function updateExpense(id, payload) {
  const { data } = await api.put(`/expenses/${id}`, payload);
  return data; // { success, expense }
}
export async function deleteExpense(id) {
  const { data } = await api.delete(`/expenses/${id}`);
  return data; // { success }
}

// ─── Profitability (Phase 16) ──────────────────────────────────────
// New, additive routes at /api/profitability. Every range-based call
// takes plain YYYY-MM-DD since/until strings, same convention as
// fetchDailyReport above.

export async function fetchProfitSettings() {
  const { data } = await api.get("/profitability/settings");
  return data; // { success, codSuccessRate }
}
export async function updateProfitSettings(codSuccessRate) {
  const { data } = await api.put("/profitability/settings", { codSuccessRate });
  return data; // { success, codSuccessRate }
}

function accountParams(accountIds) {
  const params = new URLSearchParams();
  (Array.isArray(accountIds) ? accountIds : [accountIds]).filter(Boolean).forEach((id) => params.append("adAccountId", id));
  return params;
}

export async function fetchProfitSummary(tokenId, { accountIds, since, until }) {
  const params = accountParams(accountIds);
  params.append("since", since);
  params.append("until", until ?? since);
  const { data } = await api.get(`/profitability/${tokenId}/summary?${params}`);
  return data; // { success, revenue, expenses, result, bestCampaign, worstCampaign, bestDay, highestProfitHour }
}

export async function fetchProfitCampaigns(tokenId, { accountIds, since, until }) {
  const params = accountParams(accountIds);
  params.append("since", since);
  params.append("until", until ?? since);
  const { data } = await api.get(`/profitability/${tokenId}/campaigns?${params}`);
  return data; // { success, campaigns, totals }
}

export async function fetchProfitDaily(tokenId, { accountIds, since, until }) {
  const params = accountParams(accountIds);
  params.append("since", since);
  params.append("until", until ?? since);
  const { data } = await api.get(`/profitability/${tokenId}/daily?${params}`);
  return data; // { success, days, totals }
}

export async function fetchProfitHourly(tokenId, { accountIds, date }) {
  const params = accountParams(accountIds);
  params.append("date", date);
  const { data } = await api.get(`/profitability/${tokenId}/hourly?${params}`);
  return data; // { success, hours, dayTotals }
}

export async function fetchProfitCodPrepaid(tokenId, { accountIds, since, until }) {
  const params = accountParams(accountIds);
  params.append("since", since);
  params.append("until", until ?? since);
  const { data } = await api.get(`/profitability/${tokenId}/cod-prepaid?${params}`);
  return data; // { success, prepaid, cod }
}

export async function fetchProfitProducts(tokenId, { accountIds, since, until }) {
  const params = accountParams(accountIds);
  params.append("since", since);
  params.append("until", until ?? since);
  const { data } = await api.get(`/profitability/${tokenId}/products?${params}`);
  return data; // { success, products }
}