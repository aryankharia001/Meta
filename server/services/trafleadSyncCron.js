import cron from "node-cron";
import {
  backfillTrafleadRange,
  getBackfillState,
  findPendingShipmentOrderDays,
  runShipmentPhoneMatchBatch,
} from "./trafleadSyncService.js";
import { todayIstIso } from "../utils/dateIst.js";

// ─── Auto-sync today's Traflead Abandoned Cart leads every 15 minutes ──
//
// Same reasoning as shiprocketCron.js: reuses the exact write-path
// function the manual "Sync now" button calls (backfillTrafleadRange),
// just pointed at today's IST date on a timer, so statuses updated in
// Traflead (processing -> confirmed -> shipment delivered, etc.) show up
// in Meta without anyone having to click anything. Skipped if a sync
// (cron or manual) is already running.
//
// Phase 34 — after today, also force-resync a bounded batch of OLDER
// days that still have at least one lead in a non-terminal shipment
// status (findPendingShipmentOrderDays — see trafleadSyncService.js's
// header comment for why this is necessary: a day marked "complete" is
// otherwise never re-fetched, so a shipment that delivers a week after
// its order date would never have that delivered status/date picked up
// without this). Sequential, not parallel — backfillTrafleadRange is
// single-flight and throws if already running.
async function runPendingShipmentResync() {
  let pendingDays = [];
  try {
    pendingDays = await findPendingShipmentOrderDays();
  } catch (err) {
    console.error("✖ Failed to look up days with unresolved Traflead shipments:", err.message);
    return;
  }

  if (pendingDays.length === 0) return;

  console.log(`⏱ Traflead auto-sync: re-checking shipment status for ${pendingDays.length} day(s) with unresolved shipments: ${pendingDays.join(", ")}`);

  for (const day of pendingDays) {
    if (getBackfillState().running) {
      console.log("⏭ Pending-shipment re-sync stopped early — another sync started");
      return;
    }
    try {
      await backfillTrafleadRange(day, day, { force: true });
    } catch (err) {
      console.error(`✖ Pending-shipment re-sync failed for ${day}:`, err.message);
    }
  }
}

// Phase 35 — the phone-based shipment match is resolved here, on the
// same 15-minute tick, NOT inside any request handler (see
// trafleadSyncService.js's Phase 35 header comment for why: it's a live
// per-phone call to Traflead's public endpoint, and a page load must
// never trigger a burst of those). Bounded to one small batch per tick
// (default 25 leads) so it never competes meaningfully with the lead
// sync above or piles up outbound calls to Traflead.
async function runPendingPhoneMatchResync() {
  try {
    const result = await runShipmentPhoneMatchBatch();
    if (result.checked > 0) {
      console.log(
        `⏱ Traflead auto-sync: phone-matched ${result.checked} Abandoned Cart order(s) — ${result.matched} found a shipment, ${result.delivered} delivered${
          result.errors ? `, ${result.errors} lookup error(s)` : ""
        }`
      );
    }
  } catch (err) {
    console.error("✖ Phase 35 phone-match batch failed:", err.message);
  }
}

function startTrafleadSyncCron() {
  cron.schedule("*/15 * * * *", async () => {
    if (getBackfillState().running) {
      console.log("⏭ Traflead auto-sync skipped — a sync is already running");
      return;
    }

    const today = todayIstIso();
    console.log(`⏱ Traflead auto-sync: fetching Abandoned Cart leads for ${today}`);

    try {
      await backfillTrafleadRange(today, today);
      console.log(`✔ Traflead auto-sync done for ${today}`);
    } catch (err) {
      console.error(`✖ Traflead auto-sync failed for ${today}:`, err.message);
      return;
    }

    await runPendingShipmentResync();
    // Phase 35 — runs regardless of whether runPendingShipmentResync()
    // found anything; it's an entirely independent background job (its
    // own bounded batch, its own Traflead calls) that just happens to
    // share this same 15-minute timer.
    await runPendingPhoneMatchResync();
  });

  console.log(
    "🕒 Traflead Abandoned Cart auto-sync cron scheduled (every 15 minutes, plus pending-shipment re-sync and Phase 35 phone-match resync)"
  );
}

export default startTrafleadSyncCron;
