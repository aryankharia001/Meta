import express from "express";
import ShiprocketOrder from "../models/shiprocketorder.js";
import Token from "../models/Token.js";
import AdAccount from "../models/AdAccount.js";

const router = express.Router();

// ─────────────────────────────────────────────────────────────
// Phase 10 — Daily Campaign Reports. Entirely new, additive route file
// (mounted at /api/daily), following the exact same "zero coupling to
// earlier phases" convention campaignExplorer.js (Phase 8) already
// established: its own copies of the Graph API helpers and matching
// logic, read-only against ShiprocketOrder, never touches sync/
// backfill/matching/live-sync code. Nothing here can ever change
// /compare's, the campaign drawer's, or Campaign Explorer's behavior,
// and nothing they do can ever break this route.
//
// Day boundaries: ShiprocketOrder.orderDate is already stored as the
// IST calendar day (see server/utils/dateIst.js + the
// migrateOrderDatesToIst.mjs backfill that established this — every
// order in Mongo is already bucketed to its IST day, not UTC). Meta's
// own time_increment=1 insights are similarly bucketed by the ad
// account's configured reporting timezone (the existing app already
// assumes/relies on this lining up with IST everywhere else that reads
// time_increment=1 — see campaigns.js's /date-range and
// campaignExplorer.js's /breakdown). This route reuses both exactly as
// they already behave; it does not introduce a second timezone system.
// ─────────────────────────────────────────────────────────────

// ── Graph API helpers (duplicated from campaignExplorer.js) ──────

async function fbGet(urlStr) {
  const res = await fetch(urlStr);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const msg = data.error?.message || `FB API error (${res.status})`;
    throw new Error(msg);
  }
  return data;
}

async function fetchAllPages(url) {
  const results = [];
  let next = url;
  while (next) {
    const data = await fbGet(next);
    results.push(...(data.data || []));
    next = data.paging?.next || null;
  }
  return results;
}

async function tryFetchCampaigns(actId, accessToken) {
  const campaignFields = ["id", "name", "status", "effective_status", "daily_budget", "lifetime_budget"].join(",");
  try {
    const raw = await fetchAllPages(
      `https://graph.facebook.com/v19.0/${actId}/campaigns?fields=${encodeURIComponent(campaignFields)}&limit=200&access_token=${accessToken}`
    );
    if (raw.length > 0) return raw;
  } catch (err) {
    console.log(`Daily campaign fetch (act) failed for ${actId}: ${err.message}`);
  }
  try {
    const raw = await fetchAllPages(
      `https://graph.facebook.com/v19.0/me/campaigns?fields=${encodeURIComponent(campaignFields)}&limit=200&access_token=${accessToken}`
    );
    if (raw.length > 0) return raw;
  } catch (err) {
    console.log(`Daily campaign fetch (me) failed: ${err.message}`);
  }
  return [];
}

async function fetchDailyInsights(actId, accessToken, since, until) {
  const fields = ["campaign_id", "campaign_name", "spend"].join(",");
  const url =
    `https://graph.facebook.com/v19.0/${actId}/insights?level=campaign` +
    `&fields=${encodeURIComponent(fields)}` +
    `&time_range=${encodeURIComponent(JSON.stringify({ since, until }))}` +
    `&time_increment=1&limit=500&access_token=${accessToken}`;
  try {
    return await fetchAllPages(url);
  } catch (err) {
    console.log(`Daily insights fetch failed for ${actId}: ${err.message}`);
    return [];
  }
}

const normalizeCampaignName = (name) =>
  String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

// Phase 11 — UI/display-only helper (identical convention to the copies
// in campaigns.js/campaignExplorer.js). Meta returns daily_budget/
// lifetime_budget in the ad account's currency's minor unit — divide by
// 100 for the real amount. Never used in spend/revenue/ROAS/matching math.
function deriveBudget(meta) {
  if (!meta) return { budget: null, budgetType: null };
  if (meta.daily_budget !== undefined && meta.daily_budget !== null && meta.daily_budget !== "") {
    return { budget: Number(meta.daily_budget) / 100, budgetType: "daily" };
  }
  if (meta.lifetime_budget !== undefined && meta.lifetime_budget !== null && meta.lifetime_budget !== "") {
    return { budget: Number(meta.lifetime_budget) / 100, budgetType: "lifetime" };
  }
  return { budget: null, budgetType: null };
}

function extractDeliveryStatus(raw) {
  return (
    raw?.shipment_status ||
    raw?.delivery_status ||
    raw?.current_status ||
    raw?.shipments?.[0]?.status ||
    raw?.shipments?.[0]?.delivery_status ||
    null
  );
}

function extractOrderStatus(raw) {
  return raw?.order_status || raw?.status || null;
}

// Six buckets, same classification campaignExplorer.js's deliveryBucket6
// already uses — kept as a local copy for the same "zero coupling"
// reason. "processing" is folded into "pending" in the row shape below
// since the Daily spec's column list only asks for Pending, not a
// separate Processing bucket.
function deliveryBucket6(deliveryStatus) {
  const s = (deliveryStatus || "").toLowerCase();
  if (!s) return "pending";
  if (s.includes("rto")) return "rto";
  if (s.includes("return")) return "returned";
  if (s.includes("cancel")) return "cancelled";
  if (s.includes("deliver") && !s.includes("out for")) return "delivered";
  if (s.includes("process")) return "processing";
  return "pending";
}

// Products + quantities — same probing strategy orderDetails.js's
// extractProductLines already uses for the Order Drawer, duplicated
// locally (this file never imports from orderDetails.js/campaigns.js).
// Quantity defaults to 1 per line when Shiprocket's raw payload doesn't
// carry one, so "Total Units Sold" is never silently undercounted to 0
// just because quantity wasn't present on an order that clearly shipped
// at least one unit per line item.
function extractProductLines(raw) {
  const items = raw?.cart_data?.line_items || raw?.line_items || raw?.products || raw?.items || raw?.cart_data?.products;
  if (!Array.isArray(items) || items.length === 0) return [];
  return items.map((i) => ({
    name: i?.name || i?.product_name || i?.title || "Unknown product",
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

// Calendar-day enumeration via UTC date arithmetic on plain YYYY-MM-DD
// strings — the same technique Dashboard.jsx/AnalyticsPage.jsx already
// use client-side (shiftDays) for preset ranges, just walked one day at
// a time here instead of jumping by an offset.
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

function buildRow({ date, campaignId, campaignName, accountId, accountName, status, effectiveStatus, budget = null, budgetType = null, budgetSource = "none", spend, orders, isUnmatched = false }) {
  const totalOrders = orders.length;
  const revenue = orders.reduce((s, o) => s + Number(o.totalAmountPayable || 0), 0);
  let codOrders = 0,
    codRevenue = 0,
    prepaidOrders = 0,
    prepaidRevenue = 0;
  const delivery = { delivered: 0, pending: 0, processing: 0, cancelled: 0, returned: 0, rto: 0 };
  const productNames = new Set();
  let unitsSold = 0;

  orders.forEach((o) => {
    const amount = Number(o.totalAmountPayable || 0);
    if (o.paymentType === "PREPAID") {
      prepaidOrders += 1;
      prepaidRevenue += amount;
    } else if (o.paymentType === "CASH_ON_DELIVERY") {
      codOrders += 1;
      codRevenue += amount;
    }
    delivery[deliveryBucket6(extractDeliveryStatus(o.raw))] += 1;
    extractProductLines(o.raw).forEach((line) => {
      productNames.add(line.name);
      unitsSold += line.quantity;
    });
  });

  const spendNum = Number(spend || 0);

  return {
    date,
    campaignId: campaignId || null,
    campaignName,
    accountId: accountId || null,
    accountName: accountName || null,
    status: status || null,
    effectiveStatus: effectiveStatus || null,
    budget,
    budgetType,
    budgetSource,
    isUnmatched,

    spend: Math.round(spendNum * 100) / 100,
    orders: totalOrders,
    matchedOrders: isUnmatched ? 0 : totalOrders,
    unmatchedOrders: isUnmatched ? totalOrders : 0,
    revenue: Math.round(revenue * 100) / 100,
    roas: spendNum ? revenue / spendNum : 0,

    codOrders,
    codRevenue: Math.round(codRevenue * 100) / 100,
    prepaidOrders,
    prepaidRevenue: Math.round(prepaidRevenue * 100) / 100,

    delivered: delivery.delivered,
    pending: delivery.pending + delivery.processing,
    cancelled: delivery.cancelled,
    returned: delivery.returned,
    rto: delivery.rto,

    aov: totalOrders ? revenue / totalOrders : 0,
    costPerOrder: totalOrders ? spendNum / totalOrders : 0,

    totalProductsSold: productNames.size,
    totalUnitsSold: unitsSold,
  };
}

function rollup(rows) {
  const sum = (k) => rows.reduce((s, r) => s + Number(r[k] || 0), 0);
  const spend = sum("spend");
  const revenue = sum("revenue");
  const orders = sum("orders");
  return {
    spend: Math.round(spend * 100) / 100,
    revenue: Math.round(revenue * 100) / 100,
    orders,
    matchedOrders: sum("matchedOrders"),
    unmatchedOrders: sum("unmatchedOrders"),
    roas: spend ? revenue / spend : 0,
    codOrders: sum("codOrders"),
    codRevenue: Math.round(sum("codRevenue") * 100) / 100,
    prepaidOrders: sum("prepaidOrders"),
    prepaidRevenue: Math.round(sum("prepaidRevenue") * 100) / 100,
    delivered: sum("delivered"),
    pending: sum("pending"),
    cancelled: sum("cancelled"),
    returned: sum("returned"),
    rto: sum("rto"),
    aov: orders ? revenue / orders : 0,
    costPerOrder: orders ? spend / orders : 0,
    totalProductsSold: sum("totalProductsSold"),
    totalUnitsSold: sum("totalUnitsSold"),
    campaignCount: rows.filter((r) => !r.isUnmatched).length,
  };
}

function shapeOrderForDaily(o) {
  const customerName = [o.address?.firstName, o.address?.lastName].filter(Boolean).join(" ").trim();
  const lines = extractProductLines(o.raw);
  return {
    orderId: o.orderId,
    orderDate: o.orderDate,
    campaignId: o.campaignId,
    campaignName: o.campaignName,
    totalAmountPayable: o.totalAmountPayable,
    paymentType: o.paymentType,
    paymentStatus: o.paymentStatus,
    orderCreatedAt: o.orderCreatedAt,
    phone: o.phone || null,
    customerName: customerName || null,
    city: o.address?.city || null,
    state: o.address?.state || null,
    product: lines.map((l) => l.name).join(", ") || null,
    productQuantity: lines.reduce((s, l) => s + l.quantity, 0),
    orderStatus: extractOrderStatus(o.raw),
    deliveryStatus: extractDeliveryStatus(o.raw),
  };
}

// ── Response cache — same small TTL cache pattern campaignExplorer.js
// already uses, scoped to this file only. ─────────────────────────
const CACHE_TTL_MS = 45_000;
const responseCache = new Map();
function cacheGet(key) {
  const hit = responseCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    responseCache.delete(key);
    return null;
  }
  return hit.value;
}
function cacheSet(key, value) {
  responseCache.set(key, { value, at: Date.now() });
  if (responseCache.size > 200) {
    const oldestKey = [...responseCache.keys()][0];
    responseCache.delete(oldestKey);
  }
}

// ── GET /:tokenId — day-by-day campaign performance grid ───────────
router.get("/:tokenId", async (req, res) => {
  try {
    const { tokenId } = req.params;
    const { since, until } = req.query;
    if (!since || !until) {
      return res.status(400).json({ success: false, message: "since and until are required" });
    }

    const { token, accountIds, accountNameMap } = await resolveTokenAndAccounts(tokenId, req.query.adAccountId);

    const cacheKey = `daily:${tokenId}:${[...accountIds].sort().join(",")}:${since}:${until}`;
    const cached = cacheGet(cacheKey);
    if (cached) return res.json({ ...cached, cached: true });

    const campaignMeta = new Map(); // campaignId -> { name, accountId, accountName, status, effectiveStatus }
    const insightRows = []; // flat, across all accounts, with date_start per row

    for (const accountId of accountIds) {
      const actId = accountId.startsWith("act_") ? accountId : `act_${accountId}`;
      const [metaList, dailyInsights] = await Promise.all([
        tryFetchCampaigns(actId, token.accessToken).catch((err) => {
          console.log(`Daily metadata fetch failed for ${actId}: ${err.message}`);
          return [];
        }),
        fetchDailyInsights(actId, token.accessToken, since, until),
      ]);

      metaList.forEach((c) => {
        const { budget, budgetType } = deriveBudget(c);
        campaignMeta.set(String(c.id), {
          name: c.name,
          accountId,
          accountName: accountNameMap.get(accountId) || accountId,
          status: c.status || null,
          effectiveStatus: c.effective_status || null,
          budget,
          budgetType,
          budgetSource: budget !== null ? "campaign" : "none",
        });
      });

      // Phase 36 §4 — Campaign Budget Fallback, same approach as
      // campaigns.js's /compare: only bother fetching this account's ad
      // sets when at least one of its campaigns has no genuine
      // campaign-level budget, and only ever fall back for those specific
      // campaigns — a real campaign-level budget above is never replaced.
      const idsMissingBudget = metaList.filter((c) => !deriveBudget(c).budget).map((c) => String(c.id));
      if (idsMissingBudget.length > 0) {
        const missingSet = new Set(idsMissingBudget);
        try {
          const adsetList = await fetchAllPages(
            `https://graph.facebook.com/v19.0/${actId}/adsets?fields=${encodeURIComponent("id,campaign_id,daily_budget,lifetime_budget")}&limit=500&access_token=${token.accessToken}`
          );
          const sumByCampaignId = new Map();
          adsetList.forEach((a) => {
            const cid = String(a.campaign_id || "");
            if (!cid || !missingSet.has(cid)) return;
            const { budget: adsetBudget, budgetType: adsetBudgetType } = deriveBudget(a);
            if (adsetBudget === null) return;
            const entry = sumByCampaignId.get(cid) || { dailyTotal: 0, lifetimeTotal: 0, hasDaily: false, hasLifetime: false };
            if (adsetBudgetType === "daily") {
              entry.dailyTotal += adsetBudget;
              entry.hasDaily = true;
            } else if (adsetBudgetType === "lifetime") {
              entry.lifetimeTotal += adsetBudget;
              entry.hasLifetime = true;
            }
            sumByCampaignId.set(cid, entry);
          });
          sumByCampaignId.forEach((sum, cid) => {
            const entry = campaignMeta.get(cid);
            if (!entry) return;
            if (sum.hasDaily) {
              entry.budget = sum.dailyTotal;
              entry.budgetType = "daily";
            } else if (sum.hasLifetime) {
              entry.budget = sum.lifetimeTotal;
              entry.budgetType = "lifetime";
            } else {
              return;
            }
            entry.budgetSource = "adsets";
          });
        } catch (err) {
          console.log(`Ad set budget fallback fetch failed for ${actId}: ${err.message}`);
        }
      }

      dailyInsights.forEach((row) => {
        insightRows.push(row);
        const id = String(row.campaign_id || "");
        // A campaign that spent during this range but wasn't returned by
        // tryFetchCampaigns (e.g. deleted/archived since) still needs a
        // name to match orders against — same "insights row as fallback
        // metadata" approach fetchCombinedCampaigns uses in
        // campaignExplorer.js.
        if (id && !campaignMeta.has(id)) {
          campaignMeta.set(id, {
            name: row.campaign_name,
            accountId,
            accountName: accountNameMap.get(accountId) || accountId,
            status: null,
            effectiveStatus: null,
          });
        }
      });
    }

    const rawOrders = await ShiprocketOrder.find({ orderDate: { $gte: since, $lte: until } })
      .select("orderId orderDate campaignId campaignName totalAmountPayable paymentType orderCreatedAt phone address raw")
      .lean();

    const knownNames = new Set([...campaignMeta.values()].map((v) => normalizeCampaignName(v.name)));

    const ordersByDayName = new Map(); // `${day}|${normalizedName}` -> orders[]
    const unmatchedByDay = new Map(); // day -> orders[]
    rawOrders.forEach((o) => {
      const day = o.orderDate;
      const norm = normalizeCampaignName(o.campaignName);
      if (norm && knownNames.has(norm)) {
        const key = `${day}|${norm}`;
        if (!ordersByDayName.has(key)) ordersByDayName.set(key, []);
        ordersByDayName.get(key).push(o);
      } else {
        if (!unmatchedByDay.has(day)) unmatchedByDay.set(day, []);
        unmatchedByDay.get(day).push(o);
      }
    });

    const insightsByDayCampaign = new Map(); // `${day}|${campaignId}` -> spend
    insightRows.forEach((row) => {
      const day = row.date_start;
      const id = String(row.campaign_id || "");
      if (!day || !id) return;
      insightsByDayCampaign.set(`${day}|${id}`, Number(row.spend || 0));
    });

    const days = enumerateDays(since, until);

    const dayPayloads = days.map((date) => {
      const activeCampaignIds = new Set();
      insightRows.forEach((row) => {
        if (row.date_start === date && Number(row.spend || 0) > 0) activeCampaignIds.add(String(row.campaign_id || ""));
      });
      campaignMeta.forEach((v, id) => {
        const n = normalizeCampaignName(v.name);
        if (ordersByDayName.has(`${date}|${n}`)) activeCampaignIds.add(id);
      });

      const rows = [];
      activeCampaignIds.forEach((campaignId) => {
        if (!campaignId) return;
        const meta = campaignMeta.get(campaignId);
        if (!meta) return;
        const norm = normalizeCampaignName(meta.name);
        const campaignOrders = ordersByDayName.get(`${date}|${norm}`) || [];
        rows.push(
          buildRow({
            date,
            campaignId,
            campaignName: meta.name,
            accountId: meta.accountId,
            accountName: meta.accountName,
            status: meta.status,
            effectiveStatus: meta.effectiveStatus,
            budget: meta.budget,
            budgetType: meta.budgetType,
            budgetSource: meta.budgetSource || "none",
            spend: insightsByDayCampaign.get(`${date}|${campaignId}`) || 0,
            orders: campaignOrders,
          })
        );
      });

      const unmatchedOrders = unmatchedByDay.get(date) || [];
      if (unmatchedOrders.length > 0) {
        rows.push(
          buildRow({
            date,
            campaignId: null,
            campaignName: "Unmatched Orders",
            accountId: null,
            accountName: null,
            status: null,
            effectiveStatus: null,
            spend: 0,
            orders: unmatchedOrders,
            isUnmatched: true,
          })
        );
      }

      rows.sort((a, b) => b.spend - a.spend || b.revenue - a.revenue);

      return { date, campaigns: rows, totals: rollup(rows) };
    });

    const payload = {
      success: true,
      since,
      until,
      accountIds,
      days: dayPayloads,
      totals: rollup(dayPayloads.flatMap((d) => d.campaigns)),
    };

    cacheSet(cacheKey, payload);
    res.json(payload);
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

// ── GET /:tokenId/detail — single (day, campaign) drill-down ───────
router.get("/:tokenId/detail", async (req, res) => {
  try {
    const { tokenId } = req.params;
    const { date, campaignId, campaignName, accountId } = req.query;
    if (!date || !campaignName) {
      return res.status(400).json({ success: false, message: "date and campaignName are required" });
    }

    const token = await Token.findById(tokenId).lean();
    if (!token) return res.status(404).json({ success: false, message: "Token not found" });

    const isUnmatched = !campaignId || campaignId === "null" || campaignName === "Unmatched Orders";

    let candidateAccountIds = [];
    if (accountId) {
      candidateAccountIds = [accountId];
    } else {
      const accounts = await AdAccount.find({ tokenId }).lean();
      candidateAccountIds = accounts.map((a) => a.adAccountId);
    }

    let spend = 0;
    let budget = null;
    let budgetType = null;
    let budgetSource = "none";
    if (!isUnmatched) {
      for (const acc of candidateAccountIds) {
        const actId = acc.startsWith("act_") ? acc : `act_${acc}`;
        try {
          const data = await fbGet(
            `https://graph.facebook.com/v19.0/${actId}/insights?level=campaign` +
              `&fields=${encodeURIComponent("campaign_id,spend")}` +
              `&time_range=${encodeURIComponent(JSON.stringify({ since: date, until: date }))}` +
              `&time_increment=1&limit=500&access_token=${token.accessToken}`
          );
          const hit = (data.data || []).find((r) => String(r.campaign_id) === String(campaignId));
          if (hit) {
            spend = Number(hit.spend || 0);
            break;
          }
        } catch (err) {
          console.log(`Daily detail insight fetch failed for ${actId}: ${err.message}`);
        }
      }

      // Phase 11 — Budget for this campaign's info strip, same tryFetchCampaigns
      // metadata call (now including daily_budget/lifetime_budget) used
      // elsewhere in this file. Additive only, doesn't affect spend above.
      for (const acc of candidateAccountIds) {
        const actId = acc.startsWith("act_") ? acc : `act_${acc}`;
        try {
          const list = await tryFetchCampaigns(actId, token.accessToken);
          const hit = list.find((c) => String(c.id) === String(campaignId));
          if (hit) {
            ({ budget, budgetType } = deriveBudget(hit));
            if (budget !== null) budgetSource = "campaign";
            break;
          }
        } catch (err) {
          console.log(`Daily detail budget fetch failed for ${actId}: ${err.message}`);
        }
      }

      // Phase 36 §4 — Campaign Budget Fallback: no genuine campaign-level
      // budget found above (Advantage+/CBO-off) — fall back to the sum of
      // THIS campaign's own Ad Set budgets, one bulk /adsets call per
      // candidate account, same convention as /:tokenId above and
      // campaigns.js's /compare.
      if (budget === null) {
        for (const acc of candidateAccountIds) {
          const actId = acc.startsWith("act_") ? acc : `act_${acc}`;
          try {
            const adsetList = await fetchAllPages(
              `https://graph.facebook.com/v19.0/${actId}/adsets?fields=${encodeURIComponent("id,campaign_id,daily_budget,lifetime_budget")}&limit=500&access_token=${token.accessToken}`
            );
            let dailyTotal = 0, lifetimeTotal = 0, hasDaily = false, hasLifetime = false;
            adsetList.forEach((a) => {
              if (String(a.campaign_id || "") !== String(campaignId)) return;
              const { budget: adsetBudget, budgetType: adsetBudgetType } = deriveBudget(a);
              if (adsetBudget === null) return;
              if (adsetBudgetType === "daily") {
                dailyTotal += adsetBudget;
                hasDaily = true;
              } else if (adsetBudgetType === "lifetime") {
                lifetimeTotal += adsetBudget;
                hasLifetime = true;
              }
            });
            if (hasDaily || hasLifetime) {
              budget = hasDaily ? dailyTotal : lifetimeTotal;
              budgetType = hasDaily ? "daily" : "lifetime";
              budgetSource = "adsets";
              break;
            }
          } catch (err) {
            console.log(`Daily detail ad set budget fallback fetch failed for ${actId}: ${err.message}`);
          }
        }
      }
    }

    const rawOrders = await ShiprocketOrder.find({ orderDate: date })
      .select("orderId orderDate campaignId campaignName totalAmountPayable paymentType paymentStatus orderCreatedAt phone address raw")
      .lean();

    let matchingOrders;
    if (isUnmatched) {
      const knownNames = new Set();
      for (const acc of candidateAccountIds) {
        const actId = acc.startsWith("act_") ? acc : `act_${acc}`;
        try {
          const list = await tryFetchCampaigns(actId, token.accessToken);
          list.forEach((c) => {
            const n = normalizeCampaignName(c.name);
            if (n) knownNames.add(n);
          });
        } catch (err) {
          console.log(`Daily detail known-names fetch failed for ${actId}: ${err.message}`);
        }
      }
      matchingOrders = rawOrders.filter((o) => !knownNames.has(normalizeCampaignName(o.campaignName)));
    } else {
      const normalizedTarget = normalizeCampaignName(campaignName);
      matchingOrders = rawOrders.filter((o) => normalizeCampaignName(o.campaignName) === normalizedTarget);
    }

    const orders = matchingOrders
      .map(shapeOrderForDaily)
      .sort((a, b) => new Date(b.orderCreatedAt || 0) - new Date(a.orderCreatedAt || 0));

    const metrics = buildRow({
      date,
      campaignId: isUnmatched ? null : campaignId,
      campaignName,
      accountId: accountId || null,
      accountName: null,
      status: null,
      effectiveStatus: null,
      budget,
      budgetType,
      budgetSource,
      spend,
      orders: matchingOrders,
      isUnmatched,
    });

    res.json({
      success: true,
      date,
      isUnmatched,
      campaign: { id: isUnmatched ? null : campaignId, name: campaignName, accountId: accountId || null },
      metrics,
      orders,
      dayStartIst: `${date}T00:00:00+05:30`,
      dayEndIst: `${date}T23:59:59+05:30`,
    });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

export default router;
