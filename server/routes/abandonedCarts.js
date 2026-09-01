import express from "express";
import { getOrCreateAbandonedCartSettings } from "../models/AbandonedCartSettings.js";
import TrafleadAbandonedCartLead from "../models/TrafleadAbandonedCartLead.js";
import { recordActivity } from "../lib/activityLog.js";
import {
  getStoredTrafleadLeads,
  getAbandonedCartLifecycleCohort,
  computeAbandonedCartSummary,
  getAbandonedCartDailyBreakdown,
  backfillTrafleadRange,
  getBackfillState,
  resolveShipmentMatchesForRange,
  isPhoneMatchBatchRunning,
} from "../services/trafleadSyncService.js";

const router = express.Router();

// ─────────────────────────────────────────────────────────────
// Phase 33 — REWORKED to read from TrafleadAbandonedCartLead (the exact
// mirror of Traflead's own "Abandoned Cart" offer leads — see
// services/trafleadSyncService.js) instead of Phase 25's
// AbandonedCartOrder (postback-fed from a separate, unrelated raw
// Shopify-cart-event source — see routes/abandonCartPostback.js's own
// header comment). AbandonedCartOrder / the postback route are left
// completely untouched and keep accepting requests (so whatever else
// posts to them doesn't break); they're just no longer read by anything
// below — Traflead is now the sole source of truth for every Abandoned
// Cart surface in this app.
//
// Phase 34 — revenue source changed from lead-status-based recognition
// to shipment-delivered-date-based recognition.
//
// Phase 35 — changed AGAIN: revenue is now phone-matched-shipment-status
// based, attributed to the SELECTED date range (never a delivery date).
// GET / now reads exactly ONE lead set — the order-date cohort
// (getStoredTrafleadLeads, unchanged fetch) — and computes the summary
// straight from it (computeAbandonedCartSummary(cohortLeads, settings),
// now 2-arg). `deliveredLeads` in the response is that same cohort
// filtered to isDeliveredMatch() (for the Delivered Revenue drill-down
// popup) — no second Mongo query needed since there's only one dataset
// now. GET /daily is for the Daily tab's per-day Leads/Delivered/
// Delivered Revenue table.
//
// GET / never itself calls Traflead's API (a page load must not trigger
// a live outbound call — same principle services/shiprocketService.js
// documents for Shiprocket reads). It fires a non-blocking background
// catch-up sync (skips days already synced, so this is a fast no-op for
// any range that's already up to date) so a brand-new date range
// self-heals within moments without the request itself waiting on it,
// and returns `sync` (the current backfillState) so the UI can show
// "syncing…" and poll again. The explicit "Refresh from Traflead"
// button in the UI calls POST /api/traflead-sync/start with
// force:true for an immediate, guaranteed-fresh re-fetch. The PHONE-
// matched shipment status (Phase 35) is refreshed independently, in the
// background, by trafleadSyncCron.js's runShipmentPhoneMatchBatch — see
// that file and trafleadSyncService.js's Phase 35 header comment for why
// this never happens synchronously inside a request.
//
// Phase 40 — GET / and GET /daily now compute their summary/breakdown
// from getAbandonedCartLifecycleCohort (the UNION of every lead with any
// lifecycle event in range), not getStoredTrafleadLeads (leads CREATED
// in range) — see trafleadSyncService.js's Phase 40 header comment. The
// paginated record LIST this route also returns keeps reading
// getStoredTrafleadLeads unchanged (spec's own §1 — lead fetching/
// listing is untouched, only categorization changes). The
// `deliveredLeads` array this endpoint used to embed for the Delivered
// Revenue popup is gone — every drill-down (Created/CNF/Delivered/
// Cancelled/Returned) now fetches on demand from the new GET /lifecycle
// below, so a page load no longer pays for up to 1,000 leads' worth of
// drill-down data it may never open.
// ─────────────────────────────────────────────────────────────

// Phase 40 — compact, honest "what happened when" string for the
// drill-down's Lifecycle column (spec §17's "Status History"), built
// ONLY from the dated fields actually set on this record, in
// chronological order — never fabricated, never shows a stage that
// hasn't actually happened yet.
function formatLifecycleDate(d) {
  return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
}

function buildLifecycleSummary(doc) {
  const stages = [];
  if (doc.orderDateIst) stages.push({ label: "Created", at: doc.trafleadCreatedAt || doc.orderDate, dateIst: doc.orderDateIst });
  if (doc.confirmedAt) stages.push({ label: "CNF", at: doc.confirmedAt, dateIst: doc.confirmedDateIst });
  if (doc.matchedDeliveredAt) stages.push({ label: "Delivered", at: doc.matchedDeliveredAt, dateIst: doc.matchedDeliveredDateIst });
  if (doc.cancelledAt) stages.push({ label: "Cancelled", at: doc.cancelledAt, dateIst: doc.cancelledDateIst });
  if (doc.returnedAt) stages.push({ label: "Returned", at: doc.returnedAt, dateIst: doc.returnedDateIst });

  stages.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  return stages.map((s) => `${s.label} ${formatLifecycleDate(s.at)}`).join(" → ");
}

function shape(doc) {
  return {
    id: String(doc._id),
    trafleadLeadId: doc.trafleadLeadId,

    orderId: doc.orderId,
    externalOrderId: doc.externalOrderId,
    subOrderId: doc.subOrderId,

    offerId: doc.offerId,
    offerName: doc.offerName,

    status: doc.status,
    previousStatus: doc.previousStatus,
    lastStatusChange: doc.lastStatusChange,

    shipmentStatus: doc.shipmentStatus,
    shipmentDeliveredAt: doc.shipmentDeliveredAt,
    deliveredDateIst: doc.deliveredDateIst,
    shipmentAwbNumber: doc.shipmentAwbNumber,
    shipmentCourierName: doc.shipmentCourierName,

    // Phase 35 — phone-matched shipment (see trafleadSyncService.js's
    // Phase 35 header comment). This, not the embedded shipment* fields
    // above, is what drives revenue/delivered status as of Phase 35.
    matchedShipmentFound: doc.matchedShipmentFound,
    matchedShipmentStatus: doc.matchedShipmentStatus,
    matchedOrderId: doc.matchedOrderId,
    matchedAwbNumber: doc.matchedAwbNumber,
    matchedCourierName: doc.matchedCourierName,
    matchedDeliveredAt: doc.matchedDeliveredAt,
    matchedDeliveredDateIst: doc.matchedDeliveredDateIst,
    matchedShipmentStatusChangedAt: doc.matchedShipmentStatusChangedAt,
    matchMethod: doc.matchMethod,
    matchedCandidateCount: doc.matchedCandidateCount,
    shipmentLookupCheckedAt: doc.shipmentLookupCheckedAt,
    shipmentLookupError: doc.shipmentLookupError,

    // Phase 40 — lifecycle event dates (see TrafleadAbandonedCartLead.js's
    // Phase 40 header comment for how each is sourced/kept sticky).
    confirmedAt: doc.confirmedAt,
    confirmedDateIst: doc.confirmedDateIst,
    cancelledAt: doc.cancelledAt,
    cancelledDateIst: doc.cancelledDateIst,
    returnedAt: doc.returnedAt,
    returnedDateIst: doc.returnedDateIst,
    lifecycleSummary: buildLifecycleSummary(doc),

    fullName: doc.fullName,
    phone: doc.phone,
    alternatePhone: doc.alternatePhone,
    email: doc.email,

    productName: doc.productName,
    quantity: doc.quantity,
    price: doc.price,
    total: doc.total,
    currency: doc.currency,
    paymentMode: doc.paymentMode,

    address: doc.address,
    address2: doc.address2,
    city: doc.city,
    state: doc.state,
    district: doc.district,
    pinCode: doc.pinCode,
    country: doc.country,

    orderDate: doc.orderDate,
    orderDateIst: doc.orderDateIst,
    trafleadCreatedAt: doc.trafleadCreatedAt,
    trafleadUpdatedAt: doc.trafleadUpdatedAt,

    orderSource: doc.orderSource,
    webmaster: doc.webmaster,
    externalWebmasterId: doc.externalWebmasterId,
    affiliateId: doc.affiliateId,
    leadSource: doc.leadSource,
    campaign: doc.campaign,
    medium: doc.medium,
    sub1: doc.sub1,
    sub2: doc.sub2,
    sub3: doc.sub3,
    sub4: doc.sub4,
    sub5: doc.sub5,

    isUrgent: doc.isUrgent,
    isTestOrder: doc.isTestOrder,

    notes: doc.notes || "",

    createdAt: doc.createdAt, // when THIS app last synced this record
    updatedAt: doc.updatedAt,
  };
}

// GET /api/abandoned-carts?since=&until=&search=&page=&pageSize=
router.get("/", async (req, res) => {
  try {
    const { since, until, search } = req.query;
    if (!since || !until) {
      return res.status(400).json({ success: false, message: "since and until are required (YYYY-MM-DD)" });
    }
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize, 10) || 25));

    // Non-blocking catch-up sync — see header comment. No-ops fast if
    // this range is already fully synced.
    if (!getBackfillState().running) {
      backfillTrafleadRange(since, until).catch((err) => {
        console.error(`Background Traflead catch-up sync failed for ${since} → ${until}:`, err.message);
      });
    }

    // Phase 36 §1 — "verify that the Shipment details shown for each order
    // are actually matching Traflead." Non-blocking, same fire-and-forget
    // pattern as the order backfill above — never awaited, never delays
    // this response. Keeps the phone-matched shipment status for THIS
    // range fresh without waiting on the cron's global, un-scoped queue.
    // Skips instantly (no-op) if a phone-match batch is already running.
    if (!isPhoneMatchBatchRunning()) {
      resolveShipmentMatchesForRange(since, until).catch((err) => {
        console.error(`Background shipment phone-match resync failed for ${since} → ${until}:`, err.message);
      });
    }

    // Phase 40 — the paginated record LIST keeps reading
    // getStoredTrafleadLeads (orders CREATED in range, unchanged), while
    // the summary reads the wider lifecycle cohort (orders with ANY
    // event in range) — see this file's Phase 40 header comment.
    const [settings, listCohort, lifecycleCohort] = await Promise.all([
      getOrCreateAbandonedCartSettings(),
      search ? getStoredTrafleadLeads(since, until, { search }) : getStoredTrafleadLeads(since, until),
      getAbandonedCartLifecycleCohort(since, until),
    ]);
    const summary = computeAbandonedCartSummary(lifecycleCohort, settings, since, until);

    const total = listCohort.length;
    const start = (page - 1) * pageSize;
    const docs = listCohort.slice(start, start + pageSize);

    res.json({
      success: true,
      records: docs.map(shape),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      summary,
      sync: getBackfillState(),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/abandoned-carts/lifecycle?since=&until=&event=created|cnf|delivered|cancelled|returned
//
// Phase 40 — powers every Abandoned Cart drill-down popup (summary card,
// Daily table, Dashboard), for all 5 lifecycle events, replacing the old
// pattern of embedding a capped `deliveredLeads` array in every GET /
// response whether or not the popup was ever opened. Computes the exact
// same lifecycle cohort GET / uses for its summary, filters to the one
// event+date-field the caller asked for, and returns the matching leads
// (shaped, capped defensively — the popup itself narrows the date range
// if it needs to see more than this).
const LIFECYCLE_EVENT_DATE_FIELDS = {
  created: "orderDateIst",
  cnf: "confirmedDateIst",
  delivered: "matchedDeliveredDateIst",
  cancelled: "cancelledDateIst",
  returned: "returnedDateIst",
};

router.get("/lifecycle", async (req, res) => {
  try {
    const { since, until, event } = req.query;
    if (!since || !until) {
      return res.status(400).json({ success: false, message: "since and until are required (YYYY-MM-DD)" });
    }
    const dateField = LIFECYCLE_EVENT_DATE_FIELDS[event];
    if (!dateField) {
      return res.status(400).json({
        success: false,
        message: `event must be one of: ${Object.keys(LIFECYCLE_EVENT_DATE_FIELDS).join(", ")}`,
      });
    }

    const [settings, cohort] = await Promise.all([getOrCreateAbandonedCartSettings(), getAbandonedCartLifecycleCohort(since, until)]);
    const matching = cohort.filter((l) => l[dateField] && l[dateField] >= since && l[dateField] <= until);

    const LIFECYCLE_DRILLDOWN_CAP = 1000;
    const truncated = matching.length > LIFECYCLE_DRILLDOWN_CAP;
    const leads = matching.slice(0, LIFECYCLE_DRILLDOWN_CAP).map(shape);

    const revenueContext =
      event === "cnf"
        ? (() => {
            const rate = Math.min(100, Math.max(0, Number(settings.cnfRevenueRate ?? 50) || 0));
            const potentialRevenue = matching.reduce((sum, l) => sum + (Number(l.total) || 0), 0);
            const avgOrderValue = matching.length ? potentialRevenue / matching.length : 0;
            const revenueCountedCount = Math.round(matching.length * (rate / 100));
            return { cnfRevenueRate: rate, cnfRevenueCountedCount: revenueCountedCount, cnfRevenue: avgOrderValue * revenueCountedCount };
          })()
        : {};

    res.json({
      success: true,
      event,
      since,
      until,
      count: matching.length,
      leads,
      truncated,
      ...revenueContext,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/abandoned-carts/daily?since=&until= — per-IST-day breakdown
// for the Daily tab: Created/CNF/Delivered/Cancelled/Returned, each
// bucketed by the day THAT event actually happened (Phase 40 — see
// getAbandonedCartDailyBreakdown's own header comment), plus per-day CNF
// revenue. Same non-blocking catch-up sync as GET / above.
router.get("/daily", async (req, res) => {
  try {
    const { since, until } = req.query;
    if (!since || !until) {
      return res.status(400).json({ success: false, message: "since and until are required (YYYY-MM-DD)" });
    }

    if (!getBackfillState().running) {
      backfillTrafleadRange(since, until).catch((err) => {
        console.error(`Background Traflead catch-up sync failed for ${since} → ${until}:`, err.message);
      });
    }

    // Phase 36 §1 — same non-blocking range-scoped shipment verification
    // as GET / above, so the Daily tab's Delivered/Delivered Revenue
    // columns stay backed by freshly-checked matches too.
    if (!isPhoneMatchBatchRunning()) {
      resolveShipmentMatchesForRange(since, until).catch((err) => {
        console.error(`Background shipment phone-match resync failed for ${since} → ${until}:`, err.message);
      });
    }

    const days = await getAbandonedCartDailyBreakdown(since, until);
    res.json({ success: true, days, sync: getBackfillState() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── Settings — must be declared before "/:id" so "settings" never
// matches as an :id lookup. ──
//
// Phase 34 — recognizedLeadStatuses/requireShipmentDelivered are gone
// from this API (still present but unused on the Mongoose model itself,
// see AbandonedCartSettings.js's header comment) — revenue recognition
// is no longer settings-configurable at all, it's simply
// shipment.status === "delivered". Only the four per-delivered-unit cost
// inputs remain here.
router.get("/settings", async (req, res) => {
  try {
    const settings = await getOrCreateAbandonedCartSettings();
    res.json({
      success: true,
      manufacturingCost: settings.manufacturingCost,
      packagingCost: settings.packagingCost,
      shippingCost: settings.shippingCost,
      miscCost: settings.miscCost,
      // Phase 37
      cnfRevenueRate: settings.cnfRevenueRate,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put("/settings", async (req, res) => {
  try {
    const { manufacturingCost, packagingCost, shippingCost, miscCost, cnfRevenueRate } = req.body || {};

    for (const [label, val] of [
      ["manufacturingCost", manufacturingCost],
      ["packagingCost", packagingCost],
      ["shippingCost", shippingCost],
      ["miscCost", miscCost],
    ]) {
      if (val !== undefined && (isNaN(Number(val)) || Number(val) < 0)) {
        return res.status(400).json({ success: false, message: `${label} must be a non-negative number` });
      }
    }
    // Phase 37 — CNF Revenue Rate is a percentage, 0-100.
    if (cnfRevenueRate !== undefined && (isNaN(Number(cnfRevenueRate)) || Number(cnfRevenueRate) < 0 || Number(cnfRevenueRate) > 100)) {
      return res.status(400).json({ success: false, message: "cnfRevenueRate must be a number between 0 and 100" });
    }

    const settings = await getOrCreateAbandonedCartSettings();
    if (manufacturingCost !== undefined) settings.manufacturingCost = Number(manufacturingCost) || 0;
    if (packagingCost !== undefined) settings.packagingCost = Number(packagingCost) || 0;
    if (shippingCost !== undefined) settings.shippingCost = Number(shippingCost) || 0;
    if (miscCost !== undefined) settings.miscCost = Number(miscCost) || 0;
    if (cnfRevenueRate !== undefined) settings.cnfRevenueRate = Number(cnfRevenueRate);
    await settings.save();

    await recordActivity({
      user: req.user?.email,
      type: "abandoned_cart_settings_updated",
      message: "Abandoned cart expense/CNF revenue rate settings updated",
      entityType: "abandonedCartSettings",
      entityId: String(settings._id),
    });

    res.json({
      success: true,
      manufacturingCost: settings.manufacturingCost,
      packagingCost: settings.packagingCost,
      shippingCost: settings.shippingCost,
      miscCost: settings.miscCost,
      cnfRevenueRate: settings.cnfRevenueRate,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// "View details."
router.get("/:id", async (req, res) => {
  try {
    const doc = await TrafleadAbandonedCartLead.findById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: "Abandoned cart lead not found" });
    res.json({ success: true, record: shape(doc) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Every field here is sourced from Traflead and overwritten on the next
// sync — editing it locally would just be silently reverted, so the
// only thing this app is allowed to write itself is the ops-local
// `notes` field (never sent to/from Traflead).
router.put("/:id", async (req, res) => {
  try {
    const doc = await TrafleadAbandonedCartLead.findById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: "Abandoned cart lead not found" });

    const { notes } = req.body || {};
    if (notes === undefined) {
      return res.status(400).json({
        success: false,
        message: "Only `notes` can be edited here — every other field is synced from Traflead and would be overwritten on the next sync.",
      });
    }
    doc.notes = String(notes).trim();
    await doc.save();

    await recordActivity({
      user: req.user?.email,
      type: "abandoned_cart_note_updated",
      message: `Abandoned cart note updated (${doc.orderDateIst} — ${doc.fullName || doc.phone || doc.orderId})`,
      entityType: "abandonedCart",
      entityId: String(doc._id),
    });

    res.json({ success: true, record: shape(doc) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
