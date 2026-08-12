import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Compass,
  RefreshCw,
  Search,
  X,
  SlidersHorizontal,
  Download,
  GitCompareArrows,
  Copy,
  Check,
  ChevronDown,
} from "lucide-react";
import { fetchCampaignExplorer, fetchLiveAdAccounts, fetchCampaignDetails } from "../lib/api";
import { getCachedExplorerList, setCachedExplorerList } from "../lib/campaignExplorerCache";
import { useSelectedToken } from "../lib/useSelectedToken";
import { useCampaignDrawer } from "../lib/CampaignDrawerContext";
import { useLiveSync, rangeIncludesToday } from "../lib/LiveSyncContext";
import SavedViewsControl from "../components/SavedViewsControl";
import ExplorerTable from "../components/campaignExplorer/ExplorerTable";
import LiveMonitoringSection from "../components/campaignExplorer/LiveMonitoringSection";
import ComparisonPanel from "../components/campaignExplorer/ComparisonPanel";
import MoreFiltersPanel, { DEFAULT_FILTERS, applyExplorerFilters, countActiveFilters } from "../components/campaignExplorer/MoreFiltersPanel";
import { ALL_COLUMNS } from "../lib/campaignExplorerColumns";
import { currency, number } from "../lib/format";

// ────────────────────────────────────────────────────────────────
// Phase 8 — Campaign Explorer. The new campaign-first home page,
// alongside (not replacing) Dashboard/Analytics. Built entirely on the
// new, additive /api/campaign-explorer routes — never calls
// /campaigns/:tokenId/compare, never touches sync/matching. Clicking
// any campaign opens the exact same Phase 2 CampaignDrawer every other
// page already uses.
//
// State preservation across Dashboard -> Explorer -> Drawer -> Order
// Drawer navigation: the drawers are global overlays (Phase 2/4) that
// don't unmount this page, so table scroll/pagination/expand state
// survive automatically. The primary filters that matter for "did I
// lose my place" — search, date preset/range, selected ad accounts —
// are mirrored into the URL via useSearchParams, so back/forward
// navigation and reloads restore them too; the long tail of "More
// Filters" (min revenue, ROAS, etc.) intentionally stays in local
// state rather than bloating the URL, same trade-off Phase 7's
// SavedViewsControl already makes for its own filter snapshots.
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

export default function CampaignExplorerPage() {
  const { tokenId: TOKEN_ID, setTokenId, tokens } = useSelectedToken();
  const { openCampaign } = useCampaignDrawer();
  const liveSync = useLiveSync();
  const [searchParams, setSearchParams] = useSearchParams();

  const [adAccounts, setAdAccounts] = useState([]);
  const [selectedAccounts, setSelectedAccounts] = useState(() => {
    const fromUrl = searchParams.get("accounts");
    return fromUrl ? fromUrl.split(",").filter(Boolean) : [];
  });

  const [presetKey, setPresetKey] = useState(searchParams.get("preset") || "today");
  const [customSince, setCustomSince] = useState(searchParams.get("since") || todayIso());
  const [customUntil, setCustomUntil] = useState(searchParams.get("until") || todayIso());
  const { since, until } = useMemo(() => {
    if (presetKey === "custom") return { since: customSince, until: customUntil };
    return (PRESETS.find((p) => p.key === presetKey) || PRESETS[0]).range();
  }, [presetKey, customSince, customUntil]);

  const [search, setSearch] = useState(searchParams.get("q") || "");
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastFetchedAt, setLastFetchedAt] = useState(null);

  const [selectedIds, setSelectedIds] = useState(new Set());
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const [copiedIds, setCopiedIds] = useState(false);
  const [exportingOrders, setExportingOrders] = useState(false);

  // Keep the URL in sync with the filters that matter for "don't lose my
  // place" navigation — doesn't fire on every keystroke re-render since
  // it's only these primitives, not the whole filters object.
  useEffect(() => {
    const params = new URLSearchParams();
    if (search) params.set("q", search);
    params.set("preset", presetKey);
    if (presetKey === "custom") {
      params.set("since", customSince);
      params.set("until", customUntil);
    }
    if (selectedAccounts.length) params.set("accounts", selectedAccounts.join(","));
    setSearchParams(params, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, presetKey, customSince, customUntil, selectedAccounts]);

  // ── Ad accounts ──────────────────────────────────────────────
  useEffect(() => {
    if (!TOKEN_ID) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchLiveAdAccounts(TOKEN_ID);
        const list = res.success ? res.adAccounts || [] : [];
        if (cancelled) return;
        setAdAccounts(list);
        setSelectedAccounts((prev) => (prev.length > 0 ? prev : list.map((a) => a.id)));
      } catch {
        if (!cancelled) setAdAccounts([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [TOKEN_ID]);

  // ── Main list fetch ──────────────────────────────────────────
  const load = ({ force = false } = {}) => {
    if (!TOKEN_ID || selectedAccounts.length === 0) return;
    if (!force) {
      const cached = getCachedExplorerList(TOKEN_ID, selectedAccounts, since, until);
      if (cached) {
        setData(cached);
        setLastFetchedAt(new Date());
        return;
      }
    }
    setLoading(true);
    setError("");
    fetchCampaignExplorer(TOKEN_ID, { accountIds: selectedAccounts, since, until })
      .then((res) => {
        setData(res);
        setCachedExplorerList(TOKEN_ID, selectedAccounts, since, until, res);
        setLastFetchedAt(new Date());
      })
      .catch((err) => setError(err.message || "Failed to load campaigns"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [TOKEN_ID, selectedAccounts.join(","), since, until]);

  // Phase 5-style background refresh: if a live sync tick found new
  // orders and this page's date range includes today, silently re-fetch
  // (bypassing cache) so the table reflects them without the user
  // clicking Refresh — same rangeIncludesToday guard Dashboard uses.
  useEffect(() => {
    if (!rangeIncludesToday(since, until, todayIso())) return;
    load({ force: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveSync.syncVersion]);

  // ── Filtering + search (client-side, over the fetched set) ──────
  const searched = useMemo(() => {
    const campaigns = data?.campaigns || [];
    const q = search.trim().toLowerCase();
    if (!q) return campaigns;
    return campaigns.filter(
      (c) => c.campaignName?.toLowerCase().includes(q) || c.campaignId?.includes(q) || c.accountName?.toLowerCase().includes(q)
    );
  }, [data, search]);

  const filteredCampaigns = useMemo(() => applyExplorerFilters(searched, filters), [searched, filters]);

  const filterOptions = useMemo(() => {
    const campaigns = data?.campaigns || [];
    const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort();
    return {
      statuses: uniq(campaigns.map((c) => c.effectiveStatus || c.status)),
      objectives: uniq(campaigns.map((c) => c.objective)),
      accounts: adAccounts.map((a) => ({ id: a.id, name: a.name || a.id })),
    };
  }, [data, adAccounts]);

  const activeFilterCount = countActiveFilters(filters);

  // ── Selection ────────────────────────────────────────────────
  const toggleSelect = (campaignId) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(campaignId)) next.delete(campaignId);
      else next.add(campaignId);
      return next;
    });
  const toggleSelectAll = (pageIds) =>
    setSelectedIds((prev) => {
      const allSelected = pageIds.every((id) => prev.has(id));
      const next = new Set(prev);
      pageIds.forEach((id) => (allSelected ? next.delete(id) : next.add(id)));
      return next;
    });
  const selectedCampaigns = filteredCampaigns.filter((c) => selectedIds.has(c.campaignId));

  // ExplorerTable hands over a bare campaign row (no tokenId/date range of
  // its own — those are implicit in this page's own filters), so those
  // fall back to the page's currently selected token/range. LiveMonitoringSection,
  // by contrast, already builds a full context object scoped to "today"
  // (its rows aren't from this page's selected range) — that's respected
  // as-is rather than silently overwritten with the wrong date range.
  const handleOpenCampaign = (c) => {
    openCampaign({
      tokenId: c.tokenId || TOKEN_ID,
      campaignId: c.campaignId,
      campaignName: c.campaignName,
      accountId: c.accountId,
      accountName: c.accountName,
      since: c.since || since,
      until: c.until || until,
    });
  };

  const copyCampaignIds = async () => {
    const ids = (selectedCampaigns.length ? selectedCampaigns : filteredCampaigns).map((c) => c.campaignId).join("\n");
    try {
      await navigator.clipboard.writeText(ids);
      setCopiedIds(true);
      setTimeout(() => setCopiedIds(false), 1500);
    } catch {
      // clipboard permission denied — silently ignore
    }
  };

  // ── Exports ──────────────────────────────────────────────────
  const exportScope = () => (selectedCampaigns.length ? selectedCampaigns : filteredCampaigns);

  const exportSummary = () => {
    const rows = [
      ["Campaign Name", "Campaign ID", "Ad Account", "Objective", "Status", "Start Date", "End Date"],
      ...exportScope().map((c) => [c.campaignName, c.campaignId, c.accountName, c.objective || "N/A", c.effectiveStatus || c.status || "N/A", c.startTime || "N/A", c.stopTime || "N/A"]),
    ];
    downloadCsv("campaign-summary.csv", rows);
  };

  const exportPerformance = () => {
    const rows = [ALL_COLUMNS.map((col) => col.label), ...exportScope().map((c) => ALL_COLUMNS.map((col) => (col.render ? col.render(c) : c[col.key])))];
    downloadCsv("campaign-performance.csv", rows);
  };

  const exportOrders = async () => {
    setExportingOrders(true);
    try {
      const scope = exportScope();
      const rows = [["Campaign", "Order ID", "Customer", "Phone", "Amount", "Payment Type", "Status", "Order Date"]];
      for (const c of scope) {
        const res = await fetchCampaignDetails(TOKEN_ID, c.campaignId, { campaignName: c.campaignName, accountId: c.accountId, since, until });
        (res.orders || []).forEach((o) => {
          rows.push([c.campaignName, o.orderId, o.customerName || "N/A", o.phone || "N/A", o.totalAmountPayable, o.paymentType || "N/A", o.deliveryStatus || o.orderStatus || "N/A", o.orderDate]);
        });
      }
      downloadCsv("campaign-orders.csv", rows);
    } catch (err) {
      setError(err.message || "Failed to export campaign orders");
    } finally {
      setExportingOrders(false);
    }
  };

  const isEmpty = !loading && data && filteredCampaigns.length === 0;

  return (
    <div className="min-h-screen pb-16">
      <div className="max-w-[1700px] mx-auto px-6 pt-6">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-5">
          <div className="flex items-center gap-2.5">
            <span className="flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-md shadow-indigo-500/30">
              <Compass size={18} />
            </span>
            <div>
              <h1 className="text-lg font-display font-bold text-slate-800 leading-tight">Campaign Explorer</h1>
              <p className="text-xs text-slate-400">Every campaign, combining Meta and Shiprocket in one place</p>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            {lastFetchedAt && (
              <span className="text-xs text-slate-400">Updated {lastFetchedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
            )}
            <SavedViewsControl
              page="campaign-explorer"
              getFilters={() => ({ presetKey, customSince, customUntil, selectedAccounts, search })}
              applyFilters={(f) => {
                if (f.presetKey) setPresetKey(f.presetKey);
                if (f.customSince) setCustomSince(f.customSince);
                if (f.customUntil) setCustomUntil(f.customUntil);
                if (Array.isArray(f.selectedAccounts)) setSelectedAccounts(f.selectedAccounts);
                if (f.search !== undefined) setSearch(f.search);
              }}
            />
            <button className="btn btn-secondary btn-sm" onClick={() => load({ force: true })} disabled={loading}>
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> {loading ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>

        <LiveMonitoringSection tokenId={TOKEN_ID} accountIds={selectedAccounts} onOpenCampaign={handleOpenCampaign} />

        {/* ── Filter bar ─────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-2.5 mb-3.5">
          <div className="relative flex-1 min-w-[240px] max-w-md">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className="input pl-9 pr-8" placeholder="Search campaign name, ID, or ad account…" value={search} onChange={(e) => setSearch(e.target.value)} />
            {search && (
              <button type="button" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600" onClick={() => setSearch("")}>
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

          <div className="relative">
            <button type="button" className={`btn btn-secondary btn-sm ${activeFilterCount ? "!border-blue-300 !text-blue-700" : ""}`} onClick={() => setMoreFiltersOpen((o) => !o)}>
              <SlidersHorizontal size={13} /> More Filters {activeFilterCount ? `(${activeFilterCount})` : ""}
            </button>
            {moreFiltersOpen && (
              <MoreFiltersPanel filters={filters} onChange={setFilters} options={filterOptions} onClose={() => setMoreFiltersOpen(false)} onClear={() => setFilters(DEFAULT_FILTERS)} />
            )}
          </div>

          <div className="relative ml-auto">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setExportMenuOpen((o) => !o)}>
              <Download size={13} /> Export <ChevronDown size={11} />
            </button>
            {exportMenuOpen && (
              <div className="absolute right-0 mt-1 w-56 bg-white border border-slate-200 rounded-lg shadow-lg py-1 z-30" onMouseLeave={() => setExportMenuOpen(false)}>
                <button type="button" onClick={exportSummary} className="w-full text-left px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">
                  Campaign Summary (CSV)
                </button>
                <button type="button" onClick={exportPerformance} className="w-full text-left px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">
                  Campaign Performance (CSV)
                </button>
                <button type="button" onClick={exportOrders} disabled={exportingOrders} className="w-full text-left px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">
                  {exportingOrders ? "Exporting orders…" : "Campaign Orders (CSV)"}
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 mb-4">
          <div className="flex gap-1 bg-slate-100 rounded-lg p-1 flex-wrap">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => setPresetKey(p.key)}
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
            {since === until ? since : `${since} → ${until}`} · {filteredCampaigns.length} of {data?.campaigns?.length ?? 0} campaigns
          </div>
        </div>

        {/* ── Summary strip ──────────────────────────────────── */}
        {data && (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 mb-4">
            <SummaryChip label="Campaigns" value={number(data.summary.totalCampaigns)} />
            <SummaryChip label="Total Spend" value={currency(data.summary.totalSpend)} />
            <SummaryChip label="Total Revenue" value={currency(data.summary.totalRevenue)} />
            <SummaryChip label="Total Profit" value={currency(data.summary.totalProfit)} />
            <SummaryChip label="Avg ROAS" value={`${data.summary.averageROAS.toFixed(2)}x`} />
            <SummaryChip label="Unmatched Orders" value={number(data.summary.unmatchedOrders)} />
          </div>
        )}

        {/* ── Bulk action bar ─────────────────────────────────── */}
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-2.5 mb-3 card !py-2.5 !px-4 bg-indigo-50 border-indigo-200">
            <span className="text-xs font-medium text-indigo-700">{selectedIds.size} selected</span>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setComparisonOpen(true)} disabled={selectedIds.size < 2}>
              <GitCompareArrows size={13} /> Compare Selected
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={exportPerformance}>
              <Download size={13} /> Export Selected
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={copyCampaignIds}>
              {copiedIds ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />} Copy Campaign IDs
            </button>
            <button type="button" className="text-xs text-indigo-500 hover:underline ml-auto" onClick={() => setSelectedIds(new Set())}>
              Clear selection
            </button>
          </div>
        )}

        {error && <div className="card text-sm text-rose-600 mb-4">{error}</div>}

        {!error && loading && !data && (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="card h-11 animate-pulse bg-slate-100" />
            ))}
          </div>
        )}

        {!error && isEmpty && (
          <div className="card flex flex-col items-center justify-center py-16 text-center">
            <span className="flex items-center justify-center w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 mb-3">
              <Compass size={22} />
            </span>
            <div className="text-sm text-slate-500 mb-1">No campaigns match your filters</div>
            <p className="text-xs text-slate-400">Try widening the date range or clearing a filter.</p>
          </div>
        )}

        {!error && data && filteredCampaigns.length > 0 && (
          <ExplorerTable
            campaigns={filteredCampaigns}
            tokenId={TOKEN_ID}
            since={since}
            until={until}
            onOpenCampaign={handleOpenCampaign}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
            onToggleSelectAll={toggleSelectAll}
          />
        )}
      </div>

      {comparisonOpen && <ComparisonPanel campaigns={selectedCampaigns} onClose={() => setComparisonOpen(false)} />}
    </div>
  );
}

function SummaryChip({ label, value }) {
  return (
    <div className="card !p-3.5">
      <div className="text-[11px] text-slate-400 mb-0.5">{label}</div>
      <div className="text-base font-display font-bold text-slate-800 truncate">{value}</div>
    </div>
  );
}
