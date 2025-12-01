const express = require("express");
const router = express.Router();
const {
  processUserAlertsAndStoreIntent,
} = require("../controllers/intentController");
const { getNewsForAlert } = require("../controllers/newsController");
const {
  validateUserId,
  handleValidationErrors,
} = require("../middleware/alertValidation");

/**
 * @route   POST /news/user/:user_id
 * @desc    Process user alerts, parse intent, and store in database
 * @access  Public
 * @note    This endpoint parses all active alerts for the user and stores their intents
 */
router.post(
  "/user/:user_id",
  validateUserId,
  handleValidationErrors,
  processUserAlertsAndStoreIntent
);

/**
 * @route   GET /news/alert/:alert_id
 * @desc    Get news for a specific alert
 * @access  Public
 * @query   user_id (optional) - for validation
 */
router.get("/alert/:alert_id", getNewsForAlert);

module.exports = router;
