const express = require('express');
const router = express.Router();
const { login } = require('../controllers/authController');
const { validateLogin, handleValidationErrors } = require('../middleware/validation');

/**
 * @route   POST /auth/login
 * @desc    Login or register user
 * @access  Public
 * @body    { country_code: string, phone_number: string, email: string }
 * @returns { user_id: string, country_code: string, phone_number: string, email: string }
 */
router.post('/login', validateLogin, handleValidationErrors, login);

module.exports = router;

