import { Children, cloneElement, isValidElement, useMemo, useState } from "react";
import { HelpCircle, Inbox, Search } from "lucide-react";
import { ResponsiveContainer, Tooltip } from "recharts";
import { useColumnPrefs } from "../../lib/useColumnPrefs";
import ColumnSettingsMenu from "../ColumnSettingsMenu";

// ────────────────────────────────────────────────────────────────
// Phase 6 — shared chart chrome. Every chart in the Analytics page
// (Revenue, Time, Product, Customer, Geographic, Payment, Delivery
// sections) is wrapped in <ChartCard> so loading/empty states, section
// headings, and metric-explainer tooltips look and behave identically
// everywhere, and every actual chart sits in <ResponsiveContainer> so
// it resizes correctly instead of a fixed pixel size.
// ────────────────────────────────────────────────────────────────

// A small, consistent hex palette mirroring the app's existing Tailwind
// accent hues (indigo/violet/emerald/amber/rose/sky/slate — same set
// KPI cards and drawers already use) — recharts needs real color
// values, not Tailwind class names.
export const CHART_COLORS = ["#6366f1", "#8b5cf6", "#10b981", "#f59e0b", "#f43f5e", "#0ea5e9", "#94a3b8", "#ec4899"];

export function ChartCard({ title, tip, actions, height = 280, loading, empty, emptyMessage, children }) {
  return (
    <div className="card">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-1.5">
          <h3 className="font-display font-semibold text-sm text-slate-700">{title}</h3>
          {tip && (
            <span className="text-slate-300 hover:text-slate-400 cursor-help" title={tip}>
              <HelpCircle size={13} />
            </span>
          )}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>

      {loading ? (
        <div className="animate-pulse bg-slate-100 rounded-xl" style={{ height }} />
      ) : empty ? (
        <div className="flex flex-col items-center justify-center text-center" style={{ height }}>
          <span className="flex items-center justify-center w-10 h-10 rounded-2xl bg-slate-100 text-slate-400 mb-2.5">
            <Inbox size={18} />
          </span>
          <div className="text-sm text-slate-400 max-w-xs">{emptyMessage || "No data for this range yet."}</div>
        </div>
      ) : (
        <div style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            {children}
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

export function ChartTooltip({ active, payload, label, formatter }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-lg px-3 py-2 text-xs">
      {label && <div className="font-medium text-slate-700 mb-1">{label}</div>}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-1.5 text-slate-500">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color || p.fill }} />
          {p.name}: <span className="font-medium text-slate-700">{formatter ? formatter(p.value, p.name) : p.value}</span>
        </div>
      ))}
    </div>
  );
}

// Thin, pre-styled wrapper so every chart's tooltip looks the same
// without every section re-implementing <Tooltip content={...}>.
export function StyledTooltip(props) {
  return <Tooltip content={<ChartTooltip {...props} />} />;
}

export function SectionHeading({ icon: Icon, title, subtitle }) {
  return (
    <div className="flex items-center gap-2.5 mb-1">
      {Icon && (
        <span className="flex items-center justify-center w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600">
          <Icon size={16} />
        </span>
      )}
      <div>
        <h2 className="font-display font-bold text-slate-800 leading-tight">{title}</h2>
        {subtitle && <p className="text-xs text-slate-400">{subtitle}</p>}
      </div>
    </div>
  );
}

// Recursively flattens a React node tree down to its visible text, so
// the search box below can filter rows without every caller needing to
// hand Leaderboard a separate plain-text copy of each cell.
function nodeText(node) {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join(" ");
  if (isValidElement(node)) return nodeText(node.props?.children);
  return "";
}

// Phase 10 — every Analytics leaderboard (Campaign/Customer/Geography/
// Product sections) renders through this one shared component, so
// upgrading it here adds column visibility + drag-reorder + Reset
// Columns + search to all of them at once, without touching any of
// those section files' own renderRow/columns definitions.
//
// Reordering/hiding columns works generically because every renderRow
// here already returns a plain `<tr>...N <td>s...</tr>` aligned 1:1
// with the `columns` label array (true for every current caller) —
// cloneElement swaps in just the visible/reordered `<td>` subset while
// preserving the row's own key/className/onClick untouched.
//
// Deliberately NOT adding generic click-to-sort here: these are
// curated "Top N by <metric>" boards (already sorted server/client-
// side by the metric the board is named after), not general-purpose
// grids — re-sorting "Highest ROAS" by an arbitrary column would
// undercut the board's own point. Pagination is similarly moot (every
// caller already caps these at ~8-9 rows). Search is still genuinely
// useful even at that size, so it's included.
export function Leaderboard({ title, tip, rows, renderRow, columns, emptyMessage, actions }) {
  const [search, setSearch] = useState("");

  const colDefs = useMemo(() => columns.map((label, i) => ({ key: `col-${i}`, label })), [columns]);
  const tableId = `analyticsLeaderboard.${title}`;
  const { orderedColumns, allColumnsOrdered, hidden, toggleHidden, reorder, reset } = useColumnPrefs(tableId, colDefs, []);
  const visibleIndexes = useMemo(() => orderedColumns.map((c) => Number(c.key.slice(4))), [orderedColumns]);

  const renderedRows = useMemo(() => rows.map((r) => renderRow(r)), [rows, renderRow]);

  const q = search.trim().toLowerCase();
  const filteredRows = q ? renderedRows.filter((el) => nodeText(el.props?.children).toLowerCase().includes(q)) : renderedRows;

  return (
    <div className="card p-0 overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-slate-100 flex-wrap">
        <div className="flex items-center gap-1.5">
          <h3 className="font-display font-semibold text-sm text-slate-700">{title}</h3>
          {tip && (
            <span className="text-slate-300 hover:text-slate-400 cursor-help" title={tip}>
              <HelpCircle size={13} />
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {rows.length > 0 && (
            <div className="relative">
              <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                className="input pl-6 !py-1 !text-[11px] w-32"
                placeholder="Search…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          )}
          <ColumnSettingsMenu columns={allColumnsOrdered} hidden={hidden} toggleHidden={toggleHidden} reorder={reorder} reset={reset} align="right" />
          {actions}
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-center px-4">
          <span className="flex items-center justify-center w-10 h-10 rounded-2xl bg-slate-100 text-slate-400 mb-2.5">
            <Inbox size={18} />
          </span>
          <div className="text-sm text-slate-400">{emptyMessage || "No data for this range yet."}</div>
        </div>
      ) : filteredRows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-center px-4">
          <div className="text-sm text-slate-400">No rows match your search.</div>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                {visibleIndexes.map((i) => (
                  <th key={i}>{columns[i]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((rowEl) => {
                const cells = Children.toArray(rowEl.props?.children);
                return cloneElement(rowEl, undefined, ...visibleIndexes.map((i) => cells[i]));
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
