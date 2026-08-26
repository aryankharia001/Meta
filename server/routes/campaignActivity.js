import express from "express";
import { buildActivityTimeline, getActivitySnapshot } from "../lib/campaignActivity.js";

const router = express.Router();

// ─────────────────────────────────────────────────────────────
// Phase 39 §5/§6 — Campaign Activity History. Entirely new, additive
// route file (mounted at /api/campaign-activity). Backs the Campaign
// Drawer's new "Activity History" timeline + "Active/Inactive Summary"
// sections.
//
// Read-only, pure DB reads (CampaignStatusHistory/BudgetHistory/
// BidCapHistory via campaignActivity.js) — no Meta Graph API calls, so
// opening this section of the drawer is cheap no matter how many times
// it's opened. All the actual writing (baseline seeding + status-change
// recording) happens elsewhere: services/metaEntitySync.js's
// reconcileEntity() (cron ticks + Budget/Bid Cap control actions) and
// the list-endpoint ensureBaseline()/ensureBaselinesBulk() calls in
// routes/campaigns.js and routes/campaignExplorer.js. Nothing here
// writes anything.
//
// The order-attribution numbers (Active/Post-Campaign/Inactive orders
// & revenue, Primary ROAS) are NOT served from here — they're additive
// fields returned directly by the existing /campaigns/:tokenId/compare,
// /campaigns/:tokenId/:campaignId/details, and /campaign-explorer/:tokenId
// endpoints (see campaignActivity.js's classifyOrders()/
// computePrimaryRoas()), since those endpoints already have the matched
// orders and Meta spend figure in hand and re-fetching them here would
// mean a second, redundant round trip for every page that needs them.
// This route only serves what those don't already carry: the full
// event list and period breakdown for the drawer's timeline visual.
// ─────────────────────────────────────────────────────────────

router.get("/:tokenId/:campaignId/timeline", async (req, res) => {
  try {
    const { tokenId, campaignId } = req.params;
    const { since, until } = req.query;

    const [events, snapshot] = await Promise.all([
      buildActivityTimeline({ tokenId, entityId: campaignId, since, until }),
      getActivitySnapshot({ tokenId, entityId: campaignId }),
    ]);

    res.json({
      success: true,
      events,
      periods: snapshot.periods,
      summary: {
        available: snapshot.available,
        currentBucket: snapshot.currentBucket,
        campaignStart: snapshot.campaignStart,
        campaignEnd: snapshot.campaignEnd,
        historicalDataAvailableFrom: snapshot.historicalDataAvailableFrom,
        activeMs: snapshot.activeMs,
        inactiveMs: snapshot.inactiveMs,
        activeLabel: snapshot.activeLabel,
        inactiveLabel: snapshot.inactiveLabel,
        activePeriods: snapshot.activePeriods,
        inactivePeriods: snapshot.inactivePeriods,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

export default router;
