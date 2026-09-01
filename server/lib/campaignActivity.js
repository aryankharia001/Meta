import CampaignStatusHistory from "../models/CampaignStatusHistory.js";
import MetaEntityState from "../models/MetaEntityState.js";
import BudgetHistory from "../models/BudgetHistory.js";
import BidCapHistory from "../models/BidCapHistory.js";

// ─────────────────────────────────────────────────────────────
// Phase 39 — Campaign Activity History, Active/Inactive Periods & Order
// Attribution. Shared, additive helpers imported by
// services/metaEntitySync.js (writes), routes/campaigns.js and
// routes/campaignExplorer.js (reads, additive fields only), and the new
// routes/campaignActivity.js (the Campaign Drawer's dedicated timeline
// endpoint). Nothing in this file is imported by, or changes the
// behavior of, any pre-Phase-39 code path — every existing caller of
// the files this module touches keeps working exactly as before.
//
// Core idea: Meta's Graph API has no status-history endpoint (the same
// reason Phase 27 built a polling reconciler instead of reading history
// from Meta directly — see metaEntitySync.js's own header comment), so
// a campaign's activity timeline can only ever be reconstructed from
// the moment this app first observed it onward. Everything before that
// first observation is honestly unknown — never invented — see
// ensureBaseline()/seedStatusHistoryBaseline() below.
// ─────────────────────────────────────────────────────────────

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

// ── Status bucket classification (Active / Paused / Closed) ────────
//
// Meta's effective_status vocabulary is wider than the three buckets
// this phase's spec asks for. ACTIVE/IN_PROCESS/PENDING_REVIEW are the
// same "live" set campaignDisplay.js's isLiveStatus() already treats as
// delivering. ARCHIVED/DELETED are Meta's own non-resumable-in-practice
// terminal states — that's "Closed" here. Everything else (PAUSED and
// every review/billing/issue status, which none of them mean "actively
// delivering") buckets as "paused" for attribution purposes; the raw
// Meta status string is still preserved and shown as-is in the UI, only
// this normalized bucket drives period/attribution math.
const ACTIVE_STATUSES = new Set(["ACTIVE", "IN_PROCESS", "PENDING_REVIEW"]);
const CLOSED_STATUSES = new Set(["ARCHIVED", "DELETED"]);

export function statusBucket(effectiveStatus) {
  const s = String(effectiveStatus || "").toUpperCase();
  if (!s) return "paused";
  if (ACTIVE_STATUSES.has(s)) return "active";
  if (CLOSED_STATUSES.has(s)) return "closed";
  return "paused";
}

// prevBucket -> newBucket transition -> the spec's §1 event vocabulary.
// Only ever called for a genuine transition (prevBucket !== newBucket);
// the very first row for an entity is handled separately by
// seedStatusHistoryBaseline() below (it's a baseline observation, not a
// transition from a known prior state).
export function activityTypeFor(prevBucket, newBucket) {
  if (!prevBucket || prevBucket === newBucket) return null;
  if (newBucket === "active") return prevBucket === "closed" ? "reactivated" : "resumed";
  if (newBucket === "paused") return "paused";
  if (newBucket === "closed") return "closed";
  return null;
}

// Phase 44 — entityType-aware label noun. Defaulting entityType to
// "campaign" keeps every pre-Phase-44 call site (which never passes
// entityType) byte-for-byte identical to the original ACTIVITY_LABELS
// map this replaced; only a caller that explicitly passes "adset"/"ad"
// (new in this phase, for Ad Set / Ad status history) gets the
// different noun.
const ENTITY_NOUN = { campaign: "Campaign", adset: "Ad Set", ad: "Ad" };

function activityLabelsFor(entityType) {
  const noun = ENTITY_NOUN[entityType] || "Campaign";
  return {
    created: `${noun} Created`,
    activated: `${noun} Activated`,
    paused: `${noun} Paused`,
    resumed: `${noun} Resumed`,
    closed: `${noun} Closed`,
    reactivated: `${noun} Reactivated`,
    tracking_started: "Activity Tracking Started",
  };
}

export function activityLabel(activityType, entityType = "campaign") {
  return activityLabelsFor(entityType)[activityType] || "Status Changed";
}

// ── Baseline seeding (first time an entity is ever observed) ───────
//
// Meta's own created_time is real, Meta-sourced data — safe to use as
// the "Campaign Created" timestamp when we caught the campaign
// essentially at birth (created within TRACKING_GAP_MS of this first
// observation). When the campaign already existed well before this app
// started watching it, inventing a "Created"/"Activated" timestamp
// would violate spec §14 ("do not invent timestamps") — so that case
// gets an honest "Activity Tracking Started" row instead, and
// buildPeriods() below treats everything before it as unavailable
// rather than active or inactive.
const TRACKING_GAP_MS = 24 * 60 * 60 * 1000;

export async function seedStatusHistoryBaseline({ tokenId, accountId, entityType = "campaign", entityId, entityName, effectiveStatus, createdTime }) {
  const now = new Date();
  const bucket = statusBucket(effectiveStatus);
  const createdAt = createdTime ? new Date(createdTime) : null;
  const realCreatedRecent = createdAt && !isNaN(createdAt.getTime()) && now - createdAt.getTime() <= TRACKING_GAP_MS;
  const noun = ENTITY_NOUN[entityType] || "Campaign";

  const base = {
    tokenId,
    accountId,
    entityType,
    entityId,
    entityName: entityName || "",
    previousStatus: null,
    newStatus: effectiveStatus || null,
    previousBucket: null,
    newBucket: bucket,
    source: "System",
  };

  if (realCreatedRecent) {
    return CampaignStatusHistory.create({
      ...base,
      activityType: "created",
      changedAt: createdAt,
      message: `${noun} "${entityName || entityId}" created`,
    });
  }

  return CampaignStatusHistory.create({
    ...base,
    activityType: "tracking_started",
    changedAt: now,
    message: `Activity tracking started for ${noun.toLowerCase()} "${entityName || entityId}" (observed status: ${effectiveStatus || "unknown"})`,
  });
}

// Full baseline — used by the list endpoints (campaigns.js/
// campaignExplorer.js), which already have status/effectiveStatus in
// hand from a bulk Meta call they were making anyway, so this is a
// DB-only operation (no extra Graph API call). Idempotent: no-ops if
// MetaEntityState already has a row for this entity, whichever code
// path (this one, or metaEntitySync.js's reconcileEntity) created it
// first. entityType is accepted for symmetry with MetaEntityState's own
// schema, but the CampaignStatusHistory baseline row is only ever
// written for entityType "campaign" — Phase 39 is campaign-only.
export async function ensureBaseline({ tokenId, accountId, entityType = "campaign", entityId, entityName, status, effectiveStatus, createdTime, campaignId = "", adsetId = "" }) {
  if (!tokenId || !entityId) return;
  const existing = await MetaEntityState.findOne({ tokenId, entityType, entityId }).select("_id").lean();
  if (existing) return;

  try {
    await MetaEntityState.create({
      tokenId,
      accountId,
      entityType,
      entityId,
      name: entityName || "",
      status: status || null,
      effectiveStatus: effectiveStatus || null,
      // Phase 44 — additive linkage (blank/no-op for entityType
      // "campaign", which has no parent) — see MetaEntityState.js's
      // own header for why these exist.
      campaignId: campaignId || "",
      adsetId: adsetId || "",
      lastSyncedAt: new Date(),
    });
  } catch (err) {
    // Benign race — another concurrent request/tick created the same
    // baseline first (unique index on {tokenId, entityType, entityId}).
    // Nothing further to do; that other call already seeded history.
    if (err.code === 11000) return;
    throw err;
  }

  // Phase 39 seeded this baseline row only for entityType "campaign".
  // Phase 44 §1 extends the exact same honest baseline event to Ad
  // Sets and Ads (Active/Paused/Closed status only — there's no
  // budget/bid-cap concept at the Ad level) — seedStatusHistoryBaseline()
  // is itself entityType-aware now (see its own header above), so this
  // call is safe for whichever entityType ensureBaseline was invoked
  // with; it never ran for anything but "campaign" before this phase
  // added new "adset"/"ad" call sites (adSetExplorer.js/adExplorer.js),
  // so existing campaign behavior is unchanged.
  await seedStatusHistoryBaseline({ tokenId, accountId, entityType, entityId, entityName, effectiveStatus, createdTime }).catch((err) => {
    console.error(`Status history baseline failed for ${entityType} ${entityId}: ${err.message}`);
  });
}

// Bulk variant for list endpoints — one existence-check query instead
// of N, same "bulk, not per-item" principle campaigns.js's own Ad Set
// budget/bid-cap fallback already established. Only campaigns actually
// missing a MetaEntityState row do any writing; everyone else (the
// common case, after the first load) costs one Mongo query and nothing
// else.
export async function ensureBaselinesBulk({ tokenId, accountId, campaigns }) {
  const list = (campaigns || []).filter((c) => c && c.entityId);
  if (!tokenId || !list.length) return;

  const ids = [...new Set(list.map((c) => String(c.entityId)))];
  const existingRows = await MetaEntityState.find({ tokenId, entityType: "campaign", entityId: { $in: ids } })
    .select("entityId")
    .lean();
  const existingSet = new Set(existingRows.map((r) => String(r.entityId)));
  const missing = list.filter((c) => !existingSet.has(String(c.entityId)));

  for (const c of missing) {
    await ensureBaseline({
      tokenId,
      accountId,
      entityType: "campaign",
      entityId: c.entityId,
      entityName: c.entityName,
      status: c.status,
      effectiveStatus: c.effectiveStatus,
      createdTime: c.createdTime,
    }).catch((err) => console.error(`ensureBaselinesBulk failed for campaign ${c.entityId}: ${err.message}`));
  }
}

// Phase 44 — generic bulk baseline seeder for Ad Sets/Ads (entityType
// "adset"/"ad"), used by adSetExplorer.js's/adExplorer.js's list
// endpoints. A NEW function rather than a modification of
// ensureBaselinesBulk() above (which stays exactly as Phase 39 left it,
// still only ever called with entityType "campaign" by campaigns.js/
// campaignExplorer.js) — same "zero coupling between phases" convention
// this file's own header documents. One existence-check query per call,
// same "bulk, not per-item" principle as ensureBaselinesBulk() above.
// Each entity may carry its own accountId (ad sets/ads a list endpoint
// fetched can span multiple accounts) plus optional campaignId/adsetId
// linkage (an ad set's parent campaign id; an ad's parent ad set id).
export async function ensureEntityBaselinesBulk({ tokenId, entityType, entities }) {
  const list = (entities || []).filter((e) => e && e.entityId);
  if (!tokenId || !entityType || !list.length) return;

  const ids = [...new Set(list.map((e) => String(e.entityId)))];
  const existingRows = await MetaEntityState.find({ tokenId, entityType, entityId: { $in: ids } })
    .select("entityId")
    .lean();
  const existingSet = new Set(existingRows.map((r) => String(r.entityId)));
  const missing = list.filter((e) => !existingSet.has(String(e.entityId)));

  for (const e of missing) {
    await ensureBaseline({
      tokenId,
      accountId: e.accountId || "",
      entityType,
      entityId: e.entityId,
      entityName: e.entityName,
      status: e.status,
      effectiveStatus: e.effectiveStatus,
      createdTime: e.createdTime,
      campaignId: e.campaignId || "",
      adsetId: e.adsetId || "",
    }).catch((err) => console.error(`ensureEntityBaselinesBulk failed for ${entityType} ${e.entityId}: ${err.message}`));
  }
}

// ── Recording a genuine status transition (called from reconcileEntity) ─
export async function recordStatusChange({ tokenId, accountId, entityType = "campaign", entityId, entityName, previousStatus, newStatus, source, changedBy }) {
  const previousBucket = statusBucket(previousStatus);
  const newBucket = statusBucket(newStatus);
  const activityType = activityTypeFor(previousBucket, newBucket);
  // Bucket unchanged (e.g. PENDING_REVIEW -> ACTIVE, both "active") —
  // a real Meta status change, still logged to ActivityLog by the
  // existing caller, but not a meaningful Active/Paused/Closed
  // transition for this phase's period reconstruction.
  if (!activityType) return null;

  return CampaignStatusHistory.create({
    tokenId,
    accountId,
    entityType,
    entityId,
    entityName: entityName || "",
    previousStatus: previousStatus || null,
    newStatus: newStatus || null,
    previousBucket,
    newBucket,
    activityType,
    source,
    changedBy: changedBy || "",
    changedAt: new Date(),
    message: `${activityLabel(activityType, entityType)}${entityName ? ` — "${entityName}"` : ""} (${previousStatus || "?"} → ${newStatus || "?"})`,
  });
}

// ── Period reconstruction ───────────────────────────────────────────
//
// events: CampaignStatusHistory docs for one entity, any order — sorted
// ascending internally. Consecutive events reporting the same bucket
// (e.g. a duplicate observation, or a raw-status change that stayed
// within the same bucket) never open a new period. The LAST period
// always has end: null — "ongoing as of now" — callers treat that as
// "Current" for display and as `now` for duration/attribution math.
export function buildPeriods(events, now = new Date()) {
  const sorted = [...(events || [])]
    .filter((e) => e && e.newBucket)
    .sort((a, b) => new Date(a.changedAt) - new Date(b.changedAt));

  const periods = [];
  for (const ev of sorted) {
    const at = new Date(ev.changedAt);
    const last = periods[periods.length - 1];
    if (last && last.bucket === ev.newBucket) continue;
    if (last) last.end = at;
    periods.push({ bucket: ev.newBucket, start: at, end: null, activityType: ev.activityType });
  }

  const historicalDataAvailableFrom = sorted.length ? new Date(sorted[0].changedAt) : null;
  const firstActive = periods.find((p) => p.bucket === "active");
  const campaignStart = firstActive ? firstActive.start : null;

  const lastPeriod = periods.length ? periods[periods.length - 1] : null;
  const currentBucket = lastPeriod ? lastPeriod.bucket : null;
  // "Campaign End" only means something when the campaign's current,
  // final, still-open period is itself Closed — a Closed period that
  // was later followed by a Reactivated event is mid-history, not the
  // end.
  const campaignEnd = lastPeriod && lastPeriod.bucket === "closed" ? lastPeriod.start : null;

  return { periods, historicalDataAvailableFrom, campaignStart, campaignEnd, currentBucket };
}

// { days, hours, totalHours } — Explorer's separate "Active Days"/
// "Active Hours" columns (spec §4/§15) are the days/hours pair from
// this split; totalHours is exposed too for any consumer that wants a
// single number instead.
export function splitDurationMs(ms) {
  const totalHours = Math.floor(Math.max(0, ms || 0) / (60 * 60 * 1000));
  return { days: Math.floor(totalHours / 24), hours: totalHours % 24, totalHours };
}

export function formatDurationMs(ms) {
  if (!ms || ms <= 0) return "0h";
  const { days, hours } = splitDurationMs(ms);
  return days > 0 ? `${days}d ${hours}h` : `${hours}h`;
}

export function summarizeDurations(periods, now = new Date()) {
  let activeMs = 0;
  let inactiveMs = 0;
  let activePeriods = 0;
  let inactivePeriods = 0;

  for (const p of periods || []) {
    const start = new Date(p.start);
    const end = p.end ? new Date(p.end) : now;
    const ms = Math.max(0, end - start);
    if (p.bucket === "active") {
      activeMs += ms;
      activePeriods += 1;
    } else {
      // Paused and Closed time both roll into "Inactive" for the
      // Active/Inactive Days totals (spec §4) — Post-Campaign vs
      // Paused is still distinguished separately by classifyOrders()
      // below for order attribution.
      inactiveMs += ms;
      inactivePeriods += 1;
    }
  }

  const activeSplit = splitDurationMs(activeMs);
  const inactiveSplit = splitDurationMs(inactiveMs);

  return {
    activeMs,
    inactiveMs,
    activePeriods,
    inactivePeriods,
    activeLabel: formatDurationMs(activeMs),
    inactiveLabel: formatDurationMs(inactiveMs),
    // Phase 39 §4/§15 — Explorer's separate Active Days/Active Hours
    // (and Inactive equivalents) columns read these directly rather
    // than re-splitting activeLabel/inactiveLabel client-side.
    activeDays: activeSplit.days,
    activeHours: activeSplit.hours,
    inactiveDays: inactiveSplit.days,
    inactiveHours: inactiveSplit.hours,
  };
}

// Single-entity snapshot (Campaign Drawer / the new /campaign-activity
// route) — one query, no Meta calls.
export async function getActivitySnapshot({ tokenId, entityId, entityType = "campaign" }) {
  const now = new Date();
  if (!tokenId || !entityId) {
    return { available: false, periods: [], historicalDataAvailableFrom: null, campaignStart: null, campaignEnd: null, currentBucket: null, ...summarizeDurations([], now) };
  }
  const events = await CampaignStatusHistory.find({ tokenId, entityType, entityId }).sort({ changedAt: 1 }).lean();
  if (!events.length) {
    return { available: false, periods: [], historicalDataAvailableFrom: null, campaignStart: null, campaignEnd: null, currentBucket: null, ...summarizeDurations([], now) };
  }
  const built = buildPeriods(events, now);
  return { available: true, ...built, ...summarizeDurations(built.periods, now) };
}

// Bulk variant for list endpoints — one query for every campaign on
// the page instead of one query per row.
export async function getActivitySnapshotsBulk({ tokenId, entityIds, entityType = "campaign" }) {
  const map = new Map();
  const ids = [...new Set((entityIds || []).filter(Boolean).map(String))];
  if (!tokenId || !ids.length) return map;

  const now = new Date();
  const events = await CampaignStatusHistory.find({ tokenId, entityType, entityId: { $in: ids } })
    .sort({ changedAt: 1 })
    .lean();

  const byEntity = new Map();
  for (const ev of events) {
    const key = String(ev.entityId);
    if (!byEntity.has(key)) byEntity.set(key, []);
    byEntity.get(key).push(ev);
  }

  for (const id of ids) {
    const evs = byEntity.get(id) || [];
    if (!evs.length) {
      map.set(id, { available: false, periods: [], historicalDataAvailableFrom: null, campaignStart: null, campaignEnd: null, currentBucket: null, ...summarizeDurations([], now) });
      continue;
    }
    const built = buildPeriods(evs, now);
    map.set(id, { available: true, ...built, ...summarizeDurations(built.periods, now) });
  }

  return map;
}

// Most recent "closed" transition per entity — used only by
// metaEntitySyncCron.js to decide which long-closed campaigns to skip
// polling (Phase 39 §4's bounded auto-tracking). entityId (Meta's own
// campaign id) is globally unique, so this intentionally isn't scoped
// by tokenId — same convention controlHelpers.js's buildTimeline()
// already uses for BudgetHistory/BidCapHistory lookups.
export async function getLastClosedAtMap({ entityIds }) {
  const map = new Map();
  const ids = [...new Set((entityIds || []).filter(Boolean).map(String))];
  if (!ids.length) return map;

  const rows = await CampaignStatusHistory.find({ entityType: "campaign", entityId: { $in: ids }, newBucket: "closed" })
    .sort({ changedAt: -1 })
    .select("entityId changedAt")
    .lean();

  for (const r of rows) {
    const key = String(r.entityId);
    if (!map.has(key)) map.set(key, new Date(r.changedAt)); // first hit per id, desc-sorted = most recent
  }
  return map;
}

// ── Order attribution ───────────────────────────────────────────────
//
// orders: already-matched ShiprocketOrder docs/leans (the exact same
// set campaigns.js/campaignExplorer.js's existing normalizeCampaignName
// matching already produced — this function never re-matches or
// re-fetches orders, only classifies ones it's handed). periodsInfo is
// whatever buildPeriods()/getActivitySnapshot() returned.
export function classifyOrders(orders, periodsInfo) {
  const periods = periodsInfo?.periods || [];
  const historicalDataAvailableFrom = periodsInfo?.historicalDataAvailableFrom || null;
  const lastPeriod = periods.length ? periods[periods.length - 1] : null;

  const buckets = {
    active: { orders: 0, revenue: 0 },
    inactivePaused: { orders: 0, revenue: 0 },
    postCampaign: { orders: 0, revenue: 0 },
    historicalUnavailable: { orders: 0, revenue: 0 },
  };

  for (const order of orders || []) {
    const at = order.orderCreatedAt ? new Date(order.orderCreatedAt) : null;
    const amount = Number(order.totalAmountPayable || 0);

    let target = "historicalUnavailable";
    if (at && !isNaN(at.getTime()) && historicalDataAvailableFrom && at >= historicalDataAvailableFrom) {
      const period = periods.find((p) => at >= p.start && (p.end ? at < p.end : true));
      if (!period) {
        target = "historicalUnavailable"; // genuine gap — honest fallback, never guessed
      } else if (period.bucket === "active") {
        target = "active";
      } else if (period.bucket === "closed") {
        target = period === lastPeriod ? "postCampaign" : "inactivePaused";
      } else {
        target = "inactivePaused";
      }
    }

    buckets[target].orders += 1;
    buckets[target].revenue += amount;
  }

  for (const key of Object.keys(buckets)) buckets[key].revenue = round2(buckets[key].revenue);
  return buckets;
}

// Primary ROAS = active-period revenue over spend. Spend for a
// since/until window is, by construction, spend accrued only while
// Meta was actually delivering (paused/closed campaigns don't spend) —
// so the existing `spend` figure every caller already fetches for that
// window IS the active-period spend, with zero extra Graph API calls.
// null (never 0) when there's no active spend to divide by, matching
// spec §11's explicit "Primary Campaign ROAS: N/A" requirement.
export function computePrimaryRoas(activeRevenue, spend) {
  if (!spend || spend <= 0) return null;
  return round2(activeRevenue / spend);
}

// ── Merged Activity History timeline for the Campaign Drawer ───────
//
// Combines the new CampaignStatusHistory rows with the existing
// BudgetHistory/BidCapHistory rows for one campaign into a single
// descending event list. Deliberately a fresh implementation rather
// than a modification of controlHelpers.js's buildTimeline() (which
// backs the existing, untouched "Budget & Bid Cap Control" section's
// own timeline) — same "zero coupling between phases" convention this
// codebase already follows everywhere else.
export async function buildActivityTimeline({ tokenId, entityId, since, until }) {
  const range = {};
  if (since) range.$gte = new Date(since);
  if (until) range.$lte = new Date(until);
  const dateFilter = since || until ? { changedAt: range } : {};

  const [statusRows, budgetRows, bidRows] = await Promise.all([
    CampaignStatusHistory.find({ tokenId, entityType: "campaign", entityId, ...dateFilter }).sort({ changedAt: -1 }).lean(),
    BudgetHistory.find({ tokenId, entityType: "campaign", entityId, ...dateFilter }).sort({ changedAt: -1 }).lean(),
    BidCapHistory.find({ tokenId, entityType: "campaign", entityId, ...dateFilter }).sort({ changedAt: -1 }).lean(),
  ]);

  const events = [
    ...statusRows.map((r) => ({
      kind: "status_activity",
      id: String(r._id),
      at: r.changedAt,
      title: activityLabel(r.activityType),
      activityType: r.activityType,
      previousStatus: r.previousStatus,
      newStatus: r.newStatus,
      previousBucket: r.previousBucket,
      newBucket: r.newBucket,
      source: r.source,
      changedBy: r.changedBy,
      message: r.message,
    })),
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
  ];

  events.sort((a, b) => new Date(b.at) - new Date(a.at));
  return events;
}
