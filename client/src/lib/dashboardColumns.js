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
  { key: "spend", label: "Spend", render: (c) => currency(c.spend) },
  { key: "orders", label: "Orders", render: (c) => c.orders },
  { key: "revenue", label: "Revenue", render: (c) => currency(c.revenue) },
  { key: "costPerOrder", label: "Cost/Order", render: (c) => currency(c.costPerOrder) },
  { key: "roas", label: "ROAS" },
  { key: "clicks", label: "Clicks", render: (c) => c.clicks },
  { key: "ctr", label: "CTR", render: (c) => c.ctr },
  { key: "accountId", label: "Account", sortable: false, render: (c) => c.accountId },
];

export const DASHBOARD_CAMPAIGN_DEFAULT_HIDDEN = [];

export const DASHBOARD_UNMATCHED_COLUMNS = [
  { key: "campaignName", label: "Campaign Name", sortable: false },
  { key: "campaignId", label: "Campaign ID", sortable: false, render: (o) => o.campaignId || "-" },
  { key: "orderId", label: "Order ID", sortable: false, render: (o) => o.orderId },
  { key: "totalAmountPayable", label: "Amount", sortable: false, render: (o) => currency(o.totalAmountPayable) },
  { key: "paymentType", label: "Payment", sortable: false },
  { key: "paymentStatus", label: "Status", sortable: false, render: (o) => o.paymentStatus },
  { key: "orderDate", label: "Order Date", sortable: false, render: (o) => o.orderDate },
  { key: "orderCreatedAt", label: "Created At", sortable: false, render: (o) => (o.orderCreatedAt ? new Date(o.orderCreatedAt).toLocaleString() : "N/A") },
];

export const DASHBOARD_UNMATCHED_DEFAULT_HIDDEN = [];
