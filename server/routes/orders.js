import express from "express";
import Order from "../models/shiprocketOrder.js";
import Token from "../models/Token.js";
import { todayIstIso } from "../utils/dateIst.js";

const router = express.Router();

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

// Hour-of-day (0-23) that a UTC Date instant falls into on the IST clock.
function istHourOf(date) {
  const ist = new Date(date.getTime() + IST_OFFSET_MS);
  return ist.getUTCHours();
}


router.get("/orders", async (req, res) => {
  try {
    const { since, until } = req.query;

    if (!since || !until) {
      return res.status(400).json({
        success: false,
        message: "since and until are required (YYYY-MM-DD)",
      });
    }

    const orders = await Order.find({
      orderDate: {
        $gte: since,
        $lte: until,
      },
    })
      .select(
        "orderId orderDate campaignId campaignName totalAmountPayable paymentType paymentStatus orderCreatedAt"
      )
      .sort({ orderCreatedAt: -1 })
      .lean();

    const totalOrders = orders.length;

    const totalPayout = orders.reduce(
      (sum, order) => sum + (order.totalAmountPayable || 0),
      0
    );

    const campaignMap = {};

    orders.forEach((order) => {
      const campaignName =
        order.campaignName?.trim() || "Unknown Campaign";

      if (!campaignMap[campaignName]) {
        campaignMap[campaignName] = {
          campaignId: order.campaignId,
          campaignName,
          totalOrders: 0,
          totalPayout: 0,
          orders: [],
        };
      }

      campaignMap[campaignName].totalOrders += 1;
      campaignMap[campaignName].totalPayout +=
        order.totalAmountPayable || 0;

      campaignMap[campaignName].orders.push({
        orderId: order.orderId,
        orderDate: order.orderDate,
        totalAmountPayable: order.totalAmountPayable,
        paymentType: order.paymentType,
        paymentStatus: order.paymentStatus,
        orderCreatedAt: order.orderCreatedAt,
      });
    });

    const campaigns = Object.values(campaignMap).sort(
      (a, b) => b.totalOrders - a.totalOrders
    );

    res.json({
      success: true,
      since,
      until,
      totalOrders,
      totalPayout,
      totalCampaigns: campaigns.length,
      campaigns,
    });
  } catch (err) {
    console.log(err)
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

// ─── GET /api/orders/live-tracking ───────────────────────────
//
// "Live tracking" here means live ORDER-VOLUME tracking (orders placed
// 1h/2h/3h ago, and an hour-by-hour breakdown of today) — not
// courier/shipment status. Shiprocket's courier-tracking API needs a
// separate email/password login that isn't available, so this deliberately
// only reads orders already pulled in by the existing 30-min auto-sync
// (backfillShiprocketRange / shiprocketCron.js) — it never calls
// Shiprocket itself, same as the other read-path endpoints.
router.get("/live-tracking", async (req, res) => {
  try {
    // Backward compatible: `date` alone still means a single day. `since`/
    // `until` (used by the Today/Yesterday/7 Days/30 Days presets on the
    // Live Tracking page) scope it to a range instead — the hourly
    // breakdown then becomes "which hour of the day do orders tend to land
    // in, across every day in the range" rather than a single day's hours.
    const since = req.query.since || req.query.date || todayIstIso();
    const until = req.query.until || req.query.date || since;

    // `createdAt` (the Mongo doc's own insert timestamp, always present —
    // it's a `timestamps: true` field) is selected as a fallback for the
    // handful of orders where Shiprocket didn't send order_created_date, so
    // every order lands in a real, distinct hour bucket instead of being
    // silently dropped (which previously made hour buckets look wrong/flat).
    const orders = await Order.find({ orderDate: { $gte: since, $lte: until } })
      .select("orderCreatedAt createdAt totalAmountPayable paymentType campaignName")
      .lean();

    const now = new Date();

    // Each order's best-available "when was this actually placed" instant.
    const orderTimestamp = (o) => {
      const t = o.orderCreatedAt || o.createdAt;
      return t ? new Date(t) : null;
    };

    // Hourly breakdown (IST hour-of-day, 0-23) — computed per order from its
    // own exact timestamp, not from the day-level `orderDate` field. The
    // `orderDate` query above only narrows down WHICH day we're looking at;
    // every order within that day is bucketed individually by its own hour.
    const hourly = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      orderCount: 0,
      revenue: 0,
    }));

    let missingTimestampCount = 0;

    orders.forEach((o) => {
      const ts = orderTimestamp(o);
      if (!ts || isNaN(ts.getTime())) {
        missingTimestampCount += 1;
        return;
      }
      const hour = istHourOf(ts);
      hourly[hour].orderCount += 1;
      hourly[hour].revenue += o.totalAmountPayable || 0;
    });
    hourly.forEach((h) => (h.revenue = Math.round(h.revenue * 100) / 100));

    // Rolling "N hours ago" windows, based on actual elapsed time from now
    // (not calendar buckets) — e.g. last1h = orders placed in the last 60
    // real minutes, regardless of what date they fall on. Same per-order
    // timestamp as the hourly breakdown above, so the two stay consistent.
    const windowStats = (hoursAgo) => {
      const since = new Date(now.getTime() - hoursAgo * 60 * 60 * 1000);
      const inWindow = orders.filter((o) => {
        const ts = orderTimestamp(o);
        return ts && !isNaN(ts.getTime()) && ts >= since && ts <= now;
      });
      const revenue = inWindow.reduce((sum, o) => sum + (o.totalAmountPayable || 0), 0);
      return { orderCount: inWindow.length, revenue: Math.round(revenue * 100) / 100 };
    };

    const totalRevenueToday =
      Math.round(orders.reduce((sum, o) => sum + (o.totalAmountPayable || 0), 0) * 100) / 100;

    res.json({
      success: true,
      date: since === until ? since : undefined,
      since,
      until,
      generatedAt: now,
      currentHourIst: istHourOf(now),
      totalOrders: orders.length,
      totalRevenue: totalRevenueToday,
      missingTimestampCount,
      recent: {
        last1h: windowStats(1),
        last2h: windowStats(2),
        last3h: windowStats(3),
        last6h: windowStats(6),
      },
      hourly,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;