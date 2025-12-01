const express = require("express");
const router = express.Router();
const {
  createAlert,
  getAlertsByUser,
  getScheduledAlerts,
  updateAlertById,
  pausedAlertById,
  updateAlertSchedule,
  deleteAlertById,
} = require("../controllers/alertController");
const { parseAlertIntent } = require("../controllers/intentController");
const {
  validateCreateAlert,
  validateUpdateAlert,
  validateScheduleUpdate,
  validateParams,
  validateUserId,
  handleValidationErrors,
} = require("../middleware/alertValidation");

/**
 * @route   POST /alerts/parse-intent
 * @desc    Parse alert intent from text (test endpoint)
 * @access  Public
 * Note: This route must come before /:user_id to avoid route conflicts
 */
router.post("/parse-intent", parseAlertIntent);

/**
 * @route   POST /alerts/
 * @desc    Create a new alert
 * @access  Public
 */
router.post("/", validateCreateAlert, handleValidationErrors, createAlert);

/**
 * @route   GET /alerts/active/all
 * @desc    Get all active alerts (for cron)
 * @access  Public
 * Note: This route must come before /:user_id to avoid route conflicts
 */
router.get("/active/all", getScheduledAlerts);

/**
 * @route   GET /alerts/:user_id
 * @desc    Get all alerts for a user
 * @access  Public
 */
router.get(
  "/:user_id",
  validateUserId,
  handleValidationErrors,
  getAlertsByUser
);

/**
 * @route   PUT /alerts/:user_id/:alert_id
 * @desc    Update alert fields
 * @access  Public
 */
router.put(
  "/:user_id/:alert_id",
  validateParams,
  validateUpdateAlert,
  handleValidationErrors,
  updateAlertById
);

/**
 * @route   PUT /alerts/:user_id/:alert_id/pause
 * @desc    Pause alert (set is_active to false)
 * @access  Public
 */
router.put(
  "/:user_id/:alert_id/pause",
  validateParams,
  handleValidationErrors,
  pausedAlertById
);

/**
 * @route   PUT /alerts/:user_id/:alert_id/schedule
 * @desc    Update alert schedule
 * @access  Public
 */
router.put(
  "/:user_id/:alert_id/schedule",
  validateParams,
  validateScheduleUpdate,
  handleValidationErrors,
  updateAlertSchedule
);

/**
 * @route   DELETE /alerts/:user_id/:alert_id
 * @desc    Delete alert
 * @access  Public
 */
router.delete(
  "/:user_id/:alert_id",
  validateParams,
  handleValidationErrors,
  deleteAlertById
);

module.exports = router;
