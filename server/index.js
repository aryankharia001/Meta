import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import path from "path";
import { fileURLToPath } from "url";

import campaignsRouter from "./routes/campaigns.js";
import campaignExplorerRouter from "./routes/campaignExplorer.js";
import dailyReportsRouter from "./routes/dailyReports.js";
import shiprocketRouter from "./routes/shiprocketSync.js";
import orderRouter from "./routes/orders.js";
import orderDetailsRouter from "./routes/orderDetails.js";
import liveSyncRouter from "./routes/liveSync.js";
import analyticsRouter from "./routes/analytics.js";
import favoritesRouter from "./routes/favorites.js";
import savedViewsRouter from "./routes/savedViews.js";
import entityNotesRouter from "./routes/entityNotes.js";
import activityLogRouter from "./routes/activityLog.js";
import searchRouter from "./routes/search.js";
import customersRouter from "./routes/customers.js";
import adAccounts from "./routes/adAccountsRoutes.js";
import tokensRouter from "./routes/tokens.js";
// Phase 13 — Ad Set / Ad hierarchy + Hourly performance. Entirely new,
// additive route files; none of the imports/mounts above are touched.
import adSetExplorerRouter from "./routes/adSetExplorer.js";
import adExplorerRouter from "./routes/adExplorer.js";
import hourlyRouter from "./routes/hourly.js";
// Phase 15 — Daily Hourly Intelligence & Date Drill-Down. Additive only.
import dailyHourlyRouter from "./routes/dailyHourly.js";
// Phase 16 — Product Cost, Expenses & Real Profitability. Entirely new,
// additive route files; none of the imports/mounts above are touched.
import productsRouter from "./routes/products.js";
import expensesRouter from "./routes/expenses.js";
import profitabilityRouter from "./routes/profitability.js";
// Phase 22 — Abandoned Cart Management. Entirely new, additive route
// file; none of the imports/mounts here are touched. Never writes to
// ShiprocketOrder or anything order/campaign matching reads from — see
// routes/abandonedCarts.js's own header comment.
import abandonedCartsRouter from "./routes/abandonedCarts.js";
// Phase 27 — Budget & Bid Cap Control, History, Sync and Hourly
// Activity. Entirely new, additive route files + a new sync cron;
// nothing above is modified.
import campaignControlRouter from "./routes/campaignControl.js";
import adsetControlRouter from "./routes/adsetControl.js";
import startMetaEntitySyncCron from "./services/metaEntitySyncCron.js";
// Phase 39 — Campaign Activity History, Active/Inactive Periods & Order
// Attribution. Entirely new, additive route file; nothing above is
// modified. Reads CampaignStatusHistory (also new) plus the existing
// BudgetHistory/BidCapHistory — see routes/campaignActivity.js's header.
import campaignActivityRouter from "./routes/campaignActivity.js";
// Phase 25 — Store & Fetch Real Abandoned Cart Orders. Entirely new,
// additive route file, mounted PUBLICLY (see below, before requireAuth)
// since Traflead/Shiprocket Engage can't hold a login session cookie.
import abandonCartPostbackRouter from "./routes/abandonCartPostback.js";
// Phase 14 — authentication + user management. Entirely new, additive
// route files; everything above stays untouched.
import authRouter from "./routes/auth.js";
import usersRouter from "./routes/users.js";
import { requireAuth } from "./middleware/auth.js";
import { bootstrapAdminFromEnv } from "./lib/bootstrapAdmin.js";

import { connectDB } from "./config/db.js";
import startShiprocketAutoSync from "./services/shiprocketCron.js";
import orderCostsRouter from "./routes/orderCosts.js";
// Phase 33 — Exact Traflead Abandoned Cart Data Sync. Entirely new,
// additive route file + sync cron; nothing above is modified. Pulls
// real Lead data from the separate trafleadcrm project's own API (never
// writes back to Traflead, never touches Meta<->Shiprocket sync,
// campaign/order matching, or profitability logic).
import trafleadSyncRouter from "./routes/trafleadSync.js";
import startTrafleadSyncCron, { startTrafleadRollingSyncCron } from "./services/trafleadSyncCron.js";

dotenv.config();

const app = express();

/* =========================================================
   PATH SETUP
========================================================= */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// React production build
const clientPath = path.join(__dirname, "../client/dist");

/* =========================================================
   CORS
========================================================= */

const corsOptions = {
  origin:
    process.env.CLIENT_ORIGIN ||
    "http://localhost:5173",
  credentials: true,
};

app.use(cors(corsOptions));

/* =========================================================
   BODY PARSER
========================================================= */

app.use(express.json());
// Phase 25 — some webhook senders (Traflead/Shiprocket Engage-style
// platforms) POST form-encoded bodies rather than JSON. Additive: every
// existing route keeps using express.json() exactly as before, this
// just means req.body also gets populated when a caller sends
// application/x-www-form-urlencoded.
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

/* =========================================================
   PUBLIC WEBHOOK (Phase 25) — /abandon-cart-postback must stay OUTSIDE
   requireAuth: Traflead/Shiprocket Engage can't hold a login session
   cookie. Mounted at both the bare path and the /api-prefixed path so
   either URL works, whichever one ends up configured on the sender's
   side. This is the ONLY unauthenticated write route in the app — see
   routes/abandonCartPostback.js's own header comment for why that's
   safe (it can only ever upsert one AbandonedCartOrder document).
========================================================= */

app.use("/abandon-cart-postback", abandonCartPostbackRouter);
app.use("/api/abandon-cart-postback", abandonCartPostbackRouter);

/* =========================================================
   AUTH (Phase 14) — /api/auth stays public (no signup route exists;
   login is the only way in). Every other /api/* route below is gated
   behind requireAuth, mounted here BEFORE any of them — none of those
   route files themselves are modified.
========================================================= */

app.use("/api/auth", authRouter);
app.use("/api", requireAuth);
app.use("/api/users", usersRouter);
app.use("/api", orderCostsRouter);
/* =========================================================
   API ROUTES
========================================================= */

app.use("/api/campaigns", campaignsRouter);
app.use("/api/campaign-explorer", campaignExplorerRouter);
app.use("/api/daily", dailyReportsRouter);
app.use("/api/orders", orderRouter);
app.use("/api/order-details", orderDetailsRouter);
app.use("/api/live-sync", liveSyncRouter);
app.use("/api/analytics", analyticsRouter);
app.use("/api/favorites", favoritesRouter);
app.use("/api/saved-views", savedViewsRouter);
app.use("/api/entity-notes", entityNotesRouter);
app.use("/api/activity-log", activityLogRouter);
app.use("/api/search", searchRouter);
app.use("/api/customers", customersRouter);
app.use("/api/", shiprocketRouter);
app.use("/api/adaccounts", adAccounts);
app.use("/api/tokens", tokensRouter);
// Phase 13 — additive only, mounted alongside (not instead of) every
// route above.
app.use("/api/adset-explorer", adSetExplorerRouter);
app.use("/api/ad-explorer", adExplorerRouter);
app.use("/api/hourly", hourlyRouter);
// Phase 15 — additive only, alongside every route above.
app.use("/api/daily-hourly", dailyHourlyRouter);
// Phase 16 — additive only, alongside every route above.
app.use("/api/products", productsRouter);
app.use("/api/expenses", expensesRouter);
app.use("/api/profitability", profitabilityRouter);
// Phase 22 — additive only, alongside every route above.
app.use("/api/abandoned-carts", abandonedCartsRouter);
// Phase 27 — Campaign/Ad Set Budget & Bid Cap control, history, sync,
// hourly activity. Entirely new, additive route files; nothing above is
// touched or imported except read-only Token/AdAccount lookups.
app.use("/api/campaign-control", campaignControlRouter);
app.use("/api/adset-control", adsetControlRouter);
// Phase 39 — additive only, alongside every route above.
app.use("/api/campaign-activity", campaignActivityRouter);
// Phase 33 — additive only, alongside every route above.
app.use("/api/traflead-sync", trafleadSyncRouter);

/* =========================================================
   SERVE REACT CLIENT
========================================================= */

app.use(express.static(clientPath));

/*
  React SPA fallback.

  Any request that isn't an API route will receive
  client/dist/index.html so React Router can handle
  the route on the frontend.
*/
app.get("*", (req, res) => {
  res.sendFile(path.join(clientPath, "index.html"));
});

/* =========================================================
   START SERVER
========================================================= */

const PORT = process.env.PORT || 5030;

const start = async () => {
  try {
    await connectDB();
    await bootstrapAdminFromEnv();

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`Serving client from: ${clientPath}`);
    });

    startShiprocketAutoSync();
    startMetaEntitySyncCron();
    startTrafleadSyncCron();
    // Phase 43 — the 30-day rolling background sync (see
    // trafleadSyncCron.js's own header comment): daily, force-re-fetches
    // the last 30 IST days so CFM/status updates on older Abandoned Cart
    // leads are discovered even after the day they were created on is
    // long past. Purely additive alongside the sync above.
    startTrafleadRollingSyncCron();
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
};

start();