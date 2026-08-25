import axios from "axios";
import TrafleadAbandonedCartLead from "../models/TrafleadAbandonedCartLead.js";
import TrafleadSyncLog from "../models/TrafleadSyncLog.js";
import { todayIstIso, istDayStartUtc, istDayEndUtc, toIstDateString } from "../utils/dateIst.js";

// ═════════════════════════════════════════════════════════════
// Phase 33 — Exact Traflead Abandoned Cart Data Sync into Meta.
//
// Traflead (trafleadcrm) is a SEPARATE CRM project — a working system
// that is the source of truth for Abandoned Cart lead data. Nothing in
// that project is ever modified by this file; everything below was
// written after reading Traflead's actual source (not guessed):
//
//   - src/app.js's GET /api/leads-by-offer (defined inline in app.js,
//     not routes/) is Traflead's ONLY unauthenticated endpoint — no JWT
//     needed, confirmed by reading the route's middleware chain (there
//     is none). It groups leads by Offer and returns full Lead
//     documents per group. This is the endpoint this sync calls.
//
//   - BUG (in Traflead, left untouched — do not "fix" it there):
//     passing that endpoint's `offer`/`offerId` query param throws a
//     ReferenceError (app.js uses `mongoose.Types.ObjectId.isValid`
//     without ever requiring mongoose in that file), which the route's
//     own catch turns into a 500. This sync therefore NEVER sends
//     offer/offerId — it always fetches every offer's leads for the
//     date range and picks out the "Abandoned Cart" group by name from
//     the response instead. Confirmed dead-on-arrival by reading the
//     code, not by trial and error against the live server.
//
//   - The endpoint does its OWN date filtering on `orderDate` via raw
//     `new Date(startDate)` / `new Date(endDate)` — NO IST conversion
//     happens on Traflead's side. Traflead's *own* frontend (LeadList.jsx)
//     defaults its date filter to `createdAt` (not `orderDate`), and its
//     `orderDate` is unconditionally set to `new Date()` at lead-creation
//     time in the same write as `createdAt` (leadService.js), so the two
//     are always effectively identical — meaning the endpoint's own
//     `orderDate` filtering is a safe, reliable proxy for `createdAt`.
//     What was NOT safe (and is exactly today's Meta bug) is treating a
//     selected calendar date as a UTC day instead of an IST day. Fixed
//     HERE, at this layer: every call below computes the IST day
//     boundary using this app's own istDayStartUtc()/istDayEndUtc()
//     (server/utils/dateIst.js — the same helpers Shiprocket sync
//     already uses) and sends those as full UTC ISO instants, never a
//     bare "YYYY-MM-DD" (which `new Date("YYYY-MM-DD")` on Traflead's
//     side would parse as UTC midnight, not IST midnight — the bug).
//
//   - Traflead's Lead.status enum is EXACTLY
//     processing|approved|cancelled|hold|trash|confirmed — there is no
//     "delivered" lead status. "Delivered" only exists as a separate
//     shipment.status sub-field (confirmed by reading models/Lead.js).
//     Every status value stored/displayed here is the literal Traflead
//     string, never renamed.
//
//   - Traflead has no dedicated "Ad Set"/"Ad ID" fields — confirmed by
//     reading models/Lead.js, schemas/leadSchema.js, AND Traflead's own
//     frontend (LeadList.jsx labels the sub1 column "Sub1", not
//     "Ad Set"). Attribution fields mirrored here are exactly Traflead's
//     own: campaign, medium, webmaster, affiliateId, leadSource, sub1-5.
//
// Architecture mirrors services/shiprocketService.js on purpose (same
// per-IST-day sync-with-retry + TrafleadSyncLog + single-flight
// backfillState + separate read-path functions), for the same reason
// Shiprocket sync needed it: a page load must never trigger a live
// outbound API call by itself — only backfillTrafleadRange() (write)
// talks to Traflead; getStoredTrafleadLeads() (read) is pure Mongo.
//
// ─── Phase 34 — Abandoned Cart revenue now comes from shipment data ───
//
// Traflead's "Shipment" / "Active Shipment" page (client/src/components/
// shipments/ActiveShipments.jsx, server src/controllers/
// shipmentController.js) is NOT a separate data source — confirmed by
// reading that controller: getShipments/getShipmentById query the exact
// same `Lead` collection this sync already reads
// (`Lead.find({'shipment.awbNumber': ...})`), because shipment info is
// an embedded `shipment` sub-document directly on the Lead schema (see
// src/models/Lead.js lines ~450-565: shipment.status, shipment.
// deliveredAt, shipment.awbNumber, shipment.courierName, etc.). And
// `/api/leads-by-offer` (the endpoint this sync already calls) does
// `Lead.find(groupFilter)...lean()` with NO field projection — so the
// full `shipment` sub-object was already coming back in every sync
// response; normalizeLead() above was already capturing shipmentStatus/
// shipmentDeliveredAt from it since Phase 33. There is no second,
// separately-authenticated shipment fetch to build and no Order-ID
// matching step to perform — it's the same lead record, same upsert key
// (trafleadLeadId). This is "the same implementation Traflead's Shipment
// page uses" in the way that actually matters: the same underlying
// field on the same document, not a duplicated/guessed API call.
//
// The literal shipment.status vocabulary (confirmed from Traflead's own
// client/src/utils/constants.js SHIPMENT_STATUSES/SHIPMENT_STATUS_LABELS
// — the Lead schema itself leaves shipment.status as a free-form String,
// so THIS is the real source of truth for the values that appear there):
//   delivered, pending_pickup, picked_up, in_transit, out_for_delivery,
//   delivery_failed, delayed, damaged, exception, cancelled,
//   rto_initiated, rto_in_transit, rto_out_for_delivery, rto_failed,
//   rto_delivered, rto_shortage, reverse_pending, reverse_out_for_pickup,
//   reverse_picked_up, reverse_in_transit, reverse_out_for_delivery,
//   reverse_delivered, reverse_cancelled, reverse_closed, lost, shortage,
//   unknown, "" (no shipment created yet).
// "delivered" (exact, lowercase) is Traflead's own literal value for a
// successfully delivered forward shipment — this is the ONLY status that
// generates recognized Abandoned Cart revenue (see isDeliveredLead()).
// rto_delivered/reverse_delivered mean the package came BACK to the
// warehouse, not that the customer received it — never counted as
// revenue.
//
// Revenue is attributed to shipment.deliveredAt's IST calendar day
// (deliveredDateIst, derived in normalizeLead above), never orderDateIst
// — a lead ordered on day X but delivered on day Y contributes a LEAD to
// X and RECOGNIZED REVENUE to Y. Both dates are stored side by side on
// the same document and neither is ever overwritten by the other.
//
// A shipment's status keeps changing for days/weeks after the lead's own
// orderDateIst has passed, and (per Traflead's own re-sync design, see
// getShipmentSyncStatus/syncRecentShipments in shipmentController.js)
// picking up those changes requires re-fetching. Since /api/leads-by-
// offer is date-range (not per-lead) and this sync already fetches by
// orderDateIst, the correct, non-guessed way to refresh an OLDER lead's
// shipment status is to re-run that same day's sync with force:true —
// see findPendingShipmentOrderDays() + trafleadSyncCron.js, which do
// exactly that for any day that still has a non-terminal shipment.
//
// ─── Phase 35 — Abandoned Cart Revenue From Phone-Based Shipment Matching ───
//
// Completely replaces HOW delivery status/revenue are determined, while
// leaving Abandoned Cart lead/order fetching untouched (getStoredTrafleadLeads,
// fetchAbandonedCartLeadsForDay, normalizeLead — none of these changed):
//
//   1. The selected date range applies ONLY to which Abandoned Cart
//      orders are in scope (unchanged orderDateIst query).
//   2. For each of those orders, search Traflead's shipment data by
//      PHONE NUMBER — not scoped to any date — to find out whether it
//      was actually delivered, currently.
//   3. Revenue is recognized against the SELECTED date range (the
//      order's own orderDateIst), never against a delivery date.
//
// Verified by reading Traflead's real Shipment/Active Shipment page
// (src/controllers/shipmentController.js's getShipments — the exact
// query GET /api/shipments/ runs): it queries the same `Lead` collection
// this sync already reads, filtered to `shipment.awbNumber` existing —
// i.e. "Active Shipment" is just "every Lead across the whole system,
// any offer, that has been shipped". Crucially, EVERY route in
// src/routes/shipments.js is behind `verifyToken, requireAdmin` — there
// is no unauthenticated way to list it in bulk, and Meta has no Traflead
// admin credentials configured (confirmed: server/.env has no
// TRAFLEAD_EMAIL/PASSWORD/TOKEN, only TRAFLEAD_API_BASE_URL). Per the
// user's own explicit choice when asked, this implementation stays
// credential-free: it reuses the SAME unauthenticated /api/leads-by-
// offer endpoint Phase 33/34 already call, searching it BY PHONE instead
// of by date (that endpoint's `search` param regex-matches orderId,
// fullName, phone, email, productName, city, webmaster — see Traflead's
// src/app.js — and is NOT restricted to any one offer, so it reaches
// shipments that live on a DIFFERENT Lead document than the original
// Abandoned Cart lead, e.g. one created by Traflead's own RTO re-lead
// flow for the same customer).
//
// Because this is a live per-phone lookup rather than one bulk fetch,
// it deliberately does NOT run on every dashboard page load (a page load
// must never trigger a burst of live outbound calls — same principle as
// the rest of this file). Instead runShipmentPhoneMatchBatch() runs on
// the existing 15-minute cron tick, working through a bounded batch of
// not-yet-resolved orders (oldest-checked-first) each time — see
// trafleadSyncCron.js. The API/dashboard only ever reads the LOCALLY
// cached result of that background resolution
// (matchedShipmentStatus/matchedShipmentFound/etc. on this same Mongo
// document) — never a live Traflead call from a GET /api/abandoned-carts
// request.
// ═════════════════════════════════════════════════════════════

const TRAFLEAD_API_BASE_URL = (process.env.TRAFLEAD_API_BASE_URL || "https://vedrahacrm.traffakpay.com").replace(/\/+$/, "");

// Case-insensitive target — exact match preferred, "contains" as a
// fallback (e.g. if Traflead's real offer is named "Abandoned Cart -
// COD" or similar). Overridable because only the user can confirm the
// exact spelling live in their Traflead instance.
const TARGET_OFFER_NAME = (process.env.TRAFLEAD_ABANDONED_CART_OFFER_NAME || "Nabhi Products Abandon Cart").trim();

function assertConfigured() {
  if (!TRAFLEAD_API_BASE_URL) {
    throw new Error(
      "TRAFLEAD_API_BASE_URL is not set — the Traflead sync cannot run without it. Set it in server/.env."
    );
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Returns ["2026-07-01", "2026-07-02", ...] inclusive, one entry per day.
function enumerateDays(since, until) {
  const days = [];
  let cursor = new Date(`${since}T00:00:00.000Z`);
  const end = new Date(`${until}T00:00:00.000Z`);
  while (cursor <= end) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

function matchesTargetOffer(offerName) {
  const a = String(offerName || "").trim().toLowerCase();
  const b = TARGET_OFFER_NAME.toLowerCase();
  if (!a) return false;
  return a === b || a.includes(b);
}

// ─── Traflead API call ──────────────────────────────────────
//
// Never sends offer/offerId (see header comment — that param 500s on
// Traflead's side). startDate/endDate are always full UTC ISO instants
// computed from an IST calendar day, never a bare date string — and, per
// Phase 35, are simply OMITTED (not sent at all) for a phone-based
// shipment lookup, since Traflead's endpoint treats a missing
// startDate/endDate as "no date filter" (confirmed by reading
// src/app.js — see discoverTrafleadOfferNames below, which already
// relied on this). `search` is optional and passed straight through to
// Traflead's own regex search (orderId/fullName/phone/email/productName/
// city/webmaster).
async function fetchLeadsByOfferPage({ startIso, endIso, page, limit = 500, search, sortBy = "-createdAt" }) {
  assertConfigured();
  const url = `${TRAFLEAD_API_BASE_URL}/api/leads-by-offer`;
  const params = { page, limit, sortBy };
  if (startIso) params.startDate = startIso;
  if (endIso) params.endDate = endIso;
  if (search) params.search = search;
  const { data } = await axios.get(url, { params, timeout: 30000 });
  if (!data || data.success !== true) {
    throw new Error(`Traflead /api/leads-by-offer returned an unsuccessful response: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return data;
}

// Fetches EVERY page of the "Abandoned Cart" offer's leads for one IST
// calendar day, paginating until that group's own hasNext is false.
// Returns { leads, offerName, offerId } — leads is [] (not an error) if
// the offer legitimately had zero leads that day; throws if the
// "Abandoned Cart" offer never appears in the response at all (a real
// config/connectivity problem, never silently treated as zero).
async function fetchAbandonedCartLeadsForDay(day) {
  const startIso = istDayStartUtc(day).toISOString();
  const endIso = istDayEndUtc(day).toISOString();

  let page = 1;
  const limit = 500;
  let leads = [];
  let matchedOfferName = null;
  let matchedOfferId = null;
  let sawAnyOffers = false;
  let sawMatchOnFirstPage = false;
  const maxPages = 200; // safety cap — 500/page × 200 = 100,000 leads/day ceiling

  while (page <= maxPages) {
    const data = await fetchLeadsByOfferPage({ startIso, endIso, page, limit });
    const offers = data?.data?.offers || [];
    if (offers.length > 0) sawAnyOffers = true;

    const group = offers.find((g) => matchesTargetOffer(g.offerName));
    if (!group) {
      // No "Abandoned Cart" group on this page. Offer groups are stable
      // across pages of the same query (same underlying date filter), so
      // if it's missing on page 1, it's missing for this day, period.
      break;
    }

    if (page === 1) sawMatchOnFirstPage = true;
    matchedOfferName = group.offerName;
    matchedOfferId = String(group.offerId || "");
    leads = leads.concat(group.leads || []);

    if (!group.pagination?.hasNext) break;
    page += 1;
  }

  return {
    leads,
    offerName: matchedOfferName,
    offerId: matchedOfferId,
    sawAnyOffers,
    sawMatchOnFirstPage,
  };
}

// One-time-ish discovery call (no date filter — Traflead's endpoint
// treats missing startDate/endDate as "no date filter", returning every
// offer that has ANY lead ever) so a misconfigured TARGET_OFFER_NAME
// fails loudly with the real list of offer names instead of just
// silently showing zero leads for every day. Not on the hot path of a
// per-day sync — call it when a day comes back with zero matched leads
// so the resulting error/log is actually diagnostic.
export async function discoverTrafleadOfferNames() {
  assertConfigured();
  const data = await fetchLeadsByOfferPage({ page: 1, limit: 1 });
  const offers = data?.data?.offers || [];
  return offers.map((o) => ({ offerId: o.offerId, offerName: o.offerName }));
}

// ─── Phase 35 — phone-based shipment lookup ──────────────────────────
//
// Normalizes any raw phone string down to its last 10 digits — the
// stable, comparable part of an Indian mobile number regardless of how
// the prefix was written. Handles every variant the spec calls out:
//   "+91 9876543210" → digits "919876543210" (12) → last 10 "9876543210"
//   "919876543210"   → digits "919876543210" (12) → last 10 "9876543210"
//   "09876543210"    → digits "09876543210"  (11) → last 10 "9876543210"
//   "9876543210"     → digits "9876543210"   (10) → last 10 "9876543210"
// All four collapse to the same value. Returns "" for anything that
// doesn't reduce to a full 10-digit number — deliberately NOT padded or
// guessed, so a partial/garbage phone never gets treated as a valid
// match key (see pickBestShipmentMatch's "Do not match unrelated
// numbers" requirement).
export function normalizeIndianPhone(raw) {
  if (!raw) return "";
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length < 10) return "";
  return digits.slice(-10);
}

// Searches Traflead's ONLY unauthenticated endpoint by phone number, with
// NO date filter (startDate/endDate omitted entirely — see
// fetchLeadsByOfferPage) and NO offer restriction, so it reaches every
// Lead across Traflead's whole system that shares this phone, including
// one created on a different Lead document than the Abandoned Cart lead
// itself (e.g. via Traflead's own RTO re-lead flow). Returns every
// distinct Lead (deduped by _id) across every offer group and page,
// bounded to a small page cap per group — a single phone number
// realistically never has hundreds of matching leads, so this cap exists
// only to bound worst-case latency of a single lookup, not because it's
// expected to be hit.
async function searchTrafleadLeadsByPhone(phoneDigits) {
  const maxPagesPerGroup = 5;
  const limit = 200;
  const seen = new Map(); // trafleadLeadId -> raw lead

  let page = 1;
  while (page <= maxPagesPerGroup) {
    const data = await fetchLeadsByOfferPage({ page, limit, search: phoneDigits, sortBy: "-updatedAt" });
    const offers = data?.data?.offers || [];
    if (offers.length === 0) break;

    let anyHasNext = false;
    for (const group of offers) {
      for (const raw of group.leads || []) {
        const id = String(raw._id || "");
        if (id && !seen.has(id)) seen.set(id, raw);
      }
      if (group.pagination?.hasNext) anyHasNext = true;
    }

    if (!anyHasNext) break;
    page += 1;
  }

  return [...seen.values()];
}

// Of the candidates returned by a phone search, picks the ONE shipment
// this Abandoned Cart order should be judged against:
//   1. Only candidates that (a) actually normalize to the SAME phone
//      (guards against Traflead's search matching a different field —
//      e.g. a numeric orderId that happens to contain the same digits —
//      "do not match unrelated numbers") and (b) have a real shipment
//      (`shipment.awbNumber` set — an "Active Shipment", not just any
//      Lead) are eligible at all.
//   2. Among those, an EXACT Order ID / External Order ID match against
//      this Abandoned Cart order wins outright — the spec's own
//      "Prefer Order ID / external ID when available" rule.
//   3. Otherwise (phone-only, no Order ID to disambiguate with — this is
//      the "primary matching key" case), the most recently updated
//      shipped lead is used, on the theory that it's the most likely to
//      reflect this customer's CURRENT order. This is a heuristic, not a
//      certainty — matchedCandidateCount is always recorded so an
//      ambiguous case (>1 eligible candidate) stays visible in the
//      drill-down rather than silently resolved.
// Returns null if no eligible (phone-matched + shipped) candidate exists.
function pickBestShipmentMatch(candidates, targetPhoneDigits, targetOrderId, targetExternalOrderId) {
  const eligible = candidates.filter((raw) => {
    const shipment = raw.shipment || {};
    if (!shipment.awbNumber) return false;
    return normalizeIndianPhone(raw.phone) === targetPhoneDigits;
  });

  if (eligible.length === 0) return null;

  const wantedOrderIds = [targetOrderId, targetExternalOrderId]
    .map((v) => String(v || "").trim().toLowerCase())
    .filter(Boolean);

  let chosen = null;
  let method = "phone";

  if (wantedOrderIds.length > 0) {
    chosen = eligible.find((raw) => {
      const candidateIds = [raw.orderId, raw.externalOrderId].map((v) => String(v || "").trim().toLowerCase());
      return candidateIds.some((id) => id && wantedOrderIds.includes(id));
    });
    if (chosen) method = "order_id";
  }

  if (!chosen) {
    chosen = [...eligible].sort((a, b) => {
      const at = new Date(a.updatedAt || a.shipment?.createdAt || a.createdAt || 0).getTime();
      const bt = new Date(b.updatedAt || b.shipment?.createdAt || b.createdAt || 0).getTime();
      return bt - at;
    })[0];
  }

  const shipment = chosen.shipment || {};
  return {
    method,
    candidateCount: eligible.length,
    trafleadLeadId: String(chosen._id || ""),
    orderId: chosen.orderId || "",
    status: shipment.status || "",
    awbNumber: shipment.awbNumber || "",
    courierName: shipment.courierName || "",
    deliveredAt: shipment.deliveredAt ? new Date(shipment.deliveredAt) : null,
  };
}

// Resolves (and persists) the phone-based shipment match for ONE
// Abandoned Cart lead. Never touches this document's own order fields —
// only the matched* / shipmentLookupCheckedAt / shipmentLookupError
// fields Phase 35 added.
export async function resolveShipmentMatchForLead(doc) {
  const phoneDigits = normalizeIndianPhone(doc.phone);
  const now = new Date();

  if (!phoneDigits) {
    doc.matchMethod = "invalid_phone";
    doc.matchedShipmentFound = false;
    doc.matchedShipmentStatus = "";
    doc.matchedCandidateCount = 0;
    doc.shipmentLookupCheckedAt = now;
    doc.shipmentLookupError = "";
    await doc.save();
    return doc;
  }

  try {
    const candidates = await searchTrafleadLeadsByPhone(phoneDigits);
    const match = pickBestShipmentMatch(candidates, phoneDigits, doc.orderId, doc.externalOrderId);

    if (!match) {
      doc.matchMethod = "not_found";
      doc.matchedShipmentFound = false;
      doc.matchedShipmentStatus = "";
      doc.matchedOrderId = "";
      doc.matchedAwbNumber = "";
      doc.matchedCourierName = "";
      doc.matchedDeliveredAt = null;
      doc.matchedCandidateCount = 0;
    } else {
      doc.matchMethod = match.method;
      doc.matchedShipmentFound = true;
      doc.matchedShipmentStatus = match.status;
      doc.matchedOrderId = match.orderId;
      doc.matchedAwbNumber = match.awbNumber;
      doc.matchedCourierName = match.courierName;
      doc.matchedDeliveredAt = match.deliveredAt;
      doc.matchedCandidateCount = match.candidateCount;
    }
    doc.shipmentLookupError = "";
  } catch (err) {
    // Leave any previously-resolved match fields untouched on a
    // transient failure (network blip, Traflead 5xx) — only record the
    // error and the attempt time, so the next batch retries it instead
    // of a failed call silently reading as "not found".
    doc.shipmentLookupError = err.message || String(err);
  }

  doc.shipmentLookupCheckedAt = now;
  await doc.save();
  return doc;
}

// Phase 36 §1 — single-flight guard shared by EVERY phone-match batch
// below (the cron's global sweep AND the per-range resync a page view
// triggers) so overlapping callers never fire concurrent Traflead lookups
// for the same leads — a second caller just sees "already running" and
// skips this tick; the next one tries again. Mirrors backfillState's own
// single-flight convention above, just for this independent job.
let phoneMatchBatchRunning = false;

export function isPhoneMatchBatchRunning() {
  return phoneMatchBatchRunning;
}

async function resolvePhoneMatchDocs(docs, delayMs) {
  let matched = 0;
  let delivered = 0;
  let errors = 0;

  for (const doc of docs) {
    try {
      await resolveShipmentMatchForLead(doc);
      if (doc.matchedShipmentFound) matched += 1;
      if (String(doc.matchedShipmentStatus).toLowerCase() === "delivered") delivered += 1;
      if (doc.shipmentLookupError) errors += 1;
    } catch (err) {
      errors += 1;
      console.error(`✖ Phase 35 shipment phone-match failed for lead ${doc.trafleadLeadId}:`, err.message);
    }
    if (delayMs > 0) await sleep(delayMs);
  }

  return { checked: docs.length, matched, delivered, errors };
}

// Periodic background resolver — NOT called from any request handler.
// Picks up to `batchSize` Abandoned Cart leads that aren't yet resolved
// to "delivered" (delivered is terminal, same convention as
// TERMINAL_SHIPMENT_STATUSES below — once a phone match reads delivered
// it's never re-checked again), oldest-checked-first (nulls — never
// checked — first), and resolves each one with a small delay between
// Traflead calls so a batch doesn't hammer Traflead's public endpoint.
// Called from trafleadSyncCron.js's existing 15-minute tick.
//
// This query is GLOBAL — every not-yet-delivered Abandoned Cart lead ever
// synced, regardless of order date — so on its own it can leave the leads
// in whatever date range someone is actually looking at waiting behind an
// arbitrarily large backlog of older, less relevant ones. See
// resolveShipmentMatchesForRange() below, which Phase 36 §1 added
// specifically to keep the range someone is viewing right now verified
// promptly, without abandoning this global sweep (still needed so every
// OTHER date range keeps making progress too).
export async function runShipmentPhoneMatchBatch({ batchSize = 25, delayMs = 200 } = {}) {
  if (phoneMatchBatchRunning) return { checked: 0, matched: 0, delivered: 0, errors: 0, skipped: true };
  phoneMatchBatchRunning = true;
  try {
    const candidates = await TrafleadAbandonedCartLead.find({ matchedShipmentStatus: { $ne: "delivered" } })
      .sort({ shipmentLookupCheckedAt: 1 })
      .limit(batchSize);
    return await resolvePhoneMatchDocs(candidates, delayMs);
  } finally {
    phoneMatchBatchRunning = false;
  }
}

// Phase 36 §1 — "verify that the Shipment details shown for each order are
// actually matching Traflead." Triggered non-blockingly from GET
// /api/abandoned-carts (same "fire and forget, never block the response"
// pattern the existing order-backfill catch-up already uses below) so the
// orders in the date range someone is actually viewing get their phone
// match resolved/refreshed promptly, instead of only whenever the global
// batch above happens to reach them. Bounded + throttled exactly like that
// batch; skips instantly (rather than queuing) if a phone-match batch —
// this or the cron's — is already in flight, so rapid page views/polls of
// the same or overlapping ranges never pile up concurrent Traflead calls
// for the same leads. Still entirely credential-free and still never runs
// synchronously inside a request — the caller does not await this
// resolving before responding.
export async function resolveShipmentMatchesForRange(since, until, { batchSize = 40, delayMs = 150 } = {}) {
  if (phoneMatchBatchRunning) return { checked: 0, matched: 0, delivered: 0, errors: 0, skipped: true };
  phoneMatchBatchRunning = true;
  try {
    const candidates = await TrafleadAbandonedCartLead.find({
      orderDateIst: { $gte: since, $lte: until },
      matchedShipmentStatus: { $ne: "delivered" },
    })
      .sort({ shipmentLookupCheckedAt: 1 })
      .limit(batchSize);
    return await resolvePhoneMatchDocs(candidates, delayMs);
  } finally {
    phoneMatchBatchRunning = false;
  }
}

// ─── Normalization — 1:1 field mirror, no renaming/transforming ────
function normalizeLead(raw, offerMeta) {
  const shipment = raw.shipment || {};
  const trafleadCreatedAt = raw.createdAt ? new Date(raw.createdAt) : null;
  const orderDate = raw.orderDate ? new Date(raw.orderDate) : trafleadCreatedAt;

  return {
    trafleadLeadId: String(raw._id),

    orderId: raw.orderId || "",
    externalOrderId: raw.externalOrderId || "",
    subOrderId: raw.subOrderId || "",

    offerId: offerMeta.offerId || (raw.offer ? String(raw.offer) : ""),
    offerName: offerMeta.offerName || "",

    // Literal, un-renamed Traflead values.
    status: raw.status || "",
    previousStatus: raw.previousStatus || "",
    lastStatusChange: raw.lastStatusChange ? new Date(raw.lastStatusChange) : null,

    shipmentStatus: shipment.status || "",
    shipmentDeliveredAt: shipment.deliveredAt ? new Date(shipment.deliveredAt) : null,
    // Phase 34 — IST calendar-day string derived from shipment.deliveredAt,
    // same convention as orderDateIst. This is the field every delivered-
    // date-based revenue query below filters on. null until a shipment
    // actually reaches Traflead's literal "delivered" status.
    deliveredDateIst: shipment.deliveredAt ? toIstDateString(new Date(shipment.deliveredAt)) : null,
    shipmentAwbNumber: shipment.awbNumber || "",
    shipmentCourierName: shipment.courierName || "",

    fullName: raw.fullName || "",
    phone: raw.phone || "",
    alternatePhone: raw.alternatePhone || "",
    email: raw.email || "",

    productName: raw.productName || "",
    quantity: Number(raw.quantity) || 0,
    price: Number(raw.price) || 0,
    total: Number(raw.total) || 0,
    currency: raw.currency || "",
    paymentMode: raw.paymentMode || "",

    address: raw.address || "",
    address2: raw.address2 || "",
    city: raw.city || "",
    state: raw.state || "",
    district: raw.district || "",
    pinCode: raw.pinCode || "",
    country: raw.country || "",
    landmark: raw.landmark || "",
    nearBy: raw.nearBy || "",
    area: raw.area || "",
    postOffice: raw.postOffice || "",

    orderDate,
    orderDateIst: trafleadCreatedAt ? toIstDateString(trafleadCreatedAt) : orderDate ? toIstDateString(orderDate) : null,
    trafleadCreatedAt,
    trafleadUpdatedAt: raw.updatedAt ? new Date(raw.updatedAt) : null,

    orderSource: raw.orderSource || "",
    webmaster: raw.webmaster || "",
    externalWebmasterId: raw.externalWebmasterId || "",
    affiliateId: raw.affiliateId || "",
    leadSource: raw.leadSource || "",
    campaign: raw.campaign || "",
    medium: raw.medium || "",
    sub1: raw.sub1 || "",
    sub2: raw.sub2 || "",
    sub3: raw.sub3 || "",
    sub4: raw.sub4 || "",
    sub5: raw.sub5 || "",
    additionalFields: raw.additionalFields || {},

    isUrgent: !!raw.isUrgent,
    isTestOrder: !!raw.isTestOrder,

    rawTraflead: raw,
  };
}

// ─── WRITE PATH — talks to Traflead, upserts into Mongo ─────────────

async function syncDayWithRetry(day, { maxRetries = 3, baseDelayMs = 2000 } = {}) {
  let attempt = 0;

  while (true) {
    try {
      const { leads, offerName, sawAnyOffers, sawMatchOnFirstPage } = await fetchAbandonedCartLeadsForDay(day);

      if (leads.length === 0 && !sawMatchOnFirstPage) {
        // Distinguish "genuinely zero Abandoned Cart leads that day"
        // from "the offer name is misconfigured" — only the latter
        // should fail loudly.
        const knownOffers = await discoverTrafleadOfferNames().catch(() => null);
        const anyEverMatches = knownOffers?.some((o) => matchesTargetOffer(o.offerName));
        if (knownOffers && !anyEverMatches) {
          throw new Error(
            `No offer matching "${TARGET_OFFER_NAME}" exists in Traflead at all. Offers found: ${knownOffers
              .map((o) => o.offerName)
              .join(", ") || "(none)"}. Set TRAFLEAD_ABANDONED_CART_OFFER_NAME to the exact name.`
          );
        }
        // Offer exists system-wide, just had no leads on this specific
        // day (or sawAnyOffers was false because the day had zero leads
        // for every offer) — a legitimate zero, not an error.
      }

      if (leads.length > 0) {
        const ops = leads
          .map((raw) => {
            const fields = normalizeLead(raw, { offerName, offerId: raw.offer ? String(raw.offer) : "" });
            if (!fields.trafleadLeadId) return null;
            return {
              updateOne: {
                filter: { trafleadLeadId: fields.trafleadLeadId },
                update: { $set: fields },
                upsert: true,
              },
            };
          })
          .filter(Boolean);

        if (ops.length > 0) await TrafleadAbandonedCartLead.bulkWrite(ops, { ordered: false });
      }

      await TrafleadSyncLog.findOneAndUpdate(
        { date: day },
        { status: "complete", leadCount: leads.length, offerMatched: offerName || "", error: "", lastAttemptAt: new Date() },
        { upsert: true }
      );

      return leads.length;
    } catch (err) {
      const message = err?.response?.data?.message || err.message;

      if (attempt < maxRetries) {
        const backoffMs = baseDelayMs * 2 ** attempt;
        console.warn(
          `⚠ Traflead sync failed for ${day} (attempt ${attempt + 1}/${maxRetries}): ${message}. Retrying in ${backoffMs}ms`
        );
        await sleep(backoffMs);
        attempt += 1;
        continue;
      }

      console.error(`✖ Giving up on Traflead sync for ${day} after ${maxRetries} retries: ${message}`);
      await TrafleadSyncLog.findOneAndUpdate(
        { date: day },
        { status: "failed", error: message, lastAttemptAt: new Date() },
        { upsert: true }
      );
      return 0;
    }
  }
}

let backfillState = {
  running: false,
  since: null,
  until: null,
  currentDay: null,
  daysTotal: 0,
  daysDone: 0,
  startedAt: null,
  cancelRequested: false,
  lastError: null,
};

export function getBackfillState() {
  return { ...backfillState };
}

export function requestBackfillCancel() {
  if (backfillState.running) backfillState.cancelRequested = true;
}

/**
 * Populates Mongo from Traflead for a date range, one IST day at a time.
 * Write-only — call it, then read via getStoredTrafleadLeads().
 *
 * Same "safe to call repeatedly" semantics as backfillShiprocketRange:
 * days already marked "complete" are skipped (except today, which is
 * always re-synced since Traflead statuses keep changing), "failed"
 * days are retried. Pass force:true to re-sync every day regardless.
 */
export async function backfillTrafleadRange(since, until, { force = false } = {}) {
  if (backfillState.running) {
    throw new Error("A Traflead sync is already running");
  }

  const days = enumerateDays(since, until);
  const today = todayIstIso();

  backfillState = {
    running: true,
    since,
    until,
    currentDay: null,
    daysTotal: days.length,
    daysDone: 0,
    startedAt: new Date(),
    cancelRequested: false,
    lastError: null,
  };

  try {
    let alreadySynced = new Set();
    if (!force) {
      const existingLogs = await TrafleadSyncLog.find({ date: { $in: days }, status: "complete" }).lean();
      alreadySynced = new Set(existingLogs.map((l) => l.date).filter((d) => d !== today));
    }

    for (const day of days) {
      if (backfillState.cancelRequested) {
        console.log(`⏸ Traflead sync cancelled at ${day} (${since} → ${until})`);
        break;
      }
      backfillState.currentDay = day;

      if (alreadySynced.has(day)) {
        backfillState.daysDone += 1;
        continue;
      }

      try {
        await syncDayWithRetry(day);
      } catch (err) {
        backfillState.lastError = `${day}: ${err.message}`;
        console.error(`✖ Unexpected error syncing ${day} from Traflead:`, err);
      }
      backfillState.daysDone += 1;
    }
  } finally {
    backfillState.running = false;
    backfillState.currentDay = null;
  }
}

/**
 * Checklist view: one entry per day in range, sourced from
 * TrafleadSyncLog only (no Traflead API calls).
 */
export async function getTrafleadSyncStatus(since, until) {
  const days = enumerateDays(since, until);
  const today = todayIstIso();

  const logs = await TrafleadSyncLog.find({ date: { $in: days } }).lean();
  const logByDate = new Map(logs.map((l) => [l.date, l]));

  const checklist = days.map((day) => {
    const log = logByDate.get(day);
    if (!log) return { date: day, status: day === today ? "live" : "pending" };
    return {
      date: day,
      status: day === today ? "live" : log.status,
      leadCount: log.leadCount,
      offerMatched: log.offerMatched,
      error: log.error,
      lastAttemptAt: log.lastAttemptAt,
    };
  });

  const summary = {
    total: checklist.length,
    complete: checklist.filter((d) => d.status === "complete").length,
    failed: checklist.filter((d) => d.status === "failed").length,
    pending: checklist.filter((d) => d.status === "pending").length,
    live: checklist.filter((d) => d.status === "live").length,
  };

  return { checklist, summary, backfill: getBackfillState() };
}

// ─── Phase 34 — shipment-status taxonomy ─────────────────────────────
//
// Traflead's real shipment.status literals (confirmed from Traflead's
// own client/src/utils/constants.js — see header comment). Two things
// derived from this list:
//   1. TERMINAL_SHIPMENT_STATUSES — a shipment in one of these states
//      will never change again, so a day whose leads are ALL terminal
//      never needs re-fetching. Everything else (including "" — no
//      shipment created yet) is "still in motion" and gets re-checked.
//   2. bucketShipmentStatus() — collapses the ~25 literal values into
//      the 5 buckets the Dashboard/Daily UI shows (Delivered/Pending/
//      Cancelled/Returned/Other). This bucketing is DISPLAY-ONLY — it
//      never affects revenue, which checks the literal "delivered"
//      status directly (see isDeliveredLead()).
export const TERMINAL_SHIPMENT_STATUSES = new Set([
  "delivered",
  "cancelled",
  "rto_delivered",
  "reverse_delivered",
  "reverse_cancelled",
  "reverse_closed",
]);

export function isTerminalShipmentStatus(status) {
  return TERMINAL_SHIPMENT_STATUSES.has(String(status || "").toLowerCase());
}

const SHIPMENT_STATUS_BUCKET_MAP = {
  delivered: "delivered",

  cancelled: "cancelled",
  reverse_cancelled: "cancelled",

  rto_initiated: "returned",
  rto_in_transit: "returned",
  rto_out_for_delivery: "returned",
  rto_failed: "returned",
  rto_delivered: "returned",
  rto_shortage: "returned",
  reverse_delivered: "returned",
  reverse_closed: "returned",

  pending_pickup: "pending",
  picked_up: "pending",
  in_transit: "pending",
  out_for_delivery: "pending",
  delivery_failed: "pending",
  delayed: "pending",
  reverse_pending: "pending",
  reverse_out_for_pickup: "pending",
  reverse_picked_up: "pending",
  reverse_in_transit: "pending",
  reverse_out_for_delivery: "pending",
  "": "pending", // no shipment created yet — order hasn't been resolved either way
};

// bucketShipmentStatus: anything not in the map above (damaged,
// exception, lost, shortage, unknown, or any future literal Traflead
// adds that this app doesn't know about yet) falls into "other" rather
// than being silently mis-bucketed as pending/delivered.
export function bucketShipmentStatus(status) {
  const s = String(status || "").toLowerCase();
  return SHIPMENT_STATUS_BUCKET_MAP[s] || "other";
}

// The ONLY revenue rule (Phase 34) — no lead-status requirement, no
// settings-configurable list, no delivery-rate assumption. Literal
// Traflead shipment.status === "delivered", full stop.
export function isDeliveredLead(lead) {
  return String(lead?.shipmentStatus || "").toLowerCase() === "delivered";
}

// ─── READ PATH — pure Mongo, never calls Traflead ────────────────────

/**
 * since/until are IST calendar-day strings ("YYYY-MM-DD"), inclusive —
 * same convention as every other range read in this app. Filters on
 * orderDateIst — this is the "Abandoned Cart leads placed in this
 * period" cohort. UNCHANGED from Phase 33 (explicitly not touched —
 * lead fetching was already correct).
 */
export async function getStoredTrafleadLeads(since, until, filters = {}) {
  const query = { orderDateIst: { $gte: since, $lte: until } };
  if (filters.search) {
    const re = new RegExp(String(filters.search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    query.$or = [
      { orderId: re },
      { externalOrderId: re },
      { fullName: re },
      { phone: re },
      { email: re },
      { campaign: re },
      { webmaster: re },
      { status: re },
    ];
  }
  return TrafleadAbandonedCartLead.find(query).sort({ trafleadCreatedAt: -1 }).lean();
}

// ─── Phase 35 — selected-date revenue from phone-matched shipment status ──
//
// isDeliveredMatch: the ONLY revenue predicate as of Phase 35. Checks the
// PHONE-matched status (matchedShipmentStatus), never the embedded
// shipmentStatus field Phase 34 used — see the Phase 35 header comment
// for why those two can legitimately disagree (different Lead
// documents).
export function isDeliveredMatch(lead) {
  return String(lead?.matchedShipmentStatus || "").toLowerCase() === "delivered";
}

// Phase 37 — "CNF" is the spec's own shorthand for "Confirmed Lead."
// There is no literal "CNF" value anywhere in Traflead's data — its
// LEAD_STATUSES enum is processing/approved/cancelled/hold/trash/
// confirmed (see TrafleadAbandonedCartLead.js's header comment) — so a
// CNF lead is exactly a lead whose Traflead `status` is "confirmed".
// Case-insensitive/trimmed purely defensively; Traflead's own value is
// already lowercase "confirmed" (see AbandonedCartsPage.jsx's
// STATUS_STYLES/StatusBadge, which render it exactly as stored).
export function isCnfLead(lead) {
  return String(lead?.status || "").trim().toLowerCase() === "confirmed";
}

/**
 * Phase 35 — the entire Abandoned Cart summary for a date range, built
 * from ONE dataset: the order-date cohort (cohortLeads — leads whose
 * orderDateIst falls in [since, until], fetched exactly as before via
 * getStoredTrafleadLeads — completely unchanged mechanism). There is no
 * second, delivered-date-filtered dataset anymore — Phase 35's whole
 * point is that revenue belongs to the SELECTED date range, not to
 * whenever the matched shipment happened to be delivered.
 *
 * `orders` — every Abandoned Cart order in the selected range.
 * `matched` — of those, how many have a phone-matched shipment at all
 *   (matchedShipmentFound), regardless of its status.
 * `unmatched` — orders - matched (no shipment found for that phone at
 *   all — shown in the drill-down as "Shipment: Not Found").
 * `deliveredCount` — of the MATCHED orders, how many currently read
 *   "delivered". As of Phase 37 this is INFORMATIONAL ONLY (shipment
 *   verification, still fully computed and shown) — it no longer drives
 *   revenue/expenses/profit; see cnfRevenue below for what does.
 * `notDeliveredMatched` — matched - deliveredCount (matched to a real
 *   shipment, but that shipment isn't Delivered yet/anymore).
 * `deliveredRevenue` — sum of `total` for exactly the deliveredCount
 *   orders. Also informational only as of Phase 37.
 *
 * Phase 37 — Abandoned Cart CNF-Based Revenue. Revenue recognition moves
 * OFF shipment-delivery status entirely and onto the lead's own Traflead
 * `status` reaching "confirmed" (CNF), combined with a manual, explicit,
 * settings-configurable percentage — because CNF is available immediately
 * on every lead (no phone-matched-shipment lookup required, no waiting on
 * a courier), at the cost of being an assumption rather than a verified
 * delivery. The spec is explicit that this is a deliberate trade-off:
 * "the CNF percentage is an assumption for revenue calculation only —
 * never change the actual Total Orders or CNF Lead count because of the
 * percentage."
 *
 *   cnfLeads             — cohortLeads filtered to isCnfLead().
 *   cnfLeadsCount         — cnfLeads.length. A raw, real count — NEVER
 *                           scaled by cnfRevenueRate.
 *   cnfRevenueRate        — the configured percent (settings.cnfRevenueRate,
 *                           0–100, default 50).
 *   cnfPotentialRevenue   — sum of `total` across EVERY CNF lead (i.e. what
 *                           revenue would be if the rate were 100%) —
 *                           shown for context, never itself booked as
 *                           revenue.
 *   avgCnfOrderValue      — cnfPotentialRevenue ÷ cnfLeadsCount, the
 *                           existing "average order value" structure the
 *                           spec asks to reuse.
 *   cnfRevenueCountedCount — round(cnfLeadsCount × cnfRevenueRate/100) —
 *                           the "Revenue-Counted CNF" order count (e.g.
 *                           40 × 50% = 20 orders). Rounded to a whole
 *                           number of orders since expenses below are
 *                           charged per whole order.
 *   cnfRevenue            — avgCnfOrderValue × cnfRevenueCountedCount —
 *                           the actual Abandoned Cart revenue booked for
 *                           this range, and what "Confirmed Revenue" now
 *                           means everywhere it's read.
 *
 * Expenses/profit use the same per-order formula Phase 25/33/34/35
 * already used (cost × count), just driven by cnfRevenueCountedCount
 * instead of deliveredCount now — the same orders whose revenue is being
 * counted are the orders whose per-order costs are charged.
 *
 * Back-compat aliases (expectedDelivered/recognizedRevenue/
 * netContribution/deliveryRate/confirmedRevenue) are kept so Dashboard.jsx
 * (and every other consumer — Daily/Analytics/Profitability/Campaign
 * Explorer, all of which only ever read this summary object, never
 * recompute it) automatically picks up the CNF-based numbers with no
 * changes to how they READ the summary — only what these names now MEAN
 * changes (recognizedRevenue/netContribution/confirmedRevenue are now
 * CNF-based, not shipment-delivery-based). expectedDelivered/deliveryRate
 * are left pointed at the old shipment-based deliveredCount — they were
 * never rendered anywhere (dead back-compat plumbing from Phase 33/34)
 * and aren't part of this phase's revenue path.
 */
export function computeAbandonedCartSummary(cohortLeads, settings) {
  const orders = cohortLeads.length;
  const potentialRevenue = cohortLeads.reduce((sum, l) => sum + (Number(l.total) || 0), 0);

  const matchedLeads = cohortLeads.filter((l) => l.matchedShipmentFound);
  const deliveredLeads = cohortLeads.filter((l) => isDeliveredMatch(l));
  // Phase 36 §1 — distinct from "unmatched" (a lookup that ran and found
  // nothing): this order's phone lookup simply hasn't run yet
  // (shipmentLookupCheckedAt is still null), so its shipment status isn't
  // verified against Traflead at all yet. Surfaced so the UI never shows
  // "Not Found" for an order that was actually just never checked.
  const pendingVerification = cohortLeads.filter((l) => !l.shipmentLookupCheckedAt).length;

  const matched = matchedLeads.length;
  const unmatched = orders - matched;
  const deliveredCount = deliveredLeads.length;
  const notDeliveredMatched = matched - deliveredCount;
  const deliveredRevenue = deliveredLeads.reduce((sum, l) => sum + (Number(l.total) || 0), 0);

  // Phase 37 — CNF-based revenue (see header comment above).
  const cnfLeads = cohortLeads.filter(isCnfLead);
  const cnfLeadsCount = cnfLeads.length;
  const cnfRevenueRate = Math.min(100, Math.max(0, Number(settings.cnfRevenueRate ?? 50) || 0));
  const cnfPotentialRevenue = cnfLeads.reduce((sum, l) => sum + (Number(l.total) || 0), 0);
  const avgCnfOrderValue = cnfLeadsCount ? cnfPotentialRevenue / cnfLeadsCount : 0;
  const cnfRevenueCountedCount = Math.round(cnfLeadsCount * (cnfRevenueRate / 100));
  const cnfRevenue = avgCnfOrderValue * cnfRevenueCountedCount;

  const manufacturingCost = Number(settings.manufacturingCost) || 0;
  const packagingCost = Number(settings.packagingCost) || 0;
  const shippingCost = Number(settings.shippingCost) || 0;
  const miscCost = Number(settings.miscCost) || 0;

  // Phase 37 — expenses now charged per CNF revenue-counted order (was
  // per shipment-delivered order) — the same orders whose revenue is
  // being counted are the orders whose per-order costs are charged.
  const manufacturingExpense = cnfRevenueCountedCount * manufacturingCost;
  const packagingExpense = cnfRevenueCountedCount * packagingCost;
  const shippingExpense = cnfRevenueCountedCount * shippingCost;
  const miscExpense = cnfRevenueCountedCount * miscCost;
  const totalExpenses = manufacturingExpense + packagingExpense + shippingExpense + miscExpense;

  const profit = cnfRevenue - totalExpenses;

  const byMatchedStatus = {};
  for (const l of cohortLeads) {
    const s = l.matchedShipmentFound ? l.matchedShipmentStatus || "(no status)" : "(not found)";
    byMatchedStatus[s] = (byMatchedStatus[s] || 0) + 1;
  }

  return {
    orders,
    potentialRevenue,
    matched,
    unmatched,
    pendingVerification,
    // Shipment-verification figures (Phase 34/35/36 §1) — informational
    // only as of Phase 37, no longer part of the revenue/profit formula.
    deliveredCount,
    notDeliveredMatched,
    deliveredRevenue,
    // Phase 37 — CNF-based revenue, now the actual revenue/profit driver.
    cnfLeadsCount,
    cnfRevenueRate,
    cnfPotentialRevenue,
    avgCnfOrderValue,
    cnfRevenueCountedCount,
    cnfRevenue,
    manufacturingExpense,
    packagingExpense,
    shippingExpense,
    miscExpense,
    totalExpenses,
    profit,
    byMatchedStatus,
    // Back-compat aliases (Phase 33/34 field names) — same names, now
    // sourced from the CNF-based figures (recognizedRevenue/
    // netContribution/confirmedRevenue) so every existing consumer that
    // only reads these names picks up Phase 37's revenue model with zero
    // changes on its end. expectedDelivered/deliveryRate stay pointed at
    // the shipment-based deliveredCount — dead, never-rendered plumbing
    // from Phase 33/34, unrelated to this phase's revenue path.
    expectedDelivered: deliveredCount,
    recognizedRevenue: cnfRevenue,
    netContribution: profit,
    deliveryRate: orders ? (deliveredCount / orders) * 100 : 0,
    // Phase 36 §2 — order-count terminology, unchanged by Phase 37 (still
    // literally every order / every shipment-delivered order — Phase 37
    // doesn't touch order counts, only how REVENUE is recognized).
    totalOrders: orders,
    deliveredOrders: deliveredCount,
    nonDeliveredOrders: orders - deliveredCount,
    // Phase 36 §2/§3 named this "Confirmed Revenue"; Phase 37 makes it
    // literally that — revenue confirmed via CNF status, not shipment
    // delivery.
    confirmedRevenue: cnfRevenue,
  };
}

// ─── Phase 34 — auto re-sync of days with unresolved shipments ──────
//
// A day marked "complete" in TrafleadSyncLog is otherwise never re-
// fetched (see backfillTrafleadRange's alreadySynced skip) — fine for
// lead data (which doesn't change), wrong for shipment status (which
// keeps changing for days/weeks after the order date). This finds
// orderDateIst days — excluding today, which the cron already re-syncs
// every tick — that still have at least one lead in a non-terminal
// shipment status, bounded to a lookback window so a permanently-stuck
// shipment from months ago can't force an ever-growing re-sync list.
export async function findPendingShipmentOrderDays({ lookbackDays = 45, maxDays = 8 } = {}) {
  const today = todayIstIso();
  const earliest = toIstDateString(new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000));

  const days = await TrafleadAbandonedCartLead.distinct("orderDateIst", {
    orderDateIst: { $gte: earliest, $lt: today },
    shipmentStatus: { $nin: [...TERMINAL_SHIPMENT_STATUSES] },
  });

  return days.filter(Boolean).sort().slice(0, maxDays);
}

// ─── Phase 35 — Daily tab per-day breakdown ──────────────────────────
//
// One row per IST day in [since, until]: `leads` is the order-date
// cohort count for that day, and `delivered`/`deliveredRevenue` are
// ALSO for that same day's cohort (phone-matched status checked NOW,
// attributed to the day the order was PLACED) — there's only one date
// axis in Phase 35, so unlike Phase 34 these three numbers now always
// come from the exact same subset of leads, just grouped by orderDateIst.
export async function getAbandonedCartDailyBreakdown(since, until) {
  const days = enumerateDays(since, until);
  const cohortLeads = await getStoredTrafleadLeads(since, until);

  const leadsByDay = new Map();
  const deliveredByDay = new Map();
  const revenueByDay = new Map();
  for (const l of cohortLeads) {
    const d = l.orderDateIst;
    if (!d) continue;
    leadsByDay.set(d, (leadsByDay.get(d) || 0) + 1);
    if (isDeliveredMatch(l)) {
      deliveredByDay.set(d, (deliveredByDay.get(d) || 0) + 1);
      revenueByDay.set(d, (revenueByDay.get(d) || 0) + (Number(l.total) || 0));
    }
  }

  return days.map((date) => ({
    date,
    leads: leadsByDay.get(date) || 0,
    delivered: deliveredByDay.get(date) || 0,
    deliveredRevenue: revenueByDay.get(date) || 0,
  }));
}
