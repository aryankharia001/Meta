import express from "express";
import AbandonedCartOrder from "../models/AbandonedCartOrder.js";
import { getOrCreateAbandonedCartSettings } from "../models/AbandonedCartSettings.js";
import { recordActivity } from "../lib/activityLog.js";
import { toIstDateString } from "../utils/dateIst.js";

const router = express.Router();

// ─────────────────────────────────────────────────────────────
// Phase 25 — replaces Phase 22's manual-daily-total CRUD with routes
// backed by REAL abandoned-cart orders (AbandonedCartOrder, one document
// per order, written by routes/abandonCartPostback.js). Mounted at
// /api/abandoned-carts, behind the same global requireAuth gate as
// every other /api route (see server/index.js) — unlike the postback
// route, nothing here is public.
//
// §4/§10 — every derived figure (Expected Delivered Orders, Gross
// Potential Revenue, Recognized Abandoned Cart Revenue, and the four
// expense lines) is computed HERE, once, in computeSummary() below,
// using the GLOBAL AbandonedCartSettings (delivery rate + per-order
// costs — §5) rather than a per-record rate. Both the Management Table
// (AbandonedCartsPage.jsx) and the Dashboard read the exact same
// numbers — neither recomputes this math itself.
//
// §4 — the response SHAPE of GET / is unchanged from Phase 22
// (`{ success, records, summary }`, and `summary` has the exact same
// keys: orders/expectedDelivered/potentialRevenue/recognizedRevenue/
// totalExpenses/netContribution) so Dashboard.jsx's existing
// fetchAbandonedCarts({ since, until }) call — and every number it
// derives from `res.summary` — keeps working unmodified. `records` now
// additionally supports search/page/pageSize (§3/§6); Dashboard never
// reads `records`, only `summary`, so this is purely additive from its
// point of view.
// ─────────────────────────────────────────────────────────────

// §5 — Expected Delivered Orders = Orders × Delivery Rate. Gross
// Potential Revenue = sum of every order's own cart value (more
// accurate than orders × a single average now that real per-order
// values are stored). Recognized Revenue = Potential Revenue × Delivery
// Rate — §5's own worked example (100 carts × ₹500 = ₹50,000 potential;
// at 70% -> ₹35,000 recognized) is exactly potentialRevenue ×
// deliveryRate, which only equals orders × avgOrderValue × deliveryRate
// when every cart has the same value, so summing real cart values here
// is a strict generalization of that example, not a different formula.
// Expenses are scaled by Expected Delivered Orders, not the raw order
// count, same reasoning Phase 22 used: a cart only actually incurs
// manufacturing/packaging/shipping cost once it converts into a real,
// delivered order.
function computeSummary(records, settings) {
  const orders = records.length;
  const potentialRevenue = records.reduce((sum, r) => sum + (Number(r.cartValue) || 0), 0);
  const deliveryRate = Number(settings.deliveryRate) || 0;
  const manufacturingCost = Number(settings.manufacturingCost) || 0;
  const packagingCost = Number(settings.packagingCost) || 0;
  const shippingCost = Number(settings.shippingCost) || 0;
  const miscCost = Number(settings.miscCost) || 0;

  const expectedDelivered = orders * (deliveryRate / 100);
  const recognizedRevenue = potentialRevenue * (deliveryRate / 100);

  const manufacturingExpense = expectedDelivered * manufacturingCost;
  const packagingExpense = expectedDelivered * packagingCost;
  const shippingExpense = expectedDelivered * shippingCost;
  const miscExpense = expectedDelivered * miscCost;
  const totalExpenses = manufacturingExpense + packagingExpense + shippingExpense + miscExpense;

  const netContribution = recognizedRevenue - totalExpenses;

  return {
    orders,
    deliveryRate,
    expectedDelivered,
    potentialRevenue,
    recognizedRevenue,
    manufacturingExpense,
    packagingExpense,
    shippingExpense,
    miscExpense,
    totalExpenses,
    netContribution,
  };
}

function shape(doc) {
  return {
    id: String(doc._id),
    source: doc.source,
    abandonedCartId: doc.abandonedCartId,
    cartId: doc.cartId,
    externalOrderId: doc.externalOrderId,
    orderDate: doc.orderDate,
    orderTimestamp: doc.orderTimestamp,
    customerName: doc.customerName,
    phone: doc.phone,
    email: doc.email,
    cartValue: doc.cartValue,
    items: doc.items || [],
    utmCampaign: doc.utmCampaign,
    adsetName: doc.adsetName,
    adId: doc.adId,
    shippingAddress: doc.shippingAddress || {},
    pincode: doc.pincode,
    paymentStatus: doc.paymentStatus,
    checkoutUrl: doc.checkoutUrl,
    notes: doc.notes || "",
    rawPayload: doc.rawPayload || {},
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

// §3 — free-text search across customer name/phone/email/cart id/
// order id/campaign/adset/ad.
function buildSearchFilter(search) {
  const q = String(search || "").trim();
  if (!q) return null;
  const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  return {
    $or: [
      { customerName: re },
      { phone: re },
      { email: re },
      { cartId: re },
      { externalOrderId: re },
      { abandonedCartId: re },
      { utmCampaign: re },
      { adsetName: re },
      { adId: re },
      { "items.name": re },
      { "items.sku": re },
    ],
  };
}

function buildRangeFilter(since, until) {
  if (!since && !until) return {};
  const filter = {};
  if (since) filter.$gte = since;
  if (until) filter.$lte = until;
  return { orderDate: filter };
}

// GET /api/abandoned-carts?since=&until=&search=&page=&pageSize=
// §4 — Dashboard reads this with since/until set to whatever preset/
// custom range is selected (no search/page — it only reads `summary`).
// §3/§9 — the Management Table reads it with search/page/pageSize for
// the paginated, searchable list; `summary` is always computed over the
// FULL since/until range regardless of search or pagination, so it
// stays an accurate range total even while the table itself is
// filtered/paginated down to a page of matching rows.
router.get("/", async (req, res) => {
  try {
    const { since, until, search } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize, 10) || 25));

    const rangeFilter = buildRangeFilter(since, until);
    const searchFilter = buildSearchFilter(search);

    // Summary is always over the full range (never narrowed by search),
    // so Dashboard's since/until-only call and the management page's
    // "N abandoned carts in range" figure always agree.
    const [settings, rangeDocs] = await Promise.all([
      getOrCreateAbandonedCartSettings(),
      AbandonedCartOrder.find(rangeFilter).select("cartValue").lean(),
    ]);
    const summary = computeSummary(rangeDocs, settings);

    const listFilter = searchFilter ? { ...rangeFilter, ...searchFilter } : rangeFilter;
    const total = await AbandonedCartOrder.countDocuments(listFilter);
    const docs = await AbandonedCartOrder.find(listFilter)
      .sort({ orderTimestamp: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean();

    res.json({
      success: true,
      records: docs.map(shape),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      summary,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── Settings (§5) — must be declared before "/:id" so "settings" never
// matches as an :id lookup. ──
router.get("/settings", async (req, res) => {
  try {
    const settings = await getOrCreateAbandonedCartSettings();
    res.json({
      success: true,
      deliveryRate: settings.deliveryRate,
      manufacturingCost: settings.manufacturingCost,
      packagingCost: settings.packagingCost,
      shippingCost: settings.shippingCost,
      miscCost: settings.miscCost,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put("/settings", async (req, res) => {
  try {
    const { deliveryRate, manufacturingCost, packagingCost, shippingCost, miscCost } = req.body || {};
    const rate = Number(deliveryRate);
    if (deliveryRate === undefined || isNaN(rate) || rate < 0 || rate > 100) {
      return res.status(400).json({ success: false, message: "deliveryRate must be a number between 0 and 100" });
    }
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

    const settings = await getOrCreateAbandonedCartSettings();
    settings.deliveryRate = rate;
    if (manufacturingCost !== undefined) settings.manufacturingCost = Number(manufacturingCost) || 0;
    if (packagingCost !== undefined) settings.packagingCost = Number(packagingCost) || 0;
    if (shippingCost !== undefined) settings.shippingCost = Number(shippingCost) || 0;
    if (miscCost !== undefined) settings.miscCost = Number(miscCost) || 0;
    await settings.save();

    await recordActivity({
      user: req.user?.email,
      type: "abandoned_cart_settings_updated",
      message: `Abandoned cart settings updated (delivery rate ${settings.deliveryRate}%)`,
      entityType: "abandonedCartSettings",
      entityId: String(settings._id),
    });

    res.json({
      success: true,
      deliveryRate: settings.deliveryRate,
      manufacturingCost: settings.manufacturingCost,
      packagingCost: settings.packagingCost,
      shippingCost: settings.shippingCost,
      miscCost: settings.miscCost,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// §3 — "View details."
router.get("/:id", async (req, res) => {
  try {
    const doc = await AbandonedCartOrder.findById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: "Abandoned cart record not found" });
    res.json({ success: true, record: shape(doc) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// §3 — "Edit." Corrects a real order's fields (e.g. a mis-parsed
// customer name/product) — never touches dedupeKey/source, and
// re-derives orderDate from orderTimestamp if the timestamp is edited,
// so the two never drift apart.
router.put("/:id", async (req, res) => {
  try {
    const doc = await AbandonedCartOrder.findById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: "Abandoned cart record not found" });

    const {
      customerName,
      phone,
      email,
      cartValue,
      items,
      utmCampaign,
      adsetName,
      adId,
      shippingAddress,
      paymentStatus,
      checkoutUrl,
      orderTimestamp,
      notes,
    } = req.body || {};

    if (customerName !== undefined) doc.customerName = String(customerName).trim();
    if (phone !== undefined) doc.phone = String(phone).trim();
    if (email !== undefined) doc.email = String(email).trim();
    if (cartValue !== undefined) doc.cartValue = Math.max(0, Number(cartValue) || 0);
    if (Array.isArray(items)) {
      doc.items = items.map((it) => ({
        name: String(it?.name || "").trim(),
        sku: String(it?.sku || "").trim(),
        variantId: String(it?.variantId || "").trim(),
        quantity: Math.max(0, Number(it?.quantity) || 0),
        price: Math.max(0, Number(it?.price) || 0),
      }));
    }
    if (utmCampaign !== undefined) doc.utmCampaign = String(utmCampaign).trim();
    if (adsetName !== undefined) doc.adsetName = String(adsetName).trim();
    if (adId !== undefined) doc.adId = String(adId).trim();
    if (shippingAddress && typeof shippingAddress === "object") {
      doc.shippingAddress = {
        line1: String(shippingAddress.line1 || "").trim(),
        line2: String(shippingAddress.line2 || "").trim(),
        city: String(shippingAddress.city || "").trim(),
        state: String(shippingAddress.state || "").trim(),
        pincode: String(shippingAddress.pincode || "").trim(),
        country: String(shippingAddress.country || "").trim(),
      };
      doc.pincode = doc.shippingAddress.pincode;
    }
    if (paymentStatus !== undefined) doc.paymentStatus = String(paymentStatus).trim();
    if (checkoutUrl !== undefined) doc.checkoutUrl = String(checkoutUrl).trim();
    if (notes !== undefined) doc.notes = String(notes).trim();
    if (orderTimestamp) {
      const ts = new Date(orderTimestamp);
      if (!isNaN(ts.getTime())) {
        doc.orderTimestamp = ts;
        doc.orderDate = toIstDateString(ts);
      }
    }

    await doc.save();

    await recordActivity({
      user: req.user?.email,
      type: "abandoned_cart_updated",
      message: `Abandoned cart record updated (${doc.orderDate} — ${doc.customerName || doc.phone || doc.cartId})`,
      entityType: "abandonedCart",
      entityId: String(doc._id),
    });

    res.json({ success: true, record: shape(doc) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// §3 — "Delete."
router.delete("/:id", async (req, res) => {
  try {
    const doc = await AbandonedCartOrder.findByIdAndDelete(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: "Abandoned cart record not found" });

    await recordActivity({
      user: req.user?.email,
      type: "abandoned_cart_deleted",
      message: `Abandoned cart record deleted (${doc.orderDate} — ${doc.customerName || doc.phone || doc.cartId})`,
      entityType: "abandonedCart",
      entityId: String(doc._id),
    });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
