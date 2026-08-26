// Phase 10 — Dashboard's two hand-rolled tables (Campaigns, Unmatched
// Orders), turned into column-driven definitions so both can use the
// shared useColumnPrefs/ColumnSettingsMenu system. Values only — no
// JSX in this plain .js module (same convention campaignExplorerColumns.js
// already uses); the "campaignName" and "roas"/"paymentType" keys are
// special-cased at the Dashboard.jsx render call site (CampaignLink +
// colored ROAS/payment badge), exactly like CampaignDrawer.jsx already
// does for its own orders table.

const currency = (n) =>
  `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const DASHBOARD_CAMPAIGN_COLUMNS = [
  { key: "campaignName", label: "Campaign" },
  { key: "budget", label: "Budget", align: "right" },
  { key: "bidCap", label: "Bid Cap", align: "right" },
  { key: "spend", label: "Spend", align: "right", render: (c) => currency(c.spend) },
  { key: "orders", label: "Orders", align: "right", render: (c) => c.orders },
  { key: "revenue", label: "Revenue", align: "right", render: (c) => currency(c.revenue) },
  { key: "costPerOrder", label: "Cost/Order", align: "right", render: (c) => currency(c.costPerOrder) },
  // Phase 39 §16 — special-cased at the Dashboard.jsx render call site
  // (like campaignName/budget/bidCap above) so it can show Primary ROAS
  // (active-period revenue ÷ active-period spend) via the existing
  // RoasValue component instead of the raw spend-vs-every-matched-order
  // ROAS. The underlying `roas` field is untouched, still returned by the
  // API and still readable elsewhere.
  { key: "roas", label: "ROAS", align: "right" },
  { key: "clicks", label: "Clicks", align: "right", render: (c) => c.clicks },
  { key: "ctr", label: "CTR", align: "right", render: (c) => c.ctr },
  // Phase 39 §16 — shown separately so Post-Campaign revenue never gets
  // read as part of the (Primary) ROAS above; hidden by default to keep
  // the default Dashboard table unchanged, one click away via the
  // existing column settings menu.
  { key: "postCampaignRevenue", label: "Post-Campaign Revenue", align: "right" },
  { key: "accountId", label: "Account", sortable: false, render: (c) => c.accountId },
];

export const DASHBOARD_CAMPAIGN_DEFAULT_HIDDEN = ["postCampaignRevenue"];

export const DASHBOARD_UNMATCHED_COLUMNS = [
  { key: "campaignName", label: "Campaign Name", sortable: false },
  { key: "campaignId", label: "Campaign ID", sortable: false, render: (o) => o.campaignId || "-" },
  { key: "orderId", label: "Order ID", sortable: false, render: (o) => o.orderId },
  { key: "totalAmountPayable", label: "Amount", sortable: false, align: "right", render: (o) => currency(o.totalAmountPayable) },
  { key: "paymentType", label: "Payment", sortable: false, align: "center" },
  { key: "paymentStatus", label: "Status", sortable: false, align: "center", render: (o) => o.paymentStatus },
  { key: "orderDate", label: "Order Date", sortable: false, render: (o) => o.orderDate },
  { key: "orderCreatedAt", label: "Created At", sortable: false, render: (o) => (o.orderCreatedAt ? new Date(o.orderCreatedAt).toLocaleString() : "N/A") },
];

export const DASHBOARD_UNMATCHED_DEFAULT_HIDDEN = [];
