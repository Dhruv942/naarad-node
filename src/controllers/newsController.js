const PerplexityNewsFetcher = require("../services/perplexityNewsFetcher");
const ArticleFormatter = require("../services/articleFormatter");
const AlertIntent = require("../models/AlertIntent");
const Alert = require("../models/Alert");
const { sendWatiNotification } = require("./sendController");

/**
 * Get news for a specific alert
 * GET /news/alert/:alert_id
 */
const getNewsForAlert = async (req, res) => {
  try {
    const { alert_id } = req.params;
    let { user_id } = req.query; // Optional user_id from query, will auto-fetch from alert if not provided

    // Find alert intent from database
    const query = { alert_id: alert_id };
    if (user_id) {
      query.user_id = user_id;
    }

    const alertIntent = await AlertIntent.findOne(query);

    if (!alertIntent) {
      return res.status(404).json({
        success: false,
        message: "Alert intent not found. Please parse the alert intent first.",
      });
    }

    // Auto-fetch user_id from alert intent if not provided in query
    if (!user_id && alertIntent.user_id) {
      user_id = alertIntent.user_id;
      console.log(
        "[WATI][NEWS] Auto-fetched user_id from alert intent:",
        user_id
      );
    }

    // Check if required fields exist
    if (!alertIntent.perplexity_prompt || !alertIntent.perplexity_query) {
      return res.status(400).json({
        success: false,
        message:
          "Alert intent is missing perplexity_prompt or perplexity_query. Please parse the alert again.",
      });
    }

    // Convert to intent format for Perplexity fetcher
    const intent = {
      perplexity_query: alertIntent.perplexity_query,
      perplexity_prompt: alertIntent.perplexity_prompt,
      topic: alertIntent.topic,
      category: alertIntent.category,
      timeframe: alertIntent.timeframe,
    };

    // Fetch news from Perplexity
    const fetcher = new PerplexityNewsFetcher();
    const newsPayload = await fetcher.fetchNews(intent);

    // Get raw articles
    const rawArticles = newsPayload.articles || [];

    // Format articles using ArticleFormatter
    const formatter = new ArticleFormatter(3);
    const userIntentForFormatting = {
      topic: alertIntent.topic,
      category: alertIntent.category,
      intent_summary: alertIntent.intent_summary,
      subcategory: alertIntent.subcategory || [],
      followup_questions: alertIntent.followup_questions || [],
      timeframe: alertIntent.timeframe,
    };

    const formattedArticles = await formatter.formatArticles(
      rawArticles,
      userIntentForFormatting
    );

    // Optionally send WATI notification if user_id and at least one article exist
    let wati_result = null;
    if (user_id && formattedArticles && formattedArticles.length > 0) {
      try {
        const primaryArticle = formattedArticles[0];
        console.log("[WATI][NEWS] Attempting to send notification:", {
          user_id,
          alert_id,
          hasArticle: !!primaryArticle,
          title: primaryArticle.title?.substring(0, 50),
        });
        wati_result = await sendWatiNotification(user_id, {
          alert_id,
          article: {
            title: primaryArticle.title,
            description: primaryArticle.description,
            image_url: primaryArticle.image_url,
          },
          // phone can be resolved from DB using user_id inside service
          phone: null,
        });
        console.log("[WATI][NEWS] Notification result:", {
          status: wati_result?.status,
          reason: wati_result?.reason,
        });
      } catch (watiError) {
        console.error(
          "[WATI][NEWS] Error sending WATI notification:",
          watiError.message
        );
        wati_result = {
          status: "error",
          reason: watiError.message,
        };
      }
    } else {
      console.log("[WATI][NEWS] Skipping WATI notification:", {
        hasUserId: !!user_id,
        hasArticles: formattedArticles?.length > 0,
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        alert_id: alert_id,
        query: newsPayload.query,
        raw_articles: rawArticles,
        formatted_articles: formattedArticles,
        article_count: {
          raw: rawArticles.length,
          formatted: formattedArticles.length,
        },
        intent: {
          topic: alertIntent.topic,
          category: alertIntent.category,
          timeframe: alertIntent.timeframe,
        },
        wati_notification: wati_result,
      },
    });
  } catch (error) {
    console.error("Get news for alert error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
};

/**
 * Fetch news for alert (used in pipeline)
 * @param {string} alert_id - Alert ID
 * @param {string} user_id - User ID (optional)
 * @returns {Promise<Object>} News payload
 */
const fetchNewsForAlert = async (alert_id, user_id = null) => {
  try {
    // Find alert intent
    const query = { alert_id: alert_id };
    if (user_id) {
      query.user_id = user_id;
    }

    const alertIntent = await AlertIntent.findOne(query);

    if (!alertIntent) {
      throw new Error("Alert intent not found");
    }

    if (!alertIntent.perplexity_prompt || !alertIntent.perplexity_query) {
      throw new Error("Alert intent missing perplexity fields");
    }

    const intent = {
      perplexity_query: alertIntent.perplexity_query,
      perplexity_prompt: alertIntent.perplexity_prompt,
      topic: alertIntent.topic,
      category: alertIntent.category,
      timeframe: alertIntent.timeframe,
    };

    const fetcher = new PerplexityNewsFetcher();
    const newsPayload = await fetcher.fetchNews(intent);

    return newsPayload;
  } catch (error) {
    console.error("Fetch news for alert error:", error);
    throw error;
  }
};

module.exports = {
  getNewsForAlert,
  fetchNewsForAlert,
};
