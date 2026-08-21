import { currency, number, percent, multiplier, formatDate } from "./format";
import { computeCampaignHealth } from "./campaignHealth";
import { formatBudget } from "./campaignDisplay";

// Phase 8 — Campaign Explorer's ~35 column definitions, grouped exactly
// as the spec lists them (Campaign Information / Meta Performance /
// Order Performance / Payment Breakdown / Delivery Breakdown / Customer
// Metrics). Kept in its own file since both ExplorerTable.jsx and the
// CSV export functions in CampaignExplorerPage.jsx need the same list.

export const COLUMN_GROUPS = [
  {
    group: "Campaign Information",
    columns: [
      { key: "campaignName", label: "Campaign Name", pinnedDefault: true, defaultWidth: 240 },
      {
        key: "health",
        label: "Health",
        defaultWidth: 190,
        // Auto-generated from Meta + Shiprocket data — see campaignHealth.js.
        // Returned as plain text (not JSX) so this same render fn works for
        // both the table cell and the Campaign Performance CSV export.
        render: (c) => {
          const h = computeCampaignHealth(c);
          return `${h.emoji} ${h.label}`;
        },
      },
      { key: "campaignId", label: "Campaign ID", defaultWidth: 160 },
      { key: "accountName", label: "Ad Account", defaultWidth: 150 },
      {
        key: "budget",
        label: "Budget",
        defaultWidth: 140,
        align: "right",
        render: (c) => formatBudget(c.budget, c.budgetType) || "N/A",
      },
      { key: "objective", label: "Objective", defaultWidth: 140, render: (c) => c.objective || "N/A" },
      { key: "status", label: "Status", defaultWidth: 120, align: "center", render: (c) => c.effectiveStatus || c.status || "N/A" },
      { key: "startTime", label: "Start Date", defaultWidth: 130, render: (c) => formatDate(c.startTime) },
      { key: "stopTime", label: "End Date", defaultWidth: 130, render: (c) => formatDate(c.stopTime) },
    ],
  },
  {
    group: "Meta Performance",
    columns: [
      { key: "spend", label: "Spend", defaultWidth: 110, align: "right", render: (c) => currency(c.spend) },
      { key: "reach", label: "Reach", defaultWidth: 100, align: "right", render: (c) => number(c.reach) },
      { key: "impressions", label: "Impressions", defaultWidth: 120, align: "right", render: (c) => number(c.impressions) },
      { key: "clicks", label: "Clicks", defaultWidth: 90, align: "right", render: (c) => number(c.clicks) },
      { key: "ctr", label: "CTR", defaultWidth: 90, align: "right", render: (c) => percent(c.ctr) },
      { key: "cpc", label: "CPC", defaultWidth: 90, align: "right", render: (c) => currency(c.cpc) },
      { key: "cpm", label: "CPM", defaultWidth: 90, align: "right", render: (c) => currency(c.cpm) },
      { key: "purchases", label: "Purchases", defaultWidth: 100, align: "right", render: (c) => number(c.purchases) },
      { key: "purchaseValue", label: "Purchase Value", defaultWidth: 130, align: "right", render: (c) => currency(c.purchaseValue) },
      { key: "roas", label: "ROAS", defaultWidth: 90, align: "right", render: (c) => multiplier(c.roas) },
      // Phase 30 — Video Views / Hook Rate, so campaigns can be sorted/
      // compared by hook rate alongside Ad Sets and Ads.
      { key: "videoViews", label: "Video Views", defaultWidth: 110, align: "right", render: (c) => number(c.videoViews) },
      { key: "hookRate", label: "Hook Rate", defaultWidth: 100, align: "right", render: (c) => percent(c.hookRate) },
    ],
  },
  {
    group: "Order Performance",
    columns: [
      { key: "totalOrders", label: "Total Orders", defaultWidth: 110, align: "right", render: (c) => number(c.totalOrders) },
      { key: "matchedOrders", label: "Matched Orders", defaultWidth: 130, align: "right", render: (c) => number(c.matchedOrders) },
      { key: "unmatchedOrders", label: "Unmatched Orders", defaultWidth: 140, align: "right", render: (c) => number(c.unmatchedOrders) },
      { key: "outsideRangeOrders", label: "Outside Range", defaultWidth: 130, align: "right", render: (c) => number(c.outsideRangeOrders) },
      { key: "revenue", label: "Revenue", defaultWidth: 110, align: "right", render: (c) => currency(c.revenue) },
      // Phase 19 §4 — relabeled "Profit" → "Gross Profit" (Revenue − Ad
      // Spend only), disambiguating from Profitability's real Net Profit.
      // `c.profit`'s underlying value/math is untouched.
      { key: "profit", label: "Gross Profit", defaultWidth: 110, align: "right", render: (c) => currency(c.profit) },
      { key: "aov", label: "Avg Order Value", defaultWidth: 130, align: "right", render: (c) => currency(c.aov) },
      { key: "costPerOrder", label: "Cost / Order", defaultWidth: 120, align: "right", render: (c) => currency(c.costPerOrder) },
      { key: "revenuePerOrder", label: "Revenue / Order", defaultWidth: 130, align: "right", render: (c) => currency(c.revenuePerOrder) },
    ],
  },
  {
    group: "Payment Breakdown",
    columns: [
      { key: "codOrders", label: "COD Orders", defaultWidth: 110, align: "right", render: (c) => number(c.codOrders) },
      { key: "codRevenue", label: "COD Revenue", defaultWidth: 120, align: "right", render: (c) => currency(c.codRevenue) },
      { key: "prepaidOrders", label: "Prepaid Orders", defaultWidth: 130, align: "right", render: (c) => number(c.prepaidOrders) },
      { key: "prepaidRevenue", label: "Prepaid Revenue", defaultWidth: 140, align: "right", render: (c) => currency(c.prepaidRevenue) },
    ],
  },
  {
    group: "Delivery Breakdown",
    columns: [
      { key: "delivered", label: "Delivered", defaultWidth: 100, align: "right", render: (c) => number(c.delivered) },
      { key: "pending", label: "Pending", defaultWidth: 100, align: "right", render: (c) => number(c.pending) },
      { key: "processing", label: "Processing", defaultWidth: 100, align: "right", render: (c) => number(c.processing) },
      { key: "cancelled", label: "Cancelled", defaultWidth: 100, align: "right", render: (c) => number(c.cancelled) },
      { key: "returned", label: "Returned", defaultWidth: 100, align: "right", render: (c) => number(c.returned) },
      { key: "rto", label: "RTO", defaultWidth: 80, align: "right", render: (c) => number(c.rto) },
    ],
  },
  {
    group: "Products",
    columns: [
      { key: "totalProductsSold", label: "Products", defaultWidth: 100, align: "right", render: (c) => number(c.totalProductsSold) },
      { key: "totalUnitsSold", label: "Units Sold", defaultWidth: 100, align: "right", render: (c) => number(c.totalUnitsSold) },
    ],
  },
  {
    group: "Customer Metrics",
    columns: [
      { key: "newCustomers", label: "New Customers", defaultWidth: 130, align: "right", render: (c) => number(c.newCustomers) },
      { key: "returningCustomers", label: "Returning Customers", defaultWidth: 150, align: "right", render: (c) => number(c.returningCustomers) },
    ],
  },
];

export const ALL_COLUMNS = COLUMN_GROUPS.flatMap((g) => g.columns.map((c) => ({ ...c, group: g.group })));

export const DEFAULT_HIDDEN = new Set([
  "unmatchedOrders", "outsideRangeOrders", "revenuePerOrder", "purchases", "purchaseValue",
  "codRevenue", "prepaidRevenue", "processing", "returned", "rto",
  "totalProductsSold", "totalUnitsSold",
]);
