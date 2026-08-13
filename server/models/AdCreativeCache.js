import mongoose from "mongoose";

// ─────────────────────────────────────────────────────────────
// Phase 13 §6/§18 — persistent cache for an ad's creative details
// (thumbnail, primary text, headline, CTA, destination URL, format,
// preview URL). Creative content rarely changes once an ad is live, so
// unlike the in-memory 45s TTL caches the insights routes use, this is a
// real Mongo collection with a longer TTL — avoids re-hitting the Meta
// Graph API's creative/thumbnail endpoints every time an Ad Explorer
// row renders or an Ad Drawer opens.
//
// Purely additive/new collection — nothing else in the app reads or
// writes it, and it never touches ShiprocketOrder or any Meta
// campaign/order matching logic.
// ─────────────────────────────────────────────────────────────

const adCreativeCacheSchema = new mongoose.Schema(
  {
    adId: { type: String, required: true, trim: true, index: true, unique: true },
    tokenId: { type: mongoose.Schema.Types.ObjectId, ref: "Token", required: true, index: true },

    creativeId: { type: String, trim: true, default: "" },
    thumbnailUrl: { type: String, trim: true, default: "" },
    imageUrl: { type: String, trim: true, default: "" },
    videoId: { type: String, trim: true, default: "" },
    primaryText: { type: String, default: "" },
    headline: { type: String, trim: true, default: "" },
    description: { type: String, default: "" },
    callToAction: { type: String, trim: true, default: "" },
    destinationUrl: { type: String, trim: true, default: "" },
    previewUrl: { type: String, trim: true, default: "" },
    adFormat: { type: String, trim: true, default: "" },

    // Full raw creative object from Meta, kept for anything not
    // explicitly modeled above without needing a schema migration.
    raw: { type: Object, default: {} },

    fetchedAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

export default mongoose.models.AdCreativeCache ||
  mongoose.model("AdCreativeCache", adCreativeCacheSchema);
