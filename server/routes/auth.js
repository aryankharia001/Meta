import express from "express";
import AuthUser from "../models/AuthUser.js";
import { hashPassword, verifyPassword, signSessionToken, cookieOptions, SESSION_COOKIE_NAME } from "../lib/auth.js";
import { requireAuth } from "../middleware/auth.js";
import { recordActivity } from "../lib/activityLog.js";

const router = express.Router();

// ─────────────────────────────────────────────────────────────
// Phase 14 §1/§3 — login/logout/session. Mounted at /api/auth, and
// mounted BEFORE the global `requireAuth` gate in index.js so these
// three routes stay reachable while logged out — every other /api
// route is protected. There is no signup route: accounts are only ever
// created by an admin (see routes/users.js).
// ─────────────────────────────────────────────────────────────

const NOT_AUTHORIZED_MESSAGE = "You are not authorized to access this application.";

router.post("/login", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required" });
    }

    const user = await AuthUser.findOne({ email });
    if (!user) {
      // Unregistered email — the phase brief's exact required copy.
      await recordActivity({ user: email, type: "auth_failed_login", message: `Failed login attempt (unregistered email)`, entityType: "auth", meta: { email } });
      return res.status(401).json({ success: false, message: NOT_AUTHORIZED_MESSAGE });
    }
    if (user.disabled) {
      await recordActivity({ user: user.email, type: "auth_failed_login", message: `Failed login attempt (account disabled)`, entityType: "auth" });
      return res.status(401).json({ success: false, message: NOT_AUTHORIZED_MESSAGE });
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      await recordActivity({ user: user.email, type: "auth_failed_login", message: "Failed login attempt (wrong password)", entityType: "auth" });
      return res.status(401).json({ success: false, message: "Invalid email or password." });
    }

    user.lastLoginAt = new Date();
    await user.save();

    const token = signSessionToken(user);
    res.cookie(SESSION_COOKIE_NAME, token, cookieOptions());

    await recordActivity({ user: user.email, type: "auth_login", message: "User logged in", entityType: "auth" });

    res.json({ success: true, user: { id: String(user._id), email: user.email, role: user.role } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Login failed" });
  }
});

router.post("/logout", requireAuth, async (req, res) => {
  res.clearCookie(SESSION_COOKIE_NAME, { ...cookieOptions(), maxAge: undefined });
  await recordActivity({ user: req.user.email, type: "auth_logout", message: "User logged out", entityType: "auth" });
  res.json({ success: true });
});

router.get("/me", requireAuth, async (req, res) => {
  res.json({ success: true, user: req.user });
});

// Self-service password change (any logged-in user, for their own
// account) — separate from the admin-only reset in routes/users.js.
router.post("/change-password", requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: "Current and new password are required" });
    }
    if (String(newPassword).length < 8) {
      return res.status(400).json({ success: false, message: "New password must be at least 8 characters" });
    }

    const user = await AuthUser.findById(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    const valid = await verifyPassword(currentPassword, user.passwordHash);
    if (!valid) return res.status(401).json({ success: false, message: "Current password is incorrect" });

    user.passwordHash = await hashPassword(newPassword);
    await user.save();

    await recordActivity({ user: user.email, type: "user_password_changed", message: "Password changed", entityType: "user", entityId: String(user._id) });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to change password" });
  }
});

export default router;
