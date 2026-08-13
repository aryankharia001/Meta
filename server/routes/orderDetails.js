import express from "express";
import ShiprocketOrder from "../models/shiprocketorder.js";
import OrderNote from "../models/OrderNote.js";

const router = express.Router();

// ─────────────────────────────────────────────────────────────
// Phase 4 — Order Drawer backend
// ─────────────────────────────────────────────────────────────
//
// Entirely new, additive route file (mounted at /api/order-details in
// index.js). Reads ShiprocketOrder — never writes to it, never touches
// the sync/backfill/matching code in shiprocketService.js or
// campaigns.js. The only writes here are to the brand-new OrderNote
// collection (internal notes), which Shiprocket never sees.
//
// Shiprocket's raw order payload shape for products/shipping/timeline
// fields isn't documented anywhere in this codebase — same situation
// Phase 2 and 3 ran into for courier/delivery-status. Every extractor
// below defensively probes a handful of plausible field names and falls
// back to null (rendered as "N/A" / empty client-side) instead of
// guessing wrong. What's genuinely real here (not guessed): customer
// name/phone/email/full address, payment type/status, order totals, and
// — the actually new capability this phase adds — a real cross-order
// customer history query by phone number.

function extractOrderStatus(raw) {
  return raw?.order_status || raw?.status || null;
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
function extractCourier(raw) {
  return raw?.courier_name || raw?.courier || raw?.shipment?.courier_name || raw?.shipments?.[0]?.courier_name || null;
}
function extractAwb(raw) {
  return raw?.awb || raw?.awb_code || raw?.awb_number || raw?.shipments?.[0]?.awb || raw?.shipments?.[0]?.awb_code || null;
}
function extractTrackingUrl(raw) {
  return raw?.tracking_url || raw?.track_url || raw?.shipments?.[0]?.tracking_url || null;
}
function extractPickupDate(raw) {
  return raw?.pickup_date || raw?.pickup_scheduled_date || raw?.shipments?.[0]?.pickup_date || null;
}
function extractShippingDate(raw) {
  return raw?.shipped_date || raw?.ship_date || raw?.shipments?.[0]?.shipped_date || null;
}
function extractExpectedDelivery(raw) {
  return raw?.expected_delivery_date || raw?.edd || raw?.shipments?.[0]?.edd || null;
}
function extractDeliveredDate(raw) {
  return raw?.delivered_date || raw?.delivery_date || raw?.shipments?.[0]?.delivered_date || null;
}
function extractTransactionId(raw) {
  return raw?.transaction_id || raw?.payment_transaction_id || raw?.razorpay_payment_id || raw?.upi_transaction_id || null;
}
function extractShiprocketOrderId(raw) {
  return raw?.shiprocket_order_id || raw?.sr_order_id || raw?.channel_order_id || null;
}

function extractProductLines(raw) {
  const items =
    raw?.cart_data?.line_items || raw?.line_items || raw?.products || raw?.items || raw?.cart_data?.products;
  if (!Array.isArray(items) || items.length === 0) return [];
  return items.map((i, idx) => ({
    id: String(i?.id ?? i?.line_item_id ?? idx),
    name: i?.name || i?.product_name || i?.title || "Unknown product",
    sku: i?.sku || i?.product_sku || i?.variant_sku || null,
    quantity: i?.quantity != null ? Number(i.quantity) : i?.qty != null ? Number(i.qty) : null,
    price: i?.price != null ? Number(i.price) : i?.selling_price != null ? Number(i.selling_price) : null,
    discount: i?.discount != null ? Number(i.discount) : i?.total_discount != null ? Number(i.total_discount) : null,
    total: i?.total != null ? Number(i.total) : i?.line_total != null ? Number(i.line_total) : null,
  }));
}

// Probes a handful of plausible shapes for a per-order event history
// (Shiprocket's courier-tracking "shipment_track_activities" shape is
// the most likely real one if/when this ever gets wired to a live
// tracking pull, hence checked first).
function extractTimelineEvents(raw) {
  const list =
    raw?.shipments?.[0]?.tracking_data?.shipment_track_activities || raw?.timeline || raw?.status_history || null;
  if (!Array.isArray(list)) return [];
  return list
    .map((e) => ({
      status: e?.status || e?.activity || e?.event || e?.["sr-status-label"] || null,
      date: e?.date || e?.timestamp || e?.time || null,
      location: e?.location || null,
    }))
    .filter((e) => e.status);
}

function shapeOrderDetails(order) {
  const raw = order.raw || {};
  const customerName = [order.address?.firstName, order.address?.lastName].filter(Boolean).join(" ").trim();

  return {
    orderId: order.orderId,
    shiprocketOrderId: extractShiprocketOrderId(raw),
    orderDate: order.orderDate,
    orderCreatedAt: order.orderCreatedAt,
    lastUpdated: order.updatedAt,
    orderStatus: extractOrderStatus(raw),
    deliveryStatus: extractDeliveryStatus(raw),
    paymentType: order.paymentType || null,
    paymentStatus: order.paymentStatus || null,
    totalAmountPayable: order.totalAmountPayable,
    subtotalPrice: order.subtotalPrice,
    totalDiscount: order.totalDiscount,
    transactionId: extractTransactionId(raw),

    customer: {
      name: customerName || null,
      phone: order.phone || null,
      email: order.email || null,
      address: {
        line1: order.address?.line1 || null,
        line2: order.address?.line2 || null,
        landmark: order.address?.landmark || null,
        city: order.address?.city || null,
        state: order.address?.state || null,
        pincode: order.address?.pincode || null,
        country: order.address?.country || null,
      },
    },

    products: extractProductLines(raw),

    shipping: {
      courier: extractCourier(raw),
      awb: extractAwb(raw),
      trackingUrl: extractTrackingUrl(raw),
      pickupDate: extractPickupDate(raw),
      shippingDate: extractShippingDate(raw),
      expectedDelivery: extractExpectedDelivery(raw),
      deliveredDate: extractDeliveredDate(raw),
    },

    // UTM Campaign / Source / Content map onto the same
    // cart_data.custom_attributes fields extractOrderFields() in
    // shiprocketService.js already pulls out (campaignName IS
    // utm_campaign, trackSource is the closest stored proxy for
    // utm_source, utmCreative is the closest stored proxy for
    // utm_content) — there's no separately stored utm_medium anywhere,
    // so that one is always N/A rather than guessed.
    attribution: {
      campaignId: order.campaignId || null,
      campaignName: order.campaignName || null,
      adsetId: order.adsetId || null,
      adsetName: order.adsetName || null,
      // Phase 13 §7/§19 — adId was already stored per order but never
      // exposed here. The ad's NAME isn't stored on the order at all
      // (only its id), so the frontend resolves it on demand via
      // GET /ad-explorer/:tokenId/:adId/details — this field is just the
      // stored id, never fabricated, and stays null exactly when the
      // order never carried one.
      adId: order.adId || null,
      adName: raw?.ad_name || raw?.cart_data?.custom_attributes?.ad_name || null,
      utmCampaign: order.campaignName || null,
      utmSource: order.trackSource || null,
      utmMedium: null,
      utmContent: order.utmCreative || null,
    },

    timeline: extractTimelineEvents(raw),
  };
}

// ─── GET /api/order-details/:orderId ───────────────────────────
router.get("/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;

    const order = await ShiprocketOrder.findOne({ orderId }).lean();
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    // Customer order history — a real cross-order query by phone number,
    // the most reliable identifier this schema stores per order. Not a
    // guess: every field here already exists and is indexed.
    let customerHistory = [];
    if (order.phone) {
      const history = await ShiprocketOrder.find({ phone: order.phone })
        .select("orderId orderDate campaignId campaignName totalAmountPayable paymentType paymentStatus orderCreatedAt")
        .sort({ orderCreatedAt: -1 })
        .lean();
      customerHistory = history.map((h) => ({
        orderId: h.orderId,
        orderDate: h.orderDate,
        campaignId: h.campaignId || null,
        campaignName: h.campaignName || null,
        totalAmountPayable: h.totalAmountPayable,
        paymentType: h.paymentType || null,
        paymentStatus: h.paymentStatus || null,
        orderCreatedAt: h.orderCreatedAt,
        isCurrent: h.orderId === order.orderId,
      }));
    }

    const notes = await OrderNote.find({ orderId }).sort({ createdAt: -1 }).lean();

    res.json({
      success: true,
      order: shapeOrderDetails(order),
      customerHistory,
      notes: notes.map((n) => ({
        id: String(n._id),
        text: n.text,
        author: n.author || null,
        createdAt: n.createdAt,
        updatedAt: n.updatedAt,
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Notes CRUD — app-owned data, never sent to Shiprocket ────

router.post("/:orderId/notes", async (req, res) => {
  try {
    const { orderId } = req.params;
    const { text, author } = req.body || {};
    if (!text || !text.trim()) {
      return res.status(400).json({ success: false, message: "Note text is required" });
    }
    const note = await OrderNote.create({ orderId, text: text.trim(), author: author || null });
    res.json({
      success: true,
      note: { id: String(note._id), text: note.text, author: note.author || null, createdAt: note.createdAt, updatedAt: note.updatedAt },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put("/notes/:noteId", async (req, res) => {
  try {
    const { noteId } = req.params;
    const { text, author } = req.body || {};
    if (!text || !text.trim()) {
      return res.status(400).json({ success: false, message: "Note text is required" });
    }
    const update = { text: text.trim() };
    if (author !== undefined) update.author = author || null;
    const note = await OrderNote.findByIdAndUpdate(noteId, update, { new: true });
    if (!note) return res.status(404).json({ success: false, message: "Note not found" });
    res.json({
      success: true,
      note: { id: String(note._id), text: note.text, author: note.author || null, createdAt: note.createdAt, updatedAt: note.updatedAt },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete("/notes/:noteId", async (req, res) => {
  try {
    const { noteId } = req.params;
    const deleted = await OrderNote.findByIdAndDelete(noteId);
    if (!deleted) return res.status(404).json({ success: false, message: "Note not found" });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
