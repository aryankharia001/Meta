import { createContext, useCallback, useContext, useState } from "react";

// Mounted once, above <Routes> in App.jsx (same pattern as
// ShiprocketSyncContext) so any page — Dashboard, Campaign Comparison,
// Live Dashboard, and any future analytics page — can open the same
// single drawer instance via useCampaignDrawer() without each page
// managing its own overlay/z-index.
//
// This context only tracks WHICH campaign is requested to be open
// (openCampaign/closeCampaign). All data fetching, caching, and
// rendering live in <CampaignDrawer/> itself.

const CampaignDrawerContext = createContext(null);

export function CampaignDrawerProvider({ children }) {
  // { tokenId, campaignId, campaignName, accountId, accountName, since, until }
  const [activeCampaign, setActiveCampaign] = useState(null);

  const openCampaign = useCallback((meta) => {
    if (!meta?.campaignId || !meta?.campaignName) return;
    setActiveCampaign(meta);
  }, []);

  const closeCampaign = useCallback(() => setActiveCampaign(null), []);

  return (
    <CampaignDrawerContext.Provider value={{ activeCampaign, openCampaign, closeCampaign }}>
      {children}
    </CampaignDrawerContext.Provider>
  );
}

export function useCampaignDrawer() {
  const ctx = useContext(CampaignDrawerContext);
  if (!ctx) {
    throw new Error("useCampaignDrawer must be used within a CampaignDrawerProvider");
  }
  return ctx;
}
