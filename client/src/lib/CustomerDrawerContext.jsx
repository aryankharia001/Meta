import { createContext, useCallback, useContext, useState } from "react";

// Phase 7 — same pattern as OrderDrawerContext/CampaignDrawerContext:
// only tracks WHICH customer (by phone) is requested open. All
// fetching/caching/rendering lives in <CustomerDrawer/>.

const CustomerDrawerContext = createContext(null);

export function CustomerDrawerProvider({ children }) {
  const [activeCustomer, setActiveCustomer] = useState(null); // { phone, tokenId }

  const openCustomer = useCallback((meta) => {
    if (!meta?.phone) return;
    setActiveCustomer(meta);
  }, []);

  const closeCustomer = useCallback(() => setActiveCustomer(null), []);

  return (
    <CustomerDrawerContext.Provider value={{ activeCustomer, openCustomer, closeCustomer }}>
      {children}
    </CustomerDrawerContext.Provider>
  );
}

export function useCustomerDrawer() {
  const ctx = useContext(CustomerDrawerContext);
  if (!ctx) {
    throw new Error("useCustomerDrawer must be used within a CustomerDrawerProvider");
  }
  return ctx;
}
