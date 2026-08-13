import express from "express";
import Product from "../models/Product.js";
import { recordActivity } from "../lib/activityLog.js";

const router = express.Router();

// ─────────────────────────────────────────────────────────────
// Phase 16 §2 — Product cost setup. Entirely new, additive route file
// (mounted at /api/products), sitting behind the same global requireAuth
// gate every other /api route already has (Phase 14's
// app.use("/api", requireAuth) in index.js). Simple CRUD only — no
// order/campaign logic lives here; profitability.js is the only other
// file that ever reads this collection, and it does so read-only.
// ─────────────────────────────────────────────────────────────

function shape(p) {
  return {
    id: String(p._id),
    name: p.name,
    sku: p.sku || "",
    variantId: p.variantId || "",
    productCost: p.productCost || 0,
    packagingCost: p.packagingCost || 0,
    shippingCost: p.shippingCost || 0,
    otherCost: p.otherCost || 0,
    totalCostPerOrder:
      (p.productCost || 0) + (p.packagingCost || 0) + (p.shippingCost || 0) + (p.otherCost || 0),
    active: p.active !== false,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

router.get("/", async (req, res) => {
  try {
    const products = await Product.find({}).sort({ createdAt: -1 }).lean();
    res.json({ success: true, products: products.map(shape) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/", async (req, res) => {
  try {
    const { name, sku, variantId, productCost, packagingCost, shippingCost, otherCost } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ success: false, message: "Product name is required" });
    }
    const product = await Product.create({
      name: String(name).trim(),
      sku: (sku || "").trim(),
      variantId: (variantId || "").trim(),
      productCost: Number(productCost) || 0,
      packagingCost: Number(packagingCost) || 0,
      shippingCost: Number(shippingCost) || 0,
      otherCost: Number(otherCost) || 0,
    });

    await recordActivity({
      user: req.user?.email,
      type: "product_added",
      message: `Product added (${product.name})`,
      entityType: "product",
      entityId: String(product._id),
    });

    res.json({ success: true, product: shape(product) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ success: false, message: "Product not found" });

    const { name, sku, variantId, productCost, packagingCost, shippingCost, otherCost, active } = req.body || {};
    const skuChanged = sku !== undefined && (sku || "").trim() !== product.sku;

    if (name !== undefined) product.name = String(name).trim();
    if (sku !== undefined) product.sku = (sku || "").trim();
    if (variantId !== undefined) product.variantId = (variantId || "").trim();
    if (productCost !== undefined) product.productCost = Number(productCost) || 0;
    if (packagingCost !== undefined) product.packagingCost = Number(packagingCost) || 0;
    if (shippingCost !== undefined) product.shippingCost = Number(shippingCost) || 0;
    if (otherCost !== undefined) product.otherCost = Number(otherCost) || 0;
    if (typeof active === "boolean") product.active = active;
    await product.save();

    await recordActivity({
      user: req.user?.email,
      type: skuChanged ? "product_sku_changed" : "product_updated",
      message: skuChanged ? `SKU changed for product (${product.name})` : `Product updated (${product.name})`,
      entityType: "product",
      entityId: String(product._id),
    });

    res.json({ success: true, product: shape(product) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product) return res.status(404).json({ success: false, message: "Product not found" });

    await recordActivity({
      user: req.user?.email,
      type: "product_deleted",
      message: `Product deleted (${product.name})`,
      entityType: "product",
      entityId: String(product._id),
    });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
