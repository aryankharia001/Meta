import cron from "node-cron";
import MetaEntityState from "../models/MetaEntityState.js";
import Token from "../models/Token.js";
import { reconcileEntity } from "./metaEntitySync.js";
// Phase 39 §4 — bounded auto-tracking. Additive import only.
import { statusBucket, getLastClosedAtMap } from "../lib/campaignActivity.js";
// Campaign History Phase — additive imports only; nothing above this
// line is touched. fetchAllPages/actIdOf/GRAPH_BASE are the same shared
// Graph helpers Phase 13+ route files already use (lib/metaGraph.js);
// markCampaignNoLongerReturned/markCampaignReturned/touchLastSeen are
// the dedup-guarded read-modify-write helpers in campaignIdentity.js.
import { fetchAllPages, actIdOf, GRAPH_BASE } from "../lib/metaGraph.js";
import { markCampaignNoLongerReturned, markCampaignReturned, touchLastSeen } from "../lib/campaignIdentity.js";

// ─────────────────────────────────────────────────────────────
// Phase 27 — Meta -> App direction of the two-way sync. Meta's Marketing
// API has no webhook for ad account budget/bid changes (Meta webhooks
// only cover Page/Instagram/WhatsApp-type events), so periodic polling
// is "the most reliable available Meta mechanism" per the spec.
//
// Only polls entities that already have a MetaEntityState row — i.e.
// campaigns/ad sets the app has actually shown a drawer for, or that
// have been manually synced at least once — rather than every campaign
// on every connected ad account whether anyone's looked at it or not.
// This bounds Graph API usage to what the user is actually watching.
//
// Phase 39 §4 — as of this phase, routes/campaigns.js's and
// routes/campaignExplorer.js's list endpoints also auto-seed a
// MetaEntityState row for every campaign they display (see
// campaignActivity.js's ensureBaseline()/ensureBaselinesBulk()), so the
// set of rows polled below is now broader than "opened in a drawer at
// least once" — it's "appeared in Campaign Explorer or the Dashboard at
// least once". To keep that from growing the 5-minute Graph API poll
// forever as more historical campaigns get auto-tracked, campaigns
// whose last known status is Closed AND whose most recent
// CampaignStatusHistory "closed" event is more than CLOSED_SKIP_MS old
// are skipped for this tick — they're considered settled. This never
// removes their MetaEntityState row and is fully reversible: opening
// the Campaign Drawer (or the Budget/Bid Cap "current"/refresh action)
// calls reconcileEntity() directly, immediately re-syncing a skipped
// campaign and resuming normal polling for it on the next tick. Ad sets
// are entirely unaffected by this filter.
//
// Same running-flag-guard pattern as shiprocketCron.js: if a tick is
// still going when the next one fires, the next one is skipped rather
// than run concurrently.
// ─────────────────────────────────────────────────────────────

const CLOSED_SKIP_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

// Meta's ad-account-level rate limit ("There have been too many calls
// to this ad-account...", error code 80004) is triggered by call
// *volume* against one ad account in a short window — retrying after
// the fact (fbGet()/fbPost() in lib/metaGraph.js and metaGraphWrite.js
// already do that) helps recover, but the actual fix for a tick that
// polls many entities is to not fire them back-to-back with zero delay
// in the first place. A small pause between each sequential per-entity
// call spreads a tick's calls out over time instead of bursting them,
// without changing what gets polled or how often the tick itself runs.
const ENTITY_POLL_DELAY_MS = 400;
const ACCOUNT_LIST_DELAY_MS = 500;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let running = false;

async function runSyncTick() {
  if (running) {
    console.log("⏭ Meta entity sync skipped — a sync is already running");
    return;
  }
  running = true;
  try {
    const rows = await MetaEntityState.find({}).lean();
    if (!rows.length) return;

    // Phase 39 §4 — filter out long-closed campaigns before polling.
    // Ad set rows and any campaign not confirmed closed pass through
    // untouched; only campaigns whose CampaignStatusHistory confirms a
    // "closed" event older than CLOSED_SKIP_MS are skipped.
    const closedCampaignIds = rows
      .filter((r) => r.entityType === "campaign" && statusBucket(r.effectiveStatus) === "closed")
      .map((r) => r.entityId);
    const lastClosedAtMap = await getLastClosedAtMap({ entityIds: closedCampaignIds });
    const now = Date.now();
    const rowsToPoll = rows.filter((r) => {
      if (r.entityType !== "campaign" || statusBucket(r.effectiveStatus) !== "closed") return true;
      const closedAt = lastClosedAtMap.get(String(r.entityId));
      if (!closedAt) return true; // no confirmed closedAt yet — keep polling to be safe
      return now - closedAt.getTime() <= CLOSED_SKIP_MS;
    });
    const skipped = rows.length - rowsToPoll.length;

    const tokenCache = new Map();
    let changed = 0;

    for (const row of rowsToPoll) {
      try {
        let token = tokenCache.get(String(row.tokenId));
        if (token === undefined) {
          token = await Token.findById(row.tokenId).lean();
          tokenCache.set(String(row.tokenId), token || null);
        }
        if (!token) continue;

        const { changes } = await reconcileEntity({
          tokenId: row.tokenId,
          accountId: row.accountId,
          entityType: row.entityType,
          entityId: row.entityId,
          accessToken: token.accessToken,
        });
        if (changes.budget || changes.bidCap || changes.status) changed += 1;
      } catch (err) {
        console.error(`Meta entity sync failed for ${row.entityType} ${row.entityId}: ${err.message}`);
      }
      // Pace this tick's Graph API calls instead of firing them back-to-
      // back — see ENTITY_POLL_DELAY_MS's comment above.
      await sleep(ENTITY_POLL_DELAY_MS);
    }

    console.log(
      `✔ Meta entity sync tick done — ${rowsToPoll.length} entities checked, ${changed} changed` +
        (skipped ? ` (${skipped} long-closed campaigns skipped)` : "")
    );

    // Campaign History Phase — bulk list-and-diff pass, additive after
    // the per-ID polling above. Per-ID polling (reconcileEntity's own
    // 404 catch) only ever notices a campaign is gone once it happens to
    // poll that exact ID and the fetch fails a specific way; this pass
    // instead asks Meta "what campaigns does this account have right
    // now" once per distinct tracked account and diffs the id set
    // against every MetaEntityState campaign row for that account — the
    // only way to reliably catch a campaign that Meta simply stopped
    // listing (spec §9/§10) rather than one whose direct-ID GET happens
    // to error a recognizable way. Fully self-contained try/catch so a
    // failure here can never affect the polling tick above.
    await runDeletedCampaignDetectionPass().catch((err) =>
      console.error("✖ Deleted-campaign detection pass failed:", err.message)
    );
  } catch (err) {
    console.error("✖ Meta entity sync tick failed:", err.message);
  } finally {
    running = false;
  }
}

async function runDeletedCampaignDetectionPass() {
  const campaignRows = await MetaEntityState.find({ entityType: "campaign" })
    .select("tokenId accountId entityId isDeleted name effectiveStatus")
    .lean();
  if (!campaignRows.length) return;

  // Group by (tokenId, accountId) — a bulk campaign-list call is scoped
  // to one ad account, never one per campaign.
  const groups = new Map();
  for (const row of campaignRows) {
    if (!row.accountId) continue; // can't list an account we don't know — leave untouched, not guessed at
    const key = `${row.tokenId}::${row.accountId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const tokenCache = new Map();
  let markedDeleted = 0;
  let markedReturned = 0;

  for (const [key, rows] of groups.entries()) {
    const sep = key.indexOf("::");
    const tokenId = key.slice(0, sep);
    const accountId = key.slice(sep + 2);
    try {
      let token = tokenCache.get(tokenId);
      if (token === undefined) {
        token = await Token.findById(tokenId).lean();
        tokenCache.set(tokenId, token || null);
      }
      if (!token) continue;

      const liveRows = await fetchAllPages(
        `${GRAPH_BASE}/${actIdOf(accountId)}/campaigns?fields=id&limit=500&access_token=${token.accessToken}`
      );
      const liveIds = new Set(liveRows.map((c) => String(c.id)));

      const toMarkDeleted = rows.filter((r) => !liveIds.has(String(r.entityId)) && !r.isDeleted);
      const toMarkReturned = rows.filter((r) => liveIds.has(String(r.entityId)) && r.isDeleted);
      const stillLiveIds = rows.filter((r) => liveIds.has(String(r.entityId)) && !r.isDeleted).map((r) => r.entityId);

      for (const row of toMarkDeleted) {
        await markCampaignNoLongerReturned({
          tokenId,
          accountId,
          entityId: row.entityId,
          entityName: row.name,
          previousEffectiveStatus: row.effectiveStatus,
        });
        markedDeleted += 1;
      }
      for (const row of toMarkReturned) {
        await markCampaignReturned({ tokenId, entityId: row.entityId, entityName: row.name });
        markedReturned += 1;
      }
      if (stillLiveIds.length) await touchLastSeen({ tokenId, entityIds: stillLiveIds });
    } catch (err) {
      console.error(`Deleted-campaign detection failed for account ${accountId}: ${err.message}`);
    }
    // Same pacing rationale as the per-entity loop above, scoped to
    // however many distinct ad accounts this pass is bulk-listing.
    await sleep(ACCOUNT_LIST_DELAY_MS);
  }

  if (markedDeleted || markedReturned) {
    console.log(`🔍 Deleted-campaign detection — ${markedDeleted} newly flagged no-longer-returned, ${markedReturned} reappeared`);
  }
}

function startMetaEntitySyncCron() {
  // Every 5 minutes.
  cron.schedule("*/5 * * * *", runSyncTick);
  console.log("🕒 Meta entity (budget/bid cap) sync cron scheduled (every 5 minutes)");
}

export default startMetaEntitySyncCron;
export { runSyncTick };
