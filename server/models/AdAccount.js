import mongoose from "mongoose";

const adAccountSchema = new mongoose.Schema(
  {
    tokenId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Token",
      required: true,
      index: true,
    },
    adAccountId: {
      type: String,
      required: true,
      trim: true,
    },
    name: {
      type: String,
      trim: true,
      default: "",
    },
    currency: {
      type: String,
      trim: true,
      default: "",
    },
    note: {
      type: String,
      trim: true,
      default: "",
    },
  },
  { timestamps: true }
);

// Prevent the same ad account being linked to the same token twice
adAccountSchema.index({ tokenId: 1, adAccountId: 1 }, { unique: true });

export default mongoose.model("AdAccount", adAccountSchema);
