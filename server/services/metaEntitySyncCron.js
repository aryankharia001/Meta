import cron from "node-cron";
import MetaEntityState from "../models/MetaEntityState.js";
import Token from "../models/Token.js";
import { reconcileEntity } from "./metaEntitySync.js";
// Phase 39 §4 — bounded auto-tracking. Additive import only.
import { statusBucket, getLastClosedAtMap } from "../lib/campaignActivity.js";

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
    }

    console.log(
      `✔ Meta entity sync tick done — ${rowsToPoll.length} entities checked, ${changed} changed` +
        (skipped ? ` (${skipped} long-closed campaigns skipped)` : "")
    );
  } catch (err) {
    console.error("✖ Meta entity sync tick failed:", err.message);
  } finally {
    running = false;
  }
}

function startMetaEntitySyncCron() {
  // Every 5 minutes.
  cron.schedule("*/5 * * * *", runSyncTick);
  console.log("🕒 Meta entity (budget/bid cap) sync cron scheduled (every 5 minutes)");
}

export default startMetaEntitySyncCron;
export { runSyncTick };
