import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { Images, RefreshCw } from "lucide-react";
import { fetchAds, fetchLiveAdAccounts } from "../lib/api";
import { getCachedAdExplorer, setCachedAdExplorer, adExplorerCacheKey } from "../lib/adExplorerCache";
import { useSwrFetch } from "../lib/useSwr";
import LastUpdatedIndicator from "../components/LastUpdatedIndicator";
import { useSelectedToken } from "../lib/useSelectedToken";
import { useAdDrawer } from "../lib/AdDrawerContext";
import { todayIso, shiftDays } from "../lib/dateIst";
import DataTable from "../components/DataTable";
import { AdNameCell } from "../components/AdCells";
import { AD_COLUMNS, AD_DEFAULT_HIDDEN } from "../lib/adColumns";
import { currency, number } from "../lib/format";

// Phase 18 (part 2) — same "fast-moving campaign-adjacent data" reasoning
// as Ad Set Explorer.
const AD_STALE_MS = 45000;

// ─────────────────────────────────────────────────────────────
// Phase 13 §5 — Ad Explorer. Same shape as AdSetExplorerPage.jsx, one
// level deeper. Supports being deep-linked with ?campaignId=&adsetId=
// (e.g. from an Ad Set Drawer's "View Ads" action) via the URL's query
// string, read once on mount — doesn't fight the user if they change the
// filter afterwards.
// ─────────────────────────────────────────────────────────────

const PRESETS = [
  { key: "today", label: "Today", range: () => ({ since: todayIso(), until: todayIso() }) },
  { key: "yesterday", label: "Yesterday", range: () => { const y = shiftDays(todayIso(), -1); return { since: y, until: y }; } },
  { key: "7d", label: "Last 7 Days", range: () => ({ since: shiftDays(todayIso(), -6), until: todayIso() }) },
  { key: "30d", label: "Last 30 Days", range: () => ({ since: shiftDays(todayIso(), -29), until: todayIso() }) },
  { key: "custom", label: "Custom Range", range: null },
];

export default function AdExplorerPage() {
  const { tokenId: TOKEN_ID, setTokenId, tokens } = useSelectedToken();
  const { openAd } = useAdDrawer();
  const location = useLocation();

  const initialParams = useMemo(() => new URLSearchParams(location.search), []);
  const [campaignIdFilter] = useState(initialParams.get("campaignId") || "");
  const [adsetIdFilter] = useState(initialParams.get("adsetId") || "");

  const [adAccounts, setAdAccounts] = useState([]);
  const [selectedAccounts, setSelectedAccounts] = useState([]);
  const [presetKey, setPresetKey] = useState("today");
  const [customSince, setCustomSince] = useState(todayIso());
  const [customUntil, setCustomUntil] = useState(todayIso());
  const { since, until } = useMemo(() => {
    if (presetKey === "custom") return { since: customSince, until: customUntil };
    return (PRESETS.find((p) => p.key === presetKey) || PRESETS[0]).range();
  }, [presetKey, customSince, customUntil]);

  const [paymentFilter, setPaymentFilter] = useState("");
  const [matchFilter, setMatchFilter] = useState("");

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
    return () => { cancelled = true; };
  }, [TOKEN_ID]);

  // Phase 18 (part 2) — real SWR.
  const adCacheKey =
    TOKEN_ID && selectedAccounts.length > 0
      ? adExplorerCacheKey(TOKEN_ID, selectedAccounts, since, until, campaignIdFilter, adsetIdFilter)
      : null;
  const {
    data,
    loading,
    isValidating,
    error,
    backgroundError,
    lastUpdatedAt,
    refresh,
  } = useSwrFetch(
    adCacheKey,
    () => fetchAds(TOKEN_ID, { accountIds: selectedAccounts, since, until, campaignId: campaignIdFilter || undefined, adsetId: adsetIdFilter || undefined }),
    {
      staleTimeMs: AD_STALE_MS,
      getCached: () => getCachedAdExplorer(TOKEN_ID, selectedAccounts, since, until, campaignIdFilter, adsetIdFilter),
      setCached: (d) => setCachedAdExplorer(TOKEN_ID, selectedAccounts, since, until, campaignIdFilter, adsetIdFilter, d),
    }
  );

  const rows = useMemo(() => {
    let list = data?.ads || [];
    if (paymentFilter === "COD") list = list.filter((a) => a.codOrders > 0);
    if (paymentFilter === "PREPAID") list = list.filter((a) => a.prepaidOrders > 0);
    if (matchFilter === "matched") list = list.filter((a) => a.totalOrders > 0);
    if (matchFilter === "unmatched") list = list.filter((a) => a.totalOrders === 0);
    return list;
  }, [data, paymentFilter, matchFilter]);

  const columns = useMemo(
    () =>
      AD_COLUMNS.map((c) =>
        c.key === "adName"
          ? {
              ...c,
              render: (r) => (
                <AdNameCell
                  tokenId={TOKEN_ID}
                  adId={r.adId}
                  adName={r.adName}
                  adsetId={r.adsetId}
                  adsetName={r.adsetName}
                  campaignId={r.campaignId}
                  campaignName={r.campaignName}
                  since={since}
                  until={until}
                  status={r.effectiveStatus || r.status}
                  thumbnailUrl={r.thumbnailUrl}
                />
              ),
            }
          : c
      ),
    [TOKEN_ID, since, until]
  );

  return (
    <div className="max-w-[1600px] mx-auto p-6">
      <div className="flex items-center gap-2 mb-1">
        <Images size={18} className="text-indigo-500" />
        <h1 className="text-xl font-semibold text-slate-800">Ad Explorer</h1>
      </div>
      <p className="text-sm text-slate-500 mb-5">
        Ad Set → Ad performance, creative thumbnails, and order attribution.
        {(campaignIdFilter || adsetIdFilter) && <span className="ml-2 badge badge-blue">Filtered from drill-down</span>}
      </p>

      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <select className="input w-auto" value={TOKEN_ID || ""} onChange={(e) => setTokenId(e.target.value)}>
          {tokens.length === 0 && <option value={TOKEN_ID}>{TOKEN_ID}</option>}
          {tokens.map((t) => (
            <option key={t._id} value={t._id}>{t.label || t._id}</option>
          ))}
        </select>
        {PRESETS.map((p) => (
          <button key={p.key} type="button" className={`btn btn-sm ${presetKey === p.key ? "btn-primary" : "btn-secondary"}`} onClick={() => setPresetKey(p.key)}>
            {p.label}
          </button>
        ))}
        {presetKey === "custom" && (
          <>
            <input type="date" className="input w-auto !py-1.5 !text-xs" value={customSince} onChange={(e) => setCustomSince(e.target.value)} />
            <input type="date" className="input w-auto !py-1.5 !text-xs" value={customUntil} onChange={(e) => setCustomUntil(e.target.value)} />
          </>
        )}
        <button type="button" className="btn btn-secondary btn-sm" onClick={refresh} disabled={isValidating}>
          <RefreshCw size={13} className={isValidating ? "animate-spin" : ""} /> Refresh
        </button>
        <LastUpdatedIndicator lastUpdatedAt={lastUpdatedAt} isValidating={isValidating} backgroundError={backgroundError} />
      </div>

      <div className="flex items-center gap-2 mb-5 flex-wrap">
        <select className="input w-auto !py-1.5 !text-xs" value={paymentFilter} onChange={(e) => setPaymentFilter(e.target.value)}>
          <option value="">COD / Prepaid</option>
          <option value="COD">Has COD Orders</option>
          <option value="PREPAID">Has Prepaid Orders</option>
        </select>
        <select className="input w-auto !py-1.5 !text-xs" value={matchFilter} onChange={(e) => setMatchFilter(e.target.value)}>
          <option value="">Matched / Unmatched</option>
          <option value="matched">Has Orders</option>
          <option value="unmatched">No Orders</option>
        </select>
        <div className="flex flex-wrap gap-2 ml-auto">
          {adAccounts.map((a) => (
            <label key={a.id} className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border cursor-pointer ${selectedAccounts.includes(a.id) ? "bg-blue-50 border-blue-200 text-blue-700" : "bg-white border-slate-200 text-slate-600"}`}>
              <input type="checkbox" checked={selectedAccounts.includes(a.id)} onChange={() => setSelectedAccounts((prev) => (prev.includes(a.id) ? prev.filter((x) => x !== a.id) : [...prev, a.id]))} />
              {a.name}
            </label>
          ))}
        </div>
      </div>

      {error && <div className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2 mb-4">{error}</div>}

      {data?.summary && (
        <div className="flex flex-wrap gap-3 mb-5">
          <div className="card !p-3 flex-1 min-w-[140px]"><div className="text-[11px] text-slate-400 mb-0.5">Ads</div><div className="text-lg font-bold text-slate-800">{data.summary.totalAds}</div></div>
          <div className="card !p-3 flex-1 min-w-[140px]"><div className="text-[11px] text-slate-400 mb-0.5">Spend</div><div className="text-lg font-bold text-slate-800">{currency(data.summary.totalSpend)}</div></div>
          <div className="card !p-3 flex-1 min-w-[140px]"><div className="text-[11px] text-slate-400 mb-0.5">Revenue</div><div className="text-lg font-bold text-slate-800">{currency(data.summary.totalRevenue)}</div></div>
          <div className="card !p-3 flex-1 min-w-[140px]"><div className="text-[11px] text-slate-400 mb-0.5">Orders</div><div className="text-lg font-bold text-slate-800">{number(data.summary.totalOrders)}</div></div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-sm text-slate-400">Loading ads…</div>
      ) : (
        <DataTable
          tableId="adExplorer"
          columns={columns}
          data={rows}
          searchKeys={["adName", "adId", "campaignName", "adsetName"]}
          onRowClick={(r) => openAd({ tokenId: TOKEN_ID, adId: r.adId, adName: r.adName, adsetId: r.adsetId, adsetName: r.adsetName, campaignId: r.campaignId, campaignName: r.campaignName, since, until })}
          rowKey={(r) => r.adId}
          exportFilename="ads.csv"
          emptyMessage="No ads found for this selection."
          defaultHiddenKeys={AD_DEFAULT_HIDDEN}
        />
      )}
    </div>
  );
}
