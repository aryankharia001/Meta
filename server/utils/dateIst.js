const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

// Today's date as an IST calendar day string, e.g. "2026-08-06"
export function todayIstIso() {
  const istNow = new Date(Date.now() + IST_OFFSET_MS);
  return istNow.toISOString().slice(0, 10);
}

// UTC instant corresponding to the start (00:00:00.000) of the given
// IST calendar day, e.g. istDayStartUtc("2026-08-06") -> 2026-08-05T18:30:00.000Z
export function istDayStartUtc(day) {
  return new Date(`${day}T00:00:00.000+05:30`);
}

// UTC instant corresponding to the end (23:59:59.999) of the given
// IST calendar day.
export function istDayEndUtc(day) {
  return new Date(`${day}T23:59:59.999+05:30`);
}

// ─────────────────────────────────────────────────────────────
// Phase 25 — additive. Converts an arbitrary instant (any Date, or
// anything `new Date(...)` accepts — an ISO string, a numeric epoch ms,
// etc.) into the IST calendar-day string ("YYYY-MM-DD") that every date
// field in this app already keys off of (ShiprocketOrder.orderDate,
// AbandonedCartOrder.orderDate, Expense.startDate, ...). Used for
// abandoned-cart postbacks: "the actual postback timestamp" (whatever
// instant it represents) always determines the record's IST calendar
// day via this helper, never the server's wall-clock date at insert
// time and never a UTC day boundary.
export function toIstDateString(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return null;
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  return ist.toISOString().slice(0, 10);
}