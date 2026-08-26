// ─── One-off migration: backfill confirmedAt/cancelledAt for already- ───
// ─── synced Abandoned Cart leads (Phase 40)                          ───
//
// Why this exists: Phase 40 adds confirmedAt/confirmedDateIst and
// cancelledAt/cancelledDateIst to TrafleadAbandonedCartLead, written
// STICKY (first-observed-wins, via MongoDB's $min) from the sync path
// going forward — see trafleadSyncService.js's Phase 40 header comment
// and computeStickyLifecycleFields(). That's correct for every lead
// synced AFTER this phase ships, but a lead that reached "confirmed" or
// "cancelled" BEFORE this phase shipped would otherwise never get that
// date populated: a day already marked "complete" in TrafleadSyncLog is
// only ever re-synced again if it still has a lead in a non-terminal
// SHIPMENT status (see findPendingShipmentOrderDays) — lead-level status
// (confirmed/cancelled) isn't part of that re-sync trigger at all, so an
// already-confirmed lead whose shipment has already gone terminal (or
// whose order date is old enough it's not "today") may never be
// re-fetched from Traflead again.
//
// This script closes that gap using data ALREADY sitting in Mongo — every
// synced lead already has `status` and `lastStatusChange` (both synced
// long before Phase 40). For any lead whose confirmedAt/cancelledAt is
// still unset:
//   status === "confirmed" → confirmedAt = lastStatusChange
//   status === "cancelled" → cancelledAt = lastStatusChange
// Falls back to trafleadCreatedAt when lastStatusChange is missing
// (defensive only — Traflead sets lastStatusChange on every status
// change; a lead confirmed/cancelled with no lastStatusChange at all
// would mean it was created directly in that status) — reported
// separately as an estimate, never silently treated as exact.
//
// This does NOT (and cannot) backfill returnedAt/
// matchedShipmentStatusChangedAt/matchedDeliveredDateIst — those were
// never stored before Phase 40, so there's nothing in Mongo to recompute
// them from. They self-heal automatically via the existing 15-minute
// cron's phone-match batch (runShipmentPhoneMatchBatch) and the
// range-scoped resync (resolveShipmentMatchesForRange) already
// re-checking not-yet-delivered/not-yet-terminal leads — no script
// needed for those.
//
// Usage:
//   node server/scripts/backfillAbandonedCartLifecycleDates.mjs           # dry run — reports what WOULD change, writes nothing
//   node server/scripts/backfillAbandonedCartLifecycleDates.mjs --apply   # actually commits the fix
//
// Safe to re-run: only touches documents where confirmedAt/cancelledAt is
// still unset, so a second run is a no-op for anything the first run
// already fixed.

import dotenv from "dotenv";
import mongoose from "mongoose";
import TrafleadAbandonedCartLead from "../models/TrafleadAbandonedCartLead.js";
import { toIstDateString } from "../utils/dateIst.js";

dotenv.config();

const APPLY = process.argv.includes("--apply");
const BATCH_SIZE = 500;
const SAMPLE_SIZE = 25;

async function main() {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is not set — check your .env");
  }

  console.log(`Connecting to ${process.env.MONGO_URI} …`);
  await mongoose.connect(process.env.MONGO_URI);
  console.log(APPLY ? "Running in APPLY mode — this WILL write changes.\n" : "Running in DRY-RUN mode — nothing will be written.\n");

  const stats = {
    confirmed: { scanned: 0, alreadySet: 0, fixed: 0, estimated: 0, noSource: 0 },
    cancelled: { scanned: 0, alreadySet: 0, fixed: 0, estimated: 0, noSource: 0 },
  };
  const samples = { confirmed: [], cancelled: [] };
  let batch = [];

  const flushBatch = async () => {
    if (batch.length === 0) return;
    if (APPLY) {
      await TrafleadAbandonedCartLead.bulkWrite(
        batch.map((op) => ({
          updateOne: {
            filter: { _id: op._id },
            update: { $set: op.set },
          },
        })),
        { ordered: false }
      );
    }
    batch = [];
  };

  for (const kind of ["confirmed", "cancelled"]) {
    const atField = kind === "confirmed" ? "confirmedAt" : "cancelledAt";
    const dateIstField = kind === "confirmed" ? "confirmedDateIst" : "cancelledDateIst";

    const cursor = TrafleadAbandonedCartLead.find({ status: kind })
      .select({ _id: 1, orderId: 1, trafleadLeadId: 1, status: 1, lastStatusChange: 1, trafleadCreatedAt: 1, [atField]: 1 })
      .lean()
      .cursor();

    for await (const doc of cursor) {
      stats[kind].scanned += 1;

      if (doc[atField]) {
        stats[kind].alreadySet += 1;
        continue;
      }

      let source = doc.lastStatusChange;
      let estimated = false;
      if (!source) {
        source = doc.trafleadCreatedAt;
        estimated = true;
      }

      if (!source) {
        stats[kind].noSource += 1;
        continue;
      }

      const at = new Date(source);
      const dateIst = toIstDateString(at);
      stats[kind].fixed += 1;
      if (estimated) stats[kind].estimated += 1;

      if (samples[kind].length < SAMPLE_SIZE) {
        samples[kind].push({
          orderId: doc.orderId || doc.trafleadLeadId,
          [atField]: at.toISOString(),
          [dateIstField]: dateIst,
          estimated,
        });
      }

      batch.push({ _id: doc._id, set: { [atField]: at, [dateIstField]: dateIst } });
      if (batch.length >= BATCH_SIZE) await flushBatch();
    }
    await flushBatch();
  }

  console.log("─".repeat(60));
  for (const kind of ["confirmed", "cancelled"]) {
    const s = stats[kind];
    console.log(`${kind.toUpperCase()} leads:`);
    console.log(`  Scanned:               ${s.scanned}`);
    console.log(`  Already had a date:    ${s.alreadySet}`);
    console.log(`  Backfilled${APPLY ? "" : " (would be)"}:          ${s.fixed} (${s.estimated} estimated from trafleadCreatedAt — no lastStatusChange)`);
    console.log(`  No source timestamp:   ${s.noSource} (left untouched — nothing to recompute from)`);
  }
  console.log("─".repeat(60));

  for (const kind of ["confirmed", "cancelled"]) {
    if (samples[kind].length > 0) {
      console.log(`\nSample of ${samples[kind].length} backfilled ${kind} lead(s):`);
      samples[kind].forEach((s) => console.log(`  ${JSON.stringify(s)}`));
    }
  }

  const totalFixed = stats.confirmed.fixed + stats.cancelled.fixed;
  if (!APPLY && totalFixed > 0) {
    console.log(`\nDry run only — no changes written. Re-run with --apply to fix these ${totalFixed} lead(s).`);
  } else if (APPLY && totalFixed > 0) {
    console.log(`\nDone — updated ${totalFixed} lead(s).`);
  } else {
    console.log("\nNothing to fix.");
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exitCode = 1;
  mongoose.disconnect().finally(() => {});
});
