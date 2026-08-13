import { useEffect, useMemo, useRef, useState } from "react";
import {
  X,
  Copy,
  Check,
  RefreshCw,
  User,
  Phone,
  Mail,
  MapPin,
  Package,
  Truck,
  CreditCard,
  Megaphone,
  Clock,
  History,
  Repeat,
  Search,
  AlertTriangle,
  Inbox,
  Plus,
  Trash2,
  Pencil,
  ExternalLink,
  FileText,
  Paperclip,
  CircleDot,
  Receipt,
} from "lucide-react";
import { fetchOrderDetailsFull, addOrderNote, updateOrderNote, deleteOrderNote } from "../lib/api";
import { getCachedOrderDetails, setCachedOrderDetails, patchCachedOrderNotes } from "../lib/orderDetailsCache";
import { useOrderDrawer } from "../lib/OrderDrawerContext";
import { useCustomerDrawer } from "../lib/CustomerDrawerContext";
import { usePreferences } from "../lib/PreferencesContext";
import { currency, formatDate, formatDateTime } from "../lib/format";
import { recordRecentlyViewed } from "../lib/recentlyViewed";
import CampaignLink from "./CampaignLink";
// Phase 13 §7/§19 — the Ad Set/Ad fields already existed as plain text
// here; this just makes them clickable (opens the new Ad Set/Ad
// drawers) when an id is present, and falls back to "Unmatched" —
// never a guess — when it isn't. Doesn't touch how these fields are
// fetched or matched.
import AdSetLink from "./AdSetLink";
import AdLink from "./AdLink";
import FavoriteButton from "./FavoriteButton";
import { useOverlayEscape } from "../lib/overlayStack";

// ────────────────────────────────────────────────────────────────
// Phase 4 — Order Drawer. The single, shared component every order
// click anywhere in the app opens (Dashboard tables, KPI popups,
// Campaign Drawer, a customer's own order history inside this same
// drawer). Talks only to the new, additive GET/POST/PUT/DELETE
// /api/order-details routes — never touches ShiprocketOrder writes, the
// sync/backfill jobs, or campaign matching.
// ────────────────────────────────────────────────────────────────

const TIMELINE_STAGES = [
  "Order Created",
  "Confirmed",
  "Packed",
  "Pickup Scheduled",
  "Shipped",
  "Out for Delivery",
  "Delivered",
  "Cancelled",
  "Returned",
  "RTO",
];

function statusBadgeClass(status) {
  if (!status) return "badge-slate";
  const s = status.toLowerCase();
  if (s.includes("deliver") && !s.includes("out for")) return "badge-green";
  if (s.includes("cancel")) return "badge-rose";
  if (s.includes("return") || s.includes("rto")) return "badge-rose";
  if (s.includes("transit") || s.includes("out for") || s.includes("ship")) return "badge-blue";
  if (s.includes("pending") || s.includes("process") || s.includes("confirm")) return "badge-amber";
  return "badge-slate";
}

export default function OrderDrawer() {
  const { activeOrder, closeOrder, openOrder } = useOrderDrawer();
  const { openCustomer } = useCustomerDrawer();
  const { prefs } = usePreferences();
  const open = !!activeOrder;

  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copiedField, setCopiedField] = useState("");
  const [productSearch, setProductSearch] = useState("");

  const [noteText, setNoteText] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [editingText, setEditingText] = useState("");
  const [noteError, setNoteError] = useState("");

  const historyRef = useRef(null);

  const load = (meta, { force = false, isNewOrder = false } = {}) => {
    const { orderId } = meta;
    if (!force) {
      const cached = getCachedOrderDetails(orderId);
      if (cached) {
        setDetails(cached);
        setError("");
        setLoading(false);
        return;
      }
    }
    if (isNewOrder) setDetails(null); // avoid flashing the previous order's data — same fix as Phase 2's campaign drawer
    setLoading(true);
    setError("");
    fetchOrderDetailsFull(orderId)
      .then((res) => {
        setDetails(res);
        setCachedOrderDetails(orderId, res);
      })
      .catch((err) => setError(err.message || "Failed to load order"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!activeOrder) return;
    setProductSearch("");
    setNoteText("");
    setNoteError("");
    setEditingNoteId(null);
    load(activeOrder, { isNewOrder: true });
    recordRecentlyViewed("order", activeOrder.orderId, activeOrder.orderId, { tokenId: activeOrder.tokenId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrder?.orderId]);

  useOverlayEscape(open, closeOrder);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const copy = async (text, field) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(""), 1500);
    } catch {
      // clipboard permission denied — silently ignore
    }
  };

  const o = details?.order;
  const notes = details?.notes || [];
  const history = details?.customerHistory || [];
  const repeatCount = history.length;

  const filteredProducts = useMemo(() => {
    const products = o?.products || [];
    const q = productSearch.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => [p.name, p.sku].filter(Boolean).join(" ").toLowerCase().includes(q));
  }, [o, productSearch]);

  const fullAddress = useMemo(() => {
    if (!o) return "";
    const a = o.customer.address;
    return [a.line1, a.line2, a.landmark, a.city, a.state, a.pincode, a.country].filter(Boolean).join(", ");
  }, [o]);

  const handleAddNote = async () => {
    if (!noteText.trim() || !activeOrder) return;
    setSavingNote(true);
    setNoteError("");
    try {
      const res = await addOrderNote(activeOrder.orderId, noteText.trim(), prefs.authorName || null);
      const updated = [res.note, ...notes];
      setDetails((d) => ({ ...d, notes: updated }));
      patchCachedOrderNotes(activeOrder.orderId, updated);
      setNoteText("");
    } catch (err) {
      setNoteError(err.message || "Failed to add note");
    } finally {
      setSavingNote(false);
    }
  };

  const startEditNote = (note) => {
    setEditingNoteId(note.id);
    setEditingText(note.text);
  };

  const handleUpdateNote = async (noteId) => {
    if (!editingText.trim()) return;
    setNoteError("");
    try {
      const res = await updateOrderNote(noteId, editingText.trim(), prefs.authorName || null);
      const updated = notes.map((n) => (n.id === noteId ? res.note : n));
      setDetails((d) => ({ ...d, notes: updated }));
      patchCachedOrderNotes(activeOrder.orderId, updated);
      setEditingNoteId(null);
    } catch (err) {
      setNoteError(err.message || "Failed to update note");
    }
  };

  const handleDeleteNote = async (noteId) => {
    setNoteError("");
    try {
      await deleteOrderNote(noteId);
      const updated = notes.filter((n) => n.id !== noteId);
      setDetails((d) => ({ ...d, notes: updated }));
      patchCachedOrderNotes(activeOrder.orderId, updated);
    } catch (err) {
      setNoteError(err.message || "Failed to delete note");
    }
  };

  const openHistoryOrder = (orderId) => {
    if (!activeOrder || orderId === activeOrder.orderId) return;
    openOrder({ orderId, tokenId: activeOrder?.tokenId });
  };

  const scrollToHistory = () => historyRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  // Which timeline stages have a real timestamp behind them, best-effort
  // matched from whatever extractTimelineEvents() found on the backend,
  // plus the two stages we always genuinely know (Created from
  // orderCreatedAt, and Delivered/Cancelled/Returned/RTO if
  // deliveryStatus says so).
  const stageTimestamp = (stage) => {
    if (stage === "Order Created") return o?.orderCreatedAt;
    const match = (o?.timeline || []).find((e) => (e.status || "").toLowerCase().includes(stage.toLowerCase()));
    if (match) return match.date;
    const ds = (o?.deliveryStatus || "").toLowerCase();
    if (stage === "Delivered" && ds.includes("deliver")) return o?.lastUpdated;
    if (stage === "Cancelled" && ds.includes("cancel")) return o?.lastUpdated;
    if ((stage === "Returned" || stage === "RTO") && (ds.includes("return") || ds.includes("rto"))) return o?.lastUpdated;
    return null;
  };

  return (
    <>
      <div
        className={`fixed inset-0 z-[70] bg-slate-900/50 backdrop-blur-sm transition-opacity duration-300 ${
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        onClick={closeOrder}
      />

      <div
        className={`fixed top-0 right-0 h-full z-[80] w-full sm:w-[94vw] lg:w-[1000px] max-w-full bg-slate-50 shadow-2xl transition-transform duration-300 ease-out flex flex-col ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        role="dialog"
        aria-modal="true"
      >
        {loading && !details && <DrawerSkeleton onClose={closeOrder} />}

        {!loading && error && (
          <DrawerError message={error} onRetry={() => activeOrder && load(activeOrder, { force: true })} onClose={closeOrder} />
        )}

        {!error && details && o && (
          <>
            {/* ── Sticky header ──────────────────────────────── */}
            <div className="sticky top-0 z-10 bg-white border-b border-slate-200 px-6 py-4">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <FavoriteButton
                      entityType="order"
                      entityId={o.orderId}
                      label={`Order ${o.orderId}`}
                      meta={{ tokenId: activeOrder?.tokenId }}
                      size={16}
                    />
                    <h2 className="font-display font-bold text-lg text-slate-800 truncate">Order {o.orderId}</h2>
                    {o.orderStatus && <span className={`badge ${statusBadgeClass(o.orderStatus)}`}>{o.orderStatus}</span>}
                    {o.deliveryStatus && (
                      <span className={`badge ${statusBadgeClass(o.deliveryStatus)}`}>{o.deliveryStatus}</span>
                    )}
                    <span className={`badge ${o.paymentType === "PREPAID" ? "badge-blue" : "badge-amber"}`}>
                      {o.paymentType || "N/A"}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-slate-400">
                    <span>{formatDateTime(o.orderCreatedAt)}</span>
                    <CopyChip label="Order ID" copied={copiedField === "orderId"} onClick={() => copy(o.orderId, "orderId")} />
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => activeOrder && load(activeOrder, { force: true })}
                    disabled={loading}
                    title="Refresh (bypass cache)"
                  >
                    <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
                  </button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={closeOrder} title="Close">
                    <X size={14} />
                  </button>
                </div>
              </div>

              {/* Quick actions */}
              <div className="flex items-center gap-2 flex-wrap">
                <QuickAction label="Copy Order ID" copied={copiedField === "qa-order"} onClick={() => copy(o.orderId, "qa-order")} />
                <QuickAction
                  label="Copy Phone"
                  disabled={!o.customer.phone}
                  copied={copiedField === "qa-phone"}
                  onClick={() => copy(o.customer.phone, "qa-phone")}
                />
                <QuickAction
                  label="Copy Tracking Number"
                  disabled={!o.shipping.awb}
                  copied={copiedField === "qa-awb"}
                  onClick={() => copy(o.shipping.awb, "qa-awb")}
                />
                <QuickAction
                  label="Copy Address"
                  disabled={!fullAddress}
                  copied={copiedField === "qa-address"}
                  onClick={() => copy(fullAddress, "qa-address")}
                />
              </div>
            </div>

            {/* ── Scrollable body ─────────────────────────────── */}
            <div className={`flex-1 overflow-y-auto px-6 py-6 space-y-6 transition-opacity ${loading ? "opacity-60 pointer-events-none" : ""}`}>
              {/* Summary */}
              <Section title="Order Summary" icon={Receipt}>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3 text-sm">
                  <Field label="Order ID" value={o.orderId} />
                  <Field label="Shiprocket Order ID" value={o.shiprocketOrderId || "N/A"} />
                  <Field label="Order Date & Time" value={formatDateTime(o.orderCreatedAt)} />
                  <Field label="Last Updated" value={formatDateTime(o.lastUpdated)} />
                  <Field label="Order Status" value={o.orderStatus || "N/A"} />
                  <Field label="Shipment Status" value={o.deliveryStatus || "N/A"} />
                  <Field label="Payment Type" value={o.paymentType || "N/A"} />
                  <Field label="Final Amount" value={currency(o.totalAmountPayable)} emphasis />
                </div>
              </Section>

              {/* Customer */}
              <Section title="Customer Information" icon={User}>
                <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
                  <div className="font-display font-semibold text-slate-800">{o.customer.name || "N/A"}</div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {repeatCount > 1 && (
                      <button
                        type="button"
                        onClick={scrollToHistory}
                        className="badge badge-blue inline-flex items-center gap-1 cursor-pointer hover:bg-blue-100"
                      >
                        <Repeat size={11} /> Repeat Customer ({repeatCount} Orders)
                      </button>
                    )}
                    {o.customer.phone && (
                      <button
                        type="button"
                        onClick={() => openCustomer({ phone: o.customer.phone, tokenId: activeOrder?.tokenId })}
                        className="btn btn-secondary btn-sm !py-1"
                      >
                        <User size={12} /> View Customer Profile
                      </button>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3 text-sm">
                  <Field icon={Phone} label="Phone" value={o.customer.phone || "N/A"} />
                  <Field icon={Mail} label="Email" value={o.customer.email || "N/A"} />
                  <Field icon={MapPin} label="City" value={o.customer.address.city || "N/A"} />
                  <Field label="State" value={o.customer.address.state || "N/A"} />
                  <Field label="PIN Code" value={o.customer.address.pincode || "N/A"} />
                  <Field label="Complete Address" value={fullAddress || "N/A"} className="col-span-2 sm:col-span-3" />
                </div>
              </Section>

              {/* Customer order history */}
              <div ref={historyRef}>
                <Section title="Customer Order History" icon={History}>
                  {history.length <= 1 ? (
                    <EmptyBlock message="No other orders found for this customer yet." />
                  ) : (
                    <div className="overflow-auto max-h-[320px] card p-0">
                      <table className="table">
                        <thead className="sticky top-0 z-[1]">
                          <tr>
                            <th>Order ID</th>
                            <th>Date</th>
                            <th>Campaign</th>
                            <th>Amount</th>
                            <th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {history.map((h) => (
                            <tr
                              key={h.orderId}
                              className={`cursor-pointer ${h.isCurrent ? "bg-blue-50" : ""}`}
                              onClick={() => openHistoryOrder(h.orderId)}
                            >
                              <td className="font-medium text-slate-700">
                                {h.orderId} {h.isCurrent && <span className="text-[10px] text-blue-500">(current)</span>}
                              </td>
                              <td>{formatDate(h.orderDate)}</td>
                              <td onClick={(e) => e.stopPropagation()}>
                                <CampaignLink
                                  tokenId={activeOrder?.tokenId}
                                  campaignId={h.campaignId}
                                  campaignName={h.campaignName}
                                  since={h.orderDate}
                                  until={h.orderDate}
                                  className="!text-xs"
                                />
                              </td>
                              <td>{currency(h.totalAmountPayable)}</td>
                              <td>
                                <span className={`badge ${h.paymentType === "PREPAID" ? "badge-blue" : "badge-amber"}`}>
                                  {h.paymentType || "N/A"}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Section>
              </div>

              {/* Products */}
              <Section title="Product Details" icon={Package}>
                {o.products.length > 3 && (
                  <div className="relative max-w-xs mb-3">
                    <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      className="input pl-7 !py-1.5 !text-xs"
                      placeholder="Search product or SKU…"
                      value={productSearch}
                      onChange={(e) => setProductSearch(e.target.value)}
                    />
                  </div>
                )}

                {o.products.length === 0 ? (
                  <EmptyBlock message="Product line items aren't available for this order yet." />
                ) : filteredProducts.length === 0 ? (
                  <EmptyBlock message="No products match your search." />
                ) : (
                  <div className="card p-0 overflow-auto">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Product Name</th>
                          <th>SKU</th>
                          <th>Quantity</th>
                          <th>Selling Price</th>
                          <th>Discount</th>
                          <th>Total Price</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredProducts.map((p) => (
                          <tr key={p.id}>
                            <td className="font-medium text-slate-700">{p.name}</td>
                            <td>{p.sku || "N/A"}</td>
                            <td>{p.quantity ?? "N/A"}</td>
                            <td>{p.price != null ? currency(p.price) : "N/A"}</td>
                            <td>{p.discount != null ? currency(p.discount) : "N/A"}</td>
                            <td>{p.total != null ? currency(p.total) : "N/A"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="flex flex-col items-end gap-1 mt-3 text-sm">
                  <div className="flex gap-6">
                    <span className="text-slate-400">Subtotal</span>
                    <span className="font-medium text-slate-700 w-24 text-right">{currency(o.subtotalPrice)}</span>
                  </div>
                  <div className="flex gap-6">
                    <span className="text-slate-400">Discount</span>
                    <span className="font-medium text-slate-700 w-24 text-right">{currency(o.totalDiscount)}</span>
                  </div>
                  <div className="flex gap-6 text-base">
                    <span className="text-slate-500 font-medium">Final Amount</span>
                    <span className="font-bold text-slate-800 w-24 text-right">{currency(o.totalAmountPayable)}</span>
                  </div>
                </div>
              </Section>

              {/* Shipping */}
              <Section title="Shipping Information" icon={Truck}>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3 text-sm mb-4">
                  <Field label="Courier Partner" value={o.shipping.courier || "N/A"} />
                  <Field
                    label="AWB Number"
                    value={
                      o.shipping.awb ? (
                        <span className="inline-flex items-center gap-1.5">
                          {o.shipping.awb}
                          <button type="button" onClick={() => copy(o.shipping.awb, "awb")} className="text-slate-400 hover:text-slate-600">
                            {copiedField === "awb" ? <Check size={11} className="text-emerald-500" /> : <Copy size={11} />}
                          </button>
                        </span>
                      ) : (
                        "N/A"
                      )
                    }
                  />
                  <Field
                    label="Tracking URL"
                    value={
                      o.shipping.trackingUrl ? (
                        <a
                          href={o.shipping.trackingUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-600 hover:underline inline-flex items-center gap-1"
                        >
                          Track <ExternalLink size={11} />
                        </a>
                      ) : (
                        "N/A"
                      )
                    }
                  />
                  <Field label="Pickup Date" value={formatDate(o.shipping.pickupDate)} />
                  <Field label="Shipping Date" value={formatDate(o.shipping.shippingDate)} />
                  <Field label="Expected Delivery" value={formatDate(o.shipping.expectedDelivery)} />
                  <Field label="Delivered Date" value={formatDate(o.shipping.deliveredDate)} />
                </div>

                <ShipmentProgress deliveryStatus={o.deliveryStatus} />
              </Section>

              {/* Payment */}
              <Section title="Payment Information" icon={CreditCard}>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3 text-sm">
                  <Field
                    label="Payment Type"
                    value={<span className={`badge ${o.paymentType === "PREPAID" ? "badge-blue" : "badge-amber"}`}>{o.paymentType || "N/A"}</span>}
                  />
                  <Field label="Paid Amount" value={currency(o.totalAmountPayable)} />
                  <Field label="Outstanding Amount" value="N/A" />
                  <Field label="Transaction ID" value={o.transactionId || "N/A"} />
                  <Field
                    label="Payment Status"
                    value={<span className={`badge ${statusBadgeClass(o.paymentStatus)}`}>{o.paymentStatus || "N/A"}</span>}
                  />
                </div>
              </Section>

              {/* Campaign attribution */}
              <Section title="Campaign Attribution" icon={Megaphone}>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3 text-sm">
                  <Field
                    label="Campaign Name"
                    value={
                      <CampaignLink
                        tokenId={activeOrder?.tokenId}
                        campaignId={o.attribution.campaignId}
                        campaignName={o.attribution.campaignName}
                        since={o.orderDate}
                        until={o.orderDate}
                      />
                    }
                  />
                  <Field label="Campaign ID" value={o.attribution.campaignId || "N/A"} />
                  <Field
                    label="Ad Set"
                    value={
                      <AdSetLink
                        tokenId={activeOrder?.tokenId}
                        adsetId={o.attribution.adsetId}
                        adsetName={o.attribution.adsetName}
                        campaignId={o.attribution.campaignId}
                        campaignName={o.attribution.campaignName}
                        since={o.orderDate}
                        until={o.orderDate}
                        className="!text-sm"
                      />
                    }
                  />
                  <Field
                    label="Ad"
                    value={
                      <AdLink
                        tokenId={activeOrder?.tokenId}
                        adId={o.attribution.adId}
                        adName={o.attribution.adName}
                        adsetId={o.attribution.adsetId}
                        adsetName={o.attribution.adsetName}
                        campaignId={o.attribution.campaignId}
                        campaignName={o.attribution.campaignName}
                        since={o.orderDate}
                        until={o.orderDate}
                        className="!text-sm"
                      />
                    }
                  />
                  <Field label="UTM Campaign" value={o.attribution.utmCampaign || "N/A"} />
                  <Field label="UTM Source" value={o.attribution.utmSource || "N/A"} />
                  <Field label="UTM Medium" value={o.attribution.utmMedium || "N/A"} />
                  <Field label="UTM Content" value={o.attribution.utmContent || "N/A"} />
                </div>
              </Section>

              {/* Timeline */}
              <Section title="Order Timeline" icon={Clock}>
                <div className="space-y-0">
                  {TIMELINE_STAGES.map((stage, idx) => {
                    const ts = stageTimestamp(stage);
                    const done = !!ts;
                    return (
                      <div key={stage} className="flex gap-3">
                        <div className="flex flex-col items-center">
                          <span className={done ? "text-emerald-500" : "text-slate-300"}>
                            <CircleDot size={16} />
                          </span>
                          {idx < TIMELINE_STAGES.length - 1 && (
                            <span className={`w-px flex-1 min-h-[22px] ${done ? "bg-emerald-200" : "bg-slate-200"}`} />
                          )}
                        </div>
                        <div className="pb-4">
                          <div className={`text-sm font-medium ${done ? "text-slate-700" : "text-slate-400"}`}>{stage}</div>
                          <div className="text-xs text-slate-400">{done ? formatDateTime(ts) : "Not available yet"}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Section>

              {/* Notes */}
              <Section title="Internal Notes" icon={FileText}>
                <div className="flex gap-2 mb-4">
                  <input
                    className="input !text-sm"
                    placeholder="Add a note about this order…"
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleAddNote()}
                  />
                  <button type="button" className="btn btn-primary btn-sm shrink-0" onClick={handleAddNote} disabled={savingNote || !noteText.trim()}>
                    <Plus size={14} /> Add
                  </button>
                </div>

                {noteError && <div className="text-xs text-rose-600 mb-3">{noteError}</div>}

                {notes.length === 0 ? (
                  <EmptyBlock message="No notes yet. Add one above." />
                ) : (
                  <div className="space-y-2.5">
                    {notes.map((n) => (
                      <div key={n.id} className="card !p-3.5">
                        {editingNoteId === n.id ? (
                          <div className="flex gap-2">
                            <input
                              className="input !text-sm !py-1.5"
                              value={editingText}
                              onChange={(e) => setEditingText(e.target.value)}
                              onKeyDown={(e) => e.key === "Enter" && handleUpdateNote(n.id)}
                              autoFocus
                            />
                            <button type="button" className="btn btn-primary btn-sm" onClick={() => handleUpdateNote(n.id)}>
                              Save
                            </button>
                            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditingNoteId(null)}>
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm text-slate-700 whitespace-pre-wrap break-words">{n.text}</p>
                              <p className="text-[11px] text-slate-400 mt-1">
                                {n.author && <span className="font-medium text-slate-500">{n.author}</span>}
                                {n.author && " · "}
                                {formatDateTime(n.createdAt)}
                                {n.updatedAt && n.updatedAt !== n.createdAt ? ` (edited ${formatDateTime(n.updatedAt)})` : ""}
                              </p>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <button type="button" className="text-slate-400 hover:text-slate-600 p-1" onClick={() => startEditNote(n)} title="Edit">
                                <Pencil size={13} />
                              </button>
                              <button
                                type="button"
                                className="text-slate-400 hover:text-rose-600 p-1"
                                onClick={() => handleDeleteNote(n.id)}
                                title="Delete"
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </Section>

              {/* Attachments (future ready) */}
              <Section title="Attachments" icon={Paperclip}>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {["Invoice", "Shipping Label", "Documents"].map((label) => (
                    <div
                      key={label}
                      className="card !p-4 flex flex-col items-center justify-center gap-2 text-center border-dashed opacity-70"
                    >
                      <FileText size={20} className="text-slate-300" />
                      <div className="text-xs text-slate-400">{label}</div>
                      <span className="badge badge-slate text-[10px]">Coming soon</span>
                    </div>
                  ))}
                </div>
              </Section>
            </div>
          </>
        )}
      </div>
    </>
  );
}

// ────────────────────────────────────────────────────────────────
// Subcomponents
// ────────────────────────────────────────────────────────────────

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

function Field({ icon: Icon, label, value, emphasis, className = "" }) {
  return (
    <div className={className}>
      <div className="text-[11px] text-slate-400 mb-0.5 flex items-center gap-1">
        {Icon && <Icon size={10} />} {label}
      </div>
      <div className={emphasis ? "text-base font-bold text-slate-800" : "text-slate-700 break-words"}>{value}</div>
    </div>
  );
}

function CopyChip({ label, copied, onClick }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1 hover:text-slate-600">
      {copied ? <Check size={11} className="text-emerald-500" /> : <Copy size={11} />}
      {copied ? "Copied" : label}
    </button>
  );
}

function QuickAction({ label, onClick, copied, disabled }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="btn btn-secondary btn-sm">
      {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
      {copied ? "Copied!" : label}
    </button>
  );
}

function ShipmentProgress({ deliveryStatus }) {
  const stages = ["Ordered", "Shipped", "Out for Delivery", "Delivered"];
  const ds = (deliveryStatus || "").toLowerCase();
  let activeIdx = 0;
  if (ds.includes("deliver") && !ds.includes("out for")) activeIdx = 3;
  else if (ds.includes("out for")) activeIdx = 2;
  else if (ds.includes("ship") || ds.includes("transit")) activeIdx = 1;

  return (
    <div className="flex items-center">
      {stages.map((stage, idx) => (
        <div key={stage} className="flex items-center flex-1 last:flex-none">
          <div className="flex flex-col items-center gap-1.5">
            <span
              className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
                idx <= activeIdx ? "bg-emerald-500 text-white" : "bg-slate-200 text-slate-400"
              }`}
            >
              {idx + 1}
            </span>
            <span className={`text-[11px] text-center ${idx <= activeIdx ? "text-slate-700 font-medium" : "text-slate-400"}`}>
              {stage}
            </span>
          </div>
          {idx < stages.length - 1 && (
            <span className={`flex-1 h-0.5 mx-1 mb-4 ${idx < activeIdx ? "bg-emerald-400" : "bg-slate-200"}`} />
          )}
        </div>
      ))}
    </div>
  );
}

function EmptyBlock({ message }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center px-4">
      <span className="flex items-center justify-center w-10 h-10 rounded-2xl bg-slate-100 text-slate-400 mb-2.5">
        <Inbox size={18} />
      </span>
      <div className="text-sm text-slate-400 max-w-sm">{message}</div>
    </div>
  );
}

function DrawerSkeleton({ onClose }) {
  return (
    <>
      <div className="sticky top-0 z-10 bg-white border-b border-slate-200 px-6 py-4">
        <div className="flex items-center justify-between mb-3">
          <div className="h-6 w-40 bg-slate-100 rounded animate-pulse" />
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        <div className="flex gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-7 w-24 bg-slate-100 rounded animate-pulse" />
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card h-32 animate-pulse bg-slate-100" />
        ))}
      </div>
    </>
  );
}

function DrawerError({ message, onRetry, onClose }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
      <span className="flex items-center justify-center w-14 h-14 rounded-2xl bg-rose-100 text-rose-600 mb-4">
        <AlertTriangle size={26} />
      </span>
      <h3 className="font-display font-semibold text-slate-700 mb-1">Couldn't load this order</h3>
      <p className="text-sm text-slate-400 max-w-sm mb-5">{message}</p>
      <div className="flex gap-2">
        <button type="button" className="btn btn-primary btn-sm" onClick={onRetry}>
          <RefreshCw size={14} /> Try again
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
