import { useMemo, useState } from "react";
import { ShoppingBag, Plus, Loader2, Pencil, Trash2, AlertTriangle, X, RefreshCw, CalendarRange } from "lucide-react";
import { fetchAbandonedCarts, createAbandonedCart, updateAbandonedCart, deleteAbandonedCart } from "../lib/api";
import { currency as formatCurrency, number as formatNumber, formatDate } from "../lib/format";
import DataTable from "../components/DataTable";
import { getCachedAbandonedCarts, setCachedAbandonedCarts, ABANDONED_CARTS_CACHE_KEY } from "../lib/abandonedCartsCache";
import { useSwrFetch } from "../lib/useSwr";
import LastUpdatedIndicator from "../components/LastUpdatedIndicator";

// ────────────────────────────────────────────────────────────────
// Phase 22 — Abandoned Cart Management. Entirely new, additive page
// (talks only to the new /api/abandoned-carts routes — see lib/api.js
// and server/routes/abandonedCarts.js). Genuinely DB-backed (Mongo) —
// §5 is explicit that abandoned-cart data must never live in
// localStorage, so unlike Dashboard's Additional Prepaid Revenue field
// (Phase 21, untouched), every value on this page round-trips through
// the server on every add/edit/delete. DataTable's own column-width/
// sort/page-size UI preferences still use localStorage internally
// (pre-existing, unrelated — see DataTable.jsx) — that's display
// preference, not abandoned-cart data, so it's not in scope for §5.
//
// §10 — "Revenue must only be recognized for the selected delivery/
// success percentage" and §2's exact formula (Orders × Delivery Rate ×
// Average Order Value) are computed server-side in
// routes/abandonedCarts.js's computeDerived() — this page never
// recomputes the authoritative numbers, it only displays what the
// server returns. The one exception is the Add/Edit form's "Live
// Preview" panel below, which mirrors that same formula client-side
// purely for instant feedback while typing (§3 — "do not silently hide
// expenses"); the value that actually gets saved always comes back
// from the server's response.
// ────────────────────────────────────────────────────────────────

const todayIso = () => new Date().toISOString().slice(0, 10);

const emptyForm = {
  date: todayIso(),
  orders: "",
  avgOrderValue: "",
  deliveryRate: "70",
  manufacturingCost: "",
  packagingCost: "",
  shippingCost: "",
  miscCost: "",
  notes: "",
};

// Client-side mirror of server/routes/abandonedCarts.js's computeDerived()
// — same formula, same field names — used ONLY for the Add/Edit form's
// live preview. The persisted, authoritative numbers always come from
// the server's response (see shape() there).
function computeDerived(form) {
  const orders = Number(form.orders) || 0;
  const avgOrderValue = Number(form.avgOrderValue) || 0;
  const deliveryRate = Number(form.deliveryRate) || 0;
  const manufacturingCost = Number(form.manufacturingCost) || 0;
  const packagingCost = Number(form.packagingCost) || 0;
  const shippingCost = Number(form.shippingCost) || 0;
  const miscCost = Number(form.miscCost) || 0;

  const expectedDelivered = orders * (deliveryRate / 100);
  const potentialRevenue = orders * avgOrderValue;
  const recognizedRevenue = expectedDelivered * avgOrderValue;
  const manufacturingExpense = expectedDelivered * manufacturingCost;
  const packagingExpense = expectedDelivered * packagingCost;
  const shippingExpense = expectedDelivered * shippingCost;
  const miscExpense = expectedDelivered * miscCost;
  const totalExpenses = manufacturingExpense + packagingExpense + shippingExpense + miscExpense;
  const netContribution = recognizedRevenue - totalExpenses;

  return {
    expectedDelivered,
    potentialRevenue,
    recognizedRevenue,
    manufacturingExpense,
    packagingExpense,
    shippingExpense,
    miscExpense,
    totalExpenses,
    netContribution,
  };
}

function PreviewStat({ label, value, strong }) {
  return (
    <div className="min-w-0">
      <div className="text-slate-400 truncate">{label}</div>
      <div className={`truncate ${strong ? "font-semibold text-slate-700" : "text-slate-600"}`}>{value}</div>
    </div>
  );
}

// §3 — "Then calculate the configured expenses clearly. Do not silently
// hide expenses." Every expense line (not just the total) is shown here
// as the user types, updating immediately with every keystroke.
function LivePreview({ form }) {
  const d = computeDerived(form);
  return (
    <div className="w-full grid grid-cols-2 sm:grid-cols-5 gap-x-4 gap-y-2 text-[11px] bg-slate-50 border border-slate-100 rounded-lg px-3 py-2.5">
      <PreviewStat label="Expected Delivered" value={formatNumber(d.expectedDelivered)} />
      <PreviewStat label="Potential Revenue" value={formatCurrency(d.potentialRevenue)} />
      <PreviewStat label="Recognized Revenue" value={formatCurrency(d.recognizedRevenue)} strong />
      <PreviewStat label="Total Expenses" value={formatCurrency(d.totalExpenses)} />
      <PreviewStat label="Net Contribution" value={formatCurrency(d.netContribution)} strong />
      <PreviewStat label="Manufacturing" value={formatCurrency(d.manufacturingExpense)} />
      <PreviewStat label="Packaging" value={formatCurrency(d.packagingExpense)} />
      <PreviewStat label="Shipping" value={formatCurrency(d.shippingExpense)} />
      <PreviewStat label="Miscellaneous" value={formatCurrency(d.miscExpense)} />
    </div>
  );
}

function AbandonedCartFormFields({ form, setForm }) {
  return (
    <>
      <label className="flex flex-col gap-1 text-xs text-slate-500 w-36">
        Date
        <input type="date" className="input" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} required />
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-500 w-32">
        Abandoned Orders
        <input
          type="number"
          min="0"
          step="1"
          className="input"
          value={form.orders}
          onChange={(e) => setForm((f) => ({ ...f, orders: e.target.value }))}
          placeholder="0"
          required
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-500 w-32">
        Avg. Order Value
        <input
          type="number"
          min="0"
          step="0.01"
          className="input"
          value={form.avgOrderValue}
          onChange={(e) => setForm((f) => ({ ...f, avgOrderValue: e.target.value }))}
          placeholder="₹0"
          required
        />
      </label>
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
          placeholder="70"
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
          placeholder="₹0"
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
          placeholder="₹0"
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
          placeholder="₹0"
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
          placeholder="₹0"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-500 flex-1 min-w-[160px]">
        Notes
        <input className="input" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Optional" />
      </label>
    </>
  );
}

function AddAbandonedCartForm({ onAdded }) {
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    setError("");
    setSubmitting(true);
    try {
      const res = await createAbandonedCart(form);
      onAdded(res.record);
      setForm({ ...emptyForm, date: todayIso() });
    } catch (err) {
      setError(err.message || "Failed to add abandoned cart record");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="card flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <AbandonedCartFormFields form={form} setForm={setForm} />
        <button type="submit" className="btn btn-primary btn-sm" disabled={submitting}>
          {submitting ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
          Add Record
        </button>
      </div>
      <LivePreview form={form} />
      {error && (
        <div className="flex items-center gap-1.5 text-xs text-rose-600">
          <AlertTriangle size={12} /> {error}
        </div>
      )}
    </form>
  );
}

function EditAbandonedCartModal({ record, onClose, onSaved }) {
  const [form, setForm] = useState({
    date: record.date || "",
    orders: record.orders ?? "",
    avgOrderValue: record.avgOrderValue ?? "",
    deliveryRate: record.deliveryRate ?? "",
    manufacturingCost: record.manufacturingCost ?? "",
    packagingCost: record.packagingCost ?? "",
    shippingCost: record.shippingCost ?? "",
    miscCost: record.miscCost ?? "",
    notes: record.notes || "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    setError("");
    setSubmitting(true);
    try {
      const res = await updateAbandonedCart(record.id, form);
      onSaved(res.record);
    } catch (err) {
      setError(err.message || "Failed to update abandoned cart record");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div className="font-display font-semibold text-sm text-slate-800">Edit abandoned cart record</div>
          <button type="button" className="text-slate-400 hover:text-slate-600" onClick={onClose}>
            <X size={15} />
          </button>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <AbandonedCartFormFields form={form} setForm={setForm} />
        </div>
        <LivePreview form={form} />
        {error && <div className="text-xs text-rose-600">{error}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary btn-sm" disabled={submitting}>
            {submitting ? <Loader2 size={13} className="animate-spin" /> : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function AbandonedCartsPage() {
  const [actionError, setActionError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [editTarget, setEditTarget] = useState(null);
  // §9 — "Date filtering", on top of DataTable's own free-text search
  // (which already covers date/notes via searchKeys below). Purely a
  // client-side filter over the already-fetched full list — no extra
  // network round-trip, since the list here is small/config-like data,
  // same reasoning as Expenses/Products.
  const [filterSince, setFilterSince] = useState("");
  const [filterUntil, setFilterUntil] = useState("");

  const {
    data: recordsData,
    loading,
    isValidating,
    error,
    backgroundError,
    lastUpdatedAt,
    refresh,
    mutate,
  } = useSwrFetch(ABANDONED_CARTS_CACHE_KEY, () => fetchAbandonedCarts().then((res) => res.records || []), {
    staleTimeMs: 5 * 60 * 1000,
    getCached: getCachedAbandonedCarts,
    setCached: setCachedAbandonedCarts,
  });
  const records = recordsData || [];

  const filteredRecords = useMemo(() => {
    if (!filterSince && !filterUntil) return records;
    return records.filter((r) => (!filterSince || r.date >= filterSince) && (!filterUntil || r.date <= filterUntil));
  }, [records, filterSince, filterUntil]);

  const totals = useMemo(
    () =>
      filteredRecords.reduce(
        (acc, r) => ({
          orders: acc.orders + (r.orders || 0),
          recognizedRevenue: acc.recognizedRevenue + (r.recognizedRevenue || 0),
          totalExpenses: acc.totalExpenses + (r.totalExpenses || 0),
          netContribution: acc.netContribution + (r.netContribution || 0),
        }),
        { orders: 0, recognizedRevenue: 0, totalExpenses: 0, netContribution: 0 }
      ),
    [filteredRecords]
  );

  const handleDelete = async (r) => {
    if (!window.confirm(`Delete the abandoned cart record for ${formatDate(r.date)}? This can't be undone.`)) return;
    setBusyId(r.id);
    try {
      await deleteAbandonedCart(r.id);
      mutate((prev) => (prev || []).filter((x) => x.id !== r.id));
    } catch (err) {
      setActionError(err.message || "Failed to delete abandoned cart record");
    } finally {
      setBusyId(null);
    }
  };

  const columns = [
    { key: "date", label: "Date", render: (r) => <span className="font-medium text-slate-700">{formatDate(r.date)}</span> },
    { key: "orders", label: "Abandoned", render: (r) => formatNumber(r.orders) },
    { key: "deliveryRate", label: "Delivery %", render: (r) => `${Number(r.deliveryRate || 0).toFixed(2)}%` },
    { key: "expectedDelivered", label: "Expected Delivered", render: (r) => formatNumber(Math.round(r.expectedDelivered * 100) / 100) },
    { key: "potentialRevenue", label: "Potential Revenue", render: (r) => formatCurrency(r.potentialRevenue) },
    { key: "recognizedRevenue", label: "Recognized Revenue", render: (r) => <span className="font-medium text-emerald-700">{formatCurrency(r.recognizedRevenue)}</span> },
    {
      key: "totalExpenses",
      label: "Expenses",
      render: (r) => (
        <span
          className="text-rose-600"
          title={`Manufacturing ${formatCurrency(r.manufacturingExpense)} · Packaging ${formatCurrency(r.packagingExpense)} · Shipping ${formatCurrency(
            r.shippingExpense
          )} · Misc ${formatCurrency(r.miscExpense)}`}
        >
          {formatCurrency(r.totalExpenses)}
        </span>
      ),
    },
    {
      key: "netContribution",
      label: "Net",
      render: (r) => <span className={`font-semibold ${r.netContribution >= 0 ? "text-emerald-700" : "text-rose-600"}`}>{formatCurrency(r.netContribution)}</span>,
    },
    { key: "notes", label: "Notes", render: (r) => r.notes || <span className="text-slate-300">—</span> },
    {
      key: "actions",
      label: "",
      sortable: false,
      defaultWidth: 90,
      render: (r) => (
        <div className="flex items-center gap-1.5" onClick={(ev) => ev.stopPropagation()}>
          <button type="button" className="text-slate-400 hover:text-indigo-600 disabled:opacity-40" title="Edit" disabled={busyId === r.id} onClick={() => setEditTarget(r)}>
            <Pencil size={14} />
          </button>
          <button type="button" className="text-slate-400 hover:text-rose-600 disabled:opacity-40" title="Delete" disabled={busyId === r.id} onClick={() => handleDelete(r)}>
            <Trash2 size={14} />
          </button>
        </div>
      ),
    },
  ];

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
              {loading
                ? "Loading…"
                : `${filteredRecords.length} record${filteredRecords.length === 1 ? "" : "s"} · ${formatNumber(totals.orders)} orders · Recognized ${formatCurrency(
                    totals.recognizedRevenue
                  )} · Net ${formatCurrency(totals.netContribution)}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <LastUpdatedIndicator lastUpdatedAt={lastUpdatedAt} isValidating={isValidating} backgroundError={backgroundError} />
          <button type="button" className="btn btn-secondary btn-sm" onClick={refresh} disabled={isValidating}>
            <RefreshCw size={13} className={isValidating ? "animate-spin" : ""} /> Refresh
          </button>
        </div>
      </div>

      <AddAbandonedCartForm onAdded={(x) => mutate((prev) => [x, ...(prev || [])])} />

      {(actionError || error) && (
        <div className="flex items-center gap-1.5 text-xs text-rose-600">
          <AlertTriangle size={12} /> {actionError || error}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 text-xs text-slate-500">
          <CalendarRange size={13} />
          Date range
        </div>
        <input type="date" className="input w-auto !py-1.5 !text-xs" value={filterSince} max={filterUntil || undefined} onChange={(e) => setFilterSince(e.target.value)} />
        <span className="text-slate-400 text-xs">to</span>
        <input type="date" className="input w-auto !py-1.5 !text-xs" value={filterUntil} min={filterSince || undefined} onChange={(e) => setFilterUntil(e.target.value)} />
        {(filterSince || filterUntil) && (
          <button
            type="button"
            className="text-xs text-slate-400 hover:text-slate-600 underline"
            onClick={() => {
              setFilterSince("");
              setFilterUntil("");
            }}
          >
            Clear
          </button>
        )}
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card h-14 animate-pulse bg-slate-100" />
          ))}
        </div>
      ) : (
        <DataTable
          tableId="abandonedCarts"
          columns={columns}
          data={filteredRecords}
          searchKeys={["date", "notes"]}
          exportFilename="abandoned-carts.csv"
          emptyMessage="No abandoned cart records yet. Add one above."
        />
      )}

      {editTarget && (
        <EditAbandonedCartModal
          record={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={(x) => {
            mutate((prev) => (prev || []).map((r) => (r.id === x.id ? x : r)));
            setEditTarget(null);
          }}
        />
      )}
    </div>
  );
}
