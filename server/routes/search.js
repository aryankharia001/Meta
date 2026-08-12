import express from "express";
import ShiprocketOrder from "../models/shiprocketOrder.js";

const router = express.Router();

// ─────────────────────────────────────────────────────────────
// Phase 7 — Global Command Palette search. Entirely new, additive,
// read-only route (mounted at /api/search). Queries ShiprocketOrder
// directly (same collection every other read-only route already
// queries) — never writes, never touches sync/matching. Bounded result
// counts per category so a keystroke-driven search stays cheap even on
// a large collection.
// ─────────────────────────────────────────────────────────────

router.get("/", async (req, res) => {
  try {
    const q = (req.query.q || "").trim();
    if (q.length < 2) {
      return res.json({ success: true, orders: [], campaigns: [], customers: [] });
    }

    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(escaped, "i");

    // Orders — match on orderId or phone directly.
    const orderMatches = await ShiprocketOrder.find({
      $or: [{ orderId: re }, { phone: re }],
    })
      .select("orderId phone address totalAmountPayable orderCreatedAt")
      .sort({ orderCreatedAt: -1 })
      .limit(8)
      .lean();

    // Campaigns — distinct campaignName matching the query, from
    // whatever's actually been matched into stored orders (same source
    // of truth CampaignLink/CampaignDrawer already use).
    const campaignMatches = await ShiprocketOrder.aggregate([
      { $match: { campaignName: re } },
      { $group: { _id: { campaignId: "$campaignId", campaignName: "$campaignName" }, orders: { $sum: 1 } } },
      { $sort: { orders: -1 } },
      { $limit: 8 },
    ]);

    // Customers — distinct phone numbers whose name or number matches.
    const customerMatches = await ShiprocketOrder.aggregate([
      {
        $match: {
          $or: [{ phone: re }, { "address.firstName": re }, { "address.lastName": re }],
        },
      },
      {
        $group: {
          _id: "$phone",
          name: { $first: { $concat: [{ $ifNull: ["$address.firstName", ""] }, " ", { $ifNull: ["$address.lastName", ""] }] } },
          orders: { $sum: 1 },
        },
      },
      { $match: { _id: { $ne: null, $ne: "" } } },
      { $sort: { orders: -1 } },
      { $limit: 8 },
    ]);

    res.json({
      success: true,
      orders: orderMatches.map((o) => ({
        orderId: o.orderId,
        phone: o.phone || null,
        customerName: [o.address?.firstName, o.address?.lastName].filter(Boolean).join(" ").trim() || null,
        totalAmountPayable: o.totalAmountPayable,
        orderCreatedAt: o.orderCreatedAt,
      })),
      campaigns: campaignMatches.map((c) => ({ campaignId: c._id.campaignId || null, campaignName: c._id.campaignName, orders: c.orders })),
      customers: customerMatches.map((c) => ({ phone: c._id, name: (c.name || "").trim() || null, orders: c.orders })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
