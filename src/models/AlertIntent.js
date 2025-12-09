const mongoose = require("mongoose");

const alertIntentSchema = new mongoose.Schema(
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
    topic: {
      type: String,
      required: true,
    },
    category: {
      type: String,
      required: true,
    },
    subcategory: {
      type: [String],
      default: [],
    },
    custom_question: {
      type: String,
      default: null,
    },
    // Follow-ups as objects: {question, selected_answer, options[]}
    followup_questions: {
      type: [
        new mongoose.Schema(
          {
            question: { type: String, required: false },
            selected_answer: { type: String, required: false },
            options: { type: [String], default: [] },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
    intent_summary: {
      type: String,
      required: true,
    },
    timeframe: {
      type: String,
      enum: ["24hours", "3days", "1week", "1month"],
      default: "1week",
    },
    perplexity_query: {
      type: String,
      required: true,
    },
    perplexity_prompt: {
      type: String,
      required: true,
    },
    requires_live_data: {
      type: Boolean,
      default: false,
    },
    parsing_version: {
      type: String,
      default: "llm_intent_v2",
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for faster queries
alertIntentSchema.index({ user_id: 1, alert_id: 1 });
alertIntentSchema.index({ user_id: 1, requires_live_data: 1 });

const AlertIntent = mongoose.model(
  "AlertIntent",
  alertIntentSchema,
  "alert_intents_collection"
);

module.exports = AlertIntent;
