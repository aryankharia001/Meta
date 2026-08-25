import express from "express";
import ShiprocketOrder from "../models/shiprocketorder.js";
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

// Phase 11 — UI/display-only helper. Meta returns daily_budget/
// lifetime_budget in the ad account's currency's minor unit (paise for
// INR, cents for USD, etc.) — divide by 100 to get the actual currency
// amount shown to users. Never touches spend/revenue/ROAS math above;
// purely additive metadata for the Budget column/badge the UI now
// shows next to Campaign Name and Spend.
function deriveBudget(meta) {
  if (!meta) return { budget: null, budgetType: null };
  if (meta.daily_budget !== undefined && meta.daily_budget !== null && meta.daily_budget !== "") {
    return { budget: Number(meta.daily_budget) / 100, budgetType: "daily" };
  }
  if (meta.lifetime_budget !== undefined && meta.lifetime_budget !== null && meta.lifetime_budget !== "") {
    return { budget: Number(meta.lifetime_budget) / 100, budgetType: "lifetime" };
  }
  return { budget: null, budgetType: null };
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

    // Phase 11 — campaign_id -> { budget, budgetType, status, effectiveStatus },
    // from a lightweight metadata-only call alongside the insights call
    // already made per account below. Additive only: never read by the
    // spend/revenue/ROAS/matching logic in this route, purely for the
    // Budget column and the live "● LIVE" indicator the UI now shows
    // next to Campaign Name.
    const metaByCampaignId = new Map();

    // Phase 36 §4 — Campaign Budget Fallback. campaign_id -> { dailyTotal,
    // lifetimeTotal, hasDaily, hasLifetime }, built ONLY for campaigns whose
    // own daily_budget/lifetime_budget came back null/absent above (i.e.
    // Advantage+/CBO-off campaigns using Ad Set-level budgets instead) — see
    // the per-account block below. A campaign that already has a genuine
    // Meta-reported budget never needs this and never triggers the extra
    // fetch, so accounts where every campaign already has its own budget
    // pay zero extra Graph API cost. When it IS needed, it's ONE bulk
    // /adsets call per account (paginated), never one call per campaign —
    // same "bulk, not per-item" principle Phase 35's phone-match batching
    // already established.
    const adSetBudgetByCampaignId = new Map();

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

      const metaUrl =
        `https://graph.facebook.com/v19.0/${actId}/campaigns` +
        `?fields=${encodeURIComponent("id,daily_budget,lifetime_budget,status,effective_status")}&limit=200&access_token=${token.accessToken}`;

      const [data, metaData] = await Promise.all([
        fbGet(url),
        fetchAllPages(metaUrl).catch((err) => {
          console.log(`Budget/status metadata fetch failed for ${actId}: ${err.message}`);
          return [];
        }),
      ]);

      metaData.forEach((c) => {
        metaByCampaignId.set(String(c.id), {
          ...deriveBudget(c),
          status: c.status || null,
          effectiveStatus: c.effective_status || null,
        });
      });

      // Phase 36 §4 — only bother fetching this account's ad sets when at
      // least one of its campaigns has no genuine campaign-level budget.
      const campaignIdsMissingBudget = metaData
        .filter((c) => !deriveBudget(c).budget)
        .map((c) => String(c.id));

      if (campaignIdsMissingBudget.length > 0) {
        const missingSet = new Set(campaignIdsMissingBudget);
        const adsetBudgetUrl =
          `https://graph.facebook.com/v19.0/${actId}/adsets` +
          `?fields=${encodeURIComponent("id,campaign_id,daily_budget,lifetime_budget")}&limit=500&access_token=${token.accessToken}`;
        try {
          const adsetList = await fetchAllPages(adsetBudgetUrl);
          adsetList.forEach((a) => {
            const cid = String(a.campaign_id || "");
            // Only campaigns actually missing their own budget need a sum —
            // never overrides a genuine campaign-level budget.
            if (!cid || !missingSet.has(cid)) return;
            const { budget: adsetBudget, budgetType: adsetBudgetType } = deriveBudget(a);
            if (adsetBudget === null) return; // this ad set has no budget of its own either
            const entry = adSetBudgetByCampaignId.get(cid) || {
              dailyTotal: 0,
              lifetimeTotal: 0,
              hasDaily: false,
              hasLifetime: false,
            };
            if (adsetBudgetType === "daily") {
              entry.dailyTotal += adsetBudget;
              entry.hasDaily = true;
            } else if (adsetBudgetType === "lifetime") {
              entry.lifetimeTotal += adsetBudget;
              entry.hasLifetime = true;
            }
            adSetBudgetByCampaignId.set(cid, entry);
          });
        } catch (err) {
          console.log(`Ad set budget fallback fetch failed for ${actId}: ${err.message}`);
        }
      }

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

      const meta = metaByCampaignId.get(campaignId) || {};
      let { budget = null, budgetType = null, status = null, effectiveStatus = null } = meta;

      // Phase 36 §4 — Campaign Budget Fallback: when Meta reports no
      // genuine campaign-level budget (Advantage+/CBO-off, ad-set-level
      // budgeting), fall back to the sum of this campaign's own Ad Set
      // budgets (computed above, bulk-fetched once per account) rather
      // than showing "N/A". A genuine campaign-level budget above always
      // wins and is never replaced. budgetSource tells the client which
      // one it's looking at, so the UI can show a small "Ad Set Budget
      // Applied" note without inventing a second budget field.
      let budgetSource = budget !== null && budget !== undefined ? "campaign" : "none";
      if (budgetSource === "none") {
        const sum = adSetBudgetByCampaignId.get(campaignId);
        if (sum && (sum.hasDaily || sum.hasLifetime)) {
          // Never adds a daily total to a lifetime total. In the rare case
          // a campaign's ad sets mix cadences, the daily total is shown
          // (the more common, more actionable cadence) — the Campaign
          // Drawer's own consolidated view shows the full daily+lifetime
          // breakdown for this same rare case.
          if (sum.hasDaily) {
            budget = sum.dailyTotal;
            budgetType = "daily";
          } else {
            budget = sum.lifetimeTotal;
            budgetType = "lifetime";
          }
          budgetSource = "adsets";
        }
      }

      return {
        accountId: campaign.accountId,

        campaignId,

        campaignName:
          campaign.campaign_name,

        budget,
        budgetType,
        budgetSource,
        status,
        effectiveStatus,

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

// Phase 30 — Hook Rate (3-second video views / impressions). Duplicated
// byte-identically in campaignExplorer.js/adSetExplorer.js/adExplorer.js
// so hook rate is genuinely comparable Campaign → Ad Set → Ad — see
// campaignExplorer.js's copy for the full explanation. Never falls back
// to a different metric (e.g. video_p25_watched_actions) when the true
// 3s metric is absent; returns null (rendered "N/A" client-side) instead.
function extractThreeSecVideoViews(actions, videoPlayActions) {
  const fromVideoPlayActions = findActionValue(videoPlayActions, ["video_view"]);
  if (fromVideoPlayActions !== null) return fromVideoPlayActions;
  const fromActions = findActionValue(actions, ["video_view"]);
  if (fromActions !== null) return fromActions;
  return null;
}

function computeHookRate(threeSecVideoViews, impressions) {
  if (threeSecVideoViews == null || !impressions) return null;
  return (threeSecVideoViews / impressions) * 100;
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

// Same probing logic as orderDetails.js's extractAwb() — duplicated
// locally rather than imported, following this codebase's existing
// convention of duplicating small raw-payload extractors per file (see
// extractCourier/extractDeliveryStatus/extractOrderStatus above, which
// are already duplicated between this file and orderDetails.js). There
// is no dedicated top-level `awb` field on the ShiprocketOrder model
// (checked models/shiprocketorder.js), so it has to come from `raw`.
function extractAwb(raw) {
  return raw?.awb || raw?.awb_code || raw?.awb_number || raw?.shipments?.[0]?.awb || raw?.shipments?.[0]?.awb_code || null;
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
    // Additive fields for the Campaign Drawer's stat drill-down tables
    // (Prepaid/COD/etc. order lists) — AWB from the raw payload (same
    // convention as courier/status above), ad set/ad attribution from
    // the ShiprocketOrder document's own top-level fields (populated at
    // sync/match time, not derived/guessed).
    awb: extractAwb(o.raw),
    adsetId: o.adsetId || null,
    adsetName: o.adsetName || null,
    adId: o.adId || null,
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
      "daily_budget",
      "lifetime_budget",
      "start_time",
      "stop_time",
      "created_time",
      "updated_time",
      // Phase 27 — additive field, read-only context for the drawer's
      // new Budget & Bid Cap Control section (campaigns don't have a
      // directly editable bid cap in the Graph API — see
      // routes/campaignControl.js's header comment — but bid_strategy
      // is still useful read-only context when Meta returns one).
      "bid_strategy",
      // Phase 32 §4 — account_id, as a fallback source for the "Open in
      // Meta Ads Manager" deep link on the rare path where the ?accountId
      // query param below is absent. The query param (already passed by
      // every caller of this route today) still takes priority — this
      // never overrides a value the client already sent.
      "account_id",
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
      // Phase 30 — Hook Rate / Video Views. See extractThreeSecVideoViews().
      "video_play_actions",
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
        const impressionsNum = row.impressions != null ? Number(row.impressions) : null;
        // Phase 30 — Hook Rate / Video Views.
        const threeSecVideoViews = extractThreeSecVideoViews(row.actions, row.video_play_actions);
        metaInsights = {
          spend: row.spend != null ? Number(row.spend) : null,
          reach: row.reach != null ? Number(row.reach) : null,
          impressions: impressionsNum,
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
          videoViews: threeSecVideoViews,
          hookRate: computeHookRate(threeSecVideoViews, impressionsNum),
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
        "orderId orderDate campaignId campaignName totalAmountPayable paymentType paymentStatus orderCreatedAt phone address raw adsetId adsetName adId"
      )
      .lean();

    const orders = rawOrders
      .filter((o) => normalizeCampaignName(o.campaignName) === normalizedTarget)
      .map(shapeOrderForDrawer)
      .sort((a, b) => new Date(b.orderCreatedAt || 0) - new Date(a.orderCreatedAt || 0));

    const { budget, budgetType } = deriveBudget(campaignMeta);

    res.json({
      success: true,
      campaign: {
        id: campaignId,
        name: campaignMeta?.name || campaignName,
        objective: campaignMeta?.objective || null,
        status: campaignMeta?.status || null,
        effectiveStatus: campaignMeta?.effective_status || null,
        buyingType: campaignMeta?.buying_type || null,
        budget,
        budgetType,
        startTime: campaignMeta?.start_time || null,
        stopTime: campaignMeta?.stop_time || null,
        createdTime: campaignMeta?.created_time || null,
        updatedTime: campaignMeta?.updated_time || null,
        // Phase 32 §4 — prefer the caller-supplied accountId (unchanged
        // default), fall back to Meta's own account_id on the campaign
        // node when it wasn't supplied, rather than ever leaving this
        // null when a real value is available.
        accountId: accountId || (campaignMeta?.account_id ? String(campaignMeta.account_id) : null),
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
