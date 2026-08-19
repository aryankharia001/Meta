import mongoose from "mongoose";

// ─────────────────────────────────────────────────────────────
// DEPRECATED as of Phase 25 — "Store & Fetch Real Abandoned Cart
// Orders" replaced manual daily-total entry (this model) with real,
// individual abandoned-cart orders written automatically from
// postbacks. See models/AbandonedCartOrder.js (the new per-order
// collection) and models/AbandonedCartSettings.js (the new global
// delivery-rate/cost config that replaces this model's per-record
// deliveryRate/*Cost fields).
//
// Nothing in the app imports this file anymore (routes/abandonedCarts.js
// now reads AbandonedCartOrder instead). It's left in place, untouched,
// purely so any pre-existing "abandonedcarts" collection data from
// before this phase is never destroyed by a migration — it's simply no
// longer read from. Safe to delete once you've confirmed you don't need
// that historical manually-entered data for anything.
// ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────
// Phase 22 — Abandoned Cart daily records.
//
// One document per calendar date (plain "YYYY-MM-DD" string, same
// convention every other date field in this app already uses —
// ShiprocketOrder.orderDate, Expense.startDate, Daily's since/until —
// which keeps lexicographic sort/range-query ($gte/$lte) equivalent to
// chronological order). Each record is fully independent and carries
// its OWN order count, average order value, delivery/success rate, and
// flat per-order costs, so historical dates can each have different
// assumptions (§4/§10 — "the delivery rate must be configurable per
// abandoned-cart record/day").
//
// Genuinely DB-persisted (never localStorage — §5), reached only through
// server/routes/abandonedCarts.js's CRUD routes. Entirely new/additive:
// nothing about Meta<->Shiprocket sync, campaign/order matching, or
// logistics is touched by this model or its routes, and abandoned-cart
// orders are never written into ShiprocketOrder or any other collection
// that feeds order/campaign matching (§8).
// ─────────────────────────────────────────────────────────────

const abandonedCartSchema = new mongoose.Schema(
  {
    date: { type: String, required: true, unique: true, trim: true, index: true }, // YYYY-MM-DD
    orders: { type: Number, required: true, min: 0, default: 0 },
    avgOrderValue: { type: Number, required: true, min: 0, default: 0 },
    // Percentage (0-100) — §2/§10: "Recognized Abandoned Cart Revenue =
    // Orders × Delivery Rate × Average Order Value". Only this fraction
    // of the orders/revenue/expenses below is ever treated as real.
    deliveryRate: { type: Number, required: true, min: 0, max: 100, default: 0 },
    manufacturingCost: { type: Number, min: 0, default: 0 }, // per order
    packagingCost: { type: Number, min: 0, default: 0 }, // per order
    shippingCost: { type: Number, min: 0, default: 0 }, // per order
    miscCost: { type: Number, min: 0, default: 0 }, // per order
    notes: { type: String, trim: true, default: "" },
  },
  { timestamps: true }
);

export default mongoose.models.AbandonedCart || mongoose.model("AbandonedCart", abandonedCartSchema);
