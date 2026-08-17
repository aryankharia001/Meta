import mongoose from "mongoose";

// ─────────────────────────────────────────────────────────────
// Phase 16 §2 — product cost configuration. Entirely new, additive
// model. Never touched by the Meta<->Shiprocket sync/matching path —
// ShiprocketOrder documents are never written here or read by anything
// else in this file's own CRUD route; only profitability.js reads this
// collection (to look up a per-unit cost by SKU) and it does so
// read-only.
//
// `sku` is the join key against an order's line-item SKU (see
// analytics.js/orderDetails.js's extractProductLines — the same
// `sku || product_sku || variant_sku` probing profitability.js reuses).
// Total cost per order is deliberately NOT stored here — §2 explicitly
// says "do not manually enter the total" — it's always derived as
// productCost + packagingCost + shippingCost + otherCost, computed on
// read (see the schema virtual below and profitability.js).
// ─────────────────────────────────────────────────────────────

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    sku: { type: String, trim: true, default: "", index: true },
    variantId: { type: String, trim: true, default: "" },
    // Phase 18 §1/§2 — Shopify/Shiprocket-style parent "product id",
    // distinct from `variantId` (a variant is one SKU/size/color under a
    // product; the product id is shared across all of a product's
    // variants). Additive field — existing docs default to "" via
    // Mongoose, no migration needed. Used as the third-priority match
    // tier in profitability.js (variantId -> sku -> productId -> name).
    productId: { type: String, trim: true, default: "" },
    productCost: { type: Number, default: 0, min: 0 },
    packagingCost: { type: Number, default: 0, min: 0 },
    shippingCost: { type: Number, default: 0, min: 0 },
    otherCost: { type: Number, default: 0, min: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

productSchema.virtual("totalCostPerOrder").get(function () {
  return (
    (this.productCost || 0) + (this.packagingCost || 0) + (this.shippingCost || 0) + (this.otherCost || 0)
  );
});

export default mongoose.models.Product || mongoose.model("Product", productSchema);
