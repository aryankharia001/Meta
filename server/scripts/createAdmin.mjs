// Phase 14 §1 — one-time bootstrap for the very first admin account.
// There is no signup page anywhere in the app on purpose, so this
// script (or the auto-bootstrap in index.js, whichever runs first) is
// the only way to create the account you'll actually log in with.
//
// Usage:
//   node scripts/createAdmin.mjs you@example.com "a strong password"
//
// Safe to run more than once — if an AuthUser already exists with that
// email, it updates the password/role instead of erroring, and refuses
// to run at all once ANY admin already exists in the database (use the
// in-app Admin > Users page to add more admins after that point).

import dotenv from "dotenv";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import AuthUser from "../models/AuthUser.js";
import { hashPassword } from "../lib/auth.js";

dotenv.config();

async function main() {
  const [, , email, password] = process.argv;
  if (!email || !password) {
    console.error('Usage: node scripts/createAdmin.mjs you@example.com "a strong password"');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error("Password must be at least 8 characters.");
    process.exit(1);
  }

  await connectDB();

  const existingAdminCount = await AuthUser.countDocuments({ role: "admin" });
  const normalizedEmail = email.trim().toLowerCase();
  const existing = await AuthUser.findOne({ email: normalizedEmail });

  if (existingAdminCount > 0 && !existing) {
    console.error(
      "An admin account already exists. Use the in-app Admin > Users page (logged in as an existing admin) to add more accounts instead of this script."
    );
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);

  if (existing) {
    existing.passwordHash = passwordHash;
    existing.role = "admin";
    existing.disabled = false;
    await existing.save();
    console.log(`Updated existing account ${normalizedEmail} to admin with the new password.`);
  } else {
    await AuthUser.create({ email: normalizedEmail, passwordHash, role: "admin" });
    console.log(`Created admin account ${normalizedEmail}.`);
  }

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error("Failed to create admin:", err);
  process.exit(1);
});
