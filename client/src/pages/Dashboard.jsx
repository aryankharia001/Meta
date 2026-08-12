import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LayoutDashboard,
  RefreshCw,
  Search,
  X,
  ChevronDown,
  Building2,
  Package,
  CheckCircle2,
  XCircle,
  CalendarX,
  Wallet,
  CreditCard,
  Gauge,
  PiggyBank,
  Receipt,
  Truck,
  PackageCheck,
  Clock,
  Ban,
  RotateCcw,
  Megaphone,
  Inbox,
  AlertTriangle,
  SlidersHorizontal,
  Pin,
} from "lucide-react";
import { fetchLiveAdAccounts, fetchLiveCampaigns } from "../lib/api";
import { useSelectedToken } from "../lib/useSelectedToken";
import CampaignLink from "../components/CampaignLink";
import { CampaignNameCell, RoasValue, BudgetCell } from "../components/CampaignCells";
import KpiAnalyticsPopup from "../components/KpiAnalyticsPopup";
import { useOrderDrawer } from "../lib/OrderDrawerContext";
import { useLiveSync, rangeIncludesToday } from "../lib/LiveSyncContext";
import { DataFreshnessBadge, SyncStatusIndicator } from "../components/LiveSyncWidgets";
import RecentlyViewedWidget from "../components/RecentlyViewedWidget";
import SavedViewsControl from "../components/SavedViewsControl";
import DashboardCustomizePanel from "../components/DashboardCustomizePanel";
import { useDashboardLayout } from "../lib/dashboardLayout";
import { useColumnPrefs } from "../lib/useColumnPrefs";
import ColumnSettingsMenu from "../components/ColumnSettingsMenu";
import {
  DASHBOARD_CAMPAIGN_COLUMNS,
  DASHBOARD_CAMPAIGN_DEFAULT_HIDDEN,
  DASHBOARD_UNMATCHED_COLUMNS,
  DASHBOARD_UNMATCHED_DEFAULT_HIDDEN,
} from "../lib/dashboardColumns";

// ────────────────────────────────────────────────────────────────
// Dashboard — the CRM-style homepage.
//
// Phase 1: UI/UX only, built on the existing, already-working
// GET /campaigns/:tokenId/compare endpoint (same one CampaignComparison.jsx
// and LiveCampaignsPage.jsx use) plus GET /status for the "last sync"
// indicator. No changes to how campaigns/orders are fetched or matched.
//
// Phase 3: every KPI card now opens a full analytics popup
// (KpiAnalyticsPopup) instead of the old static placeholder. Five cards
// (Delivered / Pending / Cancelled / Returned Orders, Orders Outside
// Selected Campaign Date Range) still show "—" on the grid itself — that
// number would require the same lazy /orders-detailed fetch the popup
// triggers on open, and computing it eagerly for every card on every page
// load would defeat the point of loading popup data on demand. Once
// opened, the popup is fully real: live counts, tables, search, sort,
// pagination, export — see KpiAnalyticsPopup.jsx and campaigns.js's new
// /orders-detailed route for how "outside range" is told apart from
// genuinely unmatched.
//
// Phase 5: the old static "last sync" checklist badge is replaced by
// two live widgets driven by LiveSyncContext — DataFreshnessBadge and
// SyncStatusIndicator (see components/LiveSyncWidgets.jsx) — plus the
// Refresh button now also triggers an actual incremental Shiprocket
// sync (not just a re-read of already-fetched data). A background
// useEffect watches liveSync.syncVersion and silently re-runs the
// existing load() whenever new orders land AND the selected date range
// includes today — same fetchLiveCampaigns() call Phase 1 already used,
// so it only ever touches the `data`/`lastFetchedAt` state, leaving
// search, sort, expanded rows, and the open KPI popup completely
// undisturbed.
// ────────────────────────────────────────────────────────────────

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const todayIso = () => new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
const shiftDays = (dateStr, days) => {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const monthStart = (dateStr) => `${dateStr.slice(0, 7)}-01`;
const addMonths = (dateStr, n) => {
  const [y, m] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 10);
};
const monthEnd = (dateStr) => shiftDays(addMonths(monthStart(dateStr), 1), -1);

const PRESETS = [
  { key: "today", label: "Today", range: () => ({ since: todayIso(), until: todayIso() }) },
  {
    key: "yesterday",
    label: "Yesterday",
    range: () => {
      const y = shiftDays(todayIso(), -1);
      return { since: y, until: y };
    },
  },
  { key: "7d", label: "Last 7 Days", range: () => ({ since: shiftDays(todayIso(), -6), until: todayIso() }) },
  { key: "30d", label: "Last 30 Days", range: () => ({ since: shiftDays(todayIso(), -29), until: todayIso() }) },
  { key: "thisMonth", label: "This Month", range: () => ({ since: monthStart(todayIso()), until: todayIso() }) },
  {
    key: "lastMonth",
    label: "Last Month",
    range: () => {
      const start = addMonths(monthStart(todayIso()), -1);
      return { since: start, until: monthEnd(start) };
    },
  },
  { key: "custom", label: "Custom Range", range: null },
];

const currency = (n) =>
  `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const number = (n) => Number(n || 0).toLocaleString("en-IN");

const ACCENTS = {
  indigo: "bg-indigo-50 text-indigo-600",
  violet: "bg-violet-50 text-violet-600",
  emerald: "bg-emerald-50 text-emerald-600",
  amber: "bg-amber-50 text-amber-600",
  rose: "bg-rose-50 text-rose-600",
  sky: "bg-sky-50 text-sky-600",
  slate: "bg-slate-100 text-slate-500",
};

const CARD_DEFS = [
  { key: "totalOrders", label: "Total Orders", icon: Package, accent: "indigo", format: number },
  { key: "matchedOrders", label: "Matched Orders", icon: CheckCircle2, accent: "emerald", format: number },
  { key: "unmatchedOrders", label: "Unmatched Orders", icon: XCircle, accent: "rose", format: number },
  { key: "outsideRange", label: "Outside Campaign Date Range", icon: CalendarX, accent: "slate", lazy: true },
  { key: "revenue", label: "Revenue", icon: Wallet, accent: "emerald", format: currency },
  { key: "spend", label: "Spend", icon: CreditCard, accent: "amber", format: currency },
  { key: "roas", label: "ROAS", icon: Gauge, accent: "violet", format: (v) => `${Number(v || 0).toFixed(2)}x` },
  { key: "profit", label: "Profit", icon: PiggyBank, accent: "emerald", format: currency },
  { key: "aov", label: "Avg Order Value", icon: Receipt, accent: "sky", format: currency },
  { key: "prepaid", label: "Prepaid Orders", icon: CreditCard, accent: "indigo", format: number },
  { key: "cod", label: "COD Orders", icon: Truck, accent: "amber", format: number },
  { key: "delivered", label: "Delivered Orders", icon: PackageCheck, accent: "emerald", lazy: true },
  { key: "pending", label: "Pending Orders", icon: Clock, accent: "amber", lazy: true },
  { key: "cancelled", label: "Cancelled Orders", icon: Ban, accent: "rose", lazy: true },
  { key: "returned", label: "Returned Orders", icon: RotateCcw, accent: "slate", lazy: true },
  { key: "activeCampaigns", label: "Active Campaigns", icon: Megaphone, accent: "violet", format: number },
];

// Defensive on purpose: /compare's order objects today only carry
// orderId/campaignName (see the .select() in campaigns.js) — no phone or
// customer name. Checking the extra keys anyway means the search bar
// starts matching Customer Name / Phone Number for free the moment a
// later phase adds those fields to the API response, with zero changes
// here.
function matchesSearch(order, q) {
  if (!q) return true;
  const haystack = [
    order.orderId,
    order.campaignId,
    order.campaignName,
    order.phone,
    order.customerName,
    order.customer?.name,
    order.address?.firstName,
    order.address?.lastName,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}

export default function Dashboard() {
  const { tokenId: TOKEN_ID, setTokenId, tokens } = useSelectedToken();
  const { openOrder } = useOrderDrawer();

  const [adAccounts, setAdAccounts] = useState([]);
  const [selectedAccounts, setSelectedAccounts] = useState([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);

  const [presetKey, setPresetKey] = useState("today");
  const [customSince, setCustomSince] = useState(shiftDays(todayIso(), -6));
  const [customUntil, setCustomUntil] = useState(todayIso());

  const { since, until } = useMemo(() => {
    if (presetKey === "custom") return { since: customSince, until: customUntil };
    return PRESETS.find((p) => p.key === presetKey).range();
  }, [presetKey, customSince, customUntil]);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastFetchedAt, setLastFetchedAt] = useState(null);

  const liveSync = useLiveSync();

  const [searchQuery, setSearchQuery] = useState("");
  const [activePopupCard, setActivePopupCard] = useState(null);

  const [expandedCampaign, setExpandedCampaign] = useState(null);
  const [sortConfig, setSortConfig] = useState({ key: "spend", direction: "desc" });

  // Phase 7 — Saved Views snapshot/restore. Deliberately a plain object
  // of already-existing state, not a new source of truth — restoring a
  // view just calls the same setters the filter bar's own controls use.
  const getDashboardFilters = () => ({
    tokenId: TOKEN_ID,
    selectedAccounts,
    presetKey,
    customSince,
    customUntil,
    searchQuery,
  });
  const applyDashboardFilters = (f) => {
    if (!f) return;
    if (f.tokenId) setTokenId(f.tokenId);
    if (Array.isArray(f.selectedAccounts)) setSelectedAccounts(f.selectedAccounts);
    if (f.presetKey) setPresetKey(f.presetKey);
    if (f.customSince) setCustomSince(f.customSince);
    if (f.customUntil) setCustomUntil(f.customUntil);
    if (f.searchQuery !== undefined) setSearchQuery(f.searchQuery);
  };

  // ── Ad accounts ──────────────────────────────────────────────
  useEffect(() => {
    if (!TOKEN_ID) return;
    let cancelled = false;
    (async () => {
      setLoadingAccounts(true);
      try {
        const res = await fetchLiveAdAccounts(TOKEN_ID);
        const list = res.success ? res.adAccounts || [] : [];
        if (cancelled) return;
        setAdAccounts(list);
        setSelectedAccounts(list.map((a) => a.id));
      } catch {
        if (!cancelled) setAdAccounts([]);
      } finally {
        if (!cancelled) setLoadingAccounts(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [TOKEN_ID]);

  // ── Campaign + order comparison data ────────────────────────
  const load = useCallback(async () => {
    if (!TOKEN_ID || selectedAccounts.length === 0) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetchLiveCampaigns(TOKEN_ID, { accountIds: selectedAccounts, since, until });
      setData(res);
      setLastFetchedAt(new Date());
    } catch (err) {
      setError(err.message || "Failed to load dashboard data");
    } finally {
      setLoading(false);
    }
  }, [TOKEN_ID, selectedAccounts, since, until]);

  useEffect(() => {
    load();
  }, [load]);

  // ── Phase 5: silent smart-refresh — when the background 10s live-sync
  // poll finds new orders (liveSync.syncVersion only bumps when it does,
  // see LiveSyncContext), re-run the existing load() IF the currently
  // selected date range includes today (new orders are always dated
  // today — see liveSync.js). Skipped entirely for a past range like
  // "Yesterday" so today's new orders never leak into that view. The
  // ref guards against firing on initial mount (load() already covers
  // that via the effect above).
  const prevSyncVersionRef = useRef(liveSync.syncVersion);
  useEffect(() => {
    if (liveSync.syncVersion === prevSyncVersionRef.current) return;
    prevSyncVersionRef.current = liveSync.syncVersion;
    if (rangeIncludesToday(since, until, todayIso())) {
      load();
    }
  }, [liveSync.syncVersion, since, until, load]);

  const handleRefresh = async () => {
    await liveSync.manualRefresh(); // incremental Shiprocket sync (new orders only), guarded against overlap
    load(); // re-read whatever's now in Mongo via the existing, untouched /compare endpoint
  };

  // ── Derived data ─────────────────────────────────────────────
  const allOrders = useMemo(() => {
    if (!data) return [];
    const fromCampaigns = data.campaigns.flatMap((c) => c.orderList || []);
    return [...fromCampaigns, ...(data.unmatchedOrders || [])];
  }, [data]);

  const cardValues = useMemo(() => {
    if (!data) return {};
    const totalOrders = data.summary.totalOrders || 0;
    const unmatchedCount = data.unmatchedOrders?.length || 0;
    const matchedOrders = Math.max(totalOrders - unmatchedCount, 0);
    const revenue = data.summary.totalRevenue || 0;
    const spend = data.summary.totalSpend || 0;
    const roas = data.summary.averageROAS || 0;
    const prepaid = allOrders.filter((o) => o.paymentType === "PREPAID").length;
    const cod = allOrders.filter((o) => o.paymentType === "CASH_ON_DELIVERY").length;

    return {
      totalOrders,
      matchedOrders,
      unmatchedOrders: unmatchedCount,
      revenue,
      spend,
      roas,
      profit: revenue - spend,
      aov: totalOrders ? revenue / totalOrders : 0,
      prepaid,
      cod,
      activeCampaigns: data.summary.totalCampaigns || 0,
    };
  }, [data, allOrders]);

  const cardList = useMemo(
    () =>
      CARD_DEFS.map((def) => ({
        ...def,
        display: def.lazy ? "—" : data ? def.format(cardValues[def.key]) : null,
      })),
    [cardValues, data]
  );

  // Phase 7 — Dashboard Customization: a pure display-order/visibility
  // layer over the already-computed cardList above. arrange() never
  // touches def.display/def.format, only which cards show and in what
  // order — see lib/dashboardLayout.js.
  const dashboardLayout = useDashboardLayout(CARD_DEFS.map((d) => d.key));
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const visibleCardList = useMemo(() => dashboardLayout.arrange(cardList), [cardList, dashboardLayout]);

  const q = searchQuery.trim().toLowerCase();

  const campaigns = useMemo(() => {
    if (!data) return [];
    let list = [...data.campaigns];
    if (q) {
      list = list.filter(
        (c) => (c.campaignName || "").toLowerCase().includes(q) || (c.orderList || []).some((o) => matchesSearch(o, q))
      );
    }
    list.sort((a, b) => {
      let x = a[sortConfig.key];
      let y = b[sortConfig.key];
      if (typeof x === "string") {
        x = x.toLowerCase();
        y = y.toLowerCase();
      } else {
        x = Number(x || 0);
        y = Number(y || 0);
      }
      if (x < y) return sortConfig.direction === "asc" ? -1 : 1;
      if (x > y) return sortConfig.direction === "asc" ? 1 : -1;
      return 0;
    });
    return list;
  }, [data, q, sortConfig]);

  const unmatchedOrders = useMemo(() => {
    if (!data) return [];
    const list = data.unmatchedOrders || [];
    if (!q) return list;
    return list.filter((o) => matchesSearch(o, q) || (o.campaignName || "").toLowerCase().includes(q));
  }, [data, q]);

  const handleSort = (key) => {
    setSortConfig((prev) => ({ key, direction: prev.key === key && prev.direction === "asc" ? "desc" : "asc" }));
  };
  const arrow = (key) => (sortConfig.key !== key ? "" : sortConfig.direction === "asc" ? " ↑" : " ↓");
  const toggleCampaign = (id) => setExpandedCampaign((prev) => (prev === id ? null : id));

  // Phase 10 — column customization for the two hand-rolled tables
  // below (Campaigns, Unmatched Orders). Purely a display layer over
  // the already-computed `campaigns`/`unmatchedOrders` arrays above —
  // doesn't touch load(), sortConfig, or expandedCampaign.
  const campaignCols = useColumnPrefs("dashboardCampaigns", DASHBOARD_CAMPAIGN_COLUMNS, DASHBOARD_CAMPAIGN_DEFAULT_HIDDEN);
  const unmatchedCols = useColumnPrefs("dashboardUnmatchedOrders", DASHBOARD_UNMATCHED_COLUMNS, DASHBOARD_UNMATCHED_DEFAULT_HIDDEN);

  const toggleAccount = (id) =>
    setSelectedAccounts((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const selectAllAccounts = () => setSelectedAccounts(adAccounts.map((a) => a.id));
  const clearAccounts = () => setSelectedAccounts([]);

  const handlePresetClick = (key) => {
    if (key === "custom") {
      setCustomSince(since);
      setCustomUntil(until);
    }
    setPresetKey(key);
  };

  const isEmpty = data && campaigns.length === 0 && unmatchedOrders.length === 0;
  const hasSearchButNoMatches = q && data && campaigns.length === 0 && unmatchedOrders.length === 0;

  return (
    <div className="min-h-screen pb-16">
      {/* ── Sticky filter bar ───────────────────────────────── */}
      <div className="sticky top-0 z-20 bg-white/85 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-[1600px] mx-auto px-6 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3.5">
            <div className="flex items-center gap-2.5">
              <span className="flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-md shadow-indigo-500/30">
                <LayoutDashboard size={18} />
              </span>
              <div>
                <h1 className="text-lg font-display font-bold text-slate-800 leading-tight">Dashboard</h1>
                <p className="text-xs text-slate-400">Meta campaigns × Shiprocket orders, unified</p>
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              <DataFreshnessBadge />
              <SyncStatusIndicator />
              <SavedViewsControl page="dashboard" getFilters={getDashboardFilters} applyFilters={applyDashboardFilters} />
              <button
                className="btn btn-secondary btn-sm"
                onClick={handleRefresh}
                disabled={loading || liveSync.isSyncing}
                title={liveSync.isSyncing ? "Sync already in progress." : "Refresh Now"}
              >
                <RefreshCw size={14} className={loading || liveSync.isSyncing ? "animate-spin" : ""} />
                {loading || liveSync.isSyncing ? "Refreshing…" : "Refresh Now"}
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 mb-3.5">
            <div className="relative flex-1 min-w-[260px] max-w-md">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                className="input pl-9 pr-8"
                placeholder="Search campaign, order ID, customer or phone…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button
                  type="button"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  onClick={() => setSearchQuery("")}
                >
                  <X size={14} />
                </button>
              )}
            </div>

            <select className="input w-auto" value={TOKEN_ID || ""} onChange={(e) => setTokenId(e.target.value)}>
              {tokens.length === 0 && <option value={TOKEN_ID}>{TOKEN_ID}</option>}
              {tokens.map((t) => (
                <option key={t._id} value={t._id}>
                  {t.label || t._id}
                </option>
              ))}
            </select>

            <AccountsPicker
              accounts={adAccounts}
              selected={selectedAccounts}
              loading={loadingAccounts}
              onToggle={toggleAccount}
              onSelectAll={selectAllAccounts}
              onClear={clearAccounts}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex gap-1 bg-slate-100 rounded-lg p-1 flex-wrap">
              {PRESETS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => handlePresetClick(p.key)}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    presetKey === p.key ? "bg-white text-blue-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {presetKey === "custom" && (
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  className="input w-auto"
                  value={customSince}
                  max={customUntil}
                  onChange={(e) => setCustomSince(e.target.value)}
                />
                <span className="text-slate-400 text-sm">to</span>
                <input
                  type="date"
                  className="input w-auto"
                  value={customUntil}
                  min={customSince}
                  max={todayIso()}
                  onChange={(e) => setCustomUntil(e.target.value)}
                />
              </div>
            )}

            <div className="ml-auto text-xs text-slate-400">
              {lastFetchedAt ? (
                <>
                  Updated {lastFetchedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} ·{" "}
                </>
              ) : null}
              {since === until ? since : `${since} → ${until}`}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-[1600px] mx-auto px-6 pt-6">
        <RecentlyViewedWidget />

        {error && <ErrorState message={error} onRetry={load} />}

        {!error && loading && !data && <SkeletonGrid />}

        {!error && (data || (!loading && !data)) && (
          <>
            <div className="relative flex justify-end mb-3">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setCustomizeOpen((o) => !o)}>
                <SlidersHorizontal size={13} /> Customize
              </button>
              {customizeOpen && (
                <DashboardCustomizePanel
                  items={dashboardLayout.arrangeAll(cardList)}
                  layout={dashboardLayout.layout}
                  toggleHidden={dashboardLayout.toggleHidden}
                  togglePinned={dashboardLayout.togglePinned}
                  toggleWide={dashboardLayout.toggleWide}
                  reorder={dashboardLayout.reorder}
                  reset={dashboardLayout.reset}
                  onClose={() => setCustomizeOpen(false)}
                />
              )}
            </div>
            <div
              className={`grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 mb-8 transition-opacity ${
                loading && data ? "opacity-60 pointer-events-none" : ""
              }`}
            >
              {visibleCardList.map(({ key: cardKey, ...c }) => (
                <KpiCard
                  key={cardKey}
                  {...c}
                  pinned={dashboardLayout.layout.pinned.includes(cardKey)}
                  wide={(dashboardLayout.layout.wide || []).includes(cardKey)}
                  onClick={() => data && setActivePopupCard({ key: cardKey, ...c })}
                />
              ))}
              {visibleCardList.length === 0 && (
                <div className="col-span-full text-center py-8 text-sm text-slate-400 border border-dashed border-slate-200 rounded-xl">
                  All KPI cards are hidden. Click Customize to bring some back.
                </div>
              )}
            </div>
          </>
        )}

        {!error && !loading && !data && (
          <div className="text-sm text-slate-400 mb-8">
            {selectedAccounts.length === 0
              ? "Select at least one ad account above to load the dashboard."
              : "Loading…"}
          </div>
        )}

        {!error && data && isEmpty && !hasSearchButNoMatches && <EmptyState />}
        {!error && data && hasSearchButNoMatches && <NoSearchResults query={searchQuery} onClear={() => setSearchQuery("")} />}

        {!error && data && !isEmpty && (
          <div className={`space-y-8 transition-opacity ${loading ? "opacity-60 pointer-events-none" : ""}`}>
            <section className="card p-0 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 gap-3 flex-wrap">
                <h2 className="font-display font-semibold text-slate-800 text-sm">
                  Campaigns <span className="text-slate-400 font-normal">({campaigns.length})</span>
                </h2>
                <ColumnSettingsMenu
                  columns={campaignCols.allColumnsOrdered}
                  hidden={campaignCols.hidden}
                  toggleHidden={campaignCols.toggleHidden}
                  reorder={campaignCols.reorder}
                  reset={campaignCols.reset}
                />
              </div>

              {campaigns.length === 0 ? (
                <div className="text-center py-10 text-sm text-slate-400">No campaigns match your search.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="table">
                    <thead>
                      <tr>
                        {campaignCols.orderedColumns.map((c) => (
                          <th
                            key={c.key}
                            className={`${c.sortable !== false ? "cursor-pointer select-none" : ""} ${c.align === "right" ? "num" : c.align === "center" ? "center" : ""}`}
                            onClick={() => c.sortable !== false && handleSort(c.key)}
                          >
                            {c.label}
                            {c.sortable !== false ? arrow(c.key) : ""}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {campaigns.map((campaign) => (
                        <Fragment key={campaign.campaignId}>
                          <tr
                            onClick={() => toggleCampaign(campaign.campaignId)}
                            className={`row-clickable ${expandedCampaign === campaign.campaignId ? "row-selected" : ""}`}
                          >
                            {campaignCols.orderedColumns.map((c) => {
                              if (c.key === "campaignName") {
                                return (
                                  <td key={c.key} onClick={(e) => e.stopPropagation()}>
                                    <CampaignNameCell
                                      tokenId={TOKEN_ID}
                                      campaignId={campaign.campaignId}
                                      campaignName={campaign.campaignName}
                                      accountId={campaign.accountId}
                                      accountName={adAccounts.find((a) => a.id === campaign.accountId)?.name}
                                      since={since}
                                      until={until}
                                      status={campaign.effectiveStatus || campaign.status}
                                      showId={false}
                                    />
                                  </td>
                                );
                              }
                              if (c.key === "budget") {
                                return (
                                  <td key={c.key} className="num">
                                    <BudgetCell budget={campaign.budget} budgetType={campaign.budgetType} />
                                  </td>
                                );
                              }
                              if (c.key === "roas") {
                                return (
                                  <td key={c.key} className="num">
                                    <RoasValue roas={campaign.roas} />
                                  </td>
                                );
                              }
                              if (c.key === "accountId") {
                                return (
                                  <td key={c.key} className="text-slate-400">
                                    {campaign.accountId}
                                  </td>
                                );
                              }
                              return (
                                <td key={c.key} className={c.align === "right" ? "num" : c.align === "center" ? "center" : ""}>
                                  {c.render(campaign)}
                                </td>
                              );
                            })}
                          </tr>

                          {expandedCampaign === campaign.campaignId && (
                            <tr>
                              <td colSpan={campaignCols.orderedColumns.length} className="bg-slate-50 p-5">
                                <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-3">
                                  Orders ({campaign.orderList.length})
                                </h3>
                                <div className="card p-0 overflow-x-auto">
                                  <table className="table">
                                    <thead>
                                      <tr>
                                        <th>Order ID</th>
                                        <th className="num">Amount</th>
                                        <th className="center">Payment</th>
                                        <th className="center">Status</th>
                                        <th>Order Date</th>
                                        <th>Created At</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {campaign.orderList.length === 0 && (
                                        <tr>
                                          <td colSpan={6} className="text-center py-5 text-slate-500">
                                            No Orders
                                          </td>
                                        </tr>
                                      )}
                                      {campaign.orderList.map((order) => (
                                        <tr
                                          key={order.orderId}
                                          className="row-clickable"
                                          onClick={() => openOrder({ orderId: order.orderId, tokenId: TOKEN_ID })}
                                        >
                                          <td className="metric-primary">{order.orderId}</td>
                                          <td className="num metric-primary">{currency(order.totalAmountPayable)}</td>
                                          <td className="center">
                                            <span
                                              className={`badge ${order.paymentType === "PREPAID" ? "badge-blue" : "badge-amber"}`}
                                            >
                                              {order.paymentType}
                                            </span>
                                          </td>
                                          <td className="center">{order.paymentStatus}</td>
                                          <td>{order.orderDate}</td>
                                          <td>{new Date(order.orderCreatedAt).toLocaleString()}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="card p-0 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 gap-3 flex-wrap">
                <h2 className="font-display font-semibold text-slate-800 text-sm">
                  Unmatched Orders <span className="text-slate-400 font-normal">({unmatchedOrders.length})</span>
                </h2>
                <ColumnSettingsMenu
                  columns={unmatchedCols.allColumnsOrdered}
                  hidden={unmatchedCols.hidden}
                  toggleHidden={unmatchedCols.toggleHidden}
                  reorder={unmatchedCols.reorder}
                  reset={unmatchedCols.reset}
                />
              </div>

              {unmatchedOrders.length === 0 ? (
                <div className="text-center py-10 text-sm text-slate-500">🎉 All orders matched with Facebook campaigns.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="table">
                    <thead>
                      <tr>
                        {unmatchedCols.orderedColumns.map((c) => (
                          <th key={c.key} className={c.align === "right" ? "num" : c.align === "center" ? "center" : ""}>
                            {c.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {unmatchedOrders.map((order) => (
                        <tr
                          key={order.orderId}
                          className="row-clickable"
                          onClick={() => openOrder({ orderId: order.orderId, tokenId: TOKEN_ID })}
                        >
                          {unmatchedCols.orderedColumns.map((c) => {
                            if (c.key === "campaignName") {
                              return (
                                <td key={c.key} onClick={(e) => e.stopPropagation()}>
                                  <CampaignLink
                                    tokenId={TOKEN_ID}
                                    campaignId={order.campaignId}
                                    campaignName={order.campaignName}
                                    since={since}
                                    until={until}
                                    className="campaign-name !text-slate-800"
                                  />
                                </td>
                              );
                            }
                            if (c.key === "campaignId") {
                              return (
                                <td key={c.key} className="metric-secondary">
                                  {order.campaignId || "-"}
                                </td>
                              );
                            }
                            if (c.key === "paymentType") {
                              return (
                                <td key={c.key} className="center">
                                  <span className={`badge ${order.paymentType === "PREPAID" ? "badge-blue" : "badge-amber"}`}>
                                    {order.paymentType}
                                  </span>
                                </td>
                              );
                            }
                            return (
                              <td key={c.key} className={c.align === "right" ? "num" : c.align === "center" ? "center" : ""}>
                                {c.render(order)}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        )}
      </div>

      <KpiAnalyticsPopup
        card={activePopupCard}
        onClose={() => setActivePopupCard(null)}
        dashboardData={data}
        tokenId={TOKEN_ID}
        accountIds={selectedAccounts}
        since={since}
        until={until}
      />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Subcomponents
// ────────────────────────────────────────────────────────────────

function KpiCard({ label, icon: Icon, accent, display, pinned, wide, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative text-left card !p-4 flex flex-col gap-3 hover:-translate-y-0.5 hover:border-slate-300 ${
        pinned ? "!border-amber-300" : ""
      } ${wide ? "col-span-2" : ""}`}
      title="View detailed analytics"
    >
      {pinned && <Pin size={11} className="absolute top-3 right-3 text-amber-400" fill="currentColor" />}
      <div className="flex items-center justify-between">
        <span className={`flex items-center justify-center w-9 h-9 rounded-xl ${ACCENTS[accent]}`}>
          <Icon size={17} />
        </span>
      </div>
      <div className="min-w-0">
        <div className="text-[13px] text-slate-500 mb-0.5 leading-tight truncate">{label}</div>
        <div className="text-xl font-display font-bold text-slate-800 truncate">{display ?? "—"}</div>
      </div>
    </button>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 mb-8">
      {CARD_DEFS.map((c) => (
        <div key={c.key} className="card !p-4 flex flex-col gap-3">
          <div className="w-9 h-9 rounded-xl bg-slate-100 animate-pulse" />
          <div className="space-y-2">
            <div className="h-3 w-20 bg-slate-100 rounded animate-pulse" />
            <div className="h-5 w-16 bg-slate-100 rounded animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="card flex flex-col items-center justify-center text-center py-16 px-6 mb-8">
      <span className="flex items-center justify-center w-14 h-14 rounded-2xl bg-slate-100 text-slate-400 mb-4">
        <Inbox size={26} />
      </span>
      <h3 className="font-display font-semibold text-slate-700 mb-1">No activity in this range</h3>
      <p className="text-sm text-slate-400 max-w-sm">
        No campaigns or orders were found for the selected accounts and date range. Try a different quick filter or widen the
        custom range.
      </p>
    </div>
  );
}

function NoSearchResults({ query, onClear }) {
  return (
    <div className="card flex flex-col items-center justify-center text-center py-16 px-6 mb-8">
      <span className="flex items-center justify-center w-14 h-14 rounded-2xl bg-slate-100 text-slate-400 mb-4">
        <Search size={24} />
      </span>
      <h3 className="font-display font-semibold text-slate-700 mb-1">No results for "{query}"</h3>
      <p className="text-sm text-slate-400 max-w-sm mb-4">
        Nothing in this date range matches that campaign name, order ID, customer, or phone number.
      </p>
      <button className="btn btn-secondary btn-sm" onClick={onClear}>
        Clear search
      </button>
    </div>
  );
}

function ErrorState({ message, onRetry }) {
  return (
    <div className="card border-rose-200 bg-rose-50/60 flex flex-col items-center text-center py-12 px-6 mb-8">
      <span className="flex items-center justify-center w-12 h-12 rounded-2xl bg-rose-100 text-rose-600 mb-3">
        <AlertTriangle size={22} />
      </span>
      <h3 className="font-display font-semibold text-rose-700 mb-1">Couldn't load dashboard data</h3>
      <p className="text-sm text-rose-500 mb-4 max-w-md">{message}</p>
      <button className="btn btn-primary btn-sm" onClick={onRetry}>
        <RefreshCw size={14} /> Try again
      </button>
    </div>
  );
}

function AccountsPicker({ accounts, selected, loading, onToggle, onSelectAll, onClear }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen((o) => !o)}>
        <Building2 size={14} />
        {loading ? "Loading…" : `Accounts (${selected.length}/${accounts.length})`}
        <ChevronDown size={14} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute z-30 mt-2 w-72 max-h-80 overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-xl p-2">
          <div className="flex gap-3 px-1 pb-2 mb-1 border-b border-slate-100">
            <button type="button" className="text-xs font-medium text-blue-600 hover:underline" onClick={onSelectAll}>
              Select all
            </button>
            <button type="button" className="text-xs font-medium text-slate-400 hover:underline" onClick={onClear}>
              Clear
            </button>
          </div>
          {accounts.length === 0 && <div className="text-xs text-slate-400 px-2 py-3">No ad accounts found.</div>}
          {accounts.map((a) => (
            <label key={a.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-50 text-sm cursor-pointer">
              <input type="checkbox" checked={selected.includes(a.id)} onChange={() => onToggle(a.id)} />
              <span className="truncate">{a.name || a.id}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

