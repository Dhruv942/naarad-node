const WatiNotificationService = require("../services/watiNotificationService");

/**
 * Send WATI notification for a news alert
 * Node equivalent of send_wati_notification()
 *
 * @param {string} userId - User UUID
 * @param {object} alertPayload - Contains alert_id and article (image, title, description)
 */
const sendWatiNotification = async (userId, alertPayload) => {
  try {
    const { alert_id, article, phone } = alertPayload;

    const result = await WatiNotificationService.sendNewsNotification(
      userId,
      alert_id,
      article,
      phone
    );

    return result;
  } catch (error) {
    console.error("sendWatiNotification error:", error.message);
    return {
      status: "error",
      code: 500,
      response: { message: error.message },
      message_sent: false,
      reason: error.message,
    };
  }
};

module.exports = {
  sendWatiNotification,
};
