import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import { cleanJsonResponse, cleanAndParseJson, extractWordsFromPayload } from "./src/utils/jsonSanitizer";
import { extractOrGenerateTopicActions } from "./src/utils/actionExtractor";
import { extractPhrasalVerbsAndCollocationsFromSentence } from "./src/utils/quizGenerator";
import { isPhrasalVerb, findWordInCollection, hasUserIncorporatedWord } from "./src/utils/wordNormalization";
import { sortWordsByLastPracticeTime } from "./src/utils/spacedRepetition";
import { PROVIDER_OPTIONS } from "./src/config/llmProviders";

dotenv.config();

const app = express();
const PORT = process.env.APP_PORT ? parseInt(process.env.APP_PORT, 10) : 3000;

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

interface LLMRequestConfig {
  provider?: string;
  model?: string;
  apiKey?: string;
  proxyKey?: string;
  baseUrl?: string;
  savedProviders?: Record<string, { proxyKey?: string; [key: string]: any }>;
  preferredProvider?: string;
  preferredModel?: string;
}



export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit & { timeoutMs?: number }
): Promise<Response> {
  const urlString = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
  const isImageAnalysisWorker = urlString.includes("image-analysis.nclong87.workers.dev");
  const timeoutMs = init?.timeoutMs !== undefined ? init.timeoutMs : (isImageAnalysisWorker ? 0 : 30000);

  if (timeoutMs <= 0) {
    const { timeoutMs: _, ...fetchInit } = init || {};
    return fetch(input, fetchInit);
  }

  const controller = new AbortController();
  const id = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  const { timeoutMs: _, ...fetchInit } = init || {};

  if (fetchInit.signal) {
    if (fetchInit.signal.aborted) {
      controller.abort();
    } else {
      fetchInit.signal.addEventListener("abort", () => controller.abort());
    }
  }

  try {
    const response = await fetch(input, {
      ...fetchInit,
      signal: controller.signal
    });

    const originalText = response.text.bind(response);
    const originalJson = response.json.bind(response);

    response.text = async () => {
      try {
        const textPromise = originalText();
        const timeoutPromise = new Promise<never>((_, reject) => {
          if (controller.signal.aborted) {
            reject(new Error(`API call timed out after ${Math.round(timeoutMs / 1000)} seconds.`));
          }
          controller.signal.addEventListener("abort", () => {
            reject(new Error(`API call timed out after ${Math.round(timeoutMs / 1000)} seconds.`));
          });
        });
        return await Promise.race([textPromise, timeoutPromise]);
      } finally {
        clearTimeout(id);
      }
    };

    response.json = async () => {
      try {
        const jsonPromise = originalJson();
        const timeoutPromise = new Promise<never>((_, reject) => {
          if (controller.signal.aborted) {
            reject(new Error(`API call timed out after ${Math.round(timeoutMs / 1000)} seconds.`));
          }
          controller.signal.addEventListener("abort", () => {
            reject(new Error(`API call timed out after ${Math.round(timeoutMs / 1000)} seconds.`));
          });
        });
        return await Promise.race([jsonPromise, timeoutPromise]);
      } finally {
        clearTimeout(id);
      }
    };

    return response;
  } catch (error: any) {
    clearTimeout(id);
    if (error.name === "AbortError" || controller.signal.aborted) {
      throw new Error(`API call timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
    }
    throw error;
  }
}



const VALID_GEMINI_MODELS = [
  "gemini-3.6-flash", 
  "gemini-3.5-flash", 
  "gemini-3.5-flash-lite",
];

// Sanitize model names for provider
function sanitizeModel(provider: string, model?: string): string {
  if (provider === "auto") {
    return "auto";
  }
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
    // If the model is not specified or is "auto", select the first unlocked/available model for this provider!
    const unlockedModel = providerMeta.models.find(m => !isServerModelLocked(provider, m));
    if (unlockedModel) {
      return unlockedModel;
    }
    return providerMeta.defaultModel;
  }
  return model || "auto";
}


// Parse server-side LLM error
function parseServerError(err: any, provider: string = "gemini"): {
  statusCode: number;
  errorType: string;
  userMessage: string;
  isRetryable: boolean;
  provider?: string;
  model?: string;
} {
  let originalMessage = err?.message || (typeof err === "string" ? err : JSON.stringify(err || {}));
  
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

  const lowerMsg = originalMessage.toLowerCase();
  const provUpper = provider.toUpperCase();

  let statusCode = err?.statusCode || err?.status || err?.code || 0;

  if (!statusCode) {
    const statusMatch = originalMessage.match(/\((\d{3})\)/);
    if (statusMatch) {
      statusCode = parseInt(statusMatch[1], 10);
    }
  }

  try {
    const jsonMatch = originalMessage.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsedJson = JSON.parse(jsonMatch[0]);
      const errObj = parsedJson.error || parsedJson;
      if (errObj.code && typeof errObj.code === "number") statusCode = errObj.code;
    }
  } catch {}

  const resProvider = err?.lastAttemptedCandidate?.provider || provider;
  const resModel = err?.lastAttemptedCandidate?.model;

  if (statusCode === 401 || lowerMsg.includes("unauthenticated") || lowerMsg.includes("api_key_invalid") || lowerMsg.includes("invalid api key") || lowerMsg.includes("unregistered callers")) {
    return {
      statusCode: 401,
      errorType: "INVALID_KEY",
      userMessage: `Invalid ${provUpper} API Key (401): The provided API key is invalid or unrecognized. Please check your API key in settings.`,
      isRetryable: false,
      provider: resProvider,
      model: resModel
    };
  }

  if (statusCode === 403 || lowerMsg.includes("permission_denied") || lowerMsg.includes("permission denied") || lowerMsg.includes("api_key_service_blocked")) {
    return {
      statusCode: 403,
      errorType: "PERMISSION_DENIED",
      userMessage: `Access Forbidden (403): Your ${provUpper} API key lacks access permissions or Gemini is restricted in your region/project.`,
      isRetryable: false,
      provider: resProvider,
      model: resModel
    };
  }

  if (statusCode === 429 || lowerMsg.includes("resource_exhausted") || lowerMsg.includes("quota exceeded") || lowerMsg.includes("too many requests")) {
    return {
      statusCode: 429,
      errorType: "RATE_LIMIT",
      userMessage: `Rate Limit Exceeded (429): ${provUpper} API quota or rate limit reached.`,
      isRetryable: true,
      provider: resProvider,
      model: resModel
    };
  }

  if (statusCode === 404 || lowerMsg.includes("not_found") || lowerMsg.includes("model not found")) {
    return {
      statusCode: 404,
      errorType: "NOT_FOUND",
      userMessage: `Model Not Found (404): The requested ${provUpper} model is unavailable or endpoint path is invalid.`,
      isRetryable: false,
      provider: resProvider,
      model: resModel
    };
  }

  if (statusCode >= 500 || lowerMsg.includes("internal server error") || lowerMsg.includes("service unavailable") || lowerMsg.includes("overloaded")) {
    const code = statusCode || 503;
    return {
      statusCode: code,
      errorType: "SERVER_ERROR",
      userMessage: `${provUpper} Server Error (${code}): Google/Provider AI servers are temporarily busy or undergoing maintenance.`,
      isRetryable: true,
      provider: resProvider,
      model: resModel
    };
  }

  return {
    statusCode: statusCode || 400,
    errorType: "UNKNOWN",
    userMessage: `${provUpper} Error: ${originalMessage || "Failed to communicate with LLM provider."}`,
    isRetryable: statusCode >= 500 || statusCode === 429,
    provider: resProvider,
    model: resModel
  };
}

const serverLockedModels = new Map<string, number>();

function lockServerModel(provider: string, model: string, durationMs: number = 3600000): void {
  if (provider === "auto" || model === "auto") return;
  const key = `${provider}:${model}`;
  serverLockedModels.set(key, Date.now() + durationMs);
  console.warn(`[Server Auto Mode] Locked model ${key} for ${Math.round(durationMs / 60000)} minutes`);
}

function getServerLockedModelsArray(): { key: string; expiresAt: number }[] {
  const result: { key: string; expiresAt: number }[] = [];
  const now = Date.now();
  for (const [key, expiresAt] of serverLockedModels.entries()) {
    if (expiresAt > now) {
      result.push({ key, expiresAt });
    }
  }
  return result;
}

function isServerModelLocked(provider: string, model: string): boolean {
  const key = `${provider}:${model}`;
  const expiresAt = serverLockedModels.get(key);
  if (!expiresAt) return false;
  if (expiresAt > Date.now()) return true;
  serverLockedModels.delete(key);
  return false;
}

function getServerAutoModelCandidates(llmConfig?: LLMRequestConfig): { provider: string; model: string }[] {
  const candidates: { provider: string; model: string }[] = [];
  let providersToInclude = PROVIDER_OPTIONS.filter(p => p.id !== "auto" && p.id !== "custom");

  if (llmConfig?.provider && llmConfig.provider !== "auto" && llmConfig.provider !== "custom") {
    providersToInclude = providersToInclude.filter(p => p.id === llmConfig.provider);
  }

  if (
    llmConfig?.savedProviders?.custom?.baseUrl ||
    (llmConfig?.provider === "custom" && llmConfig.baseUrl)
  ) {
    if (!llmConfig?.provider || llmConfig.provider === "auto" || llmConfig.provider === "custom") {
      const customMeta = PROVIDER_OPTIONS.find(p => p.id === "custom");
      if (customMeta && !providersToInclude.some(p => p.id === "custom")) {
        providersToInclude.push(customMeta);
      }
    }
  }

  const maxModels = Math.max(...providersToInclude.map(p => p.models.length), 0);

  // Interleave models across providers so rotation alternates providers
  for (let i = 0; i < maxModels; i++) {
    for (const p of providersToInclude) {
      if (p.models[i] && p.models[i] !== "auto") {
        candidates.push({ provider: p.id, model: p.models[i] });
      }
    }
  }
  if (candidates.length > 0) {
    return candidates;
  }
  return PROVIDER_OPTIONS.filter(p => p.id !== "auto" && p.id !== "custom").map(p => ({
    provider: p.id,
    model: p.defaultModel
  }));
}

let serverAutoRotationIndex = 0;

function getNextServerAutoCandidate(llmConfig?: LLMRequestConfig, excludedKeys?: Set<string>): { provider: string; model: string } {
  const candidates = getServerAutoModelCandidates(llmConfig);
  for (let i = 0; i < candidates.length; i++) {
    const idx = (serverAutoRotationIndex + i) % candidates.length;
    const cand = candidates[idx];
    const key = `${cand.provider}:${cand.model}`;

    if (!isServerModelLocked(cand.provider, cand.model) && (!excludedKeys || !excludedKeys.has(key))) {
      serverAutoRotationIndex = (idx + 1) % candidates.length;
      return cand;
    }
  }

  serverLockedModels.clear();
  const currentIdx = serverAutoRotationIndex % candidates.length;
  serverAutoRotationIndex = (serverAutoRotationIndex + 1) % candidates.length;
  return candidates[currentIdx];
}

// Call LLM for a single provider/model candidate
async function callLLMSingle(
  prompt: string, 
  systemInstruction: string, 
  schemaDescription: string,
  llmConfig?: LLMRequestConfig,
  signal?: AbortSignal
): Promise<string> {
  const provider = llmConfig?.provider || "gemini";
  const model = sanitizeModel(provider, llmConfig?.model);
  const apiKey = llmConfig?.apiKey;
  const proxyKey = process.env.PROXY_SECRET;
  const providerMeta = PROVIDER_OPTIONS.find(p => p.id === provider);
  const baseUrl = llmConfig?.baseUrl || providerMeta?.defaultBaseUrl || "";

  if (provider === "gemini") {
    const effectiveGeminiKey = apiKey || process.env.GEMINI_API_KEY || "";
    const effectiveGeminiUrl = baseUrl || (effectiveGeminiKey ? "https://generativelanguage.googleapis.com/v1beta" : (providerMeta?.defaultBaseUrl || "https://generativelanguage.googleapis.com/v1beta"));
    const primaryModel = model || "gemini-3.6-flash";
    const cleanBaseUrl = effectiveGeminiUrl.replace(/\/+$/, "");

    let targetEndpoint = `${cleanBaseUrl}/models/${primaryModel}:generateContent`;
    if (effectiveGeminiKey && !effectiveGeminiUrl.includes("workers.dev")) {
      targetEndpoint += `?key=${effectiveGeminiKey}`;
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };

    if (proxyKey) {
      headers["X-Proxy-Key"] = proxyKey;
    }
    if (effectiveGeminiKey) {
      headers["x-goog-api-key"] = effectiveGeminiKey;
      if (!headers["X-Proxy-Key"]) {
        headers["X-Proxy-Key"] = effectiveGeminiKey;
      }
    }

    const payload = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      systemInstruction: systemInstruction ? { parts: [{ text: systemInstruction }] } : undefined,
      generationConfig: {
        responseMimeType: "application/json"
      }
    };

    const startTime = Date.now();
    const res = await fetchWithTimeout(targetEndpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      throw new Error(`Gemini API Error (${res.status}): ${errText}`);
    }

    const data: any = await res.json();
    const parts = data.candidates?.[0]?.content?.parts || [];
    const text = parts.map((p: any) => p.text || "").join("").trim() || data.text || data.candidates?.[0]?.output || "";
    if (!text) {
      throw new Error("Empty text response from Gemini API.");
    }
    const cleanedText = cleanJsonResponse(text);
    const result = cleanAndParseJson(cleanedText);
    result.model = sanitizeModel(provider, llmConfig?.model);
    result.provider = provider;
    result.responseTimeMs = Date.now() - startTime;
    return JSON.stringify(result);
  }

  // Cloudflare Workers AI provider handling
  if (provider === "cloudflare") {
    const effectiveCloudflareUrl = (baseUrl && baseUrl.trim()) ? baseUrl.trim() : (providerMeta?.defaultBaseUrl || "https://cloudflare.nclong87.workers.dev");
    const targetEndpoint = effectiveCloudflareUrl.replace(/\/+$/, "");

    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };

    const proxyKeyToUse = proxyKey || apiKey || process.env.PROXY_SECRET || "";
    if (proxyKeyToUse) {
      headers["X-Proxy-Key"] = proxyKeyToUse;
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

    console.log(`[Server] Calling Cloudflare Workers AI model ${payload.model} at ${targetEndpoint}`);
    const startTime = Date.now();

    const res = await fetchWithTimeout(targetEndpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      throw new Error(`Cloudflare AI Error (${res.status}): ${errText}`);
    }

    const text = await parseOpenAiStyleResponse(res);
    const responseTimeMs = Date.now() - startTime;
    const result = cleanAndParseJson(text);
    result.model = sanitizeModel(provider, llmConfig?.model);
    result.provider = provider;
    result.responseTimeMs = responseTimeMs;
    return JSON.stringify(result);
  }

  let effectiveTargetBaseUrl = baseUrl.trim();
  effectiveTargetBaseUrl = effectiveTargetBaseUrl.replace(/\/+$/, "");
  if (effectiveTargetBaseUrl.endsWith("/chat/completions")) {
    effectiveTargetBaseUrl = effectiveTargetBaseUrl.slice(0, -"/chat/completions".length).replace(/\/+$/, "");
  }

  const targetUrl = effectiveTargetBaseUrl + "/chat/completions";

  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };

  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  if (provider === "openrouter") {
    headers["HTTP-Referer"] = "https://aistudio.google.com";
    headers["X-Title"] = "Vocabulary Learner";
  }

  if (proxyKey) {
    headers["X-Proxy-Key"] = proxyKey;
  } else if (apiKey) {
    headers["X-Proxy-Key"] = apiKey;
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
  if (provider === "openai" || provider === "groq" || provider === "9flare" || provider === "gemini") {
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

  console.log(`[Server] Calling ${provider.toUpperCase()} model ${reqBody.model} at ${targetUrl} with system instruction and schema description.`);
  const startTime = Date.now();

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
    throw new Error(`${provider.toUpperCase()} API Error (${res.status}): ${errText}`);
  }

  const text = await parseOpenAiStyleResponse(res);
  const responseTimeMs = Date.now() - startTime;
  const result = cleanAndParseJson(text);
  result.model = sanitizeModel(provider, llmConfig?.model);
  result.provider = provider;
  result.responseTimeMs = responseTimeMs;
  return JSON.stringify(result);
}

async function callLLMAutoCandidates(
  prompt: string,
  systemInstruction: string,
  schemaDescription: string,
  llmConfig?: LLMRequestConfig,
  initialExcludedKeys?: Set<string>,
  signal?: AbortSignal
): Promise<string> {
  const candidates = getServerAutoModelCandidates(llmConfig);
  const excludedKeys = new Set<string>(initialExcludedKeys || []);
  let lastError: any = null;

  if (llmConfig?.preferredProvider && llmConfig?.preferredModel) {
    const prefKey = `${llmConfig.preferredProvider}:${llmConfig.preferredModel}`;
    if (!isServerModelLocked(llmConfig.preferredProvider, llmConfig.preferredModel) && !excludedKeys.has(prefKey)) {
      const prefCand = { provider: llmConfig.preferredProvider, model: llmConfig.preferredModel };
      const existingIdx = candidates.findIndex(c => c.provider === prefCand.provider && c.model === prefCand.model);
      if (existingIdx !== -1) {
        candidates.splice(existingIdx, 1);
      }
      candidates.unshift(prefCand);
    }
  }

  for (let attempt = 0; attempt < candidates.length; attempt++) {
    let cand: { provider: string; model: string };
    if (attempt === 0 && llmConfig?.preferredProvider && llmConfig?.preferredModel && candidates[0]?.provider === llmConfig.preferredProvider && candidates[0]?.model === llmConfig.preferredModel) {
      cand = candidates[0];
    } else {
      cand = getNextServerAutoCandidate(llmConfig, excludedKeys);
    }
    const candKey = `${cand.provider}:${cand.model}`;
    excludedKeys.add(candKey);

    const candProfile = llmConfig?.savedProviders?.[cand.provider];
    const candMeta = PROVIDER_OPTIONS.find(p => p.id === cand.provider);
    const candConfig: LLMRequestConfig = {
      provider: cand.provider,
      model: cand.model,
      apiKey: candProfile?.apiKey || (llmConfig?.provider === cand.provider ? llmConfig.apiKey : ""),
      proxyKey: process.env.PROXY_SECRET,
      baseUrl: candProfile?.baseUrl || candMeta?.defaultBaseUrl || "",
      savedProviders: llmConfig?.savedProviders
    };

    try {
      console.log(`[Server Auto Mode] Attempt ${attempt + 1}/${candidates.length}: Routing request to ${candKey}`);
      const resultText = await callLLMSingle(prompt, systemInstruction, schemaDescription, candConfig, signal);
      if (schemaDescription) {
        try {
          cleanAndParseJson(resultText);
        } catch (jsonErr: any) {
          throw new Error(`Invalid JSON response from ${candKey}: ${jsonErr.message}`);
        }
      }
      return resultText;
    } catch (err: any) {
      if (signal?.aborted || err?.name === "AbortError" || String(err?.message || "").includes("aborted")) {
        throw err;
      }
      err.lastAttemptedCandidate = cand;
      lastError = err;
      console.warn(`[Server Auto Mode] Model ${candKey} failed: ${err?.message || err}. Locking model for 1 hour and switching...`);
      lockServerModel(cand.provider, cand.model, 3600000);
    }
  }

  throw lastError || new Error("All AI models in Auto Mode failed on server.");
}

// Main callLLM function supporting Auto Mode
async function callLLM(
  prompt: string, 
  systemInstruction: string, 
  schemaDescription: string,
  llmConfig?: LLMRequestConfig,
  signal?: AbortSignal
): Promise<string> {
  const provider = llmConfig?.provider || "auto";

  if (provider === "auto" || llmConfig?.model === "auto") {
    return callLLMAutoCandidates(prompt, systemInstruction, schemaDescription, llmConfig, undefined, signal);
  }

  // When a specific provider is configured, call it directly and throw on error without fallbacks
  return callLLMSingle(prompt, systemInstruction, schemaDescription, llmConfig, signal);
}

function extractTextFromContent(content: any): string {
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

function extractTextFromChoice(choice: any): string {
  if (!choice) return "";
  if (choice.message) {
    const msg = choice.message;
    const txt = extractTextFromContent(msg.content) || extractTextFromContent(msg.text);
    if (txt) return txt;

    // Support reasoning or reasoning_content field (Groq, DeepSeek, OpenRouter)
    const reasoningRaw = msg.reasoning || msg.reasoning_content;
    if (reasoningRaw && !msg.content) {
      const reasoningTxt = extractTextFromContent(reasoningRaw);
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
    const txt = extractTextFromContent(delta.content) || extractTextFromContent(delta.text);
    if (txt) return txt;

    const reasoningRaw = delta.reasoning || delta.reasoning_content;
    if (reasoningRaw && delta.content === undefined) {
      const reasoningTxt = extractTextFromContent(reasoningRaw);
      if (reasoningTxt) {
        const jsonMatch = reasoningTxt.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
        if (jsonMatch && jsonMatch[1].trim()) {
          return jsonMatch[1].trim();
        }
      }
    }
  }
  if (choice.text) {
    return extractTextFromContent(choice.text);
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
          const resText = extractTextFromChoice(data.result.response) ||
                          extractTextFromChoice(data.result.text) ||
                          extractTextFromChoice(data.result.output) ||
                          extractTextFromChoice(data.result.content) ||
                          extractTextFromChoice(data.result.choices?.[0]);
          if (resText) {
            return cleanJsonResponse(resText);
          }
        }
      }
      if (data.response) {
        const resText = extractTextFromChoice(data.response);
        if (resText) return cleanJsonResponse(resText);
      }

      const content = extractTextFromChoice(data.choices?.[0]) ||
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
      const chunkText = extractTextFromChoice(parsed.choices?.[0]) ||
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

// Helper function to generate image URL via Cloudflare Worker
async function generateWorkerImage(keyword: string): Promise<string> {
  if (!keyword) return "";
  try {
    const workerUrl = `https://image.nclong87.workers.dev?query=${encodeURIComponent(keyword)}`;
    const response = await fetchWithTimeout(workerUrl, {
      method: "GET",
      headers: {
        "X-Proxy-Key": process.env.PROXY_SECRET || ""
      }
    });
    if (!response.ok) {
      console.warn(`Image worker returned status ${response.status}`);
      return "";
    }
    const responseText = await response.text();
    let url = responseText.trim();
    if (url.startsWith("{")) {
      try {
        const parsed = JSON.parse(url);
        url = parsed.url || parsed.imageUrl || parsed.image || url;
      } catch (e) {
        // ignore
      }
    }
    if (url && (url.startsWith("http://") || url.startsWith("https://"))) {
      return url;
    }
  } catch (err) {
    console.warn("Failed to fetch image from worker:", err);
  }
  return "";
}

// 1. Health check endpoint
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// Gist Proxy Endpoint for Cloud Sync
app.all(["/api/gist", "/api/gist/*"], async (req, res) => {
  const method = req.method.toUpperCase();

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Proxy-Key");

  if (method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "GET, PATCH, POST, DELETE, OPTIONS");
    return res.status(204).end();
  }

  const allowedMethods = ["GET", "PATCH", "POST", "DELETE"];
  if (!allowedMethods.includes(method)) {
    return res.status(405).json({ error: `Method Not Allowed. Only ${allowedMethods.join(", ")} and OPTIONS are allowed.` });
  }

  try {
    let subPath = req.path.replace(/^\/api\/gist/, ""); // e.g. "" or "/<gistId>"
    if (subPath === "/") subPath = "";
    const authHeader = req.headers["authorization"] || "";
    const token = typeof authHeader === "string" ? authHeader.replace(/^Bearer\s+/i, "").trim() : "";
    const clientProxyKey = (req.headers["x-proxy-key"] as string) || "";

    const isDirectGitHubPat = Boolean(token && (token.startsWith("ghp_") || token.startsWith("github_pat_")));

    const baseUrl = isDirectGitHubPat
      ? "https://api.github.com/gists"
      : "https://storage.nclong87.workers.dev/gists";

    const queryString = req.url.includes("?") ? req.url.substring(req.url.indexOf("?")) : "";
    const targetUrl = `${baseUrl}${subPath}${queryString}`;

    const headers: Record<string, string> = {
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json"
    };

    // Forward caching and validation headers from incoming client request
    if (req.headers["cache-control"]) {
      headers["Cache-Control"] = req.headers["cache-control"] as string;
    }
    if (req.headers["pragma"]) {
      headers["Pragma"] = req.headers["pragma"] as string;
    }
    if (req.headers["if-none-match"]) {
      headers["If-None-Match"] = req.headers["if-none-match"] as string;
    }
    if (req.headers["if-modified-since"]) {
      headers["If-Modified-Since"] = req.headers["if-modified-since"] as string;
    }

    if (isDirectGitHubPat) {
      headers["Authorization"] = `Bearer ${token}`;
    } else {
      // Inject server-side PROXY_SECRET proxy key into header for Worker
      const proxyKeyToInject = process.env.PROXY_SECRET || clientProxyKey || token || "";
      if (proxyKeyToInject) {
        headers["X-Proxy-Key"] = proxyKeyToInject;
      }
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
    }

    const fetchOptions: RequestInit = {
      method,
      headers
    };

    if (["PATCH", "POST", "PUT"].includes(method) && req.body) {
      if (typeof req.body === "string") {
        fetchOptions.body = req.body;
      } else if (Object.keys(req.body).length > 0) {
        fetchOptions.body = JSON.stringify(req.body);
      }
    }

    console.log(`[Gist Proxy] ${method} ${targetUrl} (Body length: ${fetchOptions.body ? (fetchOptions.body as string).length : 0})`);

    const response = await fetchWithTimeout(targetUrl, fetchOptions);

    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");

    if (response.status === 204) {
      return res.status(204).end();
    }

    const dataText = await response.text();

    let dataJson;
    try {
      dataJson = JSON.parse(dataText);
    } catch {
      dataJson = { message: dataText || response.statusText };
    }

    res.status(response.status).json(dataJson);
  } catch (error: any) {
    console.error("[Gist Proxy] Error:", error);
    res.status(500).json({ error: error.message || "Failed to communicate with Gist service" });
  }
});

// Error Reporting Endpoint
app.post("/api/report-error", (req, res) => {
  try {
    const { error, stack, componentStack, recipientEmail, userAgent, url, timestamp } = req.body || {};
    console.error("=== CLIENT ERROR REPORT RECEIVED ===");
    console.error(`Recipient: ${recipientEmail || "nclong87@gmail.com"}`);
    console.error(`Timestamp: ${timestamp || new Date().toISOString()}`);
    console.error(`URL: ${url || "N/A"}`);
    console.error(`User Agent: ${userAgent || "N/A"}`);
    console.error(`Error: ${error}`);
    console.error(`Stack: ${stack}`);
    console.error(`Component Stack: ${componentStack}`);
    console.error("=====================================");

    return res.json({
      success: true,
      message: "Error report successfully received and logged on server.",
      recipient: recipientEmail || "nclong87@gmail.com",
    });
  } catch (err: any) {
    console.error("Failed to process error report:", err);
    return res.status(500).json({ error: "Failed to process error report" });
  }
});

// Image Generation Endpoint via worker https://image.nclong87.workers.dev
app.post("/api/generate-image", async (req, res) => {
  try {
    const { query, keyword, prompt } = req.body || {};
    const queryText = query || keyword || prompt || (req.query.query as string) || (req.query.keyword as string) || (req.query.prompt as string) || "";
    if (!queryText) {
      return res.status(400).json({ error: "Query parameter is required" });
    }

    const imageUrl = await generateWorkerImage(queryText);
    if (!imageUrl) {
      return res.status(500).json({ error: "Failed to generate image from worker" });
    }
    res.json({ imageUrl, query: queryText });
  } catch (error: any) {
    console.error("Error generating image via worker:", error);
    res.status(500).json({ error: error.message || "Failed to generate image" });
  }
});

// 2. Test LLM Connection endpoint
app.post("/api/test-llm", async (req, res) => {
  try {
    const { llmConfig } = req.body;
    const text = await callLLM(
      "Respond with a short json object: {\"status\": \"connected\", \"message\": \"LLM provider connection successful!\"}",
      "You are a helpful dictionary test assistant. Output strictly valid JSON-only output when requested. Do not include any conversational filler outside the JSON.",
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

// 4. Auto-fill a single word or deduce word from natural language description
app.post("/api/autofill-word", async (req, res) => {
  const controller = new AbortController();

  try {
    const { word, hint, targetLanguage, nativeLanguage, llmConfig } = req.body;

    if (!word) {
      return res.status(400).json({ error: "Word or description is required" });
    }

    const userNative = nativeLanguage || "English";
    const userTarget = targetLanguage || "Spanish";

    const prompt = `Provide detailed vocabulary learning material for the input string "${word}".
${hint ? `Scope / Context Hint: "${hint}"\nCRITICAL: Generate the definition, translation, and example sentence matching this exact scope/context hint.` : ""}
Target language being learned: "${userTarget}".
User's native language: "${userNative}".

CRITICAL AUTOMATIC LANGUAGE DETECTION & INTENT DEDUCTION INSTRUCTIONS:
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
     * If the input sentence was in the native language (${userNative}) or describes a concept, extract or translate that core headword into ${userTarget} for "word" and provide the ${userNative} translation.
     * If the target item inside the sentence is a multi-word phrase or expression (e.g. "postpone until a later date"), preserve that full multi-word phrase intact!
1. NATURAL LANGUAGE REQUEST OR SENTENCE (EXTRACT CLEAN HEADWORD & CONTEXT):
   - If "${word}" is a user sentence or natural request specifying a word and context (e.g. "I want to add a citation in the RAG context", "I want to add table in database context", "add the word citation in RAG context"):
     * EXTRACT ONLY the pure headword or core term itself for the "word" field (e.g., set "word": "citation", NOT "I want to add a citation in the RAG context").
     * EXTRACT the specified context/domain (e.g., "RAG context") and use it as the Scope / Context Hint to generate the specific definition, translation, category, context, and example sentence for that exact domain/meaning.
     * DO NOT include full conversational text or user request phrasing inside the "word" property!
2. PARENTHETICAL NOTES & CONTEXT DISAMBIGUATION (EXTRACT CLEAN HEADWORD):
   - If "${word}" contains parenthetical text, context notes, usage domain, or disambiguation hints inside parentheses (e.g., "citation (in RAG context)", "table (database)", "run (business)"):
     * EXTRACT ONLY the pure headword or core term itself for the "word" field (e.g., set "word": "citation", NOT "citation (in RAG context)").
     * DO NOT include parenthetical explanatory text inside the "word" property!
     * USE the parenthetical text as the implicit Scope / Context Hint to generate the specific definition, translation, category, context, and example sentence matching that exact domain/meaning (e.g. source reference snippet in a RAG system).
3. CONCEPT DESCRIPTION OR REQUEST:
   - If "${word}" is a descriptive sentence asking for a word without explicitly naming it (e.g., "i want to add a word in programming, related to if condition simplify", "word for feeling persistent", "how to say thank you formally"):
     * DEDUCE and IDENTIFY the exact single best vocabulary term or expression in "${userTarget}" (e.g. "Ternary operator", "Perseverance", "Much obliged").
     * Set the "word" field strictly to this deduced Target Language word/expression.
     * Set "translation" strictly to its direct translation in "${userNative}".
4. SINGLE WORD / EXPRESSION ENTRY:
   - If "${word}" is in the user's Native Language ("${userNative}"), e.g. "xin chào": translate it into "${userTarget}" (e.g. "hello"). Set "word" to "${userTarget}" term and "translation" to "${userNative}" term.
   - If "${word}" is already in "${userTarget}" (e.g. "hello"): set "word" strictly to "${word}" and "translation" to "${userNative}".

- "definition": Write clear, concise definition/explanation STRICTLY in the TARGET language (${userTarget}) for target language immersion.
- "pronunciation": International Phonetic Alphabet (IPA) pronunciation guide for the target language word.
- "partOfSpeech": noun, verb, adjective, adverb, idiom, interjection, or expression.
- "example": A realistic, high-quality example sentence in the target language (${userTarget}), e.g. "Hello, how are you?".
- "exampleTranslation": Full translation of the example sentence into the user's native language (${userNative}), e.g. "Xin chào, bạn khỏe không?".
- "category": High-level category or topic classification (e.g. "Technology & Programming", "Travel & Hospitality", "Business & Work", "Daily Life", "Emotions & Mind", "Education", "Food & Dining", etc.).
- "context": A concise 1-sentence description of the specific real-world scenario, domain, or usage context where this term is typically used.
- "suggestedWords": Array of 2 to 3 practical companion vocabulary items in "${userTarget}".
  SPEED OPTIMIZATION: Return ONLY "word" and "translation" (or concise "definition"). Do NOT output partOfSpeech or lengthy definitions.`;

    const systemInstruction = `You are a professional multilingual dictionary database engine. You detect input language, deduce intended vocabulary from natural language descriptions, map native language inputs to the target language, and output target language vocabulary details with native language translations. Output strictly valid JSON-only output when requested. Do not include any conversational filler outside the JSON.`;
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

    const text = await callLLM(prompt, systemInstruction, schemaDesc, llmConfig, controller.signal);
    if (controller.signal.aborted) return;
    const result = cleanAndParseJson(text);
    res.json(result);
  } catch (error: any) {
    if (controller.signal.aborted || error?.name === "AbortError") {
      console.log("[/api/autofill-word] Request aborted by client");
      return;
    }
    console.error("Error autofilling word:", error);
    const parsed = parseServerError(error, req.body?.llmConfig?.provider || "gemini");
    const code = parsed.statusCode >= 400 && parsed.statusCode < 600 ? parsed.statusCode : 500;
    res.status(code).json({ error: parsed.userMessage, statusCode: parsed.statusCode, errorType: parsed.errorType });
  }
});

// 4.1. Check multiple definitions or deduce vocabulary word from natural language request
app.post("/api/check-word-definitions", async (req, res) => {
  const controller = new AbortController();

  try {
    const { word, hint, targetLanguage, nativeLanguage, llmConfig } = req.body;

    if (!word) {
      return res.status(400).json({ error: "Word or description is required" });
    }

    const userNative = nativeLanguage || "English";
    const userTarget = targetLanguage || "Spanish";

    const prompt = `Analyze the input word, phrase, or natural language request: "${word}".
${hint ? `Scope / Context Hint: "${hint}"\n` : ""}
Target language: "${userTarget}".
User's native language: "${userNative}".

CRITICAL AUTOMATIC LANGUAGE DETECTION & INTENT RESOLUTION:
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
     * USE the parenthetical text as the implicit Scope / Context Hint to generate the specific definition, translation, category, context, and example sentence matching that exact domain/meaning (e.g. source reference snippet in a RAG system).
3. CONCEPT DESCRIPTION OR REQUEST:
   - The user input "${word}" might be a sentence describing a concept without explicitly naming the term (e.g., "i want to add a word in programming, related to if condition simplify", "a word for persistent in Spanish", "how to say thank you formally").
   - If "${word}" is a description, request, or question:
     * DEDUCE and IDENTIFY 1 to 3 candidate vocabulary words or expressions in "${userTarget}" that best match the described concept (e.g. "Ternary operator", "Guard clause", "Short-circuit evaluation").
     * Set the top-level "word" field (and "word" inside each sense) strictly to the primary deduced Target Language word.
     * Set "translation" strictly to its translation in "${userNative}".
4. DIRECT WORD / EXPRESSION LOOKUP:
   - If "${word}" is in "${userNative}" (e.g. "xin chào"): translate to "${userTarget}" (e.g. "hello"). Set "word" strictly to "${userTarget}" word and "translation" to "${userNative}".
   - If "${word}" is in "${userTarget}" (e.g. "hello"): set "word" strictly to "${word}" and "translation" to "${userNative}".

3. DEFINITIONS & EXAMPLES:
   - "definition": Write clear, concise definition(s) STRICTLY in "${userTarget}" for language immersion.
   - "example": Provide example sentence(s) written STRICTLY in "${userTarget}".
   - "exampleTranslation": Provide full translation of example sentence into "${userNative}".
   - "partOfSpeech": noun, verb, adjective, adverb, expression, or idiom.
   - "pronunciation": IPA pronunciation guide for "${userTarget}" word.

4. MULTIPLE SENSES / CANDIDATES DISAMBIGUATION & STRICT CONTEXT FILTERING:
   - CRITICAL CONTEXT FILTERING RULE:
     If a specific Scope / Context Hint was provided ("${hint}") OR if a specific context/domain was extracted or specified in the input (e.g., "color" from "orange in color", "database" from "table in database context", "RAG" from "citation in RAG context"):
     * YOU MUST STRICTLY FILTER AND EXCLUDE ALL SENSES THAT DO NOT MATCH OR BELONG TO THAT SPECIFIED CONTEXT!
     * DO NOT include senses from unrelated domains! (e.g., for "orange in color" or context "color", INCLUDE ONLY color-related senses such as noun/adjective for color, and ABSOLUTELY EXCLUDE citrus fruit senses like "quả cam" / fruit!).
     * If the specified context restricts the word to a specific domain (like "color"), include ONLY senses matching that domain and DO NOT return meanings from other domains!
   - GENERAL DISAMBIGUATION:
     * If a specific context or hint narrows the word down to 1 single meaning domain or concept, set "hasMultipleSenses": false and return ONLY exact matching sense(s) in "senses".
     * If there are 2 to 4 distinct matching terms or meanings fitting the context (or across domains when no context is specified), set "hasMultipleSenses": true and include each candidate in "senses".
     * If only 1 dominant matching term exists, set "hasMultipleSenses": false and return 1 matching sense in "senses".
   - Set "notFound": false unless the input is complete gibberish with zero semantic meaning.
   - Provide the matching sense(s) in "senses". For each sense, include:
     "word": string (Target Language word in "${userTarget}"),
     "partOfSpeech": string,
     "definition": string (written in "${userTarget}"),
     "translation": string (written in "${userNative}"),
     "pronunciation": string,
     "example": string (written in "${userTarget}"),
     "exampleTranslation": string (written in "${userNative}"),
     "imageKeyword": string (CRITICAL: APPLY IMAGE QUERY ONLY TO NOUNS. If partOfSpeech is a noun, provide the single most relevant, concrete 1-3 word English visual photographic search query for this noun based on its definition and context. For abstract nouns, use an iconic physical object or concrete symbol. If partOfSpeech is NOT a noun [e.g. verb, adjective, adverb, preposition], set to empty string ""),
     "category": string,
     "context": string,
      "suggestedWords": Array of 2 to 3 practical companion vocabulary items in "${userTarget}". SPEED OPTIMIZATION: Return ONLY "word" and "translation" (or concise "definition"). Do NOT output partOfSpeech, definitions, or extra fields.`;

    const systemInstruction = `You are an elite multilingual vocabulary extraction & dictionary engine. You automatically detect input language, deduce target vocabulary terms from natural language descriptions or requests, and output structured JSON with target language words, definitions, and native language translations. Output strictly valid JSON-only output when requested. Do not include any conversational filler outside the JSON.`;
    const schemaDesc = `{
  "word": "string (the primary target word/expression STRICTLY in target language ${userTarget}, e.g. 'hello')",
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
      "word": "string (the target word/expression STRICTLY in target language ${userTarget}, e.g. 'hello')",
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

    const text = await callLLM(prompt, systemInstruction, schemaDesc, llmConfig, controller.signal);
    if (controller.signal.aborted) return;
    let result = cleanAndParseJson(text);
    const parsedProvider = result?.provider || llmConfig?.provider || "gemini";
    const parsedModel = result?.model || sanitizeModel(parsedProvider, llmConfig?.model);
    const responseTimeMs = result?.responseTimeMs;

    if (Array.isArray(result)) {
      result = {
        word: result[0]?.word || word,
        notFound: false,
        hasMultipleSenses: result.length > 1,
        senses: result
      };
    } else if (result && !result.senses && (result.word || result.definition)) {
      result = {
        word: result.word || word,
        notFound: false,
        hasMultipleSenses: false,
        senses: [result]
      };
    }

    res.json({
      ...result,
      provider: parsedProvider,
      model: parsedModel,
      responseTimeMs,
      serverLockedModels: getServerLockedModelsArray()
    });
  } catch (error: any) {
    if (controller.signal.aborted || error?.name === "AbortError") {
      console.log("[/api/check-word-definitions] Request aborted by client");
      return;
    }
    console.error("Error checking word definitions:", error);
    const parsed = parseServerError(error, req.body?.llmConfig?.provider || "gemini");
    const code = parsed.statusCode >= 400 && parsed.statusCode < 600 ? parsed.statusCode : 500;
    res.status(code).json({ error: parsed.userMessage, statusCode: parsed.statusCode, errorType: parsed.errorType });
  }
});

// 4.5. Generate random words for collection
app.post("/api/generate-random-words", async (req, res) => {
  const controller = new AbortController();

  try {
    const { topic, targetLanguage, nativeLanguage, count = 5, existingWords, llmConfig } = req.body;

    const userNative = nativeLanguage || "English";
    const userTarget = targetLanguage || "Spanish";

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

    const systemInstruction = `You are an expert language teacher. Output strictly valid JSON-only output when requested containing an array of vocabulary words in a "words" field or top-level array. Do not include any conversational filler outside the JSON.`;
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

    const text = await callLLM(prompt, systemInstruction, schemaDesc, llmConfig, controller.signal);
    if (controller.signal.aborted) return;
    const result = cleanAndParseJson(text);
    const words = extractWordsFromPayload(result);
    const parsedProvider = result?.provider || llmConfig?.provider || "gemini";
    const parsedModel = result?.model || sanitizeModel(parsedProvider, llmConfig?.model);
    const responseTimeMs = result?.responseTimeMs;

    res.json({
      words,
      provider: parsedProvider,
      model: parsedModel,
      responseTimeMs,
      serverLockedModels: getServerLockedModelsArray(),
      ...(typeof result === "object" && !Array.isArray(result) ? result : {})
    });
  } catch (error: any) {
    if (controller.signal.aborted || error?.name === "AbortError") {
      console.log("[/api/generate-random-words] Request aborted by client");
      return;
    }
    console.error("Error generating random words:", error);
    const parsed = parseServerError(error, req.body?.llmConfig?.provider || "gemini");
    const code = parsed.statusCode >= 400 && parsed.statusCode < 600 ? parsed.statusCode : 500;
    res.status(code).json({ error: parsed.userMessage, statusCode: parsed.statusCode, errorType: parsed.errorType });
  }
});

// 4.8. Fix Grammar & Polish Sentence
app.post("/api/fix-grammar", async (req, res) => {
  const controller = new AbortController();

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
}`;

    const text = await callLLM(prompt, systemInstruction, schemaDesc, llmConfig, controller.signal);
    if (controller.signal.aborted) return;
    const result = cleanAndParseJson(text);
    res.json(result);
  } catch (error: any) {
    if (controller.signal.aborted || error?.name === "AbortError") {
      console.log("[/api/fix-grammar] Request aborted by client");
      return;
    }
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
app.get("/api/tts/stream", async (req, res) => {
  try {
    const rawText = (req.query.text as string) || "";
    const lang = (req.query.lang as string) || "en";
    const engine = (req.query.engine as string) || "browser";
    const voice = (req.query.voice as string) || "";
    const model = (req.query.model as string) || "";

    if (!rawText.trim()) {
      return res.status(400).send("Text parameter is required");
    }

    const text = normalizeServerTextForTTS(rawText).slice(0, 300);
    const cleanLang = (lang.includes("-") ? lang.split("-")[0] : lang).toLowerCase() || "en";

    // 1. If Gemini AI TTS engine specified
    if (engine === "gemini") {
      const queryKey = (req.query.apiKey as string) || "";
      const keyToUse = queryKey || process.env.GEMINI_API_KEY;
      if (keyToUse) {
        try {
          const ai = new GoogleGenAI({
            apiKey: keyToUse,
            httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
          });

          const modelsToTry = [
            (model && VALID_GEMINI_MODELS.includes(model)) ? model : "gemini-2.0-flash",
            "gemini-2.0-flash",
            "gemini-1.5-flash",
            "gemini-3.6-flash"
          ];

          for (const m of Array.from(new Set(modelsToTry))) {
            try {
              const gemRes = await ai.models.generateContent({
                model: m,
                contents: `Pronounce clearly: "${text}"`,
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

              const candidate = gemRes.candidates?.[0];
              const part = candidate?.content?.parts?.find((p: any) => p.inlineData);
              if (part && part.inlineData) {
                const mimeType = part.inlineData.mimeType || "audio/mp3";
                const base64Data = part.inlineData.data || "";
                const audioBuf = Buffer.from(base64Data, "base64");

                if (mimeType.includes("l16") || mimeType.includes("pcm") || mimeType.includes("raw") || (!mimeType.includes("mp3") && !mimeType.includes("wav"))) {
                  const wavBuf = pcmToWav(audioBuf, 24000, 1, 16);
                  res.setHeader("Content-Type", "audio/wav");
                  res.setHeader("Cache-Control", "public, max-age=86400");
                  return res.send(wavBuf);
                }

                res.setHeader("Content-Type", mimeType);
                res.setHeader("Cache-Control", "public, max-age=86400");
                return res.send(audioBuf);
              }
            } catch (mErr) {
              console.warn(`Gemini TTS model ${m} failed in stream route:`, mErr);
            }
          }
        } catch (gemErr) {
          console.warn("Gemini stream TTS exception, falling back to Google TTS:", gemErr);
        }
      }
    }

    // 2. OpenAI TTS
    if (engine === "openai") {
      const queryKey = (req.query.apiKey as string) || "";
      const keyToUse = queryKey || process.env.OPENAI_API_KEY;
      if (keyToUse) {
        try {
          const oaRes = await fetchWithTimeout("https://api.openai.com/v1/audio/speech", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${keyToUse}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              model: model || "tts-1",
              input: text,
              voice: voice || "alloy"
            })
          });
          if (oaRes.ok) {
            const ab = await oaRes.arrayBuffer();
            res.setHeader("Content-Type", "audio/mpeg");
            res.setHeader("Cache-Control", "public, max-age=86400");
            return res.send(Buffer.from(ab));
          }
        } catch (oaErr) {
          console.warn("OpenAI TTS stream exception:", oaErr);
        }
      }
    }

    // 2. High-quality Google TTS stream fallback
    const googleTtsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&q=${encodeURIComponent(text)}&tl=${cleanLang}`;
    const response = await fetchWithTimeout(googleTtsUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      }
    });

    if (response.ok) {
      const arrayBuffer = await response.arrayBuffer();
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Cache-Control", "public, max-age=86400");
      return res.send(Buffer.from(arrayBuffer));
    }

    return res.status(500).send("Failed to fetch TTS stream");
  } catch (err: any) {
    console.warn("TTS stream error:", err.message);
    return res.status(500).send("TTS stream error");
  }
});

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
        return res.status(400).json({ error: "Gemini API key is required for Gemini TTS model" });
      }

      const ai = new GoogleGenAI({
        apiKey: keyToUse,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
      });

      const audioModel = (model && VALID_GEMINI_MODELS.includes(model)) ? model : "gemini-2.0-flash";
      const response = await ai.models.generateContent({
        model: audioModel,
        contents: `Pronounce clearly: "${text}"`,
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

        if (mimeType.includes("l16") || mimeType.includes("pcm") || mimeType.includes("raw") || (!mimeType.includes("mp3") && !mimeType.includes("wav"))) {
          const rawPcm = Buffer.from(base64Data, "base64");
          const rateMatch = mimeType.match(/rate=(\d+)/);
          const sampleRate = rateMatch ? parseInt(rateMatch[1], 10) : 24000;
          const wavBuffer = pcmToWav(rawPcm, sampleRate, 1, 16);
          return res.json({ audioDataUrl: `data:audio/wav;base64,${wavBuffer.toString("base64")}` });
        }
        return res.json({ audioDataUrl: `data:${mimeType};base64,${base64Data}` });
      }

      return res.status(422).json({ error: "Gemini model did not return inline audio." });
    }

    if (engine === "openai") {
      if (!effectiveApiKey) {
        return res.status(400).json({ error: "OpenAI API key is required for OpenAI TTS model" });
      }

      const ttsRes = await fetchWithTimeout("https://api.openai.com/v1/audio/speech", {
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

      if (ttsRes.ok) {
        const audioBuffer = await ttsRes.arrayBuffer();
        const base64Audio = Buffer.from(audioBuffer).toString("base64");
        return res.json({ audioDataUrl: `data:audio/mp3;base64,${base64Audio}` });
      } else {
        const errText = await ttsRes.text();
        return res.status(ttsRes.status).json({ error: `OpenAI TTS error (${ttsRes.status}): ${errText}` });
      }
    }

    if (engine === "custom") {
      if (!customEndpoint) {
        return res.status(400).json({ error: "Custom endpoint URL is required for custom TTS model" });
      }

      const customRes = await fetchWithTimeout(customEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(effectiveApiKey ? { "Authorization": `Bearer ${effectiveApiKey}` } : {})
        },
        body: JSON.stringify({ text, voice, model })
      });

      if (customRes.ok) {
        const contentType = customRes.headers.get("content-type") || "";
        if (contentType.includes("json")) {
          const json: any = await customRes.json();
          return res.json({ audioDataUrl: json.audioDataUrl || json.url || json.audio });
        } else {
          const audioBuffer = await customRes.arrayBuffer();
          const base64Audio = Buffer.from(audioBuffer).toString("base64");
          return res.json({ audioDataUrl: `data:audio/mp3;base64,${base64Audio}` });
        }
      } else {
        const errText = await customRes.text();
        return res.status(customRes.status).json({ error: `Custom TTS error (${customRes.status}): ${errText}` });
      }
    }

    return res.status(400).json({ error: "Unsupported TTS engine specified" });
  } catch (error: any) {
    const engine = req.body?.engine || "gemini";
    const parsed = parseServerError(error, engine);
    res.status(parsed.statusCode || 400).json({ 
      error: parsed.userMessage, 
      statusCode: parsed.statusCode, 
      errorType: parsed.errorType
    });
  }
});

// Helper to validate and normalize Personality Profile payload
function normalizePersonalityProfile(raw: any, interactionCount: number = 0) {
  const validArchetypes = [
    "Pragmatic Professional",
    "Curious Explorer",
    "Meticulous Perfectionist",
    "Casual Conversationalist",
    "Academic Achiever"
  ];
  const archetype = validArchetypes.includes(raw?.archetype)
    ? raw.archetype
    : "Curious Explorer";

  const rawPrefs = raw?.learningPreferences || {};
  const validModalities = ["contextual_examples", "grammar_mechanics", "visual_mnemonics", "etymological_roots"];
  const validDepths = ["punchy_concise", "deep_nuance", "dialogue_driven"];
  const validFormalities = ["formal", "business_casual", "relaxed_slang"];
  const validAttitudes = ["gentle_scaffolding", "direct_critique", "fast_paced_gamified"];

  return {
    version: 1,
    lastUpdated: Date.now(),
    interactionCountAnalyzed: interactionCount,
    confidenceScore: typeof raw?.confidenceScore === "number" ? Math.min(100, Math.max(10, raw.confidenceScore)) : Math.min(95, Math.max(25, 30 + interactionCount * 3)),
    archetype,
    archetypeSummary: raw?.archetypeSummary || raw?.summary || "Dedicated learner developing comprehensive language mastery.",
    archetypeTraits: Array.isArray(raw?.archetypeTraits) && raw.archetypeTraits.length > 0
      ? raw.archetypeTraits.slice(0, 5)
      : ["Context-First", "Curious", "Goal-Oriented"],
    learningPreferences: {
      primaryModality: validModalities.includes(rawPrefs.primaryModality) ? rawPrefs.primaryModality : "contextual_examples",
      explanationDepth: validDepths.includes(rawPrefs.explanationDepth) ? rawPrefs.explanationDepth : "punchy_concise",
      formalityPreference: validFormalities.includes(rawPrefs.formalityPreference) ? rawPrefs.formalityPreference : "business_casual",
      challengeAttitude: validAttitudes.includes(rawPrefs.challengeAttitude) ? rawPrefs.challengeAttitude : "fast_paced_gamified"
    },
    detectedInterests: Array.isArray(raw?.detectedInterests) && raw.detectedInterests.length > 0
      ? raw.detectedInterests.slice(0, 6)
      : ["Everyday Communication", "Vocabulary Expansion"],
    frequentQuestionTypes: Array.isArray(raw?.frequentQuestionTypes) && raw.frequentQuestionTypes.length > 0
      ? raw.frequentQuestionTypes.slice(0, 4)
      : ["nuance_comparison", "collocations"],
    diagnostics: {
      strengths: Array.isArray(raw?.diagnostics?.strengths) && raw.diagnostics.strengths.length > 0
        ? raw.diagnostics.strengths.slice(0, 3)
        : ["Consistent vocabulary building", "Inquisitive approach to words"],
      blindSpots: Array.isArray(raw?.diagnostics?.blindSpots) && raw.diagnostics.blindSpots.length > 0
        ? raw.diagnostics.blindSpots.slice(0, 3)
        : ["Dependent prepositions and collocations need reinforcement"],
      actionableAdvice: raw?.diagnostics?.actionableAdvice || "Focus on using new words in full context sentences during daily study."
    },
    tailoredSystemPromptPatch: raw?.tailoredSystemPromptPatch || "Provide practical, context-rich examples with natural phrasing and clear formality guidance."
  };
}

// 6b. Analyze User Personality & Learner Profile endpoint
app.post("/api/analyze-personality-profile", async (req, res) => {
  const controller = new AbortController();

  try {
    const {
      activityDigest,
      inquiries = [],
      totalWords = 0,
      quizzesTaken = 0,
      accuracy = 0,
      streak = 0,
      topCategories = [],
      targetLanguage = "English",
      nativeLanguage = "Vietnamese",
      llmConfig
    } = req.body;

    const inquiriesCount = inquiries.length;
    let inquiriesContext = "";
    if (Array.isArray(inquiries) && inquiries.length > 0) {
      inquiriesContext = inquiries
        .slice(-25)
        .map((inq: any, idx: number) => {
          const origin = inq.source === "ask_ai_dialog" ? `[Ask AI Modal on "${inq.word || 'word'}"]` : "[Main Chat]";
          const pos = inq.partOfSpeech ? ` (${inq.partOfSpeech})` : "";
          const cat = inq.category ? ` [Category: ${inq.category}]` : "";
          return `${idx + 1}. ${origin}${cat}${pos}: "${inq.question}"`;
        })
        .join("\n");
    } else {
      inquiriesContext = "No prior custom inquiries logged yet.";
    }

    const categoriesStr = Array.isArray(topCategories) && topCategories.length > 0
      ? topCategories.map((c: any) => `${c.category} (${c.count} words)`).join(", ")
      : "General topics";

    const prompt = `You are an expert psycholinguist, cognitive learning scientist, and adaptive language coach.
Analyze the following student activity records, inquiries (including both Main Chat view and in-situ "Ask AI" word questions), vocabulary collection distributions, and quiz statistics to formulate an accurate, personalized User Personality & Learner Profile.

STUDENT ACTIVITY PROFILE:
- Target Language: ${targetLanguage}
- Native / Explanation Language: ${nativeLanguage}
- Total Vocabulary Words: ${totalWords}
- Top Vocabulary Themes: ${categoriesStr}
- Quizzes Completed: ${quizzesTaken}
- Quiz Accuracy: ${accuracy}%
- Study Streak: ${streak} days

RECENT INQUIRIES & QUESTIONS LOGGED (Both Main Chat and "Ask AI" modal queries):
${inquiriesContext}

${activityDigest ? `ADDITIONAL ACTIVITY DIGEST:\n${activityDigest}\n` : ""}

CRITICAL PROFILING INSTRUCTIONS:
1. Examine the user's specific questions closely:
   - Do they ask about nuance and subtle differences between synonyms? -> Traits: "Nuance-Seeker", "Meticulous".
   - Do they ask if phrases can be used in workplace meetings or formal emails? -> Archetype: "Pragmatic Professional".
   - Do they ask for slang, idioms, or casual conversation flow? -> Archetype: "Casual Conversationalist" or "Curious Explorer".
   - Do they focus on test preparation, academic writing, or strict rules? -> Archetype: "Academic Achiever".
2. Determine their preferred explanation depth, modality (contextual_examples, grammar_mechanics, visual_mnemonics, or etymological_roots), and formality preference.
3. Formulate genuine cognitive strengths and blind spots observed from their inquiries.
4. Craft a concise "tailoredSystemPromptPatch" (2-3 sentences) that an AI assistant can adopt to converse with this learner in their optimal style.
5. Provide the "archetypeSummary" and "actionableAdvice" in ${nativeLanguage} (or bilingual with ${targetLanguage}) so it feels natively personal and engaging.`;

    const systemInstruction = `You are an elite psycholinguist and adaptive education researcher. Output strictly valid JSON-only matching the schema below. CRITICAL: Archetype MUST be strictly one of: "Pragmatic Professional", "Curious Explorer", "Meticulous Perfectionist", "Casual Conversationalist", "Academic Achiever". Do not include conversational filler outside the JSON.`;

    const schemaDesc = `{
  "confidenceScore": 85,
  "archetype": "Pragmatic Professional | Curious Explorer | Meticulous Perfectionist | Casual Conversationalist | Academic Achiever",
  "archetypeSummary": "string (1-2 sentence executive summary in ${nativeLanguage})",
  "archetypeTraits": ["string", "string", "string"],
  "learningPreferences": {
    "primaryModality": "contextual_examples | grammar_mechanics | visual_mnemonics | etymological_roots",
    "explanationDepth": "punchy_concise | deep_nuance | dialogue_driven",
    "formalityPreference": "formal | business_casual | relaxed_slang",
    "challengeAttitude": "gentle_scaffolding | direct_critique | fast_paced_gamified"
  },
  "detectedInterests": ["string", "string"],
  "frequentQuestionTypes": ["nuance_comparison | collocations | pronunciation | grammar | formality | usage_context"],
  "diagnostics": {
    "strengths": ["string", "string"],
    "blindSpots": ["string"],
    "actionableAdvice": "string (Actionable advice for the next 7 days in ${nativeLanguage})"
  },
  "tailoredSystemPromptPatch": "string (2-3 sentence directive instructing an AI tutor on how to personalize future answers for this user)"
}`;

    const text = await callLLM(prompt, systemInstruction, schemaDesc, llmConfig, controller.signal);
    const rawParsed = cleanAndParseJson(text);
    const result = normalizePersonalityProfile(rawParsed, inquiriesCount);

    if (rawParsed.provider) (result as any).provider = rawParsed.provider;
    if (rawParsed.model) (result as any).model = rawParsed.model;
    if (rawParsed.responseTimeMs !== undefined) (result as any).responseTimeMs = rawParsed.responseTimeMs;

    res.json(result);
  } catch (error: any) {
    console.error("Error analyzing user personality profile:", error);
    const parsed = parseServerError(error, req.body?.llmConfig?.provider || "gemini");
    const code = parsed.statusCode >= 400 && parsed.statusCode < 600 ? parsed.statusCode : 500;
    res.status(code).json({
      error: parsed.userMessage,
      statusCode: parsed.statusCode,
      errorType: parsed.errorType
    });
  }
});

// 7. Interactive Chat Assistant endpoint
app.post("/api/chat", async (req, res) => {
  const controller = new AbortController();

  try {
    const { messages, targetLanguage = "English", nativeLanguage = "Spanish", llmConfig, wordContext, userInquiries, userProfile } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "Messages array is required and cannot be empty" });
    }

    const chatHistoryStr = messages
      .slice(-10) // Limit to last 10 messages to avoid token bloat
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

      if (wordContext.quizContext) {
        const qc = wordContext.quizContext;
        wordContextInstruction += `\n\nQUIZ QUESTION CONTEXT & LEARNER ANSWER:
The user opened this AI assistant dialog specifically to ask about a quiz question:
- Quiz Question: "${qc.question || "N/A"}"
- User's Submitted Answer: "${qc.userAnswer || "N/A"}"
- Correct Answer: "${qc.correctAnswer || wordContext.word}"
- Question Result Status: ${qc.isCorrect ? "CORRECT" : "INCORRECT"}
- Sentence Context: "${qc.sentence || "N/A"}"
- Sentence Translation: "${qc.sentenceTranslation || "N/A"}"

CRITICAL INSTRUCTIONS FOR QUIZ QUESTION CONTEXT:
- The user may ask why their answer was correct or incorrect, or why the correct answer fits best.
- Provide a clear, encouraging, and precise breakdown explaining why "${qc.correctAnswer || wordContext.word}" is correct.
- If the user's answer ("${qc.userAnswer}") was incorrect, clearly explain why it does not fit in this specific context or sentence structure.
- Compare nuances between "${qc.correctAnswer || wordContext.word}" and "${qc.userAnswer}" if applicable.`;
      }
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
        userInquiryInstruction = `\n\nUSER LEARNING PATTERNS & RECENT INQUIRIES (JUST-IN-TIME PERSONALIZATION):
The user has recently asked the following questions during study sessions:
${recentQuestionsList}

CRITICAL PERSONALIZATION FOR SUGGESTED ACTIONS:
- Analyze the user's inquiry patterns above (e.g. business/workplace emails, preposition precision, nuance/distinction between synonyms, spoken conversational dialogues, or memory mnemonics).
- Customize the 3 interactive suggestedActions in your response so their labels and payloads directly match this user's demonstrated learning preferences and interests for "${wordContext?.word || targetLanguage}".
- Keep suggestedActions compelling, highly specific to the current topic/word, and immediately useful.`;
      }
    }

    let userProfileInstruction = "";
    if (userProfile && typeof userProfile === "object" && userProfile.archetype) {
      userProfileInstruction = `\n\nUSER PERSONALITY & LEARNING PROFILE:
- Learning Archetype: ${userProfile.archetype}
- Learning Style & Preferences:
  * Primary Modality: ${userProfile.learningPreferences?.primaryModality || "contextual_examples"}
  * Preferred Explanation Depth: ${userProfile.learningPreferences?.explanationDepth || "punchy_concise"}
  * Formality Preference: ${userProfile.learningPreferences?.formalityPreference || "business_casual"}
  * Challenge Attitude: ${userProfile.learningPreferences?.challengeAttitude || "fast_paced_gamified"}
- Known Topics of Interest: ${(userProfile.detectedInterests || []).join(", ") || "General Vocabulary"}
- Adaptive Directive: ${userProfile.tailoredSystemPromptPatch || "Tailor examples and explanations to this learner's habits."}
(Adopt this persona tone and pacing naturally without explicitly quoting these parameters to the user).`;
    }

    const prompt = `Below is the recent conversation history between the User and you (the Assistant):\n\n${chatHistoryStr}\n\nAssistant, formulate your next helpful response. Ensure to check if the user is interested in practicing or adding words, and attach appropriate suggestedActions.`;

    const systemInstruction = `You are an elite, highly encouraging AI Language Coach and Vocabulary Assistant.
Your mission is to help the user master their target language "${targetLanguage}" from their native language "${nativeLanguage}".
You speak in a warm, welcoming, and linguistically precise tone.${wordContextInstruction}${userInquiryInstruction}${userProfileInstruction}

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

6. **Suggesting Related/Paired Words & Asking Questions for Duplicate/Known Words**:
   - When the user asks for commonly paired or related words for a word (e.g. "Suggest commonly paired words for \"{word}\"" or "Suggest related words for \"{word}\""):
     * Identify the target "{word}" from the prompt.
     * Provide up to 3 related words or phrases commonly paired with "{word}" in "${targetLanguage}".
     * For each related word, give its part of speech, definition, and native translation in "${nativeLanguage}".
     * CRITICAL: You MUST include "add_word" actions inside "suggestedActions" for each of these 1-3 related words in your JSON response so the user can easily click to add them to their collection! For example, [{"label": "+ Add '[word]'", "action": "add_word", "payload": {"word": "[word]", "hint": "[translation]"}}].
   - When the user asks a question about a word (e.g. "Tell me how to use \"{word}\" in conversation and ask me a practice question." or "Ask questions about \"{word}\""):
     * Identify "{word}" from the prompt.
     * Explain clearly how "{word}" is used in "${targetLanguage}" conversation.
     * Provide a realistic example sentence and translation.
     * Ask the user an interactive practice question (e.g., fill-in-the-blank, multiple choice, or conversational scenario) to test their understanding of "{word}".
     * CRITICAL: You MUST include 3 to 4 interactive reply options as "send_message" in 'suggestedActions' (with helpful answers/responses to your practice question) so the user can click to reply!

7. **Suggesting Words & Vocabulary Actions**:
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
        "word": "string (required only if action is 'add_word')",
        "message": "string (required only if action is 'send_message')"
      }
    }
  ]
}`;

    const text = await callLLM(prompt, systemInstruction, schemaDesc, llmConfig, controller.signal);
    let parsed: any;
    try {
      parsed = cleanAndParseJson(text);
    } catch {
      parsed = { text: text };
    }

    if (typeof parsed === "string") {
      parsed = { text: parsed };
    } else if (!parsed || typeof parsed !== "object") {
      parsed = { text: String(parsed || "") };
    }

    // Extract text from any common property names returned by various models
    const mainText = parsed.text || parsed.message || parsed.content || parsed.response || parsed.reply || parsed.answer || parsed.result || (typeof text === "string" ? text : "");

    // Normalize and sanitize suggestedActions
    let rawActions = Array.isArray(parsed.suggestedActions) 
      ? parsed.suggestedActions 
      : (Array.isArray(parsed.suggested_actions) ? parsed.suggested_actions : (Array.isArray(parsed.actions) ? parsed.actions : []));

    const sanitizedActions = rawActions
      .filter((act: any) => {
        if (!act || typeof act !== "object") return false;
        if (act.action === "select_definition") return Boolean(act.payload?.definition);
        const lbl = act.label ? String(act.label).trim() : "";
        const msgPayload = act.payload?.message ? String(act.payload.message).trim() : "";
        const wordPayload = act.payload?.word || act.word ? String(act.payload?.word || act.word).trim() : "";
        return lbl.length > 0 || msgPayload.length > 0 || wordPayload.length > 0;
      })
      .map((act: any) => {
        const cleaned = { ...act };
        if (!cleaned.label || !String(cleaned.label).trim()) {
          if (cleaned.payload?.message) cleaned.label = cleaned.payload.message;
          else if (cleaned.payload?.word) cleaned.label = `Add "${cleaned.payload.word}" to collection`;
          else if (cleaned.word) cleaned.label = `Add "${cleaned.word}" to collection`;
        }
        return cleaned;
      });

    const lastUserMsg = messages[messages.length - 1]?.content || "";
    const finalActions = extractOrGenerateTopicActions(
      mainText,
      sanitizedActions,
      lastUserMsg,
      targetLanguage,
      nativeLanguage
    );

    res.json({
      ...parsed,
      text: mainText,
      suggestedActions: finalActions,
      serverLockedModels: getServerLockedModelsArray()
    });
  } catch (error: any) {
    if (controller.signal.aborted || error.name === "AbortError" || String(error).includes("aborted")) {
      console.log("[Server] /api/chat request aborted by client.");
      return;
    }
    console.error("Error in AI chat:", error);
    const parsed = parseServerError(error, req.body?.llmConfig?.provider || "gemini");
    const code = parsed.statusCode >= 400 && parsed.statusCode < 600 ? parsed.statusCode : 500;
    res.status(code).json({
      error: parsed.userMessage,
      statusCode: parsed.statusCode,
      errorType: parsed.errorType,
      provider: parsed.provider,
      model: parsed.model,
      serverLockedModels: getServerLockedModelsArray()
    });
  }
});

// 7b. On-demand JIT Suggested Actions endpoint (Analyzes user inquiry history for targeted prompts)
app.post("/api/suggested-actions", async (req, res) => {
  const controller = new AbortController();
  try {
    const { word, targetLanguage = "English", nativeLanguage = "Spanish", llmConfig, userInquiries } = req.body;
    if (!word || !word.word) {
      return res.status(400).json({ error: "Word object with 'word' property is required" });
    }

    let userInquiryContext = "";
    if (Array.isArray(userInquiries) && userInquiries.length > 0) {
      const list = userInquiries
        .slice(-8)
        .map((item: any, idx: number) => {
          const q = typeof item === "string" ? item : item.question;
          const w = typeof item === "object" && item.word ? ` (on "${item.word}")` : "";
          return `${idx + 1}. "${q}"${w}`;
        })
        .filter((l: string) => l.trim().length > 3)
        .join("\n");
      if (list) {
        userInquiryContext = `The user recently asked these study questions across recent sessions:\n${list}\n`;
      }
    }

    const pos = word.partOfSpeech ? `(Part of speech: ${word.partOfSpeech})` : "";
    const def = word.translation || word.definition ? `(Meaning: ${word.translation || word.definition})` : "";

    const prompt = `The user is studying the word "${word.word}" ${pos} ${def}.
Target Language: ${targetLanguage}. Native Language: ${nativeLanguage}.
${userInquiryContext}
Generate exactly 3 highly engaging, personalized suggested action prompts for exploring and mastering "${word.word}".
Analyze the user's inquiry patterns if provided (e.g. workplace/business communication, preposition precision, nuance/distinction vs synonyms, spoken conversational dialogues, or memory mnemonics) and align the suggestions with their interests.
Do NOT suggest quizzes, tests, or practice exams. Each action must be an engaging exploration or conversational question.`;

    const systemInstruction = `You are an elite language learning coach. Return exactly 3 interactive suggested actions as valid JSON only.`;
    const schemaDesc = `{
  "suggestedActions": [
    {
      "label": "string (short enticing action label with an emoji, max 30 chars, e.g. '💼 Business email phrasing', '🔗 Prepositions with liaise', '⚖️ Liaise vs Coordinate')",
      "action": "send_message",
      "payload": {
        "message": "string (the natural, comprehensive question to ask the AI coach when this action is clicked)"
      }
    }
  ]
}`;

    const text = await callLLM(prompt, systemInstruction, schemaDesc, llmConfig, controller.signal);
    let parsed: any;
    try {
      parsed = cleanAndParseJson(text);
    } catch {
      parsed = { suggestedActions: [] };
    }

    const rawActions = Array.isArray(parsed?.suggestedActions) ? parsed.suggestedActions : [];
    const validActions = rawActions
      .filter((a: any) => a && (a.label || a.payload?.message))
      .map((a: any) => ({
        label: a.label || a.payload?.message,
        action: "send_message" as const,
        payload: {
          message: a.payload?.message || a.label
        }
      }));

    res.json({ suggestedActions: validActions });
  } catch (err: any) {
    if (controller.signal.aborted || err?.name === "AbortError") {
      return;
    }
    console.error("Error generating suggested actions:", err);
    res.status(500).json({ error: err?.message || "Failed to generate suggested actions" });
  }
});

// Helper to check if a part of speech string indicates a noun
function isNoun(partOfSpeech?: string | null): boolean {
  if (!partOfSpeech || typeof partOfSpeech !== "string") return false;
  const pos = partOfSpeech.trim().toLowerCase();
  if (pos === "n" || pos === "n.") return true;
  if (
    pos.includes("noun") ||
    pos.includes("danh từ") ||
    pos.includes("sustantivo") ||
    pos.includes("substantiv") ||
    pos.includes("nom") ||
    pos.includes("명사") ||
    pos.includes("名詞") ||
    pos.includes("名词")
  ) {
    return true;
  }
  return false;
}

// 8. Quiz Question Generation endpoint
app.post("/api/generate-quiz", async (req, res) => {
  const controller = new AbortController();

  try {
    const { words, targetLanguage = "English", nativeLanguage = "Vietnamese", llmConfig, practiceMode } = req.body;

    if (!words || !Array.isArray(words) || words.length === 0) {
      return res.status(400).json({ error: "Words array is required and cannot be empty" });
    }

    const isDuelMode = practiceMode === "confuser_duel" || practiceMode === "sandwich_duel";
    const isSandwichMode = practiceMode === "sandwich_quiz" || practiceMode === "balanced";

    // Strictly deduplicate target words by word text so the LLM is never sent duplicate words
    const uniqueInputWords: any[] = [];
    for (const w of words) {
      const wText = String(w.word || "").trim();
      if (!wText) continue;
      if (!uniqueInputWords.some((uw: any) => (uw.word || "").trim().toLowerCase() === wText.toLowerCase())) {
        uniqueInputWords.push(w);
      }
    }

    // Strictly enforce maximum 3 target words for faster LLM generation and response latency
    const targetWords = uniqueInputWords.slice(0, 3);
    const expectedCount = targetWords.length;
    const hasAnyNoun = targetWords.some((w: any) => isNoun(w.partOfSpeech));
    const minimalWordList = targetWords.map((w: any) => ({
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
   - 'sentence': Fill-in-the-blank with "______". Include complete 'sentence' and 'sentenceTranslation' (${nativeLanguage}). The 'question' MUST embed the context sentence containing "______".
   - 'definition': Match word to definition.
   - 'picture': Set concise 1-3 word 'imageKeyword' (ONLY FOR NOUNS).
   - 'duel': Pit target word against rival 'confuserWord' with a crisp 1-sentence 'contrastRule'.
     CRITICAL REQUIREMENT FOR 'duel': The 'question' MUST be a contextual fill-in-the-blank sentence where "______" represents the target word in a natural context (e.g. 'Choose the word that accurately fits the context:\n"We ______ finish work at five, but today we stayed late."'). NEVER output a vague instruction like 'Choose the word that best matches the given nuance (_____).' without a complete context sentence!
${isDuelMode 
  ? "   - Duel Mode: ALL questions MUST be 'duel' type with 'confuserWord', 'contrastRule', and a full context sentence containing '______'." 
  : isSandwichMode 
  ? (hasAnyNoun && expectedCount >= 2 
      ? "   - Balanced Session: Blend question types across the different words; include 1 'duel' question (with context sentence) and 1 'picture' question for a NOUN target word." 
      : hasAnyNoun 
      ? "   - Balanced Session: Include 1 'picture' question for a NOUN target word with an 'imageKeyword'."
      : "   - Balanced Session: Blend 'sentence', 'definition', or 'duel' questions (no picture questions since no word is a noun).")
  : (hasAnyNoun 
      ? "   - Include at least 1 'picture' question with an 'imageKeyword' for a target word that is a NOUN."
      : "   - Use 'sentence', 'definition', or 'duel' questions (no picture questions since no word is a noun).")}
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
      "sentence": "string (complete sentence)",
      "sentenceTranslation": "string (translation in ${nativeLanguage})",
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
        : isSandwichMode 
        ? (hasAnyNoun && expectedCount >= 2 
            ? `5. Include 1 'duel' (with 'confuserWord', 'contrastRule', and full context sentence with '______') and 1 'picture' question for a NOUN target word.\n`
            : hasAnyNoun
            ? `5. Include 1 'picture' question with 1-3 word 'imageKeyword' for a NOUN target word.\n`
            : `5. Use 'sentence', 'definition', or 'duel' questions.\n`)
        : (hasAnyNoun 
            ? `5. Include at least 1 'picture' question with 1-3 word 'imageKeyword' for a NOUN target word.\n`
            : `5. Use 'sentence', 'definition', or 'duel' questions.\n`)) +
      `6. Suggested words for EACH individual question: Include "suggestedWords" with 2-3 items containing "word", "translation", "partOfSpeech", and "category". CRITICAL FOR CONFUSER DUEL: Specifically examine and scan the generated context sentence and example for phrasal verbs (e.g., "laugh it off", "look forward to", "trip on", "give up", "break down"). Actively include phrasal verbs in "suggestedWords" and explicitly categorize them with category: "phrasal verb" and partOfSpeech: "phrasal verb"! Keep multi-word phrasal verbs intact (do NOT strip prepositions or shorten phrases).\n` +
      `7. CRITICAL NO-BLANK REQUIREMENT FOR SENTENCE & TRANSLATION: "sentence" must be the complete, natural sentence with the target word in place (no blanks). "sentenceTranslation" must be the natural full sentence translation in ${nativeLanguage} with NO blanks, underscores, or placeholders (NEVER put "______" or "(_____)" in sentenceTranslation).`;

    const schemaDesc = `Object with questions: array of exactly ${expectedCount} QuizQuestion objects (1 per word) each containing word, type, question, options, correctAnswer, hint, sentence, sentenceTranslation, imageKeyword, confuserWord, contrastRule, and suggestedWords (array of 2 to 3 items each containing "word", "translation", "partOfSpeech", and "category", explicitly identifying and categorizing phrasal verbs as category "phrasal verb").`;

    const text = await callLLM(prompt, systemInstruction, schemaDesc, llmConfig, controller.signal);
    if (controller.signal.aborted) return;
    const cleaned = cleanJsonResponse(text);
    const result = cleanAndParseJson(cleaned);

    let provider = result.provider || llmConfig?.provider || "gemini";
    let model = result.model || sanitizeModel(provider, llmConfig?.model);
    let responseTimeMs = result.responseTimeMs;

    let questionsArray: any[] = [];
    let topLevelSuggestions: any[] = [];

    if (Array.isArray(result)) {
      questionsArray = result;
    } else if (result && typeof result === "object") {
      if (Array.isArray(result.questions)) {
        questionsArray = result.questions;
      }
      if (Array.isArray(result.suggestedWords)) {
        topLevelSuggestions = result.suggestedWords;
      }
    }

    // Helper to normalize exactly 3 companion words for an individual question
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
      return resList.length >= 1 ? resList : [];
    };

    if (Array.isArray(questionsArray) && questionsArray.length > 0) {
      // Guarantee at least one picture question in result (unless in confuser duel mode)
      if (!isDuelMode) {
        const hasPicture = questionsArray.some((q: any) => q.type === "picture");
        if (!hasPicture) {
          questionsArray[0].type = "picture";
          questionsArray[0].question = "Which word matches the visual concept shown below?";
          questionsArray[0].imageKeyword = questionsArray[0].word;
        }
      }

      // Build a set of all tested target words to strictly filter out any lazy cross-word distractors
      const allTargetWordKeys = new Set(words.map((w: any) => (w.word || "").toLowerCase().trim()));

      // Helper for fallback confusers on server
      const generateServerConfusers = (target: string): string[] => {
        const list: string[] = [];
        if (target.includes(" ")) {
          const particleMap: Record<string, string[]> = {
            "off": ["out", "down", "up", "away"],
            "out": ["in", "up", "down", "off"],
            "up": ["down", "out", "in", "off"],
            "down": ["up", "off", "out"],
            "in": ["out", "up", "down"],
            "on": ["off", "in", "out", "up"],
            "away": ["off", "out", "back"],
          };
          for (const [p, reps] of Object.entries(particleMap)) {
            const regex = new RegExp(`\\b${p}\\b`, 'gi');
            if (regex.test(target)) {
              for (const r of reps) list.push(target.replace(regex, r));
            }
          }
        }
        list.push(
          target.replace(/ie/gi, 'ei'),
          target.replace(/ei/gi, 'ie'),
          target.replace(/tion/gi, 'sion'),
          target.replace(/sion/gi, 'tion'),
          target.replace(/c/gi, 's'),
          target.replace(/s/gi, 'c'),
          target + "e",
          target.endsWith('e') ? target.slice(0, -1) : target + "s",
          target + "ing",
          target + "ed",
          target + "ly",
          target + "er"
        );
        return Array.from(new Set(list)).filter(c => c.toLowerCase() !== target.toLowerCase() && c.trim().length > 1);
      };

      const isQuestionSentenceValid = (text: string): boolean => {
        if (!text || typeof text !== "string") return false;
        const stripped = text
          .replace(/⚔️\s*Confuser Duel\s*(?:\(Contrast Match\))?:?/gi, "")
          .replace(/Choose the (?:word|term) that (?:accurately|best)?\s*(?:fits|matches)[^:\n]*:?/gi, "")
          .replace(/Fill in the blank (?:for the sentence)?:?/gi, "")
          .replace(/Which word matches[^:\n]*:?/gi, "")
          .replace(/Please select the (?:correct )?word:?/gi, "")
          .replace(/\[blank\]|\[BLANK\]|\(\s*_{2,}\s*\)|\(_+\)|_{2,}|\.{3,}/gi, "")
          .replace(/["“”'()]/g, "")
          .trim();
        const words = stripped.split(/\s+/).filter(w => w.length > 0);
        if (words.length < 3) return false;
        if (/^(?:the\s+)?given\s+nuance\.?$/i.test(stripped)) return false;
        if (/^(?:the\s+)?context\.?$/i.test(stripped)) return false;
        return true;
      };

      const getDefaultContextSentence = (word: string, pos?: string): string => {
        const clean = (word || "").trim();
        const lower = clean.toLowerCase();
        const p = (pos || "").toLowerCase().trim();
        if (p === "adverb" || lower.endsWith("ly")) {
          return `She ${clean} finishes her tasks on schedule, rarely missing any deadline.`;
        }
        if (p === "verb") {
          return `The team must ${clean} the necessary requirements before launching.`;
        }
        if (p === "adjective") {
          return `The speaker provided a very ${clean} explanation for the audience.`;
        }
        if (p === "noun") {
          return `The committee examined the ${clean} carefully before deciding.`;
        }
        return `The team needed to ${clean} the procedure accurately.`;
      };

      const ensureServerQuestionHasBlank = (qText: string, tWord: string, fallbackSentence?: string, partOfSpeech?: string): string => {
        const cleanT = (tWord || "").trim();
        if (!qText || !isQuestionSentenceValid(qText)) {
          let baseSentence = "";
          if (fallbackSentence && isQuestionSentenceValid(fallbackSentence)) {
            baseSentence = fallbackSentence;
          } else {
            baseSentence = getDefaultContextSentence(cleanT, partOfSpeech);
          }
          const cleanBase = baseSentence.replace(/^["“]|["”]$/g, "").trim();
          const sentenceWithBlank = ensureServerQuestionHasBlank(cleanBase, cleanT);
          const cleanFinal = sentenceWithBlank.replace(/^["“]|["”]$/g, "").trim();
          return `Choose the word that accurately fits the context to break the confusion:\n"${cleanFinal}"`;
        }
        let sanitized = qText.replace(/\[blank\]|\[BLANK\]|\(\s*_{2,}\s*\)|\(_+\)|_{2,}|\.{3,}/gi, "______");
        if (sanitized.includes("______")) return sanitized;
        if (!cleanT) return sanitized + " ______";
        const escaped = cleanT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const rSuffixes = new RegExp(`\\b${escaped}(?:s|es|ed|ing|d)?\\b`, "gi");
        if (rSuffixes.test(sanitized)) return sanitized.replace(rSuffixes, "______");
        let stem = escaped;
        if (cleanT.endsWith("e")) stem = escaped.slice(0, -1);
        else if (cleanT.endsWith("y")) stem = escaped.slice(0, -1) + "(?:y|ies|ied)";
        const rStem = new RegExp(`\\b${stem}(?:ing|ed|es|s)?\\b`, "gi");
        if (rStem.test(sanitized)) return sanitized.replace(rStem, "______");
        if (/"\s*$/i.test(sanitized)) return sanitized.replace(/"\s*$/i, " ______\"");
        if (/\.\s*$/i.test(sanitized)) return sanitized.replace(/\.\s*$/i, " ______.");
        return sanitized + " ______";
      };

      // Helper to generate a fallback question if an input word was missed or duplicated
      const createFallbackQuestion = (wordObj: any, qIdx: number, preferPicture: boolean): any => {
        const wText = wordObj.word || `Word-${qIdx}`;
        const confusers = generateServerConfusers(wText);
        const options = [wText, ...confusers.slice(0, 3)].sort(() => 0.5 - Math.random());
        const wordIsNoun = isNoun(wordObj.partOfSpeech);
        
        if (preferPicture && wordIsNoun) {
          return {
            id: `ai-q-${wordObj.id || qIdx}-${qIdx}`,
            wordId: wordObj.id || `w-${qIdx}`,
            word: wText,
            partOfSpeech: wordObj.partOfSpeech,
            type: "picture",
            question: "Which word matches the visual concept shown below?",
            options,
            correctAnswer: wText,
            hint: wordObj.pronunciation || "",
            sentence: wordObj.example || undefined,
            sentenceTranslation: wordObj.exampleTranslation || undefined,
            imageKeyword: wText,
            suggestedWords: []
          };
        }
        
        const hasSentence = Boolean(wordObj.example && isQuestionSentenceValid(wordObj.example));
        const baseSentence = hasSentence ? wordObj.example : getDefaultContextSentence(wText, wordObj.partOfSpeech);
        const qSentence = ensureServerQuestionHasBlank(baseSentence, wText, undefined, wordObj.partOfSpeech);
        return {
          id: `ai-q-${wordObj.id || qIdx}-${qIdx}`,
          wordId: wordObj.id || `w-${qIdx}`,
          word: wText,
          partOfSpeech: wordObj.partOfSpeech,
          type: "sentence",
          question: `Fill in the blank for the sentence:\n"${qSentence.replace(/^["“]|["”]$/g, "").trim()}"`,
          options,
          correctAnswer: wText,
          hint: wordObj.pronunciation || "",
          sentence: baseSentence,
          sentenceTranslation: wordObj.exampleTranslation || undefined,
          imageKeyword: undefined,
          suggestedWords: []
        };
      };

      const seenWordKeys = new Set<string>();
      const deduplicatedQuestions: any[] = [];

      for (let idx = 0; idx < questionsArray.length; idx++) {
        const q = questionsArray[idx];
        const qWordLower = String(q.word || q.correctAnswer || "").toLowerCase().trim();
        
        // Match against targetWords by id or word text
        let matchingWord = targetWords.find((w: any) => 
          (w.id && q.wordId && w.id === q.wordId) || 
          (w.word || "").toLowerCase().trim() === qWordLower
        );

        // If not matched directly, find an untested word
        if (!matchingWord) {
          matchingWord = targetWords.find((w: any) => !seenWordKeys.has((w.word || "").toLowerCase().trim()));
        }

        if (!matchingWord) continue;

        const targetWordText = matchingWord.word || q.word || "";
        const targetWordLower = targetWordText.toLowerCase().trim();

        // If this target word was already tested in this quiz session:
        if (seenWordKeys.has(targetWordLower)) {
          // Check if there is an untested word in targetWords
          const unusedWord = targetWords.find((w: any) => !seenWordKeys.has((w.word || "").toLowerCase().trim()));
          if (!unusedWord) {
            // All words are already covered, strictly skip this duplicate question!
            continue;
          }
          // Untested word exists, create a tailored fallback question for the unused word
          seenWordKeys.add((unusedWord.word || "").toLowerCase().trim());
          const fallbackQ = createFallbackQuestion(unusedWord, deduplicatedQuestions.length, !deduplicatedQuestions.some(dq => dq.type === "picture"));
          deduplicatedQuestions.push(fallbackQ);
          continue;
        }

        seenWordKeys.add(targetWordLower);

        // The correct answer MUST be strictly the target vocabulary word itself being tested
        const correctAns = targetWordText;
        const correctAnsLower = correctAns.toLowerCase().trim();

        // 1. Sanitize options rejecting any cross-word reuse from the test batch
        let cleanOptions: string[] = [correctAns];
        const rawOptions = Array.isArray(q.options) ? q.options : [];

        // If duel, ensure rival confuser word is present in options
        if ((isDuelMode || q.type === "duel") && q.confuserWord) {
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
          if (allTargetWordKeys.has(optLower)) continue;
          cleanOptions.push(optStr);
        }

        // 2. Fill if under 4 options (for non-duel, or duel with under 2 options)
        const minOptionsNeeded = (isDuelMode || q.type === "duel") ? 2 : 4;
        if (cleanOptions.length < minOptionsNeeded) {
          const confusers = generateServerConfusers(targetWordText);
          for (const c of confusers) {
            if (cleanOptions.length >= minOptionsNeeded) break;
            const cLower = c.toLowerCase().trim();
            if (!cleanOptions.some(o => o.toLowerCase().trim() === cLower) && !allTargetWordKeys.has(cLower)) {
              cleanOptions.push(c);
            }
          }
        }

        const isQuestionDuel = isDuelMode || q.type === "duel";
        const qType = isQuestionDuel ? 'duel' : (q.type || 'definition');
        const fallbackSentence = (q.sentence && isQuestionSentenceValid(q.sentence))
          ? q.sentence
          : (matchingWord.example && isQuestionSentenceValid(matchingWord.example))
          ? matchingWord.example
          : undefined;

        let rawQuestionText = q.question;
        if (!rawQuestionText || !isQuestionSentenceValid(rawQuestionText)) {
          if (isQuestionDuel) {
            rawQuestionText = ensureServerQuestionHasBlank("", targetWordText, fallbackSentence, matchingWord.partOfSpeech || q.partOfSpeech);
          } else if (qType === 'sentence') {
            rawQuestionText = ensureServerQuestionHasBlank("", targetWordText, fallbackSentence, matchingWord.partOfSpeech || q.partOfSpeech);
          } else {
            rawQuestionText = `Which word matches: ${matchingWord.definition || targetWordText}`;
          }
        } else if (qType === 'duel' || qType === 'sentence' || /confuser duel|fill in the blank/i.test(rawQuestionText)) {
          rawQuestionText = ensureServerQuestionHasBlank(rawQuestionText, targetWordText, fallbackSentence, matchingWord.partOfSpeech || q.partOfSpeech);
        }

        let resolvedSentence = q.sentence || matchingWord.example;
        if (!resolvedSentence || !isQuestionSentenceValid(resolvedSentence)) {
          if (rawQuestionText.includes("______")) {
            const quoteMatch = rawQuestionText.match(/"([^"]+)"/);
            if (quoteMatch && quoteMatch[1]) {
              resolvedSentence = quoteMatch[1].replace("______", targetWordText);
            } else {
              resolvedSentence = rawQuestionText.replace("______", targetWordText);
            }
          } else {
            resolvedSentence = getDefaultContextSentence(targetWordText, matchingWord.partOfSpeech || q.partOfSpeech);
          }
        }

        const rawQuestionSuggestions = Array.isArray(q.suggestedWords)
          ? q.suggestedWords
          : Array.isArray(q.suggestedVocabulary)
          ? q.suggestedVocabulary
          : Array.isArray(q.collocations)
          ? q.collocations
          : [];

        let qSuggestions = normalizeSuggestionsForQuestion(rawQuestionSuggestions, targetWordText);

        // Fallback: check topLevelSuggestions if question didn't yield suggestions
        if (qSuggestions.length === 0 && topLevelSuggestions.length > 0) {
          qSuggestions = normalizeSuggestionsForQuestion(topLevelSuggestions, targetWordText);
        }

        // Fallback: check matchingWord.suggestedWords if question didn't yield suggestions
        if (qSuggestions.length === 0 && matchingWord && Array.isArray(matchingWord.suggestedWords) && matchingWord.suggestedWords.length > 0) {
          qSuggestions = normalizeSuggestionsForQuestion(matchingWord.suggestedWords, targetWordText);
        }

        // Fallback: for Duel questions, ensure rival confuser word is included in suggested words!
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
              partOfSpeech: matchingWord?.partOfSpeech || q.partOfSpeech,
              category: "contrast_pair",
              pairedWith: targetWordText
            });
          }
        }

        // Fallback: Extract phrasal verbs, idioms, and collocations from resolvedSentence (e.g. "laugh it off", "trip on", "liaise with")
        if (resolvedSentence && targetWordText) {
          const extracted = extractPhrasalVerbsAndCollocationsFromSentence(
            resolvedSentence,
            targetWordText,
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

        const wordIsNoun = isNoun(q.partOfSpeech || matchingWord.partOfSpeech);
        const resolvedType = (qType === "picture" && !wordIsNoun) ? (matchingWord.example ? "sentence" : "definition") : qType;

        deduplicatedQuestions.push({
          id: q.id || `ai-q-${matchingWord.id || idx}-${idx}`,
          wordId: matchingWord.id || `w-${idx}`,
          word: targetWordText,
          partOfSpeech: matchingWord.partOfSpeech || q.partOfSpeech,
          type: resolvedType,
          question: rawQuestionText,
          options: cleanOptions.sort(() => 0.5 - Math.random()),
          correctAnswer: correctAns,
          hint: q.hint || (isQuestionDuel ? `Contrast duel: '${targetWordText}' vs '${q.confuserWord || "rival"}'` : (matchingWord.pronunciation || "")),
          sentence: resolvedSentence,
          sentenceTranslation: q.sentenceTranslation || matchingWord.exampleTranslation || undefined,
          imageKeyword: (wordIsNoun && (resolvedType === "picture" || q.imageKeyword)) ? (q.imageKeyword || targetWordText) : undefined,
          suggestedWords: qSuggestions.length > 0 ? qSuggestions.slice(0, 3) : [],
          confuserWord: q.confuserWord || undefined,
          contrastRule: q.contrastRule || undefined
        });
      }

      // If we still have fewer questions than targetWords (e.g. LLM returned fewer questions), fill missing target words
      for (const w of targetWords) {
        const key = (w.word || "").toLowerCase().trim();
        if (!seenWordKeys.has(key) && deduplicatedQuestions.length < 3) {
          seenWordKeys.add(key);
          const canPreferPicture = isNoun(w.partOfSpeech) && !deduplicatedQuestions.some(dq => dq.type === "picture");
          const fallbackQ = createFallbackQuestion(w, deduplicatedQuestions.length, canPreferPicture);
          deduplicatedQuestions.push(fallbackQ);
        }
      }

      // Guarantee at least one picture question in result ONLY if there is at least one noun (and not in duel mode)
      if (!isDuelMode && hasAnyNoun) {
        const hasPicture = deduplicatedQuestions.some((q: any) => q.type === "picture");
        if (!hasPicture) {
          const nounQ = deduplicatedQuestions.find((q: any) => {
            const mw = targetWords.find((w: any) => (w.word || "").toLowerCase() === (q.word || "").toLowerCase()) ||
              words.find((w: any) => (w.word || "").toLowerCase() === (q.word || "").toLowerCase());
            return isNoun(q.partOfSpeech || mw?.partOfSpeech);
          });
          if (nounQ) {
            nounQ.type = "picture";
            nounQ.question = "Which word matches the visual concept shown below?";
            nounQ.imageKeyword = nounQ.word;
          }
        }
      }

      questionsArray = deduplicatedQuestions.slice(0, 3);

      await Promise.all(
        questionsArray.map(async (q: any) => {
          if (controller.signal.aborted) return;
          const matchingWord = targetWords.find((w: any) => (w.word || "").toLowerCase() === (q.word || "").toLowerCase()) ||
            words.find((w: any) => (w.word || "").toLowerCase() === (q.word || "").toLowerCase());
          const wordIsNoun = isNoun(q.partOfSpeech || matchingWord?.partOfSpeech);

          if (wordIsNoun && (q.type === "picture" || q.imageKeyword || q.imageUrl)) {
            const keywordText = q.imageKeyword || q.word;
            q.imageKeyword = keywordText;
            const imgUrl = await generateWorkerImage(keywordText);
            if (imgUrl) {
              q.imageUrl = imgUrl;
            } else {
              q.imageUrl = `https://image.nclong87.workers.dev?query=${encodeURIComponent(keywordText)}`;
            }
          } else {
            q.imageKeyword = undefined;
            q.imageUrl = undefined;
            q.imageUrls = undefined;
          }
        })
      );
    }

    if (controller.signal.aborted) return;

    res.json({
      questions: questionsArray.slice(0, 3),
      provider,
      model,
      responseTimeMs
    });
  } catch (error: any) {
    if (controller.signal.aborted || error?.name === "AbortError") {
      console.log("[/api/generate-quiz] Request aborted by client");
      return;
    }
    console.error("Error generating AI quiz:", error);
    const parsed = parseServerError(error, req.body?.llmConfig?.provider || "gemini");
    const code = parsed.statusCode >= 400 && parsed.statusCode < 600 ? parsed.statusCode : 500;
    res.status(code).json({ error: parsed.userMessage, statusCode: parsed.statusCode, errorType: parsed.errorType });
  }
});

// 9.5. Suggest Casual Reply
app.post("/api/suggest-casual-reply", async (req, res) => {
  const controller = new AbortController();

  try {
    const { imageDataUrl, systemPrompt, userText, provider, model } = req.body;

    if (imageDataUrl) {
      let base64Data = imageDataUrl;
      if (imageDataUrl.startsWith("data:")) {
        const parts = imageDataUrl.split(";base64,");
        base64Data = parts[1] || imageDataUrl;
      }

      const headers: Record<string, string> = {
        "Content-Type": "application/json"
      };
      headers["X-Proxy-Key"] = process.env.PROXY_SECRET || "";
      console.log("Sending request to image analysis worker with provider:", provider, "and model:", model);

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
        signal: controller.signal
      });

      if (workerRes.ok) {
        const rawText = await workerRes.text();
        let result;
        try {
          result = cleanAndParseJson(rawText);
        } catch {
          const cleaned = rawText.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
          result = cleanAndParseJson(cleaned);
        }
        if (result && (result.suggestedReplies || result.vocabularyCandidates)) {
          const parsedProvider = result.provider || provider || "gemini";
          const parsedModel = result.model || sanitizeModel(parsedProvider, model);
          return res.json({
            ...result,
            provider: parsedProvider,
            model: parsedModel,
            serverLockedModels: getServerLockedModelsArray()
          });
        }
      }
      throw new Error("Image analysis worker did not return valid JSON with suggestedReplies and vocabularyCandidates.");
    } else {
      // no image, just use the prompt directly with the LLM
      const configToUse = req.body.llmConfig || { provider, model };
      const text = await callLLM(userText, systemPrompt, "", configToUse, controller.signal);
      if (controller.signal.aborted) return;
      const cleaned = cleanJsonResponse(text);
      const parsed = cleanAndParseJson(cleaned);
      const parsedProvider = parsed?.provider || configToUse.provider || "gemini";
      const parsedModel = parsed?.model || sanitizeModel(parsedProvider, configToUse.model);
      return res.json({
        ...parsed,
        provider: parsedProvider,
        model: parsedModel,
        responseTimeMs: parsed?.responseTimeMs,
        serverLockedModels: getServerLockedModelsArray()
      });
    }
      
  } catch (error: any) {
    if (controller.signal.aborted || error?.name === "AbortError") {
      console.log("[/api/suggest-casual-reply] Request aborted by client");
      return;
    }
    console.error("Error suggesting casual reply:", error);
    const parsed = parseServerError(error, req.body?.llmConfig?.provider || "gemini");
    const code = parsed.statusCode >= 400 && parsed.statusCode < 600 ? parsed.statusCode : 500;
    res.status(code).json({ error: parsed.userMessage, statusCode: parsed.statusCode, errorType: parsed.errorType });
  }
});

// 10. Multimodal Image Vocabulary Analysis endpoint with Worker + Gemini Fallback
app.post("/api/analyze-image-vocab", async (req, res) => {
  const controller = new AbortController();
  try {
    const { imageDataUrl, systemPrompt, userText, provider, model } = req.body;

    if (!imageDataUrl) {
      return res.status(400).json({ error: "Image Data (imageDataUrl) is required" });
    }

    let base64Data = imageDataUrl;
    if (imageDataUrl.startsWith("data:")) {
      const parts = imageDataUrl.split(";base64,");
      base64Data = parts[1] || imageDataUrl;
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };
    headers["X-Proxy-Key"] = process.env.PROXY_SECRET || "";

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
      signal: controller.signal
    });

    if (workerRes.ok) {
      const rawText = await workerRes.text();
      let result;
      try {
        result = cleanAndParseJson(rawText);
      } catch {
        const cleaned = rawText.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
        result = cleanAndParseJson(cleaned);
      }
      if (result && (result.vocabularyItems || result.imageDescription)) {
        const parsedProvider = result.provider || provider || "gemini";
        const parsedModel = result.model || sanitizeModel(parsedProvider, model);
        return res.json({
          ...result,
          provider: parsedProvider,
          model: parsedModel,
          serverLockedModels: getServerLockedModelsArray()
        });
      }
    }
    throw new Error(`Image analysis worker failed with status ${workerRes.status}: ${await workerRes.text()}`);
    
  } catch (error: any) {
    if (controller.signal.aborted || error?.name === "AbortError") {
      console.log("[/api/analyze-image-vocab] Request aborted by client");
      return;
    }
    console.error("Error analyzing image vocabulary:", error);
    res.status(500).json({ error: error.message || "Failed to analyze image vocabulary" });
  }
});

// 9.6. Personalized Translation Challenge Generation
const DIVERSE_SCENARIOS = [
  { theme: "Stakeholder Negotiation & Deadlines", scenario: "Pushing back diplomatically on an unrealistic delivery date or negotiating scope boundaries with product stakeholders." },
  { theme: "Code Review & Quality Standards", scenario: "Delivering constructive feedback during a pull request review regarding code readability, maintainability, or testing." },
  { theme: "System Architecture & Storage", scenario: "Evaluating database indexing, read replicas, caching invalidation, or distributed consistency trade-offs." },
  { theme: "Incident Retrospective & Resilience", scenario: "Discussing root causes and preventative measures after unexpected production downtime without finger-pointing." },
  { theme: "Customer Support & Feedback", scenario: "Addressing constructive user feedback regarding checkout drop-offs, UX friction, or error messaging." },
  { theme: "Data Privacy & API Security", scenario: "Discussing credential rotation, OAuth token expiration, encryption at rest, or user privacy regulations." },
  { theme: "Cross-Functional Alignment", scenario: "Bridging communication gaps between UI/UX designers and back-end engineers during sprint planning." },
  { theme: "Async Collaboration & Remote Work", scenario: "Setting clear expectations for async handoffs and documentation across international time zones." },
  { theme: "Cloud Infrastructure & Cost Optimization", scenario: "Evaluating serverless scaling costs or pruning unused cloud resources to manage operational budgets." },
  { theme: "Team Mentorship & Knowledge Sharing", scenario: "Encouraging a junior teammate to ask clarifying questions and write concise architectural decision records." },
  { theme: "Product Discovery & User Interviews", scenario: "Formulating unbiased questions for user discovery interviews to validate a proposed solution." },
  { theme: "Everyday Workplace & Coffee Chat", scenario: "Chatting informally about ergonomic workstation setups, work-life balance, or weekend recharge routines." },
  { theme: "Vendor Agreements & SLAs", scenario: "Reviewing vendor service level agreements (SLAs) or negotiating support response times." },
  { theme: "Continuous Integration & Tooling", scenario: "Troubleshooting flaky automated integration tests that intermittently fail on the staging environment." },
  { theme: "Mobile Usability & Low Bandwidth", scenario: "Designing offline-first synchronization or handling poor cellular network connectivity gracefully." },
  { theme: "Executive Presentation & Value Pitch", scenario: "Pitching a tech debt refactoring proposal by framing its direct value to business reliability." }
];

const COMMUNICATIVE_MOODS = [
  "Polite professional disagreement or proposing a pragmatic alternative",
  "Explaining a nuanced technical concept in plain, accessible language",
  "Diplomatically asking clarifying questions before committing to an approach",
  "Empathizing with customer frustration while providing concrete reassurance",
  "Highlighting a potential operational risk along with actionable mitigation steps",
  "Celebrating a milestone achievement while outlining constructive next iterations",
  "Summarizing consensus and defining unambiguous ownership after a lively discussion"
];

app.post("/api/generate-challenge", async (req, res) => {
  const controller = new AbortController();
  try {
    const { nativeLanguage = "Vietnamese", targetLanguage = "English", personalityProfile, words = [], recentSentences = [], llmConfig } = req.body;

    const archetype = personalityProfile?.archetype || "Pragmatic Professional";
    const interests = (personalityProfile?.detectedInterests || ["Workplace", "Technology", "Daily Discussion"]).join(", ");
    const traits = (personalityProfile?.archetypeTraits || ["Practical", "Goal-oriented"]).join(", ");
    const modality = personalityProfile?.learningPreferences?.primaryModality || "contextual_examples";

    const randomSeed = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const scenarioObj = DIVERSE_SCENARIOS[Math.floor(Math.random() * DIVERSE_SCENARIOS.length)];
    const mood = COMMUNICATIVE_MOODS[Math.floor(Math.random() * COMMUNICATIVE_MOODS.length)];

    let vocabAnchorSection = "";
    let candidateCollectionWords: any[] = [];
    if (Array.isArray(words) && words.length > 0) {
      const validWords = words.filter((w: any) => w.completed !== false);
      const sortedCandidates = sortWordsByLastPracticeTime(validWords);
      candidateCollectionWords = sortedCandidates.slice(0, 8);
      if (candidateCollectionWords.length > 0) {
        vocabAnchorSection = `
USER'S WORDS COLLECTION CANDIDATES:
${candidateCollectionWords.map((w: any) => `- "${w.word}" (${w.translation || w.definition || "target term"}) [Strength: ${w.strength ?? 0}%]`).join("\n")}

WORDS COLLECTION TARGET IDENTIFICATION MANDATE:
- Carefully evaluate the candidate words from the user's collection above.
- Endeavor to identify the SINGLE MOST SUITABLE word from this collection that naturally fits within the assigned scenario ("${scenarioObj.theme}").
- Construct a concise sentence whose ideal translation naturally incorporates this identified word.
- Explicitly output this word in the "targetWordFromCollection" field so that when the user incorporates this word in their translation response, its strength is boosted by 30 points.`;
      }
    }

    let recentAvoidanceSection = "";
    if (Array.isArray(recentSentences) && recentSentences.length > 0) {
      const recentList = recentSentences.slice(0, 8).map((s: string) => `- "${s}"`).join("\n");
      recentAvoidanceSection = `
PREVIOUSLY GENERATED SENTENCES TO AVOID (DO NOT DUPLICATE OR RESEMBLE THESE):
${recentList}
`;
    }

    const prompt = `Generate a single personalized translation challenge for a language learner.

DIVERSITY SEED: ${randomSeed}

ASSIGNED SCENARIO FOR THIS CHALLENGE:
- Scenario Theme: ${scenarioObj.theme}
- Situation Context: ${scenarioObj.scenario}
- Communicative Mood: ${mood}

LEARNER CONTEXT:
- Native Language: ${nativeLanguage}
- Target Language: ${targetLanguage}
- Learner Archetype: ${archetype}
- Learner Traits: ${traits}
- Topics/Interests: ${interests}
- Primary Learning Modality: ${modality}
${vocabAnchorSection}
${recentAvoidanceSection}
CRITICAL MANDATES:
1. CONCISE SENTENCE STRUCTURE: Aim for a concise, compact, and punchy sentence structure (strictly 6 to 14 words). Avoid verbose rambling or convoluted multi-clause sentences. Keep the phrasing natural, modern, clear, and direct.
2. Follow the assigned Scenario Theme ("${scenarioObj.theme}") and Communicative Mood ("${mood}").
3. Create the concise sentence (6-14 words) in the user's NATIVE language (${nativeLanguage}) that they must translate into their TARGET language (${targetLanguage}).
4. Ensure the sentence sounds completely natural and idiomatic for real-life workplace or casual speech in ${nativeLanguage}.
5. Provide the ideal, concise, and polished natural translation in ${targetLanguage}.
6. Endeavor to identify and feature the most suitable word from the user's words collection within the sentence and output it in "targetWordFromCollection".
7. List 2-3 key target vocabulary words contained in the sentence with their native translation and hint.
8. Provide a short note (personalityNote) explaining why this specific scenario and vocabulary were selected.

Return STRICTLY raw JSON-only matching this schema:
{
  "nativeSentence": "Concise sentence in ${nativeLanguage} (6-14 words)",
  "idealTranslation": "Concise ideal translation in ${targetLanguage}",
  "topicContext": "${scenarioObj.theme}",
  "targetWordFromCollection": {
    "word": "most_suitable_word_from_collection",
    "translation": "translation_in_native",
    "hint": "context hint"
  },
  "keyTargetWords": [
    { "word": "word_in_target", "translation": "translation_in_native", "hint": "part of speech or context" }
  ],
  "personalityNote": "Explanation of profile alignment"
}`;

    const systemInstruction = `You are a personalized AI Language Coach creating concise, diverse, real-world translation challenges tailored to learner profiles. Always output strictly raw valid JSON without markdown formatting. Ensure sentences are concise (6-14 words) and endeavor to feature the most suitable word from the user's collection.`;
    const schemaDescription = `JSON object with nativeSentence, idealTranslation, topicContext, targetWordFromCollection object, keyTargetWords array, and personalityNote string.`;

    const rawResult = await callLLMAutoCandidates(prompt, systemInstruction, schemaDescription, llmConfig, undefined, controller.signal);
    const parsed = cleanAndParseJson(rawResult);

    if (parsed && parsed.nativeSentence && parsed.idealTranslation) {
      if (Array.isArray(words) && words.length > 0) {
        const rawTarget = parsed.targetWordFromCollection?.word ||
          (typeof parsed.targetWordFromCollection === "string" ? parsed.targetWordFromCollection : undefined) ||
          parsed.targetWord?.word;
        let matched = rawTarget ? findWordInCollection(words, rawTarget) : undefined;
        if (!matched && Array.isArray(parsed.keyTargetWords)) {
          for (const kw of parsed.keyTargetWords) {
            if (kw?.word) {
              const found = findWordInCollection(words, kw.word);
              if (found) { matched = found; break; }
            }
          }
        }
        if (!matched && candidateCollectionWords.length > 0 && parsed.idealTranslation) {
          for (const cand of candidateCollectionWords) {
            if (hasUserIncorporatedWord(parsed.idealTranslation, cand.word)) {
              matched = cand; break;
            }
          }
        }
        if (matched) {
          parsed.targetWordFromCollection = {
            id: matched.id,
            word: matched.word,
            translation: matched.translation || parsed.targetWordFromCollection?.translation,
            definition: matched.definition,
            hint: parsed.targetWordFromCollection?.hint || matched.translation,
            strength: matched.strength ?? 0,
          };
        }
      }
      return res.json(parsed);
    }
    throw new Error("Failed to parse valid challenge payload from LLM response");
  } catch (error: any) {
    if (controller.signal.aborted || error?.name === "AbortError") {
      console.log("[/api/generate-challenge] Request aborted");
      return;
    }
    console.error("Error generating translation challenge:", error);
    res.status(500).json({ error: error.message || "Failed to generate translation challenge" });
  }
});

// 9.7. Interactive Translation Challenge Turn Processing
app.post("/api/challenge-turn", async (req, res) => {
  const controller = new AbortController();
  try {
    const { challenge, userMessage, chatHistory = [], nativeLanguage = "Vietnamese", targetLanguage = "English", llmConfig } = req.body;

    if (!challenge || !userMessage) {
      return res.status(400).json({ error: "Missing challenge object or userMessage" });
    }

    const nativeSentence = challenge.nativeSentence;
    const idealTranslation = challenge.idealTranslation;
    const keyTargetWords = JSON.stringify(challenge.keyTargetWords || []);
    const targetWord = challenge.targetWordFromCollection?.word || "";

    const formattedHistory = chatHistory.map((m: any) => `${m.sender.toUpperCase()}: ${m.text}`).join("\n");

    const prompt = `Evaluate or assist a language learner during a Translation Challenge.

CHALLENGE DETAILS:
- Native Sentence (${nativeLanguage}): "${nativeSentence}"
- Ideal Target Translation (${targetLanguage}): "${idealTranslation}"
- Key Target Words: ${keyTargetWords}
- Featured Target Word from Collection: "${targetWord}"
- Target Language: ${targetLanguage}
- Native Language: ${nativeLanguage}

CONVERSATION HISTORY SO FAR:
${formattedHistory || "(No prior messages in this challenge session)"}

LATEST USER MESSAGE:
"${userMessage}"

TASK & INTENT CLASSIFICATION:
Determine if the user is:
A) ASKING FOR ASSISTANCE ("assistance"): User asks for a hint, asks how to translate a word ("what is X", "how do I say Y", "gợi ý giúp"), asks a grammar question, or requests clarification.
B) SUBMITTING FINAL ANSWER ("submission"): User is providing their attempt to translate the complete native sentence into ${targetLanguage}.

IF INTENT IS "assistance":
- Provide a helpful, friendly hint or answer to their query in ${nativeLanguage} (or simple ${targetLanguage}).
- Do NOT reveal the full ideal sentence translation!
- If they asked about a specific word or phrase, populate the "askedWord" field with word, translation, definition, and partOfSpeech.

IF INTENT IS "submission":
- Evaluate their translation against the native sentence and ideal target translation.
- Calculate an overall accuracy score from 0 to 100.
- Provide a scoreLabel (e.g. "Mastery! 🌟" for 90-100, "Great Job! 👏" for 75-89, "Good Attempt! 👍" for 60-74, "Keep Practicing! 💪" for <60).
- Provide "userTranslation": the learner's submitted translation attempt.
- SPECIFIC TARGET WORD INCORPORATION CHECK: Check whether the user's submission incorporates the specific featured target word "${targetWord}" (or its natural grammatical variants such as past tense, plural, or inflected forms). Set "incorporatedTargetWord": true if used, false otherwise. Set "targetWordUsed": "${targetWord}".
- List "whatWentWell": specific praise for correct grammar, vocabulary, or phrasing (mentioning the target word if used).
- List "areasForImprovement": constructive tips for grammar, prepositions, natural phrasing, or alternative choices.
- Provide "correctedSentence": the optimal target translation.
- Provide "suggestedVocabulary": an array of 3-5 vocabulary items containing:
  1) Any words the user explicitly asked about during the conversation history (mark askedByUser: true).
  2) Key vocabulary terms from the challenge sentence (mark askedByUser: false).

Return STRICTLY raw JSON matching:
{
  "intent": "assistance" | "submission",
  "agentReply": "Helpful reply if intent is assistance",
  "askedWord": { "word": "target_word", "translation": "native_translation", "definition": "definition", "partOfSpeech": "noun/verb", "hint": "context hint" },
  "evaluation": {
    "score": 85,
    "scoreLabel": "Great Job! 👏",
    "userTranslation": "learner's submitted translation text",
    "incorporatedTargetWord": true,
    "targetWordUsed": "${targetWord}",
    "whatWentWell": "Praise paragraph...",
    "areasForImprovement": "Improvement paragraph...",
    "correctedSentence": "Optimal target translation",
    "suggestedVocabulary": [
      {
        "word": "word",
        "translation": "translation",
        "definition": "definition",
        "partOfSpeech": "part_of_speech",
        "hint": "context hint",
        "example": "example sentence",
        "exampleTranslation": "example translation",
        "askedByUser": boolean
      }
    ]
  }
}`;

    const systemInstruction = `You are an AI Language Evaluation Coach. Classify intent as assistance or submission and return strict JSON output. Check whether the learner incorporated the designated target word.`;
    const schemaDescription = `JSON object with intent ("assistance" | "submission"), agentReply, askedWord, and evaluation object (including userTranslation, incorporatedTargetWord) if submission.`;

    const rawResult = await callLLMAutoCandidates(prompt, systemInstruction, schemaDescription, llmConfig, undefined, controller.signal);
    const parsed = cleanAndParseJson(rawResult);

    if (parsed && (parsed.intent === "assistance" || parsed.intent === "submission")) {
      if (parsed.evaluation) {
        parsed.evaluation.userTranslation = parsed.evaluation.userTranslation?.trim() || userMessage.trim();
        if (targetWord) {
          const incorporated = parsed.evaluation.incorporatedTargetWord === true ||
            hasUserIncorporatedWord(parsed.evaluation.userTranslation, targetWord) ||
            hasUserIncorporatedWord(userMessage, targetWord);
          parsed.evaluation.incorporatedTargetWord = incorporated;
          parsed.evaluation.targetWordUsed = targetWord;
        }
      }
      return res.json(parsed);
    }
    throw new Error("Failed to parse valid challenge turn response from LLM");
  } catch (error: any) {
    if (controller.signal.aborted || error?.name === "AbortError") {
      console.log("[/api/challenge-turn] Request aborted");
      return;
    }
    console.error("Error processing challenge turn:", error);
    res.status(500).json({ error: error.message || "Failed to process challenge turn" });
  }
});

// Fallback for unmatched API routes - ALWAYS return JSON 404, never HTML
app.all("/api/*", (_req, res) => {
  res.status(404).json({
    error: "API endpoint not found",
    statusCode: 404,
    errorType: "NOT_FOUND"
  });
});

// Global Express error handler for API requests - ensure JSON response instead of default HTML error page
app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("Unhandled Express error on route", req.path, err);
  if (res.headersSent) return;
  res.status(err.status || err.statusCode || 500).json({
    error: err?.message || "Internal server error occurred on server.",
    statusCode: err.status || err.statusCode || 500,
    errorType: "SERVER_ERROR"
  });
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
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

