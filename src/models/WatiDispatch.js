const mongoose = require("mongoose");

const watiDispatchSchema = new mongoose.Schema(
  {
    user_id: {
      type: String,
      required: true,
      index: true,
    },
    alert_id: {
      type: String,
      required: false,
      index: true,
    },
    content_hash: {
      type: String,
      required: true,
      index: true,
    },
    template_name: {
      type: String,
      required: true,
    },
    broadcast_name: {
      type: String,
      required: true,
    },
    title: {
      type: String,
      required: true,
    },
    description: {
      type: String,
      required: true,
    },
    image_url: {
      type: String,
      required: false,
    },
    payload: {
      type: Object,
      required: true,
    },
    response: {
      type: Object,
      required: false,
    },
    message_sent: {
      type: Boolean,
      default: false,
    },
    reason: {
      type: String,
      required: false,
    },
  },
  {
    timestamps: { createdAt: "sent_at", updatedAt: "updated_at" },
  }
);

// Compound index for duplicate prevention
watiDispatchSchema.index({ user_id: 1, template_name: 1, content_hash: 1 });

const WatiDispatch = mongoose.model(
  "WatiDispatch",
  watiDispatchSchema,
  "wati_dispatch_collection"
);

module.exports = WatiDispatch;
