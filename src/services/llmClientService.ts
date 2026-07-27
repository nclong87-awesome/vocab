import { GoogleGenAI } from "@google/genai";
import { LLMConfig } from "../types";

// Clean raw JSON strings
export function cleanJsonResponse(rawText: string): string {
  let cleaned = rawText.trim();
  if (cleaned.startsWith("```json")) {
    cleaned = cleaned.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```\s*/, "").replace(/```$/i, "").trim();
  }
  return cleaned;
}

const VALID_GEMINI_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash",
  "gemini-1.5-flash",
  "gemini-3.6-flash",
  "gemini-3.6-flash-lite",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-2.5-flash-preview-tts",
  "gemini-3.1-flash-tts-preview"
];

// Sanitize model names for provider
export function sanitizeModel(provider: string, model?: string): string {
  if (provider === "gemini") {
    if (!model || !VALID_GEMINI_MODELS.includes(model)) {
      return "gemini-3.6-flash";
    }
  }
  return model || (provider === "gemini" ? "gemini-3.6-flash" : "gpt-5.4-mini");
}

export type LLMErrorType =
  | 'INVALID_KEY'
  | 'PERMISSION_DENIED'
  | 'RATE_LIMIT'
  | 'NOT_FOUND'
  | 'SERVER_ERROR'
  | 'NETWORK_ERROR'
  | 'INVALID_RESPONSE'
  | 'UNKNOWN';

export interface ParsedLlmError {
  statusCode: number;
  errorType: LLMErrorType;
  userMessage: string;
  originalMessage: string;
  isRetryable: boolean;
  provider: string;
}

export class LLMConnectionError extends Error {
  statusCode: number;
  errorType: LLMErrorType;
  userMessage: string;
  isRetryable: boolean;
  provider: string;

  constructor(parsed: ParsedLlmError) {
    super(parsed.userMessage);
    this.name = "LLMConnectionError";
    this.statusCode = parsed.statusCode;
    this.errorType = parsed.errorType;
    this.userMessage = parsed.userMessage;
    this.isRetryable = parsed.isRetryable;
    this.provider = parsed.provider;
  }
}

/**
  Parse raw errors from Gemini API or other LLM providers into structured errors
  with status codes, retry flags, and user-friendly messages.
 */
export function parseLlmError(err: any, provider: string = "gemini"): ParsedLlmError {
  const originalMessage =
    err?.userMessage ||
    err?.message ||
    (typeof err === "string" ? err : JSON.stringify(err || {}));

  const provUpper = provider.toUpperCase();

  // Extract HTTP status code if present
  let statusCode =
    err?.statusCode ||
    err?.status ||
    err?.response?.status ||
    err?.code ||
    0;

  if (typeof statusCode !== "number" || isNaN(statusCode)) {
    statusCode = 0;
  }

  // Attempt to parse nested JSON error objects from GoogleGenAI SDK error strings
  let lowerMsg = originalMessage.toLowerCase();
  let jsonCode: number | null = null;
  let jsonStatusStr: string = "";

  try {
    const jsonMatch = originalMessage.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsedJson = JSON.parse(jsonMatch[0]);
      const errObj = parsedJson.error || parsedJson;
      if (errObj.code && typeof errObj.code === "number") {
        jsonCode = errObj.code;
      }
      if (errObj.status && typeof errObj.status === "string") {
        jsonStatusStr = errObj.status;
      }
      if (errObj.message && typeof errObj.message === "string") {
        lowerMsg = (lowerMsg + " " + errObj.message.toLowerCase()).trim();
      }
    }
  } catch {
    // Ignore JSON parse errors for non-JSON strings
  }

  if (!statusCode && jsonCode) {
    statusCode = jsonCode;
  }

  // 1. Invalid API Key / Unauthorized (401)
  if (
    statusCode === 401 ||
    jsonStatusStr === "UNAUTHENTICATED" ||
    lowerMsg.includes("unauthenticated") ||
    lowerMsg.includes("api_key_invalid") ||
    lowerMsg.includes("api key not valid") ||
    lowerMsg.includes("invalid api key") ||
    lowerMsg.includes("invalid authentication credentials") ||
    lowerMsg.includes("unregistered callers")
  ) {
    return {
      statusCode: 401,
      errorType: "INVALID_KEY",
      userMessage: `Invalid ${provUpper} API Key (401): The provided API key is invalid or unrecognized. Please check your API key in LLM Settings.`,
      originalMessage,
      isRetryable: false,
      provider
    };
  }

  // 2. Permission Denied / Access Forbidden (403)
  if (
    statusCode === 403 ||
    jsonStatusStr === "PERMISSION_DENIED" ||
    lowerMsg.includes("permission_denied") ||
    lowerMsg.includes("permission denied") ||
    lowerMsg.includes("access forbidden") ||
    lowerMsg.includes("api_key_service_blocked") ||
    lowerMsg.includes("caller does not have permission") ||
    lowerMsg.includes("method doesn't allow unregistered callers")
  ) {
    return {
      statusCode: 403,
      errorType: "PERMISSION_DENIED",
      userMessage: `Access Forbidden (403): Your ${provUpper} API key lacks access permissions or Gemini is restricted in your region/project.`,
      originalMessage,
      isRetryable: false,
      provider
    };
  }

  // 3. Rate Limit / Quota Exceeded (429)
  if (
    statusCode === 429 ||
    jsonStatusStr === "RESOURCE_EXHAUSTED" ||
    lowerMsg.includes("resource_exhausted") ||
    lowerMsg.includes("quota exceeded") ||
    lowerMsg.includes("too many requests") ||
    lowerMsg.includes("rate limit")
  ) {
    return {
      statusCode: 429,
      errorType: "RATE_LIMIT",
      userMessage: `Rate Limit Exceeded (429): ${provUpper} API quota or rate limit reached. Retrying automatically...`,
      originalMessage,
      isRetryable: true,
      provider
    };
  }

  // 4. Model Not Found (404)
  if (
    statusCode === 404 ||
    jsonStatusStr === "NOT_FOUND" ||
    lowerMsg.includes("not_found") ||
    lowerMsg.includes("model not found") ||
    lowerMsg.includes("publishermodel")
  ) {
    return {
      statusCode: 404,
      errorType: "NOT_FOUND",
      userMessage: `Model Not Found (404): The requested ${provUpper} model is unavailable or endpoint path is invalid. Retrying with fallback model...`,
      originalMessage,
      isRetryable: false,
      provider
    };
  }

  // 5. Server Error / Overloaded (500, 502, 503, 504)
  if (
    statusCode >= 500 ||
    jsonStatusStr === "INTERNAL" ||
    jsonStatusStr === "UNAVAILABLE" ||
    lowerMsg.includes("internal server error") ||
    lowerMsg.includes("service unavailable") ||
    lowerMsg.includes("overloaded") ||
    lowerMsg.includes("bad gateway")
  ) {
    const code = statusCode || 503;
    return {
      statusCode: code,
      errorType: "SERVER_ERROR",
      userMessage: `${provUpper} Server Error (${code}): Google/Provider AI servers are temporarily busy or undergoing maintenance. Retrying...`,
      originalMessage,
      isRetryable: true,
      provider
    };
  }

  // 6. Network / CORS / Fetch Error
  if (
    err?.name === "TypeError" ||
    lowerMsg.includes("failed to fetch") ||
    lowerMsg.includes("networkerror") ||
    lowerMsg.includes("cors") ||
    lowerMsg.includes("econnreset") ||
    lowerMsg.includes("etimedout")
  ) {
    return {
      statusCode: 0,
      errorType: "NETWORK_ERROR",
      userMessage: `Network Connection Error: Unable to reach ${provUpper} API servers from the browser. Please verify your internet connection.`,
      originalMessage,
      isRetryable: true,
      provider
    };
  }

  // 7. Invalid or Empty Response
  if (lowerMsg.includes("empty response") || lowerMsg.includes("json")) {
    return {
      statusCode: 422,
      errorType: "INVALID_RESPONSE",
      userMessage: `Invalid Response Error: Received empty or unparseable payload from ${provUpper}.`,
      originalMessage,
      isRetryable: true,
      provider
    };
  }

  // Default fallback error
  return {
    statusCode: statusCode || 400,
    errorType: "UNKNOWN",
    userMessage: `${provUpper} Connection Error: ${originalMessage || "Failed to communicate with LLM model."}`,
    originalMessage,
    isRetryable: statusCode >= 500 || statusCode === 429,
    provider
  };
}

/**
  Execute an async operation with exponential backoff retry logic for transient errors.
 */
export async function callWithRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: {
    maxRetries?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    backoffFactor?: number;
    provider?: string;
    onRetry?: (attempt: number, delayMs: number, error: ParsedLlmError) => void;
  } = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? 3;
  const initialDelayMs = options.initialDelayMs ?? 1000;
  const maxDelayMs = options.maxDelayMs ?? 4000;
  const backoffFactor = options.backoffFactor ?? 2;
  const provider = options.provider || "gemini";

  let lastParsedError: ParsedLlmError | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn(attempt);
    } catch (err: any) {
      const parsed = parseLlmError(err, provider);
      lastParsedError = parsed;

      // Do NOT retry non-retryable errors (e.g. 401 Invalid Key, 403 Forbidden)
      if (!parsed.isRetryable || attempt >= maxRetries) {
        throw new LLMConnectionError(parsed);
      }

      const delayMs = Math.min(
        maxDelayMs,
        initialDelayMs * Math.pow(backoffFactor, attempt - 1) + Math.floor(Math.random() * 200)
      );

      console.warn(
        `[${provider.toUpperCase()} Retry ${attempt}/${maxRetries}] ${parsed.userMessage} (Waiting ${delayMs}ms)`
      );

      if (options.onRetry) {
        options.onRetry(attempt, delayMs, parsed);
      }

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw new LLMConnectionError(
    lastParsedError || {
      statusCode: 500,
      errorType: "UNKNOWN",
      userMessage: `Failed after ${maxRetries} retry attempts`,
      originalMessage: "Max retries reached",
      isRetryable: false,
      provider
    }
  );
}

// Client-side direct LLM API invocation with retry logic and model fallback
export async function callLLMClientSide(
  prompt: string, 
  systemInstruction: string, 
  schemaDescription: string,
  llmConfig?: LLMConfig
): Promise<string> {
  const provider = llmConfig?.provider || "gemini";
  const model = sanitizeModel(provider, llmConfig?.model);
  const apiKey = llmConfig?.apiKey || "";
  const baseUrl = llmConfig?.baseUrl || "";

  const requiresKey = provider !== "ollama" && provider !== "custom" && provider !== "gemini";
  if (requiresKey && !apiKey) {
    throw new LLMConnectionError({
      statusCode: 401,
      errorType: "INVALID_KEY",
      userMessage: `API Key is required for ${provider.toUpperCase()}. Please enter a valid API key in LLM settings.`,
      originalMessage: "Missing API key",
      isRetryable: false,
      provider
    });
  }

  const effectiveApiKey = apiKey || "";

  // Gemini API client-side handling
  if (provider === "gemini") {
    if (!effectiveApiKey) {
      throw new LLMConnectionError({
        statusCode: 401,
        errorType: "INVALID_KEY",
        userMessage: "Gemini API Key is missing. Please enter your API key in LLM settings to use Gemini in the browser.",
        originalMessage: "Missing Gemini API key",
        isRetryable: false,
        provider: "gemini"
      });
    }

    const primaryModel = model || "gemini-3.6-flash";
    const fallbackModels = ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-2.5-flash"].filter(m => m !== primaryModel);

    return callWithRetry(
      async (attempt) => {
        const ai = new GoogleGenAI({ apiKey: effectiveApiKey });
        let activeModel = primaryModel;

        if (attempt > 1 && fallbackModels.length > 0) {
          activeModel = fallbackModels[(attempt - 2) % fallbackModels.length];
          console.warn(`[Gemini Fallback] Retrying with model ${activeModel}`);
        }

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
            throw new Error("Empty response received from Gemini API.");
          }
          return cleanJsonResponse(response.text);
        } catch (err: any) {
          const parsed = parseLlmError(err, "gemini");
          // If primary model returns 404 or NOT_FOUND, fallback immediately to default model
          if ((parsed.statusCode === 404 || parsed.errorType === "NOT_FOUND") && activeModel === primaryModel && fallbackModels.length > 0) {
            console.warn(`[Gemini Model Fallback] Model ${primaryModel} not found (404), trying ${fallbackModels[0]}`);
            const fallbackRes = await ai.models.generateContent({
              model: fallbackModels[0],
              contents: prompt,
              config: {
                systemInstruction,
                responseMimeType: "application/json"
              }
            });
            if (fallbackRes.text) {
              return cleanJsonResponse(fallbackRes.text);
            }
          }
          throw err;
        }
      },
      { maxRetries: 3, provider: "gemini" }
    );
  }

  if (provider === "anthropic") {
    const endpoint = (baseUrl || "https://api.anthropic.com") + "/v1/messages";
    return callWithRetry(
      async () => {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "x-api-key": effectiveApiKey,
            "anthropic-version": "2023-06-01",
            "anthropic-dangerous-direct-browser-access": "true",
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
          const errText = await res.text().catch(() => res.statusText);
          throw new Error(`Anthropic Error (${res.status}): ${errText}`);
        }

        const data: any = await res.json();
        const contentText = data.content?.[0]?.text || "";
        return cleanJsonResponse(contentText);
      },
      { maxRetries: 3, provider: "anthropic" }
    );
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
    headers["X-Title"] = "Vocabulary Learner";
  }

  const reqBody: any = {
    model: model || (provider === "ollama" ? "llama3.2" : "gpt-5.4-mini"),
    messages: [
      { role: "system", content: systemInstruction + "\nOutput MUST be strictly valid raw JSON matching:\n" + schemaDescription },
      { role: "user", content: prompt }
    ]
  };

  if (provider === "openai" || provider === "groq" || provider === "openrouter") {
    reqBody.response_format = { type: "json_object" };
  }

  return callWithRetry(
    async () => {
      const res = await fetch(targetUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(reqBody)
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => res.statusText);
        throw new Error(`${provider.toUpperCase()} API Error (${res.status}): ${errText}`);
      }

      const data: any = await res.json();
      const text = data.choices?.[0]?.message?.content || "";
      return cleanJsonResponse(text);
    },
    { maxRetries: 3, provider }
  );
}

// Helper to check if running in a pure static client host (e.g. GitHub Pages)
function isStaticHost(): boolean {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  return (
    host.endsWith("github.io") ||
    host.endsWith("netlify.app") ||
    host.endsWith("vercel.app") ||
    window.location.protocol === "file:"
  );
}

export interface ConnectionTestResult {
  success: boolean;
  response?: string;
  error?: string;
  statusCode?: number;
  errorType?: LLMErrorType;
  isRetryable?: boolean;
  provider?: string;
  modelUsed?: string;
}

// 1. Test LLM Connection with status codes and detailed feedback
export async function testLlmConnection(llmConfig: LLMConfig): Promise<ConnectionTestResult> {
  const provider = llmConfig?.provider || "gemini";
  const modelUsed = sanitizeModel(provider, llmConfig?.model);

  // Static host (GitHub Pages, Vercel) direct client test
  if (isStaticHost()) {
    try {
      const text = await callLLMClientSide(
        "Respond with a short json object: {\"status\": \"connected\", \"message\": \"LLM provider connection successful!\"}",
        "You are a helpful dictionary test assistant.",
        "{\n  \"status\": \"string\",\n  \"message\": \"string\"\n}",
        llmConfig
      );
      return { success: true, response: text, provider, modelUsed };
    } catch (clientErr: any) {
      const parsed = parseLlmError(clientErr, provider);
      return {
        success: false,
        error: parsed.userMessage,
        statusCode: parsed.statusCode,
        errorType: parsed.errorType,
        isRetryable: parsed.isRetryable,
        provider,
        modelUsed
      };
    }
  }

  try {
    const response = await fetch("/api/test-llm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ llmConfig })
    });

    if (response.ok) {
      const data = await response.json();
      return {
        success: true,
        response: data.response,
        provider,
        modelUsed
      };
    }

    if (response.status === 405 || response.status === 404) {
      const text = await callLLMClientSide(
        "Respond with a short json object: {\"status\": \"connected\", \"message\": \"LLM provider connection successful!\"}",
        "You are a helpful dictionary test assistant.",
        "{\n  \"status\": \"string\",\n  \"message\": \"string\"\n}",
        llmConfig
      );
      return { success: true, response: text, provider, modelUsed };
    }

    const errData = await response.json().catch(() => null);
    if (errData && errData.error) {
      return {
        success: false,
        error: errData.error,
        statusCode: errData.statusCode || response.status,
        errorType: errData.errorType || "SERVER_ERROR",
        isRetryable: errData.isRetryable ?? false,
        provider,
        modelUsed
      };
    }
  } catch (err: any) {
    console.warn("Backend /api/test-llm network failure, falling back to client-side test:", err);
  }

  // Fallback to client-side testing
  try {
    const text = await callLLMClientSide(
      "Respond with a short json object: {\"status\": \"connected\", \"message\": \"LLM provider connection successful!\"}",
      "You are a helpful dictionary test assistant.",
      "{\n  \"status\": \"string\",\n  \"message\": \"string\"\n}",
      llmConfig
    );
    return { success: true, response: text, provider, modelUsed };
  } catch (clientErr: any) {
    const parsed = parseLlmError(clientErr, provider);
    return {
      success: false,
      error: parsed.userMessage,
      statusCode: parsed.statusCode,
      errorType: parsed.errorType,
      isRetryable: parsed.isRetryable,
      provider,
      modelUsed
    };
  }
}

// 2. Generate Deck
export async function generateDeckService(params: {
  topic: string;
  targetLanguage?: string;
  nativeLanguage?: string;
  quantity?: number;
  llmConfig?: LLMConfig;
}): Promise<any> {
  const { topic, targetLanguage, nativeLanguage, quantity = 8, llmConfig } = params;
  const userNative = nativeLanguage || "English";
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

  if (isStaticHost()) {
    const text = await callLLMClientSide(prompt, systemInstruction, schemaDesc, llmConfig);
    return JSON.parse(text);
  }

  try {
    const res = await fetch("/api/generate-deck", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic, targetLanguage: userTarget, nativeLanguage: userNative, quantity, llmConfig })
    });

    if (res.ok) {
      return await res.json();
    }

    if (res.status === 405 || res.status === 404) {
      const text = await callLLMClientSide(prompt, systemInstruction, schemaDesc, llmConfig);
      return JSON.parse(text);
    }

    const errData = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(errData.error || `Server Error ${res.status}`);
  } catch (err: any) {
    if (err.message && !err.message.includes("Failed to fetch") && !err.message.includes("NetworkError")) {
      throw err;
    }
    const text = await callLLMClientSide(prompt, systemInstruction, schemaDesc, llmConfig);
    return JSON.parse(text);
  }
}

// 3. Autofill Word Details
export async function autofillWordService(params: {
  word: string;
  targetLanguage?: string;
  nativeLanguage?: string;
  notebookName?: string;
  notebookDescription?: string;
  llmConfig?: LLMConfig;
}): Promise<any> {
  const { word, targetLanguage, nativeLanguage, notebookName, notebookDescription, llmConfig } = params;
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

  if (isStaticHost()) {
    const text = await callLLMClientSide(prompt, systemInstruction, schemaDesc, llmConfig);
    return JSON.parse(text);
  }

  try {
    const res = await fetch("/api/autofill-word", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ word, targetLanguage: userTarget, nativeLanguage: userNative, notebookName, notebookDescription, llmConfig })
    });

    if (res.ok) {
      return await res.json();
    }

    if (res.status === 405 || res.status === 404) {
      const text = await callLLMClientSide(prompt, systemInstruction, schemaDesc, llmConfig);
      return JSON.parse(text);
    }

    const errData = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(errData.error || `Server Error ${res.status}`);
  } catch (err: any) {
    if (err.message && !err.message.includes("Failed to fetch") && !err.message.includes("NetworkError")) {
      throw err;
    }
    const text = await callLLMClientSide(prompt, systemInstruction, schemaDesc, llmConfig);
    return JSON.parse(text);
  }
}

// 3.5. Generate Random Words for Notebook (Deduplicated)
export async function generateRandomWordsService(params: {
  topic: string;
  targetLanguage?: string;
  nativeLanguage?: string;
  count?: number;
  existingWords?: string[];
  llmConfig?: LLMConfig;
}): Promise<{ words: any[] }> {
  const { topic, targetLanguage, nativeLanguage, count = 5, existingWords = [], llmConfig } = params;
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

  if (isStaticHost()) {
    const text = await callLLMClientSide(prompt, systemInstruction, schemaDesc, llmConfig);
    return JSON.parse(text);
  }

  try {
    const res = await fetch("/api/generate-random-words", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic, targetLanguage: userTarget, nativeLanguage: userNative, count, existingWords, llmConfig })
    });

    if (res.ok) {
      return await res.json();
    }

    if (res.status === 405 || res.status === 404) {
      const text = await callLLMClientSide(prompt, systemInstruction, schemaDesc, llmConfig);
      return JSON.parse(text);
    }

    const errData = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(errData.error || `Server Error ${res.status}`);
  } catch (err: any) {
    if (err.message && !err.message.includes("Failed to fetch") && !err.message.includes("NetworkError")) {
      throw err;
    }
    const text = await callLLMClientSide(prompt, systemInstruction, schemaDesc, llmConfig);
    return JSON.parse(text);
  }
}

// 4. Analyze Performance with AI Service
export interface PerformanceAnalysisRequest {
  stats: any;
  totalWords: number;
  masteredWords?: any[];
  improvingWords?: any[];
  decksSummary?: { name: string; totalWords: number; masteredCount: number }[];
  llmConfig?: LLMConfig;
}

export interface PerformanceAnalysisResult {
  overallAssessment: string;
  strengthsSummary: string;
  weaknessesSummary: string;
  actionableTips: string[];
  recommendedFocusTopics: string[];
  motivationQuote: string;
}

export async function analyzePerformanceService(params: PerformanceAnalysisRequest): Promise<PerformanceAnalysisResult> {
  const { stats, totalWords, masteredWords = [], improvingWords = [], decksSummary = [], llmConfig } = params;

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

  if (isStaticHost()) {
    const text = await callLLMClientSide(prompt, systemInstruction, schemaDesc, llmConfig);
    return JSON.parse(text);
  }

  try {
    const res = await fetch("/api/analyze-performance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stats, totalWords, masteredWords, improvingWords, decksSummary, llmConfig })
    });

    if (res.ok) {
      return await res.json();
    }

    if (res.status === 405 || res.status === 404) {
      const text = await callLLMClientSide(prompt, systemInstruction, schemaDesc, llmConfig);
      return JSON.parse(text);
    }

    const errData = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(errData.error || `Server Error ${res.status}`);
  } catch (err: any) {
    if (err.message && !err.message.includes("Failed to fetch") && !err.message.includes("NetworkError")) {
      throw err;
    }
    const text = await callLLMClientSide(prompt, systemInstruction, schemaDesc, llmConfig);
    return JSON.parse(text);
  }
}
