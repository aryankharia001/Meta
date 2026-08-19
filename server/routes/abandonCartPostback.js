import express from "express";
import AbandonedCartOrder from "../models/AbandonedCartOrder.js";
import { toIstDateString } from "../utils/dateIst.js";

const router = express.Router();

// ═════════════════════════════════════════════════════════════
// Phase 25 §1/§7 — /abandon-cart-postback (mounted publicly, BOTH at
// "/abandon-cart-postback" and "/api/abandon-cart-postback" — see
// index.js — because the caller can't hold a login session cookie, so
// this route sits OUTSIDE the requireAuth gate that protects every
// other /api/* route). This is the ONLY unauthenticated write path in
// the whole app; keep it that way — it can only ever upsert one
// AbandonedCartOrder document.
//
// §7 architecture — the Traflead + Shiprocket Engage forwarding for an
// abandoned cart is NOT handled here: it already lives in a SEPARATE
// Node app (a lead-routing/CRM service), not this one. That other
// app's existing postback handler is being extended to ALSO call this
// endpoint (fire-and-forget, alongside its Traflead/Shiprocket calls)
// so the abandoned cart lands in Meta's own MongoDB too — this route is
// purely the storage side of that fan-out, nothing more:
//
//   Abandoned Cart -> other app's /abandon-cart-postback -> {
//     Traflead (unchanged),
//     Shiprocket Engage (unchanged),
//     THIS endpoint -> MongoDB (new)
//   }
//
// The real payload shape (confirmed from the other app's actual
// forwarding code, not guessed) looks like Shopify's own abandoned-
// checkout webhook shape: cart_id, cart_token, first_name, last_name,
// phone_number, email, total_price, total_discount, item_count, items[]
// (id/variant_id/sku/title/price/quantity/line_price/product_id/...),
// custom_attributes.{utm_campaign, adset_name, ad_id} (top-level, NOT
// nested under a cart_data wrapper), shipping_address/billing_address
// (address1, city, state, pincode/zip), checkout_url, payment_status.
// normalizePostback() below is written against that exact shape (note:
// leadData has NO top-level `phone` field, only `phone_number`), while
// keeping a handful of alternate-key aliases as a safety net in case
// the other app ever changes what it forwards.
// ═════════════════════════════════════════════════════════════

function isEmpty(v) {
  return v === undefined || v === null || v === "";
}

// Returns the first non-empty value among the given candidates.
function firstNonEmpty(...vals) {
  for (const v of vals) {
    if (!isEmpty(v)) return v;
  }
  return "";
}

// Digs a dotted path ("a.b.c") out of a (possibly undefined) object
// without throwing.
function dig(obj, path) {
  if (!obj) return undefined;
  return path.split(".").reduce((acc, key) => (acc && typeof acc === "object" ? acc[key] : undefined), obj);
}

function toNumber(v, fallback = 0) {
  const n = parseFloat(v);
  return isNaN(n) ? fallback : n;
}

// Normalizes one line item — matches the real items[] shape (id,
// variant_id, sku, title/product_title, price/line_price, quantity)
// while keeping a few extra aliases as a safety net.
function normalizeItem(raw) {
  if (!raw || typeof raw !== "object") return null;
  const name = firstNonEmpty(raw.title, raw.product_title, raw.name, raw.product_name, raw.productName);
  const sku = firstNonEmpty(raw.sku, raw.product_sku, raw.productSku, raw.variant_sku);
  const variantId = firstNonEmpty(raw.variant_id, raw.variantId, raw.id, raw.variant, raw.product_variant_id);
  const quantity = toNumber(firstNonEmpty(raw.quantity, raw.qty, raw.count), 1);
  const price = toNumber(firstNonEmpty(raw.price, raw.line_price, raw.unit_price, raw.unitPrice, raw.amount), 0);
  if (!name && !sku && !variantId) return null;
  return { name: String(name || ""), sku: String(sku || ""), variantId: String(variantId || ""), quantity, price };
}

function normalizeItems(body) {
  const cart = body.cart_data || body.cart || {};
  const raw = body.items || body.line_items || body.products || body.cart_items || cart.line_items || cart.items || [];
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeItem).filter(Boolean);
}

function normalizeAddress(body) {
  const addr = body.shipping_address || body.shippingAddress || body.billing_address || body.address || body.customer?.address || {};
  const line1 = firstNonEmpty(addr.line1, addr.address1, addr.address_line1, addr.addressLine1, addr.street, addr.line_1);
  const line2 = firstNonEmpty(addr.line2, addr.address2, addr.address_line2, addr.addressLine2, addr.line_2);
  const city = firstNonEmpty(addr.city, addr.town);
  const state = firstNonEmpty(addr.state, addr.province, addr.region);
  const pincode = firstNonEmpty(addr.pincode, addr.pin_code, addr.postal_code, addr.postalCode, addr.zip, addr.zipcode, addr.zip_code);
  const country = firstNonEmpty(addr.country, addr.country_code, addr.countryCode);
  return {
    line1: String(line1 || ""),
    line2: String(line2 || ""),
    city: String(city || ""),
    state: String(state || ""),
    pincode: String(pincode || ""),
    country: String(country || ""),
  };
}

function normalizeCustomerName(body) {
  const direct = firstNonEmpty(body.customer_name, body.customerName, body.name, body.customer?.name);
  if (direct) return String(direct);
  const addr = body.shipping_address || body.billing_address || body.customer || {};
  const first = firstNonEmpty(body.first_name, body.firstName, addr.first_name, addr.firstName);
  const last = firstNonEmpty(body.last_name, body.lastName, addr.last_name, addr.lastName);
  return `${first || ""} ${last || ""}`.trim();
}

// "Source" here means where the abandoned-cart EVENT originated from —
// NOT Traflead/Shiprocket Engage (those are where the OTHER app forwards
// the lead to, not where this postback comes from). The real payload's
// fingerprint (top-level custom_attributes + cart_token +
// shipping_address, no cart_data wrapper) matches Shopify's own
// checkout/abandoned-checkout webhook shape, so that's the default
// label when nothing more specific is present.
function detectSource(body, query) {
  const explicit = String(query.source || body.source || "").toLowerCase().trim();
  if (explicit) return explicit;
  if (!isEmpty(body.cart_token) && !isEmpty(body.custom_attributes)) return "checkout";
  if (!isEmpty(body.cart_data) || !isEmpty(dig(body, "cart_data.custom_attributes"))) return "shiprocket_engage";
  return "unknown";
}

function parseTimestamp(body) {
  const raw = firstNonEmpty(
    body.timestamp,
    body.created_at,
    body.createdAt,
    body.cart_updated_at,
    body.cartUpdatedAt,
    body.updated_at,
    body.updatedAt,
    body.event_time,
    body.eventTime,
    body.abandoned_at,
    body.abandonedAt,
    body.order_created_date,
    body.orderCreatedDate,
    body.date
  );
  if (raw) {
    const d = new Date(raw);
    if (!isNaN(d.getTime())) return d;
  }
  // §1 — "use the actual postback timestamp." If the payload genuinely
  // doesn't carry one, the best remaining truth is "when we received
  // this postback" — falling back to server-receipt time rather than
  // dropping the record (losing a real abandoned cart because of a
  // missing timestamp field would be worse than a slightly-late one).
  return new Date();
}

// §2 — the identifier every write dedupes against. Priority order:
// a real order id first, then cart id (the real, stable identifier for
// a genuine abandoned cart — `leadData.cart_id`), then whatever
// abandoned-cart-event id the source uses (cart_token), then a
// phone/email + minute-bucket fallback so a genuinely id-less payload
// still gets stored instead of being silently dropped.
function buildDedupeKey({ externalOrderId, cartId, abandonedCartId, phone, email, orderTimestamp }) {
  if (externalOrderId) return `order:${externalOrderId}`;
  if (cartId) return `cart:${cartId}`;
  if (abandonedCartId) return `abandoned:${abandonedCartId}`;
  if (phone) return `phone:${phone}:${Math.floor(orderTimestamp.getTime() / 60000)}`;
  if (email) return `email:${email}:${Math.floor(orderTimestamp.getTime() / 60000)}`;
  return "";
}

function normalizePostback(body, query) {
  const cart = body.cart_data || body.cart || {};
  const attrs = cart.custom_attributes || body.custom_attributes || body.attribution || body.utm || {};

  const cartId = String(firstNonEmpty(body.cart_id, body.cartId, cart.cart_id, cart.id, body.checkout_id, body.checkoutId) || "");
  const externalOrderId = String(
    firstNonEmpty(body.order_id, body.orderId, body.external_order_id, body.externalOrderId, body.order?.id) || ""
  );
  // cart_token is the id Shiprocket Engage's own payload calls `token`
  // — the clearest "abandoned-cart-event" id available in this shape.
  const abandonedCartId = String(
    firstNonEmpty(body.cart_token, body.cartToken, body.abandoned_cart_id, body.abandonedCartId, body.event_id, body.eventId) || ""
  );

  const orderTimestamp = parseTimestamp(body);
  const orderDate = toIstDateString(orderTimestamp);

  // leadData has NO top-level `phone` — only `phone_number`.
  const phone = String(
    firstNonEmpty(body.phone_number, body.phone, body.customer_phone, body.customerPhone, body.customer?.phone) || ""
  ).trim();
  const email = String(firstNonEmpty(body.email, body.customer_email, body.customerEmail, body.customer?.email) || "")
    .trim()
    .toLowerCase();

  const cartValue = toNumber(
    firstNonEmpty(body.total_price, body.cart_value, body.cartValue, body.total, body.totalPrice, body.subtotal_price, body.amount, body.cart_total)
  );

  const dedupeKey = buildDedupeKey({ externalOrderId, cartId, abandonedCartId, phone, email, orderTimestamp });
  const shippingAddress = normalizeAddress(body);

  return {
    source: detectSource(body, query),
    dedupeKey,
    abandonedCartId,
    cartId,
    externalOrderId,
    orderDate,
    orderTimestamp,
    customerName: normalizeCustomerName(body),
    phone,
    email,
    cartValue,
    items: normalizeItems(body),
    utmCampaign: String(firstNonEmpty(body.utm_campaign, body.utmCampaign, attrs.utm_campaign, body.campaign_name, body.campaignName) || ""),
    adsetName: String(firstNonEmpty(body.utm_adset, body.adset_name, body.adsetName, attrs.adset_name, attrs.adsetName) || ""),
    adId: String(firstNonEmpty(body.ad_id, body.adId, attrs.ad_id, attrs.adId) || ""),
    shippingAddress,
    pincode: shippingAddress.pincode || String(firstNonEmpty(body.pincode, body.pin_code, body.zip) || ""),
    paymentStatus: String(firstNonEmpty(body.payment_status, body.paymentStatus, body.status) || ""),
    checkoutUrl: String(firstNonEmpty(body.checkout_url, body.checkoutUrl, body.recovery_url, body.recoveryUrl, body.cart_url, body.cartUrl) || ""),
    rawPayload: body,
  };
}

// ─── POST /abandon-cart-postback (+ /api/abandon-cart-postback) ─────
// Called by the OTHER app's postback handler (fire-and-forget, in
// parallel with its Traflead/Shiprocket Engage calls — see that app's
// forwardToMetaDb()). Pure storage: normalize -> upsert -> respond.
router.post("/", async (req, res) => {
  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const normalized = normalizePostback(body, req.query || {});

    if (!normalized.dedupeKey) {
      console.warn(
        "⚠ /abandon-cart-postback received a payload with no cart_id / phone_number / email — cannot dedupe:",
        JSON.stringify(body).slice(0, 500)
      );
      return res.status(400).json({
        success: false,
        message: "Payload has no cart_id / phone_number / email — cannot identify this cart",
      });
    }

    // Upsert on dedupeKey — a repeat postback for the same cart updates
    // the existing document (e.g. a payment_status change) instead of
    // creating a duplicate. This IS the §2 dedup guarantee, backed by
    // the unique index on AbandonedCartOrder.dedupeKey.
    const doc = await AbandonedCartOrder.findOneAndUpdate(
      { dedupeKey: normalized.dedupeKey },
      { $set: normalized, $setOnInsert: { notes: "" } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.json({ success: true, id: String(doc._id), dedupeKey: doc.dedupeKey });
  } catch (err) {
    if (err.code === 11000) {
      // A near-simultaneous duplicate race lost to another upsert —
      // treat as success, not an error, since the record now exists.
      return res.json({ success: true, message: "Already recorded" });
    }
    console.error("/abandon-cart-postback failed:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Some callers GET the URL once to verify it's reachable — respond 200
// so that check passes, without requiring auth.
router.get("/", (req, res) => {
  res.json({ success: true, message: "Abandoned cart postback endpoint is live" });
});

export default router;
