import { useEffect, useMemo, useState } from "react";
import { Layers, RefreshCw } from "lucide-react";
import { fetchAdSets, fetchLiveAdAccounts } from "../lib/api";
import { useSelectedToken } from "../lib/useSelectedToken";
import { useAdSetDrawer } from "../lib/AdSetDrawerContext";
import { todayIso, shiftDays } from "../lib/dateIst";
import DataTable from "../components/DataTable";
import { AdSetNameCell } from "../components/AdSetCells";
import { AD_SET_COLUMNS, AD_SET_DEFAULT_HIDDEN } from "../lib/adSetColumns";
import { currency, number } from "../lib/format";

// ─────────────────────────────────────────────────────────────
// Phase 13 §4 — Ad Set Explorer. Entirely new page, built on the new
// /api/adset-explorer routes only. Same date-preset/account-picker shape
// Campaign Explorer already established, and the shared DataTable/
// useColumnPrefs/ColumnSettingsMenu system for full column customization
// (§17) instead of Campaign Explorer's own hand-rolled ExplorerTable —
// this page doesn't need pinning/multi-select/expand, so the simpler,
// genuinely reusable primitive is the right fit.
// ─────────────────────────────────────────────────────────────

const PRESETS = [
  { key: "today", label: "Today", range: () => ({ since: todayIso(), until: todayIso() }) },
  { key: "yesterday", label: "Yesterday", range: () => { const y = shiftDays(todayIso(), -1); return { since: y, until: y }; } },
  { key: "7d", label: "Last 7 Days", range: () => ({ since: shiftDays(todayIso(), -6), until: todayIso() }) },
  { key: "30d", label: "Last 30 Days", range: () => ({ since: shiftDays(todayIso(), -29), until: todayIso() }) },
  { key: "custom", label: "Custom Range", range: null },
];

export default function AdSetExplorerPage() {
  const { tokenId: TOKEN_ID, setTokenId, tokens } = useSelectedToken();
  const { openAdSet } = useAdSetDrawer();

  const [adAccounts, setAdAccounts] = useState([]);
  const [selectedAccounts, setSelectedAccounts] = useState([]);
  const [presetKey, setPresetKey] = useState("today");
  const [customSince, setCustomSince] = useState(todayIso());
  const [customUntil, setCustomUntil] = useState(todayIso());
  const { since, until } = useMemo(() => {
    if (presetKey === "custom") return { since: customSince, until: customUntil };
    return (PRESETS.find((p) => p.key === presetKey) || PRESETS[0]).range();
  }, [presetKey, customSince, customUntil]);

  const [campaignFilter, setCampaignFilter] = useState("");
  const [paymentFilter, setPaymentFilter] = useState(""); // "", COD, PREPAID
  const [matchFilter, setMatchFilter] = useState(""); // "", matched, unmatched

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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

  const load = () => {
    if (!TOKEN_ID || selectedAccounts.length === 0) return;
    setLoading(true);
    setError("");
    fetchAdSets(TOKEN_ID, { accountIds: selectedAccounts, since, until })
      .then((res) => setData(res))
      .catch((err) => setError(err.message || "Failed to load ad sets"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [TOKEN_ID, selectedAccounts.join(","), since, until]);

  const campaignOptions = useMemo(() => {
    const names = new Set((data?.adsets || []).map((a) => a.campaignName).filter(Boolean));
    return [...names].sort();
  }, [data]);

  const rows = useMemo(() => {
    let list = data?.adsets || [];
    if (campaignFilter) list = list.filter((a) => a.campaignName === campaignFilter);
    if (paymentFilter === "COD") list = list.filter((a) => a.codOrders > 0);
    if (paymentFilter === "PREPAID") list = list.filter((a) => a.prepaidOrders > 0);
    if (matchFilter === "matched") list = list.filter((a) => a.totalOrders > 0);
    if (matchFilter === "unmatched") list = list.filter((a) => a.totalOrders === 0);
    return list;
  }, [data, campaignFilter, paymentFilter, matchFilter]);

  const columns = useMemo(
    () =>
      AD_SET_COLUMNS.map((c) =>
        c.key === "adsetName"
          ? {
              ...c,
              render: (r) => (
                <AdSetNameCell
                  tokenId={TOKEN_ID}
                  adsetId={r.adsetId}
                  adsetName={r.adsetName}
                  campaignId={r.campaignId}
                  campaignName={r.campaignName}
                  since={since}
                  until={until}
                  status={r.effectiveStatus || r.status}
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
        <Layers size={18} className="text-indigo-500" />
        <h1 className="text-xl font-semibold text-slate-800">Ad Set Explorer</h1>
      </div>
      <p className="text-sm text-slate-500 mb-5">Campaign → Ad Set performance and order attribution.</p>

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
        <button type="button" className="btn btn-secondary btn-sm" onClick={load} disabled={loading}>
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      <div className="flex items-center gap-2 mb-5 flex-wrap">
        <select className="input w-auto !py-1.5 !text-xs" value={campaignFilter} onChange={(e) => setCampaignFilter(e.target.value)}>
          <option value="">All Campaigns</option>
          {campaignOptions.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
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
          <div className="card !p-3 flex-1 min-w-[140px]"><div className="text-[11px] text-slate-400 mb-0.5">Ad Sets</div><div className="text-lg font-bold text-slate-800">{data.summary.totalAdSets}</div></div>
          <div className="card !p-3 flex-1 min-w-[140px]"><div className="text-[11px] text-slate-400 mb-0.5">Spend</div><div className="text-lg font-bold text-slate-800">{currency(data.summary.totalSpend)}</div></div>
          <div className="card !p-3 flex-1 min-w-[140px]"><div className="text-[11px] text-slate-400 mb-0.5">Revenue</div><div className="text-lg font-bold text-slate-800">{currency(data.summary.totalRevenue)}</div></div>
          <div className="card !p-3 flex-1 min-w-[140px]"><div className="text-[11px] text-slate-400 mb-0.5">Orders</div><div className="text-lg font-bold text-slate-800">{number(data.summary.totalOrders)}</div></div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-sm text-slate-400">Loading ad sets…</div>
      ) : (
        <DataTable
          tableId="adSetExplorer"
          columns={columns}
          data={rows}
          searchKeys={["adsetName", "adsetId", "campaignName"]}
          onRowClick={(r) => openAdSet({ tokenId: TOKEN_ID, adsetId: r.adsetId, adsetName: r.adsetName, campaignId: r.campaignId, campaignName: r.campaignName, since, until })}
          rowKey={(r) => r.adsetId}
          exportFilename="adsets.csv"
          emptyMessage="No ad sets found for this selection."
          defaultHiddenKeys={AD_SET_DEFAULT_HIDDEN}
        />
      )}
    </div>
  );
}
