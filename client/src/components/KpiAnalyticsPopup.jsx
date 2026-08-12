import { useEffect, useMemo, useRef, useState } from "react";
import {
  X,
  ArrowLeft,
  Search,
  Download,
  ChevronLeft,
  ChevronRight,
  Inbox,
  AlertTriangle,
  RefreshCw,
  Layers,
} from "lucide-react";
import { fetchOrdersDetailed } from "../lib/api";
import { getCachedDetailedOrders, setCachedDetailedOrders } from "../lib/detailedOrdersCache";
import { downloadCsv } from "../lib/csv";
import { currency, number, multiplier, formatDate } from "../lib/format";
import CampaignLink from "./CampaignLink";
import { useOrderDrawer } from "../lib/OrderDrawerContext";
import { useLiveSync, rangeIncludesToday } from "../lib/LiveSyncContext";
import { useColumnPrefs } from "../lib/useColumnPrefs";
import ColumnSettingsMenu from "./ColumnSettingsMenu";

// ────────────────────────────────────────────────────────────────
// Phase 3 — Dashboard KPI analytics popups.
//
// Every KPI card on the dashboard opens this same component, configured
// per card via POPUP_CONFIG below. It never touches /compare or the
// matching logic — "campaignFinance" popups (Revenue/Spend/Profit/ROAS/
// Active Campaigns) read straight from the already-loaded /compare
// response (dashboardData), no extra request at all. Everything else
// (order-level popups + the grouped ones) lazily fetches the new
// /orders-detailed endpoint once per (token, accounts, date range) —
// see detailedOrdersCache.js — and reuses it across every popup opened
// in that same range, including re-derived matched/outside-range/
// unmatched buckets, which are classified client-side from data this
// component already has (dashboardData.campaigns + knownCampaignNames),
// so nothing on the server needed to change to support that split.
// ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 10;

const normalizeCampaignName = (name) =>
  String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

function deliveryMatches(order, keywords) {
  return !!order.deliveryStatus && keywords.some((k) => order.deliveryStatus.toLowerCase().includes(k));
}

function groupOrders(orders, { withDelivery = false } = {}) {
  const map = new Map();
  orders.forEach((o) => {
    const name = o.campaignName || "No Campaign Name";
    if (!map.has(name)) map.set(name, []);
    map.get(name).push(o);
  });
  return [...map.entries()]
    .map(([name, list]) => {
      const codList = list.filter((o) => o.paymentType === "CASH_ON_DELIVERY");
      const prepaidList = list.filter((o) => o.paymentType === "PREPAID");
      const base = {
        key: name,
        campaignName: name,
        campaignId: list.find((o) => o.campaignId)?.campaignId || null,
        orderCount: list.length,
        revenue: list.reduce((s, o) => s + Number(o.totalAmountPayable || 0), 0),
        orderList: list,
        // Phase 10 — COD/Prepaid orders AND revenue, always computed (not
        // gated behind a flag) so every campaignOrders source — Matched,
        // Unmatched, Outside Range, COD, Prepaid — can show the payment
        // breakdown the spec asks for, not just outsideRange like before.
        cod: codList.length,
        codRevenue: codList.reduce((s, o) => s + Number(o.totalAmountPayable || 0), 0),
        prepaid: prepaidList.length,
        prepaidRevenue: prepaidList.reduce((s, o) => s + Number(o.totalAmountPayable || 0), 0),
      };
      if (withDelivery) {
        base.delivered = list.filter((o) => deliveryMatches(o, ["deliver"])).length;
        base.pending = list.filter((o) => deliveryMatches(o, ["pending", "transit", "process", "confirm"])).length;
        base.cancelled = list.filter((o) => deliveryMatches(o, ["cancel"])).length;
      }
      return base;
    })
    .sort((a, b) => b.orderCount - a.orderCount);
}

// Card key -> popup behavior. "campaignFinance" never needs the detailed
// fetch; everything else does.
const POPUP_CONFIG = {
  totalOrders: { mode: "orders", title: "Total Orders", ordersFilter: () => true },
  aov: { mode: "orders", title: "Average Order Value", ordersFilter: () => true },
  delivered: { mode: "orders", title: "Delivered Orders", ordersFilter: (o) => deliveryMatches(o, ["deliver"]) },
  pending: {
    mode: "orders",
    title: "Pending Orders",
    ordersFilter: (o) => deliveryMatches(o, ["pending", "transit", "process", "confirm"]),
  },
  cancelled: { mode: "orders", title: "Cancelled Orders", ordersFilter: (o) => deliveryMatches(o, ["cancel"]) },
  returned: { mode: "orders", title: "Returned Orders", ordersFilter: (o) => deliveryMatches(o, ["return", "rto"]) },

  revenue: { mode: "campaignFinance", title: "Revenue by Campaign", sortKey: "revenue" },
  spend: { mode: "campaignFinance", title: "Spend by Campaign", sortKey: "spend" },
  profit: { mode: "campaignFinance", title: "Profit by Campaign", sortKey: "profit" },
  roas: { mode: "campaignFinance", title: "ROAS by Campaign", sortKey: "roas" },
  activeCampaigns: { mode: "campaignFinance", title: "Active Campaigns", sortKey: "spend" },

  matchedOrders: { mode: "campaignOrders", title: "Matched Orders", source: "matched" },
  unmatchedOrders: { mode: "campaignOrders", title: "Unmatched Orders", source: "unmatched" },
  outsideRange: {
    mode: "campaignOrders",
    title: "Orders Outside Selected Campaign Date Range",
    source: "outsideRange",
  },
  cod: { mode: "campaignOrders", title: "COD Orders", source: "cod" },
  prepaid: { mode: "campaignOrders", title: "Prepaid Orders", source: "prepaid" },
};

export default function KpiAnalyticsPopup({ card, onClose, dashboardData, tokenId, accountIds, since, until }) {
  const open = !!card;
  const config = card ? POPUP_CONFIG[card.key] : null;
  const needsDetailed = config && config.mode !== "campaignFinance";
  const { openOrder } = useOrderDrawer();

  const [detailed, setDetailed] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [drillGroup, setDrillGroup] = useState(null); // campaignOrders mode: selected group, or null = groups view
  const handleOrderClick = (o) => openOrder({ orderId: o.orderId, tokenId });

  const liveSync = useLiveSync();

  const accountsKey = useMemo(() => [...(accountIds || [])].sort().join(","), [accountIds]);

  const load = ({ force = false } = {}) => {
    if (!needsDetailed) return;
    if (!force) {
      const cached = getCachedDetailedOrders(tokenId, accountsKey, since, until);
      if (cached) {
        setDetailed(cached);
        setError("");
        setLoading(false);
        return;
      }
    }
    setLoading(true);
    setError("");
    fetchOrdersDetailed(tokenId, { accountIds, since, until })
      .then((res) => {
        setDetailed(res);
        setCachedDetailedOrders(tokenId, accountsKey, since, until, res);
      })
      .catch((err) => setError(err.message || "Failed to load order details"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!open) return;
    setDrillGroup(null);
    if (needsDetailed) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, card?.key, tokenId, accountsKey, since, until]);

  // Phase 5 — "refresh any open popup if its data has changed". Only
  // relevant to popups backed by the lazy /orders-detailed fetch (the
  // campaignFinance ones already read live off dashboardData, which
  // Dashboard.jsx itself refreshes on the same signal). Bypasses the
  // cache on purpose (force: true) since the whole point is picking up
  // orders the cached response predates; skipped if the popup's own
  // date range doesn't include today, same date-filter-awareness rule
  // as everywhere else.
  const prevPopupSyncVersionRef = useRef(liveSync.syncVersion);
  useEffect(() => {
    if (!open || !needsDetailed) return;
    if (liveSync.syncVersion === prevPopupSyncVersionRef.current) return;
    prevPopupSyncVersionRef.current = liveSync.syncVersion;
    const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
    const todayIso = new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
    if (rangeIncludesToday(since, until, todayIso)) {
      load({ force: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveSync.syncVersion, open, needsDetailed, since, until]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // ── Classification: matched / outside-range / truly-unmatched ──
  // Purely client-side, from data this component already has — never
  // touches /compare.
  const classification = useMemo(() => {
    if (!detailed || !dashboardData) return null;
    const inRangeNames = new Set((dashboardData.campaigns || []).map((c) => normalizeCampaignName(c.campaignName)));
    const knownNames = new Set(detailed.knownCampaignNames || []);

    const matched = [];
    const outsideRange = [];
    const trulyUnmatched = [];

    (detailed.orders || []).forEach((o) => {
      const n = normalizeCampaignName(o.campaignName);
      if (n && inRangeNames.has(n)) matched.push(o);
      else if (n && knownNames.has(n)) outsideRange.push(o);
      else trulyUnmatched.push(o);
    });

    return { matched, outsideRange, trulyUnmatched };
  }, [detailed, dashboardData]);

  // ── campaignFinance rows (Revenue/Spend/Profit/ROAS/Active Campaigns) ──
  const financeRows = useMemo(() => {
    if (!dashboardData) return [];
    return (dashboardData.campaigns || []).map((c) => ({
      key: c.campaignId,
      campaignId: c.campaignId,
      campaignName: c.campaignName,
      accountId: c.accountId,
      spend: Number(c.spend || 0),
      revenue: Number(c.revenue || 0),
      orderCount: c.orders || 0,
      roas: Number(c.roas || 0),
      profit: Number(c.revenue || 0) - Number(c.spend || 0),
      aov: c.orders ? Number(c.revenue || 0) / c.orders : 0,
    }));
  }, [dashboardData]);

  // ── campaignOrders groups, per source ──
  const groups = useMemo(() => {
    if (!config || config.mode !== "campaignOrders") return [];
    if (config.source === "matched") {
      if (!dashboardData) return [];
      const enrichedByName = new Map();
      (classification?.matched || []).forEach((o) => {
        const n = normalizeCampaignName(o.campaignName);
        if (!enrichedByName.has(n)) enrichedByName.set(n, []);
        enrichedByName.get(n).push(o);
      });
      return (dashboardData.campaigns || [])
        .filter((c) => c.orders > 0)
        .map((c) => {
          const orderList = enrichedByName.get(normalizeCampaignName(c.campaignName)) || [];
          const codList = orderList.filter((o) => o.paymentType === "CASH_ON_DELIVERY");
          const prepaidList = orderList.filter((o) => o.paymentType === "PREPAID");
          return {
            key: c.campaignId,
            campaignId: c.campaignId,
            campaignName: c.campaignName,
            accountId: c.accountId,
            orderCount: c.orders,
            revenue: c.revenue,
            spend: c.spend,
            roas: c.roas,
            orderList,
            // Phase 10 — payment breakdown for the Matched Orders view.
            cod: codList.length,
            codRevenue: codList.reduce((s, o) => s + Number(o.totalAmountPayable || 0), 0),
            prepaid: prepaidList.length,
            prepaidRevenue: prepaidList.reduce((s, o) => s + Number(o.totalAmountPayable || 0), 0),
          };
        })
        .sort((a, b) => b.revenue - a.revenue);
    }
    if (config.source === "unmatched") return groupOrders(classification?.trulyUnmatched || []);
    if (config.source === "outsideRange") return groupOrders(classification?.outsideRange || []);
    if (config.source === "cod") {
      const orders = (detailed?.orders || []).filter((o) => o.paymentType === "CASH_ON_DELIVERY");
      return groupOrders(orders, { withDelivery: true });
    }
    if (config.source === "prepaid") {
      const orders = (detailed?.orders || []).filter((o) => o.paymentType === "PREPAID");
      return groupOrders(orders, { withDelivery: true });
    }
    return [];
  }, [config, dashboardData, classification, detailed]);

  // ── Flat "orders" mode list ──
  const flatOrders = useMemo(() => {
    if (!config || config.mode !== "orders" || !detailed) return [];
    return (detailed.orders || []).filter(config.ordersFilter);
  }, [config, detailed]);

  const retry = () => load({ force: true });

  const noDeliveryDataAtAll = useMemo(
    () => !!detailed && !(detailed.orders || []).some((o) => o.deliveryStatus),
    [detailed]
  );

  return (
    <>
      <div
        className={`fixed inset-0 z-30 bg-slate-900/50 backdrop-blur-sm transition-opacity duration-300 ${
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
      />

      <div
        className={`fixed inset-0 z-[35] flex items-start sm:items-center justify-center p-0 sm:p-6 transition-all duration-300 ${
          open ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      >
        <div
          className={`bg-slate-50 w-full sm:max-w-6xl sm:rounded-2xl shadow-2xl h-full sm:h-auto sm:max-h-[90vh] flex flex-col overflow-hidden transition-transform duration-300 ${
            open ? "translate-y-0 scale-100" : "translate-y-4 scale-95"
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          {config && (
            <>
              {/* Header */}
              <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  {config.mode === "campaignOrders" && drillGroup && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm !px-2 mr-1"
                      onClick={() => setDrillGroup(null)}
                      title="Back to campaigns"
                    >
                      <ArrowLeft size={14} />
                    </button>
                  )}
                  <div className="min-w-0">
                    <h2 className="font-display font-bold text-lg text-slate-800 truncate">
                      {config.mode === "campaignOrders" && drillGroup ? drillGroup.campaignName : config.title}
                    </h2>
                    <p className="text-xs text-slate-400">
                      {since === until ? since : `${since} → ${until}`}
                    </p>
                  </div>
                </div>
                <button type="button" className="btn btn-secondary btn-sm" onClick={onClose} title="Close">
                  <X size={14} />
                </button>
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
                {needsDetailed && loading && <PopupSkeleton />}

                {needsDetailed && !loading && error && <PopupError message={error} onRetry={retry} />}

                {(!needsDetailed || (!loading && !error)) && (
                  <>
                    {config.mode === "campaignFinance" && (
                      <CampaignFinanceView
                        rows={financeRows}
                        tokenId={tokenId}
                        since={since}
                        until={until}
                        sortKeyDefault={config.sortKey}
                        title={config.title}
                      />
                    )}

                    {config.mode === "orders" && (
                      <>
                        <KpiStrip
                          items={[
                            { label: "Orders", value: number(flatOrders.length) },
                            {
                              label: "Revenue",
                              value: currency(flatOrders.reduce((s, o) => s + Number(o.totalAmountPayable || 0), 0)),
                            },
                            { label: "COD Orders", value: number(flatOrders.filter((o) => o.paymentType === "CASH_ON_DELIVERY").length) },
                            { label: "Prepaid Orders", value: number(flatOrders.filter((o) => o.paymentType === "PREPAID").length) },
                            {
                              label: "COD Revenue",
                              value: currency(flatOrders.filter((o) => o.paymentType === "CASH_ON_DELIVERY").reduce((s, o) => s + Number(o.totalAmountPayable || 0), 0)),
                            },
                            {
                              label: "Prepaid Revenue",
                              value: currency(flatOrders.filter((o) => o.paymentType === "PREPAID").reduce((s, o) => s + Number(o.totalAmountPayable || 0), 0)),
                            },
                          ]}
                        />
                        <OrdersTable
                          orders={flatOrders}
                          tokenId={tokenId}
                          since={since}
                          until={until}
                          onOrderClick={handleOrderClick}
                          exportFilename={`${card.key}-orders.csv`}
                          emptyMessage={
                            ["delivered", "pending", "cancelled", "returned"].includes(card.key) && noDeliveryDataAtAll
                              ? "Delivery status isn't tracked in the Shiprocket data yet — this view will populate once that's available."
                              : undefined
                          }
                        />
                      </>
                    )}

                    {config.mode === "campaignOrders" && !drillGroup && (
                      <GroupsView
                        groups={groups}
                        source={config.source}
                        tokenId={tokenId}
                        since={since}
                        until={until}
                        onOpenGroup={setDrillGroup}
                      />
                    )}

                    {config.mode === "campaignOrders" && drillGroup && (
                      <>
                        <KpiStrip
                          items={[
                            { label: "Orders", value: number(drillGroup.orderCount) },
                            { label: "Revenue", value: currency(drillGroup.revenue) },
                            { label: "COD Orders", value: number(drillGroup.cod ?? (drillGroup.orderList || []).filter((o) => o.paymentType === "CASH_ON_DELIVERY").length) },
                            { label: "Prepaid Orders", value: number(drillGroup.prepaid ?? (drillGroup.orderList || []).filter((o) => o.paymentType === "PREPAID").length) },
                            { label: "COD Revenue", value: currency(drillGroup.codRevenue ?? (drillGroup.orderList || []).filter((o) => o.paymentType === "CASH_ON_DELIVERY").reduce((s, o) => s + Number(o.totalAmountPayable || 0), 0)) },
                            { label: "Prepaid Revenue", value: currency(drillGroup.prepaidRevenue ?? (drillGroup.orderList || []).filter((o) => o.paymentType === "PREPAID").reduce((s, o) => s + Number(o.totalAmountPayable || 0), 0)) },
                          ]}
                        />
                        <OrdersTable
                          key={drillGroup.key}
                          orders={drillGroup.orderList || []}
                          tokenId={tokenId}
                          since={since}
                          until={until}
                          onOrderClick={handleOrderClick}
                          exportFilename={`${card.key}-${drillGroup.campaignName}-orders.csv`}
                        />
                      </>
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

// ────────────────────────────────────────────────────────────────
// Subviews
// ────────────────────────────────────────────────────────────────

function KpiStrip({ items }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {items.map((it) => (
        <div key={it.label} className="card !p-3.5">
          <div className="text-[12px] text-slate-500 mb-1">{it.label}</div>
          <div className="text-lg font-display font-bold text-slate-800 truncate">{it.value}</div>
        </div>
      ))}
    </div>
  );
}

function CampaignFinanceView({ rows, tokenId, since, until, sortKeyDefault, title }) {
  const [search, setSearch] = useState("");
  const [sortConfig, setSortConfig] = useState({ key: sortKeyDefault || "revenue", direction: "desc" });
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => (r.campaignName || "").toLowerCase().includes(q));
  }, [rows, search]);

  const sorted = useMemo(() => {
    const list = [...filtered];
    list.sort((a, b) => {
      let x = a[sortConfig.key];
      let y = b[sortConfig.key];
      if (typeof x === "string") {
        x = x.toLowerCase();
        y = (y || "").toLowerCase();
      } else {
        x = Number(x || 0);
        y = Number(y || 0);
      }
      if (x < y) return sortConfig.direction === "asc" ? -1 : 1;
      if (x > y) return sortConfig.direction === "asc" ? 1 : -1;
      return 0;
    });
    return list;
  }, [filtered, sortConfig]);

  useEffect(() => setPage(1), [search, sortConfig]);
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const paged = sorted.slice((page - 1) * PAGE_SIZE, (page - 1) * PAGE_SIZE + PAGE_SIZE);
  const handleSort = (key) => setSortConfig((p) => ({ key, direction: p.key === key && p.direction === "asc" ? "desc" : "asc" }));
  const arrow = (key) => (sortConfig.key !== key ? "" : sortConfig.direction === "asc" ? " ↑" : " ↓");

  const totals = useMemo(
    () => ({
      spend: rows.reduce((s, r) => s + r.spend, 0),
      revenue: rows.reduce((s, r) => s + r.revenue, 0),
      orders: rows.reduce((s, r) => s + r.orderCount, 0),
    }),
    [rows]
  );

  const handleExport = () => {
    const csvRows = [
      ["Campaign", "Spend", "Revenue", "Orders", "Avg Order Value", "ROAS", "Profit"],
      ...sorted.map((r) => [r.campaignName, r.spend, r.revenue, r.orderCount, r.aov.toFixed(2), r.roas.toFixed(2), r.profit]),
    ];
    downloadCsv(`${title.toLowerCase().replace(/\s+/g, "-")}.csv`, csvRows);
  };

  return (
    <>
      <KpiStrip
        items={[
          { label: "Campaigns", value: number(rows.length) },
          { label: "Total Spend", value: currency(totals.spend) },
          { label: "Total Revenue", value: currency(totals.revenue) },
          { label: "Overall ROAS", value: multiplier(totals.spend ? totals.revenue / totals.spend : 0) },
        ]}
      />

      <div className="card p-0 overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-100 flex-wrap">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              className="input pl-7 !py-1.5 !text-xs w-56"
              placeholder="Search campaigns…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={handleExport} disabled={sorted.length === 0}>
            <Download size={13} /> Export CSV
          </button>
        </div>

        {sorted.length === 0 ? (
          <EmptyBlock message={rows.length === 0 ? "No campaigns in this date range." : "No campaigns match your search."} />
        ) : (
          <>
            <div className="overflow-auto max-h-[440px]">
              <table className="table">
                <thead className="sticky top-0 z-[1]">
                  <tr>
                    <th className="cursor-pointer select-none" onClick={() => handleSort("campaignName")}>
                      Campaign{arrow("campaignName")}
                    </th>
                    <th className="cursor-pointer select-none" onClick={() => handleSort("spend")}>
                      Spend{arrow("spend")}
                    </th>
                    <th className="cursor-pointer select-none" onClick={() => handleSort("revenue")}>
                      Revenue{arrow("revenue")}
                    </th>
                    <th className="cursor-pointer select-none" onClick={() => handleSort("orderCount")}>
                      Orders{arrow("orderCount")}
                    </th>
                    <th className="cursor-pointer select-none" onClick={() => handleSort("aov")}>
                      Avg Order Value{arrow("aov")}
                    </th>
                    <th className="cursor-pointer select-none" onClick={() => handleSort("roas")}>
                      ROAS{arrow("roas")}
                    </th>
                    <th className="cursor-pointer select-none" onClick={() => handleSort("profit")}>
                      Profit{arrow("profit")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {paged.map((r) => (
                    <tr key={r.key}>
                      <td>
                        <CampaignLink
                          tokenId={tokenId}
                          campaignId={r.campaignId}
                          campaignName={r.campaignName}
                          accountId={r.accountId}
                          since={since}
                          until={until}
                        />
                      </td>
                      <td>{currency(r.spend)}</td>
                      <td>{currency(r.revenue)}</td>
                      <td>{number(r.orderCount)}</td>
                      <td>{currency(r.aov)}</td>
                      <td className={`font-bold ${r.roas >= 3 ? "text-emerald-600" : r.roas >= 2 ? "text-amber-600" : "text-rose-600"}`}>
                        {multiplier(r.roas)}
                      </td>
                      <td className={r.profit >= 0 ? "text-emerald-600" : "text-rose-600"}>{currency(r.profit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={page} totalPages={totalPages} count={sorted.length} onPage={setPage} />
          </>
        )}
      </div>
    </>
  );
}

const GROUP_SORT_OPTIONS = [
  { key: "orderCount", label: "Orders" },
  { key: "revenue", label: "Revenue" },
  { key: "campaignName", label: "Campaign Name" },
];
const GROUP_PAGE_SIZE = 9;

function GroupsView({ groups, source, tokenId, since, until, onOpenGroup }) {
  const [search, setSearch] = useState("");
  const [sortConfig, setSortConfig] = useState({ key: "orderCount", direction: "desc" });
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter((g) => (g.campaignName || "").toLowerCase().includes(q));
  }, [groups, search]);

  const sorted = useMemo(() => {
    const list = [...filtered];
    list.sort((a, b) => {
      let x = a[sortConfig.key];
      let y = b[sortConfig.key];
      if (typeof x === "string") {
        x = x.toLowerCase();
        y = (y || "").toLowerCase();
      } else {
        x = Number(x || 0);
        y = Number(y || 0);
      }
      if (x < y) return sortConfig.direction === "asc" ? -1 : 1;
      if (x > y) return sortConfig.direction === "asc" ? 1 : -1;
      return 0;
    });
    return list;
  }, [filtered, sortConfig]);

  useEffect(() => setPage(1), [search, sortConfig]);
  const totalPages = Math.max(1, Math.ceil(sorted.length / GROUP_PAGE_SIZE));
  const paged = sorted.slice((page - 1) * GROUP_PAGE_SIZE, (page - 1) * GROUP_PAGE_SIZE + GROUP_PAGE_SIZE);

  const totals = useMemo(
    () => ({
      orders: groups.reduce((s, g) => s + g.orderCount, 0),
      revenue: groups.reduce((s, g) => s + g.revenue, 0),
      cod: groups.reduce((s, g) => s + (g.cod || 0), 0),
      codRevenue: groups.reduce((s, g) => s + (g.codRevenue || 0), 0),
      prepaid: groups.reduce((s, g) => s + (g.prepaid || 0), 0),
      prepaidRevenue: groups.reduce((s, g) => s + (g.prepaidRevenue || 0), 0),
    }),
    [groups]
  );

  const showSpendRoas = source === "matched";
  // Phase 10 — Matched & Unmatched Order Details: COD/Prepaid counts +
  // revenue now shown for matched/unmatched too, not just outsideRange.
  const showCodPrepaid = source === "outsideRange" || source === "matched" || source === "unmatched";
  const showPaymentRevenue = showCodPrepaid;
  const showDelivery = source === "cod" || source === "prepaid";

  const EMPTY_COPY = {
    matched: "No matched orders in this range.",
    unmatched: "No unmatched orders in this range — every order matched a campaign.",
    outsideRange: "No orders from campaigns outside this date range.",
    cod: "No COD orders in this range.",
    prepaid: "No prepaid orders in this range.",
  };

  const toggleDirection = () =>
    setSortConfig((p) => ({ ...p, direction: p.direction === "asc" ? "desc" : "asc" }));

  const handleExport = () => {
    const header = ["Campaign Name", "Orders", "Revenue"];
    if (showSpendRoas) header.push("Spend", "ROAS");
    if (showCodPrepaid) header.push("COD", "Prepaid");
    if (showPaymentRevenue) header.push("COD Revenue", "Prepaid Revenue");
    if (showDelivery) header.push("Delivered", "Pending");
    if (showDelivery && source === "cod") header.push("Cancelled");

    const rows = sorted.map((g) => {
      const row = [g.campaignName, g.orderCount, g.revenue];
      if (showSpendRoas) row.push(g.spend, Number(g.roas || 0).toFixed(2));
      if (showCodPrepaid) row.push(g.cod, g.prepaid);
      if (showPaymentRevenue) row.push(g.codRevenue, g.prepaidRevenue);
      if (showDelivery) row.push(g.delivered, g.pending);
      if (showDelivery && source === "cod") row.push(g.cancelled);
      return row;
    });

    downloadCsv(`${source}-campaign-groups.csv`, [header, ...rows]);
  };

  // Phase 10 — Matched & Unmatched Order Details: "24 Orders / 14 COD /
  // 10 Prepaid / ₹35,000 Revenue" at the top of the popup, before the
  // per-campaign breakdown and the full order table.
  const stripItems = [
    { label: "Total Orders", value: number(totals.orders) },
    { label: "Total Revenue", value: currency(totals.revenue) },
  ];
  if (showCodPrepaid) {
    stripItems.push({ label: "COD Orders", value: number(totals.cod) }, { label: "Prepaid Orders", value: number(totals.prepaid) });
  } else {
    stripItems.push({ label: "Campaigns", value: number(groups.length) }, { label: "Avg Order Value", value: currency(totals.orders ? totals.revenue / totals.orders : 0) });
  }
  if (showPaymentRevenue) {
    stripItems.push({ label: "COD Revenue", value: currency(totals.codRevenue) }, { label: "Prepaid Revenue", value: currency(totals.prepaidRevenue) });
  }

  return (
    <>
      <KpiStrip items={stripItems} />

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="relative max-w-md flex-1 min-w-[200px]">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            className="input pl-7 !py-1.5 !text-xs"
            placeholder="Search campaigns…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="flex items-center gap-2">
          <select
            className="input w-auto !py-1.5 !text-xs"
            value={sortConfig.key}
            onChange={(e) => setSortConfig((p) => ({ ...p, key: e.target.value }))}
          >
            {GROUP_SORT_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>
                Sort: {o.label}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn-secondary btn-sm !px-2" onClick={toggleDirection} title="Toggle sort direction">
            {sortConfig.direction === "asc" ? "↑" : "↓"}
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={handleExport} disabled={sorted.length === 0}>
            <Download size={13} /> Export CSV
          </button>
        </div>
      </div>

      {sorted.length === 0 ? (
        <EmptyBlock message={groups.length === 0 ? EMPTY_COPY[source] || "No campaigns here." : "No campaigns match your search."} />
      ) : (
        <>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {paged.map((g) => (
            // A plain div acting as the "open group" trigger, not a
            // <button> — it needs to contain a real, separately-clickable
            // CampaignLink <button> ("Open campaign"), and nesting a
            // <button> inside a <button> is invalid HTML.
            <div
              key={g.key}
              role="button"
              tabIndex={0}
              onClick={() => onOpenGroup(g)}
              onKeyDown={(e) => e.key === "Enter" && onOpenGroup(g)}
              className="text-left card !p-4 flex flex-col gap-2.5 hover:-translate-y-0.5 hover:border-slate-300 cursor-pointer"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 shrink-0">
                  <Layers size={15} />
                </span>
                {g.campaignId && (
                  <CampaignLink
                    tokenId={tokenId}
                    campaignId={g.campaignId}
                    campaignName={g.campaignName}
                    since={since}
                    until={until}
                    className="!text-[10px] !font-normal !text-slate-400 shrink-0"
                  >
                    Open campaign
                  </CampaignLink>
                )}
              </div>
              <div className="min-w-0">
                <div className="font-medium text-slate-700 text-sm truncate mb-2">{g.campaignName}</div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                  <Metric label="Orders" value={number(g.orderCount)} />
                  <Metric label="Revenue" value={currency(g.revenue)} />
                  {showSpendRoas && <Metric label="Spend" value={currency(g.spend)} />}
                  {showSpendRoas && <Metric label="ROAS" value={multiplier(g.roas)} />}
                  {showCodPrepaid && <Metric label="COD" value={number(g.cod)} />}
                  {showCodPrepaid && <Metric label="Prepaid" value={number(g.prepaid)} />}
                  {showPaymentRevenue && <Metric label="COD Revenue" value={currency(g.codRevenue)} />}
                  {showPaymentRevenue && <Metric label="Prepaid Revenue" value={currency(g.prepaidRevenue)} />}
                  {showDelivery && <Metric label="Delivered" value={number(g.delivered)} />}
                  {showDelivery && <Metric label="Pending" value={number(g.pending)} />}
                  {showDelivery && source === "cod" && <Metric label="Cancelled" value={number(g.cancelled)} />}
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="card p-0">
          <Pager page={page} totalPages={totalPages} count={sorted.length} onPage={setPage} />
        </div>
        </>
      )}
    </>
  );
}

function Metric({ label, value }) {
  return (
    <div>
      <div className="text-slate-400">{label}</div>
      <div className="font-semibold text-slate-700">{value}</div>
    </div>
  );
}

// CampaignLink normally renders the campaign name as its children; the
// "Open campaign" chip above passes its own label via children, which
// CampaignLink honors when campaignId/campaignName are both present
// (falls back to campaignName only when no children given — see
// CampaignLink.jsx). Re-declared here as a thin passthrough isn't
// necessary since CampaignLink already supports children directly.

// Phase 10 — column definitions for every dashboard KPI popup's order
// table (Total/Delivered/Pending/Cancelled/Returned "orders" mode, plus
// every campaignOrders drill-down: Matched, Unmatched, Outside Range,
// COD, Prepaid). One shared, customizable table definition instead of
// a fixed column list — satisfies both the "select and reorder columns"
// requirement and the Matched/Unmatched spec's Products/Quantity
// columns, everywhere this table is used.
function buildOrderColumns({ tokenId, since, until }) {
  return [
    { key: "orderId", label: "Order ID", defaultWidth: 110, render: (o) => o.orderId },
    { key: "customerName", label: "Customer", defaultWidth: 140, render: (o) => o.customerName || "N/A" },
    { key: "phone", label: "Phone", defaultWidth: 120, sortable: false, render: (o) => o.phone || "N/A" },
    {
      key: "campaignName",
      label: "Campaign",
      defaultWidth: 170,
      render: (o) => (
        <CampaignLink tokenId={tokenId} campaignId={o.campaignId} campaignName={o.campaignName} since={since} until={until} className="!text-xs" />
      ),
    },
    { key: "totalAmountPayable", label: "Revenue", defaultWidth: 100, render: (o) => currency(o.totalAmountPayable) },
    {
      key: "paymentType",
      label: "Payment Type",
      defaultWidth: 120,
      sortable: false,
      render: (o) => <span className={`badge ${o.paymentType === "PREPAID" ? "badge-blue" : "badge-amber"}`}>{o.paymentType || "N/A"}</span>,
    },
    { key: "product", label: "Products", defaultWidth: 160, sortable: false, render: (o) => o.product || "N/A" },
    { key: "productQuantity", label: "Quantity", defaultWidth: 90, sortable: false, render: (o) => o.productQuantity ?? "N/A" },
    { key: "status", label: "Status", defaultWidth: 120, sortable: false, render: (o) => o.deliveryStatus || o.orderStatus || "N/A" },
    { key: "courier", label: "Courier", defaultWidth: 120, sortable: false, render: (o) => o.courier || "N/A" },
    { key: "orderDate", label: "Date", defaultWidth: 120, render: (o) => formatDate(o.orderDate) },
  ];
}
const ORDER_TABLE_DEFAULT_HIDDEN = ["phone", "courier"];

function OrdersTable({ orders, tokenId, since, until, onOrderClick, exportFilename, emptyMessage }) {
  const [search, setSearch] = useState("");
  const [sortConfig, setSortConfig] = useState({ key: "orderCreatedAt", direction: "desc" });
  const [page, setPage] = useState(1);

  const allColumns = useMemo(() => buildOrderColumns({ tokenId, since, until }), [tokenId, since, until]);
  const { orderedColumns, allColumnsOrdered, hidden, toggleHidden, reorder, reset } = useColumnPrefs(
    "kpiPopupOrders",
    allColumns,
    ORDER_TABLE_DEFAULT_HIDDEN
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter((o) =>
      [o.orderId, o.customerName, o.phone, o.campaignName].filter(Boolean).join(" ").toLowerCase().includes(q)
    );
  }, [orders, search]);

  const sorted = useMemo(() => {
    const list = [...filtered];
    list.sort((a, b) => {
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
    return list;
  }, [filtered, sortConfig]);

  useEffect(() => setPage(1), [search, sortConfig]);
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const paged = sorted.slice((page - 1) * PAGE_SIZE, (page - 1) * PAGE_SIZE + PAGE_SIZE);
  const handleSort = (key) => setSortConfig((p) => ({ key, direction: p.key === key && p.direction === "asc" ? "desc" : "asc" }));
  const arrow = (key) => (sortConfig.key !== key ? "" : sortConfig.direction === "asc" ? " ↑" : " ↓");

  const handleExport = () => {
    const rows = [orderedColumns.map((c) => c.label), ...sorted.map((o) => orderedColumns.map((c) => rawOrderValue(o, c.key)))];
    downloadCsv(exportFilename, rows);
  };

  return (
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
        <div className="flex items-center gap-2">
          <ColumnSettingsMenu columns={allColumnsOrdered} hidden={hidden} toggleHidden={toggleHidden} reorder={reorder} reset={reset} />
          <button type="button" className="btn btn-secondary btn-sm" onClick={handleExport} disabled={sorted.length === 0}>
            <Download size={13} /> Export CSV
          </button>
        </div>
      </div>

      {sorted.length === 0 ? (
        <EmptyBlock message={emptyMessage || (orders.length === 0 ? "No orders here." : "No orders match your search.")} />
      ) : (
        <>
          <div className="overflow-auto max-h-[440px]">
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
                  <tr key={o.orderId} className="cursor-pointer" onClick={() => onOrderClick(o)}>
                    {orderedColumns.map((c) => (
                      <td
                        key={c.key}
                        className={c.key === "orderId" ? "font-medium text-slate-700" : c.key === "product" ? "max-w-[180px] truncate" : ""}
                        title={c.key === "product" ? o.product || "N/A" : undefined}
                        onClick={c.key === "campaignName" ? (e) => e.stopPropagation() : undefined}
                      >
                        {c.render(o)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={page} totalPages={totalPages} count={sorted.length} onPage={setPage} />
        </>
      )}
    </div>
  );
}

// Raw values (not JSX) for CSV export — matches each column's field,
// falling back to the visible label text isn't useful for a CSV so we
// go straight to the underlying order field.
function rawOrderValue(o, key) {
  if (key === "status") return o.deliveryStatus || o.orderStatus || "N/A";
  if (key === "orderDate") return o.orderDate;
  return o[key] ?? "N/A";
}

function Pager({ page, totalPages, count, onPage }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 text-xs text-slate-500">
      <span>
        Page {page} of {totalPages} · {count} result{count === 1 ? "" : "s"}
      </span>
      <div className="flex items-center gap-1.5">
        <button type="button" className="btn btn-secondary btn-sm !px-2" disabled={page <= 1} onClick={() => onPage((p) => Math.max(1, p - 1))}>
          <ChevronLeft size={13} />
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm !px-2"
          disabled={page >= totalPages}
          onClick={() => onPage((p) => Math.min(totalPages, p + 1))}
        >
          <ChevronRight size={13} />
        </button>
      </div>
    </div>
  );
}

function EmptyBlock({ message }) {
  return (
    <div className="flex flex-col items-center justify-center py-14 text-center px-6">
      <span className="flex items-center justify-center w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 mb-3">
        <Inbox size={22} />
      </span>
      <div className="text-sm text-slate-500 max-w-sm">{message}</div>
    </div>
  );
}

function PopupSkeleton() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card !p-3.5">
            <div className="h-3 w-16 bg-slate-100 rounded animate-pulse mb-2" />
            <div className="h-5 w-12 bg-slate-100 rounded animate-pulse" />
          </div>
        ))}
      </div>
      <div className="card h-80 animate-pulse bg-slate-100" />
    </div>
  );
}

function PopupError({ message, onRetry }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <span className="flex items-center justify-center w-14 h-14 rounded-2xl bg-rose-100 text-rose-600 mb-4">
        <AlertTriangle size={26} />
      </span>
      <h3 className="font-display font-semibold text-slate-700 mb-1">Couldn't load this data</h3>
      <p className="text-sm text-slate-400 max-w-sm mb-5">{message}</p>
      <button type="button" className="btn btn-primary btn-sm" onClick={onRetry}>
        <RefreshCw size={14} /> Try again
      </button>
    </div>
  );
}
