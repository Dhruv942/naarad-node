/**
 * Gemini API Configuration
 * Gets API key from environment variables
 */
class GeminiConfig {
  static getApiKey() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not set in environment variables");
    }
    return apiKey;
  }

  static getModel() {
    return process.env.GEMINI_MODEL || "gemini-2.5-flash";
  }
}

module.exports = GeminiConfig;
