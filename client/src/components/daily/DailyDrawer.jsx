import { useEffect, useState } from "react";
import { X, AlertTriangle, RefreshCw, Inbox, Search, Download, ChevronDown, ChevronRight, Clock4, Layers } from "lucide-react";
import { fetchDailyDetail, fetchAdSetsByCampaign } from "../../lib/api";
import { currency, number, multiplier, formatDateTime } from "../../lib/format";
import { formatDayLabel } from "../../lib/dateIst";
import { formatBudget, roasClass } from "../../lib/campaignDisplay";
import { downloadCsv } from "../../lib/csv";
import { useOrderDrawer } from "../../lib/OrderDrawerContext";
// Phase 13 §12 — optional Ad Set/Hourly hierarchy for this exact
// (date, campaign), collapsed by default so the Daily page stays clean.
import { useAdSetDrawer } from "../../lib/AdSetDrawerContext";
import HourlyPanel from "../hourly/HourlyPanel";

// ────────────────────────────────────────────────────────────────
// Phase 10 — Daily row drill-down. Opened when a (day, campaign) row
// is clicked in DailyTable.jsx. Fetches the exact 24-hour window's
// metrics + order list from GET /api/daily/:tokenId/detail, then hands
// every order row off to the EXISTING Order Drawer (useOrderDrawer) —
// per the spec's explicit "do not create a separate order-detail
// implementation," this component never renders order details itself,
// only a summary table whose rows open the real Order Drawer.
// ────────────────────────────────────────────────────────────────

export default function DailyDrawer({ meta, onClose }) {
  const open = !!meta;
  const { openOrder } = useOrderDrawer();
  const { openAdSet } = useAdSetDrawer();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  // Phase 13 §12 — collapsed by default; only fetched once expanded.
  const [hierarchyOpen, setHierarchyOpen] = useState(false);
  const [adSets, setAdSets] = useState([]);
  const [adSetsLoading, setAdSetsLoading] = useState(false);
  useEffect(() => {
    if (!hierarchyOpen || !meta?.campaignId || meta.isUnmatched) return;
    let cancelled = false;
    setAdSetsLoading(true);
    fetchAdSetsByCampaign(meta.tokenId, meta.campaignId, { since: meta.date, until: meta.date })
      .then((res) => !cancelled && setAdSets(res.adsets || []))
      .catch(() => !cancelled && setAdSets([]))
      .finally(() => !cancelled && setAdSetsLoading(false));
    return () => { cancelled = true; };
  }, [hierarchyOpen, meta?.tokenId, meta?.campaignId, meta?.date, meta?.isUnmatched]);

  // The panel fades out over 300ms (see the `open ? ... : ...` classes
  // below) rather than unmounting instantly, but `meta` itself goes
  // null the moment onClose fires. Rendering against `meta` directly
  // during that fade used to throw ("Cannot read properties of null")
  // because `data` was still the last-loaded response — which the
  // ErrorBoundary in App.jsx caught and showed as "Something went
  // wrong." `displayMeta` keeps the last non-null meta around so the
  // fade-out shows the campaign it was actually displaying instead of
  // crashing; `meta`/`open` still drive fetching and visibility.
  const [displayMeta, setDisplayMeta] = useState(null);
  useEffect(() => {
    if (meta) setDisplayMeta(meta);
  }, [meta]);

  const load = () => {
    if (!meta) return;
    setLoading(true);
    setError("");
    fetchDailyDetail(meta.tokenId, {
      date: meta.date,
      campaignId: meta.isUnmatched ? undefined : meta.campaignId,
      campaignName: meta.campaignName,
      accountId: meta.accountId,
    })
      .then((res) => setData(res))
      .catch((err) => setError(err.message || "Failed to load daily details"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!open) return;
    setData(null);
    setSearch("");
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, meta?.date, meta?.campaignId, meta?.campaignName, meta?.tokenId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const orders = data?.orders || [];
  const q = search.trim().toLowerCase();
  const filteredOrders = q
    ? orders.filter((o) => [o.orderId, o.customerName, o.phone, o.product].filter(Boolean).join(" ").toLowerCase().includes(q))
    : orders;

  const handleExport = () => {
    const rows = [
      ["Order ID", "Customer", "Payment Type", "Revenue", "Products", "Quantity", "Status"],
      ...filteredOrders.map((o) => [
        o.orderId,
        o.customerName || "N/A",
        o.paymentType || "N/A",
        o.totalAmountPayable,
        o.product || "N/A",
        o.productQuantity ?? "N/A",
        o.deliveryStatus || o.orderStatus || "N/A",
      ]),
    ];
    downloadCsv(`daily-${displayMeta?.date}-${(displayMeta?.campaignName || "orders").replace(/\s+/g, "-")}.csv`, rows);
  };

  return (
    <>
      <div
        className={`fixed inset-0 z-[42] bg-slate-900/50 backdrop-blur-sm transition-opacity duration-300 ${
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
      />
      <div
        className={`fixed inset-0 z-[52] flex items-start sm:items-center justify-center p-0 sm:p-6 transition-all duration-300 ${
          open ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      >
        <div
          className={`bg-slate-50 w-full sm:max-w-5xl sm:rounded-2xl shadow-2xl h-full sm:h-auto sm:max-h-[88vh] flex flex-col overflow-hidden transition-transform duration-300 ${
            open ? "translate-y-0 scale-100" : "translate-y-4 scale-95"
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-display font-bold text-lg text-slate-800 truncate">{displayMeta?.campaignName || "Daily Detail"}</h2>
              <p className="text-xs text-slate-400 truncate">{displayMeta ? formatDayLabel(displayMeta.date) : ""}</p>
            </div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={onClose} title="Close">
              <X size={14} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
            {loading && <DrawerSkeleton />}
            {!loading && error && <DrawerError message={error} onRetry={load} />}

            {!loading && !error && data && displayMeta && (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <Stat label="24h Window" value={`${displayMeta.date} 00:00 → 23:59 IST`} wide />
                  <Stat
                    label="Budget"
                    value={formatBudget(data.metrics.budget, data.metrics.budgetType) || "N/A"}
                    caption={data.metrics.budgetSource === "adsets" ? "Ad Set Budget Applied" : null}
                  />
                  <Stat label="Spend" value={currency(data.metrics.spend)} />
                  <Stat label="Orders" value={number(data.metrics.orders)} />
                  <Stat label="Revenue" value={currency(data.metrics.revenue)} />
                  <Stat label="ROAS" value={multiplier(data.metrics.roas)} valueClassName={roasClass(data.metrics.roas)} />
                  <Stat label="COD Orders" value={number(data.metrics.codOrders)} />
                  <Stat label="Prepaid Orders" value={number(data.metrics.prepaidOrders)} />
                  <Stat label="Avg Order Value" value={currency(data.metrics.aov)} />
                  <Stat label="Delivered" value={number(data.metrics.delivered)} />
                  <Stat label="Pending" value={number(data.metrics.pending)} />
                  <Stat label="Cancelled" value={number(data.metrics.cancelled)} />
                  <Stat label="Returned" value={number(data.metrics.returned)} />
                  <Stat label="Products Sold" value={number(data.metrics.totalProductsSold)} />
                  <Stat label="Units Sold" value={number(data.metrics.totalUnitsSold)} />
                </div>

                {!meta.isUnmatched && meta.campaignId && (
                  <div className="card p-0 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setHierarchyOpen((v) => !v)}
                      className="w-full flex items-center justify-between gap-2 px-4 py-3 text-sm font-display font-semibold text-slate-700"
                    >
                      <span className="flex items-center gap-2">
                        {hierarchyOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        Ad Set &amp; Hourly Breakdown
                      </span>
                      <span className="text-[11px] font-normal text-slate-400">Campaign → Ad Set → Ad → Orders, and Hour → Orders</span>
                    </button>
                    {hierarchyOpen && (
                      <div className="border-t border-slate-100 px-4 py-4 space-y-5">
                        <div>
                          <h4 className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                            <Layers size={12} /> Ad Sets
                          </h4>
                          {adSetsLoading ? (
                            <p className="text-sm text-slate-400">Loading ad sets…</p>
                          ) : adSets.length === 0 ? (
                            <p className="text-sm text-slate-400">No ad sets found for this campaign/date.</p>
                          ) : (
                            <div className="flex flex-wrap gap-2">
                              {adSets.map((a) => (
                                <button
                                  key={a.adsetId}
                                  type="button"
                                  className="btn btn-secondary btn-sm !py-1"
                                  onClick={() => openAdSet({ tokenId: meta.tokenId, adsetId: a.adsetId, adsetName: a.adsetName, campaignId: meta.campaignId, campaignName: meta.campaignName, since: meta.date, until: meta.date })}
                                >
                                  {a.adsetName} · {a.totalOrders} order{a.totalOrders === 1 ? "" : "s"}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                        <div>
                          <h4 className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                            <Clock4 size={12} /> Hourly
                          </h4>
                          <HourlyPanel
                            tokenId={meta.tokenId}
                            campaignId={meta.campaignId}
                            campaignName={meta.campaignName}
                            fixedDate={meta.date}
                            tableIdSuffix={`daily-${meta.campaignId}`}
                            title=""
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="card p-0 overflow-hidden">
                  <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-100 flex-wrap">
                    <h3 className="font-display font-semibold text-sm text-slate-700">
                      Orders <span className="text-slate-400 font-normal">({filteredOrders.length})</span>
                    </h3>
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
                      <button type="button" className="btn btn-secondary btn-sm" onClick={handleExport} disabled={filteredOrders.length === 0}>
                        <Download size={13} /> Export CSV
                      </button>
                    </div>
                  </div>

                  {filteredOrders.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-10 text-center px-4">
                      <span className="flex items-center justify-center w-10 h-10 rounded-2xl bg-slate-100 text-slate-400 mb-2.5">
                        <Inbox size={18} />
                      </span>
                      <div className="text-sm text-slate-400">
                        {orders.length === 0 ? "No orders in this 24-hour window." : "No orders match your search."}
                      </div>
                    </div>
                  ) : (
                    <div className="overflow-auto max-h-[380px]">
                      <table className="table">
                        <thead className="sticky top-0 z-[1]">
                          <tr>
                            <th>Order ID</th>
                            <th>Customer</th>
                            <th>Payment Type</th>
                            <th>Revenue</th>
                            <th>Products</th>
                            <th>Quantity</th>
                            <th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredOrders.map((o) => (
                            <tr key={o.orderId} className="cursor-pointer" onClick={() => openOrder({ orderId: o.orderId, tokenId: displayMeta.tokenId })}>
                              <td className="font-medium text-slate-700">{o.orderId}</td>
                              <td>{o.customerName || "N/A"}</td>
                              <td>
                                <span className={`badge ${o.paymentType === "PREPAID" ? "badge-blue" : "badge-amber"}`}>
                                  {o.paymentType || "N/A"}
                                </span>
                              </td>
                              <td>{currency(o.totalAmountPayable)}</td>
                              <td className="max-w-[200px] truncate" title={o.product || "N/A"}>
                                {o.product || "N/A"}
                              </td>
                              <td>{o.productQuantity ?? "N/A"}</td>
                              <td>{o.deliveryStatus || o.orderStatus || "N/A"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {orders[0]?.orderCreatedAt && (
                  <p className="text-[11px] text-slate-400">
                    Most recent order in this window: {formatDateTime(orders[0].orderCreatedAt)}
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// Phase 36 §4 — optional `caption` renders as a small, muted line below the
// value (never a second top-level Stat) — used only by Budget's "Ad Set
// Budget Applied" note when the value is a fallback sum rather than a
// genuine Meta-reported campaign budget. Every other caller is unaffected.
function Stat({ label, value, wide, valueClassName, caption }) {
  return (
    <div className={`card !p-3.5 ${wide ? "col-span-2 sm:col-span-4" : ""}`}>
      <div className="text-[11px] text-slate-500 mb-0.5">{label}</div>
      <div className={`text-base font-display font-bold text-slate-800 truncate ${valueClassName || ""}`}>{value}</div>
      {caption && <div className="text-[10px] font-normal text-slate-400 mt-0.5">{caption}</div>}
    </div>
  );
}

function DrawerSkeleton() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="card !p-3.5">
            <div className="h-3 w-16 bg-slate-100 rounded animate-pulse mb-2" />
            <div className="h-5 w-12 bg-slate-100 rounded animate-pulse" />
          </div>
        ))}
      </div>
      <div className="card h-64 animate-pulse bg-slate-100" />
    </div>
  );
}

function DrawerError({ message, onRetry }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <span className="flex items-center justify-center w-14 h-14 rounded-2xl bg-rose-100 text-rose-600 mb-4">
        <AlertTriangle size={26} />
      </span>
      <h3 className="font-display font-semibold text-slate-700 mb-1">Couldn't load this day's details</h3>
      <p className="text-sm text-slate-400 max-w-sm mb-5">{message}</p>
      <button type="button" className="btn btn-primary btn-sm" onClick={onRetry}>
        <RefreshCw size={14} /> Try again
      </button>
    </div>
  );
}
