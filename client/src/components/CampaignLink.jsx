import { useCampaignDrawer } from "../lib/CampaignDrawerContext";

// Turns a campaign name into a clickable trigger for the Phase 2 campaign
// drawer. Used wherever a campaign name appears — the Dashboard's
// campaigns/unmatched-orders tables, Campaign Comparison, Live Dashboard,
// and any future analytics page. Purely a UI wrapper: it never touches
// how the row's data was fetched or matched, it just opens the drawer
// with the identifying info the caller already has on hand.
//
// If there's no campaignId to open (e.g. an unmatched order whose
// Shiprocket attribution never carried one), renders inert text instead
// of a broken link.
//
// `children` is optional and defaults to campaignName — added in Phase 3
// so the same trigger can also be rendered as a small "Open campaign"
// chip (see KpiAnalyticsPopup's GroupsView) instead of the full campaign
// name, without changing any existing call site's behavior.
export default function CampaignLink({
  tokenId,
  campaignId,
  campaignName,
  accountId,
  accountName,
  since,
  until,
  className = "",
  children,
}) {
  const { openCampaign } = useCampaignDrawer();

  if (!campaignId || !campaignName) {
    return (
      <span className={className} title="No campaign ID available">
        {children ?? campaignName ?? "-"}
      </span>
    );
  }

  return (
    <button
      type="button"
      className={`text-left font-semibold text-slate-700 hover:text-blue-600 hover:underline underline-offset-2 decoration-slate-300 transition-colors cursor-pointer ${className}`}
      onClick={(e) => {
        e.stopPropagation();
        openCampaign({ tokenId, campaignId, campaignName, accountId, accountName, since, until });
      }}
      title="View campaign details"
    >
      {children ?? campaignName}
    </button>
  );
}
