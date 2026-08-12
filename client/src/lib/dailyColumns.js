import { currency, number, multiplier } from "./format";
import { formatDayLabel } from "./dateIst";

// Phase 10 — Daily page's per (day, campaign) row columns. Same shape
// campaignExplorerColumns.js (Phase 8) established for Campaign
// Explorer — a flat column-definition list ColumnSettingsMenu/
// useColumnPrefs can show/hide/reorder, and DailyTable.jsx renders
// directly via col.render(row).

export const DAILY_COLUMNS = [
  { key: "date", label: "Date", defaultWidth: 120, render: (r) => formatDayLabel(r.date) },
  { key: "campaignName", label: "Campaign Name", defaultWidth: 220, render: (r) => r.campaignName || "N/A" },
  { key: "campaignId", label: "Campaign ID", defaultWidth: 150, render: (r) => r.campaignId || "N/A" },
  { key: "spend", label: "Spend", defaultWidth: 100, render: (r) => currency(r.spend) },
  { key: "orders", label: "Orders", defaultWidth: 90, render: (r) => number(r.orders) },
  { key: "matchedOrders", label: "Matched Orders", defaultWidth: 130, render: (r) => number(r.matchedOrders) },
  { key: "unmatchedOrders", label: "Unmatched Orders", defaultWidth: 140, render: (r) => number(r.unmatchedOrders) },
  { key: "revenue", label: "Revenue", defaultWidth: 110, render: (r) => currency(r.revenue) },
  { key: "roas", label: "ROAS", defaultWidth: 90, render: (r) => multiplier(r.roas) },
  { key: "codOrders", label: "COD Orders", defaultWidth: 110, render: (r) => number(r.codOrders) },
  { key: "codRevenue", label: "COD Revenue", defaultWidth: 120, render: (r) => currency(r.codRevenue) },
  { key: "prepaidOrders", label: "Prepaid Orders", defaultWidth: 130, render: (r) => number(r.prepaidOrders) },
  { key: "prepaidRevenue", label: "Prepaid Revenue", defaultWidth: 140, render: (r) => currency(r.prepaidRevenue) },
  { key: "delivered", label: "Delivered", defaultWidth: 100, render: (r) => number(r.delivered) },
  { key: "pending", label: "Pending", defaultWidth: 100, render: (r) => number(r.pending) },
  { key: "cancelled", label: "Cancelled", defaultWidth: 100, render: (r) => number(r.cancelled) },
  { key: "returned", label: "Returned", defaultWidth: 100, render: (r) => number(r.returned) },
  { key: "rto", label: "RTO", defaultWidth: 80, render: (r) => number(r.rto) },
  { key: "aov", label: "Average Order Value", defaultWidth: 150, render: (r) => currency(r.aov) },
  { key: "costPerOrder", label: "Cost Per Order", defaultWidth: 130, render: (r) => currency(r.costPerOrder) },
  { key: "totalProductsSold", label: "Total Products Sold", defaultWidth: 150, render: (r) => number(r.totalProductsSold) },
  { key: "totalUnitsSold", label: "Total Units Sold", defaultWidth: 140, render: (r) => number(r.totalUnitsSold) },
];

// A manageable starting view — everything else is one click away via
// ColumnSettingsMenu, and always restorable via Reset Columns.
export const DAILY_DEFAULT_HIDDEN = [
  "campaignId",
  "matchedOrders",
  "unmatchedOrders",
  "cancelled",
  "returned",
  "rto",
  "costPerOrder",
  "totalProductsSold",
];
