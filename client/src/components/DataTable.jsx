import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Search, Download, Inbox } from "lucide-react";
import { usePreferences } from "../lib/PreferencesContext";
import { useColumnPrefs } from "../lib/useColumnPrefs";
import ColumnSettingsMenu from "./ColumnSettingsMenu";

// ────────────────────────────────────────────────────────────────
// Phase 7 — reusable DataTable: sorting, column visibility, column
// resizing, sticky header, optional sticky first column, pagination
// (default page size from Settings' "Rows per page"), search, and CSV
// export, with per-table preferences (visible columns, widths, sort,
// page size) remembered in localStorage under its own `tableId`.
//
// Deliberately NOT retrofitted onto Dashboard's campaign/order tables,
// CampaignDrawer's orders table, OrderDrawer's history/products tables,
// or the Analytics sections' tables — those are Phase 1–6 surfaces with
// their own already-working search/sort/filter/drill-down logic
// tightly wired to CampaignDrawer/OrderDrawer/live-sync, and the brief
// for this phase is explicit that none of that may change. This
// component is the new, genuinely reusable primitive going forward;
// it's applied to this phase's own new pages (Favorites, Activity Log)
// as the first real usage, and is available for any future page
// without touching a single line of earlier phases' tables.
// ────────────────────────────────────────────────────────────────

function toCsvValue(v) {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function downloadCsv(filename, rows) {
  const csv = rows.map((r) => r.map(toCsvValue).join(",")).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function loadTablePrefs(tableId) {
  try {
    const raw = localStorage.getItem(`datatable.${tableId}.v1`);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
function saveTablePrefs(tableId, prefs) {
  try {
    localStorage.setItem(`datatable.${tableId}.v1`, JSON.stringify(prefs));
  } catch {
    // storage unavailable — table just won't remember prefs across reloads
  }
}

export default function DataTable({
  tableId,
  columns,
  data,
  searchKeys,
  onRowClick,
  rowKey = (row, i) => row.id ?? i,
  exportFilename,
  stickyFirstColumn = false,
  emptyMessage = "No data to show.",
}) {
  const { prefs } = usePreferences();
  const saved = useMemo(() => loadTablePrefs(tableId), [tableId]);

  const [search, setSearch] = useState("");
  const [sortConfig, setSortConfig] = useState(saved.sortConfig || { key: null, direction: "asc" });
  const [widths, setWidths] = useState(saved.widths || {});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(saved.pageSize || prefs.tablePageSize || 10);
  const resizingRef = useRef(null);

  // Phase 10 — column visibility/order/reset now lives in the shared
  // useColumnPrefs hook (its own localStorage entry, keyed by tableId)
  // instead of this component's own hiddenCols state, so every table
  // built on DataTable automatically gets drag-to-reorder + Reset
  // Columns for free, with the same storage schema every other
  // retrofitted table in this phase uses.
  const { orderedColumns: visibleColumns, allColumnsOrdered, hidden, toggleHidden, reorder, reset } = useColumnPrefs(tableId, columns);

  useEffect(() => {
    saveTablePrefs(tableId, { sortConfig, widths, pageSize });
  }, [tableId, sortConfig, widths, pageSize]);

  useEffect(() => setPage(1), [search, sortConfig, pageSize]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return data;
    const keys = searchKeys || columns.map((c) => c.key);
    return data.filter((row) => keys.some((k) => String(row[k] ?? "").toLowerCase().includes(q)));
  }, [data, search, searchKeys, columns]);

  const sorted = useMemo(() => {
    if (!sortConfig.key) return filtered;
    const col = columns.find((c) => c.key === sortConfig.key);
    const list = [...filtered];
    list.sort((a, b) => {
      let x = col?.sortValue ? col.sortValue(a) : a[sortConfig.key];
      let y = col?.sortValue ? col.sortValue(b) : b[sortConfig.key];
      if (typeof x === "string") {
        x = x.toLowerCase();
        y = y.toLowerCase();
      }
      x = x ?? "";
      y = y ?? "";
      if (x < y) return sortConfig.direction === "asc" ? -1 : 1;
      if (x > y) return sortConfig.direction === "asc" ? 1 : -1;
      return 0;
    });
    return list;
  }, [filtered, sortConfig, columns]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const paged = useMemo(() => {
    const start = (page - 1) * pageSize;
    return sorted.slice(start, start + pageSize);
  }, [sorted, page, pageSize]);

  const handleSort = (key) => setSortConfig((prev) => ({ key, direction: prev.key === key && prev.direction === "asc" ? "desc" : "asc" }));
  const arrow = (key) => (sortConfig.key !== key ? "" : sortConfig.direction === "asc" ? " ↑" : " ↓");

  const startResize = (e, key) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = widths[key] || e.currentTarget.parentElement.offsetWidth;
    resizingRef.current = { key, startX, startWidth };
    const onMove = (ev) => {
      if (!resizingRef.current) return;
      const delta = ev.clientX - resizingRef.current.startX;
      setWidths((prev) => ({ ...prev, [resizingRef.current.key]: Math.max(60, resizingRef.current.startWidth + delta) }));
    };
    const onUp = () => {
      resizingRef.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const handleExport = () => {
    const rows = [visibleColumns.map((c) => c.label), ...sorted.map((row) => visibleColumns.map((c) => (c.csvValue ? c.csvValue(row) : row[c.key])))];
    downloadCsv(exportFilename || `${tableId}.csv`, rows);
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="input pl-7 !py-1.5 !text-xs" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <ColumnSettingsMenu columns={allColumnsOrdered} hidden={hidden} toggleHidden={toggleHidden} reorder={reorder} reset={reset} />
        <button type="button" className="btn btn-secondary btn-sm" onClick={handleExport}>
          <Download size={13} /> Export CSV
        </button>
      </div>

      <div className="card p-0 overflow-auto max-h-[520px]">
        <table className="table" style={{ tableLayout: "fixed", width: "max-content", minWidth: "100%" }}>
          <thead className="sticky top-0 z-[2]">
            <tr>
              {visibleColumns.map((c, i) => (
                <th
                  key={c.key}
                  className={`relative select-none ${c.sortable !== false ? "cursor-pointer" : ""} ${
                    stickyFirstColumn && i === 0 ? "sticky left-0 z-[3] bg-slate-50" : ""
                  }`}
                  style={{ width: widths[c.key] || c.defaultWidth || undefined }}
                  onClick={() => c.sortable !== false && handleSort(c.key)}
                >
                  {c.label}
                  {c.sortable !== false ? arrow(c.key) : ""}
                  <span
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      startResize(e, c.key);
                    }}
                    className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-slate-300"
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paged.length === 0 ? (
              <tr>
                <td colSpan={visibleColumns.length} className="text-center py-10">
                  <div className="flex flex-col items-center gap-2 text-slate-400">
                    <Inbox size={20} />
                    <span className="text-sm">{emptyMessage}</span>
                  </div>
                </td>
              </tr>
            ) : (
              paged.map((row, ri) => (
                <tr key={rowKey(row, ri)} className={onRowClick ? "cursor-pointer" : ""} onClick={() => onRowClick?.(row)}>
                  {visibleColumns.map((c, i) => (
                    <td key={c.key} className={stickyFirstColumn && i === 0 ? "sticky left-0 z-[1] bg-white" : ""}>
                      {c.render ? c.render(row) : row[c.key]}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between px-1 py-3 text-xs text-slate-500">
        <div className="flex items-center gap-2">
          <span>
            Page {page} of {totalPages} · {sorted.length} row{sorted.length === 1 ? "" : "s"}
          </span>
          <select className="input !py-1 !text-xs w-auto" value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
            {[10, 20, 50, 100].map((n) => (
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
          <button
            type="button"
            className="btn btn-secondary btn-sm !px-2"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            <ChevronRight size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}
