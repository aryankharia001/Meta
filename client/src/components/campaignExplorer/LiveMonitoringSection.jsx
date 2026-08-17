import { useEffect, useMemo, useRef, useState } from "react";
import {
  Radio,
  Wallet,
  Wallet2,
  Package,
  Gauge,
  PiggyBank,
  Building2,
  Clock,
  Loader2,
} from "lucide-react";
import { fetchLiveCampaignExplorer } from "../../lib/api";
import { getCachedLiveExplorer, setCachedLiveExplorer } from "../../lib/campaignExplorerCache";
import { useLiveSync } from "../../lib/LiveSyncContext";
import { currency, number, percent, multiplier, formatDateTime } from "../../lib/format";
import { LiveIndicator, RoasValue, BudgetCell } from "../CampaignCells";

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
            {/* Phase 19 §4 — relabeled "Profit Today" → "Gross Profit Today"
                (Revenue − Ad Spend only) — same naming-collision fix as
                every other "Profit" label in this Explorer, disambiguating
                from Profitability's real Net Profit. Value untouched. */}
            <KpiChip icon={PiggyBank} label="Gross Profit Today" value={currency(liveData.summary.profitToday)} accent="bg-emerald-50 text-emerald-600" />
            <KpiChip icon={Building2} label="Active Ad Accounts" value={number(liveData.summary.activeAdAccounts)} accent="bg-slate-100 text-slate-500" />
          </div>

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

  const NUM_KEYS = new Set(["spend", "reach", "impressions", "clicks", "ctr", "cpc", "cpm", "totalOrders", "revenue", "codOrders", "prepaidOrders", "delivered", "pending", "roas", "aov"]);

  const COLS = [
    { key: "campaignName", label: "Campaign", defaultWidth: 220 },
    { key: "accountName", label: "Ad Account" },
    { key: "budget", label: "Budget" },
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
    { key: "roas", label: "ROAS", render: (c) => <RoasValue roas={c.roas} /> },
    { key: "aov", label: "AOV", render: (c) => currency(c.aov) },
  ];

  return (
    <div className="card p-0 overflow-auto max-h-[420px]">
      <table className="table" style={{ tableLayout: "fixed", width: "max-content", minWidth: "100%" }}>
        {/* Phase 14 §11/§12 — same header/pinned-column z-index fix as
            ExplorerTable.jsx: header cells and the pinned Campaign
            column previously shared the SAME z-index (z-[1]), which
            meant the body's pinned <td> — coming later in DOM order —
            painted on top of the header on ties. Two clear tiers now:
            header cells (20) always above the pinned body column (10).

            Follow-up fix — the <thead> itself was left with its own
            redundant `sticky top-0` even after every <th> started
            declaring the same stickiness itself. Having both the
            table-header-group AND its cells independently sticky on the
            same (vertical) axis is a known trigger for browsers to
            miscompute the horizontal offset of a doubly-sticky corner
            cell — that's why the pinned Campaign column's header text
            was scrolling away horizontally while its body column (whose
            <tr> isn't itself sticky) stayed correctly pinned. Vertical
            stickiness now lives entirely on each <th>; <thead> declares
            no position of its own. */}
        <thead>
          <tr>
            {COLS.map((c) => (
              <th
                key={c.key}
                className={`cursor-pointer select-none sticky top-0 z-20 bg-slate-50 ${NUM_KEYS.has(c.key) ? "num" : ""} ${c.key === "campaignName" ? "left-0 shadow-[2px_0_0_0_rgba(0,0,0,0.04)]" : ""}`}
                style={{ minWidth: c.defaultWidth || 110 }}
                onClick={() => handleSort(c.key)}
              >
                {c.label}
                {arrow(c.key)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr>
              <td colSpan={COLS.length} className="text-center py-10 text-sm text-slate-400">
                No campaigns match this filter.
              </td>
            </tr>
          ) : (
            sorted.map((c) => (
              <tr key={c.campaignId} className="row-clickable hover:bg-slate-50/70" onClick={() => onOpenCampaign?.(c)}>
                {COLS.map((col) => {
                  if (col.key === "campaignName") {
                    return (
                      <td key={col.key} className="sticky left-0 z-10 bg-white">
                        <div className="flex items-center gap-2 min-w-0">
                          <LiveIndicator campaign={c} />
                          <span className="campaign-name truncate max-w-[170px]">{c.campaignName}</span>
                        </div>
                      </td>
                    );
                  }
                  if (col.key === "budget") {
                    return (
                      <td key={col.key}>
                        <BudgetCell budget={c.budget} budgetType={c.budgetType} />
                      </td>
                    );
                  }
                  return (
                    <td key={col.key} className={NUM_KEYS.has(col.key) ? "num" : ""}>
                      {col.render ? col.render(c) : c[col.key]}
                    </td>
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
