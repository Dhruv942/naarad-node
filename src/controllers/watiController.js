const WatiDispatch = require("../models/WatiDispatch");

/**
 * Get all WATI dispatches for a user
 * GET /wati/user/:user_id
 */
const getUserDispatches = async (req, res) => {
  try {
    const { user_id } = req.params;
    const { status, alert_id, limit = 50, skip = 0 } = req.query;

    const query = { user_id };

    // Filter by status (success, skipped, error)
    if (status) {
      if (status === "duplicate") {
        query.reason = "duplicate_message";
      } else if (status === "sent") {
        query.message_sent = true;
      } else if (status === "failed") {
        query.message_sent = false;
      }
    }

    // Filter by alert_id
    if (alert_id) {
      query.alert_id = alert_id;
    }

    const dispatches = await WatiDispatch.find(query)
      .sort({ sent_at: -1 })
      .limit(parseInt(limit))
      .skip(parseInt(skip));

    const total = await WatiDispatch.countDocuments(query);

    return res.status(200).json({
      success: true,
      data: {
        dispatches,
        total,
        limit: parseInt(limit),
        skip: parseInt(skip),
      },
    });
  } catch (error) {
    console.error("Get user dispatches error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
};

/**
 * Get duplicate messages for a user
 * GET /wati/user/:user_id/duplicates
 */
const getDuplicateMessages = async (req, res) => {
  try {
    const { user_id } = req.params;
    const { limit = 50, skip = 0 } = req.query;

    // Find all messages with duplicate reason
    const duplicates = await WatiDispatch.find({
      user_id,
      reason: "duplicate_message",
    })
      .sort({ sent_at: -1 })
      .limit(parseInt(limit))
      .skip(parseInt(skip));

    const total = await WatiDispatch.countDocuments({
      user_id,
      reason: "duplicate_message",
    });

    return res.status(200).json({
      success: true,
      data: {
        duplicates,
        total,
        limit: parseInt(limit),
        skip: parseInt(skip),
      },
    });
  } catch (error) {
    console.error("Get duplicate messages error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
};

/**
 * Get all dispatches for a specific alert
 * GET /wati/alert/:alert_id
 */
const getAlertDispatches = async (req, res) => {
  try {
    const { alert_id } = req.params;
    const { user_id } = req.query;

    const query = { alert_id };
    if (user_id) {
      query.user_id = user_id;
    }

    const dispatches = await WatiDispatch.find(query).sort({ sent_at: -1 });

    return res.status(200).json({
      success: true,
      data: {
        alert_id,
        dispatches,
        total: dispatches.length,
      },
    });
  } catch (error) {
    console.error("Get alert dispatches error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
};

/**
 * Check if a message would be duplicate
 * POST /wati/check-duplicate
 */
const checkDuplicate = async (req, res) => {
  try {
    const { user_id, alert_id, article, template_name, broadcast_name } =
      req.body;

    if (!user_id || !article) {
      return res.status(400).json({
        success: false,
        message: "user_id and article are required",
      });
    }

    const WatiNotificationService = require("../services/watiNotificationService");
    const WatiConfig = require("../config/watiConfig");

    const title = article.title || "";
    const description = article.description || "";
    const imageUrl = article.image_url || article.imageUrl || "";

    const templateName = template_name || WatiConfig.TEMPLATE_NAME;
    const broadcastName = broadcast_name || WatiConfig.BROADCAST_NAME;

    const contentHash = WatiNotificationService.computeContentHash({
      imageUrl,
      title,
      description,
      templateName,
      broadcastName,
    });

    const existing = await WatiDispatch.findOne({
      user_id,
      template_name: templateName,
      content_hash: contentHash,
    });

    return res.status(200).json({
      success: true,
      data: {
        is_duplicate: !!existing,
        content_hash: contentHash,
        existing_dispatch: existing
          ? {
              _id: existing._id,
              sent_at: existing.sent_at,
              message_sent: existing.message_sent,
              reason: existing.reason,
            }
          : null,
      },
    });
  } catch (error) {
    console.error("Check duplicate error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
};

/**
 * Get dispatch statistics for a user
 * GET /wati/user/:user_id/stats
 */
const getUserStats = async (req, res) => {
  try {
    const { user_id } = req.params;

    const [
      total,
      sent,
      skipped,
      duplicates,
      errors,
    ] = await Promise.all([
      WatiDispatch.countDocuments({ user_id }),
      WatiDispatch.countDocuments({ user_id, message_sent: true }),
      WatiDispatch.countDocuments({ user_id, message_sent: false }),
      WatiDispatch.countDocuments({
        user_id,
        reason: "duplicate_message",
      }),
      WatiDispatch.countDocuments({ user_id, reason: "error" }),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        user_id,
        stats: {
          total,
          sent,
          skipped,
          duplicates,
          errors,
          success_rate: total > 0 ? ((sent / total) * 100).toFixed(2) : 0,
        },
      },
    });
  } catch (error) {
    console.error("Get user stats error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
};

module.exports = {
  getUserDispatches,
  getDuplicateMessages,
  getAlertDispatches,
  checkDuplicate,
  getUserStats,
};

