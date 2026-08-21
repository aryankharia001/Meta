import cron from "node-cron";
import MetaEntityState from "../models/MetaEntityState.js";
import Token from "../models/Token.js";
import { reconcileEntity } from "./metaEntitySync.js";

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
// Same running-flag-guard pattern as shiprocketCron.js: if a tick is
// still going when the next one fires, the next one is skipped rather
// than run concurrently.
// ─────────────────────────────────────────────────────────────

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

    const tokenCache = new Map();
    let changed = 0;

    for (const row of rows) {
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

    console.log(`✔ Meta entity sync tick done — ${rows.length} entities checked, ${changed} changed`);
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
