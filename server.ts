import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

interface LLMRequestConfig {
  provider?: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
}

// Helper to clean JSON response text
function cleanJsonResponse(rawText: string): string {
  let cleaned = rawText.trim();
  if (cleaned.startsWith("```json")) {
    cleaned = cleaned.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```\s*/, "").replace(/```$/i, "").trim();
  }
  return cleaned;
}

const VALID_GEMINI_MODELS = ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.5-flash-lite", "gemini-2.0-flash", "gemini-1.5-flash", "gemini-3.6-flash", "gemini-3.6-flash-lite", "gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-2.5-flash-preview-tts", "gemini-3.1-flash-tts-preview"];

// Sanitize model names for provider
function sanitizeModel(provider: string, model?: string): string {
  if (provider === "gemini") {
    if (!model || !VALID_GEMINI_MODELS.includes(model)) {
      return "gemini-3.6-flash";
    }
  }
  return model || (provider === "gemini" ? "gemini-3.6-flash" : "gpt-5.4-mini");
}

// Parse server-side LLM error
function parseServerError(err: any, provider: string = "gemini"): {
  statusCode: number;
  errorType: string;
  userMessage: string;
  isRetryable: boolean;
} {
  const originalMessage = err?.message || (typeof err === "string" ? err : JSON.stringify(err || {}));
  const lowerMsg = originalMessage.toLowerCase();
  const provUpper = provider.toUpperCase();

  let statusCode = err?.statusCode || err?.status || err?.code || 0;

  try {
    const jsonMatch = originalMessage.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsedJson = JSON.parse(jsonMatch[0]);
      const errObj = parsedJson.error || parsedJson;
      if (errObj.code && typeof errObj.code === "number") statusCode = errObj.code;
    }
  } catch {}

  if (statusCode === 401 || lowerMsg.includes("unauthenticated") || lowerMsg.includes("api_key_invalid") || lowerMsg.includes("invalid api key") || lowerMsg.includes("unregistered callers")) {
    return {
      statusCode: 401,
      errorType: "INVALID_KEY",
      userMessage: `Invalid ${provUpper} API Key (401): The provided API key is invalid or unrecognized. Please check your API key in settings.`,
      isRetryable: false
    };
  }

  if (statusCode === 403 || lowerMsg.includes("permission_denied") || lowerMsg.includes("permission denied") || lowerMsg.includes("api_key_service_blocked")) {
    return {
      statusCode: 403,
      errorType: "PERMISSION_DENIED",
      userMessage: `Access Forbidden (403): Your ${provUpper} API key lacks access permissions or Gemini is restricted in your region/project.`,
      isRetryable: false
    };
  }

  if (statusCode === 429 || lowerMsg.includes("resource_exhausted") || lowerMsg.includes("quota exceeded") || lowerMsg.includes("too many requests")) {
    return {
      statusCode: 429,
      errorType: "RATE_LIMIT",
      userMessage: `Rate Limit Exceeded (429): ${provUpper} API quota or rate limit reached.`,
      isRetryable: true
    };
  }

  if (statusCode === 404 || lowerMsg.includes("not_found") || lowerMsg.includes("model not found")) {
    return {
      statusCode: 404,
      errorType: "NOT_FOUND",
      userMessage: `Model Not Found (404): The requested ${provUpper} model is unavailable or endpoint path is invalid.`,
      isRetryable: false
    };
  }

  if (statusCode >= 500 || lowerMsg.includes("internal server error") || lowerMsg.includes("service unavailable") || lowerMsg.includes("overloaded")) {
    const code = statusCode || 503;
    return {
      statusCode: code,
      errorType: "SERVER_ERROR",
      userMessage: `${provUpper} Server Error (${code}): Google/Provider AI servers are temporarily busy or undergoing maintenance.`,
      isRetryable: true
    };
  }

  return {
    statusCode: statusCode || 400,
    errorType: "UNKNOWN",
    userMessage: `${provUpper} Error: ${originalMessage || "Failed to communicate with LLM provider."}`,
    isRetryable: statusCode >= 500 || statusCode === 429
  };
}

// Call LLM based on provider
async function callLLM(
  prompt: string, 
  systemInstruction: string, 
  schemaDescription: string,
  llmConfig?: LLMRequestConfig
): Promise<string> {
  const provider = llmConfig?.provider || "gemini";
  const model = sanitizeModel(provider, llmConfig?.model);
  const apiKey = llmConfig?.apiKey || (provider === "gemini" ? process.env.GEMINI_API_KEY : "");
  const baseUrl = llmConfig?.baseUrl || "";

  const requiresKey = provider !== "ollama" && provider !== "custom" && provider !== "gemini";
  let effectiveApiKey = apiKey || (provider === "gemini" ? process.env.GEMINI_API_KEY || "" : "");

  if (requiresKey && !effectiveApiKey) {
    throw new Error(`API Key is required for provider: ${provider}. Please enter a valid API key in the LLM settings.`);
  }

  if (provider === "gemini" && !effectiveApiKey) {
    throw new Error(`Gemini API Key is missing. Please enter your Gemini API key in LLM settings or configure GEMINI_API_KEY.`);
  }

  if (!effectiveApiKey) {
    effectiveApiKey = "local-token";
  }

  if (provider === "gemini") {
    const ai = new GoogleGenAI({
      apiKey: effectiveApiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
    });

    const primaryModel = model || "gemini-3.6-flash";
    const fallbackModels = ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-2.5-flash"].filter(m => m !== primaryModel);

    let lastError: any = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const activeModel = attempt === 1 ? primaryModel : (fallbackModels[0] || "gemini-2.0-flash");
      try {
        const response = await ai.models.generateContent({
          model: activeModel,
          contents: prompt,
          config: {
            systemInstruction,
            responseMimeType: "application/json"
          }
        });

        if (!response.text) {
          throw new Error("Empty response received from Gemini model.");
        }
        return cleanJsonResponse(response.text);
      } catch (err: any) {
        lastError = err;
        const parsed = parseServerError(err, "gemini");
        if (!parsed.isRetryable && parsed.statusCode !== 404) {
          throw err;
        }
        console.warn(`[Gemini Server Retry ${attempt}/3] Model ${activeModel} failed: ${err?.message}`);
        if (attempt < 3) {
          await new Promise((r) => setTimeout(r, 1000 * attempt));
        }
      }
    }
    throw lastError;
  } 

  if (provider === "anthropic") {
    const endpoint = (baseUrl || "https://api.anthropic.com") + "/v1/messages";
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "x-api-key": effectiveApiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: model || "claude-3-5-haiku-20241022",
        max_tokens: 2048,
        system: systemInstruction + "\nOutput MUST be strictly valid raw JSON complying with schema:\n" + schemaDescription,
        messages: [{ role: "user", content: prompt }]
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Anthropic Error (${res.status}): ${errText}`);
    }

    const data: any = await res.json();
    const contentText = data.content?.[0]?.text || "";
    return cleanJsonResponse(contentText);
  }

  // OpenAI-compatible providers: openai, github, 9flare, ollama, groq, openrouter, custom
  let defaultBaseUrl = "https://api.openai.com/v1";
  if (provider === "groq") defaultBaseUrl = "https://api.groq.com/openai/v1";
  if (provider === "openrouter") defaultBaseUrl = "https://openrouter.ai/api/v1";
  if (provider === "github") defaultBaseUrl = "https://models.github.ai/inference";
  if (provider === "9flare") defaultBaseUrl = "https://9flare.com/api/v1";
  if (provider === "ollama") defaultBaseUrl = "https://ollama.com/v1";
  if (provider === "custom") defaultBaseUrl = "http://localhost:11434/v1";

  const targetUrl = (baseUrl || defaultBaseUrl).replace(/\/$/, "") + "/chat/completions";

  const headers: Record<string, string> = {
    "Authorization": `Bearer ${effectiveApiKey}`,
    "Content-Type": "application/json"
  };

  if (provider === "openrouter") {
    headers["HTTP-Referer"] = "https://aistudio.google.com";
    headers["X-Title"] = "Vocabulary Learner";
  }

  const reqBody: any = {
    model: model || "gpt-5.4-mini",
    messages: [
      { role: "system", content: systemInstruction + "\nOutput MUST be strictly valid raw JSON matching:\n" + schemaDescription },
      { role: "user", content: prompt }
    ]
  };

  // Many OpenAI compatible endpoints accept response_format: { type: "json_object" }
  if (provider === "openai" || provider === "groq" || provider === "openrouter" || provider === "9flare") {
    reqBody.response_format = { type: "json_object" };
  }

  const res = await fetch(targetUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(reqBody)
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`${provider.toUpperCase()} API Error (${res.status}): ${errText}`);
  }

  const data: any = await res.json();
  const text = data.choices?.[0]?.message?.content || "";
  return cleanJsonResponse(text);
}

// 1. Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// 2. Test LLM Connection endpoint
app.post("/api/test-llm", async (req, res) => {
  try {
    const { llmConfig } = req.body;
    const text = await callLLM(
      "Respond with a short json object: {\"status\": \"connected\", \"message\": \"LLM provider connection successful!\"}",
      "You are a helpful dictionary test assistant.",
      "{\n  \"status\": \"string\",\n  \"message\": \"string\"\n}",
      llmConfig
    );
    res.json({ success: true, response: text });
  } catch (error: any) {
    console.error("LLM Test Error:", error);
    const parsed = parseServerError(error, req.body?.llmConfig?.provider || "gemini");
    const code = parsed.statusCode >= 400 && parsed.statusCode < 600 ? parsed.statusCode : 400;
    res.status(code).json({
      success: false,
      error: parsed.userMessage,
      statusCode: parsed.statusCode,
      errorType: parsed.errorType,
      isRetryable: parsed.isRetryable
    });
  }
});

// 3. Generate custom vocabulary deck
app.post("/api/generate-deck", async (req, res) => {
  try {
    const { topic, targetLanguage, nativeLanguage, quantity = 8, llmConfig } = req.body;

    if (!topic) {
      return res.status(400).json({ error: "Topic is required" });
    }

    const userNative = nativeLanguage || localStorage?.getItem?.("vocab_learner_native_lang") || "English";
    const userTarget = targetLanguage || "Spanish";

    const prompt = `Generate a high-quality list of ${quantity} vocabulary words/expressions on the topic: "${topic}".
The target language that the user wants to learn is "${userTarget}".
The user's native language for translations is "${userNative}".

CRITICAL INSTRUCTIONS:
- "definition": Write clear, easy-to-understand definitions/explanations of each target word STRICTLY in the TARGET language (${userTarget}) for target language learning immersion. Do NOT write definitions in the native language (${userNative}).
- "translation": Direct translation into the user's native language (${userNative}).
- "example": Example sentence in target language (${userTarget}).
- "exampleTranslation": Translation of the example sentence into the user's native language (${userNative}).
- "imageUrl": Generate a relevant image URL using Pollinations AI. Format MUST be: "https://image.pollinations.ai/prompt/[short-english-description-of-word-or-topic]?width=800&height=600&nologo=true"
Ensure the words selected cover different skill levels and are practical for real conversation.`;

    const systemInstruction = `You are an expert language teacher specializing in creating vocabulary material for learners of ${userTarget}.`;
    const schemaDesc = `{
  "name": "Creative deck title",
  "description": "Short description in ${userNative}",
  "words": [
    {
      "word": "string (target word in ${userTarget})",
      "pronunciation": "string (IPA format)",
      "partOfSpeech": "string",
      "definition": "string (definition written STRICTLY in ${userTarget})",
      "translation": "string (direct translation in ${userNative})",
      "example": "string (sentence in ${userTarget})",
      "exampleTranslation": "string (sentence translation in ${userNative})",
      "imageUrl": "string (pollinations AI image URL)"
    }
  ]
}`;

    const text = await callLLM(prompt, systemInstruction, schemaDesc, llmConfig);
    const result = JSON.parse(text);
    res.json(result);
  } catch (error: any) {
    console.error("Error generating deck:", error);
    const parsed = parseServerError(error, req.body?.llmConfig?.provider || "gemini");
    const code = parsed.statusCode >= 400 && parsed.statusCode < 600 ? parsed.statusCode : 500;
    res.status(code).json({ error: parsed.userMessage, statusCode: parsed.statusCode, errorType: parsed.errorType });
  }
});

// 4. Auto-fill a single word
app.post("/api/autofill-word", async (req, res) => {
  try {
    const { word, targetLanguage, nativeLanguage, notebookName, notebookDescription, llmConfig } = req.body;

    if (!word) {
      return res.status(400).json({ error: "Word is required" });
    }

    const userNative = nativeLanguage || "English";
    const userTarget = targetLanguage || "Spanish";

    const notebookContextText = notebookName 
      ? `\nNOTEBOOK CONTEXT: The term "${word}" belongs to the Vocabulary Notebook "${notebookName}"${notebookDescription ? ` (${notebookDescription})` : ""}. Tailor the definition, example sentence, and image visual description specifically to fit this notebook context.`
      : "";

    const prompt = `Provide detailed vocabulary learning material for the word or expression "${word}".
Target language being learned: "${userTarget}".
User's native language: "${userNative}".${notebookContextText}

CRITICAL MANDATORY REQUIREMENT:
- "definition": You MUST write the definition/explanation STRICTLY in the TARGET language (${userTarget}) for target language immersion. Do NOT write the definition in the native language (${userNative}). Tailor it to the notebook topic if applicable.
- "translation": Provide the direct, accurate translation of "${word}" into the user's native language (${userNative}).
- "pronunciation": International Phonetic Alphabet (IPA) pronunciation guide.
- "partOfSpeech": noun, verb, adjective, adverb, idiom, or expression.
- "example": A realistic, high-quality example sentence in the target language (${userTarget})${notebookName ? ` contextualized to ${notebookName}` : ""}.
- "exampleTranslation": Full translation of the example sentence into the user's native language (${userNative}).
- "imageUrl": Generate a relevant image URL using Pollinations AI. Format MUST be: "https://image.pollinations.ai/prompt/[short-english-description-of-word${notebookName ? `-in-context-of-${encodeURIComponent(notebookName.toLowerCase().replace(/[^a-z0-0]/g, '-'))}` : ""}]?width=800&height=600&nologo=true"`;

    const systemInstruction = `You are a professional multilingual dictionary database engine. Always output definitions in the target language (${userTarget}) and translations in the user's native language (${userNative}).${notebookName ? ` Notebook topic context: ${notebookName}.` : ""}`;
    const schemaDesc = `{
  "word": "string",
  "pronunciation": "string",
  "partOfSpeech": "string",
  "definition": "string (definition written STRICTLY in ${userTarget})",
  "translation": "string (translation in ${userNative})",
  "example": "string (example in ${userTarget})",
  "exampleTranslation": "string (example translation in ${userNative})",
  "imageUrl": "string (pollinations AI image URL)"
}`;

    const text = await callLLM(prompt, systemInstruction, schemaDesc, llmConfig);
    const result = JSON.parse(text);
    res.json(result);
  } catch (error: any) {
    console.error("Error autofilling word:", error);
    const parsed = parseServerError(error, req.body?.llmConfig?.provider || "gemini");
    const code = parsed.statusCode >= 400 && parsed.statusCode < 600 ? parsed.statusCode : 500;
    res.status(code).json({ error: parsed.userMessage, statusCode: parsed.statusCode, errorType: parsed.errorType });
  }
});

// 4.5. Generate random words for notebook (deduplicated against existing)
app.post("/api/generate-random-words", async (req, res) => {
  try {
    const { topic, targetLanguage, nativeLanguage, count = 5, existingWords = [], llmConfig } = req.body;

    const userNative = nativeLanguage || "English";
    const userTarget = targetLanguage || "Spanish";

    const avoidText = Array.isArray(existingWords) && existingWords.length > 0
      ? `\n\nCRITICAL DEDUPLICATION RULE: Do NOT generate any of the following words that ALREADY exist in the notebook:\n[ ${existingWords.slice(0, 100).join(", ")} ]`
      : "";

    const prompt = `Generate ${count} new, unique, practical vocabulary words or expressions in target language "${userTarget}" relevant to or expanding on the notebook topic "${topic || "Vocabulary"}".
The user's native language is "${userNative}".${avoidText}

CRITICAL INSTRUCTIONS:
- Every word generated MUST BE UNIQUE and NOT present in the existing notebook list above.
- "definition": Write clear, concise definitions/explanations STRICTLY in the TARGET language (${userTarget}) for target language immersion.
- "translation": Direct translation into the user's native language (${userNative}).
- "example": Realistic example sentence in target language (${userTarget}).
- "exampleTranslation": Translation of example sentence into user's native language (${userNative}).
- "imageUrl": Generate a vivid, specific example image URL using Pollinations AI. Format MUST be: "https://image.pollinations.ai/prompt/[short-english-description-of-word-or-action]?width=800&height=600&nologo=true"`;

    const systemInstruction = `You are an expert language teacher. Output strictly a JSON object containing an array of new unique vocabulary words.`;
    const schemaDesc = `{
  "words": [
    {
      "word": "string (target word in ${userTarget})",
      "pronunciation": "string (IPA format)",
      "partOfSpeech": "string",
      "definition": "string (definition written STRICTLY in ${userTarget})",
      "translation": "string (direct translation in ${userNative})",
      "example": "string (sentence in ${userTarget})",
      "exampleTranslation": "string (sentence translation in ${userNative})",
      "imageUrl": "string (pollinations AI image URL)"
    }
  ]
}`;

    const text = await callLLM(prompt, systemInstruction, schemaDesc, llmConfig);
    const result = JSON.parse(text);
    res.json(result);
  } catch (error: any) {
    console.error("Error generating random words:", error);
    const parsed = parseServerError(error, req.body?.llmConfig?.provider || "gemini");
    const code = parsed.statusCode >= 400 && parsed.statusCode < 600 ? parsed.statusCode : 500;
    res.status(code).json({ error: parsed.userMessage, statusCode: parsed.statusCode, errorType: parsed.errorType });
  }
});

// 5. Text-to-Speech API
app.post("/api/tts", async (req, res) => {
  try {
    const { text, engine, model, voice, apiKey, customEndpoint, llmConfig } = req.body;

    if (!text) {
      return res.status(400).json({ error: "Text is required for TTS generation" });
    }

    const effectiveApiKey = apiKey || (llmConfig?.provider === engine ? llmConfig?.apiKey : undefined) || (engine === "gemini" ? process.env.GEMINI_API_KEY : "");

    if (engine === "gemini") {
      const keyToUse = effectiveApiKey || process.env.GEMINI_API_KEY;
      if (!keyToUse) {
        return res.status(400).json({ error: "Gemini API key is required for Gemini AI TTS model" });
      }

      const ai = new GoogleGenAI({
        apiKey: keyToUse,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
      });

      const targetTtsModel = (model && VALID_GEMINI_MODELS.includes(model)) ? model : "gemini-3.6-flash";
      const response = await ai.models.generateContent({
        model: targetTtsModel,
        contents: `Pronounce the following text clearly for a language learner: "${text}"`,
        config: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: voice || "Puck"
              }
            }
          }
        }
      });

      const candidate = response.candidates?.[0];
      const part = candidate?.content?.parts?.find((p: any) => p.inlineData);

      if (part && part.inlineData) {
        const mimeType = part.inlineData.mimeType || "audio/mp3";
        const base64Data = part.inlineData.data;
        return res.json({ audioDataUrl: `data:${mimeType};base64,${base64Data}` });
      }

      return res.status(422).json({ error: "Gemini model did not return inline audio. Falling back to browser speech synthesis." });
    }

    if (engine === "openai") {
      if (!effectiveApiKey) {
        return res.status(400).json({ error: "OpenAI API key is required for OpenAI TTS model" });
      }

      const ttsRes = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${effectiveApiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: model || "tts-1",
          input: text,
          voice: voice || "alloy"
        })
      });

      if (!ttsRes.ok) {
        const errText = await ttsRes.text();
        throw new Error(`OpenAI TTS API Error (${ttsRes.status}): ${errText}`);
      }

      const audioBuffer = await ttsRes.arrayBuffer();
      const base64Audio = Buffer.from(audioBuffer).toString("base64");
      return res.json({ audioDataUrl: `data:audio/mp3;base64,${base64Audio}` });
    }

    if (engine === "custom") {
      if (!customEndpoint) {
        return res.status(400).json({ error: "Custom endpoint URL is required for custom TTS model" });
      }

      const customRes = await fetch(customEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(effectiveApiKey ? { "Authorization": `Bearer ${effectiveApiKey}` } : {})
        },
        body: JSON.stringify({ text, voice, model })
      });

      if (!customRes.ok) {
        const errText = await customRes.text();
        throw new Error(`Custom TTS Error (${customRes.status}): ${errText}`);
      }

      const contentType = customRes.headers.get("content-type") || "";
      if (contentType.includes("json")) {
        const json: any = await customRes.json();
        return res.json({ audioDataUrl: json.audioDataUrl || json.url || json.audio });
      } else {
        const audioBuffer = await customRes.arrayBuffer();
        const base64Audio = Buffer.from(audioBuffer).toString("base64");
        return res.json({ audioDataUrl: `data:audio/mp3;base64,${base64Audio}` });
      }
    }

    return res.status(400).json({ error: "Unsupported TTS engine specified" });
  } catch (error: any) {
    console.error("TTS API Error:", error);
    res.status(500).json({ error: error.message || "Failed to generate speech with AI TTS model" });
  }
});

// 6. Analyze Performance with AI endpoint
app.post("/api/analyze-performance", async (req, res) => {
  try {
    const { stats, totalWords, masteredWords = [], improvingWords = [], decksSummary = [], llmConfig } = req.body;

    const masteredSampleStr = (masteredWords || []).slice(0, 15).map((w: any) => `${w.word} (${w.translation || w.definition})`).join(", ") || "None yet";
    const improvingSampleStr = (improvingWords || []).slice(0, 15).map((w: any) => `${w.word} (level ${w.strength ?? 0}, ${w.translation || w.definition})`).join(", ") || "None yet";
    const decksStr = (decksSummary || []).map((d: any) => `${d.name}: ${d.masteredCount}/${d.totalWords} mastered`).join("; ") || "No custom decks yet";

    const prompt = `You are an elite AI Language Learning Coach & Vocabulary Analyst. Analyze the following student performance data and provide a personalized, deeply insightful analytics report.

STUDENT PERFORMANCE DATA:
- Total Vocabulary Words in Collection: ${totalWords || 0}
- Total Words Mastered: ${stats?.totalWordsMastered || 0}
- Total Words Studied/Reviewed: ${stats?.totalWordsStudied || 0}
- Quizzes Completed: ${stats?.totalQuizzesTaken || 0}
- Correct Answers in Quizzes: ${stats?.totalCorrectAnswers || 0}
- Active Study Streak: ${stats?.streak?.count || 0} days

DECKS PROGRESS SUMMARY:
${decksStr}

SAMPLE MASTERED WORDS:
${masteredSampleStr}

SAMPLE WORDS NEEDING IMPROVEMENT:
${improvingSampleStr}

Provide a structured AI analysis with constructive insights, memory retention strategies, and actionable guidance for the learner.`;

    const systemInstruction = `You are an encouraging, expert AI vocabulary coach. Output strictly structured JSON analytics.`;
    const schemaDesc = `{
  "overallAssessment": "string (Empowering 2-3 sentence overview of learner's trajectory)",
  "strengthsSummary": "string (Key strengths and patterns where the learner excels)",
  "weaknessesSummary": "string (Specific word patterns or areas needing improvement)",
  "actionableTips": [
    "string (Actionable study tip 1)",
    "string (Actionable study tip 2)",
    "string (Actionable study tip 3)"
  ],
  "recommendedFocusTopics": [
    "string (Suggested focus theme 1)",
    "string (Suggested focus theme 2)"
  ],
  "motivationQuote": "string (Short inspiring quote for language learners)"
}`;

    const text = await callLLM(prompt, systemInstruction, schemaDesc, llmConfig);
    const result = JSON.parse(text);
    res.json(result);
  } catch (error: any) {
    console.error("Error analyzing performance:", error);
    const parsed = parseServerError(error, req.body?.llmConfig?.provider || "gemini");
    const code = parsed.statusCode >= 400 && parsed.statusCode < 600 ? parsed.statusCode : 500;
    res.status(code).json({ error: parsed.userMessage, statusCode: parsed.statusCode, errorType: parsed.errorType });
  }
});

// Start express server with Vite configuration
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

