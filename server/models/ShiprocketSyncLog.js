import mongoose from "mongoose";

const ShiprocketSyncLogSchema = new mongoose.Schema({
  date: { type: String, required: true, unique: true, index: true },
  status: {
    type: String,
    enum: ["complete", "failed"],
    default: "complete",
  },
  orderCount: { type: Number, default: 0 },
  error: { type: String, default: "" },
  lastAttemptAt: { type: Date, default: Date.now },
}, { timestamps: true });

const ShiprocketSyncLog =
  mongoose.models?.ShiprocketSyncLog ||
  mongoose.model("ShiprocketSyncLog", ShiprocketSyncLogSchema);

export default ShiprocketSyncLog;