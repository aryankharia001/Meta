// Phase 39 — Campaign Activity History display helpers. Pure,
// presentational — no network calls, no state, same convention
// campaignDisplay.js/campaignHealth.js already established, so every
// new campaignActivity/* component and every table column that reads
// the new additive fields (activityStatus, activeDays/activeHours,
// primaryRoas, postCampaignRevenue, ...) formats them identically.
// Nothing here touches how campaigns/orders are fetched, matched, or
// how the pre-existing `roas`/`status`/`effectiveStatus` fields are
// read elsewhere in the app.

// Mirrors the three-bucket classification server/lib/campaignActivity.js's
// statusBucket() computes (Active/Paused/Closed) — reuses the same
// badge classes campaignDisplay.js's statusBadgeClass() already defines
// (badge-green/badge-rose/badge-slate) so an Activity Status badge looks
// identical to the existing effective-status badge elsewhere in the app.
const ACTIVITY_BUCKETS = {
  active: { label: "Active", tone: "emerald", badgeClass: "badge-green" },
  paused: { label: "Paused", tone: "slate", badgeClass: "badge-slate" },
  closed: { label: "Closed", tone: "rose", badgeClass: "badge-rose" },
};

export function activityBucketInfo(bucket) {
  return ACTIVITY_BUCKETS[bucket] || { label: "Unknown", tone: "slate", badgeClass: "badge-slate" };
}

// Days/Hours -> "Xd Yh" / "Yh" — same convention the server's
// formatDurationMs() (server/lib/campaignActivity.js) already
// establishes for the activeLabel/inactiveLabel strings returned by the
// /campaign-activity/:tokenId/:campaignId/timeline endpoint; this is the
// client-side equivalent for the plain activeDays/activeHours numbers
// campaigns.js/campaignExplorer.js/campaignExplorer's list rows return.
export function formatDaysHours(days, hours) {
  const d = Number(days || 0);
  const h = Number(hours || 0);
  if (!d && !h) return "0h";
  return d > 0 ? `${d}d ${h}h` : `${h}h`;
}

const ACTIVITY_EVENT_LABELS = {
  created: "Campaign Created",
  activated: "Campaign Activated",
  paused: "Campaign Paused",
  resumed: "Campaign Resumed",
  closed: "Campaign Closed",
  reactivated: "Campaign Reactivated",
  tracking_started: "Activity Tracking Started",
};

export function activityEventLabel(activityType) {
  return ACTIVITY_EVENT_LABELS[activityType] || "Status Changed";
}

// Dot/icon color for one Activity History event — green for anything
// that means "started delivering", rose for Closed, slate for Paused/
// Tracking Started. Same three-tone-only rule campaignDisplay.js's
// statusTone() already follows (no amber/orange anywhere in this app).
export function activityEventTone(activityType) {
  if (activityType === "closed") return "rose";
  if (activityType === "activated" || activityType === "resumed" || activityType === "reactivated" || activityType === "created") {
    return "emerald";
  }
  return "slate";
}

// Client-side mirror of server/lib/campaignActivity.js's classifyOrders()
// — same algorithm, byte-for-byte equivalent bucketing rules, kept as a
// separate duplicated copy (same "zero coupling between phases"
// convention every other duplicated extractor in this codebase already
// follows — see e.g. extractDeliveryStatus() in metaGraph.js vs.
// campaignExplorer.js). Needed client-side only so the Active/Post-
// Campaign/Inactive stat tiles in ActivePerformanceSection can drill
// into the exact matching order list via the existing OrdersListPopup —
// the server's own /compare, /:campaignId/details, and /campaign-explorer
// responses already carry the authoritative bucket *counts and totals*;
// this function never recomputes or overrides those numbers, it only
// re-derives which of the already-fetched `orders` belong in which
// popup.
export function classifyOrdersByPeriods(orders, { periods, historicalDataAvailableFrom } = {}) {
  const list = periods || [];
  const lastPeriod = list.length ? list[list.length - 1] : null;
  const cutoff = historicalDataAvailableFrom ? new Date(historicalDataAvailableFrom) : null;

  const buckets = { active: [], inactivePaused: [], postCampaign: [], historicalUnavailable: [] };

  (orders || []).forEach((order) => {
    const at = order.orderCreatedAt ? new Date(order.orderCreatedAt) : null;
    let target = "historicalUnavailable";

    if (at && !isNaN(at.getTime()) && cutoff && at >= cutoff) {
      const period = list.find((p) => {
        const start = new Date(p.start);
        const end = p.end ? new Date(p.end) : null;
        return at >= start && (end ? at < end : true);
      });
      if (!period) target = "historicalUnavailable";
      else if (period.bucket === "active") target = "active";
      else if (period.bucket === "closed") target = period === lastPeriod ? "postCampaign" : "inactivePaused";
      else target = "inactivePaused";
    }

    buckets[target].push(order);
  });

  return buckets;
}
