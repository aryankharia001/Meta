import { useState } from "react";
import { Package, Plus, Loader2, Pencil, Trash2, AlertTriangle, X, Ban, CheckCircle2, RefreshCw } from "lucide-react";
import { fetchProducts, createProduct, updateProduct, deleteProduct } from "../lib/api";
import { currency as formatCurrency } from "../lib/format";
import DataTable from "../components/DataTable";
import { getCachedProducts, setCachedProducts, PRODUCTS_CACHE_KEY } from "../lib/productsCache";
import { useSwrFetch } from "../lib/useSwr";
import LastUpdatedIndicator from "../components/LastUpdatedIndicator";

// Phase 18 (part 2) — this is a config page (product cost setup), not a
// fast-moving analytics view — it only changes when someone edits it
// here, so a much longer stale window than the campaign/order pages is
// appropriate (still short enough that a second browser tab's edits show
// up within a few minutes without a hard refresh).
const PRODUCTS_STALE_MS = 5 * 60 * 1000;

// ────────────────────────────────────────────────────────────────
// Phase 16 §2 — Product Cost Setup. Entirely new, additive page (talks
// only to the new /api/products routes). Total Cost Per Order is always
// derived (productCost + packagingCost + shippingCost + otherCost),
// never a directly-editable field — matches server/models/Product.js's
// virtual and §2's explicit "never manually entered" instruction.
// ────────────────────────────────────────────────────────────────

const emptyForm = { name: "", sku: "", variantId: "", productId: "", productCost: "", packagingCost: "", shippingCost: "", otherCost: "" };

function totalOf(f) {
  return (Number(f.productCost) || 0) + (Number(f.packagingCost) || 0) + (Number(f.shippingCost) || 0) + (Number(f.otherCost) || 0);
}

function ProductFormFields({ form, setForm }) {
  return (
    <>
      <label className="flex flex-col gap-1 text-xs text-slate-500 flex-1 min-w-[160px]">
        Product Name
        <input className="input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Glow Serum 30ml" required />
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-500 min-w-[130px]">
        SKU
        <input className="input" value={form.sku} onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))} placeholder="e.g. GS-30ML" />
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-500 min-w-[130px]">
        Variant ID
        <input className="input" value={form.variantId} onChange={(e) => setForm((f) => ({ ...f, variantId: e.target.value }))} placeholder="optional" />
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-500 min-w-[130px]">
        Product ID
        <input className="input" value={form.productId} onChange={(e) => setForm((f) => ({ ...f, productId: e.target.value }))} placeholder="optional" />
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-500 w-28">
        Product Cost
        <input type="number" min="0" step="0.01" className="input" value={form.productCost} onChange={(e) => setForm((f) => ({ ...f, productCost: e.target.value }))} placeholder="₹0" />
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-500 w-28">
        Packaging Cost
        <input type="number" min="0" step="0.01" className="input" value={form.packagingCost} onChange={(e) => setForm((f) => ({ ...f, packagingCost: e.target.value }))} placeholder="₹0" />
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-500 w-28">
        Shipping Cost
        <input type="number" min="0" step="0.01" className="input" value={form.shippingCost} onChange={(e) => setForm((f) => ({ ...f, shippingCost: e.target.value }))} placeholder="₹0" />
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-500 w-28">
        Other Cost
        <input type="number" min="0" step="0.01" className="input" value={form.otherCost} onChange={(e) => setForm((f) => ({ ...f, otherCost: e.target.value }))} placeholder="₹0" />
      </label>
      <div className="flex flex-col gap-1 text-xs text-slate-500 w-32">
        Total Cost / Order
        <div className="input !bg-slate-50 text-slate-600 font-medium flex items-center">{formatCurrency(totalOf(form))}</div>
      </div>
    </>
  );
}

function AddProductForm({ onAdded }) {
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    setError("");
    setSubmitting(true);
    try {
      const res = await createProduct(form);
      onAdded(res.product);
      setForm(emptyForm);
    } catch (err) {
      setError(err.message || "Failed to add product");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="card flex flex-wrap items-end gap-3">
      <ProductFormFields form={form} setForm={setForm} />
      <button type="submit" className="btn btn-primary btn-sm" disabled={submitting}>
        {submitting ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
        Add Product
      </button>
      {error && (
        <div className="w-full flex items-center gap-1.5 text-xs text-rose-600">
          <AlertTriangle size={12} /> {error}
        </div>
      )}
    </form>
  );
}

function EditProductModal({ product, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: product.name || "",
    sku: product.sku || "",
    variantId: product.variantId || "",
    productId: product.productId || "",
    productCost: product.productCost || "",
    packagingCost: product.packagingCost || "",
    shippingCost: product.shippingCost || "",
    otherCost: product.otherCost || "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    setError("");
    setSubmitting(true);
    try {
      const res = await updateProduct(product.id, form);
      onSaved(res.product);
    } catch (err) {
      setError(err.message || "Failed to update product");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div className="font-display font-semibold text-sm text-slate-800">Edit product</div>
          <button type="button" className="text-slate-400 hover:text-slate-600" onClick={onClose}>
            <X size={15} />
          </button>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <ProductFormFields form={form} setForm={setForm} />
        </div>
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

export default function ProductsPage() {
  const [actionError, setActionError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [editTarget, setEditTarget] = useState(null);

  // Phase 18 (part 2) — real SWR, replacing the old
  // useState+useEffect+fetchProducts().then(setProducts) pattern.
  const {
    data: products,
    loading,
    isValidating,
    error,
    backgroundError,
    lastUpdatedAt,
    refresh,
    mutate,
  } = useSwrFetch(PRODUCTS_CACHE_KEY, () => fetchProducts().then((res) => res.products || []), {
    staleTimeMs: PRODUCTS_STALE_MS,
    getCached: getCachedProducts,
    setCached: setCachedProducts,
  });

  const handleToggleActive = async (p) => {
    setBusyId(p.id);
    try {
      const res = await updateProduct(p.id, { active: !p.active });
      mutate((prev) => (prev || []).map((x) => (x.id === p.id ? res.product : x)));
    } catch (err) {
      setActionError(err.message || "Failed to update product");
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (p) => {
    if (!window.confirm(`Delete "${p.name}"? This can't be undone.`)) return;
    setBusyId(p.id);
    try {
      await deleteProduct(p.id);
      mutate((prev) => (prev || []).filter((x) => x.id !== p.id));
    } catch (err) {
      setActionError(err.message || "Failed to delete product");
    } finally {
      setBusyId(null);
    }
  };

  const columns = [
    { key: "name", label: "Product Name", render: (p) => <span className="font-medium text-slate-700">{p.name}</span> },
    { key: "sku", label: "SKU", render: (p) => p.sku || <span className="text-slate-300">—</span> },
    { key: "variantId", label: "Variant ID", render: (p) => p.variantId || <span className="text-slate-300">—</span> },
    { key: "productId", label: "Product ID", render: (p) => p.productId || <span className="text-slate-300">—</span> },
    { key: "productCost", label: "Product Cost", render: (p) => formatCurrency(p.productCost) },
    { key: "packagingCost", label: "Packaging", render: (p) => formatCurrency(p.packagingCost) },
    { key: "shippingCost", label: "Shipping", render: (p) => formatCurrency(p.shippingCost) },
    { key: "otherCost", label: "Other", render: (p) => formatCurrency(p.otherCost) },
    {
      key: "totalCostPerOrder",
      label: "Total / Order",
      render: (p) => <span className="font-semibold text-slate-700">{formatCurrency(p.totalCostPerOrder)}</span>,
    },
    {
      key: "active",
      label: "Status",
      render: (p) =>
        p.active ? <span className="badge badge-green text-[10px]">Active</span> : <span className="badge badge-slate text-[10px]">Inactive</span>,
    },
    {
      key: "actions",
      label: "",
      sortable: false,
      defaultWidth: 110,
      render: (p) => (
        <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          <button type="button" className="text-slate-400 hover:text-indigo-600 disabled:opacity-40" title="Edit" disabled={busyId === p.id} onClick={() => setEditTarget(p)}>
            <Pencil size={14} />
          </button>
          <button
            type="button"
            className={`disabled:opacity-40 ${p.active ? "text-slate-400 hover:text-amber-600" : "text-slate-400 hover:text-emerald-600"}`}
            title={p.active ? "Deactivate" : "Activate"}
            disabled={busyId === p.id}
            onClick={() => handleToggleActive(p)}
          >
            {p.active ? <Ban size={14} /> : <CheckCircle2 size={14} />}
          </button>
          <button type="button" className="text-slate-400 hover:text-rose-600 disabled:opacity-40" title="Delete" disabled={busyId === p.id} onClick={() => handleDelete(p)}>
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
          <span className="flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-700 text-white shadow-md shadow-emerald-500/30">
            <Package size={18} />
          </span>
          <div>
            <h1 className="text-lg font-display font-bold text-slate-800 leading-tight">Product Costs</h1>
            <p className="text-xs text-slate-400">Configure per-product cost so Profitability can compute real margins</p>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <LastUpdatedIndicator lastUpdatedAt={lastUpdatedAt} isValidating={isValidating} backgroundError={backgroundError} />
          <button type="button" className="btn btn-secondary btn-sm" onClick={refresh} disabled={isValidating}>
            <RefreshCw size={13} className={isValidating ? "animate-spin" : ""} /> Refresh
          </button>
        </div>
      </div>

      <AddProductForm onAdded={(p) => mutate((prev) => [p, ...(prev || [])])} />

      {(actionError || error) && (
        <div className="flex items-center gap-1.5 text-xs text-rose-600">
          <AlertTriangle size={12} /> {actionError || error}
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card h-14 animate-pulse bg-slate-100" />
          ))}
        </div>
      ) : (
        <DataTable
          tableId="products"
          columns={columns}
          data={products || []}
          searchKeys={["name", "sku", "variantId", "productId"]}
          exportFilename="products.csv"
          emptyMessage="No products configured yet. Add one above."
        />
      )}

      {editTarget && (
        <EditProductModal
          product={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={(p) => {
            mutate((prev) => (prev || []).map((x) => (x.id === p.id ? p : x)));
            setEditTarget(null);
          }}
        />
      )}
    </div>
  );
}
