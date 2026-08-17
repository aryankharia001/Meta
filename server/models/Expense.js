import mongoose from "mongoose";

// ─────────────────────────────────────────────────────────────
// Phase 16 §7/§8/§19 — operating expenses. Entirely new, additive
// model. `category` is a free-text field on purpose — §7 explicitly
// says "do not hard-code only these categories," so there's no enum
// here, just a handful of suggested categories offered client-side.
// `frequency` IS a fixed enum since the allocation math in
// server/lib/expenseAllocation.js needs to know which known rule to
// apply — an open text field there would make the math undefined.
//
// Phase 20 §4 — "per-order" added as a sixth frequency. Every prior
// frequency (daily/weekly/monthly/yearly/one-time) is TIME-based: it
// contributes to a reporting range via calendar-day math regardless of
// how many orders fell in that range. A per-order expense (Misc, COD
// Handling, Payment Gateway Fee, …) is the opposite — it scales with
// ORDER COUNT, not days, so it needs a completely different allocation
// rule (server/lib/expenseAllocation.js's perOrderExpenseForOrders(),
// not dailyEquivalentForDate()/operatingExpenseForRange()). Keeping it
// as one more `frequency` value on the SAME Expense model (rather than
// a second model) means it reuses the exact same CRUD route, the exact
// same "active"/date-window/category plumbing, and — critically — the
// exact same single source of truth for "what per-order-cost-type
// expenses exist right now" that routes/profitability.js already reads
// (ctx.activeExpenses) for operating expenses, so a per-order expense
// can never be double-counted by accidentally also being summed by the
// day-based functions (those explicitly skip frequency === "per-order",
// see expenseAllocation.js).
//
// `appliesTo` is only meaningful when frequency === "per-order": which
// orders this flat per-order amount applies to. "all" (default) covers
// Miscellaneous Per-Order Cost; "prepaid" is for Payment Gateway
// Charges (only prepaid orders go through a payment gateway); "cod" is
// for COD-related handling cost (only COD orders incur it). Ignored
// (but harmless) for the five time-based frequencies.
const expenseSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    category: { type: String, required: true, trim: true },
    amount: { type: Number, required: true, min: 0 },
    frequency: { type: String, enum: ["daily", "weekly", "monthly", "yearly", "one-time", "per-order"], required: true },
    appliesTo: { type: String, enum: ["all", "prepaid", "cod"], default: "all" },
    // Plain YYYY-MM-DD strings, same convention every date field in this
    // app already uses (ShiprocketOrder.orderDate, Daily's since/until).
    startDate: { type: String, required: true },
    endDate: { type: String, default: null },
    notes: { type: String, trim: true, default: "" },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.models.Expense || mongoose.model("Expense", expenseSchema);
