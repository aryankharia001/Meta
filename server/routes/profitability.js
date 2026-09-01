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
import { requireAdmin } from "../middleware/auth.js";
// Campaign History Phase — additive import only, same shared resolver
// campaigns.js/campaignExplorer.js/dailyReports.js/dailyHourly.js/
// hourly.js now also use (see lib/campaignIdentity.js's header).
// Duplicated import here rather than re-exported from those files, per
// this file's own "zero coupling to earlier phases" convention stated
// below. Only the CAMPAIGN matching path (buildRangeContext) uses this
// — the separate product-cost name matching a little further below is
// untouched, different data entirely.
import { buildCampaignIdentityResolver } from "../lib/campaignIdentity.js";

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
// dailyHourly.js/hourly.js already established (Campaign History
// Phase): the order's campaign_name is resolved through the shared
// current + auto-historical + manual mapping chain
// (lib/campaignIdentity.js) to a Campaign ID — never by the raw
// campaignId Shiprocket stores per order (unreliable UTM-sourced
// field). An order that resolves to no campaign at all is surfaced as
// "Unmatched Orders", never guessed (§14 of Phase 15, carried forward
// here as the same "no fake data" principle Phase 16 §4/§14 also
// demands).
//
// Product cost matching (Phase 18 §1 rewrite) tries, per line item, in
// priority order: Variant ID -> SKU -> Product ID -> normalized product
// name -> no match. Each tier probes the same defensive multi-name style
// orderDetails.js's extractProductLines already used for `sku` (`sku ||
// product_sku || variant_sku`), extended to variant_id/variantId/
// variant_sku_id and product_id/productId. A line with no match at any
// tier contributes 0 cost — never a guessed/averaged cost (§2's "no fake
// data" principle) — but its units are rolled up into a visible
// "unmapped" figure (rollupOrders/operatingExpenseBreakdown below)
// instead of silently vanishing.
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

// Product line items — same base probing orderDetails.js's
// extractProductLines already uses for `sku` (`sku || product_sku ||
// variant_sku`), extended in Phase 18 §1 to ALSO probe for a variant
// identifier and a parent product identifier using the same defensive
// multi-name-probing convention (plausible Shopify/Shiprocket field
// names), plus keep `name` around for the last-resort name-based match.
// asId() normalizes any probed value to a trimmed string key (or null),
// so a numeric Shopify variant_id/product_id and a string-typed
// configured Product field always compare equal.
// Phase 19 §2 — asId() is the join-key normalizer for every identifier
// tier (variantId/sku/productId), used on BOTH sides of every match (the
// configured Product's field, via buildProductLookupMaps, and the order
// line item's extracted field, via extractProductLines below). It used
// to only trim whitespace, which meant a Product configured with SKU
// "GS-30ML" would silently fail to match an order line item carrying
// "gs-30ml" (or vice versa) — different systems (a human typing into the
// Product Cost form vs. whatever normalization the storefront/Shiprocket
// applied) very commonly differ only in case. That's a real, silent
// match failure that reproduces exactly "I configured the cost but
// Profitability still shows ₹0," indistinguishable from an actual data-
// shape problem without deliberately checking for it. Lowercasing here
// (in addition to the existing trim) makes matching case-insensitive for
// every identifier tier, everywhere resolveProductConfig() is used —
// never touches campaign name matching (normalizeCampaignName is a
// separate, untouched function).
function asId(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().toLowerCase();
  return s ? s : null;
}

// Phase 19 §2/§5 — broadened container-path and per-field probing. This
// app's order `raw` payload comes from a bespoke internal API
// (https://akravi.com/api/ad/order/:orderId — see shiprocketService.js's
// fetchOrderDetails), NOT Shiprocket's own documented order schema, so
// its true shape for product line items has never been confirmed against
// real data anywhere in this codebase (every extractor here and in
// orderDetails.js/campaigns.js has always defensively guessed). Extended
// with more plausible container paths (order_items/cart_items/cart.items,
// matching common Shiprocket "order_items" and generic cart-object
// conventions) and more plausible per-field names (units/qty_ordered for
// quantity, product_variant_id, barcode as an extra SKU-ish fallback) —
// still a guess, but a wider net than before. See the new
// GET /:tokenId/debug/sample-order-shape route below, which exposes the
// REAL keys of one actual order so this can be corrected precisely
// instead of guessed again, next time someone can check it against real
// data.
function extractProductLines(raw) {
  const items =
    raw?.cart_data?.line_items ||
    raw?.line_items ||
    raw?.order_items ||
    raw?.cart_data?.order_items ||
    raw?.products ||
    raw?.items ||
    raw?.cart_data?.products ||
    raw?.cart_data?.cart_items ||
    raw?.cart?.items ||
    raw?.cart?.line_items;
  if (!Array.isArray(items) || items.length === 0) return [];
  return items.map((i) => ({
    name: i?.name || i?.product_name || i?.title || "Unknown product",
    sku: asId(i?.sku || i?.product_sku || i?.variant_sku || i?.barcode),
    variantId: asId(i?.variant_id || i?.variantId || i?.variant_sku_id || i?.variantSkuId || i?.product_variant_id),
    productId: asId(i?.product_id || i?.productId || i?.parent_product_id),
    quantity:
      i?.quantity != null
        ? Number(i.quantity)
        : i?.qty != null
        ? Number(i.qty)
        : i?.units != null
        ? Number(i.units)
        : i?.qty_ordered != null
        ? Number(i.qty_ordered)
        : 1,
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

// ── Product cost lookup (Phase 18 §1/§3/§4) ──────────────────────────
//
// Matching priority, per spec: Variant ID -> SKU -> Product ID ->
// normalized-name fallback. Four separate lookup Maps are built once per
// request (buildProductLookupMaps), each keyed only by products where
// that particular identifier is actually configured (non-empty) — a
// Product with a blank variantId is simply absent from byVariantId, etc.
// resolveProductConfig() below is the SINGLE shared function every
// endpoint that needs to match a line item to a configured Product must
// call, so /summary, /campaigns, /daily, /hourly, /cod-prepaid, and
// /products (via computeOrderCosts and the /products endpoint itself)
// can never disagree about what counts as "matched".
function buildProductLookupMaps(products) {
  const byVariantId = new Map();
  const bySku = new Map();
  const byProductId = new Map();
  const byNormName = new Map();
  products.forEach((p) => {
    const variantId = asId(p.variantId);
    const sku = asId(p.sku);
    const productId = asId(p.productId);
    if (variantId && !byVariantId.has(variantId)) byVariantId.set(variantId, p);
    if (sku && !bySku.has(sku)) bySku.set(sku, p);
    if (productId && !byProductId.has(productId)) byProductId.set(productId, p);
    const n = normalizeCampaignName(p.name);
    if (n && !byNormName.has(n)) byNormName.set(n, p);
  });
  return { byVariantId, bySku, byProductId, byNormName };
}

async function buildProductCostMap() {
  const products = await Product.find({ active: true }).lean();
  return buildProductLookupMaps(products);
}

// Resolves ONE line item to a configured Product, trying each identifier
// tier in priority order. Returns { cfg, tier } — cfg is null (tier null)
// when nothing matched at any tier, which computeOrderCosts treats as a
// genuine 0-cost line (never a guessed/averaged cost — §2's "no fake
// data" principle), but now surfaced as a distinct "unmapped" bucket
// (see rollupOrders) instead of silently vanishing.
function resolveProductConfig(line, maps) {
  if (line.variantId && maps.byVariantId.has(line.variantId)) {
    return { cfg: maps.byVariantId.get(line.variantId), tier: "variantId" };
  }
  if (line.sku && maps.bySku.has(line.sku)) {
    return { cfg: maps.bySku.get(line.sku), tier: "sku" };
  }
  if (line.productId && maps.byProductId.has(line.productId)) {
    return { cfg: maps.byProductId.get(line.productId), tier: "productId" };
  }
  const n = normalizeCampaignName(line.name);
  if (n && maps.byNormName.has(n)) {
    return { cfg: maps.byNormName.get(n), tier: "name" };
  }
  return { cfg: null, tier: null };
}

// §2/§5 — per-order product/packaging/shipping/other cost, quantity-aware.
// A line with no identifier match at any tier contributes 0 (never a
// guessed/averaged cost), and its units are tallied into unmatchedUnits
// so the caller can roll that up into a visible "unmapped" figure rather
// than letting it silently disappear.
//
// Phase 19 §2/§5 — `hasLineItems` distinguishes TWO different failure
// modes that both used to collapse into the same silent 0-cost result:
//   (a) extractProductLines() found NO line items at all in this order's
//       raw payload (none of the probed container paths existed) — a
//       data-shape problem, configuring more products won't fix it.
//   (b) line items WERE found, but none of them matched any configured
//       Product at any identifier tier — a configuration/matching
//       problem, exactly what "Unmapped Product Cost" is meant to catch.
// Surfaced separately in rollupOrders/the /summary response so the user
// isn't left guessing which one they're looking at.
function computeOrderCosts(order, productLookupMaps) {
  const lines = extractProductLines(order.raw);
  let productCost = 0,
    packagingCost = 0,
    shippingCost = 0,
    otherCost = 0,
    matchedUnits = 0,
    unmatchedUnits = 0;
  const matchTiers = { variantId: 0, sku: 0, productId: 0, name: 0 };

  lines.forEach((line) => {
    const qty = line.quantity || 1;
    const { cfg, tier } = resolveProductConfig(line, productLookupMaps);
    if (cfg) {
      productCost += (cfg.productCost || 0) * qty;
      packagingCost += (cfg.packagingCost || 0) * qty;
      shippingCost += (cfg.shippingCost || 0) * qty;
      otherCost += (cfg.otherCost || 0) * qty;
      matchedUnits += qty;
      matchTiers[tier] += qty;
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
    matchTiers,
    hasLineItems: lines.length > 0,
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

  // Campaign History Phase — spec §21's required direction: order's
  // campaign_name -> current + auto-historical + manual mapping chain ->
  // Campaign ID, not the old "known campaign name -> orders" direction
  // this file used to use (see lib/campaignIdentity.js's header). Also
  // resolves a renamed campaign's pre-rename orders correctly, which
  // the old exact-current-name match could not do.
  const campaignIdentityResolver = await buildCampaignIdentityResolver({
    tokenId,
    accountIds,
    liveCampaigns: [...campaignMeta.entries()].map(([id, v]) => ({
      campaignId: id,
      campaignName: v.name,
      accountId: v.accountId,
    })),
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
    const match = campaignIdentityResolver.resolve(o);
    const costs = computeOrderCosts(o, productCostMap);
    const amount = Number(o.totalAmountPayable || 0);
    return {
      orderId: o.orderId,
      date: o.orderDate,
      hour: istHourOf(o.orderCreatedAt),
      matchedCampaignId: match.campaignId,
      matchedCampaignName: match.campaignId ? (match.currentName || o.campaignName || "Unmatched Orders") : (o.campaignName || "Unmatched Orders"),
      isUnmatched: !match.campaignId,
      // Campaign History Phase §22 — per-order matching debug info,
      // additive alongside the existing matchedCampaignId/
      // matchedCampaignName/isUnmatched fields.
      matchType: match.matchType,
      accountId: match.campaignId ? campaignMeta.get(match.campaignId)?.accountId || null : null,
      accountName: match.campaignId ? campaignMeta.get(match.campaignId)?.accountName || null : null,
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
    otherCost = 0,
    unmappedProductUnits = 0,
    unmappedProductOrders = 0,
    ordersWithNoLineItemsFound = 0;

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
    // Phase 18 §1/§5 — "Unmapped Product Cost" visibility: units with no
    // configured Product at any identifier tier, rolled up here so every
    // endpoint's totals carry this figure instead of it only existing
    // inside the separate /products "Unmatched" bucket.
    if (o.unmatchedUnits) {
      unmappedProductUnits += o.unmatchedUnits;
      unmappedProductOrders += 1;
    }
    // Phase 19 §2/§5 — the OTHER failure mode: this order's raw payload
    // had no recognizable line-items array at all (see extractProductLines
    // / computeOrderCosts' hasLineItems), so it never even reached
    // "matched or unmapped" — a data-shape gap, not a missing product
    // config. Counted separately so it's never confused with
    // unmappedProductOrders above.
    if (!o.hasLineItems) {
      ordersWithNoLineItemsFound += 1;
    }
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
    unmappedProductUnits,
    unmappedProductOrders,
    ordersWithNoLineItemsFound,
  };
}

// §7/§8 — per-expense breakdown of the range's operating expense, reusing
// expenseAllocation.js's pure operatingExpenseForRange() for each expense
// individually rather than reimplementing the frequency math. Zero-
// contribution expenses (inactive, outside their start/end window for
// this whole range, etc.) are omitted — nothing to show for them in this
// period. Each row carries enough of the expense's own config
// (category/frequency/dates) for the frontend to render a "configuration
// and allocation" drill-down without a second round-trip.
function operatingExpenseBreakdown(expenses, since, until) {
  return (expenses || [])
    .map((e) => ({
      expenseId: String(e._id),
      name: e.name,
      category: e.category,
      frequency: e.frequency,
      startDate: e.startDate,
      endDate: e.endDate || null,
      notes: e.notes || "",
      configuredAmount: e.amount,
      amount: round2(operatingExpenseForRange([e], since, until)),
    }))
    .filter((row) => row.amount > 0)
    .sort((a, b) => b.amount - a.amount);
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
        // Phase 18 §2 — per-expense breakdown (name/category/frequency/
        // dates + this range's allocated amount), so the frontend can
        // group/sum by category and drill into any one expense's own
        // configuration without a second endpoint.
        operatingExpenseBreakdown: operatingExpenseBreakdown(ctx.activeExpenses, since, until),
        totalExpenses: overall.totalExpenses,
        // Phase 18 §1/§5 — "Unmapped Product Cost" visibility: units (and
        // the orders containing them) that had no configured Product
        // match at any identifier tier, so Product Cost can be flagged as
        // potentially understated instead of silently under-reporting.
        // No dollar figure is invented for these — only the count.
        unmappedProductUnits: overall.unmappedProductUnits,
        unmappedProductOrders: overall.unmappedProductOrders,
        // Phase 19 §2/§5 — the OTHER, distinct failure mode: orders whose
        // raw payload had no recognizable line-items array at ALL (see
        // computeOrderCosts' hasLineItems) — a data-shape gap upstream of
        // product matching, not a missing Product config. Kept separate
        // from unmappedProductOrders above so the two causes are never
        // confused with each other in the UI.
        ordersWithNoLineItemsFound: overall.ordersWithNoLineItemsFound,
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
      totals: {
        ...rollupOrders(ctx.orders, { spend: ctx.totalSpend, operatingExpense, codSuccessRate: ctx.codSuccessRate }),
        operatingExpenseBreakdown: operatingExpenseBreakdown(ctx.activeExpenses, since, until),
      },
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
      totals: {
        ...rollupOrders(ctx.orders, { spend: ctx.totalSpend, operatingExpense: totalOperatingExpense, codSuccessRate: ctx.codSuccessRate }),
        operatingExpenseBreakdown: operatingExpenseBreakdown(ctx.activeExpenses, since, until),
      },
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
// Phase 18 §6 — rewritten to call the exact same resolveProductConfig()
// (via buildProductCostMap()'s lookup maps) that computeOrderCosts() uses
// for /summary, /campaigns, /daily, /hourly, /cod-prepaid — previously
// this endpoint re-implemented its own SKU-only probe in-line, which
// could disagree with the rest of the app about what counts as
// "matched" (e.g. a product configured only via Variant ID showed as
// "Unmatched SKU" here while correctly costed everywhere else). Grouped
// by the matched Product's own _id (not raw sku) so a product matched
// via variantId/productId/name still buckets into one row.
router.get("/:tokenId/products", async (req, res) => {
  try {
    const { tokenId } = req.params;
    const { since, until } = req.query;
    if (!since || !until) return res.status(400).json({ success: false, message: "since and until are required" });

    // Only needs orders + product config, not campaign/spend matching —
    // still goes through buildRangeContext so cost math stays identical
    // to every other endpoint (one place computes per-order costs).
    const ctx = await buildRangeContext(tokenId, { since, until, adAccountIdParam: req.query.adAccountId });
    const productLookupMaps = await buildProductCostMap();

    const byProduct = new Map(); // productDocId|"unmapped" -> row
    const rawOrders = await ShiprocketOrder.find({ orderDate: { $gte: since, $lte: until } }).select("raw").lean();
    rawOrders.forEach((o) => {
      extractProductLines(o.raw).forEach((line) => {
        const { cfg, tier } = resolveProductConfig(line, productLookupMaps);
        const key = cfg ? String(cfg._id) : "unmapped";
        if (!byProduct.has(key)) {
          byProduct.set(key, {
            productDocId: cfg ? String(cfg._id) : null,
            sku: cfg ? cfg.sku || null : null,
            variantId: cfg ? cfg.variantId || null : null,
            externalProductId: cfg ? cfg.productId || null : null,
            name: cfg ? cfg.name : "Unmapped Product",
            matchedVia: tier, // "variantId" | "sku" | "productId" | "name" | null
            units: 0,
            productCost: 0,
            packagingCost: 0,
            shippingCost: 0,
            otherCost: 0,
          });
        }
        const row = byProduct.get(key);
        row.units += line.quantity;
        if (cfg) {
          row.productCost += (cfg.productCost || 0) * line.quantity;
          row.packagingCost += (cfg.packagingCost || 0) * line.quantity;
          row.shippingCost += (cfg.shippingCost || 0) * line.quantity;
          row.otherCost += (cfg.otherCost || 0) * line.quantity;
        }
      });
    });

    const products = [...byProduct.values()]
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

// ── GET /:tokenId/expense-orders — Phase 18 §3 drill-down ────────────
// Read-only, additive: returns the actual per-order cost detail behind
// one Expenses-card figure (Product Cost / Packaging / Shipping / Other /
// Unmapped), reusing buildRangeContext's already-computed ctx.orders
// (Part 1's fix means every order already carries productCost/
// packagingCost/shippingCost/otherCost/amount/orderId/date) rather than
// re-querying or re-deriving anything. Capped so a huge date range can't
// return an unbounded list; count/cappedAt tell the caller when it was
// capped. Shaped so it can be handed straight to OrdersListPopup with a
// small custom columns array (there is no orderCreatedAt at the minute-
// level here, only the order's calendar date).
const EXPENSE_ORDER_TYPES = new Set(["productCost", "packagingCost", "shippingCost", "otherCost", "totalCost", "unmapped"]);
router.get("/:tokenId/expense-orders", async (req, res) => {
  try {
    const { tokenId } = req.params;
    const { since, until } = req.query;
    if (!since || !until) return res.status(400).json({ success: false, message: "since and until are required" });
    const type = EXPENSE_ORDER_TYPES.has(req.query.type) ? req.query.type : "totalCost";

    const ctx = await buildRangeContext(tokenId, { since, until, adAccountIdParam: req.query.adAccountId });

    const metricOf = (o) => (type === "unmapped" ? o.unmatchedUnits || 0 : o[type] || 0);
    const filtered = ctx.orders.filter((o) => metricOf(o) > 0).sort((a, b) => metricOf(b) - metricOf(a));

    const CAP = 500;
    const capped = filtered.slice(0, CAP);
    const orders = capped.map((o) => ({
      orderId: o.orderId,
      campaignId: o.matchedCampaignId,
      campaignName: o.matchedCampaignName,
      totalAmountPayable: o.amount,
      paymentType: o.paymentType,
      deliveryStatus: o.deliveryStatus,
      orderDate: o.date,
      orderCreatedAt: o.date,
      productCost: round2(o.productCost),
      packagingCost: round2(o.packagingCost),
      shippingCost: round2(o.shippingCost),
      otherCost: round2(o.otherCost),
      totalCost: round2(o.totalCost),
      matchedUnits: o.matchedUnits,
      unmatchedUnits: o.unmatchedUnits,
    }));

    res.json({
      success: true,
      since,
      until,
      type,
      count: filtered.length,
      cappedAt: filtered.length > CAP ? CAP : null,
      orders,
    });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

// ── GET /:tokenId/debug/sample-order-shape — Phase 19 §2/§5 ──────────
// Admin-only, read-only diagnostic. This app's order `raw` payload comes
// from a bespoke internal API (see the big comment on extractProductLines
// above), so its true product-line-item shape has never been confirmed
// against real data anywhere in this codebase — every extractor here has
// always been a defensive best-guess. Rather than keep guessing blindly,
// this exposes exactly what extractProductLines() (the SAME function
// every cost calculation uses — not a reimplementation) finds for one
// real order: which container path (if any) resolved to a line-items
// array, the raw key names on that array's first item, and — only if the
// caller explicitly opts in via ?includeValues=true, since this can
// surface real SKU/customer-adjacent data — the actual extracted
// name/sku/variantId/productId/quantity values, so a real mismatch (e.g.
// a casing or field-name difference from what's configured on the
// Product page) can be confirmed and fixed precisely instead of guessed
// at again. Defaults to the single most recent order; pass ?orderId=...
// to inspect a specific one.
router.get("/:tokenId/debug/sample-order-shape", requireAdmin, async (req, res) => {
  try {
    const { orderId } = req.query;
    const includeValues = req.query.includeValues === "true";

    const query = orderId ? { orderId: String(orderId) } : {};
    const order = await ShiprocketOrder.findOne(query).sort({ orderCreatedAt: -1 }).select("orderId orderDate raw").lean();

    if (!order) {
      return res.status(404).json({ success: false, message: orderId ? `Order ${orderId} not found` : "No orders found" });
    }

    const raw = order.raw || {};
    const topLevelKeys = Object.keys(raw).sort();
    const cartDataKeys = raw.cart_data ? Object.keys(raw.cart_data).sort() : null;

    // Probe the exact same container paths extractProductLines() tries,
    // in the exact same order, so this reports which one (if any) is
    // actually where the real data lives for this order.
    const candidatePaths = [
      ["cart_data.line_items", raw?.cart_data?.line_items],
      ["line_items", raw?.line_items],
      ["order_items", raw?.order_items],
      ["cart_data.order_items", raw?.cart_data?.order_items],
      ["products", raw?.products],
      ["items", raw?.items],
      ["cart_data.products", raw?.cart_data?.products],
      ["cart_data.cart_items", raw?.cart_data?.cart_items],
      ["cart.items", raw?.cart?.items],
      ["cart.line_items", raw?.cart?.line_items],
    ];
    const foundPath = candidatePaths.find(([, val]) => Array.isArray(val) && val.length > 0);

    const lines = extractProductLines(raw); // the real, single-source-of-truth extractor

    res.json({
      success: true,
      orderId: order.orderId,
      orderDate: order.orderDate,
      rawTopLevelKeys: topLevelKeys,
      cartDataKeys,
      lineItemsContainerPath: foundPath ? foundPath[0] : null,
      lineItemsContainerKeys: foundPath ? Object.keys(foundPath[1][0] || {}).sort() : [],
      lineItemsFoundCount: foundPath ? foundPath[1].length : 0,
      extractedLineItemCount: lines.length,
      extractedLineItems: includeValues ? lines : lines.map((l) => ({ hasName: !!l.name, hasSku: !!l.sku, hasVariantId: !!l.variantId, hasProductId: !!l.productId, quantity: l.quantity })),
      hint:
        lines.length === 0
          ? "No line items were found under any known container path — check rawTopLevelKeys/cartDataKeys above for the real field name and extend extractProductLines() in profitability.js to probe it."
          : lines.every((l) => !l.sku && !l.variantId && !l.productId)
          ? "Line items were found, but none carry a sku/variant_id/product_id under any probed field name — check extractedLineItems (pass ?includeValues=true) for the real key names on each item."
          : "Line items were found with at least one identifier populated — if Profitability still shows ₹0 for this product, double-check the exact SKU/Variant ID typed into the Product Cost page matches (case no longer matters as of Phase 19, but a typo/whitespace difference still would).",
    });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

export default router;
