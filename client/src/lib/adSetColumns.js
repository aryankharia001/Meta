import { currency, number, percent, multiplier, formatDate } from "./format";
import { formatBudget } from "./campaignDisplay";

// Phase 13 §4/§17 — column definitions for Ad Set Explorer, wired
// through the shared useColumnPrefs/ColumnSettingsMenu/DataTable system.
// "adsetName"/"campaignName"/"status" are special-cased at the render
// call site (AdSetExplorerPage.jsx) for the linked-name cell + badge,
// same convention OrdersListPopup.jsx/campaignExplorerColumns.js use.
export const AD_SET_COLUMNS = [
  { key: "adsetName", label: "Ad Set", group: "Ad Set Information", defaultWidth: 240 },
  { key: "adsetId", label: "Ad Set ID", group: "Ad Set Information" },
  { key: "campaignName", label: "Campaign", group: "Ad Set Information" },
  { key: "campaignId", label: "Campaign ID", group: "Ad Set Information" },
  { key: "status", label: "Status", group: "Ad Set Information", render: (r) => r.effectiveStatus || r.status || "N/A" },
  { key: "budget", label: "Budget", group: "Ad Set Information", render: (r) => formatBudget(r.budget, r.budgetType) || "—" },
  { key: "startTime", label: "Start Date", group: "Ad Set Information", render: (r) => formatDate(r.startTime) },
  { key: "endTime", label: "End Date", group: "Ad Set Information", render: (r) => formatDate(r.endTime) },
  { key: "optimizationGoal", label: "Optimization Goal", group: "Ad Set Information", render: (r) => r.optimizationGoal || "N/A" },
  { key: "billingEvent", label: "Billing Event", group: "Ad Set Information", render: (r) => r.billingEvent || "N/A" },
  { key: "bidStrategy", label: "Bid Strategy", group: "Ad Set Information", render: (r) => r.bidStrategy || "N/A" },
  { key: "targetingSummary", label: "Targeting", group: "Ad Set Information", sortable: false, render: (r) => r.targetingSummary || "N/A" },

  { key: "spend", label: "Spend", group: "Performance", align: "right", render: (r) => currency(r.spend) },
  { key: "impressions", label: "Impressions", group: "Performance", align: "right", render: (r) => number(r.impressions) },
  { key: "reach", label: "Reach", group: "Performance", align: "right", render: (r) => number(r.reach) },
  { key: "clicks", label: "Clicks", group: "Performance", align: "right", render: (r) => number(r.clicks) },
  { key: "ctr", label: "CTR", group: "Performance", align: "right", render: (r) => percent(r.ctr) },
  { key: "cpc", label: "CPC", group: "Performance", align: "right", render: (r) => currency(r.cpc) },
  { key: "cpm", label: "CPM", group: "Performance", align: "right", render: (r) => currency(r.cpm) },
  { key: "purchases", label: "Purchases", group: "Performance", align: "right", render: (r) => number(r.purchases) },
  { key: "purchaseValue", label: "Revenue (Meta)", group: "Performance", align: "right", render: (r) => currency(r.purchaseValue) },
  { key: "roas", label: "ROAS", group: "Performance", align: "right", render: (r) => multiplier(r.roas) },

  { key: "totalOrders", label: "Total Orders", group: "Orders", align: "right", render: (r) => number(r.totalOrders) },
  { key: "matchedOrders", label: "Matched Orders", group: "Orders", align: "right", render: (r) => number(r.matchedOrders) },
  { key: "unmatchedOrders", label: "Unmatched Orders", group: "Orders", align: "right", render: (r) => number(r.unmatchedOrders) },
  { key: "revenue", label: "Revenue", group: "Orders", align: "right", render: (r) => currency(r.revenue) },
  { key: "codOrders", label: "COD", group: "Orders", align: "right", render: (r) => number(r.codOrders) },
  { key: "prepaidOrders", label: "Prepaid", group: "Orders", align: "right", render: (r) => number(r.prepaidOrders) },
  { key: "delivered", label: "Delivered", group: "Orders", align: "right", render: (r) => number(r.delivered) },
  { key: "pending", label: "Pending", group: "Orders", align: "right", render: (r) => number(r.pending) },
  { key: "rto", label: "RTO", group: "Orders", align: "right", render: (r) => number(r.rto) },
  { key: "cancelled", label: "Cancelled", group: "Orders", align: "right", render: (r) => number(r.cancelled) },
  { key: "returned", label: "Returned", group: "Orders", align: "right", render: (r) => number(r.returned) },
];

export const AD_SET_DEFAULT_HIDDEN = [
  "optimizationGoal", "billingEvent", "bidStrategy", "targetingSummary",
  "impressions", "reach", "purchases", "purchaseValue",
  "cancelled", "returned",
];
