import { ExternalLink } from "lucide-react";
import { metaCampaignUrl, metaAdSetUrl, metaAdUrl } from "../lib/metaAdsManager";

// ─────────────────────────────────────────────────────────────
// Phase 32 §4 — "Open in Meta Ads Manager" button, shared by
// CampaignDrawer.jsx / AdSetDrawer.jsx / AdDrawer.jsx. Purely
// presentational: builds the destination URL from lib/metaAdsManager.js
// and either renders a real link (when every required Meta ID is known)
// or a disabled, clearly-labeled button (when it isn't) — never a link
// to the generic Ads Manager homepage.
// ─────────────────────────────────────────────────────────────

const LABELS = {
  campaign: "Open Campaign in Meta",
  adset: "Open Ad Set in Meta",
  ad: "Open Ad in Meta",
};

const LEVEL_NOUN = {
  campaign: "campaign",
  adset: "ad set",
  ad: "ad",
};

export default function OpenInMetaButton({ level, accountId, campaignId, adsetId, adId, className = "" }) {
  let url = null;
  if (level === "campaign") url = metaCampaignUrl({ accountId, campaignId });
  else if (level === "adset") url = metaAdSetUrl({ accountId, campaignId, adsetId });
  else if (level === "ad") url = metaAdUrl({ accountId, campaignId, adsetId, adId });

  const label = LABELS[level] || "Open in Meta Ads Manager";

  if (!url) {
    return (
      <button
        type="button"
        disabled
        className={`btn btn-secondary btn-sm opacity-50 cursor-not-allowed ${className}`}
        title={`Meta account ID isn't available for this ${LEVEL_NOUN[level] || "object"} yet — can't build a direct link.`}
      >
        <ExternalLink size={13} /> {label}
      </button>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className={`btn btn-secondary btn-sm ${className}`}
      title={`Opens this exact ${LEVEL_NOUN[level] || "object"} in Meta Ads Manager`}
    >
      <ExternalLink size={13} /> {label}
    </a>
  );
}
