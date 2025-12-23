const axios = require("axios");
const crypto = require("crypto");

class PerplexityNewsFetcher {
  constructor(model = "sonar-pro") {
    this.model = model;
    this.apiKey = process.env.PERPLEXITY_API_KEY;

    if (!this.apiKey) {
      throw new Error("PERPLEXITY_API_KEY missing from environment");
    }

    this.apiKey = this.apiKey.trim();

    // Debug: Log API key status (without exposing full key)
    const keyLength = this.apiKey.length;
    const keyPreview =
      this.apiKey.length > 8
        ? `${this.apiKey.substring(0, 4)}...${this.apiKey.substring(
            keyLength - 4
          )}`
        : "***";
    console.log(
      `[PERPLEXITY] API Key loaded: ${keyPreview} (length: ${keyLength})`
    );

    this.client = axios.create({
      baseURL: "https://api.perplexity.ai",
      timeout: 90000,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
    });
  }

  // ------------------------------------------------------------
  // UTILITIES
  // ------------------------------------------------------------

  _stripCodeFences(str) {
    if (!str) return str;
    return str
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();
  }

  _extractContent(resp) {
    const msg = resp?.data?.choices?.[0]?.message?.content;
    if (!msg) throw new Error("Invalid Perplexity response format");
    return msg;
  }

  _extractJSON(text) {
    // Try to find complete JSON array (greedy match to get full content)
    // Match from first [ to last ] (handles nested arrays/objects)
    const arrayStart = text.indexOf("[");
    if (arrayStart !== -1) {
      let depth = 0;
      let inString = false;
      let escapeNext = false;

      for (let i = arrayStart; i < text.length; i++) {
        const char = text[i];

        if (escapeNext) {
          escapeNext = false;
          continue;
        }

        if (char === "\\") {
          escapeNext = true;
          continue;
        }

        if (char === '"' && !escapeNext) {
          inString = !inString;
          continue;
        }

        if (!inString) {
          if (char === "[") depth++;
          if (char === "]") {
            depth--;
            if (depth === 0) {
              return text.substring(arrayStart, i + 1);
            }
          }
        }
      }
    }

    // Fallback: try simple object match
    const objMatch = text.match(/\{[\s\S]*\}/);
    if (objMatch) return objMatch[0];

    return text;
  }

  _parseArticles(content) {
    // If content is missing or not a string, return no articles instead of throwing
    if (!content || typeof content !== "string") {
      console.warn("Perplexity response missing or not a string");
      return [];
    }

    content = this._stripCodeFences(content);

    const extracted = this._extractJSON(content);
    let parsed;

    try {
      parsed = JSON.parse(extracted);
    } catch {
      // If JSON parse fails, fall back to wrapping the raw text as one article.
      // Also strip leading/trailing brackets that sometimes appear in Perplexity outputs.
      const raw = this._stripCodeFences(content).trim();
      const fallback = raw
        .replace(/^\s*\[\s*/, "")
        .replace(/\]\s*$/, "")
        .trim();

      if (!fallback) {
        console.warn("Perplexity returned invalid JSON and empty content");
        return [];
      }

      console.warn(
        "Perplexity returned invalid JSON. Using raw content as article. Preview:",
        content.substring(0, 500)
      );
      return [
        {
          article: fallback,
          article_hash: crypto
            .createHash("sha256")
            .update(fallback)
            .digest("hex"),
        },
      ];
    }

    const items = Array.isArray(parsed) ? parsed : [parsed];

    const articles = items
      .map((item) => {
        const text = item.article || item.content || item.text;
        if (!text) return null;

        const clean = text.trim();
        return {
          article: clean,
          article_hash: crypto.createHash("sha256").update(clean).digest("hex"),
        };
      })
      .filter(Boolean);

    if (articles.length === 0) {
      // Last-resort fallback: treat the whole content as one article
      const raw = this._stripCodeFences(content)
        .replace(/^\s*\[\s*/, "")
        .replace(/\]\s*$/, "")
        .trim();

      if (!raw) {
        console.warn("Perplexity returned no usable article content");
        return [];
      }

      return [
        {
          article: raw,
          article_hash: crypto.createHash("sha256").update(raw).digest("hex"),
        },
      ];
    }

    return articles.slice(0, 4);
  }

  // ------------------------------------------------------------
  // BUILD SEARCH QUERY FOR PERPLEXITY SERP
  // ------------------------------------------------------------

  _buildSearchQuery(intent) {
    const summary = (intent.intent_summary || "").trim();
    const perplexityQuery =
      typeof intent.perplexity_query === "string"
        ? intent.perplexity_query.trim()
        : "";

    const hasNoise = (text) =>
      typeof text === "string" && text.includes("[object Object]");

    const summaryClean = summary && !hasNoise(summary) ? summary : "";
    const perplexityClean =
      perplexityQuery && !hasNoise(perplexityQuery) ? perplexityQuery : "";

    // Rebuild a clean sentence
    const category = intent.category || intent.topic || "news";
    const sub =
      Array.isArray(intent.subcategory) && intent.subcategory.length > 0
        ? intent.subcategory.filter(Boolean).join(", ")
        : "";
    const followups = Array.isArray(intent.followup_questions)
      ? intent.followup_questions
          .map((fq) => {
            if (fq && typeof fq === "object") {
              const parts = [];
              if (fq.question) parts.push(`Q:${fq.question}`);
              if (Array.isArray(fq.options) && fq.options.length)
                parts.push(`Options:${fq.options.join("/")}`);
              if (fq.selected_answer)
                parts.push(`Selected:${fq.selected_answer}`);
              return parts.join(" | ");
            }
            if (typeof fq === "string") return fq;
            return "";
          })
          .filter(Boolean)
          .join("; ")
      : "";
    const customQ = intent.custom_question || "";
    // Default to 72 hours to improve recall; even if intent passed 24h, prefer 72h
    const timeframe =
      intent.timeframe === "1week"
        ? "last 7 days"
        : intent.timeframe === "1month"
        ? "last 30 days"
        : intent.timeframe === "24hours"
        ? "last 24 hours"
        : "last 72 hours";

    let sentence = `Find latest ${category}`;
    if (sub) sentence += ` about ${sub}`;
    if (followups) sentence += `, considering: ${followups}`;
    if (customQ) sentence += `, and also: ${customQ}`;
    sentence += `, strictly in the ${timeframe}.`;

    // Prefer intent summary (more precise), but append structured context for recall.
    if (summaryClean) return `${summaryClean}. ${sentence}`;

    if (perplexityClean) return perplexityClean;

    return sentence;
  }

  _buildPrompt(intent) {
    const category = intent.category || intent.topic || "General";
    const sub = Array.isArray(intent.subcategory)
      ? intent.subcategory.filter(Boolean).join(", ")
      : intent.subcategory || "";
    const customQ = intent.custom_question || "";
    const timeframe = intent.timeframe || "3days";
    const followupsRaw = Array.isArray(intent.followup_questions)
      ? intent.followup_questions
          .map((fq) => {
            if (fq && typeof fq === "object") {
              const q = fq.question || "Follow-up";
              const opts =
                Array.isArray(fq.options) && fq.options.length
                  ? fq.options.join(", ")
                  : "None";
              const sel = fq.selected_answer || "None";
              return `Q: ${q}\nOptions: ${opts}\nSelected: ${sel}`;
            }
            if (typeof fq === "string") {
              return `Q: ${fq}\nOptions: None\nSelected: None`;
            }
            return "";
          })
          .filter(Boolean)
          .join("\n\n")
      : "None";

    const searchQuery = this._buildSearchQuery(intent);

    return `You are fetching news articles for “Naarad,” an AI-powered personal update assistant. 
Naarad filters the internet, finds only meaningful and relevant updates based on a user’s interests, 
and delivers short, personalized summaries on WhatsApp. 
Naarad’s goal is to send only high-signal, noise-free updates that match exactly what the user cares about.

Below is the complete context about the user’s preferences. 
This includes the category, subcategory, all follow-up questions, all available options, 
and the exact selections the user made. 
Use ALL of this information to determine what the user actually wants updates about.

USER PREFERENCES (FULL STRUCTURE EXAMPLE):

- Category: ${category}
- Subcategory: ${sub || "None"}
- Follow-up details (question → options → selected):
${followupsRaw || "None"}
- Custom question: ${customQ || "None"}
 Intent summary: ${intent.intent_summary || "None"}

(IMPORTANT: In the actual request, all questions, all options, and all user selections for the selected subcategory will be inserted here exactly in this structure.)

Your task:
1. Fetch the MOST relevant, meaningful, and high-quality news articles based on the user's true interests.
2. Articles MUST be recent — published within the last 3 days.
3. Prefer credible reporting over viral or low-quality content.
4. Avoid generic or broad news unless the user explicitly selected broad preferences.
5. Prioritize articles that contain strong updates, discoveries, or meaningful insights.
6. Avoid press releases, low-value blogs, SEO spam, AI-generated junk, filler content.
7. Return ONLY the full original article text in JSON format.

CRITICAL: FULL ARTICLE TEXT REQUIRED
- You MUST fetch and return the COMPLETE, ENTIRE article text from start to finish
- Do NOT use ellipses (...) or any truncation markers
- Do NOT summarize, condense, or shorten the article content
- Do NOT skip any paragraphs, sentences, or sections
- Include ALL paragraphs, ALL details, ALL quotes, ALL information from the original article
- If you see "..." in source content, fetch the complete article from the source URL to get the full text
- The article text must be 100% complete with no missing portions

Output Format (strict):
Return a JSON array

Each array element MUST contain exactly one field: "content"
"content" must include:
The COMPLETE, FULL article text from the source (every paragraph, every sentence, NO truncation, NO ellipses)
Then a new line
Then the source link
Do NOT add extra fields like "source", "url", etc.
Do NOT truncate, summarize, or shorten content in ANY way
Do NOT use ellipses (...) or "..."
Do NOT add titles, summaries, metadata, or commentary outside the article
Example:
[
  {
    "content": "FULL ARTICLE TEXT HERE...\n\nSource: https://example.com/full-article-link"
  },
  {
    "content": "FULL SECOND ARTICLE TEXT HERE...\n\nSource: https://example.com/second-article-link"
  }
]


Important Notes:
* Do NOT add your own summarization or interpretation.
* Do NOT include your reasoning or analysis.
* Do NOT return anything except the JSON array.
* Return 1–3 high-quality, deeply relevant articles.

Now fetch the best possible articles as per the above instructions.`;
  }

  // ------------------------------------------------------------
  // MAIN FUNCTION — FETCH NEWS FROM PERPLEXITY
  // ------------------------------------------------------------

  async fetchNews(intent) {
    try {
      if (!intent) throw new Error("Intent is required");

      // Normalize follow-up questions array
      intent.followup_questions =
        intent.followup_questions && Array.isArray(intent.followup_questions)
          ? intent.followup_questions
          : [];

      const searchQuery = this._buildSearchQuery(intent);

      const systemMessage = {
        role: "system",
        content:
          "You are Naarad AI News Fetcher — produce factual, premium-quality news briefings with zero hallucinations.",
      };

      // Build prompt in PerplexityNewsFetcher (always built here, not from Gemini)
      const prompt = this._buildPrompt(intent);

      const userMessage = {
        role: "user",
        content: `SERP QUERY:\n${searchQuery}\n\n${prompt}`,
      };

      const payload = {
        model: this.model,
        messages: [systemMessage, userMessage],
        temperature: 0.1,
        top_p: 0.8,
        max_tokens: 8000, // Allow longer responses to get complete articles
      };

      // Print prompt being sent to Perplexity
      console.log("\n" + "=".repeat(80));
      console.log("📤 PROMPT BEING SENT TO PERPLEXITY");
      console.log("=".repeat(80));
      console.log("\n🔹 SERP QUERY:");
      console.log(searchQuery);
      console.log("\n🔹 FULL PROMPT:");
      console.log("-".repeat(80));
      console.log(userMessage.content);
      console.log("-".repeat(80));
      console.log("Payload summary:", {
        model: payload.model,
        temperature: payload.temperature,
        top_p: payload.top_p,
        system_len: systemMessage.content.length,
        user_len: userMessage.content.length,
      });

      const response = await this.client.post("/chat/completions", payload);

      const content = this._extractContent(response);

      // Log content length to debug truncation issues
      console.log("\n" + "=".repeat(80));
      console.log("📥 PERPLEXITY RESPONSE");
      console.log("=".repeat(80));
      console.log("Content length:", content.length);
      console.log(
        "Content preview (first 500 chars):",
        content.substring(0, 500)
      );
      console.log(
        "Content preview (last 500 chars):",
        content.substring(Math.max(0, content.length - 500))
      );

      const articles = this._parseArticles(content);

      // Log parsed articles info
      console.log("\n📊 PARSED ARTICLES:");
      console.log("Article count:", articles.length);
      articles.forEach((article, idx) => {
        console.log(`Article ${idx + 1} length:`, article.article?.length || 0);
        if (article.article) {
          console.log(
            `Article ${idx + 1} preview:`,
            article.article.substring(0, 200)
          );
        }
      });
      console.log("=".repeat(80) + "\n");

      return {
        query: searchQuery,
        prompt,
        intent_summary: intent.intent_summary || null,
        articles,
        raw: response.data,
      };
    } catch (err) {
      // Handle 401 Unauthorized specifically
      if (err.response && err.response.status === 401) {
        const keyLength = this.apiKey ? this.apiKey.length : 0;
        const keyPreview =
          this.apiKey && this.apiKey.length > 8
            ? `${this.apiKey.substring(0, 4)}...${this.apiKey.substring(
                keyLength - 4
              )}`
            : "NOT_LOADED";

        const errorMsg = `Perplexity API authentication failed (401). API Key Status: ${keyPreview} (length: ${keyLength}). Please verify your PERPLEXITY_API_KEY is valid and not expired.`;
        console.error("[PERPLEXITY] 401 Error Details:", {
          status: err.response.status,
          statusText: err.response.statusText,
          apiKeyLength: keyLength,
          apiKeyPreview: keyPreview,
          responseData: err.response.data,
        });
        throw new Error(errorMsg);
      }

      // Handle other errors
      console.error("Perplexity Error:", err.message || err);
      throw new Error(
        "Failed to fetch news from Perplexity: " + (err.message || err)
      );
    }
  }
}

module.exports = PerplexityNewsFetcher;
