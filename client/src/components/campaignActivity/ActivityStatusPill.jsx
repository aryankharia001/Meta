// Phase 44 — small activity-bucket badge. Handles two vocabularies this
// feature's own endpoints actually return: campaignActivity.js's own
// lowercase "active"/"paused"/"closed" bucket (spec §4's status
// history), and — for the whole-day Campaign-Based list only
// (buildCampaignsForDay) — Meta's raw uppercase effective_status
// (ACTIVE/PAUSED/DELETED/WITH_ISSUES/...). Deliberately separate from
// CampaignCells.jsx's StatusPill (tuned only for the second
// vocabulary) rather than stretching that one component to also cover
// the first. Same three-tone rule as the rest of the app: green/red/
// neutral gray, never amber.
const GREEN = new Set(["active"]);
const ROSE = new Set(["closed", "deleted", "disapproved", "with_issues"]);

function titleCase(status) {
  const s = String(status).toLowerCase().replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default function ActivityStatusPill({ status }) {
  if (!status) return <span className="badge badge-slate">—</span>;
  const s = String(status).toLowerCase();
  const cls = GREEN.has(s) ? "badge-green" : ROSE.has(s) ? "badge-rose" : "badge-slate";
  return <span className={`badge ${cls}`}>{titleCase(status)}</span>;
}
