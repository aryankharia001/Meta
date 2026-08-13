import express from "express";
import ShiprocketOrder from "../models/shiprocketorder.js";
import Token from "../models/Token.js";
import AdAccount from "../models/AdAccount.js";
import Product from "../models/Product.js";
import Expense from "../models/Expense.js";
import { getOrCreateProfitSettings } from "../models/ProfitSettings.js";
import { recordActivity } from "../lib/activityLog.js";
import { fbGet, actIdOf, extractDeliveryStatus, deliveryBucket6, createTtlCache, GRAPH_BASE } from "../lib/metaGraph.js";
import { operatingExpenseForDay, operatingExpenseForRange, operatingExpenseForHour } from "../lib/expenseAllocation.js";

const router = express.Router();

// ─────────────────────────────────────────────────────────────
// Phase 16 — Product Cost, Expenses & Real Profitability. Entirely new,
// additive route file (mounted at /api/profitability). Never writes
// ShiprocketOrder/Token/AdAccount, never imports from dailyReports.js/
// dailyHourly.js/hourly.js/campaignExplorer.js/campaigns.js/analytics.js
// — same "zero coupling between phases" convention every phase since
// Phase 8 has used. Nothing here can ever change the existing Meta<->
// Shiprocket sync, order/campaign matching, logistics tracking, or any
// existing report's numbers, and nothing they do can ever break this
// route. The only things imported are: (a) models (read-only reads of
// ShiprocketOrder/Token/AdAccount, read-write only of this phase's own
// Product/Expense/ProfitSettings collections), (b) lib/metaGraph.js and
// lib/expenseAllocation.js — genuinely shared pure-function/primitive
// libs (not route files) that dailyHourly.js (Phase 15) already
// established the precedent of importing from, and (c) lib/activityLog.js
// for audit logging, same as every other phase's mutating routes.
//
// Campaign matching follows the exact same rule dailyReports.js/
// dailyHourly.js already established: match by NAME
// (normalizeCampaignName) against the real campaigns Meta returns for
// the selected ad accounts — never by the raw campaignId Shiprocket
// stores per order (unreliable UTM-sourced field). An order whose name
// doesn't match any real campaign is surfaced as "Unmatched Orders",
// never guessed (§14 of Phase 15, carried forward here as the same "no
// fake data" principle Phase 16 §4/§14 also demands).
//
// Product cost matching follows orderDetails.js's extractProductLines
// probing: a line item's `sku || product_sku || variant_sku`, matched
// against a configured Product's `sku` field. A line item with no SKU,
// or a SKU with no matching Product, contributes 0 cost — never a
// guessed/averaged cost (§2's "no fake data" principle extended to costs).
//
// ── Design decisions for two things the spec describes precisely for
// time-based allocation (§8/§9) but does NOT specify for cross-entity
// allocation, documented here so they're easy to find and reconsider:
//
// 1. "Allocated Operating Expenses" per CAMPAIGN (§13) — the spec gives
//    an exact rule for allocating an expense across a TIME period, but
//    never says how to split a period's operating expenses ACROSS
//    campaigns. This file allocates proportional to each campaign's
//    share of RECOGNIZED revenue within the period (a campaign that
//    drove more of the money in also carries more of the fixed cost of
//    running the business that period). Exposed in every response that
//    does this as `operatingExpenseAllocationMethod: "revenue_share"`
//    so the frontend/user always knows how that number was derived.
//
// 2. "Highest profit hour" on the overall dashboard (§20) needs a
//    profit number per hour-of-day, potentially aggregated over a
//    multi-day range. Fetching Meta's real hourly spend breakdown for
//    every single day in an arbitrary range would mean one Graph API
//    call per account per day just for this one KPI — the
//    single-date §15/§16 Hourly Profit endpoint below does fetch the
//    real per-hour spend (exactly like dailyHourly.js), but the
//    range-wide dashboard KPI instead flat-splits each day's already-
//    fetched daily spend and operating expense evenly across its 24
//    hours (spend/24, opex/24 — the same flat, non-order-weighted split
//    §9's own hourly example and expenseAllocation.js's
//    operatingExpenseForHour() already use), then sums by hour-of-day
//    across every day in the range. Documented in the summary response
//    as `highestProfitHourMethod: "flat_split_by_day"`.
// ─────────────────────────────────────────────────────────────

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
function istHourOf(dateVal) {
  if (!dateVal) return null;
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return null;
  return new Date(d.getTime() + IST_OFFSET_MS).getUTCHours();
}

const normalizeCampaignName = (name) => String(name || "").trim().toLowerCase().replace(/\s+/g, " ");

const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

// ── Graph helpers (duplicated locally per this app's "zero coupling
// between route files" convention — only lib/metaGraph.js's primitives
// are shared) ─────────────────────────────────────────────────────────

async function tryFetchCampaigns(actId, accessToken) {
  const fields = "id,name,status,effective_status";
  try {
    const data = await fbGet(`${GRAPH_BASE}/${actId}/campaigns?fields=${encodeURIComponent(fields)}&limit=200&access_token=${accessToken}`);
    return data.data || [];
  } catch (err) {
    console.log(`Profitability campaign fetch failed for ${actId}: ${err.message}`);
    return [];
  }
}

// Per-campaign, per-day spend across a range — same shape dailyReports.js's
// fetchDailyInsights already uses.
async function fetchDailyInsights(actId, accessToken, since, until) {
  const fields = ["campaign_id", "campaign_name", "spend"].join(",");
  const url =
    `${GRAPH_BASE}/${actId}/insights?level=campaign` +
    `&fields=${encodeURIComponent(fields)}` +
    `&time_range=${encodeURIComponent(JSON.stringify({ since, until }))}` +
    `&time_increment=1&limit=500&access_token=${accessToken}`;
  try {
    const data = await fbGet(url);
    return data.data || [];
  } catch (err) {
    console.log(`Profitability insights fetch failed for ${actId}: ${err.message}`);
    return [];
  }
}

// Real Meta hourly ad-spend for one date, summed across accounts — same
// breakdown key dailyHourly.js/hourly.js already use, duplicated here.
async function fetchHourlySpendForAccounts(accountIds, accessToken, date) {
  const fields = "spend";
  const breakdown = "hourly_stats_aggregated_by_advertiser_time_zone";
  const timeRange = encodeURIComponent(JSON.stringify({ since: date, until: date }));
  const byHour = new Map();
  for (const accountId of accountIds || []) {
    try {
      const data = await fbGet(
        `${GRAPH_BASE}/${actIdOf(accountId)}/insights?level=account&fields=${encodeURIComponent(fields)}&breakdowns=${breakdown}&time_range=${timeRange}&limit=500&access_token=${accessToken}`
      );
      (data.data || []).forEach((row) => {
        const label = row.hourly_stats_aggregated_by_advertiser_time_zone || "";
        const hour = parseInt(String(label).slice(0, 2), 10);
        if (isNaN(hour) || hour < 0 || hour > 23) return;
        byHour.set(hour, (byHour.get(hour) || 0) + Number(row.spend || 0));
      });
    } catch (err) {
      console.log(`Profitability hourly spend fetch failed for ${accountId}: ${err.message}`);
    }
  }
  return byHour;
}

// Product line items WITH sku — same probing orderDetails.js's
// extractProductLines already uses (the join key against Product.sku).
function extractProductLines(raw) {
  const items = raw?.cart_data?.line_items || raw?.line_items || raw?.products || raw?.items || raw?.cart_data?.products;
  if (!Array.isArray(items) || items.length === 0) return [];
  return items.map((i) => ({
    name: i?.name || i?.product_name || i?.title || "Unknown product",
    sku: i?.sku || i?.product_sku || i?.variant_sku || null,
    quantity: i?.quantity != null ? Number(i.quantity) : i?.qty != null ? Number(i.qty) : 1,
  }));
}

async function resolveTokenAndAccounts(tokenId, adAccountIdParam) {
  const token = await Token.findById(tokenId).lean();
  if (!token) {
    const err = new Error("Token not found");
    err.status = 404;
    throw err;
  }
  let accountIds = adAccountIdParam;
  if (!accountIds) {
    const err = new Error("adAccountId is required");
    err.status = 400;
    throw err;
  }
  if (!Array.isArray(accountIds)) accountIds = [accountIds];
  if (accountIds.includes("all")) {
    const accounts = await AdAccount.find({ tokenId }).lean();
    accountIds = accounts.map((a) => a.adAccountId);
  }
  const accountDocs = await AdAccount.find({ tokenId, adAccountId: { $in: accountIds } }).lean();
  const accountNameMap = new Map(accountDocs.map((a) => [a.adAccountId, a.name || a.adAccountId]));
  return { token, accountIds, accountNameMap };
}

function enumerateDays(since, until) {
  const days = [];
  const cur = new Date(`${since}T00:00:00.000Z`);
  const end = new Date(`${until}T00:00:00.000Z`);
  while (cur <= end) {
    days.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return days;
}

// ── Product cost lookup ─────────────────────────────────────────────

async function buildProductCostMap() {
  const products = await Product.find({ active: true }).lean();
  const map = new Map();
  products.forEach((p) => {
    if (p.sku) map.set(p.sku, p);
  });
  return map;
}

// §2/§5 — per-order product/packaging/shipping/other cost, quantity-aware.
// A line with no SKU, or a SKU with no configured Product, contributes 0
// (never a guessed/averaged cost — §2's own "no fake data" principle).
function computeOrderCosts(order, productCostMap) {
  const lines = extractProductLines(order.raw);
  let productCost = 0,
    packagingCost = 0,
    shippingCost = 0,
    otherCost = 0,
    matchedUnits = 0,
    unmatchedUnits = 0;

  lines.forEach((line) => {
    const qty = line.quantity || 1;
    const cfg = line.sku ? productCostMap.get(line.sku) : null;
    if (cfg) {
      productCost += (cfg.productCost || 0) * qty;
      packagingCost += (cfg.packagingCost || 0) * qty;
      shippingCost += (cfg.shippingCost || 0) * qty;
      otherCost += (cfg.otherCost || 0) * qty;
      matchedUnits += qty;
    } else {
      unmatchedUnits += qty;
    }
  });

  return {
    productCost,
    packagingCost,
    shippingCost,
    otherCost,
    totalCost: productCost + packagingCost + shippingCost + otherCost,
    matchedUnits,
    unmatchedUnits,
  };
}

// §3/§4 — Recognized Revenue = Prepaid Revenue + (COD Revenue × COD Success Rate)
function recognizedRevenueOf(prepaidRevenue, codRevenue, codSuccessRatePct) {
  return prepaidRevenue + codRevenue * (codSuccessRatePct / 100);
}

// ── Core data-build: fetch + match + cost every order in a range, once,
// shared by every read endpoint below. Never mutates ShiprocketOrder. ──
async function buildRangeContext(tokenId, { since, until, adAccountIdParam }) {
  const { token, accountIds, accountNameMap } = await resolveTokenAndAccounts(tokenId, adAccountIdParam);

  const campaignMeta = new Map(); // campaignId -> {name, accountId, accountName}
  const insightRows = []; // flat, across accounts, each has date_start/campaign_id/spend

  for (const accountId of accountIds) {
    const actId = actIdOf(accountId);
    const [metaList, dailyInsights] = await Promise.all([
      tryFetchCampaigns(actId, token.accessToken),
      fetchDailyInsights(actId, token.accessToken, since, until),
    ]);
    metaList.forEach((c) => {
      campaignMeta.set(String(c.id), { name: c.name, accountId, accountName: accountNameMap.get(accountId) || accountId });
    });
    dailyInsights.forEach((row) => {
      insightRows.push(row);
      const id = String(row.campaign_id || "");
      if (id && !campaignMeta.has(id)) {
        campaignMeta.set(id, { name: row.campaign_name, accountId, accountName: accountNameMap.get(accountId) || accountId });
      }
    });
  }

  const byNormName = new Map(); // normalized name -> {campaignId, campaignName}
  campaignMeta.forEach((v, id) => {
    const n = normalizeCampaignName(v.name);
    if (n && !byNormName.has(n)) byNormName.set(n, { campaignId: id, campaignName: v.name });
  });

  const spendByDayCampaign = new Map(); // `${day}|${campaignId}` -> spend
  const spendByDay = new Map(); // day -> total spend (all campaigns)
  const spendByCampaign = new Map(); // campaignId -> total spend (whole range)
  insightRows.forEach((row) => {
    const day = row.date_start;
    const id = String(row.campaign_id || "");
    const spend = Number(row.spend || 0);
    if (!day || !id) return;
    spendByDayCampaign.set(`${day}|${id}`, (spendByDayCampaign.get(`${day}|${id}`) || 0) + spend);
    spendByDay.set(day, (spendByDay.get(day) || 0) + spend);
    spendByCampaign.set(id, (spendByCampaign.get(id) || 0) + spend);
  });

  const rawOrders = await ShiprocketOrder.find({ orderDate: { $gte: since, $lte: until } })
    .select("orderId orderDate orderCreatedAt campaignId campaignName totalAmountPayable paymentType raw")
    .lean();

  const productCostMap = await buildProductCostMap();

  const orders = rawOrders.map((o) => {
    const norm = normalizeCampaignName(o.campaignName);
    const match = norm ? byNormName.get(norm) : null;
    const costs = computeOrderCosts(o, productCostMap);
    const amount = Number(o.totalAmountPayable || 0);
    return {
      orderId: o.orderId,
      date: o.orderDate,
      hour: istHourOf(o.orderCreatedAt),
      matchedCampaignId: match ? match.campaignId : null,
      matchedCampaignName: match ? match.campaignName : o.campaignName || "Unmatched Orders",
      isUnmatched: !match,
      accountId: match ? campaignMeta.get(match.campaignId)?.accountId || null : null,
      accountName: match ? campaignMeta.get(match.campaignId)?.accountName || null : null,
      paymentType: o.paymentType || null,
      amount,
      deliveryStatus: extractDeliveryStatus(o.raw),
      ...costs,
    };
  });

  const activeExpenses = await Expense.find({ active: true }).lean();
  const settings = await getOrCreateProfitSettings();

  return {
    accountIds,
    accountNameMap,
    campaignMeta,
    orders,
    spendByDayCampaign,
    spendByDay,
    spendByCampaign,
    totalSpend: [...spendByCampaign.values()].reduce((s, v) => s + v, 0),
    activeExpenses,
    codSuccessRate: settings.codSuccessRate,
  };
}

// Revenue/cost/profit rollup over a set of already-enriched orders, given
// the ad spend and operating-expense allocated to that same slice.
function rollupOrders(orders, { spend = 0, operatingExpense = 0, codSuccessRate }) {
  let prepaidOrders = 0,
    prepaidRevenue = 0,
    codOrders = 0,
    codRevenue = 0,
    productCost = 0,
    packagingCost = 0,
    shippingCost = 0,
    otherCost = 0;

  orders.forEach((o) => {
    if (o.paymentType === "PREPAID") {
      prepaidOrders += 1;
      prepaidRevenue += o.amount;
    } else if (o.paymentType === "CASH_ON_DELIVERY") {
      codOrders += 1;
      codRevenue += o.amount;
    }
    productCost += o.productCost;
    packagingCost += o.packagingCost;
    shippingCost += o.shippingCost;
    otherCost += o.otherCost;
  });

  const grossRevenue = prepaidRevenue + codRevenue;
  const recognizedCodRevenue = codRevenue * (codSuccessRate / 100);
  const totalRecognizedRevenue = prepaidRevenue + recognizedCodRevenue;
  const totalProductExpense = productCost + packagingCost + shippingCost + otherCost;
  const totalExpenses = spend + totalProductExpense + operatingExpense;
  const netProfit = totalRecognizedRevenue - totalExpenses;

  return {
    orders: orders.length,
    prepaidOrders,
    prepaidRevenue: round2(prepaidRevenue),
    codOrders,
    codRevenue: round2(codRevenue),
    grossRevenue: round2(grossRevenue),
    recognizedPrepaidRevenue: round2(prepaidRevenue),
    recognizedCodRevenue: round2(recognizedCodRevenue),
    totalRecognizedRevenue: round2(totalRecognizedRevenue),
    spend: round2(spend),
    productCost: round2(productCost),
    packagingCost: round2(packagingCost),
    shippingCost: round2(shippingCost),
    otherCost: round2(otherCost),
    totalProductExpense: round2(totalProductExpense),
    operatingExpense: round2(operatingExpense),
    totalExpenses: round2(totalExpenses),
    netProfit: round2(netProfit),
    profitMargin: totalRecognizedRevenue ? round2((netProfit / totalRecognizedRevenue) * 100) : 0,
    roas: spend ? round2(grossRevenue / spend) : 0,
  };
}

const cache = createTtlCache(30_000);

// ── GET /settings — §18 configurable COD success rate ────────────────
router.get("/settings", async (req, res) => {
  try {
    const settings = await getOrCreateProfitSettings();
    res.json({ success: true, codSuccessRate: settings.codSuccessRate });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put("/settings", async (req, res) => {
  try {
    const { codSuccessRate } = req.body || {};
    const rate = Number(codSuccessRate);
    if (codSuccessRate === undefined || isNaN(rate) || rate < 0 || rate > 100) {
      return res.status(400).json({ success: false, message: "codSuccessRate must be a number between 0 and 100" });
    }
    const settings = await getOrCreateProfitSettings();
    settings.codSuccessRate = rate;
    await settings.save();

    await recordActivity({
      user: req.user?.email,
      type: "profit_settings_updated",
      message: `COD success rate set to ${rate}%`,
      entityType: "profitSettings",
      entityId: String(settings._id),
    });

    res.json({ success: true, codSuccessRate: settings.codSuccessRate });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /:tokenId/summary — §4/§10/§11/§12/§20 Profitability Dashboard ──
router.get("/:tokenId/summary", async (req, res) => {
  try {
    const { tokenId } = req.params;
    const { since, until } = req.query;
    if (!since || !until) return res.status(400).json({ success: false, message: "since and until are required" });

    const cacheKey = `summary:${tokenId}:${since}:${until}:${JSON.stringify(req.query.adAccountId)}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json({ ...cached, cached: true });

    const ctx = await buildRangeContext(tokenId, { since, until, adAccountIdParam: req.query.adAccountId });
    const operatingExpense = operatingExpenseForRange(ctx.activeExpenses, since, until);
    const overall = rollupOrders(ctx.orders, { spend: ctx.totalSpend, operatingExpense, codSuccessRate: ctx.codSuccessRate });

    // Best/worst campaign — allocate operating expense proportional to
    // each campaign's recognized-revenue share (design decision #1 above).
    const byCampaign = new Map();
    ctx.orders.forEach((o) => {
      const key = o.matchedCampaignId || `unmatched:${o.matchedCampaignName}`;
      if (!byCampaign.has(key)) byCampaign.set(key, { campaignId: o.matchedCampaignId, campaignName: o.matchedCampaignName, isUnmatched: o.isUnmatched, orders: [] });
      byCampaign.get(key).orders.push(o);
    });
    const totalRecognizedForShare = overall.totalRecognizedRevenue || 1;
    const campaignProfits = [...byCampaign.values()].map((c) => {
      const spend = c.campaignId ? ctx.spendByCampaign.get(c.campaignId) || 0 : 0;
      const rolled = rollupOrders(c.orders, { spend, operatingExpense: 0, codSuccessRate: ctx.codSuccessRate });
      const share = totalRecognizedForShare ? rolled.totalRecognizedRevenue / totalRecognizedForShare : 0;
      const allocatedOpEx = operatingExpense * share;
      const finalRolled = rollupOrders(c.orders, { spend, operatingExpense: allocatedOpEx, codSuccessRate: ctx.codSuccessRate });
      return { campaignId: c.campaignId, campaignName: c.campaignName, isUnmatched: c.isUnmatched, ...finalRolled };
    });
    const rankedCampaigns = campaignProfits.filter((c) => c.orders > 0).sort((a, b) => b.netProfit - a.netProfit);
    const bestCampaign = rankedCampaigns[0] || null;
    const worstCampaign = rankedCampaigns[rankedCampaigns.length - 1] || null;

    // Best profitable day
    const byDay = new Map();
    ctx.orders.forEach((o) => {
      if (!byDay.has(o.date)) byDay.set(o.date, []);
      byDay.get(o.date).push(o);
    });
    const dayProfits = [...byDay.entries()].map(([date, dayOrders]) => {
      const spend = ctx.spendByDay.get(date) || 0;
      const opEx = operatingExpenseForDay(ctx.activeExpenses, date);
      return { date, ...rollupOrders(dayOrders, { spend, operatingExpense: opEx, codSuccessRate: ctx.codSuccessRate }) };
    });
    const bestDay = dayProfits.slice().sort((a, b) => b.netProfit - a.netProfit)[0] || null;

    // Highest profit hour — flat-split approximation across the whole
    // range (design decision #2 above).
    const hourBuckets = Array.from({ length: 24 }, () => []);
    ctx.orders.forEach((o) => {
      if (o.hour !== null && o.hour !== undefined) hourBuckets[o.hour].push(o);
    });
    const hourProfits = hourBuckets.map((hourOrders, hour) => {
      // Each order's day contributes spend/24 and opEx/24 to its hour bucket.
      const daysTouched = new Set(hourOrders.map((o) => o.date));
      let hourSpend = 0,
        hourOpEx = 0;
      daysTouched.forEach((d) => {
        hourSpend += (ctx.spendByDay.get(d) || 0) / 24;
        hourOpEx += operatingExpenseForHour(ctx.activeExpenses, d);
      });
      return { hour, ...rollupOrders(hourOrders, { spend: hourSpend, operatingExpense: hourOpEx, codSuccessRate: ctx.codSuccessRate }) };
    });
    const highestProfitHour = hourProfits.filter((h) => h.orders > 0).sort((a, b) => b.netProfit - a.netProfit)[0] || null;

    const payload = {
      success: true,
      since,
      until,
      accountIds: ctx.accountIds,
      codSuccessRate: ctx.codSuccessRate,
      operatingExpenseAllocationMethod: "revenue_share",
      highestProfitHourMethod: "flat_split_by_day",
      revenue: {
        grossRevenue: overall.grossRevenue,
        prepaidRevenue: overall.prepaidRevenue,
        codRevenue: overall.codRevenue,
        recognizedPrepaidRevenue: overall.recognizedPrepaidRevenue,
        recognizedCodRevenue: overall.recognizedCodRevenue,
        totalRecognizedRevenue: overall.totalRecognizedRevenue,
      },
      expenses: {
        productCost: overall.productCost,
        packagingCost: overall.packagingCost,
        shippingCost: overall.shippingCost,
        otherCost: overall.otherCost,
        totalProductExpense: overall.totalProductExpense,
        advertisingExpense: overall.spend,
        operatingExpense: overall.operatingExpense,
        totalExpenses: overall.totalExpenses,
      },
      result: {
        netProfit: overall.netProfit,
        profitMargin: overall.profitMargin,
        roas: overall.roas,
        orders: overall.orders,
      },
      bestCampaign,
      worstCampaign,
      bestDay,
      highestProfitHour,
    };

    cache.set(cacheKey, payload);
    res.json(payload);
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

// ── GET /:tokenId/campaigns — §13 Campaign-Wise Profit ────────────────
router.get("/:tokenId/campaigns", async (req, res) => {
  try {
    const { tokenId } = req.params;
    const { since, until } = req.query;
    if (!since || !until) return res.status(400).json({ success: false, message: "since and until are required" });

    const ctx = await buildRangeContext(tokenId, { since, until, adAccountIdParam: req.query.adAccountId });
    const operatingExpense = operatingExpenseForRange(ctx.activeExpenses, since, until);
    const overallRecognized = rollupOrders(ctx.orders, { spend: 0, operatingExpense: 0, codSuccessRate: ctx.codSuccessRate }).totalRecognizedRevenue || 1;

    const byCampaign = new Map();
    ctx.orders.forEach((o) => {
      const key = o.matchedCampaignId || `unmatched:${o.matchedCampaignName}`;
      if (!byCampaign.has(key)) byCampaign.set(key, { campaignId: o.matchedCampaignId, campaignName: o.matchedCampaignName, accountId: o.accountId, accountName: o.accountName, isUnmatched: o.isUnmatched, orders: [] });
      byCampaign.get(key).orders.push(o);
    });

    const rows = [...byCampaign.values()].map((c) => {
      const spend = c.campaignId ? ctx.spendByCampaign.get(c.campaignId) || 0 : 0;
      const revenueOnly = rollupOrders(c.orders, { spend: 0, operatingExpense: 0, codSuccessRate: ctx.codSuccessRate });
      const share = overallRecognized ? revenueOnly.totalRecognizedRevenue / overallRecognized : 0;
      const allocatedOpEx = operatingExpense * share;
      const rolled = rollupOrders(c.orders, { spend, operatingExpense: allocatedOpEx, codSuccessRate: ctx.codSuccessRate });
      return {
        campaignId: c.campaignId,
        campaignName: c.campaignName,
        accountId: c.accountId,
        accountName: c.accountName,
        isUnmatched: c.isUnmatched,
        ...rolled,
      };
    });

    rows.sort((a, b) => b.netProfit - a.netProfit);

    res.json({
      success: true,
      since,
      until,
      accountIds: ctx.accountIds,
      codSuccessRate: ctx.codSuccessRate,
      operatingExpenseAllocationMethod: "revenue_share",
      campaigns: rows,
      totals: rollupOrders(ctx.orders, { spend: ctx.totalSpend, operatingExpense, codSuccessRate: ctx.codSuccessRate }),
    });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

// ── GET /:tokenId/daily — §14 Day-Wise Profit ─────────────────────────
router.get("/:tokenId/daily", async (req, res) => {
  try {
    const { tokenId } = req.params;
    const { since, until } = req.query;
    if (!since || !until) return res.status(400).json({ success: false, message: "since and until are required" });

    const ctx = await buildRangeContext(tokenId, { since, until, adAccountIdParam: req.query.adAccountId });

    const byDay = new Map();
    enumerateDays(since, until).forEach((d) => byDay.set(d, []));
    ctx.orders.forEach((o) => {
      if (!byDay.has(o.date)) byDay.set(o.date, []);
      byDay.get(o.date).push(o);
    });

    const days = [...byDay.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([date, dayOrders]) => {
        const spend = ctx.spendByDay.get(date) || 0;
        const operatingExpense = operatingExpenseForDay(ctx.activeExpenses, date);
        return { date, ...rollupOrders(dayOrders, { spend, operatingExpense, codSuccessRate: ctx.codSuccessRate }) };
      });

    const totalOperatingExpense = operatingExpenseForRange(ctx.activeExpenses, since, until);

    res.json({
      success: true,
      since,
      until,
      accountIds: ctx.accountIds,
      codSuccessRate: ctx.codSuccessRate,
      days,
      totals: rollupOrders(ctx.orders, { spend: ctx.totalSpend, operatingExpense: totalOperatingExpense, codSuccessRate: ctx.codSuccessRate }),
    });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

// ── GET /:tokenId/hourly — §15/§16 Hourly Profit for ONE date ─────────
router.get("/:tokenId/hourly", async (req, res) => {
  try {
    const { tokenId } = req.params;
    const { date } = req.query;
    if (!date) return res.status(400).json({ success: false, message: "date is required (YYYY-MM-DD)" });

    const { token, accountIds } = await resolveTokenAndAccounts(tokenId, req.query.adAccountId);

    const [ctx, hourlySpend] = await Promise.all([
      buildRangeContext(tokenId, { since: date, until: date, adAccountIdParam: req.query.adAccountId }),
      fetchHourlySpendForAccounts(accountIds, token.accessToken, date),
    ]);

    const dayOperatingExpense = operatingExpenseForDay(ctx.activeExpenses, date);
    const hourlyOperatingExpense = operatingExpenseForHour(ctx.activeExpenses, date);

    const hours = [];
    for (let h = 0; h < 24; h++) {
      const hourOrders = ctx.orders.filter((o) => o.hour === h);
      const spend = hourlySpend.get(h) || 0;
      const rolled = rollupOrders(hourOrders, { spend, operatingExpense: hourlyOperatingExpense, codSuccessRate: ctx.codSuccessRate });

      // §15 "show responsible campaigns" — light per-hour breakdown (name
      // + orders + profit), not the full Ad Set/Ad hierarchy (that fuller
      // Date -> Hour -> Campaign -> Ad Set -> Ad drill-down of §16 is
      // served by combining this endpoint with the existing Phase 15
      // dailyHourly.js hierarchy on the frontend — this route never
      // duplicates that ad set/ad name-resolving logic).
      const byCampaign = new Map();
      hourOrders.forEach((o) => {
        const key = o.matchedCampaignId || `unmatched:${o.matchedCampaignName}`;
        if (!byCampaign.has(key)) byCampaign.set(key, { campaignId: o.matchedCampaignId, campaignName: o.matchedCampaignName, isUnmatched: o.isUnmatched, orders: [] });
        byCampaign.get(key).orders.push(o);
      });
      const campaigns = [...byCampaign.values()]
        .map((c) => ({
          campaignId: c.campaignId,
          campaignName: c.campaignName,
          isUnmatched: c.isUnmatched,
          ...rollupOrders(c.orders, { spend: 0, operatingExpense: 0, codSuccessRate: ctx.codSuccessRate }),
        }))
        .sort((a, b) => b.orders - a.orders);

      hours.push({ hour: h, ...rolled, campaigns });
    }

    res.json({
      success: true,
      date,
      accountIds,
      codSuccessRate: ctx.codSuccessRate,
      hours,
      dayTotals: rollupOrders(ctx.orders, { spend: [...hourlySpend.values()].reduce((s, v) => s + v, 0), operatingExpense: dayOperatingExpense, codSuccessRate: ctx.codSuccessRate }),
    });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

// ── GET /:tokenId/cod-prepaid — §17 COD vs Prepaid Profitability ─────
router.get("/:tokenId/cod-prepaid", async (req, res) => {
  try {
    const { tokenId } = req.params;
    const { since, until } = req.query;
    if (!since || !until) return res.status(400).json({ success: false, message: "since and until are required" });

    const ctx = await buildRangeContext(tokenId, { since, until, adAccountIdParam: req.query.adAccountId });
    const operatingExpense = operatingExpenseForRange(ctx.activeExpenses, since, until);

    const prepaidOrders = ctx.orders.filter((o) => o.paymentType === "PREPAID");
    const codOrders = ctx.orders.filter((o) => o.paymentType === "CASH_ON_DELIVERY");

    const overall = rollupOrders(ctx.orders, { spend: 0, operatingExpense: 0, codSuccessRate: ctx.codSuccessRate });
    const totalRecognized = overall.totalRecognizedRevenue || 1;

    // Ad spend and operating expense aren't tracked per payment type at
    // the source, so both are allocated proportional to each side's
    // recognized-revenue share — same documented method as the campaign
    // allocation above.
    const prepaidRevenueOnly = rollupOrders(prepaidOrders, { spend: 0, operatingExpense: 0, codSuccessRate: ctx.codSuccessRate });
    const codRevenueOnly = rollupOrders(codOrders, { spend: 0, operatingExpense: 0, codSuccessRate: ctx.codSuccessRate });
    const prepaidShare = totalRecognized ? prepaidRevenueOnly.totalRecognizedRevenue / totalRecognized : 0;
    const codShare = totalRecognized ? codRevenueOnly.totalRecognizedRevenue / totalRecognized : 0;

    const prepaid = rollupOrders(prepaidOrders, {
      spend: ctx.totalSpend * prepaidShare,
      operatingExpense: operatingExpense * prepaidShare,
      codSuccessRate: ctx.codSuccessRate,
    });
    const cod = rollupOrders(codOrders, {
      spend: ctx.totalSpend * codShare,
      operatingExpense: operatingExpense * codShare,
      codSuccessRate: ctx.codSuccessRate,
    });

    res.json({
      success: true,
      since,
      until,
      accountIds: ctx.accountIds,
      codSuccessRate: ctx.codSuccessRate,
      allocationMethod: "revenue_share",
      prepaid: {
        orders: prepaid.orders,
        revenue: prepaid.grossRevenue,
        productExpense: prepaid.totalProductExpense,
        advertisingExpense: prepaid.spend,
        operatingExpense: prepaid.operatingExpense,
        totalExpenses: prepaid.totalExpenses,
        profit: prepaid.netProfit,
        profitMargin: prepaid.profitMargin,
      },
      cod: {
        orders: cod.orders,
        grossRevenue: cod.grossRevenue,
        expectedRecognizedRevenue: cod.recognizedCodRevenue,
        productExpense: cod.totalProductExpense,
        advertisingExpense: cod.spend,
        operatingExpense: cod.operatingExpense,
        totalExpenses: cod.totalExpenses,
        expectedProfit: cod.netProfit,
        expectedProfitMargin: cod.totalRecognizedRevenue ? round2((cod.netProfit / cod.totalRecognizedRevenue) * 100) : 0,
        estimated: true,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

// ── GET /:tokenId/products — Product Profitability (§22) ─────────────
router.get("/:tokenId/products", async (req, res) => {
  try {
    const { tokenId } = req.params;
    const { since, until } = req.query;
    if (!since || !until) return res.status(400).json({ success: false, message: "since and until are required" });

    // Only needs orders + product config, not campaign/spend matching —
    // still goes through buildRangeContext so cost math stays identical
    // to every other endpoint (one place computes per-order costs).
    const ctx = await buildRangeContext(tokenId, { since, until, adAccountIdParam: req.query.adAccountId });
    const productCostMap = await buildProductCostMap();

    const bySku = new Map(); // sku|"unmatched" -> {name, units, productCost, packagingCost, shippingCost, otherCost}
    const rawOrders = await ShiprocketOrder.find({ orderDate: { $gte: since, $lte: until } }).select("raw").lean();
    rawOrders.forEach((o) => {
      extractProductLines(o.raw).forEach((line) => {
        const key = line.sku && productCostMap.has(line.sku) ? line.sku : "unmatched";
        const cfg = key !== "unmatched" ? productCostMap.get(key) : null;
        if (!bySku.has(key)) {
          bySku.set(key, {
            sku: key === "unmatched" ? null : key,
            name: cfg ? cfg.name : "Unmatched SKU",
            units: 0,
            productCost: 0,
            packagingCost: 0,
            shippingCost: 0,
            otherCost: 0,
          });
        }
        const row = bySku.get(key);
        row.units += line.quantity;
        if (cfg) {
          row.productCost += cfg.productCost * line.quantity;
          row.packagingCost += cfg.packagingCost * line.quantity;
          row.shippingCost += cfg.shippingCost * line.quantity;
          row.otherCost += cfg.otherCost * line.quantity;
        }
      });
    });

    const products = [...bySku.values()]
      .map((r) => ({
        ...r,
        productCost: round2(r.productCost),
        packagingCost: round2(r.packagingCost),
        shippingCost: round2(r.shippingCost),
        otherCost: round2(r.otherCost),
        totalCost: round2(r.productCost + r.packagingCost + r.shippingCost + r.otherCost),
      }))
      .sort((a, b) => b.units - a.units);

    res.json({ success: true, since, until, products });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

export default router;
