// Phase 11 — Premium Tables, Live Campaign UI & Unified Data Experience.
// Pure, presentational helpers shared by every campaign table across the
// app (Dashboard, Daily, Campaign Explorer, Analytics, Campaign Drawer,
// Campaign Comparison). No network calls, no state — just classification
// and formatting, so the exact same rules render identically everywhere.
// Nothing here touches how campaigns/orders are fetched or matched.

// A campaign is "live" the same way campaignHealth.js/campaignExplorer.js
// already define it elsewhere in this app — Meta considers it currently
// deliverable (active or still in review), not necessarily spending yet.
const LIVE_STATUSES = new Set(["ACTIVE", "IN_PROCESS", "PENDING_REVIEW"]);

export function isLiveStatus(status) {
  return LIVE_STATUSES.has(status);
}

export function isCampaignLive(campaign) {
  if (!campaign) return false;
  return isLiveStatus(campaign.effectiveStatus || campaign.status);
}

// ROAS color rule (spec, Phase 11 §5) — standardized everywhere ROAS is
// shown: strictly greater than 2.4 is green, 2.4 and below is red. No
// amber/orange middle tier anywhere in the app.
export const ROAS_THRESHOLD = 2.4;

export function isGoodRoas(roas) {
  return Number(roas || 0) > ROAS_THRESHOLD;
}

// Returns the two CSS classes (base + tone) a ROAS value should render
// with — pair with the `.roas-value`/`.roas-good`/`.roas-bad` rules in
// index.css so every table gets the identical glow/weight/color.
export function roasClass(roas) {
  return `roas-value ${isGoodRoas(roas) ? "roas-good" : "roas-bad"}`;
}

// Campaign health/status indicators (Phase 11 §4) — only three tones,
// ever: green (positive/live), red (negative/problematic), neutral gray
// (inactive/unavailable). No orange/yellow status category anywhere.
const PROBLEM_STATUSES = new Set(["DELETED", "WITH_ISSUES", "DISAPPROVED"]);

export function statusTone(status) {
  if (isLiveStatus(status)) return "green";
  if (PROBLEM_STATUSES.has(status)) return "red";
  return "neutral";
}

export function statusBadgeClass(status) {
  const tone = statusTone(status);
  return tone === "green" ? "badge-green" : tone === "red" ? "badge-rose" : "badge-slate";
}

// Budget — uses the actual Meta campaign budget only (daily_budget or
// lifetime_budget, already converted server-side from minor currency
// units — see deriveBudget() in campaigns.js/campaignExplorer.js/
// dailyReports.js). Never calculated or inferred from spend.
export function formatBudget(budget, budgetType) {
  if (budget === null || budget === undefined) return null;
  const amount = `₹${Number(budget).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  if (budgetType === "daily") return `${amount} / day`;
  if (budgetType === "lifetime") return `${amount} lifetime`;
  return amount;
}

// Phase 32 §2 — Bid Cap applicability, derived purely from Meta's own
// bid_strategy value on the campaign/ad set. Only ever returns
// "not_applicable" when Meta explicitly reports a bidding strategy that
// is known not to use a manual bid cap ("Highest Volume" / lowest-cost-
// without-cap) — never guessed from a missing/empty bid_strategy, which
// just means Meta didn't return one ("unknown", rendered "N/A" by
// callers, not "Not Applicable"). A genuine bidAmount from Meta always
// takes priority over this classification wherever it's used — see
// CurrentValuesCard.jsx.
const BID_CAP_NOT_APPLICABLE_STRATEGIES = new Set(["LOWEST_COST_WITHOUT_CAP"]);
const BID_CAP_APPLICABLE_STRATEGIES = new Set([
  "LOWEST_COST_WITH_BID_CAP",
  "COST_CAP",
  "LOWEST_COST_WITH_MIN_ROAS",
  "TARGET_COST",
]);

export function bidCapApplicability(bidStrategy) {
  if (!bidStrategy) return "unknown";
  if (BID_CAP_NOT_APPLICABLE_STRATEGIES.has(bidStrategy)) return "not_applicable";
  if (BID_CAP_APPLICABLE_STRATEGIES.has(bidStrategy)) return "applicable";
  return "unknown";
}
