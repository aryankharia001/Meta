import mongoose from "mongoose";

const addressSchema = new mongoose.Schema(
  {
    firstName: { type: String, trim: true, default: "" },
    lastName: { type: String, trim: true, default: "" },
    line1: { type: String, trim: true, default: "" },
    line2: { type: String, trim: true, default: "" },
    landmark: { type: String, trim: true, default: "" },
    city: { type: String, trim: true, default: "" },
    state: { type: String, trim: true, default: "" },
    pincode: { type: String, trim: true, default: "" },
    country: { type: String, trim: true, default: "" },
  },
  { _id: false }
);

const shiprocketOrderSchema = new mongoose.Schema(
  {
    orderId: { type: String, required: true, index: true },
    // The calendar day (YYYY-MM-DD) this order was fetched for. Lets us
    // query "give me everything for since→until" straight from Mongo
    // without re-hitting Shiprocket.
    orderDate: { type: String, required: true, index: true },

    // ── Ad attribution (from cart_data.custom_attributes) ──
    campaignId: { type: String, trim: true, default: "", index: true },
    campaignName: { type: String, trim: true, default: "" }, // utm_campaign
    utmCreative: { type: String, trim: true, default: "" },
    adsetId: { type: String, trim: true, default: "", index: true },
    adsetName: { type: String, trim: true, default: "" },
    adId: { type: String, trim: true, default: "", index: true },
    subid: { type: String, trim: true, default: "" },
    trackSource: { type: String, trim: true, default: "" },
    pixel: { type: String, trim: true, default: "" },
    ip: { type: String, trim: true, default: "" },

    // ── Order / customer info ──
    phone: { type: String, trim: true, default: "" },
    email: { type: String, trim: true, default: "" },
    address: { type: addressSchema, default: () => ({}) },
    paymentType: { type: String, trim: true, default: "", index: true }, // PREPAID / CASH_ON_DELIVERY
    paymentStatus: { type: String, trim: true, default: "" },
    cartId: { type: String, trim: true, default: "" },
    orderCreatedAt: { type: Date, default: null },

    // ── Price ──
    subtotalPrice: { type: Number, default: 0 }, // subtotal_price — before discount
    totalDiscount: { type: Number, default: 0 }, // total_discount
    totalAmountPayable: { type: Number, default: 0, index: true }, // total_amount_payable — actual amount paid

    raw: { type: Object, default: {} },
  },
  { timestamps: true }
);

// One record per order id — re-syncing a day upserts rather than duplicates
shiprocketOrderSchema.index({ orderId: 1 }, { unique: true });

export default mongoose.models.ShiprocketOrder ||
  mongoose.model("ShiprocketOrder", shiprocketOrderSchema);