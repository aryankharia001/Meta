import { currency, multiplier } from "./format";

// Phase 27 — column definitions for HourlyControlPanel's table, same
// convention hourlyColumns.js already established for HourlyPanel.
export const HOURLY_CONTROL_COLUMNS = [
  { key: "label", label: "Hour", defaultWidth: 120, render: (r) => r.label },
  {
    key: "budget",
    label: "Budget",
    align: "right",
    render: (r) => (r.budgetChangedMidHour ? `${currency(r.budget)} *` : currency(r.budget)),
  },
  {
    key: "bidCap",
    label: "Bid Cap",
    align: "right",
    render: (r) => (r.bidCapChangedMidHour ? `${currency(r.bidCap)} *` : currency(r.bidCap)),
  },
  { key: "spend", label: "Spend", align: "right", render: (r) => currency(r.spend) },
  { key: "orders", label: "Orders", align: "right", render: (r) => r.orders },
  { key: "prepaidOrders", label: "Prepaid", align: "right", render: (r) => r.prepaidOrders },
  { key: "codOrders", label: "COD", align: "right", render: (r) => r.codOrders },
  { key: "revenue", label: "Revenue", align: "right", render: (r) => currency(r.revenue) },
  { key: "roas", label: "ROAS", align: "right", render: (r) => multiplier(r.roas) },
  { key: "cpa", label: "CPA", align: "right", render: (r) => currency(r.cpa) },
  { key: "profit", label: "Profit", align: "right", render: (r) => currency(r.profit) },
];

export const HOURLY_CONTROL_DEFAULT_HIDDEN = [];
