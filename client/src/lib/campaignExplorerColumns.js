import { currency, number, percent, multiplier, formatDate, formatDateTime } from "./format";
import { computeCampaignHealth } from "./campaignHealth";
import { formatBudget, formatBidCapText } from "./campaignDisplay";
import { activityBucketInfo, formatDaysHours } from "./campaignActivityDisplay";

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
      {
        key: "bidCap",
        label: "Bid Cap",
        defaultWidth: 140,
        align: "right",
        // Phase 38 — plain-text (CSV export reuses this render()); the
        // live table renders the richer BidCapCell JSX instead, same
        // "shared render() for CSV, JSX for the table" split the Budget
        // column above already uses.
        render: (c) => formatBidCapText(c),
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
  // Phase 39 §15 — Campaign Activity History & correct ROAS attribution.
  // Purely additive group appended at the end so the existing ~35 columns
  // and their widths/order are untouched. Every value here comes straight
  // off the additive fields campaignExplorer.js's fetchCombinedCampaigns()
  // already attaches to each campaign row (activityStatus, activeDays/
  // Hours, primaryRoas, ...) — nothing here recomputes anything. Most of
  // these are hidden by default (see DEFAULT_HIDDEN below) to keep the
  // main table clean per the spec; the detailed breakdown always lives in
  // the Campaign Drawer's "Campaign Activity" / "Active Performance"
  // sections regardless of which of these columns are shown here.
  {
    group: "Campaign Activity",
    columns: [
      {
        key: "activityStatus",
        label: "Current Status",
        defaultWidth: 120,
        align: "center",
        render: (c) => (c.activityTrackingAvailable ? activityBucketInfo(c.activityStatus).label : "N/A"),
      },
      { key: "activeDays", label: "Active Days", defaultWidth: 110, align: "right", render: (c) => number(c.activeDays) },
      { key: "activeHours", label: "Active Hours", defaultWidth: 110, align: "right", render: (c) => number(c.activeHours) },
      { key: "inactiveDays", label: "Inactive Days", defaultWidth: 110, align: "right", render: (c) => number(c.inactiveDays) },
      { key: "inactiveHours", label: "Inactive Hours", defaultWidth: 120, align: "right", render: (c) => number(c.inactiveHours) },
      { key: "campaignStart", label: "Campaign Start", defaultWidth: 160, render: (c) => (c.campaignStart ? formatDateTime(c.campaignStart) : "N/A") },
      { key: "campaignEnd", label: "Campaign End", defaultWidth: 160, render: (c) => (c.campaignEnd ? formatDateTime(c.campaignEnd) : "Ongoing") },
      { key: "activePeriodOrders", label: "Active-Period Orders", defaultWidth: 150, align: "right", render: (c) => number(c.activePeriodOrders) },
      { key: "activePeriodRevenue", label: "Active-Period Revenue", defaultWidth: 160, align: "right", render: (c) => currency(c.activePeriodRevenue) },
      { key: "postCampaignOrders", label: "Post-Campaign Orders", defaultWidth: 150, align: "right", render: (c) => number(c.postCampaignOrders) },
      { key: "postCampaignRevenue", label: "Post-Campaign Revenue", defaultWidth: 160, align: "right", render: (c) => currency(c.postCampaignRevenue) },
      {
        key: "primaryRoas",
        label: "Primary ROAS",
        defaultWidth: 120,
        align: "right",
        render: (c) => (c.primaryRoas === null || c.primaryRoas === undefined ? "N/A" : multiplier(c.primaryRoas)),
      },
    ],
  },
];

export const ALL_COLUMNS = COLUMN_GROUPS.flatMap((g) => g.columns.map((c) => ({ ...c, group: g.group })));

export const DEFAULT_HIDDEN = new Set([
  "unmatchedOrders", "outsideRangeOrders", "revenuePerOrder", "purchases", "purchaseValue",
  "codRevenue", "prepaidRevenue", "processing", "returned", "rto",
  "totalProductsSold", "totalUnitsSold",
  // Phase 39 — keep the main Explorer table clean (spec §15); Current
  // Status and Primary ROAS stay visible by default, the rest of the
  // Campaign Activity group is one click away via the existing column
  // settings menu.
  "activeDays", "activeHours", "inactiveDays", "inactiveHours",
  "campaignStart", "campaignEnd",
  "activePeriodOrders", "activePeriodRevenue", "postCampaignOrders", "postCampaignRevenue",
]);
