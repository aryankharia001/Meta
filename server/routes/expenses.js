import express from "express";
import Expense from "../models/Expense.js";
import { recordActivity } from "../lib/activityLog.js";
import { dailyEquivalentForDate } from "../lib/expenseAllocation.js";
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
