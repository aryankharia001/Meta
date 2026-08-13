// ─────────────────────────────────────────────────────────────
// Phase 13 — shared Meta Graph API helper for the NEW Ad Set / Ad /
// Hourly routes only (adSetExplorer.js, adExplorer.js, hourly.js).
//
// Deliberately NOT imported by any pre-Phase-13 route (campaigns.js,
// campaignExplorer.js, dailyReports.js keep their own local fbGet/
// fetchAllPages copies exactly as-is) — same "zero coupling between
// phases" convention this codebase has used since Phase 8. Nothing in
// this file can ever change the behavior of an earlier phase's route,
// and nothing an earlier phase does can ever break this one.
//
// The only real difference from the older per-file copies: a single
// place to bump the Graph API version. The app's existing routes call
// v19.0 (campaigns.js/campaignExplorer.js/dailyReports.js) and v21.0
// (adAccountsRoutes.js) — both already old. New Phase 13 code targets a
// current, non-deprecated version instead of copying the stale one.
// ─────────────────────────────────────────────────────────────

export const META_API_VERSION = "v23.0";
export const GRAPH_BASE = `https://graph.facebook.com/${META_API_VERSION}`;

export async function fbGet(urlStr) {
  const res = await fetch(urlStr);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const msg = data.error?.message || `FB API error (${res.status})`;
    const err = new Error(msg);
    err.fbErrorCode = data.error?.code;
    err.fbErrorSubcode = data.error?.error_subcode;
    throw err;
  }
  return data;
}

export async function fetchAllPages(url, { maxPages = 20 } = {}) {
  const results = [];
  let next = url;
  let pages = 0;
  while (next && pages < maxPages) {
    const data = await fbGet(next);
    results.push(...(data.data || []));
    next = data.paging?.next || null;
    pages += 1;
  }
  return results;
}

export function actIdOf(accountId) {
  const s = String(accountId || "");
  return s.startsWith("act_") ? s : `act_${s}`;
}

export function findActionValue(list, types) {
  if (!Array.isArray(list)) return null;
  for (const type of types) {
    const hit = list.find((a) => a.action_type === type);
    if (hit && hit.value !== undefined) return Number(hit.value);
  }
  return null;
}

// Meta returns daily_budget/lifetime_budget in the ad account's
// currency's minor unit — divide by 100 for the real amount. Same
// convention campaigns.js/campaignExplorer.js already use.
export function deriveBudget(meta) {
  if (!meta) return { budget: null, budgetType: null };
  if (meta.daily_budget !== undefined && meta.daily_budget !== null && meta.daily_budget !== "") {
    return { budget: Number(meta.daily_budget) / 100, budgetType: "daily" };
  }
  if (meta.lifetime_budget !== undefined && meta.lifetime_budget !== null && meta.lifetime_budget !== "") {
    return { budget: Number(meta.lifetime_budget) / 100, budgetType: "lifetime" };
  }
  return { budget: null, budgetType: null };
}

// Same six-bucket delivery classification campaignExplorer.js's
// deliveryBucket6() already established — duplicated here on purpose
// (same "zero coupling" convention) rather than imported, so nothing in
// Phase 13 can ever change Campaign Explorer's bucketing and vice versa.
export function extractDeliveryStatus(raw) {
  return (
    raw?.shipment_status ||
    raw?.delivery_status ||
    raw?.current_status ||
    raw?.shipments?.[0]?.status ||
    raw?.shipments?.[0]?.delivery_status ||
    null
  );
}

export function deliveryBucket6(deliveryStatus) {
  const s = (deliveryStatus || "").toLowerCase();
  if (!s) return "pending";
  if (s.includes("rto")) return "rto";
  if (s.includes("return")) return "returned";
  if (s.includes("cancel")) return "cancelled";
  if (s.includes("deliver") && !s.includes("out for")) return "delivered";
  if (s.includes("process")) return "processing";
  return "pending";
}

// Small in-memory TTL cache, same pattern campaignExplorer.js's
// responseCache already established — scoped to whichever route file
// creates one (each new Phase 13 route makes its own via this factory,
// they never share a Map), disappears on server restart.
export function createTtlCache(ttlMs = 45_000, maxEntries = 300) {
  const store = new Map();
  return {
    get(key) {
      const hit = store.get(key);
      if (!hit) return null;
      if (Date.now() - hit.at > ttlMs) {
        store.delete(key);
        return null;
      }
      return hit.value;
    },
    set(key, value) {
      store.set(key, { value, at: Date.now() });
      if (store.size > maxEntries) {
        const oldestKey = [...store.keys()][0];
        store.delete(oldestKey);
      }
    },
  };
}
