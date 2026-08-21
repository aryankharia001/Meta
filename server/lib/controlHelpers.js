import ShiprocketOrder from "../models/shiprocketorder.js";
import BudgetHistory from "../models/BudgetHistory.js";
import BidCapHistory from "../models/BidCapHistory.js";
import ActivityLog from "../models/ActivityLog.js";
import { fetchHourlySpend } from "../routes/hourly.js";
import { toIstDateString } from "../utils/dateIst.js";

// ─────────────────────────────────────────────────────────────
// Phase 27 — shared helpers for campaignControl.js/adsetControl.js.
// New file, introduced by and only used within this phase (the same way
// metaGraph.js is shared across every Phase-13+ route file) — does not
// touch hourly.js's own route body, only imports its additive
// fetchHourlySpend export.
//
// "Profit" in the hourly/compare views below is revenue minus Meta ad
// spend only (not the full product-cost/expense-based profitability
// engine from Phase 16's profitability.js, which this phase does not
// import from, per "zero coupling"). This is a real, honestly-labeled
// number (`profitMethod: "revenue_minus_spend"`), not the same thing as
// the Profitability page's fully-costed net profit — never presented as
// if it were.
// ─────────────────────────────────────────────────────────────

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
function istHourOf(dateVal) {
  if (!dateVal) return null;
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return null;
  return new Date(d.getTime() + IST_OFFSET_MS).getUTCHours();
}
function pad2(n) {
  return String(n).padStart(2, "0");
}
function hourLabel(h) {
  return `${pad2(h)}:00–${pad2(h)}:59`;
}
function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function orderFilterFor(entityType, entityId) {
  return entityType === "campaign" ? { campaignId: entityId } : { adsetId: entityId };
}

// ── Unified Activity/Budget/BidCap timeline for one entity ─────────
export async function buildTimeline({ entityType, entityId, since, until }) {
  const range = {};
  if (since) range.$gte = new Date(since);
  if (until) range.$lte = new Date(until);
  const dateFilter = since || until ? { changedAt: range } : {};

  const [budgetRows, bidRows, activityRows] = await Promise.all([
    BudgetHistory.find({ entityType, entityId, ...dateFilter }).sort({ changedAt: -1 }).lean(),
    entityType === "adset" ? BidCapHistory.find({ entityType, entityId, ...dateFilter }).sort({ changedAt: -1 }).lean() : [],
    ActivityLog.find({
      entityType,
      entityId: String(entityId),
      type: { $in: ["campaign_status_changed", "adset_status_changed"] },
      ...(since || until ? { createdAt: range } : {}),
    }).sort({ createdAt: -1 }).lean(),
  ]);

  const events = [
    ...budgetRows.map((r) => ({
      kind: "budget",
      id: String(r._id),
      at: r.changedAt,
      title: "Budget Changed",
      from: r.previousBudget,
      to: r.newBudget,
      changeAmount: r.changeAmount,
      changePercent: r.changePercent,
      source: r.source,
      changedBy: r.changedBy,
    })),
    ...bidRows.map((r) => ({
      kind: "bid_cap",
      id: String(r._id),
      at: r.changedAt,
      title: "Bid Cap Changed",
      from: r.previousBidAmount,
      to: r.newBidAmount,
      changeAmount: r.changeAmount,
      changePercent: r.changePercent,
      source: r.source,
      changedBy: r.changedBy,
    })),
    ...activityRows.map((r) => ({
      kind: "status",
      id: String(r._id),
      at: r.createdAt,
      title: r.meta?.to ? `Status changed to ${r.meta.to}` : "Status Changed",
      from: r.meta?.from || null,
      to: r.meta?.to || null,
      source: r.user === "Meta Ads Manager" ? "Meta Ads Manager" : "App",
      changedBy: r.user !== "Meta Ads Manager" ? r.user : "",
      message: r.message,
    })),
  ];

  events.sort((a, b) => new Date(b.at) - new Date(a.at));
  return events;
}

// ── Hourly performance for one entity, with budget/bid-cap overlay ──
export async function computeHourlyControl({ entityType, entityId, accessToken, date }) {
  const { available: metaHourlyAvailable, byHour, error: metaError } = await fetchHourlySpend({
    objectId: entityId,
    accessToken,
    date,
  });

  const dayOrders = await ShiprocketOrder.find({ orderDate: date, ...orderFilterFor(entityType, entityId) })
    .select("orderCreatedAt totalAmountPayable paymentType")
    .lean();

  const dayStart = new Date(`${date}T00:00:00.000+05:30`);
  const dayEnd = new Date(`${date}T23:59:59.999+05:30`);

  const [budgetChanges, bidChanges] = await Promise.all([
    BudgetHistory.find({ entityType, entityId, changedAt: { $gte: dayStart, $lte: dayEnd } }).sort({ changedAt: 1 }).lean(),
    entityType === "adset"
      ? BidCapHistory.find({ entityType, entityId, changedAt: { $gte: dayStart, $lte: dayEnd } }).sort({ changedAt: 1 }).lean()
      : [],
  ]);

  const hours = [];
  for (let h = 0; h < 24; h++) {
    const metaRow = byHour.get(h) || null;
    const spend = metaRow ? round2(metaRow.spend) : 0;

    const ordersInHour = dayOrders.filter((o) => istHourOf(o.orderCreatedAt) === h);
    let revenue = 0, codOrders = 0, prepaidOrders = 0;
    ordersInHour.forEach((o) => {
      revenue += Number(o.totalAmountPayable || 0);
      if (o.paymentType === "PREPAID") prepaidOrders += 1;
      else if (o.paymentType === "CASH_ON_DELIVERY") codOrders += 1;
    });
    revenue = round2(revenue);

    // Budget/bid cap "as of the start of this hour" — the last change
    // at or before hh:00:00 IST. If a change lands inside this hour
    // (after hh:00:00, before the next hour), it's surfaced as a
    // `changedMidHour` marker instead of silently relabeling the whole
    // row — spec §8.
    const hourStart = new Date(`${date}T${pad2(h)}:00:00.000+05:30`);
    const hourEnd = new Date(`${date}T${pad2(h)}:59:59.999+05:30`);

    const budgetAtStart = [...budgetChanges].reverse().find((c) => new Date(c.changedAt) <= hourStart);
    const budgetMidHour = budgetChanges.find((c) => new Date(c.changedAt) > hourStart && new Date(c.changedAt) <= hourEnd);
    const bidAtStart = [...bidChanges].reverse().find((c) => new Date(c.changedAt) <= hourStart);
    const bidMidHour = bidChanges.find((c) => new Date(c.changedAt) > hourStart && new Date(c.changedAt) <= hourEnd);

    hours.push({
      hour: h,
      label: hourLabel(h),
      budget: budgetAtStart ? budgetAtStart.newBudget : null,
      budgetChangedMidHour: budgetMidHour
        ? { at: budgetMidHour.changedAt, from: budgetMidHour.previousBudget, to: budgetMidHour.newBudget }
        : null,
      bidCap: bidAtStart ? bidAtStart.newBidAmount : null,
      bidCapChangedMidHour: bidMidHour
        ? { at: bidMidHour.changedAt, from: bidMidHour.previousBidAmount, to: bidMidHour.newBidAmount }
        : null,
      spend,
      orders: ordersInHour.length,
      prepaidOrders,
      codOrders,
      revenue,
      roas: spend ? round2(revenue / spend) : 0,
      cpa: ordersInHour.length ? round2(spend / ordersInHour.length) : 0,
      profit: round2(revenue - spend),
    });
  }

  return {
    date,
    metaHourlyAvailable,
    metaHourlyError: metaHourlyAvailable ? null : metaError,
    profitMethod: "revenue_minus_spend",
    hours,
    summary: {
      totalSpend: round2(hours.reduce((s, h) => s + h.spend, 0)),
      totalOrders: hours.reduce((s, h) => s + h.orders, 0),
      totalRevenue: round2(hours.reduce((s, h) => s + h.revenue, 0)),
      totalProfit: round2(hours.reduce((s, h) => s + h.profit, 0)),
    },
  };
}

async function metricsForWindow({ entityType, entityId, accessToken, fromAt, toAt }) {
  const orders = await ShiprocketOrder.find({
    ...orderFilterFor(entityType, entityId),
    orderCreatedAt: { $gte: new Date(fromAt), $lte: new Date(toAt) },
  })
    .select("orderCreatedAt totalAmountPayable paymentType")
    .lean();

  let revenue = 0, codOrders = 0, prepaidOrders = 0;
  orders.forEach((o) => {
    revenue += Number(o.totalAmountPayable || 0);
    if (o.paymentType === "PREPAID") prepaidOrders += 1;
    else if (o.paymentType === "CASH_ON_DELIVERY") codOrders += 1;
  });
  revenue = round2(revenue);

  // Meta Insights has no sub-hour granularity — spend for a window is
  // summed from the hourly breakdown (per calendar day the window
  // touches). If the window's boundary falls mid-hour, that boundary
  // hour's spend is still whole-hour precision, not invented as exact —
  // surfaced via `spendGranularity` so the UI can label it honestly
  // (spec §15).
  const fromDate = new Date(fromAt);
  const toDate = new Date(toAt);
  const days = [];
  for (let d = new Date(fromDate); d <= toDate; d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(toIstDateString(d));
  }
  const uniqueDays = [...new Set(days)];

  let spend = 0;
  let spendAvailable = false;
  for (const day of uniqueDays) {
    try {
      const { available, byHour } = await fetchHourlySpend({ objectId: entityId, accessToken, date: day });
      if (!available) continue;
      spendAvailable = true;
      for (const [h, row] of byHour.entries()) {
        const hourStart = new Date(`${day}T${pad2(h)}:00:00.000+05:30`);
        const hourEnd = new Date(`${day}T${pad2(h)}:59:59.999+05:30`);
        // Include this hour if it overlaps the window at all.
        if (hourEnd >= fromDate && hourStart <= toDate) spend += Number(row.spend || 0);
      }
    } catch {
      // leave spendAvailable as-is for this day
    }
  }
  spend = round2(spend);

  return {
    spend,
    spendAvailable,
    spendGranularity: "hour",
    orders: orders.length,
    prepaidOrders,
    codOrders,
    revenue,
    roas: spend ? round2(revenue / spend) : 0,
    cpa: orders.length ? round2(spend / orders.length) : 0,
    profit: round2(revenue - spend),
  };
}

// ── Before vs After comparison for one budget/bid-cap change ───────
export async function computeCompare({ entityType, entityId, accessToken, changeType, changeId }) {
  const Model = changeType === "bid_cap" ? BidCapHistory : BudgetHistory;
  const change = await Model.findOne({ _id: changeId, entityType, entityId }).lean();
  if (!change) {
    const err = new Error("Change not found");
    err.status = 404;
    throw err;
  }

  const prior = await Model.findOne({ entityType, entityId, changedAt: { $lt: change.changedAt } })
    .sort({ changedAt: -1 })
    .lean();
  const next = await Model.findOne({ entityType, entityId, changedAt: { $gt: change.changedAt } })
    .sort({ changedAt: 1 })
    .lean();

  const beforeFrom = prior ? prior.changedAt : new Date(change.changedAt.getTime() - 24 * 60 * 60 * 1000);
  const afterTo = next ? next.changedAt : new Date();

  const [before, after] = await Promise.all([
    metricsForWindow({ entityType, entityId, accessToken, fromAt: beforeFrom, toAt: change.changedAt }),
    metricsForWindow({ entityType, entityId, accessToken, fromAt: change.changedAt, toAt: afterTo }),
  ]);

  return {
    change:
      changeType === "bid_cap"
        ? { from: change.previousBidAmount, to: change.newBidAmount, at: change.changedAt, source: change.source }
        : { from: change.previousBudget, to: change.newBudget, at: change.changedAt, source: change.source },
    before: { window: { from: beforeFrom, to: change.changedAt }, ...before },
    after: { window: { from: change.changedAt, to: afterTo }, ...after },
  };
}
