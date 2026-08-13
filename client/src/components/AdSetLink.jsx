import { useAdSetDrawer } from "../lib/AdSetDrawerContext";

// Mirrors CampaignLink.jsx exactly. If there's no adsetId to open (order
// has no ad-set attribution, or Meta data for it isn't available),
// renders inert text — never a broken link, never fabricated.
export default function AdSetLink({ tokenId, adsetId, adsetName, campaignId, campaignName, since, until, className = "", children }) {
  const { openAdSet } = useAdSetDrawer();

  if (!adsetId) {
    return (
      <span className={className} title="No ad set attribution available">
        {children ?? adsetName ?? "Unmatched"}
      </span>
    );
  }

  return (
    <button
      type="button"
      className={`text-left font-semibold text-slate-700 hover:text-blue-600 hover:underline underline-offset-2 decoration-slate-300 transition-colors cursor-pointer ${className}`}
      onClick={(e) => {
        e.stopPropagation();
        openAdSet({ tokenId, adsetId, adsetName, campaignId, campaignName, since, until });
      }}
      title="View ad set details"
    >
      {children ?? adsetName ?? adsetId}
    </button>
  );
}
