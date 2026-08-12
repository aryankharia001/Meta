import { useEffect, useMemo, useRef, useState } from "react";
import {
  X,
  Copy,
  Check,
  RefreshCw,
  Download,
  Search,
  ChevronLeft,
  ChevronRight,
  SlidersHorizontal,
  AlertTriangle,
  Inbox,
  Calendar,
  Building2,
  Target,
  Tag,
  Clock,
  Wallet,
  CreditCard,
  Gauge,
  Receipt,
  Truck,
  PackageCheck,
  Ban,
  RotateCcw,
  Megaphone,
  Package,
  CheckCircle2,
  Info,
  FileText,
} from "lucide-react";
import { fetchCampaignDetails } from "../lib/api";
import { getCachedCampaignDetails, setCachedCampaignDetails } from "../lib/campaignDetailsCache";
import { useCampaignDrawer } from "../lib/CampaignDrawerContext";
import { useOrderDrawer } from "../lib/OrderDrawerContext";
import { useLiveSync, rangeIncludesToday } from "../lib/LiveSyncContext";
import { currency, number, percent, multiplier, formatDate, formatDateTime } from "../lib/format";
import { statusBadgeClass, roasClass, formatBudget } from "../lib/campaignDisplay";
import { LiveIndicator } from "./CampaignCells";
import InfoModal from "./InfoModal";
import FavoriteButton from "./FavoriteButton";
import EntityNotesPanel from "./EntityNotesPanel";
import { recordRecentlyViewed } from "../lib/recentlyViewed";
import { useColumnPrefs } from "../lib/useColumnPrefs";
import ColumnSettingsMenu from "./ColumnSettingsMenu";
import { CAMPAIGN_ORDER_COLUMNS, CAMPAIGN_ORDER_DEFAULT_HIDDEN } from "../lib/campaignOrderColumns";

// ────────────────────────────────────────────────────────────────
// Phase 2 — Campaign drawer: the "click a campaign, get a full CRM
// object" surface. Talks only to GET /campaigns/:tokenId/:campaignId/details
// (new, additive route — see campaigns.js) and the session cache in
// campaignDetailsCache.js. Never touches /compare, sync, or matching.
// ────────────────────────────────────────────────────────────────

const ACCENTS = {
  indigo: "bg-indigo-50 text-indigo-600",
  violet: "bg-violet-50 text-violet-600",
  emerald: "bg-emerald-50 text-emerald-600",
  amber: "bg-amber-50 text-amber-600",
  rose: "bg-rose-50 text-rose-600",
  sky: "bg-sky-50 text-sky-600",
  slate: "bg-slate-100 text-slate-500",
};

// Phase 11 — campaign status badge now uses the shared statusBadgeClass()
// from lib/campaignDisplay.js, so this drawer's badge colors (green/red/
// neutral gray only, no amber/orange) match every other campaign status
// indicator in the app.

// Same lowercase/trim/collapse-whitespace normalization used elsewhere
// (KpiAnalyticsPopup's matched/unmatched/outside-range classification) —
// duplicated locally rather than imported so this file has zero new
// cross-component coupling; it's a pure string helper, not shared state.
const normalizeCampaignName = (name) =>
  String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

const KPI_DEFS = [
  { key: "spend", label: "Spend", icon: CreditCard, accent: "amber", format: currency },
  { key: "revenue", label: "Revenue", icon: Wallet, accent: "emerald", format: currency },
  { key: "roas", label: "ROAS", icon: Gauge, accent: "violet", format: multiplier },
  { key: "totalOrders", label: "Total Orders", icon: Package, accent: "indigo", format: number },
  { key: "matchedOrders", label: "Matched Orders", icon: CheckCircle2, accent: "emerald", format: number },
  { key: "prepaid", label: "Prepaid Orders", icon: CreditCard, accent: "indigo", format: number },
  { key: "cod", label: "COD Orders", icon: Truck, accent: "amber", format: number },
  { key: "delivered", label: "Delivered Orders", icon: PackageCheck, accent: "emerald", format: number },
  { key: "pending", label: "Pending Orders", icon: Clock, accent: "amber", format: number },
  { key: "cancelled", label: "Cancelled Orders", icon: Ban, accent: "rose", format: number },
  { key: "returned", label: "Returned Orders", icon: RotateCcw, accent: "slate", format: number },
  { key: "aov", label: "Avg Order Value", icon: Receipt, accent: "sky", format: currency },
  { key: "cpo", label: "Cost Per Order", icon: Target, accent: "violet", format: currency },
];

const META_METRIC_DEFS = [
  { key: "spend", label: "Spend", format: currency, tip: "Total amount spent, from Meta insights for this range." },
  { key: "reach", label: "Reach", format: number, tip: "Estimated number of unique people who saw the ads." },
  { key: "impressions", label: "Impressions", format: number, tip: "Total number of times the ads were shown." },
  { key: "cpm", label: "CPM", format: currency, tip: "Average cost per 1,000 impressions." },
  { key: "cpc", label: "CPC", format: currency, tip: "Average cost per click." },
  { key: "ctr", label: "CTR", format: percent, tip: "Click-through rate — clicks divided by impressions." },
  { key: "clicks", label: "Clicks", format: number, tip: "All clicks on the ad." },
  { key: "linkClicks", label: "Link Clicks", format: number, tip: "Clicks that led to the destination link." },
  { key: "landingPageViews", label: "Landing Page Views", format: number, tip: "Link clicks that loaded the landing page." },
  { key: "purchases", label: "Purchases", format: number, tip: "Meta-attributed purchase events (pixel/CAPI) — may differ from Shiprocket-matched orders." },
  { key: "purchaseValue", label: "Purchase Value", format: currency, tip: "Meta-attributed purchase value." },
  { key: "costPerPurchase", label: "Cost Per Purchase", format: currency, tip: "Spend divided by Meta-attributed purchases." },
  { key: "frequency", label: "Frequency", format: (v) => (v == null ? "N/A" : Number(v).toFixed(2)), tip: "Average number of times each person saw the ad." },
  { key: "purchaseRoas", label: "ROAS (Meta)", format: multiplier, tip: "Meta's own pixel-tracked ROAS — compare against the Shiprocket-matched ROAS above." },
];

function toCsvValue(v) {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function downloadCsv(filename, rows) {
  const csv = rows.map((r) => r.map(toCsvValue).join(",")).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const PAGE_SIZE = 10;
const EMPTY_FILTERS = { paymentType: "", orderStatus: "", deliveryStatus: "", product: "", state: "", city: "" };

export default function CampaignDrawer() {
  const { activeCampaign, closeCampaign } = useCampaignDrawer();
  const { openOrder } = useOrderDrawer();
  const liveSync = useLiveSync();
  const open = !!activeCampaign;

  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sortConfig, setSortConfig] = useState({ key: "orderCreatedAt", direction: "desc" });
  const [page, setPage] = useState(1);

  const [infoCard, setInfoCard] = useState(null);

  const loadDetails = (meta, { force = false, isNewCampaign = false } = {}) => {
    const { tokenId, campaignId, campaignName, accountId, since, until } = meta;

    if (!force) {
      const cached = getCachedCampaignDetails(tokenId, campaignId, accountId, since, until);
      if (cached) {
        setDetails(cached);
        setError("");
        setLoading(false);
        return;
      }
    }

    // Switching to a different campaign that isn't cached: clear the
    // previous campaign's data first so it can't flash on screen under
    // the loading overlay. A plain refresh of the campaign already open
    // (force=true from the header button) keeps showing the current data,
    // dimmed, while the fresh copy loads in.
    if (isNewCampaign) setDetails(null);

    setLoading(true);
    setError("");
    fetchCampaignDetails(tokenId, campaignId, { campaignName, accountId, since, until })
      .then((res) => {
        setDetails(res);
        setCachedCampaignDetails(tokenId, campaignId, accountId, since, until, res);
      })
      .catch((err) => setError(err.message || "Failed to load campaign details"))
      .finally(() => setLoading(false));
  };

  // Reset local drawer UI state and (re)fetch whenever a different
  // campaign (or the same campaign with a different date range) is opened.
  useEffect(() => {
    if (!activeCampaign) return;
    setSearch("");
    setFilters(EMPTY_FILTERS);
    setFiltersOpen(false);
    setSortConfig({ key: "orderCreatedAt", direction: "desc" });
    setPage(1);
    loadDetails(activeCampaign, { isNewCampaign: true });
    if (activeCampaign.campaignId) {
      recordRecentlyViewed("campaign", activeCampaign.campaignId, activeCampaign.campaignName, {
        tokenId: activeCampaign.tokenId,
        accountId: activeCampaign.accountId,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCampaign?.tokenId, activeCampaign?.campaignId, activeCampaign?.accountId, activeCampaign?.since, activeCampaign?.until]);

  // Phase 5 — "refresh any open drawer if its data has changed": if the
  // live-sync poll finds new orders and this drawer is currently open on
  // the campaign one of them belongs to (name match, same normalization
  // the KPI popups use), force a refetch bypassing the cache — but only
  // if this drawer's own date range actually includes today, same rule
  // every other page follows.
  const prevDrawerSyncVersionRef = useRef(liveSync.syncVersion);
  useEffect(() => {
    if (!activeCampaign) return;
    if (liveSync.syncVersion === prevDrawerSyncVersionRef.current) return;
    prevDrawerSyncVersionRef.current = liveSync.syncVersion;

    const records = liveSync.lastResult?.newOrderRecords || [];
    if (records.length === 0) return;

    const openName = normalizeCampaignName(activeCampaign.campaignName);
    const relevant = records.some((r) => normalizeCampaignName(r.campaignName) === openName);
    const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
    const todayIso = new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);

    if (relevant && rangeIncludesToday(activeCampaign.since, activeCampaign.until, todayIso)) {
      loadDetails(activeCampaign, { force: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveSync.syncVersion, activeCampaign]);

  useEffect(() => {
    setPage(1);
  }, [filters, search, sortConfig]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && closeCampaign();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, closeCampaign]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // ── Derived data ─────────────────────────────────────────────

  const kpiValues = useMemo(() => {
    if (!details) return null;
    const orders = details.orders || [];
    const spend = details.metaInsights?.spend ?? null;
    const revenue = orders.reduce((s, o) => s + Number(o.totalAmountPayable || 0), 0);
    const totalOrders = orders.length;
    const prepaid = orders.filter((o) => o.paymentType === "PREPAID").length;
    const cod = orders.filter((o) => o.paymentType === "CASH_ON_DELIVERY").length;

    const withDelivery = orders.filter((o) => o.deliveryStatus);
    const countBy = (kws) =>
      withDelivery.filter((o) => kws.some((k) => o.deliveryStatus.toLowerCase().includes(k))).length;
    const delivered = withDelivery.length ? countBy(["deliver"]) : null;
    const pending = withDelivery.length ? countBy(["pending", "transit", "process", "confirm"]) : null;
    const cancelled = withDelivery.length ? countBy(["cancel"]) : null;
    const returned = withDelivery.length ? countBy(["return", "rto"]) : null;

    const roas = spend ? revenue / spend : spend === 0 ? 0 : null;
    const aov = totalOrders ? revenue / totalOrders : 0;
    const cpo = spend != null && totalOrders ? spend / totalOrders : spend === 0 ? 0 : null;

    return {
      spend,
      revenue,
      roas,
      totalOrders,
      matchedOrders: totalOrders,
      prepaid,
      cod,
      delivered,
      pending,
      cancelled,
      returned,
      aov,
      cpo,
    };
  }, [details]);

  const insights = useMemo(() => {
    if (!details) return null;
    const orders = details.orders || [];
    if (orders.length === 0) return { empty: true };

    const withCreated = orders.filter((o) => o.orderCreatedAt);
    const first = withCreated.length
      ? withCreated.reduce((a, b) => (new Date(a.orderCreatedAt) < new Date(b.orderCreatedAt) ? a : b))
      : null;
    const last = withCreated.length
      ? withCreated.reduce((a, b) => (new Date(a.orderCreatedAt) > new Date(b.orderCreatedAt) ? a : b))
      : null;

    const byDay = new Map();
    orders.forEach((o) => {
      const cur = byDay.get(o.orderDate) || { day: o.orderDate, count: 0, revenue: 0 };
      cur.count += 1;
      cur.revenue += Number(o.totalAmountPayable || 0);
      byDay.set(o.orderDate, cur);
    });
    const days = [...byDay.values()];
    const highestRevenueDay = days.length ? days.reduce((a, b) => (b.revenue > a.revenue ? b : a)) : null;
    const highestOrderDay = days.length ? days.reduce((a, b) => (b.count > a.count ? b : a)) : null;

    const totalOrders = orders.length;
    const prepaidCount = orders.filter((o) => o.paymentType === "PREPAID").length;
    const codCount = orders.filter((o) => o.paymentType === "CASH_ON_DELIVERY").length;
    const totalRevenue = orders.reduce((s, o) => s + Number(o.totalAmountPayable || 0), 0);

    const withDelivery = orders.filter((o) => o.deliveryStatus);
    const deliveredCount = withDelivery.filter((o) => o.deliveryStatus.toLowerCase().includes("deliver")).length;
    const cancelledCount = withDelivery.filter((o) => o.deliveryStatus.toLowerCase().includes("cancel")).length;

    return {
      empty: false,
      firstOrder: first,
      lastOrder: last,
      highestRevenueDay,
      highestOrderDay,
      codPercent: totalOrders ? (codCount / totalOrders) * 100 : 0,
      prepaidPercent: totalOrders ? (prepaidCount / totalOrders) * 100 : 0,
      avgRevenuePerOrder: totalOrders ? totalRevenue / totalOrders : 0,
      deliveredPercent: withDelivery.length ? (deliveredCount / withDelivery.length) * 100 : null,
      cancelledPercent: withDelivery.length ? (cancelledCount / withDelivery.length) * 100 : null,
    };
  }, [details]);

  const filterOptions = useMemo(() => {
    const orders = details?.orders || [];
    const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort();
    return {
      paymentTypes: uniq(orders.map((o) => o.paymentType)),
      orderStatuses: uniq(orders.map((o) => o.orderStatus)),
      deliveryStatuses: uniq(orders.map((o) => o.deliveryStatus)),
      products: uniq(orders.flatMap((o) => (o.product ? o.product.split(",").map((p) => p.trim()) : []))),
      states: uniq(orders.map((o) => o.state)),
      cities: uniq(orders.map((o) => o.city)),
    };
  }, [details]);

  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  const filteredOrders = useMemo(() => {
    let list = details?.orders || [];
    if (filters.paymentType) list = list.filter((o) => o.paymentType === filters.paymentType);
    if (filters.orderStatus) list = list.filter((o) => o.orderStatus === filters.orderStatus);
    if (filters.deliveryStatus) list = list.filter((o) => o.deliveryStatus === filters.deliveryStatus);
    if (filters.product) list = list.filter((o) => (o.product || "").includes(filters.product));
    if (filters.state) list = list.filter((o) => o.state === filters.state);
    if (filters.city) list = list.filter((o) => o.city === filters.city);

    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((o) =>
        [o.orderId, o.customerName, o.phone, o.product].filter(Boolean).join(" ").toLowerCase().includes(q)
      );
    }
    return list;
  }, [details, filters, search]);

  const sortedOrders = useMemo(() => {
    const list = [...filteredOrders];
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
  }, [filteredOrders, sortConfig]);

  const totalPages = Math.max(1, Math.ceil(sortedOrders.length / PAGE_SIZE));
  const pagedOrders = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return sortedOrders.slice(start, start + PAGE_SIZE);
  }, [sortedOrders, page]);

  const handleSort = (key) =>
    setSortConfig((prev) => ({ key, direction: prev.key === key && prev.direction === "asc" ? "desc" : "asc" }));
  const arrow = (key) => (sortConfig.key !== key ? "" : sortConfig.direction === "asc" ? " ↑" : " ↓");

  // Phase 10 — Campaign Orders column customization (show/hide, drag
  // reorder, reset), its own storage key so it never affects any other
  // table's prefs. Sorting/filtering/pagination above are all untouched
  // business logic — this only changes which columns render and in
  // what order.
  const {
    orderedColumns: orderColumns,
    allColumnsOrdered: allOrderColumns,
    hidden: hiddenOrderCols,
    toggleHidden: toggleOrderCol,
    reorder: reorderOrderCols,
    reset: resetOrderCols,
  } = useColumnPrefs("campaignDrawerOrders", CAMPAIGN_ORDER_COLUMNS, CAMPAIGN_ORDER_DEFAULT_HIDDEN);

  const handleCopyId = async () => {
    if (!details) return;
    try {
      await navigator.clipboard.writeText(details.campaign.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard permissions denied — silently ignore, button just won't confirm
    }
  };

  const exportSummary = () => {
    if (!details || !kpiValues) return;
    const c = details.campaign;
    const rows = [
      ["Field", "Value"],
      ["Campaign Name", c.name],
      ["Campaign ID", c.id],
      ["Status", c.status || "N/A"],
      ["Budget", formatBudget(c.budget, c.budgetType) || "N/A"],
      ["Objective", c.objective || "N/A"],
      ["Buying Type", c.buyingType || "N/A"],
      ["Ad Account", activeCampaign?.accountName || c.accountId || "N/A"],
      ["Start Date", formatDate(c.startTime)],
      ["End Date", formatDate(c.stopTime)],
      ["Created", formatDate(c.createdTime)],
      ["Last Updated", formatDate(c.updatedTime)],
      ["Date Range", `${details.since} to ${details.until}`],
      ...KPI_DEFS.map((d) => [d.label, d.format(kpiValues[d.key])]),
    ];
    downloadCsv(`campaign-${c.id}-summary.csv`, rows);
  };

  const exportOrders = () => {
    if (!details) return;
    const rows = [
      ["Order ID", "Customer Name", "Phone", "Product(s)", "Revenue", "Payment Type", "Current Status", "Courier", "Order Date"],
      ...sortedOrders.map((o) => [
        o.orderId,
        o.customerName || "N/A",
        o.phone || "N/A",
        o.product || "N/A",
        o.totalAmountPayable,
        o.paymentType || "N/A",
        o.deliveryStatus || o.orderStatus || "N/A",
        o.courier || "N/A",
        o.orderDate,
      ]),
    ];
    downloadCsv(`campaign-${details.campaign.id}-orders.csv`, rows);
  };

  const clearFilters = () => setFilters(EMPTY_FILTERS);

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-sm transition-opacity duration-300 ${
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        onClick={closeCampaign}
      />

      <div
        className={`fixed top-0 right-0 h-full z-50 w-full sm:w-[94vw] lg:w-[1100px] max-w-full bg-slate-50 shadow-2xl transition-transform duration-300 ease-out flex flex-col ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        role="dialog"
        aria-modal="true"
      >
        {loading && !details && <DrawerSkeleton onClose={closeCampaign} />}

        {!loading && error && (
          <DrawerError message={error} onRetry={() => activeCampaign && loadDetails(activeCampaign, { force: true })} onClose={closeCampaign} />
        )}

        {!error && details && (
          <>
            {/* ── Sticky campaign header ─────────────────────── */}
            <div className="sticky top-0 z-10 bg-white border-b border-slate-200 px-6 py-4">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <FavoriteButton
                      entityType="campaign"
                      entityId={details.campaign.id}
                      label={details.campaign.name}
                      meta={{ tokenId: activeCampaign?.tokenId, accountId: details.campaign.accountId }}
                      size={16}
                    />
                    <h2 className="font-display font-bold text-lg text-slate-800 truncate max-w-[420px]">
                      {details.campaign.name}
                    </h2>
                    {details.campaign.status && (
                      <span className={`badge ${statusBadgeClass(details.campaign.effectiveStatus || details.campaign.status)}`}>
                        {details.campaign.status}
                      </span>
                    )}
                    <LiveIndicator status={details.campaign.effectiveStatus || details.campaign.status} />
                    {!details.campaign.metaAvailable && (
                      <span className="badge badge-slate" title="Meta didn't return metadata for this campaign ID">
                        Meta data unavailable
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={handleCopyId}
                    className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-600 font-mono"
                    title="Copy campaign ID"
                  >
                    {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                    {details.campaign.id}
                  </button>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => loadDetails(activeCampaign, { force: true })}
                    disabled={loading}
                    title="Refresh (bypass cache)"
                  >
                    <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
                  </button>
                  <div className="relative group">
                    <button type="button" className="btn btn-secondary btn-sm">
                      <Download size={13} /> Export
                    </button>
                    <div className="absolute right-0 mt-1 w-48 bg-white border border-slate-200 rounded-lg shadow-lg py-1 hidden group-hover:block z-20">
                      <button
                        type="button"
                        onClick={exportSummary}
                        className="w-full text-left px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
                      >
                        Campaign Summary (CSV)
                      </button>
                      <button
                        type="button"
                        onClick={exportOrders}
                        className="w-full text-left px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
                      >
                        Campaign Orders (CSV)
                      </button>
                    </div>
                  </div>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={closeCampaign} title="Close">
                    <X size={14} />
                  </button>
                </div>
              </div>

              {/* Campaign info strip */}
              <div className="flex flex-wrap gap-x-6 gap-y-1.5 text-xs text-slate-500">
                <InfoBit icon={Wallet} label="Budget" value={formatBudget(details.campaign.budget, details.campaign.budgetType) || "N/A"} />
                <InfoBit icon={Target} label="Objective" value={details.campaign.objective || "N/A"} />
                <InfoBit icon={Tag} label="Buying Type" value={details.campaign.buyingType || "N/A"} />
                <InfoBit icon={Building2} label="Ad Account" value={activeCampaign?.accountName || details.campaign.accountId || "N/A"} />
                <InfoBit icon={Calendar} label="Start" value={formatDate(details.campaign.startTime)} />
                <InfoBit icon={Calendar} label="End" value={formatDate(details.campaign.stopTime)} />
                <InfoBit icon={Clock} label="Created" value={formatDate(details.campaign.createdTime)} />
                <InfoBit icon={Clock} label="Updated" value={formatDate(details.campaign.updatedTime)} />
              </div>
            </div>

            {/* ── Scrollable body ─────────────────────────────── */}
            <div className={`flex-1 overflow-y-auto px-6 py-6 space-y-8 transition-opacity ${loading ? "opacity-60 pointer-events-none" : ""}`}>
              {/* KPIs */}
              <section>
                <SectionTitle icon={Gauge}>Campaign KPIs</SectionTitle>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3.5">
                  {KPI_DEFS.map((def) => (
                    <button
                      key={def.key}
                      type="button"
                      onClick={() =>
                        setInfoCard({ ...def, display: kpiValues ? def.format(kpiValues[def.key]) : "N/A" })
                      }
                      className="text-left card !p-3.5 flex flex-col gap-2.5 hover:-translate-y-0.5 hover:border-slate-300"
                    >
                      <span className={`flex items-center justify-center w-8 h-8 rounded-lg ${ACCENTS[def.accent]}`}>
                        <def.icon size={15} />
                      </span>
                      <div className="min-w-0">
                        <div className="text-[12px] text-slate-500 leading-tight truncate">{def.label}</div>
                        <div
                          className={`text-lg font-display font-bold truncate ${
                            def.key === "roas" && kpiValues?.roas != null ? roasClass(kpiValues.roas) : "text-slate-800"
                          }`}
                        >
                          {kpiValues ? def.format(kpiValues[def.key]) : "N/A"}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </section>

              {/* Meta Performance */}
              <section>
                <SectionTitle icon={Megaphone}>Meta Performance</SectionTitle>
                <div className="card p-0 overflow-hidden">
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 divide-x divide-y divide-slate-100">
                    {META_METRIC_DEFS.map((m) => (
                      <div key={m.key} className="p-3.5" title={m.tip}>
                        <div className="text-[11px] text-slate-400 mb-1 flex items-center gap-1">
                          {m.label}
                          <Info size={10} className="text-slate-300" />
                        </div>
                        <div className="text-sm font-semibold text-slate-700">
                          {details.metaInsights ? m.format(details.metaInsights[m.key]) : "N/A"}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                {!details.metaInsights && (
                  <p className="text-xs text-slate-400 mt-2">Meta didn't return insights for this campaign in this date range.</p>
                )}
              </section>

              {/* Insights */}
              <section>
                <SectionTitle icon={Info}>Insights</SectionTitle>
                {insights?.empty ? (
                  <div className="card text-sm text-slate-400 text-center py-6">No orders in range to derive insights from.</div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                    <InsightCard label="First Order Received" value={formatDateTime(insights?.firstOrder?.orderCreatedAt)} sub={insights?.firstOrder ? `#${insights.firstOrder.orderId}` : null} />
                    <InsightCard label="Latest Order Received" value={formatDateTime(insights?.lastOrder?.orderCreatedAt)} sub={insights?.lastOrder ? `#${insights.lastOrder.orderId}` : null} />
                    <InsightCard label="Highest Revenue Day" value={insights?.highestRevenueDay?.day || "N/A"} sub={insights?.highestRevenueDay ? currency(insights.highestRevenueDay.revenue) : null} />
                    <InsightCard label="Highest Order Day" value={insights?.highestOrderDay?.day || "N/A"} sub={insights?.highestOrderDay ? `${insights.highestOrderDay.count} orders` : null} />
                    <InsightCard label="COD %" value={percent(insights?.codPercent)} />
                    <InsightCard label="Prepaid %" value={percent(insights?.prepaidPercent)} />
                    <InsightCard label="Avg Revenue / Order" value={currency(insights?.avgRevenuePerOrder)} />
                    <InsightCard label="Delivered %" value={percent(insights?.deliveredPercent)} note={insights?.deliveredPercent == null ? "Delivery status not tracked yet" : null} />
                    <InsightCard label="Cancellation %" value={percent(insights?.cancelledPercent)} note={insights?.cancelledPercent == null ? "Delivery status not tracked yet" : null} />
                  </div>
                )}
              </section>

              {/* Orders */}
              <section>
                <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
                  <SectionTitle icon={Package} noMargin>
                    Campaign Orders <span className="text-slate-400 font-normal">({sortedOrders.length})</span>
                  </SectionTitle>

                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="relative">
                      <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        className="input pl-7 !py-1.5 !text-xs w-48"
                        placeholder="Search orders…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </div>
                    <button
                      type="button"
                      className={`btn btn-secondary btn-sm ${activeFilterCount ? "!border-blue-300 !text-blue-700" : ""}`}
                      onClick={() => setFiltersOpen((o) => !o)}
                    >
                      <SlidersHorizontal size={13} /> Filters {activeFilterCount ? `(${activeFilterCount})` : ""}
                    </button>
                    <ColumnSettingsMenu
                      columns={allOrderColumns}
                      hidden={hiddenOrderCols}
                      toggleHidden={toggleOrderCol}
                      reorder={reorderOrderCols}
                      reset={resetOrderCols}
                    />
                  </div>
                </div>

                {filtersOpen && (
                  <div className="card mb-3 flex flex-wrap gap-3 items-end">
                    <FilterSelect label="Payment Type" value={filters.paymentType} options={filterOptions.paymentTypes} onChange={(v) => setFilters((f) => ({ ...f, paymentType: v }))} />
                    <FilterSelect label="Order Status" value={filters.orderStatus} options={filterOptions.orderStatuses} onChange={(v) => setFilters((f) => ({ ...f, orderStatus: v }))} emptyHint="Not tracked yet" />
                    <FilterSelect label="Delivery Status" value={filters.deliveryStatus} options={filterOptions.deliveryStatuses} onChange={(v) => setFilters((f) => ({ ...f, deliveryStatus: v }))} emptyHint="Not tracked yet" />
                    <FilterSelect label="Product" value={filters.product} options={filterOptions.products} onChange={(v) => setFilters((f) => ({ ...f, product: v }))} emptyHint="Not tracked yet" />
                    <FilterSelect label="State" value={filters.state} options={filterOptions.states} onChange={(v) => setFilters((f) => ({ ...f, state: v }))} />
                    <FilterSelect label="City" value={filters.city} options={filterOptions.cities} onChange={(v) => setFilters((f) => ({ ...f, city: v }))} />
                    {activeFilterCount > 0 && (
                      <button type="button" className="text-xs text-blue-600 hover:underline mb-1.5" onClick={clearFilters}>
                        Clear filters
                      </button>
                    )}
                  </div>
                )}

                <div className="card p-0 overflow-hidden">
                  {sortedOrders.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-14 text-center">
                      <span className="flex items-center justify-center w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 mb-3">
                        <Inbox size={22} />
                      </span>
                      <div className="text-sm text-slate-500">
                        {details.orders.length === 0 ? "No orders matched this campaign in range." : "No orders match your search/filters."}
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="overflow-auto max-h-[440px]">
                        <table className="table">
                          <thead className="sticky top-0 z-[1]">
                            <tr>
                              {orderColumns.map((c) => (
                                <th
                                  key={c.key}
                                  className={c.sortable !== false ? "cursor-pointer select-none" : ""}
                                  onClick={() => c.sortable !== false && handleSort(c.sortKey || c.key)}
                                >
                                  {c.label}
                                  {c.sortable !== false ? arrow(c.sortKey || c.key) : ""}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {pagedOrders.map((o) => (
                              <tr
                                key={o.orderId}
                                className="cursor-pointer"
                                onClick={() => openOrder({ orderId: o.orderId, tokenId: activeCampaign?.tokenId })}
                              >
                                {orderColumns.map((c) => (
                                  <td
                                    key={c.key}
                                    className={
                                      c.key === "orderId" ? "font-medium text-slate-700" : c.key === "product" ? "max-w-[180px] truncate" : ""
                                    }
                                    title={c.key === "product" ? o.product || "N/A" : undefined}
                                  >
                                    {c.key === "paymentType" ? (
                                      <span className={`badge ${o.paymentType === "PREPAID" ? "badge-blue" : "badge-amber"}`}>
                                        {o.paymentType || "N/A"}
                                      </span>
                                    ) : (
                                      c.render(o)
                                    )}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 text-xs text-slate-500">
                        <span>
                          Page {page} of {totalPages} · {sortedOrders.length} order{sortedOrders.length === 1 ? "" : "s"}
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
              </section>

              {/* Phase 7 — Internal Notes */}
              <section>
                <SectionTitle icon={FileText}>Internal Notes</SectionTitle>
                <div className="card">
                  <EntityNotesPanel entityType="campaign" entityId={details.campaign.id} />
                </div>
              </section>
            </div>
          </>
        )}
      </div>

      <InfoModal
        open={!!infoCard}
        title={infoCard?.label}
        subtitle={infoCard ? `Current value: ${infoCard.display}` : ""}
        icon={infoCard?.icon}
        accentClass={infoCard ? ACCENTS[infoCard.accent] : ""}
        body={`A detailed ${(infoCard?.label || "").toLowerCase()} drill-down — trend over time, breakdown by day — is coming in a later phase.`}
        onClose={() => setInfoCard(null)}
      />
    </>
  );
}

// ────────────────────────────────────────────────────────────────
// Subcomponents
// ────────────────────────────────────────────────────────────────

function SectionTitle({ icon: Icon, children, noMargin }) {
  return (
    <h3 className={`flex items-center gap-2 font-display font-semibold text-slate-700 text-sm ${noMargin ? "" : "mb-3"}`}>
      <Icon size={15} className="text-slate-400" />
      {children}
    </h3>
  );
}

function InfoBit({ icon: Icon, label, value }) {
  return (
    <span className="inline-flex items-center gap-1.5" title={label}>
      <Icon size={12} className="text-slate-300" />
      <span className="text-slate-400">{label}:</span>
      <span className="font-medium text-slate-600">{value}</span>
    </span>
  );
}

function InsightCard({ label, value, sub, note }) {
  return (
    <div className="card !p-4">
      <div className="text-[12px] text-slate-500 mb-1">{label}</div>
      <div className="text-base font-display font-bold text-slate-800 truncate">{value}</div>
      {sub && <div className="text-xs text-slate-400 mt-0.5">{sub}</div>}
      {note && <div className="text-[11px] text-slate-300 mt-0.5 italic">{note}</div>}
    </div>
  );
}

function FilterSelect({ label, value, options, onChange, emptyHint }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-slate-500 min-w-[140px]">
      {label}
      <select className="input !py-1.5 !text-xs" value={value} onChange={(e) => onChange(e.target.value)} disabled={options.length === 0}>
        <option value="">All</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      {options.length === 0 && emptyHint && <span className="text-[10px] text-slate-300">{emptyHint}</span>}
    </label>
  );
}

function DrawerSkeleton({ onClose }) {
  return (
    <>
      <div className="sticky top-0 z-10 bg-white border-b border-slate-200 px-6 py-4">
        <div className="flex items-center justify-between mb-3">
          <div className="h-6 w-56 bg-slate-100 rounded animate-pulse" />
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        <div className="flex gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-3 w-20 bg-slate-100 rounded animate-pulse" />
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-8">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3.5">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="card !p-3.5 flex flex-col gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-slate-100 animate-pulse" />
              <div className="h-3 w-16 bg-slate-100 rounded animate-pulse" />
              <div className="h-4 w-12 bg-slate-100 rounded animate-pulse" />
            </div>
          ))}
        </div>
        <div className="card h-48 animate-pulse bg-slate-100" />
        <div className="card h-64 animate-pulse bg-slate-100" />
      </div>
    </>
  );
}

function DrawerError({ message, onRetry, onClose }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
      <span className="flex items-center justify-center w-14 h-14 rounded-2xl bg-rose-100 text-rose-600 mb-4">
        <AlertTriangle size={26} />
      </span>
      <h3 className="font-display font-semibold text-slate-700 mb-1">Couldn't load this campaign</h3>
      <p className="text-sm text-slate-400 max-w-sm mb-5">{message}</p>
      <div className="flex gap-2">
        <button type="button" className="btn btn-primary btn-sm" onClick={onRetry}>
          <RefreshCw size={14} /> Try again
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
