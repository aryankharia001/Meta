// Campaign History Phase — single consolidating helper.
//
// Every page in this app caches its data for the lifetime of the browser
// tab (see the *Cache.js files in this folder) with no TTL and, until now,
// no way to invalidate. That's normally fine, but it breaks one specific
// case: when a manual historical-name mapping is added, edited, or
// deleted in the Campaign Identity panel, the server-side order↔campaign
// resolution changes immediately — but any already-loaded page keeps
// serving its stale in-memory result until a hard reload, because nothing
// tells these caches a mapping changed.
//
// This file does nothing except call every relevant cache's own clear
// function. It never reads or writes cache data itself, and every
// existing getter/setter in every file below is untouched.
import { clearCampaignDetailsCache } from "./campaignDetailsCache.js";
import { clearCampaignExplorerCache } from "./campaignExplorerCache.js";
import { clearDashboardCache } from "./dashboardCache.js";
import { clearDailyReportCache } from "./dailyReportCache.js";
import { clearDetailedOrdersCache } from "./detailedOrdersCache.js";
import { clearOrderDetailsCache } from "./orderDetailsCache.js";
import { clearProfitabilityCache } from "./profitabilityCache.js";
import { clearCampaignTestingCache } from "./campaignTestingCache.js";
import { clearOrdersTestingCache } from "./ordersTestingCache.js";
import { clearAdExplorerCache } from "./adExplorerCache.js";
import { clearAdSetExplorerCache } from "./adSetExplorerCache.js";

// Call this after any manual historical-name mapping mutation (add, edit,
// delete) so every page that shows order/campaign matching results
// refetches instead of continuing to show data computed before the
// mapping existed. Safe to call unconditionally — clearing an already-
// empty Map is a no-op.
export function invalidateOrderMatchingCaches() {
  clearCampaignDetailsCache();
  clearCampaignExplorerCache();
  clearDashboardCache();
  clearDailyReportCache();
  clearDetailedOrdersCache();
  clearOrderDetailsCache();
  clearProfitabilityCache();
  clearCampaignTestingCache();
  clearOrdersTestingCache();
  clearAdExplorerCache();
  clearAdSetExplorerCache();
}
