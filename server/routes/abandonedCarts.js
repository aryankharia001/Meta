import express from "express";
import AbandonedCart from "../models/AbandonedCart.js";
import { recordActivity } from "../lib/activityLog.js";

const router = express.Router();

// ─────────────────────────────────────────────────────────────
// Phase 22 §5/§9 — Abandoned Cart CRUD, mounted at /api/abandoned-carts
// (behind the same global requireAuth gate as every other /api route —
// see server/index.js). Entirely new, additive route file; nothing
// about Meta<->Shiprocket sync, campaign/order matching, or logistics
// is touched here, and abandoned-cart orders are never written to
// ShiprocketOrder or any collection order/campaign matching reads from
// (§8).
//
// §2/§3/§10 — every derived figure (Expected Delivered Orders, Gross
// Potential Revenue, Recognized Abandoned Cart Revenue, and the four
// expense lines) is computed HERE, once, in computeDerived() below, and
// returned alongside the raw stored fields on every read/write response.
// Both the Management Table (AbandonedCartsPage.jsx) and the Dashboard
// read the exact same numbers — neither recomputes this math itself —
// so there is exactly one source of truth for how a delivery rate turns
// into recognized revenue/expenses.
//
// Design note on WHY expenses scale with Expected Delivered Orders (not
// the full raw order count): an abandoned cart only actually incurs
// manufacturing/packaging/shipping cost once it's recovered/converted
// into a real, fulfilled order — same reasoning as why recognizedRevenue
// isn't the full `orders × avgOrderValue` (potentialRevenue). Both
// revenue and cost are scaled by the same deliveryRate.
// ─────────────────────────────────────────────────────────────

function computeDerived(doc) {
  const orders = Number(doc.orders) || 0;
  const avgOrderValue = Number(doc.avgOrderValue) || 0;
  const deliveryRate = Number(doc.deliveryRate) || 0;
  const manufacturingCost = Number(doc.manufacturingCost) || 0;
  const packagingCost = Number(doc.packagingCost) || 0;
  const shippingCost = Number(doc.shippingCost) || 0;
  const miscCost = Number(doc.miscCost) || 0;

  // §2 — "Expected Delivered Orders = Orders × Delivery Rate".
  const expectedDelivered = orders * (deliveryRate / 100);

  // §7 — "Gross Potential Revenue": the full, undiscounted figure, shown
  // for context only — never added into recognized revenue/profit math.
  const potentialRevenue = orders * avgOrderValue;

  // §2/§10 — the ONLY revenue figure that's ever treated as real.
  const recognizedRevenue = expectedDelivered * avgOrderValue;

  // §3 — expense breakdown, "Do not silently hide expenses": each cost
  // category shown individually, all four scaled by Expected Delivered
  // Orders (see design note above).
  const manufacturingExpense = expectedDelivered * manufacturingCost;
  const packagingExpense = expectedDelivered * packagingCost;
  const shippingExpense = expectedDelivered * shippingCost;
  const miscExpense = expectedDelivered * miscCost;
  const totalExpenses = manufacturingExpense + packagingExpense + shippingExpense + miscExpense;

  const netContribution = recognizedRevenue - totalExpenses;

  return {
    expectedDelivered,
    potentialRevenue,
    recognizedRevenue,
    manufacturingExpense,
    packagingExpense,
    shippingExpense,
    miscExpense,
    totalExpenses,
    netContribution,
  };
}

function shape(doc) {
  return {
    id: String(doc._id),
    date: doc.date,
    orders: doc.orders,
    avgOrderValue: doc.avgOrderValue,
    deliveryRate: doc.deliveryRate,
    manufacturingCost: doc.manufacturingCost,
    packagingCost: doc.packagingCost,
    shippingCost: doc.shippingCost,
    miscCost: doc.miscCost,
    notes: doc.notes || "",
    ...computeDerived(doc),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function summarize(records) {
  return records.reduce(
    (acc, r) => ({
      orders: acc.orders + (r.orders || 0),
      expectedDelivered: acc.expectedDelivered + (r.expectedDelivered || 0),
      potentialRevenue: acc.potentialRevenue + (r.potentialRevenue || 0),
      recognizedRevenue: acc.recognizedRevenue + (r.recognizedRevenue || 0),
      totalExpenses: acc.totalExpenses + (r.totalExpenses || 0),
      netContribution: acc.netContribution + (r.netContribution || 0),
    }),
    { orders: 0, expectedDelivered: 0, potentialRevenue: 0, recognizedRevenue: 0, totalExpenses: 0, netContribution: 0 }
  );
}

const VALIDATE = ({ date, orders, avgOrderValue, deliveryRate }) => {
  if (!date) return "Date is required";
  if (orders === undefined || orders === null || Number(orders) < 0) return "A valid number of abandoned cart orders is required";
  if (avgOrderValue === undefined || avgOrderValue === null || Number(avgOrderValue) < 0) return "A valid average order value is required";
  if (deliveryRate === undefined || deliveryRate === null || Number(deliveryRate) < 0 || Number(deliveryRate) > 100)
    return "Delivery/Success Rate must be between 0 and 100";
  return null;
};

// GET /api/abandoned-carts?since=YYYY-MM-DD&until=YYYY-MM-DD
// Phase 22 §6 — Dashboard integration reads this with since/until set to
// whatever preset/custom range is selected; the Management Table
// (§9) reads it with no params for the full list. Same route, same
// shape, single source of truth either way.
router.get("/", async (req, res) => {
  try {
    const { since, until } = req.query;
    const filter = {};
    if (since || until) {
      filter.date = {};
      if (since) filter.date.$gte = since;
      if (until) filter.date.$lte = until;
    }
    const docs = await AbandonedCart.find(filter).sort({ date: -1 }).lean();
    const records = docs.map(shape);
    res.json({ success: true, records, summary: summarize(records) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const doc = await AbandonedCart.findById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: "Abandoned cart record not found" });
    res.json({ success: true, record: shape(doc) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/", async (req, res) => {
  try {
    const { date, orders, avgOrderValue, deliveryRate, manufacturingCost, packagingCost, shippingCost, miscCost, notes } = req.body || {};
    const validationError = VALIDATE({ date, orders, avgOrderValue, deliveryRate });
    if (validationError) return res.status(400).json({ success: false, message: validationError });

    const existing = await AbandonedCart.findOne({ date });
    if (existing) {
      return res.status(409).json({ success: false, message: `A record for ${date} already exists — edit it instead of creating a duplicate.` });
    }

    const doc = await AbandonedCart.create({
      date,
      orders: Number(orders) || 0,
      avgOrderValue: Number(avgOrderValue) || 0,
      deliveryRate: Number(deliveryRate) || 0,
      manufacturingCost: Number(manufacturingCost) || 0,
      packagingCost: Number(packagingCost) || 0,
      shippingCost: Number(shippingCost) || 0,
      miscCost: Number(miscCost) || 0,
      notes: (notes || "").trim(),
    });

    await recordActivity({
      user: req.user?.email,
      type: "abandoned_cart_added",
      message: `Abandoned cart record added (${doc.date} — ${doc.orders} orders @ ${doc.deliveryRate}% delivery rate)`,
      entityType: "abandonedCart",
      entityId: String(doc._id),
    });

    res.json({ success: true, record: shape(doc) });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: "A record for that date already exists — edit it instead of creating a duplicate." });
    }
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const doc = await AbandonedCart.findById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: "Abandoned cart record not found" });

    const { date, orders, avgOrderValue, deliveryRate, manufacturingCost, packagingCost, shippingCost, miscCost, notes } = req.body || {};

    if (date !== undefined && date !== doc.date) {
      const clash = await AbandonedCart.findOne({ date, _id: { $ne: doc._id } });
      if (clash) return res.status(409).json({ success: false, message: `A record for ${date} already exists.` });
      doc.date = date;
    }
    if (orders !== undefined) doc.orders = Math.max(0, Number(orders) || 0);
    if (avgOrderValue !== undefined) doc.avgOrderValue = Math.max(0, Number(avgOrderValue) || 0);
    if (deliveryRate !== undefined) doc.deliveryRate = Math.min(100, Math.max(0, Number(deliveryRate) || 0));
    if (manufacturingCost !== undefined) doc.manufacturingCost = Math.max(0, Number(manufacturingCost) || 0);
    if (packagingCost !== undefined) doc.packagingCost = Math.max(0, Number(packagingCost) || 0);
    if (shippingCost !== undefined) doc.shippingCost = Math.max(0, Number(shippingCost) || 0);
    if (miscCost !== undefined) doc.miscCost = Math.max(0, Number(miscCost) || 0);
    if (notes !== undefined) doc.notes = (notes || "").trim();

    await doc.save();

    await recordActivity({
      user: req.user?.email,
      type: "abandoned_cart_updated",
      message: `Abandoned cart record updated (${doc.date})`,
      entityType: "abandonedCart",
      entityId: String(doc._id),
    });

    res.json({ success: true, record: shape(doc) });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ success: false, message: "A record for that date already exists." });
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const doc = await AbandonedCart.findByIdAndDelete(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: "Abandoned cart record not found" });

    await recordActivity({
      user: req.user?.email,
      type: "abandoned_cart_deleted",
      message: `Abandoned cart record deleted (${doc.date})`,
      entityType: "abandonedCart",
      entityId: String(doc._id),
    });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
