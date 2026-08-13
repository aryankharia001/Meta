import AuthUser from "../models/AuthUser.js";
import { verifySessionToken, SESSION_COOKIE_NAME } from "../lib/auth.js";

// ─────────────────────────────────────────────────────────────
// Phase 14 §3 — protects every API route behind a logged-in, non-
// disabled AuthUser. Mounted once in index.js as `app.use("/api", requireAuth)`
// AFTER /api/auth (login must stay public — there is no signup) and
// BEFORE every existing route (campaigns, orders, tokens, etc.) — none
// of those route files are modified themselves, this just sits in front
// of all of them.
// ─────────────────────────────────────────────────────────────

export async function requireAuth(req, res, next) {
  try {
    const token = req.cookies?.[SESSION_COOKIE_NAME];
    if (!token) return res.status(401).json({ success: false, message: "Not authenticated" });

    const payload = verifySessionToken(token);
    if (!payload?.sub) return res.status(401).json({ success: false, message: "Session expired" });

    const user = await AuthUser.findById(payload.sub).lean();
    if (!user || user.disabled) {
      return res.status(401).json({ success: false, message: "Not authenticated" });
    }

    req.user = { id: String(user._id), email: user.email, role: user.role };
    next();
  } catch (err) {
    console.error("Auth middleware error:", err);
    res.status(401).json({ success: false, message: "Not authenticated" });
  }
}

export function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ success: false, message: "Not authenticated" });
  if (req.user.role !== "admin") return res.status(403).json({ success: false, message: "Admin access required" });
  next();
}
