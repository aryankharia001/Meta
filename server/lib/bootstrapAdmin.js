import AuthUser from "../models/AuthUser.js";
import { hashPassword } from "./auth.js";

// ─────────────────────────────────────────────────────────────
// Phase 14 §1 — convenience alternative to running
// scripts/createAdmin.mjs by hand: if BOOTSTRAP_ADMIN_EMAIL and
// BOOTSTRAP_ADMIN_PASSWORD are set in server/.env AND no AuthUser
// exists yet at all, create that one admin account on server start.
// Entirely opt-in (does nothing if those env vars aren't set) and only
// ever fires when the AuthUser collection is completely empty, so it
// can't be used to silently (re)create an account later — remove the
// two env vars once you've logged in for the first time.
// ─────────────────────────────────────────────────────────────

export async function bootstrapAdminFromEnv() {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;

  const anyUserExists = await AuthUser.exists({});
  if (anyUserExists) return;

  if (!email || !password) {
    console.warn(
      "⚠ No AuthUser accounts exist yet, and BOOTSTRAP_ADMIN_EMAIL/BOOTSTRAP_ADMIN_PASSWORD aren't set. " +
        'Create the first admin with: node scripts/createAdmin.mjs you@example.com "a strong password"'
    );
    return;
  }
  if (password.length < 8) {
    console.warn("⚠ BOOTSTRAP_ADMIN_PASSWORD is too short (min 8 characters) — skipping auto-bootstrap.");
    return;
  }

  await AuthUser.create({ email, passwordHash: await hashPassword(password), role: "admin" });
  console.log(`✓ Bootstrapped first admin account: ${email}. You can remove BOOTSTRAP_ADMIN_PASSWORD from .env now.`);
}
