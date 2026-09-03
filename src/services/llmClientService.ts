import { LLMConfig, Word, QuizQuestion, UserStats, SuggestedVocabularyWord, FlashcardItem, SuggestedPairedWord } from "../types";
import { generateConfusers, getImageKeyword } from "../utils/quizGenerator";
import {  resizeImageDataUrl } from "../utils/llmHelpers";
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
    if (healthy.length > 0) {
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
        const msg = data.choices[0].message || data.choices[0].delta || {};
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

// 2b. Generate Image Search Query Parameter using LLM
export async function generateImageSearchQueryService(params: {
  word: string;
  definition?: string;
  context?: string;
  partOfSpeech?: string;
  placeholderIndex?: number;
  cfg?: LLMConfig;
  signal?: AbortSignal;
}): Promise<string> {
  const { word, definition, context, partOfSpeech, placeholderIndex = 1, cfg, signal } = params;
  const llmConfig = getOverrideConfig(cfg);
  notifyLlmRequestStartFromConfig(llmConfig);

  const slotDescriptions = [
    "a direct main subject visual depiction",
    "a realistic photo showing the word in action or real-world setting",
    "a clear illustration or creative visual flashcard depiction"
  ];
  const slotHint = slotDescriptions[(placeholderIndex - 1) % 3] || "a clear visual clue";

  const prompt = `Vocabulary Word: "${word}"
Part of Speech: "${partOfSpeech || 'noun'}"
Definition: "${definition || ''}"
Context/Usage: "${context || ''}"

Goal: Generate a concise, highly specific 1-3 word English visual search query term for fetching an image from an image search API for placeholder #${placeholderIndex} (${slotHint}).
Output MUST be strictly JSON format: {"query": "search_query_here"}`;

  const systemInstruction = "You are a helpful dictionary visual search assistant. Generate a short 1-3 word query term for image search in JSON format. Do not include markdown code block formatting outside the JSON.";
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

  // Fallback query if LLM fails or is offline
  const cleanWord = word.includes(",") ? word.split(",")[0].trim() : word.trim();
  if (placeholderIndex === 2) return `${cleanWord} photo`;
  if (placeholderIndex === 3) return `${cleanWord} illustration`;
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
- "suggestedWords": Array of 1 or 2 practical vocabulary words or collocations in "${userTarget}" that people frequently pair or use together with this word in natural contexts.
  CRITICAL VERB & COLLOCATION RULE: For verbs or verb-derived phrases, prioritize natural verb + dependent preposition collocations (e.g. "cure for", "elaborate on", "rely on", "participate in", "deal with", "benefit from") rather than bare verbs, so learners master the complete prepositional pattern. Do NOT include or repeat the current word itself in the suggested words. ALWAYS output each suggested word as an object containing "word", "definition" (short definition in ${userTarget}), and "translation" (translation in ${userNative}). Example: for "cure" -> [{"word": "cure for", "definition": "A remedy or solution that restores health or fixes a condition", "translation": "phương thuốc chữa cho"}, {"word": "elaborate on", "definition": "To add more detail or explain further", "translation": "nói chi tiết về"}].`;

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
      "definition": "string (short definition in ${userTarget})",
      "translation": "string (translation in ${userNative})"
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
     "suggestedWords": Array of exactly 1 or 2 practical vocabulary words/collocations in "${userTarget}" that people frequently pair or use together with this word in natural contexts. CRITICAL: For verbs or actions, prioritize natural verb + dependent preposition collocations (e.g. "cure for", "elaborate on", "rely on", "participate in", "benefit from", "cope with") rather than bare verbs. Do NOT include or repeat the current word itself in the suggested words; output just the companion/paired words (e.g. for "cure" -> ["cure for", "remedy"]; for "elaborate" -> ["elaborate on", "details"]; for "apple" -> ["crisp", "orchard"]; for "acquire" -> ["acquire knowledge", "skill"]; for "mitigate" -> ["mitigate risk", "impact"]),
     "imageKeyword": string (MUST be in English, 1-3 words, representing a highly concrete, visual, physical object or action that symbolizes the word for Unsplash image search. Avoid abstract concepts. Examples: for "ephemeral" use "soap bubble", for "serendipity" use "four leaf clover", for "understand" use "light bulb", for "gregarious" use "friends cafe"),
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
      "definition": "string (short definition in ${userTarget})",
      "translation": "string (translation in ${userNative})"
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
      "imageKeyword": "string (MUST be in English, highly focused 1-3 word concrete visual concept/object that symbolizes the word for Unsplash image search)",
      "category": "string",
      "context": "string",
      "suggestedWords": [
        {
          "word": "string (vocabulary word in ${userTarget} commonly paired with this word)",
          "definition": "string (short definition in ${userTarget})",
          "translation": "string (translation in ${userNative})"
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
  vocabularyCandidates: {
    word: string;
    definition?: string;
    translation?: string;
    reason: string;
  }[];
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
3. "vocabularyCandidates": Identify 1 to 4 valuable candidate vocabulary words, collocations, or expressions from EITHER the user's input or the fixed sentence that are worth learning in "${userTarget}".
  CRITICAL VERB & PREPOSITION RULE: For any verb candidates, always suggest the verb together with its dependent preposition or key collocation (e.g. "elaborate on", "apologize for", "prevent from", "insist on", "comply with", "cure for", "rely on") instead of bare isolated verbs.
  PRIORITY RULE: If the user's input contains misspelled words, prioritize those first as vocabulary candidates.
  - For misspelled candidates, set "word" to the corrected form in "${userTarget}" and mention the original misspelling in "reason".
  - If there are multiple misspellings, rank them before other candidate words.
   For each candidate, provide:
   - "word": string (the target language word or expression, with dependent prepositions for verbs)
   - "definition": string (clear, concise definition written strictly in ${userTarget})
   - "translation": string (direct translation into user's native language ${userNative})
   - "reason": string (a short, clear 1-line reason why this word/expression is a great candidate to add to their vocabulary collection)
`;

  const systemInstruction = `You are a friendly, natural AI Language Coach. Polish sentences, improve flow, and fix grammar & spelling with a casual tone, suggesting candidate vocabulary words for the user's collection. Output strictly valid JSON-only output matching the schema when requested. Do not include any conversational filler outside the JSON.`;
  const schemaDesc = `{
  "fixedSentence": "string",
  "explanation": "string (markdown formatted casual explanation)",
  "vocabularyCandidates": [
    {
      "word": "string (target word in ${userTarget})",
      "definition": "string (definition written strictly in ${userTarget})",
      "translation": "string (direct translation in ${userNative})",
      "reason": "string (short reason)"
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

// 4. Analyze Performance with AI Service
export interface RecommendedPracticeWord {
  word: string;
  translation: string;
  reason: string;
  type: 'recently_used' | 'never_used';
  strength?: number;
  priority?: 'high' | 'medium';
  mnemonic?: string;
  etymology?: string;
  exampleSentence?: string;
  exampleTranslation?: string;
  commonTrap?: string;
  pos?: string;
  riskLevel?: 'critical' | 'high' | 'moderate';
}

export interface PerformanceAnalysisRequest {
  stats: any;
  totalWords: number;
  masteredWords?: any[];
  improvingWords?: any[];
  recentlyUsedWords?: any[];
  neverUsedWords?: any[];
  allWords?: any[];
  targetLanguage?: string;
  nativeLanguage?: string;
  llmConfig?: LLMConfig;
}

export interface PerformanceAnalysisResult {
  overallAssessment: string;
  strengthsSummary: string;
  weaknessesSummary: string;
  actionableTips: string[];
  recommendedFocusTopics: string[];
  topPracticeWords?: RecommendedPracticeWord[];
  motivationQuote: string;
  cefrLevel?: string;
  retentionHealthScore?: number;
  forgettingRiskSummary?: string;
  contextStory?: {
    title: string;
    story: string;
    storyTranslation?: string;
    featuredWords: string[];
  };
  diagnosticBadges?: {
    label: string;
    value: string;
    tone?: 'emerald' | 'amber' | 'indigo' | 'rose';
  }[];
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
      topPracticeWords: [],
      actionableTips: ["Review weak terms daily", "Take quick practice quizzes", "Use spaced repetition"],
      recommendedFocusTopics: ["Core Vocabulary"],
      motivationQuote: "Consistency in practice builds lasting language fluency.",
      cefrLevel: "B1 Intermediate",
      retentionHealthScore: 75
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

  // Parse Top Practice Words (Top 10 words to practice: recently used and never used)
  let topPracticeWords: RecommendedPracticeWord[] = [];
  const rawPractice = raw.topPracticeWords || raw.top_practice_words || raw.topWordsToPractice || raw.practiceWords || raw.practice_words || raw.recommendedPracticeWords || raw.top_10_words || raw.wordsToPractice;
  if (Array.isArray(rawPractice)) {
    topPracticeWords = rawPractice.slice(0, 10).map((item: any) => {
      if (typeof item === "string") {
        return {
          word: item,
          translation: "",
          reason: "Recommended for practice",
          type: "recently_used" as const,
          strength: 20,
          priority: "high" as const
        };
      }
      const rawType = String(item.type || item.category || item.status || "").toLowerCase();
      const isNeverUsed = rawType.includes("never") || rawType.includes("new") || rawType.includes("untouched") || item.strength === 0 || item.lastReviewed === null;
      const type: 'recently_used' | 'never_used' = isNeverUsed ? 'never_used' : 'recently_used';
      const strength = typeof item.strength === "number" ? Math.max(0, Math.min(100, item.strength)) : (isNeverUsed ? 0 : 30);
      
      const riskLevel: 'critical' | 'high' | 'moderate' = 
        strength <= 20 ? 'critical' : strength <= 45 ? 'high' : 'moderate';

      return {
        word: String(item.word || item.name || item.term || "").trim(),
        translation: String(item.translation || item.meaning || item.definition || "").trim(),
        reason: String(item.reason || item.note || item.explanation || (isNeverUsed ? "Never practiced yet - start initial recall" : "Needs reinforcement and practice")).trim(),
        type,
        strength,
        priority: (item.priority === "medium" ? "medium" : "high") as 'high' | 'medium',
        mnemonic: item.mnemonic || item.memory_hook || item.hook || item.memoryHook || undefined,
        etymology: item.etymology || item.roots || item.word_origin || item.origin || undefined,
        exampleSentence: item.exampleSentence || item.example || item.example_sentence || item.sentence || undefined,
        exampleTranslation: item.exampleTranslation || item.example_translation || item.sentence_translation || undefined,
        commonTrap: item.commonTrap || item.common_trap || item.trap || item.pitfall || item.false_friend || undefined,
        pos: item.pos || item.partOfSpeech || item.part_of_speech || undefined,
        riskLevel
      };
    }).filter((item: RecommendedPracticeWord) => Boolean(item.word));
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

  // Parse CEFR Level & Retention Score
  const cefrLevel = raw.cefrLevel || raw.cefr_level || raw.proficiency_level || raw.student_level || "B1 Intermediate";
  const retentionHealthScore = typeof raw.retentionHealthScore === "number" 
    ? Math.max(10, Math.min(100, raw.retentionHealthScore)) 
    : typeof raw.retention_score === "number"
    ? Math.max(10, Math.min(100, raw.retention_score))
    : undefined;

  const forgettingRiskSummary = raw.forgettingRiskSummary || raw.forgetting_risk_summary || raw.risk_forecast || undefined;

  // Context Story
  let contextStory: PerformanceAnalysisResult['contextStory'] = undefined;
  const rawStory = raw.contextStory || raw.context_story || raw.micro_story || raw.story;
  if (rawStory && typeof rawStory === "object") {
    contextStory = {
      title: rawStory.title || "AI Context Immersion Story",
      story: rawStory.story || rawStory.text || rawStory.paragraph || "",
      storyTranslation: rawStory.storyTranslation || rawStory.translation || rawStory.meaning || undefined,
      featuredWords: Array.isArray(rawStory.featuredWords || rawStory.featured_words || rawStory.target_words) 
        ? (rawStory.featuredWords || rawStory.featured_words || rawStory.target_words) 
        : []
    };
  }

  return {
    overallAssessment: overallAssessment || "Your vocabulary practice shows steady progress and active momentum.",
    strengthsSummary: strengthsSummary || "Demonstrating solid recall on core vocabulary terms.",
    weaknessesSummary: weaknessesSummary || "Focus on terms with lower strength scores and terms needing review.",
    topPracticeWords: topPracticeWords.length > 0 ? topPracticeWords : undefined,
    actionableTips: actionableTips.length > 0 ? actionableTips : ["Review weak terms daily", "Practice with active quizzes", "Focus on spaced repetition"],
    recommendedFocusTopics: recommendedFocusTopics.length > 0 ? recommendedFocusTopics : ["Core Vocabulary"],
    motivationQuote: motivationQuote || "Consistency in practice builds lasting language fluency.",
    cefrLevel,
    retentionHealthScore,
    forgettingRiskSummary,
    contextStory,
    provider: raw.provider,
    model: raw.model,
    responseTimeMs: raw.responseTimeMs
  };
}

export async function analyzePerformanceService(params: PerformanceAnalysisRequest): Promise<PerformanceAnalysisResult> {
  const { 
    stats, 
    totalWords, 
    masteredWords = [], 
    improvingWords = [], 
    recentlyUsedWords = [], 
    neverUsedWords = [],
    targetLanguage = "English",
    nativeLanguage = "Vietnamese",
    llmConfig: cfg 
  } = params;
  const llmConfig = getOverrideConfig(cfg);
  notifyLlmRequestStartFromConfig(llmConfig);
  const startTime = performance.now();

  const masteredSampleStr = (masteredWords || []).slice(0, 15).map((w: any) => `${w.word} (${w.translation || w.definition})`).join(", ") || "None yet";
  const improvingSampleStr = (improvingWords || []).slice(0, 15).map((w: any) => `${w.word} (strength ${w.strength ?? 0}/100, ${w.translation || w.definition})`).join(", ") || "None yet";
  const recentlyUsedStr = (recentlyUsedWords || []).slice(0, 15).map((w: any) => `${w.word} (strength ${w.strength ?? 0}/100, last reviewed: ${w.lastReviewed || 'recently'}, ${w.translation || w.definition})`).join(", ") || "None recorded";
  const neverUsedStr = (neverUsedWords || []).slice(0, 15).map((w: any) => `${w.word} (strength 0/100, never reviewed yet, ${w.translation || w.definition})`).join(", ") || "None (all words have been practiced)";

  const prompt = `You are an elite AI Language Learning Coach & Vocabulary Analyst. Analyze the following student performance data and provide a personalized, deeply insightful analytics report with a curated list of the TOP 10 WORDS THE LEARNER NEEDS TO PRACTICE.

STUDENT PERFORMANCE DATA:
- Target Language: ${targetLanguage}
- Native Explanation Language: ${nativeLanguage}
- Total Vocabulary Words in Collection: ${totalWords || 0}
- Total Words Mastered: ${(masteredWords || []).length}
- Total Words Studied/Reviewed: ${(masteredWords || []).length + (improvingWords || []).filter((w: any) => w.lastReviewed !== null || (w.strength ?? 0) > 0).length}
- Total Words Never Practiced / Untouched: ${(neverUsedWords || []).length}
- Quizzes Completed: ${stats?.totalQuizzesTaken || 0}
- Correct Answers in Quizzes: ${stats?.totalCorrectAnswers || 0}
- Active Study Streak: ${stats?.streak?.count || 0} days

1. WORDS USED/REVIEWED RECENTLY (Sample):
${recentlyUsedStr}

2. WORDS NEVER USED / UNTOUCHED (Sample):
${neverUsedStr}

3. WORDS NEEDING IMPROVEMENT / LOW STRENGTH (Sample):
${improvingSampleStr}

4. MASTERED WORDS (Sample):
${masteredSampleStr}

CRITICAL DIRECTIVE FOR TOP 10 WORDS TO PRACTICE:
You MUST identify and select the TOP 10 WORDS the learner needs to practice right now, presenting a balanced selection of BOTH:
1. Words they have used/reviewed recently that need reinforcement (words with lower retention strength, recent review mistakes, or fading memory).
2. Words in their collection that they have NEVER used or reviewed yet (untouched words that need initial learning and memory establishment).

For each of the 10 practice words, specify:
- "word": The word in ${targetLanguage}
- "translation": Translation or meaning in ${nativeLanguage}
- "pos": Part of speech (e.g. noun, verb, adjective)
- "reason": A crisp, encouraging 1-sentence pedagogical reason explaining why the student should practice this word.
- "mnemonic": A vivid, memorable cognitive memory hook or visual association in ${nativeLanguage} or bilingual format to help lock this word in memory forever.
- "etymology": Word root, prefix/suffix breakdown, or morphological anatomy.
- "exampleSentence": Practical, realistic usage sentence in ${targetLanguage}.
- "exampleTranslation": Translation of the sentence in ${nativeLanguage}.
- "commonTrap": A common mistake learners make (confused words, false friends, incorrect prepositions).
- "type": Strictly either "recently_used" or "never_used".
- "strength": Current retention strength (0-100).
- "priority": "high" or "medium".
- "riskLevel": "critical" | "high" | "moderate".

ALSO INCLUDE:
- "contextStory": An engaging 2-3 sentence micro-story written in ${targetLanguage} that naturally integrates 3-4 of the top practice words (bolded like **word**), with "storyTranslation" in ${nativeLanguage}.
- "retentionHealthScore": Calculated retention health percentage (0-100) based on student performance.
- "cefrLevel": Estimated CEFR milestone (e.g. "A2 Elementary", "B1 Intermediate", "B2 Upper Intermediate").

Provide a structured AI analysis with constructive insights, memory retention strategies, the top 10 words to practice, and actionable guidance for the learner.`;

  const systemInstruction = `You are an elite, highly encouraging AI vocabulary coach. Output strictly valid JSON-only analytics matching the schema below. CRITICAL: Use the exact JSON field names specified in schemaDesc. Ensure topPracticeWords contains up to 10 prioritized words combining both recently used and never-used words. Do not include any conversational filler outside the JSON.`;
  const schemaDesc = `{
  "overallAssessment": "string (Empowering 2-3 sentence overview of learner's trajectory)",
  "strengthsSummary": "string (Key strengths and patterns where the learner excels)",
  "weaknessesSummary": "string (Specific word patterns or areas needing improvement)",
  "retentionHealthScore": 75,
  "cefrLevel": "B1 Intermediate",
  "contextStory": {
    "title": "AI Context Immersion Micro-Story",
    "story": "Short 2-3 sentence narrative in ${targetLanguage} embedding **targetWords**",
    "storyTranslation": "Translation in ${nativeLanguage}",
    "featuredWords": ["word1", "word2"]
  },
  "topPracticeWords": [
    {
      "word": "string (Word in ${targetLanguage})",
      "translation": "string (Translation in ${nativeLanguage})",
      "pos": "string",
      "reason": "string (Pedagogical reason why the user should practice this word)",
      "mnemonic": "string (Vivid memory hook / association)",
      "etymology": "string (Root or word anatomy breakdown)",
      "exampleSentence": "string (Practical sentence)",
      "exampleTranslation": "string (Sentence translation)",
      "commonTrap": "string (Common mistake or false friend warning)",
      "type": "recently_used | never_used",
      "strength": 0,
      "priority": "high | medium",
      "riskLevel": "critical | high | moderate"
    }
  ],
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
      body: JSON.stringify({ 
        stats, 
        totalWords, 
        masteredWords, 
        improvingWords, 
        recentlyUsedWords, 
        neverUsedWords, 
        targetLanguage, 
        nativeLanguage, 
        llmConfig 
      })
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

    const errData = await res.json().catch(() => ({ error: res.statusText }));
    const parsedErr = parseLlmError(errData, llmConfig?.provider || "gemini");
    throw new Error(parsedErr.userMessage || `Server error (${res.status}): ${res.statusText}`);
  } catch (err: any) {
    const parsedErr = parseLlmError(err, llmConfig?.provider || "gemini");
    throw new Error(parsedErr.userMessage || err?.message || "Unable to complete AI Performance Analysis. Please check your AI model settings.");
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
  const { messages, targetLanguage, nativeLanguage, llmConfig, wordContext, userInquiries, signal } = params;
  notifyLlmRequestStartFromConfig(llmConfig);
  const startTime = performance.now();

  const chatHistoryStr = messages
    .slice(-10)
    .map((m: any) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n");

  let wordContextInstruction = "";
  if (wordContext && typeof wordContext === "object" && wordContext.word) {
    wordContextInstruction = `\n\nTARGET FLASHCARD / VOCABULARY FOCUS:
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

CRITICAL FLASHCARD VOCABULARY COACHING INSTRUCTIONS:
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
   - If the user wants to practice flashcards or take a test, include a "start_practice" action in suggestedActions.
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
      body: JSON.stringify({ messages, targetLanguage, nativeLanguage, llmConfig, wordContext, userInquiries }),
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
  const { words, targetLanguage = "English", nativeLanguage = "Vietnamese", llmConfig, signal } = params;
  notifyLlmRequestStartFromConfig(llmConfig);
  const startTime = performance.now();

  if (!words || words.length === 0) {
    return { questions: [] };
  }

  if (!llmConfig || !llmConfig.isLoggedIn) {
    throw new Error("AI provider configuration or login is required to generate quiz questions.");
  }

  // Optimize payload: Only send essential fields to reduce token count and AI latency
  const minimalWordList = words.map(w => ({
    word: w.word,
    partOfSpeech: w.partOfSpeech || "noun",
    definition: w.definition,
    example: w.example || undefined
  }));

  const systemInstruction = `You are a world-class AI Language Pedagogy Engine specializing in ${targetLanguage} assessment.
Your goal is to generate a JSON array of high-quality, targeted quiz questions for the given vocabulary words.

STRICT GENERATION RULES & RESTRICTIONS:
1. Target-Language Immersion:
   - ALL question text, prompts, hints, and options MUST be written 100% strictly in ${targetLanguage}.
   - Absolutely NO native language translations in questions, prompts, hints, or options.
2. STRICT DISTRACTOR INDEPENDENCE DIRECTIVE (CRITICAL):
   - ABSOLUTE BAN: DO NOT USE OR REUSE THE OTHER WORDS IN THE INPUT LIST AS DISTRACTORS/OPTIONS!
   - Every question's 3 incorrect options (distractors) MUST be external, plausible words/phrases crafted specifically for THAT target word.
   - Distractors MUST match the target word's EXACT part of speech, grammatical category, and structural format:
     * For a single noun (e.g., "inquiry"): all 3 distractors MUST be nouns (e.g., "requisition", "proposal", "query").
     * For a phrasal verb (e.g., "back off"): all 3 distractors MUST be phrasal verbs (e.g., "step down", "hold back", "stand by").
     * For an idiom/phrase (e.g., "tone it down"): all 3 distractors MUST be parallel phrases (e.g., "play it down", "wind it up", "brush it off").
   - Distractors must be challenging and convincing (phonetic/orthographic confusers, common particle shifts, or contextual near-misses).
   - Distractors MUST NOT be valid synonyms or semantically acceptable answers for the given blank/question.
   - Exactly 4 unique options per question (1 correct answer + 3 distractors).
3. Question Types (mix across questions):
   - 'sentence': "Fill in the blank for the sentence:\n'[sentence in ${targetLanguage} with target word replaced by ______]'" (Ensure unambiguous single correct answer with distinct collocation/preposition cues).
     * For 'sentence' questions, you MUST also provide:
       - 'sentence': The full, complete sentence in ${targetLanguage} with the target word filled in.
       - 'sentenceTranslation': The natural, complete sentence translation in ${nativeLanguage}.
   - 'definition': "Which word matches the following definition?\n'[definition in ${targetLanguage}]'"
   - 'listening': "Listen to the audio clip and select the correct matching word:" (options contain phonetically/morphologically similar words).
   - 'picture': "Which word matches the visual concept shown below?" (set 'imageKeyword' to a concise 1-3 word English search term representing a concrete, physical object or scene).
4. MANDATORY REQUIREMENTS:
   - At least ONE question in the quiz MUST be a picture question ('type': 'picture') with an 'imageKeyword'.
   - Generate UP TO THREE (max 3) suggested companion words across the entire quiz ('suggestedWords' array with 1 to 3 items: 'word', 'translation' in ${nativeLanguage}, 'pairedWith', 'hint').
   - CRITICAL RULE FOR SUGGESTED WORDS:
     * Derive these suggested words directly from candidates that are actually used in the quiz questions, specifically selecting meaningful incorrect answers (distractors) or options presented in the quiz (e.g. options such as 'freighter' or other notable distractor choices).
     * CRITICAL VERB & COLLOCATION RULE: For verbs or verb options, prioritize verbs with their dependent prepositions/collocations (e.g., "elaborate on", "rely on", "cure for", "participate in").
     * Set 'pairedWith' to the quiz word/question it accompanied.
     * Keep the total number of suggested words at a maximum of three (3).
5. STRICT CORRECT ANSWER MATCHING RULE (CRITICAL):
   - The correct answer to every question MUST be EXACTLY the target vocabulary word itself (matching the spelling in the input list exactly).
   - Under no circumstances should the correct answer be a synonym, a definition, or any other word.
   - For example, if the word being tested is "minutes", the "correctAnswer" property MUST be set to "minutes", and the "options" array MUST contain exactly 4 unique options where one of them is "minutes".

Output MUST be strictly valid JSON matching this schema:
{
  "questions": [
    {
      "word": "string (the target word being tested)",
      "type": "definition" | "sentence" | "listening" | "picture",
      "question": "string",
      "options": ["string", "string", "string", "string"],
      "correctAnswer": "string (MUST be exactly the target word itself matching the 'word' field)",
      "hint": "string",
      "sentence": "string (for sentence-type questions, provide the complete sentence in ${targetLanguage} with the target word)",
      "sentenceTranslation": "string (for sentence-type questions, provide the full sentence translation in ${nativeLanguage})",
      "imageKeyword": "string (1-3 word English search term)"
    }
  ],
  "suggestedWords": [
    {
      "word": "string (Suggested word derived from incorrect answer options/distractors used in the quiz)",
      "translation": "string (Translation in ${nativeLanguage})",
      "pairedWith": "string (Which quiz word it accompanies as an option)",
      "hint": "string (Brief note on its meaning or context from the quiz options)"
    }
  ]
}`;

  const prompt = `Generate 1 quiz question for each of these vocabulary words:\n${JSON.stringify(minimalWordList, null, 2)}\n\n` +
    `CRITICAL INSTRUCTIONS:\n` +
    `1. Return exactly 1 question per word.\n` +
    `2. The correct answer (correctAnswer) to each question MUST be EXACTLY the target word being tested. For example, if the word being tested is "minutes", the correctAnswer MUST be "minutes".\n` +
    `3. DO NOT use words from this input list as distractors for other questions. Generate external, plausible confusers sharing the exact same part of speech.\n` +
    `4. Ensure at least one question has 'type': 'picture' with a 1-3 word 'imageKeyword'.\n` +
    `5. Include up to 3 suggested companion words ('suggestedWords' array, max 3) derived directly from the candidates actually used in the quiz questions, specifically selecting meaningful incorrect answer options (distractors) presented in the quiz (such as 'freighter' or other options found in the distractors).`;

  const schemaDesc = `Object with questions (array of QuizQuestion objects with word, type, question, options, correctAnswer, hint, sentence, sentenceTranslation, imageKeyword) and suggestedWords (array of up to 3 items with word, translation, pairedWith, hint derived from quiz distractors/options).`;

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
        body: JSON.stringify({ words: minimalWordList, targetLanguage, nativeLanguage, llmConfig }),
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

    if (Array.isArray(rawQuestions) && rawQuestions.length > 0) {
      // Collect up to 3 total suggestions across all questions or topLevelSuggestions
      let collectedSuggestions: any[] = [...topLevelSuggestions];

      if (collectedSuggestions.length === 0) {
        rawQuestions.forEach((q: any) => {
          const list = Array.isArray(q.suggestedWords) ? q.suggestedWords : (Array.isArray(q.suggestedVocabulary) ? q.suggestedVocabulary : (Array.isArray(q.collocations) ? q.collocations : []));
          list.forEach((item: any) => {
            if (item) collectedSuggestions.push(typeof item === "object" ? { ...item, pairedWith: item.pairedWith || q.word } : { word: item, pairedWith: q.word });
          });
        });
      }

      const seenWordKeys = new Set<string>();
      const normalizedTop3Suggestions: any[] = [];

      for (const item of collectedSuggestions) {
        const w = typeof item === "string" ? item.trim() : (item.word || item.vocab || item.term || "").trim();
        if (!w) continue;
        const key = w.toLowerCase();
        if (seenWordKeys.has(key)) continue;
        seenWordKeys.add(key);

        normalizedTop3Suggestions.push({
          word: w,
          translation: typeof item === "object" ? (item.translation || item.meaning || "") : "",
          hint: typeof item === "object" ? (item.hint || item.reason || item.relationship || item.usage || `Option used in quiz question`) : `Option used in quiz question`,
          pairedWith: typeof item === "object" && item.pairedWith ? item.pairedWith : (words[0]?.word || "")
        });

        if (normalizedTop3Suggestions.length >= 3) break;
      }

      // Fallback 1: Extract plausible distractors from the generated quiz questions if under 3
      if (normalizedTop3Suggestions.length < 3) {
        for (const q of rawQuestions) {
          const rawOpts = Array.isArray(q.options) ? q.options : [];
          const targetLower = (q.word || "").toLowerCase().trim();
          for (const opt of rawOpts) {
            const optStr = String(opt || "").trim();
            if (!optStr) continue;
            const optLower = optStr.toLowerCase();
            if (optLower === targetLower || seenWordKeys.has(optLower)) continue;
            seenWordKeys.add(optLower);
            normalizedTop3Suggestions.push({
              word: optStr,
              translation: "",
              hint: `Option used in quiz question for "${q.word || ""}"`,
              pairedWith: q.word || ""
            });
            if (normalizedTop3Suggestions.length >= 3) break;
          }
          if (normalizedTop3Suggestions.length >= 3) break;
        }
      }

      // Fallback 2: Pick from word database collocations up to 3
      if (normalizedTop3Suggestions.length < 3) {
        for (const w of words) {
          if (Array.isArray(w.suggestedWords)) {
            for (const sw of w.suggestedWords) {
              const swText = typeof sw === "string" ? sw.trim() : (sw.word || "").trim();
              if (!swText) continue;
              const key = swText.toLowerCase();
              if (seenWordKeys.has(key) || key === w.word.toLowerCase()) continue;
              seenWordKeys.add(key);
              normalizedTop3Suggestions.push({
                word: swText,
                translation: typeof sw === "object" ? (sw.translation || "") : "",
                hint: typeof sw === "object" ? (sw.hint || `Frequently appears with ${w.word}`) : `Frequently appears with ${w.word}`,
                pairedWith: w.word
              });
              if (normalizedTop3Suggestions.length >= 3) break;
            }
          }
          if (normalizedTop3Suggestions.length >= 3) break;
        }
      }

      // Build a set of all tested target words to strictly filter out any lazy cross-word distractors
      const allTargetWordKeys = new Set(words.map(w => w.word.toLowerCase().trim()));

      const validQuestions: QuizQuestion[] = rawQuestions.map((q: any, idx: number) => {
        const matchingWord = words.find(w => w.id === q.wordId || w.word.toLowerCase() === (q.word || "").toLowerCase()) || words[idx % words.length];
        const targetWordLower = matchingWord.word.toLowerCase().trim();
        // The correct answer MUST be strictly the target vocabulary word itself being tested
        const correctAns = matchingWord.word;
        const correctAnsLower = correctAns.toLowerCase().trim();

        // 1. Collect sanitized options, strictly rejecting any distractor that is another target word from the quiz
        let cleanOptions: string[] = [correctAns];
        const rawOptions = Array.isArray(q.options) ? q.options : [];

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
        if (cleanOptions.length < 4) {
          const extraDistractors = generateConfusers(matchingWord.word);
          for (const d of extraDistractors) {
            if (cleanOptions.length >= 4) break;
            const dLower = d.toLowerCase().trim();
            if (!cleanOptions.some(o => o.toLowerCase().trim() === dLower) && !allTargetWordKeys.has(dLower)) {
              cleanOptions.push(d);
            }
          }
        }

        // 3. Fallback suffix/morph confusers if still under 4 options
        const fallbackSuffixes = ["ing", "ed", "er", "ly", "tion", "ment", "ness", "s", "al"];
        let suffixIdx = 0;
        while (cleanOptions.length < 4 && suffixIdx < fallbackSuffixes.length) {
          const candidate = `${matchingWord.word}${fallbackSuffixes[suffixIdx++]}`;
          const cLower = candidate.toLowerCase().trim();
          if (!cleanOptions.some(o => o.toLowerCase().trim() === cLower) && !allTargetWordKeys.has(cLower)) {
            cleanOptions.push(candidate);
          }
        }

        const keywordText = q.imageKeyword || (q.type === 'picture' ? getImageKeyword(matchingWord) : undefined);

        const existingWordImages = [
          ...(matchingWord.imageUrls || []),
          ...(matchingWord.imageUrl ? [matchingWord.imageUrl] : [])
        ].map(u => String(u || "").trim()).filter(Boolean);

        let imgUrl: string | undefined = undefined;
        if (existingWordImages.length > 0 && (q.type === 'picture' || q.imageUrl || keywordText)) {
          imgUrl = existingWordImages[Math.floor(Math.random() * existingWordImages.length)];
        } else if (q.imageUrl && q.imageUrl.startsWith("http")) {
          imgUrl = q.imageUrl;
        } else if (keywordText) {
          imgUrl = `https://image.nclong87.workers.dev?query=${encodeURIComponent(keywordText)}`;
        }

        let resolvedSentence = q.sentence || (matchingWord.example ? matchingWord.example : undefined);
        if (!resolvedSentence && (q.type === 'sentence' || /_{2,}|\[blank\]|\.\.\./i.test(q.question || ""))) {
          const cleanedQ = (q.question || "")
            .replace(/^Fill in the blank (?:for the sentence)?:\s*/i, "")
            .replace(/^["“]|["”]$/g, "")
            .trim();
          if (/_{2,}|\[blank\]|\.\.\./i.test(cleanedQ)) {
            resolvedSentence = cleanedQ.replace(/_{2,}|\[blank\]|\.\.\./gi, correctAns);
          } else {
            resolvedSentence = cleanedQ;
          }
        }

        const resolvedSentenceTranslation = q.sentenceTranslation || matchingWord.exampleTranslation || undefined;

        return {
          id: q.id || `ai-q-${matchingWord.id}-${idx}`,
          wordId: matchingWord.id,
          word: matchingWord.word,
          type: q.type || 'definition',
          question: q.question || `Which word matches: ${matchingWord.definition}`,
          options: cleanOptions.sort(() => 0.5 - Math.random()),
          correctAnswer: correctAns,
          hint: q.hint || matchingWord.pronunciation,
          sentence: resolvedSentence,
          sentenceTranslation: resolvedSentenceTranslation,
          imageKeyword: keywordText,
          imageUrl: imgUrl,
          suggestedWords: idx === 0 ? normalizedTop3Suggestions : undefined
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

        const existingWordImages = [
          ...(matchingWord.imageUrls || []),
          ...(matchingWord.imageUrl ? [matchingWord.imageUrl] : [])
        ].map(u => String(u || "").trim()).filter(Boolean);

        if (existingWordImages.length > 0) {
          targetQ.imageUrl = existingWordImages[Math.floor(Math.random() * existingWordImages.length)];
        } else {
          targetQ.imageUrl = `https://image.nclong87.workers.dev?query=${encodeURIComponent(targetQ.imageKeyword)}`;
        }
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

export interface FlashcardGenerationRequest {
  word: Word;
  targetLanguage?: string;
  nativeLanguage?: string;
  llmConfig?: LLMConfig;
  signal?: AbortSignal;
}

export interface FlashcardsBatchGenerationRequest {
  words: Word[];
  targetLanguage?: string;
  nativeLanguage?: string;
  llmConfig?: LLMConfig;
  signal?: AbortSignal;
}

export interface GeneratedBatchFlashcardsResult {
  cards: FlashcardItem[];
  provider?: string;
  model?: string;
  responseTimeMs?: number;
}

export interface GeneratedFlashcardContent {
  word: string;
  pronunciation?: string;
  partOfSpeech?: string;
  definition: string;
  translation: string;
  category?: string;
  context?: string;
  example?: string;
  exampleTranslation?: string;
  extraExampleSentences?: {
    sentence: string;
    translation: string;
    contextCategoryNote?: string;
  }[];
  usageNotes?: string;
  imageKeyword?: string;
  suggestedVocabulary?: SuggestedVocabularyWord[];
  suggestedWords?: (string | SuggestedPairedWord)[];
  cards?: FlashcardItem[];
  provider?: string;
  model?: string;
  responseTimeMs?: number;
}

const MAX_SUGGESTED_PAIRED_WORDS = 3;

export async function generateBatchFlashcardsService(
  params: FlashcardsBatchGenerationRequest
): Promise<GeneratedBatchFlashcardsResult> {
  const { words, targetLanguage = "English", nativeLanguage = "Vietnamese", llmConfig, signal } = params;
  notifyLlmRequestStartFromConfig(llmConfig);
  const startTime = performance.now();

  const wordsList = Array.isArray(words) ? words : [];
  if (wordsList.length === 0) {
    return { cards: [] };
  }

  const fallbackCards: FlashcardItem[] = wordsList.map((w) => {
    let rawSugg: SuggestedPairedWord[] = [];
    if (w.suggestedWords && Array.isArray(w.suggestedWords)) {
      rawSugg = w.suggestedWords.map((sw: any) => 
        typeof sw === "string" ? { word: sw, translation: "", relationship: "Collocation" } : sw
      );
    }
    return {
      wordId: w.id,
      word: w.word,
      pronunciation: w.pronunciation || "/.../",
      partOfSpeech: w.partOfSpeech || "noun",
      definition: w.definition || `Study card for "${w.word}"`,
      translation: w.translation || "Translation",
      example: w.example || `Let's study "${w.word}" in context.`,
      exampleTranslation: w.exampleTranslation || w.translation || "",
      category: w.category || "General",
      context: w.context || w.definition,
      suggestedWords: rawSugg.slice(0, MAX_SUGGESTED_PAIRED_WORDS)
    };
  });

  if (!llmConfig || !llmConfig.isLoggedIn) {
    return { cards: fallbackCards };
  }

  const systemInstruction = `You are a world-class AI Language Pedagogy Engine creating interactive flashcards for ${targetLanguage} learners (native language: ${nativeLanguage}).
Given target vocabulary words, generate a clean, focused, high-retention flashcard for EACH word.

FOR EACH WORD:
1. "word": The target vocabulary word in ${targetLanguage}.
   CRITICAL VERB & PREPOSITION RULE: When teaching or reviewing verbs that commonly take dependent prepositions or are phrasal/prepositional verbs (e.g. "elaborate on", "cure for", "cure of", "rely on", "participate in", "consist of", "focus on", "deal with", "abide by", "specialize in", "benefit from"), format the headword with its dependent preposition (e.g., "elaborate on", "cure for", "rely on") so the learner masters the complete grammatical usage.
2. "pronunciation": Accurate IPA pronunciation guide (e.g. /ɪˈfɛmərəl/).
3. "partOfSpeech": Part of speech (noun, verb, adjective, adverb, idiom, etc.).
4. "translation": Natural, accurate translation in ${nativeLanguage}.
5. "definition": Concise, clear definition in ${targetLanguage}.
6. "example": EXACTLY 1 natural, realistic example sentence in ${targetLanguage} demonstrating practical usage in context (do not include translation for the example).
7. "category": Thematic domain/tag (e.g. "Everyday", "Business", "Travel", "Academic", "Emotions").
8. "suggestedWords": Optional top 1 or 2 most natural collocations or paired expressions (keep it strictly concise, maximum 1-2 items per card).
   CRITICAL COLLOCATION RULE: For verbs and action words, prioritize verb + dependent preposition collocations and phrasal patterns (e.g. "cure for", "elaborate on", "rely on", "cope with").
   For each pairing, provide:
   - "word": The collocated expression in ${targetLanguage} (e.g., "elaborate on", "cure for", "heavy rain", "deep breath").
   - "translation": Native translation in ${nativeLanguage}.
   - "hint": A brief 2-4 word explanation note.

CRITICAL REQUIREMENT: For each flashcard, "suggestedWords" MUST contain AT MOST 1 or 2 items. Do not generate long lists.

Output MUST be strictly valid JSON matching this schema:
[
  {
    "word": "string",
    "pronunciation": "string",
    "partOfSpeech": "string",
    "translation": "string",
    "definition": "string in ${targetLanguage}",
    "example": "string in ${targetLanguage}",
    "category": "string",
    "suggestedWords": [
      {
        "word": "string (collocation/pairing)",
        "translation": "string (native translation)",
        "hint": "string (brief note)"
      }
    ]
  }
]`;

  const wordsDetails = wordsList.map((w: any, idx: number) => 
    `${idx + 1}. Word: "${w.word}" | POS: "${w.partOfSpeech || "unknown"}" | Def: "${w.definition || ""}" | Trans: "${w.translation || ""}" | Cat: "${w.category || "General"}" | Context: "${w.context || ""}"`
  ).join("\n");

  const prompt = `Generate interactive study flashcards for these ${wordsList.length} vocabulary words:\n${wordsDetails}\n\n` +
    `REMINDERS:\n` +
    `- Return a JSON array containing EXACTLY ${wordsList.length} flashcard objects.\n` +
    `- For each flashcard, include 1 natural example sentence in ${targetLanguage} without any translation.\n` +
    `- For each flashcard, include at most 1 or 2 top commonly paired words/collocations ("suggestedWords") with their native translation (keep concise).`;

  const schemaDesc = `Array of Flashcard objects with word, pronunciation, partOfSpeech, translation, definition, example, category, suggestedWords (concise array of at most 1-2 items with word, translation, hint).`;

  try {
    let rawResultText = "";
    let metaProvider: string | undefined;
    let metaModel: string | undefined;

    if (isStaticHost()) {
      const resWithMeta = await callLLMClientSideWithMeta(prompt, systemInstruction, schemaDesc, llmConfig, signal, { action: "Flashcards" });
      rawResultText = resWithMeta.text;
      metaProvider = resWithMeta.provider;
      metaModel = resWithMeta.model;
    } else {
      const res = await fetchWithTimeout("/api/generate-flashcards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ words: wordsList, targetLanguage, nativeLanguage, llmConfig }),
        signal
      });
      if (res.ok) {
        const data = await res.json();
        if (data && (Array.isArray(data.cards) || Array.isArray(data))) {
          const duration = data.responseTimeMs || Math.round(performance.now() - startTime);
          const prov = data.provider || llmConfig?.provider || "gemini";
          const mod = data.model || sanitizeModel(llmConfig?.provider || "gemini", llmConfig?.model);
          recordModelResponse(prov, mod, duration);

          logApiRequest({
            provider: prov,
            model: mod,
            prompt,
            systemInstruction,
            schemaDescription: schemaDesc,
            response: JSON.stringify(data),
            responseTimeMs: duration,
            status: "success",
            statusCode: 200,
            action: "Flashcards"
          }).catch(() => undefined);

          const rawCards = Array.isArray(data.cards) ? data.cards : Array.isArray(data) ? data : [];
          const cards: FlashcardItem[] = rawCards.map((card: any, idx: number) => {
            const orig = wordsList[idx] || wordsList.find(w => w.word.toLowerCase().trim() === card.word?.toLowerCase().trim()) || fallbackCards[idx];
            let suggestions: any[] = [];
            const rawSugg = card.suggestedWords || card.suggestedVocabulary || [];
            if (Array.isArray(rawSugg)) {
              suggestions = rawSugg.slice(0, MAX_SUGGESTED_PAIRED_WORDS).map((item: any) => {
                if (typeof item === "string") return { word: item, translation: "", hint: "Common pairing" };
                return {
                  word: String(item.word || "").trim(),
                  translation: String(item.translation || "").trim(),
                  hint: String(item.hint || item.partOfSpeech || "").trim()
                };
              }).filter(item => Boolean(item.word));
            }
            return {
              wordId: (orig as any)?.id || (orig as any)?.wordId || "",
              word: card.word || orig.word,
              pronunciation: card.pronunciation || orig.pronunciation || "/.../",
              partOfSpeech: card.partOfSpeech || orig.partOfSpeech || "noun",
              translation: card.translation || orig.translation || "",
              definition: card.definition || orig.definition || "",
              example: card.example || orig.example || "",
              exampleTranslation: card.exampleTranslation || orig.exampleTranslation || "",
              category: card.category || orig.category || "General",
              context: card.context || orig.context || orig.definition || "",
              suggestedWords: suggestions.slice(0, MAX_SUGGESTED_PAIRED_WORDS)
            };
          });
          return {
            cards: cards.length > 0 ? cards : fallbackCards,
            provider: prov,
            model: mod,
            responseTimeMs: duration
          };
        }
      }
      const resWithMeta = await callLLMClientSideWithMeta(prompt, systemInstruction, schemaDesc, llmConfig, signal, { action: "Flashcards" });
      rawResultText = resWithMeta.text;
      metaProvider = resWithMeta.provider;
      metaModel = resWithMeta.model;
    }

    const cleaned = cleanJsonResponse(rawResultText);
    const parsed = cleanAndParseJson(cleaned);
    let cardsArray: any[] = [];
    if (Array.isArray(parsed)) {
      cardsArray = parsed;
    } else if (parsed && Array.isArray(parsed.cards)) {
      cardsArray = parsed.cards;
    } else if (parsed && Array.isArray(parsed.flashcards)) {
      cardsArray = parsed.flashcards;
    } else if (parsed && typeof parsed === "object") {
      cardsArray = [parsed];
    }

    const duration = Math.round(performance.now() - startTime);
    const prov = metaProvider || llmConfig?.provider || "gemini";
    const mod = metaModel || sanitizeModel(llmConfig?.provider || "gemini", llmConfig?.model);
    recordModelResponse(prov, mod, duration);

    const cards: FlashcardItem[] = cardsArray.map((card: any, idx: number) => {
      const orig = wordsList[idx] || wordsList.find(w => w.word.toLowerCase().trim() === card.word?.toLowerCase().trim()) || fallbackCards[idx];
      let suggestions: any[] = [];
      const rawSugg = card.suggestedWords || card.suggestedVocabulary || [];
      if (Array.isArray(rawSugg)) {
        suggestions = rawSugg.slice(0, MAX_SUGGESTED_PAIRED_WORDS).map((item: any) => {
          if (typeof item === "string") return { word: item, translation: "", hint: "Common pairing" };
          return {
            word: String(item.word || "").trim(),
            translation: String(item.translation || "").trim(),
            hint: String(item.hint || item.partOfSpeech || "").trim()
          };
        }).filter(item => Boolean(item.word));
      }
      return {
        wordId: (orig as any)?.id || (orig as any)?.wordId || "",
        word: card.word || orig.word,
        pronunciation: card.pronunciation || orig.pronunciation || "/.../",
        partOfSpeech: card.partOfSpeech || orig.partOfSpeech || "noun",
        translation: card.translation || orig.translation || "",
        definition: card.definition || orig.definition || "",
        example: card.example || orig.example || "",
        exampleTranslation: card.exampleTranslation || orig.exampleTranslation || "",
        category: card.category || orig.category || "General",
        context: card.context || orig.context || orig.definition || "",
        suggestedWords: suggestions.slice(0, MAX_SUGGESTED_PAIRED_WORDS)
      };
    });

    return {
      cards,
      provider: prov,
      model: mod,
      responseTimeMs: duration
    };
  } catch (err: any) {
    console.error("AI Batch Flashcard Generation API error:", err);
    const parsedErr = parseLlmError(err, llmConfig?.provider || "gemini");
    throw new Error(parsedErr.userMessage || err?.message || "Failed to generate flashcards.");
  }
}

export async function generateFlashcardContentService(
  params: FlashcardGenerationRequest
): Promise<GeneratedFlashcardContent> {
  const { word, targetLanguage = "English", nativeLanguage = "Vietnamese", llmConfig, signal } = params;
  const batchRes = await generateBatchFlashcardsService({
    words: [word],
    targetLanguage,
    nativeLanguage,
    llmConfig,
    signal
  });

  const card = batchRes.cards[0] || {
    word: word.word,
    pronunciation: word.pronunciation,
    partOfSpeech: word.partOfSpeech || "noun",
    definition: word.definition,
    translation: word.translation,
    example: word.example,
    exampleTranslation: word.exampleTranslation,
    category: word.category || "General",
    context: word.context || word.definition,
    suggestedWords: []
  };

  return {
    word: card.word,
    pronunciation: card.pronunciation,
    partOfSpeech: card.partOfSpeech,
    definition: card.definition,
    translation: card.translation,
    category: card.category,
    context: card.context,
    example: card.example,
    exampleTranslation: card.exampleTranslation,
    extraExampleSentences: card.example ? [
      {
        sentence: card.example,
        translation: card.exampleTranslation || card.translation,
        contextCategoryNote: card.category || "Context Example"
      }
    ] : [],
    suggestedWords: card.suggestedWords || [],
    suggestedVocabulary: (card.suggestedWords || []).map(s => typeof s === "string" ? { word: s, translation: "" } : s),
    cards: batchRes.cards,
    provider: batchRes.provider,
    model: batchRes.model,
    responseTimeMs: batchRes.responseTimeMs
  };
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

  userText += `\n\nCRITICAL DIRECTIVES:\n- NO REASONING OR THINKING: Do not include any chain of thought, reasoning, thinking process, explanation of reasoning, or commentary in your response. Do not use '<think>' tags or similar blocks. Output strictly valid raw JSON and absolutely nothing else.\n- CRITICAL VERB & COLLOCATION RULE: When extracting vocabulary candidates for verbs, pair verbs with their natural dependent prepositions and collocations (e.g., "catch up on", "count on", "look forward to", "elaborate on", "rely on").`;

  const schemaDesc = `{
    "suggestedReplies": [
      {
        "reply": "string (The suggested response in \"${userTarget}\". Keep them sounding highly natural, native, and casual.)",
        "translation": "string (exact translation in \"${userNative}\")",
        "tone": "string (tone/vibe description)",
        "explanation": "string (nuance/usage explanation in \"${userNative}\")"
      }
    ],
    "vocabularyCandidates": [
      {
        "word": "string (useful vocabulary term or verb + preposition collocation in ${userTarget})",
        "translation": "string (translation in ${userNative})",
        "reason": "string (short explanation of usage/meaning in ${userNative})"
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

