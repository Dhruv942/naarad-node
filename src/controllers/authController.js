const { v4: uuidv4 } = require("uuid");
const User = require("../models/User");
const WatiNotificationService = require("../services/watiNotificationService");

/**
 * Login or Register user
 * Checks if user exists by country_code + phone_number
 * If existing: Updates email if changed, returns existing user_id
 * If new: Creates new user with UUID, returns new user_id
 * TODO: WATI welcome message integration to be added later
 */
const login = async (req, res) => {
  try {
    const { country_code, phone_number, email } = req.body;

    // Validate required fields
    if (!country_code || !phone_number || !email) {
      return res.status(400).json({
        success: false,
        message: "country_code, phone_number, and email are required",
      });
    }

    // Find existing user by country_code + phone_number
    const existingUser = await User.findByPhone(country_code, phone_number);

    if (existingUser) {
      // User exists - update email if changed
      let updatedUser = existingUser;

      if (existingUser.email !== email) {
        updatedUser = await User.findByIdAndUpdate(
          existingUser._id,
          { email: email },
          { new: true }
        );
      }

      // Return existing user (no welcome message)
      return res.status(200).json({
        success: true,
        data: {
          user_id: updatedUser.user_id,
          country_code: updatedUser.country_code,
          phone_number: updatedUser.phone_number,
          email: updatedUser.email,
        },
      });
    }

    // New user - create with UUID
    const newUser = new User({
      user_id: uuidv4(),
      country_code: country_code,
      phone_number: phone_number,
      email: email,
    });

    const savedUser = await newUser.save();

    // Send welcome WhatsApp message via WATI (non-blocking)
    WatiNotificationService.sendWelcomeMessage(savedUser).catch((err) => {
      console.error("Failed to send WATI welcome message:", err.message);
    });

    // Return new user
    return res.status(201).json({
      success: true,
      data: {
        user_id: savedUser.user_id,
        country_code: savedUser.country_code,
        phone_number: savedUser.phone_number,
        email: savedUser.email,
      },
    });
  } catch (error) {
    console.error("Login error:", error);

    // Handle duplicate key error (if unique constraint is violated)
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "User with this phone number already exists",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

module.exports = {
  login,
};
