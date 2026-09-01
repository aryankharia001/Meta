import ShiprocketOrder from "../models/shiprocketorder.js";
import BudgetHistory from "../models/BudgetHistory.js";
import BidCapHistory from "../models/BidCapHistory.js";
import MetaEntityState from "../models/MetaEntityState.js";
import { fbGet, actIdOf, GRAPH_BASE } from "./metaGraph.js";
import { getActivitySnapshot, getActivitySnapshotsBulk } from "./campaignActivity.js";
// Campaign History Phase — additive import only, same shared resolver
// every route file in this app now uses (see this module's own header
// comment below and campaignIdentity.js's header for the full picture).
import { buildCampaignIdentityResolver, buildSingleCampaignResolver } from "./campaignIdentity.js";

// ─────────────────────────────────────────────────────────────────────
// Phase 44 — Campaign Activity History + Hourly ROAS. Entirely new,
// additive module (imported only by the new endpoints added to
// routes/campaignActivity.js). Same "zero coupling between phases"
// convention every phase since Phase 8 has used: nothing here modifies
// hourly.js/dailyHourly.js/controlHelpers.js/campaigns.js/
// campaignExplorer.js, and nothing they do can ever break this file.
//
// Scope, per the phase spec: normal Meta campaign/ad set/ad activity and
// normal Meta/Shiprocket order performance ONLY. This module never
// imports or queries anything Abandoned-Cart-related — it only ever
// reads ShiprocketOrder (which has never stored Abandoned Cart rows;
// those lived in a separate, now-removed collection entirely) plus the
// existing Budget/Bid Cap/Status history collections Phase 27/39
// already established, generalized in campaignActivity.js to also cover
// Ad Sets/Ads.
//
// Order matching follows the exact same established rules the rest of
// the app already uses (never reinvented here): a Campaign is resolved
// via the shared current + auto-historical + manual mapping chain
// (Campaign History Phase — lib/campaignIdentity.js), same rule as
// campaigns.js/campaignExplorer.js/dailyReports.js/dailyHourly.js/
// hourly.js — NOT by the raw campaignId Shiprocket stores per order (a
// UTM value, not guaranteed to equal Meta's real campaign id). An Ad
// Set/Ad is matched by the adsetId/adId Shiprocket already stores per
// order — a direct ID match, same rule as adSetExplorer.js/
// adExplorer.js/hourly.js.
//
// Revenue/ROAS use the exact same figures every other page already
// computes from ShiprocketOrder.totalAmountPayable — no second revenue
// engine (spec §22). ROAS edge cases follow spec §21: spend 0 → null
// (rendered "—" by the client, same as this app's existing zero-spend
// convention); revenue 0 with spend > 0 → 0.00, never null.
// ─────────────────────────────────────────────────────────────────────

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function pad2(n) {
  return String(n).padStart(2, "0");
}
function round2(n) {
  if (n === null || n === undefined || isNaN(n)) return null;
  return Math.round(Number(n) * 100) / 100;
}
function istHourOf(dateVal) {
  if (!dateVal) return null;
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return null;
  return new Date(d.getTime() + IST_OFFSET_MS).getUTCHours();
}
function hourStartIst(date, hour) {
  return new Date(`${date}T${pad2(hour)}:00:00.000+05:30`);
}
function hourEndIst(date, hour) {
  return new Date(`${date}T${pad2(hour)}:59:59.999+05:30`);
}
export const normalizeCampaignName = (name) => String(name || "").trim().toLowerCase().replace(/\s+/g, " ");

// Spec §21 — the one ROAS formula every level/granularity in this
// module uses. null (never 0, never Infinity) when there's no spend to
// divide by; a genuine 0.00 when there was spend but zero revenue.
export function computeRoas(revenue, spend) {
  if (!spend || spend <= 0) return null;
  return round2(Number(revenue || 0) / spend);
}

// Percent change, spec §25/§28. null when `before` is 0 and `after`
// isn't (an undefined percentage, not a fabricated one) — 0 when both
// are 0 (genuinely unchanged).
export function pctChange(before, after) {
  const b = Number(before || 0);
  const a = Number(after || 0);
  if (b === 0) return a === 0 ? 0 : null;
  return round2(((a - b) / b) * 100);
}

function enumerateIstDays(since, until) {
  const days = [];
  const start = new Date(`${since}T00:00:00.000Z`);
  const end = new Date(`${until}T00:00:00.000Z`);
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

// ── Meta Graph helpers (duplicated locally per this codebase's own
// "zero coupling between phases" convention — see this file's header)

async function fetchAccountCampaigns(accountIds, accessToken) {
  const byId = new Map(); // campaignId -> { id, name, effectiveStatus }
  for (const accountId of accountIds || []) {
    try {
      const data = await fbGet(
        `${GRAPH_BASE}/${actIdOf(accountId)}/campaigns?fields=${encodeURIComponent("id,name,effective_status")}&limit=500&access_token=${accessToken}`
      );
      (data.data || []).forEach((c) => byId.set(String(c.id), { id: String(c.id), name: c.name || "", effectiveStatus: c.effective_status || "" }));
    } catch (err) {
      console.log(`Campaign Activity: known-campaign fetch failed for ${accountId}: ${err.message}`);
    }
  }
  return byId;
}

// Meta's hourly breakdown, requested at campaign/adset/ad LEVEL so one
// call per account returns every entity's own hourly spend, rather than
// one call per entity — the same breakdown key hourly.js/dailyHourly.js
// already use, just combined with `level` instead of a single objectId.
export async function fetchHourlySpendByLevel({ level, accountIds, accessToken, date }) {
  const idField = level === "campaign" ? "campaign_id" : level === "adset" ? "adset_id" : "ad_id";
  const nameField = level === "campaign" ? "campaign_name" : level === "adset" ? "adset_name" : "ad_name";
  const fields =
    level === "ad"
      ? "ad_id,ad_name,adset_id,campaign_id,campaign_name,spend"
      : level === "adset"
      ? "adset_id,adset_name,campaign_id,campaign_name,spend"
      : "campaign_id,campaign_name,spend";
  const breakdown = "hourly_stats_aggregated_by_advertiser_time_zone";
  const timeRange = encodeURIComponent(JSON.stringify({ since: date, until: date }));

  const byEntity = new Map(); // entityId -> { name, campaignId, campaignName, adsetId, byHour: Map(hour -> spend) }
  let any = false;
  let lastError = null;

  for (const accountId of accountIds || []) {
    try {
      const url = `${GRAPH_BASE}/${actIdOf(accountId)}/insights?level=${level}&fields=${encodeURIComponent(
        fields
      )}&breakdowns=${breakdown}&time_range=${timeRange}&limit=500&access_token=${accessToken}`;
      const data = await fbGet(url);
      const rows = data.data || [];
      if (rows.length) any = true;
      rows.forEach((row) => {
        const entityId = String(row[idField] || "");
        if (!entityId) return;
        const label = row.hourly_stats_aggregated_by_advertiser_time_zone || "";
        const hour = parseInt(String(label).slice(0, 2), 10);
        if (isNaN(hour) || hour < 0 || hour > 23) return;

        let entry = byEntity.get(entityId);
        if (!entry) {
          entry = {
            name: row[nameField] || "",
            campaignId: row.campaign_id ? String(row.campaign_id) : null,
            campaignName: row.campaign_name || null,
            adsetId: row.adset_id ? String(row.adset_id) : null,
            byHour: new Map(),
          };
          byEntity.set(entityId, entry);
        }
        const cur = entry.byHour.get(hour) || 0;
        entry.byHour.set(hour, cur + Number(row.spend || 0));
      });
    } catch (err) {
      lastError = err.message;
      console.log(`Campaign Activity: hourly ${level} spend fetch failed for ${accountId}: ${err.message}`);
    }
  }
  return { available: any, error: any ? null : lastError, byEntity };
}

// Day-level (not hourly) per-campaign spend across a date range — one
// call per account for the WHOLE range, same time_increment=1 approach
// dailyReports.js's fetchDailyInsights already established, duplicated
// here for the same "zero coupling" reason.
async function fetchDailySpendByCampaign({ accountIds, accessToken, since, until }) {
  const byDate = new Map(); // date -> total spend across matched campaigns that day
  let any = false;
  let lastError = null;
  for (const accountId of accountIds || []) {
    try {
      const url =
        `${GRAPH_BASE}/${actIdOf(accountId)}/insights?level=campaign` +
        `&fields=${encodeURIComponent("campaign_id,campaign_name,spend")}` +
        `&time_range=${encodeURIComponent(JSON.stringify({ since, until }))}` +
        `&time_increment=1&limit=500&access_token=${accessToken}`;
      const data = await fbGet(url);
      const rows = data.data || [];
      if (rows.length) any = true;
      rows.forEach((row) => {
        const date = row.date_start;
        if (!date) return;
        byDate.set(date, (byDate.get(date) || 0) + Number(row.spend || 0));
      });
    } catch (err) {
      lastError = err.message;
      console.log(`Campaign Activity: daily spend fetch failed for ${accountId}: ${err.message}`);
    }
  }
  return { available: any, error: any ? null : lastError, byDate };
}

// Resolve a campaign's current real name from Meta — only used when the
// caller doesn't already have it (the frontend normally does, from
// whichever list/hourly response it drilled down from).
async function resolveCampaignName(campaignId, accessToken) {
  try {
    const data = await fbGet(`${GRAPH_BASE}/${campaignId}?fields=name&access_token=${accessToken}`);
    return data.name || null;
  } catch (err) {
    console.log(`Campaign Activity: campaign name resolve failed for ${campaignId}: ${err.message}`);
    return null;
  }
}

// ── Order matching + per-order-set stats ────────────────────────────

async function orderFilterFor(entityType, { tokenId, campaignName, entityId } = {}) {
  if (entityType === "campaign") {
    // Campaign History Phase — resolved via the shared current + auto-
    // historical + manual mapping chain (see lib/campaignIdentity.js's
    // header), scoped to just this one campaign, so a renamed
    // campaign's pre-rename orders still show in its own hourly drill.
    const singleResolver = await buildSingleCampaignResolver({ tokenId, campaignId: entityId, currentName: campaignName || "" });
    return (o) => !!singleResolver.resolve(o).campaignId;
  }
  if (entityType === "adset") return (o) => String(o.adsetId || "") === String(entityId);
  if (entityType === "ad") return (o) => String(o.adId || "") === String(entityId);
  return () => false;
}

function statsOf(orders) {
  let revenue = 0,
    prepaid = 0,
    cod = 0;
  for (const o of orders) {
    revenue += Number(o.totalAmountPayable || 0);
    if (o.paymentType === "PREPAID") prepaid += 1;
    else if (o.paymentType === "CASH_ON_DELIVERY") cod += 1;
  }
  return { orders: orders.length, prepaid, cod, revenue: round2(revenue) };
}

// ── Value-at-hour reconstruction (Budget/Bid Cap "applied to hour",
// spec §14/§15/§20) ──────────────────────────────────────────────────
//
// BudgetHistory/BidCapHistory only ever store CHANGES (previous → new),
// never a baseline "value at tracking start" row — so reconstructing
// "what was the value at hour H" needs three cases, all honest, never
// fabricated:
//  1. There's a recorded change at or before hour H → its `new` value.
//  2. There's no change at/before H, but there IS one after H → the
//     value must have been that change's own `previous` value (that's
//     what "previous" means) — not a guess, a logical certainty.
//  3. No change ever recorded for this entity at all → the entity's
//     CURRENT known value, assumed constant back through this day. This
//     is the same "continuity" assumption the rest of the app already
//     makes everywhere it shows a "current" budget/bid cap; it is never
//     presented as a *different* historical value, just the one steady
//     value observed the whole time this app has tracked the entity.
function buildHourlyValueSeries({ changes, date, prevKey, newKey, currentFallback }) {
  const sorted = [...(changes || [])].sort((a, b) => new Date(a.changedAt) - new Date(b.changedAt));
  const series = [];
  for (let h = 0; h < 24; h++) {
    const hourStart = hourStartIst(date, h);
    let value = null;
    let found = false;
    for (const c of sorted) {
      if (new Date(c.changedAt) <= hourStart) {
        value = c[newKey];
        found = true;
      } else break;
    }
    if (!found) {
      const firstAfter = sorted.find((c) => new Date(c.changedAt) > hourStart);
      value = firstAfter ? firstAfter[prevKey] : currentFallback ?? null;
    }
    series.push(value === undefined ? null : value);
  }
  return series;
}

async function adsetBudgetSeries(entityId, date, currentFallback) {
  const changes = await BudgetHistory.find({ entityType: "adset", entityId }).lean();
  return buildHourlyValueSeries({ changes, date, prevKey: "previousBudget", newKey: "newBudget", currentFallback });
}
async function adsetBidCapSeries(entityId, date, currentFallback) {
  const changes = await BidCapHistory.find({ entityType: "adset", entityId }).lean();
  return buildHourlyValueSeries({ changes, date, prevKey: "previousBidAmount", newKey: "newBidAmount", currentFallback });
}

// Spec §16 — Campaign Budget Fallback: a genuine campaign-level budget
// (tracked directly) always wins; otherwise fall back to the SUM of
// this campaign's own tracked Ad Sets' budgets, per hour — never "N/A"
// when an Ad Set budget is available. Mirrors the existing real-time
// fallback campaigns.js/campaignExplorer.js already use (daily totals
// preferred over lifetime when a campaign's Ad Sets mix cadences),
// reconstructed hour-by-hour from history instead of a live Meta call.
export async function campaignBudgetSeries({ tokenId, campaignId, date }) {
  const campaignState = await MetaEntityState.findOne({ tokenId, entityType: "campaign", entityId: campaignId }).lean();
  const campaignChanges = await BudgetHistory.find({ entityType: "campaign", entityId: campaignId }).lean();
  const hasCampaignLevel = (campaignState && campaignState.budget !== null && campaignState.budget !== undefined) || campaignChanges.length > 0;

  if (hasCampaignLevel) {
    const series = buildHourlyValueSeries({
      changes: campaignChanges,
      date,
      prevKey: "previousBudget",
      newKey: "newBudget",
      currentFallback: campaignState?.budget ?? null,
    });
    return { series, budgetType: campaignState?.budgetType || campaignChanges[campaignChanges.length - 1]?.budgetType || null, source: "campaign" };
  }

  const adsetStates = await MetaEntityState.find({ tokenId, entityType: "adset", campaignId }).lean();
  if (!adsetStates.length) return { series: Array(24).fill(null), budgetType: null, source: "none" };

  const adsetIds = adsetStates.map((a) => a.entityId);
  const allChanges = await BudgetHistory.find({ entityType: "adset", entityId: { $in: adsetIds } }).lean();
  const changesByAdset = new Map();
  for (const c of allChanges) {
    const k = String(c.entityId);
    if (!changesByAdset.has(k)) changesByAdset.set(k, []);
    changesByAdset.get(k).push(c);
  }

  const dailySeries = Array(24).fill(0);
  const lifetimeSeries = Array(24).fill(0);
  let hasDailyAny = false,
    hasLifetimeAny = false;
  for (const a of adsetStates) {
    const changes = changesByAdset.get(String(a.entityId)) || [];
    const series = buildHourlyValueSeries({ changes, date, prevKey: "previousBudget", newKey: "newBudget", currentFallback: a.budget ?? null });
    const budgetType = a.budgetType || changes[changes.length - 1]?.budgetType || "daily";
    for (let h = 0; h < 24; h++) {
      const v = series[h];
      if (v === null || v === undefined) continue;
      if (budgetType === "lifetime") {
        lifetimeSeries[h] += v;
        hasLifetimeAny = true;
      } else {
        dailySeries[h] += v;
        hasDailyAny = true;
      }
    }
  }
  if (hasDailyAny) return { series: dailySeries.map(round2), budgetType: "daily", source: "adsets" };
  if (hasLifetimeAny) return { series: lifetimeSeries.map(round2), budgetType: "lifetime", source: "adsets" };
  return { series: Array(24).fill(null), budgetType: null, source: "none" };
}

// Bid Cap has no campaign-level concept in Meta's API in practice (see
// BidCapHistory.js's own header) — always reconstructed as the
// min/max range across this campaign's tracked Ad Sets, per hour. A
// single number when every tracked Ad Set agrees, an explicit range
// when they don't — same convention campaigns.js's real-time fallback
// already uses (BidCapCell collapses equal min/max client-side).
export async function campaignBidCapSeries({ tokenId, campaignId, date }) {
  const adsetStates = await MetaEntityState.find({ tokenId, entityType: "adset", campaignId }).lean();
  if (!adsetStates.length) return { minSeries: Array(24).fill(null), maxSeries: Array(24).fill(null), source: "none" };

  const adsetIds = adsetStates.map((a) => a.entityId);
  const allChanges = await BidCapHistory.find({ entityType: "adset", entityId: { $in: adsetIds } }).lean();
  const changesByAdset = new Map();
  for (const c of allChanges) {
    const k = String(c.entityId);
    if (!changesByAdset.has(k)) changesByAdset.set(k, []);
    changesByAdset.get(k).push(c);
  }

  const perAdsetSeries = adsetStates.map((a) => {
    const changes = changesByAdset.get(String(a.entityId)) || [];
    return buildHourlyValueSeries({ changes, date, prevKey: "previousBidAmount", newKey: "newBidAmount", currentFallback: a.bidAmount ?? null });
  });

  const minSeries = [],
    maxSeries = [];
  for (let h = 0; h < 24; h++) {
    const vals = perAdsetSeries.map((s) => s[h]).filter((v) => v !== null && v !== undefined);
    if (!vals.length) {
      minSeries.push(null);
      maxSeries.push(null);
      continue;
    }
    minSeries.push(round2(Math.min(...vals)));
    maxSeries.push(round2(Math.max(...vals)));
  }
  return { minSeries, maxSeries, source: "adsets" };
}

// ── Status-at-hour (Active/Paused/Closed bucket per hour, spec §1/§4) ─

export async function activeStatusSeries({ tokenId, entityId, entityType, date }) {
  const snapshot = await getActivitySnapshot({ tokenId, entityId, entityType });
  const series = [];
  for (let h = 0; h < 24; h++) {
    if (!snapshot.available) {
      series.push(null);
      continue;
    }
    const hourStart = hourStartIst(date, h);
    const period = snapshot.periods.find((p) => new Date(p.start) <= hourStart && (!p.end || hourStart < new Date(p.end)));
    series.push(period ? period.bucket : null);
  }
  return series;
}

// How many of `entityIds` (campaigns, typically) were in the "active"
// bucket at each hour of `date` — powers the account-wide "Active
// Campaigns" column (spec §5/§6).
async function activeCountSeries({ tokenId, entityIds, entityType, date }) {
  const snapshots = await getActivitySnapshotsBulk({ tokenId, entityIds, entityType });
  const series = Array(24).fill(0);
  for (let h = 0; h < 24; h++) {
    const hourStart = hourStartIst(date, h);
    for (const id of entityIds) {
      const snap = snapshots.get(id);
      if (!snap || !snap.available) continue;
      const period = snap.periods.find((p) => new Date(p.start) <= hourStart && (!p.end || hourStart < new Date(p.end)));
      if (period && period.bucket === "active") series[h] += 1;
    }
  }
  return series;
}

// Whether `entityId` had an "active" period overlapping the whole IST
// calendar day `date` at all (spec §5's daily "Active Campaigns" count
// — a campaign counts for a day if it was active at any point in it).
function activeOverlapsDay(snapshot, date) {
  if (!snapshot || !snapshot.available) return false;
  const dayStart = hourStartIst(date, 0);
  const dayEnd = hourEndIst(date, 23);
  return snapshot.periods.some((p) => p.bucket === "active" && new Date(p.start) <= dayEnd && (!p.end || new Date(p.end) > dayStart));
}

// ─────────────────────────────────────────────────────────────────────
// PUBLIC: Daily Campaign Activity (spec §5) — one row per day across a
// date range: Active Campaigns, Spend, Orders, Prepaid, COD, Revenue,
// ROAS. Matched orders only (orders attributed to a real, currently-
// known campaign) — Abandoned Cart is out of scope entirely (it isn't
// stored in ShiprocketOrder at all).
// ─────────────────────────────────────────────────────────────────────
export async function buildDailyActivityReport({ tokenId, accountIds, accessToken, since, until }) {
  const days = enumerateIstDays(since, until);
  const campaignsById = await fetchAccountCampaigns(accountIds, accessToken);
  const campaignIds = [...campaignsById.keys()];
  // Campaign History Phase — spec §21's required direction: order's
  // campaign_name -> current + auto-historical + manual mapping chain ->
  // Campaign ID, not the old "known campaign name -> orders" direction
  // (see lib/campaignIdentity.js's header).
  const campaignIdentityResolver = await buildCampaignIdentityResolver({
    tokenId,
    accountIds,
    liveCampaigns: [...campaignsById.values()].map((c) => ({ campaignId: c.id, campaignName: c.name })),
  });

  const { available: spendAvailable, error: spendError, byDate: spendByDate } = await fetchDailySpendByCampaign({
    accountIds,
    accessToken,
    since,
    until,
  });

  const snapshots = await getActivitySnapshotsBulk({ tokenId, entityIds: campaignIds, entityType: "campaign" });

  const rows = [];
  for (const date of days) {
    const dayOrders = await ShiprocketOrder.find({ orderDate: date }).select("campaignName totalAmountPayable paymentType").lean();
    const matched = dayOrders.filter((o) => !!campaignIdentityResolver.resolve(o).campaignId);
    const stats = statsOf(matched);
    const spend = round2(spendByDate.get(date) || 0);
    const activeCampaigns = campaignIds.filter((id) => activeOverlapsDay(snapshots.get(id), date)).length;

    rows.push({
      date,
      activeCampaigns,
      spend,
      orders: stats.orders,
      prepaidOrders: stats.prepaid,
      codOrders: stats.cod,
      revenue: stats.revenue,
      roas: computeRoas(stats.revenue, spend),
    });
  }

  const totals = rows.reduce(
    (acc, r) => ({
      spend: acc.spend + r.spend,
      orders: acc.orders + r.orders,
      prepaidOrders: acc.prepaidOrders + r.prepaidOrders,
      codOrders: acc.codOrders + r.codOrders,
      revenue: acc.revenue + r.revenue,
    }),
    { spend: 0, orders: 0, prepaidOrders: 0, codOrders: 0, revenue: 0 }
  );

  return {
    since,
    until,
    metaSpendAvailable: spendAvailable,
    metaSpendError: spendAvailable ? null : spendError,
    days: rows,
    summary: {
      spend: round2(totals.spend),
      orders: totals.orders,
      prepaidOrders: totals.prepaidOrders,
      codOrders: totals.codOrders,
      revenue: round2(totals.revenue),
      roas: computeRoas(totals.revenue, totals.spend),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// PUBLIC: single-entity 24-hour drill (spec §6/§8/§9/§12/§13) — works
// identically for a campaign, an ad set, or an ad. Budget/Bid Cap only
// apply at campaign/ad-set level (null for "ad", which has neither in
// Meta's model); status/isActive apply at every level.
// ─────────────────────────────────────────────────────────────────────
export async function buildEntityHourlyReport({ tokenId, entityType, entityId, campaignId, campaignName, accountIds, accessToken, date }) {
  let resolvedCampaignName = campaignName || null;
  if (entityType === "campaign" && !resolvedCampaignName) {
    resolvedCampaignName = await resolveCampaignName(entityId, accessToken);
  }

  const level = entityType === "campaign" ? "campaign" : entityType === "adset" ? "adset" : "ad";
  const { available: metaHourlyAvailable, error: metaHourlyError, byEntity } = await fetchHourlySpendByLevel({
    level,
    accountIds,
    accessToken,
    date,
  });
  const spendEntry = byEntity.get(String(entityId));
  const spendByHour = spendEntry?.byHour || new Map();

  const dayOrders = await ShiprocketOrder.find({ orderDate: date })
    .select("orderCreatedAt totalAmountPayable paymentType campaignName adsetId adId")
    .lean();
  const filter = await orderFilterFor(entityType, { tokenId, campaignName: resolvedCampaignName, entityId });
  const matched = dayOrders.filter(filter);

  let budgetSeries = Array(24).fill(null);
  let budgetType = null;
  let budgetSource = "none";
  let bidCapMinSeries = Array(24).fill(null);
  let bidCapMaxSeries = Array(24).fill(null);
  let bidCapSource = "none";

  if (entityType === "campaign") {
    const b = await campaignBudgetSeries({ tokenId, campaignId: entityId, date });
    budgetSeries = b.series;
    budgetType = b.budgetType;
    budgetSource = b.source;
    const bc = await campaignBidCapSeries({ tokenId, campaignId: entityId, date });
    bidCapMinSeries = bc.minSeries;
    bidCapMaxSeries = bc.maxSeries;
    bidCapSource = bc.source;
  } else if (entityType === "adset") {
    const state = await MetaEntityState.findOne({ tokenId, entityType: "adset", entityId }).lean();
    budgetSeries = await adsetBudgetSeries(entityId, date, state?.budget ?? null);
    budgetType = state?.budgetType || null;
    budgetSource = budgetSeries.some((v) => v !== null) ? "adset" : "none";
    const bidSeries = await adsetBidCapSeries(entityId, date, state?.bidAmount ?? null);
    bidCapMinSeries = bidSeries;
    bidCapMaxSeries = bidSeries;
    bidCapSource = bidSeries.some((v) => v !== null) ? "adset" : "none";
  }
  // entityType "ad" — Meta ads have no budget/bid-cap of their own;
  // series stay null/"none", exactly as declared above.

  const statusSeries = await activeStatusSeries({ tokenId, entityId, entityType, date });

  const hours = [];
  for (let h = 0; h < 24; h++) {
    const spend = round2(spendByHour.get(h) || 0);
    const ordersInHour = matched.filter((o) => istHourOf(o.orderCreatedAt) === h);
    const stats = statsOf(ordersInHour);
    const bidCapMin = bidCapMinSeries[h];
    const bidCapMax = bidCapMaxSeries[h];

    hours.push({
      hour: h,
      label: `${pad2(h)}:00`,
      budget: budgetSeries[h],
      budgetType,
      budgetSource,
      bidCap: bidCapMin === bidCapMax ? bidCapMin : null,
      bidCapMin,
      bidCapMax,
      bidCapSource,
      status: statusSeries[h],
      isActive: statusSeries[h] === "active",
      spend,
      orders: stats.orders,
      prepaidOrders: stats.prepaid,
      codOrders: stats.cod,
      revenue: stats.revenue,
      roas: computeRoas(stats.revenue, spend),
    });
  }

  const totals = hours.reduce(
    (acc, h) => ({
      spend: acc.spend + h.spend,
      orders: acc.orders + h.orders,
      prepaidOrders: acc.prepaidOrders + h.prepaidOrders,
      codOrders: acc.codOrders + h.codOrders,
      revenue: acc.revenue + h.revenue,
    }),
    { spend: 0, orders: 0, prepaidOrders: 0, codOrders: 0, revenue: 0 }
  );

  return {
    date,
    entityType,
    entityId: String(entityId),
    entityName: entityType === "campaign" ? resolvedCampaignName : spendEntry?.name || null,
    campaignId: entityType === "campaign" ? String(entityId) : spendEntry?.campaignId || campaignId || null,
    campaignName: entityType === "campaign" ? resolvedCampaignName : spendEntry?.campaignName || null,
    metaHourlyAvailable,
    metaHourlyError: metaHourlyAvailable ? null : metaHourlyError,
    hours,
    summary: {
      spend: round2(totals.spend),
      orders: totals.orders,
      prepaidOrders: totals.prepaidOrders,
      codOrders: totals.codOrders,
      revenue: round2(totals.revenue),
      roas: computeRoas(totals.revenue, totals.spend),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// PUBLIC: all campaigns active/spending during one specific hour (spec
// §7) — the table shown after clicking an hour from the account-wide
// hourly view.
// ─────────────────────────────────────────────────────────────────────
export async function buildCampaignsForHour({ tokenId, accountIds, accessToken, date, hour }) {
  const campaignsById = await fetchAccountCampaigns(accountIds, accessToken);
  const campaignIds = [...campaignsById.keys()];

  const { available: metaHourlyAvailable, error: metaHourlyError, byEntity } = await fetchHourlySpendByLevel({
    level: "campaign",
    accountIds,
    accessToken,
    date,
  });

  const dayOrders = await ShiprocketOrder.find({ orderDate: date }).select("orderCreatedAt totalAmountPayable paymentType campaignName").lean();
  const ordersInHour = dayOrders.filter((o) => istHourOf(o.orderCreatedAt) === hour);
  // Campaign History Phase — spec §21's required direction: order's
  // campaign_name -> current + auto-historical + manual mapping chain ->
  // Campaign ID (see lib/campaignIdentity.js's header), bucketed once
  // up front rather than re-derived per campaign in the loop below.
  const campaignIdentityResolver = await buildCampaignIdentityResolver({
    tokenId,
    accountIds,
    liveCampaigns: [...campaignsById.values()].map((c) => ({ campaignId: c.id, campaignName: c.name })),
  });
  const ordersInHourByCampaignId = new Map();
  ordersInHour.forEach((o) => {
    const match = campaignIdentityResolver.resolve(o);
    if (!match.campaignId) return;
    if (!ordersInHourByCampaignId.has(match.campaignId)) ordersInHourByCampaignId.set(match.campaignId, []);
    ordersInHourByCampaignId.get(match.campaignId).push(o);
  });

  const snapshots = await getActivitySnapshotsBulk({ tokenId, entityIds: campaignIds, entityType: "campaign" });
  const hourStart = hourStartIst(date, hour);

  const rows = [];
  for (const [id, c] of campaignsById.entries()) {
    const snap = snapshots.get(id);
    const period = snap?.available ? snap.periods.find((p) => new Date(p.start) <= hourStart && (!p.end || hourStart < new Date(p.end))) : null;
    const isActive = period ? period.bucket === "active" : false;

    const spendEntry = byEntity.get(id);
    const spend = round2(spendEntry?.byHour.get(hour) || 0);

    const matched = ordersInHourByCampaignId.get(id) || [];
    const stats = statsOf(matched);

    if (!isActive && spend === 0 && stats.orders === 0) continue; // nothing to show for this campaign this hour

    const [b, bc] = await Promise.all([
      campaignBudgetSeries({ tokenId, campaignId: id, date }),
      campaignBidCapSeries({ tokenId, campaignId: id, date }),
    ]);

    rows.push({
      campaignId: id,
      campaignName: c.name,
      isActive,
      status: period?.bucket || null,
      budget: b.series[hour],
      budgetType: b.budgetType,
      budgetSource: b.source,
      bidCapMin: bc.minSeries[hour],
      bidCapMax: bc.maxSeries[hour],
      bidCap: bc.minSeries[hour] === bc.maxSeries[hour] ? bc.minSeries[hour] : null,
      spend,
      orders: stats.orders,
      prepaidOrders: stats.prepaid,
      codOrders: stats.cod,
      revenue: stats.revenue,
      roas: computeRoas(stats.revenue, spend),
    });
  }

  rows.sort((a, b) => b.spend - a.spend || b.revenue - a.revenue);

  return { date, hour, metaHourlyAvailable, metaHourlyError: metaHourlyAvailable ? null : metaHourlyError, campaigns: rows };
}

// ─────────────────────────────────────────────────────────────────────
// PUBLIC: every campaign's WHOLE-DAY totals (spec §17's Campaign-Based
// exploration mode: Day → Campaign list, hour-independent — as opposed
// to buildCampaignsForHour() above, which is scoped to one hour). Same
// underlying data, just summed across all 24 hours instead of filtered
// to one.
// ─────────────────────────────────────────────────────────────────────
export async function buildCampaignsForDay({ tokenId, accountIds, accessToken, date }) {
  const campaignsById = await fetchAccountCampaigns(accountIds, accessToken);
  const campaignIds = [...campaignsById.keys()];

  const { available: metaHourlyAvailable, error: metaHourlyError, byEntity } = await fetchHourlySpendByLevel({
    level: "campaign",
    accountIds,
    accessToken,
    date,
  });

  const dayOrders = await ShiprocketOrder.find({ orderDate: date }).select("totalAmountPayable paymentType campaignName").lean();
  const snapshots = await getActivitySnapshotsBulk({ tokenId, entityIds: campaignIds, entityType: "campaign" });
  // Campaign History Phase — spec §21's required direction: order's
  // campaign_name -> current + auto-historical + manual mapping chain ->
  // Campaign ID (see lib/campaignIdentity.js's header), bucketed once
  // up front rather than re-derived per campaign in the loop below.
  const campaignIdentityResolver = await buildCampaignIdentityResolver({
    tokenId,
    accountIds,
    liveCampaigns: [...campaignsById.values()].map((c) => ({ campaignId: c.id, campaignName: c.name })),
  });
  const dayOrdersByCampaignId = new Map();
  dayOrders.forEach((o) => {
    const match = campaignIdentityResolver.resolve(o);
    if (!match.campaignId) return;
    if (!dayOrdersByCampaignId.has(match.campaignId)) dayOrdersByCampaignId.set(match.campaignId, []);
    dayOrdersByCampaignId.get(match.campaignId).push(o);
  });

  const rows = [];
  for (const [id, c] of campaignsById.entries()) {
    const spendEntry = byEntity.get(id);
    const spend = round2(spendEntry ? [...spendEntry.byHour.values()].reduce((s, v) => s + v, 0) : 0);

    const matched = dayOrdersByCampaignId.get(id) || [];
    const stats = statsOf(matched);

    const isActiveToday = activeOverlapsDay(snapshots.get(id), date);
    if (!isActiveToday && spend === 0 && stats.orders === 0) continue;

    const [b, bc] = await Promise.all([
      campaignBudgetSeries({ tokenId, campaignId: id, date }),
      campaignBidCapSeries({ tokenId, campaignId: id, date }),
    ]);
    // Representative Budget/Bid Cap for the day-level row: the value
    // applicable right now (last hour with a known value) — the entity's
    // own hourly drill (buildEntityHourlyReport) is where the full
    // hour-by-hour Budget/Bid Cap history is shown.
    const lastKnown = (series) => [...series].reverse().find((v) => v !== null && v !== undefined) ?? null;

    rows.push({
      campaignId: id,
      campaignName: c.name,
      isActiveToday,
      status: c.effectiveStatus || null,
      budget: lastKnown(b.series),
      budgetType: b.budgetType,
      bidCapMin: lastKnown(bc.minSeries),
      bidCapMax: lastKnown(bc.maxSeries),
      spend,
      orders: stats.orders,
      prepaidOrders: stats.prepaid,
      codOrders: stats.cod,
      revenue: stats.revenue,
      roas: computeRoas(stats.revenue, spend),
    });
  }

  rows.sort((a, b) => b.spend - a.spend || b.revenue - a.revenue);
  return { date, metaHourlyAvailable, metaHourlyError: metaHourlyAvailable ? null : metaHourlyError, campaigns: rows };
}

// ─────────────────────────────────────────────────────────────────────
// PUBLIC: child entities (Ad Sets under a Campaign, or Ads under an Ad
// Set) for one hour — spec §11's hierarchy drill.
// ─────────────────────────────────────────────────────────────────────
export async function buildChildrenForHour({ tokenId, parentType, parentId, accountIds, accessToken, date, hour }) {
  const childLevel = parentType === "campaign" ? "adset" : "ad";
  const { available: metaHourlyAvailable, error: metaHourlyError, byEntity } = await fetchHourlySpendByLevel({
    level: childLevel,
    accountIds,
    accessToken,
    date,
  });

  const children = [...byEntity.entries()].filter(([, v]) =>
    parentType === "campaign" ? String(v.campaignId || "") === String(parentId) : String(v.adsetId || "") === String(parentId)
  );

  const dayOrders = await ShiprocketOrder.find({ orderDate: date }).select("orderCreatedAt totalAmountPayable paymentType adsetId adId").lean();
  const ordersInHour = dayOrders.filter((o) => istHourOf(o.orderCreatedAt) === hour);

  const rows = [];
  for (const [childId, entry] of children) {
    const spend = round2(entry.byHour.get(hour) || 0);
    const matched = ordersInHour.filter((o) => (childLevel === "adset" ? String(o.adsetId || "") === childId : String(o.adId || "") === childId));
    const stats = statsOf(matched);

    let budget = null,
      bidCap = null,
      status = null;
    if (childLevel === "adset") {
      const state = await MetaEntityState.findOne({ tokenId, entityType: "adset", entityId: childId }).lean();
      const [bSeries, bidSeries, statusSeries] = await Promise.all([
        adsetBudgetSeries(childId, date, state?.budget ?? null),
        adsetBidCapSeries(childId, date, state?.bidAmount ?? null),
        activeStatusSeries({ tokenId, entityId: childId, entityType: "adset", date }),
      ]);
      budget = bSeries[hour];
      bidCap = bidSeries[hour];
      status = statusSeries[hour];
    } else {
      const statusSeries = await activeStatusSeries({ tokenId, entityId: childId, entityType: "ad", date });
      status = statusSeries[hour];
    }

    if (spend === 0 && stats.orders === 0 && status !== "active") continue;

    rows.push({
      [childLevel === "adset" ? "adsetId" : "adId"]: childId,
      name: entry.name || childId,
      status,
      isActive: status === "active",
      budget,
      bidCap,
      spend,
      orders: stats.orders,
      prepaidOrders: stats.prepaid,
      codOrders: stats.cod,
      revenue: stats.revenue,
      roas: computeRoas(stats.revenue, spend),
    });
  }

  rows.sort((a, b) => b.spend - a.spend || b.revenue - a.revenue);
  return { date, hour, parentType, parentId, childLevel, metaHourlyAvailable, metaHourlyError: metaHourlyAvailable ? null : metaHourlyError, children: rows };
}

// ─────────────────────────────────────────────────────────────────────
// PUBLIC: account-wide hourly rollup (spec §6, when no single campaign
// is selected) — spend/orders/revenue/ROAS summed across every matched
// campaign, plus how many campaigns were active each hour. Budget is
// shown as the sum of every active campaign's applicable budget; Bid
// Cap has no meaningful single value across many campaigns and is left
// null at this rollup level (shown per-campaign instead, spec §7).
// ─────────────────────────────────────────────────────────────────────
export async function buildAccountHourlyReport({ tokenId, accountIds, accessToken, date }) {
  const campaignsById = await fetchAccountCampaigns(accountIds, accessToken);
  const campaignIds = [...campaignsById.keys()];
  // Campaign History Phase — spec §21's required direction: order's
  // campaign_name -> current + auto-historical + manual mapping chain ->
  // Campaign ID, not the old "known campaign name -> orders" direction
  // (see lib/campaignIdentity.js's header).
  const campaignIdentityResolver = await buildCampaignIdentityResolver({
    tokenId,
    accountIds,
    liveCampaigns: [...campaignsById.values()].map((c) => ({ campaignId: c.id, campaignName: c.name })),
  });

  const { available: metaHourlyAvailable, error: metaHourlyError, byEntity } = await fetchHourlySpendByLevel({
    level: "campaign",
    accountIds,
    accessToken,
    date,
  });

  const dayOrders = await ShiprocketOrder.find({ orderDate: date }).select("orderCreatedAt totalAmountPayable paymentType campaignName").lean();
  const matchedOrders = dayOrders.filter((o) => !!campaignIdentityResolver.resolve(o).campaignId);

  const activeCampaigns = await activeCountSeries({ tokenId, entityIds: campaignIds, entityType: "campaign", date });

  // Sum every active campaign's applicable budget per hour.
  const budgetByCampaign = await Promise.all(campaignIds.map((id) => campaignBudgetSeries({ tokenId, campaignId: id, date })));
  const snapshots = await getActivitySnapshotsBulk({ tokenId, entityIds: campaignIds, entityType: "campaign" });

  const hours = [];
  for (let h = 0; h < 24; h++) {
    const spendEntry = [...byEntity.values()].reduce((s, v) => s + Number(v.byHour.get(h) || 0), 0);
    const spend = round2(spendEntry);
    const ordersInHour = matchedOrders.filter((o) => istHourOf(o.orderCreatedAt) === h);
    const stats = statsOf(ordersInHour);

    const hourStart = hourStartIst(date, h);
    let budgetSum = 0;
    let anyBudget = false;
    campaignIds.forEach((id, idx) => {
      const snap = snapshots.get(id);
      const period = snap?.available ? snap.periods.find((p) => new Date(p.start) <= hourStart && (!p.end || hourStart < new Date(p.end))) : null;
      if (period && period.bucket === "active") {
        const v = budgetByCampaign[idx].series[h];
        if (v !== null && v !== undefined) {
          budgetSum += v;
          anyBudget = true;
        }
      }
    });

    hours.push({
      hour: h,
      label: `${pad2(h)}:00`,
      activeCampaigns: activeCampaigns[h],
      budget: anyBudget ? round2(budgetSum) : null,
      bidCap: null,
      spend,
      orders: stats.orders,
      prepaidOrders: stats.prepaid,
      codOrders: stats.cod,
      revenue: stats.revenue,
      roas: computeRoas(stats.revenue, spend),
    });
  }

  const totals = hours.reduce(
    (acc, h) => ({
      spend: acc.spend + h.spend,
      orders: acc.orders + h.orders,
      prepaidOrders: acc.prepaidOrders + h.prepaidOrders,
      codOrders: acc.codOrders + h.codOrders,
      revenue: acc.revenue + h.revenue,
    }),
    { spend: 0, orders: 0, prepaidOrders: 0, codOrders: 0, revenue: 0 }
  );

  return {
    date,
    metaHourlyAvailable,
    metaHourlyError: metaHourlyAvailable ? null : metaHourlyError,
    hours,
    summary: {
      spend: round2(totals.spend),
      orders: totals.orders,
      prepaidOrders: totals.prepaidOrders,
      codOrders: totals.codOrders,
      revenue: round2(totals.revenue),
      roas: computeRoas(totals.revenue, totals.spend),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// PUBLIC: Before/After Comparison Window (spec §23-§30). Reuses
// buildEntityHourlyReport()'s already-computed per-hour array — never a
// separate/approximate fetch (spec §30) — and simply sums the hours
// inside each selected window. Hour-granularity boundaries (Meta's
// Insights API has no sub-hour spend data — see controlHelpers.js's own
// note — so no page in this app can honestly do better than that).
// beforeEnd/afterEnd are INCLUSIVE hour numbers (0-23): "Before: 00→05"
// means hours 0,1,2,3,4,5 (i.e. through 05:59).
// ─────────────────────────────────────────────────────────────────────
export async function buildComparison({
  tokenId,
  entityType,
  entityId,
  campaignId,
  campaignName,
  accountIds,
  accessToken,
  date,
  beforeStart,
  beforeEnd,
  afterStart,
  afterEnd,
}) {
  const report = await buildEntityHourlyReport({ tokenId, entityType, entityId, campaignId, campaignName, accountIds, accessToken, date });

  const windowStats = (startHour, endHour) => {
    const hours = report.hours.filter((h) => h.hour >= startHour && h.hour <= endHour);
    const spend = round2(hours.reduce((s, h) => s + h.spend, 0));
    const orders = hours.reduce((s, h) => s + h.orders, 0);
    const prepaidOrders = hours.reduce((s, h) => s + h.prepaidOrders, 0);
    const codOrders = hours.reduce((s, h) => s + h.codOrders, 0);
    const revenue = round2(hours.reduce((s, h) => s + h.revenue, 0));
    const roas = computeRoas(revenue, spend);
    const last = hours[hours.length - 1] || null;
    const first = hours[0] || null;
    return {
      window: { startHour, endHour, label: `${pad2(startHour)}:00–${pad2(endHour)}:59` },
      spend,
      orders,
      prepaidOrders,
      codOrders,
      revenue,
      roas,
      budget: last ? last.budget : null,
      bidCap: last ? last.bidCap : null,
      costPerOrder: orders ? round2(spend / orders) : null,
      revenuePerOrder: orders ? round2(revenue / orders) : null,
      prepaidPct: orders ? round2((prepaidOrders / orders) * 100) : null,
      codPct: orders ? round2((codOrders / orders) * 100) : null,
      _boundaryBudget: first ? first.budget : null,
      _boundaryBidCap: first ? first.bidCap : null,
    };
  };

  const before = windowStats(beforeStart, beforeEnd);
  const after = windowStats(afterStart, afterEnd);
  // "After" should read the budget/bid cap that took effect entering
  // its own window (its first hour), not its own window's last hour.
  after.budget = after._boundaryBudget;
  after.bidCap = after._boundaryBidCap;
  delete before._boundaryBudget;
  delete before._boundaryBidCap;
  delete after._boundaryBudget;
  delete after._boundaryBidCap;

  const metrics = ["spend", "orders", "prepaidOrders", "codOrders", "revenue", "roas", "budget", "bidCap"];
  const comparison = metrics.map((metric) => ({
    metric,
    before: before[metric],
    after: after[metric],
    changePercent: pctChange(before[metric], after[metric]),
  }));

  return {
    entityType,
    entityId: String(entityId),
    entityName: report.entityName,
    campaignId: report.campaignId,
    campaignName: report.campaignName,
    date,
    before,
    after,
    comparison,
    changes: {
      budget: before.budget !== after.budget ? { from: before.budget, to: after.budget } : null,
      bidCap: before.bidCap !== after.bidCap ? { from: before.bidCap, to: after.bidCap } : null,
    },
    timeline: report.hours.map((h) => ({ hour: h.hour, spend: h.spend, revenue: h.revenue, roas: h.roas })),
  };
}
