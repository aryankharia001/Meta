import { useState } from "react";
import { Wallet, Plus, Loader2, Pencil, Trash2, AlertTriangle, X, Ban, CheckCircle2, RefreshCw } from "lucide-react";
import { fetchExpenses, createExpense, updateExpense, deleteExpense } from "../lib/api";
import { currency as formatCurrency, formatDate } from "../lib/format";
import DataTable from "../components/DataTable";
import { getCachedExpenses, setCachedExpenses, EXPENSES_CACHE_KEY } from "../lib/expensesCache";
import { useSwrFetch } from "../lib/useSwr";
import LastUpdatedIndicator from "../components/LastUpdatedIndicator";

// Phase 18 (part 2) — same "config page, not a fast-moving analytics
// view" reasoning as productsCache.js.
const EXPENSES_STALE_MS = 5 * 60 * 1000;

// ────────────────────────────────────────────────────────────────
// Phase 16 §7/§8/§9/§19 — Operating Expenses. Entirely new, additive
// page (talks only to the new /api/expenses routes). `category` is a
// free-text field with a datalist of common suggestions — §7 explicitly
// says "do not hard-code only these categories," so nothing here
// prevents typing a custom one. Each row's "Daily Equivalent" comes
// straight from the server (server/lib/expenseAllocation.js), the same
// math routes/profitability.js uses for actual period allocation — this
// page never recomputes that math itself.
// ────────────────────────────────────────────────────────────────

const SUGGESTED_CATEGORIES = [
  "Employee Salary",
  "Fixed Expenses",
  "Office Rent",
  "Electricity",
  "Software",
  "Internet",
  "Packaging Supplies",
  "Warehouse",
  "Accountant",
  "Agency Fees",
  "Miscellaneous",
];

const FREQUENCIES = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" },
  { value: "one-time", label: "One-Time" },
];

const emptyForm = { name: "", category: "", amount: "", frequency: "monthly", startDate: new Date().toISOString().slice(0, 10), endDate: "", notes: "" };

function ExpenseFormFields({ form, setForm }) {
  return (
    <>
      <label className="flex flex-col gap-1 text-xs text-slate-500 flex-1 min-w-[160px]">
        Expense Name
        <input className="input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Warehouse Staff Salary" required />
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-500 min-w-[170px]">
        Category
        <input
          className="input"
          list="expense-categories"
          value={form.category}
          onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
          placeholder="e.g. Employee Salary"
          required
        />
        <datalist id="expense-categories">
          {SUGGESTED_CATEGORIES.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-500 w-28">
        Amount
        <input type="number" min="0" step="0.01" className="input" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} placeholder="₹0" required />
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-500 w-32">
        Frequency
        <select className="input" value={form.frequency} onChange={(e) => setForm((f) => ({ ...f, frequency: e.target.value }))}>
          {FREQUENCIES.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-500 w-36">
        Start Date
        <input type="date" className="input" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} required />
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-500 w-36">
        End Date
        <input type="date" className="input" value={form.endDate} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} placeholder="Optional" />
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-500 flex-1 min-w-[160px]">
        Notes
        <input className="input" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Optional" />
      </label>
    </>
  );
}

function AddExpenseForm({ onAdded }) {
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    setError("");
    setSubmitting(true);
    try {
      const res = await createExpense({ ...form, endDate: form.endDate || null });
      onAdded(res.expense);
      setForm(emptyForm);
    } catch (err) {
      setError(err.message || "Failed to add expense");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="card flex flex-wrap items-end gap-3">
      <ExpenseFormFields form={form} setForm={setForm} />
      <button type="submit" className="btn btn-primary btn-sm" disabled={submitting}>
        {submitting ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
        Add Expense
      </button>
      {error && (
        <div className="w-full flex items-center gap-1.5 text-xs text-rose-600">
          <AlertTriangle size={12} /> {error}
        </div>
      )}
    </form>
  );
}

function EditExpenseModal({ expense, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: expense.name || "",
    category: expense.category || "",
    amount: expense.amount || "",
    frequency: expense.frequency || "monthly",
    startDate: expense.startDate || "",
    endDate: expense.endDate || "",
    notes: expense.notes || "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    setError("");
    setSubmitting(true);
    try {
      const res = await updateExpense(expense.id, { ...form, endDate: form.endDate || null });
      onSaved(res.expense);
    } catch (err) {
      setError(err.message || "Failed to update expense");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div className="font-display font-semibold text-sm text-slate-800">Edit expense</div>
          <button type="button" className="text-slate-400 hover:text-slate-600" onClick={onClose}>
            <X size={15} />
          </button>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <ExpenseFormFields form={form} setForm={setForm} />
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

export default function ExpensesPage() {
  const [actionError, setActionError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [editTarget, setEditTarget] = useState(null);

  // Phase 18 (part 2) — real SWR, replacing the old
  // useState+useEffect+fetchExpenses().then(setExpenses) pattern.
  const {
    data: expensesData,
    loading,
    isValidating,
    error,
    backgroundError,
    lastUpdatedAt,
    refresh,
    mutate,
  } = useSwrFetch(EXPENSES_CACHE_KEY, () => fetchExpenses().then((res) => res.expenses || []), {
    staleTimeMs: EXPENSES_STALE_MS,
    getCached: getCachedExpenses,
    setCached: setCachedExpenses,
  });
  const expenses = expensesData || [];

  const handleToggleActive = async (x) => {
    setBusyId(x.id);
    try {
      const res = await updateExpense(x.id, { active: !x.active });
      mutate((prev) => (prev || []).map((e) => (e.id === x.id ? res.expense : e)));
    } catch (err) {
      setActionError(err.message || "Failed to update expense");
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (x) => {
    if (!window.confirm(`Delete "${x.name}"? This can't be undone.`)) return;
    setBusyId(x.id);
    try {
      await deleteExpense(x.id);
      mutate((prev) => (prev || []).filter((e) => e.id !== x.id));
    } catch (err) {
      setActionError(err.message || "Failed to delete expense");
    } finally {
      setBusyId(null);
    }
  };

  const totalDaily = expenses.filter((e) => e.active).reduce((s, e) => s + (e.dailyEquivalent || 0), 0);

  const columns = [
    { key: "name", label: "Expense Name", render: (e) => <span className="font-medium text-slate-700">{e.name}</span> },
    { key: "category", label: "Category", render: (e) => <span className="badge badge-slate text-[10px]">{e.category}</span> },
    { key: "amount", label: "Amount", render: (e) => formatCurrency(e.amount) },
    { key: "frequency", label: "Frequency", render: (e) => FREQUENCIES.find((f) => f.value === e.frequency)?.label || e.frequency },
    {
      key: "dailyEquivalent",
      label: "Daily Equivalent",
      render: (e) => (
        <span className="text-slate-600">
          {formatCurrency(e.dailyEquivalent)}
          <span className="text-slate-400">/day</span>
        </span>
      ),
    },
    { key: "startDate", label: "Start Date", render: (e) => formatDate(e.startDate) },
    { key: "endDate", label: "End Date", render: (e) => (e.endDate ? formatDate(e.endDate) : <span className="text-slate-300">—</span>) },
    { key: "notes", label: "Notes", render: (e) => e.notes || <span className="text-slate-300">—</span> },
    {
      key: "active",
      label: "Status",
      render: (e) =>
        e.active ? <span className="badge badge-green text-[10px]">Active</span> : <span className="badge badge-slate text-[10px]">Inactive</span>,
    },
    {
      key: "actions",
      label: "",
      sortable: false,
      defaultWidth: 110,
      render: (e) => (
        <div className="flex items-center gap-1.5" onClick={(ev) => ev.stopPropagation()}>
          <button type="button" className="text-slate-400 hover:text-indigo-600 disabled:opacity-40" title="Edit" disabled={busyId === e.id} onClick={() => setEditTarget(e)}>
            <Pencil size={14} />
          </button>
          <button
            type="button"
            className={`disabled:opacity-40 ${e.active ? "text-slate-400 hover:text-amber-600" : "text-slate-400 hover:text-emerald-600"}`}
            title={e.active ? "Deactivate" : "Activate"}
            disabled={busyId === e.id}
            onClick={() => handleToggleActive(e)}
          >
            {e.active ? <Ban size={14} /> : <CheckCircle2 size={14} />}
          </button>
          <button type="button" className="text-slate-400 hover:text-rose-600 disabled:opacity-40" title="Delete" disabled={busyId === e.id} onClick={() => handleDelete(e)}>
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
          <span className="flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 text-white shadow-md shadow-amber-500/30">
            <Wallet size={18} />
          </span>
          <div>
            <h1 className="text-lg font-display font-bold text-slate-800 leading-tight">Operating Expenses</h1>
            <p className="text-xs text-slate-400">
              {loading ? "Loading…" : `${expenses.filter((e) => e.active).length} active · ~${formatCurrency(totalDaily)}/day today`}
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

      <AddExpenseForm onAdded={(x) => mutate((prev) => [x, ...(prev || [])])} />

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
          tableId="expenses"
          columns={columns}
          data={expenses}
          searchKeys={["name", "category", "notes"]}
          exportFilename="expenses.csv"
          emptyMessage="No expenses added yet. Add one above."
        />
      )}

      {editTarget && (
        <EditExpenseModal
          expense={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={(x) => {
            mutate((prev) => (prev || []).map((e) => (e.id === x.id ? x : e)));
            setEditTarget(null);
          }}
        />
      )}
    </div>
  );
}
