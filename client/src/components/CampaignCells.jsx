import CampaignLink from "./CampaignLink";
import { isCampaignLive, isLiveStatus, roasClass, statusBadgeClass, formatBudget } from "../lib/campaignDisplay";
import { multiplier } from "../lib/format";

// ────────────────────────────────────────────────────────────────
// Phase 11 — Premium Tables, Live Campaign UI & Unified Data Experience.
// Small, reusable presentational building blocks so every campaign table
// across Dashboard/Daily/Campaign Explorer/Analytics/Campaign Drawer/
// Campaign Comparison renders the same campaign the same way, instead of
// each page hand-rolling its own badge/indicator markup. Pure display —
// none of these touch data fetching, matching, or sync.
// ────────────────────────────────────────────────────────────────

// A subtle glowing "● LIVE" indicator — soft outer glow + gentle pulse
// (see .live-dot/.live-indicator in index.css), replacing the old flat
// colored-circle status dot. Renders nothing for non-live campaigns so
// callers can drop it in unconditionally.
export function LiveIndicator({ status, campaign, className = "" }) {
  const live = campaign ? isCampaignLive(campaign) : isLiveStatus(status);
  if (!live) return null;
  return (
    <span className={`live-indicator ${className}`} title="Currently live on Meta">
      <span className="live-dot" />
      LIVE
    </span>
  );
}

// Standardized ROAS display: > 2.4 green with a soft glow, <= 2.4 red —
// identical rule and styling everywhere ROAS appears.
export function RoasValue({ roas, className = "" }) {
  return <span className={`${roasClass(roas)} ${className}`}>{multiplier(roas)}</span>;
}

// Campaign health/status badge — green (live/positive), red (problem
// status), or neutral gray. Never orange/yellow.
export function StatusPill({ status, label }) {
  if (!status) return <span className="badge badge-slate">N/A</span>;
  return <span className={`badge ${statusBadgeClass(status)}`}>{label || status}</span>;
}

// Campaign's own Meta budget (daily or lifetime) — never derived from
// spend. Shows a muted em dash when Meta didn't return a budget.
export function BudgetCell({ budget, budgetType }) {
  const display = formatBudget(budget, budgetType);
  if (!display) return <span className="budget-cell text-slate-300">—</span>;
  const [amount, ...rest] = display.split(" ");
  return (
    <span className="budget-cell">
      <strong>{amount}</strong> {rest.join(" ")}
    </span>
  );
}

// The campaign name as the primary visual element of a row: bold/larger
// name, optional muted campaign ID underneath, and the live indicator
// inline — everything CampaignLink already does for click-to-open, just
// with the richer two-line layout the redesigned tables use.
export function CampaignNameCell({
  tokenId,
  campaignId,
  campaignName,
  accountId,
  accountName,
  since,
  until,
  status,
  campaign,
  showId = true,
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2 min-w-0">
        <CampaignLink
          tokenId={tokenId}
          campaignId={campaignId}
          campaignName={campaignName}
          accountId={accountId}
          accountName={accountName}
          since={since}
          until={until}
          className="campaign-name !text-slate-800 truncate max-w-[260px]"
        />
        <LiveIndicator status={status} campaign={campaign} />
      </div>
      {showId && campaignId && <div className="campaign-id mt-0.5 truncate">{campaignId}</div>}
    </div>
  );
}
