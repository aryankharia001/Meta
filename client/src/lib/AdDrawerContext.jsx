import { createContext, useCallback, useContext, useState } from "react";
import { logActivity } from "./api";

// Phase 13 §9 — mirrors CampaignDrawerContext.jsx/AdSetDrawerContext.jsx.
// Mounted once, above <Routes> in App.jsx. Deepest level of the Phase 13
// drill-down chain (Ad Set Drawer -> Ad -> Ad Drawer -> Order -> Order
// Drawer), so it needs to be reachable from anywhere an ad row renders.
//
// Only tracks WHICH ad is requested open. All fetching/caching/rendering
// lives in <AdDrawer/>.

const AdDrawerContext = createContext(null);

export function AdDrawerProvider({ children }) {
  // { tokenId, adId, adName, adsetId, adsetName, campaignId, campaignName, since, until }
  const [activeAd, setActiveAd] = useState(null);

  const openAd = useCallback((meta) => {
    if (!meta?.adId) return;
    setActiveAd(meta);
    logActivity("ad_opened", `Ad opened (${meta.adName || meta.adId})`, {}, "ad", meta.adId);
  }, []);

  const closeAd = useCallback(() => setActiveAd(null), []);

  return <AdDrawerContext.Provider value={{ activeAd, openAd, closeAd }}>{children}</AdDrawerContext.Provider>;
}

export function useAdDrawer() {
  const ctx = useContext(AdDrawerContext);
  if (!ctx) throw new Error("useAdDrawer must be used within an AdDrawerProvider");
  return ctx;
}
