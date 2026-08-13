import { createContext, useCallback, useContext, useState } from "react";
import { logActivity } from "./api";

// Phase 13 §10 — mirrors CampaignDrawerContext.jsx exactly. Mounted once,
// above <Routes> in App.jsx, so any page (Ad Set Explorer, Campaign
// Drawer's new Ad Sets section, Order Drawer's attribution links) can
// open the same single Ad Set Drawer instance via useAdSetDrawer().
//
// Only tracks WHICH ad set is requested open. All fetching/caching/
// rendering lives in <AdSetDrawer/>.

const AdSetDrawerContext = createContext(null);

export function AdSetDrawerProvider({ children }) {
  // { tokenId, adsetId, adsetName, campaignId, campaignName, since, until }
  const [activeAdSet, setActiveAdSet] = useState(null);

  const openAdSet = useCallback((meta) => {
    if (!meta?.adsetId) return;
    setActiveAdSet(meta);
    logActivity("adset_opened", `Ad set opened (${meta.adsetName || meta.adsetId})`, {}, "adset", meta.adsetId);
  }, []);

  const closeAdSet = useCallback(() => setActiveAdSet(null), []);

  return (
    <AdSetDrawerContext.Provider value={{ activeAdSet, openAdSet, closeAdSet }}>{children}</AdSetDrawerContext.Provider>
  );
}

export function useAdSetDrawer() {
  const ctx = useContext(AdSetDrawerContext);
  if (!ctx) throw new Error("useAdSetDrawer must be used within an AdSetDrawerProvider");
  return ctx;
}
