import { Fragment, useEffect, useMemo, useState } from "react";
import {
  Activity,
  RefreshCw,
  Star,
  FileText,
  Bookmark,
  Download,
  AlertTriangle,
  LogIn,
  LogOut,
  KeyRound,
  ShoppingCart,
  Megaphone,
  Users,
  Search,
  X,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { fetchActivityLog } from "../lib/api";
import { formatDateTime } from "../lib/format";

// ────────────────────────────────────────────────────────────────
// Phase 7 — Activity Log page (read-only view over /api/activity-log).
// Phase 14 §6–§8 — the backend route this page reads from now records
// Authentication/Meta/Orders/Campaigns/Users actions too (see
// server/routes/activityLog.js, auth.js, users.js, tokens.js) and
// supports search/date/user/action/entity filters — this page only
// adds the UI for those filters plus a click-to-expand detail row. It
// never decides what counts as "activity" itself, same as before.
// ────────────────────────────────────────────────────────────────

const TYPE_META = {
  sync: { icon: RefreshCw, accent: "bg-sky-50 text-sky-600" },
  favorite: { icon: Star, accent: "bg-amber-50 text-amber-600" },
  note: { icon: FileText, accent: "bg-indigo-50 text-indigo-600" },
  "saved-view": { icon: Bookmark, accent: "bg-violet-50 text-violet-600" },
  export: { icon: Download, accent: "bg-emerald-50 text-emerald-600" },
  auth_login: { icon: LogIn, accent: "bg-emerald-50 text-emerald-600" },
  auth_logout: { icon: LogOut, accent: "bg-slate-100 text-slate-500" },
  auth_failed_login: { icon: AlertTriangle, accent: "bg-rose-50 text-rose-600" },
  user_password_changed: { icon: KeyRound, accent: "bg-indigo-50 text-indigo-600" },
  meta_token_added: { icon: KeyRound, accent: "bg-sky-50 text-sky-600" },
  meta_token_updated: { icon: KeyRound, accent: "bg-sky-50 text-sky-600" },
  meta_token_deleted: { icon: KeyRound, accent: "bg-rose-50 text-rose-600" },
  order_opened: { icon: ShoppingCart, accent: "bg-sky-50 text-sky-600" },
  order_export: { icon: Download, accent: "bg-emerald-50 text-emerald-600" },
  campaign_opened: { icon: Megaphone, accent: "bg-indigo-50 text-indigo-600" },
  campaign_exported: { icon: Download, accent: "bg-emerald-50 text-emerald-600" },
  adset_opened: { icon: Megaphone, accent: "bg-indigo-50 text-indigo-600" },
  ad_opened: { icon: Megaphone, accent: "bg-indigo-50 text-indigo-600" },
  user_added: { icon: Users, accent: "bg-emerald-50 text-emerald-600" },
  user_removed: { icon: Users, accent: "bg-rose-50 text-rose-600" },
  user_enabled: { icon: Users, accent: "bg-emerald-50 text-emerald-600" },
  user_disabled: { icon: Users, accent: "bg-slate-100 text-slate-500" },
};
const DEFAULT_TYPE_META = { icon: Activity, accent: "bg-slate-100 text-slate-500" };

// A few keywords that should never render even if they somehow ended
// up in a meta blob — belt-and-suspenders on top of the backend never
// being given these values to store in the first place (see §7's
// "never log passwords/tokens/secrets" requirement).
const SENSITIVE_KEY_RE = /password|secret|token|apikey|api_key/i;

function sanitizeMeta(meta) {
  if (!meta || typeof meta !== "object") return {};
  return Object.fromEntries(Object.entries(meta).filter(([k]) => !SENSITIVE_KEY_RE.test(k)));
}

const EMPTY_FILTERS = { q: "", user: "", type: "", entityType: "", since: "", until: "" };

export default function ActivityLogPage() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [expandedId, setExpandedId] = useState(null);

  const load = (activeFilters = filters) => {
    setLoading(true);
    setError("");
    fetchActivityLog({ ...activeFilters, limit: 300 })
      .then((res) => setEntries(res.entries || []))
      .catch((err) => setError(err.message || "Failed to load activity log"))
      .finally(() => setLoading(false));
  };

  // Initial load only — filter changes are applied explicitly (Apply
  // button / Enter), not on every keystroke, to avoid hammering the
  // endpoint while typing a search term.
  useEffect(() => {
    load(EMPTY_FILTERS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Dropdown options for Action/User/Entity filters — derived from
  // whatever's currently loaded (simple, no extra endpoint needed) plus
  // a fixed baseline list so the dropdowns aren't empty on first paint.
  const knownTypes = useMemo(() => {
    const s = new Set(Object.keys(TYPE_META));
    entries.forEach((e) => e.type && s.add(e.type));
    return [...s].sort();
  }, [entries]);
  const knownUsers = useMemo(() => {
    const s = new Set();
    entries.forEach((e) => e.user && s.add(e.user));
    return [...s].sort();
  }, [entries]);
  const knownEntityTypes = useMemo(() => {
    const s = new Set();
    entries.forEach((e) => e.entityType && s.add(e.entityType));
    return [...s].sort();
  }, [entries]);

  const applyFilters = (e) => {
    e?.preventDefault?.();
    load(filters);
  };

  const clearFilters = () => {
    setFilters(EMPTY_FILTERS);
    load(EMPTY_FILTERS);
  };

  const hasActiveFilters = Object.values(filters).some(Boolean);

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-slate-700 to-slate-900 text-white shadow-md">
            <Activity size={18} />
          </span>
          <div>
            <h1 className="text-lg font-display font-bold text-slate-800 leading-tight">Activity Log</h1>
            <p className="text-xs text-slate-400">Recent actions across the app, most recent first</p>
          </div>
        </div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => load(filters)} disabled={loading}>
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      <form onSubmit={applyFilters} className="card flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-slate-500 flex-1 min-w-[180px]">
          Search
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-300" />
            <input
              type="text"
              className="input pl-7 w-full"
              placeholder="Message, user, action, entity ID…"
              value={filters.q}
              onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
            />
          </div>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-500">
          User
          <select
            className="input w-auto"
            value={filters.user}
            onChange={(e) => setFilters((f) => ({ ...f, user: e.target.value }))}
          >
            <option value="">All users</option>
            {knownUsers.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-500">
          Action
          <select
            className="input w-auto"
            value={filters.type}
            onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value }))}
          >
            <option value="">All actions</option>
            {knownTypes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-500">
          Entity
          <select
            className="input w-auto"
            value={filters.entityType}
            onChange={(e) => setFilters((f) => ({ ...f, entityType: e.target.value }))}
          >
            <option value="">All entities</option>
            {knownEntityTypes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-500">
          From
          <input
            type="date"
            className="input w-auto"
            value={filters.since}
            onChange={(e) => setFilters((f) => ({ ...f, since: e.target.value }))}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-500">
          To
          <input
            type="date"
            className="input w-auto"
            value={filters.until}
            onChange={(e) => setFilters((f) => ({ ...f, until: e.target.value }))}
          />
        </label>
        <button type="submit" className="btn btn-primary btn-sm">
          <Search size={13} /> Apply
        </button>
        {hasActiveFilters && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={clearFilters}>
            <X size={13} /> Clear
          </button>
        )}
      </form>

      {error && (
        <div className="card flex flex-col items-center justify-center py-10 text-center">
          <AlertTriangle size={22} className="text-rose-500 mb-2" />
          <div className="text-sm text-slate-500">{error}</div>
        </div>
      )}

      {!error && loading && entries.length === 0 && (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="card h-14 animate-pulse bg-slate-100" />
          ))}
        </div>
      )}

      {!error && !loading && entries.length === 0 && (
        <div className="card flex flex-col items-center justify-center py-14 text-center">
          <Activity size={22} className="text-slate-300 mb-2" />
          <div className="text-sm text-slate-500">No activity recorded yet.</div>
          <p className="text-xs text-slate-400 mt-1 max-w-sm">
            {hasActiveFilters ? "No entries match the current filters." : "Actions across the app will show up here."}
          </p>
        </div>
      )}

      {!error && entries.length > 0 && (
        <div className="card overflow-hidden !p-0">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5 font-medium w-8"></th>
                <th className="px-4 py-2.5 font-medium">Action</th>
                <th className="px-4 py-2.5 font-medium">Description</th>
                <th className="px-4 py-2.5 font-medium">User</th>
                <th className="px-4 py-2.5 font-medium">Date · Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {entries.map((e) => {
                const meta = TYPE_META[e.type] || DEFAULT_TYPE_META;
                const Icon = meta.icon;
                const expanded = expandedId === e.id;
                const cleanMeta = sanitizeMeta(e.meta);
                const hasDetail = e.entityType || e.entityId || Object.keys(cleanMeta).length > 0;
                return (
                  <Fragment key={e.id}>
                    <tr
                      className={`cursor-pointer hover:bg-slate-50 ${expanded ? "bg-slate-50" : ""}`}
                      onClick={() => hasDetail && setExpandedId(expanded ? null : e.id)}
                    >
                      <td className="px-4 py-2.5 text-slate-300">
                        {hasDetail ? expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} /> : null}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium whitespace-nowrap ${meta.accent}`}>
                          <Icon size={11} /> {e.type}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-slate-700">{e.message}</td>
                      <td className="px-4 py-2.5 text-slate-500 text-xs whitespace-nowrap">{e.user || "System"}</td>
                      <td className="px-4 py-2.5 text-xs text-slate-400 whitespace-nowrap">{formatDateTime(e.createdAt)}</td>
                    </tr>
                    {expanded && (
                      <tr className="bg-slate-50/70">
                        <td></td>
                        <td colSpan={4} className="px-4 pb-3 pt-0">
                          <div className="text-[11px] text-slate-500 space-y-1 bg-white border border-slate-100 rounded-lg p-3">
                            {e.entityType && (
                              <div>
                                <span className="text-slate-400">Related entity:</span> {e.entityType}
                                {e.entityId ? ` (${e.entityId})` : ""}
                              </div>
                            )}
                            {Object.keys(cleanMeta).length > 0 && (
                              <pre className="whitespace-pre-wrap font-mono text-[10.5px] text-slate-500 mt-1">
                                {JSON.stringify(cleanMeta, null, 2)}
                              </pre>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
