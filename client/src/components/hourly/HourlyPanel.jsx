import { useEffect, useState } from "react";
import { AlertTriangle, Clock } from "lucide-react";
import { todayIso, shiftDays } from "../../lib/dateIst";
import { fetchHourlyReport, fetchHourlyOrders } from "../../lib/api";
import { HOURLY_COLUMNS, HOURLY_DEFAULT_HIDDEN } from "../../lib/hourlyColumns";
import DataTable from "../DataTable";
import OrdersListPopup from "../OrdersListPopup";
import { shapeOrdersForPopup } from "../../lib/shapeOrder";
import { currency } from "../../lib/format";

// ─────────────────────────────────────────────────────────────
// Phase 13 §1/§2/§11/§15 — reusable Hourly Performance panel: a
// Today/Yesterday/Custom Date picker, a 24-row table (full column
// customization via the shared DataTable/useColumnPrefs system, §17),
// and click-a-row-to-drill-into-its-orders (via the existing
// OrdersListPopup, so rows still open the real Order Drawer).
//
// Purely additive — reads from the brand-new /api/hourly routes only.
// Embedded wherever the spec asks for an Hourly view (Campaign Drawer,
// Daily Drawer, Analytics' Hourly tab, Campaign Explorer's per-campaign
// breakdown) without duplicating this logic per page.
//
// Scope is passed in via props — omit all of campaignId/adsetId/adId to
// get the whole-account hourly view (Dashboard/Analytics level); pass
// campaignId for "Campaign A → Today" (§2); pass adsetId/adId to go all
// the way to ad-level hourly (§11).
// ─────────────────────────────────────────────────────────────

export default function HourlyPanel({
  tokenId,
  accountIds,
  campaignId,
  campaignName,
  adsetId,
  adsetName,
  adId,
  adName,
  tableIdSuffix = "default",
  title = "Hourly Performance",
  // Phase 13 §12 — when set (e.g. from Daily Drawer, which is already
  // showing one specific calendar day), pins the panel to that exact
  // date and hides the Today/Yesterday/Custom picker entirely instead of
  // defaulting to "today" and requiring an extra click.
  fixedDate = null,
}) {
  const today = todayIso();
  const [mode, setMode] = useState("today"); // today | yesterday | custom
  const [customDate, setCustomDate] = useState(fixedDate || today);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [popup, setPopup] = useState({ open: false, hour: null, orders: [], loading: false });

  const date = fixedDate || (mode === "today" ? today : mode === "yesterday" ? shiftDays(today, -1) : customDate);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      // Nothing to scope this hourly view to yet (no account and no
      // campaign/adset/ad) — wait for the caller to supply one instead
      // of firing a request that the backend will 400 on.
      if (!accountIds?.length && !campaignId && !adsetId && !adId) return;
      setLoading(true);
      setError(null);
      try {
        const res = await fetchHourlyReport(tokenId, { accountIds, date, campaignId, adsetId, adId });
        if (!cancelled) setReport(res);
      } catch (err) {
        if (!cancelled) setError(err.message || "Failed to load hourly report");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [tokenId, JSON.stringify(accountIds), date, campaignId, adsetId, adId]);

  const openHour = async (row) => {
    setPopup({ open: true, hour: row.hour, orders: [], loading: true });
    try {
      const res = await fetchHourlyOrders(tokenId, { date, hour: row.hour, campaignId, campaignName, adsetId, adId });
      setPopup({ open: true, hour: row.hour, orders: shapeOrdersForPopup(res.orders), loading: false });
    } catch (err) {
      setPopup({ open: true, hour: row.hour, orders: [], loading: false });
    }
  };

  const hours = report?.hours || [];
  const scopeLabel = adName || adsetName || campaignName || "All Campaigns";

  return (
    <div>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <Clock size={15} />
          {title}
        </div>
        {!fixedDate && (
          <div className="flex items-center gap-2">
            {["today", "yesterday", "custom"].map((m) => (
              <button
                key={m}
                type="button"
                className={`btn btn-sm ${mode === m ? "btn-primary" : "btn-secondary"}`}
                onClick={() => setMode(m)}
              >
                {m === "today" ? "Today" : m === "yesterday" ? "Yesterday" : "Custom Date"}
              </button>
            ))}
            {mode === "custom" && (
              <input
                type="date"
                className="input w-auto !py-1.5 !text-xs"
                max={today}
                value={customDate}
                onChange={(e) => setCustomDate(e.target.value)}
              />
            )}
          </div>
        )}
      </div>

      <p className="text-xs text-slate-400 mb-3">{scopeLabel} · {date}</p>

      {error && (
        <div className="flex items-center gap-2 text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2 mb-3">
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      {report && report.metaHourlyAvailable === false && (
        <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mb-3">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>
            Meta didn't return hourly ad-spend data for this account/date — Meta requires an ad account to explicitly
            enable hourly breakdowns before the Insights API returns them. Order-level figures below (orders, revenue,
            COD/prepaid, delivery) are still accurate; the Spend/ROAS/CPA columns will read 0 until that's enabled on
            Meta's side.
          </span>
        </div>
      )}

      {report && (
        <div className="flex flex-wrap gap-3 mb-4">
          <div className="card !p-3 flex-1 min-w-[130px]">
            <div className="text-[11px] text-slate-400 mb-0.5">Total Spend</div>
            <div className="text-lg font-bold text-slate-800">{currency(report.summary.totalSpend)}</div>
          </div>
          <div className="card !p-3 flex-1 min-w-[130px]">
            <div className="text-[11px] text-slate-400 mb-0.5">Total Orders</div>
            <div className="text-lg font-bold text-slate-800">{report.summary.totalOrders}</div>
          </div>
          <div className="card !p-3 flex-1 min-w-[130px]">
            <div className="text-[11px] text-slate-400 mb-0.5">Total Revenue</div>
            <div className="text-lg font-bold text-slate-800">{currency(report.summary.totalRevenue)}</div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-10 text-sm text-slate-400">Loading hourly data…</div>
      ) : (
        <DataTable
          tableId={`hourly.${tableIdSuffix}`}
          columns={HOURLY_COLUMNS}
          data={hours}
          searchKeys={["label"]}
          onRowClick={openHour}
          rowKey={(r) => r.hour}
          exportFilename={`hourly-${date}.csv`}
          emptyMessage={accountIds?.length || campaignId || adsetId || adId ? "No hourly data for this date." : "Select an ad account, campaign, ad set, or ad to see hourly data."}
        />
      )}

      <OrdersListPopup
        open={popup.open}
        title={popup.hour !== null ? `Orders — ${String(popup.hour).padStart(2, "0")}:00–${String(popup.hour).padStart(2, "0")}:59` : "Orders"}
        subtitle={`${scopeLabel} · ${date}`}
        orders={popup.orders}
        tokenId={tokenId}
        since={date}
        until={date}
        onClose={() => setPopup({ open: false, hour: null, orders: [], loading: false })}
        exportFilename={`hourly-orders-${date}-${popup.hour ?? ""}.csv`}
      />
    </div>
  );
}
