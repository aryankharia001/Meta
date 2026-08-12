// Phase 8 — Campaign Health Indicators + Alerts. Pure functions over
// the already-combined campaign rows fetchCampaignExplorer()/
// fetchLiveCampaignExplorer() return — no network calls, no state,
// just classification, so both the main Explorer table and the Live
// Monitoring section can share the exact same rules.

const HIGH_SPEND_THRESHOLD = 500; // ₹ — "high spend" for the no-orders/low-ROAS checks below
const LOW_ROAS_THRESHOLD = 1; // ROAS < 1x means spend isn't covered by revenue yet
const RECENTLY_STARTED_HOURS = 48;

export const HEALTH = {
  healthy: { emoji: "🟢", label: "Healthy", tone: "emerald" },
  noOrdersYet: { emoji: "🟡", label: "Active, no orders yet", tone: "amber" },
  highSpendLowConversion: { emoji: "🟠", label: "High spend, low conversions", tone: "orange" },
  highSpendZeroOrders: { emoji: "🔴", label: "High spend, zero orders", tone: "rose" },
  recentlyStarted: { emoji: "🔵", label: "Recently started", tone: "sky" },
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

// Alerts — a flatter list of "things needing attention," each tagged
// with a severity so the Alerts section can badge them consistently.
// Computed from the same fields health indicators use, plus a simple
// day-over-day comparison for spikes/drops when a `previous` snapshot
// (yesterday's totals for the same campaign) is available — optional,
// since Explorer doesn't always have a prior-period fetch on hand.
const SEVERITY = { critical: "rose", warning: "amber", info: "sky" };

export function computeCampaignAlerts(campaign, { previous } = {}) {
  const alerts = [];
  const status = campaign.effectiveStatus || campaign.status;
  const isLive = status === "ACTIVE" || status === "IN_PROCESS" || status === "PENDING_REVIEW";

  if (isLive && campaign.spend >= HIGH_SPEND_THRESHOLD && campaign.totalOrders === 0) {
    alerts.push({ type: "high-spend-no-orders", severity: SEVERITY.critical, message: `Spent ₹${campaign.spend.toFixed(0)} with zero orders` });
  }
  if (isLive && campaign.spend >= HIGH_SPEND_THRESHOLD && campaign.roas > 0 && campaign.roas < LOW_ROAS_THRESHOLD) {
    alerts.push({ type: "high-spend-low-roas", severity: SEVERITY.warning, message: `ROAS ${campaign.roas.toFixed(2)}x on ₹${campaign.spend.toFixed(0)} spend` });
  }
  const lastOrderHoursAgo = campaign.lastOrderAt ? (Date.now() - new Date(campaign.lastOrderAt).getTime()) / (60 * 60 * 1000) : null;
  if (isLive && lastOrderHoursAgo != null && lastOrderHoursAgo >= 6 && campaign.spend > 0) {
    alerts.push({ type: "no-orders-6h", severity: SEVERITY.warning, message: `No orders in the last ${Math.floor(lastOrderHoursAgo)}h` });
  } else if (isLive && campaign.spend > 0 && campaign.totalOrders === 0 && !lastOrderHoursAgo) {
    // Spend today but literally never an order for this campaign — same
    // signal, phrased without a "last order" timestamp to reference.
    alerts.push({ type: "no-orders-6h", severity: SEVERITY.warning, message: "No orders yet today" });
  }
  if (previous) {
    if (previous.revenue > 0 && campaign.revenue >= previous.revenue * 2) {
      alerts.push({ type: "revenue-spike", severity: SEVERITY.info, message: `Revenue up ${Math.round((campaign.revenue / previous.revenue - 1) * 100)}% vs yesterday` });
    }
    if (previous.totalOrders > 0 && campaign.totalOrders >= previous.totalOrders * 2) {
      alerts.push({ type: "orders-spike", severity: SEVERITY.info, message: `Orders up ${Math.round((campaign.totalOrders / previous.totalOrders - 1) * 100)}% vs yesterday` });
    }
    if (previous.revenue > 0 && campaign.revenue <= previous.revenue * 0.4) {
      alerts.push({ type: "performance-drop", severity: SEVERITY.warning, message: `Revenue down ${Math.round((1 - campaign.revenue / previous.revenue) * 100)}% vs yesterday` });
    }
  }
  return alerts;
}
