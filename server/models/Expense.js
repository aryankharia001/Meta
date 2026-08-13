import mongoose from "mongoose";

// ─────────────────────────────────────────────────────────────
// Phase 16 §7/§8/§19 — operating expenses. Entirely new, additive
// model. `category` is a free-text field on purpose — §7 explicitly
// says "do not hard-code only these categories," so there's no enum
// here, just a handful of suggested categories offered client-side.
// `frequency` IS a fixed enum (daily/weekly/monthly/yearly/one-time)
// since §8 lists exactly these five and profitability.js's allocation
// math needs to know which of five known rules to apply — an open
// text field there would make the math undefined.
// ─────────────────────────────────────────────────────────────

const expenseSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    category: { type: String, required: true, trim: true },
    amount: { type: Number, required: true, min: 0 },
    frequency: { type: String, enum: ["daily", "weekly", "monthly", "yearly", "one-time"], required: true },
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
