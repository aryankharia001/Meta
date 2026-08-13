import express from "express";
import AuthUser from "../models/AuthUser.js";
import { hashPassword } from "../lib/auth.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { recordActivity } from "../lib/activityLog.js";

const router = express.Router();

// ─────────────────────────────────────────────────────────────
// Phase 14 §2 — simple admin-only user management. Mounted at
// /api/users, every route here requires an authenticated admin (the
// global requireAuth in index.js already covers authentication; the
// requireAdmin below adds the role check). No signup route exists
// anywhere in the app — this is the only way an account gets created.
// ─────────────────────────────────────────────────────────────

router.use(requireAuth, requireAdmin);

function shape(u) {
  return {
    id: String(u._id),
    email: u.email,
    role: u.role,
    disabled: u.disabled,
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
  };
}

router.get("/", async (req, res) => {
  try {
    const users = await AuthUser.find({}).sort({ createdAt: -1 }).lean();
    res.json({ success: true, users: users.map(shape) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    const role = req.body?.role === "admin" ? "admin" : "user";
    if (!email || !email.includes("@")) {
      return res.status(400).json({ success: false, message: "A valid email is required" });
    }
    if (password.length < 8) {
      return res.status(400).json({ success: false, message: "Password must be at least 8 characters" });
    }

    const existing = await AuthUser.findOne({ email });
    if (existing) return res.status(409).json({ success: false, message: "That email is already authorized" });

    const user = await AuthUser.create({ email, passwordHash: await hashPassword(password), role });

    await recordActivity({
      user: req.user.email,
      type: "user_added",
      message: `Authorized email added (${email})`,
      entityType: "user",
      entityId: String(user._id),
    });

    res.json({ success: true, user: shape(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Enable / disable / change role
router.patch("/:id", async (req, res) => {
  try {
    const user = await AuthUser.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    if (req.user.id === String(user._id) && req.body?.disabled === true) {
      return res.status(400).json({ success: false, message: "You can't disable your own account" });
    }

    if (typeof req.body?.disabled === "boolean") {
      user.disabled = req.body.disabled;
    }
    if (req.body?.role === "admin" || req.body?.role === "user") {
      user.role = req.body.role;
    }
    await user.save();

    await recordActivity({
      user: req.user.email,
      type: user.disabled ? "user_disabled" : "user_enabled",
      message: `${user.disabled ? "Disabled" : "Enabled"} user (${user.email})`,
      entityType: "user",
      entityId: String(user._id),
    });

    res.json({ success: true, user: shape(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Admin-initiated password reset — distinct from the self-service
// change-password in routes/auth.js.
router.patch("/:id/password", async (req, res) => {
  try {
    const newPassword = String(req.body?.newPassword || "");
    if (newPassword.length < 8) {
      return res.status(400).json({ success: false, message: "Password must be at least 8 characters" });
    }
    const user = await AuthUser.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    user.passwordHash = await hashPassword(newPassword);
    await user.save();

    await recordActivity({
      user: req.user.email,
      type: "user_password_changed",
      message: `Password reset for user (${user.email})`,
      entityType: "user",
      entityId: String(user._id),
    });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    if (req.user.id === req.params.id) {
      return res.status(400).json({ success: false, message: "You can't delete your own account" });
    }
    const user = await AuthUser.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    await recordActivity({
      user: req.user.email,
      type: "user_removed",
      message: `Authorized email removed (${user.email})`,
      entityType: "user",
      entityId: String(user._id),
    });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
