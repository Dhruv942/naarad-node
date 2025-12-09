const { body, param, validationResult } = require("express-validator");

// Validation for creating alert
const validateCreateAlert = [
  body("user_id")
    .notEmpty()
    .withMessage("user_id is required")
    .isString()
    .withMessage("user_id must be a string"),

  body("main_category")
    .notEmpty()
    .withMessage("main_category is required")
    .isIn(["Sports", "News", "Movies", "YouTube", "Custom_Input"])
    .withMessage(
      "main_category must be one of: Sports, News, Movies, YouTube, Custom_Input"
    ),

  body("sub_categories")
    .optional()
    .isArray()
    .withMessage("sub_categories must be an array")
    .custom((value) => {
      if (value && value.length > 0) {
        return value.every((item) => typeof item === "string");
      }
      return true;
    })
    .withMessage("sub_categories must be an array of strings"),

  body("followup_questions")
    .optional()
    .isArray()
    .withMessage("followup_questions must be an array")
    .custom((value) => {
      if (value && value.length > 0) {
        return value.every((item) => {
          return (
            typeof item === "object" &&
            item !== null &&
            typeof item.question === "string" &&
            (item.selected_answer === undefined ||
              item.selected_answer === null ||
              typeof item.selected_answer === "string") &&
            (item.options === undefined ||
              item.options === null ||
              (Array.isArray(item.options) &&
                item.options.every((opt) => typeof opt === "string")))
          );
        });
      }
      return true;
    })
    .withMessage(
      "followup_questions must be an array of objects with question (string), selected_answer (string, optional), and options (array of strings, optional)"
    ),

  body("custom_question")
    .optional()
    .isString()
    .withMessage("custom_question must be a string"),
];

// Validation for updating alert
const validateUpdateAlert = [
  body("sub_categories")
    .optional()
    .isArray()
    .withMessage("sub_categories must be an array"),

  body("followup_questions")
    .optional()
    .isArray()
    .withMessage("followup_questions must be an array")
    .custom((value) => {
      if (value && value.length > 0) {
        return value.every((item) => {
          return (
            typeof item === "object" &&
            item !== null &&
            typeof item.question === "string" &&
            (item.selected_answer === undefined ||
              item.selected_answer === null ||
              typeof item.selected_answer === "string") &&
            (item.options === undefined ||
              item.options === null ||
              (Array.isArray(item.options) &&
                item.options.every((opt) => typeof opt === "string")))
          );
        });
      }
      return true;
    })
    .withMessage(
      "followup_questions must be an array of objects with question (string), selected_answer (string, optional), and options (array of strings, optional)"
    ),

  body("is_active")
    .optional()
    .isBoolean()
    .withMessage("is_active must be a boolean"),

  body("main_category")
    .optional()
    .isIn(["Sports", "News", "Movies", "YouTube", "Custom_Input"])
    .withMessage(
      "main_category must be one of: Sports, News, Movies, YouTube, Custom_Input"
    ),

  body("custom_question")
    .optional()
    .isString()
    .withMessage("custom_question must be a string"),
];

// Validation for schedule update
const validateScheduleUpdate = [
  body("frequency")
    .optional()
    .isIn(["realtime", "hourly", "daily", "weekly"])
    .withMessage("frequency must be one of: realtime, hourly, daily, weekly"),

  body("time")
    .optional()
    .matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/)
    .withMessage("time must be in HH:MM format"),

  body("timezone")
    .optional()
    .isString()
    .withMessage("timezone must be a string"),

  body("days")
    .optional()
    .isArray()
    .withMessage("days must be an array")
    .custom((value) => {
      if (value && value.length > 0) {
        const validDays = [
          "monday",
          "tuesday",
          "wednesday",
          "thursday",
          "friday",
          "saturday",
          "sunday",
        ];
        return value.every((day) => validDays.includes(day.toLowerCase()));
      }
      return true;
    })
    .withMessage(
      "days must be an array of valid day names (monday, tuesday, etc.)"
    ),
];

// Validation for URL parameters
const validateParams = [
  param("user_id")
    .notEmpty()
    .withMessage("user_id is required")
    .isString()
    .withMessage("user_id must be a string"),

  param("alert_id")
    .notEmpty()
    .withMessage("alert_id is required")
    .isString()
    .withMessage("alert_id must be a string"),
];

// Validation for user_id only
const validateUserId = [
  param("user_id")
    .notEmpty()
    .withMessage("user_id is required")
    .isString()
    .withMessage("user_id must be a string"),
];

// Middleware to handle validation errors
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: errors.array(),
    });
  }
  next();
};

module.exports = {
  validateCreateAlert,
  validateUpdateAlert,
  validateScheduleUpdate,
  validateParams,
  validateUserId,
  handleValidationErrors,
};
