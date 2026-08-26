import { useMemo, useState } from "react";
import { Wallet, ShoppingBag, TrendingUp, Gauge } from "lucide-react";
import { currency, number, multiplier } from "../../lib/format";
import { isGoodRoas } from "../../lib/campaignDisplay";
import { classifyOrdersByPeriods } from "../../lib/campaignActivityDisplay";
import OrdersListPopup from "../OrdersListPopup";

// ────────────────────────────────────────────────────────────────
// Phase 39 §7/§9/§17 — Active Performance / Post-Campaign / Inactive-
// Period order tiles. Every number here comes straight from the
// additive fields campaigns.js's /:campaignId/details already returns
// on `campaign` (activePeriodOrders/Revenue, postCampaignOrders/Revenue,
// inactivePeriodOrders/Revenue, primaryRoas, ...) — this component
// never recomputes them. The click-through order lists use
// classifyOrdersByPeriods() (campaignActivityDisplay.js) purely to
// figure out which of the already-fetched `orders` belong in which
// popup — same counts, same totals, just re-derived client-side so the
// existing OrdersListPopup drill-down pattern keeps working here too
// (spec §17: "All statistics should remain clickable").
//
// `spend` is passed in separately (from metaInsights.spend) rather than
// read off `campaign` — it's already, by construction, active-period
// spend (see server/lib/campaignActivity.js's computePrimaryRoas()
// header), so it's shown as-is under "Active Performance" without a
// second, redundant field name.
// ────────────────────────────────────────────────────────────────

function Tile({ icon: Icon, label, value, onClick, tone }) {
  const clickable = typeof onClick === "function";
  return (
    <button
      type="button"
      disabled={!clickable}
      onClick={onClick}
      className={`rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-left transition-colors ${
        clickable ? "hover:border-indigo-300 hover:bg-indigo-50/40 cursor-pointer" : "cursor-default"
      }`}
    >
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-400">
        {Icon && <Icon size={12} />}
        {label}
      </div>
      <div
        className={`text-base font-display font-semibold mt-0.5 ${
          tone === "rose" ? "text-rose-600" : tone === "emerald" ? "text-emerald-600" : "text-slate-800"
        }`}
      >
        {value}
      </div>
    </button>
  );
}

export default function ActivePerformanceSection({ campaign, spend, orders, periods, historicalDataAvailableFrom, tokenId, since, until }) {
  const [popupKey, setPopupKey] = useState(null);

  const buckets = useMemo(
    () => classifyOrdersByPeriods(orders || [], { periods, historicalDataAvailableFrom }),
    [orders, periods, historicalDataAvailableFrom]
  );

  if (!campaign) return null;

  const showPostCampaign = campaign.activityStatus === "closed" || Number(campaign.postCampaignOrders || 0) > 0;
  const showInactive = Number(campaign.inactivePeriodOrders || 0) > 0;
  const showHistoricalNote = Number(campaign.historicalUnavailableOrders || 0) > 0;

  const popupConfig = {
    active: { title: "Active-Period Orders", list: buckets.active },
    post: { title: "Post-Campaign Orders", list: buckets.postCampaign },
    inactive: { title: "Inactive / Paused-Period Orders", list: buckets.inactivePaused },
    historical: { title: "Historical Orders (Tracking Unavailable)", list: buckets.historicalUnavailable },
  }[popupKey];

  const roasTone = campaign.primaryRoas === null || campaign.primaryRoas === undefined ? undefined : isGoodRoas(campaign.primaryRoas) ? "emerald" : "rose";

  return (
    <div className="space-y-4">
      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Active Performance</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <Tile icon={Wallet} label="Spend" value={currency(spend)} />
          <Tile icon={ShoppingBag} label="Orders" value={number(campaign.activePeriodOrders)} onClick={() => setPopupKey("active")} />
          <Tile icon={TrendingUp} label="Revenue" value={currency(campaign.activePeriodRevenue)} onClick={() => setPopupKey("active")} />
          <Tile
            icon={Gauge}
            label="Primary ROAS"
            value={campaign.primaryRoas === null || campaign.primaryRoas === undefined ? "N/A" : multiplier(campaign.primaryRoas)}
            tone={roasTone}
          />
        </div>
      </div>

      {showPostCampaign && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Post-Campaign</div>
          <div className="grid grid-cols-2 gap-2.5">
            <Tile icon={ShoppingBag} label="Orders" value={number(campaign.postCampaignOrders)} onClick={() => setPopupKey("post")} />
            <Tile icon={TrendingUp} label="Revenue" value={currency(campaign.postCampaignRevenue)} onClick={() => setPopupKey("post")} />
          </div>
          <div className="text-xs text-slate-400 mt-1.5">Orders received after the campaign's final closure — never included in the Primary ROAS above.</div>
        </div>
      )}

      {showInactive && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Inactive / Paused-Period Orders</div>
          <div className="grid grid-cols-2 gap-2.5">
            <Tile icon={ShoppingBag} label="Orders" value={number(campaign.inactivePeriodOrders)} onClick={() => setPopupKey("inactive")} />
            <Tile icon={TrendingUp} label="Revenue" value={currency(campaign.inactivePeriodRevenue)} onClick={() => setPopupKey("inactive")} />
          </div>
        </div>
      )}

      {showHistoricalNote && (
        <div className="text-xs text-slate-400">
          {number(campaign.historicalUnavailableOrders)} order(s) ({currency(campaign.historicalUnavailableRevenue)}) fall before activity
          tracking began for this campaign and aren't classified as Active or Post-Campaign.{" "}
          <button type="button" className="underline hover:text-slate-600" onClick={() => setPopupKey("historical")}>
            View
          </button>
        </div>
      )}

      {popupConfig && (
        <OrdersListPopup
          open
          title={popupConfig.title}
          subtitle={campaign.name}
          orders={popupConfig.list}
          tokenId={tokenId}
          since={since}
          until={until}
          onClose={() => setPopupKey(null)}
          storageKey="campaignActivityOrdersPopup"
        />
      )}
    </div>
  );
}
