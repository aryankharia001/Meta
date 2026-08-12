import express from "express";
import ShiprocketOrder from "../models/shiprocketOrder.js";
import Token from "../models/Token.js";
import AdAccount from "../models/AdAccount.js";

const router = express.Router();

// ─── Helpers ────────────────────────────────────────────────

async function fbGet(urlStr) {
  const res = await fetch(urlStr);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const msg = data.error?.message || `FB API error (${res.status})`;
    throw new Error(msg);
  }
  return data;
}

async function fetchAllPages(url) {
  const results = [];
  let next = url;
  while (next) {
    const data = await fbGet(next);
    results.push(...(data.data || []));
    next = data.paging?.next || null;
  }
  return results;
}

function pick(obj, ...keys) {
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return "";
}

function safeInt(v) {
  const n = parseInt(v, 10);
  return isNaN(n) ? null : n;
}

// ─── Try multiple endpoint strategies ───────────────────────

async function tryFetchCampaigns(base, actId, accessToken) {
  const campaignFields = [
    "id", "name", "objective", "status", "effective_status", "buying_type",
    "daily_budget", "lifetime_budget", "spend_cap",
    "start_time", "stop_time", "updated_time",
  ].join(",");

  // Strategy 1: /act_xxx/campaigns (System User token)
  try {
    const raw = await fetchAllPages(
      `${base}/campaigns?fields=${encodeURIComponent(campaignFields)}&limit=100&access_token=${accessToken}`
    );
    if (raw.length > 0) return { campaigns: raw, strategy: "act" };
  } catch (err) {
    console.log(`Strategy 1 (act_xxx) failed: ${err.message}`);
  }

  // Strategy 2: /me/campaigns (regular user token with ads_read)
  try {
    const raw = await fetchAllPages(
      `https://graph.facebook.com/v19.0/me/campaigns?fields=${encodeURIComponent(campaignFields)}&limit=100&access_token=${accessToken}`
    );
    if (raw.length > 0) return { campaigns: raw, strategy: "me" };
  } catch (err) {
    console.log(`Strategy 2 (me/campaigns) failed: ${err.message}`);
  }

  // Strategy 3: Search campaigns directly
  try {
    const raw = await fetchAllPages(
      `https://graph.facebook.com/v19.0/search?type=adcampaign&limit=100&fields=${encodeURIComponent(campaignFields)}&access_token=${accessToken}`
    );
    if (raw.length > 0) return { campaigns: raw, strategy: "search" };
  } catch (err) {
    console.log(`Strategy 3 (search) failed: ${err.message}`);
  }

  return { campaigns: [], strategy: null };
}




function isActiveInRange(campaign, rangeStartUtc, rangeEndUtc) {
  const start = campaign.startTime ? new Date(campaign.startTime) : null;
  const stop = campaign.stopTime ? new Date(campaign.stopTime) : null;
  if (rangeEndUtc && start && !isNaN(start.getTime()) && start > rangeEndUtc) return false; // starts after the range ends
  if (rangeStartUtc && stop && !isNaN(stop.getTime()) && stop < rangeStartUtc) return false; // stopped before the range starts
  return true;
}


router.get("/:tokenId/date-range", async (req, res) => {
  try {
    const { adAccountId, since, until } = req.query;

    if (!adAccountId)
      return res.status(400).json({
        success: false,
        message: "adAccountId is required",
      });

    if (!since || !until)
      return res.status(400).json({
        success: false,
        message: "since and until are required (YYYY-MM-DD)",
      });

    const token = await Token.findById(req.params.tokenId).lean();

    if (!token) {
      return res.status(404).json({
        success: false,
        message: "Token not found",
      });
    }

    const actId = adAccountId.startsWith("act_")
      ? adAccountId
      : `act_${adAccountId}`;

    const fields = [
      "campaign_id",
      "campaign_name",
      "spend",
      "impressions",
      "reach",
      "clicks",
      "ctr",
      "cpc",
      "cpm",
      "frequency",
      "actions",
      "purchase_roas"
    ].join(",");

    const url =
    `https://graph.facebook.com/v19.0/${actId}/insights` +
    `?level=campaign` +
    `&fields=${encodeURIComponent(fields)}` +
    `&time_range=${encodeURIComponent(
    JSON.stringify({
      since,
      until
    })
    )}` +
    `&time_increment=1` +
    `&limit=500` +
    `&access_token=${token.accessToken}`;

    const data = await fbGet(url);

    res.json({
      success: true,
      since,
      until,
      campaigns: data.data || [],
    });
  } catch (err) {
    console.log("err : ", err)
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});






const normalizeCampaignName = (name) => {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
};

router.get("/:tokenId/compare", async (req, res) => {
  try {
    const { tokenId } = req.params;
    const { since, until } = req.query;

    if (!since || !until) {
      return res.status(400).json({
        success: false,
        message: "since and until are required",
      });
    }

    //-------------------------------------------------------
    // Token
    //-------------------------------------------------------

    const token = await Token.findById(tokenId).lean();

    if (!token) {
      return res.status(404).json({
        success: false,
        message: "Token not found",
      });
    }

    //-------------------------------------------------------
    // Selected Accounts
    //-------------------------------------------------------

    let accountIds = req.query.adAccountId;

    if (!accountIds) {
      return res.status(400).json({
        success: false,
        message: "adAccountId is required",
      });
    }

    if (!Array.isArray(accountIds)) {
      accountIds = [accountIds];
    }

    //-------------------------------------------------------
    // Select All
    //-------------------------------------------------------

    if (accountIds.includes("all")) {
      const accounts = await AdAccount.find({
        tokenId,
      }).lean();

      accountIds = accounts.map((a) => a.adAccountId);
    }

    //-------------------------------------------------------
    // Fetch FB Campaigns
    //-------------------------------------------------------

    let fbCampaigns = [];

    const fields = [
      "campaign_id",
      "campaign_name",
      "spend",
      "impressions",
      "reach",
      "clicks",
      "ctr",
      "cpc",
      "cpm",
      "frequency",
      "actions",
      "purchase_roas",
    ].join(",");

    for (const accountId of accountIds) {
      const actId = accountId.startsWith("act_")
        ? accountId
        : `act_${accountId}`;

      const url =
        `https://graph.facebook.com/v19.0/${actId}/insights` +
        `?level=campaign` +
        `&fields=${encodeURIComponent(fields)}` +
        `&time_range=${encodeURIComponent(
          JSON.stringify({
            since,
            until,
          })
        )}` +
        `&time_increment=all_days` +
        `&limit=500` +
        `&access_token=${token.accessToken}`;

      const data = await fbGet(url);

      (data.data || []).forEach((campaign) => {
        fbCampaigns.push({
          ...campaign,
          accountId,
        });
      });
    }

    //-------------------------------------------------------
    // Orders
    //-------------------------------------------------------

    const orders = await ShiprocketOrder.find({
      orderDate: {
        $gte: since,
        $lte: until,
      },
    })
      .select(
        `
        orderId
        orderDate
        campaignId
        campaignName
        totalAmountPayable
        paymentType
        paymentStatus
        orderCreatedAt
      `
      )
      .lean();

    //-------------------------------------------------------
    // Campaign -> Orders Map
    //-------------------------------------------------------

    const orderMap = {};

for (const order of orders) {

  const campaignName =
    normalizeCampaignName(
      order.campaignName
    );

  if (!campaignName)
    continue;

  if (!orderMap[campaignName]) {
    orderMap[campaignName] = [];
  }

  orderMap[campaignName].push(order);
}


const matchedCampaignNames = new Set();

    //-------------------------------------------------------
    // Merge FB + Orders
    //-------------------------------------------------------

    let totalSpend = 0;
    let totalRevenue = 0;
    let totalClicks = 0;
    let totalImpressions = 0;

    const campaigns = fbCampaigns.map((campaign) => {
      const campaignId = String(campaign.campaign_id || "");
      const normalizedName =
  normalizeCampaignName(
    campaign.campaign_name
  );

const campaignOrders =
  orderMap[normalizedName] || [];

if (campaignOrders.length) {
  matchedCampaignNames.add(normalizedName);
}

      const spend = Number(campaign.spend || 0);

      const clicks = Number(campaign.clicks || 0);

      const impressions = Number(
        campaign.impressions || 0
      );

      const revenue = campaignOrders.reduce(
        (sum, order) =>
          sum + Number(order.totalAmountPayable || 0),
        0
      );

      totalSpend += spend;
      totalRevenue += revenue;
      totalClicks += clicks;
      totalImpressions += impressions;

      return {
        accountId: campaign.accountId,

        campaignId,

        campaignName:
          campaign.campaign_name,

        spend,

        impressions,

        reach: Number(
          campaign.reach || 0
        ),

        clicks,

        ctr: Number(
          campaign.ctr || 0
        ),

        cpc: Number(
          campaign.cpc || 0
        ),

        cpm: Number(
          campaign.cpm || 0
        ),

        frequency: Number(
          campaign.frequency || 0
        ),

        orders:
          campaignOrders.length,

        revenue,

        costPerOrder:
          campaignOrders.length
            ? spend /
              campaignOrders.length
            : 0,

        roas:
          spend
            ? revenue / spend
            : 0,

        conversionRate:
          clicks
            ? (
                (campaignOrders.length /
                  clicks) *
                100
              ).toFixed(2)
            : 0,

        revenuePerClick:
          clicks
            ? revenue / clicks
            : 0,

        orderList: campaignOrders,
      };
    });


    //-------------------------------------------------------
// Unmatched Orders
//-------------------------------------------------------

const unmatchedOrders = orders.filter((order) => {
  const normalized = normalizeCampaignName(
    order.campaignName
  );

  return !matchedCampaignNames.has(normalized);
});

    //-------------------------------------------------------
    // Sort
    //-------------------------------------------------------

    campaigns.sort(
      (a, b) => b.spend - a.spend
    );

    //-------------------------------------------------------
    // Response
    //-------------------------------------------------------

    res.json({
  success: true,

  since,
  until,

  summary: {
    totalSpend,

    totalRevenue,

    totalOrders: orders.length,

    totalCampaigns:
      campaigns.length,

    totalClicks,

    totalImpressions,

    averageROAS:
      totalSpend
        ? totalRevenue /
          totalSpend
        : 0,
  },

  campaigns,

  unmatchedOrders: unmatchedOrders.map((order) => ({
    orderId: order.orderId,
    campaignId: order.campaignId,
    campaignName: order.campaignName,
    orderDate: order.orderDate,
    totalAmountPayable: order.totalAmountPayable,
    paymentType: order.paymentType,
    paymentStatus: order.paymentStatus,
    orderCreatedAt: order.orderCreatedAt,
  })),
});
  } catch (err) {
    console.error(err);

    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});


// ─────────────────────────────────────────────────────────────
// Phase 2 — Campaign Details (drawer)
// ─────────────────────────────────────────────────────────────
//
// Purely additive: nothing above this line is touched. Does not change
// /compare, /date-range, or how campaigns/orders get matched — it just
// exposes a lazy, on-demand, single-campaign view of the same data,
// fetched only when a campaign is opened in the UI (see
// campaignDetailsCache.js on the client, which skips this request
// entirely on a cache hit).
//
// Orders are matched using the exact same normalizeCampaignName
// comparison /compare already uses above, so the order list returned
// here is always identical to what /compare's orderList already
// contains for this campaign — just fetched on its own instead of
// eagerly for every campaign on every page load.

function findActionValue(list, types) {
  if (!Array.isArray(list)) return null;
  for (const type of types) {
    const hit = list.find((a) => a.action_type === type);
    if (hit && hit.value !== undefined) return Number(hit.value);
  }
  return null;
}

// Shiprocket's raw order payload shape for product lines / courier /
// shipment status isn't unpacked anywhere else in this codebase (the
// `raw` field is stored as-is — see extractOrderFields in
// shiprocketService.js, which never reads these). Rather than guess
// wrong, we defensively probe a handful of plausible field names and
// fall back to null (rendered as "N/A" client-side) instead of showing
// something misleading.
function extractProducts(raw) {
  const items =
    raw?.cart_data?.line_items || raw?.line_items || raw?.products || raw?.items || raw?.cart_data?.products;
  if (!Array.isArray(items) || items.length === 0) return null;
  const names = items.map((i) => i?.name || i?.product_name || i?.title).filter(Boolean);
  return names.length ? names.join(", ") : null;
}

// Phase 10 — total unit count across an order's line items, for the
// Matched/Unmatched popups' "Quantity" column. Additive companion to
// extractProducts() above (same field probing, just summing quantity
// instead of joining names) — doesn't change what extractProducts
// returns or how any existing caller uses it.
function extractProductQuantity(raw) {
  const items =
    raw?.cart_data?.line_items || raw?.line_items || raw?.products || raw?.items || raw?.cart_data?.products;
  if (!Array.isArray(items) || items.length === 0) return null;
  return items.reduce((sum, i) => {
    const qty = i?.quantity != null ? Number(i.quantity) : i?.qty != null ? Number(i.qty) : 1;
    return sum + (isNaN(qty) ? 1 : qty);
  }, 0);
}

function extractCourier(raw) {
  return raw?.courier_name || raw?.courier || raw?.shipment?.courier_name || raw?.shipments?.[0]?.courier_name || null;
}

function extractOrderStatus(raw) {
  return raw?.order_status || raw?.status || null;
}

function extractDeliveryStatus(raw) {
  return (
    raw?.shipment_status ||
    raw?.delivery_status ||
    raw?.current_status ||
    raw?.shipments?.[0]?.status ||
    raw?.shipments?.[0]?.delivery_status ||
    null
  );
}

function shapeOrderForDrawer(o) {
  const customerName = [o.address?.firstName, o.address?.lastName].filter(Boolean).join(" ").trim();
  return {
    orderId: o.orderId,
    orderDate: o.orderDate,
    campaignId: o.campaignId,
    campaignName: o.campaignName,
    totalAmountPayable: o.totalAmountPayable,
    paymentType: o.paymentType,
    paymentStatus: o.paymentStatus,
    orderCreatedAt: o.orderCreatedAt,
    phone: o.phone || null,
    customerName: customerName || null,
    city: o.address?.city || null,
    state: o.address?.state || null,
    product: extractProducts(o.raw),
    productQuantity: extractProductQuantity(o.raw),
    courier: extractCourier(o.raw),
    orderStatus: extractOrderStatus(o.raw),
    deliveryStatus: extractDeliveryStatus(o.raw),
  };
}

router.get("/:tokenId/:campaignId/details", async (req, res) => {
  try {
    const { tokenId, campaignId } = req.params;
    const { campaignName, accountId, since, until } = req.query;

    if (!campaignName) {
      return res.status(400).json({ success: false, message: "campaignName is required" });
    }
    if (!since || !until) {
      return res.status(400).json({ success: false, message: "since and until are required" });
    }

    const token = await Token.findById(tokenId).lean();
    if (!token) {
      return res.status(404).json({ success: false, message: "Token not found" });
    }

    // Campaign metadata (status/objective/buying type/dates) — a separate
    // Graph API call from the insights fields /compare fetches, since
    // /compare never asks for these.
    const metaFields = [
      "id",
      "name",
      "objective",
      "status",
      "effective_status",
      "buying_type",
      "start_time",
      "stop_time",
      "created_time",
      "updated_time",
    ].join(",");

    let campaignMeta = null;
    try {
      campaignMeta = await fbGet(
        `https://graph.facebook.com/v19.0/${campaignId}?fields=${encodeURIComponent(metaFields)}&access_token=${token.accessToken}`
      );
    } catch (err) {
      console.log(`Campaign meta fetch failed for ${campaignId}: ${err.message}`);
    }

    // Expanded insights for the "Meta Performance" section — same
    // time_range/time_increment convention /compare uses above, just a
    // wider field list and scoped directly to this campaign node instead
    // of the ad account.
    const insightFields = [
      "spend",
      "reach",
      "impressions",
      "cpm",
      "cpc",
      "ctr",
      "clicks",
      "inline_link_clicks",
      "actions",
      "action_values",
      "cost_per_action_type",
      "frequency",
      "purchase_roas",
    ].join(",");

    let metaInsights = null;
    try {
      const insightsUrl =
        `https://graph.facebook.com/v19.0/${campaignId}/insights` +
        `?fields=${encodeURIComponent(insightFields)}` +
        `&time_range=${encodeURIComponent(JSON.stringify({ since, until }))}` +
        `&time_increment=all_days` +
        `&access_token=${token.accessToken}`;
      const insightsData = await fbGet(insightsUrl);
      const row = (insightsData.data || [])[0] || null;

      if (row) {
        metaInsights = {
          spend: row.spend != null ? Number(row.spend) : null,
          reach: row.reach != null ? Number(row.reach) : null,
          impressions: row.impressions != null ? Number(row.impressions) : null,
          cpm: row.cpm != null ? Number(row.cpm) : null,
          cpc: row.cpc != null ? Number(row.cpc) : null,
          ctr: row.ctr != null ? Number(row.ctr) : null,
          clicks: row.clicks != null ? Number(row.clicks) : null,
          linkClicks: row.inline_link_clicks != null ? Number(row.inline_link_clicks) : null,
          landingPageViews: findActionValue(row.actions, ["landing_page_view"]),
          purchases: findActionValue(row.actions, ["purchase", "omni_purchase"]),
          purchaseValue: findActionValue(row.action_values, ["purchase", "omni_purchase"]),
          costPerPurchase: findActionValue(row.cost_per_action_type, ["purchase", "omni_purchase"]),
          frequency: row.frequency != null ? Number(row.frequency) : null,
          purchaseRoas: findActionValue(row.purchase_roas, ["omni_purchase", "purchase"]),
        };
      }
    } catch (err) {
      console.log(`Campaign insights fetch failed for ${campaignId}: ${err.message}`);
    }

    // Orders — identical matching rule to /compare (normalized campaign
    // name), just scoped to a single campaign and fetched lazily.
    const normalizedTarget = normalizeCampaignName(campaignName);

    const rawOrders = await ShiprocketOrder.find({
      orderDate: { $gte: since, $lte: until },
    })
      .select(
        "orderId orderDate campaignId campaignName totalAmountPayable paymentType paymentStatus orderCreatedAt phone address raw"
      )
      .lean();

    const orders = rawOrders
      .filter((o) => normalizeCampaignName(o.campaignName) === normalizedTarget)
      .map(shapeOrderForDrawer)
      .sort((a, b) => new Date(b.orderCreatedAt || 0) - new Date(a.orderCreatedAt || 0));

    res.json({
      success: true,
      campaign: {
        id: campaignId,
        name: campaignMeta?.name || campaignName,
        objective: campaignMeta?.objective || null,
        status: campaignMeta?.status || null,
        effectiveStatus: campaignMeta?.effective_status || null,
        buyingType: campaignMeta?.buying_type || null,
        startTime: campaignMeta?.start_time || null,
        stopTime: campaignMeta?.stop_time || null,
        createdTime: campaignMeta?.created_time || null,
        updatedTime: campaignMeta?.updated_time || null,
        accountId: accountId || null,
        metaAvailable: !!campaignMeta,
      },
      metaInsights,
      orders,
      since,
      until,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// Phase 3 — Orders Detailed + Known Campaign Names (dashboard popups)
// ─────────────────────────────────────────────────────────────
//
// Purely additive, same rules as the Phase 2 section above: /compare and
// the matching logic are never touched. This backs the dashboard's KPI
// popups (Total Orders, Unmatched, Outside Range, COD, Prepaid, delivery
// status, ...) with two things /compare doesn't provide:
//
//   1. Every order in range, enriched with the same customer/phone/
//      courier/status fields the Phase 2 campaign drawer already shapes
//      (shapeOrderForDrawer, reused as-is — not redefined here).
//
//   2. The full set of campaign names that exist for the selected ad
//      accounts, regardless of date range — via tryFetchCampaigns, which
//      has been sitting in this file since before Phase 1 but was never
//      actually called by any route. This is what lets the client tell
//      "Orders Outside Selected Campaign Date Range" (a real Meta
//      campaign, just with no spend in the current range) apart from
//      "Unmatched Orders" (no matching campaign at all) — see the
//      classification logic in Dashboard.jsx, which does this split
//      client-side using data it already has from /compare, so nothing
//      here needs to re-fetch insights.
router.get("/:tokenId/orders-detailed", async (req, res) => {
  try {
    const { tokenId } = req.params;
    const { since, until } = req.query;

    if (!since || !until) {
      return res.status(400).json({ success: false, message: "since and until are required" });
    }

    const token = await Token.findById(tokenId).lean();
    if (!token) {
      return res.status(404).json({ success: false, message: "Token not found" });
    }

    let accountIds = req.query.adAccountId;
    if (accountIds && !Array.isArray(accountIds)) accountIds = [accountIds];

    if (accountIds?.includes("all")) {
      const accounts = await AdAccount.find({ tokenId }).lean();
      accountIds = accounts.map((a) => a.adAccountId);
    }

    // Every order in range, enriched — matches what the Phase 2 campaign
    // drawer already shows, just not scoped to a single campaign here.
    const rawOrders = await ShiprocketOrder.find({
      orderDate: { $gte: since, $lte: until },
    })
      .select(
        "orderId orderDate campaignId campaignName totalAmountPayable paymentType paymentStatus orderCreatedAt phone address raw"
      )
      .lean();

    const orders = rawOrders.map(shapeOrderForDrawer);

    // All campaign names for the selected accounts, any time range.
    const knownNames = new Set();
    for (const accountId of accountIds || []) {
      const actId = accountId.startsWith("act_") ? accountId : `act_${accountId}`;
      try {
        const { campaigns: allCampaigns } = await tryFetchCampaigns(
          `https://graph.facebook.com/v19.0/${actId}`,
          actId,
          token.accessToken
        );
        allCampaigns.forEach((c) => {
          const name = normalizeCampaignName(c.name);
          if (name) knownNames.add(name);
        });
      } catch (err) {
        console.log(`Known-campaign fetch failed for ${accountId}: ${err.message}`);
      }
    }

    res.json({
      success: true,
      since,
      until,
      orders,
      knownCampaignNames: [...knownNames],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
