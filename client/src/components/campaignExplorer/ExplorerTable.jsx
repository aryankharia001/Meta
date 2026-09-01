import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, ChevronLeft, Columns3, GripVertical, Pin, PinOff, Download, RotateCcw } from "lucide-react";
import { ALL_COLUMNS, DEFAULT_HIDDEN } from "../../lib/campaignExplorerColumns";
import ExpandedRowContent from "./ExpandedRowContent";
import { useColumnPrefs } from "../../lib/useColumnPrefs";
import { LiveIndicator, RoasValue, StatusPill, BudgetCell, BidCapCell } from "../CampaignCells";

// ────────────────────────────────────────────────────────────────
// Phase 8 — Campaign Explorer's dense data table. Purpose-built rather
// than a modification of Phase 7's shared DataTable.jsx (see the task
// list note in this phase's summary for why): Explorer needs row
// selection, expandable rows, AND true multi-column pinning at once,
// which would have meant substantially complicating a component two
// other pages already depend on. Sorting/resizing/visibility/sticky-
// header/remembered-prefs here intentionally mirror DataTable.jsx's own
// implementation so the UX feels identical across the app, just
// re-implemented against this table's extra row-level features.
//
// Sorting, resizing, visibility, pinning and pagination all operate on
// whatever `campaigns` array the parent page hands in — CampaignExplorerPage
// owns filtering/search (so it can drive the "N campaigns match" count
// and CSV export from the same filtered set), this component only ever
// arranges and paginates rows it's given.
// ────────────────────────────────────────────────────────────────

const STORAGE_KEY = "campaignExplorerTable.v1";
const PAGE_SIZE_OPTIONS = [25, 50, 100, 200];

function loadPrefs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
function savePrefs(prefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // storage unavailable — table just won't remember prefs across reloads
  }
}

export default function ExplorerTable({ campaigns, tokenId, since, until, onOpenCampaign, selectedIds, onToggleSelect, onToggleSelectAll }) {
  const saved = useMemo(loadPrefs, []);

  const [sortConfig, setSortConfig] = useState(saved.sortConfig || { key: "spend", direction: "desc" });
  const [pinnedCols, setPinnedCols] = useState(new Set(saved.pinnedCols || ["campaignName"]));
  const [widths, setWidths] = useState(saved.widths || {});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(saved.pageSize || 50);
  const [columnsMenuOpen, setColumnsMenuOpen] = useState(false);
  const [dragKey, setDragKey] = useState(null);
  const [expandedIds, setExpandedIds] = useState(new Set());
  const menuRef = useRef(null);
  const resizingRef = useRef(null);

  // Phase 10 — visibility + order now live in the shared useColumnPrefs
  // hook (its own `columnPrefs.campaignExplorerColumns.v1` storage
  // entry), adding drag-to-reorder + Reset Columns on top of what this
  // table already had. Pinning stays as ExplorerTable's own concern
  // (true sticky-left pinning is specific to this table, not something
  // every other retrofitted table needs) — kept in its own local
  // storage exactly as before, just no longer sharing a payload with
  // hiddenCols.
  const { orderedColumns: orderedVisible, allColumnsOrdered, hidden: hiddenCols, toggleHidden: toggleColumn, reorder, reset: resetColumns } = useColumnPrefs(
    "campaignExplorerColumns",
    ALL_COLUMNS,
    [...DEFAULT_HIDDEN]
  );

  useEffect(() => {
    savePrefs({ sortConfig, pinnedCols: [...pinnedCols], widths, pageSize });
  }, [sortConfig, pinnedCols, widths, pageSize]);

  useEffect(() => {
    const onClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setColumnsMenuOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  useEffect(() => setPage(1), [campaigns, pageSize]);

  const visibleColumns = useMemo(() => {
    // Pinned columns always render first, in their own relative order;
    // everything else keeps the user's drag-reordered sequence.
    const pinned = orderedVisible.filter((c) => pinnedCols.has(c.key));
    const rest = orderedVisible.filter((c) => !pinnedCols.has(c.key));
    return [...pinned, ...rest];
  }, [orderedVisible, pinnedCols]);

  // Cumulative left offsets for sticky pinned columns — the select +
  // expand toggle columns are always pinned first (44px each).
  const pinnedLeftOffsets = useMemo(() => {
    const offsets = {};
    let left = 44 + 32; // select checkbox + expand chevron columns
    visibleColumns.forEach((c) => {
      if (!pinnedCols.has(c.key)) return;
      offsets[c.key] = left;
      left += widths[c.key] || c.defaultWidth || 120;
    });
    return offsets;
  }, [visibleColumns, pinnedCols, widths]);

  const sorted = useMemo(() => {
    if (!sortConfig.key) return campaigns;
    const col = ALL_COLUMNS.find((c) => c.key === sortConfig.key);
    const list = [...campaigns];
    list.sort((a, b) => {
      let x = a[sortConfig.key];
      let y = b[sortConfig.key];
      if (typeof x === "string") {
        x = x.toLowerCase();
        y = (y || "").toLowerCase();
      }
      x = x ?? (typeof x === "string" ? "" : -Infinity);
      y = y ?? (typeof y === "string" ? "" : -Infinity);
      if (x < y) return sortConfig.direction === "asc" ? -1 : 1;
      if (x > y) return sortConfig.direction === "asc" ? 1 : -1;
      return 0;
    });
    return list;
  }, [campaigns, sortConfig]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const paged = useMemo(() => sorted.slice((page - 1) * pageSize, page * pageSize), [sorted, page, pageSize]);

  const handleSort = (key) => setSortConfig((prev) => ({ key, direction: prev.key === key && prev.direction === "asc" ? "desc" : "asc" }));
  const arrow = (key) => (sortConfig.key !== key ? "" : sortConfig.direction === "asc" ? " ↑" : " ↓");

  const togglePin = (key) =>
    setPinnedCols((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const toggleExpand = (campaignId) =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(campaignId)) next.delete(campaignId);
      else next.add(campaignId);
      return next;
    });

  const startResize = (e, key) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = widths[key] || ALL_COLUMNS.find((c) => c.key === key)?.defaultWidth || 120;
    resizingRef.current = { key, startX, startWidth };
    const onMove = (ev) => {
      if (!resizingRef.current) return;
      const delta = ev.clientX - resizingRef.current.startX;
      setWidths((prev) => ({ ...prev, [resizingRef.current.key]: Math.max(70, resizingRef.current.startWidth + delta) }));
    };
    const onUp = () => {
      resizingRef.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const allOnPageSelected = paged.length > 0 && paged.every((c) => selectedIds.has(c.campaignId));

  // Phase 10 — group allColumnsOrdered (the user's current drag order)
  // by .group on the fly, rather than iterating the static
  // COLUMN_GROUPS constant, so the menu reflects reordering even when
  // columns have been dragged across group boundaries.
  const groupedForMenu = useMemo(() => {
    const groups = [];
    const byGroup = new Map();
    allColumnsOrdered.forEach((c) => {
      const g = c.group || "Other";
      if (!byGroup.has(g)) {
        byGroup.set(g, { group: g, items: [] });
        groups.push(byGroup.get(g));
      }
      byGroup.get(g).items.push(c);
    });
    return groups;
  }, [allColumnsOrdered]);

  return (
    <div>
      <div className="flex items-center justify-end mb-2">
        <div className="relative" ref={menuRef}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setColumnsMenuOpen((o) => !o)}>
            <Columns3 size={13} /> Columns
          </button>
          {columnsMenuOpen && (
            <div className="absolute right-0 mt-1 w-72 bg-white border border-slate-200 rounded-lg shadow-lg z-30 py-1.5 max-h-96 overflow-y-auto">
              <p className="px-3 pb-1.5 text-[10px] text-slate-400">Drag to reorder · checkbox to show/hide · pin to sticky-left.</p>
              {groupedForMenu.map((g) => (
                <div key={g.group} className="mb-1">
                  <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{g.group}</div>
                  {g.items.map((c) => {
                    const isHidden = hiddenCols.includes(c.key);
                    return (
                      <div
                        key={c.key}
                        draggable
                        onDragStart={() => setDragKey(c.key)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault();
                          if (dragKey && dragKey !== c.key) reorder(dragKey, c.key);
                          setDragKey(null);
                        }}
                        onDragEnd={() => setDragKey(null)}
                        className={`flex items-center gap-2 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50 cursor-grab active:cursor-grabbing ${
                          dragKey === c.key ? "opacity-40" : ""
                        } ${isHidden ? "opacity-50" : ""}`}
                      >
                        <GripVertical size={11} className="text-slate-300 shrink-0" />
                        <input type="checkbox" checked={!isHidden} onChange={() => toggleColumn(c.key)} className="shrink-0" />
                        <span className="flex-1 truncate">{c.label}</span>
                        <button type="button" onClick={() => togglePin(c.key)} className={pinnedCols.has(c.key) ? "text-indigo-500" : "text-slate-300 hover:text-slate-500"} title="Pin column">
                          {pinnedCols.has(c.key) ? <Pin size={11} fill="currentColor" /> : <PinOff size={11} />}
                        </button>
                      </div>
                    );
                  })}
                </div>
              ))}
              <div className="px-3 pt-1.5 mt-1 border-t border-slate-100">
                <button type="button" className="btn btn-secondary btn-sm w-full !justify-center" onClick={resetColumns}>
                  <RotateCcw size={12} /> Reset Columns
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Phase 14 §11/§12 — sticky-header/sticky-column layering fix.
          Root cause #1: only the <thead> itself had `sticky top-0`, and
          pinned header <th>s relied on inheriting that vertical
          stickiness from their parent while carrying their OWN higher
          z-index (30) for horizontal pinning — a fragile split that, in
          some browsers/zoom levels, let a pinned body <td> (also
          `position: sticky`, its own stacking context) paint over the
          header edge as it scrolled past. Fix: every header <th> now
          declares `sticky top-0` itself (not just the <thead> wrapper),
          so vertical stickiness never depends on thead's own sticky
          support, and there are exactly two z tiers everywhere in this
          table — header cells (20) and pinned body cells (10) — instead
          of a third, higher one (30) that only pinned header cells had.

          Root cause #2 (found after the above): the <thead> was left
          with its OWN redundant `sticky top-0` even after every <th>
          started declaring the same thing itself. A table-header-group
          element and its cells BOTH being independently sticky on the
          same axis is a well-known trigger for browsers to miscompute
          the *other* axis's sticky offset on a doubly-sticky corner
          cell — in practice this showed up as the pinned Campaign
          column's header text scrolling away horizontally while the
          body column (whose <tr> is not itself sticky) stayed pinned
          correctly. Fix: <thead> no longer declares its own
          position/sticky at all — vertical stickiness lives entirely on
          each <th>, which was already the source of truth. */}
      <div className="card p-0 overflow-auto max-h-[70vh]">
        <table className="table" style={{ tableLayout: "fixed", width: "max-content", minWidth: "100%" }}>
          <thead>
            <tr>
              <th className="sticky top-0 left-0 z-20 bg-slate-50 !w-11" style={{ width: 44 }}>
                <input type="checkbox" checked={allOnPageSelected} onChange={() => onToggleSelectAll(paged.map((c) => c.campaignId))} />
              </th>
              <th className="sticky top-0 z-20 bg-slate-50" style={{ left: 44, width: 32 }} />
              {visibleColumns.map((c) => (
                <th
                  key={c.key}
                  className={`relative select-none cursor-pointer sticky top-0 z-20 bg-slate-50 ${c.align === "right" ? "num" : c.align === "center" ? "center" : ""} ${
                    pinnedCols.has(c.key) ? "shadow-[2px_0_0_0_rgba(0,0,0,0.04)]" : ""
                  }`}
                  style={{ width: widths[c.key] || c.defaultWidth, left: pinnedCols.has(c.key) ? pinnedLeftOffsets[c.key] : undefined }}
                  onClick={() => handleSort(c.key)}
                  title={c.group}
                >
                  {c.label}
                  {arrow(c.key)}
                  <span onMouseDown={(e) => startResize(e, c.key)} className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-slate-300" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paged.length === 0 ? (
              <tr>
                <td colSpan={visibleColumns.length + 2} className="text-center py-14 text-sm text-slate-400">
                  No campaigns match your filters.
                </td>
              </tr>
            ) : (
              paged.map((c) => {
                const expanded = expandedIds.has(c.campaignId);
                return (
                  <Fragment key={c.campaignId}>
                    <tr className="cursor-pointer hover:bg-slate-50/70" onClick={() => onOpenCampaign(c)}>
                      <td className="sticky left-0 z-10 bg-white" style={{ width: 44 }} onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={selectedIds.has(c.campaignId)} onChange={() => onToggleSelect(c.campaignId)} />
                      </td>
                      <td className="sticky z-10 bg-white" style={{ left: 44, width: 32 }} onClick={(e) => e.stopPropagation()}>
                        <button type="button" className="text-slate-400 hover:text-slate-600" onClick={() => toggleExpand(c.campaignId)}>
                          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>
                      </td>
                      {visibleColumns.map((col) => {
                        const alignClass = col.align === "right" ? "num" : col.align === "center" ? "center" : "";
                        const pinClass = pinnedCols.has(col.key) ? "sticky z-10 bg-white shadow-[2px_0_0_0_rgba(0,0,0,0.04)]" : "";
                        // Explicit width on every body cell (not just pinned
                        // ones) — previously only the <th> had a width, so
                        // a long campaign name could grow the <td> wider
                        // than its header, both overflowing the intended
                        // column width and desyncing the pinned cell's box
                        // from its header counterpart (the visual cause of
                        // the header appearing to sit "behind" the column
                        // while scrolling).
                        const style = {
                          left: pinnedCols.has(col.key) ? pinnedLeftOffsets[col.key] : undefined,
                          width: widths[col.key] || col.defaultWidth,
                        };

                        if (col.key === "campaignName") {
                          return (
                            <td key={col.key} className={pinClass} style={style}>
                              <div className="flex items-center gap-2 min-w-0">
                                <LiveIndicator campaign={c} />
                                <span className="campaign-name truncate max-w-[190px]">{c.campaignName}</span>
                                {/* Campaign History Phase §9/§10 — only ever
                                    present when the page fetched with
                                    includeNoLongerReturned=true; never
                                    deleted, just flagged. */}
                                {c.isDeleted && (
                                  <span className="badge badge-amber shrink-0" title="Meta no longer returns this campaign — its history, orders, and identity are preserved permanently">
                                    No Longer Returned
                                  </span>
                                )}
                              </div>
                            </td>
                          );
                        }
                        if (col.key === "roas") {
                          return (
                            <td key={col.key} className={`num ${pinClass}`} style={style}>
                              <RoasValue roas={c.roas} />
                            </td>
                          );
                        }
                        if (col.key === "status") {
                          return (
                            <td key={col.key} className={`center ${pinClass}`} style={style}>
                              <StatusPill status={c.effectiveStatus || c.status} />
                            </td>
                          );
                        }
                        // Phase 36 §4 — Campaign Budget Fallback. The shared
                        // column list's own render() stays plain-text (CSV
                        // export reuses it), so the "Ad Set Budget Applied"
                        // note is added here instead, same pattern as roas/
                        // status above.
                        if (col.key === "budget") {
                          return (
                            <td key={col.key} className={`${alignClass} ${pinClass}`} style={style}>
                              <BudgetCell budget={c.budget} budgetType={c.budgetType} budgetSource={c.budgetSource} />
                            </td>
                          );
                        }
                        // Phase 38 — Campaign Bid Cap Fallback to Ad Set,
                        // same "rich JSX in the table, plain text for
                        // CSV" split as budget just above.
                        if (col.key === "bidCap") {
                          return (
                            <td key={col.key} className={`${alignClass} ${pinClass}`} style={style}>
                              <BidCapCell bidCapMin={c.bidCapMin} bidCapMax={c.bidCapMax} bidCapSource={c.bidCapSource} />
                            </td>
                          );
                        }
                        return (
                          <td key={col.key} className={`${alignClass} ${pinClass}`} style={style}>
                            {col.render ? col.render(c) : c[col.key]}
                          </td>
                        );
                      })}
                    </tr>
                    {expanded && (
                      <tr>
                        <td colSpan={visibleColumns.length + 2} className="bg-slate-50 p-0">
                          <ExpandedRowContent campaign={c} tokenId={tokenId} since={since} until={until} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between px-1 py-3 text-xs text-slate-500">
        <div className="flex items-center gap-2">
          <span>
            Page {page} of {totalPages} · {sorted.length} campaign{sorted.length === 1 ? "" : "s"}
          </span>
          <select className="input !py-1 !text-xs w-auto" value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
            {PAGE_SIZE_OPTIONS.map((n) => (
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
    </div>
  );
}
