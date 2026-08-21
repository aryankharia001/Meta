import { fbGet, GRAPH_BASE, deriveBudget } from "../lib/metaGraph.js";
import MetaEntityState from "../models/MetaEntityState.js";
import BudgetHistory from "../models/BudgetHistory.js";
import BidCapHistory from "../models/BidCapHistory.js";
import { recordActivity } from "../lib/activityLog.js";

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
].join(",");

const ADSET_STATE_FIELDS = [
  "id", "name", "campaign_id", "status", "effective_status",
  "daily_budget", "lifetime_budget", "bid_strategy", "bid_amount",
].join(",");

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

async function fetchLiveEntity(entityType, entityId, accessToken) {
  const fields = entityType === "campaign" ? CAMPAIGN_FIELDS : ADSET_STATE_FIELDS;
  const meta = await fbGet(`${GRAPH_BASE}/${entityId}?fields=${encodeURIComponent(fields)}&access_token=${accessToken}`);
  const { budget, budgetType } = deriveBudget(meta);
  return {
    name: meta.name || "",
    budget,
    budgetType,
    bidAmount: meta.bid_amount !== undefined && meta.bid_amount !== null && meta.bid_amount !== "" ? Number(meta.bid_amount) / 100 : null,
    bidStrategy: meta.bid_strategy || "",
    status: meta.status || "",
    effectiveStatus: meta.effective_status || "",
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
  const live = await fetchLiveEntity(entityType, entityId, accessToken);

  let prevState = await MetaEntityState.findOne({ tokenId, entityType, entityId });
  const changes = { budget: null, bidCap: null, status: null };

  const source = actingUser ? "App" : "Meta Ads Manager";
  const changedBy = actingUser || "";

  if (!prevState) {
    // First time we've ever seen this entity — establish the baseline,
    // no history row (there's nothing to compare against, and we must
    // never invent a fabricated "previous" value — spec §15).
    prevState = new MetaEntityState({ tokenId, accountId, entityType, entityId, name: live.name });
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

    // Status diff — logged to the existing Activity Log only (spec §5's
    // "Campaign activated/paused" timeline events read from there).
    if (prevState.effectiveStatus && live.effectiveStatus && prevState.effectiveStatus !== live.effectiveStatus) {
      changes.status = { from: prevState.effectiveStatus, to: live.effectiveStatus };
      await recordActivity({
        user: source === "App" ? changedBy : "Meta Ads Manager",
        type: entityType === "campaign" ? "campaign_status_changed" : "adset_status_changed",
        message: `${entityType === "campaign" ? "Campaign" : "Ad Set"} "${live.name || prevState.name}" status changed from ${prevState.effectiveStatus} to ${live.effectiveStatus}`,
        entityType,
        entityId,
        meta: { from: prevState.effectiveStatus, to: live.effectiveStatus, source },
      });
    }
  }

  prevState.accountId = accountId || prevState.accountId;
  prevState.name = live.name || prevState.name;
  prevState.budget = live.budget;
  prevState.budgetType = live.budgetType;
  prevState.bidAmount = live.bidAmount;
  prevState.bidStrategy = live.bidStrategy;
  prevState.status = live.status;
  prevState.effectiveStatus = live.effectiveStatus;
  prevState.lastSyncedAt = new Date();
  await prevState.save();

  return { current: live, changes };
}
