const { GoogleGenerativeAI } = require("@google/generative-ai");
const GeminiConfig = require("../config/geminiConfig");

class LLMIntentParser {
  constructor(apiKey = null, model = null) {
    this.apiKey = apiKey || GeminiConfig.getApiKey();
    this.modelName = model || GeminiConfig.getModel();
    this.genAI = new GoogleGenerativeAI(this.apiKey);
    this.model = this.genAI.getGenerativeModel({
      model: this.modelName,
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 2048,
        responseMimeType: "application/json",
      },
      safetySettings: [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
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
   * --------------------------------------------
   *    UPDATED + ADVANCED INTENT PARSER PROMPT
   * --------------------------------------------
   */
  _buildPrompt(alertData) {
    const {
      topic,
      category,
      subcategories = [],
      followup_questions = [],
      custom_question = "",
    } = alertData;

    const combinedTopic = topic || category || "General";
    const followups = followup_questions.join(", ");
    const subs = subcategories.join(", ");

    return `
You are "Naarad AI" — an advanced intent understanding engine.

Your job is to understand the COMPLETE user alert intent with maximum detail by merging ALL the following fields together:
- topic
- category
- subcategories
- follow-up questions
- custom question

You must generate a human-like intent summary that explains exactly:
- what the user wants,
- in what format,
- at what detail,
- what conditions or filters matter,
- which direction to track,
- how recent the news should be.

Do NOT create generic summaries.

USER ALERT:
- Topic: ${combinedTopic}
- Category: ${category || "Not specified"}
- Subcategories: ${subs || "None"}
- Follow-up Questions: ${followups || "None"}
- Custom Question: ${custom_question || "None"}

Return valid JSON ONLY:

{
  "topic": "main subject",
  "category": "category name",
  "subcategory": ["..."],
  "custom_question": "exact custom text",
  "followup_questions": ["..."],
  "intent_summary": "Deep, detailed interpretation. MUST include and merge ALL parts: category, subcategories, follow-ups, custom question, domain, and topic.

Example style:
'The user wants alerts for cricket in the Sports category with focus on Test, ODI and T20 formats, especially player or team updates. They specifically want only final match scores, win/lose updates, day-wise Test scores and YouTube highlights if available.'

The summary must read like this level of detail.",
  "timeframe": "24hours|3days|1week|1month",
  "perplexity_query": "optimized search query",
  "perplexity_prompt": "instructions for news fetching",
  "requires_live_data": true/false
}

RULES:

1. ALWAYS incorporate:
   - category
   - subcategories
   - custom question
   - follow-up questions
   - topic

2. NEVER drop numbers, dates, reports or specific domain signals.

3. Timeframe rules:
   - "24hours" for urgent or live or score type alerts
   - "3days" for recent updates
   - "1week" for general updates
   - "1month" for long trend requests

4. The JSON must always be complete, detailed and meaningful.

5. NEVER output markdown, explanation or extra text — ONLY JSON.
`;
  }

  /**
   * Detect urgency keywords for timeframe
   */
  _detectUrgency(text) {
    if (!text) return false;
    const urgencyKeywords = [
      "only",
      "win",
      "won",
      "result",
      "score",
      "breaking",
      "live",
      "today",
      "now",
    ];
    return urgencyKeywords.some((k) => text.toLowerCase().includes(k));
  }

  /**
   * Build Perplexity Query
   */
  _buildPerplexityQuery(alertData) {
    const {
      custom_question = "",
      subcategories = [],
      followup_questions = [],
      topic = "",
    } = alertData;

    const stopWords = new Set([
      "the",
      "a",
      "an",
      "and",
      "or",
      "but",
      "in",
      "on",
      "at",
      "to",
      "for",
      "of",
      "with",
      "by",
      "from",
      "is",
      "are",
      "was",
      "were",
      "be",
      "been",
      "being",
      "have",
      "has",
      "had",
      "do",
      "does",
      "did",
      "will",
      "would",
      "should",
      "could",
      "may",
      "might",
      "must",
      "can",
    ]);

    const terms = [];

    if (custom_question) {
      terms.push(
        ...custom_question
          .toLowerCase()
          .split(/\s+/)
          .filter((w) => w.length > 2 && !stopWords.has(w))
          .slice(0, 3)
      );
    }

    if (subcategories.length > 0) {
      terms.push(
        ...subcategories
          .slice(0, 2)
          .map((c) => c.toLowerCase().replace(/\s+/g, ""))
      );
    }

    if (followup_questions.length > 0) {
      terms.push(
        ...followup_questions[0]
          .toLowerCase()
          .split(/\s+/)
          .filter((w) => w.length > 2 && !stopWords.has(w))
          .slice(0, 2)
      );
    }

    if (topic) {
      const t = topic.toLowerCase().replace(/\s+/g, "");
      if (!terms.includes(t)) terms.push(t);
    }

    const uniqueTerms = [...new Set(terms)];

    return uniqueTerms.length === 0
      ? "latest news"
      : `${uniqueTerms.join(" AND ")} latest news`;
  }

  /**
   * Perplexity prompt builder
   */
  _buildPerplexityPrompt(intentSummary, context, timeframe, focusAreas) {
    return `
You are a strict news summarizer for Naarad.

Task: Fetch the most relevant and recent news based on the user's inferred intent.

USER INTENT SUMMARY:
${intentSummary}

CONTEXT:
${context}
Timeframe: ${timeframe}
Focus: ${focusAreas.join(", ")}

EXCLUSIONS:
politics, gossip, opinions, controversies, clickbait

OUTPUT RULES:
- Return 3–5 full article-style paragraphs
- Preserve ALL numbers, dates, percentages, and metrics EXACTLY
- No titles, bullets, or markdown
- Tone casual but clear and factual
- Every article must contain actual stats when available
`;
  }

  /**
   * Fallback
   */
  _fallbackParse(alertData) {
    const {
      topic = "",
      category = "",
      subcategories = [],
      followup_questions = [],
      custom_question = "",
    } = alertData;

    const requiresLiveData = this._detectUrgency(
      custom_question || followup_questions.join(" ")
    );

    const timeframe = requiresLiveData ? "24hours" : "1week";

    const intentSummary = `User wants updates on ${topic || category}${
      subcategories.length > 0 ? ` focusing on ${subcategories.join(", ")}` : ""
    }${custom_question ? ` and specifically ${custom_question}` : ""}`;

    return {
      topic: topic || category,
      category: category || topic,
      subcategory: subcategories,
      custom_question,
      followup_questions,
      intent_summary: intentSummary,
      timeframe,
      perplexity_query: this._buildPerplexityQuery(alertData),
      perplexity_prompt: this._buildPerplexityPrompt(
        intentSummary,
        `${category} news`,
        timeframe,
        subcategories
      ),
      requires_live_data: requiresLiveData,
    };
  }

  _normalizeIntent(intent) {
    if (typeof intent.subcategory === "string") {
      intent.subcategory = [intent.subcategory];
    }
    if (typeof intent.followup_questions === "string") {
      intent.followup_questions = [intent.followup_questions];
    }

    const valid = ["24hours", "3days", "1week", "1month"];
    if (!valid.includes(intent.timeframe)) intent.timeframe = "1week";

    if (intent.requires_live_data == null) {
      const urgency =
        intent.custom_question ||
        (intent.followup_questions && intent.followup_questions.join(" "));
      intent.requires_live_data = this._detectUrgency(urgency);
    }

    if (intent.requires_live_data) intent.timeframe = "24hours";

    return intent;
  }

  /**
   * main entry
   */
  async parseIntent(alertData) {
    try {
      const result = await this.model.generateContent(
        this._buildPrompt(alertData)
      );
      const response = await result.response;

      if (!response.text().trim()) return this._fallbackParse(alertData);

      const cleaned = response
        .text()
        .replace(/```json/g, "")
        .replace(/```/g, "")
        .trim();

      let parsed = JSON.parse(cleaned);

      return this._normalizeIntent(parsed);
    } catch (e) {
      console.log("LLM parse error", e.message);
      return this._fallbackParse(alertData);
    }
  }
}

module.exports = LLMIntentParser;
