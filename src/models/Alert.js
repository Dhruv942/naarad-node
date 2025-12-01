const mongoose = require("mongoose");

const alertSchema = new mongoose.Schema(
  {
    alert_id: {
      type: String,
      required: true,
      unique: true,
    },
    user_id: {
      type: String,
      required: true,
      index: true,
    },
    main_category: {
      type: String,
      required: true,
      enum: ["Sports", "News", "Movies", "YouTube", "Custom_Input"],
    },
    sub_categories: {
      type: [String],
      default: null,
    },
    followup_questions: {
      type: [String],
      default: null,
    },
    custom_question: {
      type: String,
      default: null,
    },
    is_active: {
      type: Boolean,
      default: true,
    },
    schedule: {
      frequency: {
        type: String,
        enum: ["realtime", "hourly", "daily", "weekly"],
        default: "realtime",
      },
      time: {
        type: String,
        default: "09:00",
      },
      timezone: {
        type: String,
        default: "Asia/Kolkata",
      },
      days: {
        type: [String],
        default: null,
      },
    },
  },
  {
    timestamps: true,
  }
);

// Index for faster queries
alertSchema.index({ user_id: 1, is_active: 1 });
alertSchema.index({ is_active: 1 });

const Alert = mongoose.model("Alert", alertSchema, "alerts_collection");

module.exports = Alert;
