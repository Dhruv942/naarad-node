const { GoogleGenerativeAI } = require("@google/generative-ai");
const GeminiConfig = require("../config/geminiConfig");
const ImageSearchService = require("./imageSearchService");

class ArticleFormatter {
  constructor(maxArticles = 3, model = null, maxPromptChars = 1500) {
    this.maxArticles = maxArticles;
    this.modelName = model || GeminiConfig.getModel();
    this.maxPromptChars = maxPromptChars;
    this.apiKey = GeminiConfig.getApiKey();

    // Initialize image search service (optional - won't fail if not configured)
    try {
      this.imageSearchService = new ImageSearchService();
    } catch (error) {
      console.warn("Image search service not available:", error.message);
      this.imageSearchService = null;
    }

    this.genAI = new GoogleGenerativeAI(this.apiKey);
    this.model = this.genAI.getGenerativeModel({
      model: this.modelName,
      generationConfig: {
        temperature: 0.3,
        responseMimeType: "application/json",
      },
      safetySettings: [
        {
          category: "HARM_CATEGORY_HARASSMENT",
          threshold: "BLOCK_NONE",
        },
        {
          category: "HARM_CATEGORY_HATE_SPEECH",
          threshold: "BLOCK_NONE",
        },
        {
          category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
          threshold: "BLOCK_NONE",
        },
        {
          category: "HARM_CATEGORY_DANGEROUS_CONTENT",
          threshold: "BLOCK_NONE",
        },
      ],
    });
  }

  /**
   * Fallback formatting when Gemini fails
   */
  _fallback(articleText) {
    if (!articleText || typeof articleText !== "string") {
      return {
        title: "News Update",
        description: "Latest news update available.",
      };
    }

    const sentences = articleText
      .split(/[.!?]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    // Title: First sentence (up to 80 chars)
    const title = sentences[0]
      ? sentences[0].substring(0, 80).trim()
      : "News Update";

    // Description: First 3 sentences (up to 200 chars)
    const description = sentences
      .slice(0, 3)
      .join(" ")
      .substring(0, 200)
      .trim();

    return {
      title: title,
      description: description || "Latest news update available.",
    };
  }

  /**
   * Build formatting prompt
   */
  _buildFormattingPrompt(articleText, userIntent = null) {
    let prompt = `Rewrite the following full article into a premium "Naarad short update".\n\n`;

    if (userIntent && userIntent.intent_summary) {
      prompt += `User Context: ${userIntent.intent_summary}\n\n`;
    }

    // Truncate if too big
    let articleForPrompt = articleText;
    if (articleForPrompt.length > this.maxPromptChars) {
      articleForPrompt =
        articleForPrompt.substring(0, this.maxPromptChars) + "...";
    }

    prompt += `
### TITLE RULES (sexy, modern, premium clickbait)
- Max 10–12 words.
- Always start with MATCH RESULT + MARGIN.
- NEVER begin with a player name.
- MUST contain a “tension/drama/action” word like:
  “thriller”, “stunner”, “nail-biter”, “dramatic finish”, “sealed”, “edge”.

- Include:
  - match result,
  - margin,
  - match type/format,
  - opponent.


- Avoid generic headlines like:
  “India win ODI” or “India beat SA easily”.

- MUST include numbers EXACTLY as they appear.
- Tone: crisp + high-energy + engaging + modern.


Avoid boring titles like:
- "Match report on India vs Pakistan"
- "Company announces launch of new product"

### DESCRIPTION RULES (65–85 words)
- Must read like premium, human written news.
- Keep the tone punchy, modern and casual.
- Keep 2–3 key insights, NOT full summary.
- CRITICAL: Preserve ALL numbers, dates, metrics and special words exactly.
- Must highlight:
  - what happened,
  - why it matters,
  - what changed or what's next,
  - any crucial twist or surprise.
- Include names, scores, rankings, deals, performance details.
- No corporate style or robotic tone.
- NO generic template sentences.

### STRICT FORMAT:
Return ONLY valid JSON:
{
  "title": "<sexy crisp short title>",
  "description": "<modern human 65–85 word summary>"
}

NO markdown, NO commentary, NO formatting tags.
Never change or round numbers.

### ARTICLE:
${articleForPrompt}
`;

    return prompt;
  }

  /**
   * Generate formatted article using Gemini
   */
  async _generateWithGemini(articleText, userIntent = null) {
    try {
      const prompt = this._buildFormattingPrompt(articleText, userIntent);

      const result = await this.model.generateContent(prompt);
      const response = await result.response;

      // Check for blocking
      if (response.promptFeedback) {
        const blockReason = response.promptFeedback.blockReason;
        if (blockReason && blockReason !== "BLOCK_REASON_UNSPECIFIED") {
          console.warn(
            `Gemini blocked response: ${blockReason}. Using fallback.`
          );
          return this._fallback(articleText);
        }
      }

      const text = response.text();
      if (!text || text.trim().length === 0) {
        console.warn("Empty response from Gemini. Using fallback.");
        return this._fallback(articleText);
      }

      // Parse JSON
      try {
        const cleanedText = text
          .replace(/```json\n?/gi, "")
          .replace(/```\n?/g, "")
          .trim();

        const parsed = JSON.parse(cleanedText);

        // Validate structure
        if (!parsed.title || !parsed.description) {
          console.warn("Invalid JSON structure. Using fallback.");
          return this._fallback(articleText);
        }

        return {
          title: parsed.title.trim(),
          description: parsed.description.trim(),
        };
      } catch (parseError) {
        console.error("JSON parse error:", parseError.message);
        console.error("Response preview:", text.substring(0, 200));
        return this._fallback(articleText);
      }
    } catch (error) {
      console.error("Gemini formatting error:", error);
      return this._fallback(articleText);
    }
  }

  /**
   * Build rating prompt for raw articles (before formatting)
   * Dynamic prompt based on user preferences (category, subcategory, follow-up questions, custom question)
   */
  _buildArticleRatingPrompt(articleText, alertIntent) {
    // Build dynamic prompt
    let prompt = `You are Naarad, an intelligent news curation and relevance-rating engine.\n\n`;
    prompt += `Goal:\n`;
    prompt += `Determine how relevant a given news article is for a user based on their explicit preferences, and assign a single relevance rating.\n\n`;

    prompt += `🔹 User Preference Context\n\n`;

    // Category
    if (alertIntent?.category) {
      prompt += `Category: ${alertIntent.category}\n`;
    }

    // Subcategory
    if (
      alertIntent?.subcategory &&
      Array.isArray(alertIntent.subcategory) &&
      alertIntent.subcategory.length > 0
    ) {
      prompt += `Subcategory: ${alertIntent.subcategory
        .filter(Boolean)
        .join(", ")}\n`;
    }

    // Follow-up Questions
    if (
      alertIntent?.followup_questions &&
      Array.isArray(alertIntent.followup_questions) &&
      alertIntent.followup_questions.length > 0
    ) {
      prompt += `\nFollow-up Questions & Selections:\n`;
      alertIntent.followup_questions.forEach((fq, idx) => {
        if (fq && typeof fq === "object") {
          prompt += `${idx + 1}. Question: ${fq.question || "N/A"}\n`;
          if (Array.isArray(fq.options) && fq.options.length > 0) {
            prompt += `   Options: ${fq.options.join(", ")}\n`;
          }
          prompt += `   Selected Answer: ${fq.selected_answer || "N/A"}\n\n`;
        } else if (typeof fq === "string") {
          prompt += `${idx + 1}. ${fq}\n\n`;
        }
      });
    }

    // Custom Question
    if (alertIntent?.custom_question) {
      prompt += `Custom Question/Interests: ${alertIntent.custom_question}\n`;
    }

    // Intent Summary (if available)
    if (alertIntent?.intent_summary) {
      prompt += `\nIntent Summary: ${alertIntent.intent_summary}\n`;
    }

    prompt += `\n🔹 Instructions\n\n`;
    prompt += `1. Read the entire article carefully.\n`;
    prompt += `2. Evaluate alignment with the user's preferences (category, subcategory, follow-up question selections, and custom question).\n`;
    prompt += `3. Consider if the article is "Interesting Trivia" - fascinating topics, techc\n`;
    prompt += `4. Rate the article on a scale of 1 to 10.\n`;
    prompt += `5. Justify the rating using clear, concise reasoning.\n`;
    prompt += `6. Do not assume or fabricate information.\n\n`;

    prompt += `🔹 Scoring Logic (Internal – do not expose)\n\n`;
    prompt += `- Strong alignment with category and subcategory increases score.\n`;
    prompt += `- Match with follow-up question selections significantly boosts score.\n`;
    prompt += `- Relevance to custom question/interests adds value.\n`;
    prompt += `- Detailed information, stats, or key developments increase relevance.\n`;
    prompt += `- Interesting Trivia: Articles about interesting/fascinating topics, tech launches (like AI models, new products), discoveries, or trivia-worthy news should be rated highly if they match user interests.\n`;
    prompt += `  Examples: "Google Gemini model 3 launches", "New AI breakthrough", "Interesting scientific discovery", etc.\n`;
    prompt += `- Absence of these elements lowers the score proportionally.\n`;
    prompt += `- Only articles with rating >= 9 will be selected.\n\n`;

    prompt += `\nRAW ARTICLE TO RATE:\n${articleText.substring(0, 2000)}\n\n`;

    prompt += `Return ONLY valid JSON:\n`;
    prompt += `{\n`;
    prompt += `  "rating": <number 1-10>,\n`;
    prompt += `  "reason": "<brief explanation of rating>"\n`;
    prompt += `}\n`;

    return prompt;
  }

  /**
   * Rate raw article before formatting (gatekeeping)
   * Returns rating 0-10, only proceed if >= 9
   */
  async _rateArticleBeforeFormatting(articleText, alertIntent) {
    try {
      if (!articleText || articleText.trim().length === 0) {
        return {
          rating: 0,
          reason: "Empty article text",
          shouldProceed: false,
        };
      }

      if (!alertIntent) {
        return {
          rating: 10,
          reason: "No intent to compare against",
          shouldProceed: true,
        };
      }

      const prompt = this._buildArticleRatingPrompt(articleText, alertIntent);
      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();

      if (!text || text.trim().length === 0) {
        return {
          rating: 10,
          reason: "Rating service unavailable",
          shouldProceed: true,
        };
      }

      try {
        const cleanedText = text
          .replace(/```json\n?/gi, "")
          .replace(/```\n?/g, "")
          .trim();

        const parsed = JSON.parse(cleanedText);
        const rating = typeof parsed.rating === "number" ? parsed.rating : 0;
        const reason = parsed.reason || "No reason provided";
        const shouldProceed = rating >= 9;

        return {
          rating,
          reason,
          shouldProceed,
        };
      } catch (parseError) {
        // Fail open - allow article if parsing fails
        return {
          rating: 10,
          reason: "Rating parse error",
          shouldProceed: true,
        };
      }
    } catch (error) {
      // Fail open - allow article on error
      return {
        rating: 10,
        reason: "Rating service error",
        shouldProceed: true,
      };
    }
  }

  /**
   * Build gatekeeping prompt
   */
  _buildGatekeepingPrompt(formattedArticles, userIntent) {
    let prompt = `You are a gatekeeper for "Naarad" news updates. Review the following formatted articles and decide if they match the user's intent.\n\n`;

    if (userIntent && userIntent.intent_summary) {
      prompt += `User Intent: ${userIntent.intent_summary}\n\n`;
    }

    prompt += `Formatted Articles:\n`;
    formattedArticles.forEach((article, index) => {
      prompt += `${index + 1}. Title: ${article.title}\n`;
      prompt += `   Description: ${article.description}\n\n`;
    });

    prompt += `Rules:\n`;
    prompt += `- Return ONLY valid JSON array.\n`;
    prompt += `- Include articles that match user intent.\n`;
    prompt += `- Exclude articles that are irrelevant, outdated, or don't match the intent.\n`;
    prompt += `- For each included article, add a "gatekeeper_reason" field explaining why it was selected.\n`;
    prompt += `- Return empty array [] if no articles match.\n\n`;

    prompt += `Return format:\n`;
    prompt += `[\n`;
    prompt += `  {\n`;
    prompt += `    "title": "...",\n`;
    prompt += `    "description": "...",\n`;
    prompt += `    "gatekeeper_reason": "Why this was selected"\n`;
    prompt += `  }\n`;
    prompt += `]\n`;

    return prompt;
  }

  /**
   * Gatekeeping stage - filter articles based on user intent
   */
  async _gatekeepArticles(formattedArticles, userIntent) {
    try {
      if (formattedArticles.length === 0) {
        return [];
      }

      const prompt = this._buildGatekeepingPrompt(
        formattedArticles,
        userIntent
      );

      const result = await this.model.generateContent(prompt);
      const response = await result.response;

      const text = response.text();
      if (!text || text.trim().length === 0) {
        console.warn("Empty gatekeeping response. Returning all articles.");
        return formattedArticles.map((article) => ({
          ...article,
          gatekeeper_reason: "Article passed gatekeeping",
        }));
      }

      try {
        const cleanedText = text
          .replace(/```json\n?/gi, "")
          .replace(/```\n?/g, "")
          .trim();

        const parsed = JSON.parse(cleanedText);

        if (Array.isArray(parsed)) {
          return parsed;
        }

        // If single object, wrap in array
        if (parsed.title && parsed.description) {
          return [parsed];
        }

        return [];
      } catch (parseError) {
        console.error("Gatekeeping JSON parse error:", parseError.message);
        // Return all articles with default reason
        return formattedArticles.map((article) => ({
          ...article,
          gatekeeper_reason: "Article passed gatekeeping",
        }));
      }
    } catch (error) {
      console.error("Gatekeeping error:", error);
      // Return all articles on error
      return formattedArticles.map((article) => ({
        ...article,
        gatekeeper_reason: "Article passed gatekeeping",
      }));
    }
  }

  /**
   * Main method: Format articles
   * @param {Array} articles - Array of article strings or objects
   * @param {Object} userIntent - Optional user intent object
   * @returns {Promise<Array>} Formatted articles with title, description, gatekeeper_reason
   */
  async formatArticles(articles, userIntent = null) {
    try {
      if (!articles || !Array.isArray(articles) || articles.length === 0) {
        return [];
      }

      // Limit to max articles
      const articlesToProcess = articles.slice(0, this.maxArticles);

      // Stage 1: Format each article
      const formattedArticles = [];
      for (const article of articlesToProcess) {
        // Extract text if article is an object
        const articleText =
          typeof article === "string"
            ? article
            : article.article || JSON.stringify(article);

        // Preserve underlying article_hash if present
        const articleHash =
          typeof article === "object" && article.article_hash
            ? article.article_hash
            : null;

        if (!articleText || articleText.trim().length === 0) {
          continue;
        }

        // NEW GATEKEEPING: Rate article before formatting
        // Only proceed if rating >= 9
        if (userIntent && userIntent.alertIntent) {
          const ratingResult = await this._rateArticleBeforeFormatting(
            articleText,
            userIntent.alertIntent
          );

          if (!ratingResult.shouldProceed) {
            // Single console explaining why article was not selected
            console.log(
              `\n[GATEKEEPING] ❌ ARTICLE REJECTED - Rating: ${
                ratingResult.rating
              }/10 (Required: >= 9) | Reason: ${
                ratingResult.reason
              } | Category: ${
                userIntent.alertIntent.category || "N/A"
              } | Subcategory: ${JSON.stringify(
                userIntent.alertIntent.subcategory || []
              )} | Intent: ${userIntent.alertIntent.intent_summary || "N/A"}\n`
            );

            continue; // Skip this article, don't format it
          }
        }

        const formatted = await this._generateWithGemini(
          articleText,
          userIntent
        );
        if (formatted && formatted.title && formatted.description) {
          // Attach source article hash if available
          if (articleHash) {
            formatted.article_hash = articleHash;
          }
          // Get image for the article
          if (this.imageSearchService) {
            try {
              const imageResult =
                await this.imageSearchService.getImageForArticle(
                  formatted.title,
                  formatted.description
                );
              if (imageResult) {
                formatted.image_url = imageResult.url;
                formatted.image_thumbnail = imageResult.thumbnail;
                formatted.image_search_query = imageResult.search_query;
                formatted.image_source = imageResult.source;
              }
            } catch (imageError) {
              console.error("Error fetching image:", imageError);
              // Continue without image
            }
          }

          formattedArticles.push(formatted);
        }
      }

      if (formattedArticles.length === 0) {
        return [];
      }

      // Stage 2: Gatekeeping - filter based on user intent
      const finalArticles = await this._gatekeepArticles(
        formattedArticles,
        userIntent
      );

      // Ensure image URLs are preserved in final articles
      finalArticles.forEach((article, index) => {
        const originalArticle = formattedArticles.find(
          (a) => a.title === article.title
        );
        if (originalArticle && originalArticle.image_url) {
          article.image_url = originalArticle.image_url;
          article.image_thumbnail = originalArticle.image_thumbnail;
          article.image_search_query = originalArticle.image_search_query;
        }
      });

      return finalArticles;
    } catch (error) {
      console.error("[ARTICLE_FORMATTER] Error:", error.message);
      return [];
    }
  }
}

module.exports = ArticleFormatter;
