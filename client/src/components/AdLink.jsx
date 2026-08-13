import { useAdDrawer } from "../lib/AdDrawerContext";

// Mirrors CampaignLink.jsx/AdSetLink.jsx exactly. If there's no adId to
// open, renders inert text — never a broken link, never fabricated.
export default function AdLink({ tokenId, adId, adName, adsetId, adsetName, campaignId, campaignName, since, until, className = "", children }) {
  const { openAd } = useAdDrawer();

  if (!adId) {
    return (
      <span className={className} title="No ad attribution available">
        {children ?? adName ?? "Unmatched"}
      </span>
    );
  }

  return (
    <button
      type="button"
      className={`text-left font-semibold text-slate-700 hover:text-blue-600 hover:underline underline-offset-2 decoration-slate-300 transition-colors cursor-pointer ${className}`}
      onClick={(e) => {
        e.stopPropagation();
        openAd({ tokenId, adId, adName, adsetId, adsetName, campaignId, campaignName, since, until });
      }}
      title="View ad details"
    >
      {children ?? adName ?? adId}
    </button>
  );
}
