import { currency, number, percent, multiplier, formatDate } from "./format";

// Phase 13 §5/§17 — column definitions for Ad Explorer. "adName"
// (thumbnail + link), "campaignName", and "status" are special-cased at
// the render call site (AdExplorerPage.jsx), same convention as
// adSetColumns.js.
export const AD_COLUMNS = [
  { key: "adName", label: "Ad", group: "Ad Information", defaultWidth: 260 },
  { key: "adId", label: "Ad ID", group: "Ad Information" },
  { key: "adsetName", label: "Ad Set", group: "Ad Information", render: (r) => r.adsetName || "N/A" },
  { key: "campaignName", label: "Campaign", group: "Ad Information" },
  { key: "status", label: "Status", group: "Ad Information", render: (r) => r.effectiveStatus || r.status || "N/A" },
  { key: "createdTime", label: "Created", group: "Ad Information", render: (r) => formatDate(r.createdTime) },

  { key: "spend", label: "Spend", group: "Performance", align: "right", render: (r) => currency(r.spend) },
  { key: "impressions", label: "Impressions", group: "Performance", align: "right", render: (r) => number(r.impressions) },
  { key: "reach", label: "Reach", group: "Performance", align: "right", render: (r) => number(r.reach) },
  { key: "clicks", label: "Clicks", group: "Performance", align: "right", render: (r) => number(r.clicks) },
  { key: "ctr", label: "CTR", group: "Performance", align: "right", render: (r) => percent(r.ctr) },
  { key: "cpc", label: "CPC", group: "Performance", align: "right", render: (r) => currency(r.cpc) },
  { key: "cpm", label: "CPM", group: "Performance", align: "right", render: (r) => currency(r.cpm) },
  { key: "purchases", label: "Purchases", group: "Performance", align: "right", render: (r) => number(r.purchases) },
  { key: "roas", label: "ROAS", group: "Performance", align: "right", render: (r) => multiplier(r.roas) },

  { key: "totalOrders", label: "Orders", group: "Orders", align: "right", render: (r) => number(r.totalOrders) },
  { key: "revenue", label: "Revenue", group: "Orders", align: "right", render: (r) => currency(r.revenue) },
  { key: "codOrders", label: "COD", group: "Orders", align: "right", render: (r) => number(r.codOrders) },
  { key: "prepaidOrders", label: "Prepaid", group: "Orders", align: "right", render: (r) => number(r.prepaidOrders) },
  { key: "delivered", label: "Delivered", group: "Orders", align: "right", render: (r) => number(r.delivered) },
  { key: "rto", label: "RTO", group: "Orders", align: "right", render: (r) => number(r.rto) },
];

export const AD_DEFAULT_HIDDEN = ["impressions", "reach", "purchases", "createdTime"];
