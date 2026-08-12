import { createContext, useCallback, useContext, useEffect, useState } from "react";

// ────────────────────────────────────────────────────────────────
// Phase 7 — User Preferences. This app has no login/auth anywhere
// (every earlier phase's data — tokens, ad accounts, favorites, notes —
// is shared, single-tenant), so "the user's" preferences are really
// "this browser's" preferences. localStorage is the right, standard
// place for that — no new backend model needed, and it can't leak
// between different people's data the way a fake per-user backend
// record would misleadingly imply. Mounted once above <Routes>, same
// as every other Phase 1–6 provider, so it's readable from anywhere.
// ────────────────────────────────────────────────────────────────

const STORAGE_KEY = "prefs.v1";

const DEFAULTS = {
  defaultDateRange: "7d", // matches Dashboard's PRESETS keys
  defaultLandingPage: "/", // route path
  tablePageSize: 10,
  theme: "system", // "light" | "dark" | "system"
  autoRefreshSeconds: 10, // LiveSyncContext's poll interval
  notifyOnSync: true,
  notifyOnNewOrders: true,
  notifyOnErrors: true,
  notifyOnExport: true,
  authorName: "", // attached to new notes as "Author"
};

function loadPrefs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

function applyTheme(theme) {
  const root = document.documentElement;
  const resolved =
    theme === "system" ? (window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light") : theme;
  root.classList.toggle("dark", resolved === "dark");
}

const PreferencesContext = createContext(null);

export function PreferencesProvider({ children }) {
  const [prefs, setPrefs] = useState(loadPrefs);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    applyTheme(prefs.theme);
  }, [prefs]);

  // React to OS theme changes live when the preference is "system".
  useEffect(() => {
    if (prefs.theme !== "system") return;
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const handler = () => applyTheme("system");
    mq.addEventListener?.("change", handler);
    return () => mq.removeEventListener?.("change", handler);
  }, [prefs.theme]);

  const updatePrefs = useCallback((patch) => {
    setPrefs((prev) => ({ ...prev, ...patch }));
  }, []);

  const resetPrefs = useCallback(() => setPrefs({ ...DEFAULTS }), []);

  return (
    <PreferencesContext.Provider value={{ prefs, updatePrefs, resetPrefs, defaults: DEFAULTS }}>
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferences() {
  const ctx = useContext(PreferencesContext);
  if (!ctx) {
    throw new Error("usePreferences must be used within a PreferencesProvider");
  }
  return ctx;
}
