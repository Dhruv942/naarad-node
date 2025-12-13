const mongoose = require("mongoose");

const articleSchema = new mongoose.Schema(
  {
    alert_id: {
      type: String,
      required: true,
      index: true,
    },
    user_id: {
      type: String,
      required: true,
      index: true,
    },
    article_hash: {
      type: String,
      required: true,
    },
    content: {
      type: String,
      required: true,
    },
    intent_summary: {
      type: String,
      default: "",
    },
    category: {
      type: String,
      default: "",
    },
    subcategory: {
      type: [String],
      default: [],
    },
    timeframe: {
      type: String,
      default: "",
    },
    source: {
      type: String,
      default: "perplexity",
    },
  },
  {
    timestamps: true,
  }
);

// Avoid duplicate storage for the same alert + article_hash
articleSchema.index({ alert_id: 1, article_hash: 1 }, { unique: true });

module.exports = mongoose.model("Article", articleSchema);
