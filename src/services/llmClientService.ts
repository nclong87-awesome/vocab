import { GoogleGenAI } from "@google/genai";
import { LLMConfig, Word, QuizQuestion, UserStats } from "../types";
import { generateQuizQuestions, generateConfusers, getPollinationsImageUrl } from "../utils/quizGenerator";
import { getDaysSinceLastReview } from "../utils/spacedRepetition";

// Clean raw JSON strings
export function cleanJsonResponse(rawText: string): string {
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
  if (provider === "chatjimmy") {
    return model || "llama3.1-8B";
  }
  if (provider === "groq") {
    return model || "llama-3.3-70b-versatile";
  }
  if (provider === "openrouter") {
    return model || "meta-llama/llama-3.3-70b-instruct";
  }
  if (provider === "gemini") {
    if (!model || !VALID_GEMINI_MODELS.includes(model)) {
      return "gemini-3.6-flash";
    }
  }
  return model || (provider === "chatjimmy" ? "llama3.1-8B" : provider === "groq" ? "llama-3.3-70b-versatile" : provider === "openrouter" ? "meta-llama/llama-3.3-70b-instruct" : provider === "gemini" ? "gemini-3.6-flash" : "gpt-5.4-mini");
}

export type LLMErrorType =
  | 'INVALID_KEY'
  | 'PERMISSION_DENIED'
  | 'LOCATION_UNSUPPORTED'
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

  // 2b. Location Not Supported / Failed Precondition (400)
  if (
    jsonStatusStr === "FAILED_PRECONDITION" ||
    lowerMsg.includes("user location is not supported") ||
    lowerMsg.includes("failed_precondition") ||
    lowerMsg.includes("location is not supported") ||
    lowerMsg.includes("not available in your current location") ||
    lowerMsg.includes("not available in your")
  ) {
    return {
      statusCode: 400,
      errorType: "LOCATION_UNSUPPORTED",
      userMessage: `Location Not Supported (400): Gemini API is restricted in your user/proxy location. In your Cloudflare Worker, make sure to delete client IP/country headers (x-forwarded-for, cf-connecting-ip, x-real-ip, cf-ipcountry) before proxying to Google.`,
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
  const provider = llmConfig?.provider || "openai";
  const model = sanitizeModel(provider, llmConfig?.model);
  const apiKey = llmConfig?.apiKey || "";
  
  // Single shared proxyKey across providers (checking current config and saved provider map)
  const sharedProxyKey = llmConfig?.proxyKey || 
    (llmConfig?.savedProviders ? Object.values(llmConfig.savedProviders).find(p => Boolean(p?.proxyKey))?.proxyKey : "") || 
    "";
  const proxyKey = sharedProxyKey;
  const baseUrl = llmConfig?.baseUrl || "";

  const effectiveApiKey = apiKey || "";
  const proxyKeyToUse = proxyKey || apiKey || "";

  // ChatJimmy API client-side handling
  if (provider === "chatjimmy") {
    const endpoint = baseUrl || "https://chatjimmy.ai/api/chat";
    return callWithRetry(
      async () => {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Accept": "*/*",
            "Content-Type": "application/json",
            "Origin": "https://chatjimmy.ai",
            "Referer": "https://chatjimmy.ai/",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
            ...(proxyKeyToUse ? { "X-Proxy-Key": proxyKeyToUse } : {})
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
      },
      { maxRetries: 3, provider: "chatjimmy" }
    );
  }

  // Gemini API client-side handling
  if (provider === "gemini") {
    const effectiveGeminiUrl = baseUrl || "https://gemini.nclong87.workers.dev/v1beta";
    const isCustomOrProxyUrl = Boolean(effectiveGeminiUrl && !effectiveGeminiUrl.includes("googleapis.com"));

    if (!isCustomOrProxyUrl) {
      if (!effectiveApiKey && !proxyKeyToUse) {
        throw new LLMConnectionError({
          statusCode: 401,
          errorType: "INVALID_KEY",
          userMessage: "Gemini API Key or Proxy Secret is missing. Please configure LLM settings.",
          originalMessage: "Missing Gemini API key",
          isRetryable: false,
          provider: "gemini"
        });
      }

      const primaryModel = model || "gemini-3.6-flash";
      const fallbackModels = ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-2.5-flash"].filter(m => m !== primaryModel);

      return callWithRetry(
        async (attempt) => {
          const ai = new GoogleGenAI({ 
            apiKey: effectiveApiKey || proxyKeyToUse || "dummy-key",
            httpOptions: {
              headers: {
                ...(proxyKeyToUse ? { "X-Proxy-Key": proxyKeyToUse } : {})
              }
            }
          });
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
    } else {
      // Worker proxy handling for Gemini (uses native generateContent endpoint rather than /chat/completions)
      const primaryModel = model || "gemini-3.6-flash";
      const fallbackModels = ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-2.5-flash"].filter(m => m !== primaryModel);

      return callWithRetry(
        async (attempt) => {
          let activeModel = primaryModel;
          if (attempt > 1 && fallbackModels.length > 0) {
            activeModel = fallbackModels[(attempt - 2) % fallbackModels.length];
          }
          const cleanBaseUrl = effectiveGeminiUrl.replace(/\/$/, "");
          const targetEndpoint = `${cleanBaseUrl}/models/${activeModel}:generateContent${effectiveApiKey ? `?key=${effectiveApiKey}` : ""}`;

          const headers: Record<string, string> = {
            "Content-Type": "application/json"
          };
          if (proxyKeyToUse) {
            headers["X-Proxy-Key"] = proxyKeyToUse;
          }
          if (effectiveApiKey) {
            headers["x-goog-api-key"] = effectiveApiKey;
          }

          const payload = {
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            systemInstruction: systemInstruction ? { parts: [{ text: systemInstruction }] } : undefined,
            generationConfig: {
              responseMimeType: "application/json"
            }
          };

          const res = await fetch(targetEndpoint, {
            method: "POST",
            headers,
            body: JSON.stringify(payload)
          });

          if (!res.ok) {
            const errText = await res.text().catch(() => res.statusText);
            throw new Error(`Gemini Proxy Error (${res.status}): ${errText}`);
          }

          const data = await res.json();
          const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
          if (!text) {
            throw new Error("Empty response from Gemini worker proxy.");
          }
          return cleanJsonResponse(text);
        },
        { maxRetries: 3, provider: "gemini" }
      );
    }
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
            "content-type": "application/json",
            ...(proxyKeyToUse ? { "X-Proxy-Key": proxyKeyToUse } : {})
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

  // OpenAI-compatible providers: openai, 9flare, ollama, groq, openrouter, custom, gemini (worker proxy)
  let defaultBaseUrl = "https://api.openai.com/v1";
  if (provider === "groq") defaultBaseUrl = "https://api.groq.com/openai/v1";
  if (provider === "openrouter") defaultBaseUrl = "https://openrouter.ai/api/v1";
  if (provider === "9flare") defaultBaseUrl = "https://9flare.com/api/v1";
  if (provider === "ollama") defaultBaseUrl = "https://ollama.com/v1";
  if (provider === "custom") defaultBaseUrl = "http://localhost:11434/v1";
  if (provider === "gemini") defaultBaseUrl = "https://gemini.nclong87.workers.dev/v1beta";

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
    headers["X-Title"] = "Vocabulary Learner";
    headers["Model"] = model || "openrouter/free";
  }

  const effectiveTargetBaseUrl = baseUrl || defaultBaseUrl;
  if (proxyKeyToUse || (effectiveTargetBaseUrl && (effectiveTargetBaseUrl.includes("workers.dev") || effectiveTargetBaseUrl.includes("worker.dev") || effectiveTargetBaseUrl.includes("cloudflare.com")))) {
    headers["X-Proxy-Key"] = proxyKeyToUse || apiKey || effectiveApiKey;
  }

  const reqBody: any = {
    model: model || (provider === "gemini" ? "gemini-3.6-flash" : provider === "ollama" ? "llama3.2" : "gpt-5.4-mini"),
    messages: [
      { role: "system", content: systemInstruction + "\nOutput MUST be strictly valid raw JSON matching:\n" + schemaDescription },
      { role: "user", content: prompt }
    ]
  };

  if (provider === "openai" || provider === "groq" || provider === "openrouter" || provider === "gemini" || provider === "9flare") {
    reqBody.stream = false;
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
  const provider = llmConfig?.provider || "openai";
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

// 3. Autofill Word Details
export async function autofillWordService(params: {
  word: string;
  hint?: string;
  targetLanguage?: string;
  nativeLanguage?: string;
  llmConfig?: LLMConfig;
}): Promise<any> {
  const { word, hint, targetLanguage, nativeLanguage, llmConfig } = params;

  const userNative = nativeLanguage || "Vietnamese";
  const userTarget = targetLanguage || "Spanish";

  const prompt = `Provide detailed vocabulary learning material for the word or expression "${word}".
${hint ? `Scope / Context Hint: "${hint}"\nCRITICAL: Generate the definition, translation, and example sentence matching this exact scope/context hint.` : ""}
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

  if (isStaticHost()) {
    const text = await callLLMClientSide(prompt, systemInstruction, schemaDesc, llmConfig);
    return JSON.parse(text);
  }

  try {
    const res = await fetch("/api/autofill-word", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ word, hint, targetLanguage: userTarget, nativeLanguage: userNative, llmConfig })
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

// 3.1. Check Word Multiple Definitions Sense Detection or Exact Definition with Context Hint
export async function checkWordDefinitionsService(params: {
  word: string;
  hint?: string;
  targetLanguage?: string;
  nativeLanguage?: string;
  llmConfig?: LLMConfig;
}): Promise<any> {
  const { word, hint, targetLanguage, nativeLanguage, llmConfig } = params;
  const userNative = nativeLanguage || "Vietnamese";
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

  if (isStaticHost()) {
    const text = await callLLMClientSide(prompt, systemInstruction, schemaDesc, llmConfig);
    return JSON.parse(text);
  }

  try {
    const res = await fetch("/api/check-word-definitions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ word, hint, targetLanguage: userTarget, nativeLanguage: userNative, llmConfig })
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

// 3.5. Generate Random Words for Collection (Deduplicated)
export async function generateRandomWordsService(params: {
  topic: string;
  targetLanguage?: string;
  nativeLanguage?: string;
  count?: number;
  existingWords?: string[];
  llmConfig?: LLMConfig;
}): Promise<{ words: any[] }> {
  const { topic, targetLanguage, nativeLanguage, count = 5, existingWords = [], llmConfig } = params;
  const userNative = nativeLanguage || "Vietnamese";
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

// 3.8. Fix Grammar & Polish Sentence
export interface FixGrammarRequest {
  userText: string;
  targetLanguage?: string;
  nativeLanguage?: string;
  llmConfig?: LLMConfig;
}

export interface FixGrammarResult {
  fixedSentence: string;
  explanation: string;
  vocabularyCandidates: {
    word: string;
    reason: string;
  }[];
}

export async function fixGrammarService(params: FixGrammarRequest): Promise<FixGrammarResult> {
  const { userText, targetLanguage, nativeLanguage, llmConfig } = params;
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

  if (isStaticHost()) {
    const text = await callLLMClientSide(prompt, systemInstruction, schemaDesc, llmConfig);
    return JSON.parse(text);
  }

  try {
    const res = await fetch("/api/fix-grammar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userText, targetLanguage: userTarget, nativeLanguage: userNative, llmConfig })
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
  const { stats, totalWords, masteredWords = [], improvingWords = [], llmConfig } = params;

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

  if (isStaticHost()) {
    const text = await callLLMClientSide(prompt, systemInstruction, schemaDesc, llmConfig);
    return JSON.parse(text);
  }

  try {
    const res = await fetch("/api/analyze-performance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stats, totalWords, masteredWords, improvingWords, llmConfig })
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

// 5. Interactive Chat Assistant Service
export interface ChatMessageRequest {
  messages: { role: string; content: string }[];
  targetLanguage: string;
  nativeLanguage: string;
  llmConfig?: LLMConfig;
}

export interface ChatMessageResult {
  text: string;
  suggestedActions?: {
    label: string;
    action: "add_word" | "start_quiz";
    payload?: {
      word?: string;
    };
  }[];
}

export async function sendChatMessageService(params: ChatMessageRequest): Promise<ChatMessageResult> {
  const { messages, targetLanguage, nativeLanguage, llmConfig } = params;

  const chatHistoryStr = messages
    .slice(-10)
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

  if (isStaticHost()) {
    const text = await callLLMClientSide(prompt, systemInstruction, schemaDesc, llmConfig);
    return JSON.parse(text);
  }

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, targetLanguage, nativeLanguage, llmConfig })
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

export interface QuizGenerationRequest {
  words: Word[];
  targetLanguage?: string;
  nativeLanguage?: string;
  llmConfig?: LLMConfig;
  stats?: UserStats;
}

export async function generateAiQuizQuestionsService(
  params: QuizGenerationRequest
): Promise<QuizQuestion[]> {
  const { words, targetLanguage = "English", nativeLanguage = "Vietnamese", llmConfig, stats } = params;

  if (!words || words.length === 0) {
    return [];
  }

  const fallbackQuestions = generateQuizQuestions(words, targetLanguage);

  if (!llmConfig || !llmConfig.isLoggedIn) {
    return fallbackQuestions;
  }

  const wordDataSummary = words.map(w => {
    const daysSinceReview = getDaysSinceLastReview(w);
    return {
      id: w.id,
      word: w.word,
      partOfSpeech: w.partOfSpeech,
      definition: w.definition,
      translation: w.translation,
      example: w.example || "",
      category: w.category || "General",
      context: w.context || w.definition,
      // Useful stats per word for targeted learning & memory decay:
      strength: w.strength ?? 0, // 0 (weakest/newest) to 4 (mastered)
      learned: Boolean(w.learned),
      starred: Boolean(w.starred),
      daysSinceLastReview: daysSinceReview,
      lastReviewed: w.lastReviewed ? `${daysSinceReview} day(s) ago` : "Never reviewed",
      memoryStatus: daysSinceReview >= 5 ? "Needs Refresher (Memory Decay / Overdue)" : w.strength >= 3 ? "Mastered / Strong" : "Learning / Developing"
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
   - 'picture': "Which word matches the visual concept shown below?" (set imageUrl to https://image.pollinations.ai/prompt/[encoded description of target word in its specific category and real-world usage context]?width=500&height=400&nologo=true)
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
    "imageUrl": "string"
  }
]`;

  const prompt = `Generate 1 quiz question for each of these vocabulary words, adapting question depth and distractors according to the provided word stats and learner progress stats:\n\n` +
    (usefulStatsSummary ? `Learner Progress Stats:\n${JSON.stringify(usefulStatsSummary, null, 2)}\n\n` : "") +
    `Vocabulary Words with Word Mastery Stats:\n${JSON.stringify(wordDataSummary, null, 2)}`;

  const schemaDesc = `Array of QuizQuestion objects with id, wordId, word, type, question, options, correctAnswer, hint, imageUrl.`;

  try {
    let rawResultText = "";
    if (isStaticHost()) {
      rawResultText = await callLLMClientSide(prompt, systemInstruction, schemaDesc, llmConfig);
    } else {
      const res = await fetch("/api/generate-quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ words, stats, targetLanguage, nativeLanguage, llmConfig })
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) return data;
      }
      rawResultText = await callLLMClientSide(prompt, systemInstruction, schemaDesc, llmConfig);
    }

    const cleaned = cleanJsonResponse(rawResultText);
    const parsed = JSON.parse(cleaned);

    if (Array.isArray(parsed) && parsed.length > 0) {
      const validQuestions: QuizQuestion[] = parsed.map((q: any, idx: number) => {
        const matchingWord = words.find(w => w.id === q.wordId || w.word.toLowerCase() === (q.word || "").toLowerCase()) || words[idx % words.length];
        
        let options = Array.isArray(q.options) ? q.options : [];
        if (options.length > 0 && !options.includes(q.correctAnswer || matchingWord.word)) {
          options[0] = q.correctAnswer || matchingWord.word;
        }
        options = Array.from(new Set(options));
        if (options.length < 4) {
          const extraDistractors = generateConfusers(matchingWord.word);
          for (const d of extraDistractors) {
            if (options.length >= 4) break;
            if (!options.includes(d)) options.push(d);
          }
        }

        return {
          id: q.id || `ai-q-${matchingWord.id}-${idx}`,
          wordId: matchingWord.id,
          word: matchingWord.word,
          type: q.type || 'definition',
          question: q.question || `Which word matches: ${matchingWord.definition}`,
          options: options.sort(() => 0.5 - Math.random()),
          correctAnswer: q.correctAnswer || matchingWord.word,
          hint: q.hint || matchingWord.pronunciation,
          imageUrl: (q.imageUrl && !q.imageUrl.includes("loremflickr")) ? q.imageUrl : (q.type === 'picture' ? getPollinationsImageUrl(matchingWord) : undefined)
        };
      });

      return validQuestions;
    }
  } catch (err) {
    console.warn("AI Quiz Generation failed, falling back to rule-based engine:", err);
  }

  return fallbackQuestions;
}
