// routes/orderCosts.route.js

import express from "express";
import OrderCosts from "../models/OrderCosts.js";

const router = express.Router();

// GET /api/order-costs
router.get("/order-costs", async (req, res) => {
  try {
    const doc = await OrderCosts.findOne({ key: "default" }).lean();

    res.json({
      manufacturing: Number(doc?.manufacturing) || 0,
      shipping: Number(doc?.shipping) || 0,
      packaging: Number(doc?.packaging) || 0,
      misc: Number(doc?.misc) || 0,
    });
  } catch (err) {
    console.error("GET /order-costs failed:", err);

    res.status(500).json({
      error: "Failed to load order costs",
    });
  }
});

export default router;