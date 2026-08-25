// ─────────────────────────────────────────────────────────────
// Phase 32 §4 — Direct Meta Ads Manager navigation. Pure URL builders,
// no network calls, no state. Every function requires the real Meta
// object ID(s) it links to; if the ad account ID isn't known for this
// object, callers get `null` back and must not render a link — this app
// never falls back to the generic Ads Manager homepage (spec §4
// explicitly forbids that "fake" navigation, same "don't invent what
// Meta didn't give us" rule Hook Rate/Bid Cap already follow).
//
// Ad account IDs are stored throughout this app as plain numeric
// strings (see server/models/AdAccount.js, and metaGraph.js's
// actIdOf() — the only place "act_" ever gets prepended, and only for
// calling the Graph API itself). This strips a leading "act_" anyway,
// defensively, in case one ever leaks in from a raw Meta object field.
// ─────────────────────────────────────────────────────────────

function normalizeAccountId(accountId) {
  if (accountId === null || accountId === undefined) return null;
  const s = String(accountId).trim();
  if (!s) return null;
  return s.replace(/^act_/, "");
}

const MANAGE_BASE = "https://adsmanager.facebook.com/adsmanager/manage";

// Opens Ads Manager's Campaigns view, scoped to the ad account, with
// this exact campaign pre-selected.
export function metaCampaignUrl({ accountId, campaignId }) {
  const act = normalizeAccountId(accountId);
  if (!act || !campaignId) return null;
  const params = new URLSearchParams({ act, selected_campaign_ids: String(campaignId) });
  return `${MANAGE_BASE}/campaigns?${params.toString()}`;
}

// Opens Ads Manager's Ad Sets view with this ad set pre-selected.
// campaignId is included when known (narrows Ads Manager's own view to
// the parent campaign first) but isn't required — the ad set ID alone
// is enough for Meta to resolve the exact object.
export function metaAdSetUrl({ accountId, campaignId, adsetId }) {
  const act = normalizeAccountId(accountId);
  if (!act || !adsetId) return null;
  const params = new URLSearchParams({ act, selected_adset_ids: String(adsetId) });
  if (campaignId) params.set("selected_campaign_ids", String(campaignId));
  return `${MANAGE_BASE}/adsets?${params.toString()}`;
}

// Opens Ads Manager's Ads view with this exact ad pre-selected.
export function metaAdUrl({ accountId, campaignId, adsetId, adId }) {
  const act = normalizeAccountId(accountId);
  if (!act || !adId) return null;
  const params = new URLSearchParams({ act, selected_ad_ids: String(adId) });
  if (campaignId) params.set("selected_campaign_ids", String(campaignId));
  if (adsetId) params.set("selected_adset_ids", String(adsetId));
  return `${MANAGE_BASE}/ads?${params.toString()}`;
}
