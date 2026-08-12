// ─── One-off migration: re-label orderDate to the correct IST day ───
//
// Why this exists: the Shiprocket sync used to bucket orders into a
// calendar day using UTC midnight-to-midnight windows instead of IST
// midnight-to-midnight (see server/services/shiprocketService.js — now
// fixed to use server/utils/dateIst.js going forward). That meant any
// order actually placed between 12:00 AM and 5:29 AM IST got stored with
// `orderDate` set to the PREVIOUS calendar day, since UTC is 5:30 behind
// IST. `orderCreatedAt` (a real timestamp) was never affected — only the
// `orderDate` string label used for day-bucketed queries was wrong.
//
// This script recomputes `orderDate` for every already-synced order from
// its own `orderCreatedAt`, using the same IST rule the app now uses
// everywhere else, and fixes any that drifted.
//
// Usage:
//   node server/scripts/migrateOrderDatesToIst.mjs           # dry run — reports what WOULD change, writes nothing
//   node server/scripts/migrateOrderDatesToIst.mjs --apply   # actually commits the fix
//
// Safe to re-run: once orderDate matches the IST-derived value, an order
// is a no-op on subsequent runs. Orders with no orderCreatedAt (shouldn't
// happen, but just in case) are left untouched and reported separately —
// there's nothing to recompute from.

import dotenv from "dotenv";
import mongoose from "mongoose";
import Order from "../models/shiprocketorder.js";
import { istDateStr } from "../utils/dateIst.js";

dotenv.config();

const APPLY = process.argv.includes("--apply");
const BATCH_SIZE = 500;
const SAMPLE_SIZE = 25; // how many before/after examples to print

async function main() {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is not set — check your .env");
  }

  console.log(`Connecting to ${process.env.MONGO_URI} …`);
  await mongoose.connect(process.env.MONGO_URI);
  console.log(APPLY ? "Running in APPLY mode — this WILL write changes.\n" : "Running in DRY-RUN mode — nothing will be written.\n");

  let scanned = 0;
  let noTimestamp = 0;
  let alreadyCorrect = 0;
  let toFix = 0;
  const samples = [];
  let batch = [];

  const flushBatch = async () => {
    if (batch.length === 0) return;
    if (APPLY) {
      await Order.bulkWrite(
        batch.map((op) => ({
          updateOne: {
            filter: { _id: op._id },
            update: { $set: { orderDate: op.correctDate } },
          },
        })),
        { ordered: false }
      );
    }
    batch = [];
  };

  const cursor = Order.find({ orderCreatedAt: { $ne: null } })
    .select({ _id: 1, orderId: 1, orderCreatedAt: 1, orderDate: 1 })
    .lean()
    .cursor();

  for await (const doc of cursor) {
    scanned += 1;

    if (!doc.orderCreatedAt) {
      noTimestamp += 1;
      continue;
    }

    const correctDate = istDateStr(new Date(doc.orderCreatedAt));
    if (correctDate === doc.orderDate) {
      alreadyCorrect += 1;
      continue;
    }

    toFix += 1;
    if (samples.length < SAMPLE_SIZE) {
      samples.push({ orderId: doc.orderId, was: doc.orderDate, correctDate, orderCreatedAt: doc.orderCreatedAt });
    }

    batch.push({ _id: doc._id, correctDate });
    if (batch.length >= BATCH_SIZE) await flushBatch();
  }
  await flushBatch();

  // Orders with no orderCreatedAt at all can't be recomputed from a
  // timestamp — surface how many so it's not a silent gap.
  const untouchable = await Order.countDocuments({
    $or: [{ orderCreatedAt: null }, { orderCreatedAt: { $exists: false } }],
  });

  console.log("─".repeat(60));
  console.log(`Scanned:              ${scanned}`);
  console.log(`Already correct:      ${alreadyCorrect}`);
  console.log(`Mislabeled (fixed${APPLY ? "" : " would be"}):  ${toFix}`);
  console.log(`No orderCreatedAt:     ${untouchable} (left untouched — nothing to recompute from)`);
  console.log("─".repeat(60));

  if (samples.length > 0) {
    console.log(`\nSample of ${samples.length} mislabeled order(s):`);
    samples.forEach((s) => {
      console.log(`  ${s.orderId}: orderDate ${s.was} → ${s.correctDate}  (orderCreatedAt: ${new Date(s.orderCreatedAt).toISOString()})`);
    });
  }

  if (!APPLY && toFix > 0) {
    console.log(`\nDry run only — no changes written. Re-run with --apply to fix these ${toFix} order(s).`);
  } else if (APPLY && toFix > 0) {
    console.log(`\nDone — updated ${toFix} order(s).`);
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
