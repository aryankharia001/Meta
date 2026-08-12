import cron from "node-cron";
import {
  backfillShiprocketRange,
  getBackfillState,
} from "../services/shiprocketService.js";
import { todayIstIso } from "../utils/dateIst.js";

// ─── Auto-sync today's Shiprocket orders every 30 minutes ──────
//
// Reuses the exact same write-path function the manual "Start Fetch"
// button calls (backfillShiprocketRange), just pointed at today's date
// on a timer. No new fetch/save logic here on purpose:
//
//   - backfillShiprocketRange -> syncDayWithRetry already skips any
//     orderId already stored in Mongo before calling the Shiprocket
//     detail API for it (saves API calls on every re-run).
//   - Saving uses updateOne({ filter: { orderId }, upsert: true }), so
//     even if the same order is fetched twice, Mongo upserts instead of
//     inserting a second document — no duplicates.
//   - If a run is still in progress (this tick, or a manual backfill
//     kicked off from the UI) when the next tick fires, it's skipped
//     rather than run concurrently.
//
// NOTE: the upsert-by-orderId dedup only fully holds if `orderId` has a
// unique index on the ShiprocketOrder schema. Double check that.

function startShiprocketAutoSync() {
  // Every 30 minutes, on the hour and half hour (00, 30).
  cron.schedule("*/30 * * * *", async () => {
    if (getBackfillState().running) {
      console.log("⏭ Shiprocket auto-sync skipped — a sync is already running");
      return;
    }

    const today = todayIstIso();
    console.log(`⏱ Shiprocket auto-sync: fetching orders for ${today}`);

    try {
      await backfillShiprocketRange(today, today);
      console.log(`✔ Shiprocket auto-sync done for ${today}`);
    } catch (err) {
      console.error(`✖ Shiprocket auto-sync failed for ${today}:`, err.message);
    }
  });

  console.log("🕒 Shiprocket auto-sync cron scheduled (every 30 minutes)");
}

export default startShiprocketAutoSync;