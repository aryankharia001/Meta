import express from "express";
import Expense from "../models/Expense.js";
import { recordActivity } from "../lib/activityLog.js";
import { dailyEquivalentForDate, operatingExpenseForRange } from "../lib/expenseAllocation.js";
import { todayIstIso } from "../utils/dateIst.js";

const router = express.Router();

// ─────────────────────────────────────────────────────────────
// Phase 16 §7/§8/§19 — Operating Expenses. Entirely new, additive route
// file (mounted at /api/expenses), behind the same global requireAuth
// gate as every other /api route. Simple CRUD; the only "smart" bit is
// exposing each row's today-equivalent daily amount (via
// lib/expenseAllocation.js) so the Expenses page can show it inline —
// the actual period allocation used in profit math lives in
// profitability.js, not here.
// ─────────────────────────────────────────────────────────────

function shape(e) {
  return {
    id: String(e._id),
    name: e.name,
    category: e.category,
    amount: e.amount,
    frequency: e.frequency,
    startDate: e.startDate,
    endDate: e.endDate || null,
    notes: e.notes || "",
    active: e.active !== false,
    dailyEquivalent: Math.round(dailyEquivalentForDate(e, todayIstIso()) * 100) / 100,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}

router.get("/", async (req, res) => {
  try {
    const expenses = await Expense.find({}).sort({ createdAt: -1 }).lean();
    res.json({ success: true, expenses: expenses.map(shape) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// Phase 28 §2 — GET /breakdown?since=&until= — read-only, additive.
// Returns each active, TIME-based configured Expense's allocated amount
// for one date range, reusing the exact same operatingExpenseForRange()
// pure function server/routes/profitability.js's own
// operatingExpenseBreakdown() already calls — so this can never disagree
// with Profitability's own numbers for the same expense/range. Declared
// before "/:id" (elsewhere in this file) so "breakdown" is never
// swallowed as an :id lookup.
//
// Per-order frequency expenses are excluded on purpose: they scale with
// order count, not calendar days (see the Expense model's own comment),
// so operatingExpenseForRange()/dailyEquivalentForDate() already treat
// them as contributing 0 to every day — filtered out here too so the
// response never lists a per-order-frequency row with a misleading ₹0.
// Nothing here writes anything, and nothing here touches order sync,
// campaign matching, or abandoned-cart logic.
router.get("/breakdown", async (req, res) => {
  try {
    const { since, until } = req.query;
    if (!since || !until) return res.status(400).json({ success: false, message: "since and until are required" });

    const expenses = await Expense.find({ active: true, frequency: { $ne: "per-order" } }).lean();
    const rows = expenses
      .map((e) => ({
        expenseId: String(e._id),
        name: e.name,
        category: e.category,
        frequency: e.frequency,
        startDate: e.startDate,
        endDate: e.endDate || null,
        notes: e.notes || "",
        configuredAmount: e.amount,
        amount: Math.round(operatingExpenseForRange([e], since, until) * 100) / 100,
      }))
      .filter((row) => row.amount > 0)
      .sort((a, b) => b.amount - a.amount);

    const total = Math.round(rows.reduce((sum, r) => sum + r.amount, 0) * 100) / 100;

    res.json({ success: true, since, until, expenses: rows, total });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

const FREQUENCIES = ["daily", "weekly", "monthly", "yearly", "one-time"];

router.post("/", async (req, res) => {
  try {
    const { name, category, amount, frequency, startDate, endDate, notes } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ success: false, message: "Expense name is required" });
    if (!category || !String(category).trim()) return res.status(400).json({ success: false, message: "Category is required" });
    if (amount === undefined || Number(amount) < 0) return res.status(400).json({ success: false, message: "A valid amount is required" });
    if (!FREQUENCIES.includes(frequency)) return res.status(400).json({ success: false, message: "frequency must be one of " + FREQUENCIES.join(", ") });
    if (!startDate) return res.status(400).json({ success: false, message: "Start date is required" });

    const expense = await Expense.create({
      name: String(name).trim(),
      category: String(category).trim(),
      amount: Number(amount),
      frequency,
      startDate,
      endDate: endDate || null,
      notes: (notes || "").trim(),
    });

    await recordActivity({
      user: req.user?.email,
      type: "expense_added",
      message: `Expense added (${expense.name} — ${expense.category})`,
      entityType: "expense",
      entityId: String(expense._id),
    });

    res.json({ success: true, expense: shape(expense) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const expense = await Expense.findById(req.params.id);
    if (!expense) return res.status(404).json({ success: false, message: "Expense not found" });

    const { name, category, amount, frequency, startDate, endDate, notes, active } = req.body || {};
    if (name !== undefined) expense.name = String(name).trim();
    if (category !== undefined) expense.category = String(category).trim();
    if (amount !== undefined) expense.amount = Number(amount) || 0;
    if (frequency !== undefined) {
      if (!FREQUENCIES.includes(frequency)) return res.status(400).json({ success: false, message: "frequency must be one of " + FREQUENCIES.join(", ") });
      expense.frequency = frequency;
    }
    if (startDate !== undefined) expense.startDate = startDate;
    if (endDate !== undefined) expense.endDate = endDate || null;
    if (notes !== undefined) expense.notes = (notes || "").trim();
    if (typeof active === "boolean") expense.active = active;
    await expense.save();

    await recordActivity({
      user: req.user?.email,
      type: "expense_updated",
      message: `Expense updated (${expense.name})`,
      entityType: "expense",
      entityId: String(expense._id),
    });

    res.json({ success: true, expense: shape(expense) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const expense = await Expense.findByIdAndDelete(req.params.id);
    if (!expense) return res.status(404).json({ success: false, message: "Expense not found" });

    await recordActivity({
      user: req.user?.email,
      type: "expense_deleted",
      message: `Expense deleted (${expense.name})`,
      entityType: "expense",
      entityId: String(expense._id),
    });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
