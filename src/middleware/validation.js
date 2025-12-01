const { body, validationResult } = require('express-validator');

// Validation middleware for login route
const validateLogin = [
  body('country_code')
    .notEmpty()
    .withMessage('country_code is required')
    .isString()
    .withMessage('country_code must be a string')
    .matches(/^\+?\d+$/)
    .withMessage('country_code must be a valid format (e.g., "+91")'),
  
  body('phone_number')
    .notEmpty()
    .withMessage('phone_number is required')
    .isString()
    .withMessage('phone_number must be a string')
    .matches(/^\d+$/)
    .withMessage('phone_number must contain only digits'),
  
  body('email')
    .notEmpty()
    .withMessage('email is required')
    .isEmail()
    .withMessage('email must be a valid email address')
    .normalizeEmail(),
];

// Middleware to handle validation errors
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array(),
    });
  }
  next();
};

module.exports = {
  validateLogin,
  handleValidationErrors,
};

