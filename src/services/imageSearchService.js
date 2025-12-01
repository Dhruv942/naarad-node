const axios = require("axios");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const GeminiConfig = require("../config/geminiConfig");

class ImageSearchService {
  constructor() {
    this.googleApiKey = process.env.GOOGLE_SEARCH_API_KEY;
    this.googleCx = process.env.GOOGLE_SEARCH_CX;
    this.geminiApiKey = GeminiConfig.getApiKey();
    this.searchEndpoint = "https://www.googleapis.com/customsearch/v1";

    if (!this.googleApiKey || !this.googleCx) {
      throw new Error(
        "GOOGLE_SEARCH_API_KEY and GOOGLE_SEARCH_CX are required for image search"
      );
    }

    // Initialize Gemini for query generation
    this.genAI = new GoogleGenerativeAI(this.geminiApiKey);
    // Use gemini-1.5-flash for simpler queries (doesn't use thinking tokens)
    this.geminiModel = this.genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: {
        temperature: 0.3,
        // Removed maxOutputTokens - let Gemini use default
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
   * Generate image search query from title and description using Gemini
   */
  async generateImageQuery(title, description) {
    try {
      const prompt = `Generate a 2-5 word image search query.

Title: ${title}
Description: ${description.substring(0, 150)}

Output only the query words, nothing else. Examples: "Virat Kohli cricket", "India match", "Tesla stock"

Query:`;

      const result = await this.geminiModel.generateContent(prompt);
      const response = await result.response;

      // Check for blocking
      if (response.promptFeedback) {
        const blockReason = response.promptFeedback.blockReason;
        if (blockReason && blockReason !== "BLOCK_REASON_UNSPECIFIED") {
          console.warn(
            `Gemini blocked response: ${blockReason}. Using fallback.`
          );
          return this._getFallbackQuery(title);
        }
      }

      // Get text from response - try multiple methods
      let rawText = null;

      // Method 1: Standard text() method
      try {
        rawText = response.text();
      } catch (textError) {
        // Method 2: Extract from candidates structure
        if (response.candidates && response.candidates[0]) {
          const candidate = response.candidates[0];
          if (candidate.content && candidate.content.parts) {
            for (const part of candidate.content.parts) {
              if (part.text) {
                rawText = part.text;
                break;
              }
            }
          }
        }
      }

      // Check finish reason
      if (response.candidates && response.candidates[0]) {
        const finishReason = response.candidates[0].finishReason;
        if (finishReason === "MAX_TOKENS") {
          console.warn(
            "Gemini hit MAX_TOKENS limit. Trying to extract partial response."
          );
          // Even with MAX_TOKENS, there might be partial text
          if (!rawText && response.candidates[0].content) {
            const parts = response.candidates[0].content.parts || [];
            for (const part of parts) {
              if (part.text) {
                rawText = part.text;
                break;
              }
            }
          }
        }
      }

      if (!rawText || rawText.trim().length === 0) {
        console.warn("Gemini returned empty response. Using fallback.");
        if (response.candidates && response.candidates[0]) {
          console.warn("Finish reason:", response.candidates[0].finishReason);
          console.warn(
            "Response structure:",
            JSON.stringify(response.candidates[0]).substring(0, 500)
          );
        }
        return this._getFallbackQuery(title);
      }

      let query = rawText.trim();
      console.log("Gemini raw response:", query.substring(0, 100));

      // Clean up any markdown, quotes, or extra text
      query = query
        .replace(/```/g, "")
        .replace(/json/gi, "")
        .replace(/^["']|["']$/g, "") // Remove surrounding quotes
        .replace(/^query:\s*/gi, "") // Remove "Query:" prefix if present
        .replace(/^output:\s*/gi, "") // Remove "Output:" prefix if present
        .replace(/^\d+\.\s*/, "") // Remove numbered list prefix
        .replace(/^-\s*/, "") // Remove bullet point
        .replace(/^Here.*?:\s*/i, "") // Remove "Here is the query:" type prefixes
        .trim();

      // If still empty or too short, use fallback
      if (!query || query.length < 2) {
        console.warn(
          "Gemini returned empty query after cleaning, using fallback"
        );
        console.warn("Raw Gemini response was:", rawText.substring(0, 200));
        return this._getFallbackQuery(title);
      }

      console.log("✅ Gemini generated query:", query);
      return query.substring(0, 100); // Limit to 100 chars
    } catch (error) {
      console.error("Error generating image query:", error);
      console.error("Error details:", error.message);
      return this._getFallbackQuery(title);
    }
  }

  /**
   * Get fallback query from title
   */
  _getFallbackQuery(title) {
    const titleWords = title
      .replace(/[!?.,:;'"]/g, " ")
      .split(" ")
      .filter(
        (w) =>
          w.length > 2 &&
          ![
            "the",
            "and",
            "for",
            "with",
            "vs",
            "in",
            "on",
            "at",
            "seal",
            "seals",
          ].includes(w.toLowerCase())
      )
      .slice(0, 3);
    const fallback =
      titleWords.join(" ") || title.split(" ").slice(0, 3).join(" ");
    console.log("Using fallback query:", fallback);
    return fallback;
  }

  /**
   * Search for image using Google Custom Search API
   * Prioritizes trusted news sources
   */
  async searchImage(query) {
    try {
      if (!query || query.trim().length === 0) {
        return null;
      }

      // Trusted news sources for image search
      const trustedSources = [
        "site:indianexpress.com",
        "site:thehindu.com",
        "site:timesofindia.indiatimes.com",
        "site:hindustantimes.com",
        "site:ndtv.com",
        "site:news18.com",
        "site:firstpost.com",
        "site:scroll.in",
        "site:thequint.com",
        "site:news24online.com",
      ];

      // Try trusted sources first
      for (const source of trustedSources) {
        const params = {
          key: this.googleApiKey,
          cx: this.googleCx,
          q: `${query} ${source}`,
          searchType: "image",
          num: 1,
          safe: "active",
          imgSize: "large",
          imgType: "photo",
        };

        try {
          const response = await axios.get(this.searchEndpoint, { params });

          if (
            response.data &&
            response.data.items &&
            response.data.items.length > 0
          ) {
            const imageItem = response.data.items[0];
            // Verify the image is from a trusted source
            const imageUrl = imageItem.link || "";
            const contextUrl = imageItem.image?.contextLink || "";

            if (
              this._isTrustedSource(imageUrl) ||
              this._isTrustedSource(contextUrl)
            ) {
              return {
                url: imageItem.link,
                thumbnail: imageItem.image?.thumbnailLink || imageItem.link,
                title: imageItem.title,
                context: imageItem.image?.contextLink,
                source: this._extractSource(contextUrl || imageUrl),
              };
            }
          }
        } catch (sourceError) {
          // Continue to next source if this one fails
          continue;
        }
      }

      // If no trusted source found, try general search as fallback
      const params = {
        key: this.googleApiKey,
        cx: this.googleCx,
        q: query,
        searchType: "image",
        num: 3, // Get 3 results to find a trusted one
        safe: "active",
        imgSize: "large",
        imgType: "photo",
      };

      const response = await axios.get(this.searchEndpoint, { params });

      if (
        response.data &&
        response.data.items &&
        response.data.items.length > 0
      ) {
        // Look for trusted source in results
        for (const imageItem of response.data.items) {
          const imageUrl = imageItem.link || "";
          const contextUrl = imageItem.image?.contextLink || "";

          if (
            this._isTrustedSource(imageUrl) ||
            this._isTrustedSource(contextUrl)
          ) {
            return {
              url: imageItem.link,
              thumbnail: imageItem.image?.thumbnailLink || imageItem.link,
              title: imageItem.title,
              context: imageItem.image?.contextLink,
              source: this._extractSource(contextUrl || imageUrl),
            };
          }
        }

        // If no trusted source found, return first result anyway
        const imageItem = response.data.items[0];
        return {
          url: imageItem.link,
          thumbnail: imageItem.image?.thumbnailLink || imageItem.link,
          title: imageItem.title,
          context: imageItem.image?.contextLink,
          source: this._extractSource(
            imageItem.image?.contextLink || imageItem.link
          ),
        };
      }

      return null;
    } catch (error) {
      console.error("Error searching image:", error);
      if (error.response) {
        console.error("Google Search API error:", error.response.data);
      }
      return null;
    }
  }

  /**
   * Check if URL is from a trusted source
   */
  _isTrustedSource(url) {
    if (!url) return false;

    const trustedDomains = [
      "indianexpress.com",
      "thehindu.com",
      "timesofindia.indiatimes.com",
      "hindustantimes.com",
      "ndtv.com",
      "news18.com",
      "firstpost.com",
      "scroll.in",
      "thequint.com",
      "news24online.com",
      "reuters.com",
      "bbc.com",
      "cnn.com",
      "aljazeera.com",
    ];

    return trustedDomains.some((domain) =>
      url.toLowerCase().includes(domain.toLowerCase())
    );
  }

  /**
   * Extract source domain from URL
   */
  _extractSource(url) {
    if (!url) return "unknown";

    try {
      const urlObj = new URL(url);
      return urlObj.hostname.replace("www.", "");
    } catch (error) {
      // If URL parsing fails, try regex
      const match = url.match(/https?:\/\/(?:www\.)?([^\/]+)/);
      return match ? match[1] : "unknown";
    }
  }

  /**
   * Get image for article (generates query + searches)
   */
  async getImageForArticle(title, description) {
    try {
      // Generate search query using Gemini
      const searchQuery = await this.generateImageQuery(title, description);

      // Search for image
      const imageResult = await this.searchImage(searchQuery);

      return imageResult
        ? {
            url: imageResult.url,
            thumbnail: imageResult.thumbnail,
            search_query: searchQuery,
            source: imageResult.source,
          }
        : null;
    } catch (error) {
      console.error("Error getting image for article:", error);
      return null;
    }
  }
}

module.exports = ImageSearchService;
