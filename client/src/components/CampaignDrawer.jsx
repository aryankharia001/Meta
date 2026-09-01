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
  Layers,
  PiggyBank,
  ShoppingBag,
  ExternalLink,
  // Phase 39 — Campaign Activity History / Active Performance section icons.
  Activity,
  TrendingUp,
  // Campaign History Phase — Campaign Identity section icon.
  Fingerprint,
} from "lucide-react";
import { Link } from "react-router-dom";
import { fetchCampaignDetails, logActivity, fetchProfitCampaigns, fetchCampaignActivityTimeline } from "../lib/api";
import { getCachedCampaignDetails, setCachedCampaignDetails } from "../lib/campaignDetailsCache";
import { useCampaignDrawer } from "../lib/CampaignDrawerContext";
import { useOrderDrawer } from "../lib/OrderDrawerContext";
import { useOverlayEscape } from "../lib/overlayStack";
import { useLiveSync, rangeIncludesToday } from "../lib/LiveSyncContext";
import { currency, number, percent, multiplier, formatDate, formatDateTime } from "../lib/format";
import { statusBadgeClass, roasClass, formatBudget, formatBidCapAmount } from "../lib/campaignDisplay";
import { LiveIndicator } from "./CampaignCells";
import InfoModal from "./InfoModal";
import OrdersListPopup from "./OrdersListPopup";
import FavoriteButton from "./FavoriteButton";
import EntityNotesPanel from "./EntityNotesPanel";
// Phase 32 §4 — "Open in Meta Ads Manager" button. New, additive import.
import OpenInMetaButton from "./OpenInMetaButton";
// Phase 27 — Budget & Bid Cap Control section. New, additive import;
// nothing above/below this line is touched.
import BudgetBidControlSection from "./control/BudgetBidControlSection";
// Phase 39 — Campaign Activity History, Active/Inactive Periods & Order
// Attribution. New, additive imports; nothing above/below this line is
// touched. Deliberately separate components from control/ActivityTimeline
// (Phase 27's Budget/Bid Cap timeline, still used unmodified inside
// BudgetBidControlSection above) — see campaignActivity/
// CampaignActivityHistoryList.jsx's own header comment for why.
import CampaignActivitySummaryCard from "./campaignActivity/CampaignActivitySummaryCard";
import CampaignActivityHistoryList from "./campaignActivity/CampaignActivityHistoryList";
import ActivePeriodsBar from "./campaignActivity/ActivePeriodsBar";
import ActivePerformanceSection from "./campaignActivity/ActivePerformanceSection";
// Campaign History Phase — Campaign Identity / Historical Names
// section. New, additive import; nothing above/below this line is
// touched. Own independent fetch (see CampaignIdentitySection.jsx's
// own header), same isolation as the Phase 39 imports just above.
import CampaignIdentitySection from "./campaignIdentity/CampaignIdentitySection";
import { recordRecentlyViewed } from "../lib/recentlyViewed";
import { useColumnPrefs } from "../lib/useColumnPrefs";
import ColumnSettingsMenu from "./ColumnSettingsMenu";
import {
  CAMPAIGN_ORDER_COLUMNS,
  CAMPAIGN_ORDER_DEFAULT_HIDDEN,
  CAMPAIGN_STAT_ORDER_COLUMNS,
  CAMPAIGN_STAT_ORDER_DEFAULT_HIDDEN,
} from "../lib/campaignOrderColumns";
// Phase 13 §3/§10 — Ad Sets section + Hourly Performance section, both
// purely additive (new sections appended to this drawer, nothing above
// them touched). fetchAdSetsByCampaign is a read-only GET against the
// new /api/adset-explorer routes.
import { fetchAdSetsByCampaign } from "../lib/api";
import { useAdSetDrawer } from "../lib/AdSetDrawerContext";
import HourlyPanel from "./hourly/HourlyPanel";

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
  // Phase 30 — Video Views / Hook Rate. videoViews is the 3-second video
  // view count Meta reports (action_type "video_view", from
  // video_play_actions or actions); hookRate is that count divided by
  // impressions. Both show "N/A" when Meta didn't return the underlying
  // 3s-video-view metric for this campaign/range — never approximated
  // from a different metric (e.g. video_p25_watched_actions).
  { key: "videoViews", label: "Video Views", format: number, tip: "3-second video views (action_type video_view) — Meta's standard 'hooked' viewer count." },
  { key: "hookRate", label: "Hook Rate", format: percent, tip: "3-second video views divided by impressions — how well the ad's opening hooks viewers." },
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

// KPI tiles that have a real order collection behind them (clicking one
// opens the actual order list via OrdersListPopup) vs. purely scalar
// stats (spend/roas/aov/cpo — nothing to list, just a value).
const COLLECTION_STAT_KEYS = new Set([
  "totalOrders",
  "matchedOrders",
  "revenue",
  "prepaid",
  "cod",
  "delivered",
  "pending",
  "cancelled",
  "returned",
]);

const STAT_EMPTY_MESSAGES = {
  totalOrders: "No orders found for this campaign and selected date range.",
  matchedOrders: "No matched orders found for this campaign and selected date range.",
  revenue: "No orders found for this campaign and selected date range.",
  prepaid: "No prepaid orders found for this campaign and selected date range.",
  cod: "No COD orders found for this campaign and selected date range.",
  delivered: "No delivered orders found for this campaign and selected date range.",
  pending: "No pending orders found for this campaign and selected date range.",
  cancelled: "No cancelled orders found for this campaign and selected date range.",
  returned: "No returned orders found for this campaign and selected date range.",
};

// Plain explanations for the scalar (non-collection) KPI tiles — shown
// in InfoModal instead of the old "coming in a later phase" placeholder.
const SCALAR_STAT_DESCRIPTIONS = {
  spend: "Total amount spent on this campaign, from Meta insights, for the selected date range.",
  roas: "Return on ad spend — revenue divided by spend — for the selected date range.",
  aov: "Average order value — total revenue divided by number of orders — for the selected date range.",
  cpo: "Cost per order — spend divided by number of orders — for the selected date range.",
};

// Returns the exact order list behind a given collection-stat KPI key.
// Deliberately byte-identical filter logic to kpiValues' own
// prepaid/cod/delivered/pending/cancelled/returned counts above, so the
// popup's order count always matches the KPI tile's displayed number.
function getStatOrders(key, orders) {
  if (key === "prepaid") return orders.filter((o) => o.paymentType === "PREPAID");
  if (key === "cod") return orders.filter((o) => o.paymentType === "CASH_ON_DELIVERY");
  if (key === "delivered" || key === "pending" || key === "cancelled" || key === "returned") {
    const withDelivery = orders.filter((o) => o.deliveryStatus);
    const kws =
      key === "delivered"
        ? ["deliver"]
        : key === "pending"
        ? ["pending", "transit", "process", "confirm"]
        : key === "cancelled"
        ? ["cancel"]
        : ["return", "rto"];
    return withDelivery.filter((o) => kws.some((k) => o.deliveryStatus.toLowerCase().includes(k)));
  }
  // totalOrders / matchedOrders / revenue — all orders in range.
  return orders;
}

// Phase 31 §2 — Consolidated Campaign Budget. A Meta campaign either
// carries a genuine campaign-level budget (daily_budget/lifetime_budget
// set directly on the Campaign object — details.campaign.budget, as
// deriveBudget() in campaigns.js already exposes it) or uses
// Advantage+/CBO-off ad-set-level budgeting, where the Campaign object's
// own budget fields are null/absent and each Ad Set carries its own
// budget instead (adSetExplorer.js's by-campaign endpoint now returns
// budget/budgetType per ad set — see Phase 31 §2a). Never adds the two
// together, and never sums a daily ad-set budget with a lifetime one —
// each cadence is summed separately and shown separately.
function consolidatedCampaignBudget(campaign, adSets) {
  if (campaign && campaign.budget !== null && campaign.budget !== undefined) {
    return { display: formatBudget(campaign.budget, campaign.budgetType) || "N/A", source: "campaign" };
  }

  const withBudget = (adSets || []).filter((a) => a.budget !== null && a.budget !== undefined);
  if (withBudget.length === 0) return { display: "N/A", source: "none" };

  let dailyTotal = 0, hasDaily = false;
  let lifetimeTotal = 0, hasLifetime = false;
  withBudget.forEach((a) => {
    if (a.budgetType === "daily") {
      dailyTotal += Number(a.budget) || 0;
      hasDaily = true;
    } else if (a.budgetType === "lifetime") {
      lifetimeTotal += Number(a.budget) || 0;
      hasLifetime = true;
    }
  });

  const parts = [];
  if (hasDaily) parts.push(formatBudget(dailyTotal, "daily"));
  if (hasLifetime) parts.push(formatBudget(lifetimeTotal, "lifetime"));
  return { display: parts.length ? parts.join(" + ") : "N/A", source: "adsets" };
}

// Phase 38 — Consolidated Campaign Bid Cap. Companion to
// consolidatedCampaignBudget() above, same fallback shape: a genuine
// Campaign-level bid cap (details.campaign.bidAmount — Meta's Graph API
// doesn't actually expose this on Campaign nodes today, see
// campaignDisplay.js's bidCapApplicability comment, so this branch is
// mostly future-proofing) always wins; otherwise this campaign's own Ad
// Sets' bid caps (adSetExplorer.js's by-campaign endpoint now returns
// bidAmount per ad set — see Phase 38) are rolled into a min/max. Equal
// values render as one number, differing ones as an explicit range —
// never a single invented value.
function consolidatedCampaignBidCap(campaign, adSets) {
  if (campaign && campaign.bidAmount !== null && campaign.bidAmount !== undefined) {
    return { min: campaign.bidAmount, max: campaign.bidAmount, source: "campaign" };
  }

  const withBidCap = (adSets || []).filter((a) => a.bidAmount !== null && a.bidAmount !== undefined);
  if (withBidCap.length === 0) return { min: null, max: null, source: "none" };

  const values = withBidCap.map((a) => Number(a.bidAmount) || 0);
  return { min: Math.min(...values), max: Math.max(...values), source: "adsets" };
}

export default function CampaignDrawer() {
  const { activeCampaign, closeCampaign } = useCampaignDrawer();
  const { openOrder } = useOrderDrawer();
  const { openAdSet } = useAdSetDrawer();
  const liveSync = useLiveSync();
  const open = !!activeCampaign;

  // Phase 13 §3/§10 — Ad Sets under this campaign. Separate state/effect
  // from the campaign `details` fetch above (own loading flag, own
  // failure mode) so a slow/failed Meta ad-set fetch can never block or
  // break the rest of this drawer.
  const [campaignAdSets, setCampaignAdSets] = useState([]);
  const [adSetsLoading, setAdSetsLoading] = useState(false);
  useEffect(() => {
    if (!activeCampaign?.tokenId || !activeCampaign?.campaignId) return;
    let cancelled = false;
    setAdSetsLoading(true);
    fetchAdSetsByCampaign(activeCampaign.tokenId, activeCampaign.campaignId, { since: activeCampaign.since, until: activeCampaign.until })
      .then((res) => !cancelled && setCampaignAdSets(res.adsets || []))
      .catch(() => !cancelled && setCampaignAdSets([]))
      .finally(() => !cancelled && setAdSetsLoading(false));
    return () => { cancelled = true; };
  }, [activeCampaign?.tokenId, activeCampaign?.campaignId, activeCampaign?.since, activeCampaign?.until]);

  // `details` is declared here (moved up from its original spot further
  // below) because the Phase 32 §5 effect immediately below reads
  // `details?.campaign?.accountId` in its dependency array. That
  // dependency array is evaluated synchronously during render, so
  // `details` must already be initialized by the time this line runs —
  // declaring it after this block (as originally written) left it in the
  // temporal dead zone here and threw "Cannot access 'details' before
  // initialization" on every mount. Nothing about `details`' behavior
  // changes, only where it's declared.
  const [details, setDetails] = useState(null);

  // Phase 32 §5 — Profit & Cost Breakdown for this one campaign. Reuses
  // the existing, already-audited GET /profitability/:tokenId/campaigns
  // endpoint (same numbers the Profitability page's Campaign-Wise Profit
  // table and "Advertising Expense" drill-down already show) filtered
  // down to this campaignId — never a second, independently-computed
  // profit calculation living in this drawer. Own state/effect, same
  // "can't block or break the rest of the drawer" isolation as the Ad
  // Sets fetch above. Requires a known ad account ID (the endpoint is
  // account-scoped); when that isn't available in this context, the
  // section below explains why rather than silently showing nothing.
  const [campaignProfit, setCampaignProfit] = useState(null);
  const [campaignProfitLoading, setCampaignProfitLoading] = useState(false);
  const [campaignProfitError, setCampaignProfitError] = useState("");
  const loadCampaignProfit = () => {
    const tokenId = activeCampaign?.tokenId;
    const campaignId = activeCampaign?.campaignId;
    const accountId = activeCampaign?.accountId || details?.campaign?.accountId;
    if (!tokenId || !campaignId || !accountId) {
      setCampaignProfit(null);
      return;
    }
    let cancelled = false;
    setCampaignProfitLoading(true);
    setCampaignProfitError("");
    fetchProfitCampaigns(tokenId, { accountIds: [accountId], since: activeCampaign.since, until: activeCampaign.until })
      .then((res) => {
        if (cancelled) return;
        const row = (res.campaigns || []).find((c) => c.campaignId === campaignId);
        setCampaignProfit(row || null);
      })
      .catch((err) => !cancelled && setCampaignProfitError(err.message || "Failed to load profit breakdown"))
      .finally(() => !cancelled && setCampaignProfitLoading(false));
    return () => { cancelled = true; };
  };
  useEffect(() => {
    return loadCampaignProfit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCampaign?.tokenId, activeCampaign?.campaignId, activeCampaign?.accountId, activeCampaign?.since, activeCampaign?.until, details?.campaign?.accountId]);

  // Phase 39 §5/§6 — Campaign Activity History (merged status/budget/
  // bid-cap event timeline + reconstructed Active/Inactive periods +
  // summary). Own state/effect, same "can't block or break the rest of
  // the drawer" isolation as the Ad Sets/Profit fetches above. The
  // order-attribution numbers (Active/Post-Campaign/Inactive orders &
  // revenue, Primary ROAS) don't live here — they're already on
  // `details.campaign` from the main details fetch — this effect only
  // gets the event list + period boundaries the timeline/summary card
  // need to render.
  const [activityTimeline, setActivityTimeline] = useState(null); // { events, periods, summary }
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState("");
  useEffect(() => {
    if (!activeCampaign?.tokenId || !activeCampaign?.campaignId) return;
    let cancelled = false;
    setActivityLoading(true);
    setActivityError("");
    fetchCampaignActivityTimeline(activeCampaign.tokenId, activeCampaign.campaignId, {
      since: activeCampaign.since,
      until: activeCampaign.until,
    })
      .then((res) => !cancelled && setActivityTimeline(res))
      .catch((err) => !cancelled && setActivityError(err.response?.data?.message || err.message || "Failed to load activity history"))
      .finally(() => !cancelled && setActivityLoading(false));
    return () => {
      cancelled = true;
    };
  }, [activeCampaign?.tokenId, activeCampaign?.campaignId, activeCampaign?.since, activeCampaign?.until]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sortConfig, setSortConfig] = useState({ key: "orderCreatedAt", direction: "desc" });
  const [page, setPage] = useState(1);

  const [infoCard, setInfoCard] = useState(null);
  // { key, label } of whichever collection-stat KPI tile was clicked, or
  // null. Drives the OrdersListPopup drill-down below.
  const [statPopup, setStatPopup] = useState(null);

  // Campaign History Phase §29 — the missing half of "show cached data
  // immediately, refresh in background" (loadDetails previously only
  // ever did cache-OR-fetch, never both). Tracks which request is the
  // most recent one loadDetails was asked for, so a background refetch
  // that resolves after the user has since moved on (a different
  // campaign, a different date range, or an explicit force-refresh)
  // can detect it's stale and discard itself — same guard purpose the
  // activityTimeline effect above serves with its own `cancelled` flag,
  // just expressed as a ref since loadDetails isn't scoped to a single
  // effect's lifecycle (it's also called directly by the header's
  // refresh button and the error screen's retry button).
  const latestRequestKeyRef = useRef(null);

  const loadDetails = (meta, { force = false, isNewCampaign = false } = {}) => {
    const { tokenId, campaignId, campaignName, accountId, since, until } = meta;
    const requestKey = `${tokenId}:${campaignId}:${accountId}:${since}:${until}`;
    latestRequestKeyRef.current = requestKey;

    if (!force) {
      const cached = getCachedCampaignDetails(tokenId, campaignId, accountId, since, until);
      if (cached) {
        setDetails(cached);
        setError("");
        setLoading(false);
        // Silent background refresh: re-fetch the same campaign/range
        // and, if this is still the most recently requested one when it
        // resolves, quietly replace `details`/the cache with the fresh
        // copy. Never shows a loading state and never surfaces its own
        // errors — the cached data already satisfied this view, so a
        // background refresh failing shouldn't interrupt it.
        fetchCampaignDetails(tokenId, campaignId, { campaignName, accountId, since, until })
          .then((res) => {
            if (latestRequestKeyRef.current !== requestKey) return; // superseded by a newer request
            setDetails(res);
            setCachedCampaignDetails(tokenId, campaignId, accountId, since, until, res);
          })
          .catch(() => {});
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
    setInfoCard(null);
    setStatPopup(null);
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

  useOverlayEscape(open, closeCampaign);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // ── Derived data ─────────────────────────────────────────────

  // Phase 31 §2 — recomputed from whatever campaignAdSets/details.campaign
  // currently hold, so it always reflects the latest fetch (the refresh
  // button/live-sync refetch above already re-runs both fetches; nothing
  // here caches a stale copy independently).
  const budgetInfo = useMemo(
    () => consolidatedCampaignBudget(details?.campaign, campaignAdSets),
    [details?.campaign, campaignAdSets]
  );

  // Phase 38 — same recompute-on-latest-fetch reasoning as budgetInfo
  // above.
  const bidCapInfo = useMemo(
    () => consolidatedCampaignBidCap(details?.campaign, campaignAdSets),
    [details?.campaign, campaignAdSets]
  );

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

    // Phase 39 — the headline ROAS tile now shows Primary ROAS (active-period
    // revenue ÷ active-period spend, see campaignActivity.js's
    // computePrimaryRoas()) instead of spend-vs-every-matched-order ROAS, so
    // orders that arrived after a campaign closed never inflate it. `spend`/
    // `revenue` above stay full-range and unchanged — still used for AOV/CPO
    // and the CSV export.
    const roas = details.campaign?.primaryRoas ?? null;
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

  // Order list behind the currently open stat popup, using the exact
  // same predicates as kpiValues above so the popup's order count always
  // matches the KPI tile's displayed number.
  const statOrders = useMemo(() => {
    if (!statPopup || !details) return [];
    return getStatOrders(statPopup.key, details.orders || []);
  }, [statPopup, details]);

  // Extra summary cards for the stat popup: Avg Order Value for every
  // collection stat, plus an honest "Expected COD Revenue" card for the
  // cod popup specifically — only shown when delivery-status data
  // actually exists for at least one COD order (same "don't fabricate
  // untracked data" convention insights.deliveredPercent/cancelledPercent
  // already follow above). No COD "conversion rate" card — there's no
  // underlying click/event data in this app to compute a genuine rate
  // from, so it's omitted rather than invented.
  const statExtraCards = useMemo(() => {
    if (!statPopup) return [];
    const revenue = statOrders.reduce((s, o) => s + Number(o.totalAmountPayable || 0), 0);
    const aov = statOrders.length ? revenue / statOrders.length : 0;
    const cards = [{ label: "Avg Order Value", value: currency(aov) }];

    if (statPopup.key === "cod") {
      const allOrders = details?.orders || [];
      const codOrders = allOrders.filter((o) => o.paymentType === "CASH_ON_DELIVERY");
      const codHasDeliveryData = codOrders.some((o) => o.deliveryStatus);
      if (codHasDeliveryData) {
        const isCancelledOrReturned = (o) => {
          if (!o.deliveryStatus) return false;
          const s = o.deliveryStatus.toLowerCase();
          return s.includes("cancel") || s.includes("return") || s.includes("rto");
        };
        const expectedCodRevenue = codOrders
          .filter((o) => !isCancelledOrReturned(o))
          .reduce((s, o) => s + Number(o.totalAmountPayable || 0), 0);
        cards.push({ label: "Expected COD Revenue", value: currency(expectedCodRevenue) });
      }
    }
    return cards;
  }, [statPopup, statOrders, details]);

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
    // Phase 14 §6 — "Campaign exported". Fire-and-forget.
    logActivity("campaign_exported", `Campaign exported (${c.name})`, {}, "campaign", c.id);
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
    // Phase 14 §6 — "Order export performed". Fire-and-forget.
    logActivity(
      "order_export",
      `Order export performed (${sortedOrders.length} order${sortedOrders.length === 1 ? "" : "s"} — ${details.campaign.name})`,
      {},
      "campaign",
      details.campaign.id
    );
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

        {open && !error && details && (
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
                    <LiveIndicator status={details.campaign.effectiveStatus || details.campaign.status} />
                    <h2 className="font-display font-bold text-lg text-slate-800 truncate max-w-[420px]">
                      {details.campaign.name}
                    </h2>
                    {details.campaign.status && (
                      <span className={`badge ${statusBadgeClass(details.campaign.effectiveStatus || details.campaign.status)}`}>
                        {details.campaign.status}
                      </span>
                    )}
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
                  {/* Phase 32 §4 — real Meta object deep link, not the
                      generic Ads Manager homepage. Disabled with a
                      tooltip when the account ID isn't known yet rather
                      than linking somewhere generic. */}
                  <OpenInMetaButton
                    level="campaign"
                    accountId={details.campaign.accountId || activeCampaign?.accountId}
                    campaignId={details.campaign.id}
                  />
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
                {/* Phase 31 §2 / Phase 36 §4 — consolidated budget: the
                    genuine Meta campaign-level budget when set, else the sum
                    of each ad set's own budget (grouped by daily/lifetime
                    cadence, never added together — see
                    consolidatedCampaignBudget()). The label always stays
                    "Campaign Budget" — a fallback sum is called out with a
                    small "Ad Set Budget Applied" caption below the value
                    instead of a renamed label or a second field. */}
                <InfoBit
                  icon={Wallet}
                  label="Campaign Budget"
                  value={budgetInfo.display}
                  caption={budgetInfo.source === "adsets" ? "Ad Set Budget Applied" : null}
                />
                {/* Phase 38 — Campaign Bid Cap Fallback to Ad Set, same
                    "same field, small caption" convention as Campaign
                    Budget just above — see consolidatedCampaignBidCap(). */}
                <InfoBit
                  icon={Gauge}
                  label="Bid Cap"
                  value={
                    bidCapInfo.source === "none" || bidCapInfo.min === null
                      ? "N/A"
                      : bidCapInfo.max !== bidCapInfo.min
                      ? `${formatBidCapAmount(bidCapInfo.min)}–${formatBidCapAmount(bidCapInfo.max)}`
                      : formatBidCapAmount(bidCapInfo.min)
                  }
                  caption={bidCapInfo.source === "adsets" ? "Ad Set Bid Cap Applied" : null}
                />
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
              {/* Campaign History Phase — Campaign Identity / Historical
                  Names. Purely additive section, its own independent
                  fetch (see CampaignIdentitySection.jsx's own header) —
                  never touches `details`/loadDetails or any section
                  below. Placed first so the campaign's permanent
                  identity is the first thing shown in the drawer body. */}
              <section>
                <SectionTitle icon={Fingerprint}>Campaign Identity</SectionTitle>
                <CampaignIdentitySection tokenId={activeCampaign.tokenId} campaignId={details.campaign.id} />
              </section>

              {/* Phase 27 — Budget & Bid Cap Control, History, Sync,
                  Hourly Activity. Purely additive section — reads/writes
                  only the new Phase 27 /campaign-control endpoints,
                  nothing above or below this block is touched. */}
              <section>
                <SectionTitle icon={Wallet}>Budget & Bid Cap Control</SectionTitle>
                <BudgetBidControlSection
                  level="campaign"
                  tokenId={activeCampaign.tokenId}
                  entityId={details.campaign.id}
                  tableIdSuffix="campaign"
                />
              </section>

              {/* Phase 39 — Campaign Activity History: Active/Inactive
                  Summary, reconstructed periods, and the full status +
                  budget/bid-cap activity timeline. Purely additive —
                  reads only the new GET /campaign-activity/:tokenId/
                  :campaignId/timeline endpoint (see the activityTimeline
                  effect above); nothing above or below this block is
                  touched. */}
              <section>
                <SectionTitle icon={Activity}>Campaign Activity</SectionTitle>
                <div className="card p-4 space-y-5">
                  <CampaignActivitySummaryCard summary={activityTimeline?.summary} loading={activityLoading} error={activityError} />
                  {activityTimeline?.summary?.available && (
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Active / Inactive Periods</div>
                      <ActivePeriodsBar periods={activityTimeline?.periods} loading={activityLoading} error={activityError} />
                    </div>
                  )}
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Activity Timeline</div>
                    <CampaignActivityHistoryList events={activityTimeline?.events} loading={activityLoading} error={activityError} />
                  </div>
                </div>
              </section>

              {/* KPIs */}
              <section>
                <SectionTitle icon={Gauge}>Campaign KPIs</SectionTitle>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3.5">
                  {KPI_DEFS.map((def) => (
                    <button
                      key={def.key}
                      type="button"
                      onClick={() => {
                        if (COLLECTION_STAT_KEYS.has(def.key)) {
                          setStatPopup({ key: def.key, label: def.label });
                        } else {
                          setInfoCard({ ...def, display: kpiValues ? def.format(kpiValues[def.key]) : "N/A" });
                        }
                      }}
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

              {/* Phase 39 §17 — Active Performance / Post-Campaign / Inactive-
                  Period order & revenue attribution, and the Primary ROAS
                  (active-period revenue ÷ active-period spend). Purely
                  additive — every figure here comes from the new fields
                  campaigns.js's /:campaignId/details already returns on
                  `details.campaign`; nothing above or below this block is
                  touched. */}
              <section>
                <SectionTitle icon={TrendingUp}>Active Performance</SectionTitle>
                <div className="card p-4">
                  <ActivePerformanceSection
                    campaign={details.campaign}
                    spend={details.metaInsights?.spend ?? null}
                    orders={details.orders || []}
                    periods={activityTimeline?.periods}
                    historicalDataAvailableFrom={activityTimeline?.summary?.historicalDataAvailableFrom}
                    tokenId={activeCampaign.tokenId}
                    since={activeCampaign.since}
                    until={activeCampaign.until}
                  />
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

              {/* Phase 32 §5 — Profit & Cost Breakdown, reusing the
                  existing profitability/:tokenId/campaigns endpoint (see
                  loadCampaignProfit above) — not a new profit calculation. */}
              <section>
                <SectionTitle icon={PiggyBank}>Profit & Cost Breakdown</SectionTitle>
                {!(activeCampaign?.accountId || details.campaign.accountId) ? (
                  <div className="card text-sm text-slate-400 text-center py-6">
                    Ad account isn't known for this campaign in this context, so a cost-inclusive profit breakdown can't be computed here.
                  </div>
                ) : campaignProfitLoading && !campaignProfit ? (
                  <div className="card text-sm text-slate-400 text-center py-6">Loading…</div>
                ) : campaignProfitError ? (
                  <div className="card text-center py-6 flex flex-col items-center gap-2">
                    <span className="text-sm text-rose-500">{campaignProfitError}</span>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={loadCampaignProfit}>
                      <RefreshCw size={13} /> Try again
                    </button>
                  </div>
                ) : !campaignProfit ? (
                  <div className="card text-sm text-slate-400 text-center py-6">
                    No matched orders for this campaign in this date range — nothing to compute a profit breakdown from yet.
                  </div>
                ) : (
                  <div className="card p-0 overflow-hidden">
                    <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y divide-slate-100">
                      <div className="p-3.5">
                        <div className="text-[11px] text-slate-400 mb-1">Total Recognized Revenue</div>
                        <div className="text-sm font-semibold text-slate-700">{currency(campaignProfit.totalRecognizedRevenue)}</div>
                      </div>
                      <div className="p-3.5">
                        <div className="text-[11px] text-slate-400 mb-1">Total Expenses</div>
                        <div className="text-sm font-semibold text-slate-700">{currency(campaignProfit.totalExpenses)}</div>
                      </div>
                      <div className="p-3.5">
                        <div className="text-[11px] text-slate-400 mb-1">Net Profit</div>
                        <div className={`text-sm font-semibold ${campaignProfit.netProfit >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                          {currency(campaignProfit.netProfit)}
                        </div>
                      </div>
                      <div className="p-3.5">
                        <div className="text-[11px] text-slate-400 mb-1">Profit Margin</div>
                        <div className={`text-sm font-semibold ${campaignProfit.netProfit >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                          {percent(campaignProfit.profitMargin)}
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 divide-x divide-y divide-slate-100 border-t border-slate-100">
                      <div className="p-3.5">
                        <div className="text-[11px] text-slate-400 mb-1">Product / Manufacturing</div>
                        <div className="text-sm font-medium text-slate-700">{currency(campaignProfit.productCost)}</div>
                      </div>
                      <div className="p-3.5">
                        <div className="text-[11px] text-slate-400 mb-1">Packaging</div>
                        <div className="text-sm font-medium text-slate-700">{currency(campaignProfit.packagingCost)}</div>
                      </div>
                      <div className="p-3.5">
                        <div className="text-[11px] text-slate-400 mb-1">Shipping</div>
                        <div className="text-sm font-medium text-slate-700">{currency(campaignProfit.shippingCost)}</div>
                      </div>
                      <div className="p-3.5">
                        <div className="text-[11px] text-slate-400 mb-1">Ad Spend</div>
                        <div className="text-sm font-medium text-slate-700">{currency(campaignProfit.spend)}</div>
                      </div>
                      <div className="p-3.5">
                        <div className="text-[11px] text-slate-400 mb-1">Allocated Operating Expenses</div>
                        <div className="text-sm font-medium text-slate-700">{currency(campaignProfit.operatingExpense)}</div>
                      </div>
                      <div className="p-3.5">
                        <div className="text-[11px] text-slate-400 mb-1">Other Per-Order Cost</div>
                        <div className="text-sm font-medium text-slate-700">{currency(campaignProfit.otherCost)}</div>
                      </div>
                    </div>
                    <div className="px-3.5 py-2 border-t border-slate-100 text-[11px] text-slate-400">
                      Operating expenses (rent, salaries, and other configured expenses) are allocated to this campaign proportional to its share of total recognized revenue in range — the same method the Profitability page uses.
                    </div>
                  </div>
                )}
              </section>

              {/* Phase 33 — Abandoned Cart (Traflead). Traflead's synced
                  leads carry their OWN free-text `campaign` field (see
                  services/trafleadSyncService.js's header comment — Traflead
                  has no confirmed structural link, like a shared campaign
                  ID, tying a lead back to a specific Meta campaign), so
                  this is deliberately a manual, transparent SEARCH by this
                  campaign's name rather than a claimed exact match/count —
                  showing a confident-looking "0" here when the real
                  attribution field just doesn't line up would be worse
                  than not showing a number at all. */}
              <section>
                <SectionTitle icon={ShoppingBag}>Abandoned Cart (Traflead)</SectionTitle>
                <div className="card text-xs text-slate-500 flex items-center justify-between gap-3">
                  <span>
                    Traflead's synced Abandoned Cart leads don't carry a confirmed campaign-ID link back to Meta — search by this
                    campaign's name in the Abandoned Carts page instead of a possibly-wrong automatic match.
                  </span>
                  <Link
                    to={`/abandoned-carts?since=${details?.since || ""}&until=${details?.until || ""}&search=${encodeURIComponent(details.campaign.name || "")}`}
                    className="btn btn-secondary btn-sm shrink-0"
                  >
                    Search Traflead <ExternalLink size={12} />
                  </Link>
                </div>
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

              {/* Phase 13 §3/§10 — Ad Sets under this campaign */}
              <section>
                <SectionTitle icon={Layers}>Ad Sets ({campaignAdSets.length})</SectionTitle>
                <div className="card">
                  {adSetsLoading ? (
                    <p className="text-sm text-slate-400 py-3">Loading ad sets…</p>
                  ) : campaignAdSets.length === 0 ? (
                    <p className="text-sm text-slate-400 py-3">No ad sets found for this campaign in Meta.</p>
                  ) : (
                    <div className="overflow-x-auto -mx-4">
                      <table className="table">
                        <thead>
                          <tr>
                            <th>Ad Set</th><th>Status</th>
                            {/* Phase 31 §2c — per-ad-set budget, alongside the
                                consolidated total shown in the header strip. */}
                            <th className="text-right">Budget</th>
                            <th className="text-right">Spend</th><th className="text-right">ROAS</th><th className="text-right">Orders</th><th className="text-right">Revenue</th>
                          </tr>
                        </thead>
                        <tbody>
                          {campaignAdSets.map((a) => (
                            <tr
                              key={a.adsetId}
                              className="cursor-pointer"
                              onClick={() =>
                                openAdSet({
                                  tokenId: activeCampaign.tokenId,
                                  adsetId: a.adsetId,
                                  adsetName: a.adsetName,
                                  campaignId: details.campaign.id,
                                  campaignName: details.campaign.name,
                                  since: activeCampaign.since,
                                  until: activeCampaign.until,
                                })
                              }
                            >
                              <td className="font-medium text-slate-700">{a.adsetName}</td>
                              <td>{a.effectiveStatus || a.status || "N/A"}</td>
                              <td className="text-right">{formatBudget(a.budget, a.budgetType) || "N/A"}</td>
                              <td className="text-right">{currency(a.spend)}</td>
                              <td className={`text-right ${roasClass(a.roas)}`}>{multiplier(a.roas)}</td>
                              <td className="text-right">{a.totalOrders}</td>
                              <td className="text-right">{currency(a.revenue)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </section>

              {/* Phase 13 §1/§2/§11 — Hourly Performance for this campaign */}
              <section>
                <SectionTitle icon={Clock}>Hourly Performance</SectionTitle>
                <div className="card">
                  <HourlyPanel
                    tokenId={activeCampaign.tokenId}
                    campaignId={details.campaign.id}
                    campaignName={details.campaign.name}
                    tableIdSuffix={`campaign-${details.campaign.id}`}
                    title=""
                  />
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
        body={infoCard ? SCALAR_STAT_DESCRIPTIONS[infoCard.key] : ""}
        onClose={() => setInfoCard(null)}
      />

      <OrdersListPopup
        open={!!statPopup}
        title={statPopup && details ? `${statPopup.label} — ${details.campaign.name}` : ""}
        subtitle={details ? `${details.since} to ${details.until}` : ""}
        orders={statOrders}
        tokenId={activeCampaign?.tokenId}
        since={details?.since}
        until={details?.until}
        onClose={() => setStatPopup(null)}
        exportFilename={details && statPopup ? `campaign-${details.campaign.id}-${statPopup.key}.csv` : "campaign-orders.csv"}
        emptyMessage={statPopup ? STAT_EMPTY_MESSAGES[statPopup.key] : undefined}
        extraCards={statExtraCards}
        columns={CAMPAIGN_STAT_ORDER_COLUMNS}
        defaultHidden={CAMPAIGN_STAT_ORDER_DEFAULT_HIDDEN}
        storageKey="campaignStatOrdersPopup"
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

// Phase 36 §4 — optional `caption` renders as a small, muted line below the
// value (never a second top-level InfoBit/field) — used only by Campaign
// Budget's "Ad Set Budget Applied" note when the value shown is a fallback
// sum rather than a genuine Meta-reported campaign budget. Every other
// caller is unaffected — no caption means this renders exactly as before.
function InfoBit({ icon: Icon, label, value, caption }) {
  return (
    <span className="inline-flex items-start gap-1.5" title={label}>
      <Icon size={12} className="text-slate-300 mt-0.5" />
      <span className="flex flex-col leading-tight">
        <span>
          <span className="text-slate-400">{label}:</span> <span className="font-medium text-slate-600">{value}</span>
        </span>
        {caption && <span className="text-[10px] text-slate-400">{caption}</span>}
      </span>
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
