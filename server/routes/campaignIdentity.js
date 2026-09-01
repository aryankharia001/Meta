import express from "express";
import Token from "../models/Token.js";
import AdAccount from "../models/AdAccount.js";
import MetaEntityState from "../models/MetaEntityState.js";
import CampaignNameHistory from "../models/CampaignNameHistory.js";
import CampaignNameMapping from "../models/CampaignNameMapping.js";
import { normalizeCampaignName } from "../lib/campaignIdentity.js";
import { recordActivity } from "../lib/activityLog.js";

const router = express.Router();

// ─────────────────────────────────────────────────────────────
// Campaign History Phase — Campaign Identity: the Campaign Drill side
// window's new "Campaign Identity" / "Historical Names" section.
// Entirely new, additive route file (mounted at /api/campaign-identity).
// Read-only for identity/history; the only writes here are to the new
// CampaignNameMapping collection (manual historical names) — never to
// CampaignNameHistory (auto, append-only, written only from
// services/metaEntitySync.js), MetaEntityState, or ShiprocketOrder.
// ─────────────────────────────────────────────────────────────

async function resolveAccountId(tokenId, campaignId) {
  const state = await MetaEntityState.findOne({ tokenId, entityType: "campaign", entityId: campaignId }).select("accountId").lean();
  if (state?.accountId) return state.accountId;
  const accounts = await AdAccount.find({ tokenId }).lean();
  return accounts[0]?.adAccountId || "";
}

// Checks whether `normalizedName` would collide with (a) a manual
// mapping already pointing at a DIFFERENT campaign, (b) another
// campaign's current name, or (c) another campaign's auto-detected
// historical name. Bulk-fetched and compared in memory — same
// convention every order-matching route already uses (MetaEntityState.name
// isn't stored normalized, so this can't be a single indexed query) —
// candidate counts per token are small (an ad account's campaign list),
// so this is cheap. Returns null when there's no collision.
async function findCollision({ tokenId, campaignId, normalizedName }) {
  const cid = String(campaignId);

  const existingMapping = await CampaignNameMapping.findOne({ tokenId, normalizedName }).lean();
  if (existingMapping && String(existingMapping.campaignId) !== cid) {
    const rec = await MetaEntityState.findOne({ tokenId, entityType: "campaign", entityId: existingMapping.campaignId }).select("name").lean();
    return {
      conflictType: "manual_mapping",
      conflictingCampaignId: String(existingMapping.campaignId),
      conflictingCampaignName: rec?.name || String(existingMapping.campaignId),
      message: `"${existingMapping.historicalName}" is already manually mapped to a different campaign (${rec?.name || existingMapping.campaignId}).`,
    };
  }

  const [allStates, allNameHistory] = await Promise.all([
    MetaEntityState.find({ tokenId, entityType: "campaign", entityId: { $ne: cid } }).select("entityId name").lean(),
    CampaignNameHistory.find({ tokenId, campaignId: { $ne: cid } })
      .select("campaignId previousNameNormalized newNameNormalized")
      .lean(),
  ]);

  const currentHit = allStates.find((s) => normalizeCampaignName(s.name) === normalizedName);
  if (currentHit) {
    return {
      conflictType: "current_name",
      conflictingCampaignId: String(currentHit.entityId),
      conflictingCampaignName: currentHit.name,
      message: `This name is currently in use by another campaign (${currentHit.name}).`,
    };
  }

  const historyHit = allNameHistory.find((r) => r.previousNameNormalized === normalizedName || r.newNameNormalized === normalizedName);
  if (historyHit) {
    const rec = allStates.find((s) => String(s.entityId) === String(historyHit.campaignId));
    return {
      conflictType: "historical_name",
      conflictingCampaignId: String(historyHit.campaignId),
      conflictingCampaignName: rec?.name || String(historyHit.campaignId),
      message: `This name was historically used by a different campaign (${rec?.name || historyHit.campaignId}).`,
    };
  }

  return null;
}

// ── GET /:tokenId/:campaignId — Identity snapshot for the drawer ────
router.get("/:tokenId/:campaignId", async (req, res) => {
  try {
    const { tokenId, campaignId } = req.params;
    const token = await Token.findById(tokenId).lean();
    if (!token) return res.status(404).json({ success: false, message: "Token not found" });

    const state = await MetaEntityState.findOne({ tokenId, entityType: "campaign", entityId: campaignId }).lean();

    const [nameHistoryRows, mappingRows] = await Promise.all([
      CampaignNameHistory.find({ tokenId, campaignId }).sort({ changedAt: -1 }).lean(),
      CampaignNameMapping.find({ tokenId, campaignId }).sort({ createdAt: -1 }).lean(),
    ]);

    // "Automatically saved historical campaign names" (spec §3/§5) —
    // every distinct name this campaign has ever been observed under,
    // deduped, excluding whatever the current name is (that's shown
    // separately). The most recent time each name was seen wins the
    // displayed "last seen" timestamp.
    const currentNormalized = normalizeCampaignName(state?.name);
    const autoNamesSeen = new Map(); // normalized -> { name, lastSeenAt }
    nameHistoryRows.forEach((r) => {
      [
        { name: r.previousName, norm: r.previousNameNormalized },
        { name: r.newName, norm: r.newNameNormalized },
      ].forEach(({ name, norm }) => {
        if (!norm || norm === currentNormalized || !name) return;
        const existing = autoNamesSeen.get(norm);
        if (!existing || new Date(r.changedAt) > new Date(existing.lastSeenAt)) {
          autoNamesSeen.set(norm, { name, lastSeenAt: r.changedAt });
        }
      });
    });

    res.json({
      success: true,
      campaignId,
      currentName: state?.name || null,
      isDeleted: !!state?.isDeleted,
      noLongerReturnedAt: state?.noLongerReturnedAt || null,
      lastSeenAt: state?.lastSeenAt || null,
      autoHistoricalNames: [...autoNamesSeen.values()].sort((a, b) => new Date(b.lastSeenAt) - new Date(a.lastSeenAt)),
      manualMappings: mappingRows.map((m) => ({
        id: String(m._id),
        historicalName: m.historicalName,
        note: m.note || "",
        createdBy: m.createdBy || "",
        createdAt: m.createdAt,
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

// ── POST /:tokenId/:campaignId/mapping — add a manual historical name ─
router.post("/:tokenId/:campaignId/mapping", async (req, res) => {
  try {
    const { tokenId, campaignId } = req.params;
    const { historicalName, note, force } = req.body || {};

    if (!historicalName || !String(historicalName).trim()) {
      return res.status(400).json({ success: false, message: "historicalName is required" });
    }
    const normalizedName = normalizeCampaignName(historicalName);

    const token = await Token.findById(tokenId).lean();
    if (!token) return res.status(404).json({ success: false, message: "Token not found" });

    if (!force) {
      const collision = await findCollision({ tokenId, campaignId, normalizedName });
      if (collision) return res.status(409).json({ success: false, conflict: true, ...collision });
    }

    const accountId = await resolveAccountId(tokenId, campaignId);

    // Upsert on {tokenId, normalizedName} — a name resolves to exactly
    // one campaign at a time (schema-enforced unique index); if it was
    // previously mapped elsewhere this naturally reassigns it here,
    // which is exactly the "warn, allow override" behavior force=true
    // (after the client has shown the collision warning above) confirms.
    const mapping = await CampaignNameMapping.findOneAndUpdate(
      { tokenId, normalizedName },
      {
        $set: {
          tokenId,
          accountId,
          campaignId: String(campaignId),
          historicalName: String(historicalName).trim(),
          normalizedName,
          note: note || "",
          createdBy: req.user?.email || "",
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    await recordActivity({
      user: req.user?.email || "",
      type: "campaign_historical_name_added",
      message: `${req.user?.email || "A user"} added historical name "${historicalName}" for campaign ${campaignId}`,
      entityType: "campaign",
      entityId: campaignId,
      meta: { historicalName, normalizedName },
    }).catch(() => {});

    res.json({
      success: true,
      mapping: { id: String(mapping._id), historicalName: mapping.historicalName, note: mapping.note, createdBy: mapping.createdBy, createdAt: mapping.createdAt },
    });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

// ── PUT /:tokenId/:campaignId/mapping/:mappingId — edit ─────────────
router.put("/:tokenId/:campaignId/mapping/:mappingId", async (req, res) => {
  try {
    const { tokenId, campaignId, mappingId } = req.params;
    const { historicalName, note, force } = req.body || {};

    const existing = await CampaignNameMapping.findOne({ _id: mappingId, tokenId, campaignId: String(campaignId) });
    if (!existing) return res.status(404).json({ success: false, message: "Mapping not found" });

    if (historicalName !== undefined) {
      if (!String(historicalName).trim()) {
        return res.status(400).json({ success: false, message: "historicalName cannot be empty" });
      }
      const normalizedName = normalizeCampaignName(historicalName);
      if (normalizedName !== existing.normalizedName && !force) {
        const collision = await findCollision({ tokenId, campaignId, normalizedName });
        if (collision) return res.status(409).json({ success: false, conflict: true, ...collision });
      }
      existing.historicalName = String(historicalName).trim();
      existing.normalizedName = normalizedName;
    }
    if (note !== undefined) existing.note = note;

    try {
      await existing.save();
    } catch (err) {
      if (err.code === 11000) {
        return res.status(409).json({
          success: false,
          conflict: true,
          conflictType: "manual_mapping",
          message: "This name is already mapped to a different campaign.",
        });
      }
      throw err;
    }

    res.json({
      success: true,
      mapping: { id: String(existing._id), historicalName: existing.historicalName, note: existing.note, createdBy: existing.createdBy, createdAt: existing.createdAt },
    });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

// ── DELETE /:tokenId/:campaignId/mapping/:mappingId ─────────────────
// Removes ONLY this manual mapping row. Must never (and does never)
// touch CampaignNameHistory, ShiprocketOrder, or MetaEntityState — spec
// §5's explicit requirement.
router.delete("/:tokenId/:campaignId/mapping/:mappingId", async (req, res) => {
  try {
    const { tokenId, campaignId, mappingId } = req.params;
    const deleted = await CampaignNameMapping.findOneAndDelete({ _id: mappingId, tokenId, campaignId: String(campaignId) });
    if (!deleted) return res.status(404).json({ success: false, message: "Mapping not found" });

    await recordActivity({
      user: req.user?.email || "",
      type: "campaign_historical_name_removed",
      message: `${req.user?.email || "A user"} removed historical name "${deleted.historicalName}" for campaign ${campaignId}`,
      entityType: "campaign",
      entityId: campaignId,
      meta: { historicalName: deleted.historicalName },
    }).catch(() => {});

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
});

export default router;
