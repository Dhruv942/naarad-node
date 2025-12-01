const express = require("express");
const router = express.Router();
const {
  getUserDispatches,
  getDuplicateMessages,
  getAlertDispatches,
  checkDuplicate,
  getUserStats,
} = require("../controllers/watiController");
const {
  validateUserId,
  handleValidationErrors,
} = require("../middleware/alertValidation");

/**
 * @route   GET /wati/user/:user_id
 * @desc    Get all WATI dispatches for a user
 * @query   status (optional): "sent" | "failed" | "duplicate"
 * @query   alert_id (optional): Filter by alert_id
 * @query   limit (optional): Default 50
 * @query   skip (optional): Default 0
 */
router.get(
  "/user/:user_id",
  validateUserId,
  handleValidationErrors,
  getUserDispatches
);

/**
 * @route   GET /wati/user/:user_id/duplicates
 * @desc    Get all duplicate messages for a user
 * @query   limit (optional): Default 50
 * @query   skip (optional): Default 0
 */
router.get(
  "/user/:user_id/duplicates",
  validateUserId,
  handleValidationErrors,
  getDuplicateMessages
);

/**
 * @route   GET /wati/user/:user_id/stats
 * @desc    Get WATI dispatch statistics for a user
 */
router.get(
  "/user/:user_id/stats",
  validateUserId,
  handleValidationErrors,
  getUserStats
);

/**
 * @route   GET /wati/alert/:alert_id
 * @desc    Get all dispatches for a specific alert
 * @query   user_id (optional): Filter by user_id
 */
router.get("/alert/:alert_id", getAlertDispatches);

/**
 * @route   POST /wati/check-duplicate
 * @desc    Check if a message would be duplicate before sending
 * @body    { user_id, alert_id, article: { title, description, image_url }, template_name?, broadcast_name? }
 */
router.post("/check-duplicate", checkDuplicate);

module.exports = router;

