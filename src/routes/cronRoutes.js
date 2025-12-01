const express = require("express");
const router = express.Router();
const { triggerCronJob, getCronStatus } = require("../controllers/cronController");

/**
 * @route   POST /cron/trigger
 * @desc    Manually trigger cron job
 * @access  Public
 */
router.post("/trigger", triggerCronJob);

/**
 * @route   GET /cron/status
 * @desc    Get cron job status
 * @access  Public
 */
router.get("/status", getCronStatus);

module.exports = router;

