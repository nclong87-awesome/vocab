import { GoogleGenAI } from "@google/genai";
import { LLMConfig, Word, QuizQuestion, UserStats, SuggestedVocabularyWord } from "../types";
import { generateQuizQuestions, generateConfusers, getImageKeyword } from "../utils/quizGenerator";
import { getDaysSinceLastReview } from "../utils/spacedRepetition";
import {  resizeImageDataUrl } from "../utils/llmHelpers";
import { PROVIDER_OPTIONS, DEFAULT_PROVIDER_ID } from "../config/llmProviders";
import { fetchWithTimeout } from "../utils";
import { 
  getAutoModelCandidates, 
  getAutoCandidateWithMeta,
  lockModel, 
  recordModelResponse, 
  recordModelFailure
} from "../utils/autoModeManager";

import { cleanJsonResponse, cleanAndParseJson } from "../utils/jsonSanitizer";
export { cleanJsonResponse, cleanAndParseJson };

const VALID_GEMINI_MODELS = [
  "gemini-3.6-flash",
  "gemini-3.6-flash-lite",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite"
];

// Sanitize model names for provider
export function sanitizeModel(provider: string, model?: string): string {
  if (provider === "gemini") {
    if (!model || !VALID_GEMINI_MODELS.includes(model)) {
      return "gemini-3.6-flash";
    }
  }
  if (model) return model;
  const providerMeta = PROVIDER_OPTIONS.find(p => p.id === provider);
  if (providerMeta?.defaultModel) return providerMeta.defaultModel;
  const defaultMeta = PROVIDER_OPTIONS.find(p => p.id === DEFAULT_PROVIDER_ID) || PROVIDER_OPTIONS[0];
  return defaultMeta.defaultModel;
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
  let originalMessage =
    err?.userMessage ||
    err?.message ||
    (typeof err === "string" ? err : JSON.stringify(err || {}));

  // Clean HTML error bodies (e.g. 404 page from wrong endpoints)
  if (originalMessage.includes("<!DOCTYPE") || originalMessage.includes("<html") || originalMessage.includes("<body")) {
    const titleMatch = originalMessage.match(/<title>([^<]+)<\/title>/i);
    const h1Match = originalMessage.match(/<h1[^>]*>([^<]+)<\/h1>/i);
    if (titleMatch && titleMatch[1].trim()) {
      originalMessage = `HTML Error Response (${titleMatch[1].trim()})`;
    } else if (h1Match && h1Match[1].trim()) {
      originalMessage = `HTML Error Response (${h1Match[1].trim()})`;
    } else {
      originalMessage = "HTML Error Response (404/500) from server endpoint";
    }
  }

  const provUpper = provider.toUpperCase();

  // Extract HTTP status code if present
  let statusCode =
    err?.statusCode ||
    err?.status ||
    err?.response?.status ||
    err?.code ||
    0;

  if (typeof statusCode !== "number" || isNaN(statusCode) || !statusCode) {
    const statusMatch = originalMessage.match(/\((\d{3})\)/);
    if (statusMatch) {
      statusCode = parseInt(statusMatch[1], 10);
    } else {
      statusCode = 0;
    }
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
      userMessage: `Rate Limit Exceeded (429): ${provUpper} API quota or rate limit reached.`,
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

  // 6. Network / CORS / Fetch Error / Timeout
  if (
    err?.name === "TypeError" ||
    lowerMsg.includes("failed to fetch") ||
    lowerMsg.includes("networkerror") ||
    lowerMsg.includes("cors") ||
    lowerMsg.includes("econnreset") ||
    lowerMsg.includes("etimedout") ||
    lowerMsg.includes("timed out")
  ) {
    const isTimeout = lowerMsg.includes("timed out") || lowerMsg.includes("etimedout");
    return {
      statusCode: 0,
      errorType: "NETWORK_ERROR",
      userMessage: isTimeout
        ? `API Request Timed Out (60s): ${provUpper} API did not respond within 60 seconds.`
        : `Network Connection Error: Unable to reach ${provUpper} API servers from the browser. Please verify your internet connection.`,
      originalMessage,
      isRetryable: !isTimeout,
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
  const maxRetries = options.maxRetries ?? 1;
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

// Client-side direct LLM API invocation for a single provider candidate
async function callLLMClientSideSingleCandidate(
  prompt: string, 
  systemInstruction: string, 
  schemaDescription: string,
  llmConfig?: LLMConfig
): Promise<string> {
  const provider = llmConfig?.provider || "openrouter";
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
      const fallbackModels = ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite"].filter(m => m !== primaryModel);

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
        { maxRetries: 1, provider: "gemini" }
      );
    } else {
      const primaryModel = model || "gemini-3.6-flash";
      const fallbackModels = ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite"].filter(m => m !== primaryModel);

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

          const res = await fetchWithTimeout(targetEndpoint, {
            method: "POST",
            headers,
            body: JSON.stringify(payload)
          });

          if (!res.ok) {
            const errText = await res.text().catch(() => res.statusText);
            throw new Error(`Gemini Proxy Error (${res.status}): ${errText}`);
          }

          const data = await res.json();
          const parts = data.candidates?.[0]?.content?.parts || [];
          const text = parts.map((p: any) => p.text || "").join("").trim() || data.text || data.candidates?.[0]?.output || "";
          if (!text) {
            throw new Error("Empty response from Gemini worker proxy.");
          }
          return cleanJsonResponse(text);
        },
        { maxRetries: 1, provider: "gemini" }
      );
    }
  }

  // OpenAI-compatible providers: openai, 9flare, ollama, groq, openrouter, custom, gemini (worker proxy)
  let defaultBaseUrl = "https://openai.nclong87.workers.dev/v1";
  if (provider === "groq") defaultBaseUrl = "https://groq.nclong87.workers.dev/openai/v1";
  if (provider === "openrouter") defaultBaseUrl = "https://openrouter.nclong87.workers.dev/api/v1";
  if (provider === "9flare") defaultBaseUrl = "https://9flare.nclong87.workers.dev/api/v1";
  if (provider === "ollama") defaultBaseUrl = "https://ollama.nclong87.workers.dev/v1";
  if (provider === "custom") defaultBaseUrl = "http://localhost:11434/v1";
  if (provider === "gemini") defaultBaseUrl = "https://gemini.nclong87.workers.dev/v1beta";

  let effectiveTargetBaseUrl = (baseUrl && baseUrl.trim()) ? baseUrl.trim() : defaultBaseUrl;
  effectiveTargetBaseUrl = effectiveTargetBaseUrl.replace(/\/+$/, "");
  if (effectiveTargetBaseUrl.endsWith("/chat/completions")) {
    effectiveTargetBaseUrl = effectiveTargetBaseUrl.slice(0, -"/chat/completions".length).replace(/\/+$/, "");
  }
  if (provider === "9flare" && effectiveTargetBaseUrl === "https://9flare.com") {
    effectiveTargetBaseUrl = "https://9flare.com/v1";
  }

  const targetUrl = effectiveTargetBaseUrl + "/chat/completions";

  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };

  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  } else if (provider !== "ollama" && effectiveApiKey) {
    headers["Authorization"] = `Bearer ${effectiveApiKey}`;
  }

  if (provider === "openrouter") {
    headers["HTTP-Referer"] = typeof window !== "undefined" ? window.location.origin : "https://aistudio.google.com";
    headers["X-Title"] = "Vocabulary Learner";
  }

  if (proxyKeyToUse || (effectiveTargetBaseUrl && (effectiveTargetBaseUrl.includes("workers.dev") || effectiveTargetBaseUrl.includes("worker.dev") || effectiveTargetBaseUrl.includes("cloudflare.com")))) {
    headers["X-Proxy-Key"] = proxyKeyToUse || apiKey || effectiveApiKey;
  }

  const reqBody: any = {
    model: model || (provider === "openrouter" ? "inclusionai/ling-3.0-flash:free" : provider === "gemini" ? "gemini-3.6-flash" : provider === "ollama" ? "llama3.2" : "inclusionai/ling-3.0-flash:free"),
    messages: [
      { role: "system", content: systemInstruction + "\nOutput MUST be strictly valid raw JSON-only matching:\n" + schemaDescription + "\nDo not include any conversational filler outside the JSON." },
      { role: "user", content: prompt }
    ],
    stream: false
  };

  // OpenRouter models often return 400 "JSON mode is not supported for this model". Only pass response_format for other supported providers.
  if (provider === "openai" || provider === "groq" || provider === "gemini" || provider === "9flare") {
    reqBody.response_format = { type: "json_object" };
  }

  return callWithRetry(
    async () => {
      let res = await fetchWithTimeout(targetUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(reqBody)
      });

      // If request failed with 400 due to response_format or JSON mode incompatibility, retry once without response_format
      if (!res.ok && reqBody.response_format) {
        const errClone = res.clone();
        const errText = await errClone.text().catch(() => "");
        if (errText.includes("JSON mode") || errText.includes("response_format") || res.status === 400) {
          delete reqBody.response_format;
          res = await fetchWithTimeout(targetUrl, {
            method: "POST",
            headers,
            body: JSON.stringify(reqBody)
          });
        }
      }

      if (!res.ok) {
        const errText = await res.text().catch(() => res.statusText);
        throw new Error(`${provider.toUpperCase()} API Error (${res.status}): ${errText}`);
      }

      return await parseOpenAiStyleResponse(res);
    },
    { maxRetries: 1, provider }
  );
}

export interface LLMResponseWithMeta {
  text: string;
  provider: string;
  model: string;
  responseTimeMs?: number;
}

// Client-side LLM invocation returning text plus provider and model metadata
export async function callLLMClientSideWithMeta(
  prompt: string, 
  systemInstruction: string, 
  schemaDescription: string,
  llmConfig?: LLMConfig
): Promise<LLMResponseWithMeta> {
  const provider = llmConfig?.provider || "auto";

  // AUTO MODE: Automatically rotate across all available models & lock failing models for 1 hour
  if (provider === "auto" || llmConfig?.model === "auto") {
    const candidates = getAutoModelCandidates(llmConfig);
    const excludedKeys = new Set<string>();
    let lastError: any = null;

    for (let attempt = 0; attempt < candidates.length; attempt++) {
      const { candidate, tierMeta } = getAutoCandidateWithMeta(llmConfig, excludedKeys);
      const candidateKey = `${candidate.provider}:${candidate.model}`;
      excludedKeys.add(candidateKey);

      const candidateSavedProfile = llmConfig?.savedProviders?.[candidate.provider];
      const effectiveCandidateConfig: LLMConfig = {
        provider: candidate.provider,
        model: candidate.model,
        apiKey: candidateSavedProfile?.apiKey || (llmConfig?.provider === candidate.provider ? llmConfig.apiKey : ""),
        proxyKey: candidateSavedProfile?.proxyKey || llmConfig?.proxyKey || "",
        baseUrl: candidateSavedProfile?.baseUrl || "",
        useProxy: candidateSavedProfile?.useProxy !== undefined ? candidateSavedProfile.useProxy : true,
        isLoggedIn: true,
        savedProviders: llmConfig?.savedProviders
      };

      const candidateStartTime = Date.now();
      try {
        console.log(`[Auto Mode - ${tierMeta.badgeLabel}] Attempt ${attempt + 1}/${candidates.length}: Routing request to ${candidateKey}`);
        let text = await callLLMClientSideSingleCandidate(prompt, systemInstruction, schemaDescription, effectiveCandidateConfig);
        const candidateDuration = Date.now() - candidateStartTime;

        if (schemaDescription) {
          try {
            text = cleanJsonResponse(text);
            JSON.parse(text);
          } catch (jsonErr: any) {
            try {
              const repairedObj = cleanAndParseJson(text);
              text = JSON.stringify(repairedObj);
            } catch (repairErr: any) {
              throw new Error(`Invalid JSON format response from ${candidateKey}: ${repairErr.message || jsonErr.message}`);
            }
          }
        }

        recordModelResponse(candidate.provider, candidate.model, candidateDuration);

        return {
          text,
          provider: candidate.provider,
          model: candidate.model,
          responseTimeMs: candidateDuration
        };
      } catch (err: any) {
        lastError = err;
        const candidateDuration = Date.now() - candidateStartTime;
        console.warn(`[Auto Mode] Model ${candidateKey} failed: ${err?.message || err}. Locking for 1 hour and switching automatically...`);
        recordModelFailure(candidate.provider, candidate.model, err?.message || String(err), candidateDuration);
      }
    }

    throw lastError || new Error("All AI models in Auto Mode failed or were locked out. Please check network connectivity or API configuration.");
  }

  const activeProvider = llmConfig?.provider || "gemini";
  const activeModel = sanitizeModel(activeProvider, llmConfig?.model);
  const singleStartTime = Date.now();
  try {
    const text = await callLLMClientSideSingleCandidate(prompt, systemInstruction, schemaDescription, llmConfig);
    const singleDuration = Date.now() - singleStartTime;
    recordModelResponse(activeProvider, activeModel, singleDuration);
    return {
      text,
      provider: activeProvider,
      model: activeModel,
      responseTimeMs: singleDuration
    };
  } catch (err: any) {
    const singleDuration = Date.now() - singleStartTime;
    recordModelFailure(activeProvider, activeModel, err?.message || String(err), singleDuration);
    throw err;
  }
}

// Outer LLM invocation entry point supporting Auto Mode model rotation & circuit breaker lockouts
export async function callLLMClientSide(
  prompt: string, 
  systemInstruction: string, 
  schemaDescription: string,
  llmConfig?: LLMConfig
): Promise<string> {
  const res = await callLLMClientSideWithMeta(prompt, systemInstruction, schemaDescription, llmConfig);
  return res.text;
}

function extractTextFromContentClient(content: any): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map(item => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object") {
        return item.text || item.content || item.value || "";
      }
      return "";
    }).join("");
  }
  if (typeof content === "object") {
    return content.text || content.value || content.content || "";
  }
  return String(content);
}

function extractTextFromChoiceClient(choice: any): string {
  if (!choice) return "";
  if (choice.message) {
    const msg = choice.message;
    const txt = extractTextFromContentClient(msg.content) || extractTextFromContentClient(msg.text);
    if (txt) return txt;
    if (msg.reasoning_content && !msg.content) {
      return extractTextFromContentClient(msg.reasoning_content);
    }
  }
  if (choice.delta) {
    const delta = choice.delta;
    const txt = extractTextFromContentClient(delta.content) || extractTextFromContentClient(delta.text);
    if (txt) return txt;
    if (delta.reasoning_content && delta.content === undefined) {
      return extractTextFromContentClient(delta.reasoning_content);
    }
  }
  if (choice.text) {
    return extractTextFromContentClient(choice.text);
  }
  return "";
}

// Helper to parse OpenAI/OpenRouter style responses (supporting both standard JSON objects and SSE/streaming lines)
async function parseOpenAiStyleResponse(res: Response): Promise<string> {
  const rawText = await res.text();

  if (!rawText || !rawText.trim()) {
    throw new Error("Empty response received from API.");
  }

  const trimmedText = rawText.trim();

  // 1. Try parsing directly as a standard JSON response object
  try {
    const data = JSON.parse(trimmedText);
    if (data && typeof data === "object") {
      const content = extractTextFromChoiceClient(data.choices?.[0]) ||
                      data.output ||
                      data.text ||
                      data.content ||
                      "";
      if (content) {
        return cleanJsonResponse(content);
      }
    }
  } catch {
    // Not a single valid JSON object; proceed to parse as SSE / chunked event stream
  }

  // 2. Parse as SSE streaming event lines ("data: {...}") or chunked stream
  let accumulatedText = "";
  let dataBuffer = "";

  const processChunk = (str: string): boolean => {
    if (!str) return false;
    const trimmed = str.trim();
    if (!trimmed || trimmed === "[DONE]") return true;
    try {
      const parsed = JSON.parse(trimmed);
      const chunkText = extractTextFromChoiceClient(parsed.choices?.[0]) ||
                        parsed.choices?.[0]?.delta?.content ||
                        parsed.choices?.[0]?.message?.content ||
                        parsed.choices?.[0]?.text ||
                        "";
      if (chunkText) {
        accumulatedText += chunkText;
      }
      return true;
    } catch {
      return false;
    }
  };

  const lines = trimmedText.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      if (dataBuffer) {
        processChunk(dataBuffer);
        dataBuffer = "";
      }
      continue;
    }

    if (line.startsWith(":")) {
      // SSE comment / ping
      continue;
    }

    if (line.startsWith("data:")) {
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") {
        if (dataBuffer) {
          processChunk(dataBuffer);
          dataBuffer = "";
        }
        continue;
      }

      if (dataBuffer) {
        if (!processChunk(dataBuffer)) {
          // Unparsed buffer: append new payload line
          dataBuffer += "\n" + payload;
        } else {
          dataBuffer = payload;
        }
      } else {
        dataBuffer = payload;
      }

      if (processChunk(dataBuffer)) {
        dataBuffer = "";
      }
    } else if (dataBuffer) {
      // Continuation line (e.g. unescaped newline inside a string in SSE payload)
      dataBuffer += "\n" + line;
      if (processChunk(dataBuffer)) {
        dataBuffer = "";
      }
    }
  }

  if (dataBuffer) {
    processChunk(dataBuffer);
  }

  if (accumulatedText) {
    return cleanJsonResponse(accumulatedText);
  }

  // 3. Fallback to cleanJsonResponse on rawText
  return cleanJsonResponse(rawText);
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
  const provider = llmConfig?.provider || "openrouter";
  const modelUsed = sanitizeModel(provider, llmConfig?.model);

  // Static host (GitHub Pages, Vercel) direct client test
  if (isStaticHost()) {
    try {
      const text = await callLLMClientSide(
        "Respond with a short json object: {\"status\": \"connected\", \"message\": \"LLM provider connection successful!\"}",
        "You are a helpful dictionary test assistant. Output strictly valid JSON-only output when requested. Do not include any conversational filler outside the JSON.",
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
    const response = await fetchWithTimeout("/api/test-llm", {
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
        "You are a helpful dictionary test assistant. Output strictly valid JSON-only output when requested. Do not include any conversational filler outside the JSON.",
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
      "You are a helpful dictionary test assistant. Output strictly valid JSON-only output when requested. Do not include any conversational filler outside the JSON.",
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

  const prompt = `Provide detailed vocabulary learning material for the input word or expression "${word}".
${hint ? `Scope / Context Hint: "${hint}"\nCRITICAL: Generate the definition, translation, and example sentence matching this exact scope/context hint.` : ""}
Target language being learned: "${userTarget}".
User's native language: "${userNative}".

CRITICAL AUTOMATIC LANGUAGE DETECTION & TRANSLATION INSTRUCTIONS:
- NATURAL LANGUAGE REQUEST OR SENTENCE (EXTRACT CLEAN HEADWORD & CONTEXT):
  * If "${word}" is a user sentence or natural request specifying a word and context (e.g. "I want to add a citation in the RAG context", "I want to add table in database context", "add the word citation in RAG context"):
    - EXTRACT ONLY the pure headword or core term itself for the "word" field (e.g., set "word": "citation", NOT "I want to add a citation in the RAG context").
    - EXTRACT the specified context/domain (e.g., "RAG context") and use it as the Scope / Context Hint to generate the specific definition, translation, category, context, and example sentence for that exact domain/meaning.
    - DO NOT include full conversational text or user request phrasing inside the "word" property!
- PARENTHETICAL NOTES & CONTEXT DISAMBIGUATION (EXTRACT CLEAN HEADWORD):
  * If "${word}" contains parenthetical text, context notes, usage domain, or disambiguation hints inside parentheses (e.g., "citation (in RAG context)", "table (database)", "run (business)"):
    - EXTRACT ONLY the pure headword or core term itself for the "word" field (e.g., set "word": "citation", NOT "citation (in RAG context)").
    - DO NOT include parenthetical text or usage notes inside the "word" property!
    - USE the parenthetical text as the implicit Scope / Context Hint to generate the specific definition, translation, category, context, and example sentence matching that exact domain/meaning.
- AUTOMATIC LANGUAGE DETECTION: The user input string "${word}" could be entered in EITHER the Target Language ("${userTarget}") OR the Native Language ("${userNative}").
  * If "${word}" is in the user's Native Language ("${userNative}"), e.g. "xin chào" in Vietnamese:
    - Translate it into the Target Language ("${userTarget}"), e.g. "hello".
    - Set the "word" field strictly to the Target Language word (e.g. "hello").
    - Set "translation" strictly to the Native Language term (e.g. "xin chào").
  * If "${word}" is already in the Target Language ("${userTarget}"), e.g. "hello":
    - Set "word" strictly to "${word}" (or its canonical Target Language form).
    - Set "translation" strictly to its direct translation in the user's Native Language ("${userNative}"), e.g. "xin chào".
- "definition": Write clear, concise definition/explanation STRICTLY in the TARGET language (${userTarget}) for target language immersion.
- "pronunciation": International Phonetic Alphabet (IPA) pronunciation guide for the target language word.
- "partOfSpeech": noun, verb, adjective, adverb, idiom, interjection, or expression.
- "example": A realistic, high-quality example sentence in the target language (${userTarget}), e.g. "Hello, how are you?".
- "exampleTranslation": Full translation of the example sentence into the user's native language (${userNative}), e.g. "Xin chào, bạn khỏe không?".
- "category": High-level category or topic classification (e.g. "Travel & Hospitality", "Business & Work", "Technology", "Daily Life", "Emotions & Mind", "Education", "Food & Dining", etc.).
- "context": A concise 1-sentence description of the specific real-world scenario, domain, or usage context where this term is typically used.`;

  const systemInstruction = `You are a professional multilingual dictionary database engine. You detect input language, map native language inputs to the target language, and output target language vocabulary details with native language translations. Output strictly valid JSON-only output when requested. Do not include any conversational filler outside the JSON.`;
  const schemaDesc = `{
  "word": "string (the word/expression STRICTLY in target language ${userTarget}, e.g. 'hello')",
  "pronunciation": "string",
  "partOfSpeech": "string",
  "definition": "string (definition written STRICTLY in ${userTarget})",
  "translation": "string (translation in ${userNative}, e.g. 'xin chào')",
  "example": "string (example in ${userTarget})",
  "exampleTranslation": "string (example translation in ${userNative})",
  "category": "string (topic/category string)",
  "context": "string (specific real-world usage context description)"
}`;

  const startTime = performance.now();

  if (isStaticHost()) {
    const resWithMeta = await callLLMClientSideWithMeta(prompt, systemInstruction, schemaDesc, llmConfig);
    const duration = resWithMeta.responseTimeMs || Math.round(performance.now() - startTime);
    if (resWithMeta.provider && resWithMeta.model) {
      recordModelResponse(resWithMeta.provider, resWithMeta.model, duration);
    }
    return cleanAndParseJson(resWithMeta.text);
  }

  try {
    const res = await fetchWithTimeout("/api/autofill-word", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ word, hint, targetLanguage: userTarget, nativeLanguage: userNative, llmConfig })
    });

    if (res.ok) {
      const data = await res.json();
      const duration = data.responseTimeMs || Math.round(performance.now() - startTime);
      const prov = data.provider || llmConfig?.provider || "gemini";
      const mod = data.model || sanitizeModel(llmConfig?.provider || "gemini", llmConfig?.model);
      if (prov && mod) {
        recordModelResponse(prov, mod, duration);
      }
      return data;
    }

    if (res.status === 405 || res.status === 404) {
      const resWithMeta = await callLLMClientSideWithMeta(prompt, systemInstruction, schemaDesc, llmConfig);
      const duration = resWithMeta.responseTimeMs || Math.round(performance.now() - startTime);
      if (resWithMeta.provider && resWithMeta.model) {
        recordModelResponse(resWithMeta.provider, resWithMeta.model, duration);
      }
      return cleanAndParseJson(resWithMeta.text);
    }

    const errData = await res.json().catch(() => ({ error: res.statusText }));
    console.warn("[autofillWordService] Server returned error status:", res.status, errData, "Attempting client-side LLM fallback...");
    const resWithMeta = await callLLMClientSideWithMeta(prompt, systemInstruction, schemaDesc, llmConfig);
    const duration = resWithMeta.responseTimeMs || Math.round(performance.now() - startTime);
    if (resWithMeta.provider && resWithMeta.model) {
      recordModelResponse(resWithMeta.provider, resWithMeta.model, duration);
    }
    return cleanAndParseJson(resWithMeta.text);
  } catch (err: any) {
    console.warn("[autofillWordService] Server call failed:", err?.message || err, "Attempting client-side LLM fallback...");
    try {
      const resWithMeta = await callLLMClientSideWithMeta(prompt, systemInstruction, schemaDesc, llmConfig);
      const duration = resWithMeta.responseTimeMs || Math.round(performance.now() - startTime);
      if (resWithMeta.provider && resWithMeta.model) {
        recordModelResponse(resWithMeta.provider, resWithMeta.model, duration);
      }
      return cleanAndParseJson(resWithMeta.text);
    } catch (clientErr) {
      throw err;
    }
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

  const prompt = `Analyze the input word or expression "${word}".
${hint ? `Scope / Context Hint: "${hint}"\nCRITICAL MANDATORY REQUIREMENT: The user wants to add "${word}" specifically in the scope/context described above.` : ""}
Target language: "${userTarget}".
User's native language: "${userNative}".

CRITICAL AUTOMATIC LANGUAGE DETECTION & TRANSLATION INSTRUCTIONS:
1. NATURAL LANGUAGE REQUEST OR SENTENCE (EXTRACT CLEAN HEADWORD & CONTEXT):
   - If "${word}" is a user sentence or request asking to add a word and context (e.g., "I want to add a citation in the RAG context", "I want to add table in database context", "add the word citation in RAG context"):
     * EXTRACT ONLY the target vocabulary headword itself for the "word" field (both for top-level "word" and inside every sense item in "senses", e.g., set "word": "citation", NOT "I want to add a citation in the RAG context").
     * EXTRACT the specified domain/context (e.g. "RAG context") and use it as the Scope / Context Hint to generate the specific definition, translation, category, context, and example sentence for that exact domain/meaning.
     * DO NOT include full sentence text or request phrases in the "word" property!
2. PARENTHETICAL NOTES & CONTEXT DISAMBIGUATION (EXTRACT CLEAN HEADWORD):
   - If "${word}" contains parenthetical text, context notes, usage domain, or disambiguation hints inside parentheses (e.g., "citation (in RAG context)", "table (database)", "run (business)"):
     * EXTRACT ONLY the pure headword or core term itself for the "word" field (both for top-level "word" and inside every sense item in "senses", e.g., set "word": "citation", NOT "citation (in RAG context)").
     * DO NOT include parenthetical explanatory text inside the "word" property!
     * USE the parenthetical text as the implicit Scope / Context Hint to generate the specific definition, translation, category, context, and example sentence matching that exact domain/meaning.
3. AUTOMATIC LANGUAGE DETECTION: The user input string "${word}" could be entered in EITHER the Target Language ("${userTarget}") OR the Native Language ("${userNative}").
   - If "${word}" is in the user's Native Language ("${userNative}"), e.g. "xin chào" in Vietnamese:
     * Translate it into the Target Language ("${userTarget}"), e.g. "hello".
     * Set the top-level "word" field and the "word" field inside each sense strictly to the Target Language word (e.g. "hello").
     * Set "translation" strictly to the Native Language term (e.g. "xin chào").
   - If "${word}" is already in the Target Language ("${userTarget}"), e.g. "hello":
     * Set "word" strictly to "${word}" (or its canonical Target Language form).
     * Set "translation" strictly to its direct translation in the user's Native Language ("${userNative}"), e.g. "xin chào".

2. DEFINITIONS & EXAMPLES:
   - "definition": Write clear, concise definition(s) STRICTLY in the Target Language ("${userTarget}") for language immersion.
   - "example": Provide example sentence(s) written STRICTLY in the Target Language ("${userTarget}"), e.g. "Hello, how are you?".
   - "exampleTranslation": Provide full translation of the example sentence into the user's Native Language ("${userNative}"), e.g. "Xin chào, bạn khỏe không?".
   - "partOfSpeech": noun, verb, adjective, adverb, idiom, interjection, or expression.
   - "pronunciation": IPA pronunciation guide for the Target Language word (e.g. "/həˈloʊ/").

3. INVALID INPUT HANDLING:
   - If no valid definition or meaning can be found or generated for "${word}" (or if "${word}" is invalid or unrecognized), set "notFound": true, "hasMultipleSenses": false, and "senses": [].

4. MULTIPLE SENSES DISAMBIGUATION:
   - ${hint ? `Since a specific Scope/Context Hint was provided ("${hint}"), set "hasMultipleSenses": false and return ONLY 1 exact matching sense in "senses".` : `If there is only 1 dominant definition or translation, set "hasMultipleSenses": false. If there are 2 to 4 distinct meanings or parts of speech in "${userTarget}", set "hasMultipleSenses": true.`}
   - Provide the matching sense(s) in "senses". For each sense, include:
     "word": string (Target Language word in "${userTarget}"),
     "partOfSpeech": string,
     "definition": string (written in "${userTarget}"),
     "translation": string (written in "${userNative}"),
     "pronunciation": string,
     "example": string (written in "${userTarget}"),
     "exampleTranslation": string (written in "${userNative}"),
     "imageKeyword": string (3-5 word comma-free search term capturing the visual concept of the word with relevance context and category for image search),
     "category": string,
     "context": string`;

  const systemInstruction = `You are an elite multilingual dictionary lookup engine. You automatically detect input language, map native language inputs to the target language, and output structured JSON with target language words, definitions, and native language translations. If no valid definition exists or cannot be found, set "notFound": true and "senses": []. Output strictly valid JSON-only output when requested. Do not include any conversational filler outside the JSON.`;
  const schemaDesc = `{
  "word": "string (the word/expression STRICTLY in the target language ${userTarget}, e.g. 'hello')",
  "notFound": boolean,
  "hasMultipleSenses": boolean,
  "senses": [
    {
      "word": "string (the word/expression STRICTLY in the target language ${userTarget}, e.g. 'hello')",
      "partOfSpeech": "string (e.g. noun, verb, adjective, expression)",
      "definition": "string (definition written STRICTLY in ${userTarget})",
      "translation": "string (translation in ${userNative})",
      "pronunciation": "string (IPA pronunciation)",
      "example": "string (sentence in ${userTarget})",
      "exampleTranslation": "string (sentence translation in ${userNative})",
      "imageKeyword": "string (3-5 word comma-free search term capturing the visual concept of the word with relevance context and category for image search)",
      "category": "string",
      "context": "string"
    }
  ]
}`;

  const startTime = performance.now();

  if (isStaticHost()) {
    const resWithMeta = await callLLMClientSideWithMeta(prompt, systemInstruction, schemaDesc, llmConfig);
    const parsed = JSON.parse(resWithMeta.text);
    const duration = resWithMeta.responseTimeMs || Math.round(performance.now() - startTime);
    if (resWithMeta.provider && resWithMeta.model) {
      recordModelResponse(resWithMeta.provider, resWithMeta.model, duration);
    }
    return {
      ...parsed,
      provider: resWithMeta.provider,
      model: resWithMeta.model,
      responseTimeMs: duration
    };
  }

  try {
    const res = await fetchWithTimeout("/api/check-word-definitions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ word, hint, targetLanguage: userTarget, nativeLanguage: userNative, llmConfig })
    });

    if (res.ok) {
      const data = await res.json();
      const duration = data.responseTimeMs || Math.round(performance.now() - startTime);
      const prov = data.provider || llmConfig?.provider || "gemini";
      const mod = data.model || sanitizeModel(llmConfig?.provider || "gemini", llmConfig?.model);
      if (prov && mod) {
        recordModelResponse(prov, mod, duration);
      }
      return {
        ...data,
        provider: prov,
        model: mod,
        responseTimeMs: duration
      };
    }

    if (res.status === 405 || res.status === 404) {
      const resWithMeta = await callLLMClientSideWithMeta(prompt, systemInstruction, schemaDesc, llmConfig);
      const parsed = JSON.parse(resWithMeta.text);
      const duration = resWithMeta.responseTimeMs || Math.round(performance.now() - startTime);
      if (resWithMeta.provider && resWithMeta.model) {
        recordModelResponse(resWithMeta.provider, resWithMeta.model, duration);
      }
      return {
        ...parsed,
        provider: resWithMeta.provider,
        model: resWithMeta.model,
        responseTimeMs: duration
      };
    }

    const errData = await res.json().catch(() => ({ error: res.statusText }));
    console.warn("[checkWordDefinitionsService] Server returned error status, attempting client-side LLM auto mode fallback...", res.status, errData);
    const resWithMeta = await callLLMClientSideWithMeta(prompt, systemInstruction, schemaDesc, llmConfig);
    const parsed = JSON.parse(resWithMeta.text);
    const duration = resWithMeta.responseTimeMs || Math.round(performance.now() - startTime);
    if (resWithMeta.provider && resWithMeta.model) {
      recordModelResponse(resWithMeta.provider, resWithMeta.model, duration);
    }
    return {
      ...parsed,
      provider: resWithMeta.provider,
      model: resWithMeta.model,
      responseTimeMs: duration
    };
  } catch (err: any) {
    console.warn("[checkWordDefinitionsService] Server call failed, attempting client-side LLM auto mode fallback...", err?.message || err);
    try {
      const resWithMeta = await callLLMClientSideWithMeta(prompt, systemInstruction, schemaDesc, llmConfig);
      const parsed = JSON.parse(resWithMeta.text);
      const duration = resWithMeta.responseTimeMs || Math.round(performance.now() - startTime);
      if (resWithMeta.provider && resWithMeta.model) {
        recordModelResponse(resWithMeta.provider, resWithMeta.model, duration);
      }
      return {
        ...parsed,
        provider: resWithMeta.provider,
        model: resWithMeta.model,
        responseTimeMs: duration
      };
    } catch (clientErr) {
      throw err;
    }
  }
}

// 3.5. Generate Random Words for Collection
export async function generateRandomWordsService(params: {
  topic: string;
  targetLanguage?: string;
  nativeLanguage?: string;
  count?: number;
  llmConfig?: LLMConfig;
}): Promise<{ words: any[]; provider?: string; model?: string; responseTimeMs?: number }> {
  const { topic, targetLanguage, nativeLanguage, count = 5, llmConfig } = params;
  const userNative = nativeLanguage || "Vietnamese";
  const userTarget = targetLanguage || "Spanish";
  const startTime = performance.now();

  const prompt = `Generate ${count} practical vocabulary words or expressions in target language "${userTarget}" relevant to or expanding on the topic "${topic || "Vocabulary"}".
The user's native language is "${userNative}".

CRITICAL INSTRUCTIONS:
- Every word generated SHOULD BE unique and practical for a language learner.
- "definition": Write clear, concise definitions/explanations STRICTLY in the TARGET language (${userTarget}) for target language immersion.
- "translation": Direct translation into the user's native language (${userNative}).
- "example": Realistic example sentence in target language (${userTarget}).
- "exampleTranslation": Translation of example sentence into user's native language (${userNative}).
- "category": High-level category string (e.g. "${topic || "Vocabulary"}").
- "context": Short description of the real-world situation or domain context where this word is used.`;

  const systemInstruction = `You are an expert language teacher. Output strictly valid JSON-only output when requested containing an array of vocabulary words. Do not include any conversational filler outside the JSON.`;
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
    const resWithMeta = await callLLMClientSideWithMeta(prompt, systemInstruction, schemaDesc, llmConfig);
    const parsed = JSON.parse(resWithMeta.text);
    const duration = resWithMeta.responseTimeMs || Math.round(performance.now() - startTime);
    if (resWithMeta.provider && resWithMeta.model) {
      recordModelResponse(resWithMeta.provider, resWithMeta.model, duration);
    }
    return {
      ...parsed,
      provider: resWithMeta.provider,
      model: resWithMeta.model,
      responseTimeMs: duration
    };
  }

  try {
    const res = await fetchWithTimeout("/api/generate-random-words", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic, targetLanguage: userTarget, nativeLanguage: userNative, count, llmConfig })
    });

    if (res.ok) {
      const data = await res.json();
      const duration = data.responseTimeMs || Math.round(performance.now() - startTime);
      const prov = data.provider || llmConfig?.provider || "gemini";
      const mod = data.model || sanitizeModel(llmConfig?.provider || "gemini", llmConfig?.model);
      if (prov && mod) {
        recordModelResponse(prov, mod, duration);
      }
      return {
        ...data,
        provider: prov,
        model: mod,
        responseTimeMs: duration
      };
    }

    if (res.status === 405 || res.status === 404) {
      const resWithMeta = await callLLMClientSideWithMeta(prompt, systemInstruction, schemaDesc, llmConfig);
      const parsed = JSON.parse(resWithMeta.text);
      const duration = resWithMeta.responseTimeMs || Math.round(performance.now() - startTime);
      if (resWithMeta.provider && resWithMeta.model) {
        recordModelResponse(resWithMeta.provider, resWithMeta.model, duration);
      }
      return {
        ...parsed,
        provider: resWithMeta.provider,
        model: resWithMeta.model,
        responseTimeMs: duration
      };
    }

    const errData = await res.json().catch(() => ({ error: res.statusText }));
    console.warn("[generateRandomWordsService] Server returned error, attempting client-side LLM auto mode fallback...", res.status, errData);
    const resWithMeta = await callLLMClientSideWithMeta(prompt, systemInstruction, schemaDesc, llmConfig);
    const parsed = JSON.parse(resWithMeta.text);
    const duration = resWithMeta.responseTimeMs || Math.round(performance.now() - startTime);
    if (resWithMeta.provider && resWithMeta.model) {
      recordModelResponse(resWithMeta.provider, resWithMeta.model, duration);
    }
    return {
      ...parsed,
      provider: resWithMeta.provider,
      model: resWithMeta.model,
      responseTimeMs: duration
    };
  } catch (err: any) {
    console.warn("[generateRandomWordsService] Server call failed, attempting client-side LLM auto mode fallback...", err?.message || err);
    try {
      const resWithMeta = await callLLMClientSideWithMeta(prompt, systemInstruction, schemaDesc, llmConfig);
      const parsed = JSON.parse(resWithMeta.text);
      const duration = resWithMeta.responseTimeMs || Math.round(performance.now() - startTime);
      if (resWithMeta.provider && resWithMeta.model) {
        recordModelResponse(resWithMeta.provider, resWithMeta.model, duration);
      }
      return {
        ...parsed,
        provider: resWithMeta.provider,
        model: resWithMeta.model,
        responseTimeMs: duration
      };
    } catch (clientErr) {
      throw err;
    }
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
  provider?: string;
  model?: string;
  responseTimeMs?: number;
  vocabularyCandidates: {
    word: string;
    reason: string;
  }[];
}

export async function fixGrammarService(params: FixGrammarRequest): Promise<FixGrammarResult> {
  const { userText, targetLanguage, nativeLanguage, llmConfig } = params;
  const userTarget = targetLanguage || "English";
  const userNative = nativeLanguage || "Vietnamese";
  const startTime = performance.now();

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
  PRIORITY RULE: If the user's input contains misspelled words, prioritize those first as vocabulary candidates.
  - For misspelled candidates, set "word" to the corrected form in "${userTarget}" and mention the original misspelling in "reason".
  - If there are multiple misspellings, rank them before other candidate words.
   For each candidate, provide:
   - "word": string (the target language word or expression)
   - "reason": string (a short, clear 1-line reason why this word/expression is a great candidate to add to their vocabulary collection)
`;

  const systemInstruction = `You are a friendly, natural AI Language Coach. Fix grammar & spelling with a casual tone and suggest candidate vocabulary words for the user's collection. Output strictly valid JSON-only output matching the schema when requested. Do not include any conversational filler outside the JSON.`;
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
    const resWithMeta = await callLLMClientSideWithMeta(prompt, systemInstruction, schemaDesc, llmConfig);
    const parsed = JSON.parse(resWithMeta.text);
    const duration = resWithMeta.responseTimeMs || Math.round(performance.now() - startTime);
    if (resWithMeta.provider && resWithMeta.model) {
      recordModelResponse(resWithMeta.provider, resWithMeta.model, duration);
    }
    return {
      ...parsed,
      provider: resWithMeta.provider,
      model: resWithMeta.model,
      responseTimeMs: duration
    };
  }

  try {
    const res = await fetchWithTimeout("/api/fix-grammar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userText, targetLanguage: userTarget, nativeLanguage: userNative, llmConfig })
    });

    if (res.ok) {
      const data = await res.json();
      const duration = data.responseTimeMs || Math.round(performance.now() - startTime);
      const prov = data.provider || llmConfig?.provider || "gemini";
      const mod = data.model || sanitizeModel(llmConfig?.provider || "gemini", llmConfig?.model);
      if (prov && mod) {
        recordModelResponse(prov, mod, duration);
      }
      return {
        ...data,
        provider: prov,
        model: mod,
        responseTimeMs: duration
      };
    }

    if (res.status === 405 || res.status === 404) {
      const resWithMeta = await callLLMClientSideWithMeta(prompt, systemInstruction, schemaDesc, llmConfig);
      const parsed = JSON.parse(resWithMeta.text);
      const duration = resWithMeta.responseTimeMs || Math.round(performance.now() - startTime);
      if (resWithMeta.provider && resWithMeta.model) {
        recordModelResponse(resWithMeta.provider, resWithMeta.model, duration);
      }
      return {
        ...parsed,
        provider: resWithMeta.provider,
        model: resWithMeta.model,
        responseTimeMs: duration
      };
    }

    const errData = await res.json().catch(() => ({ error: res.statusText }));
    console.warn("[fixGrammarService] Server returned error, attempting client-side LLM auto mode fallback...", res.status, errData);
    const resWithMeta = await callLLMClientSideWithMeta(prompt, systemInstruction, schemaDesc, llmConfig);
    const parsed = JSON.parse(resWithMeta.text);
    const duration = resWithMeta.responseTimeMs || Math.round(performance.now() - startTime);
    if (resWithMeta.provider && resWithMeta.model) {
      recordModelResponse(resWithMeta.provider, resWithMeta.model, duration);
    }
    return {
      ...parsed,
      provider: resWithMeta.provider,
      model: resWithMeta.model,
      responseTimeMs: duration
    };
  } catch (err: any) {
    console.warn("[fixGrammarService] Server call failed, attempting client-side LLM auto mode fallback...", err?.message || err);
    try {
      const resWithMeta = await callLLMClientSideWithMeta(prompt, systemInstruction, schemaDesc, llmConfig);
      const parsed = JSON.parse(resWithMeta.text);
      const duration = resWithMeta.responseTimeMs || Math.round(performance.now() - startTime);
      if (resWithMeta.provider && resWithMeta.model) {
        recordModelResponse(resWithMeta.provider, resWithMeta.model, duration);
      }
      return {
        ...parsed,
        provider: resWithMeta.provider,
        model: resWithMeta.model,
        responseTimeMs: duration
      };
    } catch (clientErr) {
      throw err;
    }
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
  provider?: string;
  model?: string;
  responseTimeMs?: number;
}

export function normalizePerformanceAnalysis(raw: any): PerformanceAnalysisResult {
  if (!raw || typeof raw !== "object") {
    return {
      overallAssessment: "Great progress on your vocabulary learning journey! Keep practicing regularly to strengthen retention.",
      strengthsSummary: "Building consistency across studied terms and flashcard reviews.",
      weaknessesSummary: "Focus on lower strength terms and newly added words.",
      actionableTips: ["Review weak terms daily", "Take quick practice quizzes", "Use spaced repetition"],
      recommendedFocusTopics: ["Core Vocabulary"],
      motivationQuote: "Consistency in practice builds lasting language fluency."
    };
  }

  let overallAssessment = 
    raw.overallAssessment ||
    raw.overall_assessment ||
    raw.coach_note ||
    raw.coachNote ||
    raw.summary ||
    raw.overview ||
    raw.assessment ||
    "";

  if (!overallAssessment && raw.analytics_summary) {
    const s = raw.analytics_summary;
    overallAssessment = typeof s === "string" ? s : `Student level: ${s.student_level || "Active Learner"}. Streak: ${s.active_streak_days || 0} days. Quizzes completed: ${s.quizzes_completed || 0}.`;
  }

  let strengthsSummary = "";
  if (typeof raw.strengthsSummary === "string" && raw.strengthsSummary) {
    strengthsSummary = raw.strengthsSummary;
  } else if (typeof raw.strengths_summary === "string" && raw.strengths_summary) {
    strengthsSummary = raw.strengths_summary;
  } else if (Array.isArray(raw.strengths)) {
    strengthsSummary = raw.strengths.join(" ");
  } else if (raw.performance_insights && Array.isArray(raw.performance_insights.strengths)) {
    strengthsSummary = raw.performance_insights.strengths.join(" ");
  } else if (raw.performance_insights && typeof raw.performance_insights.strengths === "string") {
    strengthsSummary = raw.performance_insights.strengths;
  } else if (Array.isArray(raw.key_strengths)) {
    strengthsSummary = raw.key_strengths.join(" ");
  }

  let weaknessesSummary = "";
  if (typeof raw.weaknessesSummary === "string" && raw.weaknessesSummary) {
    weaknessesSummary = raw.weaknessesSummary;
  } else if (typeof raw.weaknesses_summary === "string" && raw.weaknesses_summary) {
    weaknessesSummary = raw.weaknesses_summary;
  } else if (Array.isArray(raw.weaknesses)) {
    weaknessesSummary = raw.weaknesses.join(" ");
  } else if (Array.isArray(raw.areas_for_growth)) {
    weaknessesSummary = raw.areas_for_growth.join(" ");
  } else if (raw.performance_insights && Array.isArray(raw.performance_insights.areas_for_growth)) {
    weaknessesSummary = raw.performance_insights.areas_for_growth.join(" ");
  } else if (raw.performance_insights && Array.isArray(raw.performance_insights.weaknesses)) {
    weaknessesSummary = raw.performance_insights.weaknesses.join(" ");
  } else if (raw.performance_insights && typeof raw.performance_insights.areas_for_growth === "string") {
    weaknessesSummary = raw.performance_insights.areas_for_growth;
  }

  let actionableTips: string[] = [];
  const tipsRaw = raw.actionableTips || raw.actionable_tips || raw.actionable_next_steps || raw.retention_strategies || raw.tips || raw.strategies;
  if (Array.isArray(tipsRaw)) {
    actionableTips = tipsRaw.map((item: any) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object") {
        return item.description ? `${item.strategy_name ? item.strategy_name + ": " : ""}${item.description}` : (item.text || item.tip || JSON.stringify(item));
      }
      return String(item);
    });
  }

  let recommendedFocusTopics: string[] = [];
  const topicsRaw = raw.recommendedFocusTopics || raw.recommended_focus_topics || raw.focus_topics || raw.suggested_topics || raw.recommended_topics || raw.topics;
  if (Array.isArray(topicsRaw)) {
    recommendedFocusTopics = topicsRaw.map((t: any) => typeof t === "string" ? t : (t.name || t.topic || String(t)));
  }

  let motivationQuote = raw.motivationQuote || raw.motivation_quote || raw.quote || raw.motivational_quote || "";

  return {
    overallAssessment: overallAssessment || "Your vocabulary practice shows steady progress and active momentum.",
    strengthsSummary: strengthsSummary || "Demonstrating solid recall on core vocabulary terms.",
    weaknessesSummary: weaknessesSummary || "Focus on terms with lower strength scores and terms needing review.",
    actionableTips: actionableTips.length > 0 ? actionableTips : ["Review weak terms daily", "Practice with active quizzes", "Focus on spaced repetition"],
    recommendedFocusTopics: recommendedFocusTopics.length > 0 ? recommendedFocusTopics : ["Core Vocabulary"],
    motivationQuote: motivationQuote || "Consistency in practice builds lasting language fluency.",
    provider: raw.provider,
    model: raw.model,
    responseTimeMs: raw.responseTimeMs
  };
}

export async function analyzePerformanceService(params: PerformanceAnalysisRequest): Promise<PerformanceAnalysisResult> {
  const { stats, totalWords, masteredWords = [], improvingWords = [], llmConfig } = params;
  const startTime = performance.now();

  const masteredSampleStr = (masteredWords || []).slice(0, 15).map((w: any) => `${w.word} (${w.translation || w.definition})`).join(", ") || "None yet";
  const improvingSampleStr = (improvingWords || []).slice(0, 15).map((w: any) => `${w.word} (strength ${w.strength ?? 0}/100, ${w.translation || w.definition})`).join(", ") || "None yet";

  const prompt = `You are an elite AI Language Learning Coach & Vocabulary Analyst. Analyze the following student performance data and provide a personalized, deeply insightful analytics report.

STUDENT PERFORMANCE DATA:
- Total Vocabulary Words in Collection: ${totalWords || 0}
- Total Words Mastered: ${(masteredWords || []).length}
- Total Words Studied/Reviewed: ${(masteredWords || []).length + (improvingWords || []).filter((w: any) => w.lastReviewed !== null || (w.strength ?? 0) > 0).length}
- Quizzes Completed: ${stats?.totalQuizzesTaken || 0}
- Correct Answers in Quizzes: ${stats?.totalCorrectAnswers || 0}
- Active Study Streak: ${stats?.streak?.count || 0} days

SAMPLE MASTERED WORDS:
${masteredSampleStr}

SAMPLE WORDS NEEDING IMPROVEMENT:
${improvingSampleStr}

Provide a structured AI analysis with constructive insights, memory retention strategies, and actionable guidance for the learner.`;

  const systemInstruction = `You are an encouraging, expert AI vocabulary coach. Output strictly valid JSON-only analytics matching the schema below. CRITICAL: Use the exact JSON field names specified in schemaDesc. Do not include any conversational filler outside the JSON.`;
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
    const resWithMeta = await callLLMClientSideWithMeta(prompt, systemInstruction, schemaDesc, llmConfig);
    const parsedRaw = JSON.parse(resWithMeta.text);
    const result = normalizePerformanceAnalysis(parsedRaw);
    const duration = resWithMeta.responseTimeMs || Math.round(performance.now() - startTime);
    if (resWithMeta.provider && resWithMeta.model) {
      recordModelResponse(resWithMeta.provider, resWithMeta.model, duration);
    }
    return {
      ...result,
      provider: resWithMeta.provider,
      model: resWithMeta.model,
      responseTimeMs: duration
    };
  }

  try {
    const res = await fetchWithTimeout("/api/analyze-performance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stats, totalWords, masteredWords, improvingWords, llmConfig })
    });

    if (res.ok) {
      const rawJson = await res.json();
      const result = normalizePerformanceAnalysis(rawJson);
      const duration = rawJson.responseTimeMs || Math.round(performance.now() - startTime);
      const prov = rawJson.provider || llmConfig?.provider || "gemini";
      const mod = rawJson.model || sanitizeModel(llmConfig?.provider || "gemini", llmConfig?.model);
      if (prov && mod) {
        recordModelResponse(prov, mod, duration);
      }
      return {
        ...result,
        provider: prov,
        model: mod,
        responseTimeMs: duration
      };
    }

    if (res.status === 405 || res.status === 404) {
      const resWithMeta = await callLLMClientSideWithMeta(prompt, systemInstruction, schemaDesc, llmConfig);
      const parsedRaw = JSON.parse(resWithMeta.text);
      const result = normalizePerformanceAnalysis(parsedRaw);
      const duration = resWithMeta.responseTimeMs || Math.round(performance.now() - startTime);
      if (resWithMeta.provider && resWithMeta.model) {
        recordModelResponse(resWithMeta.provider, resWithMeta.model, duration);
      }
      return {
        ...result,
        provider: resWithMeta.provider,
        model: resWithMeta.model,
        responseTimeMs: duration
      };
    }

    const errData = await res.json().catch(() => ({ error: res.statusText }));
    console.warn("[analyzePerformanceService] Server returned error, attempting client-side LLM auto mode fallback...", res.status, errData);
    const resWithMeta = await callLLMClientSideWithMeta(prompt, systemInstruction, schemaDesc, llmConfig);
    const parsedRaw = JSON.parse(resWithMeta.text);
    const result = normalizePerformanceAnalysis(parsedRaw);
    const duration = resWithMeta.responseTimeMs || Math.round(performance.now() - startTime);
    if (resWithMeta.provider && resWithMeta.model) {
      recordModelResponse(resWithMeta.provider, resWithMeta.model, duration);
    }
    return {
      ...result,
      provider: resWithMeta.provider,
      model: resWithMeta.model,
      responseTimeMs: duration
    };
  } catch (err: any) {
    console.warn("[analyzePerformanceService] Server call failed, attempting client-side LLM auto mode fallback...", err?.message || err);
    try {
      const resWithMeta = await callLLMClientSideWithMeta(prompt, systemInstruction, schemaDesc, llmConfig);
      const parsedRaw = JSON.parse(resWithMeta.text);
      const result = normalizePerformanceAnalysis(parsedRaw);
      const duration = resWithMeta.responseTimeMs || Math.round(performance.now() - startTime);
      if (resWithMeta.provider && resWithMeta.model) {
        recordModelResponse(resWithMeta.provider, resWithMeta.model, duration);
      }
      return {
        ...result,
        provider: resWithMeta.provider,
        model: resWithMeta.model,
        responseTimeMs: duration
      };
    } catch (clientErr) {
      throw err;
    }
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
  provider?: string;
  model?: string;
  responseTimeMs?: number;
}

export async function sendChatMessageService(params: ChatMessageRequest): Promise<ChatMessageResult> {
  const { messages, targetLanguage, nativeLanguage, llmConfig } = params;
  const startTime = performance.now();

  const chatHistoryStr = messages
    .slice(-10)
    .map((m: any) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n");

  const prompt = `Below is the recent conversation history between the User and you (the Assistant):\n\n${chatHistoryStr}\n\nAssistant, formulate your next helpful response. Ensure to check if the user is interested in practicing or adding words, and attach appropriate suggestedActions.`;

  const systemInstruction = `You are an elite, highly encouraging AI Language Coach and Vocabulary Assistant.
Your mission is to help the user master their target language "${targetLanguage}" from their native language "${nativeLanguage}".
You speak in a warm, welcoming, and linguistically precise tone.

CRITICAL INTERACTIVE CONVERSATION GUIDELINES:
1. **Explain Grammar Rules**:
   - When the user asks to learn or explain grammar rules (or clicks "Explain Grammar Rules"):
     * Do NOT dump a massive wall of unrequested text immediately.
     * Ask the user naturally in their native language ("${nativeLanguage}") which specific grammar rule or sentence structure they would like to explore today.
     * Give a few clear, concrete examples (e.g., Past Tense vs Present Perfect, Subjunctive Mood, Prepositions & Word Order, Passive Voice).
     * Provide 3 to 4 interactive options in "suggestedActions" with action "send_message" so the user can click to select a topic or type their own!
   - When the user specifies a grammar rule:
     * Explain it clearly in their native language ("${nativeLanguage}"), with clear example sentences in "${targetLanguage}" and translations in "${nativeLanguage}".
     * Highlight key vocabulary words or phrases in the explanation and attach "add_word" suggestedActions for those words!

2. **Translate & Compare**:
   - When the user asks to translate & compare (or clicks "Translate & Compare"):
     * Ask the user what sentence, phrase, or context they would like to translate and contrast between "${nativeLanguage}" and "${targetLanguage}".
     * Give 3 to 4 concrete example scenario options in "suggestedActions" (e.g., "Polite Requests & Ordering Coffee", "Expressing Opinions & Disagreeing", "Formal vs Casual Greetings").
   - When the user provides a sentence or scenario to compare:
     * Present side-by-side comparisons showing literal translation vs. natural/idiomatic translation in "${targetLanguage}".
     * Explain tone, nuance, and cultural context.

3. **Common Phrases & Idioms**:
   - When the user asks for common phrases or idioms (or clicks "Common Phrases"):
     * Ask the user which real-world scenario or topic they want to cover (e.g., Dining Out, Travel & Airports, Workplace Small Talk, Expressing Emotions).
     * Provide 3 to 4 topic options in "suggestedActions".
   - When a topic is chosen:
     * Provide 4-6 essential, practical expressions/idioms with target language text, IPA pronunciation, native translation, and usage notes.
     * Include "add_word" suggestedActions so the user can easily save useful phrases to their collection!

4. **Interactive Language Coach (Consolidated Action)**:
   - When the user initiates the interactive language coach:
     * Offer 3 clear paths in "suggestedActions": "Explain Grammar Rules (in ${nativeLanguage})", "Translate & Compare Nuances", and "Common Phrases & Idioms".

5. **Ambiguous or Unclear User Input**:
   - If the user's message is vague, ambiguous, or incomplete (e.g., just typing "grammar", "rule", "translate", or an unclear fragment):
     * Kindly ask the user to clarify or confirm what specific topic, phrase, or sentence they would like to focus on before providing a full explanation. Provide helpful choices in "suggestedActions"!

6. **General Rules**:
   - Answer questions about grammar, translation, and pronunciation clearly and encouragingly.
   - If you introduce a valuable vocabulary word or expression, include an "add_word" action in suggestedActions.
   - If the user wants to practice flashcards or take a test, include a "start_quiz" action in suggestedActions.
   - You MUST strictly output valid JSON-only output matching the schema below.
   - Do not include any conversational filler outside the JSON.`;

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
    const resWithMeta = await callLLMClientSideWithMeta(prompt, systemInstruction, schemaDesc, llmConfig);
    const parsed = JSON.parse(resWithMeta.text);
    const endTime = performance.now();
    const duration = resWithMeta.responseTimeMs || Math.round(endTime - startTime);
    const result = {
      ...parsed,
      provider: resWithMeta.provider,
      model: resWithMeta.model,
      responseTimeMs: duration
    };
    if (result.provider && result.model && result.responseTimeMs) {
      recordModelResponse(result.provider, result.model, result.responseTimeMs);
    }
    return result;
  }

  try {
    const res = await fetchWithTimeout("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, targetLanguage, nativeLanguage, llmConfig })
    });

    if (res.ok) {
      const data = await res.json();
      const endTime = performance.now();
      const duration = data.responseTimeMs || Math.round(endTime - startTime);
      const prov = data.provider || llmConfig?.provider || "gemini";
      const mod = data.model || sanitizeModel(llmConfig?.provider || "gemini", llmConfig?.model);
      const result = {
        ...data,
        provider: prov,
        model: mod,
        responseTimeMs: duration
      };
      if (prov && mod && duration) {
        recordModelResponse(prov, mod, duration);
      }
      return result;
    }

    if (res.status === 405 || res.status === 404) {
      const resWithMeta = await callLLMClientSideWithMeta(prompt, systemInstruction, schemaDesc, llmConfig);
      const parsed = JSON.parse(resWithMeta.text);
      const endTime = performance.now();
      const duration = resWithMeta.responseTimeMs || Math.round(endTime - startTime);
      const result = {
        ...parsed,
        provider: resWithMeta.provider,
        model: resWithMeta.model,
        responseTimeMs: duration
      };
      if (result.provider && result.model && result.responseTimeMs) {
        recordModelResponse(result.provider, result.model, result.responseTimeMs);
      }
      return result;
    }

    const errData = await res.json().catch(() => ({ error: res.statusText }));
    console.warn("[sendChatMessageService] Server returned error, attempting client-side LLM auto mode fallback...", res.status, errData);
    const resWithMeta = await callLLMClientSideWithMeta(prompt, systemInstruction, schemaDesc, llmConfig);
    const parsed = JSON.parse(resWithMeta.text);
    const endTime = performance.now();
    const duration = resWithMeta.responseTimeMs || Math.round(endTime - startTime);
    const result = {
      ...parsed,
      provider: resWithMeta.provider,
      model: resWithMeta.model,
      responseTimeMs: duration
    };
    if (result.provider && result.model && result.responseTimeMs) {
      recordModelResponse(result.provider, result.model, result.responseTimeMs);
    }
    return result;
  } catch (err: any) {
    console.warn("[sendChatMessageService] Server call failed, attempting client-side LLM auto mode fallback...", err?.message || err);
    try {
      const resWithMeta = await callLLMClientSideWithMeta(prompt, systemInstruction, schemaDesc, llmConfig);
      const parsed = JSON.parse(resWithMeta.text);
      const endTime = performance.now();
      const duration = resWithMeta.responseTimeMs || Math.round(endTime - startTime);
      const result = {
        ...parsed,
        provider: resWithMeta.provider,
        model: resWithMeta.model,
        responseTimeMs: duration
      };
      if (result.provider && result.model && result.responseTimeMs) {
        recordModelResponse(result.provider, result.model, result.responseTimeMs);
      }
      return result;
    } catch (clientErr) {
      throw err;
    }
  }
}

export interface QuizGenerationRequest {
  words: Word[];
  targetLanguage?: string;
  nativeLanguage?: string;
  llmConfig?: LLMConfig;
  stats?: UserStats;
}

export interface QuizGenerationResult {
  questions: QuizQuestion[];
  provider?: string;
  model?: string;
  responseTimeMs?: number;
}

export async function generateAiQuizQuestionsService(
  params: QuizGenerationRequest
): Promise<QuizGenerationResult> {
  const { words, targetLanguage = "English", nativeLanguage = "Vietnamese", llmConfig, stats } = params;
  const startTime = performance.now();

  if (!words || words.length === 0) {
    return { questions: [] };
  }

  const fallbackQuestions = generateQuizQuestions(words, targetLanguage);

  if (!llmConfig || !llmConfig.isLoggedIn) {
    return { questions: fallbackQuestions };
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
      strength: w.strength ?? 0, // 0 to 100
      learned: Boolean(w.learned),
      starred: Boolean(w.starred),
      daysSinceLastReview: daysSinceReview,
      lastReviewed: w.lastReviewed ? `${daysSinceReview} day(s) ago` : "Never reviewed",
      memoryStatus: daysSinceReview >= 5 ? "Needs Refresher (Memory Decay / Overdue)" : w.strength >= 80 ? "Mastered / Strong" : "Learning / Developing"
    };
  });

  const accuracyPercent = stats && stats.totalQuizzesTaken > 0
    ? `${Math.round((stats.totalCorrectAnswers / Math.max(1, stats.totalQuizzesTaken * 5)) * 100)}%`
    : stats && stats.totalCorrectAnswers > 0
    ? `${stats.totalCorrectAnswers} total correct answers`
    : "New learner";

  const totalMasteredFromWords = (words || []).filter((w: any) => w.learned || (w.strength ?? 0) >= 80).length;
  const totalStudiedFromWords = (words || []).filter((w: any) => w.lastReviewed !== null || (w.strength ?? 0) > 0).length;

  const usefulStatsSummary = stats ? {
    activeStreakDays: stats.streak?.count || 0,
    totalWordsMastered: totalMasteredFromWords,
    totalWordsStudied: totalStudiedFromWords,
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
   - Use each word's mastery stats (strength 0-100, daysSinceLastReview, memoryStatus, starred, learned) and overall stats (streak, accuracy, mastered count) to customize question difficulty:
     * Memory Decay / Overdue Words (daysSinceLastReview >= 5, or recalculated strength): The student may have forgotten this word since it hasn't been reviewed in a while. Generate targeted context fill-in-the-blank or usage questions with challenging distractors to test active memory recall.
     * Weak / New Words (strength < 50, never reviewed): Generate foundational questions (e.g. direct definition matching or simple supportive sentences) with helpful hints to reinforce basic recall.
     * Starred / Priority Words: Focus on practical usage and clear context sentences to solidify active vocabulary.
     * High Strength / Recently Reviewed Words (strength >= 80): Challenge the learner with nuanced context or subtle distractor choices to ensure long-term mastery.
4. Question Types (mix across questions):
   - 'definition': "Which word matches the following definition?\n'[definition in ${targetLanguage}]'"
   - 'sentence': "Fill in the blank for the sentence:\n'[sentence in ${targetLanguage} tailored strictly to the word's category/context with target word replaced by ______]'"
   - 'listening': "Listen to the audio clip and select the correct matching word:" (options contain phonetically/morphologically similar words)
  - 'picture': "Which word matches the visual concept shown below?" (set imageKeyword to 3-5 word comma-free search term capturing the visual concept of the word with relevance context and category for image search)
5. Context & Category Alignment:
   - Each word provided contains its stored 'category' and 'context'. You MUST tailor sentence blanks, definitions, and picture descriptions specifically around the word's given category and context scenario.
6. MANDATORY PICTURE/IMAGE QUESTION REQUIREMENT:
   - At least ONE question in the generated quiz MUST be a picture or image-based question ('type': 'picture').
  - For picture questions, set question to "Which word matches the visual concept shown below?" and set 'imageKeyword' to a 3-5 word comma-free search term capturing the visual concept of the word with relevance context and category for image search.

7. Output Schema:
Return strictly valid JSON-only output when requested matching this schema. Do not include any conversational filler outside the JSON:
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
    "imageKeyword": "string (ONE single comma-free search term for picture questions, directly relevant to the word's context and category)"
  }
]`;

  const prompt = `Generate 1 quiz question for each of these vocabulary words, adapting question depth and distractors according to the provided word stats and learner progress stats.

CRITICAL MANDATORY REQUIREMENT: Ensure at least ONE question in the generated quiz MUST be a picture or image-based question ('type': 'picture') with an 'imageKeyword' that is a 3-5 word comma-free search term capturing the visual concept of the word with relevance context and category for image search.\n\n` +
    (usefulStatsSummary ? `Learner Progress Stats:\n${JSON.stringify(usefulStatsSummary, null, 2)}\n\n` : "") +
    `Vocabulary Words with Word Mastery Stats:\n${JSON.stringify(wordDataSummary, null, 2)}`;

  const schemaDesc = `Array of QuizQuestion objects with id, wordId, word, type, question, options, correctAnswer, hint, imageKeyword (3-5 word comma-free search term capturing the visual concept of the word with relevance context and category for image search).`;

  let provider = llmConfig?.provider || "gemini";
  let model = sanitizeModel(provider, llmConfig?.model);
  let responseTimeMs: number | undefined = undefined;

  try {
    let rawQuestions: any[] = [];
    if (isStaticHost()) {
      const resWithMeta = await callLLMClientSideWithMeta(prompt, systemInstruction, schemaDesc, llmConfig);
      const cleaned = cleanJsonResponse(resWithMeta.text);
      rawQuestions = JSON.parse(cleaned);
      provider = resWithMeta.provider;
      model = resWithMeta.model;
      responseTimeMs = resWithMeta.responseTimeMs || Math.round(performance.now() - startTime);
    } else {
      const res = await fetchWithTimeout("/api/generate-quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ words, stats, targetLanguage, nativeLanguage, llmConfig })
      });
      if (res.ok) {
        const data = await res.json();
        const endTime = performance.now();
        responseTimeMs = Math.round(endTime - startTime);
        if (Array.isArray(data)) {
          rawQuestions = data;
        } else if (data && typeof data === "object") {
          rawQuestions = data.questions || [];
          if (data.provider) provider = data.provider;
          if (data.model) model = data.model;
          if (data.responseTimeMs) responseTimeMs = data.responseTimeMs;
        }
      } else {
        const resWithMeta = await callLLMClientSideWithMeta(prompt, systemInstruction, schemaDesc, llmConfig);
        const cleaned = cleanJsonResponse(resWithMeta.text);
        rawQuestions = JSON.parse(cleaned);
        provider = resWithMeta.provider;
        model = resWithMeta.model;
        responseTimeMs = resWithMeta.responseTimeMs || Math.round(performance.now() - startTime);
      }
    }

    if (Array.isArray(rawQuestions) && rawQuestions.length > 0) {
      const validQuestions: QuizQuestion[] = rawQuestions.map((q: any, idx: number) => {
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

        const keywordText = q.imageKeyword || (q.type === 'picture' ? getImageKeyword(matchingWord) : undefined);
        const imgUrl = q.imageUrl && q.imageUrl.startsWith("http") ? q.imageUrl : (keywordText ? `https://image.nclong87.workers.dev?query=${encodeURIComponent(keywordText)}` : undefined);

        return {
          id: q.id || `ai-q-${matchingWord.id}-${idx}`,
          wordId: matchingWord.id,
          word: matchingWord.word,
          type: q.type || 'definition',
          question: q.question || `Which word matches: ${matchingWord.definition}`,
          options: options.sort(() => 0.5 - Math.random()),
          correctAnswer: q.correctAnswer || matchingWord.word,
          hint: q.hint || matchingWord.pronunciation,
          imageKeyword: keywordText,
          imageUrl: imgUrl
        };
      });

      // Guarantee at least one picture or image-based question in the generated quiz
      const hasPictureQuestion = validQuestions.some(q => q.type === 'picture');
      if (!hasPictureQuestion && validQuestions.length > 0) {
        const targetQ = validQuestions[0];
        const matchingWord = words.find(w => w.id === targetQ.wordId || w.word.toLowerCase() === targetQ.word.toLowerCase()) || words[0];
        targetQ.type = 'picture';
        targetQ.question = "Which word matches the visual concept shown below?";
        targetQ.imageKeyword = getImageKeyword(matchingWord);
        targetQ.imageUrl = `https://image.nclong87.workers.dev?query=${encodeURIComponent(targetQ.imageKeyword)}`;
      }

      if (provider && model && responseTimeMs) {
        recordModelResponse(provider, model, responseTimeMs);
      }

      return {
        questions: validQuestions,
        provider,
        model,
        responseTimeMs
      };
    }
  } catch (err: any) {
    console.warn("AI Quiz Generation failed:", err);
    if (llmConfig && llmConfig.isLoggedIn) {
      throw err;
    }
  }

  return { questions: fallbackQuestions };
}

/**
 * Service to analyze image for vocabulary using Cloudflare worker and Gemini Vision fallback
 */
export async function analyzeImageVocabService(params: {
  imageDataUrl: string;
  customPrompt?: string;
  targetLanguage: string;
  nativeLanguage: string;
  llmConfig?: LLMConfig;
}): Promise<{
  imageDescription: string;
  vocabularyItems: Array<{
    word: string;
    translation: string;
    partOfSpeech?: string;
    pronunciation?: string;
    definition: string;
    example?: string;
    exampleTranslation?: string;
    category?: string;
    context?: string;
  }>;
  provider?: string;
  model?: string;
  responseTimeMs?: number;
}> {
  const startTime = performance.now();
  let { imageDataUrl, customPrompt, targetLanguage, nativeLanguage, llmConfig } = params;

  // Resize client-side before sending to server or worker if image is large
  if (typeof window !== "undefined" && imageDataUrl && imageDataUrl.startsWith("data:image")) {
    try {
      imageDataUrl = await resizeImageDataUrl(imageDataUrl, 1600, 0.85);
    } catch (resizeErr) {
      console.warn("Client side image resize warning:", resizeErr);
    }
  }

  let serverOrWorkerError: any = null;

  // 1. Attempt call through Node server API route if not running on static host
  if (!isStaticHost()) {
    try {
      const res = await fetchWithTimeout("/api/analyze-image-vocab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageDataUrl, customPrompt, targetLanguage, nativeLanguage, llmConfig })
      });
      if (res.ok) {
        const data = await res.json();
        return {
          ...data,
          provider: data.provider || llmConfig?.provider || "gemini",
          model: data.model || sanitizeModel(llmConfig?.provider || "gemini", llmConfig?.model),
          responseTimeMs: data.responseTimeMs || Math.round(performance.now() - startTime)
        };
      }
      const errorJson = await res.json().catch(() => null);
      if (errorJson?.error) {
        serverOrWorkerError = new Error(errorJson.error);
      }
    } catch (e: any) {
      console.warn("Server API analyze-image-vocab failed, falling back to direct worker/Gemini:", e);
      serverOrWorkerError = e;
    }
  }

  // 2. Direct client-side call to Cloudflare Worker
  let base64Data = imageDataUrl;
  if (imageDataUrl.startsWith("data:")) {
    const parts = imageDataUrl.split(";base64,");
    base64Data = parts[1] || imageDataUrl;
  }

  const sharedProxyKey = llmConfig?.proxyKey ||
    (llmConfig?.savedProviders ? (Object.values(llmConfig.savedProviders) as any[]).find((p: any) => Boolean(p?.proxyKey))?.proxyKey : "") ||
    llmConfig?.apiKey ||
    "";

  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };

  if (sharedProxyKey) {
    headers["X-Proxy-Key"] = sharedProxyKey;
  }

  const systemPrompt =
    "You are a Multilingual Computer Vision & AI Language Pedagogy Engine. You analyze photographs and visual media to extract relevant vocabulary for language learners. Output strictly valid JSON-only output when requested. Do not include any conversational filler outside the JSON.\n" +
    "Output MUST be strictly valid raw JSON-only matching:\n" +
    "{\n" +
    '  "imageDescription": "string",\n' +
    '  "vocabularyItems": [\n' +
    "    {\n" +
    '      "word": "string",\n' +
    '      "translation": "string",\n' +
    '      "partOfSpeech": "string",\n' +
    '      "pronunciation": "string",\n' +
    '      "definition": "string",\n' +
    '      "example": "string",\n' +
    '      "exampleTranslation": "string",\n' +
    '      "category": "string",\n' +
    '      "context": "string"\n' +
    "    }\n" +
    "  ]\n" +
    "}";

  const userText = `Analyze this image for vocabulary learning in "${targetLanguage}" for a native "${nativeLanguage}" speaker.\nIdentify key objects, text, signs, items, actions, or scenes present in the image`;

  const workerRes = await fetchWithTimeout("https://image-analysis.nclong87.workers.dev/", {
    method: "POST",
    headers,
    body: JSON.stringify({
      nativeLanguage,
      targetLanguage,
      imageData: base64Data,
      customPrompt,
      systemPrompt,
      userText
    })
  });

  if (workerRes.ok) {
    const rawText = await workerRes.text();
    let data;
    try {
      data = JSON.parse(rawText);
    } catch {
      const cleaned = cleanJsonResponse(rawText);
      data = JSON.parse(cleaned);
    }
    if (data && (data.vocabularyItems || data.imageDescription)) {
      const duration = data.responseTimeMs || Math.round(performance.now() - startTime);
      const prov = data.provider || "";
      const mod = data.model || "";
      recordModelResponse(prov, mod, duration);
      return {
        ...data,
        provider: prov,
        model: mod,
        responseTimeMs: duration
      };
    }
  } else {
    const errText = await workerRes.text().catch(() => workerRes.statusText);
    serverOrWorkerError = new Error(`Image Analysis Worker Error (${workerRes.status}): ${errText}`);
  }
  
  throw serverOrWorkerError || new Error("Image analysis failed without a specific error.");
}

export interface FlashcardGenerationRequest {
  word: Word;
  targetLanguage?: string;
  nativeLanguage?: string;
  llmConfig?: LLMConfig;
}

export interface GeneratedFlashcardContent {
  word: string;
  pronunciation?: string;
  partOfSpeech?: string;
  definition: string;
  translation: string;
  category?: string;
  context?: string;
  extraExampleSentences: {
    sentence: string;
    translation: string;
    contextCategoryNote?: string;
  }[];
  usageNotes?: string;
  imageKeyword?: string;
  suggestedVocabulary?: SuggestedVocabularyWord[];
  provider?: string;
  model?: string;
  responseTimeMs?: number;
}

const MAX_EXTRA_EXAMPLE_SENTENCES = 1;
const MAX_SUGGESTED_VOCABULARY = 5;

/**
 * Enforces flashcard content limits regardless of what the model returns.
 * Prompt constraints alone are not reliable, so cap here as well.
 */
function limitFlashcardContent<T extends {
  word?: string;
  extraExampleSentences?: any;
  suggestedVocabulary?: any;
}>(content: T, targetWord?: string): T {
  const sentences = Array.isArray(content.extraExampleSentences) ? content.extraExampleSentences : [];
  const suggestions = Array.isArray(content.suggestedVocabulary) ? content.suggestedVocabulary : [];

  const normalizedTarget = (targetWord || "").trim().toLowerCase();
  const seen = new Set<string>();
  const dedupedSuggestions = suggestions.filter((s: any) => {
    const key = String(s?.word || "").trim().toLowerCase();
    if (!key || key === normalizedTarget || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    ...content,
    extraExampleSentences: sentences.slice(0, MAX_EXTRA_EXAMPLE_SENTENCES),
    suggestedVocabulary: dedupedSuggestions.slice(0, MAX_SUGGESTED_VOCABULARY)
  };
}

export async function generateFlashcardContentService(
  params: FlashcardGenerationRequest
): Promise<GeneratedFlashcardContent> {
  const { word, targetLanguage = "English", nativeLanguage = "Vietnamese", llmConfig } = params;
  const startTime = performance.now();

  const fallbackContent: GeneratedFlashcardContent = {
    word: word.word,
    pronunciation: word.pronunciation,
    partOfSpeech: word.partOfSpeech || "noun",
    definition: word.definition,
    translation: word.translation,
    category: word.category || "General",
    context: word.context || word.definition,
    extraExampleSentences: word.example ? [
      {
        sentence: word.example,
        translation: word.exampleTranslation || word.translation,
        contextCategoryNote: word.category || "Context Example"
      }
    ] : [],
    usageNotes: `Category: ${word.category || "General"}. Context: ${word.context || word.definition}`,
    imageKeyword: word.imageKeyword || word.word,
    suggestedVocabulary: []
  };

  if (!llmConfig || !llmConfig.isLoggedIn) {
    return fallbackContent;
  }

  const systemInstruction = `You are a world-class AI Language Pedagogy Engine creating interactive flash cards for ${targetLanguage} learners (native language: ${nativeLanguage}).
Given a target vocabulary word, its category, context, definition, and user stats, generate rich flashcard study content.

CRITICAL REQUIREMENTS:
1. Provide a refined target language definition in ${targetLanguage}, pronunciation (IPA), and native translation in ${nativeLanguage}.
2. Category & Context Alignment: Identify or refine the word's category (e.g. "Business & Meetings", "Travel & Hospitality", "Everyday Conversation", "Emotions & Mindset") and practical usage context scenario.
3. Extra Example Sentence: Generate EXACTLY 1 EXTRA example sentence in ${targetLanguage} with its native translation in ${nativeLanguage}. The sentence MUST be directly relevant to the word's specific category ("${word.category || "General"}") and context ("${word.context || "Conversational"}"), demonstrating real-world conversational or professional usage. Return it as a single-element array — do not return more than one sentence.
4. Usage Notes: Provide a concise, highly practical note on collocations, tone (formal vs casual), memory hooks, or common nuances.
5. Image Search Keyword: Set imageKeyword to ONE single search term (comma-free) capturing the visual concept of the word.
6. Suggested Related Vocabulary: Identify 3 to 5 COMMON, everyday-frequency words or expressions in ${targetLanguage} that belong to the SAME category ("${word.category || "General"}") and the SAME usage context ("${word.context || "Conversational"}") as the target word. Guidelines:
   - Prioritize high-frequency words a learner would realistically encounter and reuse in this context. Do NOT pick rare, archaic, academic, or overly advanced vocabulary.
   - They must be thematically related to the target word (same topic/scenario), not merely words that happened to appear in the example sentence.
   - Do NOT repeat the target word itself, and do not repeat the same word twice.
   - For each, provide its target-language form ("word"), direct native-language translation ("translation" in ${nativeLanguage}), part of speech ("partOfSpeech"), and a brief definition ("definition" in ${targetLanguage}).
   These will be displayed as suggested actions to allow the user to easily add them to their collection.

Output MUST be strictly valid JSON matching this schema:
{
  "word": "string",
  "pronunciation": "string",
  "partOfSpeech": "string",
  "definition": "string in ${targetLanguage}",
  "translation": "string in ${nativeLanguage}",
  "category": "string",
  "context": "string",
  "extraExampleSentences": [
    {
      "sentence": "string in ${targetLanguage}",
      "translation": "string in ${nativeLanguage}",
      "contextCategoryNote": "string (brief note explaining relevance to context/category)"
    }
  ],
  "usageNotes": "string",
  "imageKeyword": "string (3-5 word comma-free search term capturing the visual concept of the word with relevance context and category for image search)",
  "suggestedVocabulary": [
    {
      "word": "string (common related word/expression in the same category and context)",
      "translation": "string (translation in ${nativeLanguage})",
      "partOfSpeech": "string (e.g. noun, verb, adjective, idiom)",
      "definition": "string (short definition in ${targetLanguage})"
    }
  ]
}

NOTE: "extraExampleSentences" MUST contain EXACTLY 1 item. "suggestedVocabulary" MUST contain 3 to 5 items.`;

  const prompt = `Generate interactive flashcard content for the word:\n` +
    `Word: "${word.word}"\n` +
    `Part of Speech: "${word.partOfSpeech || "unknown"}"\n` +
    `Stored Definition: "${word.definition}"\n` +
    `Stored Translation: "${word.translation}"\n` +
    `Stored Category: "${word.category || "General"}"\n` +
    `Stored Context: "${word.context || word.definition}"\n` +
    `Stored Example: "${word.example || "N/A"}"\n\n` +
    `REMINDERS:\n` +
    `- Return EXACTLY 1 extra example sentence.\n` +
    `- Return 3 to 5 suggestedVocabulary entries that are COMMON words related to the category "${word.category || "General"}" and context "${word.context || "Conversational"}" (not rare or advanced vocabulary, and not the target word itself).`;

  const schemaDesc = `Object containing word, pronunciation, partOfSpeech, definition, translation, category, context, extraExampleSentences (array with EXACTLY 1 item: sentence, translation, contextCategoryNote), usageNotes, imageKeyword, and suggestedVocabulary (3 to 5 common related words in the same category and context, each with word, translation, partOfSpeech, definition).`;

  try {
    let rawResultText = "";
    let metaProvider: string | undefined;
    let metaModel: string | undefined;

    if (isStaticHost()) {
      const resWithMeta = await callLLMClientSideWithMeta(prompt, systemInstruction, schemaDesc, llmConfig);
      rawResultText = resWithMeta.text;
      metaProvider = resWithMeta.provider;
      metaModel = resWithMeta.model;
    } else {
      const res = await fetchWithTimeout("/api/generate-flashcard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ word, targetLanguage, nativeLanguage, llmConfig })
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.word) {
          const duration = data.responseTimeMs || Math.round(performance.now() - startTime);
          const prov = data.provider || llmConfig?.provider || "gemini";
          const mod = data.model || sanitizeModel(llmConfig?.provider || "gemini", llmConfig?.model);
          recordModelResponse(prov, mod, duration);
          return limitFlashcardContent({
            ...data,
            provider: prov,
            model: mod,
            responseTimeMs: duration
          }, word.word);
        }
      } else {
        let errData: any = {};
        try { errData = await res.json(); } catch {}
        const userMsg = errData.error || `HTTP ${res.status} from flashcard generation endpoint`;
        const err: any = new Error(userMsg);
        err.userMessage = userMsg;
        err.statusCode = res.status;
        throw err;
      }
      const resWithMeta = await callLLMClientSideWithMeta(prompt, systemInstruction, schemaDesc, llmConfig);
      rawResultText = resWithMeta.text;
      metaProvider = resWithMeta.provider;
      metaModel = resWithMeta.model;
    }

    const cleaned = cleanJsonResponse(rawResultText);
    const parsed = JSON.parse(cleaned);

    if (parsed && parsed.word) {
      const duration = Math.round(performance.now() - startTime);
      const prov = metaProvider || llmConfig?.provider || "gemini";
      const mod = metaModel || sanitizeModel(llmConfig?.provider || "gemini", llmConfig?.model);
      recordModelResponse(prov, mod, duration);
      return limitFlashcardContent({
        word: parsed.word || word.word,
        pronunciation: parsed.pronunciation || word.pronunciation,
        partOfSpeech: parsed.partOfSpeech || word.partOfSpeech || "noun",
        definition: parsed.definition || word.definition,
        translation: parsed.translation || word.translation,
        category: parsed.category || word.category || "General",
        context: parsed.context || word.context || word.definition,
        extraExampleSentences: Array.isArray(parsed.extraExampleSentences) && parsed.extraExampleSentences.length > 0
          ? parsed.extraExampleSentences
          : fallbackContent.extraExampleSentences,
        usageNotes: parsed.usageNotes || fallbackContent.usageNotes,
        imageKeyword: parsed.imageKeyword || word.imageKeyword || word.word,
        suggestedVocabulary: Array.isArray(parsed.suggestedVocabulary) ? parsed.suggestedVocabulary : [],
        provider: prov,
        model: mod,
        responseTimeMs: duration
      }, word.word);
    }
  } catch (err: any) {
    console.error("AI Flashcard Generation API error:", err);
    if (llmConfig?.provider && llmConfig?.model) {
      lockModel(llmConfig.provider, llmConfig.model, 3600000, err?.message || String(err));
    }
    throw err;
  }

  return fallbackContent;
}

export interface SuggestReplyRequest {
  imageDataUrl: string | null;
  customPrompt: string;
  targetLanguage: string;
  nativeLanguage: string;
  llmConfig?: LLMConfig;
}

export interface SuggestReplyResult {
  suggestedReplies: Array<{
    reply: string;
    translation: string;
    tone: string;
    explanation: string;
  }>;
  vocabularyCandidates: Array<{
    word: string;
    translation: string;
    reason: string;
  }>;
  provider?: string;
  model?: string;
  responseTimeMs?: number;
}

export async function suggestCasualReplyService(params: SuggestReplyRequest): Promise<SuggestReplyResult> {
  const { imageDataUrl, customPrompt, targetLanguage, nativeLanguage, llmConfig } = params;
  const startTime = performance.now();

  const userTarget = targetLanguage || "English";
  const userNative = nativeLanguage || "Vietnamese";

  // 1. Try server API route if not running on static host
  if (!isStaticHost()) {
    try {
      const res = await fetchWithTimeout("/api/suggest-casual-reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageDataUrl, customPrompt, targetLanguage: userTarget, nativeLanguage: userNative, llmConfig })
      });

      if (res.ok) {
        const data = await res.json();
        const duration = data.responseTimeMs || Math.round(performance.now() - startTime);
        const prov = data.provider || llmConfig?.provider || "gemini";
        const mod = data.model || sanitizeModel(llmConfig?.provider || "gemini", llmConfig?.model);
        if (prov && mod) {
          recordModelResponse(prov, mod, duration);
        }
        return {
          ...data,
          provider: prov,
          model: mod,
          responseTimeMs: duration
        };
      }
    } catch (e) {
      console.warn("Server API suggest-casual-reply failed, falling back to direct client-side:", e);
    }
  }

  // 2. Direct client-side Gemini fallback
  const effectiveApiKey = llmConfig?.apiKey;
  const proxyKeyToUse = llmConfig?.proxyKey || (llmConfig?.savedProviders ? (Object.values(llmConfig.savedProviders) as any[]).find((p: any) => Boolean(p?.proxyKey))?.proxyKey : "");

  const ai = new GoogleGenAI({
    apiKey: effectiveApiKey || proxyKeyToUse || "dummy-key",
    httpOptions: { 
      headers: { 
        ...(proxyKeyToUse ? { "X-Proxy-Key": proxyKeyToUse } : {})
      } 
    }
  });

  let prompt = `You are a friendly, natural language and culture assistant. Suggest a few natural, casual replies in "${userTarget}" (with translation, tone description, and nuance/usage explanations in "${userNative}").`;

  if (customPrompt) {
    prompt += `\nUser guidance/instruction: "${customPrompt}"`;
  }

  if (imageDataUrl) {
    prompt += `\n\nAnalyze the attached conversation screenshot image to understand the context and flow, then provide customized replies.`;
  }

  prompt += `\n\nCRITICAL INSTRUCTIONS:
1. Provide a list of "suggestedReplies". Each item must include:
   - "reply": The suggested response in "${userTarget}". Keep them sounding highly natural, native, and casual.
   - "translation": The exact translation of the response in "${userNative}".
   - "tone": A description of the tone/vibe (e.g., "Casual & Chill", "Playful & Teasing", "Sincere & Warm", "Brief & Direct").
   - "explanation": Nuance or context explaining when and how to use this response, written in "${userNative}".
2. Provide a list of "vocabularyCandidates". Identify 1 to 4 useful vocabulary terms (words, phrases, slang, or idioms) from the conversation/screenshot or suggested replies. Each item must include:
   - "word": The word or phrase in "${userTarget}".
   - "translation": The translation in "${userNative}".
   - "reason": A short explanation of its usage/meaning, written in "${userNative}".
`;

  const systemInstruction = `You are a friendly, natural AI Language Coach. Analyze the conversation or guiding prompt, and suggest natural casual replies and candidate vocabulary words. Output strictly valid JSON-only output matching the schema. Do not include any markdown backticks or conversational text outside the JSON.`;

  try {
    let response;
    if (imageDataUrl) {
      let base64Data = imageDataUrl;
      let mimeType = "image/jpeg";
      if (imageDataUrl.startsWith("data:")) {
        const parts = imageDataUrl.split(";base64,");
        const meta = parts[0];
        base64Data = parts[1] || imageDataUrl;
        const mimeMatch = meta.match(/data:([^;]+)/);
        if (mimeMatch) {
          mimeType = mimeMatch[1];
        }
      }

      // 1. Try Cloudflare image-analysis worker client-side
      try {
        const sharedProxyKey =
          llmConfig?.proxyKey ||
          (llmConfig?.savedProviders
            ? (Object.values(llmConfig.savedProviders) as any[]).find((p: any) =>
                Boolean(p?.proxyKey)
              )?.proxyKey
            : "") ||
          "";

        const headers: Record<string, string> = {
          "Content-Type": "application/json"
        };

        if (sharedProxyKey) {
          headers["X-Proxy-Key"] = sharedProxyKey;
        }

        const workerRes = await fetchWithTimeout("https://image-analysis.nclong87.workers.dev/", {
          method: "POST",
          headers,
          body: JSON.stringify({
            nativeLanguage: userNative,
            targetLanguage: userTarget,
            imageData: base64Data,
            customPrompt,
            systemPrompt: systemInstruction,
            userText: prompt
          })
        });

        if (workerRes.ok) {
          const rawText = await workerRes.text();
          const cleanText = cleanJsonResponse(rawText);
          const parsed = JSON.parse(cleanText);
          if (parsed && (parsed.suggestedReplies || parsed.vocabularyCandidates)) {
            const duration = Math.round(performance.now() - startTime);
            return {
              ...parsed,
              provider: "cloudflare-worker",
              model: "image-analysis-worker",
              responseTimeMs: duration
            };
          }
        }
      } catch (err) {
        console.warn("Client-side Cloudflare worker failed for suggestCasualReplyService, falling back to direct Gemini:", err);
      }

      // 2. Direct Gemini fallback client-side
      const imagePart = {
        inlineData: {
          data: base64Data,
          mimeType: mimeType
        }
      };
      const textPart = {
        text: prompt
      };

      response = await ai.models.generateContent({
        model: "gemini-3.6-flash",
        contents: { parts: [imagePart, textPart] },
        config: {
          systemInstruction,
          responseMimeType: "application/json"
        }
      });
    } else {
      response = await ai.models.generateContent({
        model: llmConfig?.model || "gemini-3.6-flash",
        contents: prompt,
        config: {
          systemInstruction,
          responseMimeType: "application/json"
        }
      });
    }

    if (!response.text) {
      throw new Error("Empty response from Gemini API.");
    }

    const cleanText = cleanJsonResponse(response.text);
    const parsed = JSON.parse(cleanText);
    const duration = Math.round(performance.now() - startTime);

    return {
      ...parsed,
      provider: "gemini",
      model: llmConfig?.model || "gemini-3.6-flash",
      responseTimeMs: duration
    };
  } catch (err: any) {
    console.error("Client side suggest casual reply error:", err);
    throw err;
  }
}

