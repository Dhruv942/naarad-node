const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    user_id: {
      type: String,
      required: true,
      unique: true,
    },
    country_code: {
      type: String,
      required: true,
    },
    phone_number: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

// Create compound unique index on country_code + phone_number
userSchema.index({ country_code: 1, phone_number: 1 }, { unique: true });

// Static method to find user by country_code and phone_number
userSchema.statics.findByPhone = function (countryCode, phoneNumber) {
  return this.findOne({ country_code: countryCode, phone_number: phoneNumber });
};

const User = mongoose.model("User", userSchema, "users_collection");

module.exports = User;
