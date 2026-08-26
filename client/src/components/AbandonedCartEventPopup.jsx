import { useEffect, useMemo, useState } from "react";
import { X, Search, Download, Inbox, Loader2, AlertTriangle } from "lucide-react";
import { currency, number as formatNumber } from "../lib/format";
import { downloadCsv } from "../lib/csv";
import { fetchAbandonedCartLifecycleEvents } from "../lib/api";

// ─────────────────────────────────────────────────────────────
// Phase 40 — generalized drill-down popup for ALL FIVE Abandoned Cart
// lifecycle events (Created/CNF/Delivered/Cancelled/Returned), replacing
// Phase 34/35's DeliveredRevenuePopup (which only ever handled Delivered
// Revenue, fed by a `leads` array the caller had already fetched). This
// component fetches its own data on open, from the new GET
// /abandoned-carts/lifecycle endpoint, scoped to whichever single event
// + date range it's opened for — so a click on ANY count (Created, CNF,
// Delivered, Cancelled, Returned — spec §11/§17 "every count must be
// clickable") opens the exact set of orders that event actually belongs
// to, dated by that event's own date field, never orderDateIst for all
// of them.
//
// Columns follow spec §17's drill-down list: Customer, Phone, Order ID,
// Created Date, CNF Date, Delivered Date, Current Status, Lifecycle
// (server-built `lifecycleSummary` — the "Status History" column, built
// only from dated fields actually set, never fabricated), Order Value,
// Campaign, Ad Set (Traflead's own sub1 — see the header comment in the
// old DeliveredRevenuePopup for why this isn't a fabricated Meta Ad
// Set/Ad match), Ad (sub2).
// ─────────────────────────────────────────────────────────────

const PAGE_SIZE = 15;

const EVENT_META = {
  created: { title: "Abandoned Cart — Created Orders", noun: "created", dateLabel: "orders created" },
  cnf: { title: "Abandoned Cart — CNF / Confirmed Orders", noun: "confirmed (CNF)", dateLabel: "orders confirmed" },
  delivered: { title: "Abandoned Cart — Delivered Orders", noun: "delivered", dateLabel: "orders delivered" },
  cancelled: { title: "Abandoned Cart — Cancelled Orders", noun: "cancelled", dateLabel: "orders cancelled" },
  returned: { title: "Abandoned Cart — Returned Orders", noun: "returned (RTO)", dateLabel: "orders returned" },
};

export default function AbandonedCartEventPopup({ open, since, until, event, onClose }) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || !since || !until || !event) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    setSearch("");
    setPage(1);
    fetchAbandonedCartLifecycleEvents({ since, until, event })
      .then((res) => !cancelled && setData(res))
      .catch((err) => !cancelled && setError(err.message || "Failed to load abandoned cart orders"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open, since, until, event]);

  const meta = EVENT_META[event] || EVENT_META.created;
  const leads = data?.leads || [];

  const filtered = useMemo(() => {
    if (!search.trim()) return leads;
    const q = search.trim().toLowerCase();
    return leads.filter((l) =>
      [l.fullName, l.phone, l.orderId, l.externalOrderId, l.trafleadLeadId, l.campaign]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    );
  }, [leads, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageSafe = Math.min(page, totalPages);
  const pageRows = filtered.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE);

  if (!open) return null;

  const totalValue = filtered.reduce((sum, l) => sum + (Number(l.total) || 0), 0);

  const handleExport = () => {
    const rows = [
      [
        "Customer",
        "Phone",
        "Order ID",
        "Lead ID",
        "Created Date",
        "CNF Date",
        "Delivered Date",
        "Current Status",
        "Lifecycle",
        "Order Value",
        "Campaign",
        "Ad Set",
        "Ad",
      ],
      ...filtered.map((l) => [
        l.fullName || "",
        l.phone || "",
        l.orderId || l.externalOrderId || "",
        l.trafleadLeadId || "",
        l.orderDateIst || "",
        l.confirmedDateIst || "",
        l.matchedDeliveredDateIst || "",
        l.status || "",
        l.lifecycleSummary || "",
        l.total ?? "",
        l.campaign || "",
        l.sub1 || "",
        l.sub2 || "",
      ]),
    ];
    downloadCsv(`abandoned-cart-${event}_${since}_to_${until}.csv`, rows);
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between p-5 pb-3">
          <div>
            <div className="font-display font-semibold text-sm text-slate-800">{meta.title}</div>
            <div className="text-xs text-slate-400 mt-0.5">
              {since === until ? since : `${since} to ${until}`} · {meta.dateLabel} on {since === until ? "this date" : "these dates"} ·{" "}
              {formatNumber(filtered.length)} order{filtered.length === 1 ? "" : "s"} · {currency(totalValue)} total order value
              {event === "cnf" && data?.cnfRevenueRate !== undefined && (
                <>
                  {" "}
                  · CNF Revenue Rate {formatNumber(data.cnfRevenueRate)}% · Revenue-Counted {formatNumber(data.cnfRevenueCountedCount)} ·
                  Confirmed Revenue {currency(data.cnfRevenue)}
                </>
              )}
            </div>
            {data?.truncated && (
              <div className="text-[11px] text-amber-600 mt-0.5">
                Showing the first 1,000 {meta.noun} orders for this range — narrow the date range to see the rest.
              </div>
            )}
          </div>
          <button type="button" className="text-slate-400 hover:text-slate-600" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="flex items-center gap-2 px-5 pb-3">
          <div className="relative flex-1 max-w-xs">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-300" />
            <input
              className="input !pl-7 !py-1.5 !text-xs w-full"
              placeholder="Search customer, phone, order ID..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <button type="button" className="btn btn-secondary btn-sm !text-xs ml-auto" onClick={handleExport} disabled={filtered.length === 0}>
            <Download size={12} /> Export CSV
          </button>
        </div>

        <div className="flex-1 overflow-auto px-5">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-slate-400 gap-2">
              <Loader2 size={16} className="animate-spin" /> Loading…
            </div>
          ) : error ? (
            <div className="flex items-center gap-1.5 text-xs text-rose-600 py-10 justify-center">
              <AlertTriangle size={12} /> {error}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-2">
              <Inbox size={22} />
              <div className="text-xs">No {meta.noun} Abandoned Cart orders for this range.</div>
            </div>
          ) : (
            <table className="table" style={{ tableLayout: "fixed", width: "max-content", minWidth: "100%" }}>
              <thead>
                <tr>
                  {[
                    "Customer",
                    "Phone",
                    "Order ID",
                    "Created Date",
                    "CNF Date",
                    "Delivered Date",
                    "Current Status",
                    "Lifecycle",
                    "Order Value",
                    "Campaign",
                    "Ad Set",
                    "Ad",
                  ].map((h) => (
                    <th key={h} className="sticky top-0 z-[2] bg-slate-50 text-left whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((l) => (
                  <tr key={l.id}>
                    <td className="text-slate-700">{l.fullName || "—"}</td>
                    <td className="text-slate-500">{l.phone || "—"}</td>
                    <td className="text-slate-600">{l.orderId || l.externalOrderId || "—"}</td>
                    <td className="text-slate-500 whitespace-nowrap">{l.orderDateIst || "—"}</td>
                    <td className="text-slate-500 whitespace-nowrap">{l.confirmedDateIst || "—"}</td>
                    <td className="text-slate-500 whitespace-nowrap">{l.matchedDeliveredDateIst || "—"}</td>
                    <td className="text-slate-600 capitalize">{l.status || "—"}</td>
                    <td className="text-slate-400 text-[11px] whitespace-nowrap">{l.lifecycleSummary || "—"}</td>
                    <td className="text-slate-600">{currency(l.total)}</td>
                    <td className="text-slate-500">{l.campaign || "—"}</td>
                    <td className="text-slate-400">{l.sub1 || "—"}</td>
                    <td className="text-slate-400">{l.sub2 || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 text-xs text-slate-500 border-t border-slate-100">
            <span>
              Page {pageSafe} of {totalPages}
            </span>
            <div className="flex items-center gap-1.5">
              <button type="button" className="btn btn-secondary btn-sm !text-xs" disabled={pageSafe <= 1} onClick={() => setPage((p) => p - 1)}>
                Prev
              </button>
              <button type="button" className="btn btn-secondary btn-sm !text-xs" disabled={pageSafe >= totalPages} onClick={() => setPage((p) => p + 1)}>
                Next
              </button>
            </div>
          </div>
        )}

        <div className="text-[10px] text-slate-400 px-5 py-2 border-t border-slate-100">
          Created/CNF/Delivered dates are each the ACTUAL date that event happened (Traflead's own timestamps) — never the
          original Abandoned Cart creation date. Ad Set / Ad show Traflead's own sub1/sub2 attribution fields — Traflead
          doesn't track a separate Meta Ad Set/Ad ID, so these are shown as Traflead has them rather than guessed at.
        </div>
      </div>
    </div>
  );
}
