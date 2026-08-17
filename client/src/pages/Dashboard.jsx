import { Fragment, useEffect, useMemo, useRef, useState } from "react";
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
import { getCachedDashboard, setCachedDashboard, dashboardCacheKey } from "../lib/dashboardCache";
import { useSwrFetch } from "../lib/useSwr";
import LastUpdatedIndicator from "../components/LastUpdatedIndicator";
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
  // Phase 19 §4 — relabeled from "Profit" to "Gross Profit" to avoid
  // colliding with the Profitability page's real, fully-expensed Net
  // Profit. Label kept as-is (not re-renamed here) since that naming
  // decision still stands, but the math is no longer just Revenue −
  // Ad Spend: it now also nets out (a) a COD-risk discount — codSuccessRate,
  // user-editable via the COD Orders card, default 70%, since not every
  // COD order actually gets delivered/collected — and (b) editable flat
  // per-order costs (manufacturing/shipping/packaging/misc) entered via
  // the dropdown on this card, multiplied by total order count. See the
  // `profit`/`profitBreakdown` computation in cardValues below and the
  // ProfitCard component. This is still a dashboard-level *estimate*,
  // not a replacement for the Profitability page's audited Net Profit.
  { key: "profit", label: "Gross Profit", icon: PiggyBank, accent: "emerald", format: currency },
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

  const liveSync = useLiveSync();

  const [searchQuery, setSearchQuery] = useState("");
  const [activePopupCard, setActivePopupCard] = useState(null);

  const [expandedCampaign, setExpandedCampaign] = useState(null);
  const [sortConfig, setSortConfig] = useState({ key: "spend", direction: "desc" });

  // ── Profit inputs (new) ──────────────────────────────────────
  // COD orders show up as "revenue" the moment they're placed, but a
  // real chunk of them never actually get delivered/collected (RTO,
  // cancelled in transit, etc.). codSuccessRate is a user-editable
  // estimate (default 70%) of how much COD revenue is real; it's read
  // from and written to localStorage so the person's own estimate
  // persists across visits. It ONLY affects the profit calculation
  // below — the "Revenue" and "COD Orders" cards themselves keep
  // showing the literal totals from the API, unchanged.
  const [codSuccessRate, setCodSuccessRate] = useState(() => {
    const saved = Number(localStorage.getItem("dashboardCodSuccessRate"));
    return Number.isFinite(saved) && saved > 0 && saved <= 100 ? saved : 70;
  });
  useEffect(() => {
    localStorage.setItem("dashboardCodSuccessRate", String(codSuccessRate));
  }, [codSuccessRate]);

  // Per-order cost inputs (manufacturing / shipping / packaging / misc),
  // also user-editable and persisted. Each is a flat ₹ amount charged
  // once per order, multiplied by total order count in cardValues below.
  const [perOrderCosts, setPerOrderCosts] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("dashboardPerOrderCosts"));
      return {
        manufacturing: Number(saved?.manufacturing) || 0,
        shipping: Number(saved?.shipping) || 0,
        packaging: Number(saved?.packaging) || 0,
        misc: Number(saved?.misc) || 0,
      };
    } catch {
      return { manufacturing: 0, shipping: 0, packaging: 0, misc: 0 };
    }
  });
  useEffect(() => {
    localStorage.setItem("dashboardPerOrderCosts", JSON.stringify(perOrderCosts));
  }, [perOrderCosts]);
  const updatePerOrderCost = (field, value) => {
    const v = Number(value);
    setPerOrderCosts((prev) => ({ ...prev, [field]: Number.isFinite(v) && v >= 0 ? v : 0 }));
  };

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

  // ── Campaign + order comparison data (Phase 18 part 2 — real SWR) ──
  // "Today"/live-ish views change fast, so a short stale window — same
  // 30s Campaign Explorer's Live section effectively polls at.
  const dashboardKey =
    TOKEN_ID && selectedAccounts.length > 0 ? dashboardCacheKey(TOKEN_ID, selectedAccounts, since, until) : null;
  const {
    data,
    loading,
    isValidating,
    error,
    backgroundError,
    lastUpdatedAt,
    refresh,
  } = useSwrFetch(dashboardKey, () => fetchLiveCampaigns(TOKEN_ID, { accountIds: selectedAccounts, since, until }), {
    staleTimeMs: 30000,
    getCached: () => getCachedDashboard(TOKEN_ID, selectedAccounts, since, until),
    setCached: (d) => setCachedDashboard(TOKEN_ID, selectedAccounts, since, until, d),
  });

  // ── Phase 5: silent smart-refresh — when the background 10s live-sync
  // poll finds new orders (liveSync.syncVersion only bumps when it does,
  // see LiveSyncContext), force a real refetch (bypassing staleness) IF
  // the currently selected date range includes today (new orders are
  // always dated today — see liveSync.js). Skipped entirely for a past
  // range like "Yesterday" so today's new orders never leak into that
  // view. The ref guards against firing on initial mount (the SWR hook's
  // own mount effect already covers that).
  const prevSyncVersionRef = useRef(liveSync.syncVersion);
  useEffect(() => {
    if (liveSync.syncVersion === prevSyncVersionRef.current) return;
    prevSyncVersionRef.current = liveSync.syncVersion;
    if (rangeIncludesToday(since, until, todayIso())) {
      refresh();
    }
  }, [liveSync.syncVersion, since, until, refresh]);

  const handleRefresh = async () => {
    await liveSync.manualRefresh(); // incremental Shiprocket sync (new orders only), guarded against overlap
    refresh(); // re-read whatever's now in Mongo via the existing, untouched /compare endpoint
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

    // Revenue attributable to COD orders, at face value (before the
    // success-rate haircut). The "Revenue" card keeps showing the raw
    // `revenue` total untouched — this discount only feeds into profit.
    const codRevenueRaw = allOrders
      .filter((o) => o.paymentType === "CASH_ON_DELIVERY")
      .reduce((sum, o) => sum + Number(o.totalAmountPayable || 0), 0);
    const codRevenueLoss = codRevenueRaw * (1 - codSuccessRate / 100);

    // Flat per-order costs (manufacturing + shipping + packaging + misc),
    // applied to every order in the range — matched, unmatched, and
    // regardless of outcome, since manufacturing/shipping/packaging spend
    // is typically committed as soon as an order ships, not only on
    // orders that end up delivered.
    const perOrderCostTotal =
      (Number(perOrderCosts.manufacturing) || 0) +
      (Number(perOrderCosts.shipping) || 0) +
      (Number(perOrderCosts.packaging) || 0) +
      (Number(perOrderCosts.misc) || 0);
    const totalPerOrderCosts = perOrderCostTotal * totalOrders;

    const profit = revenue - codRevenueLoss - spend - totalPerOrderCosts;

    return {
      totalOrders,
      matchedOrders,
      unmatchedOrders: unmatchedCount,
      revenue,
      spend,
      roas,
      profit,
      profitBreakdown: {
        revenue,
        codRevenueLoss,
        spend,
        perOrderCostTotal,
        totalPerOrderCosts,
        totalOrders,
      },
      aov: totalOrders ? revenue / totalOrders : 0,
      prepaid,
      cod,
      activeCampaigns: data.summary.totalCampaigns || 0,
    };
  }, [data, allOrders, codSuccessRate, perOrderCosts]);

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
              <LastUpdatedIndicator lastUpdatedAt={lastUpdatedAt} isValidating={isValidating} backgroundError={backgroundError} />
              <DataFreshnessBadge />
              <SyncStatusIndicator />
              <SavedViewsControl page="dashboard" getFilters={getDashboardFilters} applyFilters={applyDashboardFilters} />
              <button
                className="btn btn-secondary btn-sm"
                onClick={handleRefresh}
                disabled={isValidating || liveSync.isSyncing}
                title={liveSync.isSyncing ? "Sync already in progress." : "Refresh Now"}
              >
                <RefreshCw size={14} className={isValidating || liveSync.isSyncing ? "animate-spin" : ""} />
                {isValidating || liveSync.isSyncing ? "Refreshing…" : "Refresh Now"}
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

            <div className="ml-auto text-xs text-slate-400">{since === until ? since : `${since} → ${until}`}</div>
          </div>
        </div>
      </div>

      <div className="max-w-[1600px] mx-auto px-6 pt-6">
        <RecentlyViewedWidget />

        {error && <ErrorState message={error} onRetry={refresh} />}

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
                isValidating && data ? "opacity-60 pointer-events-none" : ""
              }`}
            >
              {visibleCardList.map(({ key: cardKey, ...c }) => {
                const pinned = dashboardLayout.layout.pinned.includes(cardKey);
                const wide = (dashboardLayout.layout.wide || []).includes(cardKey);
                const onClick = () => data && setActivePopupCard({ key: cardKey, ...c });

                if (cardKey === "cod") {
                  return (
                    <CodOrdersCard
                      key={cardKey}
                      {...c}
                      pinned={pinned}
                      wide={wide}
                      codSuccessRate={codSuccessRate}
                      onCodSuccessRateChange={setCodSuccessRate}
                      onClick={onClick}
                    />
                  );
                }
                if (cardKey === "profit") {
                  return (
                    <ProfitCard
                      key={cardKey}
                      {...c}
                      pinned={pinned}
                      wide={wide}
                      perOrderCosts={perOrderCosts}
                      onCostChange={updatePerOrderCost}
                      breakdown={cardValues.profitBreakdown}
                      onClick={onClick}
                    />
                  );
                }
                return <KpiCard key={cardKey} {...c} pinned={pinned} wide={wide} onClick={onClick} />;
              })}
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
          <div className={`space-y-8 transition-opacity ${isValidating ? "opacity-60 pointer-events-none" : ""}`}>
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

// COD Orders card — adds an inline, editable "success rate" field.
// Clicking the icon/label still opens the usual analytics popup; the
// success-rate row is stopPropagation'd so typing in it never triggers
// that click.
function CodOrdersCard({ label, icon: Icon, accent, display, pinned, wide, codSuccessRate, onCodSuccessRateChange, onClick }) {
  return (
    <div
      className={`group relative card !p-4 flex flex-col gap-2.5 ${pinned ? "!border-amber-300" : ""} ${
        wide ? "col-span-2" : ""
      }`}
    >
      {pinned && <Pin size={11} className="absolute top-3 right-3 text-amber-400" fill="currentColor" />}
      <button type="button" onClick={onClick} className="flex flex-col gap-3 text-left" title="View detailed analytics">
        <span className={`flex items-center justify-center w-9 h-9 rounded-xl ${ACCENTS[accent]}`}>
          <Icon size={17} />
        </span>
        <div className="min-w-0">
          <div className="text-[13px] text-slate-500 mb-0.5 leading-tight truncate">{label}</div>
          <div className="text-xl font-display font-bold text-slate-800 truncate">{display ?? "—"}</div>
        </div>
      </button>

      <div
        className="flex items-center justify-between gap-2 pt-2 mt-0.5 border-t border-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        <label className="text-[11px] text-slate-400 shrink-0" title="Estimated % of COD orders that actually get delivered/collected">
          Success rate
        </label>
        <div className="flex items-center gap-1">
          <input
            type="number"
            min={0}
            max={100}
            step={1}
            value={codSuccessRate}
            onChange={(e) => {
              const v = Number(e.target.value);
              onCodSuccessRateChange(Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : 0);
            }}
            className="w-14 text-xs border border-slate-200 rounded-md px-1.5 py-0.5 text-slate-700 text-right focus:outline-none focus:ring-1 focus:ring-indigo-400"
          />
          <span className="text-[11px] text-slate-400">%</span>
        </div>
      </div>
    </div>
  );
}

// Gross Profit card — adds a collapsible "dropdown" of editable
// per-order cost inputs (manufacturing / shipping / packaging / misc)
// plus a short breakdown of what got deducted. The chevron toggles the
// panel open/closed without triggering the analytics popup.
function ProfitCard({ label, icon: Icon, accent, display, pinned, wide, perOrderCosts, onCostChange, breakdown, onClick }) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className={`group relative card !p-4 flex flex-col gap-3 ${pinned ? "!border-amber-300" : ""} ${
        wide ? "col-span-2" : ""
      }`}
    >
      {pinned && <Pin size={11} className="absolute top-3 right-3 text-amber-400" fill="currentColor" />}

      <div className="flex items-center justify-between">
        <button type="button" onClick={onClick} title="View detailed analytics">
          <span className={`flex items-center justify-center w-9 h-9 rounded-xl ${ACCENTS[accent]}`}>
            <Icon size={17} />
          </span>
        </button>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="text-slate-400 hover:text-slate-600 p-0.5 -m-0.5"
          title="Set per-order costs"
        >
          <ChevronDown size={15} className={`transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </div>

      <button type="button" onClick={onClick} className="min-w-0 text-left" title="View detailed analytics">
        <div className="text-[13px] text-slate-500 mb-0.5 leading-tight truncate">{label}</div>
        <div className="text-xl font-display font-bold text-slate-800 truncate">{display ?? "—"}</div>
      </button>

      {open && (
        <div className="pt-2.5 mt-0.5 border-t border-slate-100 space-y-2" onClick={(e) => e.stopPropagation()}>
          <CostInput label="Manufacturing / order" value={perOrderCosts.manufacturing} onChange={(v) => onCostChange("manufacturing", v)} />
          <CostInput label="Shipping / order" value={perOrderCosts.shipping} onChange={(v) => onCostChange("shipping", v)} />
          <CostInput label="Packaging / order" value={perOrderCosts.packaging} onChange={(v) => onCostChange("packaging", v)} />
          <CostInput label="Misc / order" value={perOrderCosts.misc} onChange={(v) => onCostChange("misc", v)} />

          {breakdown && (
            <div className="text-[11px] text-slate-400 pt-1.5 mt-0.5 border-t border-slate-100 leading-relaxed">
              Revenue {currency(breakdown.revenue)} − COD loss {currency(breakdown.codRevenueLoss)} − Spend{" "}
              {currency(breakdown.spend)} − Costs {currency(breakdown.totalPerOrderCosts)} ({breakdown.totalOrders} orders ×{" "}
              {currency(breakdown.perOrderCostTotal)})
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CostInput({ label, value, onChange }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <label className="text-[11px] text-slate-400">{label}</label>
      <div className="flex items-center gap-1">
        <span className="text-[11px] text-slate-400">₹</span>
        <input
          type="number"
          min={0}
          step="0.01"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-16 text-xs border border-slate-200 rounded-md px-1.5 py-0.5 text-slate-700 text-right focus:outline-none focus:ring-1 focus:ring-indigo-400"
        />
      </div>
    </div>
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