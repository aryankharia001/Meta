import { currency, number, multiplier } from "./format";
import { formatDayLabel } from "./dateIst";
import { formatBudget, formatBidCapText } from "./campaignDisplay";

// Phase 10 — Daily page's per (day, campaign) row columns. Same shape
// campaignExplorerColumns.js (Phase 8) established for Campaign
// Explorer — a flat column-definition list ColumnSettingsMenu/
// useColumnPrefs can show/hide/reorder, and DailyTable.jsx renders
// directly via col.render(row).
//
// Phase 11 — added Budget, Profit and Status columns, plus `align`
// metadata (right for numbers, center for status) so every renderer of
// this column list can apply consistent alignment without hardcoding
// per-key checks everywhere.

export const DAILY_COLUMNS = [
  { key: "date", label: "Date", defaultWidth: 120, render: (r) => formatDayLabel(r.date) },
  { key: "campaignName", label: "Campaign Name", defaultWidth: 220, render: (r) => r.campaignName || "N/A" },
  { key: "campaignId", label: "Campaign ID", defaultWidth: 150, render: (r) => r.campaignId || "N/A" },
  { key: "status", label: "Status", defaultWidth: 110, align: "center", render: (r) => r.effectiveStatus || r.status || "N/A" },
  { key: "budget", label: "Budget", defaultWidth: 130, align: "right", render: (r) => formatBudget(r.budget, r.budgetType) || "N/A" },
  { key: "bidCap", label: "Bid Cap", defaultWidth: 130, align: "right", render: (r) => formatBidCapText(r) },
  { key: "spend", label: "Spend", defaultWidth: 100, align: "right", render: (r) => currency(r.spend) },
  { key: "orders", label: "Orders", defaultWidth: 90, align: "right", render: (r) => number(r.orders) },
  { key: "matchedOrders", label: "Matched Orders", defaultWidth: 130, align: "right", render: (r) => number(r.matchedOrders) },
  { key: "unmatchedOrders", label: "Unmatched Orders", defaultWidth: 140, align: "right", render: (r) => number(r.unmatchedOrders) },
  { key: "revenue", label: "Revenue", defaultWidth: 110, align: "right", render: (r) => currency(r.revenue) },
  { key: "roas", label: "ROAS", defaultWidth: 90, align: "right", render: (r) => multiplier(r.roas) },
  { key: "profit", label: "Profit", defaultWidth: 110, align: "right", render: (r) => currency(Number(r.revenue || 0) - Number(r.spend || 0)) },
  { key: "codOrders", label: "COD Orders", defaultWidth: 110, align: "right", render: (r) => number(r.codOrders) },
  { key: "codRevenue", label: "COD Revenue", defaultWidth: 120, align: "right", render: (r) => currency(r.codRevenue) },
  { key: "prepaidOrders", label: "Prepaid Orders", defaultWidth: 130, align: "right", render: (r) => number(r.prepaidOrders) },
  { key: "prepaidRevenue", label: "Prepaid Revenue", defaultWidth: 140, align: "right", render: (r) => currency(r.prepaidRevenue) },
  { key: "delivered", label: "Delivered", defaultWidth: 100, align: "right", render: (r) => number(r.delivered) },
  { key: "pending", label: "Pending", defaultWidth: 100, align: "right", render: (r) => number(r.pending) },
  { key: "cancelled", label: "Cancelled", defaultWidth: 100, align: "right", render: (r) => number(r.cancelled) },
  { key: "returned", label: "Returned", defaultWidth: 100, align: "right", render: (r) => number(r.returned) },
  { key: "rto", label: "RTO", defaultWidth: 80, align: "right", render: (r) => number(r.rto) },
  { key: "aov", label: "Average Order Value", defaultWidth: 150, align: "right", render: (r) => currency(r.aov) },
  { key: "costPerOrder", label: "Cost Per Order", defaultWidth: 130, align: "right", render: (r) => currency(r.costPerOrder) },
  { key: "totalProductsSold", label: "Total Products Sold", defaultWidth: 150, align: "right", render: (r) => number(r.totalProductsSold) },
  { key: "totalUnitsSold", label: "Total Units Sold", defaultWidth: 140, align: "right", render: (r) => number(r.totalUnitsSold) },
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
