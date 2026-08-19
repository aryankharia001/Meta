import mongoose from "mongoose";

// ─────────────────────────────────────────────────────────────
// Phase 25 — Store & Fetch Real Abandoned Cart Orders.
//
// Replaces Phase 22's AbandonedCart model (one document per CALENDAR
// DATE, manually typed in). This is the opposite: one document per REAL
// abandoned-cart order, written automatically by
// routes/abandonCartPostback.js whenever Traflead or Shiprocket Engage
// posts one to /abandon-cart-postback. The database is now the single
// source of truth — daily/range totals are always DERIVED by querying
// this collection (see routes/abandonedCarts.js), never typed in.
//
// Dedup (§2 — "do not create duplicate abandoned-cart records if the
// same cart/order is sent to the API multiple times"): `dedupeKey` is
// the one field every write is upserted against. It's computed once in
// the postback handler as the first identifier available, in priority
// order: externalOrderId -> cartId -> abandonedCartId (see
// buildDedupeKey() in abandonCartPostback.js) — NOT enforced here via a
// schema-level fallback, because Mongoose can't express "unique across
// whichever of these three fields is non-empty" as a single index. The
// unique index below is what actually makes re-sending the same
// cart/order a no-op update instead of a second document.
//
// `orderDate` is a plain "YYYY-MM-DD" IST string — same convention as
// ShiprocketOrder.orderDate / Expense.startDate / the old
// AbandonedCart.date — computed from `orderTimestamp` via
// utils/dateIst.js's toIstDateString(), so lexicographic $gte/$lte range
// queries stay equivalent to chronological order. `orderTimestamp` is
// the actual postback/order instant (§1 — "use the actual postback
// timestamp as the order date/time"), kept as a real Date so Dashboard/
// management-page "Date/Time" columns can show the exact time, not just
// the day.
// ─────────────────────────────────────────────────────────────

const addressSchema = new mongoose.Schema(
  {
    line1: { type: String, trim: true, default: "" },
    line2: { type: String, trim: true, default: "" },
    city: { type: String, trim: true, default: "" },
    state: { type: String, trim: true, default: "" },
    pincode: { type: String, trim: true, default: "" },
    country: { type: String, trim: true, default: "" },
  },
  { _id: false }
);

const cartItemSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, default: "" },
    sku: { type: String, trim: true, default: "" },
    variantId: { type: String, trim: true, default: "" },
    quantity: { type: Number, default: 1, min: 0 },
    price: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const abandonedCartOrderSchema = new mongoose.Schema(
  {
    // Which integration this came in through — "traflead" |
    // "shiprocket_engage" | "unknown" (free string on purpose, same
    // reasoning as Expense.category: new sources can show up without a
    // schema change).
    source: { type: String, trim: true, default: "unknown", index: true },

    // §2 — the dedup key every postback upserts against. See the header
    // comment above for how it's derived.
    dedupeKey: { type: String, required: true, unique: true, trim: true },

    abandonedCartId: { type: String, trim: true, default: "", index: true },
    cartId: { type: String, trim: true, default: "", index: true },
    externalOrderId: { type: String, trim: true, default: "", index: true },

    orderDate: { type: String, required: true, index: true }, // YYYY-MM-DD, IST
    orderTimestamp: { type: Date, required: true, index: true }, // exact postback timestamp

    customerName: { type: String, trim: true, default: "" },
    phone: { type: String, trim: true, default: "", index: true },
    email: { type: String, trim: true, default: "" },

    cartValue: { type: Number, default: 0, min: 0 },
    items: { type: [cartItemSchema], default: [] },

    utmCampaign: { type: String, trim: true, default: "", index: true },
    adsetName: { type: String, trim: true, default: "" },
    adId: { type: String, trim: true, default: "" },

    shippingAddress: { type: addressSchema, default: () => ({}) },
    // Convenience top-level mirror of shippingAddress.pincode — kept in
    // sync by the postback handler / edit route — so it can be indexed
    // and searched without reaching into the subdocument.
    pincode: { type: String, trim: true, default: "", index: true },

    paymentStatus: { type: String, trim: true, default: "" },
    checkoutUrl: { type: String, trim: true, default: "" },

    // Free-text ops notes (e.g. "called customer, will reorder") — not
    // part of the postback payload, only ever set via the Edit modal on
    // the management page. Same purpose as the old AbandonedCart.notes.
    notes: { type: String, trim: true, default: "" },

    // Full postback body exactly as received, untouched. Nothing this
    // model/route parses out of a payload is ever dropped — if a field
    // mapping turns out to be wrong or incomplete once real Traflead/
    // Shiprocket Engage traffic is seen, the original data is still
    // here to re-derive from.
    rawPayload: { type: Object, default: {} },
  },
  { timestamps: true }
);

// Range queries (management page + Dashboard) filter by orderDate and
// sort by orderTimestamp within it.
abandonedCartOrderSchema.index({ orderDate: 1, orderTimestamp: -1 });
// Text-ish search across the columns the management page's search box
// covers (customer/phone/email/cart id/order id/campaign) — see
// routes/abandonedCarts.js's buildSearchFilter().
abandonedCartOrderSchema.index({ customerName: 1 });
abandonedCartOrderSchema.index({ utmCampaign: 1, adsetName: 1, adId: 1 });

export default mongoose.models.AbandonedCartOrder || mongoose.model("AbandonedCartOrder", abandonedCartOrderSchema);
