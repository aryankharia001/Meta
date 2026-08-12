import { Settings, Moon, Sun, Monitor, RotateCcw, User, Bell, Clock, Table2, LayoutDashboard, Palette } from "lucide-react";
import { usePreferences } from "../lib/PreferencesContext";

// ────────────────────────────────────────────────────────────────
// Phase 7 — User Preferences. Everything here is stored in
// localStorage via PreferencesContext (see that file for why: this app
// has no login/auth, so "the user's" settings are this browser's
// settings). Nothing here touches how the Dashboard/Analytics/drawers
// actually fetch or compute data — it only changes defaults/appearance
// those pages already read from LiveSyncContext/PreferencesContext.
// ────────────────────────────────────────────────────────────────

const DATE_RANGE_OPTIONS = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "7d", label: "Last 7 Days" },
  { value: "30d", label: "Last 30 Days" },
  { value: "thisMonth", label: "This Month" },
  { value: "lastMonth", label: "Last Month" },
];

const LANDING_PAGE_OPTIONS = [
  { value: "/", label: "Dashboard" },
  { value: "/analytics", label: "Analytics" },
  { value: "/live-campaigns", label: "Live Dashboard" },
  { value: "/adorder-comparison", label: "Campaign Comparison" },
  { value: "/favorites", label: "Favorites" },
  { value: "/activity-log", label: "Activity Log" },
  { value: "/export-center", label: "Export Center" },
];

const THEME_OPTIONS = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

export default function SettingsPage() {
  const { prefs, updatePrefs, resetPrefs } = usePreferences();

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <div className="flex items-center gap-2.5 mb-1">
        <span className="flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-md shadow-indigo-500/30">
          <Settings size={18} />
        </span>
        <div>
          <h1 className="text-lg font-display font-bold text-slate-800 leading-tight">Settings</h1>
          <p className="text-xs text-slate-400">Preferences are saved to this browser and applied everywhere in the app</p>
        </div>
      </div>

      <section className="card">
        <h2 className="font-display font-semibold text-sm text-slate-700 mb-4 flex items-center gap-2">
          <Palette size={15} /> Appearance
        </h2>
        <Field label="Theme">
          <div className="flex gap-2">
            {THEME_OPTIONS.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => updatePrefs({ theme: t.value })}
                className={`flex-1 flex flex-col items-center gap-1.5 py-3 rounded-xl border text-sm transition-colors ${
                  prefs.theme === t.value
                    ? "border-indigo-400 bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10"
                    : "border-slate-200 text-slate-500 hover:bg-slate-50"
                }`}
              >
                <t.icon size={16} />
                {t.label}
              </button>
            ))}
          </div>
        </Field>
      </section>

      <section className="card">
        <h2 className="font-display font-semibold text-sm text-slate-700 mb-4 flex items-center gap-2">
          <LayoutDashboard size={15} /> Defaults
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Default dashboard date range">
            <select className="input" value={prefs.defaultDateRange} onChange={(e) => updatePrefs({ defaultDateRange: e.target.value })}>
              {DATE_RANGE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Default landing page">
            <select className="input" value={prefs.defaultLandingPage} onChange={(e) => updatePrefs({ defaultLandingPage: e.target.value })}>
              {LANDING_PAGE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </section>

      <section className="card">
        <h2 className="font-display font-semibold text-sm text-slate-700 mb-4 flex items-center gap-2">
          <Table2 size={15} /> Tables
        </h2>
        <Field label="Rows per page" hint="Applies to new tables using the shared DataTable component.">
          <select className="input w-auto" value={prefs.tablePageSize} onChange={(e) => updatePrefs({ tablePageSize: Number(e.target.value) })}>
            {[10, 20, 50, 100].map((n) => (
              <option key={n} value={n}>
                {n} rows
              </option>
            ))}
          </select>
        </Field>
      </section>

      <section className="card">
        <h2 className="font-display font-semibold text-sm text-slate-700 mb-4 flex items-center gap-2">
          <Clock size={15} /> Live Sync
        </h2>
        <Field label="Auto-refresh interval" hint="How often the background live-sync check runs. Lower values mean more frequent Shiprocket checks.">
          <select className="input w-auto" value={prefs.autoRefreshSeconds} onChange={(e) => updatePrefs({ autoRefreshSeconds: Number(e.target.value) })}>
            {[10, 15, 30, 60, 120].map((n) => (
              <option key={n} value={n}>
                Every {n} seconds
              </option>
            ))}
          </select>
        </Field>
      </section>

      <section className="card">
        <h2 className="font-display font-semibold text-sm text-slate-700 mb-4 flex items-center gap-2">
          <Bell size={15} /> Notifications
        </h2>
        <div className="space-y-3">
          <Toggle label="Sync completed" checked={prefs.notifyOnSync} onChange={(v) => updatePrefs({ notifyOnSync: v })} />
          <Toggle label="New orders detected" checked={prefs.notifyOnNewOrders} onChange={(v) => updatePrefs({ notifyOnNewOrders: v })} />
          <Toggle label="Errors" checked={prefs.notifyOnErrors} onChange={(v) => updatePrefs({ notifyOnErrors: v })} />
          <Toggle label="Export completed" checked={prefs.notifyOnExport} onChange={(v) => updatePrefs({ notifyOnExport: v })} />
        </div>
      </section>

      <section className="card">
        <h2 className="font-display font-semibold text-sm text-slate-700 mb-4 flex items-center gap-2">
          <User size={15} /> Notes Authorship
        </h2>
        <Field label="Your name" hint="Shown as the Author on new notes you add to campaigns, orders, and customers.">
          <input className="input" placeholder="e.g. Priya" value={prefs.authorName} onChange={(e) => updatePrefs({ authorName: e.target.value })} />
        </Field>
      </section>

      <button type="button" className="btn btn-secondary btn-sm" onClick={resetPrefs}>
        <RotateCcw size={13} /> Reset to defaults
      </button>
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <div className="text-xs font-medium text-slate-600 mb-1.5">{label}</div>
      {children}
      {hint && <p className="text-[11px] text-slate-400 mt-1">{hint}</p>}
    </label>
  );
}

function Toggle({ label, checked, onChange }) {
  return (
    <label className="flex items-center justify-between cursor-pointer">
      <span className="text-sm text-slate-600">{label}</span>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative w-10 h-5.5 rounded-full transition-colors ${checked ? "bg-indigo-600" : "bg-slate-200"}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-4.5 h-4.5 bg-white rounded-full shadow transition-transform ${
            checked ? "translate-x-4.5" : "translate-x-0"
          }`}
        />
      </button>
    </label>
  );
}
