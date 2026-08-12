import { useEffect, useMemo, useRef, useState } from "react";
import {
  Radio,
  Wallet,
  Wallet2,
  Package,
  Gauge,
  PiggyBank,
  Building2,
  AlertTriangle,
  Clock,
  Loader2,
} from "lucide-react";
import { fetchLiveCampaignExplorer, fetchCampaignExplorer } from "../../lib/api";
import { getCachedLiveExplorer, setCachedLiveExplorer } from "../../lib/campaignExplorerCache";
import { useLiveSync } from "../../lib/LiveSyncContext";
import { currency, number, percent, multiplier, formatDateTime } from "../../lib/format";
import { computeCampaignHealth, computeCampaignAlerts } from "../../lib/campaignHealth";

// ────────────────────────────────────────────────────────────────
// Phase 8 — Live Campaign Monitoring. A self-contained section at the
// top of Campaign Explorer: its own fetch (GET /campaign-explorer/:id/live,
// scoped to today IST server-side), its own filters, and a compact
// table with a Today's Metrics / Selected Range toggle. Re-fetches
// (bypassing cache) whenever LiveSyncContext's syncVersion bumps — the
// same "something new landed" signal Phase 5 built for the Dashboard —
// so these cards update automatically on a live refresh without this
// component needing its own polling loop.
//
// Meta's campaign API has no literal "SCHEDULED"/"COMPLETED" status —
// those two quick filters are derived here from start_time/stop_time
// against an ACTIVE campaign, documented inline below.
// ────────────────────────────────────────────────────────────────

const LIVE_FILTERS = [
  { key: "live", label: "Live Campaigns" },
  { key: "active", label: "Active Campaigns" },
  { key: "scheduled", label: "Scheduled" },
  { key: "paused", label: "Paused" },
  { key: "completed", label: "Completed" },
  { key: "archived", label: "Archived" },
  { key: "receivingToday", label: "Receiving Orders Today" },
  { key: "noOrdersToday", label: "No Orders Today" },
];

const PAUSED_STATUSES = new Set(["PAUSED", "CAMPAIGN_PAUSED", "ADSET_PAUSED"]);

function matchesLiveFilter(c, key) {
  const status = c.effectiveStatus || c.status;
  const now = Date.now();
  const started = c.startTime ? new Date(c.startTime).getTime() <= now : true;
  const stopped = c.stopTime ? new Date(c.stopTime).getTime() < now : false;

  switch (key) {
    case "live":
      return status === "ACTIVE" || status === "IN_PROCESS" || status === "PENDING_REVIEW";
    case "active":
      return status === "ACTIVE" && started && !stopped;
    case "scheduled":
      return status === "ACTIVE" && !started;
    case "paused":
      return PAUSED_STATUSES.has(status);
    case "completed":
      return stopped;
    case "archived":
      return status === "ARCHIVED";
    case "receivingToday":
      return c.totalOrders > 0;
    case "noOrdersToday":
      return c.totalOrders === 0;
    default:
      return true;
  }
}

function KpiChip({ icon: Icon, label, value, accent }) {
  return (
    <div className="card !p-3.5 flex items-center gap-3">
      <span className={`flex items-center justify-center w-9 h-9 rounded-xl shrink-0 ${accent}`}>
        <Icon size={16} />
      </span>
      <div className="min-w-0">
        <div className="text-[11px] text-slate-400 truncate">{label}</div>
        <div className="text-base font-display font-bold text-slate-800 truncate">{value}</div>
      </div>
    </div>
  );
}

export default function LiveMonitoringSection({ tokenId, accountIds, onOpenCampaign }) {
  const liveSync = useLiveSync();
  const [liveData, setLiveData] = useState(() => (tokenId && accountIds.length ? getCachedLiveExplorer(tokenId, accountIds) : null));
  const [yesterday, setYesterday] = useState(null);
  const [loading, setLoading] = useState(!liveData);
  const [error, setError] = useState("");
  const [filterKey, setFilterKey] = useState("live");
  const [metricsMode, setMetricsMode] = useState("today"); // "today" | "range" — "range" just relabels the same today-scoped numbers as unavailable, since Live Monitoring only ever fetches today's data server-side; the toggle's real job is documented on the button itself.

  const load = () => {
    if (!tokenId || accountIds.length === 0) return;
    setLoading(true);
    setError("");
    fetchLiveCampaignExplorer(tokenId, { accountIds })
      .then((res) => {
        setLiveData(res);
        setCachedLiveExplorer(tokenId, accountIds, res);
      })
      .catch((err) => setError(err.message || "Failed to load live campaigns"))
      .finally(() => setLoading(false));

    // Yesterday snapshot, purely for spike/drop alert comparison — same
    // main list endpoint, just a different date, cheap and cached
    // server-side too.
    const y = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    fetchCampaignExplorer(tokenId, { accountIds, since: y, until: y })
      .then((res) => setYesterday(new Map((res.campaigns || []).map((c) => [c.campaignId, c]))))
      .catch(() => setYesterday(null));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenId, accountIds.join(",")]);

  const prevSyncVersionRef = useRef(liveSync.syncVersion);
  useEffect(() => {
    if (liveSync.syncVersion === prevSyncVersionRef.current) return;
    prevSyncVersionRef.current = liveSync.syncVersion;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveSync.syncVersion]);

  const pool = liveData?.allCampaigns || [];
  const filtered = useMemo(() => pool.filter((c) => matchesLiveFilter(c, filterKey)), [pool, filterKey]);

  const alerts = useMemo(() => {
    if (!liveData) return [];
    const list = [];
    (liveData.campaigns || []).forEach((c) => {
      const previous = yesterday?.get(c.campaignId) || null;
      computeCampaignAlerts(c, { previous }).forEach((a) =>
        list.push({ ...a, campaignId: c.campaignId, campaignName: c.campaignName, accountId: c.accountId, accountName: c.accountName })
      );
    });
    return list.sort((a, b) => (a.severity === "rose" ? -1 : 1) - (b.severity === "rose" ? -1 : 1));
  }, [liveData, yesterday]);

  // Campaign rows here (both the alerts list and allCampaigns) carry
  // campaignId/accountId/accountName but not tokenId (implicit in this
  // section's own prop, not part of the row payload) or a date range
  // (this section only ever fetches "today"). openCampaign() needs both
  // to fetch — see CampaignDrawer.jsx's fetchCampaignDetails call — so
  // every click routed through here injects them before opening.
  const openWithContext = (c) =>
    onOpenCampaign?.({
      tokenId,
      campaignId: c.campaignId,
      campaignName: c.campaignName,
      accountId: c.accountId,
      accountName: c.accountName,
      since: liveData?.date,
      until: liveData?.date,
    });

  return (
    <section className="mb-8">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <h2 className="flex items-center gap-2 font-display font-bold text-slate-800">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
          Live Campaign Monitoring
          {loading && <Loader2 size={14} className="animate-spin text-slate-400" />}
        </h2>
        {liveData?.date && <span className="text-xs text-slate-400">as of {liveData.date}</span>}
      </div>

      {error && <div className="card text-sm text-rose-600 mb-3">{error}</div>}

      {liveData && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 mb-4">
            <KpiChip icon={Radio} label="Live Campaigns" value={number(liveData.summary.liveCampaigns)} accent="bg-emerald-50 text-emerald-600" />
            <KpiChip icon={Wallet2} label="Spend Today" value={currency(liveData.summary.spendToday)} accent="bg-amber-50 text-amber-600" />
            <KpiChip icon={Wallet} label="Revenue Today" value={currency(liveData.summary.revenueToday)} accent="bg-sky-50 text-sky-600" />
            <KpiChip icon={Package} label="Orders Today" value={number(liveData.summary.ordersToday)} accent="bg-indigo-50 text-indigo-600" />
            <KpiChip icon={Gauge} label="ROAS Today" value={multiplier(liveData.summary.roasToday)} accent="bg-violet-50 text-violet-600" />
            <KpiChip icon={PiggyBank} label="Profit Today" value={currency(liveData.summary.profitToday)} accent="bg-emerald-50 text-emerald-600" />
            <KpiChip icon={Building2} label="Active Ad Accounts" value={number(liveData.summary.activeAdAccounts)} accent="bg-slate-100 text-slate-500" />
          </div>

          {alerts.length > 0 && (
            <div className="card mb-4">
              <h3 className="flex items-center gap-2 font-display font-semibold text-sm text-slate-700 mb-2.5">
                <AlertTriangle size={14} className="text-amber-500" /> Alerts <span className="text-slate-400 font-normal">({alerts.length})</span>
              </h3>
              <div className="flex flex-wrap gap-2">
                {alerts.map((a, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => openWithContext(a)}
                    className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border ${
                      a.severity === "rose"
                        ? "bg-rose-50 border-rose-200 text-rose-700"
                        : a.severity === "amber"
                        ? "bg-amber-50 border-amber-200 text-amber-700"
                        : "bg-sky-50 border-sky-200 text-sky-700"
                    } hover:opacity-80`}
                    title="Open this campaign"
                  >
                    <span className="font-medium truncate max-w-[140px]">{a.campaignName}</span>
                    <span className="opacity-70">— {a.message}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
            <div className="flex flex-wrap gap-1.5">
              {LIVE_FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setFilterKey(f.key)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    filterKey === f.key ? "bg-indigo-50 border-indigo-300 text-indigo-700" : "bg-white border-slate-200 text-slate-500 hover:bg-slate-50"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
              <button
                type="button"
                onClick={() => setMetricsMode("today")}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${metricsMode === "today" ? "bg-white text-blue-700 shadow-sm" : "text-slate-500"}`}
                title="Today's numbers, refreshed live"
              >
                <Clock size={11} className="inline mr-1 -mt-0.5" /> Today
              </button>
              <button
                type="button"
                onClick={() => setMetricsMode("range")}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${metricsMode === "range" ? "bg-white text-blue-700 shadow-sm" : "text-slate-500"}`}
                title="Switch to the Campaign Explorer table below for the selected dashboard date range"
              >
                Selected Range
              </button>
            </div>
          </div>

          {metricsMode === "range" ? (
            <div className="card text-sm text-slate-500 text-center py-6">
              Showing the selected dashboard date range — see the Campaign Explorer table below, which already reflects the date range chosen in the filters.
            </div>
          ) : (
            <LiveCampaignTable campaigns={filtered} onOpenCampaign={openWithContext} />
          )}
        </>
      )}
    </section>
  );
}

function LiveCampaignTable({ campaigns, onOpenCampaign }) {
  const [sortConfig, setSortConfig] = useState({ key: "spend", direction: "desc" });

  const sorted = useMemo(() => {
    const list = [...campaigns];
    list.sort((a, b) => {
      const x = a[sortConfig.key] ?? 0;
      const y = b[sortConfig.key] ?? 0;
      if (typeof x === "string") return sortConfig.direction === "asc" ? x.localeCompare(y) : y.localeCompare(x);
      return sortConfig.direction === "asc" ? x - y : y - x;
    });
    return list;
  }, [campaigns, sortConfig]);

  const handleSort = (key) => setSortConfig((prev) => ({ key, direction: prev.key === key && prev.direction === "asc" ? "desc" : "asc" }));
  const arrow = (key) => (sortConfig.key !== key ? "" : sortConfig.direction === "asc" ? " ↑" : " ↓");

  const COLS = [
    { key: "campaignName", label: "Campaign" },
    { key: "accountName", label: "Ad Account" },
    { key: "spend", label: "Spend Today", render: (c) => currency(c.spend) },
    { key: "reach", label: "Reach", render: (c) => number(c.reach) },
    { key: "impressions", label: "Impressions", render: (c) => number(c.impressions) },
    { key: "clicks", label: "Clicks", render: (c) => number(c.clicks) },
    { key: "ctr", label: "CTR", render: (c) => percent(c.ctr) },
    { key: "cpc", label: "CPC", render: (c) => currency(c.cpc) },
    { key: "cpm", label: "CPM", render: (c) => currency(c.cpm) },
    { key: "totalOrders", label: "Orders Today", render: (c) => number(c.totalOrders) },
    { key: "revenue", label: "Revenue Today", render: (c) => currency(c.revenue) },
    { key: "codOrders", label: "COD", render: (c) => number(c.codOrders) },
    { key: "prepaidOrders", label: "Prepaid", render: (c) => number(c.prepaidOrders) },
    { key: "delivered", label: "Delivered", render: (c) => number(c.delivered) },
    { key: "pending", label: "Pending", render: (c) => number(c.pending) },
    { key: "roas", label: "ROAS", render: (c) => multiplier(c.roas) },
    { key: "aov", label: "AOV", render: (c) => currency(c.aov) },
  ];

  return (
    <div className="card p-0 overflow-auto max-h-[420px]">
      <table className="table" style={{ tableLayout: "fixed", width: "max-content", minWidth: "100%" }}>
        <thead className="sticky top-0 z-[1]">
          <tr>
            <th className="sticky left-0 z-[2] bg-slate-50" style={{ width: 40 }} />
            {COLS.map((c) => (
              <th key={c.key} className="cursor-pointer select-none" style={{ minWidth: 110 }} onClick={() => handleSort(c.key)}>
                {c.label}
                {arrow(c.key)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr>
              <td colSpan={COLS.length + 1} className="text-center py-10 text-sm text-slate-400">
                No campaigns match this filter.
              </td>
            </tr>
          ) : (
            sorted.map((c) => {
              const health = computeCampaignHealth(c);
              return (
                <tr key={c.campaignId} className="cursor-pointer hover:bg-slate-50/70" onClick={() => onOpenCampaign?.(c)}>
                  <td className="sticky left-0 z-[1] bg-white text-center" title={health.label}>
                    {health.emoji}
                  </td>
                  {COLS.map((col) => (
                    <td key={col.key} className={col.key === "campaignName" ? "font-medium text-slate-700" : ""}>
                      {col.render ? col.render(c) : c[col.key]}
                    </td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
