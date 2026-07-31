import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.APP_PORT ? parseInt(process.env.APP_PORT, 10) : 3000;

app.use(express.json());

interface LLMRequestConfig {
  provider?: string;
  model?: string;
  apiKey?: string;
  proxyKey?: string;
  baseUrl?: string;
  savedProviders?: Record<string, { proxyKey?: string; [key: string]: any }>;
}

// Helper to clean JSON response text
function cleanJsonResponse(rawText: string): string {
  if (!rawText) return "";
  let cleaned = rawText.trim();

  // Try extracting from markdown code blocks first
  const codeBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (codeBlockMatch && codeBlockMatch[1]) {
    cleaned = codeBlockMatch[1].trim();
  }

  // If still not starting with [ or {, search for the first [ or { and matching last ] or }
  if (!cleaned.startsWith("[") && !cleaned.startsWith("{")) {
    const firstSquare = cleaned.indexOf("[");
    const lastSquare = cleaned.lastIndexOf("]");
    const firstCurly = cleaned.indexOf("{");
    const lastCurly = cleaned.lastIndexOf("}");

    let startIdx = -1;
    let endIdx = -1;

    if (firstSquare !== -1 && (firstCurly === -1 || firstSquare < firstCurly)) {
      startIdx = firstSquare;
      endIdx = lastSquare;
    } else if (firstCurly !== -1) {
      startIdx = firstCurly;
      endIdx = lastCurly;
    }

    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      cleaned = cleaned.substring(startIdx, endIdx + 1).trim();
    }
  }

  return cleaned;
}

const VALID_GEMINI_MODELS = ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.5-flash-lite", "gemini-2.0-flash", "gemini-1.5-flash", "gemini-3.6-flash", "gemini-3.6-flash-lite", "gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-2.5-flash-preview-tts", "gemini-3.1-flash-tts-preview"];

// Sanitize model names for provider
function sanitizeModel(provider: string, model?: string): string {
  if (provider === "chatjimmy") {
    return model || "llama3.1-8B";
  }
  if (provider === "gemini") {
    if (!model || !VALID_GEMINI_MODELS.includes(model)) {
      return "gemini-3.6-flash";
    }
  }
  return model || (provider === "chatjimmy" ? "llama3.1-8B" : provider === "gemini" ? "gemini-3.6-flash" : "gpt-5.4-mini");
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
  const provider = llmConfig?.provider || "openai";
  const model = sanitizeModel(provider, llmConfig?.model);
  const apiKey = llmConfig?.apiKey || (provider === "gemini" ? process.env.GEMINI_API_KEY : "");
  const sharedProxyKey = llmConfig?.proxyKey || 
    (llmConfig?.savedProviders ? Object.values(llmConfig.savedProviders).find(p => Boolean(p?.proxyKey))?.proxyKey : "") || 
    process.env.PROXY_KEY || process.env.PROXY_SECRET || process.env.X_PROXY_KEY || "";
  const proxyKey = sharedProxyKey;
  const baseUrl = llmConfig?.baseUrl || "";

  const requiresKey = provider !== "chatjimmy" && provider !== "ollama" && provider !== "custom" && provider !== "gemini" && provider !== "openai";
  let effectiveApiKey = apiKey || (provider === "gemini" ? process.env.GEMINI_API_KEY || "" : "");
  const effectiveProxyKey = proxyKey || apiKey || (provider === "gemini" ? process.env.GEMINI_API_KEY || "" : "") || process.env.PROXY_KEY || process.env.PROXY_SECRET || process.env.X_PROXY_KEY || "";

  if (requiresKey && !effectiveApiKey && !effectiveProxyKey) {
    throw new Error(`API Key or Proxy Secret is required for provider: ${provider}. Please enter a valid key in LLM settings.`);
  }

  if (provider === "gemini" && !effectiveApiKey && !effectiveProxyKey) {
    throw new Error(`Gemini API Key or Proxy Secret is missing. Please enter your key in LLM settings or configure GEMINI_API_KEY / PROXY_KEY.`);
  }

  if (!effectiveApiKey) {
    effectiveApiKey = "local-token";
  }

  if (provider === "chatjimmy") {
    const endpoint = baseUrl || "https://chatjimmy.ai/api/chat";
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Accept": "*/*",
        "Content-Type": "application/json",
        "Origin": "https://chatjimmy.ai",
        "Referer": "https://chatjimmy.ai/",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
        ...(effectiveProxyKey ? { "X-Proxy-Key": effectiveProxyKey } : {})
      },
      body: JSON.stringify({
        messages: [
          {
            role: "user",
            content: prompt
          }
        ],
        chatOptions: {
          selectedModel: model || "llama3.1-8B",
          systemPrompt: systemInstruction + "\n\nCRITICAL INSTRUCTION: Output STRICTLY raw valid JSON matching schema:\n" + schemaDescription + "\nDo NOT include any conversational preamble, intro text, markdown code blocks, or explanations.",
          topK: 8
        },
        attachment: null
      })
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      throw new Error(`ChatJimmy API Error (${res.status}): ${errText}`);
    }

    const resText = await res.text();
    const cleanText = resText.split("<|stats|>")[0];
    return cleanJsonResponse(cleanText);
  }

  if (provider === "gemini") {
    const ai = new GoogleGenAI({
      apiKey: effectiveApiKey || effectiveProxyKey || "local-key",
      httpOptions: { 
        headers: { 
          'User-Agent': 'aistudio-build',
          ...(effectiveProxyKey ? { 'X-Proxy-Key': effectiveProxyKey } : {})
        } 
      }
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
        "content-type": "application/json",
        ...(effectiveProxyKey ? { "X-Proxy-Key": effectiveProxyKey } : {})
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
    "Content-Type": "application/json"
  };

  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  } else if (provider !== "ollama" && effectiveApiKey) {
    headers["Authorization"] = `Bearer ${effectiveApiKey}`;
  }

  if (provider === "openrouter") {
    headers["HTTP-Referer"] = "https://aistudio.google.com";
    headers["X-Title"] = "Vocabulary Learner";
  }

  if (effectiveProxyKey || (baseUrl && (baseUrl.includes("workers.dev") || baseUrl.includes("worker.dev")))) {
    headers["X-Proxy-Key"] = effectiveProxyKey || effectiveApiKey;
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

// 4. Auto-fill a single word
app.post("/api/autofill-word", async (req, res) => {
  try {
    const { word, targetLanguage, nativeLanguage, llmConfig } = req.body;

    if (!word) {
      return res.status(400).json({ error: "Word is required" });
    }

    const userNative = nativeLanguage || "English";
    const userTarget = targetLanguage || "Spanish";

    const prompt = `Provide detailed vocabulary learning material for the word or expression "${word}".
Target language being learned: "${userTarget}".
User's native language: "${userNative}".

CRITICAL MANDATORY REQUIREMENT:
- "definition": You MUST write the definition/explanation STRICTLY in the TARGET language (${userTarget}) for target language immersion. Do NOT write the definition in the native language (${userNative}).
- "translation": Provide the direct, accurate translation of "${word}" into the user's native language (${userNative}).
- "pronunciation": International Phonetic Alphabet (IPA) pronunciation guide.
- "partOfSpeech": noun, verb, adjective, adverb, idiom, or expression.
- "example": A realistic, high-quality example sentence in the target language (${userTarget}).
- "exampleTranslation": Full translation of the example sentence into the user's native language (${userNative}).
- "category": High-level category or topic classification (e.g. "Travel & Hospitality", "Business & Work", "Technology", "Daily Life", "Emotions & Mind", "Education", "Food & Dining", etc.).
- "context": A concise 1-sentence description of the specific real-world scenario, domain, or usage context where this term is typically used.`;

    const systemInstruction = `You are a professional multilingual dictionary database engine. Always output definitions in the target language (${userTarget}) and translations in the user's native language (${userNative}).`;
    const schemaDesc = `{
  "word": "string",
  "pronunciation": "string",
  "partOfSpeech": "string",
  "definition": "string (definition written STRICTLY in ${userTarget})",
  "translation": "string (translation in ${userNative})",
  "example": "string (example in ${userTarget})",
  "exampleTranslation": "string (example translation in ${userNative})",
  "category": "string (topic/category string)",
  "context": "string (specific real-world usage context description)"
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

// 4.1. Check multiple definitions or exact definition with context hint of a word
app.post("/api/check-word-definitions", async (req, res) => {
  try {
    const { word, hint, targetLanguage, nativeLanguage, llmConfig } = req.body;

    if (!word) {
      return res.status(400).json({ error: "Word is required" });
    }

    const userNative = nativeLanguage || "English";
    const userTarget = targetLanguage || "Spanish";

    const prompt = `Analyze the word or expression "${word}".
${hint ? `Scope / Context Hint: "${hint}"\nCRITICAL MANDATORY REQUIREMENT: The user wants to add "${word}" specifically in the scope/context described above.` : ""}
Target language: "${userTarget}".
User's native language: "${userNative}".

CRITICAL INSTRUCTIONS:
1. ${hint ? `Use the provided Scope/Context Hint ("${hint}") to generate the exact definition, translation, pronunciation, and example sentence for "${word}" matching that specific scope/context.` : "Analyze the word or expression and provide its definition and translation."}
2. If no valid definition, translation, or meaning can be found or generated for "${word}" (or if "${word}" is invalid, unrecognized, or cannot be matched with a definition in the given context), set "notFound": true, "hasMultipleSenses": false, and "senses": [].
3. ${hint ? `Since a specific Scope/Context Hint was provided ("${hint}"), set "hasMultipleSenses": false and return ONLY 1 exact matching sense in "senses".` : `If there is only 1 dominant or common definition, set "hasMultipleSenses": false. If there are 2 to 4 distinct meanings or parts of speech in "${userTarget}", set "hasMultipleSenses": true.`}
4. Provide the matching sense(s) in "senses". For each sense, provide:
   - "partOfSpeech": noun, verb, adjective, adverb, idiom, or expression
   - "definition": clear definition written STRICTLY in the target language ("${userTarget}")
   - "translation": direct translation in the user's native language ("${userNative}")
   - "pronunciation": IPA pronunciation
   - "example": example sentence in "${userTarget}"
   - "exampleTranslation": translation of example sentence in "${userNative}"
   - "imagePrompt": short English visual description
   - "category": high-level category string (e.g. "Travel", "Business", "Daily Life")
   - "context": concise description of the domain or real-world usage context`;

    const systemInstruction = `You are an elite dictionary lookup engine. You analyze target language words and output JSON with exact definitions and translations. If no valid definition exists or cannot be found, set "notFound": true and "senses": [].`;
    const schemaDesc = `{
  "word": "string",
  "notFound": boolean,
  "hasMultipleSenses": boolean,
  "senses": [
    {
      "partOfSpeech": "string (e.g. noun, verb, adjective, expression)",
      "definition": "string (definition written STRICTLY in ${userTarget})",
      "translation": "string (translation in ${userNative})",
      "pronunciation": "string (IPA pronunciation)",
      "example": "string (sentence in ${userTarget})",
      "exampleTranslation": "string (sentence translation in ${userNative})",
      "imagePrompt": "string (short English visual description)",
      "category": "string",
      "context": "string"
    }
  ]
}`;

    const text = await callLLM(prompt, systemInstruction, schemaDesc, llmConfig);
    const result = JSON.parse(text);
    res.json(result);
  } catch (error: any) {
    console.error("Error checking word definitions:", error);
    const parsed = parseServerError(error, req.body?.llmConfig?.provider || "gemini");
    const code = parsed.statusCode >= 400 && parsed.statusCode < 600 ? parsed.statusCode : 500;
    res.status(code).json({ error: parsed.userMessage, statusCode: parsed.statusCode, errorType: parsed.errorType });
  }
});

// 4.5. Generate random words for collection (deduplicated against existing)
app.post("/api/generate-random-words", async (req, res) => {
  try {
    const { topic, targetLanguage, nativeLanguage, count = 5, existingWords = [], llmConfig } = req.body;

    const userNative = nativeLanguage || "English";
    const userTarget = targetLanguage || "Spanish";

    const avoidText = Array.isArray(existingWords) && existingWords.length > 0
      ? `\n\nCRITICAL DEDUPLICATION RULE: Do NOT generate any of the following words that ALREADY exist in the collection:\n[ ${existingWords.slice(0, 100).join(", ")} ]`
      : "";

    const prompt = `Generate ${count} new, unique, practical vocabulary words or expressions in target language "${userTarget}" relevant to or expanding on the topic "${topic || "Vocabulary"}".
The user's native language is "${userNative}".${avoidText}

CRITICAL INSTRUCTIONS:
- Every word generated MUST BE UNIQUE and NOT present in the existing list above.
- "definition": Write clear, concise definitions/explanations STRICTLY in the TARGET language (${userTarget}) for target language immersion.
- "translation": Direct translation into the user's native language (${userNative}).
- "example": Realistic example sentence in target language (${userTarget}).
- "exampleTranslation": Translation of example sentence into user's native language (${userNative}).
- "category": High-level category string (e.g. "${topic || "Vocabulary"}").
- "context": Short description of the real-world situation or domain context where this word is used.`;

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
      "category": "string",
      "context": "string"
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

// 4.8. Fix Grammar & Polish Sentence
app.post("/api/fix-grammar", async (req, res) => {
  try {
    const { userText, targetLanguage, nativeLanguage, llmConfig } = req.body;

    if (!userText) {
      return res.status(400).json({ error: "Text is required" });
    }

    const userTarget = targetLanguage || "English";
    const userNative = nativeLanguage || "Vietnamese";

    const prompt = `Analyze and fix grammar, spelling, clarity, and vocabulary in the following user text:
"${userText}"

Target language being learned: "${userTarget}".
User's native language: "${userNative}".

CRITICAL INSTRUCTIONS:
1. "fixedSentence": Rewrite the user's sentence to fix all grammar, spelling, punctuation, clarity, and readability issues. Improve phrasing and suggest better, natural word choices when helpful. Keep the tone natural and casual.
2. "explanation": Provide a friendly, casual, encouraging breakdown of:
   - What corrections were made (grammar, spelling, punctuation)
   - Why those changes make the sentence sound more natural and fluent
   - Alternative casual ways to express the same idea
3. "vocabularyCandidates": Identify 1 to 4 valuable candidate vocabulary words, expressions, or idioms from EITHER the user's input or the fixed sentence that are worth learning in "${userTarget}".
   For each candidate, provide:
   - "word": string (the target language word or expression)
   - "reason": string (a short, clear 1-line reason why this word/expression is a great candidate to add to their vocabulary collection)
`;

    const systemInstruction = `You are a friendly, natural AI Language Coach. Fix grammar & spelling with a casual tone and suggest candidate vocabulary words for the user's collection. Output strictly raw valid JSON matching the schema.`;
    const schemaDesc = `{
  "fixedSentence": "string",
  "explanation": "string (markdown formatted casual explanation)",
  "vocabularyCandidates": [
    {
      "word": "string (target word in ${userTarget})",
      "reason": "string (short reason)"
    }
  ]
}`;

    const text = await callLLM(prompt, systemInstruction, schemaDesc, llmConfig);
    const result = JSON.parse(text);
    res.json(result);
  } catch (error: any) {
    console.error("Error fixing grammar:", error);
    const parsed = parseServerError(error, req.body?.llmConfig?.provider || "gemini");
    const code = parsed.statusCode >= 400 && parsed.statusCode < 600 ? parsed.statusCode : 500;
    res.status(code).json({ error: parsed.userMessage, statusCode: parsed.statusCode, errorType: parsed.errorType });
  }
});

function pcmToWav(pcmBuffer: Buffer, sampleRate = 24000, numChannels = 1, bitsPerSample = 16): Buffer {
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = pcmBuffer.length;
  const chunkSize = 36 + dataSize;

  const wavBuffer = Buffer.alloc(44 + dataSize);

  // RIFF header
  wavBuffer.write('RIFF', 0);
  wavBuffer.writeUInt32LE(chunkSize, 4);
  wavBuffer.write('WAVE', 8);

  // fmt chunk
  wavBuffer.write('fmt ', 12);
  wavBuffer.writeUInt32LE(16, 16);
  wavBuffer.writeUInt16LE(1, 20); // PCM format
  wavBuffer.writeUInt16LE(numChannels, 22);
  wavBuffer.writeUInt32LE(sampleRate, 24);
  wavBuffer.writeUInt32LE(byteRate, 28);
  wavBuffer.writeUInt16LE(blockAlign, 32);
  wavBuffer.writeUInt16LE(bitsPerSample, 34);

  // data chunk
  wavBuffer.write('data', 36);
  wavBuffer.writeUInt32LE(dataSize, 40);

  pcmBuffer.copy(wavBuffer, 44);

  return wavBuffer;
}

function normalizeServerTextForTTS(text: string): string {
  if (!text) return "";
  let cleaned = text;
  cleaned = cleaned.replace(/[\u200B-\u200D\uFEFF\u00A0\u0000-\u001F]/g, " ");
  cleaned = cleaned.replace(/<[^>]*>/g, " ");
  cleaned = cleaned.replace(/[\u{1F300}-\u{1F9FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1F1E0}-\u{1F1FF}]/gu, "");
  cleaned = cleaned.replace(/[★☆●•►▪✦✧✔✕✖✓✗➔→←⇒▲▼♦♠♣♥]/g, " ");
  cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  cleaned = cleaned.replace(/!\[([^\]]*)\]\([^)]+\)/g, "");
  cleaned = cleaned.replace(/\*\*([^*]+)\*\*/g, "$1");
  cleaned = cleaned.replace(/\*([^*]+)\*/g, "$1");
  cleaned = cleaned.replace(/~~([^~]+)~~/g, "$1");
  cleaned = cleaned.replace(/`([^`]+)`/g, "$1");
  cleaned = cleaned.replace(/^[#>\-\*\+\s]+/gm, " ");
  cleaned = cleaned.replace(/\[\s*_{1,}\s*\]/g, " blank ");
  cleaned = cleaned.replace(/\(\s*_{1,}\s*\)/g, " blank ");
  cleaned = cleaned.replace(/_{2,}/g, " blank ");
  cleaned = cleaned.replace(/-{3,}/g, " blank ");
  cleaned = cleaned.replace(/\.{4,}/g, " blank ");
  cleaned = cleaned.replace(/^(Fill in the blank for the sentence|Complete the sentence|Fill in the blank):\s*/i, "Complete sentence: ");
  cleaned = cleaned.replace(/^(Which word matches the following definition|Which word matches the definition):\s*/i, "Definition: ");
  cleaned = cleaned.replace(/^(Question|Q):\s*/i, "");
  cleaned = cleaned.replace(/["“”«»„‟]/g, "");
  cleaned = cleaned.replace(/['‘’]/g, "'");
  cleaned = cleaned.replace(/[~^|\\@#$%*+=<>]/g, " ");
  cleaned = cleaned.replace(/[\r\n]+/g, ". ");
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  return cleaned || text.trim();
}

// 5. Text-to-Speech API
app.post("/api/tts", async (req, res) => {
  try {
    const { text: rawText, engine, model, voice, apiKey, customEndpoint, llmConfig } = req.body;

    if (!rawText) {
      return res.status(400).json({ error: "Text is required for TTS generation" });
    }

    const text = normalizeServerTextForTTS(rawText);

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

      let targetTtsModel = (model && VALID_GEMINI_MODELS.includes(model)) ? model : "gemini-3.1-flash-tts-preview";
      if (targetTtsModel.startsWith("gemini-") && !targetTtsModel.endsWith("-tts-preview")) {
        targetTtsModel = "gemini-3.1-flash-tts-preview";
      }
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
        const base64Data = part.inlineData.data || "";

        // If Gemini returned raw PCM / L16 audio, wrap with standard WAV header so browsers decode and play natively
        if (mimeType.includes("l16") || mimeType.includes("pcm") || mimeType.includes("raw") || (!mimeType.includes("mp3") && !mimeType.includes("wav"))) {
          try {
            const rawPcm = Buffer.from(base64Data, "base64");
            const rateMatch = mimeType.match(/rate=(\d+)/);
            const sampleRate = rateMatch ? parseInt(rateMatch[1], 10) : 24000;
            const wavBuffer = pcmToWav(rawPcm, sampleRate, 1, 16);
            const wavBase64 = wavBuffer.toString("base64");
            return res.json({ audioDataUrl: `data:audio/wav;base64,${wavBase64}` });
          } catch (convErr) {
            console.warn("PCM to WAV conversion error, falling back to raw data:", convErr);
          }
        }

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
    const engine = req.body?.engine || "gemini";
    const parsed = parseServerError(error, engine);
    console.warn(`[TTS API Fallback - ${engine}]`, parsed.userMessage);
    res.status(parsed.statusCode || 400).json({ 
      error: parsed.userMessage, 
      statusCode: parsed.statusCode, 
      errorType: parsed.errorType,
      fallback: true 
    });
  }
});

// 6. Analyze Performance with AI endpoint
app.post("/api/analyze-performance", async (req, res) => {
  try {
    const { stats, totalWords, masteredWords = [], improvingWords = [], llmConfig } = req.body;

    const masteredSampleStr = (masteredWords || []).slice(0, 15).map((w: any) => `${w.word} (${w.translation || w.definition})`).join(", ") || "None yet";
    const improvingSampleStr = (improvingWords || []).slice(0, 15).map((w: any) => `${w.word} (level ${w.strength ?? 0}, ${w.translation || w.definition})`).join(", ") || "None yet";

    const prompt = `You are an elite AI Language Learning Coach & Vocabulary Analyst. Analyze the following student performance data and provide a personalized, deeply insightful analytics report.

STUDENT PERFORMANCE DATA:
- Total Vocabulary Words in Collection: ${totalWords || 0}
- Total Words Mastered: ${stats?.totalWordsMastered || 0}
- Total Words Studied/Reviewed: ${stats?.totalWordsStudied || 0}
- Quizzes Completed: ${stats?.totalQuizzesTaken || 0}
- Correct Answers in Quizzes: ${stats?.totalCorrectAnswers || 0}
- Active Study Streak: ${stats?.streak?.count || 0} days

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

// 7. Interactive Chat Assistant endpoint
app.post("/api/chat", async (req, res) => {
  try {
    const { messages, targetLanguage = "English", nativeLanguage = "Spanish", llmConfig } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "Messages array is required and cannot be empty" });
    }

    const chatHistoryStr = messages
      .slice(-10) // Limit to last 10 messages to avoid token bloat
      .map((m: any) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n");

    const prompt = `Below is the recent conversation history between the User and you (the Assistant):\n\n${chatHistoryStr}\n\nAssistant, formulate your next helpful response. Ensure to check if the user is interested in practicing or adding words, and attach appropriate suggestedActions.`;

    const systemInstruction = `You are an elite, highly encouraging AI Language Coach and Vocabulary Assistant.
Your mission is to help the user master their target language "${targetLanguage}" from their native language "${nativeLanguage}".
You speak in a warm, welcoming, and linguistically precise tone.

CRITICAL INSTRUCTIONS:
- Answer questions about grammar, translation, and pronunciation.
- If you explain, introduce, or define a vocabulary word that the user might want to study, always suggest adding it to their collection using the "add_word" action.
- If the user indicates they want to take a test, quiz, practice, or study their flashcards, suggest starting a quiz using the "start_quiz" action.
- If you ask or offer the user to move on to the next question or topic (e.g., "Shall we move on to Question 4?"), you MUST include a "send_message" action in suggestedActions with label "Move on to Question X" or "Continue to Next Question".
- You MUST respond with a valid JSON object matching the schema below.`;

    const schemaDesc = `{
  "text": "string (the main conversation response in markdown format. Keep it beautifully styled, use bolding, bullet points, etc. where helpful)",
  "suggestedActions": [
    {
      "label": "string (compelling action text, e.g. 'Add \"serendipity\" to collection', 'Move on to Question 4', or 'Start Vocab Quiz')",
      "action": "string (one of: 'add_word', 'start_quiz', 'send_message')",
      "payload": {
        "word": "string (required only if action is 'add_word')",
        "message": "string (required only if action is 'send_message')"
      }
    }
  ]
}`;

    const text = await callLLM(prompt, systemInstruction, schemaDesc, llmConfig);
    const result = JSON.parse(text);
    res.json(result);
  } catch (error: any) {
    console.error("Error in AI chat:", error);
    const parsed = parseServerError(error, req.body?.llmConfig?.provider || "gemini");
    const code = parsed.statusCode >= 400 && parsed.statusCode < 600 ? parsed.statusCode : 500;
    res.status(code).json({ error: parsed.userMessage, statusCode: parsed.statusCode, errorType: parsed.errorType });
  }
});

// 8. Quiz Question Generation endpoint
app.post("/api/generate-quiz", async (req, res) => {
  try {
    const { words, stats, targetLanguage = "English", nativeLanguage = "Vietnamese", llmConfig } = req.body;

    if (!words || !Array.isArray(words) || words.length === 0) {
      return res.status(400).json({ error: "Words array is required and cannot be empty" });
    }

    const getDaysSinceReview = (dateStr?: string | null) => {
      if (!dateStr) return 0;
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return 0;
      return Math.max(0, Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24)));
    };

    const wordDataSummary = words.map((w: any) => {
      const daysSinceReview = getDaysSinceReview(w.lastReviewed || w.createdAt);
      return {
        id: w.id,
        word: w.word,
        partOfSpeech: w.partOfSpeech,
        definition: w.definition,
        translation: w.translation,
        example: w.example || "",
        category: w.category || "General",
        context: w.context || w.definition,
        strength: w.strength ?? 0,
        learned: Boolean(w.learned),
        starred: Boolean(w.starred),
        daysSinceLastReview: daysSinceReview,
        lastReviewed: w.lastReviewed ? `${daysSinceReview} day(s) ago` : "Never reviewed",
        memoryStatus: daysSinceReview >= 5 ? "Needs Refresher (Memory Decay / Overdue)" : (w.strength ?? 0) >= 3 ? "Mastered / Strong" : "Learning / Developing"
      };
    });

    const accuracyPercent = stats && stats.totalQuizzesTaken > 0
      ? `${Math.round((stats.totalCorrectAnswers / Math.max(1, stats.totalQuizzesTaken * 5)) * 100)}%`
      : stats && stats.totalCorrectAnswers > 0
      ? `${stats.totalCorrectAnswers} total correct answers`
      : "New learner";

    const usefulStatsSummary = stats ? {
      activeStreakDays: stats.streak?.count || 0,
      totalWordsMastered: stats.totalWordsMastered || 0,
      totalWordsStudied: stats.totalWordsStudied || 0,
      totalQuizzesTaken: stats.totalQuizzesTaken || 0,
      accuracyTrend: accuracyPercent
    } : null;

    const systemInstruction = `You are a world-class AI Language Pedagogy Engine specializing in ${targetLanguage} assessment.
Your goal is to generate a JSON array of high-quality, targeted quiz questions for the given vocabulary words based on the student's mastery stats.

STRICT GENERATION RULES & RESTRICTIONS:
1. Target-Language Immersion Restrictions:
   - ALL question text, prompts, hints, audio descriptions, and options MUST be written 100% strictly in ${targetLanguage}.
   - ABSOLUTELY DO NOT include native language (${nativeLanguage} or any non-${targetLanguage} translations) anywhere in questions, prompts, hints, or options.
2. Distractor Logic:
   - Exactly 4 options per multiple-choice question (1 correct answer + 3 distractors).
   - Options must be unique, non-overlapping, and grammatically/morphologically similar (same part of speech or phonetically/spelling close).
   - Never put the same option twice.
3. Adaptive Difficulty & Spaced Repetition Personalization:
   - Use each word's mastery stats (strength 0-4, daysSinceLastReview, memoryStatus, starred, learned) and overall stats (streak, accuracy, mastered count) to customize question difficulty:
     * Memory Decay / Overdue Words (daysSinceLastReview >= 5, or recalculated strength): The student may have forgotten this word since it hasn't been reviewed in a while. Generate targeted context fill-in-the-blank or usage questions with challenging distractors to test active memory recall.
     * Weak / New Words (strength 0-1, never reviewed): Generate foundational questions (e.g. direct definition matching or simple supportive sentences) with helpful hints to reinforce basic recall.
     * Starred / Priority Words: Focus on practical usage and clear context sentences to solidify active vocabulary.
     * High Strength / Recently Reviewed Words (strength 3-4): Challenge the learner with nuanced context or subtle distractor choices to ensure long-term mastery.
4. Question Types (mix across questions):
   - 'definition': "Which word matches the following definition?\n'[definition in ${targetLanguage}]'"
   - 'sentence': "Fill in the blank for the sentence:\n'[sentence in ${targetLanguage} tailored strictly to the word's category/context with target word replaced by ______]'"
   - 'listening': "Listen to the audio clip and select the correct matching word:" (options contain phonetically/morphologically similar words)
   - 'picture': "Which word matches the visual concept shown below?" (set imageUrl to https://image.pollinations.ai/prompt/[encoded prompt describing target word in its specific category and real-world usage context]?width=500&height=400&nologo=true)
5. Context & Category Alignment:
   - Each word provided contains its stored 'category' and 'context'. You MUST tailor sentence blanks, definitions, and picture descriptions specifically around the word's given category and context scenario.

5. Output Schema:
Return ONLY a valid JSON array of objects matching this schema:
[
  {
    "id": "string",
    "wordId": "string",
    "word": "string",
    "type": "definition" | "sentence" | "listening" | "picture",
    "question": "string",
    "options": ["string", "string", "string", "string"],
    "correctAnswer": "string",
    "hint": "string",
    "imageUrl": "string (optional)"
  }
]`;

    const prompt = `Generate 1 quiz question for each of these vocabulary words, adapting question depth and distractors according to the provided word stats and learner progress stats:\n\n` +
      (usefulStatsSummary ? `Learner Progress Stats:\n${JSON.stringify(usefulStatsSummary, null, 2)}\n\n` : "") +
      `Vocabulary Words with Word Mastery Stats:\n${JSON.stringify(wordDataSummary, null, 2)}`;
    const schemaDesc = `Array of QuizQuestion objects with id, wordId, word, type, question, options, correctAnswer, hint, imageUrl.`;

    const text = await callLLM(prompt, systemInstruction, schemaDesc, llmConfig);
    const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/```$/i, "").trim();
    const result = JSON.parse(cleaned);
    res.json(result);
  } catch (error: any) {
    console.error("Error generating AI quiz:", error);
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

