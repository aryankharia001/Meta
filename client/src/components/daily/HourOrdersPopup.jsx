import { useEffect, useMemo, useState } from "react";
import { X, Search, Download, Inbox, AlertTriangle } from "lucide-react";
import { fetchDailyHourOrders } from "../../lib/api";
import { currency, formatDateTime } from "../../lib/format";
import { downloadCsv } from "../../lib/csv";
import { useOrderDrawer } from "../../lib/OrderDrawerContext";
import CampaignLink from "../CampaignLink";
import AdSetLink from "../AdSetLink";
import AdLink from "../AdLink";

// ─────────────────────────────────────────────────────────────
// Phase 15 §3/§12 — hourly order drill-down. A fresh, self-contained
// popup rather than a modification of OrdersListPopup.jsx — same "zero
// coupling" convention this codebase has followed since Phase 6
// (OrdersListPopup.jsx's own header comment explains the same choice
// for the exact same reason: a phase-specific need shouldn't risk
// changing a component every other page already depends on).
//
// Fetches the hour's orders ONCE per (date, hour, scope) via
// GET /api/daily-hourly/:tokenId/hour-orders, then filters/searches
// client-side — same pattern OrdersListPopup already uses. Row click
// opens the EXISTING Order Drawer; Campaign/Ad Set/Ad cells open the
// EXISTING Campaign/Ad Set/Ad Drawers via CampaignLink/AdSetLink/AdLink
// — nothing here re-implements those.
// ─────────────────────────────────────────────────────────────

const FILTERS = [
  { key: "all", label: "All" },
  { key: "cod", label: "COD" },
  { key: "prepaid", label: "Prepaid" },
  { key: "delivered", label: "Delivered" },
  { key: "pending", label: "Pending" },
  { key: "rto", label: "RTO" },
  { key: "cancelled", label: "Cancelled" },
];

function matchesFilter(o, filterKey) {
  switch (filterKey) {
    case "cod":
      return o.paymentType === "CASH_ON_DELIVERY";
    case "prepaid":
      return o.paymentType === "PREPAID";
    case "delivered":
      return o.deliveryBucket === "delivered";
    case "pending":
      return o.deliveryBucket === "pending" || o.deliveryBucket === "processing";
    case "rto":
      return o.deliveryBucket === "rto";
    case "cancelled":
      return o.deliveryBucket === "cancelled";
    default:
      return true;
  }
}

export default function HourOrdersPopup({ open, tokenId, date, hour, scopeLabel, campaignId, campaignName, adsetId, adId, onClose }) {
  const { openOrder } = useOrderDrawer();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filterKey, setFilterKey] = useState("all");

  useEffect(() => {
    if (!open || hour === null || hour === undefined) return;
    setSearch("");
    setFilterKey("all");
    setLoading(true);
    setError("");
    fetchDailyHourOrders(tokenId, { date, hour, campaignId, campaignName, adsetId, adId })
      .then((res) => setOrders(res.orders || []))
      .catch((err) => setError(err.message || "Failed to load orders"))
      .finally(() => setLoading(false));
  }, [open, tokenId, date, hour, campaignId, campaignName, adsetId, adId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const filtered = useMemo(() => {
    const byFilter = orders.filter((o) => matchesFilter(o, filterKey));
    const q = search.trim().toLowerCase();
    if (!q) return byFilter;
    return byFilter.filter((o) =>
      [o.orderId, o.customerName, o.phone, o.campaignName, o.adsetName, o.adName, o.product].filter(Boolean).join(" ").toLowerCase().includes(q)
    );
  }, [orders, filterKey, search]);

  const codOrders = orders.filter((o) => o.paymentType === "CASH_ON_DELIVERY");
  const prepaidOrders = orders.filter((o) => o.paymentType === "PREPAID");
  const codRevenue = codOrders.reduce((s, o) => s + Number(o.totalAmountPayable || 0), 0);
  const prepaidRevenue = prepaidOrders.reduce((s, o) => s + Number(o.totalAmountPayable || 0), 0);

  const handleExport = () => {
    const rows = [
      ["Order ID", "Order Time", "Customer", "Amount", "Payment Type", "Campaign", "Ad Set", "Ad", "Product", "Quantity", "Delivery Status"],
      ...filtered.map((o) => [
        o.orderId,
        formatDateTime(o.orderCreatedAt),
        o.customerName || "N/A",
        o.totalAmountPayable,
        o.paymentType === "PREPAID" ? "Prepaid" : o.paymentType === "CASH_ON_DELIVERY" ? "COD" : "N/A",
        o.campaignName || "N/A",
        o.adsetName || "Unmatched",
        o.adName || "Unmatched",
        o.product || "N/A",
        o.productQuantity ?? "N/A",
        o.deliveryStatus || "N/A",
      ]),
    ];
    downloadCsv(`hourly-orders-${date}-${String(hour).padStart(2, "0")}.csv`, rows);
  };

  const title = hour !== null && hour !== undefined ? `${String(hour).padStart(2, "0")}:00–${String(hour).padStart(2, "0")}:59 Orders` : "Orders";

  return (
    <>
      <div
        className={`fixed inset-0 z-[46] bg-slate-900/50 backdrop-blur-sm transition-opacity duration-300 ${
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
      />
      <div
        className={`fixed inset-0 z-[56] flex items-start sm:items-center justify-center p-0 sm:p-6 transition-all duration-300 ${
          open ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      >
        <div
          className={`bg-slate-50 w-full sm:max-w-6xl sm:rounded-2xl shadow-2xl h-full sm:h-auto sm:max-h-[88vh] flex flex-col overflow-hidden transition-transform duration-300 ${
            open ? "translate-y-0 scale-100" : "translate-y-4 scale-95"
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-display font-bold text-lg text-slate-800 truncate">{title}</h2>
              <p className="text-xs text-slate-400 truncate">
                {date}
                {scopeLabel ? ` · ${scopeLabel}` : ""}
              </p>
            </div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={onClose} title="Close">
              <X size={14} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
            {error && (
              <div className="flex items-center gap-2 text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">
                <AlertTriangle size={14} /> {error}
              </div>
            )}

            {/* §12 — COD vs Prepaid, counts + revenue, clearly separated */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="card !p-3">
                <div className="text-[11px] text-slate-400 mb-0.5">Orders</div>
                <div className="text-lg font-bold text-slate-800">{orders.length}</div>
              </div>
              <div className="card !p-3">
                <div className="text-[11px] text-slate-400 mb-0.5">Revenue</div>
                <div className="text-lg font-bold text-slate-800">{currency(orders.reduce((s, o) => s + Number(o.totalAmountPayable || 0), 0))}</div>
              </div>
              <div className="card !p-3 bg-amber-50/60">
                <div className="text-[11px] text-amber-700 mb-0.5">COD — {codOrders.length}</div>
                <div className="text-lg font-bold text-amber-800">{currency(codRevenue)}</div>
              </div>
              <div className="card !p-3 bg-sky-50/60">
                <div className="text-[11px] text-sky-700 mb-0.5">Prepaid — {prepaidOrders.length}</div>
                <div className="text-lg font-bold text-sky-800">{currency(prepaidRevenue)}</div>
              </div>
            </div>

            <div className="card p-0 overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-slate-100">
                <div className="flex flex-wrap gap-1.5">
                  {FILTERS.map((f) => (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => setFilterKey(f.key)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                        filterKey === f.key ? "bg-indigo-50 border-indigo-300 text-indigo-700" : "bg-white border-slate-200 text-slate-500 hover:bg-slate-50"
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      className="input pl-7 !py-1.5 !text-xs w-48"
                      placeholder="Search orders…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={handleExport} disabled={filtered.length === 0}>
                    <Download size={13} /> Export CSV
                  </button>
                </div>
              </div>

              {loading ? (
                <div className="flex items-center justify-center py-10 text-sm text-slate-400">Loading orders…</div>
              ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center px-4">
                  <span className="flex items-center justify-center w-10 h-10 rounded-2xl bg-slate-100 text-slate-400 mb-2.5">
                    <Inbox size={18} />
                  </span>
                  <div className="text-sm text-slate-400">{orders.length === 0 ? "No orders in this hour." : "No orders match this filter."}</div>
                </div>
              ) : (
                <div className="overflow-auto max-h-[420px]">
                  <table className="table">
                    <thead className="sticky top-0 z-[1]">
                      <tr>
                        <th>Order ID</th>
                        <th>Time</th>
                        <th>Customer</th>
                        <th className="num">Amount</th>
                        <th>Payment</th>
                        <th>Campaign</th>
                        <th>Ad Set</th>
                        <th>Ad</th>
                        <th>Product</th>
                        <th className="num">Qty</th>
                        <th>Delivery Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((o) => (
                        <tr key={o.orderId} className="cursor-pointer" onClick={() => openOrder({ orderId: o.orderId, tokenId })}>
                          <td className="font-medium text-slate-700">{o.orderId}</td>
                          <td className="whitespace-nowrap">{formatDateTime(o.orderCreatedAt)}</td>
                          <td>{o.customerName || "N/A"}</td>
                          <td className="num">{currency(o.totalAmountPayable)}</td>
                          <td>
                            <span className={`badge ${o.paymentType === "PREPAID" ? "badge-blue" : "badge-amber"}`}>
                              {o.paymentType === "PREPAID" ? "Prepaid" : o.paymentType === "CASH_ON_DELIVERY" ? "COD" : "N/A"}
                            </span>
                          </td>
                          <td onClick={(e) => e.stopPropagation()}>
                            <CampaignLink tokenId={tokenId} campaignId={o.campaignId} campaignName={o.campaignName} since={date} until={date} className="!text-xs" />
                          </td>
                          <td onClick={(e) => e.stopPropagation()}>
                            <AdSetLink
                              tokenId={tokenId}
                              adsetId={o.adsetId}
                              adsetName={o.adsetName}
                              campaignId={o.campaignId}
                              campaignName={o.campaignName}
                              since={date}
                              until={date}
                              className="!text-xs"
                            />
                          </td>
                          <td onClick={(e) => e.stopPropagation()}>
                            <AdLink
                              tokenId={tokenId}
                              adId={o.adId}
                              adName={o.adName}
                              adsetId={o.adsetId}
                              adsetName={o.adsetName}
                              campaignId={o.campaignId}
                              campaignName={o.campaignName}
                              since={date}
                              until={date}
                              className="!text-xs"
                            />
                          </td>
                          <td className="max-w-[180px] truncate" title={o.product || "N/A"}>
                            {o.product || "N/A"}
                          </td>
                          <td className="num">{o.productQuantity ?? "N/A"}</td>
                          <td>{o.deliveryStatus || "N/A"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
