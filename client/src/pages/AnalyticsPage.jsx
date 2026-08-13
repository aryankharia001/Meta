import { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  Wallet,
  Megaphone,
  Package,
  Users,
  MapPin,
  CreditCard,
  Truck,
  Clock,
  Clock4,
  Layers,
  Images,
  AlertTriangle,
  RefreshCw,
  X,
} from "lucide-react";
import { Link } from "react-router-dom";
import { fetchAnalyticsOrders, fetchLiveAdAccounts, fetchLiveCampaigns } from "../lib/api";
// Phase 13 §14 — Analytics' new Hourly tab, reusing the same panel every
// other Hourly integration point uses.
import HourlyPanel from "../components/hourly/HourlyPanel";
import { getCachedAnalyticsOrders, setCachedAnalyticsOrders } from "../lib/analyticsCache";
import { useSelectedToken } from "../lib/useSelectedToken";
import { useLiveSync, rangeIncludesToday } from "../lib/LiveSyncContext";
import OrdersListPopup from "../components/OrdersListPopup";
import { deliveryBucket, DELIVERY_LABELS } from "../lib/analyticsUtils";
import SavedViewsControl from "../components/SavedViewsControl";

import RevenueSection from "../components/analytics/RevenueSection";
import CampaignSection from "../components/analytics/CampaignSection";
import ProductSection from "../components/analytics/ProductSection";
import CustomerSection from "../components/analytics/CustomerSection";
import GeoSection from "../components/analytics/GeoSection";
import PaymentSection from "../components/analytics/PaymentSection";
import DeliverySection from "../components/analytics/DeliverySection";
import TimeSection from "../components/analytics/TimeSection";

// ────────────────────────────────────────────────────────────────
// Phase 6 — Analytics. A dedicated page (not crammed onto the
// Dashboard), lazily fetching one enriched order list the first time
// it's opened (see analyticsCache.js) plus the same /compare campaign
// data Dashboard/CampaignComparison already use for spend/ROAS. Every
// section below derives its own charts from these two already-fetched
// datasets via useMemo — nothing here re-implements or touches sync,
// matching, or comparison logic.
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
  { key: "yesterday", label: "Yesterday", range: () => { const y = shiftDays(todayIso(), -1); return { since: y, until: y }; } },
  { key: "7d", label: "Last 7 Days", range: () => ({ since: shiftDays(todayIso(), -6), until: todayIso() }) },
  { key: "30d", label: "Last 30 Days", range: () => ({ since: shiftDays(todayIso(), -29), until: todayIso() }) },
  { key: "thisMonth", label: "This Month", range: () => ({ since: monthStart(todayIso()), until: todayIso() }) },
  { key: "lastMonth", label: "Last Month", range: () => { const start = addMonths(monthStart(todayIso()), -1); return { since: start, until: monthEnd(start) }; } },
  { key: "custom", label: "Custom Range", range: null },
];

const TABS = [
  { key: "revenue", label: "Revenue", icon: Wallet },
  { key: "campaigns", label: "Campaigns", icon: Megaphone },
  { key: "products", label: "Products", icon: Package },
  { key: "customers", label: "Customers", icon: Users },
  { key: "geography", label: "Geography", icon: MapPin },
  { key: "payments", label: "Payments", icon: CreditCard },
  { key: "delivery", label: "Delivery", icon: Truck },
  { key: "time", label: "Time-Based", icon: Clock },
  // Phase 13 §14 — lets users switch into Hourly analysis from the same
  // tab bar, without duplicating a second analytics engine — it renders
  // the same HourlyPanel every other integration point uses, scoped to
  // whichever ad accounts are selected above.
  { key: "hourly", label: "Hourly", icon: Clock4 },
];

export default function AnalyticsPage() {
  const { tokenId: TOKEN_ID, setTokenId, tokens } = useSelectedToken();
  const liveSync = useLiveSync();

  const [adAccounts, setAdAccounts] = useState([]);
  const [selectedAccounts, setSelectedAccounts] = useState([]);

  const [presetKey, setPresetKey] = useState("today");
  const [customSince, setCustomSince] = useState(shiftDays(todayIso(), -29));
  const [customUntil, setCustomUntil] = useState(todayIso());
  const { since, until } = useMemo(() => {
    if (presetKey === "custom") return { since: customSince, until: customUntil };
    return PRESETS.find((p) => p.key === presetKey).range();
  }, [presetKey, customSince, customUntil]);

  const [orders, setOrders] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastFetchedAt, setLastFetchedAt] = useState(null);

  const [campaignData, setCampaignData] = useState(null); // /compare response, for spend/ROAS

  const [activeTab, setActiveTab] = useState("revenue");

  // ── Extra filters ────────────────────────────────────────────
  const [filterCampaign, setFilterCampaign] = useState("");
  const [filterPayment, setFilterPayment] = useState("");
  const [filterState, setFilterState] = useState("");
  const [filterCity, setFilterCity] = useState("");
  const [filterProduct, setFilterProduct] = useState("");
  const [filterStatus, setFilterStatus] = useState("");

  const [popup, setPopup] = useState(null); // { title, subtitle, orders, exportFilename }
  const openOrdersList = (cfg) => setPopup(cfg);
  const closeOrdersList = () => setPopup(null);

  // Phase 7 — Saved Views snapshot/restore for this page's own filters.
  const getAnalyticsFilters = () => ({
    tokenId: TOKEN_ID,
    selectedAccounts,
    presetKey,
    customSince,
    customUntil,
    filterCampaign,
    filterPayment,
    filterState,
    filterCity,
    filterProduct,
    filterStatus,
    activeTab,
  });
  const applyAnalyticsFilters = (f) => {
    if (!f) return;
    if (f.tokenId) setTokenId(f.tokenId);
    if (Array.isArray(f.selectedAccounts)) setSelectedAccounts(f.selectedAccounts);
    if (f.presetKey) setPresetKey(f.presetKey);
    if (f.customSince) setCustomSince(f.customSince);
    if (f.customUntil) setCustomUntil(f.customUntil);
    setFilterCampaign(f.filterCampaign || "");
    setFilterPayment(f.filterPayment || "");
    setFilterState(f.filterState || "");
    setFilterCity(f.filterCity || "");
    setFilterProduct(f.filterProduct || "");
    setFilterStatus(f.filterStatus || "");
    if (f.activeTab) setActiveTab(f.activeTab);
  };

  // ── Ad accounts (needed for the existing /compare call) ──────
  useEffect(() => {
    if (!TOKEN_ID) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchLiveAdAccounts(TOKEN_ID);
        const list = res.success ? res.adAccounts || [] : [];
        if (cancelled) return;
        setAdAccounts(list);
        setSelectedAccounts(list.map((a) => a.id));
      } catch {
        if (!cancelled) setAdAccounts([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [TOKEN_ID]);

  // ── Analytics orders (lazy, cached) ───────────────────────────
  const load = ({ force = false } = {}) => {
    if (!TOKEN_ID) return;
    if (!force) {
      const cached = getCachedAnalyticsOrders(TOKEN_ID, since, until);
      if (cached) {
        setOrders(cached.orders);
        setError("");
        setLastFetchedAt(new Date());
        return;
      }
    }
    setLoading(true);
    setError("");
    fetchAnalyticsOrders(TOKEN_ID, { since, until })
      .then((res) => {
        setOrders(res.orders);
        setCachedAnalyticsOrders(TOKEN_ID, since, until, res);
        setLastFetchedAt(new Date());
      })
      .catch((err) => setError(err.message || "Failed to load analytics data"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [TOKEN_ID, since, until]);

  // Campaign spend/ROAS data — same existing /compare endpoint Dashboard
  // and Campaign Comparison already call, reused as-is for leaderboards.
  useEffect(() => {
    if (!TOKEN_ID || selectedAccounts.length === 0) {
      setCampaignData(null);
      return;
    }
    let cancelled = false;
    fetchLiveCampaigns(TOKEN_ID, { accountIds: selectedAccounts, since, until })
      .then((res) => {
        if (!cancelled) setCampaignData(res);
      })
      .catch(() => {
        if (!cancelled) setCampaignData(null);
      });
    return () => {
      cancelled = true;
    };
  }, [TOKEN_ID, selectedAccounts, since, until]);

  // Phase 5 background sync — silently refresh analytics data when new
  // orders land and this page's range includes today, same
  // date-filter-awareness rule every other page follows.
  useEffect(() => {
    if (rangeIncludesToday(since, until, todayIso())) {
      load({ force: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveSync.syncVersion]);

  const handlePresetClick = (key) => {
    if (key === "custom") {
      setCustomSince(since);
      setCustomUntil(until);
    }
    setPresetKey(key);
  };

  // ── Filter option lists, derived from the fetched data ────────
  const filterOptions = useMemo(() => {
    const campaigns = new Set();
    const states = new Set();
    const cities = new Set();
    const products = new Set();
    (orders || []).forEach((o) => {
      if (o.campaignName) campaigns.add(o.campaignName);
      if (o.state) states.add(o.state);
      if (o.city) cities.add(o.city);
      (o.products || []).forEach((p) => p.name && products.add(p.name));
    });
    return {
      campaigns: [...campaigns].sort(),
      states: [...states].sort(),
      cities: [...cities].sort(),
      products: [...products].sort(),
    };
  }, [orders]);

  // ── Apply all filters client-side ─────────────────────────────
  const filteredOrders = useMemo(() => {
    if (!orders) return [];
    return orders.filter((o) => {
      if (filterCampaign && o.campaignName !== filterCampaign) return false;
      if (filterPayment && o.paymentType !== filterPayment) return false;
      if (filterState && o.state !== filterState) return false;
      if (filterCity && o.city !== filterCity) return false;
      if (filterProduct && !(o.products || []).some((p) => p.name === filterProduct)) return false;
      if (filterStatus && deliveryBucket(o) !== filterStatus) return false;
      return true;
    });
  }, [orders, filterCampaign, filterPayment, filterState, filterCity, filterProduct, filterStatus]);

  const activeFilterCount = [filterCampaign, filterPayment, filterState, filterCity, filterProduct, filterStatus].filter(
    Boolean
  ).length;

  const clearFilters = () => {
    setFilterCampaign("");
    setFilterPayment("");
    setFilterState("");
    setFilterCity("");
    setFilterProduct("");
    setFilterStatus("");
  };

  const sectionProps = {
    orders: filteredOrders,
    campaignData,
    tokenId: TOKEN_ID,
    since,
    until,
    openOrdersList,
  };

  return (
    <div className="min-h-screen pb-16">
      <div className="sticky top-0 z-20 bg-white/85 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-[1600px] mx-auto px-6 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3.5">
            <div className="flex items-center gap-2.5">
              <span className="flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-md shadow-indigo-500/30">
                <BarChart3 size={18} />
              </span>
              <div>
                <h1 className="text-lg font-display font-bold text-slate-800 leading-tight">Analytics</h1>
                <p className="text-xs text-slate-400">Business intelligence across campaigns, products, customers &amp; more</p>
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              {lastFetchedAt && (
                <span className="text-xs text-slate-400">
                  Updated {lastFetchedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              )}
              <SavedViewsControl page="analytics" getFilters={getAnalyticsFilters} applyFilters={applyAnalyticsFilters} />
              <button className="btn btn-secondary btn-sm" onClick={() => load({ force: true })} disabled={loading}>
                <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
                {loading ? "Refreshing…" : "Refresh"}
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 mb-3.5">
            <select className="input w-auto" value={TOKEN_ID || ""} onChange={(e) => setTokenId(e.target.value)}>
              {tokens.length === 0 && <option value={TOKEN_ID}>{TOKEN_ID}</option>}
              {tokens.map((t) => (
                <option key={t._id} value={t._id}>
                  {t.label || t._id}
                </option>
              ))}
            </select>

            <FilterSelect label="Campaign" value={filterCampaign} onChange={setFilterCampaign} options={filterOptions.campaigns} />
            <FilterSelect
              label="Payment Type"
              value={filterPayment}
              onChange={setFilterPayment}
              options={[
                { value: "PREPAID", label: "Prepaid" },
                { value: "CASH_ON_DELIVERY", label: "COD" },
              ]}
            />
            <FilterSelect label="State" value={filterState} onChange={setFilterState} options={filterOptions.states} />
            <FilterSelect label="City" value={filterCity} onChange={setFilterCity} options={filterOptions.cities} />
            <FilterSelect label="Product" value={filterProduct} onChange={setFilterProduct} options={filterOptions.products} />
            <FilterSelect
              label="Order Status"
              value={filterStatus}
              onChange={setFilterStatus}
              options={Object.entries(DELIVERY_LABELS)
                .filter(([k]) => k !== "unknown")
                .map(([value, label]) => ({ value, label }))}
            />

            {activeFilterCount > 0 && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={clearFilters}>
                <X size={12} /> Clear filters ({activeFilterCount})
              </button>
            )}
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
                <input type="date" className="input w-auto" value={customSince} max={customUntil} onChange={(e) => setCustomSince(e.target.value)} />
                <span className="text-slate-400 text-sm">to</span>
                <input type="date" className="input w-auto" value={customUntil} min={customSince} max={todayIso()} onChange={(e) => setCustomUntil(e.target.value)} />
              </div>
            )}

            <div className="ml-auto text-xs text-slate-400">
              {since === until ? since : `${since} → ${until}`} · {filteredOrders.length} order{filteredOrders.length === 1 ? "" : "s"}
            </div>
          </div>
        </div>

        <div className="max-w-[1600px] mx-auto px-6">
          <div className="flex items-center gap-1 overflow-x-auto -mb-px">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setActiveTab(t.key)}
                className={`flex items-center gap-1.5 px-3.5 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                  activeTab === t.key
                    ? "border-indigo-600 text-indigo-700"
                    : "border-transparent text-slate-500 hover:text-slate-700"
                }`}
              >
                <t.icon size={14} />
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-[1600px] mx-auto px-6 pt-6">
        {error && <ErrorState message={error} onRetry={() => load({ force: true })} />}

        {!error && loading && !orders && <SectionSkeleton />}

        {!error && orders && (
          <div className={`transition-opacity ${loading ? "opacity-60 pointer-events-none" : ""}`}>
            {activeTab === "revenue" && <RevenueSection {...sectionProps} />}
            {activeTab === "campaigns" && <CampaignSection {...sectionProps} />}
            {activeTab === "products" && <ProductSection {...sectionProps} />}
            {activeTab === "customers" && <CustomerSection {...sectionProps} />}
            {activeTab === "geography" && <GeoSection {...sectionProps} />}
            {activeTab === "payments" && <PaymentSection {...sectionProps} />}
            {activeTab === "delivery" && <DeliverySection {...sectionProps} />}
            {activeTab === "time" && <TimeSection {...sectionProps} />}
            {activeTab === "hourly" && (
              <div>
                <div className="flex items-center gap-2 mb-4 text-xs text-slate-500">
                  <span>Ad Set- and Ad-level breakdowns live in their own explorers:</span>
                  <Link to="/adset-explorer" className="btn btn-secondary btn-sm !py-1"><Layers size={12} /> Ad Set Explorer</Link>
                  <Link to="/ad-explorer" className="btn btn-secondary btn-sm !py-1"><Images size={12} /> Ad Explorer</Link>
                </div>
                <HourlyPanel tokenId={TOKEN_ID} accountIds={selectedAccounts} tableIdSuffix="analytics" title="Hourly Performance" />
              </div>
            )}
          </div>
        )}
      </div>

      <OrdersListPopup
        open={!!popup}
        title={popup?.title}
        subtitle={popup?.subtitle}
        orders={popup?.orders || []}
        exportFilename={popup?.exportFilename}
        tokenId={TOKEN_ID}
        since={since}
        until={until}
        onClose={closeOrdersList}
      />
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }) {
  const normalized = options.map((o) => (typeof o === "string" ? { value: o, label: o } : o));
  return (
    <select className="input w-auto !text-xs" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{label}: All</option>
      {normalized.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function SectionSkeleton() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-8">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="card">
          <div className="h-4 w-32 bg-slate-100 rounded animate-pulse mb-4" />
          <div className="h-56 bg-slate-100 rounded-xl animate-pulse" />
        </div>
      ))}
    </div>
  );
}

function ErrorState({ message, onRetry }) {
  return (
    <div className="card border-rose-200 bg-rose-50/60 flex flex-col items-center text-center py-12 px-6 mb-8">
      <span className="flex items-center justify-center w-12 h-12 rounded-2xl bg-rose-100 text-rose-600 mb-3">
        <AlertTriangle size={22} />
      </span>
      <h3 className="font-display font-semibold text-rose-700 mb-1">Couldn't load analytics data</h3>
      <p className="text-sm text-rose-500 mb-4 max-w-md">{message}</p>
      <button className="btn btn-primary btn-sm" onClick={onRetry}>
        <RefreshCw size={14} /> Try again
      </button>
    </div>
  );
}
