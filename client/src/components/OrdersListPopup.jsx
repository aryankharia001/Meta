import { useEffect, useMemo, useState } from "react";
import { X, Search, Download, ChevronLeft, ChevronRight, Inbox } from "lucide-react";
import { currency, formatDate } from "../lib/format";
import { downloadCsv } from "../lib/csv";
import { useOrderDrawer } from "../lib/OrderDrawerContext";
import CampaignLink from "./CampaignLink";
import AdSetLink from "./AdSetLink";
import AdLink from "./AdLink";
import { useColumnPrefs } from "../lib/useColumnPrefs";
import ColumnSettingsMenu from "./ColumnSettingsMenu";
import { useOverlayEscape } from "../lib/overlayStack";

// Phase 10 — column definitions for this popup's order table, wired
// through the shared useColumnPrefs/ColumnSettingsMenu system. "campaignName"
// and "paymentType" stay special-cased at the render call site below
// (CampaignLink + colored badge), same pattern every other retrofitted
// table in this phase uses.
const ORDERS_LIST_COLUMNS = [
  { key: "orderId", label: "Order ID", render: (o) => o.orderId },
  { key: "customerName", label: "Customer", render: (o) => o.customerName || "N/A" },
  { key: "campaignName", label: "Campaign" },
  { key: "location", label: "City / State", sortable: false, render: (o) => [o.city, o.state].filter(Boolean).join(", ") || "N/A" },
  { key: "product", label: "Products", sortable: false, render: (o) => o.product || "N/A" },
  { key: "totalAmountPayable", label: "Amount", render: (o) => currency(o.totalAmountPayable) },
  { key: "paymentType", label: "Payment" },
  { key: "status", label: "Status", sortable: false, render: (o) => o.deliveryStatus || o.orderStatus || "N/A" },
  { key: "orderCreatedAt", label: "Order Date", render: (o) => formatDate(o.orderDate) },
];
const ORDERS_LIST_DEFAULT_HIDDEN = ["product"];

// ────────────────────────────────────────────────────────────────
// Phase 6 — the one generic "click X, see the orders behind it" popup
// every analytics section reuses (products, customers, states, cities,
// delivery-status buckets, hour/day buckets, ...). Same
// search/sort/paginate/export table pattern KpiAnalyticsPopup.jsx built
// for its own order lists — deliberately a fresh, self-contained copy
// here rather than an import from that Phase 3 file, so nothing in this
// phase can ever change that file's behavior (or vice versa).
//
// Row click opens the Phase 4 Order Drawer; the campaign cell opens the
// Phase 2 Campaign Drawer via the existing CampaignLink — same
// drill-down chain the spec asks for, reused everywhere instead of
// reinvented per section.
// ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 10;

export default function OrdersListPopup({
  open,
  title,
  subtitle,
  orders,
  tokenId,
  since,
  until,
  onClose,
  exportFilename,
  // Optional, backward-compatible additions — every existing caller
  // (Dashboard's own KPI popups) omits all of these and renders exactly
  // as before.
  emptyMessage, // shown instead of the generic "No orders here." when the full list (not just the filtered/searched view) is empty
  extraCards = [], // [{ label, value }] additional summary cards alongside Orders/Revenue
  columns, // override ORDERS_LIST_COLUMNS
  defaultHidden, // override ORDERS_LIST_DEFAULT_HIDDEN
  storageKey, // override the "ordersListPopup" useColumnPrefs storage key, so a richer caller's column prefs don't collide with the Dashboard's simpler popup
}) {
  const { openOrder } = useOrderDrawer();
  const [search, setSearch] = useState("");
  const [sortConfig, setSortConfig] = useState({ key: "orderCreatedAt", direction: "desc" });
  const [page, setPage] = useState(1);
  const { orderedColumns, allColumnsOrdered, hidden, toggleHidden, reorder, reset } = useColumnPrefs(
    storageKey || "ordersListPopup",
    columns || ORDERS_LIST_COLUMNS,
    defaultHidden || ORDERS_LIST_DEFAULT_HIDDEN
  );

  useEffect(() => {
    if (!open) return;
    setSearch("");
    setSortConfig({ key: "orderCreatedAt", direction: "desc" });
    setPage(1);
  }, [open, title]);

  useOverlayEscape(open, onClose);

  const list = orders || [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((o) =>
      [o.orderId, o.customerName, o.phone, o.campaignName, o.city, o.state]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [list, search]);

  const sorted = useMemo(() => {
    const rows = [...filtered];
    rows.sort((a, b) => {
      let x = a[sortConfig.key];
      let y = b[sortConfig.key];
      if (sortConfig.key === "orderCreatedAt") {
        x = x ? new Date(x).getTime() : 0;
        y = y ? new Date(y).getTime() : 0;
      } else if (sortConfig.key === "totalAmountPayable") {
        x = Number(x || 0);
        y = Number(y || 0);
      } else {
        x = (x || "").toString().toLowerCase();
        y = (y || "").toString().toLowerCase();
      }
      if (x < y) return sortConfig.direction === "asc" ? -1 : 1;
      if (x > y) return sortConfig.direction === "asc" ? 1 : -1;
      return 0;
    });
    return rows;
  }, [filtered, sortConfig]);

  useEffect(() => setPage(1), [search, sortConfig]);
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const paged = sorted.slice((page - 1) * PAGE_SIZE, (page - 1) * PAGE_SIZE + PAGE_SIZE);
  const handleSort = (key) => setSortConfig((p) => ({ key, direction: p.key === key && p.direction === "asc" ? "desc" : "asc" }));
  const arrow = (key) => (sortConfig.key !== key ? "" : sortConfig.direction === "asc" ? " ↑" : " ↓");

  const totalRevenue = useMemo(() => sorted.reduce((s, o) => s + Number(o.totalAmountPayable || 0), 0), [sorted]);

  const handleExport = () => {
    const rows = [
      ["Order ID", "Customer", "Phone", "Campaign", "City", "State", "Amount", "Payment Type", "Status", "Order Date"],
      ...sorted.map((o) => [
        o.orderId,
        o.customerName || "N/A",
        o.phone || "N/A",
        o.campaignName || "N/A",
        o.city || "N/A",
        o.state || "N/A",
        o.totalAmountPayable,
        o.paymentType || "N/A",
        o.deliveryStatus || o.orderStatus || "N/A",
        o.orderDate,
      ]),
    ];
    downloadCsv(exportFilename || "orders.csv", rows);
  };

  return (
    <>
      <div
        className={`fixed inset-0 z-[45] bg-slate-900/50 backdrop-blur-sm transition-opacity duration-300 ${
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
      />
      <div
        className={`fixed inset-0 z-[55] flex items-start sm:items-center justify-center p-0 sm:p-6 transition-all duration-300 ${
          open ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      >
        <div
          className={`bg-slate-50 w-full sm:max-w-5xl sm:rounded-2xl shadow-2xl h-full sm:h-auto sm:max-h-[85vh] flex flex-col overflow-hidden transition-transform duration-300 ${
            open ? "translate-y-0 scale-100" : "translate-y-4 scale-95"
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-display font-bold text-lg text-slate-800 truncate">{title}</h2>
              {subtitle && <p className="text-xs text-slate-400 truncate">{subtitle}</p>}
            </div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={onClose} title="Close">
              <X size={14} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
            <div className="flex flex-wrap gap-3">
              <div className="card !p-3 flex-1 min-w-[140px]">
                <div className="text-[11px] text-slate-400 mb-0.5">Orders</div>
                <div className="text-lg font-bold text-slate-800">{sorted.length}</div>
              </div>
              <div className="card !p-3 flex-1 min-w-[140px]">
                <div className="text-[11px] text-slate-400 mb-0.5">Revenue</div>
                <div className="text-lg font-bold text-slate-800">{currency(totalRevenue)}</div>
              </div>
              {extraCards.map((c) => (
                <div key={c.label} className="card !p-3 flex-1 min-w-[140px]">
                  <div className="text-[11px] text-slate-400 mb-0.5">{c.label}</div>
                  <div className="text-lg font-bold text-slate-800">{c.value}</div>
                </div>
              ))}
            </div>

            <div className="card p-0 overflow-hidden">
              <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-100 flex-wrap">
                <div className="relative">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    className="input pl-7 !py-1.5 !text-xs w-56"
                    placeholder="Search orders…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <ColumnSettingsMenu columns={allColumnsOrdered} hidden={hidden} toggleHidden={toggleHidden} reorder={reorder} reset={reset} />
                <button type="button" className="btn btn-secondary btn-sm" onClick={handleExport} disabled={sorted.length === 0}>
                  <Download size={13} /> Export CSV
                </button>
              </div>

              {sorted.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center px-4">
                  <span className="flex items-center justify-center w-10 h-10 rounded-2xl bg-slate-100 text-slate-400 mb-2.5">
                    <Inbox size={18} />
                  </span>
                  <div className="text-sm text-slate-400">
                    {list.length === 0 ? emptyMessage || "No orders here." : "No orders match your search."}
                  </div>
                </div>
              ) : (
                <>
                  <div className="overflow-auto max-h-[420px]">
                    <table className="table">
                      <thead className="sticky top-0 z-[1]">
                        <tr>
                          {orderedColumns.map((c) => (
                            <th
                              key={c.key}
                              className={c.sortable !== false ? "cursor-pointer select-none" : ""}
                              onClick={() => c.sortable !== false && handleSort(c.key)}
                            >
                              {c.label}
                              {c.sortable !== false ? arrow(c.key) : ""}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {paged.map((o) => (
                          <tr
                            key={o.orderId}
                            className="cursor-pointer"
                            onClick={() => openOrder({ orderId: o.orderId, tokenId })}
                          >
                            {orderedColumns.map((c) => {
                              if (c.key === "campaignName") {
                                return (
                                  <td key={c.key} onClick={(e) => e.stopPropagation()}>
                                    <CampaignLink
                                      tokenId={tokenId}
                                      campaignId={o.campaignId}
                                      campaignName={o.campaignName}
                                      since={since}
                                      until={until}
                                      className="!text-xs"
                                    />
                                  </td>
                                );
                              }
                              if (c.key === "adsetName") {
                                return (
                                  <td key={c.key} onClick={(e) => e.stopPropagation()}>
                                    <AdSetLink
                                      tokenId={tokenId}
                                      adsetId={o.adsetId}
                                      adsetName={o.adsetName}
                                      campaignId={o.campaignId}
                                      campaignName={o.campaignName}
                                      since={since}
                                      until={until}
                                      className="!text-xs"
                                    />
                                  </td>
                                );
                              }
                              if (c.key === "adName") {
                                return (
                                  <td key={c.key} onClick={(e) => e.stopPropagation()}>
                                    <AdLink
                                      tokenId={tokenId}
                                      adId={o.adId}
                                      adName={o.adName}
                                      adsetId={o.adsetId}
                                      adsetName={o.adsetName}
                                      campaignId={o.campaignId}
                                      campaignName={o.campaignName}
                                      since={since}
                                      until={until}
                                      className="!text-xs"
                                    />
                                  </td>
                                );
                              }
                              if (c.key === "paymentType") {
                                return (
                                  <td key={c.key}>
                                    <span className={`badge ${o.paymentType === "PREPAID" ? "badge-blue" : "badge-amber"}`}>
                                      {o.paymentType || "N/A"}
                                    </span>
                                  </td>
                                );
                              }
                              if (c.key === "orderId") {
                                return (
                                  <td key={c.key} className="font-medium text-slate-700">
                                    {o.orderId}
                                  </td>
                                );
                              }
                              return <td key={c.key}>{c.render(o)}</td>;
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 text-xs text-slate-500">
                    <span>
                      Page {page} of {totalPages} · {sorted.length} result{sorted.length === 1 ? "" : "s"}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm !px-2"
                        disabled={page <= 1}
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                      >
                        <ChevronLeft size={13} />
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm !px-2"
                        disabled={page >= totalPages}
                        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      >
                        <ChevronRight size={13} />
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
