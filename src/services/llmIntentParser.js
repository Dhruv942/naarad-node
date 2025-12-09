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
    const followups =
      Array.isArray(followup_questions) && followup_questions.length > 0
        ? followup_questions
            .map((fq) => {
              if (fq && typeof fq === "object") {
                const q = fq.question ? `Q:${fq.question}` : "Q:Unknown";
                const sel = fq.selected_answer
                  ? `Selected:${fq.selected_answer}`
                  : "Selected:None";
                const opts =
                  Array.isArray(fq.options) && fq.options.length > 0
                    ? `Options:${fq.options.join("/")}`
                    : "Options:None";
                return `${q} | ${opts} | ${sel}`;
              }
              if (typeof fq === "string") return fq;
              return "";
            })
            .filter(Boolean)
            .join("; ")
        : "None";
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
- how recent the news should be,
- how the final update can feel curated and satisfying for the user.

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
  "intent_summary": "Deep, detailed interpretation. MUST include and merge ALL parts: category, subcategories, follow-ups (respecting the user's SELECTED answers as strong preferences), custom question, domain, and topic.

Example style:
'The user wants alerts for cricket in the Sports category with focus on Test, ODI and T20 formats, especially player or team updates. They specifically want only final match scores, win/lose updates, day-wise Test scores and YouTube highlights if available.'

The summary must read like this level of detail.",
  "timeframe": "24hours|3days|1week|1month",
"perplexity_query": "Natural-language, single-sentence search query (no AND/OR/boolean). MUST include category, subcategories, follow-ups (if any), custom question, and the recency constraint from timeframe (e.g., last 3 days / last 24 hours). Keep it concise (<220 chars) and readable."


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
   - "24hours" for urgent/live/score alerts
   - "3days" for recent updates (default)
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
      category = "",
      timeframe = "3days",
      intent_summary = "",
    } = alertData;

    // If intent_summary already exists, use that directly to avoid noisy queries
    const summaryClean =
      typeof intent_summary === "string" ? intent_summary.trim() : "";
    if (summaryClean) return summaryClean;

    const main = category || topic || "news";
    const subs =
      Array.isArray(subcategories) && subcategories.length > 0
        ? ` about ${subcategories.slice(0, 2).join(", ")}`
        : "";
    const custom =
      typeof custom_question === "string" && custom_question.trim().length > 0
        ? ` and also address: ${custom_question.trim()}`
        : "";
    const tf =
      timeframe === "24hours"
        ? "in the last 24 hours"
        : timeframe === "1week"
        ? "in the last 7 days"
        : timeframe === "1month"
        ? "in the last 30 days"
        : "in the last 3 days";

    const sentence = `Find latest ${main}${subs}${custom}, strictly ${tf}.`;
    return sentence.length > 220 ? sentence.slice(0, 220) : sentence;
  }

  /**
   * Build preference notes to feed into perplexity prompt
   */
  _buildPreferenceNotes(alertData = {}) {
    const {
      subcategories,
      followup_questions,
      custom_question,
      topic,
      category,
    } = alertData || {};

    const notes = [];

    if (Array.isArray(subcategories) && subcategories.length > 0) {
      notes.push(`Prioritize sub-interests: ${subcategories.join(", ")}`);
    }

    const cleanedFollowUps = Array.isArray(followup_questions)
      ? followup_questions
          .filter((q) => typeof q === "string" && q.trim().length > 0)
          .map((q) => q.trim())
      : [];
    if (cleanedFollowUps.length > 0) {
      notes.push(
        `Answer follow-up prompts such as: ${cleanedFollowUps.join("; ")}`
      );
    }

    const trimmedCustom =
      typeof custom_question === "string" ? custom_question.trim() : "";
    if (trimmedCustom) {
      notes.push(`Directly cover the custom ask: ${trimmedCustom}`);
    }

    const domain = topic || category;
    if (domain) {
      notes.push(
        `Anchor every update strictly to ${domain} and avoid unrelated detours.`
      );
    }

    notes.push(
      "Select only premium, well-sourced reportage — no gossip, no clickbait, no low-credibility blogs."
    );
    notes.push(
      "Craft the experience to feel personalized, high-trust, and satisfaction-first."
    );

    return notes.join(" | ");
  }

  /**
   * Perplexity prompt builder
   */
  _buildPerplexityPrompt(
    intentSummary,
    context,
    timeframe,
    focusAreas,
    preferenceNotes = ""
  ) {
    const safeFocus = Array.isArray(focusAreas)
      ? focusAreas.filter(Boolean).join(", ")
      : "";

    const focusLine =
      safeFocus ||
      "Use the alert’s core category/subcategories as focus anchors.";
    const preferenceLine =
      preferenceNotes ||
      "Mirror every stated preference or custom ask and make the user feel the news was hand-picked.";

    return `
You are Naarad's premium news concierge.

MISSION:
1. Fetch only authoritative, fact-checked reporting that aligns with the alert intent.
2. Blend relevance + freshness so the user feels the update is handcrafted for them.
3. Never invent details; cite only what trusted publications have actually reported.





OUTPUT RULES:
- Produce 3–5 flowing paragraphs (no titles, bullets, markdown, or quotes block).
- Include concrete dates, numbers, companies, deals, KPIs, or analyst takeaways whenever available.
- Maintain a modern, factual newsroom tone — calm, confident, premium.
- Highlight why each development matters to the user's stated focus areas.
- If a detail cannot be verified, be explicit and move on without speculation.

QUALITY FILTERS:
- Exclude politics, gossip, paid PR, rumor blogs, or low-signal chatter unless explicitly required.
- Reject repetitive facts; every sentence should add value.
- Prefer cross-verified coverage from outlets such as Reuters, Bloomberg, WSJ, FT, Guardian, BBC, Mint, ET, Moneycontrol, etc.

Finish only after delivering the paragraphs. No extra commentary.
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

    const timeframe = requiresLiveData ? "24hours" : "3days";

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
      // perplexity_prompt is now built in PerplexityNewsFetcher
      requires_live_data: requiresLiveData,
    };
  }

  _normalizeIntent(intent, alertData) {
    if (typeof intent.subcategory === "string") {
      intent.subcategory = [intent.subcategory];
    }
    if (typeof intent.followup_questions === "string") {
      intent.followup_questions = [intent.followup_questions];
    }

    const valid = ["24hours", "3days", "1week", "1month"];
    if (!valid.includes(intent.timeframe)) intent.timeframe = "3days";

    if (intent.requires_live_data == null) {
      const urgency =
        intent.custom_question ||
        (intent.followup_questions && intent.followup_questions.join(" "));
      intent.requires_live_data = this._detectUrgency(urgency);
    }

    if (intent.requires_live_data) intent.timeframe = "24hours";

    // Ensure perplexity_query exists and is concise
    if (
      !intent.perplexity_query ||
      typeof intent.perplexity_query !== "string" ||
      !intent.perplexity_query.trim()
    ) {
      intent.perplexity_query = this._buildPerplexityQuery(alertData || intent);
    }
    // Trim and cap length to keep retrieval tight
    intent.perplexity_query = intent.perplexity_query.trim();
    if (intent.perplexity_query.length > 180) {
      intent.perplexity_query = intent.perplexity_query.slice(0, 180);
    }

    // perplexity_prompt is now built in PerplexityNewsFetcher, not here
    // Remove any perplexity_prompt that might have come from Gemini
    delete intent.perplexity_prompt;

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

      // Normalize intent and add perplexity_prompt (always built directly, not from Gemini)
      return this._normalizeIntent(parsed, alertData);
    } catch (e) {
      console.log("LLM parse error", e.message);
      return this._fallbackParse(alertData);
    }
  }
}

module.exports = LLMIntentParser;
