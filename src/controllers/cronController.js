const cronService = require("../services/cronService");

/**
 * Manually trigger cron job
 * POST /cron/trigger
 */
const triggerCronJob = async (req, res) => {
  try {
    if (cronService.isRunning) {
      return res.status(409).json({
        success: false,
        message: "Cron job is already running",
      });
    }

    // Run in background (don't wait for completion)
    cronService.processAllAlerts().catch((error) => {
      console.error("[CRON][MANUAL] Error in manual trigger:", error);
    });

    return res.status(200).json({
      success: true,
      message: "Cron job triggered successfully",
    });
  } catch (error) {
    console.error("Trigger cron job error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Get cron job status
 * GET /cron/status
 */
const getCronStatus = async (req, res) => {
  try {
    const status = cronService.getStatus();
    return res.status(200).json({
      success: true,
      data: status,
    });
  } catch (error) {
    console.error("Get cron status error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

module.exports = {
  triggerCronJob,
  getCronStatus,
};
