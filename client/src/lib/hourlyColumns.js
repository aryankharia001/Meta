import { currency, multiplier } from "./format";

// Phase 13 §1/§17 — column definitions for the Hourly Performance table,
// wired through the same useColumnPrefs/ColumnSettingsMenu/DataTable
// system every other retrofitted table in this app uses.
export const HOURLY_COLUMNS = [
  { key: "label", label: "Hour", defaultWidth: 120, render: (r) => r.label },
  { key: "spend", label: "Spend", align: "right", render: (r) => currency(r.spend) },
  { key: "orders", label: "Orders", align: "right", render: (r) => r.orders },
  { key: "matchedOrders", label: "Matched Orders", align: "right", render: (r) => r.matchedOrders },
  { key: "unmatchedOrders", label: "Unmatched Orders", align: "right", render: (r) => r.unmatchedOrders },
  { key: "revenue", label: "Revenue", align: "right", render: (r) => currency(r.revenue) },
  { key: "codOrders", label: "COD Orders", align: "right", render: (r) => r.codOrders },
  { key: "prepaidOrders", label: "Prepaid Orders", align: "right", render: (r) => r.prepaidOrders },
  { key: "delivered", label: "Delivered", align: "right", render: (r) => r.delivered },
  { key: "pending", label: "Pending", align: "right", render: (r) => r.pending },
  { key: "rto", label: "RTO", align: "right", render: (r) => r.rto },
  { key: "roas", label: "ROAS", align: "right", render: (r) => multiplier(r.roas) },
  { key: "aov", label: "AOV", align: "right", render: (r) => currency(r.aov) },
  { key: "cpa", label: "CPA", align: "right", render: (r) => currency(r.cpa) },
];

export const HOURLY_DEFAULT_HIDDEN = [];
