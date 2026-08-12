import { Fragment, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Search, Download, Rows3, ListTree, Inbox } from "lucide-react";
import { DAILY_COLUMNS, DAILY_DEFAULT_HIDDEN } from "../../lib/dailyColumns";
import { useColumnPrefs } from "../../lib/useColumnPrefs";
import ColumnSettingsMenu from "../ColumnSettingsMenu";
import { downloadCsv } from "../../lib/csv";
import { currency, number, multiplier } from "../../lib/format";
import { formatDayLabel } from "../../lib/dateIst";

// ────────────────────────────────────────────────────────────────
// Phase 10 — the Daily page's main table. Two view modes over the same
// underlying `days` data (from GET /api/daily/:tokenId — already
// grouped by calendar day server-side, see dailyReports.js):
//
//   "grouped" (default) — one row per day (rollup totals), expandable
//   to reveal that day's campaigns — satisfies the spec's primary
//   "10 August → Campaign X → ..." example and the "expand a date and
//   see all campaigns running that day" requirement.
//
//   "flat" — every (day, campaign) pair as its own row, sortable and
//   searchable across the whole range — satisfies the spec's
//   alternative "campaign filter/search so users can quickly find a
//   specific campaign across all days" requirement.
//
// Column visibility/order/reset is shared between both modes via the
// same useColumnPrefs("dailyCampaigns", ...) instance, so customizing
// columns in one view is reflected in the other.
// ────────────────────────────────────────────────────────────────

// Generic comparator every sort here shares — string columns (date,
// campaignName, campaignId) compare case-insensitively, everything
// else compares numerically.
function compareRows(a, b, key, direction) {
  let x = a[key];
  let y = b[key];
  if (typeof x === "string" || typeof y === "string") {
    x = (x ?? "").toString().toLowerCase();
    y = (y ?? "").toString().toLowerCase();
  } else {
    x = Number(x || 0);
    y = Number(y || 0);
  }
  if (x < y) return direction === "asc" ? -1 : 1;
  if (x > y) return direction === "asc" ? 1 : -1;
  return 0;
}

// The outer "by day" rollup row's own sortable fields — everything
// here reads off `d.totals` (the per-day aggregate) except "date",
// which reads off `d.date` directly.
const DAY_ROLLUP_COLUMNS = [
  { key: "date", label: "Date", width: 140 },
  { key: "campaignCount", label: "Campaigns", width: 100 },
  { key: "spend", label: "Spend", width: 110 },
  { key: "orders", label: "Orders", width: 90 },
  { key: "revenue", label: "Revenue", width: 110 },
  { key: "roas", label: "ROAS", width: 90 },
  { key: "codOrders", label: "COD", width: 100 },
  { key: "prepaidOrders", label: "Prepaid", width: 100 },
];

export default function DailyTable({ days, onOpenRow }) {
  const [search, setSearch] = useState("");
  const [mode, setMode] = useState("grouped"); // "grouped" | "flat"
  const [expanded, setExpanded] = useState(new Set());
  // Sorts each (day, campaign) row — used by Flat view's rows AND, per
  // day, by the expandable campaign sub-tables in Grouped view (the
  // same column set describes both, so one sort config drives both).
  const [sortConfig, setSortConfig] = useState({ key: "date", direction: "desc" });
  // Sorts the outer day-rollup rows in Grouped view (Date/Campaigns/
  // Spend/Orders/Revenue/ROAS/COD/Prepaid) — a separate config since
  // those rows aggregate a whole day, not one campaign.
  const [daySortConfig, setDaySortConfig] = useState({ key: "date", direction: "desc" });

  const { orderedColumns, allColumnsOrdered, hidden, toggleHidden, reorder, reset } = useColumnPrefs(
    "dailyCampaigns",
    DAILY_COLUMNS,
    DAILY_DEFAULT_HIDDEN
  );

  const q = search.trim().toLowerCase();
  const matchesQuery = (row) => !q || (row.campaignName || "").toLowerCase().includes(q) || (row.campaignId || "").toLowerCase().includes(q);

  const filteredDays = useMemo(() => {
    if (!q) return days;
    return days.map((d) => ({ ...d, campaigns: d.campaigns.filter(matchesQuery) })).filter((d) => d.campaigns.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, q]);

  // Grouped view's outer rows, sorted by whichever rollup column was
  // clicked — each row keeps its own `campaigns` array untouched here;
  // that's sorted separately, per expanded day, below.
  const sortedGroupedDays = useMemo(() => {
    const list = [...filteredDays];
    list.sort((a, b) => {
      if (daySortConfig.key === "date") {
        return daySortConfig.direction === "asc" ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date);
      }
      return compareRows(a.totals, b.totals, daySortConfig.key, daySortConfig.direction);
    });
    return list;
  }, [filteredDays, daySortConfig]);

  const flatRows = useMemo(() => filteredDays.flatMap((d) => d.campaigns), [filteredDays]);

  const sortedFlatRows = useMemo(() => {
    const list = [...flatRows];
    list.sort((a, b) => compareRows(a, b, sortConfig.key, sortConfig.direction));
    return list;
  }, [flatRows, sortConfig]);

  const handleSort = (key) => setSortConfig((p) => ({ key, direction: p.key === key && p.direction === "asc" ? "desc" : "asc" }));
  const arrow = (key) => (sortConfig.key !== key ? "" : sortConfig.direction === "asc" ? " ↑" : " ↓");

  const handleDaySort = (key) => setDaySortConfig((p) => ({ key, direction: p.key === key && p.direction === "asc" ? "desc" : "asc" }));
  const dayArrow = (key) => (daySortConfig.key !== key ? "" : daySortConfig.direction === "asc" ? " ↑" : " ↓");

  const toggleExpand = (date) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });

  const handleExport = () => {
    const rows = [orderedColumns.map((c) => c.label), ...sortedFlatRows.map((r) => orderedColumns.map((c) => (c.csvValue ? c.csvValue(r) : rawValue(r, c.key))))];
    downloadCsv("daily-campaign-report.csv", rows);
  };

  const isEmpty = filteredDays.length === 0;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative flex-1 min-w-[220px] max-w-xs">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            className="input pl-7 !py-1.5 !text-xs"
            placeholder="Search campaign name or ID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
          <button
            type="button"
            onClick={() => setMode("grouped")}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
              mode === "grouped" ? "bg-white text-blue-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
            }`}
            title="Group rows by day, expandable to see campaigns"
          >
            <ListTree size={12} /> By Day
          </button>
          <button
            type="button"
            onClick={() => setMode("flat")}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
              mode === "flat" ? "bg-white text-blue-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
            }`}
            title="One row per day + campaign, sortable"
          >
            <Rows3 size={12} /> Flat
          </button>
        </div>

        <ColumnSettingsMenu columns={allColumnsOrdered} hidden={hidden} toggleHidden={toggleHidden} reorder={reorder} reset={reset} />

        <button type="button" className="btn btn-secondary btn-sm" onClick={handleExport} disabled={sortedFlatRows.length === 0}>
          <Download size={13} /> Export CSV
        </button>
      </div>

      <div className="card p-0 overflow-auto max-h-[65vh]">
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center py-14 text-center px-4">
            <span className="flex items-center justify-center w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 mb-3">
              <Inbox size={22} />
            </span>
            <div className="text-sm text-slate-400">
              {q ? "No campaigns match your search in this range." : "No campaign activity in this date range."}
            </div>
          </div>
        ) : mode === "grouped" ? (
          <GroupedView
            days={sortedGroupedDays}
            columns={orderedColumns}
            expanded={expanded}
            onToggleExpand={toggleExpand}
            onOpenRow={onOpenRow}
            daySortConfig={daySortConfig}
            onDaySort={handleDaySort}
            dayArrow={dayArrow}
            sortConfig={sortConfig}
            onSort={handleSort}
            arrow={arrow}
          />
        ) : (
          <FlatView rows={sortedFlatRows} columns={orderedColumns} sortConfig={sortConfig} onSort={handleSort} arrow={arrow} onOpenRow={onOpenRow} />
        )}
      </div>
    </div>
  );
}

// Raw (non-formatted) value for CSV export — falls back to the
// formatted render output if there's no obvious raw field, same
// tolerant approach DataTable.jsx's own CSV export uses.
function rawValue(row, key) {
  return row[key] ?? "";
}

function GroupedView({ days, columns, expanded, onToggleExpand, onOpenRow, daySortConfig, onDaySort, dayArrow, sortConfig, onSort, arrow }) {
  return (
    <table className="table" style={{ tableLayout: "fixed", width: "max-content", minWidth: "100%" }}>
      <thead className="sticky top-0 z-[2]">
        <tr>
          <th style={{ width: 32 }} />
          {DAY_ROLLUP_COLUMNS.map((c) => (
            <th
              key={c.key}
              className="cursor-pointer select-none hover:text-blue-600"
              style={{ width: c.width }}
              onClick={() => onDaySort(c.key)}
              title="Sort"
            >
              {c.label}
              {dayArrow(c.key)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {days.map((d) => {
          const isOpen = expanded.has(d.date);
          const sortedCampaigns = [...d.campaigns].sort((a, b) => compareRows(a, b, sortConfig.key, sortConfig.direction));
          return (
            <Fragment key={d.date}>
              <tr className="cursor-pointer bg-slate-50/60 hover:bg-slate-100/70 font-medium" onClick={() => onToggleExpand(d.date)}>
                <td className="text-slate-400">{isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
                <td className="text-slate-800">{formatDayLabel(d.date)}</td>
                <td>{number(d.totals.campaignCount)}</td>
                <td>{currency(d.totals.spend)}</td>
                <td>{number(d.totals.orders)}</td>
                <td>{currency(d.totals.revenue)}</td>
                <td className={`font-bold ${d.totals.roas >= 3 ? "text-emerald-600" : d.totals.roas >= 2 ? "text-amber-600" : "text-rose-600"}`}>
                  {multiplier(d.totals.roas)}
                </td>
                <td>{number(d.totals.codOrders)}</td>
                <td>{number(d.totals.prepaidOrders)}</td>
              </tr>
              {isOpen && (
                <tr>
                  <td colSpan={9} className="bg-slate-50 p-0">
                    <div className="overflow-auto">
                      <table className="table" style={{ tableLayout: "fixed", width: "max-content", minWidth: "100%" }}>
                        <thead>
                          <tr>
                            {columns.map((c) => (
                              <th
                                key={c.key}
                                className="cursor-pointer select-none hover:text-blue-600"
                                style={{ width: c.defaultWidth }}
                                onClick={() => onSort(c.key)}
                                title="Sort"
                              >
                                {c.label}
                                {arrow(c.key)}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {sortedCampaigns.map((row) => (
                            <tr
                              key={`${row.date}-${row.campaignId || "unmatched"}`}
                              className={`cursor-pointer ${row.isUnmatched ? "text-slate-500" : ""}`}
                              onClick={() => onOpenRow(row)}
                            >
                              {columns.map((c) => (
                                <td key={c.key}>{c.render ? c.render(row) : row[c.key]}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

function FlatView({ rows, columns, sortConfig, onSort, arrow, onOpenRow }) {
  return (
    <table className="table" style={{ tableLayout: "fixed", width: "max-content", minWidth: "100%" }}>
      <thead className="sticky top-0 z-[2]">
        <tr>
          {columns.map((c) => (
            <th
              key={c.key}
              className="cursor-pointer select-none hover:text-blue-600"
              style={{ width: c.defaultWidth }}
              onClick={() => onSort(c.key)}
              title="Sort"
            >
              {c.label}
              {arrow(c.key)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={`${row.date}-${row.campaignId || "unmatched"}`} className={`cursor-pointer ${row.isUnmatched ? "text-slate-500" : ""}`} onClick={() => onOpenRow(row)}>
            {columns.map((c) => (
              <td key={c.key}>{c.render ? c.render(row) : row[c.key]}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
