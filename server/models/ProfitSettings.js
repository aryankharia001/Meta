import mongoose from "mongoose";

// ─────────────────────────────────────────────────────────────
// Phase 16 §3/§18 — configurable COD success rate. This is the app's
// first genuinely backend-persisted, shared setting (every prior
// "setting" in this codebase — see client/src/context/PreferencesContext
// and SettingsPage.jsx — lives only in localStorage, per-browser). A COD
// success rate must be shared across every user/browser viewing
// profitability numbers, so it has to live in the database instead.
//
// Singleton pattern: exactly one document ever exists, found/created via
// getOrCreate() below. Never instantiate this model with `new` directly
// from route code — always go through getOrCreate() so a second document
// can never accidentally be created.
// ─────────────────────────────────────────────────────────────

const profitSettingsSchema = new mongoose.Schema(
  {
    // Percentage, e.g. 70 means "70% of COD orders are expected to
    // convert into real recognized revenue" (§3's own example).
    codSuccessRate: { type: Number, default: 70, min: 0, max: 100 },
  },
  { timestamps: true }
);

const ProfitSettings = mongoose.models.ProfitSettings || mongoose.model("ProfitSettings", profitSettingsSchema);

export async function getOrCreateProfitSettings() {
  let doc = await ProfitSettings.findOne({});
  if (!doc) {
    doc = await ProfitSettings.create({});
  }
  return doc;
}

export default ProfitSettings;
