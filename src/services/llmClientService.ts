import { LLMConfig, Word, QuizQuestion, UserStats, UserPersonalityProfile, QuizSuggestedWord } from "../types";
import { generateConfusers, getImageKeyword, ensureQuestionHasBlank, generateQuizQuestions, isQuestionSentenceValid, getDefaultContextSentence, extractPhrasalVerbsAndCollocationsFromSentence } from "../utils/quizGenerator";
import { areWordsEquivalent, isNoun, isPhrasalVerb } from "../utils/wordNormalization";
import { resizeImageDataUrl } from "../utils/llmHelpers";
import { PROVIDER_OPTIONS, DEFAULT_PROVIDER_ID, RELIABLE_MODELS } from "../config/llmProviders";
import { fetchWithTimeout, isStaticHost, getStoredAccessCode } from "../utils";
import { 
  getAutoCandidateWithMeta,
  recordModelResponse, 
  recordModelFailure,
  lockModel,
  syncServerLocks,
  getAllModelStatuses
} from "../utils/autoModeManager";
import { logApiRequest } from "./requestHistoryService";
import { publishLlmRequestStart, notifyLlmRequestStartFromConfig } from "../utils/llmEvents";

import { cleanJsonResponse, cleanAndParseJson, extractWordsFromPayload } from "../utils/jsonSanitizer";
import { getRotatedDefaultModel } from "../components/chat/quickActionsConfig";
export { cleanJsonResponse, cleanAndParseJson, extractWordsFromPayload };

export function getFastestModelForProvider(provider: string, llmConfig?: LLMConfig): string | null {
  try {
    const statuses = getAllModelStatuses(llmConfig);
    const healthy = statuses.filter(s => s.provider === provider && s.status !== 'offline');
    if (healthy && healthy.length > 0 && healthy[0]?.model) {
      return healthy[0].model;
    }
  } catch (e) {
    // Ignore error and fall back
  }
  return null;
}

// Sanitize model names for provider
export function sanitizeModel(provider: string, model?: string): string {
  if (provider === "auto") return "auto";
  const providerMeta = PROVIDER_OPTIONS.find(p => p.id === provider);
  if (providerMeta) {
    if (
      model &&
      model !== "auto" &&
      (
        providerMeta.models.includes(model) ||
        Boolean(providerMeta.visionModels?.includes(model)) ||
        Boolean(providerMeta.tts_models?.includes(model))
      )
    ) {
      return model;
    }
    // Pick the fastest model based on status data!
    const fastestModel = getFastestModelForProvider(provider);
    if (fastestModel) {
      return fastestModel;
    }
    return providerMeta.defaultModel;
  }
  if (model) return model;
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
  rawResponse?: string;
}

export class LLMConnectionError extends Error {
  statusCode: number;
  errorType: LLMErrorType;
  userMessage: string;
  isRetryable: boolean;
  provider: string;
  rawResponse?: string;

  constructor(parsed: ParsedLlmError) {
    super(parsed.userMessage);
    this.name = "LLMConnectionError";
    this.statusCode = parsed.statusCode;
    this.errorType = parsed.errorType;
    this.userMessage = parsed.userMessage;
    this.isRetryable = parsed.isRetryable;
    this.provider = parsed.provider;
    this.rawResponse = parsed.rawResponse;
  }
}

export function getOverrideConfig(llmConfig?: LLMConfig): LLMConfig | undefined {
  // if llmConfig?.model is reliable, return it as-is; otherwise, rotate to a reliable model
  if (llmConfig?.model && RELIABLE_MODELS.some(m => m === llmConfig.model)) {
    return llmConfig;
  }
  let overrideConfig: LLMConfig | undefined = undefined;
  const match = getRotatedDefaultModel(RELIABLE_MODELS);
  if (match) {
    const savedProfile = llmConfig?.savedProviders?.[match.provider];
    overrideConfig = {
      provider: match.provider,
      model: match.model,
      apiKey: savedProfile?.apiKey || llmConfig?.apiKey || "",
      baseUrl: savedProfile?.baseUrl || llmConfig?.baseUrl || "",
      isLoggedIn: savedProfile?.isLoggedIn ?? llmConfig?.isLoggedIn ?? true,
    };
  }
  return overrideConfig || llmConfig;
}

/**
  Parse raw errors from Gemini API or other LLM providers into structured errors
  with status codes, retry flags, and user-friendly messages.
 */
export function parseLlmError(err: any, provider: string = "gemini"): ParsedLlmError {
  const rawResponse =
    err?.rawResponse ||
    (typeof err?.response === "string" ? err.response : undefined) ||
    (typeof err?.data === "string" ? err.data : undefined);

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
      provider,
      rawResponse
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
      provider,
      rawResponse
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
      provider,
      rawResponse
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
      provider,
      rawResponse
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
      userMessage: `Model Not Found (404): The requested ${provUpper} model is unavailable or endpoint path is invalid.`,
      originalMessage,
      isRetryable: false,
      provider,
      rawResponse
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
      userMessage: `${provUpper} Server Error (${code}): Google/Provider AI servers are temporarily busy or undergoing maintenance.`,
      originalMessage,
      isRetryable: true,
      provider,
      rawResponse
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
        ? `API Request Timed Out (30s): ${provUpper} API did not respond within 30 seconds.`
        : `Network Connection Error: Unable to reach ${provUpper} API servers from the browser. Please verify your internet connection.`,
      originalMessage,
      isRetryable: !isTimeout,
      provider,
      rawResponse
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
      provider,
      rawResponse
    };
  }

  // Default fallback error
  return {
    statusCode: statusCode || 400,
    errorType: "UNKNOWN",
    userMessage: `${provUpper} Connection Error: ${originalMessage || "Failed to communicate with LLM model."}`,
    originalMessage,
    isRetryable: statusCode >= 500 || statusCode === 429,
    provider,
    rawResponse
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
      if (err?.name === "AbortError" || String(err?.message || "").includes("aborted") || String(err).includes("aborted")) {
        throw err;
      }
      const parsed = parseLlmError(err, provider);
      if (err?.rawResponse && !parsed.rawResponse) {
        parsed.rawResponse = err.rawResponse;
      }
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
  llmConfig?: LLMConfig,
  signal?: AbortSignal
): Promise<string> {
  const provider = llmConfig?.provider || "openrouter";
  const model = sanitizeModel(provider, llmConfig?.model);
  const apiKey = llmConfig?.apiKey || "";
  const baseUrl = llmConfig?.baseUrl || "";

  const effectiveApiKey = apiKey || "";
  const accessCode = getStoredAccessCode();
  const proxyKeyToUse = accessCode || apiKey || "";

  // Gemini API client-side handling
  if (provider === "gemini") {
    const effectiveGeminiUrl = baseUrl || "https://generativelanguage.googleapis.com/v1beta";
    const primaryModel = model || "gemini-3.6-flash";
    const cleanBaseUrl = effectiveGeminiUrl.replace(/\/+$/, "");

    let targetEndpoint = `${cleanBaseUrl}/models/${primaryModel}:generateContent`;
    if (effectiveApiKey && !effectiveGeminiUrl.includes("workers.dev")) {
      targetEndpoint += `?key=${effectiveApiKey}`;
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };
    if (proxyKeyToUse) {
      headers["X-Proxy-Key"] = proxyKeyToUse;
    }
    if (effectiveApiKey) {
      headers["x-goog-api-key"] = effectiveApiKey;
      if (!headers["X-Proxy-Key"]) {
        headers["X-Proxy-Key"] = effectiveApiKey;
      }
    }

    const payload = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      systemInstruction: systemInstruction ? { parts: [{ text: systemInstruction }] } : undefined,
      generationConfig: {
        responseMimeType: "application/json"
      }
    };

    return callWithRetry(
      async () => {
        const res = await fetchWithTimeout(targetEndpoint, {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
          signal
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => res.statusText);
          const err: any = new Error(`Gemini API Error (${res.status}): ${errText}`);
          err.rawResponse = errText;
          err.statusCode = res.status;
          throw err;
        }

        const data = await res.json();
        const parts = data.candidates?.[0]?.content?.parts || [];
        const text = parts.map((p: any) => p.text || "").join("").trim() || data.text || data.candidates?.[0]?.output || "";
        if (!text) {
          throw new Error("Empty response from Gemini API.");
        }
        return cleanJsonResponse(text);
      },
      { maxRetries: 1, provider: "gemini" }
    );
  }

  // Cloudflare Workers AI provider handling
  if (provider === "cloudflare") {
    const effectiveCloudflareUrl = (baseUrl && baseUrl.trim()) ? baseUrl.trim() : "https://cloudflare.nclong87.workers.dev";
    const targetEndpoint = effectiveCloudflareUrl.replace(/\/+$/, "");

    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };

    if (proxyKeyToUse) {
      headers["X-Proxy-Key"] = proxyKeyToUse;
    } else if (effectiveApiKey) {
      headers["X-Proxy-Key"] = effectiveApiKey;
    }

    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    const messages: Array<{ role: string; content: string }> = [];
    if (systemInstruction) {
      messages.push({
        role: "system",
        content: systemInstruction + (schemaDescription ? "\nOutput MUST be strictly valid raw JSON-only matching:\n" + schemaDescription + "\nDo not include any conversational filler outside the JSON." : "")
      });
    }
    messages.push({
      role: "user",
      content: prompt
    });

    const payload = {
      model: model || "@cf/aisingapore/gemma-sea-lion-v4-27b-it",
      input: {
        messages,
        max_tokens: 2048
      }
    };

    return callWithRetry(
      async () => {
        const res = await fetchWithTimeout(targetEndpoint, {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
          signal
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => res.statusText);
          const err: any = new Error(`Cloudflare AI Error (${res.status}): ${errText}`);
          err.rawResponse = errText;
          err.statusCode = res.status;
          throw err;
        }

        return await parseOpenAiStyleResponse(res);
      },
      { maxRetries: 1, provider: "cloudflare" }
    );
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
    model: model,
    messages: [
      { role: "system", content: systemInstruction + "\nOutput MUST be strictly valid raw JSON-only matching:\n" + schemaDescription + "\nDo not include any conversational filler outside the JSON." },
      { role: "user", content: prompt }
    ],
    max_tokens: 2500,
    stream: false
  };

  // OpenRouter models often return 400 "JSON mode is not supported for this model". Only pass response_format for other supported providers.
  if (provider === "openai" || provider === "groq" || provider === "gemini" || provider === "9flare") {
    reqBody.response_format = { type: "json_object" };
  }

  // Suppress returning reasoning in response payloads for reasoning models while preserving reasoning capability
  // 1. Groq API: reasoning_format: "hidden" instructs Groq to omit reasoning from returned payload entirely
  if (provider === "groq" || model.toLowerCase().includes("groq")) {
    reqBody.reasoning_format = "hidden";
  }

  // 2. OpenRouter, DeepSeek, 9flare, Ollama: include_reasoning: false suppresses returning reasoning streams
  if (
    provider === "openrouter" || 
    provider === "deepseek" || 
    provider === "9flare" || 
    provider === "ollama" ||
    model.toLowerCase().includes("deepseek") || 
    model.toLowerCase().includes("r1")
  ) {
    reqBody.include_reasoning = false;
  }

  return callWithRetry(
    async () => {
      let res = await fetchWithTimeout(targetUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(reqBody),
        signal
      });

      // If request failed with 400 due to response_format, reasoning parameters, or JSON mode incompatibility, retry once without those parameters
      if (!res.ok && (reqBody.response_format || reqBody.reasoning_format || reqBody.include_reasoning !== undefined)) {
        const errClone = res.clone();
        const errText = await errClone.text().catch(() => "");
        if (errText.includes("JSON mode") || errText.includes("response_format") || errText.includes("reasoning") || errText.includes("unrecognized field") || res.status === 400) {
          delete reqBody.response_format;
          delete reqBody.reasoning_format;
          delete reqBody.include_reasoning;
          res = await fetchWithTimeout(targetUrl, {
            method: "POST",
            headers,
            body: JSON.stringify(reqBody),
            signal
          });
        }
      }

      if (!res.ok) {
        const errText = await res.text().catch(() => res.statusText);
        const err: any = new Error(`${provider.toUpperCase()} API Error (${res.status}): ${errText}`);
        err.rawResponse = errText;
        err.statusCode = res.status;
        throw err;
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

export interface LLMCallOptions {
  skipHistory?: boolean;
  skipMetrics?: boolean;
  action?: string;
}

// Client-side LLM invocation returning text plus provider and model metadata
export async function callLLMClientSideWithMeta(
  prompt: string, 
  systemInstruction: string, 
  schemaDescription: string,
  llmConfig?: LLMConfig,
  signal?: AbortSignal,
  options?: LLMCallOptions
): Promise<LLMResponseWithMeta> {
  const provider = llmConfig?.provider || "auto";

  // AUTO MODE: Automatically select candidate model & lock failing model dynamically
  if (provider === "auto" || llmConfig?.model === "auto") {
    const { candidate, tierMeta } = getAutoCandidateWithMeta(llmConfig);
    const candidateKey = `${candidate.provider}:${candidate.model}`;

    // Publish event BEFORE calling AI worker
    publishLlmRequestStart({ provider: candidate.provider, model: candidate.model, timestamp: Date.now() });

    const candidateSavedProfile = llmConfig?.savedProviders?.[candidate.provider];
    const effectiveCandidateConfig: LLMConfig = {
      provider: candidate.provider,
      model: candidate.model,
      apiKey: candidateSavedProfile?.apiKey || (llmConfig?.provider === candidate.provider ? llmConfig.apiKey : ""),
      baseUrl: candidateSavedProfile?.baseUrl || "",
      useProxy: candidateSavedProfile?.useProxy !== undefined ? candidateSavedProfile.useProxy : true,
      isLoggedIn: true,
      savedProviders: llmConfig?.savedProviders
    };

    const candidateStartTime = Date.now();
    try {
      console.log(`[Auto Mode - ${tierMeta.badgeLabel}] Routing request to ${candidateKey}`);
      let text = await callLLMClientSideSingleCandidate(prompt, systemInstruction, schemaDescription, effectiveCandidateConfig, signal);
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

      if (!options?.skipMetrics) {
        recordModelResponse(candidate.provider, candidate.model, candidateDuration);
      }

      if (!options?.skipHistory) {
        // Record successful request/response history log
        logApiRequest({
          provider: candidate.provider,
          model: candidate.model,
          prompt,
          systemInstruction,
          schemaDescription,
          response: text,
          rawResponse: text,
          responseTimeMs: candidateDuration,
          status: "success",
          statusCode: 200,
          action: options?.action
        }).catch(() => undefined);
      }

      return {
        text,
        provider: candidate.provider,
        model: candidate.model,
        responseTimeMs: candidateDuration
      };
    } catch (err: any) {
      if (signal?.aborted || err?.name === "AbortError" || String(err?.message || "").includes("aborted") || String(err).includes("aborted")) {
        throw err;
      }
      const candidateDuration = Date.now() - candidateStartTime;
      console.warn(`[Auto Mode] Model ${candidateKey} failed: ${err?.message || err}. Locking dynamically.`);
      if (!options?.skipMetrics) {
        recordModelFailure(candidate.provider, candidate.model, err?.message || String(err), candidateDuration);
        lockModel(candidate.provider, candidate.model, 3600000, err?.message || String(err));
      }

      const rawResp = err?.rawResponse || (typeof err?.response === 'string' ? err.response : "") || "";

      if (!options?.skipHistory) {
        // Record failed request/response history log
        logApiRequest({
          provider: candidate.provider,
          model: candidate.model,
          prompt,
          systemInstruction,
          schemaDescription,
          response: rawResp || err?.userMessage || err?.message || String(err),
          rawResponse: rawResp || undefined,
          responseTimeMs: candidateDuration,
          status: "error",
          statusCode: err?.statusCode || 500,
          errorMessage: err?.userMessage || err?.message || String(err),
          action: options?.action
        }).catch(() => undefined);
      }

      err.provider = candidate.provider;
      err.model = candidate.model;
      err.isAutoMode = true;
      throw err;
    }
  }

  const activeProvider = llmConfig?.provider || "gemini";
  const activeModel = sanitizeModel(activeProvider, llmConfig?.model);

  // Publish event BEFORE calling AI worker
  publishLlmRequestStart({ provider: activeProvider, model: activeModel, timestamp: Date.now() });

  const singleStartTime = Date.now();
  try {
    const text = await callLLMClientSideSingleCandidate(prompt, systemInstruction, schemaDescription, llmConfig, signal);
    const singleDuration = Date.now() - singleStartTime;
    if (!options?.skipMetrics) {
      recordModelResponse(activeProvider, activeModel, singleDuration);
    }

    if (!options?.skipHistory) {
      // Record successful single request/response history log
      logApiRequest({
        provider: activeProvider,
        model: activeModel,
        prompt,
        systemInstruction,
        schemaDescription,
        response: text,
        rawResponse: text,
        responseTimeMs: singleDuration,
        status: "success",
        statusCode: 200,
        action: options?.action
      }).catch(() => undefined);
    }

    return {
      text,
      provider: activeProvider,
      model: activeModel,
      responseTimeMs: singleDuration
    };
  } catch (err: any) {
    const singleDuration = Date.now() - singleStartTime;
    if (!options?.skipMetrics) {
      recordModelFailure(activeProvider, activeModel, err?.message || String(err), singleDuration);
    }

    const rawResp = err?.rawResponse || (typeof err?.response === 'string' ? err.response : "") || "";

    if (!options?.skipHistory) {
      // Record failed single request/response history log
      logApiRequest({
        provider: activeProvider,
        model: activeModel,
        prompt,
        systemInstruction,
        schemaDescription,
        response: rawResp || err?.userMessage || err?.message || String(err),
        rawResponse: rawResp || undefined,
        responseTimeMs: singleDuration,
        status: "error",
        statusCode: err?.statusCode || 500,
        errorMessage: err?.userMessage || err?.message || String(err),
        action: options?.action
      }).catch(() => undefined);
    }

    throw err;
  }
}

// Outer LLM invocation entry point supporting Auto Mode model rotation & circuit breaker lockouts
export async function callLLMClientSide(
  prompt: string, 
  systemInstruction: string, 
  schemaDescription: string,
  llmConfig?: LLMConfig,
  signal?: AbortSignal,
  options?: LLMCallOptions
): Promise<string> {
  const res = await callLLMClientSideWithMeta(prompt, systemInstruction, schemaDescription, llmConfig, signal, options);
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

    // Support reasoning or reasoning_content field (Groq, DeepSeek, OpenRouter)
    const reasoningRaw = msg.reasoning || msg.reasoning_content;
    if (reasoningRaw && !msg.content) {
      const reasoningTxt = extractTextFromContentClient(reasoningRaw);
      if (reasoningTxt) {
        // Attempt to extract embedded JSON code block inside reasoning
        const jsonMatch = reasoningTxt.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
        if (jsonMatch && jsonMatch[1].trim()) {
          return jsonMatch[1].trim();
        }
      }
    }
  }
  if (choice.delta) {
    const delta = choice.delta;
    const txt = extractTextFromContentClient(delta.content) || extractTextFromContentClient(delta.text);
    if (txt) return txt;

    const reasoningRaw = delta.reasoning || delta.reasoning_content;
    if (reasoningRaw && delta.content === undefined) {
      const reasoningTxt = extractTextFromContentClient(reasoningRaw);
      if (reasoningTxt) {
        const jsonMatch = reasoningTxt.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
        if (jsonMatch && jsonMatch[1].trim()) {
          return jsonMatch[1].trim();
        }
      }
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
      // Cloudflare Workers AI wrapper support
      if (data.result !== undefined && data.result !== null) {
        if (typeof data.result === "string") {
          return cleanJsonResponse(data.result);
        }
        if (typeof data.result === "object") {
          const resText = extractTextFromContentClient(data.result.response) ||
                          extractTextFromContentClient(data.result.text) ||
                          extractTextFromContentClient(data.result.output) ||
                          extractTextFromContentClient(data.result.content) ||
                          extractTextFromChoiceClient(data.result.choices?.[0]);
          if (resText) {
            return cleanJsonResponse(resText);
          }
        }
      }
      if (data.response) {
        const resText = extractTextFromContentClient(data.response);
        if (resText) return cleanJsonResponse(resText);
      }

      const content = extractTextFromChoiceClient(data.choices?.[0]) ||
                      data.output ||
                      data.text ||
                      data.content ||
                      "";
      if (content) {
        return cleanJsonResponse(content);
      }

      // Detect if choices exist but content was empty / only contained reasoning thoughts without output
      if (data.choices?.[0]) {
        const msg = data.choices[0]?.message || data.choices[0]?.delta || {};
        const reasoningText = msg.reasoning || msg.reasoning_content || "";
        if (reasoningText) {
          throw new Error("Empty content from model (model generated reasoning thoughts but no final output content).");
        }
        throw new Error("Empty content received in model choices response.");
      }
    }
  } catch (jsonErr: any) {
    // If we threw an explicit empty content error above, rethrow it
    if (jsonErr.message && jsonErr.message.includes("Empty content")) {
      throw jsonErr;
    }
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

  // Prevent returning raw JSON API wrapper objects as assistant content
  try {
    const parsedObj = JSON.parse(trimmedText);
    if (parsedObj && typeof parsedObj === "object" && (parsedObj.choices || parsedObj.id || parsedObj.object || parsedObj.error)) {
      throw new Error("Empty or unparseable payload from API provider response wrapper.");
    }
  } catch (err: any) {
    if (err.message && err.message.includes("Empty or unparseable payload")) {
      throw err;
    }
  }

  // 3. Fallback to cleanJsonResponse on rawText for plain text responses
  return cleanJsonResponse(rawText);
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
        error: parsed.originalMessage || parsed.userMessage,
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
      error: parsed.originalMessage || parsed.userMessage,
      statusCode: parsed.statusCode,
      errorType: parsed.errorType,
      isRetryable: parsed.isRetryable,
      provider,
      modelUsed
    };
  }
}

// 2b. Generate Image Search Query Parameter using LLM (Strictly for Nouns)
export async function generateImageSearchQueryService(params: {
  word: string;
  definition?: string;
  context?: string;
  partOfSpeech?: string;
  placeholderIndex?: number;
  cfg?: LLMConfig;
  signal?: AbortSignal;
}): Promise<string> {
  const { word, definition, context, partOfSpeech, placeholderIndex: _placeholderIndex = 1, cfg, signal } = params;

  // RULE: Apply image search query generation strictly to nouns
  if (partOfSpeech && !isNoun(partOfSpeech)) {
    return "";
  }

  const llmConfig = getOverrideConfig(cfg);
  notifyLlmRequestStartFromConfig(llmConfig);

  const prompt = `You are an expert visual search query optimizer for vocabulary learners.
Your mission is to generate the single most relevant, concise 1-3 word English search query to retrieve an authentic, iconic, high-quality photograph representing this noun.

Noun: "${word}"
Part of Speech: "${partOfSpeech || 'noun'}"
Definition: "${definition || ''}"
Context/Usage: "${context || ''}"

OPTIMIZATION DIRECTIVES:
1. STRICTLY FOR NOUNS: Focus on the primary concrete physical object, person, or setting that unmistakably depicts this noun according to the specified definition and context.
2. DISAMBIGUATE ACCURATELY: If this noun has multiple distinct meanings (e.g., "bank" as riverbank vs. financial institution; "crane" as bird vs. construction machine; "cell" as biology vs. prison), select the specific visual subject that strictly matches the definition and context provided.
3. CONCRETE SYMBOLISM FOR ABSTRACT NOUNS: If the noun is conceptual or abstract (e.g., "serendipity", "nostalgia", "peace", "democracy"), select the most universally recognized physical visual symbol or iconic scene (e.g., "four leaf clover", "vintage polaroid", "olive branch", "ballot box").
4. PHOTOGRAPHIC SEARCH QUERY: Output 1 to 3 words in English optimized for photography search engines (Unsplash, Pexels). NO punctuation, NO quotes, NO generic filler words like "image of", "picture of", "photo".
5. OUTPUT FORMAT: Output MUST be strictly JSON format: {"query": "search_query_here"}`;

  const systemInstruction = "You are an expert visual search query optimizer. Given a noun and its definition/context, output a JSON object containing a highly optimized 1-3 word English photographic search query. Do not include any explanations or markdown formatting outside the JSON.";
  const schemaDescription = '{\n  "query": "string"\n}';

  try {
    const rawText = await callLLMClientSide(
      prompt,
      systemInstruction,
      schemaDescription,
      llmConfig,
      signal,
      { skipHistory: true, skipMetrics: true }
    );
    const parsed = cleanAndParseJson(rawText);
    if (parsed && typeof parsed === "object" && typeof parsed.query === "string" && parsed.query.trim()) {
      return parsed.query.trim();
    }
  } catch (err) {
    console.warn("LLM image query generation failed, using fallback query parameter:", err);
  }

  // Fallback query if LLM fails or is offline (only for nouns)
  const cleanWord = word.includes(",") ? word.split(",")[0].trim() : word.trim();
  return cleanWord;
}

// 3. Autofill Word Details
export async function autofillWordService(params: {
  word: string;
  hint?: string;
  category?: string;
  context?: string;
  targetLanguage?: string;
  nativeLanguage?: string;
  cfg?: LLMConfig;
  signal?: AbortSignal;
}): Promise<any> {
  const { word, hint, category, context, targetLanguage, nativeLanguage, cfg, signal } = params;
  const llmConfig = getOverrideConfig(cfg);
  notifyLlmRequestStartFromConfig(llmConfig);

  function normalizeLanguageName(lang?: string): string {
    if (!lang) return "";
    const trimmed = lang.trim();
    const lower = trimmed.toLowerCase();
    if (lower === "vi" || lower === "vietnamese") return "Vietnamese";
    if (lower === "en" || lower === "english") return "English";
    if (lower === "es" || lower === "spanish") return "Spanish";
    if (lower === "fr" || lower === "french") return "French";
    if (lower === "ja" || lower === "japanese") return "Japanese";
    if (lower === "zh" || lower === "chinese") return "Chinese";
    if (lower === "de" || lower === "german") return "German";
    if (lower === "ko" || lower === "korean") return "Korean";
    return trimmed;
  }

  const userTarget = normalizeLanguageName(targetLanguage) || "English";
  let userNative = normalizeLanguageName(nativeLanguage);

  if (!userNative && typeof window !== "undefined") {
    const stored = localStorage.getItem("vocab_learner_native_lang");
    if (stored) {
      userNative = normalizeLanguageName(stored);
    }
  }

  if (!userNative || userNative.toLowerCase() === userTarget.toLowerCase()) {
    const storedNative = typeof window !== "undefined" ? localStorage.getItem("vocab_learner_native_lang") : null;
    const normalizedStored = normalizeLanguageName(storedNative || "");
    if (normalizedStored && normalizedStored.toLowerCase() !== userTarget.toLowerCase()) {
      userNative = normalizedStored;
    } else {
      userNative = userTarget === "English" ? "Vietnamese" : "English";
    }
  }

  const contextSections: string[] = [];
  if (category) contextSections.push(`- CATEGORY / TOPIC DOMAIN: "${category}"`);
  if (context) contextSections.push(`- CURRENT USAGE CONTEXT: "${context}"`);
  if (hint && hint !== context && hint !== category) contextSections.push(`- SCOPE / USAGE HINT: "${hint}"`);

  const contextPromptText = contextSections.length > 0
    ? `\nCRITICAL CATEGORY & USAGE CONTEXT SPECIFICATION:\n${contextSections.join("\n")}\nCRITICAL DIRECTIVE: Generate the definition, translation, example sentence, and pronunciation guide specifically tailored and matching the above Category and Usage Context.\n`
    : "";

  const prompt = `Provide detailed vocabulary learning material for the input word or expression "${word}".
${contextPromptText}
Target language being learned: "${userTarget}".
User's native language: "${userNative}".

CRITICAL AUTOMATIC LANGUAGE DETECTION & TRANSLATION INSTRUCTIONS:
- MULTI-WORD INPUT ANALYSIS & TARGET DETERMINATION FLOW:
  * When the input "${word}" contains more than one word, first perform an LLM analysis of the user's input:
    1. ANALYZE INTENT: Determine whether the user wants to add a specific word (along with its specific context or domain) OR the whole multi-word expression/sentence as the target entry:
       - OPTION A (SPECIFIC WORD + CONTEXT): If the input is a full conversational sentence, question, or request mentioning a specific word (e.g., "I want to add table in database context", "She had an innate talent for music", "How do you say resilience in Spanish?"), EXTRACT the specific target word/term (e.g., "table", "innate", "resilience") and isolate the specified context/domain (e.g. "database context", "musical ability").
       - OPTION B (WHOLE MULTI-WORD PHRASE / EXPRESSION): If the input is a multi-word vocabulary item, phrasal verb, collocation, idiom, or fixed expression (e.g., "postpone until a later date", "forward to", "wholesale market", "look forward to", "take into account", "break down", "piece of cake"), TREAT THE ENTIRE MULTI-WORD PHRASE as the target item! DO NOT strip prepositions or shorten the phrase!
    2. CONTINUE WITH WORD-ADDING PROCESS: Generate the complete vocabulary details (definition, translation, example, IPA, part of speech, category, context) for the target term identified in Step 1.
- CRITICAL WORD EXTRACTION & TARGET PHRASE PRESERVATION DIRECTIVE:
  * Always attempt to extract individual target vocabulary words or key lexical terms from user sentences, queries, or natural language requests whenever possible, rather than using an entire conversational request phrase as a single entry.
  * CRITICAL EXCEPTION FOR MULTI-WORD EXPRESSIONS, PHRASAL VERBS, & COLLOCATIONS:
    If "${word}" or the target item being learned is a multi-word vocabulary item, phrase, collocation, phrasal verb, idiom, or fixed expression (e.g. "postpone until a later date", "forward to", "wholesale market", "look forward to", "take into account"):
    - YOU MUST PRESERVE AND KEEP THE ENTIRE MULTI-WORD PHRASE / EXPRESSION INTACT AS THE TARGET "word" FIELD!
    - ABSOLUTELY DO NOT strip words, prepositions, or modifiers from a multi-word target phrase (e.g. DO NOT shorten "postpone until a later date" to "postpone", DO NOT shorten "forward to" to "forward", DO NOT shorten "wholesale market" to "wholesale").
    - Treat the COMPLETE multi-word phrase/expression as the target vocabulary headword to be defined, translated, and stored in the user's collection.
  * EXTRACTING CORE HEADWORDS FROM CONVERSATIONAL SENTENCES OR QUESTIONS:
    If "${word}" is a full conversational sentence, clause, natural language query, or conversational request (e.g., "The weather is very whimsical today", "I want to add the word serendipity", "She had an innate talent for music", "Thêm từ enthusiastic vào từ điển", "How do you say resilience in Spanish?", "Can we learn about biodiversity?"):
    - DO NOT set the "word" field to the entire input sentence or question!
    - Isolate and extract ONLY the core target vocabulary word/expression being learned or referenced (e.g. "whimsical", "serendipity", "innate", "enthusiastic", "resilience", "biodiversity").
    - If the input sentence was in the native language (${userNative}) or describes a concept, extract or translate that core headword into ${userTarget} for "word" and provide the ${userNative} translation.
    - If the target item inside the sentence is a multi-word phrase or expression (e.g. "postpone until a later date"), preserve that full multi-word phrase intact!
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
- "context": A concise 1-sentence description of the specific real-world scenario, domain, or usage context where this term is typically used.
- "suggestedWords": Array of 2 to 3 practical companion vocabulary items in "${userTarget}".
  SPEED OPTIMIZATION: Return ONLY "word" and "translation" (or concise "definition"). Do NOT output partOfSpeech or lengthy definitions.`;

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
  "context": "string (specific real-world usage context description)",
  "suggestedWords": [
    {
      "word": "string (vocabulary word in ${userTarget} commonly paired with this word)",
      "translation": "string (translation in ${userNative} or concise definition)"
    }
  ]
}`;

  const startTime = performance.now();

  if (isStaticHost()) {
    const resWithMeta = await callLLMClientSideWithMeta(prompt, systemInstruction, schemaDesc, llmConfig, signal);
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
      body: JSON.stringify({ word, hint, targetLanguage: userTarget, nativeLanguage: userNative, llmConfig }),
      signal
    });

    if (res.ok) {
      const data = await res.json();
      syncServerLocks(data.serverLockedModels);
      const duration = data.responseTimeMs || Math.round(performance.now() - startTime);
      const prov = data.provider || llmConfig?.provider || "gemini";
      const mod = data.model || sanitizeModel(llmConfig?.provider || "gemini", llmConfig?.model);
      if (prov && mod) {
        recordModelResponse(prov, mod, duration);
      }
      return data;
    }

    if (res.status === 405 || res.status === 404) {
      const resWithMeta = await callLLMClientSideWithMeta(prompt, systemInstruction, schemaDesc, llmConfig, signal);
      const duration = resWithMeta.responseTimeMs || Math.round(performance.now() - startTime);
      if (resWithMeta.provider && resWithMeta.model) {
        recordModelResponse(resWithMeta.provider, resWithMeta.model, duration);
      }
      return cleanAndParseJson(resWithMeta.text);
    }

    const errData = await res.json().catch(() => ({ error: res.statusText }));
    syncServerLocks(errData.serverLockedModels);
    const parsedErr = parseLlmError(errData, llmConfig?.provider || "gemini");
    throw new Error(parsedErr.userMessage || `Server error (${res.status}): ${res.statusText}`);
  } catch (err: any) {
    const parsedErr = parseLlmError(err, llmConfig?.provider || "gemini");
    throw new Error(parsedErr.userMessage || err?.message || "Failed to auto-fill word definition.");
  }
}

// 3.1. Check Word Multiple Definitions Sense Detection or Exact Definition with Context Hint
export async function checkWordDefinitionsService(params: {
  word: string;
  hint?: string;
  targetLanguage?: string;
  nativeLanguage?: string;
  cfg?: LLMConfig;
  signal?: AbortSignal;
}): Promise<any> {
  const { word, hint, targetLanguage, nativeLanguage, cfg, signal } = params;
  const llmConfig = getOverrideConfig(cfg);
  notifyLlmRequestStartFromConfig(llmConfig);
  const userNative = nativeLanguage || "Vietnamese";
  const userTarget = targetLanguage || "Spanish";

  const prompt = `Analyze the input word or expression "${word}".
${hint ? `Scope / Context Hint: "${hint}"\nCRITICAL MANDATORY REQUIREMENT: The user wants to add "${word}" specifically in the scope/context described above.` : ""}
Target language: "${userTarget}".
User's native language: "${userNative}".

CRITICAL AUTOMATIC LANGUAGE DETECTION & TRANSLATION INSTRUCTIONS:
0. MULTI-WORD INPUT ANALYSIS & TARGET DETERMINATION FLOW:
   - When the input "${word}" contains more than one word, first perform an LLM analysis of the user's input:
     1. ANALYZE INTENT: Determine whether the user wants to add a specific word (along with its specific context or domain) OR the whole multi-word expression/sentence as the target entry:
        * OPTION A (SPECIFIC WORD + CONTEXT): If the input is a full conversational sentence, question, or request mentioning a specific word (e.g., "I want to add table in database context", "She had an innate talent for music", "How do you say resilience in Spanish?"), EXTRACT the specific target word/term (e.g., "table", "innate", "resilience") and isolate the specified context/domain (e.g. "database context", "musical ability").
        * OPTION B (WHOLE MULTI-WORD PHRASE / EXPRESSION): If the input is a multi-word vocabulary item, phrasal verb, collocation, idiom, or fixed expression (e.g., "postpone until a later date", "forward to", "wholesale market", "look forward to", "take into account", "break down", "piece of cake"), TREAT THE ENTIRE MULTI-WORD PHRASE as the target item! DO NOT strip prepositions or shorten the phrase!
     2. CONTINUE WITH WORD-ADDING PROCESS: Generate the complete vocabulary details (definition, translation, example, IPA, part of speech, category, context) for the target term identified in Step 1.
   - CRITICAL WORD EXTRACTION & TARGET PHRASE PRESERVATION DIRECTIVE:
     * Always attempt to extract individual target vocabulary words or key lexical terms from user sentences, queries, or natural language requests whenever possible, rather than using an entire conversational request phrase as a single entry.
     * CRITICAL EXCEPTION FOR MULTI-WORD EXPRESSIONS, PHRASAL VERBS, & COLLOCATIONS:
       If "${word}" or the target item being learned is a multi-word vocabulary item, phrase, collocation, phrasal verb, idiom, or fixed expression (e.g. "postpone until a later date", "forward to", "wholesale market", "look forward to", "take into account"):
       - YOU MUST PRESERVE AND KEEP THE ENTIRE MULTI-WORD PHRASE / EXPRESSION INTACT AS THE TARGET "word" FIELD!
       - ABSOLUTELY DO NOT strip words, prepositions, or modifiers from a multi-word target phrase (e.g. DO NOT shorten "postpone until a later date" to "postpone", DO NOT shorten "forward to" to "forward", DO NOT shorten "wholesale market" to "wholesale").
       - Treat the COMPLETE multi-word phrase/expression as the target vocabulary headword to be defined, translated, and stored in the user's collection.
   - EXTRACTING CORE HEADWORDS FROM CONVERSATIONAL SENTENCES OR QUESTIONS:
     If "${word}" is a full conversational sentence, clause, natural language query, or conversational request (e.g., "The weather is very whimsical today", "I want to add the word serendipity", "She had an innate talent for music", "Thêm từ enthusiastic vào từ điển", "How do you say resilience in Spanish?", "Can we learn about biodiversity?"):
     * NEVER set the "word" field to the entire input sentence or question!
     * Isolate and extract ONLY the core target vocabulary word/expression being learned or referenced (e.g. "whimsical", "serendipity", "innate", "enthusiastic", "resilience", "biodiversity").
     * If multiple distinct candidate vocabulary terms exist in the sentence, or if the user's focus is ambiguous, set "hasMultipleSenses": true and provide candidate senses for each extracted individual word from the sentence so the user can choose which specific word to add.
     * If the target item inside the sentence is a multi-word phrase or expression (e.g. "postpone until a later date"), preserve that full multi-word phrase intact!
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

4. MULTIPLE SENSES DISAMBIGUATION & STRICT CONTEXT FILTERING:
   - CRITICAL CONTEXT FILTERING RULE:
     If a specific Scope / Context Hint was provided ("${hint}") OR if a specific context/domain was extracted or specified in the input (e.g., "color" from "orange in color", "database" from "table in database context", "RAG" from "citation in RAG context"):
     * YOU MUST STRICTLY FILTER AND EXCLUDE ALL SENSES THAT DO NOT MATCH OR BELONG TO THAT SPECIFIED CONTEXT!
     * DO NOT include senses from unrelated domains! (e.g., for "orange in color" or context "color", INCLUDE ONLY color-related senses such as noun/adjective for color, and ABSOLUTELY EXCLUDE citrus fruit senses like "quả cam" / fruit!).
     * If the specified context restricts the word to a specific domain (like "color"), include ONLY senses matching that domain and DO NOT return meanings from other domains!
   - GENERAL DISAMBIGUATION:
     * ${hint ? `Since a specific Scope/Context Hint was provided ("${hint}"), set "hasMultipleSenses": false and return ONLY exact matching sense(s) in "senses".` : `If there is only 1 dominant definition or translation (or if the specified context narrows it to 1 single meaning domain), set "hasMultipleSenses": false. If there are 2 to 4 distinct meanings or parts of speech matching the context in "${userTarget}", set "hasMultipleSenses": true.`}
   - Provide the matching sense(s) in "senses". For each sense, include:
     "word": string (Target Language word in "${userTarget}"),
     "partOfSpeech": string,
     "definition": string (written in "${userTarget}"),
     "translation": string (written in "${userNative}"),
     "pronunciation": string,
     "example": string (written in "${userTarget}"),
     "exampleTranslation": string (written in "${userNative}"),
     "suggestedWords": Array of 2 to 3 practical companion vocabulary items in "${userTarget}". SPEED OPTIMIZATION: Return ONLY "word" and "translation" (or concise "definition"). Do NOT output partOfSpeech, definitions, or extra fields.,
     "imageKeyword": string (CRITICAL: APPLY IMAGE QUERY ONLY TO NOUNS. If partOfSpeech is a noun, provide the single most relevant, concrete 1-3 word English visual photographic search query for this noun based on its definition and context. For abstract nouns, use an iconic physical object or concrete symbol. If partOfSpeech is NOT a noun [e.g. verb, adjective, adverb, preposition], set to empty string ""),
     "category": string,
     "context": string`;

  const systemInstruction = `You are an elite multilingual dictionary lookup engine. You automatically detect input language, map native language inputs to the target language, and output structured JSON with target language words, definitions, and native language translations. If no valid definition exists or cannot be found, set "notFound": true and "senses": []. Output strictly valid JSON-only output when requested. Do not include any conversational filler outside the JSON.`;
  const schemaDesc = `{
  "word": "string (the word/expression STRICTLY in the target language ${userTarget}, e.g. 'hello')",
  "notFound": boolean,
  "hasMultipleSenses": boolean,
  "suggestedWords": [
    {
      "word": "string (vocabulary word in ${userTarget} commonly paired with this word)",
      "translation": "string (translation in ${userNative} or concise definition)"
    }
  ],
  "senses": [
    {
      "word": "string (the word/expression STRICTLY in the target language ${userTarget}, e.g. 'hello')",
      "partOfSpeech": "string (e.g. noun, verb, adjective, expression)",
      "definition": "string (definition written STRICTLY in ${userTarget})",
      "translation": "string (translation in ${userNative})",
      "pronunciation": "string (IPA pronunciation)",
      "example": "string (sentence in ${userTarget})",
      "exampleTranslation": "string (sentence translation in ${userNative})",
      "imageKeyword": "string (ONLY FOR NOUNS: single most relevant 1-3 word concrete visual search query in English for this noun based on its definition and context. If partOfSpeech is NOT a noun, leave as empty string '')",
      "category": "string",
      "context": "string",
      "suggestedWords": [
        {
          "word": "string (vocabulary word in ${userTarget} commonly paired with this word)",
          "translation": "string (translation in ${userNative} or concise definition)"
        }
      ]
    }
  ]
}`;

  const startTime = performance.now();

  if (isStaticHost()) {
    const resWithMeta = await callLLMClientSideWithMeta(prompt, systemInstruction, schemaDesc, llmConfig, signal);
    const parsed = cleanAndParseJson(resWithMeta.text);
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
      body: JSON.stringify({ word, hint, targetLanguage: userTarget, nativeLanguage: userNative, llmConfig }),
      signal
    });

    if (res.ok) {
      const data = await res.json();
      syncServerLocks(data.serverLockedModels);
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

    const errData = await res.json().catch(() => ({ error: res.statusText }));
    syncServerLocks(errData.serverLockedModels);
    const parsedErr = parseLlmError(errData, llmConfig?.provider || "gemini");
    throw new Error(parsedErr.userMessage || `Server error (${res.status}): ${res.statusText}`);
  } catch (err: any) {
    const parsedErr = parseLlmError(err, llmConfig?.provider || "gemini");
    throw new Error(parsedErr.userMessage || err?.message || "Failed to check word definitions.");
  }
}

// 3.5. Generate Random Words for Collection
export async function generateRandomWordsService(params: {
  topic: string;
  targetLanguage?: string;
  nativeLanguage?: string;
  count?: number;
  existingWords?: string[];
  cfg?: LLMConfig;
  signal?: AbortSignal;
}): Promise<{ words: any[]; provider?: string; model?: string; responseTimeMs?: number }> {
  const { topic, targetLanguage, nativeLanguage, count = 5, existingWords, cfg, signal } = params;
  const llmConfig = getOverrideConfig(cfg);
  notifyLlmRequestStartFromConfig(llmConfig);
  const userNative = nativeLanguage || "Vietnamese";
  const userTarget = targetLanguage || "Spanish";
  const startTime = performance.now();

  const prompt = `Generate ${count} practical vocabulary words or expressions in target language "${userTarget}" relevant to or expanding on the topic "${topic || "Vocabulary"}".
The user's native language is "${userNative}".
${Array.isArray(existingWords) && existingWords.length > 0 ? `\nCRITICAL DO-NOT-DUPLICATE DIRECTIVE:\nThe user ALREADY has the following words in their collection for the "${topic}" category:\n${JSON.stringify(existingWords)}\nDO NOT generate or include any of these existing words! Generate ${count} NEW, DISTINCT words for this category that are NOT in the list above.\n` : ""}
CRITICAL INSTRUCTIONS:
- Every word generated SHOULD BE unique and practical for a language learner.
- CRITICAL VERB & COLLOCATION RULE: When generating verbs or action terms, ALWAYS pair verbs with their natural dependent prepositions and key collocations (e.g. generate "elaborate on", "rely on", "focus on", "specialize in", "cure for", "abide by", "invest in", "refrain from", "participate in", "deal with") rather than bare isolated verbs, so learners master the complete verb + preposition usage.
- "word": The target vocabulary word, collocation, or expression STRICTLY in the target language (${userTarget}), e.g. "elaborate on".
- "pronunciation": International Phonetic Alphabet (IPA) pronunciation guide for the target language word/expression, e.g. "/ɪˈlæbəreɪt ɒn/". Must NOT be empty.
- "partOfSpeech": The part of speech of the word (e.g. noun, verb, adjective, adverb, idiom, interjection, or expression).
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
    const resWithMeta = await callLLMClientSideWithMeta(prompt, systemInstruction, schemaDesc, llmConfig, signal);
    const parsed = cleanAndParseJson(resWithMeta.text);
    const words = extractWordsFromPayload(parsed);
    const duration = resWithMeta.responseTimeMs || Math.round(performance.now() - startTime);
    if (resWithMeta.provider && resWithMeta.model) {
      recordModelResponse(resWithMeta.provider, resWithMeta.model, duration);
    }
    return {
      words,
      provider: resWithMeta.provider,
      model: resWithMeta.model,
      responseTimeMs: duration
    };
  }

  try {
    const res = await fetchWithTimeout("/api/generate-random-words", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic, targetLanguage: userTarget, nativeLanguage: userNative, count, existingWords, llmConfig }),
      signal
    });

    if (res.ok) {
      const data = await res.json();
      syncServerLocks(data.serverLockedModels);
      const words = extractWordsFromPayload(data);
      const duration = data.responseTimeMs || Math.round(performance.now() - startTime);
      const prov = data.provider || llmConfig?.provider || "gemini";
      const mod = data.model || sanitizeModel(llmConfig?.provider || "gemini", llmConfig?.model);
      if (prov && mod) {
        recordModelResponse(prov, mod, duration);
      }
      return {
        words,
        provider: prov,
        model: mod,
        responseTimeMs: duration
      };
    }

    const errData = await res.json().catch(() => ({ error: res.statusText }));
    syncServerLocks(errData.serverLockedModels);
    const parsedErr = parseLlmError(errData, llmConfig?.provider || "gemini");
    throw new Error(parsedErr.userMessage || `Server error (${res.status}): ${res.statusText}`);
  } catch (err: any) {
    const parsedErr = parseLlmError(err, llmConfig?.provider || "gemini");
    throw new Error(parsedErr.userMessage || err?.message || "Failed to generate random words.");
  }
}

// 3.8. Polish Sentence & Improve Clarity
export interface FixGrammarRequest {
  userText: string;
  targetLanguage?: string;
  nativeLanguage?: string;
  llmConfig?: LLMConfig;
  signal?: AbortSignal;
}

export interface FixGrammarResult {
  fixedSentence: string;
  explanation: string;
  provider?: string;
  model?: string;
  responseTimeMs?: number;
  suggestedWords?: Array<{
    word: string;
    definition?: string;
    translation?: string;
    partOfSpeech?: string;
    reason?: string;
    hint?: string;
  }>;
  vocabularyCandidates?: Array<{
    word: string;
    definition?: string;
    translation?: string;
    reason?: string;
  }>;
}

export async function fixGrammarService(params: FixGrammarRequest): Promise<FixGrammarResult> {
  const { userText, targetLanguage, nativeLanguage, llmConfig, signal } = params;
  notifyLlmRequestStartFromConfig(llmConfig);
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
3. "suggestedWords": Array of 2 to 3 practical companion vocabulary items in "${userTarget}".
   SPEED OPTIMIZATION: To maximize response speed, return ONLY "word" and "translation" (or concise "definition"). Do NOT output partOfSpeech, definition sentences, or reason fields.
`;

  const systemInstruction = `You are a friendly, natural AI Language Coach. Polish sentences, improve flow, and fix grammar & spelling with a casual tone. Suggest 2-3 companion vocabulary words (word and translation or definition) for the user's collection. Output strictly valid JSON-only output matching the schema when requested. Do not include any conversational filler outside the JSON.`;
  const schemaDesc = `{
  "fixedSentence": "string",
  "explanation": "string (markdown formatted casual explanation)",
  "suggestedWords": [
    {
      "word": "string (target word in ${userTarget})",
      "translation": "string (direct translation in ${userNative} or concise definition)"
    }
  ]
};`;

  if (isStaticHost()) {
    const resWithMeta = await callLLMClientSideWithMeta(prompt, systemInstruction, schemaDesc, llmConfig, signal);
    const parsed = cleanAndParseJson(resWithMeta.text);
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
      body: JSON.stringify({ userText, targetLanguage: userTarget, nativeLanguage: userNative, llmConfig }),
      signal
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

    const errData = await res.json().catch(() => ({ error: res.statusText }));
    const parsedErr = parseLlmError(errData, llmConfig?.provider || "gemini");
    throw new Error(parsedErr.userMessage || `Server error (${res.status}): ${res.statusText}`);
  } catch (err: any) {
    const parsedErr = parseLlmError(err, llmConfig?.provider || "gemini");
    throw new Error(parsedErr.userMessage || err?.message || "Failed to check or fix grammar.");
  }
}

// 5. Interactive Chat Assistant Service
export interface ChatMessageRequest {
  messages: { role: string; content: string }[];
  targetLanguage: string;
  nativeLanguage: string;
  llmConfig?: LLMConfig;
  wordContext?: Partial<Word> | null;
  userInquiries?: Array<{ question: string; word?: string; timestamp?: number }>;
  userProfile?: UserPersonalityProfile | null;
  signal?: AbortSignal;
}

export interface ChatMessageResult {
  text: string;
  suggestedActions?: {
    label: string;
    action: "add_word" | "start_practice" | "send_message";
    payload?: {
      word?: string;
      message?: string;
    };
  }[];
  provider?: string;
  model?: string;
  responseTimeMs?: number;
}

export async function sendChatMessageService(params: ChatMessageRequest): Promise<ChatMessageResult> {
  const { messages, targetLanguage, nativeLanguage, llmConfig, wordContext, userInquiries, userProfile, signal } = params;
  notifyLlmRequestStartFromConfig(llmConfig);
  const startTime = performance.now();

  const chatHistoryStr = messages
    .slice(-10)
    .map((m: any) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n");

  let wordContextInstruction = "";
  if (wordContext && typeof wordContext === "object" && wordContext.word) {
    wordContextInstruction = `\n\nTARGET VOCABULARY FOCUS:
You are currently providing focused language coaching for the word "${wordContext.word}".
- Target Word: "${wordContext.word}"
- Part of Speech: "${wordContext.partOfSpeech || "N/A"}"
- IPA Pronunciation: "${wordContext.pronunciation || "N/A"}"
- Target Language Definition: "${wordContext.definition || "N/A"}"
- Native Translation (${nativeLanguage}): "${wordContext.translation || "N/A"}"
- Category/Topic: "${wordContext.category || "General"}"
- Real-world Usage Context: "${wordContext.context || "N/A"}"
- Example Sentence: "${wordContext.example || "N/A"}"
- Example Translation: "${wordContext.exampleTranslation || "N/A"}"
${Array.isArray(wordContext.suggestedWords) && wordContext.suggestedWords.length > 0 ? `- Common Collocations / Paired Words: ${JSON.stringify(wordContext.suggestedWords)}` : ""}

CRITICAL VOCABULARY COACHING INSTRUCTIONS:
- Directly and accurately answer all user questions about this specific word ("${wordContext.word}"), its grammar, prepositions, collocations, nuances, distinctions from synonyms, etymology, and conversation practice.
- Ensure all explanations incorporate these specific details, and maintain seamless continuity with the full conversation history.
- When generating example sentences, highlight "${wordContext.word}" in bold (**${wordContext.word}**).
- ABSOLUTELY NO QUIZZES OR PRACTICE TESTS: Do NOT offer, mention, or suggest quizzes, test questions, practice tests, "Start a quick practice", or "practice with a short quiz" in this dialog.
- Do NOT ask the user if they want to practice with a quiz. Instead, offer choices like exploring nuances, seeing more examples, asking follow-up questions, or adding related vocabulary.
- Do NOT include "start_practice" or quiz/practice actions in suggestedActions.`;
  }

  let userInquiryInstruction = "";
  if (Array.isArray(userInquiries) && userInquiries.length > 0) {
    const recentQuestionsList = userInquiries
      .slice(-8)
      .map((item: any, idx: number) => {
        const q = typeof item === "string" ? item : (item.question || "");
        const w = typeof item === "object" && item.word ? ` (for "${item.word}")` : "";
        return `${idx + 1}. "${q}"${w}`;
      })
      .filter((line: string) => line.trim().length > 3)
      .join("\n");

    if (recentQuestionsList) {
      userInquiryInstruction = `\n\nUSER LEARNING PREFERENCES & RECENT INQUIRIES (JUST-IN-TIME PERSONALIZATION):
The user recently asked the following questions during study sessions:
${recentQuestionsList}

CRITICAL PERSONALIZATION FOR SUGGESTED ACTIONS:
- Analyze the user's inquiry patterns above (e.g. business/workplace emails, preposition precision, nuance/distinction between synonyms, spoken conversational dialogues, or memory mnemonics).
- You MUST customize the 3 interactive suggestedActions in your response so their labels and payloads directly match this user's demonstrated learning preferences and interests for "${wordContext?.word || targetLanguage}".
- Keep suggestedActions compelling, highly specific to the current topic/word, and immediately useful.`;
    }
  }

  const prompt = `Below is the recent conversation history between the User and you (the Assistant):\n\n${chatHistoryStr}\n\nAssistant, formulate your next helpful response. Ensure to check if the user is interested in practicing or adding words, and attach appropriate suggestedActions.`;

  const systemInstruction = `You are an elite, highly encouraging AI Language Coach and Vocabulary Assistant.
Your mission is to help the user master their target language "${targetLanguage}" from their native language "${nativeLanguage}".
You speak in a warm, welcoming, and linguistically precise tone.${wordContextInstruction}${userInquiryInstruction}

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

6. **Suggesting Words & Vocabulary Actions**:
   - Answer questions about grammar, translation, and pronunciation clearly and encouragingly.
   - If you introduce a valuable vocabulary word or expression, include an "add_word" action in suggestedActions.
   - CRITICAL VERB & COLLOCATION RULE: Whenever suggesting or adding verbs via "add_word" or introducing verbs, ALWAYS pair verbs with their natural dependent prepositions and key collocations (e.g., "cure for", "elaborate on", "rely on", "participate in", "account for", "specialize in", "abide by", "benefit from") rather than bare isolated verbs.
   - If the user wants to practice vocabulary or take a test, include a "start_practice" action in suggestedActions.
   - You MUST strictly output valid JSON-only output matching the schema below.
   - Do not include any conversational filler outside the JSON.`;

  const schemaDesc = `{
  "text": "string (the main conversation response in markdown format. Keep it beautifully styled, use bolding, bullet points, etc. where helpful)",
  "suggestedActions": [
    {
      "label": "string (compelling action text, e.g. 'Add \"serendipity\" to collection', 'Move on to Question 4', or 'Start Practice')",
      "action": "string (one of: 'add_word', 'start_practice', 'send_message')",
      "payload": {
        "word": "string (required if action is 'add_word')",
        "definition": "string (concise definition in target language if action is 'add_word')",
        "translation": "string (translation in native language if action is 'add_word')",
        "message": "string (required if action is 'send_message')"
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
      body: JSON.stringify({ messages, targetLanguage, nativeLanguage, llmConfig, wordContext, userInquiries, userProfile }),
      signal
    });

    if (res.ok) {
      const data = await res.json();
      syncServerLocks(data.serverLockedModels);
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

    const errData = await res.json().catch(() => ({ error: res.statusText }));
    syncServerLocks(errData.serverLockedModels);
    if (errData.provider && errData.model && res.status !== 401 && res.status !== 403) {
      lockModel(errData.provider, errData.model);
    }
    const parsedErr = parseLlmError(errData, errData.provider || llmConfig?.provider || "gemini");
    if (errData.model) {
      parsedErr.userMessage = parsedErr.userMessage.replace(/Google\/Provider|Gemini|LLM provider/i, `${errData.provider}:${errData.model}`);
    }
    throw new LLMConnectionError(parsedErr);
  } catch (err: any) {
    if (err instanceof LLMConnectionError) {
      throw err;
    }
    const parsedErr = parseLlmError(err, llmConfig?.provider || "gemini");
    throw new LLMConnectionError(parsedErr);
  }
}

export interface GenerateSuggestedActionsRequest {
  word: Partial<Word>;
  targetLanguage?: string;
  nativeLanguage?: string;
  llmConfig?: LLMConfig;
  userInquiries?: Array<{ question: string; word?: string; timestamp?: number }>;
  signal?: AbortSignal;
}

export async function generateJitSuggestedActionsService(
  params: GenerateSuggestedActionsRequest
): Promise<Array<{ label: string; action: "send_message"; payload: { message: string } }>> {
  const { word, targetLanguage = "English", nativeLanguage = "Vietnamese", llmConfig, userInquiries, signal } = params;
  if (!word || !word.word) return [];

  if (isStaticHost()) {
    try {
      let inquiryPromptPart = "";
      if (Array.isArray(userInquiries) && userInquiries.length > 0) {
        const qList = userInquiries.slice(-8).map((q, i) => `${i + 1}. "${q.question}"`).join("\n");
        inquiryPromptPart = `The user frequently asks study questions like:\n${qList}\n`;
      }
      const prompt = `The user is studying the word "${word.word}" (Meaning: ${word.translation || word.definition || "N/A"}).
Target Language: ${targetLanguage}. Native Language: ${nativeLanguage}.
${inquiryPromptPart}
Generate exactly 3 highly engaging, personalized suggested action prompts for learning "${word.word}".
Align them with the user's demonstrated learning preferences if available (prepositions, business, nuances, conversation, mnemonics).
Do NOT suggest quizzes or tests.`;

      const sys = `Return 3 interactive suggested actions as valid JSON only.`;
      const schema = `{"suggestedActions": [{"label": "string", "action": "send_message", "payload": {"message": "string"}}]}`;
      const res = await callLLMClientSideWithMeta(prompt, sys, schema, llmConfig);
      const parsed = JSON.parse(res.text);
      if (Array.isArray(parsed?.suggestedActions)) {
        return parsed.suggestedActions.map((a: any) => ({
          label: a.label || a.payload?.message,
          action: "send_message" as const,
          payload: { message: a.payload?.message || a.label }
        }));
      }
    } catch {
      // Fallback
    }
    return [];
  }

  try {
    const res = await fetchWithTimeout("/api/suggested-actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ word, targetLanguage, nativeLanguage, llmConfig, userInquiries }),
      signal
    });
    if (res.ok) {
      const data = await res.json();
      return Array.isArray(data?.suggestedActions) ? data.suggestedActions : [];
    }
  } catch (e) {
    console.warn("Failed to fetch JIT suggested actions:", e);
  }
  return [];
}

export interface QuizGenerationRequest {
  words: Word[];
  targetLanguage?: string;
  nativeLanguage?: string;
  llmConfig?: LLMConfig;
  stats?: UserStats;
  signal?: AbortSignal;
  practiceMode?: "auto" | "story_immersion" | "quiz_only" | "balanced" | "sandwich_quiz" | "sandwich_duel" | "confuser_duel";
}

export interface QuizGenerationResult {
  questions: QuizQuestion[];
  suggestedWords?: QuizSuggestedWord[];
  provider?: string;
  model?: string;
  responseTimeMs?: number;
}

export async function generateAiQuizQuestionsService(
  params: QuizGenerationRequest
): Promise<QuizGenerationResult> {
  const { words, targetLanguage = "English", nativeLanguage = "Vietnamese", llmConfig, signal, practiceMode } = params;
  notifyLlmRequestStartFromConfig(llmConfig);
  const startTime = performance.now();

  if (!words || words.length === 0) {
    return { questions: [] };
  }

  if (!llmConfig || !llmConfig.isLoggedIn) {
    throw new Error("AI provider configuration or login is required to generate quiz questions.");
  }

  const isDuelMode = practiceMode === "confuser_duel" || practiceMode === "sandwich_duel";

  // Strictly deduplicate target words so no equivalent or duplicate words are sent to the AI
  const uniqueInputWords: Word[] = [];
  for (const w of words) {
    if (!uniqueInputWords.some(uw => uw.id === w.id || areWordsEquivalent(uw.word, w.word))) {
      uniqueInputWords.push(w);
    }
  }

  // Strictly enforce maximum 3 target words for faster LLM generation and response latency
  const targetWords = uniqueInputWords.slice(0, 3);
  const expectedCount = targetWords.length;
  const hasAnyNoun = targetWords.some(w => isNoun(w.partOfSpeech));
  const minimalWordList = targetWords.map(w => ({
    word: w.word,
    partOfSpeech: w.partOfSpeech || "",
    definition: w.definition ? String(w.definition).slice(0, 100) : undefined
  }));

  const systemInstruction = `You are a fast, high-accuracy language assessment engine for ${targetLanguage}.
Generate exactly ${expectedCount} targeted quiz question(s) (strictly 1 question per input word, total ${expectedCount} question(s)) in valid JSON.

CORE RULES:
1. Target-Language Immersion: All text, questions, hints, and options MUST be 100% in ${targetLanguage} (no translations in options/questions).
2. Distractor Independence: Options must be plausible external confusers matching the exact part of speech. Never reuse input words as distractors.
3. Correct Answer: MUST strictly equal the target word being tested.
4. STRICT NO DUPLICATE WORDS: Each question MUST test a DIFFERENT, UNIQUE target word from the input list. NEVER generate two questions for the same word.
5. NOUN-ONLY RULE FOR IMAGES:
   - Images and 'picture' questions are STRICTLY RESTRICTED to words whose part of speech is a NOUN.
   - If a word is NOT a noun (e.g. adjective, verb, adverb, preposition), you MUST NEVER use 'picture' type, and 'imageKeyword' MUST be omitted or empty.
   - Do NOT generate a 'picture' question unless the target word is actually a noun.
6. Question Types:
   - 'sentence': Fill-in-the-blank with "______". Include complete 'sentence' (with target word filled in, NEVER with blanks) and 'sentenceTranslation' (${nativeLanguage} full natural translation, NEVER with blanks or placeholders). The 'question' MUST embed the context sentence containing "______".
   - 'definition': Match word to definition.
   - 'picture': Set concise 1-3 word 'imageKeyword' (ONLY FOR NOUNS).
   - 'duel': Pit target word against rival 'confuserWord' with a crisp 1-sentence 'contrastRule'.
     CRITICAL REQUIREMENT FOR 'duel': The 'question' MUST be a contextual fill-in-the-blank sentence where "______" represents the target word in a natural context (e.g. 'Choose the word that accurately fits the context:\n"We ______ finish work at five, but today we stayed late."'). NEVER output a vague instruction like 'Choose the word that best matches the given nuance (_____).' without a complete context sentence!
${isDuelMode 
  ? "   - Duel Mode: ALL questions MUST be 'duel' type with 'confuserWord', 'contrastRule', and a full context sentence containing '______'." 
  : (hasAnyNoun 
      ? "   - Include at least 1 'picture' question with an 'imageKeyword' for a target word that is a NOUN. Other questions must be 'sentence', 'definition', or 'listening' (NEVER use 'duel' type)."
      : "   - Use 'sentence', 'definition', or 'listening' questions (NEVER use 'duel' type, no picture questions since no word is a noun).")}
7. Suggested Words & Phrasal Verbs (FOR EACH INDIVIDUAL QUESTION):
   For EACH individual question, provide a "suggestedWords" array with 2 to 3 practical companion vocabulary items, phrasal verbs, collocations, idioms, or paired expressions in ${targetLanguage} directly relevant to that question.
   - CRITICAL REQUIREMENT FOR CONFUSER DUEL:
     * When generating Confuser Duel practice ('duel' questions), you MUST specifically examine and scan the generated context sentence and example for natural phrasal verbs.
     * Actively incorporate or look for high-value phrasal verbs (e.g., "look forward to", "laugh it off", "trip on", "give up", "break down", "carry out", "turn into", "put off") directly in the context sentence or example.
     * Include the phrasal verb in "suggestedWords", and explicitly categorize it with "category": "phrasal verb" and "partOfSpeech": "phrasal verb"!
   - MULTI-WORD INTEGRITY RULE: For any multi-word expression, phrasal verb, collocation, or idiom, KEEP THE ENTIRE PHRASE INTACT (e.g., "laugh it off", not just "laugh"; "look forward to", not just "look"). DO NOT strip prepositions, pronouns, or particles!
   - For 'duel' questions: include the rival 'confuserWord' (categorized as "contrast_pair"), and specifically look for and categorize phrasal verbs from the context sentence as "phrasal verb".
   - Each suggested word item should provide "word", "translation" (or concise "definition"), "partOfSpeech" (e.g., "phrasal verb"), and "category" (e.g., "phrasal verb", "contrast_pair", "collocation").

Output MUST be strictly valid JSON matching this schema:
{
  "questions": [
    {
      "word": "string (the target word being tested)",
      "partOfSpeech": "string (the part of speech of the word)",
      "type": "definition" | "sentence" | "listening" | "picture" | "duel",
      "question": "string (For 'duel' and 'sentence', MUST be a full context sentence with '______' inside double quotes; NEVER a sentence-less prompt)",
      "options": ["string", "string"],
      "correctAnswer": "string (MUST be exactly the target word itself)",
      "hint": "string",
      "sentence": "string (complete sentence with target word filled in, NEVER with '______' or blanks)",
      "sentenceTranslation": "string (translation in ${nativeLanguage} of complete sentence, NEVER contain blanks or '______')",
      "imageKeyword": "string (ONLY for nouns: 1-3 word English search term, omit/empty for non-nouns)",
      "confuserWord": "string (for duel type)",
      "contrastRule": "string (for duel type)",
      "suggestedWords": [
        {
          "word": "string (companion word, phrasal verb e.g. 'laugh it off', collocation, or idiom intact)",
          "translation": "string (concise translation in ${nativeLanguage} or definition)",
          "partOfSpeech": "string (e.g. 'phrasal verb' when applicable)",
          "category": "string (explicit category/tag: 'phrasal verb', 'contrast_pair', or 'collocation')"
        }
      ]
    }
  ]
}`;

  const prompt = `Generate exactly ${expectedCount} quiz question(s) (strictly 1 question per word, total ${expectedCount}) for:\n${JSON.stringify(minimalWordList)}\n\n` +
    `Requirements:\n` +
    `1. Return exactly ${expectedCount} question(s) (strictly 1 per word). Correct answer MUST be the exact word.\n` +
    `2. CRITICAL: Every question must test a different target word. NEVER generate more than one question for the same word.\n` +
    `3. Distractors must match part of speech; do NOT use other input words as distractors.\n` +
    `4. IMAGES AND PICTURE QUESTIONS: ONLY use 'picture' type or provide 'imageKeyword' if the target word is a NOUN. For adjectives, verbs, adverbs, etc., do NOT use 'picture' type and do NOT provide 'imageKeyword'.\n` +
    (isDuelMode 
      ? `5. ALL questions must be 'duel' with 'confuserWord', 'contrastRule', and a full context sentence containing '______' (never a sentence-less prompt).\n` 
      : (hasAnyNoun 
          ? `5. Include at least 1 'picture' question with 1-3 word 'imageKeyword' for a NOUN target word. Other questions must be 'sentence', 'definition', or 'listening' (do NOT use 'duel').\n`
          : `5. Use 'sentence', 'definition', or 'listening' questions (do NOT use 'duel').\n`)) +
    `6. Suggested words for EACH individual question: Include "suggestedWords" with 2-3 items containing "word", "translation", "partOfSpeech", and "category". CRITICAL FOR CONFUSER DUEL: Specifically examine and scan the generated context sentence and example for phrasal verbs (e.g., "laugh it off", "look forward to", "trip on", "give up", "break down"). Actively include phrasal verbs in "suggestedWords" and explicitly categorize them with category: "phrasal verb" and partOfSpeech: "phrasal verb"! Keep multi-word phrasal verbs intact (do NOT strip prepositions or shorten phrases).\n` +
    `7. CRITICAL NO-BLANK REQUIREMENT FOR SENTENCE & TRANSLATION: "sentence" must be the complete, natural sentence with the target word in place (no blanks). "sentenceTranslation" must be the natural full sentence translation in ${nativeLanguage} with NO blanks, underscores, or placeholders (NEVER put "______" or "(_____)" in sentenceTranslation).`;

  const schemaDesc = `Object with questions: array of exactly ${expectedCount} QuizQuestion objects (1 per word) each containing word, type, question, options, correctAnswer, hint, sentence, sentenceTranslation, imageKeyword, confuserWord, contrastRule, and suggestedWords (array of 2 to 3 items each containing "word", "translation", "partOfSpeech", and "category", explicitly identifying and categorizing phrasal verbs as category "phrasal verb").`;

  let provider = llmConfig?.provider || "gemini";
  let model = sanitizeModel(provider, llmConfig?.model);
  let responseTimeMs: number | undefined = undefined;

  try {
    let rawQuestions: any[] = [];
    let topLevelSuggestions: any[] = [];

    if (isStaticHost()) {
      const resWithMeta = await callLLMClientSideWithMeta(prompt, systemInstruction, schemaDesc, llmConfig, signal);
      const cleaned = cleanJsonResponse(resWithMeta.text);
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed)) {
        rawQuestions = parsed;
      } else if (parsed && typeof parsed === "object") {
        rawQuestions = parsed.questions || [];
        topLevelSuggestions = parsed.suggestedWords || [];
      }
      provider = resWithMeta.provider;
      model = resWithMeta.model;
      responseTimeMs = resWithMeta.responseTimeMs || Math.round(performance.now() - startTime);
    } else {
      const res = await fetchWithTimeout("/api/generate-quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ words: minimalWordList, targetLanguage, nativeLanguage, llmConfig, practiceMode }),
        signal
      });
      if (res.ok) {
        const data = await res.json();
        const endTime = performance.now();
        responseTimeMs = Math.round(endTime - startTime);
        if (Array.isArray(data)) {
          rawQuestions = data;
        } else if (data && typeof data === "object") {
          rawQuestions = data.questions || [];
          topLevelSuggestions = data.suggestedWords || [];
          if (data.provider) provider = data.provider;
          if (data.model) model = data.model;
          if (data.responseTimeMs) responseTimeMs = data.responseTimeMs;
        }
      } else {
        const resWithMeta = await callLLMClientSideWithMeta(prompt, systemInstruction, schemaDesc, llmConfig, signal);
        const cleaned = cleanJsonResponse(resWithMeta.text);
        const parsed = JSON.parse(cleaned);
        if (Array.isArray(parsed)) {
          rawQuestions = parsed;
        } else if (parsed && typeof parsed === "object") {
          rawQuestions = parsed.questions || [];
          topLevelSuggestions = parsed.suggestedWords || [];
        }
        provider = resWithMeta.provider;
        model = resWithMeta.model;
        responseTimeMs = resWithMeta.responseTimeMs || Math.round(performance.now() - startTime);
      }
    }

    // Helper to normalize companion words for an individual question
    const normalizeSuggestionsForQuestion = (rawList: any[], _targetWordText?: string): any[] => {
      if (!Array.isArray(rawList) || rawList.length === 0) return [];
      const seen = new Set<string>();
      const resList: any[] = [];
      for (const item of rawList) {
        const w = typeof item === "string" ? item.trim() : (item.word || item.vocab || item.term || "").trim();
        if (!w) continue;
        const key = w.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);

        const trans = typeof item === "object" ? (item.translation || item.meaning || "") : "";
        const def = typeof item === "object" ? (item.definition || "") : "";
        const rawPos = typeof item === "object" ? item.partOfSpeech : undefined;
        const rawCat = typeof item === "object" ? item.category : undefined;
        const isPv = isPhrasalVerb(w, rawPos, rawCat);
        const finalPos = isPv ? "phrasal verb" : rawPos;
        const finalCat = isPv ? "phrasal verb" : (rawCat || undefined);

        resList.push({
          word: w,
          translation: trans || (!def ? "" : trans),
          definition: def,
          hint: typeof item === "object" ? (item.hint || item.reason || item.relationship || item.usage || "") : "",
          partOfSpeech: finalPos,
          category: finalCat,
          pairedWith: typeof item === "object" && item.pairedWith ? item.pairedWith : undefined
        });

        if (resList.length >= 3) break;
      }
      return resList;
    };

    if (Array.isArray(rawQuestions) && rawQuestions.length > 0) {
      // Build a set of all tested target words to strictly filter out any lazy cross-word distractors
      const allTargetWordKeys = new Set(targetWords.map(w => w.word.toLowerCase().trim()));

      const seenWordKeys = new Set<string>();
      const validQuestions: QuizQuestion[] = [];

      for (let idx = 0; idx < rawQuestions.length; idx++) {
        const q = rawQuestions[idx];
        const qWordLower = String(q.word || q.correctAnswer || "").toLowerCase().trim();

        // Match against targetWords by id or word text
        let matchingWord = targetWords.find(w => 
          (w.id && q.wordId && w.id === q.wordId) || 
          w.word.toLowerCase().trim() === qWordLower || 
          areWordsEquivalent(w.word, q.word || "")
        );

        // If not matched directly, find an untested word
        if (!matchingWord) {
          matchingWord = targetWords.find(w => !seenWordKeys.has(w.word.toLowerCase().trim()));
        }

        if (!matchingWord) continue;

        const targetWordLower = matchingWord.word.toLowerCase().trim();

        // If this target word was already tested in this quiz batch:
        if (seenWordKeys.has(targetWordLower)) {
          // Check if there is an untested word in targetWords
          const unusedWord = targetWords.find(w => !seenWordKeys.has(w.word.toLowerCase().trim()));
          if (!unusedWord) {
            // All words covered, strictly skip this duplicate question
            continue;
          }
          // Untested word exists, generate a rule-based question for the unused word
          seenWordKeys.add(unusedWord.word.toLowerCase().trim());
          const fallbackQs = generateQuizQuestions([unusedWord], targetLanguage);
          if (fallbackQs.length > 0) {
            validQuestions.push(fallbackQs[0]);
          }
          continue;
        }

        seenWordKeys.add(targetWordLower);

        // The correct answer MUST be strictly the target vocabulary word itself being tested
        const correctAns = matchingWord.word;
        const correctAnsLower = correctAns.toLowerCase().trim();

        // 1. Collect sanitized options, strictly rejecting any distractor that is another target word from the quiz
        let cleanOptions: string[] = [correctAns];
        const rawOptions = Array.isArray(q.options) ? q.options : [];

        // If duel, ensure rival confuser word is present in options
        if (isDuelMode && q.confuserWord) {
          const confuserStr = String(q.confuserWord).trim();
          if (confuserStr && confuserStr.toLowerCase() !== correctAnsLower) {
            cleanOptions.push(confuserStr);
          }
        }

        for (const opt of rawOptions) {
          const optStr = String(opt || "").trim();
          const optLower = optStr.toLowerCase();
          if (!optStr) continue;
          if (optLower === correctAnsLower || optLower === targetWordLower) continue;
          if (cleanOptions.some(o => o.toLowerCase().trim() === optLower)) continue;
          // REJECT if option is another target word in this quiz batch!
          if (allTargetWordKeys.has(optLower)) continue;
          cleanOptions.push(optStr);
        }

        // 2. If distractors were insufficient or rejected, generate quality confusers
        const minOptionsNeeded = isDuelMode ? 2 : 4;
        if (cleanOptions.length < minOptionsNeeded) {
          const extraDistractors = generateConfusers(matchingWord.word);
          for (const d of extraDistractors) {
            if (cleanOptions.length >= minOptionsNeeded) break;
            const dLower = d.toLowerCase().trim();
            if (!cleanOptions.some(o => o.toLowerCase().trim() === dLower) && !allTargetWordKeys.has(dLower)) {
              cleanOptions.push(d);
            }
          }
        }

        // 3. Fallback suffix/morph confusers if still under required options
        const fallbackSuffixes = ["ing", "ed", "er", "ly", "tion", "ment", "ness", "s", "al"];
        let suffixIdx = 0;
        while (cleanOptions.length < minOptionsNeeded && suffixIdx < fallbackSuffixes.length) {
          const candidate = `${matchingWord.word}${fallbackSuffixes[suffixIdx++]}`;
          const cLower = candidate.toLowerCase().trim();
          if (!cleanOptions.some(o => o.toLowerCase().trim() === cLower) && !allTargetWordKeys.has(cLower)) {
            cleanOptions.push(candidate);
          }
        }

        const isQuestionDuel = isDuelMode;
        const questionType = isQuestionDuel ? 'duel' : (q.type === 'duel' ? (matchingWord.example ? 'sentence' : 'definition') : (q.type || 'definition'));

        const wordIsNoun = isNoun(matchingWord.partOfSpeech || q.partOfSpeech);
        const resolvedType = (questionType === "picture" && !wordIsNoun) ? (matchingWord.example ? "sentence" : "definition") : questionType;

        const keywordText = (wordIsNoun && (resolvedType === 'picture' || q.imageKeyword)) 
          ? (q.imageKeyword || getImageKeyword(matchingWord)) 
          : undefined;

        const existingWordImages = wordIsNoun ? [
          ...(matchingWord.imageUrls || []),
          ...(matchingWord.imageUrl ? [matchingWord.imageUrl] : [])
        ].map(u => String(u || "").trim()).filter(Boolean) : [];

        let imgUrl: string | undefined = undefined;
        if (wordIsNoun && existingWordImages.length > 0 && (resolvedType === 'picture' || q.imageUrl || keywordText)) {
          imgUrl = existingWordImages[Math.floor(Math.random() * existingWordImages.length)];
        } else if (wordIsNoun && q.imageUrl && q.imageUrl.startsWith("http")) {
          imgUrl = q.imageUrl;
        } else if (wordIsNoun && keywordText) {
          imgUrl = `https://image.nclong87.workers.dev?query=${encodeURIComponent(keywordText)}`;
        }

        const fallbackSentence = (q.sentence && isQuestionSentenceValid(q.sentence))
          ? q.sentence
          : (matchingWord.example && isQuestionSentenceValid(matchingWord.example))
          ? matchingWord.example
          : undefined;

        let rawQuestion = q.question;
        if (!rawQuestion || !isQuestionSentenceValid(rawQuestion)) {
          if (isQuestionDuel) {
            rawQuestion = ensureQuestionHasBlank("", matchingWord.word, fallbackSentence, matchingWord.partOfSpeech || q.partOfSpeech);
          } else if (resolvedType === 'sentence') {
            rawQuestion = ensureQuestionHasBlank("", matchingWord.word, fallbackSentence, matchingWord.partOfSpeech || q.partOfSpeech);
          } else {
            rawQuestion = `Which word matches: ${matchingWord.definition || matchingWord.word}`;
          }
        } else if (resolvedType === 'duel' || resolvedType === 'sentence' || /confuser duel|fill in the blank/i.test(rawQuestion)) {
          rawQuestion = ensureQuestionHasBlank(rawQuestion, matchingWord.word, fallbackSentence, matchingWord.partOfSpeech || q.partOfSpeech);
        }

        let resolvedSentence = q.sentence || (matchingWord.example ? matchingWord.example : undefined);
        const blankPlaceholderRegex = /\[blank\]|\[BLANK\]|\(\s*_{2,}\s*\)|\(_+\)|_{2,}|\.{3,}/gi;
        if (!resolvedSentence || !isQuestionSentenceValid(resolvedSentence)) {
          if (rawQuestion.includes("______")) {
            const quoteMatch = rawQuestion.match(/"([^"]+)"/);
            if (quoteMatch && quoteMatch[1]) {
              resolvedSentence = quoteMatch[1].replace("______", correctAns);
            } else {
              resolvedSentence = rawQuestion.replace("______", correctAns);
            }
          } else {
            resolvedSentence = getDefaultContextSentence(correctAns, matchingWord.partOfSpeech || q.partOfSpeech);
          }
        }
        if (resolvedSentence && blankPlaceholderRegex.test(resolvedSentence)) {
          resolvedSentence = resolvedSentence.replace(blankPlaceholderRegex, correctAns);
        }

        let resolvedSentenceTranslation = q.sentenceTranslation || matchingWord.exampleTranslation || undefined;
        if (resolvedSentenceTranslation && blankPlaceholderRegex.test(resolvedSentenceTranslation)) {
          const primaryTrans = (matchingWord.translation || "").split(/[;,\/]/)[0].trim() || matchingWord.translation || correctAns;
          resolvedSentenceTranslation = resolvedSentenceTranslation.replace(blankPlaceholderRegex, primaryTrans);
        }

        const rawQuestionSuggestions = Array.isArray(q.suggestedWords)
          ? q.suggestedWords
          : Array.isArray(q.suggestedVocabulary)
          ? q.suggestedVocabulary
          : Array.isArray(q.collocations)
          ? q.collocations
          : [];

        let qSuggestions = normalizeSuggestionsForQuestion(rawQuestionSuggestions, matchingWord.word);

        // Fallback 1: check topLevelSuggestions if question didn't yield suggestions
        if (qSuggestions.length === 0 && topLevelSuggestions.length > 0) {
          qSuggestions = normalizeSuggestionsForQuestion(topLevelSuggestions, matchingWord.word);
        }

        // Fallback 2: check matchingWord in user's collection
        if (qSuggestions.length === 0 && matchingWord && Array.isArray(matchingWord.suggestedWords) && matchingWord.suggestedWords.length > 0) {
          qSuggestions = normalizeSuggestionsForQuestion(matchingWord.suggestedWords, matchingWord.word);
        }

        // Fallback 3: for Duel questions, ensure rival confuser word is included in suggested words!
        if (isQuestionDuel || q.confuserWord) {
          const confuserStr = String(q.confuserWord || "").trim();
          if (confuserStr && !qSuggestions.some(s => s.word.toLowerCase() === confuserStr.toLowerCase())) {
            let cleanRivalDef = "";
            if (q.contrastRule) {
              const escapedRival = confuserStr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
              const m = q.contrastRule.match(
                new RegExp(`(?:while|whereas)?\\s*(?:a|an)?\\s*['"]?${escapedRival}['"]?\\s*(?:refers to|means|is defined as|denotes|is)\\s*([^.;]+)`, "i")
              );
              if (m && m[1]) {
                cleanRivalDef = m[1].trim();
              } else {
                cleanRivalDef = q.contrastRule;
              }
            }
            qSuggestions.unshift({
              word: confuserStr,
              translation: "",
              definition: cleanRivalDef,
              partOfSpeech: matchingWord.partOfSpeech,
              category: "contrast_pair",
              pairedWith: matchingWord.word
            });
          }
        }

        // Fallback 4: Extract phrasal verbs, idioms, and collocations from resolvedSentence (e.g. "laugh it off", "trip on", "liaise with")
        if (resolvedSentence && matchingWord.word) {
          const extracted = extractPhrasalVerbsAndCollocationsFromSentence(
            resolvedSentence,
            matchingWord.word,
            qSuggestions.map(s => s.word),
            nativeLanguage
          );
          for (const item of extracted) {
            if (qSuggestions.some(s => s.word.toLowerCase() === item.word.toLowerCase())) continue;
            if (item.partOfSpeech === "phrasal verb") {
              item.category = "phrasal verb";
            }
            if (qSuggestions.length < 3) {
              qSuggestions.push(item);
            } else if (item.partOfSpeech === "phrasal verb") {
              // Prioritize a vivid phrasal verb from the context sentence over a trailing generic synonym
              qSuggestions[qSuggestions.length - 1] = item;
            }
          }
        }

        validQuestions.push({
          id: q.id || `ai-q-${matchingWord.id}-${idx}`,
          wordId: matchingWord.id,
          word: matchingWord.word,
          partOfSpeech: matchingWord.partOfSpeech || q.partOfSpeech,
          type: resolvedType,
          question: rawQuestion,
          options: cleanOptions.sort(() => 0.5 - Math.random()),
          correctAnswer: correctAns,
          hint: q.hint || (isQuestionDuel ? `Contrast duel: '${matchingWord.word}' vs '${q.confuserWord || "rival"}'` : matchingWord.pronunciation),
          sentence: resolvedSentence,
          sentenceTranslation: resolvedSentenceTranslation,
          imageKeyword: keywordText,
          imageUrl: imgUrl,
          suggestedWords: qSuggestions.length > 0 ? qSuggestions.slice(0, 3) : [],
          confuserWord: isQuestionDuel ? (q.confuserWord || undefined) : undefined,
          contrastRule: isQuestionDuel ? (q.contrastRule || undefined) : undefined
        });
      }

      // If any target words were missed by the LLM, fill them with rule-based questions
      for (const w of targetWords) {
        const key = w.word.toLowerCase().trim();
        if (!seenWordKeys.has(key) && validQuestions.length < 3) {
          seenWordKeys.add(key);
          const fallbackQs = generateQuizQuestions([w], targetLanguage);
          if (fallbackQs.length > 0) {
            validQuestions.push(fallbackQs[0]);
          }
        }
      }

      // Guarantee at least one picture or image-based question in the generated quiz ONLY if there is a noun (unless duel mode)
      if (!isDuelMode && hasAnyNoun) {
        const hasPictureQuestion = validQuestions.some(q => q.type === 'picture');
        if (!hasPictureQuestion && validQuestions.length > 0) {
          const nounQ = validQuestions.find(q => {
            const mw = words.find(w => w.id === q.wordId || w.word.toLowerCase() === q.word.toLowerCase());
            return isNoun(q.partOfSpeech || mw?.partOfSpeech);
          });
          if (nounQ) {
            const matchingWord = (words && (words.find(w => w.id === nounQ.wordId || w.word.toLowerCase() === nounQ.word.toLowerCase()) || words[0])) || { word: "Vocabulary", pronunciation: "" } as Word;
            nounQ.type = 'picture';
            nounQ.question = "Which word matches the visual concept shown below?";
            nounQ.imageKeyword = getImageKeyword(matchingWord);

            const existingWordImages = [
              ...(matchingWord.imageUrls || []),
              ...(matchingWord.imageUrl ? [matchingWord.imageUrl] : [])
            ].map(u => String(u || "").trim()).filter(Boolean);

            if (existingWordImages.length > 0) {
              nounQ.imageUrl = existingWordImages[Math.floor(Math.random() * existingWordImages.length)];
            } else if (nounQ.imageKeyword) {
              nounQ.imageUrl = `https://image.nclong87.workers.dev?query=${encodeURIComponent(nounQ.imageKeyword)}`;
            }
          }
        }
      }

      if (provider && model && responseTimeMs) {
        recordModelResponse(provider, model, responseTimeMs);
      }

      return {
        questions: validQuestions.slice(0, 3),
        provider,
        model,
        responseTimeMs
      };
    }
    throw new Error("Failed to generate quiz questions from AI provider. Please try again or switch model.");
  } catch (err: any) {
    console.warn("AI Quiz Generation failed:", err);
    throw err;
  }
}

/**
 * Service to analyze image for vocabulary using Cloudflare worker
 */
export async function analyzeImageVocabService(params: {
  imageDataUrl: string;
  customPrompt?: string;
  targetLanguage: string;
  nativeLanguage: string;
  llmConfig?: LLMConfig;
  signal?: AbortSignal;
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
  let { imageDataUrl, targetLanguage, nativeLanguage, llmConfig, signal } = params;
  notifyLlmRequestStartFromConfig(llmConfig);

  // Resize client-side before sending to server or worker if image is large
  if (typeof window !== "undefined" && imageDataUrl && imageDataUrl.startsWith("data:image")) {
    try {
      imageDataUrl = await resizeImageDataUrl(imageDataUrl, 1600, 0.85);
    } catch (resizeErr) {
      console.warn("Client side image resize warning:", resizeErr);
    }
  }

  let serverOrWorkerError: any = null;
  const provider = llmConfig?.provider || "gemini";
  const model = sanitizeModel(provider, llmConfig?.model);
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

  const userText = `Analyze this image for vocabulary learning in "${targetLanguage}" for a native "${nativeLanguage}" speaker.\nIdentify key objects, text, signs, items, actions, or scenes present in the image.\nCRITICAL VERB & COLLOCATION RULE: For verbs or actions identified in the image, provide the verb with its natural dependent preposition or collocation (e.g., "gaze at", "lean against", "listen to", "reach for", "pour into", "focus on") rather than bare isolated verbs.`;

  // 1. Attempt call through Node server API route if not running on static host
  if (!isStaticHost()) {
    try {
      const res = await fetchWithTimeout("/api/analyze-image-vocab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageDataUrl, systemPrompt, userText, provider, model }),
        signal
      });
      if (res.ok) {
        const data = await res.json();
        const responseTimeMs = data.responseTimeMs || Math.round(performance.now() - startTime);
        logApiRequest({
          provider,
          model,
          prompt: userText,
          systemInstruction: systemPrompt,
          response: JSON.stringify(data),
          responseTimeMs,
          status: "success",
          statusCode: 200,
          action: "Image Analysis"
        }).catch(() => undefined);
        return {
          ...data,
          provider,
          model,
          responseTimeMs
        };
      }
      const errorJson = await res.json().catch(() => null);
      const rawErrText = errorJson ? JSON.stringify(errorJson) : "";
      const errMsg = errorJson?.error || `Server API analyze-image-vocab failed with status ${res.status}`;
      logApiRequest({
        provider,
        model,
        prompt: userText,
        systemInstruction: systemPrompt,
        response: rawErrText || errMsg,
        rawResponse: rawErrText || undefined,
        responseTimeMs: Math.round(performance.now() - startTime),
        status: "error",
        statusCode: res.status,
        errorMessage: errMsg,
        action: "Image Analysis"
      }).catch(() => undefined);
      throw new Error(errMsg);
    } catch (e: any) {
      console.error("Server API analyze-image-vocab failed:", e);
      throw e;
    }
  }

  // 2. Direct client-side call to Cloudflare Worker
  let base64Data = imageDataUrl;
  if (imageDataUrl.startsWith("data:")) {
    const parts = imageDataUrl.split(";base64,");
    base64Data = parts[1] || imageDataUrl;
  }

  const sharedProxyKey = getStoredAccessCode() || llmConfig?.apiKey || "";

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
      imageData: base64Data,
      systemPrompt,
      userText,
      provider,
      model
    }),
    signal
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
      recordModelResponse(provider, model, duration);
      logApiRequest({
        provider,
        model,
        prompt: userText,
        systemInstruction: systemPrompt,
        response: rawText,
        responseTimeMs: duration,
        status: "success",
        statusCode: 200,
        action: "Image Analysis"
      }).catch(() => undefined);
      return {
        ...data,
        provider,
        model,
        responseTimeMs: duration
      };
    }
  } else {
    const errText = await workerRes.text().catch(() => workerRes.statusText);
    serverOrWorkerError = new Error(`Image Analysis Worker Error (${workerRes.status}): ${errText}`);
    (serverOrWorkerError as any).rawResponse = errText;
    logApiRequest({
      provider,
      model,
      prompt: userText,
      systemInstruction: systemPrompt,
      response: errText || serverOrWorkerError.message,
      rawResponse: errText || undefined,
      responseTimeMs: Math.round(performance.now() - startTime),
      status: "error",
      statusCode: workerRes.status,
      errorMessage: serverOrWorkerError.message,
      action: "Image Analysis"
    }).catch(() => undefined);
  }
  
  throw serverOrWorkerError || new Error("Image analysis failed without a specific error.");
}

export interface SuggestReplyRequest {
  imageDataUrl: string | null;
  customPrompt: string;
  targetLanguage: string;
  nativeLanguage: string;
  llmConfig?: LLMConfig;
  signal?: AbortSignal;
}

export interface SuggestReplyResult {
  suggestedReplies: Array<{
    reply: string;
    translation: string;
    tone: string;
    explanation: string;
  }>;
  vocabularyCandidates?: Array<{
    word: string;
    translation: string;
    reason: string;
  }>;
  suggestedWords?: Array<{
    word: string;
    definition?: string;
    translation?: string;
    partOfSpeech?: string;
    reason?: string;
    hint?: string;
  }>;
  provider?: string;
  model?: string;
  responseTimeMs?: number;
}

export async function suggestCasualReplyService(params: SuggestReplyRequest): Promise<SuggestReplyResult> {
  const { imageDataUrl, customPrompt, targetLanguage, nativeLanguage, llmConfig, signal } = params;
  notifyLlmRequestStartFromConfig(llmConfig);
  const startTime = performance.now();

  const userTarget = targetLanguage || "English";
  const userNative = nativeLanguage || "Vietnamese";

  let userText = '';

  if (imageDataUrl) {
    userText += `\n\nAnalyze the attached conversation screenshot image to understand the context and flow, then provide customized replies.`;
  } else {
    userText += `\n\nAnalyze the provided text prompt to understand the context and flow, then provide customized replies.`;
  }

  if (customPrompt) {
    userText += `\n\nUser guidance/instruction: "${customPrompt}"`;
  }

  userText += `\n\nCRITICAL DIRECTIVES:
- NO REASONING OR THINKING: Do not include any chain of thought, reasoning, thinking process, explanation of reasoning, or commentary in your response. Do not use '<think>' tags or similar blocks. Output strictly valid raw JSON and absolutely nothing else.
- SUGGESTED WORDS: Provide a "suggestedWords" array with 2 to 3 practical companion vocabulary items in "${userTarget}".
  SPEED OPTIMIZATION: Return ONLY "word" and "translation" (or concise "definition"). Do NOT output definition sentences, partOfSpeech, or reason fields.`;

  const schemaDesc = `{
    "suggestedReplies": [
      {
        "reply": "string (The suggested response in \"${userTarget}\". Keep them sounding highly natural, native, and casual.)",
        "translation": "string (exact translation in \"${userNative}\")",
        "tone": "string (tone/vibe description)",
        "explanation": "string (nuance/usage explanation in \"${userNative}\")"
      }
    ],
    "suggestedWords": [
      {
        "word": "string (useful vocabulary term or collocation in ${userTarget})",
        "translation": "string (translation in ${userNative} or concise definition)"
      }
    ]
  }`;

  const systemPrompt = `You are a friendly, natural AI Language Coach. Analyze the conversation or guiding prompt, and suggest natural casual replies in "${userTarget}" (with translation, tone description, and nuance/usage explanations in "${userNative}") and candidate vocabulary words. Output MUST be strictly valid raw JSON-only matching the schema, with absolutely no thinking process, chain-of-thought, '<think>' tags, reasoning text, or conversational commentary included. Do not use any markdown code blocks: \n
${schemaDesc}`;

  const provider = llmConfig?.provider || "gemini";
  const model = sanitizeModel(provider, llmConfig?.model);

  // 1. Try server API route if not running on static host
  if (!isStaticHost()) {
    try {
      const res = await fetchWithTimeout("/api/suggest-casual-reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageDataUrl, systemPrompt, userText, provider, model }),
        signal
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
      const errorJson = await res.json().catch(() => null);
      throw new Error(errorJson?.error || `Server API suggest-casual-reply failed with status ${res.status}`);
    } catch (e: any) {
      console.error("Server API suggest-casual-reply failed:", e);
      throw e;
    }
  }
  let rawText = "";
  try {
    if (imageDataUrl) {
      let base64Data = imageDataUrl;
      if (imageDataUrl.startsWith("data:")) {
        const parts = imageDataUrl.split(";base64,");
        base64Data = parts[1] || imageDataUrl;
      }

      const sharedProxyKey = getStoredAccessCode();

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
          imageData: base64Data,
          systemPrompt,
          userText,
          provider,
          model
        }),
        signal
      });

      if (!workerRes.ok) {
        const errText = await workerRes.text().catch(() => workerRes.statusText);
        throw new Error(`Image Analysis Worker Error (${workerRes.status}): ${errText}`);
      }

      rawText = await workerRes.text();
    } else {
      // no image, just use the prompt directly with the LLM
      const resWithMeta = await callLLMClientSideWithMeta(userText, systemPrompt, schemaDesc, llmConfig, signal);
      rawText = resWithMeta.text;
    }

    if (rawText) {
      const cleaned = cleanJsonResponse(rawText);
      const parsed = JSON.parse(cleaned);
      if (parsed && (parsed.suggestedReplies || parsed.vocabularyCandidates)) {
        const duration = Math.round(performance.now() - startTime);
        return {
          ...parsed,
          provider: provider,
          model: model,
          responseTimeMs: duration
        };
      }
    }

    throw new Error("Image analysis worker did not return valid JSON with suggestedReplies and vocabularyCandidates.");
  } catch (err: any) {
    console.error("Client side suggest casual reply error:", err);
    throw err;
  }
}

