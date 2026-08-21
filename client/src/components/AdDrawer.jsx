import { useEffect, useState } from "react";
import {
  X, RefreshCw, AlertTriangle, Megaphone, Wallet, Gauge, Package,
  CreditCard, Truck, PackageCheck, Clock, RotateCcw, Users, Image as ImageIcon, ExternalLink,
  Video, Anchor,
} from "lucide-react";
import { fetchAdDetails, fetchAdOrders, fetchAdCreative } from "../lib/api";
import { useAdDrawer } from "../lib/AdDrawerContext";
import { useAdSetDrawer } from "../lib/AdSetDrawerContext";
import { useCampaignDrawer } from "../lib/CampaignDrawerContext";
import { useOrderDrawer } from "../lib/OrderDrawerContext";
import { currency, number, multiplier, percent, formatDate } from "../lib/format";
import { roasClass, statusBadgeClass } from "../lib/campaignDisplay";
import { AdThumbnail } from "./AdCells";
import { shapeOrdersForPopup } from "../lib/shapeOrder";
import { useOverlayEscape } from "../lib/overlayStack";

// ─────────────────────────────────────────────────────────────
// Phase 13 §9 — Ad Drawer. Same self-contained-copy convention as
// AdSetDrawer.jsx. One z-index tier above AdSetDrawer (that's how a user
// typically gets here), below Order/Customer drawers. Every order row
// opens the existing, untouched Order Drawer.
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
      <div className="text-slate-700 break-words whitespace-pre-wrap">{value ?? "N/A"}</div>
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

export default function AdDrawer() {
  const { activeAd, closeAd } = useAdDrawer();
  const { openAdSet } = useAdSetDrawer();
  const { openCampaign } = useCampaignDrawer();
  const { openOrder } = useOrderDrawer();

  const open = !!activeAd;
  const [details, setDetails] = useState(null);
  const [creative, setCreative] = useState(null);
  const [creativeLoading, setCreativeLoading] = useState(false);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useOverlayEscape(open, closeAd);

  useEffect(() => {
    if (!activeAd) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    setCreative(null);
    Promise.all([
      fetchAdDetails(activeAd.tokenId, activeAd.adId, { since: activeAd.since, until: activeAd.until }),
      fetchAdOrders(activeAd.tokenId, activeAd.adId, { since: activeAd.since, until: activeAd.until }),
    ])
      .then(([detailsRes, ordersRes]) => {
        if (cancelled) return;
        setDetails(detailsRes);
        setOrders(shapeOrdersForPopup(ordersRes.orders || []));
      })
      .catch((err) => !cancelled && setError(err.message || "Failed to load ad"))
      .finally(() => !cancelled && setLoading(false));

    setCreativeLoading(true);
    fetchAdCreative(activeAd.tokenId, activeAd.adId)
      .then((res) => !cancelled && setCreative(res.creative))
      .catch(() => !cancelled && setCreative(null))
      .finally(() => !cancelled && setCreativeLoading(false));

    return () => { cancelled = true; };
  }, [activeAd]);

  const ad = details?.ad;
  const metrics = details?.metaInsights;
  const orderMetrics = details?.orders;

  return (
    <>
      <div
        className={`fixed inset-0 z-[58] bg-slate-900/50 backdrop-blur-sm transition-opacity duration-300 ${open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
        onClick={closeAd}
      />
      <div
        className={`fixed top-0 right-0 h-full z-[60] w-full sm:w-[94vw] lg:w-[980px] max-w-full bg-slate-50 shadow-2xl transition-transform duration-300 ease-out flex flex-col ${open ? "translate-x-0" : "translate-x-full"}`}
        role="dialog"
        aria-modal="true"
      >
        {open && (
          <>
            <div className="sticky top-0 z-10 bg-white border-b border-slate-200 px-6 py-4 flex items-center gap-3">
              <AdThumbnail url={ad?.thumbnailUrl || creative?.thumbnailUrl} alt={ad?.adName} size={44} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h2 className="font-display font-bold text-lg text-slate-800 truncate">{ad?.adName || activeAd?.adName || "Ad"}</h2>
                  {(ad?.effectiveStatus || ad?.status) && <span className={`badge ${statusBadgeClass(ad.effectiveStatus || ad.status)}`}>{ad.effectiveStatus || ad.status}</span>}
                </div>
                <p className="text-xs text-slate-400 truncate mt-0.5">
                  <button type="button" className="hover:text-blue-600 hover:underline" onClick={() => (ad?.campaignId || activeAd?.campaignId) && openCampaign({ tokenId: activeAd.tokenId, campaignId: ad?.campaignId || activeAd.campaignId, campaignName: ad?.campaignName || activeAd.campaignName, since: activeAd.since, until: activeAd.until })}>
                    {ad?.campaignName || activeAd?.campaignName || "N/A"}
                  </button>
                  {" → "}
                  <button type="button" className="hover:text-blue-600 hover:underline" onClick={() => (ad?.adsetId || activeAd?.adsetId) && openAdSet({ tokenId: activeAd.tokenId, adsetId: ad?.adsetId || activeAd.adsetId, adsetName: ad?.adsetName || activeAd.adsetName, campaignId: ad?.campaignId || activeAd.campaignId, campaignName: ad?.campaignName || activeAd.campaignName, since: activeAd.since, until: activeAd.until })}>
                    {ad?.adsetName || activeAd?.adsetName || "N/A"}
                  </button>
                  {" · "}{activeAd?.adId}
                </p>
              </div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={closeAd}><X size={14} /></button>
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
                  {/* Phase 30 — Hook Rate, shown prominently near the ad
                      thumbnail/name (same "highlight the headline number"
                      treatment CampaignDrawer.jsx gives ROAS), not buried
                      in the generic metric grid below. "N/A" whenever
                      Meta didn't return a genuine 3-second video-view
                      metric for this ad/range — never approximated from a
                      different metric. */}
                  <div className="card !p-4 flex items-center gap-4 bg-indigo-50/60 border-indigo-100">
                    <span className="flex items-center justify-center w-12 h-12 rounded-2xl bg-indigo-100 text-indigo-600 shrink-0">
                      <Anchor size={22} />
                    </span>
                    <div className="min-w-0">
                      <div className="text-xs text-indigo-500 font-medium">Hook Rate</div>
                      <div className="text-2xl font-display font-bold text-indigo-700 truncate">{percent(metrics?.hookRate)}</div>
                      <div className="text-[11px] text-indigo-400 mt-0.5">3-second video views ÷ impressions</div>
                    </div>
                    <div className="ml-auto text-right shrink-0">
                      <div className="text-[11px] text-indigo-400 flex items-center gap-1 justify-end">
                        <Video size={11} /> Video Views
                      </div>
                      <div className="text-base font-semibold text-indigo-700">{number(metrics?.videoViews)}</div>
                    </div>
                  </div>

                  {ad?.metaAvailable === false && (
                    <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                      <AlertTriangle size={14} /> Meta metadata for this ad isn't available (deleted, or the token doesn't have access). Order data below is still shown from Shiprocket's stored attribution.
                    </div>
                  )}

                  <div className="flex flex-wrap gap-3">
                    <Kpi icon={Wallet} label="Spend" value={currency(metrics?.spend)} />
                    <Kpi icon={Gauge} label="ROAS" value={multiplier(metrics?.roas)} />
                    <Kpi icon={Package} label="Total Orders" value={number(orderMetrics?.totalOrders)} />
                    <Kpi icon={CreditCard} label="Revenue" value={currency(orderMetrics?.revenue)} />
                    <Kpi icon={Truck} label="COD" value={number(orderMetrics?.codOrders)} />
                    <Kpi icon={CreditCard} label="Prepaid" value={number(orderMetrics?.prepaidOrders)} />
                    <Kpi icon={PackageCheck} label="Delivered" value={number(orderMetrics?.delivered)} />
                    <Kpi icon={Clock} label="Pending" value={number(orderMetrics?.pending)} />
                    <Kpi icon={RotateCcw} label="RTO" value={number(orderMetrics?.rto)} />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="card !p-3">
                      <div className="text-[11px] text-slate-400">Impressions</div>
                      <div className="text-base font-bold text-slate-800">{number(metrics?.impressions)}</div>
                    </div>
                    <div className="card !p-3">
                      <div className="text-[11px] text-slate-400">Reach</div>
                      <div className="text-base font-bold text-slate-800">{number(metrics?.reach)}</div>
                    </div>
                    <div className="card !p-3">
                      <div className="text-[11px] text-slate-400">CTR / CPC / CPM</div>
                      <div className="text-sm font-semibold text-slate-800">{metrics?.ctr?.toFixed?.(2) ?? "N/A"}% · {currency(metrics?.cpc)} · {currency(metrics?.cpm)}</div>
                    </div>
                    <div className="card !p-3">
                      <div className="text-[11px] text-slate-400">Clicks</div>
                      <div className="text-base font-bold text-slate-800">{number(metrics?.clicks)}</div>
                    </div>
                  </div>

                  <Section title="Creative Details" icon={ImageIcon}>
                    {creativeLoading ? (
                      <p className="text-sm text-slate-400 py-3">Loading creative…</p>
                    ) : !creative ? (
                      <p className="text-sm text-slate-400 py-3">No creative details available for this ad.</p>
                    ) : (
                      <div className="flex flex-col sm:flex-row gap-4">
                        {(creative.thumbnailUrl || creative.imageUrl) && (
                          <img src={creative.thumbnailUrl || creative.imageUrl} alt="Creative" className="w-full sm:w-40 h-40 object-cover rounded-lg border border-slate-200 shrink-0" />
                        )}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3 text-sm flex-1">
                          <Field label="Creative ID" value={creative.creativeId} />
                          <Field label="Ad Format" value={creative.adFormat} />
                          <Field label="Headline" value={creative.headline} />
                          <Field label="Call To Action" value={creative.callToAction} />
                          <Field label="Primary Text" value={creative.primaryText} className="sm:col-span-2" />
                          <Field label="Description" value={creative.description} className="sm:col-span-2" />
                          <Field
                            label="Destination URL"
                            value={
                              creative.destinationUrl ? (
                                <a href={creative.destinationUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline inline-flex items-center gap-1">
                                  {creative.destinationUrl} <ExternalLink size={11} />
                                </a>
                              ) : "N/A"
                            }
                            className="sm:col-span-2"
                          />
                          {creative.previewUrl && (
                            <Field
                              label="Preview"
                              value={
                                <a href={creative.previewUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline inline-flex items-center gap-1">
                                  Open ad preview <ExternalLink size={11} />
                                </a>
                              }
                              className="sm:col-span-2"
                            />
                          )}
                        </div>
                      </div>
                    )}
                  </Section>

                  <Section title={`Orders (${orders.length})`} icon={Users}>
                    {orders.length === 0 ? (
                      <p className="text-sm text-slate-400 py-3">No orders attributed to this ad.</p>
                    ) : (
                      <div className="overflow-x-auto -mx-4 max-h-[360px] overflow-y-auto">
                        <table className="table">
                          <thead className="sticky top-0 bg-white">
                            <tr><th>Order ID</th><th>Customer</th><th>Payment</th><th>Status</th><th className="text-right">Amount</th><th>Date</th></tr>
                          </thead>
                          <tbody>
                            {orders.map((o) => (
                              <tr key={o.orderId} className="cursor-pointer" onClick={() => openOrder({ orderId: o.orderId, tokenId: activeAd.tokenId })}>
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
