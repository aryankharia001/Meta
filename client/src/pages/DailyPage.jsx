import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Building2, ChevronDown, RefreshCw, AlertTriangle, LayoutList, Columns3 } from "lucide-react";
import { fetchLiveAdAccounts, fetchDailyReport } from "../lib/api";
import { useSelectedToken } from "../lib/useSelectedToken";
import { todayIso, shiftDays } from "../lib/dateIst";
import DailyTable from "../components/daily/DailyTable";
import DailyDrawer from "../components/daily/DailyDrawer";
import DailyHourlyDrawer from "../components/daily/DailyHourlyDrawer";
import CampaignPicker from "../components/daily/CampaignPicker";
import DailyCompareView from "../components/daily/DailyCompareView";

// ────────────────────────────────────────────────────────────────
// Phase 10 — Daily page. A dedicated top-level tab, separate from
// Dashboard/Campaign Explorer/Analytics, giving a day-by-day campaign
// performance report instead of a single range-wide total. Built on
// the new, additive GET /api/daily/:tokenId (see dailyReports.js) —
// never touches /compare, Campaign Explorer, live sync, or matching.
//
// Date range selection intentionally mirrors Dashboard.jsx's own
// preset pattern (same IST-day convention, same custom-range inputs)
// so it feels like a natural extension of the rest of the app rather
// than a bolted-on new UI language.
// ────────────────────────────────────────────────────────────────

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

export default function DailyPage() {
  const { tokenId: TOKEN_ID, setTokenId, tokens } = useSelectedToken();

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

  const [drawerMeta, setDrawerMeta] = useState(null);
  // Phase 15 §1/§13 — separate from drawerMeta above (which is scoped to
  // one campaign+date, opened from a campaign row inside an expanded
  // day). This one is scoped to the whole date across every campaign in
  // the currently selected accounts, opened by clicking the date row
  // itself. Reuses whatever accounts/token are already selected on this
  // page, so it automatically respects the existing Daily filters.
  const [hourlyDrawerMeta, setHourlyDrawerMeta] = useState(null);

  // ── Campaign selection & comparison mode ──────────────────────
  // Empty selection = "All Campaigns" (the default, unfiltered view).
  // Derived from whatever's already loaded in `data` — every campaign
  // active in the current range is already in there (see
  // dailyReports.js), so no extra fetch is needed just to list them.
  const [selectedCampaignKeys, setSelectedCampaignKeys] = useState(new Set());
  const [viewMode, setViewMode] = useState("table"); // "table" | "compare"

  const campaignOptions = useMemo(() => {
    if (!data) return [];
    const map = new Map();
    data.days.forEach((d) => {
      d.campaigns.forEach((c) => {
        const key = c.campaignId || "unmatched";
        if (!map.has(key)) map.set(key, { key, campaignId: c.campaignId, campaignName: c.campaignName });
      });
    });
    return [...map.values()].sort((a, b) => (a.campaignName || "").localeCompare(b.campaignName || ""));
  }, [data]);

  // Drop any selected campaign that no longer appears once the data
  // reloads (new date range / accounts) instead of silently filtering
  // everything down to nothing.
  useEffect(() => {
    if (!data) return;
    setSelectedCampaignKeys((prev) => {
      if (prev.size === 0) return prev;
      const validKeys = new Set(campaignOptions.map((o) => o.key));
      const next = new Set([...prev].filter((k) => validKeys.has(k)));
      return next.size === prev.size ? prev : next;
    });
  }, [campaignOptions, data]);

  useEffect(() => {
    if (viewMode === "compare" && selectedCampaignKeys.size < 2) setViewMode("table");
  }, [viewMode, selectedCampaignKeys]);

  const filteredDays = useMemo(() => {
    if (!data) return [];
    if (selectedCampaignKeys.size === 0) return data.days;
    return data.days
      .map((d) => ({ ...d, campaigns: d.campaigns.filter((c) => selectedCampaignKeys.has(c.campaignId || "unmatched")) }))
      .filter((d) => d.campaigns.length > 0);
  }, [data, selectedCampaignKeys]);

  // Range-summary cards reflect whatever campaign selection is active,
  // not always the full unfiltered range total.
  const filteredTotals = useMemo(() => {
    if (!data) return null;
    if (selectedCampaignKeys.size === 0) return data.totals;
    const rows = filteredDays.flatMap((d) => d.campaigns);
    const sum = (k) => rows.reduce((s, r) => s + Number(r[k] || 0), 0);
    const spend = sum("spend");
    const revenue = sum("revenue");
    return { spend, revenue, roas: spend ? revenue / spend : 0, orders: sum("orders"), codOrders: sum("codOrders"), prepaidOrders: sum("prepaidOrders") };
  }, [data, filteredDays, selectedCampaignKeys]);

  const toggleCampaign = (key) =>
    setSelectedCampaignKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const selectAllCampaigns = (keys) => setSelectedCampaignKeys(new Set(keys));
  const clearCampaigns = () => setSelectedCampaignKeys(new Set());

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

  const load = () => {
    if (!TOKEN_ID || selectedAccounts.length === 0) return;
    setLoading(true);
    setError("");
    fetchDailyReport(TOKEN_ID, { accountIds: selectedAccounts, since, until })
      .then((res) => {
        setData(res);
        setLastFetchedAt(new Date());
      })
      .catch((err) => setError(err.message || "Failed to load the daily report"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [TOKEN_ID, selectedAccounts, since, until]);

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

  const openRow = (row) => {
    setDrawerMeta({
      tokenId: TOKEN_ID,
      date: row.date,
      campaignId: row.campaignId,
      campaignName: row.campaignName,
      accountId: row.accountId,
      isUnmatched: row.isUnmatched,
    });
  };

  const openDate = (date) => {
    setHourlyDrawerMeta({ tokenId: TOKEN_ID, date, accountIds: selectedAccounts });
  };

  return (
    <div className="min-h-screen pb-16">
      <div className="sticky top-0 z-20 bg-white/85 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-[1600px] mx-auto px-6 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3.5">
            <div className="flex items-center gap-2.5">
              <span className="flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-md shadow-indigo-500/30">
                <CalendarDays size={18} />
              </span>
              <div>
                <h1 className="text-lg font-display font-bold text-slate-800 leading-tight">Daily</h1>
                <p className="text-xs text-slate-400">Day-by-day campaign performance, one 24-hour window at a time</p>
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              {lastFetchedAt && (
                <span className="text-xs text-slate-400">Updated {lastFetchedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
              )}
              <button className="btn btn-secondary btn-sm" onClick={load} disabled={loading}>
                <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
                {loading ? "Loading…" : "Refresh"}
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

            <CampaignPicker
              options={campaignOptions}
              selected={selectedCampaignKeys}
              onToggle={toggleCampaign}
              onSelectAll={selectAllCampaigns}
              onClear={clearCampaigns}
            />

            <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
              <button
                type="button"
                onClick={() => setViewMode("table")}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  viewMode === "table" ? "bg-white text-blue-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                <LayoutList size={13} /> Table
              </button>
              <button
                type="button"
                onClick={() => selectedCampaignKeys.size >= 2 && setViewMode("compare")}
                disabled={selectedCampaignKeys.size < 2}
                title={selectedCampaignKeys.size < 2 ? "Select 2+ campaigns to compare" : "Compare selected campaigns side-by-side, per date"}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                  viewMode === "compare" ? "bg-white text-blue-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                <Columns3 size={13} /> Compare
              </button>
            </div>
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
              {since === until ? since : `${since} → ${until}`}
              {data ? ` · ${filteredDays.length} day${filteredDays.length === 1 ? "" : "s"}` : ""}
              {selectedCampaignKeys.size > 0 ? ` · ${selectedCampaignKeys.size} campaign${selectedCampaignKeys.size === 1 ? "" : "s"} selected` : ""}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-[1600px] mx-auto px-6 pt-6">
        {error && <ErrorState message={error} onRetry={load} />}

        {!error && loading && !data && <SkeletonBlock />}

        {!error && data && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3.5 mb-6">
              <RangeStat label="Spend" value={filteredTotals.spend} kind="currency" />
              <RangeStat label="Revenue" value={filteredTotals.revenue} kind="currency" />
              <RangeStat label="ROAS" value={filteredTotals.roas} kind="multiplier" />
              <RangeStat label="Orders" value={filteredTotals.orders} kind="number" />
              <RangeStat label="COD Orders" value={filteredTotals.codOrders} kind="number" />
              <RangeStat label="Prepaid Orders" value={filteredTotals.prepaidOrders} kind="number" />
            </div>

            {viewMode === "compare" ? (
              <DailyCompareView days={filteredDays} onOpenRow={openRow} />
            ) : (
              <DailyTable days={filteredDays} onOpenRow={openRow} onOpenDate={openDate} />
            )}
          </>
        )}

        {!error && !loading && !data && (
          <div className="text-sm text-slate-400">
            {selectedAccounts.length === 0 ? "Select at least one ad account above to load the daily report." : "Loading…"}
          </div>
        )}
      </div>

      <DailyDrawer meta={drawerMeta} onClose={() => setDrawerMeta(null)} />
      <DailyHourlyDrawer meta={hourlyDrawerMeta} onClose={() => setHourlyDrawerMeta(null)} />
    </div>
  );
}

function RangeStat({ label, value, kind }) {
  const display =
    kind === "currency"
      ? `₹${Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : kind === "multiplier"
      ? `${Number(value || 0).toFixed(2)}x`
      : Number(value || 0).toLocaleString("en-IN");
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
      <h3 className="font-display font-semibold text-rose-700 mb-1">Couldn't load the daily report</h3>
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
