import express from "express";
import ShiprocketOrder from "../models/shiprocketorder.js";

const router = express.Router();

// ─────────────────────────────────────────────────────────────
// Phase 7 — Customer Drawer backend. Entirely new, additive, read-only
// route (mounted at /api/customers). There's no separate Customer
// collection anywhere in this app — "a customer" has always meant "a
// phone number" (same identifier Phase 4's customerHistory and Phase
// 6's Customer Analytics already use) — this just gives that same
// phone-scoped order query its own standalone endpoint so a customer
// profile can be opened directly (from Analytics, the command palette,
// or Favorites) without already having a specific order open first.
// ─────────────────────────────────────────────────────────────

router.get("/:phone", async (req, res) => {
  try {
    const { phone } = req.params;
    if (!phone) {
      return res.status(400).json({ success: false, message: "phone is required" });
    }

    const orders = await ShiprocketOrder.find({ phone })
      .select("orderId orderDate campaignId campaignName totalAmountPayable paymentType paymentStatus orderCreatedAt address")
      .sort({ orderCreatedAt: -1 })
      .lean();

    if (orders.length === 0) {
      return res.status(404).json({ success: false, message: "No orders found for this phone number" });
    }

    const first = orders[0];
    const name = [first.address?.firstName, first.address?.lastName].filter(Boolean).join(" ").trim() || null;
    const totalRevenue = orders.reduce((s, o) => s + Number(o.totalAmountPayable || 0), 0);

    res.json({
      success: true,
      customer: {
        phone,
        name,
        city: first.address?.city || null,
        state: first.address?.state || null,
        totalOrders: orders.length,
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        firstOrderDate: orders[orders.length - 1]?.orderDate || null,
        lastOrderDate: orders[0]?.orderDate || null,
      },
      orders: orders.map((o) => ({
        orderId: o.orderId,
        orderDate: o.orderDate,
        orderCreatedAt: o.orderCreatedAt,
        campaignId: o.campaignId || null,
        campaignName: o.campaignName || null,
        totalAmountPayable: o.totalAmountPayable,
        paymentType: o.paymentType || null,
        paymentStatus: o.paymentStatus || null,
        city: o.address?.city || null,
        state: o.address?.state || null,
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
