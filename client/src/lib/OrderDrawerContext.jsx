import { createContext, useCallback, useContext, useState } from "react";
import { logActivity } from "./api";

// Mounted once, above <Routes> in App.jsx — same pattern as
// ShiprocketSyncContext and CampaignDrawerContext. This is the deepest
// level of the app's drill-down chain (Dashboard Card -> Analytics Popup
// -> Campaign -> Campaign Drawer -> Order -> Order Drawer), so it needs
// to be reachable from literally anywhere an order row is rendered:
// Dashboard's own tables, KPI popups, and the Campaign Drawer itself —
// and it needs to sit visually on top of all of them (see the z-index
// on OrderDrawer.jsx).
//
// Only tracks WHICH order is requested open. All fetching/caching/
// rendering lives in <OrderDrawer/>.

const OrderDrawerContext = createContext(null);

export function OrderDrawerProvider({ children }) {
  // { orderId, tokenId }
  const [activeOrder, setActiveOrder] = useState(null);

  const openOrder = useCallback((meta) => {
    if (!meta?.orderId) return;
    setActiveOrder(meta);
    // Phase 14 §6 — "Order opened" / "Order details viewed". Fire-and-
    // forget, doesn't touch the actual fetch/render path below.
    logActivity("order_opened", `Order opened (#${meta.orderId})`, {}, "order", meta.orderId);
  }, []);

  const closeOrder = useCallback(() => setActiveOrder(null), []);

  return (
    <OrderDrawerContext.Provider value={{ activeOrder, openOrder, closeOrder }}>{children}</OrderDrawerContext.Provider>
  );
}

export function useOrderDrawer() {
  const ctx = useContext(OrderDrawerContext);
  if (!ctx) {
    throw new Error("useOrderDrawer must be used within an OrderDrawerProvider");
  }
  return ctx;
}
