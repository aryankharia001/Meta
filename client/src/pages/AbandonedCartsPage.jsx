import { useEffect, useMemo, useState } from "react";
import {
  ShoppingBag,
  Loader2,
  Pencil,
  Trash2,
  Eye,
  AlertTriangle,
  X,
  RefreshCw,
  CalendarRange,
  Search,
  ChevronLeft,
  ChevronRight,
  Settings2,
  ExternalLink,
} from "lucide-react";
import {
  fetchAbandonedCarts,
  fetchAbandonedCart,
  updateAbandonedCart,
  deleteAbandonedCart,
  fetchAbandonedCartSettings,
  updateAbandonedCartSettings,
} from "../lib/api";
import { currency as formatCurrency, number as formatNumber, formatDateTime } from "../lib/format";

// ────────────────────────────────────────────────────────────────
// Phase 25 — Store & Fetch Real Abandoned Cart Orders. Replaces Phase
// 22's manual daily-total entry page. Every record here is a REAL
// abandoned-cart order, written automatically by the
// /abandon-cart-postback webhook (Traflead / Shiprocket Engage) into
// MongoDB (see server/models/AbandonedCartOrder.js) — this page never
// creates a record, it only searches/filters/views/edits/deletes what
// the database already has (§6 — "the database records themselves
// should determine the daily totals," §7 architecture diagram: Postback
// -> MongoDB -> this page -> Dashboard).
//
// §5 — the delivery/success rate and the four per-order costs are now
// GLOBAL settings (server/models/AbandonedCartSettings.js), edited in
// the collapsible panel below, instead of one value typed per daily
// record. The range summary (§4) is computed server-side in
// routes/abandonedCarts.js's computeSummary() from those settings +
// every matching order's own cart value — this page only displays it.
// ────────────────────────────────────────────────────────────────

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const todayIso = () => new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
const shiftDays = (dateStr, days) => {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const PAGE_SIZES = [10, 25, 50, 100];

function productSummary(items) {
  if (!items || items.length === 0) return { label: "—", title: "" };
  const names = items.map((it) => it.name || it.sku || "Item").filter(Boolean);
  const label = names.length > 1 ? `${names[0]} +${names.length - 1} more` : names[0];
  const title = items.map((it) => `${it.name || it.sku || "Item"} × ${it.quantity || 1} (${formatCurrency(it.price)})`).join("\n");
  return { label, title };
}

function SettingsPanel({ open, onClose }) {
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    fetchAbandonedCartSettings()
      .then((res) => {
        if (cancelled) return;
        setForm({
          deliveryRate: String(res.deliveryRate ?? 70),
          manufacturingCost: String(res.manufacturingCost ?? 0),
          packagingCost: String(res.packagingCost ?? 0),
          shippingCost: String(res.shippingCost ?? 0),
          miscCost: String(res.miscCost ?? 0),
        });
      })
      .catch((err) => !cancelled && setError(err.message || "Failed to load settings"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const res = await updateAbandonedCartSettings({
        deliveryRate: Number(form.deliveryRate) || 0,
        manufacturingCost: Number(form.manufacturingCost) || 0,
        packagingCost: Number(form.packagingCost) || 0,
        shippingCost: Number(form.shippingCost) || 0,
        miscCost: Number(form.miscCost) || 0,
      });
      setForm({
        deliveryRate: String(res.deliveryRate ?? 0),
        manufacturingCost: String(res.manufacturingCost ?? 0),
        packagingCost: String(res.packagingCost ?? 0),
        shippingCost: String(res.shippingCost ?? 0),
        miscCost: String(res.miscCost ?? 0),
      });
      setSavedAt(Date.now());
    } catch (err) {
      setError(err.message || "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="font-display font-semibold text-sm text-slate-800">Abandoned Cart Settings</div>
        <button type="button" className="text-slate-400 hover:text-slate-600" onClick={onClose}>
          <X size={15} />
        </button>
      </div>
      <p className="text-xs text-slate-400 -mt-1">
        Applies to every abandoned cart, everywhere in the app (this page and the Dashboard). Expenses are scaled by Expected
        Delivered Orders (Orders × Delivery Rate), not the raw order count.
      </p>
      {loading || !form ? (
        <div className="h-16 animate-pulse bg-slate-100 rounded-lg" />
      ) : (
        <form onSubmit={handleSave} className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-slate-500 w-32">
            Delivery Rate %
            <input
              type="number"
              min="0"
              max="100"
              step="0.01"
              className="input"
              value={form.deliveryRate}
              onChange={(e) => setForm((f) => ({ ...f, deliveryRate: e.target.value }))}
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-500 w-36">
            Manufacturing Cost / Order
            <input
              type="number"
              min="0"
              step="0.01"
              className="input"
              value={form.manufacturingCost}
              onChange={(e) => setForm((f) => ({ ...f, manufacturingCost: e.target.value }))}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-500 w-32">
            Packaging Cost / Order
            <input
              type="number"
              min="0"
              step="0.01"
              className="input"
              value={form.packagingCost}
              onChange={(e) => setForm((f) => ({ ...f, packagingCost: e.target.value }))}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-500 w-32">
            Shipping Cost / Order
            <input
              type="number"
              min="0"
              step="0.01"
              className="input"
              value={form.shippingCost}
              onChange={(e) => setForm((f) => ({ ...f, shippingCost: e.target.value }))}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-500 w-32">
            Misc Cost / Order
            <input
              type="number"
              min="0"
              step="0.01"
              className="input"
              value={form.miscCost}
              onChange={(e) => setForm((f) => ({ ...f, miscCost: e.target.value }))}
            />
          </label>
          <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
            {saving ? <Loader2 size={13} className="animate-spin" /> : "Save"}
          </button>
          {savedAt && !saving && <span className="text-xs text-emerald-600">Saved</span>}
        </form>
      )}
      {error && (
        <div className="flex items-center gap-1.5 text-xs text-rose-600">
          <AlertTriangle size={12} /> {error}
        </div>
      )}
    </div>
  );
}

function AddressBlock({ address, pincode }) {
  const parts = [address?.line1, address?.line2, address?.city, address?.state, pincode || address?.pincode, address?.country].filter(
    Boolean
  );
  if (parts.length === 0) return <span className="text-slate-300">—</span>;
  return <span>{parts.join(", ")}</span>;
}

function ViewDetailsModal({ id, onClose }) {
  const [record, setRecord] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchAbandonedCart(id)
      .then((res) => !cancelled && setRecord(res.record))
      .catch((err) => !cancelled && setError(err.message || "Failed to load record"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div className="font-display font-semibold text-sm text-slate-800">Abandoned cart details</div>
          <button type="button" className="text-slate-400 hover:text-slate-600" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        {loading && <div className="h-40 animate-pulse bg-slate-100 rounded-lg" />}
        {error && <div className="text-xs text-rose-600">{error}</div>}

        {record && !loading && (
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2.5">
              <Field label="Date / Time" value={formatDateTime(record.orderTimestamp)} />
              <Field label="Source" value={record.source || "—"} />
              <Field label="Payment Status" value={record.paymentStatus || "—"} />
              <Field label="Cart ID" value={record.cartId || "—"} />
              <Field label="Order ID" value={record.externalOrderId || "—"} />
              <Field label="Abandoned Cart ID" value={record.abandonedCartId || "—"} />
              <Field label="Customer" value={record.customerName || "—"} />
              <Field label="Phone" value={record.phone || "—"} />
              <Field label="Email" value={record.email || "—"} />
              <Field label="Cart Value" value={formatCurrency(record.cartValue)} strong />
              <Field label="Campaign" value={record.utmCampaign || "—"} />
              <Field label="Adset" value={record.adsetName || "—"} />
              <Field label="Ad" value={record.adId || "—"} />
              <Field label="Pincode" value={record.pincode || "—"} />
              <div className="col-span-2 sm:col-span-3">
                <div className="text-slate-400">Shipping Address</div>
                <div className="text-slate-700 mt-0.5">
                  <AddressBlock address={record.shippingAddress} pincode={record.pincode} />
                </div>
              </div>
              {record.checkoutUrl && (
                <div className="col-span-2 sm:col-span-3">
                  <div className="text-slate-400">Checkout URL</div>
                  <a
                    href={record.checkoutUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-indigo-600 hover:underline inline-flex items-center gap-1 break-all"
                  >
                    {record.checkoutUrl} <ExternalLink size={11} className="shrink-0" />
                  </a>
                </div>
              )}
            </div>

            <div>
              <div className="text-slate-400 mb-1.5">Items</div>
              {record.items && record.items.length > 0 ? (
                <div className="border border-slate-100 rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-slate-500">
                      <tr>
                        <th className="text-left px-2.5 py-1.5 font-medium">Product</th>
                        <th className="text-left px-2.5 py-1.5 font-medium">SKU</th>
                        <th className="text-left px-2.5 py-1.5 font-medium">Variant</th>
                        <th className="text-right px-2.5 py-1.5 font-medium">Qty</th>
                        <th className="text-right px-2.5 py-1.5 font-medium">Price</th>
                      </tr>
                    </thead>
                    <tbody>
                      {record.items.map((it, i) => (
                        <tr key={i} className="border-t border-slate-100">
                          <td className="px-2.5 py-1.5">{it.name || "—"}</td>
                          <td className="px-2.5 py-1.5">{it.sku || "—"}</td>
                          <td className="px-2.5 py-1.5">{it.variantId || "—"}</td>
                          <td className="px-2.5 py-1.5 text-right">{formatNumber(it.quantity)}</td>
                          <td className="px-2.5 py-1.5 text-right">{formatCurrency(it.price)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <span className="text-slate-300">No line items recorded</span>
              )}
            </div>

            {record.notes && (
              <div>
                <div className="text-slate-400 mb-1">Notes</div>
                <div className="text-slate-700">{record.notes}</div>
              </div>
            )}

            <details className="text-xs">
              <summary className="cursor-pointer text-slate-400 hover:text-slate-600">Raw postback payload</summary>
              <pre className="mt-2 bg-slate-50 border border-slate-100 rounded-lg p-2.5 overflow-auto max-h-64 text-[10px] leading-relaxed">
                {JSON.stringify(record.rawPayload || {}, null, 2)}
              </pre>
            </details>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, strong }) {
  return (
    <div className="min-w-0">
      <div className="text-slate-400">{label}</div>
      <div className={`truncate ${strong ? "font-semibold text-slate-800" : "text-slate-700"}`}>{value}</div>
    </div>
  );
}

function EditAbandonedCartModal({ id, onClose, onSaved }) {
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetchAbandonedCart(id)
      .then((res) => {
        if (cancelled) return;
        const r = res.record;
        setForm({
          customerName: r.customerName || "",
          phone: r.phone || "",
          email: r.email || "",
          cartValue: r.cartValue ?? "",
          paymentStatus: r.paymentStatus || "",
          utmCampaign: r.utmCampaign || "",
          adsetName: r.adsetName || "",
          adId: r.adId || "",
          checkoutUrl: r.checkoutUrl || "",
          line1: r.shippingAddress?.line1 || "",
          line2: r.shippingAddress?.line2 || "",
          city: r.shippingAddress?.city || "",
          state: r.shippingAddress?.state || "",
          pincode: r.pincode || r.shippingAddress?.pincode || "",
          country: r.shippingAddress?.country || "",
          notes: r.notes || "",
        });
      })
      .catch((err) => !cancelled && setError(err.message || "Failed to load record"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [id]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting || !form) return;
    setError("");
    setSubmitting(true);
    try {
      const res = await updateAbandonedCart(id, {
        customerName: form.customerName,
        phone: form.phone,
        email: form.email,
        cartValue: Number(form.cartValue) || 0,
        paymentStatus: form.paymentStatus,
        utmCampaign: form.utmCampaign,
        adsetName: form.adsetName,
        adId: form.adId,
        checkoutUrl: form.checkoutUrl,
        shippingAddress: {
          line1: form.line1,
          line2: form.line2,
          city: form.city,
          state: form.state,
          pincode: form.pincode,
          country: form.country,
        },
        notes: form.notes,
      });
      onSaved(res.record);
    } catch (err) {
      setError(err.message || "Failed to update abandoned cart record");
    } finally {
      setSubmitting(false);
    }
  };

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto p-5 space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="font-display font-semibold text-sm text-slate-800">Edit abandoned cart record</div>
          <button type="button" className="text-slate-400 hover:text-slate-600" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        {loading || !form ? (
          <div className="h-40 animate-pulse bg-slate-100 rounded-lg" />
        ) : (
          <>
            <div className="flex flex-wrap gap-3">
              <label className="flex flex-col gap-1 text-xs text-slate-500 flex-1 min-w-[160px]">
                Customer Name
                <input className="input" value={form.customerName} onChange={set("customerName")} />
              </label>
              <label className="flex flex-col gap-1 text-xs text-slate-500 w-40">
                Phone
                <input className="input" value={form.phone} onChange={set("phone")} />
              </label>
              <label className="flex flex-col gap-1 text-xs text-slate-500 flex-1 min-w-[180px]">
                Email
                <input className="input" value={form.email} onChange={set("email")} />
              </label>
              <label className="flex flex-col gap-1 text-xs text-slate-500 w-32">
                Cart Value
                <input type="number" min="0" step="0.01" className="input" value={form.cartValue} onChange={set("cartValue")} />
              </label>
              <label className="flex flex-col gap-1 text-xs text-slate-500 w-36">
                Payment Status
                <input className="input" value={form.paymentStatus} onChange={set("paymentStatus")} />
              </label>
              <label className="flex flex-col gap-1 text-xs text-slate-500 w-36">
                Campaign
                <input className="input" value={form.utmCampaign} onChange={set("utmCampaign")} />
              </label>
              <label className="flex flex-col gap-1 text-xs text-slate-500 w-32">
                Adset
                <input className="input" value={form.adsetName} onChange={set("adsetName")} />
              </label>
              <label className="flex flex-col gap-1 text-xs text-slate-500 w-28">
                Ad
                <input className="input" value={form.adId} onChange={set("adId")} />
              </label>
              <label className="flex flex-col gap-1 text-xs text-slate-500 flex-1 min-w-[200px]">
                Checkout URL
                <input className="input" value={form.checkoutUrl} onChange={set("checkoutUrl")} />
              </label>
            </div>

            <div className="text-xs text-slate-400 pt-1">Shipping Address</div>
            <div className="flex flex-wrap gap-3">
              <label className="flex flex-col gap-1 text-xs text-slate-500 flex-1 min-w-[160px]">
                Address Line 1
                <input className="input" value={form.line1} onChange={set("line1")} />
              </label>
              <label className="flex flex-col gap-1 text-xs text-slate-500 flex-1 min-w-[160px]">
                Address Line 2
                <input className="input" value={form.line2} onChange={set("line2")} />
              </label>
              <label className="flex flex-col gap-1 text-xs text-slate-500 w-32">
                City
                <input className="input" value={form.city} onChange={set("city")} />
              </label>
              <label className="flex flex-col gap-1 text-xs text-slate-500 w-32">
                State
                <input className="input" value={form.state} onChange={set("state")} />
              </label>
              <label className="flex flex-col gap-1 text-xs text-slate-500 w-28">
                Pincode
                <input className="input" value={form.pincode} onChange={set("pincode")} />
              </label>
              <label className="flex flex-col gap-1 text-xs text-slate-500 w-28">
                Country
                <input className="input" value={form.country} onChange={set("country")} />
              </label>
            </div>

            <label className="flex flex-col gap-1 text-xs text-slate-500">
              Notes
              <input className="input" value={form.notes} onChange={set("notes")} placeholder="Optional" />
            </label>
          </>
        )}

        {error && <div className="text-xs text-rose-600">{error}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary btn-sm" disabled={submitting || loading}>
            {submitting ? <Loader2 size={13} className="animate-spin" /> : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function AbandonedCartsPage() {
  const [since, setSince] = useState(shiftDays(todayIso(), -29));
  const [until, setUntil] = useState(todayIso());
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [viewId, setViewId] = useState(null);
  const [editId, setEditId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [actionError, setActionError] = useState("");

  // §3/§9 — debounce the search box so every keystroke doesn't fire a
  // network request.
  useEffect(() => {
    const t = setTimeout(() => {
      setPage(1);
      setSearch(searchInput.trim());
    }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => setPage(1), [since, until, pageSize]);

  const load = (background = false) => {
    if (background) setRefreshing(true);
    else setLoading(true);
    setError("");
    fetchAbandonedCarts({ since, until, search, page, pageSize })
      .then((res) => setData(res))
      .catch((err) => setError(err.message || "Failed to load abandoned cart records"))
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  };

  useEffect(load, [since, until, search, page, pageSize]);

  const records = data?.records || [];
  const summary = data?.summary || null;
  const totalPages = data?.totalPages || 1;
  const total = data?.total ?? 0;

  const handleDelete = async (r) => {
    if (!window.confirm(`Delete the abandoned cart record for ${r.customerName || r.phone || r.cartId || "this cart"}? This can't be undone.`)) return;
    setBusyId(r.id);
    setActionError("");
    try {
      await deleteAbandonedCart(r.id);
      load(true);
    } catch (err) {
      setActionError(err.message || "Failed to delete abandoned cart record");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between gap-2.5 flex-wrap">
        <div className="flex items-center gap-2.5">
          <span className="flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-rose-500 to-orange-500 text-white shadow-md shadow-rose-500/30">
            <ShoppingBag size={18} />
          </span>
          <div>
            <h1 className="text-lg font-display font-bold text-slate-800 leading-tight">Abandoned Carts</h1>
            <p className="text-xs text-slate-400">
              {loading || !summary
                ? "Loading…"
                : `${formatNumber(summary.orders)} abandoned cart${summary.orders === 1 ? "" : "s"} in range · Potential ${formatCurrency(
                    summary.potentialRevenue
                  )} · Recognized ${formatCurrency(summary.recognizedRevenue)} · Net ${formatCurrency(summary.netContribution)}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSettingsOpen((v) => !v)}>
            <Settings2 size={13} /> Settings
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => load(true)} disabled={refreshing}>
            <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} /> Refresh
          </button>
        </div>
      </div>

      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {(actionError || error) && (
        <div className="flex items-center gap-1.5 text-xs text-rose-600">
          <AlertTriangle size={12} /> {actionError || error}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            className="input pl-7 !py-1.5 !text-xs"
            placeholder="Search customer, phone, email, cart ID, campaign…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-1.5 text-xs text-slate-500">
          <CalendarRange size={13} />
          Date range
        </div>
        <input type="date" className="input w-auto !py-1.5 !text-xs" value={since} max={until || undefined} onChange={(e) => setSince(e.target.value)} />
        <span className="text-slate-400 text-xs">to</span>
        <input type="date" className="input w-auto !py-1.5 !text-xs" value={until} min={since || undefined} onChange={(e) => setUntil(e.target.value)} />
        <button
          type="button"
          className="text-xs text-slate-400 hover:text-slate-600 underline"
          onClick={() => {
            setSince(shiftDays(todayIso(), -29));
            setUntil(todayIso());
          }}
        >
          Last 30 days
        </button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card h-14 animate-pulse bg-slate-100" />
          ))}
        </div>
      ) : (
        <>
          <div className="card p-0 overflow-auto max-h-[560px]">
            <table className="table" style={{ tableLayout: "fixed", width: "max-content", minWidth: "100%" }}>
              <thead>
                <tr>
                  {["Date / Time", "Customer", "Cart ID", "Product", "Amount", "Campaign", "Adset", "Ad", ""].map((h) => (
                    <th key={h} className="sticky top-0 z-[2] bg-slate-50 text-left">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {records.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="text-center py-10 text-slate-400 text-sm">
                      No abandoned cart records for this range/search.
                    </td>
                  </tr>
                ) : (
                  records.map((r) => {
                    const product = productSummary(r.items);
                    return (
                      <tr key={r.id} className="cursor-pointer" onClick={() => setViewId(r.id)}>
                        <td className="font-medium text-slate-700 whitespace-nowrap">{formatDateTime(r.orderTimestamp)}</td>
                        <td>
                          <div className="text-slate-700">{r.customerName || "—"}</div>
                          {(r.phone || r.email) && <div className="text-slate-400 text-[11px]">{r.phone || r.email}</div>}
                        </td>
                        <td className="text-slate-600">{r.cartId || r.externalOrderId || r.abandonedCartId || "—"}</td>
                        <td title={product.title}>{product.label}</td>
                        <td className="font-medium">{formatCurrency(r.cartValue)}</td>
                        <td className="text-slate-600">{r.utmCampaign || "—"}</td>
                        <td className="text-slate-600">{r.adsetName || "—"}</td>
                        <td className="text-slate-600">{r.adId || "—"}</td>
                        <td onClick={(ev) => ev.stopPropagation()}>
                          <div className="flex items-center gap-1.5">
                            <button type="button" className="text-slate-400 hover:text-indigo-600" title="View details" onClick={() => setViewId(r.id)}>
                              <Eye size={14} />
                            </button>
                            <button type="button" className="text-slate-400 hover:text-indigo-600" title="Edit" disabled={busyId === r.id} onClick={() => setEditId(r.id)}>
                              <Pencil size={14} />
                            </button>
                            <button
                              type="button"
                              className="text-slate-400 hover:text-rose-600 disabled:opacity-40"
                              title="Delete"
                              disabled={busyId === r.id}
                              onClick={() => handleDelete(r)}
                            >
                              {busyId === r.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between px-1 py-1 text-xs text-slate-500">
            <div className="flex items-center gap-2">
              <span>
                Page {page} of {totalPages} · {formatNumber(total)} record{total === 1 ? "" : "s"}
              </span>
              <select className="input !py-1 !text-xs w-auto" value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
                {PAGE_SIZES.map((n) => (
                  <option key={n} value={n}>
                    {n} / page
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-1.5">
              <button type="button" className="btn btn-secondary btn-sm !px-2" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                <ChevronLeft size={13} />
              </button>
              <button type="button" className="btn btn-secondary btn-sm !px-2" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
                <ChevronRight size={13} />
              </button>
            </div>
          </div>
        </>
      )}

      {viewId && <ViewDetailsModal id={viewId} onClose={() => setViewId(null)} />}
      {editId && (
        <EditAbandonedCartModal
          id={editId}
          onClose={() => setEditId(null)}
          onSaved={() => {
            setEditId(null);
            load(true);
          }}
        />
      )}
    </div>
  );
}
