const { GoogleGenerativeAI } = require("@google/generative-ai");
const GeminiConfig = require("../config/geminiConfig");
const ImageSearchService = require("./imageSearchService");
const Article = require("../models/Article");

class ArticleFormatter {
  constructor(
    maxArticles = 3,
    model = null,
    maxPromptChars = 1500,
    minRatingThreshold = 7,
    enableRating = true
  ) {
    this.maxArticles = maxArticles;
    this.modelName = model || GeminiConfig.getModel();
    this.maxPromptChars = maxPromptChars;
    this.apiKey = GeminiConfig.getApiKey();
    this.minRatingThreshold = minRatingThreshold; // Minimum rating to proceed (default 7 instead of 9)
    this.enableRating = enableRating; // Enable/disable rating gatekeeping

    // Initialize image search service (optional - won't fail if not configured)
    try {
      this.imageSearchService = new ImageSearchService();
    } catch (error) {
      this.imageSearchService = null;
    }

    this.genAI = new GoogleGenerativeAI(this.apiKey);
    this.model = this.genAI.getGenerativeModel({
      model: this.modelName,
      generationConfig: {
        temperature: 0.3,
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
   * Clean article text - remove unwanted content
   */
  _cleanArticleText(articleText, articleHash = null) {
    if (!articleText || typeof articleText !== "string") {
      return "";
    }

    let cleaned = articleText;

    // Remove article_hash if it appears in the text
    if (articleHash) {
      cleaned = cleaned.replace(new RegExp(articleHash, "gi"), "");
    }

    // First, protect URLs by temporarily replacing them
    const urlPlaceholder = "___URL_PLACEHOLDER___";
    const urls = [];
    let urlIndex = 0;
    cleaned = cleaned.replace(/https?:\/\/[^\s]+/g, (url) => {
      urls.push(url);
      return `${urlPlaceholder}${urlIndex++}`;
    });

    // Remove common unwanted patterns
    cleaned = cleaned
      // Remove article_hash patterns
      .replace(/article_hash\s*[:=]\s*[a-f0-9]+/gi, "")
      // Remove long hex strings (likely hashes)
      .replace(/\b[a-f0-9]{32,}\b/gi, "")
      // Remove unwanted Hindi text artifacts
      .replace(/ye\s+becch\s+me/gi, "")
      .replace(/kyu\s+aa\s+rhe\s+hai/gi, "")
      .replace(/aisa\s+nahi\s+ana\s+chaihye/gi, "")
      .replace(/\s+bro\s*$/i, "")
      // Remove ellipses - aggressive cleaning
      // Remove standalone ellipses " ... " or "..."
      .replace(/\s+\.{2,}\s+/g, " ")
      .replace(/\s+\.{2,}/g, " ")
      .replace(/\.{2,}\s+/g, " ")
      // Remove ellipses after sentences
      .replace(/([.!?])\s*\.{2,}\s*/g, "$1 ")
      // Remove ellipses at start/end
      .replace(/^\.{2,}\s*/g, "")
      .replace(/\s+\.{2,}$/g, "")
      // Remove any remaining ellipses
      .replace(/\.{2,}/g, "")
      // Normalize whitespace
      .replace(/\s+/g, " ")
      .trim();

    // Restore URLs
    urls.forEach((url, idx) => {
      cleaned = cleaned.replace(`${urlPlaceholder}${idx}`, url);
    });

    return cleaned;
  }

  /**
   * Validate article text quality before processing
   */
  _validateArticleText(articleText) {
    if (!articleText || typeof articleText !== "string") {
      return { valid: false, reason: "Empty or invalid article text" };
    }

    const issues = [];

    // Check for unwanted patterns
    if (/article_hash\s*[:=]/i.test(articleText)) {
      issues.push("Contains article_hash pattern");
    }

    if (/\b[a-f0-9]{32,}\b/i.test(articleText)) {
      issues.push("Contains long hex string (possible hash)");
    }

    if (/ye\s+becch\s+me|kyu\s+aa\s+rhe/i.test(articleText)) {
      issues.push("Contains unwanted Hindi text artifacts");
    }

    // Check minimum length
    if (articleText.trim().length < 50) {
      issues.push("Article text too short");
    }

    return {
      valid: issues.length === 0,
      issues: issues,
      cleaned:
        issues.length > 0 ? this._cleanArticleText(articleText) : articleText,
    };
  }

  /**
   * Validate prompt structure
   */
  _validatePromptStructure(prompt) {
    const validations = {
      hasNaaradContext: prompt.includes("Naarad is an AI-powered"),
      hasTask: prompt.includes("Rewrite the article"),
      hasTitleRules: prompt.includes("TITLE (max 10–12 words)"),
      hasDescriptionRules: prompt.includes("DESCRIPTION (55–75 words)"),
      hasOutputFormat:
        prompt.includes("TITLE:") && prompt.includes("DESCRIPTION:"),
      hasSentenceCaseRule: prompt.includes("sentence case"),
      hasArticleText: prompt.length > 500, // Basic check that article text is included
    };

    const allValid = Object.values(validations).every((v) => v === true);

    console.log("\n" + "=".repeat(80));
    console.log("[PROMPT_VALIDATION] Prompt Structure Validation:");
    console.log("=".repeat(80));
    Object.entries(validations).forEach(([key, value]) => {
      console.log(`  ${key}: ${value ? "✅ PASS" : "❌ FAIL"}`);
    });
    console.log(
      `\nOverall: ${
        allValid ? "✅ PROMPT STRUCTURE VALID" : "❌ PROMPT STRUCTURE INVALID"
      }`
    );
    console.log("=".repeat(80) + "\n");

    return { valid: allValid, validations };
  }

  /**
   * Validate title and description against requirements
   */
  _validateTitleAndDescription(title, description) {
    const titleWordCount = title ? title.trim().split(/\s+/).length : 0;
    const descriptionWordCount = description
      ? description.trim().split(/\s+/).length
      : 0;

    // Check sentence case (not Title Case)
    const isTitleCase = (text) => {
      const words = text.split(/\s+/);
      // Check if more than 2 words start with capital (excluding first word and proper nouns)
      let capitalCount = 0;
      for (let i = 1; i < words.length; i++) {
        const word = words[i].replace(/[^a-zA-Z]/g, "");
        if (
          word &&
          word[0] === word[0].toUpperCase() &&
          word[0] !== word[0].toLowerCase()
        ) {
          capitalCount++;
        }
      }
      return capitalCount > words.length * 0.3; // More than 30% of words capitalized
    };

    const validations = {
      titleExists: !!title && title.trim().length > 0,
      descriptionExists: !!description && description.trim().length > 0,
      titleWordCount: titleWordCount >= 10 && titleWordCount <= 12,
      descriptionWordCount:
        descriptionWordCount >= 55 && descriptionWordCount <= 75,
      titleNotTitleCase: !isTitleCase(title || ""),
      descriptionNotTitleCase: !isTitleCase(description || ""),
      noExclamationMarks: !title?.includes("!") && !description?.includes("!"),
      noAllCaps:
        !title?.toUpperCase() === title &&
        !description?.toUpperCase() === description,
    };

    const allValid = Object.values(validations).every((v) => v === true);

    console.log("\n" + "=".repeat(80));
    console.log("[RESPONSE_VALIDATION] Title & Description Validation:");
    console.log("=".repeat(80));
    console.log(
      `\nTitle: "${title?.substring(0, 80)}${title?.length > 80 ? "..." : ""}"`
    );
    console.log(
      `  Word count: ${titleWordCount} (required: 10-12) ${
        validations.titleWordCount ? "✅" : "❌"
      }`
    );
    console.log(`  Length: ${title?.length || 0} characters`);
    console.log(
      `  Sentence case: ${validations.titleNotTitleCase ? "✅" : "❌"}`
    );

    console.log(
      `\nDescription: "${description?.substring(0, 100)}${
        description?.length > 100 ? "..." : ""
      }"`
    );
    console.log(
      `  Word count: ${descriptionWordCount} (required: 55-75) ${
        validations.descriptionWordCount ? "✅" : "❌"
      }`
    );
    console.log(`  Length: ${description?.length || 0} characters`);
    console.log(
      `  Sentence case: ${validations.descriptionNotTitleCase ? "✅" : "❌"}`
    );

    console.log("\nValidation Details:");
    Object.entries(validations).forEach(([key, value]) => {
      console.log(`  ${key}: ${value ? "✅ PASS" : "❌ FAIL"}`);
    });
    console.log(
      `\nOverall: ${
        allValid
          ? "✅ RESPONSE VALID"
          : "⚠️  RESPONSE HAS ISSUES (but may still be acceptable)"
      }`
    );
    console.log("=".repeat(80) + "\n");

    return {
      valid: allValid,
      validations,
      titleWordCount,
      descriptionWordCount,
    };
  }

  /**
   * Build formatting prompt
   */
  _buildFormattingPrompt(articleText, userIntent = null) {
    let prompt = `Rewrite the following full article into an inShorts-style update for "Naarad."

Naarad (context):  
Naarad is an AI-powered personal update assistant that learns each user’s interests and delivers only high-signal, relevant, and meaningful updates. It filters internet noise and sends short, personalized updates (e.g., to WhatsApp). Naarad prioritizes clarity, factual accuracy, and a noise-free experience.

Task:  
Rewrite the article below into a compact Naarad update with ONLY two parts: a TITLE and a DESCRIPTION.

OUTPUT RULES — STRICT
1) TITLE (max 10–12 words)
   - Create a subtle but strong curiosity gap; make the reader pause.
   - Tone: calm, smart, premium — not loud or sensational.
   - Avoid all-caps, exclamation marks, and hypey punctuation.
   - Use simple English and, where useful, contrast (old vs new, unexpected vs expected).
   - Do NOT use heavy jargon or marketing fluff. The reader shouldn't feel out of place or overwhelmed.
   - Aim for an "almost-clickbait" curiosity that remains fully factual and honest.
   - IMPORTANT: Do NOT use Title Case (capitalizing every word's first letter). Use sentence case (only first word capitalized, proper nouns capitalized).
   - Example: "Liverpool's recent form hints at what's next" NOT "Liverpool's Recent Form Hints At What's Next"

2) DESCRIPTION (55–75 words)
   - Crisp, human, conversational.
   - Focus on ONE single most meaningful or surprising insight from the article.
   - No list of facts, no full summary — pick the single idea that matters most to the reader.
   - No corporate tone, no long adjectives, no sensational language.
   - Should include the numbers if necessary and if it maters to the article
   - Must read like: "Here's the one thing you actually want to know."
   - IMPORTANT: Use sentence case (only first word capitalized, proper nouns capitalized). Do NOT use Title Case.

GENERAL RULES
- Do NOT mention the author, publication, or article format (podcast/article).
- Do NOT add titles, headings, metadata, URLs, or any extra fields.
- Do NOT summarize everything — select the single strongest angle.
- Do NOT use exclamation marks, ALL CAPS, or sensational modifiers.
- Be concise and valuable — the user should feel the time spent reading was worth it.

OUTPUT FORMAT (exact)
Return ONLY this two-part text in the following structure (no JSON, no extra commentary):

TITLE:
<one-line title (10–12 words)>

DESCRIPTION:
<one paragraph, 55–75 words>

Now rewrite the following article into a Naarad update:
`;

    // Truncate if too big
    let articleForPrompt = articleText;
    if (articleForPrompt.length > this.maxPromptChars) {
      articleForPrompt =
        articleForPrompt.substring(0, this.maxPromptChars) + "...";
    }

    prompt += `${articleForPrompt}`;

    return prompt;
  }

  /**
   * Generate formatted article using Gemini
   */
  async _generateWithGemini(articleText, userIntent = null) {
    try {
      const prompt = this._buildFormattingPrompt(articleText, userIntent);

      // Validate prompt structure before sending
      this._validatePromptStructure(prompt);

      // Console log: Full prompt being sent to Gemini
      console.log("\n" + "=".repeat(80));
      console.log("[GEMINI_FORMAT] Full Prompt being sent to Gemini:");
      console.log("=".repeat(80));
      console.log("\nCOMPLETE PROMPT:");
      console.log("=".repeat(80));
      console.log(prompt);
      console.log("=".repeat(80));
      console.log(`\nPrompt length: ${prompt.length} characters`);
      console.log("=".repeat(80) + "\n");

      const result = await this.model.generateContent(prompt);
      const response = await result.response;

      // Log token usage
      console.log("\n" + "=".repeat(80));
      console.log("[GEMINI_TOKEN_USAGE] Token Information:");
      console.log("=".repeat(80));
      if (response.usageMetadata) {
        console.log("\nUSAGE METADATA:");
        console.log(
          `  Prompt Tokens: ${response.usageMetadata.promptTokenCount || "N/A"}`
        );
        console.log(
          `  Candidates Tokens: ${
            response.usageMetadata.candidatesTokenCount || "N/A"
          }`
        );
        console.log(
          `  Total Tokens: ${response.usageMetadata.totalTokenCount || "N/A"}`
        );
      } else {
        console.log("\nUsage metadata not available in response");
      }
      console.log("=".repeat(80) + "\n");

      // Check for blocking
      if (response.promptFeedback) {
        const blockReason = response.promptFeedback.blockReason;
        if (blockReason && blockReason !== "BLOCK_REASON_UNSPECIFIED") {
          return this._fallback(articleText);
        }
      }

      const text = response.text();

      // Console log: Raw response from Gemini
      console.log("\n" + "=".repeat(80));
      console.log("[GEMINI_FORMAT] Raw response received from Gemini:");
      console.log("=".repeat(80));
      console.log("\nRAW RESPONSE:");
      console.log("-".repeat(80));
      console.log(text);
      console.log("-".repeat(80));
      console.log("=".repeat(80) + "\n");

      if (!text || text.trim().length === 0) {
        return this._fallback(articleText);
      }

      // Parse response (can be JSON or text format)
      try {
        let title = "";
        let description = "";

        // Try to parse as JSON first
        try {
          const cleanedText = text
            .replace(/```json\n?/gi, "")
            .replace(/```\n?/g, "")
            .trim();

          const parsed = JSON.parse(cleanedText);

          // Debug: Log parsed JSON
          console.log("\n" + "=".repeat(80));
          console.log("[GEMINI_PARSE] Parsed JSON keys:", Object.keys(parsed));
          console.log("=".repeat(80));
          console.log("\nPARSED OBJECT:");
          console.log(JSON.stringify(parsed, null, 2));
          console.log("=".repeat(80) + "\n");

          // Handle both uppercase and lowercase keys
          title = parsed.title || parsed.TITLE || "";
          description = parsed.description || parsed.DESCRIPTION || "";

          // Debug: Log extracted values
          console.log("\n" + "=".repeat(80));
          console.log("[GEMINI_PARSE] Extracted Title & Description:");
          console.log("=".repeat(80));
          console.log("\nTITLE (before trim):");
          console.log(`"${title}"`);
          console.log(`Title length: ${title.length} characters`);
          console.log("\nDESCRIPTION (before trim):");
          console.log(`"${description}"`);
          console.log(`Description length: ${description.length} characters`);
          console.log("=".repeat(80) + "\n");

          if (title) title = title.trim();
          if (description) description = description.trim();

          // Debug: Log after trim
          console.log("\n" + "=".repeat(80));
          console.log("[GEMINI_PARSE] After Trim:");
          console.log("=".repeat(80));
          console.log("\nTITLE (after trim):");
          console.log(`"${title}"`);
          console.log(`Title length: ${title.length} characters`);
          console.log("\nDESCRIPTION (after trim):");
          console.log(`"${description}"`);
          console.log(`Description length: ${description.length} characters`);
          console.log("=".repeat(80) + "\n");
        } catch (jsonError) {
          console.log("\n" + "=".repeat(80));
          console.log("[GEMINI_PARSE] JSON parse failed, trying text format:");
          console.log("=".repeat(80));
          console.log("JSON Error:", jsonError.message);
          console.log("=".repeat(80) + "\n");

          // If not JSON, try to parse text format (TITLE: ... DESCRIPTION: ...)
          const titleMatch = text.match(/TITLE:\s*(.+?)(?:\n|DESCRIPTION:)/is);
          const descMatch = text.match(
            /DESCRIPTION:\s*(.+?)(?:\n\n|\nTITLE:|$)/is
          );

          if (titleMatch) {
            title = titleMatch[1].trim();
            console.log(
              "[GEMINI_PARSE] Title extracted from text format:",
              title.substring(0, 50)
            );
          }
          if (descMatch) {
            description = descMatch[1].trim();
            console.log(
              "[GEMINI_PARSE] Description extracted from text format:",
              description.substring(0, 50)
            );
          }
        }

        // Validate structure
        if (!title || !description) {
          console.log("\n" + "=".repeat(80));
          console.log(
            "[GEMINI_PARSE] Validation failed - missing title or description:"
          );
          console.log("=".repeat(80));
          console.log(
            "Title:",
            title ? `"${title.substring(0, 50)}"` : "EMPTY"
          );
          console.log(
            "Description:",
            description ? `"${description.substring(0, 50)}"` : "EMPTY"
          );
          console.log("Using fallback method...");
          console.log("=".repeat(80) + "\n");
          return this._fallback(articleText);
        }

        // Validate title and description against requirements
        const validationResult = this._validateTitleAndDescription(
          title,
          description
        );

        // Debug: Final parsed result
        console.log("\n" + "=".repeat(80));
        console.log("[GEMINI_PARSE] SUCCESS - Final Parsed Result:");
        console.log("=".repeat(80));
        console.log("\nFINAL TITLE:");
        console.log(`"${title}"`);
        console.log(`Title length: ${title.length} characters`);
        console.log(
          `Title word count: ${validationResult.titleWordCount} words`
        );
        console.log("\nFINAL DESCRIPTION:");
        console.log(`"${description}"`);
        console.log(`Description length: ${description.length} characters`);
        console.log(
          `Description word count: ${validationResult.descriptionWordCount} words`
        );
        console.log("=".repeat(80) + "\n");

        // Log warning if validation failed but still return the result
        if (!validationResult.valid) {
          console.log("\n" + "⚠️".repeat(40));
          console.log(
            "[WARNING] Response does not fully meet requirements but will be used."
          );
          console.log("⚠️".repeat(40) + "\n");
        }

        return {
          title: title,
          description: description,
          validationResult: validationResult, // Include validation result for debugging
        };
      } catch (parseError) {
        return this._fallback(articleText);
      }
    } catch (error) {
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
    prompt += `- Only articles with rating >= ${this.minRatingThreshold} will be selected.\n\n`;

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

        // Log the rating response for debugging
        console.log("\n" + "=".repeat(80));
        console.log("[ARTICLE_RATING] Gemini Rating Response:");
        console.log("=".repeat(80));
        console.log("Raw response:", text.substring(0, 200));
        console.log("Parsed rating:", rating);
        console.log("Parsed reason:", reason);
        console.log("=".repeat(80) + "\n");

        const shouldProceed = rating >= this.minRatingThreshold;

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
        // Return all articles with default reason
        return formattedArticles.map((article) => ({
          ...article,
          gatekeeper_reason: "Article passed gatekeeping",
        }));
      }
    } catch (error) {
      // Return all articles on error
      return formattedArticles.map((article) => ({
        ...article,
        gatekeeper_reason: "Article passed gatekeeping",
      }));
    }
  }

  /**
   * Store articles in database
   * @param {Array} articles - Formatted articles with original_content
   * @param {Object} userIntent - User intent object with alert_id, user_id, etc.
   */
  async _storeArticlesInDatabase(articles, userIntent) {
    try {
      const alert_id = userIntent.alert_id || null;
      const user_id = userIntent.user_id || null;

      if (!alert_id || !user_id) {
        return;
      }

      for (const article of articles) {
        if (!article.article_hash || !article.original_content) {
          continue;
        }

        try {
          const articleData = {
            alert_id: alert_id,
            user_id: user_id,
            article_hash: article.article_hash,
            content: article.original_content,
            intent_summary: userIntent.intent_summary || "",
            category: userIntent.category || "",
            subcategory: Array.isArray(userIntent.subcategory)
              ? userIntent.subcategory
              : [],
            timeframe: userIntent.timeframe || "",
            source: "perplexity",
          };

          // Use findOneAndUpdate with upsert to avoid duplicates
          await Article.findOneAndUpdate(
            { alert_id: alert_id, article_hash: article.article_hash },
            articleData,
            { upsert: true, new: true }
          );
        } catch (storeError) {
          // Handle duplicate key error gracefully (unique index on alert_id + article_hash)
          // Silently continue on duplicate or other errors
        }
      }
    } catch (error) {
      // Silently handle errors
    }
  }

  /**
   * Verify Gemini prompt and response handling
   * This method can be called to test if the prompt is being used correctly
   * @param {string} testArticleText - Optional test article text
   * @returns {Promise<Object>} Verification report
   */
  async verifyGeminiPromptUsage(testArticleText = null) {
    const testArticle =
      testArticleText ||
      `This is a test article about technology and innovation. 
    It discusses the latest developments in artificial intelligence and how they are transforming various industries. 
    The article covers key points about machine learning, neural networks, and their practical applications.`;

    console.log("\n" + "🔍".repeat(40));
    console.log("[VERIFICATION] Testing Gemini Prompt Usage");
    console.log("🔍".repeat(40) + "\n");

    try {
      // 1. Test prompt building
      const prompt = this._buildFormattingPrompt(testArticle);
      const promptValidation = this._validatePromptStructure(prompt);

      // 2. Test Gemini call
      let geminiTestResult = null;
      let geminiError = null;
      try {
        geminiTestResult = await this._generateWithGemini(testArticle);
      } catch (error) {
        geminiError = error.message;
      }

      const verificationReport = {
        timestamp: new Date().toISOString(),
        promptValidation: promptValidation,
        geminiCallSuccess: !!geminiTestResult && !geminiError,
        geminiError: geminiError,
        testResult: geminiTestResult,
        recommendations: [],
      };

      // Add recommendations
      if (!promptValidation.valid) {
        verificationReport.recommendations.push(
          "⚠️ Prompt structure validation failed. Check prompt building method."
        );
      }

      if (geminiError) {
        verificationReport.recommendations.push(
          `❌ Gemini API call failed: ${geminiError}`
        );
      }

      if (geminiTestResult && geminiTestResult.validationResult) {
        if (!geminiTestResult.validationResult.valid) {
          verificationReport.recommendations.push(
            "⚠️ Response validation failed. Gemini may not be following prompt correctly."
          );
        } else {
          verificationReport.recommendations.push(
            "✅ All validations passed! Gemini prompt is working correctly."
          );
        }
      }

      console.log("\n" + "📊".repeat(40));
      console.log("[VERIFICATION] Summary Report:");
      console.log("📊".repeat(40));
      console.log(JSON.stringify(verificationReport, null, 2));
      console.log("📊".repeat(40) + "\n");

      return verificationReport;
    } catch (error) {
      console.error("[VERIFICATION] Error during verification:", error);
      return {
        timestamp: new Date().toISOString(),
        error: error.message,
        recommendations: ["❌ Verification failed. Check error message above."],
      };
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
        let articleText =
          typeof article === "string"
            ? article
            : article.article ||
              (typeof article === "object" ? null : String(article));

        // If article is object but no article property, skip it (don't stringify the whole object)
        if (!articleText && typeof article === "object") {
          console.log(
            "[ARTICLE_FORMAT] Skipping article - no 'article' property found"
          );
          console.log("[ARTICLE_FORMAT] Article keys:", Object.keys(article));
          continue;
        }

        // Preserve underlying article_hash if present
        const articleHash =
          typeof article === "object" && article.article_hash
            ? article.article_hash
            : null;

        // Validate and clean article text
        const validation = this._validateArticleText(articleText);

        if (!validation.valid) {
          console.log("\n" + "=".repeat(80));
          console.log("[ARTICLE_FORMAT] Article text validation found issues:");
          console.log("=".repeat(80));
          validation.issues.forEach((issue) => {
            console.log(`  ⚠️  ${issue}`);
          });
          console.log("=".repeat(80) + "\n");

          // Use cleaned version
          articleText = validation.cleaned;
        }

        // Additional cleaning pass
        articleText = this._cleanArticleText(articleText, articleHash);

        if (!articleText || articleText.trim().length === 0) {
          console.log(
            "[ARTICLE_FORMAT] Skipping article - empty after cleaning"
          );
          continue;
        }

        // Log cleaned article preview for debugging
        console.log("\n" + "=".repeat(80));
        console.log("[ARTICLE_FORMAT] Processing article:");
        console.log("=".repeat(80));
        console.log(`Article hash: ${articleHash || "N/A"}`);
        console.log(`Article length: ${articleText.length} characters`);
        console.log(`Article preview: ${articleText.substring(0, 150)}...`);
        console.log("=".repeat(80) + "\n");

        // NEW GATEKEEPING: Rate article before formatting
        // Only proceed if rating >= threshold (default 7)
        if (this.enableRating && userIntent && userIntent.alertIntent) {
          console.log("\n" + "=".repeat(80));
          console.log("[ARTICLE_RATING] Rating article before formatting:");
          console.log("=".repeat(80));
          console.log(`Article preview: ${articleText.substring(0, 200)}...`);
          console.log("=".repeat(80) + "\n");

          const ratingResult = await this._rateArticleBeforeFormatting(
            articleText,
            userIntent.alertIntent
          );

          console.log("\n" + "=".repeat(80));
          console.log("[ARTICLE_RATING] Rating Result:");
          console.log("=".repeat(80));
          console.log(`Rating: ${ratingResult.rating}/10`);
          console.log(`Reason: ${ratingResult.reason}`);
          console.log(
            `Should Proceed: ${ratingResult.shouldProceed ? "✅ YES" : "❌ NO"}`
          );
          console.log("=".repeat(80) + "\n");

          if (!ratingResult.shouldProceed) {
            console.log(
              `[ARTICLE_RATING] ⚠️  Skipping article - rating ${ratingResult.rating}/10 is below threshold (${this.minRatingThreshold}/10)`
            );
            continue; // Skip this article, don't format it
          } else {
            console.log(
              `[ARTICLE_RATING] ✅ Proceeding with formatting - rating ${ratingResult.rating}/10 meets threshold (${this.minRatingThreshold}/10)`
            );
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
          // Attach original article text (content) for database storage
          formatted.original_content = articleText;
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
        if (originalArticle) {
          if (originalArticle.image_url) {
            article.image_url = originalArticle.image_url;
            article.image_thumbnail = originalArticle.image_thumbnail;
            article.image_search_query = originalArticle.image_search_query;
          }
          // Preserve original content
          if (originalArticle.original_content) {
            article.original_content = originalArticle.original_content;
          }
          // Preserve article hash
          if (originalArticle.article_hash) {
            article.article_hash = originalArticle.article_hash;
          }
        }
      });

      // Store articles in database if alert_id and user_id are available
      if (userIntent && (userIntent.alert_id || userIntent.user_id)) {
        await this._storeArticlesInDatabase(finalArticles, userIntent);
      }

      return finalArticles;
    } catch (error) {
      return [];
    }
  }
}

module.exports = ArticleFormatter;
