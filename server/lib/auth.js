import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";

// ─────────────────────────────────────────────────────────────
// Phase 14 §3 — authentication primitives. Password hashing (bcrypt,
// 12 rounds) and session token signing/verification (JWT in an
// httpOnly cookie — see middleware/auth.js and routes/auth.js). Nothing
// here ever touches Meta/logistics tokens or the Shiprocket sync path.
//
// JWT_SECRET must come from the environment in production. If it's
// missing (e.g. a fresh local checkout that hasn't set one yet) we
// generate a random, in-memory-only secret at boot instead of either
// hardcoding one or crashing — every existing session is invalidated on
// restart in that case, which is a safe failure mode (nobody stays
// logged in with a token signed by a secret no longer known to any
// other process), and a loud console warning tells you to fix it.
// Never logged, never sent to the frontend.
// ─────────────────────────────────────────────────────────────

const SALT_ROUNDS = 12;

let secret = process.env.JWT_SECRET;
if (!secret) {
  secret = crypto.randomBytes(48).toString("hex");
  console.warn(
    "⚠ JWT_SECRET is not set in the environment. Using a random, ephemeral secret for this process only — " +
      "every logged-in session will be invalidated the next time the server restarts. Set JWT_SECRET in " +
      "server/.env (a long random string) before deploying this to production."
  );
}
const JWT_SECRET = secret;
const TOKEN_TTL = "7d";
export const SESSION_COOKIE_NAME = "meta_session";
export const SESSION_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export async function hashPassword(plainPassword) {
  return bcrypt.hash(plainPassword, SALT_ROUNDS);
}

export async function verifyPassword(plainPassword, hash) {
  if (!plainPassword || !hash) return false;
  return bcrypt.compare(plainPassword, hash);
}

export function signSessionToken(user) {
  return jwt.sign({ sub: String(user._id), email: user.email, role: user.role }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

export function verifySessionToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

export function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_COOKIE_MAX_AGE_MS,
    path: "/",
  };
}
