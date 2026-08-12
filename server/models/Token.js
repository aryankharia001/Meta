import mongoose from "mongoose";

const tokenSchema = new mongoose.Schema(
  {
    accessToken: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    label: {
      type: String,
      trim: true,
      default: "",
    },
    note: {
      type: String,
      trim: true,
      default: "",
    },
  },
  { timestamps: true }
);

// Cascade-delete ad accounts when the token is removed
tokenSchema.pre("findOneAndDelete", async function (next) {
  try {
    const token = await this.model.findOne(this.getFilter());
    if (token) {
      await mongoose.model("AdAccount").deleteMany({ tokenId: token._id });
    }
    next();
  } catch (err) {
    next(err);
  }
});

export default mongoose.model("Token", tokenSchema);
