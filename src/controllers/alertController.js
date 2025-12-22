const { v4: uuidv4 } = require("uuid");
const Alert = require("../models/Alert");
const cronService = require("../services/cronService");

/**
 * Create a new alert
 * POST /alerts/
 */
const createAlert = async (req, res) => {
  try {
    const {
      user_id,
      main_category,
      sub_categories,
      followup_questions,
      custom_question,
    } = req.body;

    // Check if this is the user's first alert
    const existingAlertsCount = await Alert.countDocuments({
      user_id: user_id,
    });
    const isFirstAlert = existingAlertsCount === 0;

    console.log(`[ALERT][CREATE] Creating alert for user ${user_id}:`, {
      isFirstAlert,
      existingAlertsCount,
    });

    console.log(`[ALERT][CREATE] Received data:`, {
      main_category,
      sub_categories,
      followup_questions_count: followup_questions?.length || 0,
      custom_question,
    });

    // Normalize followup_questions: map 'answers' to 'options' if needed
    let normalizedFollowupQuestions = null;
    if (followup_questions && Array.isArray(followup_questions) && followup_questions.length > 0) {
      console.log(`[ALERT][CREATE] Normalizing followup_questions...`);
      normalizedFollowupQuestions = followup_questions.map((fq, idx) => {
        const normalized = {
          question: fq.question || "",
          selected_answer: fq.selected_answer || "",
        };
        
        // Map 'answers' to 'options' if 'answers' exists but 'options' doesn't
        if (fq.answers && Array.isArray(fq.answers) && fq.answers.length > 0) {
          normalized.options = fq.answers;
          console.log(`[ALERT][CREATE] Mapped 'answers' to 'options' for question ${idx + 1}:`, fq.answers);
        } else if (fq.options && Array.isArray(fq.options)) {
          normalized.options = fq.options;
        } else {
          normalized.options = [];
        }
        
        return normalized;
      });
      console.log(`[ALERT][CREATE] Normalized followup_questions:`, JSON.stringify(normalizedFollowupQuestions, null, 2));
    }

    // Create new alert with defaults
    const newAlert = new Alert({
      alert_id: uuidv4(),
      user_id: user_id,
      main_category: main_category,
      sub_categories:
        sub_categories && sub_categories.length > 0 ? sub_categories : null,
      followup_questions: normalizedFollowupQuestions,
      custom_question: custom_question || null,
      is_active: true,
      schedule: {
        frequency: "realtime",
        time: "09:00",
        timezone: "Asia/Kolkata",
        days: null,
      },
    });

    const savedAlert = await newAlert.save();

    // If this is the first alert, process it immediately
    if (isFirstAlert) {
      console.log(
        `[ALERT][CREATE] First alert detected! Processing immediately for user ${user_id}`
      );

      // Process in background (don't block response)
      setImmediate(async () => {
        try {
          const alertForProcessing = {
            alert_id: savedAlert.alert_id,
            user_id: savedAlert.user_id,
            main_category: savedAlert.main_category,
            sub_categories: savedAlert.sub_categories,
            followup_questions: savedAlert.followup_questions,
            custom_question: savedAlert.custom_question,
          };

          console.log(
            `[ALERT][CREATE][IMMEDIATE] Starting immediate processing for alert ${savedAlert.alert_id}`
          );

          const result = await cronService.processAlert(alertForProcessing);

          console.log(
            `[ALERT][CREATE][IMMEDIATE] Immediate processing completed:`,
            {
              alert_id: savedAlert.alert_id,
              status: result.status,
              reason: result.reason || "N/A",
            }
          );
        } catch (immediateError) {
          console.error(
            `[ALERT][CREATE][IMMEDIATE] Error in immediate processing:`,
            immediateError.message
          );
        }
      });
    } else {
      console.log(
        `[ALERT][CREATE] Not first alert (count: ${
          existingAlertsCount + 1
        }). Will be processed by cron job.`
      );
    }

    return res.status(201).json({
      success: true,
      data: {
        alert_id: savedAlert.alert_id,
        user_id: savedAlert.user_id,
        main_category: savedAlert.main_category,
        sub_categories: savedAlert.sub_categories,
        followup_questions: savedAlert.followup_questions,
        custom_question: savedAlert.custom_question,
        is_active: savedAlert.is_active,
      },
      message: isFirstAlert
        ? "Alert created successfully! Your first news update is being sent now."
        : "Alert created successfully! You will receive updates via cron job.",
    });
  } catch (error) {
    console.error("Create alert error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Get all alerts for a user
 * GET /alerts/:user_id
 */
const getAlertsByUser = async (req, res) => {
  try {
    const { user_id } = req.params;

    const alerts = await Alert.find({ user_id: user_id }).sort({
      createdAt: -1,
    });

    const alertsResponse = alerts.map((alert) => ({
      alert_id: alert.alert_id,
      user_id: alert.user_id,
      main_category: alert.main_category,
      sub_categories: alert.sub_categories,
      followup_questions: alert.followup_questions,
      custom_question: alert.custom_question,
      is_active: alert.is_active,
    }));

    return res.status(200).json({
      success: true,
      data: alertsResponse,
    });
  } catch (error) {
    console.error("Get alerts by user error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Get all active alerts (for cron)
 * GET /alerts/active/all
 */
const getScheduledAlerts = async (req, res) => {
  try {
    const alerts = await Alert.find({ is_active: true }).sort({
      createdAt: -1,
    });

    const alertsResponse = alerts.map((alert) => ({
      alert_id: alert.alert_id,
      user_id: alert.user_id,
      main_category: alert.main_category,
      sub_categories: alert.sub_categories,
      followup_questions: alert.followup_questions,
      custom_question: alert.custom_question,
      is_active: alert.is_active,
    }));

    return res.status(200).json({
      success: true,
      data: alertsResponse,
    });
  } catch (error) {
    console.error("Get scheduled alerts error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Update alert by ID
 * PUT /alerts/:user_id/:alert_id
 */
const updateAlertById = async (req, res) => {
  try {
    const { user_id, alert_id } = req.params;
    const updateData = req.body;

    // Find alert
    const alert = await Alert.findOne({
      alert_id: alert_id,
      user_id: user_id,
    });

    if (!alert) {
      return res.status(404).json({
        success: false,
        message: "Alert not found",
      });
    }

    // Handle special cases for empty arrays
    if (updateData.sub_categories !== undefined) {
      if (
        Array.isArray(updateData.sub_categories) &&
        (updateData.sub_categories.length === 0 ||
          updateData.sub_categories.includes("No Preference"))
      ) {
        updateData.sub_categories = null;
      }
    }

    if (updateData.followup_questions !== undefined) {
      if (
        Array.isArray(updateData.followup_questions) &&
        updateData.followup_questions.length === 0
      ) {
        updateData.followup_questions = null;
      } else if (Array.isArray(updateData.followup_questions) && updateData.followup_questions.length > 0) {
        // Normalize followup_questions: map 'answers' to 'options' if needed
        updateData.followup_questions = updateData.followup_questions.map((fq) => {
          const normalized = {
            question: fq.question || "",
            selected_answer: fq.selected_answer || "",
          };
          
          // Map 'answers' to 'options' if 'answers' exists but 'options' doesn't
          if (fq.answers && Array.isArray(fq.answers) && fq.answers.length > 0) {
            normalized.options = fq.answers;
          } else if (fq.options && Array.isArray(fq.options)) {
            normalized.options = fq.options;
          } else {
            normalized.options = [];
          }
          
          return normalized;
        });
      }
    }

    // Update alert
    const updatedAlert = await Alert.findOneAndUpdate(
      { alert_id: alert_id, user_id: user_id },
      updateData,
      { new: true, runValidators: true }
    );

    return res.status(200).json({
      success: true,
      data: {
        alert_id: updatedAlert.alert_id,
        user_id: updatedAlert.user_id,
        main_category: updatedAlert.main_category,
        sub_categories: updatedAlert.sub_categories,
        followup_questions: updatedAlert.followup_questions,
        custom_question: updatedAlert.custom_question,
        is_active: updatedAlert.is_active,
      },
    });
  } catch (error) {
    console.error("Update alert error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Pause alert (set is_active to false)
 * PUT /alerts/:user_id/:alert_id/pause
 */
const pausedAlertById = async (req, res) => {
  try {
    const { user_id, alert_id } = req.params;

    const alert = await Alert.findOne({
      alert_id: alert_id,
      user_id: user_id,
    });

    if (!alert) {
      return res.status(404).json({
        success: false,
        message: "Alert not found",
      });
    }

    const updatedAlert = await Alert.findOneAndUpdate(
      { alert_id: alert_id, user_id: user_id },
      { is_active: false },
      { new: true }
    );

    return res.status(200).json({
      success: true,
      data: {
        alert_id: updatedAlert.alert_id,
        user_id: updatedAlert.user_id,
        main_category: updatedAlert.main_category,
        sub_categories: updatedAlert.sub_categories,
        followup_questions: updatedAlert.followup_questions,
        custom_question: updatedAlert.custom_question,
        is_active: updatedAlert.is_active,
      },
    });
  } catch (error) {
    console.error("Pause alert error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Activate alert (set is_active to true)
 * PUT /alerts/:user_id/:alert_id/activate
 */
const activateAlertById = async (req, res) => {
  try {
    const { user_id, alert_id } = req.params;

    const alert = await Alert.findOne({
      alert_id: alert_id,
      user_id: user_id,
    });

    if (!alert) {
      return res.status(404).json({
        success: false,
        message: "Alert not found",
      });
    }

    const updatedAlert = await Alert.findOneAndUpdate(
      { alert_id: alert_id, user_id: user_id },
      { is_active: true },
      { new: true }
    );

    return res.status(200).json({
      success: true,
      data: {
        alert_id: updatedAlert.alert_id,
        user_id: updatedAlert.user_id,
        main_category: updatedAlert.main_category,
        sub_categories: updatedAlert.sub_categories,
        followup_questions: updatedAlert.followup_questions,
        custom_question: updatedAlert.custom_question,
        is_active: updatedAlert.is_active,
      },
    });
  } catch (error) {
    console.error("Activate alert error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Update alert schedule
 * PUT /alerts/:user_id/:alert_id/schedule
 */
const updateAlertSchedule = async (req, res) => {
  try {
    const { user_id, alert_id } = req.params;
    const { frequency, time, days, timezone } = req.body;

    const alert = await Alert.findOne({
      alert_id: alert_id,
      user_id: user_id,
    });

    if (!alert) {
      return res.status(404).json({
        success: false,
        message: "Alert not found",
      });
    }

    // Update schedule fields
    const scheduleUpdate = {};
    if (frequency) scheduleUpdate["schedule.frequency"] = frequency;
    if (time) scheduleUpdate["schedule.time"] = time;
    if (timezone) scheduleUpdate["schedule.timezone"] = timezone;
    if (days !== undefined) {
      scheduleUpdate["schedule.days"] =
        Array.isArray(days) && days.length > 0 ? days : null;
    }

    const updatedAlert = await Alert.findOneAndUpdate(
      { alert_id: alert_id, user_id: user_id },
      scheduleUpdate,
      { new: true }
    );

    return res.status(200).json({
      success: true,
      data: {
        alert_id: updatedAlert.alert_id,
        user_id: updatedAlert.user_id,
        main_category: updatedAlert.main_category,
        sub_categories: updatedAlert.sub_categories,
        followup_questions: updatedAlert.followup_questions,
        custom_question: updatedAlert.custom_question,
        is_active: updatedAlert.is_active,
      },
    });
  } catch (error) {
    console.error("Update schedule error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Delete alert
 * DELETE /alerts/:user_id/:alert_id
 */
const deleteAlertById = async (req, res) => {
  try {
    const { user_id, alert_id } = req.params;

    const alert = await Alert.findOne({
      alert_id: alert_id,
      user_id: user_id,
    });

    if (!alert) {
      return res.status(404).json({
        success: false,
        message: "Alert not found",
      });
    }

    await Alert.findOneAndDelete({
      alert_id: alert_id,
      user_id: user_id,
    });

    return res.status(200).json({
      success: true,
      message: "Alert deleted successfully",
    });
  } catch (error) {
    console.error("Delete alert error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

module.exports = {
  createAlert,
  getAlertsByUser,
  getScheduledAlerts,
  updateAlertById,
  pausedAlertById,
  activateAlertById,
  updateAlertSchedule,
  deleteAlertById,
};
