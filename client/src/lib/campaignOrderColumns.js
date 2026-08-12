import { currency, formatDate } from "./format";

// Phase 10 — Campaign Drawer's "Campaign Orders" table column
// definitions, matching the columns that table already rendered
// (Order ID, Customer, Phone, Product(s), Revenue, Payment, Current
// Status, Courier, Order Date) plus the new Quantity column, wired
// through useColumnPrefs/ColumnSettingsMenu so users can show/hide/
// reorder/reset them — same reusable system Campaign Explorer and the
// Daily page use, with its own storage key so these prefs never affect
// any other table.

export const CAMPAIGN_ORDER_COLUMNS = [
  { key: "orderId", label: "Order ID", render: (o) => o.orderId },
  { key: "customerName", label: "Customer", render: (o) => o.customerName || "N/A" },
  { key: "phone", label: "Phone", sortable: false, render: (o) => o.phone || "N/A" },
  { key: "product", label: "Product(s)", sortable: false, render: (o) => o.product || "N/A" },
  { key: "productQuantity", label: "Quantity", sortable: false, render: (o) => o.productQuantity ?? "N/A" },
  { key: "totalAmountPayable", label: "Revenue", render: (o) => currency(o.totalAmountPayable) },
  // No JSX here on purpose (this is a plain .js module, same convention
  // campaignExplorerColumns.js already uses) — the payment badge's
  // color comes from the "paymentType" key special-case in
  // CampaignDrawer.jsx's own cell renderer instead.
  { key: "paymentType", label: "Payment", sortable: false, render: (o) => o.paymentType || "N/A" },
  { key: "status", label: "Current Status", sortable: false, render: (o) => o.deliveryStatus || o.orderStatus || "N/A" },
  { key: "courier", label: "Courier", sortable: false, render: (o) => o.courier || "N/A" },
  { key: "orderDate", label: "Order Date", sortKey: "orderCreatedAt", render: (o) => formatDate(o.orderDate) },
];

export const CAMPAIGN_ORDER_DEFAULT_HIDDEN = ["phone", "courier"];
