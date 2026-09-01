import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  ShoppingBag,
  Loader2,
  Pencil,
  Eye,
  AlertTriangle,
  X,
  RefreshCw,
  CalendarRange,
  Search,
  ChevronLeft,
  ChevronRight,
  Settings2,
  Download,
  CheckCircle2,
} from "lucide-react";
import {
  fetchAbandonedCarts,
  fetchAbandonedCart,
  updateAbandonedCartNotes,
  fetchAbandonedCartSettings,
  updateAbandonedCartSettings,
  startTrafleadSync,
  fetchTrafleadSyncStatus,
} from "../lib/api";
import { currency as formatCurrency, number as formatNumber, formatDateTime } from "../lib/format";
import { downloadCsv } from "../lib/csv";
import {
  BUCKET_STYLES,
  matchMethodLabel,
  MATCH_METHOD_STYLES,
  shipmentStatusDisplay,
  shipmentStatusBadgeTone,
  effectiveMatchMethod,
  isVerificationPending,
} from "../lib/shipmentStatus";

// ────────────────────────────────────────────────────────────────
// Phase 33 — Exact Traflead Abandoned Cart Data Sync. Every record on
// this page is an EXACT MIRROR of a real Lead in the separate trafleadcrm
// project's "Abandoned Cart" offer (synced via
// server/services/trafleadSyncService.js, upserted on Traflead's own
// stable Lead ID — see server/models/TrafleadAbandonedCartLead.js).
// This page never creates or deletes a record — only Traflead does that
// — it searches/filters/views what's synced, and can add a purely
// ops-local Note (the one field this app is allowed to write itself;
// every other field would just be overwritten by the next sync).
//
// Status is shown EXACTLY as Traflead has it (processing/approved/
// cancelled/hold/trash/confirmed), never renamed. Revenue recognition
// (Settings panel) is now based on that real status (+ shipment
// delivered, optionally) instead of a flat assumed delivery-rate %.
// ────────────────────────────────────────────────────────────────

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const todayIso = () => new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
const shiftDays = (dateStr, days) => {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const PAGE_SIZES = [10, 25, 50, 100];

const STATUS_STYLES = {
  confirmed: "bg-emerald-50 text-emerald-700 border-emerald-200",
  approved: "bg-sky-50 text-sky-700 border-sky-200",
  processing: "bg-amber-50 text-amber-700 border-amber-200",
  hold: "bg-orange-50 text-orange-700 border-orange-200",
  cancelled: "bg-slate-100 text-slate-500 border-slate-200",
  trash: "bg-rose-50 text-rose-600 border-rose-200",
};

function StatusBadge({ status }) {
  if (!status) return <span className="text-slate-300">—</span>;
  const cls = STATUS_STYLES[String(status).toLowerCase()] || "bg-slate-100 text-slate-600 border-slate-200";
  return <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium border ${cls}`}>{status}</span>;
}

// ────────────────────────────────────────────────────────────────
// Filters — quick presets + persistence across navigation.
// (Unchanged from Phase 25/28 — see original header comment for the
// full rationale: presets fetch immediately, custom range stages a
// draft until "Apply", and everything is mirrored into sessionStorage
// so navigating away and back picks up where you left off.)
// ────────────────────────────────────────────────────────────────
const FILTERS_STORAGE_KEY = "abandonedCartsPage.filters.v1";

function loadPersistedFilters() {
  try {
    const raw = sessionStorage.getItem(FILTERS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function savePersistedFilters(state) {
  try {
    sessionStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore — private browsing / storage disabled, filters just won't persist
  }
}

const PRESETS = [
  { key: "today", label: "Today", range: () => [todayIso(), todayIso()] },
  { key: "yesterday", label: "Yesterday", range: () => [shiftDays(todayIso(), -1), shiftDays(todayIso(), -1)] },
  { key: "7d", label: "7 Days", range: () => [shiftDays(todayIso(), -6), todayIso()] },
  { key: "30d", label: "30 Days", range: () => [shiftDays(todayIso(), -29), todayIso()] },
];

function SettingsPanel({ open, onClose, onSaved }) {
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
          manufacturingCost: String(res.manufacturingCost ?? 0),
          packagingCost: String(res.packagingCost ?? 0),
          shippingCost: String(res.shippingCost ?? 0),
          miscCost: String(res.miscCost ?? 0),
          cnfRevenueRate: String(res.cnfRevenueRate ?? 50),
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
        manufacturingCost: Number(form.manufacturingCost) || 0,
        packagingCost: Number(form.packagingCost) || 0,
        shippingCost: Number(form.shippingCost) || 0,
        miscCost: Number(form.miscCost) || 0,
        cnfRevenueRate: Number(form.cnfRevenueRate) || 0,
      });
      setForm({
        manufacturingCost: String(res.manufacturingCost ?? 0),
        packagingCost: String(res.packagingCost ?? 0),
        shippingCost: String(res.shippingCost ?? 0),
        miscCost: String(res.miscCost ?? 0),
        cnfRevenueRate: String(res.cnfRevenueRate ?? 50),
      });
      setSavedAt(Date.now());
      // Phase 37 — "changing it must immediately recalculate the
      // Abandoned Cart revenue and profitability." Re-fetch the page's own
      // summary right away rather than waiting for the next unrelated
      // refresh/navigation; every other page reading this same setting
      // already recalculates on its own next fetch (settings are read
      // fresh server-side on every GET /api/abandoned-carts call, never
      // cached), so this just makes it immediate here too instead of only
      // eventually.
      onSaved?.();
    } catch (err) {
      setError(err.message || "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="font-display font-semibold text-sm text-slate-800">Abandoned Cart Expense Settings</div>
        <button type="button" className="text-slate-400 hover:text-slate-600" onClick={onClose}>
          <X size={15} />
        </button>
      </div>
      <p className="text-xs text-slate-400 -mt-1">
        Applies everywhere in the app (this page, Dashboard, Daily, Analytics, Profitability, Campaign Explorer). Revenue is
        recognized from CNF (Confirmed) leads — orders whose Traflead status is "confirmed" — × the CNF Revenue Rate below, a
        manual assumption of how many of those confirmed leads to count as revenue. Shipment delivery status is still
        verified and shown (see the table below) but no longer drives revenue on its own. These per-order costs are charged
        against the resulting Revenue-Counted CNF order count, not the raw confirmed-lead count.
      </p>
      {loading || !form ? (
        <div className="h-20 animate-pulse bg-slate-100 rounded-lg" />
      ) : (
        <form onSubmit={handleSave} className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs text-slate-500 w-36">
              CNF Revenue Rate
              <div className="relative">
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  className="input !pr-6"
                  value={form.cnfRevenueRate}
                  onChange={(e) => setForm((f) => ({ ...f, cnfRevenueRate: e.target.value }))}
                />
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">%</span>
              </div>
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
          </div>
          <p className="text-[11px] text-slate-400">
            "/ Order" here means per Revenue-Counted CNF order (CNF Leads × CNF Revenue Rate) — see the summary above for that
            count. Saving recalculates Abandoned Cart revenue and profit immediately, everywhere it's shown.
          </p>
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

function AddressBlock({ record }) {
  const parts = [record.address, record.address2, record.city, record.state, record.pinCode, record.country].filter(Boolean);
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
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="font-display font-semibold text-sm text-slate-800">Abandoned cart lead — from Traflead</div>
          <button type="button" className="text-slate-400 hover:text-slate-600" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        {loading && <div className="h-40 animate-pulse bg-slate-100 rounded-lg" />}
        {error && <div className="text-xs text-rose-600">{error}</div>}

        {record && !loading && (
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2.5">
              <Field label="Created (Traflead)" value={formatDateTime(record.trafleadCreatedAt)} />
              <Field label="Updated (Traflead)" value={formatDateTime(record.trafleadUpdatedAt)} />
              <Field label="Status" value={<StatusBadge status={record.status} />} raw />
              {/* Phase 40 — lifecycle event dates, each the ACTUAL date that
                  event happened (never the Abandoned Cart creation date).
                  Only shown once that event has actually occurred. */}
              {record.confirmedDateIst && <Field label="CNF Date" value={record.confirmedDateIst} />}
              {record.matchedDeliveredDateIst && <Field label="Delivered Date" value={record.matchedDeliveredDateIst} />}
              {record.cancelledDateIst && <Field label="Cancelled Date" value={record.cancelledDateIst} />}
              {record.returnedDateIst && <Field label="Returned Date" value={record.returnedDateIst} />}
              {record.lifecycleSummary && (
                <div className="col-span-2 sm:col-span-3">
                  <Field label="Lifecycle" value={record.lifecycleSummary} />
                </div>
              )}
              {/* Phase 36 §1 — reads through the same shared helpers the
                  main table uses (see lib/shipmentStatus.js) so this modal
                  can never show a different status/match interpretation
                  than the table row it was opened from. */}
              <Field label="Shipment Status" value={shipmentStatusDisplay(record)} />
              <Field
                label="Matched Shipment"
                value={
                  <span
                    className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium border ${
                      isVerificationPending(record)
                        ? "bg-blue-50 text-blue-600 border-blue-200"
                        : record.matchedShipmentFound
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                        : "bg-slate-100 text-slate-500 border-slate-200"
                    }`}
                  >
                    {isVerificationPending(record) ? "Verifying…" : record.matchedShipmentFound ? "Found" : "Not Found"}
                  </span>
                }
                raw
              />
              <Field label="Match status" value={matchMethodLabel(effectiveMatchMethod(record))} />
              {!isVerificationPending(record) && (
                <Field label="Last Verified" value={formatDateTime(record.shipmentLookupCheckedAt)} />
              )}
              <Field label="Matched Order ID" value={record.matchedOrderId || "—"} />
              <Field label="Matched AWB" value={record.matchedAwbNumber || "—"} />
              {record.matchedCandidateCount > 1 && (
                <Field label="Candidates for this phone" value={`${record.matchedCandidateCount} shipped leads`} />
              )}
              <Field
                label="Matched Delivered At"
                value={record.matchedDeliveredAt ? formatDateTime(record.matchedDeliveredAt) : "—"}
              />
              <Field label="Order Date (Traflead)" value={record.orderDateIst || "—"} />
              <Field label="Lead ID (Traflead)" value={record.trafleadLeadId || "—"} />
              <Field label="Order ID" value={record.orderId || "—"} />
              <Field label="External Order ID" value={record.externalOrderId || "—"} />
              <Field label="Offer" value={record.offerName || "—"} />
              <Field label="Customer" value={record.fullName || "—"} />
              <Field label="Phone" value={record.phone || "—"} />
              <Field label="Email" value={record.email || "—"} />
              <Field label="Product" value={record.productName || "—"} />
              <Field label="Amount" value={formatCurrency(record.total)} strong />
              <Field label="Payment Mode" value={record.paymentMode || "—"} />
              <Field label="Campaign" value={record.campaign || "—"} />
              <Field label="Medium" value={record.medium || "—"} />
              <Field label="Webmaster" value={record.webmaster || "—"} />
              <Field label="Affiliate ID" value={record.affiliateId || "—"} />
              <Field label="Lead Source" value={record.leadSource || "—"} />
              <Field label="Sub1" value={record.sub1 || "—"} />
              <Field label="Sub2" value={record.sub2 || "—"} />
              <Field label="Sub3" value={record.sub3 || "—"} />
              <Field label="Sub4" value={record.sub4 || "—"} />
              <Field label="Sub5" value={record.sub5 || "—"} />
              <div className="col-span-2 sm:col-span-3">
                <div className="text-slate-400">Address</div>
                <div className="text-slate-700 mt-0.5">
                  <AddressBlock record={record} />
                </div>
              </div>
            </div>

            {record.notes && (
              <div>
                <div className="text-slate-400 mb-1">Notes (ops-local, never synced to/from Traflead)</div>
                <div className="text-slate-700">{record.notes}</div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, strong, raw }) {
  return (
    <div className="min-w-0">
      <div className="text-slate-400">{label}</div>
      {raw ? (
        <div className="mt-0.5">{value}</div>
      ) : (
        <div className={`truncate ${strong ? "font-semibold text-slate-800" : "text-slate-700"}`}>{value}</div>
      )}
    </div>
  );
}

// Every field on a synced lead comes from Traflead and would just be
// overwritten by the next sync — this app is only allowed to write its
// own `notes` field, so editing is a single textarea, not a full form.
function EditNotesModal({ record, onClose, onSaved }) {
  const [notes, setNotes] = useState(record.notes || "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    setError("");
    setSubmitting(true);
    try {
      const res = await updateAbandonedCartNotes(record.id, notes);
      onSaved(res.record);
    } catch (err) {
      setError(err.message || "Failed to save note");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-5 space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="font-display font-semibold text-sm text-slate-800">Note — {record.fullName || record.phone || record.orderId}</div>
          <button type="button" className="text-slate-400 hover:text-slate-600" onClick={onClose}>
            <X size={15} />
          </button>
        </div>
        <p className="text-xs text-slate-400">
          Every other field on this lead is synced from Traflead and read-only here. Notes are ops-local only.
        </p>
        <textarea
          className="input w-full min-h-[100px]"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Optional"
        />
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

// Compact "synced from Traflead" indicator — polls /traflead-sync/status
// while a sync is running (either the background catch-up GET / kicked
// off, or a manual force-refresh) and stops once it's done.
function SyncStatusBar({ since, until, onSyncComplete }) {
  const [status, setStatus] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const pollRef = useRef(null);

  const poll = () => {
    fetchTrafleadSyncStatus({ since, until })
      .then((res) => {
        setStatus(res.data);
        const running = res.data?.backfill?.running;
        if (running) {
          pollRef.current = setTimeout(poll, 2500);
        } else {
          setRefreshing(false);
          onSyncComplete?.();
        }
      })
      .catch(() => {
        setRefreshing(false);
      });
  };

  useEffect(() => {
    poll();
    return () => clearTimeout(pollRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [since, until]);

  const handleForceSync = async () => {
    setRefreshing(true);
    try {
      await startTrafleadSync({ since, until, force: true });
      poll();
    } catch {
      setRefreshing(false);
    }
  };

  const backfill = status?.backfill;
  const running = backfill?.running;
  const failed = status?.summary?.failed || 0;

  return (
    <div className="flex items-center gap-2 text-xs text-slate-500">
      {running ? (
        <>
          <Loader2 size={12} className="animate-spin text-indigo-500" />
          Syncing from Traflead — day {backfill.daysDone}/{backfill.daysTotal}
          {backfill.currentDay ? ` (${backfill.currentDay})` : ""}
        </>
      ) : failed > 0 ? (
        <>
          <AlertTriangle size={12} className="text-rose-500" />
          {failed} day{failed === 1 ? "" : "s"} failed to sync from Traflead
        </>
      ) : (
        <>
          <CheckCircle2 size={12} className="text-emerald-500" />
          Synced from Traflead
        </>
      )}
      <button
        type="button"
        className="btn btn-secondary btn-sm !py-1 !text-[11px]"
        onClick={handleForceSync}
        disabled={refreshing || running}
      >
        {refreshing || running ? "Syncing…" : "Sync now"}
      </button>
    </div>
  );
}

export default function AbandonedCartsPage() {
  // Phase 28 §6 — "Abandoned Cart Revenue → opens the abandoned-cart
  // orders for that date range." Dashboard's breakdown links here as
  // /abandoned-carts?since=&until=, so this page seeds its own
  // since/until state from those query params when present.
  const [searchParams] = useSearchParams();
  const [persisted] = useState(() => loadPersistedFilters());
  const [since, setSince] = useState(() => searchParams.get("since") || persisted?.since || todayIso());
  const [until, setUntil] = useState(() => searchParams.get("until") || persisted?.until || todayIso());
  const [sinceDraft, setSinceDraft] = useState(since);
  const [untilDraft, setUntilDraft] = useState(until);
  const [searchInput, setSearchInput] = useState(() => persisted?.searchInput || "");
  const [search, setSearch] = useState(() => persisted?.search || "");
  const [page, setPage] = useState(() => persisted?.page || 1);
  const [pageSize, setPageSize] = useState(() => persisted?.pageSize || 25);

  const activePresetKey = useMemo(() => {
    const match = PRESETS.find((p) => {
      const [s, u] = p.range();
      return s === since && u === until;
    });
    return match?.key || null;
  }, [since, until]);

  const applyPreset = (preset) => {
    const [s, u] = preset.range();
    setSince(s);
    setUntil(u);
    setSinceDraft(s);
    setUntilDraft(u);
  };

  const hasPendingRange = sinceDraft !== since || untilDraft !== until;
  const applyCustomRange = () => {
    if (!sinceDraft || !untilDraft || !hasPendingRange) return;
    setSince(sinceDraft);
    setUntil(untilDraft);
  };

  useEffect(() => {
    savePersistedFilters({ since, until, searchInput, search, page, pageSize });
  }, [since, until, searchInput, search, page, pageSize]);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [viewId, setViewId] = useState(null);
  const [editRecord, setEditRecord] = useState(null);
  const [actionError, setActionError] = useState("");
  const [exporting, setExporting] = useState(false);

  const isFirstSearchRun = useRef(true);
  useEffect(() => {
    if (isFirstSearchRun.current) {
      isFirstSearchRun.current = false;
      return;
    }
    const t = setTimeout(() => {
      setPage(1);
      setSearch(searchInput.trim());
    }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  const isFirstRangeRun = useRef(true);
  useEffect(() => {
    if (isFirstRangeRun.current) {
      isFirstRangeRun.current = false;
      return;
    }
    setPage(1);
  }, [since, until, pageSize]);

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

  // Export — a CSV of every record matching the CURRENT since/until/
  // search filters (not just the page on screen).
  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    setActionError("");
    try {
      const all = [];
      let p = 1;
      let pages = 1;
      do {
        const res = await fetchAbandonedCarts({ since, until, search, page: p, pageSize: 200 });
        all.push(...(res.records || []));
        pages = res.totalPages || 1;
        p += 1;
      } while (p <= pages);

      const rows = [
        [
          "Created (Traflead)",
          "Updated (Traflead)",
          "Lead ID (Traflead)",
          "Order ID",
          "External Order ID",
          "Customer",
          "Phone",
          "Email",
          "Product",
          "Amount",
          "Status",
          "Shipment Status",
          "Matched Shipment",
          "Match status",
          "Matched Order ID",
          "Campaign",
          "Medium",
          "Webmaster",
          "Affiliate ID",
          "Sub1",
          "Sub2",
          "Sub3",
          "Sub4",
          "Sub5",
        ],
        ...all.map((r) => [
          formatDateTime(r.trafleadCreatedAt),
          formatDateTime(r.trafleadUpdatedAt),
          r.trafleadLeadId || "",
          r.orderId || "",
          r.externalOrderId || "",
          r.fullName || "",
          r.phone || "",
          r.email || "",
          r.productName || "",
          r.total ?? 0,
          r.status || "",
          shipmentStatusDisplay(r),
          isVerificationPending(r) ? "Verifying" : r.matchedShipmentFound ? "Found" : "Not Found",
          matchMethodLabel(effectiveMatchMethod(r)),
          r.matchedOrderId || "",
          r.campaign || "",
          r.medium || "",
          r.webmaster || "",
          r.affiliateId || "",
          r.sub1 || "",
          r.sub2 || "",
          r.sub3 || "",
          r.sub4 || "",
          r.sub5 || "",
        ]),
      ];
      downloadCsv(`abandoned-carts-${since}-to-${until}.csv`, rows);
    } catch (err) {
      setActionError(err.message || "Failed to export abandoned cart records");
    } finally {
      setExporting(false);
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
                : `${formatNumber(summary.orders)} abandoned cart lead${summary.orders === 1 ? "" : "s"} in range (synced from Traflead) · CNF ${formatNumber(
                    summary.cnfLeadsCount
                  )} · Potential ${formatCurrency(summary.potentialRevenue)} · Confirmed Revenue ${formatCurrency(
                    summary.confirmedRevenue ?? summary.cnfRevenue
                  )} (${formatNumber(summary.cnfRevenueCountedCount)} CNF × ${formatNumber(summary.cnfRevenueRate)}%) · Profit ${formatCurrency(summary.profit)}${
                    summary.pendingVerification > 0 ? ` · ${formatNumber(summary.pendingVerification)} awaiting verification` : ""
                  }`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSettingsOpen((v) => !v)}>
            <Settings2 size={13} /> Settings
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={handleExport} disabled={exporting || total === 0}>
            {exporting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} {exporting ? "Exporting…" : "Export"}
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => load(true)} disabled={refreshing}>
            <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} /> Refresh
          </button>
        </div>
      </div>

      <SyncStatusBar since={since} until={until} onSyncComplete={() => load(true)} />

      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} onSaved={() => load(true)} />

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
            placeholder="Search customer, phone, email, order ID, campaign, status…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-1.5 text-xs text-slate-500">
          <CalendarRange size={13} />
          Date range
        </div>
        <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-0.5">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                activePresetKey === p.key ? "bg-white text-indigo-600 shadow-sm font-medium" : "text-slate-500 hover:text-slate-700"
              }`}
              onClick={() => applyPreset(p)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <input
          type="date"
          className="input w-auto !py-1.5 !text-xs"
          value={sinceDraft}
          max={untilDraft || undefined}
          onChange={(e) => setSinceDraft(e.target.value)}
        />
        <span className="text-slate-400 text-xs">to</span>
        <input
          type="date"
          className="input w-auto !py-1.5 !text-xs"
          value={untilDraft}
          min={sinceDraft || undefined}
          onChange={(e) => setUntilDraft(e.target.value)}
        />
        <button
          type="button"
          className="btn btn-secondary btn-sm !py-1.5 !text-xs"
          disabled={!sinceDraft || !untilDraft || !hasPendingRange}
          onClick={applyCustomRange}
        >
          Apply
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
                  {["Created (Traflead)", "Order ID", "Customer", "Amount", "Status", "Shipment", "Match", "Campaign", ""].map((h) => (
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
                      No abandoned cart leads for this range/search.
                    </td>
                  </tr>
                ) : (
                  records.map((r) => (
                    <tr key={r.id} className="cursor-pointer" onClick={() => setViewId(r.id)}>
                      <td className="font-medium text-slate-700 whitespace-nowrap">{formatDateTime(r.trafleadCreatedAt)}</td>
                      <td className="text-slate-600">{r.orderId || r.externalOrderId || r.trafleadLeadId || "—"}</td>
                      <td>
                        <div className="text-slate-700">{r.fullName || "—"}</div>
                        {(r.phone || r.email) && <div className="text-slate-400 text-[11px]">{r.phone || r.email}</div>}
                      </td>
                      <td className="font-medium">{formatCurrency(r.total)}</td>
                      <td>
                        <StatusBadge status={r.status} />
                      </td>
                      <td>
                        <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium border ${BUCKET_STYLES[shipmentStatusBadgeTone(r)]}`}>
                          {shipmentStatusDisplay(r)}
                        </span>
                      </td>
                      <td>
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium border whitespace-nowrap ${
                            MATCH_METHOD_STYLES[effectiveMatchMethod(r)] || MATCH_METHOD_STYLES.not_found
                          }`}
                        >
                          {matchMethodLabel(effectiveMatchMethod(r))}
                        </span>
                      </td>
                      <td className="text-slate-600">{r.campaign || "—"}</td>
                      <td onClick={(ev) => ev.stopPropagation()}>
                        <div className="flex items-center gap-1.5">
                          <button type="button" className="text-slate-400 hover:text-indigo-600" title="View details" onClick={() => setViewId(r.id)}>
                            <Eye size={14} />
                          </button>
                          <button type="button" className="text-slate-400 hover:text-indigo-600" title="Edit note" onClick={() => setEditRecord(r)}>
                            <Pencil size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
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
      {editRecord && (
        <EditNotesModal
          record={editRecord}
          onClose={() => setEditRecord(null)}
          onSaved={() => {
            setEditRecord(null);
            load(true);
          }}
        />
      )}
    </div>
  );
}
