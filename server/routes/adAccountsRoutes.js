import express from "express";
import AdAccount from "../models/AdAccount.js";

const router = express.Router();

/**
 * GET /api/adaccounts/:tokenId
 * Fetch all ad accounts for a token
 */
router.get("/:tokenId", async (req, res) => {
  try {
    const { tokenId } = req.params;

    const adAccounts = await AdAccount.find({ tokenId })
      .select("-__v")
      .sort({ name: 1 });

    res.status(200).json(adAccounts);
  } catch (error) {
    console.error("Error fetching ad accounts:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch ad accounts.",
      error: error.message,
    });
  }
});






import Token from "../models/Token.js";
import axios from "axios";


router.get("/adaccounts/:tokenId", async (req, res) => {
  try {
    const { tokenId } = req.params;

    // Find token in MongoDB
    const tokenDoc = await Token.findById(tokenId);

    if (!tokenDoc) {
      return res.status(404).json({
        success: false,
        message: "Token not found",
      });
    }

    const accessToken = tokenDoc.accessToken;

    // Fetch Meta ad accounts
    const response = await axios.get(
      "https://graph.facebook.com/v21.0/me/adaccounts",
      {
        params: {
          fields: "id,name,account_status,currency,timezone_name",
          access_token: accessToken,
          limit: 100,
        },
      }
    );

    res.json({
      success: true,
      adAccounts: response.data.data,
    });

  } catch (error) {
    console.error(
      "Ad Account Fetch Error:",
      error.response?.data || error.message
    );

    res.status(500).json({
      success: false,
      error: error.response?.data || error.message,
    });
  }
});


export default router;