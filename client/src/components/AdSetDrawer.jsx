import { useEffect, useState } from "react";
import {
  X, RefreshCw, AlertTriangle, Layers, Target, Wallet, Gauge, Package,
  CreditCard, Truck, PackageCheck, Clock, RotateCcw, Calendar, Megaphone, Users, Clock4,
  Video, Anchor,
} from "lucide-react";
import { fetchAdSetDetails, fetchAdSetOrders, fetchAdsByAdSet } from "../lib/api";
import { useAdSetDrawer } from "../lib/AdSetDrawerContext";
import { useAdDrawer } from "../lib/AdDrawerContext";
import { useCampaignDrawer } from "../lib/CampaignDrawerContext";
import { useOrderDrawer } from "../lib/OrderDrawerContext";
import { currency, number, multiplier, percent, formatDate } from "../lib/format";
import { roasClass, statusBadgeClass, formatBudget, bidCapApplicability } from "../lib/campaignDisplay";
import { AdThumbnail } from "./AdCells";
import HourlyPanel from "./hourly/HourlyPanel";
// Phase 27 — Budget & Bid Cap Control section. New, additive import;
// nothing above/below this line is touched.
import BudgetBidControlSection from "./control/BudgetBidControlSection";
import { shapeOrdersForPopup } from "../lib/shapeOrder";
import { useOverlayEscape } from "../lib/overlayStack";
// Phase 32 §4 — "Open in Meta Ads Manager" button. New, additive import.
import OpenInMetaButton from "./OpenInMetaButton";

// ─────────────────────────────────────────────────────────────
// Phase 13 §10 — Ad Set Drawer. Mirrors CampaignDrawer.jsx's overall
// shell (backdrop + slide-in panel, sticky header, Section/Field card
// layout, skeleton/error states) as its own self-contained copy — same
// "zero coupling between phases/surfaces" convention every drawer in
// this app already follows — rather than importing anything from
// CampaignDrawer.jsx. Sits one z-index tier above CampaignDrawer (which
// is how a user gets here — via a campaign's Ad Sets section) and below
// the Order/Customer drawers.
// ─────────────────────────────────────────────────────────────

function Section({ title, icon: Icon, children }) {
  return (
    <section>
      <h3 className="flex items-center gap-2 font-display font-semibold text-slate-700 text-sm mb-3">
        <Icon size={15} className="text-slate-400" />
        {title}
      </h3>
      <div className="card">{children}</div>
    </section>
  );
}
function Field({ label, value, className = "" }) {
  return (
    <div className={className}>
      <div className="text-[11px] text-slate-400 mb-0.5">{label}</div>
      <div className="text-slate-700 break-words">{value ?? "N/A"}</div>
    </div>
  );
}
function Kpi({ icon: Icon, label, value }) {
  return (
    <div className="card !p-3 flex items-center gap-3 min-w-[150px] flex-1">
      <span className="flex items-center justify-center w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 shrink-0">
        <Icon size={16} />
      </span>
      <div className="min-w-0">
        <div className="text-[11px] text-slate-400">{label}</div>
        <div className="text-base font-bold text-slate-800 truncate">{value}</div>
      </div>
    </div>
  );
}

export default function AdSetDrawer() {
  const { activeAdSet, closeAdSet } = useAdSetDrawer();
  const { openAd } = useAdDrawer();
  const { openCampaign } = useCampaignDrawer();
  const { openOrder } = useOrderDrawer();

  const open = !!activeAdSet;
  const [details, setDetails] = useState(null);
  const [ads, setAds] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useOverlayEscape(open, closeAdSet);

  useEffect(() => {
    if (!activeAdSet) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    Promise.all([
      fetchAdSetDetails(activeAdSet.tokenId, activeAdSet.adsetId, { since: activeAdSet.since, until: activeAdSet.until }),
      fetchAdsByAdSet(activeAdSet.tokenId, activeAdSet.adsetId, { since: activeAdSet.since, until: activeAdSet.until }),
      fetchAdSetOrders(activeAdSet.tokenId, activeAdSet.adsetId, { since: activeAdSet.since, until: activeAdSet.until }),
    ])
      .then(([detailsRes, adsRes, ordersRes]) => {
        if (cancelled) return;
        setDetails(detailsRes);
        setAds(adsRes.ads || []);
        setOrders(shapeOrdersForPopup(ordersRes.orders || []));
      })
      .catch((err) => !cancelled && setError(err.message || "Failed to load ad set"))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [activeAdSet]);

  const adset = details?.adset;
  const metrics = details?.metaInsights;
  const orderMetrics = details?.orders;

  return (
    <>
      <div
        className={`fixed inset-0 z-[54] bg-slate-900/50 backdrop-blur-sm transition-opacity duration-300 ${open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
        onClick={closeAdSet}
      />
      <div
        className={`fixed top-0 right-0 h-full z-[56] w-full sm:w-[94vw] lg:w-[980px] max-w-full bg-slate-50 shadow-2xl transition-transform duration-300 ease-out flex flex-col ${open ? "translate-x-0" : "translate-x-full"}`}
        role="dialog"
        aria-modal="true"
      >
        {open && (
          <>
            <div className="sticky top-0 z-10 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Layers size={16} className="text-indigo-500 shrink-0" />
                  <h2 className="font-display font-bold text-lg text-slate-800 truncate">{adset?.adsetName || activeAdSet?.adsetName || "Ad Set"}</h2>
                  {(adset?.effectiveStatus || adset?.status) && (
                    <span className={`badge ${statusBadgeClass(adset.effectiveStatus || adset.status)}`}>{adset.effectiveStatus || adset.status}</span>
                  )}
                </div>
                <p className="text-xs text-slate-400 truncate mt-0.5">
                  Campaign:{" "}
                  <button
                    type="button"
                    className="hover:text-blue-600 hover:underline"
                    onClick={() => (adset?.campaignId || activeAdSet?.campaignId) && openCampaign({ tokenId: activeAdSet.tokenId, campaignId: adset?.campaignId || activeAdSet.campaignId, campaignName: adset?.campaignName || activeAdSet.campaignName, since: activeAdSet.since, until: activeAdSet.until })}
                  >
                    {adset?.campaignName || activeAdSet?.campaignName || "N/A"}
                  </button>
                  {" · "}{activeAdSet?.adsetId}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {/* Phase 32 §4 — real Meta object deep link. */}
                <OpenInMetaButton
                  level="adset"
                  accountId={adset?.accountId}
                  campaignId={adset?.campaignId || activeAdSet?.campaignId}
                  adsetId={activeAdSet?.adsetId}
                />
                <button type="button" className="btn btn-secondary btn-sm" onClick={closeAdSet}><X size={14} /></button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
              {loading && !details && <div className="flex items-center justify-center py-16 text-sm text-slate-400"><RefreshCw size={14} className="animate-spin mr-2" /> Loading…</div>}
              {error && (
                <div className="flex items-center gap-2 text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">
                  <AlertTriangle size={14} /> {error}
                </div>
              )}

              {!loading && details && (
                <>
                  {adset?.metaAvailable === false && (
                    <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                      <AlertTriangle size={14} /> Meta metadata for this ad set isn't available (deleted, or the token doesn't have access). Order data below is still shown from Shiprocket's stored attribution.
                    </div>
                  )}

                  <div className="flex flex-wrap gap-3">
                    <Kpi icon={Wallet} label="Spend" value={currency(metrics?.spend)} />
                    <Kpi icon={Gauge} label="ROAS" value={multiplier(metrics?.roas)} />
                    {/* Phase 30 — Video Views / Hook Rate, "N/A" when Meta
                        didn't return a 3-second video-view metric. */}
                    <Kpi icon={Video} label="Video Views" value={number(metrics?.videoViews)} />
                    <Kpi icon={Anchor} label="Hook Rate" value={percent(metrics?.hookRate)} />
                    <Kpi icon={Package} label="Total Orders" value={number(orderMetrics?.totalOrders)} />
                    <Kpi icon={CreditCard} label="Revenue" value={currency(orderMetrics?.revenue)} />
                    <Kpi icon={Truck} label="COD" value={number(orderMetrics?.codOrders)} />
                    <Kpi icon={CreditCard} label="Prepaid" value={number(orderMetrics?.prepaidOrders)} />
                    <Kpi icon={PackageCheck} label="Delivered" value={number(orderMetrics?.delivered)} />
                    <Kpi icon={Clock} label="Pending" value={number(orderMetrics?.pending)} />
                    <Kpi icon={RotateCcw} label="RTO" value={number(orderMetrics?.rto)} />
                  </div>

                  {/* Phase 27 — Budget & Bid Cap Control, History, Sync,
                      Hourly Activity. Purely additive section — reads/
                      writes only the new Phase 27 /adset-control
                      endpoints, nothing else in this drawer is touched. */}
                  <Section title="Budget & Bid Cap Control" icon={Wallet}>
                    <BudgetBidControlSection
                      level="adset"
                      tokenId={activeAdSet.tokenId}
                      entityId={activeAdSet.adsetId}
                      tableIdSuffix={`adset-${activeAdSet.adsetId}`}
                    />
                  </Section>

                  <Section title="Ad Set Information" icon={Target}>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3 text-sm">
                      <Field label="Ad Set ID" value={adset?.adsetId} />
                      <Field label="Campaign ID" value={adset?.campaignId} />
                      <Field label="Budget" value={formatBudget(adset?.budget, adset?.budgetType) || "N/A"} />
                      <Field label="Start Date" value={formatDate(adset?.startTime)} />
                      <Field label="End Date" value={formatDate(adset?.endTime)} />
                      <Field label="Optimization Goal" value={adset?.optimizationGoal} />
                      <Field label="Billing Event" value={adset?.billingEvent} />
                      <Field label="Bid Strategy" value={adset?.bidStrategy} />
                      {/* Phase 32 §2 — real Meta bid_amount when present;
                          "Not Applicable" (never a fake ₹0) when Meta's own
                          bid_strategy says this ad set's bidding doesn't use
                          a manual cap; "Not set" otherwise — same three-way
                          rule as CurrentValuesCard.jsx's Bid Cap tile above,
                          just as a plain info field here. */}
                      <Field
                        label="Bid Cap"
                        value={
                          adset?.bidAmount !== null && adset?.bidAmount !== undefined
                            ? currency(adset.bidAmount)
                            : bidCapApplicability(adset?.bidStrategy) === "not_applicable"
                            ? "Not Applicable"
                            : "Not set"
                        }
                      />
                      <Field label="Targeting" value={adset?.targetingSummary} className="col-span-2 sm:col-span-3" />
                    </div>
                  </Section>

                  <Section title="Hourly Performance" icon={Clock4}>
                    <HourlyPanel
                      tokenId={activeAdSet.tokenId}
                      adsetId={activeAdSet.adsetId}
                      adsetName={adset?.adsetName}
                      tableIdSuffix={`adset-${activeAdSet.adsetId}`}
                      title=""
                    />
                  </Section>

                  <Section title={`Ads in this Ad Set (${ads.length})`} icon={Megaphone}>
                    {ads.length === 0 ? (
                      <p className="text-sm text-slate-400 py-3">No ads found for this ad set in Meta.</p>
                    ) : (
                      <div className="overflow-x-auto -mx-4">
                        <table className="table">
                          <thead>
                            <tr>
                              <th></th><th>Ad</th><th>Status</th><th className="text-right">Spend</th><th className="text-right">ROAS</th><th className="text-right">Orders</th><th className="text-right">Revenue</th>
                            </tr>
                          </thead>
                          <tbody>
                            {ads.map((a) => (
                              <tr
                                key={a.adId}
                                className="cursor-pointer"
                                onClick={() => openAd({ tokenId: activeAdSet.tokenId, adId: a.adId, adName: a.adName, adsetId: activeAdSet.adsetId, adsetName: adset?.adsetName, campaignId: adset?.campaignId, campaignName: adset?.campaignName, since: activeAdSet.since, until: activeAdSet.until })}
                              >
                                <td><AdThumbnail url={a.thumbnailUrl} alt={a.adName} size={28} /></td>
                                <td className="font-medium text-slate-700">{a.adName}</td>
                                <td>{a.effectiveStatus || a.status || "N/A"}</td>
                                <td className="text-right">{currency(a.spend)}</td>
                                <td className={`text-right ${roasClass(a.roas)}`}>{multiplier(a.roas)}</td>
                                <td className="text-right">{a.totalOrders}</td>
                                <td className="text-right">{currency(a.revenue)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </Section>

                  <Section title={`Orders (${orders.length})`} icon={Users}>
                    {orders.length === 0 ? (
                      <p className="text-sm text-slate-400 py-3">No orders attributed to this ad set.</p>
                    ) : (
                      <div className="overflow-x-auto -mx-4 max-h-[360px] overflow-y-auto">
                        <table className="table">
                          <thead className="sticky top-0 bg-white">
                            <tr><th>Order ID</th><th>Customer</th><th>Payment</th><th>Status</th><th className="text-right">Amount</th><th>Date</th></tr>
                          </thead>
                          <tbody>
                            {orders.map((o) => (
                              <tr key={o.orderId} className="cursor-pointer" onClick={() => openOrder({ orderId: o.orderId, tokenId: activeAdSet.tokenId })}>
                                <td className="font-medium text-slate-700">{o.orderId}</td>
                                <td>{o.customerName || "N/A"}</td>
                                <td><span className={`badge ${o.paymentType === "PREPAID" ? "badge-blue" : "badge-amber"}`}>{o.paymentType || "N/A"}</span></td>
                                <td>{o.deliveryStatus || o.orderStatus || "N/A"}</td>
                                <td className="text-right">{currency(o.totalAmountPayable)}</td>
                                <td>{formatDate(o.orderDate)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </Section>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
