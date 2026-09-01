import MetaEntityState from "../models/MetaEntityState.js";
import CampaignNameHistory from "../models/CampaignNameHistory.js";
import CampaignNameMapping from "../models/CampaignNameMapping.js";
import CampaignStatusHistory from "../models/CampaignStatusHistory.js";
import { statusBucket } from "./campaignActivity.js";

// ─────────────────────────────────────────────────────────────────────
// Campaign History Phase — the ONE shared place order→campaign identity
// resolution happens. Deliberately the single explicit exception to this
// codebase's normal "zero coupling between phases / duplicate small
// helpers per file" convention (see campaignActivity.js's/every route
// file's own header) — the whole point of this phase is that every page
// resolves a Shiprocket order's campaign_name to the same permanent
// Meta Campaign ID the same way, so the matching logic can only live in
// one place. Nothing here makes a Meta Graph API call.
//
// Meta Campaign ID is the permanent identity of a campaign (never
// re-derived from name). A campaign's current name lives on
// MetaEntityState; every name it has ever been observed under lives in
// CampaignNameHistory (auto, append-only, written from
// services/metaEntitySync.js's reconcileEntity()); user-asserted
// alternate names live in CampaignNameMapping (manual, added from the
// Campaign Drill side window via routes/campaignIdentity.js).
//
// Resolution priority (reconciles spec §6's search order with §8's
// override rule): a manual mapping, when one exists for the exact name
// being resolved, ALWAYS wins — it's explicit human truth meant to
// override an automatic guess when they'd disagree. Absent a manual
// mapping, the current campaign name is checked, then automatically
// saved historical names. This is the one deliberate reconciliation of
// the two spec sections, documented here since it's the crux of the
// whole matching direction:
//
//   Shiprocket Order → order's campaign_name
//        → manual mapping | current name | auto historical name
//        → Campaign ID → Campaign record → CURRENT display name
//
// never the reverse (Meta campaigns → name-match → orders), which is
// the bug this phase exists to fix.
// ─────────────────────────────────────────────────────────────────────

export function normalizeCampaignName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

// Meta's specific "the object you asked for by ID doesn't exist /
// isn't accessible" signal — code 100, subcode 33 in practice, or a
// message containing "does not exist". Deliberately narrow: auth
// failures (code 190), rate limiting (code 4/17/32), and permission
// errors that don't say "does not exist" are NOT treated as deletion —
// they fall through to the existing log-and-skip behavior every caller
// already had before this phase, so a transient/auth error can never be
// misread as "Meta deleted this campaign".
export function isMetaObjectMissingError(err) {
  if (!err) return false;
  if (err.fbErrorCode === 100 && err.fbErrorSubcode === 33) return true;
  return /does not exist/i.test(String(err.message || ""));
}

// ── Name-change history (append-only, deduped) ─────────────────────
//
// Only ever writes a row when there's a genuine change AND a real prior
// name to compare against — never fabricates a "previous name" on a
// campaign's first observation, same convention BudgetHistory/
// BidCapHistory already use for their own first-observation case.
export async function recordNameChangeIfNeeded({ tokenId, accountId, campaignId, previousName, newName }) {
  const prevNorm = normalizeCampaignName(previousName);
  const newNorm = normalizeCampaignName(newName);
  if (!newNorm || !prevNorm || prevNorm === newNorm) return null;

  return CampaignNameHistory.create({
    tokenId,
    accountId: accountId || "",
    campaignId: String(campaignId),
    previousName: previousName || "",
    newName: newName || "",
    previousNameNormalized: prevNorm,
    newNameNormalized: newNorm,
    source: "Meta Ads Manager",
    changedAt: new Date(),
  });
}

// ── Deleted / no-longer-returned tracking ───────────────────────────
//
// Both functions are no-ops (return null, write nothing) when the state
// they'd produce already holds — spec §25's dedup rule applied to this
// new flag, so repeated polling never creates duplicate
// CampaignStatusHistory rows for the same disappearance/reappearance.
export async function markCampaignNoLongerReturned({ tokenId, accountId, entityId, entityName, previousEffectiveStatus }) {
  const prevState = await MetaEntityState.findOne({ tokenId, entityType: "campaign", entityId });
  if (!prevState || prevState.isDeleted) return null;

  const previousStatus = previousEffectiveStatus ?? prevState.effectiveStatus ?? null;
  const previousBucket = statusBucket(previousStatus);

  prevState.isDeleted = true;
  prevState.noLongerReturnedAt = new Date();
  await prevState.save();

  return CampaignStatusHistory.create({
    tokenId,
    accountId: accountId || prevState.accountId || "",
    entityType: "campaign",
    entityId,
    entityName: entityName || prevState.name || "",
    previousStatus,
    newStatus: null, // Meta no longer tells us anything — never fabricated
    previousBucket,
    newBucket: "closed",
    activityType: "no_longer_returned",
    source: "System",
    changedBy: "",
    changedAt: new Date(),
    message: `Campaign "${entityName || prevState.name || entityId}" is no longer returned by Meta (deleted, or access revoked) — historical data preserved`,
  });
}

export async function markCampaignReturned({ tokenId, entityId, entityName, effectiveStatus }) {
  const prevState = await MetaEntityState.findOne({ tokenId, entityType: "campaign", entityId });
  if (!prevState || !prevState.isDeleted) return null;

  prevState.isDeleted = false;
  prevState.noLongerReturnedAt = null;
  prevState.lastSeenAt = new Date();
  await prevState.save();

  const newBucket = statusBucket(effectiveStatus ?? prevState.effectiveStatus);
  return CampaignStatusHistory.create({
    tokenId,
    accountId: prevState.accountId || "",
    entityType: "campaign",
    entityId,
    entityName: entityName || prevState.name || "",
    previousStatus: prevState.effectiveStatus || null,
    newStatus: effectiveStatus || prevState.effectiveStatus || null,
    previousBucket: "closed",
    newBucket,
    activityType: newBucket === "active" ? "reactivated" : "resumed",
    source: "System",
    changedBy: "",
    changedAt: new Date(),
    message: `Campaign "${entityName || prevState.name || entityId}" is being returned by Meta again`,
  });
}

// Marks lastSeenAt on every campaign actually present in a bulk Meta
// list response, without touching isDeleted (that's markCampaignReturned's
// job, only when the campaign was previously flagged). DB-only, no
// Meta call. Best-effort — a failure here never blocks the caller.
export async function touchLastSeen({ tokenId, entityIds }) {
  const ids = [...new Set((entityIds || []).filter(Boolean).map(String))];
  if (!tokenId || !ids.length) return;
  await MetaEntityState.updateMany(
    { tokenId, entityType: "campaign", entityId: { $in: ids } },
    { $set: { lastSeenAt: new Date() } }
  ).catch(() => {});
}

// ── Pure resolution (no DB access — operates on the maps built by
// buildCampaignIdentityResolver()/buildSingleCampaignResolver() below) ─
export function resolveOrderCampaign(order, maps) {
  const { byManualName, byCurrentName, byHistoricalName, byId } = maps;
  const norm = normalizeCampaignName(order?.campaignName);
  if (!norm) return { campaignId: null, currentName: null, matchType: "unmatched" };

  const manualId = byManualName.get(norm);
  if (manualId) {
    const rec = byId.get(manualId);
    return { campaignId: manualId, currentName: rec ? rec.currentName : null, matchType: "manual_mapping" };
  }

  const currentId = byCurrentName.get(norm);
  if (currentId) {
    const rec = byId.get(currentId);
    return { campaignId: currentId, currentName: rec ? rec.currentName : null, matchType: "current_name" };
  }

  const historicalSet = byHistoricalName.get(norm);
  if (historicalSet && historicalSet.size === 1) {
    const id = [...historicalSet][0];
    const rec = byId.get(id);
    return { campaignId: id, currentName: rec ? rec.currentName : null, matchType: "historical_name" };
  }
  if (historicalSet && historicalSet.size > 1) {
    // This exact name was historically used by more than one campaign
    // and there's no manual mapping to disambiguate — surfaced
    // distinctly rather than guessing wrong. A manual mapping (spec §4)
    // is exactly the tool to resolve this.
    return { campaignId: null, currentName: null, matchType: "ambiguous_historical_name" };
  }

  return { campaignId: null, currentName: null, matchType: "unmatched" };
}

// ── Bulk resolver builder (list-style routes: /compare, campaign
// explorer, daily/hourly reports, profitability) ────────────────────
//
// liveCampaigns: whatever Meta campaign list the caller already fetched
// this request — [{ campaignId, campaignName, accountId? }] (also
// accepts { id, name } shape so callers can pass raw Meta rows
// directly). Zero Meta API calls happen in this function.
//
// Also folds in every campaign this app has EVER tracked for this
// token/these accounts via MetaEntityState — including isDeleted ones —
// which is what makes a deleted campaign's historical orders still
// resolvable even once it's dropped out of `liveCampaigns` entirely
// (spec §9/§19).
export async function buildCampaignIdentityResolver({ tokenId, accountIds, liveCampaigns }) {
  const byId = new Map(); // campaignId -> { campaignId, currentName, accountId, isDeleted }

  (liveCampaigns || []).forEach((c) => {
    const id = String(c.campaignId || c.id || "");
    if (!id) return;
    byId.set(id, {
      campaignId: id,
      currentName: c.campaignName || c.name || "",
      accountId: c.accountId || "",
      isDeleted: false,
    });
  });

  const stateFilter = { tokenId, entityType: "campaign" };
  if (accountIds && accountIds.length) stateFilter.accountId = { $in: accountIds };
  const stateRows = await MetaEntityState.find(stateFilter).select("entityId name accountId isDeleted").lean();
  stateRows.forEach((r) => {
    const id = String(r.entityId);
    if (byId.has(id)) return; // live data (fresher) already covers this one
    byId.set(id, { campaignId: id, currentName: r.name || "", accountId: r.accountId || "", isDeleted: !!r.isDeleted });
  });

  const byCurrentName = new Map();
  byId.forEach((v, id) => {
    const n = normalizeCampaignName(v.currentName);
    if (n && !byCurrentName.has(n)) byCurrentName.set(n, id);
  });

  const campaignIds = [...byId.keys()];
  const [nameHistoryRows, mappingRows] = campaignIds.length
    ? await Promise.all([
        CampaignNameHistory.find({ tokenId, campaignId: { $in: campaignIds } })
          .select("campaignId previousNameNormalized newNameNormalized")
          .lean(),
        CampaignNameMapping.find({ tokenId, campaignId: { $in: campaignIds } }).select("campaignId normalizedName").lean(),
      ])
    : [[], []];

  const byHistoricalName = new Map(); // normalized -> Set<campaignId>
  nameHistoryRows.forEach((r) => {
    [r.previousNameNormalized, r.newNameNormalized].forEach((n) => {
      if (!n) return;
      if (!byHistoricalName.has(n)) byHistoricalName.set(n, new Set());
      byHistoricalName.get(n).add(String(r.campaignId));
    });
  });

  const byManualName = new Map(); // normalized -> campaignId (unique per tokenId, enforced in DB)
  mappingRows.forEach((r) => {
    if (r.normalizedName) byManualName.set(r.normalizedName, String(r.campaignId));
  });

  const maps = { byManualName, byCurrentName, byHistoricalName, byId };
  return { byId, resolve: (order) => resolveOrderCampaign(order, maps) };
}

// ── Single-campaign resolver (the Campaign Drawer's /details route) ─
//
// Cheaper variant scoped to one campaignId: does this order's name match
// THIS campaign's current name, any of its own auto-historical names, or
// its own manual mappings? No cross-campaign ambiguity is possible here
// (there's only one candidate), so this never returns
// "ambiguous_historical_name".
export async function buildSingleCampaignResolver({ tokenId, campaignId, currentName }) {
  const id = String(campaignId);
  const byId = new Map([[id, { campaignId: id, currentName: currentName || "", accountId: "", isDeleted: false }]]);

  const byCurrentName = new Map();
  const n = normalizeCampaignName(currentName);
  if (n) byCurrentName.set(n, id);

  const [nameHistoryRows, mappingRows] = await Promise.all([
    CampaignNameHistory.find({ tokenId, campaignId: id }).select("previousNameNormalized newNameNormalized").lean(),
    CampaignNameMapping.find({ tokenId, campaignId: id }).select("normalizedName").lean(),
  ]);

  const byHistoricalName = new Map();
  nameHistoryRows.forEach((r) => {
    [r.previousNameNormalized, r.newNameNormalized].forEach((nn) => {
      if (nn && !byHistoricalName.has(nn)) byHistoricalName.set(nn, new Set([id]));
    });
  });

  const byManualName = new Map();
  mappingRows.forEach((r) => {
    if (r.normalizedName) byManualName.set(r.normalizedName, id);
  });

  const maps = { byManualName, byCurrentName, byHistoricalName, byId };
  return { byId, resolve: (order) => resolveOrderCampaign(order, maps) };
}
