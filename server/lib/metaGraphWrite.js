import { GRAPH_BASE } from "./metaGraph.js";

// ─────────────────────────────────────────────────────────────
// Phase 27 — the app's first Meta *write* path. Additive sibling to
// metaGraph.js (fbGet/fetchAllPages/etc. in that file are untouched —
// nothing here is imported by, or changes the behavior of, any
// pre-Phase-27 route).
//
// fbPost() mirrors fbGet()'s error-shape handling exactly (same
// { fbErrorCode, fbErrorSubcode } convention) so callers can surface a
// real Meta error message rather than a generic HTTP failure (spec §12).
// ─────────────────────────────────────────────────────────────

export async function fbPost(urlStr, formBody) {
  const res = await fetch(urlStr, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(formBody).toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const msg = data.error?.message || `FB API error (${res.status})`;
    const err = new Error(msg);
    err.fbErrorCode = data.error?.code;
    err.fbErrorSubcode = data.error?.error_subcode;
    err.status = res.status && res.status >= 400 && res.status < 600 ? 400 : 502;
    throw err;
  }
  return data;
}

// Budget values in the app are always the real currency amount (e.g.
// "3500" = ₹3,500). Meta stores/accepts daily_budget/lifetime_budget in
// the ad account's currency's minor unit (paise/cents) — same
// convention metaGraph.js's deriveBudget() already divides by 100 on
// the read side; this multiplies by 100 on the write side.
export function toMinorUnits(amount) {
  return Math.round(Number(amount) * 100);
}

// Updates arbitrary fields on a campaign or ad set node. `fields` is a
// plain object of Graph-API field name -> value (already in the units
// Meta expects — callers are responsible for calling toMinorUnits() on
// budget/bid values before passing them in here).
export async function updateEntityFields(entityId, accessToken, fields) {
  const url = `${GRAPH_BASE}/${entityId}`;
  return fbPost(url, { ...fields, access_token: accessToken });
}
