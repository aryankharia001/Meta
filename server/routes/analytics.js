import express from "express";
import ShiprocketOrder from "../models/shiprocketorder.js";

const router = express.Router();

// ─────────────────────────────────────────────────────────────
// Phase 6 — Analytics backend
// ─────────────────────────────────────────────────────────────
//
// Entirely new, additive route file (mounted at /api/analytics in
// index.js). Read-only: a single Mongo query against ShiprocketOrder,
// scoped by orderDate, no writes anywhere. Never touches /compare, the
// campaign-matching logic, or any sync path — this route doesn't even
// know those exist.
//
// Deliberately duplicates a few small extraction helpers that already
// exist in near-identical form in campaigns.js (shapeOrderForDrawer)
// and orderDetails.js (extractProductLines) rather than importing from
// those files. Same reasoning as CampaignDrawer.jsx's local
// normalizeCampaignName copy: this route has zero coupling to any
// Phase 2–5 file, so nothing done here can ever change their behavior,
// and nothing they do can ever break this route. The one genuinely new
// piece of data this endpoint provides that no earlier phase exposed in
// bulk is full product line items (name/sku/quantity/price/total) per
// order, which product-level analytics needs and campaigns.js's
// extractProducts() (a joined name string only) doesn't give.
//
// Aggregation itself (revenue by day/campaign/product/state/city,
// customer grouping, delivery-status buckets, hour-of-day trends, ...)
// intentionally happens on the CLIENT (AnalyticsPage.jsx), the same way
// Dashboard.jsx already derives its KPI cards from one fetched dataset
// via useMemo. This endpoint's only job is to hand over one clean,
// enriched, already-filtered-by-date order list — every section's chart
// then just reduces that same array a different way, memoized, so
// switching tabs never re-fetches and rarely re-computes.

function extractCourier(raw) {
  return raw?.courier_name || raw?.courier || raw?.shipment?.courier_name || raw?.shipments?.[0]?.courier_name || null;
}
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
function extractProductLines(raw) {
  const items = raw?.cart_data?.line_items || raw?.line_items || raw?.products || raw?.items || raw?.cart_data?.products;
  if (!Array.isArray(items) || items.length === 0) return [];
  return items.map((i, idx) => ({
    id: String(i?.id ?? i?.line_item_id ?? idx),
    name: i?.name || i?.product_name || i?.title || "Unknown product",
    sku: i?.sku || i?.product_sku || i?.variant_sku || null,
    quantity: i?.quantity != null ? Number(i.quantity) : i?.qty != null ? Number(i.qty) : 1,
    price: i?.price != null ? Number(i.price) : i?.selling_price != null ? Number(i.selling_price) : null,
    total: i?.total != null ? Number(i.total) : i?.line_total != null ? Number(i.line_total) : null,
  }));
}

function shapeAnalyticsOrder(o) {
  const raw = o.raw || {};
  const customerName = [o.address?.firstName, o.address?.lastName].filter(Boolean).join(" ").trim();
  return {
    orderId: o.orderId,
    orderDate: o.orderDate,
    orderCreatedAt: o.orderCreatedAt,
    campaignId: o.campaignId || null,
    campaignName: o.campaignName || null,
    totalAmountPayable: o.totalAmountPayable || 0,
    paymentType: o.paymentType || null,
    paymentStatus: o.paymentStatus || null,
    phone: o.phone || null,
    customerName: customerName || null,
    city: o.address?.city || null,
    state: o.address?.state || null,
    orderStatus: extractOrderStatus(raw),
    deliveryStatus: extractDeliveryStatus(raw),
    courier: extractCourier(raw),
    products: extractProductLines(raw),
  };
}

// ─── GET /api/analytics/:tokenId/orders ────────────────────────
// tokenId isn't actually used to filter (ShiprocketOrder isn't scoped
// per-token — same as /orders-detailed above), kept in the path purely
// for URL consistency with every other per-token route in this app.
router.get("/:tokenId/orders", async (req, res) => {
  try {
    const { since, until } = req.query;
    if (!since || !until) {
      return res.status(400).json({ success: false, message: "since and until are required (YYYY-MM-DD)" });
    }

    const rawOrders = await ShiprocketOrder.find({ orderDate: { $gte: since, $lte: until } })
      .select(
        "orderId orderDate campaignId campaignName totalAmountPayable paymentType paymentStatus orderCreatedAt phone address raw"
      )
      .lean();

    const orders = rawOrders.map(shapeAnalyticsOrder);

    res.json({ success: true, since, until, orders });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
