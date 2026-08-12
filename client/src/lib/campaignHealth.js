// Phase 8 — Campaign Health Indicators. Pure functions over the
// already-combined campaign rows fetchCampaignExplorer()/
// fetchLiveCampaignExplorer() return — no network calls, no state,
// just classification, so both the main Explorer table and the Live
// Monitoring section can share the exact same rules.
//
// Phase 11 — recolored to only three tones (green/red/neutral gray),
// per the "remove orange/yellow status styling" requirement. The
// underlying classification is unchanged (still six distinct
// situations, each with its own label), only the color/emoji mapping
// collapsed down to what's allowed: no amber, no orange, no blue.
// The Campaign Alerts feature this file used to also power has been
// removed (see Campaign Explorer, Phase 11 §15) — this file now only
// exports the health classifier.

const HIGH_SPEND_THRESHOLD = 500; // ₹ — "high spend" for the no-orders/low-ROAS checks below
const LOW_ROAS_THRESHOLD = 1; // ROAS < 1x means spend isn't covered by revenue yet
const RECENTLY_STARTED_HOURS = 48;

export const HEALTH = {
  healthy: { emoji: "🟢", label: "Healthy", tone: "emerald" },
  noOrdersYet: { emoji: "⚪", label: "Active, no orders yet", tone: "slate" },
  highSpendLowConversion: { emoji: "🔴", label: "High spend, low conversions", tone: "rose" },
  highSpendZeroOrders: { emoji: "🔴", label: "High spend, zero orders", tone: "rose" },
  recentlyStarted: { emoji: "⚪", label: "Recently started", tone: "slate" },
  paused: { emoji: "⚪", label: "Paused / inactive", tone: "slate" },
};

// A campaign's health is evaluated in priority order — zero-orders-at-
// high-spend is worse than merely low-conversion, which is worse than
// "just started," etc. Only ACTIVE-ish campaigns get evaluated for
// performance issues; anything paused/archived just shows as such.
export function computeCampaignHealth(campaign) {
  const status = campaign.effectiveStatus || campaign.status;
  const isLive = status === "ACTIVE" || status === "IN_PROCESS" || status === "PENDING_REVIEW";

  if (!isLive) return HEALTH.paused;

  const startedRecently =
    campaign.startTime && (Date.now() - new Date(campaign.startTime).getTime()) / (60 * 60 * 1000) < RECENTLY_STARTED_HOURS;

  if (campaign.spend >= HIGH_SPEND_THRESHOLD && campaign.totalOrders === 0) return HEALTH.highSpendZeroOrders;
  if (campaign.spend >= HIGH_SPEND_THRESHOLD && campaign.roas > 0 && campaign.roas < LOW_ROAS_THRESHOLD) return HEALTH.highSpendLowConversion;
  if (startedRecently) return HEALTH.recentlyStarted;
  if (campaign.spend > 0 && campaign.totalOrders === 0) return HEALTH.noOrdersYet;
  return HEALTH.healthy;
}
