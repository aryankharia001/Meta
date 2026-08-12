import { useEffect, useState } from "react";
import { Activity, RefreshCw, Star, FileText, Bookmark, Download, AlertTriangle } from "lucide-react";
import { fetchActivityLog } from "../lib/api";
import { formatDateTime } from "../lib/format";
import DataTable from "../components/DataTable";

// ────────────────────────────────────────────────────────────────
// Phase 7 — Activity Log page. Reads the new /api/activity-log
// collection (append-only, capped at 500 server-side), newest first.
// Entries are written by logActivity() calls sprinkled non-invasively
// across existing actions (LiveSyncContext's manual/background syncs,
// FavoritesContext's toggle, EntityNotesPanel/OrderDrawer's note CRUD)
// — this page only reads and renders, it never itself decides what
// counts as "activity."
// ────────────────────────────────────────────────────────────────

const TYPE_META = {
  sync: { icon: RefreshCw, accent: "bg-sky-50 text-sky-600" },
  favorite: { icon: Star, accent: "bg-amber-50 text-amber-600" },
  note: { icon: FileText, accent: "bg-indigo-50 text-indigo-600" },
  "saved-view": { icon: Bookmark, accent: "bg-violet-50 text-violet-600" },
  export: { icon: Download, accent: "bg-emerald-50 text-emerald-600" },
};

export default function ActivityLogPage() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = () => {
    setLoading(true);
    setError("");
    fetchActivityLog(200)
      .then((res) => setEntries(res.entries || []))
      .catch((err) => setError(err.message || "Failed to load activity log"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
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
        <button type="button" className="btn btn-secondary btn-sm" onClick={load} disabled={loading}>
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

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
            Refreshing the dashboard, adding notes, and favoriting items will show up here.
          </p>
        </div>
      )}

      {!error && entries.length > 0 && (
        <DataTable
          tableId="activity-log"
          columns={[
            {
              key: "type",
              label: "Type",
              defaultWidth: 110,
              render: (e) => {
                const meta = TYPE_META[e.type] || { icon: Activity, accent: "bg-slate-100 text-slate-500" };
                const Icon = meta.icon;
                return (
                  <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium ${meta.accent}`}>
                    <Icon size={11} /> {e.type}
                  </span>
                );
              },
            },
            { key: "message", label: "Message", render: (e) => <span className="text-slate-700">{e.message}</span> },
            {
              key: "createdAt",
              label: "When",
              defaultWidth: 160,
              render: (e) => formatDateTime(e.createdAt),
              sortValue: (e) => new Date(e.createdAt).getTime(),
            },
          ]}
          data={entries}
          searchKeys={["type", "message"]}
          rowKey={(e) => e.id}
          exportFilename="activity-log.csv"
          emptyMessage="No activity recorded yet."
        />
      )}
    </div>
  );
}
