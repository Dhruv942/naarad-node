const axios = require("axios");
const crypto = require("crypto");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const WatiConfig = require("../config/watiConfig");
const GeminiConfig = require("../config/geminiConfig");
const WatiDispatch = require("../models/WatiDispatch");
const User = require("../models/User");

class WatiNotificationService {
  constructor() {
    this.accessToken = WatiConfig.ACCESS_TOKEN;
    this.baseUrl = WatiConfig.BASE_URL;

    // Initialize Gemini for similarity checking
    try {
      const apiKey = GeminiConfig.getApiKey();
      const modelName = GeminiConfig.getModel();
      this.genAI = new GoogleGenerativeAI(apiKey);
      this.geminiModel = this.genAI.getGenerativeModel({
        model: modelName,
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
        },
      });
      console.log("[WATI] Gemini initialized for similarity checking");
    } catch (error) {
      console.warn(
        "[WATI] Gemini not available for similarity checking:",
        error.message
      );
      this.geminiModel = null;
    }
  }

  /**
   * Normalize phone number to E.164 (without +)
   * @param {string} countryCode e.g. "+91"
   * @param {string} phoneNumber e.g. "9876543210"
   */
  normalizePhone(countryCode, phoneNumber) {
    console.log("[WATI][PHONE][DEBUG] normalizePhone input:", {
      countryCode,
      phoneNumber,
      countryCodeType: typeof countryCode,
      phoneNumberType: typeof phoneNumber,
    });

    const ccDigits = (countryCode || "").replace(/\D/g, "");
    const pnDigits = (phoneNumber || "").replace(/\D/g, "");

    console.log("[WATI][PHONE][DEBUG] After regex cleanup:", {
      ccDigits,
      pnDigits,
      ccDigitsLength: ccDigits.length,
      pnDigitsLength: pnDigits.length,
    });

    if (!ccDigits || !pnDigits) {
      console.warn("[WATI][PHONE][DEBUG] Missing digits:", {
        hasCcDigits: !!ccDigits,
        hasPnDigits: !!pnDigits,
      });
      return null;
    }

    const result = `${ccDigits}${pnDigits}`;
    console.log("[WATI][PHONE][DEBUG] Final normalized phone:", {
      result,
      length: result.length,
    });

    return result;
  }

  /**
   * Build template payload for WATI sendTemplateMessages
   */
  buildTemplatePayload({
    whatsappNumber,
    imageUrl,
    title,
    description,
    templateName,
    broadcastName,
    channelNumber,
  }) {
    const customParams = [
      { name: "1", value: imageUrl || "" },
      { name: "2", value: title || "" },
      // Send full description (no truncation); downstream template must handle size
      { name: "3", value: description || "" },
    ];

    const receiver = {
      whatsappNumber,
      customParams,
    };

    const payload = {
      receivers: [receiver],
      template_name: templateName,
      broadcast_name: broadcastName,
    };

    if (channelNumber) {
      payload.channel_number = channelNumber;
    }

    return payload;
  }

  /**
   * Compute content hash for duplicate prevention
   */
  computeContentHash({
    imageUrl,
    title,
    description,
    templateName,
    broadcastName,
  }) {
    const fingerprint = `${imageUrl || ""}|${title || ""}|${
      description || ""
    }|${templateName}|${broadcastName}`;
    return crypto
      .createHash("sha256")
      .update(fingerprint, "utf-8")
      .digest("hex");
  }

  /**
   * Check for duplicate dispatch based on formatted message content
   */
  async isDuplicate({ userId, templateName, contentHash }) {
    const existing = await WatiDispatch.findOne({
      user_id: userId,
      template_name: templateName,
      content_hash: contentHash,
    });
    return !!existing;
  }

  /**
   * Check for duplicate based on original article hash (same news, even if
   * title/description have changed).
   */
  async isDuplicateByArticle({ userId, templateName, articleHash }) {
    if (!articleHash) return false;

    const existing = await WatiDispatch.findOne({
      user_id: userId,
      template_name: templateName,
      article_hash: articleHash,
    });

    return !!existing;
  }

  /**
   * Level 3: Check for similar messages using Gemini AI
   * Compares current message with recent messages to detect semantic similarity
   */
  async isSimilarByGemini({
    userId,
    templateName,
    title,
    description,
    lookbackHours = 24,
    maxRecentMessages = 10,
  }) {
    if (!this.geminiModel) {
      console.log(
        "[WATI][SIMILARITY] Gemini not available, skipping similarity check"
      );
      return false;
    }

    try {
      // Fetch recent successful messages for this user (within lookback window)
      const lookbackDate = new Date();
      lookbackDate.setHours(lookbackDate.getHours() - lookbackHours);

      const recentMessages = await WatiDispatch.find({
        user_id: userId,
        template_name: templateName,
        message_sent: true,
        reason: "success",
        sent_at: { $gte: lookbackDate },
      })
        .sort({ sent_at: -1 })
        .limit(maxRecentMessages)
        .select("title description sent_at")
        .lean();

      if (recentMessages.length === 0) {
        console.log(
          "[WATI][SIMILARITY] No recent messages found for comparison"
        );
        return false;
      }

      // Build prompt for Gemini
      const previousMessagesText = recentMessages
        .map((msg, idx) => {
          return `${idx + 1}. Title: "${
            msg.title
          }"\n   Description: "${msg.description.substring(0, 200)}"`;
        })
        .join("\n\n");

      const prompt = `You are a duplicate message detector for news alerts.

CURRENT MESSAGE TO CHECK:
Title: "${title}"
Description: "${description}"

RECENT MESSAGES SENT TO THIS USER (last ${lookbackHours} hours):
${previousMessagesText}

TASK:
Determine if the CURRENT MESSAGE is semantically similar to ANY of the RECENT MESSAGES above.

Rules:
- Two messages are "similar" if they report the SAME news event/story, even if wording is different
- Examples of SIMILAR:
  * "Kohli 132-run knock edges India to 3-wicket win" vs "India clinch thriller, Kohli scores 132*"
  * "India win by 17 runs" vs "India seal 17-run victory"
- Examples of NOT SIMILAR:
  * Different matches/games
  * Different events
  * Different time periods

Return ONLY valid JSON:
{
  "is_similar": true/false,
  "similar_to_index": null or number (which recent message it's similar to, 1-indexed),
  "confidence": 0.0-1.0,
  "reason": "brief explanation"
}`;

      const result = await this.geminiModel.generateContent(prompt);
      const response = await result.response;
      const text = response.text();

      // Parse JSON response
      let parsed;
      try {
        const cleanedText = text
          .replace(/```json\n?/gi, "")
          .replace(/```\n?/g, "")
          .trim();
        parsed = JSON.parse(cleanedText);
      } catch (parseError) {
        console.error(
          "[WATI][SIMILARITY] Failed to parse Gemini response:",
          parseError.message
        );
        console.error(
          "[WATI][SIMILARITY] Raw response:",
          text.substring(0, 200)
        );
        return false; // Fail open - if Gemini fails, don't block the message
      }

      const isSimilar = parsed.is_similar === true && parsed.confidence >= 0.7;

      if (isSimilar) {
        console.log("[WATI][SIMILARITY] Similar message detected:", {
          userId,
          similarToIndex: parsed.similar_to_index,
          confidence: parsed.confidence,
          reason: parsed.reason,
        });
      }

      return isSimilar;
    } catch (error) {
      console.error(
        "[WATI][SIMILARITY] Error checking similarity with Gemini:",
        error.message
      );
      // Fail open - if Gemini fails, don't block the message
      return false;
    }
  }

  /**
   * Send template message (news alert)
   * @param {string} userId
   * @param {string} alertId
   * @param {object} article { image_url, title, description }
   * @param {object} phone { country_code, phone_number }
   * @returns {Promise<object>}
   */
  async sendNewsNotification(userId, alertId, article, phone) {
    try {
      console.log("[WATI][NEWS][DEBUG] Starting sendNewsNotification:", {
        userId,
        alertId,
        hasPhoneParam: !!phone,
        phoneParam: phone,
      });

      if (!this.accessToken || !this.baseUrl) {
        console.warn("[WATI][NEWS][DEBUG] Missing config:", {
          hasAccessToken: !!this.accessToken,
          hasBaseUrl: !!this.baseUrl,
        });
        return {
          status: "skipped",
          reason: "missing_config",
          message_sent: false,
        };
      }

      // Resolve user & phone if not provided
      let countryCode = phone?.country_code;
      let phoneNumber = phone?.phone_number;

      if (!countryCode || !phoneNumber) {
        console.log(
          "[WATI][NEWS][DEBUG] Phone not in param, fetching from DB:",
          {
            userId,
            query: { user_id: userId },
          }
        );

        const user = await User.findOne({ user_id: userId });

        console.log("[WATI][NEWS][DEBUG] User lookup result:", {
          found: !!user,
          userId,
          userData: user
            ? {
                user_id: user.user_id,
                country_code: user.country_code,
                phone_number: user.phone_number,
                email: user.email,
              }
            : null,
        });

        if (!user) {
          console.error("[WATI][NEWS][DEBUG] User not found in database:", {
            userId,
            collection: "users_collection",
          });
          return {
            status: "skipped",
            reason: "phone_missing",
            message_sent: false,
          };
        }

        countryCode = user.country_code;
        phoneNumber = user.phone_number;

        console.log("[WATI][NEWS][DEBUG] Extracted from user:", {
          countryCode,
          phoneNumber,
        });
      } else {
        console.log("[WATI][NEWS][DEBUG] Using phone from param:", {
          countryCode,
          phoneNumber,
        });
      }

      console.log("[WATI][NEWS][DEBUG] Normalizing phone:", {
        countryCode,
        phoneNumber,
        countryCodeType: typeof countryCode,
        phoneNumberType: typeof phoneNumber,
      });

      const whatsappNumber = this.normalizePhone(countryCode, phoneNumber);

      console.log("[WATI][NEWS][DEBUG] Normalized result:", {
        whatsappNumber,
        isValid: !!whatsappNumber,
        length: whatsappNumber?.length,
      });

      if (!whatsappNumber) {
        console.error("[WATI][NEWS][DEBUG] Phone normalization failed:", {
          countryCode,
          phoneNumber,
          reason: "normalizePhone returned null/empty",
        });
        return {
          status: "skipped",
          reason: "phone_missing",
          message_sent: false,
        };
      }

      const templateName = WatiConfig.TEMPLATE_NAME;
      const broadcastName = WatiConfig.BROADCAST_NAME;
      const channelNumber = WatiConfig.CHANNEL_NUMBER || undefined;

      const title = article?.title || "";
      const description = article?.description || "";
      const imageUrl = article?.image_url || article?.imageUrl || "";
      const articleHash = article?.article_hash || null;

      const contentHash = this.computeContentHash({
        imageUrl,
        title,
        description,
        templateName,
        broadcastName,
      });

      // Duplicate check – level 1: exact same formatted content
      const duplicate = await this.isDuplicate({
        userId,
        templateName,
        contentHash,
      });

      if (duplicate) {
        // Log skipped message in DB for tracking
        try {
          await WatiDispatch.create({
            user_id: userId,
            alert_id: alertId,
            content_hash: contentHash,
            article_hash: articleHash || undefined,
            template_name: templateName,
            broadcast_name: broadcastName,
            title,
            description,
            image_url: imageUrl,
            payload: {},
            response: {},
            message_sent: false,
            reason: "duplicate_message",
          });
        } catch (logError) {
          console.error(
            "[WATI][NEWS] Failed to log duplicate_message:",
            logError.message
          );
        }
        return {
          status: "skipped",
          reason: "duplicate_message",
          message_sent: false,
        };
      }

      // Duplicate check – level 2: same underlying article content
      const duplicateArticle = await this.isDuplicateByArticle({
        userId,
        templateName,
        articleHash,
      });

      if (duplicateArticle) {
        console.log(
          "[WATI][NEWS] Duplicate detected (Level 2 - same article):",
          {
            userId,
            alertId,
            articleHash,
          }
        );
        // Log skipped message in DB for tracking
        try {
          await WatiDispatch.create({
            user_id: userId,
            alert_id: alertId,
            content_hash: contentHash,
            article_hash: articleHash || undefined,
            template_name: templateName,
            broadcast_name: broadcastName,
            title,
            description,
            image_url: imageUrl,
            payload: {},
            response: {},
            message_sent: false,
            reason: "duplicate_article",
          });
        } catch (logError) {
          console.error(
            "[WATI][NEWS] Failed to log duplicate_article:",
            logError.message
          );
        }
        return {
          status: "skipped",
          reason: "duplicate_article",
          message_sent: false,
        };
      }

      // Duplicate check – level 3: Gemini-based semantic similarity
      const isSimilar = await this.isSimilarByGemini({
        userId,
        templateName,
        title,
        description,
        lookbackHours: 24, // Check last 24 hours
        maxRecentMessages: 10, // Compare with last 10 messages
      });

      if (isSimilar) {
        console.log(
          "[WATI][NEWS] Similar message detected (Level 3 - Gemini):",
          {
            userId,
            alertId,
            title: title.substring(0, 50),
          }
        );
        // Log skipped message in DB for tracking
        try {
          await WatiDispatch.create({
            user_id: userId,
            alert_id: alertId,
            content_hash: contentHash,
            article_hash: articleHash || undefined,
            template_name: templateName,
            broadcast_name: broadcastName,
            title,
            description,
            image_url: imageUrl,
            payload: {},
            response: {},
            message_sent: false,
            reason: "duplicate_similar",
          });
        } catch (logError) {
          console.error(
            "[WATI][NEWS] Failed to log duplicate_similar:",
            logError.message
          );
        }
        return {
          status: "skipped",
          reason: "duplicate_similar",
          message_sent: false,
        };
      }

      // Build payload
      const payload = this.buildTemplatePayload({
        whatsappNumber,
        imageUrl,
        title,
        description,
        templateName,
        broadcastName,
        channelNumber,
      });

      const url = `${this.baseUrl}/api/v1/sendTemplateMessages`;

      console.log("[WATI][NEWS] Sending news notification:", {
        userId,
        alertId,
        whatsappNumber,
        templateName,
        broadcastName,
        title: title.substring(0, 50),
      });

      const response = await axios.post(url, payload, {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
        },
      });

      // Log in DB
      const log = await WatiDispatch.create({
        user_id: userId,
        alert_id: alertId,
        content_hash: contentHash,
        article_hash: articleHash || undefined,
        template_name: templateName,
        broadcast_name: broadcastName,
        title,
        description,
        image_url: imageUrl,
        payload,
        response: response.data,
        message_sent: true,
        reason: "success",
      });

      return {
        status: "success",
        code: 200,
        response: response.data,
        message_sent: true,
        reason: "success",
        template_payload: payload,
        log_id: log._id,
      };
    } catch (error) {
      console.error(
        "WATI news notification error:",
        error.response?.data || error.message
      );

      // Attempt to log error
      try {
        await WatiDispatch.create({
          user_id: userId,
          alert_id: alertId,
          content_hash: "",
          template_name: WatiConfig.TEMPLATE_NAME,
          broadcast_name: WatiConfig.BROADCAST_NAME,
          title: article?.title || "",
          description: article?.description || "",
          image_url: article?.image_url || "",
          payload: {},
          response: error.response?.data || { message: error.message },
          message_sent: false,
          reason: "error",
        });
      } catch (logError) {
        console.error("Failed to log WATI dispatch error:", logError.message);
      }

      return {
        status: "error",
        code: error.response?.status || 500,
        response: error.response?.data || { message: error.message },
        message_sent: false,
        reason: error.message,
      };
    }
  }

  /**
   * Send welcome message for new user
   */
  async sendWelcomeMessage(user) {
    try {
      console.log("[WATI][WELCOME] Starting welcome send for user:", {
        user_id: user.user_id,
        country_code: user.country_code,
        phone_number: user.phone_number,
      });

      if (!this.accessToken || !this.baseUrl) {
        console.warn("[WATI][WELCOME] Missing config", {
          hasAccessToken: !!this.accessToken,
          hasBaseUrl: !!this.baseUrl,
        });
        return {
          status: "skipped",
          reason: "missing_config",
          message_sent: false,
        };
      }

      const whatsappNumber = this.normalizePhone(
        user.country_code,
        user.phone_number
      );

      if (!whatsappNumber) {
        console.warn("[WATI][WELCOME] Phone missing/invalid for user:", {
          user_id: user.user_id,
          country_code: user.country_code,
          phone_number: user.phone_number,
        });
        return {
          status: "skipped",
          reason: "phone_missing",
          message_sent: false,
        };
      }

      const templateName = WatiConfig.WELCOME_TEMPLATE;
      const broadcastName = WatiConfig.WELCOME_BROADCAST;
      const channelNumber = WatiConfig.CHANNEL_NUMBER || undefined;

      const payload = {
        receivers: [
          {
            whatsappNumber,
            customParams: [],
          },
        ],
        template_name: templateName,
        broadcast_name: broadcastName,
      };

      if (channelNumber) {
        payload.channel_number = channelNumber;
      }

      const url = `${this.baseUrl}/api/v1/sendTemplateMessages`;

      console.log("[WATI][WELCOME] Sending request:", {
        url,
        payload,
      });

      const response = await axios.post(url, payload, {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
        },
      });

      console.log("[WATI][WELCOME] Response:", response.data);

      return {
        status: "success",
        code: 200,
        response: response.data,
        message_sent: true,
        reason: "welcome_sent",
        template_payload: payload,
      };
    } catch (error) {
      console.error(
        "WATI welcome notification error:",
        error.response?.data || error.message
      );
      return {
        status: "error",
        code: error.response?.status || 500,
        response: error.response?.data || { message: error.message },
        message_sent: false,
        reason: error.message,
      };
    }
  }
}

module.exports = new WatiNotificationService();
