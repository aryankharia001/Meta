import dotenv from "dotenv";
import express from "express";
import cors from "cors";
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