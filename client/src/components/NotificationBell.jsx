import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Bell,
  CheckCheck,
  Trash2,
  RefreshCw,
  Package,
  AlertTriangle,
  Download,
  CreditCard,
  Wallet,
  PackageCheck,
  RotateCcw,
  Ban,
  Truck,
  Megaphone,
} from "lucide-react";
import { useLiveSync } from "../lib/LiveSyncContext";
import { usePreferences } from "../lib/PreferencesContext";
import { useNotifications } from "../lib/NotificationsContext";

// ────────────────────────────────────────────────────────────────
// Phase 7 — Notification Center. Replaces LiveSyncToast (Phase 5) as
// the thing mounted once at app root. Two jobs in one component:
// 1. Bridge: watches LiveSyncContext (new orders / manual completion /
//    errors) and preferences (notifyOnSync/NewOrders/Errors), and turns
//    the relevant transitions into entries in NotificationsContext.
//    Export Center (once built) calls addNotification("export", ...)
//    directly rather than through this bridge, since exports aren't a
//    LiveSyncContext concern.
// 2. UI: the bell icon + unread badge + dropdown, mounted once in the
//    sidebar so it's visible on every page.
//
// Phase 10 — z-index/stacking fix: the dropdown used to render as a
// plain absolutely-positioned child inside the sidebar's <aside
// className="... overflow-y-auto">. Per the CSS spec, setting
// overflow-y to anything but visible forces overflow-x to compute to
// "auto" too — so the panel (wider than the 256px sidebar) was being
// silently clipped at the sidebar's right edge instead of overlapping
// the page content, which is what actually looked like "appearing
// behind the page." Raising z-index alone can never fix that; it's a
// clipping/stacking-context problem, not a z-order problem. Fixed by
// rendering the panel through a portal straight onto document.body
// with fixed positioning computed from the bell button's own bounding
// rect, so it's no longer a descendant of any overflow/width-
// constrained ancestor and can't be clipped by one. Re-verified as
// part of Phase 14 §5 — still correct, no changes needed here.
//
// Phase 14 §4 — richer notification types. "new-orders" is kept as a
// legacy alias (harmless if anything still reads it from localStorage
// history); new order events now fire as "prepaid-order" / "cod-order"
// with a full order payload in `meta` so the panel can render an
// order-shaped card (Order ID / Customer / Amount / Campaign /
// Payment / Status) instead of one aggregated line. "sync-failed" is
// split out from generic "error" so a failed sync reads clearly.
// "order-delivered" / "order-rto" / "order-cancelled" /
// "logistics-status" / "campaign-activity" are wired up as renderable
// types for forward-compatibility — see the honest gap note in the
// final phase summary re: why the live-sync layer can't yet detect
// status *changes* on already-synced orders without touching the
// prohibited sync/matching logic.
// ────────────────────────────────────────────────────────────────

const TYPE_META = {
  sync: { icon: RefreshCw, accent: "text-sky-500", label: "Sync Completed" },
  "sync-failed": { icon: AlertTriangle, accent: "text-rose-500", label: "Sync Failed" },
  "new-orders": { icon: Package, accent: "text-emerald-500", label: "New Order" },
  "prepaid-order": { icon: CreditCard, accent: "text-sky-600", label: "New Order" },
  "cod-order": { icon: Wallet, accent: "text-amber-600", label: "New Order" },
  "order-delivered": { icon: PackageCheck, accent: "text-emerald-600", label: "Order Delivered" },
  "order-rto": { icon: RotateCcw, accent: "text-amber-600", label: "Order RTO" },
  "order-cancelled": { icon: Ban, accent: "text-rose-500", label: "Order Cancelled" },
  "logistics-status": { icon: Truck, accent: "text-sky-500", label: "Logistics Update" },
  "campaign-activity": { icon: Megaphone, accent: "text-indigo-500", label: "Campaign Activity" },
  error: { icon: AlertTriangle, accent: "text-rose-500", label: "Error" },
  export: { icon: Download, accent: "text-violet-500", label: "Export Ready" },
};

function formatCurrency(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return null;
  return `₹${n.toLocaleString("en-IN")}`;
}

function paymentLabel(paymentType) {
  if (paymentType === "PREPAID") return "Prepaid";
  if (paymentType === "CASH_ON_DELIVERY") return "COD";
  return null;
}

// Builds the plain-text fallback (used for the toast-era `message`
// field / anywhere the raw string is read) from an enriched order
// record — kept in sync with the rich card rendered below.
function buildOrderMessage(order) {
  const parts = [`Order #${order.orderId}`];
  const pay = paymentLabel(order.paymentType);
  const amt = formatCurrency(order.totalAmountPayable);
  if (pay && amt) parts.push(`${pay} · ${amt}`);
  else if (amt) parts.push(amt);
  if (order.campaignName) parts.push(`Campaign: ${order.campaignName}`);
  if (order.deliveryStatus) parts.push(order.deliveryStatus);
  return parts.join(" — ");
}

function timeAgo(iso) {
  if (!iso) return "";
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function NotificationBell() {
  const liveSync = useLiveSync();
  const { prefs } = usePreferences();
  const { notifications, unreadCount, addNotification, markRead, markAllRead, clearAll } = useNotifications();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const ref = useRef(null);
  const panelRef = useRef(null);

  const lastNotifIdRef = useRef(null);
  const lastErrorRef = useRef("");
  const lastManualIdRef = useRef(null);

  // New orders (background or manual) — piggybacks on the same
  // liveSync.notification the old toast used, so the "what counts as a
  // new-order event" logic isn't duplicated (that decision — did new
  // orders land this cycle — still lives entirely in LiveSyncContext,
  // untouched). We only read the already-computed newOrderRecords off
  // liveSync.lastResult (set in the same state batch as `notification`)
  // to turn one aggregated event into one rich card per order.
  useEffect(() => {
    if (!liveSync.notification) return;
    if (liveSync.notification.id === lastNotifIdRef.current) return;
    lastNotifIdRef.current = liveSync.notification.id;
    if (!prefs.notifyOnNewOrders) return;

    const records = liveSync.lastResult?.newOrderRecords || [];
    if (records.length === 0) {
      addNotification("new-orders", liveSync.notification.message);
      return;
    }
    records.forEach((order) => {
      const type = order.paymentType === "PREPAID" ? "prepaid-order" : order.paymentType === "CASH_ON_DELIVERY" ? "cod-order" : "new-orders";
      addNotification(type, buildOrderMessage(order), order);
    });
  }, [liveSync.notification, liveSync.lastResult, prefs.notifyOnNewOrders, addNotification]);

  // Errors — only fire once per distinct error message, not once per
  // failed 10s poll tick.
  useEffect(() => {
    if (liveSync.status !== "error" || !liveSync.lastError) {
      if (liveSync.status !== "error") lastErrorRef.current = "";
      return;
    }
    if (liveSync.lastError === lastErrorRef.current) return;
    lastErrorRef.current = liveSync.lastError;
    if (prefs.notifyOnErrors) {
      addNotification("error", `Sync error: ${liveSync.lastError}`);
    }
  }, [liveSync.status, liveSync.lastError, prefs.notifyOnErrors, addNotification]);

  // Manual "Refresh Now" completions — fires even at 0 new orders, so
  // clicking Refresh always gives some feedback in the center.
  useEffect(() => {
    if (!liveSync.manualCompletion) return;
    if (liveSync.manualCompletion.id === lastManualIdRef.current) return;
    lastManualIdRef.current = liveSync.manualCompletion.id;
    if (prefs.notifyOnSync) {
      const { newOrders, failedOrders } = liveSync.manualCompletion;
      // Phase 14 §4/§6 — "Sync failed" gets its own notification type
      // instead of folding into generic "Sync completed", using the
      // failedOrders count LiveSyncContext already exposes (untouched).
      if (failedOrders > 0) {
        addNotification("sync-failed", "Sync failed — see Sync page for details");
      } else {
        addNotification("sync", newOrders > 0 ? `Sync completed — ${newOrders} new order${newOrders > 1 ? "s" : ""}` : "Sync completed — no new orders");
      }
    }
  }, [liveSync.manualCompletion, prefs.notifyOnSync, addNotification]);

  // Outside-click closes the panel — checks both the bell button AND
  // the portaled panel itself (the panel is no longer a DOM descendant
  // of `ref` once it's rendered via createPortal onto document.body,
  // so without panelRef here every click inside the panel would look
  // like an "outside" click and close it instantly).
  useEffect(() => {
    const onClick = (e) => {
      if (ref.current?.contains(e.target)) return;
      if (panelRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const updatePosition = () => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    setPos({ top: rect.bottom + 8, left: rect.left });
  };

  const toggleOpen = () => {
    if (!open) updatePosition();
    setOpen((o) => !o);
  };

  // Keep the panel glued under the bell if the viewport resizes while
  // it's open (e.g. rotating a tablet, resizing the window).
  useEffect(() => {
    if (!open) return;
    updatePosition();
    window.addEventListener("resize", updatePosition);
    return () => window.removeEventListener("resize", updatePosition);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const panel = open
    ? createPortal(
        <div
          ref={panelRef}
          style={{ top: pos.top, left: pos.left }}
          className="fixed w-80 bg-white border border-slate-200 rounded-xl shadow-2xl z-[9999] py-2"
        >
          <div className="flex items-center justify-between px-3.5 pb-2 border-b border-slate-100">
            <span className="font-display font-semibold text-sm text-slate-800">Notifications</span>
            <div className="flex items-center gap-2">
              <button type="button" className="text-slate-400 hover:text-slate-600" onClick={markAllRead} title="Mark all read">
                <CheckCheck size={14} />
              </button>
              <button type="button" className="text-slate-400 hover:text-rose-600" onClick={clearAll} title="Clear all">
                <Trash2 size={14} />
              </button>
            </div>
          </div>

          <div className="max-h-80 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="px-3.5 py-8 text-center text-xs text-slate-400">No notifications yet.</div>
            ) : (
              notifications.map((n) => {
                const typeMeta = TYPE_META[n.type] || TYPE_META.sync;
                const Icon = typeMeta.icon;
                const order = n.meta?.orderId ? n.meta : null;
                const pay = order ? paymentLabel(order.paymentType) : null;
                const amt = order ? formatCurrency(order.totalAmountPayable) : null;
                return (
                  <div
                    key={n.id}
                    className={`flex items-start gap-2.5 px-3.5 py-2.5 hover:bg-slate-50 cursor-pointer ${!n.read ? "bg-blue-50/50" : ""}`}
                    onClick={() => markRead(n.id)}
                  >
                    <Icon size={13} className={`shrink-0 mt-0.5 ${typeMeta.accent}`} />
                    <div className="min-w-0 flex-1">
                      {order ? (
                        // Phase 14 §4 — rich order notification card, per
                        // spec example format: title / Order # / Payment ·
                        // Amount / Campaign / Delivery status.
                        <div className="space-y-0.5">
                          <div className="text-[11px] font-semibold text-slate-800 leading-snug">{typeMeta.label}</div>
                          <div className="text-xs text-slate-700 leading-snug font-mono">Order #{order.orderId}</div>
                          {(pay || amt) && (
                            <div className="text-[11px] text-slate-500 leading-snug">
                              {pay || "—"}
                              {amt ? ` · ${amt}` : ""}
                            </div>
                          )}
                          {order.campaignName && <div className="text-[11px] text-slate-500 leading-snug">Campaign: {order.campaignName}</div>}
                          {order.customerName && <div className="text-[11px] text-slate-400 leading-snug">{order.customerName}</div>}
                          {order.orderStatus && <div className="text-[11px] text-slate-500 leading-snug">Order: {order.orderStatus}</div>}
                          {order.deliveryStatus && <div className="text-[11px] text-slate-500 leading-snug">{order.deliveryStatus}</div>}
                        </div>
                      ) : (
                        <div className="text-xs text-slate-700 leading-snug">{n.message}</div>
                      )}
                      <div className="text-[10px] text-slate-400 mt-0.5">{timeAgo(n.createdAt)}</div>
                    </div>
                    {!n.read && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0 mt-1" />}
                  </div>
                );
              })
            )}
          </div>
        </div>,
        document.body
      )
    : null;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={toggleOpen}
        className="relative flex items-center justify-center w-8 h-8 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
        title="Notifications"
      >
        <Bell size={16} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[15px] h-[15px] px-1 rounded-full bg-rose-500 text-white text-[9px] font-bold">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {panel}
    </div>
  );
}
