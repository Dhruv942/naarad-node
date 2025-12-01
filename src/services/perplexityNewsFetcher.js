const axios = require("axios");
const crypto = require("crypto");

class PerplexityNewsFetcher {
  constructor(model = "sonar-pro") {
    this.model = model;
    this.apiKey = process.env.PERPLEXITY_API_KEY;
    this.apiEndpoint = "https://api.perplexity.ai/chat/completions";

    if (!this.apiKey) {
      throw new Error("PERPLEXITY_API_KEY is required for news fetching");
    }

    // Trim whitespace from API key
    this.apiKey = this.apiKey.trim();

    // Validate API key format (should start with pplx-)
    if (!this.apiKey.startsWith("pplx-")) {
      console.warn("Warning: Perplexity API key should start with 'pplx-'");
    }

    // Create HTTP client with 90-second timeout
    this.client = axios.create({
      timeout: 90000, // 90 seconds
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
    });
  }

  /**
   * Strip markdown code fences from content
   */
  _stripCodeFences(content) {
    if (!content) return content;
    // Remove ```json and ``` wrappers
    return content
      .replace(/```json\n?/gi, "")
      .replace(/```\n?/g, "")
      .trim();
  }

  /**
   * Extract content from Perplexity response
   */
  _extractContent(response) {
    try {
      const choices = response.data?.choices;
      if (!choices || choices.length === 0) {
        throw new Error("No choices in Perplexity response");
      }

      const message = choices[0]?.message;
      if (!message) {
        throw new Error("No message in Perplexity response");
      }

      const content = message.content;
      if (!content || typeof content !== "string") {
        throw new Error("Invalid content format in Perplexity response");
      }

      return content;
    } catch (error) {
      throw new Error(`Invalid Perplexity response format: ${error.message}`);
    }
  }

  /**
   * Extract JSON from text that might contain extra content
   */
  _extractJSON(content) {
    // Try to find JSON array first (most common)
    const jsonArrayMatch = content.match(/\[[\s\S]*?\]/);
    if (jsonArrayMatch) {
      return jsonArrayMatch[0];
    }

    // Try to find JSON object
    const jsonObjectMatch = content.match(/\{[\s\S]*?\}/);
    if (jsonObjectMatch) {
      return jsonObjectMatch[0];
    }

    return content;
  }

  /**
   * Parse articles from JSON content
   */
  _parseArticles(content) {
    try {
      // Strip code fences first
      let cleanedContent = this._stripCodeFences(content);

      if (!cleanedContent || cleanedContent.trim().length === 0) {
        throw new Error("Perplexity returned empty content");
      }

      // Try to extract JSON if there's extra text
      cleanedContent = this._extractJSON(cleanedContent);

      // Remove any leading/trailing whitespace
      cleanedContent = cleanedContent.trim();

      // Try to find and extract just the JSON part
      // Sometimes Perplexity adds explanatory text before/after JSON
      let jsonStart = cleanedContent.indexOf("[");
      let jsonEnd = cleanedContent.lastIndexOf("]");

      if (jsonStart === -1) {
        jsonStart = cleanedContent.indexOf("{");
        jsonEnd = cleanedContent.lastIndexOf("}");
      }

      if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
        cleanedContent = cleanedContent.substring(jsonStart, jsonEnd + 1);
      }

      // Parse JSON with better error handling
      let parsed;
      try {
        parsed = JSON.parse(cleanedContent);
      } catch (parseError) {
        // Try one more time with more aggressive cleaning
        // Remove anything before first [ or { and after last ] or }
        const firstBracket = Math.min(
          cleanedContent.indexOf("["),
          cleanedContent.indexOf("{") === -1
            ? Infinity
            : cleanedContent.indexOf("{")
        );
        const lastBracket = Math.max(
          cleanedContent.lastIndexOf("]"),
          cleanedContent.lastIndexOf("}") === -1
            ? -1
            : cleanedContent.lastIndexOf("}")
        );

        if (
          firstBracket !== -1 &&
          lastBracket !== -1 &&
          lastBracket > firstBracket
        ) {
          cleanedContent = cleanedContent.substring(
            firstBracket,
            lastBracket + 1
          );
          parsed = JSON.parse(cleanedContent);
        } else {
          throw parseError;
        }
      }

      // Handle both single dict and list of dicts
      const items = Array.isArray(parsed) ? parsed : [parsed];

      // Extract article field from each item
      const articles = [];
      for (const item of items) {
        // Try different possible field names
        let articleText = null;

        if (item && typeof item === "object") {
          // Try "article" field first
          if (item.article && typeof item.article === "string") {
            articleText = item.article;
          }
          // Try "content" field
          else if (item.content && typeof item.content === "string") {
            articleText = item.content;
          }
          // Try "text" field
          else if (item.text && typeof item.text === "string") {
            articleText = item.text;
          }
        } else if (typeof item === "string") {
          articleText = item;
        }

        if (articleText && articleText.trim().length > 0) {
          const clean = articleText.trim();
          const articleHash = crypto
            .createHash("sha256")
            .update(clean, "utf-8")
            .digest("hex");

          articles.push({
            article: clean,
            article_hash: articleHash,
          });
        }
      }

      // Log if no articles found
      if (articles.length === 0 && items.length > 0) {
        console.warn(
          "No articles extracted. Items structure:",
          JSON.stringify(items[0]).substring(0, 500)
        );
      }

      // Return max 4 articles (now as objects with article + article_hash)
      return articles.slice(0, 4);
    } catch (error) {
      if (error instanceof SyntaxError) {
        console.error(
          "JSON decode error. Content preview:",
          content.substring(0, 2000)
        );
        console.error(
          "Cleaned content preview:",
          this._stripCodeFences(content).substring(0, 500)
        );
        throw new Error(`Perplexity returned invalid JSON: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Main method: Fetch news from Perplexity
   * @param {Object} intent - Intent object with perplexity_query and perplexity_prompt
   * @returns {Promise<Object>} News payload with articles
   */
  async fetchNews(intent) {
    try {
      // Validate intent
      if (!intent) {
        throw new Error("Intent is required");
      }

      const { perplexity_query, perplexity_prompt } = intent;

      if (!perplexity_prompt || !perplexity_query) {
        throw new Error(
          "Intent must include perplexity_prompt and perplexity_query"
        );
      }

      // Build system message
      const systemMessage = {
        role: "system",
        content:
          "You are Naarad AI News Fetcher — your ONLY job is to fetch real, factual, full article text from credible news sources without rewriting, summarizing, shortening, or inventing content.",
      };

      // Build user message
      const userMessage = {
        role: "user",
        content: `SERP Query:\n${perplexity_query}\n\nInstruction:\n${perplexity_prompt}\n\nReturn ONLY valid JSON as a list (max 4 items).\nEach item MUST follow exactly this structure:\n{\n  "article": "<full accurate article text>"\n}\n\nStrict rules for the article:\n- Must be FULL article text, not a summary\n- Must contain full reporting context and progression\n- Must be based only on real, verifiable news sources\n- Must NOT be generated, imagined, inferred, or assumed\n- Must NOT shorten or compress content\n- Must NOT include titles, headlines, bullet points, or formatting\n- Must NOT include opinions, analysis, commentary, marketing tone, or emojis\n- Must be purely factual reporting\n\nReturn nothing except the JSON.`,
      };

      // Build request payload
      const payload = {
        model: this.model,
        messages: [systemMessage, userMessage],
        temperature: 0.1, // Low temperature for factual accuracy
        top_p: 0.8,
      };

      // Make API request
      const response = await this.client.post(this.apiEndpoint, payload);

      // Extract content
      const content = this._extractContent(response);

      // Log content for debugging (first 1000 chars)
      console.log(
        "Perplexity response content preview:",
        content.substring(0, 1000)
      );

      // Parse articles
      const articles = this._parseArticles(content);

      // Log parsed articles count
      console.log(
        `Parsed ${articles.length} articles from Perplexity response`
      );

      // Return payload
      return {
        query: perplexity_query,
        articles: articles,
        raw_response: response.data,
      };
    } catch (error) {
      console.error("Perplexity news fetch error:", error);

      // Handle HTTP errors
      if (error.response) {
        const status = error.response.status;
        const statusText = error.response.statusText;

        console.error("Perplexity API error:", {
          status: status,
          statusText: statusText,
          data: error.response.data,
        });

        if (status === 401) {
          throw new Error(
            "Perplexity API authentication failed. Please check your PERPLEXITY_API_KEY in .env file. The API key should be valid and start with 'pplx-'."
          );
        }

        throw new Error(
          `Perplexity API error: ${status} ${statusText} - ${JSON.stringify(
            error.response.data
          )}`
        );
      }

      // Re-throw validation errors
      if (
        error.message.includes("required") ||
        error.message.includes("must include")
      ) {
        throw error;
      }

      // Wrap other errors
      throw new Error(`Failed to fetch news from Perplexity: ${error.message}`);
    }
  }
}

module.exports = PerplexityNewsFetcher;
