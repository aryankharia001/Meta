import mongoose from "mongoose";

// ─────────────────────────────────────────────────────────────
// Phase 14 §1/§2/§3 — application login accounts. Entirely new,
// additive collection — completely separate from Token (Meta access
// tokens) and AdAccount. Only ever stores a bcrypt hash, never a
// plain-text password (see server/lib/auth.js for hashing/verification).
//
// "Admin" vs "user" is the ONLY distinction the app makes — no
// per-feature permission system, per the phase brief's explicit "keep
// it simple" instruction.
// ─────────────────────────────────────────────────────────────

const authUserSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
    },
    passwordHash: {
      type: String,
      required: true,
    },
    role: {
      type: String,
      enum: ["admin", "user"],
      default: "user",
    },
    disabled: {
      type: Boolean,
      default: false,
    },
    lastLoginAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

export default mongoose.models.AuthUser || mongoose.model("AuthUser", authUserSchema);
