// Phase 18 (part 2) — session-lifetime cache for the "Campaigns" testing
// page (CampaignTesting.jsx, GET /api/campaigns/:tokenId/date-range per
// selected ad account), same Map pattern as dashboardCache.js. Keyed by
// tokenId+accountIds+since+until, same shape as every other explorer-
// style page's key even though this page fans out one request per
// account itself rather than calling a single combined endpoint.

const cache = new Map();

const keyFor = (tokenId, accountIds, since, until) =>
  `${tokenId}|${[...accountIds].sort().join(",")}|${since}|${until}`;

export function getCachedCampaignReport(tokenId, accountIds, since, until) {
  return cache.get(keyFor(tokenId, accountIds, since, until)) || null;
}

export function setCachedCampaignReport(tokenId, accountIds, since, until, data) {
  cache.set(keyFor(tokenId, accountIds, since, until), data);
}

export const campaignReportCacheKey = keyFor;
