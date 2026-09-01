import { fbGet, GRAPH_BASE, deriveBudget } from "../lib/metaGraph.js";
import MetaEntityState from "../models/MetaEntityState.js";
import BudgetHistory from "../models/BudgetHistory.js";
import BidCapHistory from "../models/BidCapHistory.js";
import { recordActivity } from "../lib/activityLog.js";
// Phase 39 — Campaign Activity History. Additive import only; nothing
// below that pre-dates Phase 39 is changed by importing these two
// functions. seedStatusHistoryBaseline()/recordStatusChange() are the
// only two campaignActivity.js exports this file needs — see that
// module's header for the full picture (period reconstruction, order
// attribution, etc. all live there and are consumed by the route files
// instead).
import { seedStatusHistoryBaseline, recordStatusChange } from "../lib/campaignActivity.js";
// Campaign History Phase — additive import only; nothing above this
// line is touched. See lib/campaignIdentity.js's header for the full
// picture (name history, manual mappings, deleted-campaign detection,
// the shared order-matching resolver used by every route file).
import {
  recordNameChangeIfNeeded,
  markCampaignNoLongerReturned,
  markCampaignReturned,
  isMetaObjectMissingError,
} from "../lib/campaignIdentity.js";

// ─────────────────────────────────────────────────────────────
// Phase 27 — the single place that ever diffs a fresh Meta read against
// the last known value and writes history. Called from three places
// (see the route files + the cron), so there is exactly one diff/write
// code path — no risk of the App-write path and the periodic-poll path
// disagreeing about what counts as a "change".
//
// Meta's current value is always authoritative: this function never
// writes anything back to Meta, it only ever reads Meta and reconciles
// the local snapshot (MetaEntityState) + history to match it. The
// App-write endpoints (campaignControl.js/adsetControl.js) call
// updateEntityFields() themselves *first*, then call this function to
// read back and record what Meta actually confirmed.
// ─────────────────────────────────────────────────────────────

const CAMPAIGN_FIELDS = [
  "id", "name", "status", "effective_status",
  "daily_budget", "lifetime_budget", "bid_strategy",
  // Phase 39 — real Meta-sourced creation timestamp, used only to
  // decide whether the very first CampaignStatusHistory row for a
  // newly-tracked campaign can honestly be labeled "Campaign Created"
  // (see campaignActivity.js's seedStatusHistoryBaseline()). Never used
  // for budget/bid/status diffing above.
  "created_time",
].join(",");

const ADSET_STATE_FIELDS = [
  "id", "name", "campaign_id", "status", "effective_status",
  "daily_budget", "lifetime_budget", "bid_strategy", "bid_amount",
  // Phase 44 — same reasoning as CAMPAIGN_FIELDS' created_time above,
  // extended to Ad Sets now that Ad Set status history is tracked too.
  "created_time",
].join(",");

// Phase 44 — Ad-level polling. Ads have no budget/bid-cap field of
// their own in Meta's Graph API (only status/effective_status and
// parent linkage are meaningful here); AD_STATE_FIELDS reflects that.
const AD_STATE_FIELDS = [
  "id", "name", "adset_id", "campaign_id", "status", "effective_status",
  "created_time",
].join(",");

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

async function fetchLiveEntity(entityType, entityId, accessToken) {
  const fields = entityType === "campaign" ? CAMPAIGN_FIELDS : entityType === "adset" ? ADSET_STATE_FIELDS : AD_STATE_FIELDS;
  const meta = await fbGet(`${GRAPH_BASE}/${entityId}?fields=${encodeURIComponent(fields)}&access_token=${accessToken}`);
  // Ads have no daily_budget/lifetime_budget field at all — deriveBudget()
  // naturally returns {budget: null, budgetType: null} for them, same as
  // it would for any object missing both fields.
  const { budget, budgetType } = deriveBudget(meta);
  return {
    name: meta.name || "",
    budget,
    budgetType,
    bidAmount: meta.bid_amount !== undefined && meta.bid_amount !== null && meta.bid_amount !== "" ? Number(meta.bid_amount) / 100 : null,
    bidStrategy: meta.bid_strategy || "",
    status: meta.status || "",
    effectiveStatus: meta.effective_status || "",
    // Phase 39/44 — present for campaign/adset/ad reads alike now that
    // all three request created_time.
    createdTime: meta.created_time || null,
    // Phase 44 — parent linkage: campaign_id is present on adset/ad
    // reads (null for campaign reads — a campaign has no parent);
    // adset_id is present on ad reads only.
    campaignId: meta.campaign_id || null,
    adsetId: meta.adset_id || null,
  };
}

/**
 * Reads the entity's current values from Meta, diffs against the last
 * known MetaEntityState snapshot, and writes BudgetHistory/BidCapHistory
 * rows + Activity Log entries for anything that changed. Returns the
 * fresh current values plus whatever changes were detected on this call.
 *
 * @param {object} opts
 * @param {string} opts.tokenId
 * @param {string} opts.accountId
 * @param {"campaign"|"adset"} opts.entityType
 * @param {string} opts.entityId
 * @param {string} opts.accessToken
 * @param {string} [opts.actingUser] - when set, this call is immediately
 *   following an App-initiated write by this user; if the diffed value
 *   matches what changed, the history row is attributed to "App" with
 *   this user instead of "Meta Ads Manager".
 */
export async function reconcileEntity({ tokenId, accountId, entityType, entityId, accessToken, actingUser = null }) {
  let prevState = await MetaEntityState.findOne({ tokenId, entityType, entityId });
  // Campaign History Phase — captured before anything below can touch
  // prevState.isDeleted, so a per-ID reconcile that succeeds again after
  // a prior "no longer returned" flag can un-flag it at the end of this
  // function (see the markCampaignReturned() call near the return).
  const wasDeleted = !!(prevState && prevState.isDeleted);

  let live;
  try {
    live = await fetchLiveEntity(entityType, entityId, accessToken);
  } catch (err) {
    // Campaign History Phase — Meta's "object does not exist" signal,
    // narrowly matched (see campaignIdentity.js's isMetaObjectMissingError)
    // so auth/rate-limit/permission errors are NEVER misread as deletion
    // and keep throwing exactly as they did before this phase existed.
    // Only handled for a campaign we already knew about (prevState
    // exists) — a brand-new, never-tracked entity failing its very first
    // fetch is still just a normal error, same as always.
    if (entityType === "campaign" && prevState && isMetaObjectMissingError(err)) {
      await markCampaignNoLongerReturned({
        tokenId,
        accountId,
        entityId,
        entityName: prevState.name,
        previousEffectiveStatus: prevState.effectiveStatus,
      }).catch((markErr) => console.error(`markCampaignNoLongerReturned failed for campaign ${entityId}: ${markErr.message}`));
      return { current: null, changes: { budget: null, bidCap: null, status: null }, noLongerReturned: true };
    }
    throw err;
  }

  const changes = { budget: null, bidCap: null, status: null };

  const source = actingUser ? "App" : "Meta Ads Manager";
  const changedBy = actingUser || "";

  if (!prevState) {
    // First time we've ever seen this entity — establish the baseline,
    // no BudgetHistory/BidCapHistory row (there's nothing to compare
    // against, and we must never invent a fabricated "previous" value —
    // spec §15).
    prevState = new MetaEntityState({
      tokenId,
      accountId,
      entityType,
      entityId,
      name: live.name,
      // Phase 44 — parent linkage for Ad Sets/Ads (blank for campaigns,
      // which have no parent) — see MetaEntityState.js's own header.
      campaignId: live.campaignId || "",
      adsetId: live.adsetId || "",
    });

    // Phase 39 §1/§3 seeded this only for entityType "campaign". Phase
    // 44 §1 extends the exact same honest baseline event to Ad Sets and
    // Ads (Active/Paused/Closed status only — there's no budget/bid-cap
    // concept at the Ad level); seedStatusHistoryBaseline() is
    // entityType-aware now (see campaignActivity.js's own header), so
    // this is safe for whichever entityType reconcileEntity was called
    // with. Safe to do unconditionally here because this whole branch
    // only runs the first time reconcileEntity ever sees this entityId
    // (gated by the same "!prevState" check MetaEntityState's own
    // baseline above is gated on) — whichever code path (this
    // cron/control-route call, or a list-endpoint's own
    // ensureBaseline()/ensureEntityBaselinesBulk()) observes the entity
    // first is the only one that ever seeds it; the other backs off via
    // its own MetaEntityState existence check.
    await seedStatusHistoryBaseline({
      tokenId,
      accountId,
      entityType,
      entityId,
      entityName: live.name,
      effectiveStatus: live.effectiveStatus,
      createdTime: live.createdTime,
    }).catch((err) => console.error(`Status history baseline failed for ${entityType} ${entityId}: ${err.message}`));
  } else {
    // Budget diff
    const prevBudget = prevState.budget;
    if (prevBudget !== null && live.budget !== null && round2(prevBudget) !== round2(live.budget)) {
      const changeAmount = round2(live.budget - prevBudget);
      const changePercent = prevBudget !== 0 ? round2((changeAmount / prevBudget) * 100) : null;
      const row = await BudgetHistory.create({
        tokenId, accountId, entityType, entityId,
        entityName: live.name || prevState.name,
        previousBudget: prevBudget,
        newBudget: live.budget,
        changeAmount,
        changePercent,
        budgetType: live.budgetType,
        source,
        changedBy,
        changedAt: new Date(),
      });
      changes.budget = row;
      await recordActivity({
        user: source === "App" ? changedBy : "Meta Ads Manager",
        type: "budget_changed",
        message: `${source === "App" ? changedBy || "A user" : "Meta Ads Manager"} changed ${entityType === "campaign" ? "Campaign" : "Ad Set"} "${live.name || prevState.name}" Budget from ${prevBudget} to ${live.budget}`,
        entityType,
        entityId,
        meta: { previousBudget: prevBudget, newBudget: live.budget, budgetType: live.budgetType, source },
      });
    } else if (prevBudget === null && live.budget !== null) {
      // Baseline had no budget recorded yet (e.g. row created by a
      // manual sync before the value was known) — adopt silently, no
      // fabricated "previous" value to compare against.
    }

    // Bid cap diff (ad sets only, per the Bid Cap scoping note)
    if (entityType === "adset") {
      const prevBid = prevState.bidAmount;
      if (prevBid !== null && live.bidAmount !== null && round2(prevBid) !== round2(live.bidAmount)) {
        const changeAmount = round2(live.bidAmount - prevBid);
        const changePercent = prevBid !== 0 ? round2((changeAmount / prevBid) * 100) : null;
        const row = await BidCapHistory.create({
          tokenId, accountId, entityType, entityId,
          entityName: live.name || prevState.name,
          previousBidAmount: prevBid,
          newBidAmount: live.bidAmount,
          changeAmount,
          changePercent,
          bidStrategy: live.bidStrategy,
          source,
          changedBy,
          changedAt: new Date(),
        });
        changes.bidCap = row;
        await recordActivity({
          user: source === "App" ? changedBy : "Meta Ads Manager",
          type: "bid_cap_changed",
          message: `${source === "App" ? changedBy || "A user" : "Meta Ads Manager"} changed Ad Set "${live.name || prevState.name}" Bid Cap from ${prevBid} to ${live.bidAmount}`,
          entityType,
          entityId,
          meta: { previousBidAmount: prevBid, newBidAmount: live.bidAmount, bidStrategy: live.bidStrategy, source },
        });
      }
    }

    // Status diff — logged to the existing Activity Log (spec §5's
    // "Campaign activated/paused" timeline events read from there).
    if (prevState.effectiveStatus && live.effectiveStatus && prevState.effectiveStatus !== live.effectiveStatus) {
      changes.status = { from: prevState.effectiveStatus, to: live.effectiveStatus };
      const noun = entityType === "campaign" ? "Campaign" : entityType === "adset" ? "Ad Set" : "Ad";
      await recordActivity({
        user: source === "App" ? changedBy : "Meta Ads Manager",
        type: entityType === "campaign" ? "campaign_status_changed" : entityType === "adset" ? "adset_status_changed" : "ad_status_changed",
        message: `${noun} "${live.name || prevState.name}" status changed from ${prevState.effectiveStatus} to ${live.effectiveStatus}`,
        entityType,
        entityId,
        meta: { from: prevState.effectiveStatus, to: live.effectiveStatus, source },
      });

      // Phase 39 §1/§2/§13 recorded this structured CampaignStatusHistory
      // row for campaigns only. Phase 44 §1 extends it to Ad Sets/Ads
      // too — recordStatusChange() is entityType-aware now (see
      // campaignActivity.js) — so Active/Inactive periods can be
      // reconstructed at every level, not just the campaign. Purely
      // additive alongside the recordActivity() call above, which is
      // untouched. recordStatusChange() itself still no-ops (writes
      // nothing) when the normalized Active/Paused/Closed bucket didn't
      // actually change (e.g. PENDING_REVIEW -> ACTIVE are both
      // "active") — see campaignActivity.js.
      await recordStatusChange({
        tokenId,
        accountId,
        entityType,
        entityId,
        entityName: live.name || prevState.name,
        previousStatus: prevState.effectiveStatus,
        newStatus: live.effectiveStatus,
        source,
        changedBy,
      }).catch((err) => console.error(`Status history record failed for ${entityType} ${entityId}: ${err.message}`));
    }

    // Campaign History Phase — name diff. Campaign-identity concept
    // only (ad sets/ads don't get a name-history collection); dedup and
    // the "never fabricate a previous name" rule both live inside
    // recordNameChangeIfNeeded() itself.
    if (entityType === "campaign") {
      await recordNameChangeIfNeeded({
        tokenId,
        accountId,
        campaignId: entityId,
        previousName: prevState.name,
        newName: live.name,
      }).catch((err) => console.error(`Name history record failed for campaign ${entityId}: ${err.message}`));
    }
  }

  prevState.accountId = accountId || prevState.accountId;
  prevState.name = live.name || prevState.name;
  // Phase 44 — keep parent linkage fresh (e.g. an ad moved to a
  // different ad set) on every reconcile tick, not just at creation.
  prevState.campaignId = live.campaignId || prevState.campaignId;
  prevState.adsetId = live.adsetId || prevState.adsetId;
  prevState.budget = live.budget;
  prevState.budgetType = live.budgetType;
  prevState.bidAmount = live.bidAmount;
  prevState.bidStrategy = live.bidStrategy;
  prevState.status = live.status;
  prevState.effectiveStatus = live.effectiveStatus;
  prevState.lastSyncedAt = new Date();
  await prevState.save();

  // Campaign History Phase — this per-ID fetch just succeeded, so if the
  // campaign was previously flagged "no longer returned" it evidently
  // isn't anymore. Runs strictly after prevState.save() above (a fresh
  // findOne inside markCampaignReturned, never a concurrent write to the
  // same in-memory document) — see that function's own header.
  if (entityType === "campaign" && wasDeleted) {
    await markCampaignReturned({ tokenId, entityId, entityName: live.name, effectiveStatus: live.effectiveStatus }).catch((err) =>
      console.error(`markCampaignReturned failed for campaign ${entityId}: ${err.message}`)
    );
  }

  return { current: live, changes };
}
