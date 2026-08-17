// models/OrderCosts.js

import mongoose from "mongoose";

const orderCostsSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      default: "default",
      unique: true,
    },

    manufacturing: {
      type: Number,
      default: 0,
      min: 0,
    },

    shipping: {
      type: Number,
      default: 0,
      min: 0,
    },

    packaging: {
      type: Number,
      default: 0,
      min: 0,
    },

    misc: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: true,
    collection: "orderCosts",
  }
);

const OrderCosts =
  mongoose.models.OrderCosts ||
  mongoose.model("OrderCosts", orderCostsSchema);

export default OrderCosts;