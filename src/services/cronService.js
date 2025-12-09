const cron = require("node-cron");
const Alert = require("../models/Alert");
const AlertIntent = require("../models/AlertIntent");
const { parseAndStoreAlert } = require("../controllers/intentController");
const PerplexityNewsFetcher = require("./perplexityNewsFetcher");
const ArticleFormatter = require("./articleFormatter");
const { sendWatiNotification } = require("../controllers/sendController");

class CronService {
  constructor() {
    this.isRunning = false;
    this.lastRun = null;
    this.cronInterval = process.env.CRON_INTERVAL || "0 */6 * * *"; // Default: every 6 hours
    this.cronJob = null;
  }

  /**
   * Process a single alert: parse intent, fetch news, send WATI
   */
  async processAlert(alert) {
    try {
      const { alert_id, user_id } = alert;

      console.log(
        `[CRON][ALERT] Processing alert ${alert_id} for user ${user_id}`
      );

      // Step 1: Parse and store intent (if not exists or needs update)
      let alertIntent = await AlertIntent.findOne({
        alert_id: alert_id,
        user_id: user_id,
      });

      if (!alertIntent) {
        console.log(
          `[CRON][ALERT] Intent not found, parsing for alert ${alert_id}`
        );
        alertIntent = await parseAndStoreAlert(alert);
      } else {
        console.log(
          `[CRON][ALERT] Intent already exists for alert ${alert_id}`
        );
      }

      // Step 2: Check if required fields exist
      if (!alertIntent.perplexity_query) {
        console.warn(
          `[CRON][ALERT] Alert ${alert_id} missing perplexity_query, skipping`
        );
        return {
          alert_id,
          user_id,
          status: "skipped",
          reason: "missing_perplexity_query",
        };
      }

      // Step 3: Fetch news from Perplexity
      const intent = {
        perplexity_query: alertIntent.perplexity_query,
        topic: alertIntent.topic,
        category: alertIntent.category,
        subcategory: alertIntent.subcategory || [],
        followup_questions: alertIntent.followup_questions || [],
        custom_question: alertIntent.custom_question || "",
        timeframe: alertIntent.timeframe,
      };

      // Log SERP query source
      console.log(`[CRON][ALERT] SERP Query Source for alert ${alert_id}:`);
      console.log(
        `  📍 From Database (AlertIntent.perplexity_query): ${alertIntent.perplexity_query}`
      );
      console.log(`  📍 Perplexity Prompt: Built in PerplexityNewsFetcher`);
      console.log(`  📍 Alert Topic: ${alertIntent.topic}`);
      console.log(`  📍 Category: ${alertIntent.category}`);
      console.log(
        `  📍 Subcategory: ${JSON.stringify(alertIntent.subcategory || [])}`
      );
      console.log(
        `  📍 Custom Question: ${alertIntent.custom_question || "None"}`
      );

      const fetcher = new PerplexityNewsFetcher();
      const newsPayload = await fetcher.fetchNews(intent);
      const rawArticles = newsPayload.articles || [];

      if (rawArticles.length === 0) {
        console.log(`[CRON][ALERT] No articles found for alert ${alert_id}`);
        return {
          alert_id,
          user_id,
          status: "skipped",
          reason: "no_articles_found",
        };
      }

      // Step 4: Format articles
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

      if (formattedArticles.length === 0) {
        console.log(
          `[CRON][ALERT] No formatted articles for alert ${alert_id}`
        );
        return {
          alert_id,
          user_id,
          status: "skipped",
          reason: "no_formatted_articles",
        };
      }

      // Step 5: Send WATI notification (first article only)
      const primaryArticle = formattedArticles[0];
      let wati_result = null;

      try {
        wati_result = await sendWatiNotification(user_id, {
          alert_id,
          article: {
            title: primaryArticle.title,
            description: primaryArticle.description,
            image_url: primaryArticle.image_url,
            article_hash: primaryArticle.article_hash,
          },
          phone: null,
        });

        console.log(`[CRON][ALERT] WATI result for alert ${alert_id}:`, {
          status: wati_result?.status,
          reason: wati_result?.reason,
        });
      } catch (watiError) {
        console.error(
          `[CRON][ALERT] WATI error for alert ${alert_id}:`,
          watiError.message
        );
        wati_result = {
          status: "error",
          reason: watiError.message,
        };
      }

      return {
        alert_id,
        user_id,
        status: "success",
        articles_found: rawArticles.length,
        formatted_articles: formattedArticles.length,
        wati_notification: wati_result,
      };
    } catch (error) {
      console.error(
        `[CRON][ALERT] Error processing alert ${alert.alert_id}:`,
        error.message
      );
      return {
        alert_id: alert.alert_id,
        user_id: alert.user_id,
        status: "error",
        error: error.message,
      };
    }
  }

  /**
   * Process all active alerts
   */
  async processAllAlerts() {
    if (this.isRunning) {
      console.log("[CRON] Previous job still running, skipping this run");
      return;
    }

    this.isRunning = true;
    const startTime = new Date();
    console.log(`[CRON] Starting job at ${startTime.toISOString()}`);

    try {
      // Fetch all active alerts
      const activeAlerts = await Alert.find({ is_active: true }).lean();

      if (activeAlerts.length === 0) {
        console.log("[CRON] No active alerts found");
        this.isRunning = false;
        this.lastRun = new Date();
        return {
          success: true,
          processed: 0,
          skipped: 0,
          errors: 0,
        };
      }

      console.log(`[CRON] Found ${activeAlerts.length} active alerts`);

      // Group alerts by user_id to process efficiently
      const alertsByUser = {};
      activeAlerts.forEach((alert) => {
        if (!alertsByUser[alert.user_id]) {
          alertsByUser[alert.user_id] = [];
        }
        alertsByUser[alert.user_id].push(alert);
      });

      const results = {
        success: true,
        processed: 0,
        skipped: 0,
        errors: 0,
        details: [],
      };

      // Process alerts sequentially (to avoid overwhelming APIs)
      for (const [user_id, userAlerts] of Object.entries(alertsByUser)) {
        console.log(
          `[CRON] Processing ${userAlerts.length} alerts for user ${user_id}`
        );

        for (const alert of userAlerts) {
          const result = await this.processAlert(alert);

          if (result.status === "success") {
            results.processed++;
          } else if (result.status === "skipped") {
            results.skipped++;
          } else {
            results.errors++;
          }

          results.details.push(result);

          // Small delay between alerts to avoid rate limiting
          await new Promise((resolve) => setTimeout(resolve, 2000)); // 2 seconds
        }
      }

      const endTime = new Date();
      const duration = (endTime - startTime) / 1000; // seconds

      console.log(`[CRON] Job completed in ${duration}s:`, {
        processed: results.processed,
        skipped: results.skipped,
        errors: results.errors,
      });

      this.lastRun = endTime;
      this.isRunning = false;

      return results;
    } catch (error) {
      console.error("[CRON] Fatal error in job:", error);
      this.isRunning = false;
      this.lastRun = new Date();
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Start the cron job
   * Runs immediately on start, then schedules based on interval
   */
  start() {
    if (this.cronJob) {
      console.log("[CRON] Cron job already running");
      return;
    }

    console.log(`[CRON] Starting cron job with interval: ${this.cronInterval}`);

    // Run immediately on server start
    console.log("[CRON] Running initial job on server start...");
    this.processAllAlerts().catch((error) => {
      console.error("[CRON] Error in initial job:", error);
    });

    // Schedule recurring job
    this.cronJob = cron.schedule(this.cronInterval, async () => {
      await this.processAllAlerts();
    });

    console.log(
      "[CRON] Cron job started successfully (initial run completed, scheduled for recurring execution)"
    );
  }

  /**
   * Stop the cron job
   */
  stop() {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
      console.log("[CRON] Cron job stopped");
    }
  }

  /**
   * Get cron job status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      lastRun: this.lastRun,
      cronInterval: this.cronInterval,
      isScheduled: !!this.cronJob,
    };
  }
}

module.exports = new CronService();
