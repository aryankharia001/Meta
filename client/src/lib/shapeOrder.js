// Phase 13 — the new backend routes (adSetExplorer.js, adExplorer.js,
// hourly.js) return raw ShiprocketOrder documents (orderId, orderDate,
// campaignId, campaignName, adsetId, adsetName, adId, totalAmountPayable,
// paymentType, orderCreatedAt, address{...}, raw{...}) — the same shape
// getStoredShiprocketOrders() has always returned. OrdersListPopup.jsx
// (and DataTable-based order tables) expect the flatter shape
// analytics.js's /orders endpoint already pre-shapes server-side
// (customerName, city, state, product, deliveryStatus, orderStatus).
// This is a client-side-only, read-only mapping — it doesn't change
// what's stored or how orders are matched, it just formats an
// already-fetched order for display, the same probing logic
// orderDetails.js/campaignExplorer.js already use server-side.

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

function extractProductSummary(raw) {
  const items = raw?.cart_data?.line_items || raw?.line_items || raw?.products || raw?.items || raw?.cart_data?.products;
  if (!Array.isArray(items) || items.length === 0) return null;
  const names = items.map((i) => i?.name || i?.product_name || i?.title).filter(Boolean);
  return names.length ? names.join(", ") : null;
}

export function shapeOrderForPopup(o) {
  const raw = o.raw || {};
  const customerName = [o.address?.firstName, o.address?.lastName].filter(Boolean).join(" ").trim() || null;
  return {
    orderId: o.orderId,
    customerName,
    phone: o.phone || null,
    campaignId: o.campaignId || null,
    campaignName: o.campaignName || null,
    adsetId: o.adsetId || null,
    adsetName: o.adsetName || null,
    adId: o.adId || null,
    city: o.address?.city || null,
    state: o.address?.state || null,
    product: extractProductSummary(raw),
    totalAmountPayable: o.totalAmountPayable,
    paymentType: o.paymentType || null,
    deliveryStatus: extractDeliveryStatus(raw),
    orderStatus: raw?.order_status || raw?.status || null,
    orderCreatedAt: o.orderCreatedAt,
    orderDate: o.orderDate,
  };
}

export function shapeOrdersForPopup(orders) {
  return (orders || []).map(shapeOrderForPopup);
}
