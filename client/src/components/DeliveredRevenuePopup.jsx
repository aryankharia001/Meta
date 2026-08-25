import { useMemo, useState } from "react";
import { X, Search, Download, Inbox } from "lucide-react";
import { currency, number as formatNumber } from "../lib/format";
import { downloadCsv } from "../lib/csv";
import { shipmentStatusLabel, matchMethodLabel } from "../lib/shipmentStatus";

// ─────────────────────────────────────────────────────────────
// Phase 34 — "Clicking Abandoned Cart Delivered Revenue should open a
// popup showing the actual delivered shipments... This allows me to
// verify exactly where the revenue came from."
//
// Data is passed in as a prop (`leads`), not fetched by this component —
// every caller already has it from the same fetchAbandonedCarts({since,
// until}) call that produced the Delivered Revenue figure it's opened
// from, so the popup can never show a different number than the figure
// the person clicked. Same "data passed in, not fetched here" pattern
// OrdersListPopup.jsx already uses.
//
// Phase 35 — columns changed to match the new phone-based matching spec
// exactly: Customer, Phone, Order ID, Abandoned Cart Lead ID, Order
// Date, Order Price, Shipment Status, Matched Shipment, Campaign, Ad
// Set, Ad, Match status, Revenue. "Delivered Date" is gone — Phase 35
// attributes revenue to the SELECTED date range, never a delivery date,
// so there's only one date per row now (Order Date). "Shipment Status"
// and "Matched Shipment" both come from the PHONE match
// (matchedShipmentStatus/matchedShipmentFound), not the embedded
// shipment fields Phase 34 used — see trafleadSyncService.js's Phase 35
// header comment for why those can legitimately point at different
// underlying Traflead Lead documents. Traflead has no dedicated Ad
// Set/Ad ID fields (see trafleadSyncService.js's header comment) — Ad
// Set/Ad show Traflead's own sub1/sub2 attribution fields rather than a
// fabricated Meta match, same honesty precedent CampaignDrawer's "Search
// Traflead" link already established.
// ─────────────────────────────────────────────────────────────

const PAGE_SIZE = 15;

export default function DeliveredRevenuePopup({ open, since, until, leads, truncated, onClose }) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const list = leads || [];
    if (!search.trim()) return list;
    const q = search.trim().toLowerCase();
    return list.filter((l) =>
      [l.fullName, l.phone, l.orderId, l.externalOrderId, l.trafleadLeadId, l.matchedOrderId, l.campaign]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    );
  }, [leads, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageSafe = Math.min(page, totalPages);
  const pageRows = filtered.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE);

  if (!open) return null;

  const totalRevenue = filtered.reduce((sum, l) => sum + (Number(l.total) || 0), 0);

  const handleExport = () => {
    const rows = [
      [
        "Customer",
        "Phone",
        "Order ID",
        "Abandoned Cart Lead ID",
        "Order Date",
        "Order Price",
        "Shipment Status",
        "Matched Shipment",
        "Match status",
        "Matched Order ID",
        "Campaign",
        "Ad Set",
        "Ad",
        "Revenue",
      ],
      ...filtered.map((l) => [
        l.fullName || "",
        l.phone || "",
        l.orderId || l.externalOrderId || "",
        l.trafleadLeadId || "",
        l.orderDateIst || "",
        l.total ?? "",
        l.matchedShipmentStatus || "",
        l.matchedShipmentFound ? "Found" : "Not Found",
        matchMethodLabel(l.matchMethod),
        l.matchedOrderId || "",
        l.campaign || "",
        l.sub1 || "",
        l.sub2 || "",
        l.total ?? "",
      ]),
    ];
    downloadCsv(`abandoned-cart-delivered-revenue_${since}_to_${until}.csv`, rows);
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between p-5 pb-3">
          <div>
            <div className="font-display font-semibold text-sm text-slate-800">Abandoned Cart — Delivered Revenue</div>
            <div className="text-xs text-slate-400 mt-0.5">
              {since === until ? since : `${since} to ${until}`} · orders placed in this window whose phone-matched shipment currently
              reads Delivered · {formatNumber(filtered.length)} order{filtered.length === 1 ? "" : "s"} · {currency(totalRevenue)}
            </div>
            {truncated && (
              <div className="text-[11px] text-amber-600 mt-0.5">
                Showing the first 1,000 delivered orders for this range — narrow the date range to see the rest.
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
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-2">
              <Inbox size={22} />
              <div className="text-xs">No delivered Abandoned Cart orders for this range.</div>
            </div>
          ) : (
            <table className="table" style={{ tableLayout: "fixed", width: "max-content", minWidth: "100%" }}>
              <thead>
                <tr>
                  {[
                    "Customer",
                    "Phone",
                    "Order ID",
                    "Lead ID",
                    "Order Date",
                    "Order Price",
                    "Shipment Status",
                    "Matched Shipment",
                    "Match status",
                    "Campaign",
                    "Ad Set",
                    "Ad",
                    "Revenue",
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
                    <td className="text-slate-400 text-[11px]">{l.trafleadLeadId || "—"}</td>
                    <td className="text-slate-500 whitespace-nowrap">{l.orderDateIst || "—"}</td>
                    <td className="text-slate-600">{currency(l.total)}</td>
                    <td className="text-slate-600">{shipmentStatusLabel(l.matchedShipmentStatus)}</td>
                    <td>
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium border ${
                          l.matchedShipmentFound
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                            : "bg-slate-100 text-slate-500 border-slate-200"
                        }`}
                      >
                        {l.matchedShipmentFound ? "Found" : "Not Found"}
                      </span>
                      {l.matchedCandidateCount > 1 && (
                        <div className="text-[10px] text-amber-600 mt-0.5">{l.matchedCandidateCount} candidates for this phone</div>
                      )}
                    </td>
                    <td className="text-slate-500 whitespace-nowrap">{matchMethodLabel(l.matchMethod)}</td>
                    <td className="text-slate-500">{l.campaign || "—"}</td>
                    <td className="text-slate-400">{l.sub1 || "—"}</td>
                    <td className="text-slate-400">{l.sub2 || "—"}</td>
                    <td className="font-semibold text-emerald-700">{currency(l.total)}</td>
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
          Shipment Status / Matched Shipment come from searching Traflead's shipped leads by this customer's phone number — not
          necessarily the same Traflead Lead record this order itself is. Ad Set / Ad show Traflead's own sub1/sub2 attribution
          fields — Traflead doesn't track a separate Meta Ad Set/Ad ID, so these are shown as Traflead has them rather than guessed at.
        </div>
      </div>
    </div>
  );
}
