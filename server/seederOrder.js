// seedOrderCosts.js

import dotenv from "dotenv";
import mongoose from "mongoose";
import OrderCosts from "./models/OrderCosts.js";

// Load .env
dotenv.config();

async function seed() {
  try {
    // Check that MONGO_URI exists
    if (!process.env.MONGO_URI) {
      throw new Error(
        "MONGO_URI is not defined. Check your .env file."
      );
    }

    console.log("Connecting to MongoDB...");

    await mongoose.connect(process.env.MONGO_URI);

    console.log("MongoDB connected.");

    const doc = await OrderCosts.findOneAndUpdate(
      { key: "default" },
      {
        manufacturing: 120,
        shipping: 45,
        packaging: 15,
        misc: 0,
      },
      {
        upsert: true,
        new: true,
      }
    );

    console.log("Seeded order costs:");
    console.log(doc.toObject());

    await mongoose.disconnect();

    console.log("MongoDB disconnected.");
  } catch (err) {
    console.error("Seed failed:", err);

    try {
      await mongoose.disconnect();
    } catch {}

    process.exit(1);
  }
}

seed();