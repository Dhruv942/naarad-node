const crypto = require("crypto");
const Article = require("../models/Article");

/**
 * Save raw articles for an alert with deduplication.
 * @param {Array} rawArticles - articles returned by Perplexity (string or {article, article_hash})
 * @param {Object} context - { alert_id, user_id, intent_summary, category, subcategory, timeframe, source }
 * @returns {Promise<number>} count of saved/updated articles
 */
async function saveRawArticles(rawArticles, context = {}) {
  if (!Array.isArray(rawArticles) || rawArticles.length === 0) {
    return 0;
  }

  const {
    alert_id,
    user_id,
    intent_summary = "",
    category = "",
    subcategory = [],
    timeframe = "",
    source = "perplexity",
  } = context;

  if (!alert_id || !user_id) {
    console.warn("[ARTICLE_STORE] Missing alert_id or user_id, skipping save");
    return 0;
  }

  let savedCount = 0;

  for (const art of rawArticles) {
    try {
      const content =
        typeof art === "string"
          ? art
          : art?.article || art?.content || art?.text || "";

      if (!content || typeof content !== "string") {
        continue;
      }

      const article_hash =
        typeof art === "object" && art.article_hash
          ? art.article_hash
          : crypto.createHash("sha256").update(content).digest("hex");

      await Article.findOneAndUpdate(
        { alert_id, article_hash },
        {
          alert_id,
          user_id,
          article_hash,
          content,
          intent_summary,
          category,
          subcategory: Array.isArray(subcategory) ? subcategory : [],
          timeframe,
          source,
        },
        { upsert: true, new: true }
      );

      savedCount += 1;
    } catch (err) {
      console.error("[ARTICLE_STORE] Error saving article:", err.message);
    }
  }

  return savedCount;
}

module.exports = {
  saveRawArticles,
};




