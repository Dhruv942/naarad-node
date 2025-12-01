const LLMIntentParser = require("../services/llmIntentParser");
const AlertIntent = require("../models/AlertIntent");
const Alert = require("../models/Alert");

/**
 * Parse alert intent from text or user_id + alert_id
 * POST /alerts/parse-intent
 * Body: { alert_text: "..." } OR { user_id: "...", alert_id: "..." }
 */
const parseAlertIntent = async (req, res) => {
  try {
    const { alert_text, user_id, alert_id } = req.body;

    let alertData;

    // If user_id and alert_id provided, fetch alert from database
    if (user_id && alert_id) {
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

      // Convert alert to alert_data format
      alertData = {
        topic: alert.main_category,
        category: alert.main_category,
        subcategories: alert.sub_categories || [],
        followup_questions: alert.followup_questions || [],
        custom_question: alert.custom_question || "",
        alert_id: alert.alert_id,
      };
    } else if (alert_text) {
      // Use alert_text if provided
      alertData = {
        topic: "General",
        category: "General",
        subcategories: [],
        followup_questions: [],
        custom_question: alert_text,
      };
    } else {
      return res.status(400).json({
        success: false,
        message: "Either alert_text or (user_id + alert_id) is required",
      });
    }

    // Parse intent
    const parser = new LLMIntentParser();
    const intent = await parser.parseIntent(alertData);

    // Validate timeframe
    const validTimeframes = ["24hours", "3days", "1week", "1month"];
    if (!validTimeframes.includes(intent.timeframe)) {
      intent.timeframe = "1week";
    }

    // Store parsed intent in database if user_id and alert_id are available
    if (user_id && alert_id) {
      const intentData = {
        alert_id: alert_id,
        user_id: user_id,
        topic: intent.topic,
        category: intent.category,
        subcategory: intent.subcategory || [],
        custom_question: intent.custom_question || null,
        followup_questions: intent.followup_questions || [],
        intent_summary: intent.intent_summary,
        timeframe: intent.timeframe,
        perplexity_query: intent.perplexity_query,
        perplexity_prompt: intent.perplexity_prompt,
        requires_live_data: intent.requires_live_data || false,
        parsing_version: "llm_intent_v2",
      };

      // Upsert (update if exists, create if not)
      const savedIntent = await AlertIntent.findOneAndUpdate(
        { alert_id: alert_id, user_id: user_id },
        intentData,
        { upsert: true, new: true }
      );

      return res.status(200).json({
        success: true,
        message: "Intent parsed and stored successfully",
        data: {
          intent: intent,
          stored_intent: savedIntent,
        },
      });
    }

    // If only alert_text provided, return without storing
    return res.status(200).json({
      success: true,
      message: "Intent parsed successfully (not stored - provide user_id and alert_id to store)",
      data: intent,
    });
  } catch (error) {
    console.error("Parse alert intent error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Process user alerts and store intent
 * GET /news/user/:user_id
 */
const processUserAlertsAndStoreIntent = async (req, res) => {
  try {
    const { user_id } = req.params;

    // Get all active alerts for user
    const alerts = await Alert.find({
      user_id: user_id,
      is_active: true,
    });

    if (alerts.length === 0) {
      return res.status(200).json({
        success: true,
        message: "No active alerts found for user",
        data: [],
      });
    }

    const parser = new LLMIntentParser();
    const results = [];

    // Process each alert
    for (const alert of alerts) {
      try {
        // Convert alert to alert_data format
        const alertData = {
          topic: alert.main_category,
          category: alert.main_category,
          subcategories: alert.sub_categories || [],
          followup_questions: alert.followup_questions || [],
          custom_question: alert.custom_question || "",
          alert_id: alert.alert_id,
        };

        // Parse intent
        const intent = await parser.parseIntent(alertData);

        // Store or update in database
        const intentData = {
          alert_id: alert.alert_id,
          user_id: user_id,
          topic: intent.topic,
          category: intent.category,
          subcategory: intent.subcategory || [],
          custom_question: intent.custom_question || null,
          followup_questions: intent.followup_questions || [],
          intent_summary: intent.intent_summary,
          timeframe: intent.timeframe,
          perplexity_query: intent.perplexity_query,
          perplexity_prompt: intent.perplexity_prompt,
          requires_live_data: intent.requires_live_data || false,
          parsing_version: "llm_intent_v2",
        };

        // Upsert (update if exists, create if not)
        const savedIntent = await AlertIntent.findOneAndUpdate(
          { alert_id: alert.alert_id, user_id: user_id },
          intentData,
          { upsert: true, new: true }
        );

        results.push({
          alert_id: alert.alert_id,
          intent: savedIntent,
        });
      } catch (alertError) {
        console.error(
          `Error processing alert ${alert.alert_id}:`,
          alertError.message
        );
        results.push({
          alert_id: alert.alert_id,
          error: alertError.message,
        });
      }
    }

    return res.status(200).json({
      success: true,
      message: `Processed ${results.length} alerts`,
      data: results,
    });
  } catch (error) {
    console.error("Process user alerts error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Parse and store intent for a single alert
 * Used in news pipeline
 */
const parseAndStoreAlert = async (alert) => {
  try {
    const parser = new LLMIntentParser();

    const alertData = {
      topic: alert.main_category,
      category: alert.main_category,
      subcategories: alert.sub_categories || [],
      followup_questions: alert.followup_questions || [],
      custom_question: alert.custom_question || "",
      alert_id: alert.alert_id,
    };

    const intent = await parser.parseIntent(alertData);

    const intentData = {
      alert_id: alert.alert_id,
      user_id: alert.user_id,
      topic: intent.topic,
      category: intent.category,
      subcategory: intent.subcategory || [],
      custom_question: intent.custom_question || null,
      followup_questions: intent.followup_questions || [],
      intent_summary: intent.intent_summary,
      timeframe: intent.timeframe,
      perplexity_query: intent.perplexity_query,
      perplexity_prompt: intent.perplexity_prompt,
      requires_live_data: intent.requires_live_data || false,
      parsing_version: "llm_intent_v2",
    };

    const savedIntent = await AlertIntent.findOneAndUpdate(
      { alert_id: alert.alert_id, user_id: alert.user_id },
      intentData,
      { upsert: true, new: true }
    );

    return savedIntent;
  } catch (error) {
    console.error("Parse and store alert error:", error);
    throw error;
  }
};

module.exports = {
  parseAlertIntent,
  processUserAlertsAndStoreIntent,
  parseAndStoreAlert,
};
