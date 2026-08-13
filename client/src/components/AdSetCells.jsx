import AdSetLink from "./AdSetLink";
import { LiveIndicator } from "./CampaignCells";
import { isLiveStatus } from "../lib/campaignDisplay";

// Phase 13 §4 — mirrors CampaignCells.jsx's CampaignNameCell. Reuses the
// generic LiveIndicator/RoasValue/StatusPill/BudgetCell from
// CampaignCells.jsx as-is (nothing campaign-specific about them) rather
// than duplicating them.
export function AdSetNameCell({ tokenId, adsetId, adsetName, campaignId, campaignName, since, until, status, showId = true }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2 min-w-0">
        {isLiveStatus(status) && <LiveIndicator status={status} />}
        <AdSetLink
          tokenId={tokenId}
          adsetId={adsetId}
          adsetName={adsetName}
          campaignId={campaignId}
          campaignName={campaignName}
          since={since}
          until={until}
          className="!text-slate-800 truncate max-w-[240px]"
        />
      </div>
      {showId && adsetId && <div className="campaign-id mt-0.5 truncate">{adsetId}</div>}
    </div>
  );
}
