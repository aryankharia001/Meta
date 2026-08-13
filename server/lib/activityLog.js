import ActivityLog from "../models/ActivityLog.js";

// ─────────────────────────────────────────────────────────────
// Phase 14 §6/§7 — server-side activity recording, for actions that
// happen entirely on the backend (login, logout, failed login, token
// CRUD, user management) where there's no natural frontend call site to
// hang the existing client-side logActivity() (lib/api.js -> POST
// /activity-log) off of. Both paths write to the same ActivityLog
// collection.
//
// SECURITY — this is the one place every server-side log entry funnels
// through, so it's also where the "never log secrets" rule is enforced
// structurally: callers pass a plain description string they wrote
// themselves (e.g. "Added Meta Access Token"), never the request body,
// so there is no code path here that could accidentally serialize a
// password/token/secret into the log even by mistake.
// ─────────────────────────────────────────────────────────────

export async function recordActivity({ user, type, message, entityType = "", entityId = "", meta = {} }) {
  try {
    await ActivityLog.create({
      type,
      message,
      user: user || "System",
      entityType,
      entityId: entityId ? String(entityId) : "",
      meta,
    });
  } catch (err) {
    // Activity logging must never break the action it's describing.
    console.error("Failed to record activity:", err.message);
  }
}
