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

// Meta's "you are being throttled, wait and retry" signals — code 4
// (app-level), 17 (user-level, "too many calls"), 32 (page-level),
// 80004 (ad-account level — exactly the "There have been too many calls
// to this ad-account. Wait a bit and try again." error this route was
// hitting), 613 (custom/marketing API rate limit). Deliberately narrow:
// any other error (bad token, network failure, etc.) is not retried and
// fails on the first attempt, same as before.
function isMetaRateLimitError(errData) {
  const code = errData?.code;
  return code === 4 || code === 17 || code === 32 || code === 80004 || code === 613;
}

const RATE_LIMIT_RETRIES = 3;
const RATE_LIMIT_BASE_DELAY_MS = 4000;

function rateLimitDelayMs(attempt) {
  return Math.round(RATE_LIMIT_BASE_DELAY_MS * 2 ** attempt + Math.random() * 1000);
}

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

    // Fetch Meta ad accounts — retried with backoff on a rate-limit
    // response only; any other failure (bad token, network error)
    // throws straight to the catch block below on the first attempt,
    // exactly as before this retry loop existed.
    let response;
    for (let attempt = 0; ; attempt += 1) {
      try {
        response = await axios.get(
          "https://graph.facebook.com/v21.0/me/adaccounts",
          {
            params: {
              fields: "id,name,account_status,currency,timezone_name",
              access_token: accessToken,
              limit: 100,
            },
          }
        );
        break;
      } catch (err) {
        const errData = err.response?.data?.error;
        if (isMetaRateLimitError(errData) && attempt < RATE_LIMIT_RETRIES) {
          const delayMs = rateLimitDelayMs(attempt);
          console.warn(
            `Meta API rate limit on /adaccounts (code ${errData.code}) — retrying in ${Math.round(delayMs / 1000)}s (attempt ${attempt + 1}/${RATE_LIMIT_RETRIES})`
          );
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }
        throw err;
      }
    }

    res.json({
      success: true,
      adAccounts: response.data.data,
    });

  } catch (error) {
    console.error(
      "Ad Account Fetch Error:",
      error.response?.data || error.message
    );

    // rateLimited is additive — existing callers that only read
    // success/error keep working unchanged; a caller that wants to show
    // a friendlier "Meta is rate-limiting requests, try again shortly"
    // message can check this flag instead of parsing the error text.
    res.status(500).json({
      success: false,
      error: error.response?.data || error.message,
      rateLimited: isMetaRateLimitError(error.response?.data?.error),
    });
  }
});


export default router;