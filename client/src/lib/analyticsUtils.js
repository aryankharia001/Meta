// Shared pure helpers for every Phase 6 analytics section. All of them
// operate on the enriched order list from fetchAnalyticsOrders() (see
// server/routes/analytics.js) — nothing here talks to the network or
// touches any other phase's state.

export const normalizeCampaignName = (name) =>
  String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

// Same keyword-matching classification KpiAnalyticsPopup.jsx already
// uses per-card (delivered/pending/cancelled/returned) — consolidated
// here into one bucket function covering all five delivery states this
// phase's Delivery Analytics section needs, RTO included.
export function deliveryBucket(order) {
  const s = (order.deliveryStatus || "").toLowerCase();
  if (!s) return "unknown";
  if (s.includes("rto")) return "rto";
  if (s.includes("return")) return "returned";
  if (s.includes("cancel")) return "cancelled";
  if (s.includes("deliver") && !s.includes("out for")) return "delivered";
  return "pending";
}

export const DELIVERY_LABELS = {
  delivered: "Delivered",
  pending: "Pending / In Transit",
  cancelled: "Cancelled",
  returned: "Returned",
  rto: "RTO",
  unknown: "Unknown",
};

// Generic "group by key, sum revenue + count orders" reducer used by
// almost every section (campaign/product/state/city/payment/day/hour
// breakdowns all boil down to this same shape).
export function groupBy(list, keyFn, { labelFn } = {}) {
  const map = new Map();
  list.forEach((o) => {
    const key = keyFn(o);
    if (key === null || key === undefined) return;
    if (!map.has(key)) {
      map.set(key, { key, label: labelFn ? labelFn(o, key) : key, orders: 0, revenue: 0, items: [] });
    }
    const bucket = map.get(key);
    bucket.orders += 1;
    bucket.revenue += Number(o.totalAmountPayable || 0);
    bucket.items.push(o);
  });
  return [...map.values()].map((b) => ({ ...b, revenue: Math.round(b.revenue * 100) / 100 }));
}

export function dayKey(order) {
  return order.orderDate || null;
}

export function hourOfDay(order) {
  if (!order.orderCreatedAt) return null;
  const d = new Date(order.orderCreatedAt);
  if (isNaN(d.getTime())) return null;
  // IST hour-of-day, matching the rest of the app's IST convention.
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  return new Date(d.getTime() + IST_OFFSET_MS).getUTCHours();
}

// ISO 8601 week key, e.g. "2026-W32" — used for week-over-week trend
// buckets.
export function isoWeekKey(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (isNaN(d.getTime())) return null;
  const target = new Date(d.getTime());
  const dayNum = (d.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((target - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function monthKey(dateStr) {
  return (dateStr || "").slice(0, 7); // "2026-08"
}

export function isPrepaid(order) {
  return order.paymentType === "PREPAID";
}
export function isCod(order) {
  return order.paymentType === "CASH_ON_DELIVERY";
}

export function sortDesc(rows, key) {
  return [...rows].sort((a, b) => b[key] - a[key]);
}
export function sortAsc(rows, key) {
  return [...rows].sort((a, b) => a[key] - b[key]);
}
