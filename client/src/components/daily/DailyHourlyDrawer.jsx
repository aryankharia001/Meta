import { useEffect, useMemo, useState } from "react";
import { X, AlertTriangle, RefreshCw, ChevronDown, ChevronRight, TrendingUp, Wallet, Clock4, Megaphone, Layers, Image as ImageIcon } from "lucide-react";
import { fetchDailyHourlySummary, fetchProfitHourly } from "../../lib/api";
import { currency, number, multiplier, percent } from "../../lib/format";
import { formatDayLabel } from "../../lib/dateIst";
import { useCampaignDrawer } from "../../lib/CampaignDrawerContext";
import { useAdSetDrawer } from "../../lib/AdSetDrawerContext";
import { useAdDrawer } from "../../lib/AdDrawerContext";
import HourOrdersPopup from "./HourOrdersPopup";

// ─────────────────────────────────────────────────────────────
// Phase 15 — Daily's per-date drill-down. Opened when a DATE row (not a
// specific campaign row) is clicked in DailyTable.jsx's "By Day" view.
// Everything here is scoped to ONE calendar date, across every campaign
// active that day for the currently selected ad accounts — a different
// scope from the existing (single-campaign) HourlyPanel embedded in
// DailyDrawer.jsx, which this component does not touch or duplicate the
// UI of (a fresh, self-contained drawer, per the codebase's own "zero
// coupling between phases" convention).
//
// Navigation chain per §15: Daily → Date (this drawer) → Hour (expand
// or the orders popup) → Campaign/Ad Set/Ad (existing drawers, via
// useCampaignDrawer/useAdSetDrawer/useAdDrawer, already mounted at the
// App root) → Order (existing Order Drawer, opened from inside
// HourOrdersPopup). Nothing here reimplements any of those four.
//
// Phase 16 §14 — "Day-Wise Profit... integrate into existing Daily
// page... clicking a date should allow the existing hourly drill-down
// to show Revenue → Expenses → Profit hour by hour." This is that
// integration: a purely additive fetch of GET
// /api/profitability/:tokenId/hourly layered on top of everything
// above. It never replaces or recalculates anything this drawer already
// shows (orders/revenue/spend/ROAS/delivery counts are all still
// exactly what Phase 15 computed) — it only adds a Profit column to the
// existing table and one extra summary card. If the profit fetch fails
// or product/expense costs haven't been configured yet, the section
// simply doesn't render — this drawer's original Phase 15 behavior is
// never blocked by it.
// ─────────────────────────────────────────────────────────────

function Stat({ label, value, sub, onClick, accent }) {
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={`card !p-3.5 text-left w-full ${onClick ? "hover:border-indigo-300 hover:shadow-sm transition-shadow cursor-pointer" : ""} ${accent || ""}`}
    >
      <div className="text-[11px] text-slate-500 mb-0.5">{label}</div>
      <div className="text-base font-display font-bold text-slate-800 truncate">{value}</div>
      {sub && <div className="text-[11px] text-slate-400 truncate mt-0.5">{sub}</div>}
    </Comp>
  );
}

export default function DailyHourlyDrawer({ meta, onClose }) {
  const open = !!meta;
  const { openCampaign } = useCampaignDrawer();
  const { openAdSet } = useAdSetDrawer();
  const { openAd } = useAdDrawer();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expandedHours, setExpandedHours] = useState(new Set());
  const [expandedCampaigns, setExpandedCampaigns] = useState(new Set());

  // Phase 16 §14 — optional, additive profit enrichment. Separate
  // loading/error state from the main `data`/`loading`/`error` above so
  // a failed or slow profit fetch (e.g. Meta not returning hourly spend,
  // or simply no Product/Expense config yet) never blocks or delays the
  // Phase 15 hourly view this drawer already renders.
  const [profitData, setProfitData] = useState(null);

  const [popup, setPopup] = useState(null); // { hour, scopeLabel, campaignId, campaignName, adsetId, adId }

  // Same fade-out-without-crashing pattern DailyDrawer.jsx already uses.
  const [displayMeta, setDisplayMeta] = useState(null);
  useEffect(() => {
    if (meta) setDisplayMeta(meta);
  }, [meta]);

  const load = () => {
    if (!meta) return;
    setLoading(true);
    setError("");
    fetchDailyHourlySummary(meta.tokenId, { date: meta.date, accountIds: meta.accountIds })
      .then((res) => setData(res))
      .catch((err) => setError(err.message || "Failed to load hourly breakdown"))
      .finally(() => setLoading(false));

    // Additive only — never surfaced as a blocking error; the section
    // just stays hidden if this fails.
    fetchProfitHourly(meta.tokenId, { date: meta.date, accountIds: meta.accountIds })
      .then((res) => setProfitData(res))
      .catch(() => setProfitData(null));
  };

  useEffect(() => {
    if (!open) return;
    setData(null);
    setProfitData(null);
    setExpandedHours(new Set());
    setExpandedCampaigns(new Set());
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, meta?.date, meta?.tokenId, JSON.stringify(meta?.accountIds)]);

  const profitByHour = useMemo(() => {
    const map = new Map();
    (profitData?.hours || []).forEach((h) => map.set(h.hour, h));
    return map;
  }, [profitData]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const toggleHour = (h) =>
    setExpandedHours((prev) => {
      const next = new Set(prev);
      if (next.has(h)) next.delete(h);
      else next.add(h);
      return next;
    });
  const campaignKey = (h, id) => `${h}:${id}`;
  const toggleCampaign = (h, id) =>
    setExpandedCampaigns((prev) => {
      const next = new Set(prev);
      const key = campaignKey(h, id);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const openHourOrders = (hour, extra = {}) => {
    setPopup({ hour, ...extra });
  };

  const s = data?.summary;

  return (
    <>
      <div
        className={`fixed inset-0 z-[41] bg-slate-900/50 backdrop-blur-sm transition-opacity duration-300 ${
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
      />
      <div
        className={`fixed inset-y-0 right-0 z-[51] w-full sm:w-[720px] bg-slate-50 shadow-2xl flex flex-col transition-transform duration-300 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-display font-bold text-lg text-slate-800 truncate">
              {displayMeta ? formatDayLabel(displayMeta.date) : ""} — Hourly Performance
            </h2>
            <p className="text-xs text-slate-400">Hour-by-hour, every campaign active this day</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button type="button" className="btn btn-secondary btn-sm" onClick={load} disabled={loading} title="Refresh">
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={onClose} title="Close">
              <X size={14} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {loading && !data && <DrawerSkeleton />}
          {!loading && error && <DrawerError message={error} onRetry={load} />}

          {!loading && !error && data && s && (
            <>
              {data.metaHourlyAvailable === false && (
                <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                  <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                  <span>
                    Meta didn't return hourly ad-spend data for this account/date — order-level figures below are still
                    accurate; Spend/ROAS will read 0 for hours until Meta's hourly breakdown is enabled for this account.
                  </span>
                </div>
              )}

              {/* §10 — Daily Summary Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <Stat label="Total Orders" value={number(s.totalOrders)} />
                <Stat label="COD Orders" value={number(s.codOrders)} />
                <Stat label="Prepaid Orders" value={number(s.prepaidOrders)} />
                <Stat label="Revenue" value={currency(s.revenue)} />
                <Stat label="Spend" value={currency(s.spend)} />
                <Stat label="ROAS" value={multiplier(s.roas)} />
                <Stat
                  label="Highest Selling Hour"
                  value={s.highestSellingHour ? s.highestSellingHour.label : "N/A"}
                  sub={s.highestSellingHour ? `${number(s.highestSellingHour.orders)} orders` : null}
                  onClick={s.highestSellingHour ? () => openHourOrders(s.highestSellingHour.hour, { scopeLabel: "Highest Selling Hour" }) : undefined}
                  accent="border-emerald-200"
                />
                <Stat
                  label="Highest Revenue Hour"
                  value={s.highestRevenueHour ? s.highestRevenueHour.label : "N/A"}
                  sub={s.highestRevenueHour ? currency(s.highestRevenueHour.revenue) : null}
                  onClick={s.highestRevenueHour ? () => openHourOrders(s.highestRevenueHour.hour, { scopeLabel: "Highest Revenue Hour" }) : undefined}
                  accent="border-indigo-200"
                />
                <Stat
                  label="Top Campaign"
                  value={s.topCampaign ? s.topCampaign.campaignName : "N/A"}
                  sub={s.topCampaign ? `${number(s.topCampaign.orders)} orders` : null}
                  onClick={
                    s.topCampaign && !s.topCampaign.isUnmatched
                      ? () => openCampaign({ tokenId: meta.tokenId, campaignId: s.topCampaign.campaignId, campaignName: s.topCampaign.campaignName, since: meta.date, until: meta.date })
                      : undefined
                  }
                />
                <Stat
                  label="Top Ad Set"
                  value={s.topAdSet ? s.topAdSet.adsetName : "N/A"}
                  sub={s.topAdSet ? `${number(s.topAdSet.orders)} orders` : null}
                  onClick={s.topAdSet && s.topAdSet.adsetId ? () => openAdSet({ tokenId: meta.tokenId, adsetId: s.topAdSet.adsetId, adsetName: s.topAdSet.adsetName, since: meta.date, until: meta.date }) : undefined}
                />
                {/* §9 — "show the ad thumbnail where available" */}
                <button
                  type="button"
                  onClick={s.topAd && s.topAd.adId ? () => openAd({ tokenId: meta.tokenId, adId: s.topAd.adId, adName: s.topAd.adName, since: meta.date, until: meta.date }) : undefined}
                  className={`card !p-3.5 text-left w-full flex items-center gap-2.5 ${s.topAd?.adId ? "hover:border-indigo-300 hover:shadow-sm transition-shadow cursor-pointer" : ""}`}
                >
                  {s.topAd?.thumbnailUrl ? (
                    <img src={s.topAd.thumbnailUrl} alt="" className="w-8 h-8 rounded-lg object-cover shrink-0" />
                  ) : (
                    <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-slate-100 text-slate-300 shrink-0">
                      <ImageIcon size={14} />
                    </span>
                  )}
                  <div className="min-w-0">
                    <div className="text-[11px] text-slate-500 mb-0.5">Top Ad</div>
                    <div className="text-sm font-display font-bold text-slate-800 truncate">{s.topAd ? s.topAd.adName : "N/A"}</div>
                    {s.topAd && <div className="text-[11px] text-slate-400 truncate mt-0.5">{number(s.topAd.orders)} orders</div>}
                  </div>
                </button>
              </div>

              {/* §4 — COD / Prepaid breakdown */}
              <div className="grid grid-cols-2 gap-3">
                <div className="card !p-4 bg-amber-50/60 border-amber-100">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 mb-2">
                    <Wallet size={13} /> COD
                  </div>
                  <div className="text-xl font-display font-bold text-amber-800">{number(s.codOrders)} orders</div>
                  <div className="text-sm text-amber-700 mt-0.5">{currency(s.codRevenue)}</div>
                  <div className="text-[11px] text-amber-600 mt-1">
                    {s.totalOrders ? `${Math.round((s.codOrders / s.totalOrders) * 100)}% of orders` : "0%"}
                  </div>
                </div>
                <div className="card !p-4 bg-sky-50/60 border-sky-100">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-sky-700 mb-2">
                    <TrendingUp size={13} /> Prepaid
                  </div>
                  <div className="text-xl font-display font-bold text-sky-800">{number(s.prepaidOrders)} orders</div>
                  <div className="text-sm text-sky-700 mt-0.5">{currency(s.prepaidRevenue)}</div>
                  <div className="text-[11px] text-sky-600 mt-1">
                    {s.totalOrders ? `${Math.round((s.prepaidOrders / s.totalOrders) * 100)}% of orders` : "0%"}
                  </div>
                </div>
              </div>

              {/* Phase 16 §14 — optional profit summary for this date,
                  additive, only rendered if the profit fetch succeeded. */}
              {profitData?.dayTotals && (
                <div className="card !p-4 bg-emerald-50/60 border-emerald-100">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 mb-2.5">
                    <TrendingUp size={13} /> Profitability (this date)
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div>
                      <div className="text-[10px] text-emerald-600/70">Recognized Revenue</div>
                      <div className="text-sm font-display font-bold text-emerald-800">{currency(profitData.dayTotals.totalRecognizedRevenue)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-emerald-600/70">Total Expenses</div>
                      <div className="text-sm font-display font-bold text-emerald-800">{currency(profitData.dayTotals.totalExpenses)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-emerald-600/70">Net Profit</div>
                      <div className={`text-sm font-display font-bold ${profitData.dayTotals.netProfit >= 0 ? "text-emerald-800" : "text-rose-600"}`}>
                        {currency(profitData.dayTotals.netProfit)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-emerald-600/70">Profit Margin</div>
                      <div className={`text-sm font-display font-bold ${profitData.dayTotals.profitMargin >= 0 ? "text-emerald-800" : "text-rose-600"}`}>
                        {percent(profitData.dayTotals.profitMargin)}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* §2/§3/§11 — 24-hour breakdown, expandable to the
                  Campaign -> Ad Set -> Ad hierarchy */}
              <div className="card p-0 overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100">
                  <Clock4 size={14} className="text-slate-400" />
                  <h3 className="font-display font-semibold text-sm text-slate-700">Hourly Breakdown</h3>
                  <span className="text-[11px] text-slate-400 ml-auto">Click a row for its orders · expand for campaign/ad set/ad detail</span>
                </div>
                <div className="overflow-auto max-h-[480px]">
                  <table className="table" style={{ tableLayout: "fixed", width: "max-content", minWidth: "100%" }}>
                    <thead>
                      <tr>
                        <th className="sticky top-0 z-[2] bg-slate-50" style={{ width: 28 }} />
                        <th className="sticky top-0 z-[2] bg-slate-50" style={{ width: 100 }}>Hour</th>
                        <th className="sticky top-0 z-[2] bg-slate-50 num" style={{ width: 80 }}>Orders</th>
                        <th className="sticky top-0 z-[2] bg-slate-50 num" style={{ width: 70 }}>COD</th>
                        <th className="sticky top-0 z-[2] bg-slate-50 num" style={{ width: 80 }}>Prepaid</th>
                        <th className="sticky top-0 z-[2] bg-slate-50 num" style={{ width: 100 }}>Revenue</th>
                        <th className="sticky top-0 z-[2] bg-slate-50 num" style={{ width: 90 }}>Spend</th>
                        <th className="sticky top-0 z-[2] bg-slate-50 num" style={{ width: 70 }}>ROAS</th>
                        <th className="sticky top-0 z-[2] bg-slate-50 num" style={{ width: 80 }}>Delivered</th>
                        <th className="sticky top-0 z-[2] bg-slate-50 num" style={{ width: 75 }}>Pending</th>
                        <th className="sticky top-0 z-[2] bg-slate-50 num" style={{ width: 60 }}>RTO</th>
                        {profitData && <th className="sticky top-0 z-[2] bg-slate-50 num" style={{ width: 100 }}>Profit</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {data.hours.map((h) => {
                        const isOpen = expandedHours.has(h.hour);
                        const isBest = s.highestSellingHour?.hour === h.hour;
                        return (
                          <HourRow
                            key={h.hour}
                            h={h}
                            profit={profitByHour.get(h.hour)}
                            showProfitColumn={!!profitData}
                            isOpen={isOpen}
                            isBest={isBest}
                            onToggle={() => toggleHour(h.hour)}
                            onOpenOrders={() => openHourOrders(h.hour)}
                            expandedCampaigns={expandedCampaigns}
                            onToggleCampaign={(id) => toggleCampaign(h.hour, id)}
                            campaignKey={campaignKey}
                            onOpenCampaignOrders={(c) => openHourOrders(h.hour, { campaignId: c.campaignId, campaignName: c.campaignName, scopeLabel: c.campaignName })}
                            onOpenAdSetOrders={(as) => openHourOrders(h.hour, { adsetId: as.adsetId, scopeLabel: as.adsetName })}
                            onOpenAdOrders={(a) => openHourOrders(h.hour, { adId: a.adId, scopeLabel: a.adName })}
                            onOpenCampaign={(c) => !c.isUnmatched && openCampaign({ tokenId: meta.tokenId, campaignId: c.campaignId, campaignName: c.campaignName, since: meta.date, until: meta.date })}
                            onOpenAdSet={(c, as) => as.adsetId && openAdSet({ tokenId: meta.tokenId, adsetId: as.adsetId, adsetName: as.adsetName, campaignId: c.campaignId, campaignName: c.campaignName, since: meta.date, until: meta.date })}
                            onOpenAd={(c, as, a) => a.adId && openAd({ tokenId: meta.tokenId, adId: a.adId, adName: a.adName, adsetId: as.adsetId, adsetName: as.adsetName, campaignId: c.campaignId, campaignName: c.campaignName, since: meta.date, until: meta.date })}
                          />
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <HourOrdersPopup
        open={!!popup}
        tokenId={meta?.tokenId}
        date={meta?.date}
        hour={popup?.hour ?? null}
        scopeLabel={popup?.scopeLabel}
        campaignId={popup?.campaignId}
        campaignName={popup?.campaignName}
        adsetId={popup?.adsetId}
        adId={popup?.adId}
        onClose={() => setPopup(null)}
      />
    </>
  );
}

function HourRow({
  h,
  profit,
  showProfitColumn,
  isOpen,
  isBest,
  onToggle,
  onOpenOrders,
  expandedCampaigns,
  onToggleCampaign,
  campaignKey,
  onOpenCampaignOrders,
  onOpenAdSetOrders,
  onOpenAdOrders,
  onOpenCampaign,
  onOpenAdSet,
  onOpenAd,
}) {
  const colCount = showProfitColumn ? 12 : 11;
  return (
    <>
      <tr className={`hover:bg-slate-50/70 ${isBest ? "bg-emerald-50/50" : ""}`}>
        <td className="text-slate-400 cursor-pointer" onClick={onToggle}>
          {h.campaigns.length > 0 ? isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} /> : null}
        </td>
        <td className="metric-primary cursor-pointer" onClick={onOpenOrders}>
          {h.label}
          {isBest && <span className="badge badge-green text-[9px] ml-1.5 align-middle">Top</span>}
        </td>
        <td className="num cursor-pointer" onClick={onOpenOrders}>{number(h.orders)}</td>
        <td className="num">{number(h.codOrders)}</td>
        <td className="num">{number(h.prepaidOrders)}</td>
        <td className="num metric-primary">{currency(h.revenue)}</td>
        <td className="num">{currency(h.spend)}</td>
        <td className="num">{multiplier(h.roas)}</td>
        <td className="num">{number(h.delivered)}</td>
        <td className="num">{number(h.pending)}</td>
        <td className="num">{number(h.rto)}</td>
        {showProfitColumn && (
          <td className={`num font-semibold ${profit ? (profit.netProfit >= 0 ? "text-emerald-600" : "text-rose-600") : "text-slate-300"}`}>
            {profit ? currency(profit.netProfit) : "—"}
          </td>
        )}
      </tr>
      {isOpen && h.campaigns.length > 0 && (
        <tr>
          <td colSpan={colCount} className="bg-slate-50 p-0">
            <div className="px-4 py-3 space-y-2">
              {/* §7/§8/§9 — this hour's top campaign/ad set/ad, computed
                  server-side alongside the nested breakdown below (same
                  data, just surfaced as a one-line summary too since the
                  spec calls each of these out as its own requirement). */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500 pb-1">
                {h.topCampaign && (
                  <span>
                    <span className="text-slate-400">Top Campaign:</span> <strong className="text-slate-700 font-medium">{h.topCampaign.campaignName}</strong> ({h.topCampaign.orders})
                  </span>
                )}
                {h.topAdSet && (
                  <span>
                    <span className="text-slate-400">Top Ad Set:</span> <strong className="text-slate-700 font-medium">{h.topAdSet.adsetName}</strong> ({h.topAdSet.orders})
                  </span>
                )}
                {h.topAd && (
                  <span className="flex items-center gap-1">
                    <span className="text-slate-400">Top Ad:</span>
                    {h.topAd.thumbnailUrl && <img src={h.topAd.thumbnailUrl} alt="" className="w-3.5 h-3.5 rounded object-cover" />}
                    <strong className="text-slate-700 font-medium">{h.topAd.adName}</strong> ({h.topAd.orders})
                  </span>
                )}
              </div>
              {h.campaigns.map((c) => {
                const key = campaignKey(h.hour, c.campaignId || c.campaignName);
                const cOpen = expandedCampaigns.has(key);
                return (
                  <div key={key} className="bg-white border border-slate-100 rounded-lg overflow-hidden">
                    <div className="flex items-center gap-2 px-3 py-2">
                      <button type="button" className="text-slate-400 shrink-0" onClick={() => onToggleCampaign(c.campaignId || c.campaignName)}>
                        {c.adsets.length > 0 ? cOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} /> : <span className="inline-block w-[13px]" />}
                      </button>
                      <Megaphone size={12} className="text-indigo-400 shrink-0" />
                      <button
                        type="button"
                        className={`text-sm font-medium truncate flex-1 text-left ${c.isUnmatched ? "text-slate-500" : "text-slate-700 hover:text-blue-600 hover:underline"}`}
                        onClick={() => onOpenCampaign(c)}
                        disabled={c.isUnmatched}
                        title={c.isUnmatched ? "No matching Meta campaign found" : "View campaign"}
                      >
                        {c.campaignName}
                      </button>
                      <button type="button" className="text-xs text-slate-500 hover:text-indigo-600 shrink-0" onClick={() => onOpenCampaignOrders(c)}>
                        {c.orders} order{c.orders === 1 ? "" : "s"}
                      </button>
                    </div>
                    {cOpen && c.adsets.length > 0 && (
                      <div className="border-t border-slate-100 px-3 py-2 pl-8 space-y-1.5">
                        {c.adsets.map((as) => (
                          <div key={as.adsetId || as.adsetName}>
                            <div className="flex items-center gap-2">
                              <Layers size={11} className="text-slate-400 shrink-0" />
                              <button
                                type="button"
                                className={`text-xs truncate flex-1 text-left ${as.adsetId ? "text-slate-600 hover:text-blue-600 hover:underline" : "text-slate-400"}`}
                                onClick={() => onOpenAdSet(c, as)}
                                title={as.adsetId ? "View ad set" : "No ad set attribution"}
                              >
                                {as.adsetName}
                              </button>
                              <button type="button" className="text-[11px] text-slate-400 hover:text-indigo-600 shrink-0" onClick={() => onOpenAdSetOrders(as)}>
                                {as.orders} order{as.orders === 1 ? "" : "s"}
                              </button>
                            </div>
                            {as.ads.length > 0 && (
                              <div className="pl-5 mt-1 space-y-1">
                                {as.ads.map((a) => (
                                  <div key={a.adId || a.adName} className="flex items-center gap-2">
                                    {a.thumbnailUrl ? (
                                      <img src={a.thumbnailUrl} alt="" className="w-4 h-4 rounded object-cover shrink-0" />
                                    ) : (
                                      <ImageIcon size={11} className="text-slate-300 shrink-0" />
                                    )}
                                    <button
                                      type="button"
                                      className={`text-[11px] truncate flex-1 text-left ${a.adId ? "text-slate-500 hover:text-blue-600 hover:underline" : "text-slate-400"}`}
                                      onClick={() => onOpenAd(c, as, a)}
                                      title={a.adId ? "View ad" : "No ad attribution"}
                                    >
                                      {a.adName}
                                    </button>
                                    <button type="button" className="text-[10px] text-slate-400 hover:text-indigo-600 shrink-0" onClick={() => onOpenAdOrders(a)}>
                                      {a.orders}
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function DrawerSkeleton() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {Array.from({ length: 9 }).map((_, i) => (
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

function DrawerError({ message, onRetry }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <span className="flex items-center justify-center w-14 h-14 rounded-2xl bg-rose-100 text-rose-600 mb-4">
        <AlertTriangle size={26} />
      </span>
      <h3 className="font-display font-semibold text-slate-700 mb-1">Couldn't load this day's hourly breakdown</h3>
      <p className="text-sm text-slate-400 max-w-sm mb-5">{message}</p>
      <button type="button" className="btn btn-primary btn-sm" onClick={onRetry}>
        <RefreshCw size={14} /> Try again
      </button>
    </div>
  );
}
