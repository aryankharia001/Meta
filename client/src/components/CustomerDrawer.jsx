import { useEffect, useState } from "react";
import { X, RefreshCw, User, Phone, MapPin, Package, AlertTriangle, FileText, History } from "lucide-react";
import { fetchCustomerByPhone } from "../lib/api";
import { getCachedCustomerDetails, setCachedCustomerDetails } from "../lib/customerDetailsCache";
import { useCustomerDrawer } from "../lib/CustomerDrawerContext";
import { useOrderDrawer } from "../lib/OrderDrawerContext";
import { currency, formatDate, formatDateTime } from "../lib/format";
import { recordRecentlyViewed } from "../lib/recentlyViewed";
import CampaignLink from "./CampaignLink";
import FavoriteButton from "./FavoriteButton";
import EntityNotesPanel from "./EntityNotesPanel";
import { useOverlayEscape } from "../lib/overlayStack";

// ────────────────────────────────────────────────────────────────
// Phase 7 — Customer Drawer. This app never had a standalone customer
// profile before (customer info only ever appeared embedded inside an
// order — see Order Drawer's "Customer Information" section from
// Phase 4, and Analytics' Customer leaderboard from Phase 6). Favorites
// and Notes now need customers to be a first-class, directly-openable
// entity, so this drawer is that profile: order history by phone (the
// same identifier every earlier phase already treats as "the
// customer"), notes, and a favorite toggle. Same drawer chrome/z-index
// pattern as Order/Campaign drawers, one level below them (z-[65]/[75])
// since a click inside here can open the Order Drawer on top of it.
// ────────────────────────────────────────────────────────────────

export default function CustomerDrawer() {
  const { activeCustomer, closeCustomer } = useCustomerDrawer();
  const { openOrder } = useOrderDrawer();
  const open = !!activeCustomer;

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = (meta, { force = false, isNewCustomer = false } = {}) => {
    const { phone } = meta;
    if (!force) {
      const cached = getCachedCustomerDetails(phone);
      if (cached) {
        setData(cached);
        setError("");
        setLoading(false);
        return;
      }
    }
    if (isNewCustomer) setData(null);
    setLoading(true);
    setError("");
    fetchCustomerByPhone(phone)
      .then((res) => {
        setData(res);
        setCachedCustomerDetails(phone, res);
      })
      .catch((err) => setError(err.message || "Failed to load customer"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!activeCustomer) return;
    load(activeCustomer, { isNewCustomer: true });
    recordRecentlyViewed("customer", activeCustomer.phone, data?.customer?.name || activeCustomer.phone);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCustomer?.phone]);

  useOverlayEscape(open, closeCustomer);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const c = data?.customer;
  const orders = data?.orders || [];

  return (
    <>
      <div
        className={`fixed inset-0 z-[65] bg-slate-900/50 backdrop-blur-sm transition-opacity duration-300 ${
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        onClick={closeCustomer}
      />
      <div
        className={`fixed top-0 right-0 h-full z-[75] w-full sm:w-[92vw] lg:w-[820px] max-w-full bg-slate-50 shadow-2xl transition-transform duration-300 ease-out flex flex-col ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        role="dialog"
        aria-modal="true"
      >
        {loading && !data && (
          <>
            <div className="sticky top-0 z-10 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
              <div className="h-6 w-40 bg-slate-100 rounded animate-pulse" />
              <button type="button" className="btn btn-secondary btn-sm" onClick={closeCustomer}>
                <X size={14} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="card h-28 animate-pulse bg-slate-100" />
              ))}
            </div>
          </>
        )}

        {!loading && error && (
          <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
            <span className="flex items-center justify-center w-14 h-14 rounded-2xl bg-rose-100 text-rose-600 mb-4">
              <AlertTriangle size={26} />
            </span>
            <h3 className="font-display font-semibold text-slate-700 mb-1">Couldn't load this customer</h3>
            <p className="text-sm text-slate-400 max-w-sm mb-5">{error}</p>
            <div className="flex gap-2">
              <button type="button" className="btn btn-primary btn-sm" onClick={() => activeCustomer && load(activeCustomer, { force: true })}>
                <RefreshCw size={14} /> Try again
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={closeCustomer}>
                Close
              </button>
            </div>
          </div>
        )}

        {!error && data && c && (
          <>
            <div className="sticky top-0 z-10 bg-white border-b border-slate-200 px-6 py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex items-center gap-2">
                  <FavoriteButton entityType="customer" entityId={c.phone} label={c.name || c.phone} meta={{ phone: c.phone }} size={16} />
                  <div>
                    <h2 className="font-display font-bold text-lg text-slate-800 truncate">{c.name || "Unnamed Customer"}</h2>
                    <div className="text-xs text-slate-400">{c.phone}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => activeCustomer && load(activeCustomer, { force: true })}
                    disabled={loading}
                    title="Refresh"
                  >
                    <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
                  </button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={closeCustomer} title="Close">
                    <X size={14} />
                  </button>
                </div>
              </div>
            </div>

            <div className={`flex-1 overflow-y-auto px-6 py-6 space-y-6 transition-opacity ${loading ? "opacity-60 pointer-events-none" : ""}`}>
              <section>
                <h3 className="flex items-center gap-2 font-display font-semibold text-slate-700 text-sm mb-3">
                  <User size={15} className="text-slate-400" /> Overview
                </h3>
                <div className="card grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3 text-sm">
                  <Field label="Total Orders" value={c.totalOrders} emphasis />
                  <Field label="Total Revenue" value={currency(c.totalRevenue)} emphasis />
                  <Field icon={Phone} label="Phone" value={c.phone} />
                  <Field icon={MapPin} label="Location" value={[c.city, c.state].filter(Boolean).join(", ") || "N/A"} />
                  <Field label="First Order" value={formatDate(c.firstOrderDate)} />
                  <Field label="Last Order" value={formatDate(c.lastOrderDate)} />
                </div>
              </section>

              <section>
                <h3 className="flex items-center gap-2 font-display font-semibold text-slate-700 text-sm mb-3">
                  <History size={15} className="text-slate-400" /> Order History
                </h3>
                <div className="card p-0 overflow-auto max-h-[360px]">
                  <table className="table">
                    <thead className="sticky top-0 z-[1]">
                      <tr>
                        <th>Order ID</th>
                        <th>Date</th>
                        <th>Campaign</th>
                        <th>Amount</th>
                        <th>Payment</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orders.map((o) => (
                        <tr key={o.orderId} className="cursor-pointer" onClick={() => openOrder({ orderId: o.orderId, tokenId: activeCustomer?.tokenId })}>
                          <td className="font-medium text-slate-700">{o.orderId}</td>
                          <td>{formatDateTime(o.orderCreatedAt)}</td>
                          <td onClick={(e) => e.stopPropagation()}>
                            <CampaignLink
                              tokenId={activeCustomer?.tokenId}
                              campaignId={o.campaignId}
                              campaignName={o.campaignName}
                              since={o.orderDate}
                              until={o.orderDate}
                              className="!text-xs"
                            />
                          </td>
                          <td>{currency(o.totalAmountPayable)}</td>
                          <td>
                            <span className={`badge ${o.paymentType === "PREPAID" ? "badge-blue" : "badge-amber"}`}>{o.paymentType || "N/A"}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section>
                <h3 className="flex items-center gap-2 font-display font-semibold text-slate-700 text-sm mb-3">
                  <FileText size={15} className="text-slate-400" /> Internal Notes
                </h3>
                <div className="card">
                  <EntityNotesPanel entityType="customer" entityId={c.phone} />
                </div>
              </section>
            </div>
          </>
        )}
      </div>
    </>
  );
}

function Field({ icon: Icon, label, value, emphasis }) {
  return (
    <div>
      <div className="text-[11px] text-slate-400 mb-0.5 flex items-center gap-1">
        {Icon && <Icon size={10} />} {label}
      </div>
      <div className={emphasis ? "text-base font-bold text-slate-800" : "text-slate-700"}>{value}</div>
    </div>
  );
}
