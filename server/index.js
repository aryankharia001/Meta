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
// Phase 14 — authentication + user management. Entirely new, additive
// route files; everything above stays untouched.
import authRouter from "./routes/auth.js";
import usersRouter from "./routes/users.js";
import { requireAuth } from "./middleware/auth.js";
import { bootstrapAdminFromEnv } from "./lib/bootstrapAdmin.js";

import { connectDB } from "./config/db.js";
import startShiprocketAutoSync from "./services/shiprocketCron.js";

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
app.use(cookieParser());

/* =========================================================
   AUTH (Phase 14) — /api/auth stays public (no signup route exists;
   login is the only way in). Every other /api/* route below is gated
   behind requireAuth, mounted here BEFORE any of them — none of those
   route files themselves are modified.
========================================================= */

app.use("/api/auth", authRouter);
app.use("/api", requireAuth);
app.use("/api/users", usersRouter);

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
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
};

start();