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
  ExternalLink,
  Loader2,
  ShoppingBag,
  Plus,
  Minus,
  Equal,
  Layers,
} from "lucide-react";
import { Link } from "react-router-dom";
import { fetchLiveAdAccounts, fetchLiveCampaigns, fetchAbandonedCarts, fetchExpenseBreakdown } from "../lib/api";
import { OperatingExpenseBreakdownPopup } from "../components/profitability/ExpenseDrillPopups";
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
import DeliveredRevenuePopup from "../components/DeliveredRevenuePopup";
import AbandonedCartSummaryCard from "../components/AbandonedCartSummaryCard";
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

// Phase 21 — small shared hook for the batch of new manual, non-negative,
// per-browser-persisted numeric inputs this phase adds (Abandoned Cart's
// six fields + Additional Prepaid Revenue). Same read-from/write-to
// localStorage pattern already used inline for codSuccessRate/miscCost
// above, just factored out to avoid repeating it seven times.
function usePersistedNumber(key, defaultValue) {
  const [value, setValue] = useState(() => {
    const saved = Number(localStorage.getItem(key));
    return Number.isFinite(saved) && saved >= 0 ? saved : defaultValue;
  });
  useEffect(() => {
    localStorage.setItem(key, String(value));
  }, [key, value]);
  const update = (v) => {
    const n = Number(v);
    setValue(Number.isFinite(n) && n >= 0 ? n : 0);
  };
  return [value, update];
}

// Small dedicated client for the new order-costs endpoint (kept local to
// this file rather than added into ../lib/api since I don't have that
// file's contents to match its conventions — move it there if you'd like
// it alongside fetchLiveAdAccounts/fetchLiveCampaigns).
// Expects the backend to return a flat JSON object with manufacturing /
// shipping / packaging (misc is intentionally ignored — that field stays
// a manual input in the UI, see Dashboard()'s miscCost state).
async function fetchOrderCosts() {
  const res = await fetch("/api/order-costs", { credentials: "include" });
  if (!res.ok) throw new Error(`Failed to load order costs (HTTP ${res.status})`);
  const json = await res.json();
  return json?.costs || json;
}

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
  // Phase 21 — headline stays the untouched Actual Order Revenue (same
  // number ROAS/AOV already used); RevenueCard's dropdown adds the full
  // Revenue Summary (Actual/Prepaid/Additional Prepaid/COD/Abandoned
  // Cart/Total Gross Revenue) plus the manual Additional Prepaid Revenue
  // and Abandoned Cart Orders inputs. See cardValues' revenueBreakdown.
  { key: "revenue", label: "Revenue", icon: Wallet, accent: "emerald", format: currency },
  // Phase 21 §3 — headline stays the GST-inclusive spend figure that
  // already fed Gross Profit; SpendCard's dropdown clearly itemizes
  // Actual Spend / GST @ 18% / Total Spend incl. GST. Original Meta
  // spend is unchanged, still available as spendBreakdown.actualSpend.
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
  // Phase 21 — Revenue side of the formula is now Total Gross Revenue
  // (Actual Order Revenue + Additional Prepaid Revenue + Abandoned Cart
  // Revenue) and Abandoned Cart Expenses are also netted out; Spend is
  // the GST-inclusive figure. Deliberately plain, direct arithmetic on
  // the manual inputs — no HALUCINATE-style projection/simulation.
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
  // Phase 28 §6 — drill-down for the "Other configured expenses" tile in
  // the new Gross Profit breakdown row. Reuses the existing, already-
  // built OperatingExpenseBreakdownPopup (Profitability page) purely
  // synchronously — the rows are already the whole loaded expenseBreakdown
  // list, no extra fetch.
  const [otherExpensesPopupOpen, setOtherExpensesPopupOpen] = useState(false);

  const [expandedCampaign, setExpandedCampaign] = useState(null);
  const [sortConfig, setSortConfig] = useState({ key: "spend", direction: "desc" });

  // ── Profit inputs ─────────────────────────────────────────────
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

  // Manufacturing / shipping / packaging are now read-only, sourced from
  // the DB via GET /api/order-costs (see fetchOrderCosts below and the
  // backend scaffold shared alongside this file — the collection/field
  // names there are placeholders until wired to your actual document).
  // Fetched once on mount since it's a single shared config document,
  // not scoped per token/date-range.
  const [dbCosts, setDbCosts] = useState({ manufacturing: 0, shipping: 0, packaging: 0 });
  const [dbCostsLoading, setDbCostsLoading] = useState(false);
  const [dbCostsError, setDbCostsError] = useState(null);

  const loadDbCosts = () => {
    let cancelled = false;
    setDbCostsLoading(true);
    setDbCostsError(null);
    fetchOrderCosts()
      .then((costs) => {
        if (cancelled) return;
        setDbCosts({
          manufacturing: Number(costs?.manufacturing) || 0,
          shipping: Number(costs?.shipping) || 0,
          packaging: Number(costs?.packaging) || 0,
        });
      })
      .catch((err) => {
        if (!cancelled) setDbCostsError(err?.message || "Failed to load order costs");
      })
      .finally(() => {
        if (!cancelled) setDbCostsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  };
  useEffect(() => loadDbCosts(), []);

  // Misc cost is the one field left as a manual, editable input — same
  // behavior as before, persisted locally.
  const [miscCost, setMiscCost] = useState(() => {
    const saved = Number(localStorage.getItem("dashboardMiscCostPerOrder"));
    return Number.isFinite(saved) && saved >= 0 ? saved : 0;
  });
  useEffect(() => {
    localStorage.setItem("dashboardMiscCostPerOrder", String(miscCost));
  }, [miscCost]);
  const updateMiscCost = (value) => {
    const v = Number(value);
    setMiscCost(Number.isFinite(v) && v >= 0 ? v : 0);
  };

  // ── Phase 22 §6/§8: Abandoned Cart Orders (MongoDB-backed) ──────
  // Supersedes Phase 21 §1's manual, localStorage-only inputs — those
  // are gone. Abandoned cart data now lives in MongoDB (see
  // server/models/AbandonedCart.js) and is created/edited/deleted only
  // on its own management page at /abandoned-carts (AbandonedCartsPage.jsx).
  // Dashboard only ever READS it here, re-fetched whenever the selected
  // date range changes, scoped to that exact range via GET
  // /api/abandoned-carts?since=&until=. The server computes Expected
  // Delivered Orders / Gross Potential Revenue / Recognized Abandoned
  // Cart Revenue / expenses / Net Contribution for each record — using
  // THAT record's own delivery rate (§10, so historical dates can each
  // have a different rate) — and returns them pre-summed as `summary`;
  // this component never recomputes that math itself (see cardValues
  // below, which just reads abandonedCartSummary). Still NEVER merged
  // into allOrders/totalOrders/matchedOrders/unmatchedOrders/prepaid/cod
  // — abandoned carts continue to never count as actual/COD/prepaid/
  // delivered/matched/Shiprocket orders (§8), and none of the
  // Meta↔Shiprocket sync/matching logic is touched.
  const [abandonedCartSummary, setAbandonedCartSummary] = useState(null);
  const [abandonedCartLoading, setAbandonedCartLoading] = useState(false);
  const [abandonedCartError, setAbandonedCartError] = useState(null);
  // Phase 34 — shipment-level rows behind the Delivered Revenue figure,
  // for the drill-down popup. Same fetch as the summary above (no extra
  // request) — just also keeping the part of the response the old code
  // discarded.
  const [abandonedCartDeliveredLeads, setAbandonedCartDeliveredLeads] = useState([]);
  const [abandonedCartDeliveredLeadsTruncated, setAbandonedCartDeliveredLeadsTruncated] = useState(false);

  const loadAbandonedCartSummary = () => {
    if (!since || !until) return () => {};
    let cancelled = false;
    setAbandonedCartLoading(true);
    setAbandonedCartError(null);
    fetchAbandonedCarts({ since, until })
      .then((res) => {
        if (cancelled) return;
        setAbandonedCartSummary(res.summary || null);
        setAbandonedCartDeliveredLeads(res.deliveredLeads || []);
        setAbandonedCartDeliveredLeadsTruncated(!!res.deliveredLeadsTruncated);
      })
      .catch((err) => {
        if (!cancelled) setAbandonedCartError(err?.message || "Failed to load abandoned cart data");
      })
      .finally(() => {
        if (!cancelled) setAbandonedCartLoading(false);
      });
    return () => {
      cancelled = true;
    };
  };
  // Re-fetches every time the selected date range changes (Today ↔
  // Yesterday ↔ Last 7 Days ↔ ... ↔ Custom Range) — §6's "only
  // abandoned-cart records inside that date range should be included".
  useEffect(() => loadAbandonedCartSummary(), [since, until]);

  // ── Phase 28 §2: "Other configured expenses" — the operating-expense
  // side of the Complete Gross Profit Breakdown. Read-only, sourced from
  // MongoDB via GET /api/expenses/breakdown?since=&until= (new, additive
  // route — see server/routes/expenses.js), which reuses the exact same
  // operatingExpenseForRange() allocation math profitability.js's own
  // breakdown already uses. Re-fetched whenever the selected date range
  // changes, same pattern as loadAbandonedCartSummary above. Never
  // touches order sync, campaign matching, or abandoned-cart logic —
  // this only reads the Expense collection that already powers the
  // Expenses management page.
  const [expenseBreakdown, setExpenseBreakdown] = useState(null);
  const [expenseBreakdownLoading, setExpenseBreakdownLoading] = useState(false);
  const [expenseBreakdownError, setExpenseBreakdownError] = useState(null);

  const loadExpenseBreakdown = () => {
    if (!since || !until) return () => {};
    let cancelled = false;
    setExpenseBreakdownLoading(true);
    setExpenseBreakdownError(null);
    fetchExpenseBreakdown({ since, until })
      .then((res) => {
        if (cancelled) return;
        setExpenseBreakdown(res || null);
      })
      .catch((err) => {
        if (!cancelled) setExpenseBreakdownError(err?.message || "Failed to load configured expenses");
      })
      .finally(() => {
        if (!cancelled) setExpenseBreakdownLoading(false);
      });
    return () => {
      cancelled = true;
    };
  };
  useEffect(() => loadExpenseBreakdown(), [since, until]);

  // ── Phase 21 §2: Additional Prepaid Revenue ─────────────────────
  // A manual top-up added on top of the real Prepaid Revenue computed
  // from allOrders. Flows into Revenue/Profit/Profit Margin (cardValues
  // below) but — like Abandoned Cart Orders above — never touches the
  // `prepaid` order count or any order/campaign matching logic.
  const [additionalPrepaidRevenue, setAdditionalPrepaidRevenue] = usePersistedNumber(
    "dashboardAdditionalPrepaidRevenue",
    0
  );

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

  const SPEND_GST_RATE = 0.18;

  const cardValues = useMemo(() => {
    if (!data) return {};
    const totalOrders = data.summary.totalOrders || 0;
    const unmatchedCount = data.unmatchedOrders?.length || 0;
    const matchedOrders = Math.max(totalOrders - unmatchedCount, 0);
    // Actual Order Revenue — sum of real, Shiprocket-matched/unmatched
    // orders only, exactly as before. Untouched by anything in Phase 21.
    const revenue = data.summary.totalRevenue || 0;

    // Phase 21 §3 — 18% GST on Spend. `actualSpend` is the untouched,
    // original Meta spend figure; `spend` (GST-inclusive) is what already
    // fed the profit calculation below before this phase, so profitability
    // math is unchanged — it's just now also exposed as three clearly
    // labeled pieces (see spendBreakdown) instead of a single opaque number.
    const actualSpend = data.summary.totalSpend || 0;
    const spendGst = actualSpend * SPEND_GST_RATE;
    const spend = actualSpend + spendGst; // Spend Including GST
    const roas = data.summary.averageROAS || 0;
    const prepaid = allOrders.filter((o) => o.paymentType === "PREPAID").length;
    const cod = allOrders.filter((o) => o.paymentType === "CASH_ON_DELIVERY").length;

    // Revenue attributable to COD orders, at face value (before the
    // success-rate haircut). The "Revenue" card keeps showing the raw
    // `revenue` total untouched — this discount only feeds into profit.
    const codRevenueActual = allOrders
      .filter((o) => o.paymentType === "CASH_ON_DELIVERY")
      .reduce((sum, o) => sum + Number(o.totalAmountPayable || 0), 0);
    const codRevenueLoss = codRevenueActual * (1 - codSuccessRate / 100);

    // Revenue attributable to real Prepaid orders, at face value — the
    // COD counterpart above. Phase 21 §2's Additional Prepaid Revenue is
    // a separate manual top-up added on top of this, never mixed into it
    // or into the `prepaid` order count above.
    const prepaidRevenueActual = allOrders
      .filter((o) => o.paymentType === "PREPAID")
      .reduce((sum, o) => sum + Number(o.totalAmountPayable || 0), 0);
    const additionalPrepaid = Number(additionalPrepaidRevenue) || 0;
    const totalPrepaidRevenue = prepaidRevenueActual + additionalPrepaid;

    // Phase 22 §6/§10 — Abandoned Cart Orders, sourced from MongoDB via
    // abandonedCartSummary (fetched above, scoped to the selected date
    // range — see the state block above). Every figure here already
    // reflects each underlying record's OWN delivery rate; recognized
    // revenue/expenses are NOT the full orders × avgOrderValue figure
    // (that's abandonedCartPotentialRevenue, kept only for context/
    // display per §7's "Gross Potential Revenue" line — never added
    // into Total Gross Revenue or profit).
    const ac = abandonedCartSummary || {
      orders: 0,
      expectedDelivered: 0,
      potentialRevenue: 0,
      recognizedRevenue: 0,
      totalExpenses: 0,
      netContribution: 0,
      matched: 0,
      unmatched: 0,
      deliveredCount: 0,
      notDeliveredMatched: 0,
      deliveredRevenue: 0,
      cnfLeadsCount: 0,
      cnfRevenueRate: 0,
      cnfRevenueCountedCount: 0,
      cnfPotentialRevenue: 0,
      cnfRevenue: 0,
    };
    const abandonedCartOrderCount = ac.orders || 0;
    const abandonedCartExpectedDelivered = ac.expectedDelivered || 0;
    const abandonedCartPotentialRevenue = ac.potentialRevenue || 0;
    // Phase 37 — recognizedRevenue/netContribution/totalExpenses are now
    // CNF-based (see trafleadSyncService.js's computeAbandonedCartSummary
    // header comment) — read exactly as before, only what the server puts
    // in them changed, so nothing else about this Gross Profit calculation
    // needs to change.
    const abandonedCartRecognizedRevenue = ac.recognizedRevenue || 0;
    const abandonedCartExpenses = ac.totalExpenses || 0;
    const abandonedCartContribution = ac.netContribution || 0;
    // Phase 37 — CNF-based revenue figures, the actual profit driver as of
    // this phase. Never scaled/re-derived client-side — read exactly as
    // the server computed them so this page can never disagree with the
    // Abandoned Carts management page or AbandonedCartSummaryCard.
    const abandonedCartCnfLeadsCount = ac.cnfLeadsCount || 0;
    const abandonedCartCnfRevenueRate = ac.cnfRevenueRate || 0;
    const abandonedCartCnfRevenueCountedCount = ac.cnfRevenueCountedCount || 0;
    const abandonedCartCnfPotentialRevenue = ac.cnfPotentialRevenue || 0;
    // Phase 34/35/36 §1 — shipment verification. INFORMATIONAL ONLY as of
    // Phase 37 — kept exactly as computed before, just no longer feeding
    // revenue/expenses/profit above (ac.recognizedRevenue/netContribution
    // are CNF-based now, not derived from these).
    const abandonedCartMatched = ac.matched || 0;
    const abandonedCartUnmatched = ac.unmatched || 0;
    const abandonedCartDeliveredCount = ac.deliveredCount || 0;
    const abandonedCartNotDeliveredMatched = ac.notDeliveredMatched || 0;
    const abandonedCartShipmentDeliveredRevenue = ac.deliveredRevenue || 0;
    // Delivered rate — what fraction of leads PLACED in this range are,
    // as of now, phone-matched AND delivered. Display-only, shipment-based
    // (unrelated to the CNF revenue rate setting above).
    const abandonedCartDeliveryRate = abandonedCartOrderCount ? (abandonedCartDeliveredCount / abandonedCartOrderCount) * 100 : 0;

    // Total Gross Revenue = Actual Order Revenue + Additional Prepaid
    // Revenue (§2) + Recognized Abandoned Cart Revenue (§1/§10).
    const totalGrossRevenue = revenue + additionalPrepaid + abandonedCartRecognizedRevenue;

    // Flat per-order costs (manufacturing + shipping + packaging come
    // from the DB via dbCosts; misc is the one manually-entered field),
    // applied to every real order in the range — matched, unmatched, and
    // regardless of outcome, since manufacturing/shipping/packaging spend
    // is typically committed as soon as an order ships, not only on
    // orders that end up delivered. Abandoned Cart orders have their own
    // separate per-order costs, configured per record on the
    // /abandoned-carts management page, and are intentionally excluded
    // here (their expenses are already in abandonedCartExpenses above).
    const perOrderCostTotal =
      (Number(dbCosts.manufacturing) || 0) +
      (Number(dbCosts.shipping) || 0) +
      (Number(dbCosts.packaging) || 0) +
      (Number(miscCost) || 0);
    const totalPerOrderCosts = perOrderCostTotal * totalOrders;

    // Phase 28 §2 — "Other configured expenses" (rent, salaries, tooling,
    // any time-based Expense configured on the Expenses page), allocated
    // to this exact date range via GET /api/expenses/breakdown (see the
    // loadExpenseBreakdown effect above). Previously configured Expenses
    // were tracked on the Profitability page only and never reduced this
    // Dashboard's Gross Profit figure — folding them in here (and into
    // `profit` below) closes that gap so the Gross Profit breakdown row
    // (§2/§3 of Phase 28) and this headline card can never show two
    // different "Gross Profit" numbers for the same range.
    const otherExpenseRows = expenseBreakdown?.expenses || [];
    const otherExpensesTotal = Number(expenseBreakdown?.total) || 0;

    // Phase 32 §3 — group configured expenses by their own `category`
    // (never hardcoded — categories are whatever the user typed on the
    // Expenses page, see server/models/Expense.js's header comment: "do
    // not hard-code only these categories") so real categories like
    // "Employee Salary" or "Fixed Expenses" render as their own line in
    // the Dashboard's cost breakdown instead of being hidden inside one
    // aggregate "Other Configured Expenses" number. Pure client-side
    // regrouping of the exact same otherExpenseRows/otherExpensesTotal
    // above — sums must always add back up to otherExpensesTotal; this
    // never recomputes or changes a single expense's allocated amount.
    const otherExpensesByCategory = (() => {
      const map = new Map();
      otherExpenseRows.forEach((row) => {
        const key = row.category || "Uncategorized";
        const cur = map.get(key) || { category: key, amount: 0, count: 0 };
        cur.amount += Number(row.amount) || 0;
        cur.count += 1;
        map.set(key, cur);
      });
      return [...map.values()].sort((a, b) => b.amount - a.amount);
    })();

    // Normal-order Recognized Revenue, exactly rollupOrders()'s formula in
    // server/routes/profitability.js (Prepaid + COD × success rate) —
    // kept as its own named figure (not just an intermediate step) so the
    // new full-width Gross Profit breakdown row (Phase 28) can show it
    // directly instead of re-deriving it from `profit`/`codRevenueLoss`.
    // Phase 32 §3 — codRecognizedRevenue is the COD half of this sum,
    // broken out on its own (same number, just no longer hidden inside
    // the combined total) so the breakdown can show "COD Recognized
    // Revenue" as its own line per the spec's Revenue section.
    const codRecognizedRevenue = codRevenueActual * (codSuccessRate / 100);
    const normalRecognizedRevenue = prepaidRevenueActual + additionalPrepaid + codRecognizedRevenue;

    // Gross Profit now nets out of Total Gross Revenue (real + additional
    // prepaid + abandoned cart), the COD-risk discount, GST-inclusive ad
    // spend, real per-order costs, Abandoned Cart Expenses, and (Phase 28)
    // every other configured operating expense allocated to this range.
    const profit = totalGrossRevenue - codRevenueLoss - spend - totalPerOrderCosts - abandonedCartExpenses - otherExpensesTotal;
    const profitMargin = totalGrossRevenue ? (profit / totalGrossRevenue) * 100 : 0;

    // Phase 28 §1/§2/§3 — Complete Gross Profit Breakdown. Every figure
    // below is one already computed above, just organized into the exact
    // Normal Orders / Abandoned Cart / Expenses / Totals shape the new
    // full-width breakdown row renders — nothing here recomputes anything
    // differently from the `profit`/`profitBreakdown` figures the small
    // Gross Profit KPI card already shows, so the two sections of the
    // Dashboard can never disagree.
    const totalRecognizedRevenue = normalRecognizedRevenue + abandonedCartRecognizedRevenue;
    const totalExpensesFull =
      totalPerOrderCosts + spend + abandonedCartExpenses + otherExpensesTotal;
    const grossProfitFull = totalRecognizedRevenue - totalExpensesFull;

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
        totalGrossRevenue,
        codRevenueLoss,
        spend,
        actualSpend,
        spendGst,
        perOrderCostTotal,
        totalPerOrderCosts,
        totalOrders,
        additionalPrepaidRevenue: additionalPrepaid,
        abandonedCartRecognizedRevenue,
        abandonedCartExpenses,
        otherExpensesTotal,
        profitMargin,
      },
      // Phase 28 — Complete Gross Profit Breakdown row. See GrossProfitSection.
      grossProfitBreakdown: {
        normalOrders: {
          orderCount: totalOrders,
          prepaidRevenue: prepaidRevenueActual,
          additionalPrepaidRevenue: additionalPrepaid,
          totalPrepaidRevenue,
          codRevenue: codRevenueActual,
          codSuccessRate,
          // Phase 32 §3 — COD Recognized Revenue as its own figure (see
          // codRecognizedRevenue above).
          codRecognizedRevenue,
          recognizedRevenue: normalRecognizedRevenue,
        },
        abandonedCart: {
          orders: abandonedCartOrderCount,
          expectedDelivered: abandonedCartExpectedDelivered,
          deliveryRate: abandonedCartDeliveryRate,
          potentialRevenue: abandonedCartPotentialRevenue,
          recognizedRevenue: abandonedCartRecognizedRevenue,
          expenses: abandonedCartExpenses,
          // Phase 35 — shipment verification, informational only as of
          // Phase 37 (no longer the revenue/expense/profit driver below).
          matched: abandonedCartMatched,
          unmatched: abandonedCartUnmatched,
          deliveredCount: abandonedCartDeliveredCount,
          notDeliveredMatched: abandonedCartNotDeliveredMatched,
          shipmentDeliveredRevenue: abandonedCartShipmentDeliveredRevenue,
          // Phase 37 — CNF-based revenue (see cardValues above / spec).
          // `recognizedRevenue`/`profit` above ARE these numbers now —
          // these extra fields expose the chain (leads → rate → counted →
          // revenue) so the UI can show it explicitly rather than folding
          // it into one opaque total.
          cnfLeadsCount: abandonedCartCnfLeadsCount,
          cnfRevenueRate: abandonedCartCnfRevenueRate,
          cnfRevenueCountedCount: abandonedCartCnfRevenueCountedCount,
          cnfPotentialRevenue: abandonedCartCnfPotentialRevenue,
          cnfRevenue: abandonedCartRecognizedRevenue,
          profit: abandonedCartContribution,
        },
        totalRecognizedRevenue,
        expenses: {
          productCost: (Number(dbCosts.manufacturing) || 0) * totalOrders,
          packagingCost: (Number(dbCosts.packaging) || 0) * totalOrders,
          shippingCost: (Number(dbCosts.shipping) || 0) * totalOrders,
          miscCost: (Number(miscCost) || 0) * totalOrders,
          totalPerOrderCosts,
          metaAdSpend: actualSpend,
          gstOnAdSpend: spendGst,
          abandonedCartExpenses,
          otherExpenseRows,
          otherExpensesTotal,
          // Phase 32 §3 — same rows/total as above, regrouped by category
          // (see otherExpensesByCategory above).
          otherExpensesByCategory,
          totalExpenses: totalExpensesFull,
        },
        grossProfit: grossProfitFull,
        profitMargin: totalRecognizedRevenue ? (grossProfitFull / totalRecognizedRevenue) * 100 : 0,
      },
      revenueBreakdown: {
        actualRevenue: revenue,
        prepaidRevenueActual,
        additionalPrepaidRevenue: additionalPrepaid,
        totalPrepaidRevenue,
        codRevenueActual,
        abandonedCartOrders: abandonedCartOrderCount,
        abandonedCartDeliveryRate,
        abandonedCartExpectedDelivered,
        abandonedCartPotentialRevenue,
        abandonedCartRecognizedRevenue,
        abandonedCartExpenses,
        abandonedCartContribution,
        // Phase 35 — shipment verification, informational only as of
        // Phase 37.
        abandonedCartMatched,
        abandonedCartUnmatched,
        abandonedCartDeliveredCount,
        abandonedCartNotDeliveredMatched,
        abandonedCartShipmentDeliveredRevenue,
        // Phase 37 — CNF-based revenue chain (see cardValues above).
        abandonedCartCnfLeadsCount,
        abandonedCartCnfRevenueRate,
        abandonedCartCnfRevenueCountedCount,
        abandonedCartCnfPotentialRevenue,
        totalGrossRevenue,
      },
      spendBreakdown: {
        actualSpend,
        spendGst,
        spendInclGst: spend,
      },
      aov: totalOrders ? revenue / totalOrders : 0,
      prepaid,
      cod,
      activeCampaigns: data.summary.totalCampaigns || 0,
    };
  }, [
    data,
    allOrders,
    codSuccessRate,
    dbCosts,
    miscCost,
    additionalPrepaidRevenue,
    abandonedCartSummary,
    expenseBreakdown,
  ]);

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
                      dbCosts={dbCosts}
                      dbCostsLoading={dbCostsLoading}
                      dbCostsError={dbCostsError}
                      onRetryDbCosts={loadDbCosts}
                      miscCost={miscCost}
                      onMiscChange={updateMiscCost}
                      breakdown={cardValues.profitBreakdown}
                      onClick={onClick}
                    />
                  );
                }
                if (cardKey === "revenue") {
                  return (
                    <RevenueCard
                      key={cardKey}
                      {...c}
                      pinned={pinned}
                      wide={wide}
                      since={since}
                      until={until}
                      breakdown={cardValues.revenueBreakdown}
                      additionalPrepaidRevenue={additionalPrepaidRevenue}
                      onAdditionalPrepaidRevenueChange={setAdditionalPrepaidRevenue}
                      abandonedCartLoading={abandonedCartLoading}
                      abandonedCartError={abandonedCartError}
                      onRetryAbandonedCart={loadAbandonedCartSummary}
                      abandonedCartDeliveredLeads={abandonedCartDeliveredLeads}
                      abandonedCartDeliveredLeadsTruncated={abandonedCartDeliveredLeadsTruncated}
                      onClick={onClick}
                    />
                  );
                }
                if (cardKey === "spend") {
                  return <SpendCard key={cardKey} {...c} pinned={pinned} wide={wide} breakdown={cardValues.spendBreakdown} onClick={onClick} />;
                }
                return <KpiCard key={cardKey} {...c} pinned={pinned} wide={wide} onClick={onClick} />;
              })}
              {visibleCardList.length === 0 && (
                <div className="col-span-full text-center py-8 text-sm text-slate-400 border border-dashed border-slate-200 rounded-xl">
                  All KPI cards are hidden. Click Customize to bring some back.
                </div>
              )}
            </div>

            {/* Phase 28 — Complete Gross Profit Breakdown, full width. */}
            <GrossProfitSection
              since={since}
              until={until}
              breakdown={cardValues.grossProfitBreakdown}
              abandonedCartLoading={abandonedCartLoading}
              abandonedCartError={abandonedCartError}
              onRetryAbandonedCart={loadAbandonedCartSummary}
              abandonedCartDeliveredLeads={abandonedCartDeliveredLeads}
              abandonedCartDeliveredLeadsTruncated={abandonedCartDeliveredLeadsTruncated}
              expenseBreakdownLoading={expenseBreakdownLoading}
              expenseBreakdownError={expenseBreakdownError}
              onRetryExpenseBreakdown={loadExpenseBreakdown}
              onDrill={(key) => data && setActivePopupCard({ key })}
              onOpenOtherExpenses={() => setOtherExpensesPopupOpen(true)}
            />

            {/* Phase 37 — a standalone Abandoned Cart box, additive to the
                bespoke Abandoned Cart figures already inside the Revenue
                card's dropdown and the Complete Cost Breakdown section
                above. Those two stay exactly as they are (same data, same
                math) — this is just the same self-contained summary card
                already used on Daily/Analytics/Profitability/Campaign
                Explorer, now also on the Dashboard, for an at-a-glance view
                (Total/Delivered/Non-Delivered Orders, Confirmed Revenue,
                Shipment Matched, Awaiting Verification, Profit, and its own
                collapsed-by-default cost breakdown) without needing to open
                either of the sections above. It fetches independently
                (GET /api/abandoned-carts?since=&until=) — no new state or
                calculation added to this page. */}
            <AbandonedCartSummaryCard since={since} until={until} className="mb-8" />
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
                                    <BudgetCell budget={campaign.budget} budgetType={campaign.budgetType} budgetSource={campaign.budgetSource} />
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

      {/* Phase 28 §6 — "Other configured expenses" drill-down, reusing the
          already-built Profitability-page popup purely synchronously off
          the same rows already loaded into cardValues.grossProfitBreakdown. */}
      <OperatingExpenseBreakdownPopup
        open={otherExpensesPopupOpen}
        breakdown={cardValues.grossProfitBreakdown?.expenses?.otherExpenseRows}
        since={since}
        until={until}
        onClose={() => setOtherExpensesPopupOpen(false)}
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
            className="w-14 text-xs border border-slate-200 rounded-md px-1.5 py-0.5 text-slate-700 text-left focus:outline-none focus:ring-1 focus:ring-indigo-400"
          />
          <span className="text-[11px] text-slate-400">%</span>
        </div>
      </div>
    </div>
  );
}

// Gross Profit card — the dropdown now shows manufacturing / shipping /
// packaging as read-only values pulled from the DB (fetchOrderCosts),
// with a loading/error state and a retry link. Misc stays the one
// editable input, same as before.
function ProfitCard({
  label,
  icon: Icon,
  accent,
  display,
  pinned,
  wide,
  dbCosts,
  dbCostsLoading,
  dbCostsError,
  onRetryDbCosts,
  miscCost,
  onMiscChange,
  breakdown,
  onClick,
}) {
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
          title="View per-order costs"
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
          {dbCostsLoading ? (
            <div className="text-[11px] text-slate-400">Loading costs…</div>
          ) : dbCostsError ? (
            <div className="text-[11px] text-rose-500 flex items-center justify-between gap-2">
              <span className="truncate">Couldn't load costs</span>
              <button type="button" className="underline shrink-0" onClick={onRetryDbCosts}>
                Retry
              </button>
            </div>
          ) : (
            <>
              <CostRow label="Manufacturing / order" value={dbCosts.manufacturing} />
              <CostRow label="Shipping / order" value={dbCosts.shipping} />
              <CostRow label="Packaging / order" value={dbCosts.packaging} />
            </>
          )}

          <CostInput label="Misc / order" value={miscCost} onChange={onMiscChange} />

          {breakdown && (
            <div className="text-[11px] text-slate-400 pt-1.5 mt-0.5 border-t border-slate-100 leading-relaxed space-y-1">
              <div>
                Total Gross Revenue {currency(breakdown.totalGrossRevenue)} (Actual {currency(breakdown.revenue)} + Additional
                Prepaid {currency(breakdown.additionalPrepaidRevenue)} + Recognized Abandoned Cart{" "}
                {currency(breakdown.abandonedCartRecognizedRevenue)}) − COD loss {currency(breakdown.codRevenueLoss)} − Spend incl.
                GST {currency(breakdown.spend)} − Order Costs {currency(breakdown.totalPerOrderCosts)} ({breakdown.totalOrders} orders
                × {currency(breakdown.perOrderCostTotal)}) − Abandoned Cart Expenses {currency(breakdown.abandonedCartExpenses)}
              </div>
              <div className="font-medium text-slate-500">Profit Margin {Number(breakdown.profitMargin || 0).toFixed(2)}%</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Read-only cost row (manufacturing/shipping/packaging — sourced from the DB).
function CostRow({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <label className="text-[11px] text-slate-400">{label}</label>
      <span className="text-xs text-slate-600 font-medium">{currency(value)}</span>
    </div>
  );
}

// Editable cost row (misc — the one field left as manual input).
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
          className="w-16 text-xs border border-slate-200 rounded-md px-1.5 py-0.5 text-slate-700 text-left focus:outline-none focus:ring-1 focus:ring-indigo-400"
        />
      </div>
    </div>
  );
}

// Read-only breakdown row shared by RevenueCard/SpendCard — a label plus
// a formatted value (currency by default; pass `format` for a count or
// percentage — see the Abandoned Cart Orders rows below), optionally
// emphasized for rollup totals.
function BreakdownRow({ label, value, strong, format = currency, onClick }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <label className={`text-[11px] ${strong ? "text-slate-600 font-medium" : "text-slate-400"}`}>{label}</label>
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          className={`text-xs font-medium hover:underline ${strong ? "text-slate-800" : "text-slate-600"}`}
        >
          {format(value)}
        </button>
      ) : (
        <span className={`text-xs font-medium ${strong ? "text-slate-800" : "text-slate-600"}`}>{format(value)}</span>
      )}
    </div>
  );
}

// Editable currency input row — RevenueCard's Additional Prepaid Revenue
// field (Phase 21 §2, still a local per-browser setting). Same visual
// language as the Gross Profit card's CostInput above.
function EditableRow({ label, value, onChange, prefix = "₹", step = "0.01" }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <label className="text-[11px] text-slate-400">{label}</label>
      <div className="flex items-center gap-1">
        {prefix && <span className="text-[11px] text-slate-400">{prefix}</span>}
        <input
          type="number"
          min={0}
          step={step}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-20 text-xs border border-slate-200 rounded-md px-1.5 py-0.5 text-slate-700 text-left focus:outline-none focus:ring-1 focus:ring-indigo-400"
        />
      </div>
    </div>
  );
}

// Revenue card — Phase 21 §2/§4 + Phase 22 §6/§7/§8. Headline stays the
// untouched Actual Order Revenue (same number that already fed ROAS/AOV
// elsewhere on this page); the dropdown adds the full Revenue Summary
// breakdown, the manual Additional Prepaid Revenue input (Phase 21 §2 —
// still a local, per-browser setting, unchanged), and a READ-ONLY
// Abandoned Cart Orders summary sourced from MongoDB (Phase 22 —
// abandonedCartSummary in Dashboard() above, filtered to the selected
// date range). Abandoned cart records themselves are only ever
// created/edited/deleted on their own management page, /abandoned-carts
// (AbandonedCartsPage.jsx) — linked at the bottom of this dropdown —
// never here, and never counted as actual/COD/prepaid/delivered/matched
// orders (§8). All math lives in cardValues above; this component only
// displays it.
function RevenueCard({
  label,
  icon: Icon,
  accent,
  display,
  pinned,
  wide,
  since,
  until,
  breakdown,
  additionalPrepaidRevenue,
  onAdditionalPrepaidRevenueChange,
  abandonedCartLoading,
  abandonedCartError,
  onRetryAbandonedCart,
  abandonedCartDeliveredLeads,
  abandonedCartDeliveredLeadsTruncated,
  onClick,
}) {
  const [open, setOpen] = useState(false);
  const [drilldownOpen, setDrilldownOpen] = useState(false);

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
          title="View revenue summary"
        >
          <ChevronDown size={15} className={`transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </div>

      <button type="button" onClick={onClick} className="min-w-0 text-left" title="View detailed analytics">
        <div className="text-[13px] text-slate-500 mb-0.5 leading-tight truncate">{label}</div>
        <div className="text-xl font-display font-bold text-slate-800 truncate">{display ?? "—"}</div>
        {breakdown && (
          <div className="text-[11px] text-slate-400 mt-0.5 truncate">
            Total Gross Revenue {currency(breakdown.totalGrossRevenue)}
          </div>
        )}
      </button>

      {open && breakdown && (
        <div className="pt-2.5 mt-0.5 border-t border-slate-100 space-y-2" onClick={(e) => e.stopPropagation()}>
          <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Revenue Summary</div>
          <BreakdownRow label="Actual Revenue" value={breakdown.actualRevenue} />
          <BreakdownRow label="Prepaid Revenue" value={breakdown.prepaidRevenueActual} />
          <EditableRow
            label="Additional Prepaid Revenue"
            value={additionalPrepaidRevenue}
            onChange={onAdditionalPrepaidRevenueChange}
          />
          <BreakdownRow label="Total Prepaid Revenue" value={breakdown.totalPrepaidRevenue} strong />
          <BreakdownRow label="COD Revenue" value={breakdown.codRevenueActual} />
          <BreakdownRow
            label="Confirmed Abandoned Cart Revenue (CNF-based)"
            value={breakdown.abandonedCartRecognizedRevenue}
          />
          <BreakdownRow label="Total Gross Revenue" value={breakdown.totalGrossRevenue} strong />

          <div className="flex items-center justify-between gap-2 pt-2 mt-1 border-t border-slate-100">
            <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Abandoned Cart</div>
            {abandonedCartLoading && <Loader2 size={11} className="animate-spin text-slate-300 shrink-0" />}
          </div>
          {abandonedCartError ? (
            <div className="text-[11px] text-rose-500 flex items-center justify-between gap-2">
              <span className="truncate">Couldn't load abandoned cart data</span>
              <button type="button" className="underline shrink-0" onClick={onRetryAbandonedCart}>
                Retry
              </button>
            </div>
          ) : (
            <>
              {/* Phase 37 — CNF-based revenue, the actual revenue/profit
                  driver now. "Do not hide this calculation inside the
                  Gross Profit number" — every step is its own row. */}
              <BreakdownRow label="Abandoned Cart Leads (synced from Traflead)" value={breakdown.abandonedCartOrders} format={number} />
              <BreakdownRow label="CNF / Confirmed Leads" value={breakdown.abandonedCartCnfLeadsCount} format={number} />
              <BreakdownRow label="CNF Revenue Rate" value={breakdown.abandonedCartCnfRevenueRate} format={(v) => `${number(v)}%`} />
              <BreakdownRow label="Revenue Counted (CNF × Rate)" value={breakdown.abandonedCartCnfRevenueCountedCount} format={number} />
              <BreakdownRow label="Gross Potential Revenue" value={breakdown.abandonedCartPotentialRevenue} />
              <BreakdownRow label="Confirmed Revenue" value={breakdown.abandonedCartRecognizedRevenue} strong />
              <BreakdownRow label="Abandoned Cart Expenses" value={breakdown.abandonedCartExpenses} />
              <BreakdownRow label="Abandoned Cart Profit" value={breakdown.abandonedCartContribution} strong />
              <div className="text-[10px] text-slate-400 italic">
                Revenue calculated from CNF leads × selected CNF revenue rate.
              </div>

              {/* Phase 34/35/36 §1 — shipment verification. Informational
                  only as of Phase 37, kept exactly as before, no longer
                  the revenue driver above. */}
              <div className="flex items-center justify-between gap-2 pt-2 mt-1 border-t border-slate-100">
                <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">
                  Shipment verification (informational)
                </div>
              </div>
              <BreakdownRow label="Shipment Matched (by phone)" value={breakdown.abandonedCartMatched} format={number} />
              <BreakdownRow label="Delivered" value={breakdown.abandonedCartDeliveredCount} format={number} />
              <BreakdownRow label="Not Delivered (matched, not yet)" value={breakdown.abandonedCartNotDeliveredMatched} format={number} />
              <BreakdownRow label="No Shipment Matched" value={breakdown.abandonedCartUnmatched} format={number} />
              <BreakdownRow
                label="Delivered Revenue (shipment-based, info only)"
                value={breakdown.abandonedCartShipmentDeliveredRevenue}
                onClick={() => setDrilldownOpen(true)}
              />
            </>
          )}

          <DeliveredRevenuePopup
            open={drilldownOpen}
            since={since}
            until={until}
            leads={abandonedCartDeliveredLeads || []}
            truncated={abandonedCartDeliveredLeadsTruncated}
            onClose={() => setDrilldownOpen(false)}
          />

          <Link
            to="/abandoned-carts"
            className="flex items-center gap-1 text-[11px] font-medium text-indigo-600 hover:text-indigo-700 pt-1.5 mt-1 border-t border-slate-100"
          >
            Manage Abandoned Carts <ExternalLink size={11} />
          </Link>
        </div>
      )}
    </div>
  );
}

// Spend card — Phase 21 §3. Headline stays the GST-inclusive spend figure
// that already fed Gross Profit before this phase (Keep the original Meta
// spend unchanged — it's still available, untouched, as `actualSpend`
// inside the breakdown). The dropdown clearly itemizes all three values.
function SpendCard({ label, icon: Icon, accent, display, pinned, wide, breakdown, onClick }) {
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
          title="View spend breakdown"
        >
          <ChevronDown size={15} className={`transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </div>

      <button type="button" onClick={onClick} className="min-w-0 text-left" title="View detailed analytics">
        <div className="text-[13px] text-slate-500 mb-0.5 leading-tight truncate">{label}</div>
        <div className="text-xl font-display font-bold text-slate-800 truncate">{display ?? "—"}</div>
        {breakdown && <div className="text-[11px] text-slate-400 mt-0.5 truncate">incl. 18% GST</div>}
      </button>

      {open && breakdown && (
        <div className="pt-2.5 mt-0.5 border-t border-slate-100 space-y-2" onClick={(e) => e.stopPropagation()}>
          <BreakdownRow label="Actual Spend" value={breakdown.actualSpend} />
          <BreakdownRow label="GST @ 18%" value={breakdown.spendGst} />
          <BreakdownRow label="Total Spend incl. GST" value={breakdown.spendInclGst} strong />
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Phase 28 — Complete Gross Profit Breakdown, full-width row.
//
// Purely a presentation layer over cardValues.grossProfitBreakdown (built
// in Dashboard() above from the exact same figures that already feed the
// small Gross Profit KPI card) — nothing here computes revenue/expenses
// differently, and nothing here touches order sync, campaign matching,
// or abandoned-cart database logic. Every clickable value opens either
// an existing KpiAnalyticsPopup mode (Total Orders / Prepaid / COD /
// Revenue by Campaign / Spend by Campaign — all already built, all
// reading the same underlying data), the Abandoned Carts management page
// pre-filtered to this exact date range (§6), or the existing
// OperatingExpenseBreakdownPopup for "Other configured expenses" — no new
// popup UI was invented where an existing one already fit.
// ────────────────────────────────────────────────────────────────

function StatRow({ label, value, format = currency, onClick, strong, muted }) {
  const content = (
    <>
      <span className={`text-[12px] ${muted ? "text-slate-400" : strong ? "text-slate-700 font-medium" : "text-slate-500"}`}>{label}</span>
      <span className={`text-[13px] ${strong ? "font-semibold text-slate-800" : "font-medium text-slate-700"}`}>{format(value)}</span>
    </>
  );
  if (!onClick) {
    return <div className="flex items-center justify-between gap-2 py-1">{content}</div>;
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center justify-between gap-2 py-1 w-full text-left rounded-md -mx-1.5 px-1.5 hover:bg-slate-50 transition-colors"
      title="Click to drill down"
    >
      {content}
    </button>
  );
}

function FormulaOperator({ icon: Icon }) {
  return (
    <div className="flex items-center justify-center shrink-0 text-slate-300 lg:px-1">
      <Icon size={16} />
    </div>
  );
}

function FormulaTile({ label, value, accent = "slate", sub }) {
  const toneMap = {
    emerald: "border-emerald-200 bg-emerald-50/60 text-emerald-700",
    rose: "border-rose-200 bg-rose-50/60 text-rose-700",
    slate: "border-slate-200 bg-slate-50 text-slate-700",
    indigo: "border-indigo-200 bg-indigo-50/60 text-indigo-700",
  };
  return (
    <div className={`flex-1 min-w-[140px] rounded-xl border px-4 py-3 ${toneMap[accent]}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wide opacity-70 mb-0.5">{label}</div>
      <div className="text-lg font-display font-bold truncate">{currency(value)}</div>
      {sub && <div className="text-[11px] opacity-70 mt-0.5">{sub}</div>}
    </div>
  );
}

function GrossProfitSection({
  since,
  until,
  breakdown,
  abandonedCartLoading,
  abandonedCartError,
  onRetryAbandonedCart,
  abandonedCartDeliveredLeads,
  abandonedCartDeliveredLeadsTruncated,
  expenseBreakdownLoading,
  expenseBreakdownError,
  onRetryExpenseBreakdown,
  onDrill,
  onOpenOtherExpenses,
}) {
  const [abandonedCartDrilldownOpen, setAbandonedCartDrilldownOpen] = useState(false);
  // Phase 36 §5 — collapsed by default so this full breakdown doesn't
  // overload the Dashboard on load; purely local UI state, toggling it
  // never refetches or recomputes anything — `breakdown` (and everything
  // derived from it below) is already fully computed and passed in
  // regardless of whether this section is shown expanded or collapsed.
  const [expanded, setExpanded] = useState(false);
  if (!breakdown) return null;
  const { normalOrders, abandonedCart, expenses } = breakdown;
  const rangeLabel = since === until ? since : `${since} → ${until}`;
  const isProfit = breakdown.grossProfit >= 0;

  return (
    <section className="card !p-0 overflow-hidden mb-8">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center justify-between px-5 py-4 border-b border-slate-100 gap-3 flex-wrap text-left hover:bg-slate-50/60 transition-colors"
        title={expanded ? "Collapse breakdown" : "Click to expand the complete breakdown"}
      >
        <div>
          <h2 className="font-display font-semibold text-slate-800 text-sm flex items-center gap-1.5">
            <PiggyBank size={15} className="text-emerald-600" /> Complete Cost Breakdown
          </h2>
          <p className="text-[11px] text-slate-400 mt-0.5">
            {expanded
              ? `Every rupee of revenue and expense behind Pure Profit — same total as the Gross Profit card above, fully itemized — for ${rangeLabel}. Click any value to drill in.`
              : `Click to see every rupee of revenue and expense behind this figure, for ${rangeLabel}.`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Phase 32 §3 — relabeled "Pure Profit" here (spec's own term for
              a revenue figure with every real expense already netted out —
              product costs, marketing costs incl. GST, and every other
              configured expense below). Identical number to the "Gross
              Profit" KPI card above; nothing about how it's computed
              changed, only how it's presented in this full breakdown. This
              box IS the compact summary Phase 36 §5 asks for — always
              visible whether the detailed breakdown below is expanded or
              not. */}
          <div className={`text-right rounded-xl border px-4 py-2 ${isProfit ? "border-emerald-200 bg-emerald-50" : "border-rose-200 bg-rose-50"}`}>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Pure Profit</div>
            <div className={`text-xl font-display font-bold ${isProfit ? "text-emerald-700" : "text-rose-700"}`}>{currency(breakdown.grossProfit)}</div>
            <div className="text-[10px] text-slate-400">{Number(breakdown.profitMargin || 0).toFixed(2)}% margin</div>
          </div>
          <ChevronDown size={16} className={`text-slate-400 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`} />
        </div>
      </button>

      {expanded && (
        <>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 divide-y lg:divide-y-0 lg:divide-x divide-slate-100 border-b border-slate-100">
        {/* Normal Orders */}
        <div className="p-5">
          <div className="flex items-center gap-1.5 mb-2.5">
            <Package size={13} className="text-indigo-500" />
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Normal Orders</h3>
          </div>
          <div className="divide-y divide-slate-50">
            <StatRow label="Order Count" value={normalOrders.orderCount} format={number} onClick={() => onDrill("totalOrders")} />
            <StatRow label="Prepaid Revenue" value={normalOrders.prepaidRevenue} onClick={() => onDrill("prepaid")} />
            {normalOrders.additionalPrepaidRevenue > 0 && (
              <StatRow label="+ Additional Prepaid Revenue (manual)" value={normalOrders.additionalPrepaidRevenue} muted />
            )}
            {/* Phase 32 §3 — COD Revenue (raw, before the delivery-success
                haircut) and COD Recognized Revenue (after it) shown as two
                distinct lines, rather than only the combined
                Prepaid+COD total below — same underlying numbers, just no
                longer hidden inside one figure. */}
            <StatRow label="COD Revenue (before delivery-success adjustment)" value={normalOrders.codRevenue} onClick={() => onDrill("cod")} muted />
            <StatRow
              label={`COD Recognized Revenue (@ ${Number(normalOrders.codSuccessRate || 0).toFixed(0)}% success rate)`}
              value={normalOrders.codRecognizedRevenue}
              onClick={() => onDrill("cod")}
            />
            <StatRow
              label="Recognized Revenue (Normal Orders)"
              value={normalOrders.recognizedRevenue}
              onClick={() => onDrill("revenue")}
              strong
            />
          </div>
        </div>

        {/* Abandoned Cart */}
        <div className="p-5">
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-1.5">
              <ShoppingBag size={13} className="text-amber-500" />
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Abandoned Cart</h3>
            </div>
            {abandonedCartLoading && <Loader2 size={11} className="animate-spin text-slate-300" />}
          </div>
          {abandonedCartError ? (
            <div className="text-[11px] text-rose-500 flex items-center justify-between gap-2">
              <span className="truncate">Couldn't load abandoned cart data</span>
              <button type="button" className="underline shrink-0" onClick={onRetryAbandonedCart}>
                Retry
              </button>
            </div>
          ) : (
            <div className="divide-y divide-slate-50">
              <Link to={`/abandoned-carts?since=${since}&until=${until}`} className="flex items-center justify-between gap-2 py-1 -mx-1.5 px-1.5 rounded-md hover:bg-slate-50 transition-colors">
                <span className="text-[12px] text-slate-500">Abandoned Cart Leads (Traflead)</span>
                <span className="text-[13px] font-medium text-slate-700 flex items-center gap-1">
                  {number(abandonedCart.orders)} <ExternalLink size={10} className="text-slate-300" />
                </span>
              </Link>
              {/* Phase 37 — CNF-based revenue, the actual revenue/profit
                  driver. Shown as its own explicit chain per spec §5
                  ("do not hide this calculation inside the Gross Profit
                  number"). */}
              <StatRow label="CNF / Confirmed Leads" value={abandonedCart.cnfLeadsCount} format={number} />
              <StatRow label="CNF Revenue Rate" value={abandonedCart.cnfRevenueRate} format={(v) => `${number(v)}%`} />
              <StatRow label="Revenue Counted (CNF × Rate)" value={abandonedCart.cnfRevenueCountedCount} format={number} />
              <Link to={`/abandoned-carts?since=${since}&until=${until}`} className="flex items-center justify-between gap-2 py-1 -mx-1.5 px-1.5 rounded-md hover:bg-slate-50 transition-colors">
                <span className="text-[12px] text-slate-500">Potential Revenue</span>
                <span className="text-[13px] font-medium text-slate-700">{currency(abandonedCart.potentialRevenue)}</span>
              </Link>
              <StatRow label="Confirmed Revenue" value={abandonedCart.cnfRevenue} strong />
              <StatRow label="Abandoned Cart Expenses" value={abandonedCart.expenses} muted />
              <StatRow label="Abandoned Cart Profit" value={abandonedCart.profit} strong />
              <div className="text-[10px] text-slate-400 italic pt-1">
                Revenue calculated from CNF leads × selected CNF revenue rate.
              </div>

              {/* Phase 34/35/36 §1 — shipment verification. Informational
                  only as of Phase 37 — kept, no longer the revenue driver
                  above. */}
              <div className="pt-2 mt-1 border-t border-slate-100">
                <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide pb-1">
                  Shipment verification (informational)
                </div>
              </div>
              <StatRow label="Shipment Matched (by phone)" value={abandonedCart.matched} format={number} muted />
              <StatRow label="Delivered" value={abandonedCart.deliveredCount} format={number} muted />
              <StatRow label="Not Delivered (matched, not yet)" value={abandonedCart.notDeliveredMatched} format={number} muted />
              <StatRow label="No Shipment Matched" value={abandonedCart.unmatched} format={number} muted />
              <StatRow
                label="Delivered Revenue (shipment-based, info only)"
                value={abandonedCart.shipmentDeliveredRevenue}
                onClick={() => setAbandonedCartDrilldownOpen(true)}
                muted
              />
            </div>
          )}

          <DeliveredRevenuePopup
            open={abandonedCartDrilldownOpen}
            since={since}
            until={until}
            leads={abandonedCartDeliveredLeads || []}
            truncated={abandonedCartDeliveredLeadsTruncated}
            onClose={() => setAbandonedCartDrilldownOpen(false)}
          />
        </div>
      </div>

      {/* Total Recognized Revenue */}
      <div className="px-5 py-3 bg-emerald-50/40 border-b border-slate-100 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">Total Recognized Revenue</span>
        <span className="text-base font-display font-bold text-emerald-700">{currency(breakdown.totalRecognizedRevenue)}</span>
      </div>

      {/* Complete Expense Breakdown */}
      <div className="p-5 border-b border-slate-100">
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-1.5">
            <Receipt size={13} className="text-rose-500" />
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Complete Expense Breakdown</h3>
          </div>
          {expenseBreakdownLoading && <Loader2 size={11} className="animate-spin text-slate-300" />}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Product Costs</div>
            <div className="divide-y divide-slate-50">
              <StatRow label="Manufacturing / Product Cost" value={expenses.productCost} onClick={() => onDrill("totalOrders")} />
              <StatRow label="Packaging Cost" value={expenses.packagingCost} onClick={() => onDrill("totalOrders")} />
              <StatRow label="Shipping Cost" value={expenses.shippingCost} onClick={() => onDrill("totalOrders")} />
              <StatRow label="Miscellaneous Per-Order Cost" value={expenses.miscCost} onClick={() => onDrill("totalOrders")} />
            </div>
          </div>
          <div className="space-y-3.5">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Marketing Costs</div>
              <div className="divide-y divide-slate-50">
                <StatRow label="Meta Ad Spend" value={expenses.metaAdSpend} onClick={() => onDrill("spend")} />
                <StatRow label="GST on Ad Spend (18%)" value={expenses.gstOnAdSpend} onClick={() => onDrill("spend")} />
              </div>
            </div>
            {/* Phase 32 §3 — Other Expenses, broken out by real category
                (Employee Salary, Fixed Expenses, Miscellaneous, or
                whatever the user actually configured on the Expenses
                page — see otherExpensesByCategory above, never
                hardcoded) instead of one aggregate "Other Configured
                Expenses" number. Each category row still opens the same
                existing drill-down popup as before. */}
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Other Expenses</div>
              <div className="divide-y divide-slate-50">
                <StatRow label="Abandoned Cart Expenses" value={expenses.abandonedCartExpenses} />
                {expenseBreakdownError ? (
                  <div className="text-[11px] text-rose-500 flex items-center justify-between gap-2 py-1">
                    <span className="truncate">Couldn't load other expenses</span>
                    <button type="button" className="underline shrink-0" onClick={onRetryExpenseBreakdown}>
                      Retry
                    </button>
                  </div>
                ) : (expenses.otherExpensesByCategory || []).length > 0 ? (
                  expenses.otherExpensesByCategory.map((c) => (
                    <StatRow
                      key={c.category}
                      label={`${c.category} (${c.count})`}
                      value={c.amount}
                      onClick={onOpenOtherExpenses}
                    />
                  ))
                ) : (
                  <StatRow label="No other expenses configured" value={0} muted />
                )}
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between pt-2.5 mt-2 border-t border-slate-100">
          <span className="text-[12px] font-semibold text-slate-700">TOTAL EXPENSES</span>
          <span className="text-sm font-display font-bold text-rose-700">{currency(expenses.totalExpenses)}</span>
        </div>
      </div>

      {/* Final Gross Profit — visual calculation */}
      <div className="p-5">
        <div className="flex items-center gap-1.5 mb-3">
          <Layers size={13} className="text-slate-400" />
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">How This Was Calculated</h3>
        </div>
        <div className="flex flex-col lg:flex-row items-stretch gap-2">
          <FormulaTile label="Normal Order Revenue" value={normalOrders.recognizedRevenue} accent="indigo" />
          <FormulaOperator icon={Plus} />
          <FormulaTile label="Abandoned Cart Revenue" value={abandonedCart.recognizedRevenue} accent="indigo" />
          <FormulaOperator icon={Equal} />
          <FormulaTile label="Total Recognized Revenue" value={breakdown.totalRecognizedRevenue} accent="emerald" />
          <FormulaOperator icon={Minus} />
          <FormulaTile label="Total Expenses" value={expenses.totalExpenses} accent="rose" />
          <FormulaOperator icon={Equal} />
          <FormulaTile label="Pure Profit" value={breakdown.grossProfit} accent={isProfit ? "emerald" : "rose"} sub={`${Number(breakdown.profitMargin || 0).toFixed(2)}% margin`} />
        </div>
      </div>
        </>
      )}
    </section>
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