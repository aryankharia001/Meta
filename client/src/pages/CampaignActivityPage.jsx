import { useEffect, useMemo, useRef, useState } from "react";
import { Clock, Building2, ChevronDown, ChevronRight, RefreshCw, AlertTriangle, GitCompareArrows, LayoutList, Compass } from "lucide-react";
import {
  fetchLiveAdAccounts,
  fetchCampaignActivityDaily,
  fetchCampaignActivityHourly,
  fetchCampaignsForHour,
  fetchCampaignsForDay,
  fetchCampaignHourly,
  fetchAdSetsForCampaignHour,
  fetchAdSetHourly,
  fetchAdsForAdSetHour,
  fetchAdHourly,
} from "../lib/api";
import { useSelectedToken } from "../lib/useSelectedToken";
import { todayIso, shiftDays, formatDayLabel } from "../lib/dateIst";
import { currency, number, multiplier } from "../lib/format";
import HourOrdersPopup from "../components/daily/HourOrdersPopup";
import { DailyActivityTable, HourlyActivityTable, CampaignsTable, ChildrenTable } from "../components/campaignActivity/ActivityTables";
import ComparisonPanel from "../components/campaignActivity/ComparisonPanel";
import { hourRangeLabel } from "../components/campaignActivity/activityFormat";

// ─────────────────────────────────────────────────────────────────────
// Phase 44 — Campaign Activity History + Hourly ROAS. A dedicated,
// additive top-level page — same "zero coupling between phases"
// convention Daily/Campaign Explorer/Analytics already follow: built
// entirely on the new, additive GET /api/campaign-activity/:tokenId/*
// endpoints (see server/routes/campaignActivity.js and its
// lib/campaignActivityReport.js), and never touches Daily, Campaign
// Explorer, Live Dashboard, or Abandoned Cart in any way.
//
// Spec §17 — two Exploration Modes over the same underlying data, only
// differing in what a Day expands into:
//   Time-Based:     Date → Day (24h, account-wide) → Hour → Campaign
//                    → Hour → Ad Set → Hour → Ad → Hour → Orders
//   Campaign-Based: Date → Day → Campaign (whole-day list) → Hour
//                    → Ad Set → Hour → Ad → Hour → Orders
// Modeled as a single breadcrumb "drill stack" — the mode only decides
// what the Daily table's row click pushes as the SECOND stack entry;
// every entry after that (Campaign → Hour → Ad Set → Hour → Ad → Hour)
// is identical in both modes, since it's the same underlying entity
// hierarchy either way.
// ─────────────────────────────────────────────────────────────────────

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
  { key: "custom", label: "Custom Range", range: null },
];

// Spec §26 — default the Comparison panel's boundary to wherever this
// entity's own Budget or Bid Cap actually changed today, rather than an
// arbitrary midday split. Reads the same `hours` array already on
// screen — never a separate fetch.
function detectBoundaryHour(hours) {
  if (!hours || !hours.length) return null;
  for (let i = 1; i < hours.length; i++) {
    if (hours[i].budget !== hours[i - 1].budget || hours[i].bidCap !== hours[i - 1].bidCap) return hours[i].hour;
  }
  return null;
}

export default function CampaignActivityPage() {
  const { tokenId: TOKEN_ID, setTokenId, tokens } = useSelectedToken();

  const [adAccounts, setAdAccounts] = useState([]);
  const [selectedAccounts, setSelectedAccounts] = useState([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);

  const [presetKey, setPresetKey] = useState("7d");
  const [customSince, setCustomSince] = useState(shiftDays(todayIso(), -6));
  const [customUntil, setCustomUntil] = useState(todayIso());
  const { since, until } = useMemo(() => {
    if (presetKey === "custom") return { since: customSince, until: customUntil };
    return PRESETS.find((p) => p.key === presetKey).range();
  }, [presetKey, customSince, customUntil]);

  // Spec §17 — Exploration Mode, only adjustable at the root (Daily)
  // view; every deeper level is shared between both modes.
  const [mode, setMode] = useState("time"); // "time" | "campaign"

  // The drill-down breadcrumb stack. Index 0 is always the Daily root.
  const [stack, setStack] = useState([{ view: "daily", label: "Daily" }]);
  const top = stack[stack.length - 1];

  const [viewData, setViewData] = useState(null);
  const [viewLoading, setViewLoading] = useState(false);
  const [viewError, setViewError] = useState("");

  const [ordersPopup, setOrdersPopup] = useState(null);
  const [comparePanel, setComparePanel] = useState(null);

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

  // Reset the drill stack whenever the token, accounts, or date range
  // change — a stale hour/campaign selection from a previous filter set
  // would otherwise point at data outside the new scope.
  const accountsKey = useMemo(() => [...selectedAccounts].sort().join(","), [selectedAccounts]);
  useEffect(() => {
    setStack([{ view: "daily", label: "Daily" }]);
  }, [TOKEN_ID, accountsKey, since, until]);

  // ── Fetch whatever the top of the stack currently needs ───────────
  useEffect(() => {
    if (!TOKEN_ID || selectedAccounts.length === 0) return;
    let cancelled = false;
    setViewLoading(true);
    setViewError("");
    // Clear the previous view's data immediately — otherwise, for the
    // brief gap before the new fetch resolves, the tables below would
    // render with the OLD view's response shape (e.g. a Daily response's
    // `.days` where the new Hourly view expects `.hours`), and every
    // table's `[...rows]` spread would throw "is not iterable" on
    // whatever field doesn't exist on that stale object.
    setViewData(null);

    const common = { accountIds: selectedAccounts };
    let promise;
    switch (top.view) {
      case "daily":
        promise = fetchCampaignActivityDaily(TOKEN_ID, { ...common, since, until });
        break;
      case "account-hourly":
        promise = fetchCampaignActivityHourly(TOKEN_ID, { ...common, date: top.date });
        break;
      case "hour-campaigns":
        promise = fetchCampaignsForHour(TOKEN_ID, { ...common, date: top.date, hour: top.hour });
        break;
      case "day-campaigns":
        promise = fetchCampaignsForDay(TOKEN_ID, { ...common, date: top.date });
        break;
      case "campaign-hourly":
        promise = fetchCampaignHourly(TOKEN_ID, top.campaignId, { ...common, date: top.date, campaignName: top.campaignName });
        break;
      case "campaign-hour-adsets":
        promise = fetchAdSetsForCampaignHour(TOKEN_ID, top.campaignId, top.hour, { ...common, date: top.date });
        break;
      case "adset-hourly":
        promise = fetchAdSetHourly(TOKEN_ID, top.adsetId, { ...common, date: top.date, campaignId: top.campaignId });
        break;
      case "adset-hour-ads":
        promise = fetchAdsForAdSetHour(TOKEN_ID, top.adsetId, top.hour, { ...common, date: top.date });
        break;
      case "ad-hourly":
        promise = fetchAdHourly(TOKEN_ID, top.adId, { ...common, date: top.date });
        break;
      default:
        promise = Promise.resolve(null);
    }

    promise
      .then((data) => {
        if (!cancelled) setViewData(data);
      })
      .catch((err) => {
        if (!cancelled) setViewError(err.message || "Failed to load Campaign Activity data");
      })
      .finally(() => {
        if (!cancelled) setViewLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [TOKEN_ID, accountsKey, since, until, stack]);

  const goToBreadcrumb = (index) => setStack((s) => s.slice(0, index + 1));

  const openDay = (date) => {
    const nextView =
      mode === "time"
        ? { view: "account-hourly", date, label: formatDayLabel(date) }
        : { view: "day-campaigns", date, label: formatDayLabel(date) };
    setStack((s) => [s[0], nextView]);
  };

  const openCampaign = (row) => {
    setStack((s) => [...s, { view: "campaign-hourly", date: top.date, campaignId: row.campaignId, campaignName: row.campaignName, label: row.campaignName }]);
  };

  const openHourChildren = (hour) => {
    if (top.view === "account-hourly") {
      setStack((s) => [...s, { view: "hour-campaigns", date: top.date, hour, label: hourRangeLabel(hour) }]);
    } else if (top.view === "campaign-hourly") {
      setStack((s) => [
        ...s,
        { view: "campaign-hour-adsets", date: top.date, campaignId: top.campaignId, campaignName: top.campaignName, hour, label: hourRangeLabel(hour) },
      ]);
    } else if (top.view === "adset-hourly") {
      setStack((s) => [
        ...s,
        {
          view: "adset-hour-ads",
          date: top.date,
          campaignId: top.campaignId,
          campaignName: top.campaignName,
          adsetId: top.adsetId,
          adsetName: top.adsetName,
          hour,
          label: hourRangeLabel(hour),
        },
      ]);
    }
  };

  const openChild = (row) => {
    if (top.view === "campaign-hour-adsets") {
      setStack((s) => [
        ...s,
        {
          view: "adset-hourly",
          date: top.date,
          campaignId: top.campaignId,
          campaignName: top.campaignName,
          adsetId: row.adsetId,
          adsetName: row.name,
          label: row.name,
        },
      ]);
    } else if (top.view === "adset-hour-ads") {
      setStack((s) => [
        ...s,
        {
          view: "ad-hourly",
          date: top.date,
          campaignId: top.campaignId,
          campaignName: top.campaignName,
          adsetId: top.adsetId,
          adsetName: top.adsetName,
          adId: row.adId,
          adName: row.name,
          label: row.name,
        },
      ]);
    }
  };

  const openOrders = (hour) => {
    if (top.view === "account-hourly") {
      setOrdersPopup({ date: top.date, hour, scopeLabel: "All Campaigns" });
    } else if (top.view === "campaign-hourly") {
      setOrdersPopup({ date: top.date, hour, campaignId: top.campaignId, campaignName: top.campaignName, scopeLabel: top.campaignName });
    } else if (top.view === "adset-hourly") {
      setOrdersPopup({ date: top.date, hour, adsetId: top.adsetId, campaignId: top.campaignId, scopeLabel: top.adsetName || top.adsetId });
    } else if (top.view === "ad-hourly") {
      setOrdersPopup({ date: top.date, hour, adId: top.adId, scopeLabel: top.adName || top.adId });
    }
  };

  const openCompare = () => {
    const entityType = top.view === "campaign-hourly" ? "campaign" : top.view === "adset-hourly" ? "adset" : "ad";
    const entityId = entityType === "campaign" ? top.campaignId : entityType === "adset" ? top.adsetId : top.adId;
    const entityName = entityType === "campaign" ? top.campaignName : entityType === "adset" ? top.adsetName : top.adName;
    setComparePanel({
      entityType,
      entityId,
      campaignId: top.campaignId,
      campaignName: top.campaignName,
      entityName,
      date: top.date,
      defaultBoundaryHour: detectBoundaryHour(viewData?.hours),
    });
  };

  const handlePresetClick = (key) => {
    if (key === "custom") {
      setCustomSince(since);
      setCustomUntil(until);
    }
    setPresetKey(key);
  };

  const toggleAccount = (id) => setSelectedAccounts((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const selectAllAccounts = () => setSelectedAccounts(adAccounts.map((a) => a.id));
  const clearAccounts = () => setSelectedAccounts([]);

  const canCompare = ["campaign-hourly", "adset-hourly", "ad-hourly"].includes(top.view);
  const atRoot = stack.length === 1;

  return (
    <div className="min-h-screen pb-16">
      <div className="sticky top-0 z-20 bg-white/85 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-[1600px] mx-auto px-6 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3.5">
            <div className="flex items-center gap-2.5">
              <span className="flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-md shadow-indigo-500/30">
                <Clock size={18} />
              </span>
              <div>
                <h1 className="text-lg font-display font-bold text-slate-800 leading-tight">Campaign Activity</h1>
                <p className="text-xs text-slate-400">Budget/bid cap history, hourly ROAS, and before/after comparisons</p>
              </div>
            </div>
            <div className="flex items-center gap-2.5">
              {canCompare && (
                <button type="button" className="btn btn-primary btn-sm" onClick={openCompare}>
                  <GitCompareArrows size={14} /> Compare Before/After
                </button>
              )}
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setStack((s) => [...s])}
                disabled={viewLoading}
                title="Refresh this view"
              >
                <RefreshCw size={14} className={viewLoading ? "animate-spin" : ""} />
                {viewLoading ? "Loading…" : "Refresh"}
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

            <AccountsPicker
              accounts={adAccounts}
              selected={selectedAccounts}
              loading={loadingAccounts}
              onToggle={toggleAccount}
              onSelectAll={selectAllAccounts}
              onClear={clearAccounts}
            />

            {atRoot && (
              <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
                <button
                  type="button"
                  onClick={() => setMode("time")}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    mode === "time" ? "bg-white text-blue-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
                  }`}
                  title="Date → Day → Hour → Campaign → Ad Set → Ad → Orders"
                >
                  <LayoutList size={13} /> Time-Based
                </button>
                <button
                  type="button"
                  onClick={() => setMode("campaign")}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    mode === "campaign" ? "bg-white text-blue-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
                  }`}
                  title="Date → Day → Campaign → Hour → Ad Set → Ad → Orders"
                >
                  <Compass size={13} /> Campaign-Based
                </button>
              </div>
            )}
          </div>

          {atRoot ? (
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
          ) : (
            <div className="flex items-center gap-1.5 text-xs flex-wrap">
              {stack.map((s, i) => (
                <span key={i} className="flex items-center gap-1.5">
                  {i > 0 && <ChevronRight size={12} className="text-slate-300" />}
                  <button
                    type="button"
                    onClick={() => goToBreadcrumb(i)}
                    className={i === stack.length - 1 ? "font-semibold text-slate-700" : "text-slate-400 hover:text-indigo-600"}
                  >
                    {s.label}
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="max-w-[1600px] mx-auto px-6 pt-6">
        {viewError && <ErrorState message={viewError} onRetry={() => setStack((s) => [...s])} />}

        {!viewError && viewLoading && !viewData && <SkeletonBlock />}

        {!viewError && viewData && (
          <>
            {viewData.summary && (
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3.5 mb-6">
                <RangeStat label="Spend" value={viewData.summary.spend} kind="currency" />
                <RangeStat label="Revenue" value={viewData.summary.revenue} kind="currency" />
                <RangeStat label="ROAS" value={viewData.summary.roas} kind="multiplier" />
                <RangeStat label="Orders" value={viewData.summary.orders} kind="number" />
                <RangeStat label="Prepaid" value={viewData.summary.prepaidOrders} kind="number" />
                <RangeStat label="COD" value={viewData.summary.codOrders} kind="number" />
              </div>
            )}

            {(viewData.metaSpendAvailable === false || viewData.metaHourlyAvailable === false) && (
              <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mb-4">
                <AlertTriangle size={14} />
                Meta spend data couldn't be fetched for part of this view{viewData.metaSpendError || viewData.metaHourlyError ? `: ${viewData.metaSpendError || viewData.metaHourlyError}` : "."}
                {" "}Orders/revenue figures below are still accurate.
              </div>
            )}

            {top.view === "daily" && <DailyActivityTable days={viewData.days} onOpenDay={openDay} />}

            {top.view === "account-hourly" && (
              <HourlyActivityTable hours={viewData.hours} mode="account" onOpenChildren={openHourChildren} onOpenOrders={openOrders} />
            )}

            {top.view === "hour-campaigns" && (
              <CampaignsTable
                campaigns={viewData.campaigns}
                activeField="isActive"
                tokenId={TOKEN_ID}
                since={top.date}
                until={top.date}
                onOpenCampaign={openCampaign}
              />
            )}

            {top.view === "day-campaigns" && (
              <CampaignsTable
                campaigns={viewData.campaigns}
                activeField="isActiveToday"
                tokenId={TOKEN_ID}
                since={top.date}
                until={top.date}
                onOpenCampaign={openCampaign}
              />
            )}

            {top.view === "campaign-hourly" && (
              <HourlyActivityTable hours={viewData.hours} mode="campaign" onOpenChildren={openHourChildren} onOpenOrders={openOrders} />
            )}

            {top.view === "campaign-hour-adsets" && (
              <ChildrenTable
                children={viewData.children}
                childLevel="adset"
                tokenId={TOKEN_ID}
                since={top.date}
                until={top.date}
                campaignId={top.campaignId}
                campaignName={top.campaignName}
                onOpenChild={openChild}
              />
            )}

            {top.view === "adset-hourly" && (
              <HourlyActivityTable hours={viewData.hours} mode="adset" onOpenChildren={openHourChildren} onOpenOrders={openOrders} />
            )}

            {top.view === "adset-hour-ads" && (
              <ChildrenTable
                children={viewData.children}
                childLevel="ad"
                tokenId={TOKEN_ID}
                since={top.date}
                until={top.date}
                campaignId={top.campaignId}
                campaignName={top.campaignName}
                adsetId={top.adsetId}
                adsetName={top.adsetName}
                onOpenChild={openChild}
              />
            )}

            {top.view === "ad-hourly" && <HourlyActivityTable hours={viewData.hours} mode="ad" onOpenChildren={openHourChildren} onOpenOrders={openOrders} />}
          </>
        )}

        {!viewError && !viewLoading && !viewData && (
          <div className="text-sm text-slate-400">
            {selectedAccounts.length === 0 ? "Select at least one ad account above to load Campaign Activity." : "Loading…"}
          </div>
        )}
      </div>

      <HourOrdersPopup
        open={!!ordersPopup}
        tokenId={TOKEN_ID}
        date={ordersPopup?.date}
        hour={ordersPopup?.hour}
        scopeLabel={ordersPopup?.scopeLabel}
        campaignId={ordersPopup?.campaignId}
        campaignName={ordersPopup?.campaignName}
        adsetId={ordersPopup?.adsetId}
        adId={ordersPopup?.adId}
        onClose={() => setOrdersPopup(null)}
      />

      <ComparisonPanel
        open={!!comparePanel}
        tokenId={TOKEN_ID}
        entityType={comparePanel?.entityType}
        entityId={comparePanel?.entityId}
        campaignId={comparePanel?.campaignId}
        campaignName={comparePanel?.campaignName}
        entityName={comparePanel?.entityName}
        date={comparePanel?.date}
        defaultBoundaryHour={comparePanel?.defaultBoundaryHour}
        onClose={() => setComparePanel(null)}
      />
    </div>
  );
}

function RangeStat({ label, value, kind }) {
  const display =
    kind === "currency" ? currency(value) : kind === "multiplier" ? multiplier(value) : number(value);
  return (
    <div className="card !p-3.5">
      <div className="text-[11px] text-slate-500 mb-0.5">{label}</div>
      <div className="text-lg font-display font-bold text-slate-800 truncate">{display}</div>
    </div>
  );
}

function SkeletonBlock() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3.5">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="card !p-3.5">
            <div className="h-3 w-16 bg-slate-100 rounded animate-pulse mb-2" />
            <div className="h-5 w-14 bg-slate-100 rounded animate-pulse" />
          </div>
        ))}
      </div>
      <div className="card h-96 animate-pulse bg-slate-100" />
    </div>
  );
}

function ErrorState({ message, onRetry }) {
  return (
    <div className="card border-rose-200 bg-rose-50/60 flex flex-col items-center text-center py-12 px-6 mb-8">
      <span className="flex items-center justify-center w-12 h-12 rounded-2xl bg-rose-100 text-rose-600 mb-3">
        <AlertTriangle size={22} />
      </span>
      <h3 className="font-display font-semibold text-rose-700 mb-1">Couldn't load Campaign Activity</h3>
      <p className="text-sm text-rose-500 mb-4 max-w-md">{message}</p>
      <button className="btn btn-primary btn-sm" onClick={onRetry}>
        <RefreshCw size={14} /> Try again
      </button>
    </div>
  );
}

// Duplicated locally from DailyPage.jsx's own AccountsPicker (same
// "zero coupling" convention — see this file's header) rather than
// importing it across pages.
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
