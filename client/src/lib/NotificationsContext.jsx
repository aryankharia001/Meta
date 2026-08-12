import { createContext, useCallback, useContext, useEffect, useState } from "react";

// ────────────────────────────────────────────────────────────────
// Phase 7 — Notification Center, replacing Phase 5's auto-dismissing
// toast (LiveSyncToast). Same "no auth = per-browser" reasoning as
// PreferencesContext/recentlyViewed.js: notifications persist in this
// browser's localStorage, capped at 50, newest first. This context is
// purely storage — WHAT gets notified (sync/new-orders/errors/export)
// is decided by the components that call addNotification (see
// NotificationBell.jsx, which bridges LiveSyncContext + preferences
// into this store) so this file has zero knowledge of sync/export.
// ────────────────────────────────────────────────────────────────

const STORAGE_KEY = "notifications.v1";
const MAX_ITEMS = 50;

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function save(list) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // storage full/unavailable — notifications just won't persist across reloads
  }
}

const NotificationsContext = createContext(null);

export function NotificationsProvider({ children }) {
  const [notifications, setNotifications] = useState(() => load());

  useEffect(() => {
    save(notifications);
  }, [notifications]);

  const addNotification = useCallback((type, message, meta = {}) => {
    if (!message) return;
    setNotifications((prev) => [
      { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, type, message, meta, createdAt: new Date().toISOString(), read: false },
      ...prev,
    ].slice(0, MAX_ITEMS));
  }, []);

  const markRead = useCallback((id) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
  }, []);

  const markAllRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, []);

  const clearAll = useCallback(() => setNotifications([]), []);

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <NotificationsContext.Provider value={{ notifications, unreadCount, addNotification, markRead, markAllRead, clearAll }}>
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationsContext);
  if (!ctx) {
    throw new Error("useNotifications must be used within a NotificationsProvider");
  }
  return ctx;
}
