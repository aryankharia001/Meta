// ─────────────────────────────────────────────────────────────
// Phase 16 §8/§9 — shared expense-allocation math. A small, pure-
// function lib (same role as lib/metaGraph.js for Phase 13+) so both
// routes/expenses.js (to display a daily-equivalent per row) and
// routes/profitability.js (to actually allocate expenses into a
// reporting period) use the exact same rule — never two slightly
// different implementations drifting apart.
//
// Rule per §8/§9:
//   daily      -> the amount itself
//   weekly     -> amount / 7
//   monthly    -> amount / (days in that calendar month)
//   yearly     -> amount / (days in that calendar year, leap-aware)
//   one-time   -> the full amount, but only on the exact day it starts
//                 (a one-off cost is incurred once, not smeared across
//                 a range — the spec never says otherwise, and silently
//                 spreading a one-time cost over an arbitrary reporting
//                 window would misrepresent it as recurring)
//
// This module never mutates or reads the Expense collection itself —
// callers pass plain {amount, frequency, startDate, endDate, active}
// shaped objects, so it stays 100% pure/testable and can't accidentally
// change the stored expense value (§9: "use this only for profitability
// reporting; do not modify the original expense value").
// ─────────────────────────────────────────────────────────────

function daysInMonth(year, monthIndex0) {
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
}

function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInYear(year) {
  return isLeapYear(year) ? 366 : 365;
}

// Daily-equivalent amount this expense contributes to ONE specific
// calendar day (YYYY-MM-DD), or 0 if the expense wasn't active/in-window
// that day.
export function dailyEquivalentForDate(expense, dateStr) {
  if (!expense || expense.active === false) return 0;
  if (expense.startDate && dateStr < expense.startDate) return 0;
  if (expense.endDate && dateStr > expense.endDate) return 0;

  const amount = Number(expense.amount || 0);
  if (!amount) return 0;

  switch (expense.frequency) {
    case "daily":
      return amount;
    case "weekly":
      return amount / 7;
    case "monthly": {
      const [y, m] = dateStr.split("-").map(Number);
      return amount / daysInMonth(y, m - 1);
    }
    case "yearly": {
      const y = Number(dateStr.slice(0, 4));
      return amount / daysInYear(y);
    }
    case "one-time":
      return dateStr === expense.startDate ? amount : 0;
    default:
      return 0;
  }
}

// Every calendar day between since and until, inclusive — same UTC walk
// dateIst.js's enumerateDays()/dailyReports.js's enumerateDays() already
// use, duplicated here (zero coupling — this lib intentionally has no
// dependency on any route file).
export function enumerateDays(since, until) {
  const days = [];
  const cur = new Date(`${since}T00:00:00.000Z`);
  const end = new Date(`${until}T00:00:00.000Z`);
  while (cur <= end) {
    days.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return days;
}

// Sum of every active expense's daily-equivalent, for one specific day.
export function operatingExpenseForDay(expenses, dateStr) {
  return (expenses || []).reduce((sum, e) => sum + dailyEquivalentForDate(e, dateStr), 0);
}

// Sum across a whole [since, until] range.
export function operatingExpenseForRange(expenses, since, until) {
  return enumerateDays(since, until).reduce((sum, d) => sum + operatingExpenseForDay(expenses, d), 0);
}

// §9's hourly example: "Daily operating expense ₹3,000 -> Hourly
// allocation ₹125/hour" = 3000 / 24, a flat split across the day's 24
// hours (not weighted by order volume — the spec's own example computes
// a plain division, so that's the rule this mirrors).
export function operatingExpenseForHour(expenses, dateStr) {
  return operatingExpenseForDay(expenses, dateStr) / 24;
}
