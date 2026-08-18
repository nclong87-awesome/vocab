import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import { cleanJsonResponse, cleanAndParseJson, extractWordsFromPayload } from "./src/utils/jsonSanitizer";
import { extractOrGenerateTopicActions } from "./src/utils/actionExtractor";
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
  return model || PROVIDER_OPTIONS.find(p => p.id === provider)?.defaultModel || "auto";
}


// Parse server-side LLM error
function parseServerError(err: any, provider: string = "gemini"): {
  statusCode: number;
  errorType: string;
  userMessage: string;
  isRetryable: boolean;
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

const serverLockedModels = new Map<string, number>();

function lockServerModel(provider: string, model: string, durationMs: number = 3600000): void {
  if (provider === "auto" || model === "auto") return;
  const key = `${provider}:${model}`;
  serverLockedModels.set(key, Date.now() + durationMs);
  console.warn(`[Server Auto Mode] Locked model ${key} for ${Math.round(durationMs / 60000)} minutes`);
}

function isServerModelLocked(provider: string, model: string): boolean {
  const key = `${provider}:${model}`;
  const expiresAt = serverLockedModels.get(key);
  if (!expiresAt) return false;
  if (expiresAt > Date.now()) return true;
  serverLockedModels.delete(key);
  return false;
}

const SERVER_AUTO_CANDIDATES = [
  ...(process.env.GEMINI_API_KEY ? [
    { provider: "gemini", model: "gemini-3.6-flash" },
    { provider: "gemini", model: "gemini-3.5-flash" },
    { provider: "gemini", model: "gemini-3.5-flash-lite" }
  ] : []),
  ...PROVIDER_OPTIONS.filter(p => p.id !== "auto" && p.id !== "custom" && (!process.env.GEMINI_API_KEY || p.id !== "gemini")).map(p => ({
    provider: p.id,
    model: p.defaultModel
  }))
];

let serverAutoRotationIndex = 0;

function getNextServerAutoCandidate(excludedKeys?: Set<string>): { provider: string; model: string } {
  for (let i = 0; i < SERVER_AUTO_CANDIDATES.length; i++) {
    const idx = (serverAutoRotationIndex + i) % SERVER_AUTO_CANDIDATES.length;
    const cand = SERVER_AUTO_CANDIDATES[idx];
    const key = `${cand.provider}:${cand.model}`;

    if (!isServerModelLocked(cand.provider, cand.model) && (!excludedKeys || !excludedKeys.has(key))) {
      serverAutoRotationIndex = (idx + 1) % SERVER_AUTO_CANDIDATES.length;
      return cand;
    }
  }

  serverLockedModels.clear();
  serverAutoRotationIndex = (serverAutoRotationIndex + 1) % SERVER_AUTO_CANDIDATES.length;
  return SERVER_AUTO_CANDIDATES[0];
}

// Call LLM for a single provider/model candidate
async function callLLMSingle(
  prompt: string, 
  systemInstruction: string, 
  schemaDescription: string,
  llmConfig?: LLMRequestConfig
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
    const isCustomOrProxyUrl = Boolean(effectiveGeminiUrl && !effectiveGeminiUrl.includes("googleapis.com"));

    if (!isCustomOrProxyUrl && effectiveGeminiKey) {
      const ai = new GoogleGenAI({
        apiKey: effectiveGeminiKey,
        httpOptions: { 
          headers: { 
            'User-Agent': 'aistudio-build',
          } 
        }
      });

      const primaryModel = model || "gemini-3.6-flash";
      try {
        const response = await ai.models.generateContent({
          model: primaryModel,
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
        throw err;
      }
    } else {
      // Worker proxy handling for Gemini (uses native generateContent endpoint rather than /chat/completions)
      const primaryModel = model || "gemini-3.6-flash";
      const cleanBaseUrl = effectiveGeminiUrl.replace(/\/$/, "");
      const targetEndpoint = `${cleanBaseUrl}/models/${primaryModel}:generateContent`;

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
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => res.statusText);
        throw new Error(`Gemini Worker Proxy Error (${res.status}): ${errText}`);
      }

      const data: any = await res.json();
      const parts = data.candidates?.[0]?.content?.parts || [];
      const text = parts.map((p: any) => p.text || "").join("").trim() || data.text || data.candidates?.[0]?.output || "";
      if (!text) {
        throw new Error("Empty text response from Gemini worker proxy.");
      }
      const cleanedText = cleanJsonResponse(text);
      const result = cleanAndParseJson(cleanedText);
      result.model = sanitizeModel(provider, llmConfig?.model);
      result.provider = provider;
      result.responseTimeMs = Date.now() - startTime;
      return JSON.stringify(result);
    }
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
    stream: false
  };

  // OpenRouter models often return 400 "JSON mode is not supported for this model". Only pass response_format for other supported providers.
  if (provider === "openai" || provider === "groq" || provider === "9flare" || provider === "gemini") {
    reqBody.response_format = { type: "json_object" };
  }
  console.log(`[Server] Calling ${provider.toUpperCase()} model ${reqBody.model} at ${targetUrl} with system instruction and schema description.`);
  const startTime = Date.now();

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
  initialExcludedKeys?: Set<string>
): Promise<string> {
  const excludedKeys = new Set<string>(initialExcludedKeys || []);
  let lastError: any = null;

  for (let attempt = 0; attempt < SERVER_AUTO_CANDIDATES.length; attempt++) {
    const cand = getNextServerAutoCandidate(excludedKeys);
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
      console.log(`[Server Auto Mode] Attempt ${attempt + 1}/${SERVER_AUTO_CANDIDATES.length}: Routing request to ${candKey}`);
      const resultText = await callLLMSingle(prompt, systemInstruction, schemaDescription, candConfig);
      if (schemaDescription) {
        try {
          cleanAndParseJson(resultText);
        } catch (jsonErr: any) {
          throw new Error(`Invalid JSON response from ${candKey}: ${jsonErr.message}`);
        }
      }
      return resultText;
    } catch (err: any) {
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
  llmConfig?: LLMRequestConfig
): Promise<string> {
  const provider = llmConfig?.provider || "auto";

  if (provider === "auto" || llmConfig?.model === "auto") {
    return callLLMAutoCandidates(prompt, systemInstruction, schemaDescription, llmConfig);
  }

  // When a specific provider is configured, call it directly and throw on error without fallbacks
  return callLLMSingle(prompt, systemInstruction, schemaDescription, llmConfig);
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
    if (msg.reasoning_content && !msg.content) {
      return extractTextFromContent(msg.reasoning_content);
    }
  }
  if (choice.delta) {
    const delta = choice.delta;
    const txt = extractTextFromContent(delta.content) || extractTextFromContent(delta.text);
    if (txt) return txt;
    if (delta.reasoning_content && delta.content === undefined) {
      return extractTextFromContent(delta.reasoning_content);
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
      const content = extractTextFromChoice(data.choices?.[0]) ||
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

  // 3. Fallback to cleanJsonResponse on rawText
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

  if (method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, PATCH, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Proxy-Key");
    return res.status(204).end();
  }

  if (method !== "GET" && method !== "PATCH") {
    return res.status(405).json({ error: "Method Not Allowed. Only GET, PATCH, and OPTIONS are allowed." });
  }

  try {
    const subPath = req.path.replace(/^\/api\/gist/, ""); // e.g. "" or "/<gistId>"
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

    if (method === "PATCH" && req.body && Object.keys(req.body).length > 0) {
      fetchOptions.body = JSON.stringify(req.body);
    }

    const response = await fetchWithTimeout(targetUrl, fetchOptions);
    const dataText = await response.text();

    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");

    let dataJson;
    try {
      dataJson = JSON.parse(dataText);
    } catch {
      dataJson = { message: dataText || response.statusText };
    }

    res.status(response.status).json(dataJson);
  } catch (error: any) {
    console.error("Gist proxy error:", error);
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
0. CRITICAL WORD EXTRACTION & HEADWORD ISOLATION DIRECTIVE:
   - Always attempt to extract individual target vocabulary words or key lexical terms from user input whenever possible, rather than using the entire sentence or request phrase as a single word!
   - If "${word}" is a full user sentence, clause, natural language query, or conversational request (e.g., "The weather is very whimsical today", "I want to add the word serendipity", "She had an innate talent for music", "Thêm từ enthusiastic vào từ điển", "How do you say resilience in Spanish?", "Can we learn about biodiversity?"):
     * NEVER set the "word" field to the entire input sentence or question!
     * Isolate and extract the core headword / target vocabulary item being learned or referenced (e.g. "whimsical", "serendipity", "innate", "enthusiastic", "resilience", "biodiversity").
     * If the input sentence was in the native language (${userNative}) or describes a concept, extract or translate that core headword into ${userTarget} for "word" and provide the ${userNative} translation.
     * Established multi-word phrasal verbs or fixed idioms (e.g., "break down", "piece of cake", "give up") may be extracted as a unit, but NEVER treat full descriptive sentences, greetings, or conversational questions as a single word!
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
- "suggestedWords": Array of exactly 1 or 2 practical vocabulary words in "${userTarget}" that people frequently pair or use together with this word in natural contexts. Do NOT include or repeat the current word itself in the suggested words; output just the companion/paired words (e.g. for "apple" -> ["crisp", "orchard"] or ["cider", "pie"]; for "whimsical" -> ["charm", "notion"]; for "acquire" -> ["knowledge", "skill"]; for "mitigate" -> ["risk", "impact"]).`;

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
      "definition": "string (short definition in ${userTarget})",
      "translation": "string (translation in ${userNative})"
    }
  ]
}`;

    const text = await callLLM(prompt, systemInstruction, schemaDesc, llmConfig);
    const result = cleanAndParseJson(text);
    res.json(result);
  } catch (error: any) {
    console.error("Error autofilling word:", error);
    const parsed = parseServerError(error, req.body?.llmConfig?.provider || "gemini");
    const code = parsed.statusCode >= 400 && parsed.statusCode < 600 ? parsed.statusCode : 500;
    res.status(code).json({ error: parsed.userMessage, statusCode: parsed.statusCode, errorType: parsed.errorType });
  }
});

// 4.1. Check multiple definitions or deduce vocabulary word from natural language request
app.post("/api/check-word-definitions", async (req, res) => {
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
0. CRITICAL WORD EXTRACTION & HEADWORD ISOLATION DIRECTIVE:
   - Always attempt to extract individual target vocabulary words or key lexical terms from user input whenever possible, rather than using the entire sentence or request phrase as a single word!
   - If "${word}" is a full user sentence, clause, natural language query, or conversational request (e.g., "The weather is very whimsical today", "I want to add the word serendipity", "She had an innate talent for music", "Thêm từ enthusiastic vào từ điển", "How do you say resilience in Spanish?", "Can we learn about biodiversity?"):
     * NEVER set the "word" field to the entire input sentence or question!
     * Isolate and extract the core headword / target vocabulary item being learned or referenced (e.g. "whimsical", "serendipity", "innate", "enthusiastic", "resilience", "biodiversity").
     * If multiple distinct candidate vocabulary terms exist in the sentence, or if the user's focus is ambiguous, set "hasMultipleSenses": true and provide candidate senses for each extracted individual word from the sentence so the user can choose which specific word to add.
     * Established multi-word phrasal verbs or fixed idioms (e.g., "break down", "piece of cake", "give up") may be extracted as a unit, but NEVER treat full descriptive sentences, greetings, or conversational questions as a single word!
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

4. MULTIPLE SENSES / CANDIDATES DISAMBIGUATION:
   - If there are 2 to 4 distinct matching terms or meanings (e.g. "Ternary operator" vs "Guard clause"), set "hasMultipleSenses": true and include each candidate in "senses".
   - If only 1 dominant matching term exists, set "hasMultipleSenses": false and return 1 matching sense in "senses".
   - Set "notFound": false unless the input is complete gibberish with zero semantic meaning.
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
     "context": string,
     "suggestedWords": Array of exactly 1 or 2 practical vocabulary words in "${userTarget}" that people frequently pair or use together with this word in natural contexts. Do NOT include or repeat the current word itself in the suggested words; output just the companion/paired words (e.g. for "apple" -> ["crisp", "orchard"] or ["cider", "pie"]; for "whimsical" -> ["charm", "notion"]; for "acquire" -> ["knowledge", "skill"]; for "mitigate" -> ["risk", "impact"]).`;

    const systemInstruction = `You are an elite multilingual vocabulary extraction & dictionary engine. You automatically detect input language, deduce target vocabulary terms from natural language descriptions or requests, and output structured JSON with target language words, definitions, and native language translations. Output strictly valid JSON-only output when requested. Do not include any conversational filler outside the JSON.`;
    const schemaDesc = `{
  "word": "string (the primary target word/expression STRICTLY in target language ${userTarget}, e.g. 'hello')",
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
      "word": "string (the target word/expression STRICTLY in target language ${userTarget}, e.g. 'hello')",
      "partOfSpeech": "string (e.g. noun, verb, adjective, expression)",
      "definition": "string (definition written STRICTLY in ${userTarget})",
      "translation": "string (translation in ${userNative})",
      "pronunciation": "string (IPA pronunciation)",
      "example": "string (sentence in ${userTarget})",
      "exampleTranslation": "string (sentence translation in ${userNative})",
      "imageKeyword": "string (3-5 word comma-free search term capturing the visual concept of the word with relevance context and category for image search)",
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

    const text = await callLLM(prompt, systemInstruction, schemaDesc, llmConfig);
    let result = cleanAndParseJson(text);
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
    res.json(result);
  } catch (error: any) {
    console.error("Error checking word definitions:", error);
    const parsed = parseServerError(error, req.body?.llmConfig?.provider || "gemini");
    const code = parsed.statusCode >= 400 && parsed.statusCode < 600 ? parsed.statusCode : 500;
    res.status(code).json({ error: parsed.userMessage, statusCode: parsed.statusCode, errorType: parsed.errorType });
  }
});

// 4.5. Generate random words for collection
app.post("/api/generate-random-words", async (req, res) => {
  try {
    const { topic, targetLanguage, nativeLanguage, count = 5, llmConfig } = req.body;

    const userNative = nativeLanguage || "English";
    const userTarget = targetLanguage || "Spanish";

    const prompt = `Generate ${count} practical vocabulary words or expressions in target language "${userTarget}" relevant to or expanding on the topic "${topic || "Vocabulary"}".
The user's native language is "${userNative}".

CRITICAL INSTRUCTIONS:
- Every word generated SHOULD BE unique and practical for a language learner.
- "word": The target vocabulary word or expression STRICTLY in the target language (${userTarget}), e.g. "hello".
- "pronunciation": International Phonetic Alphabet (IPA) pronunciation guide for the target language word, e.g. "/həˈloʊ/". Must NOT be empty.
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

    const text = await callLLM(prompt, systemInstruction, schemaDesc, llmConfig);
    const result = cleanAndParseJson(text);
    const words = extractWordsFromPayload(result);
    res.json({
      words,
      ...(typeof result === "object" && !Array.isArray(result) ? result : {})
    });
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
  PRIORITY RULE: If the user's input contains misspelled words, prioritize those first as vocabulary candidates.
  - For misspelled candidates, set "word" to the corrected form in "${userTarget}" and mention the original misspelling in "reason".
  - If there are multiple misspellings, rank them before other candidate words.
   For each candidate, provide:
   - "word": string (the target language word or expression)
   - "definition": string (clear, concise definition written strictly in ${userTarget})
   - "translation": string (direct translation into user's native language ${userNative})
   - "reason": string (a short, clear 1-line reason why this word/expression is a great candidate to add to their vocabulary collection)
`;

    const systemInstruction = `You are a friendly, natural AI Language Coach. Fix grammar & spelling with a casual tone and suggest candidate vocabulary words for the user's collection. Output strictly valid JSON-only output matching the schema when requested. Do not include any conversational filler outside the JSON.`;
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
}`;

    const text = await callLLM(prompt, systemInstruction, schemaDesc, llmConfig);
    const result = cleanAndParseJson(text);
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

function normalizePerformanceAnalysis(raw: any): any {
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

  // Parse Top Practice Words (Top 10 words to practice: recently used and never used)
  let topPracticeWords: any[] = [];
  const rawPractice = raw.topPracticeWords || raw.top_practice_words || raw.topWordsToPractice || raw.practiceWords || raw.practice_words || raw.recommendedPracticeWords || raw.top_10_words || raw.wordsToPractice;
  if (Array.isArray(rawPractice)) {
    topPracticeWords = rawPractice.slice(0, 10).map((item: any) => {
      if (typeof item === "string") {
        return {
          word: item,
          translation: "",
          reason: "Recommended for practice",
          type: "recently_used",
          strength: 20,
          priority: "high",
          pos: "word",
          mnemonic: `Mental Hook: Lock "${item}" into memory with active imagery.`,
          exampleSentence: `Practice using "${item}" in everyday conversation.`,
          riskLevel: "high"
        };
      }
      const rawType = String(item.type || item.category || item.status || "").toLowerCase();
      const isNeverUsed = rawType.includes("never") || rawType.includes("new") || rawType.includes("untouched") || item.strength === 0 || item.lastReviewed === null;
      const type = isNeverUsed ? "never_used" : "recently_used";
      const wordStr = String(item.word || item.name || item.term || "").trim();
      const transStr = String(item.translation || item.meaning || item.definition || "").trim();

      return {
        word: wordStr,
        translation: transStr,
        reason: String(item.reason || item.note || item.explanation || (isNeverUsed ? "Never practiced yet - start initial recall" : "Needs reinforcement and practice")).trim(),
        type,
        strength: typeof item.strength === "number" ? Math.max(0, Math.min(100, item.strength)) : (isNeverUsed ? 0 : 30),
        priority: item.priority === "medium" ? "medium" : "high",
        pos: item.pos || item.partOfSpeech || "word",
        mnemonic: item.mnemonic || `Mental Anchor: Associate "${wordStr}" with "${transStr}" in an active memory picture.`,
        etymology: item.etymology || item.anatomy || `[${(item.pos || "word").toUpperCase()}] — Essential vocabulary term.`,
        exampleSentence: item.exampleSentence || item.example || `The term "${wordStr}" is used to express ${transStr || "this concept"}.`,
        exampleTranslation: item.exampleTranslation,
        commonTrap: item.commonTrap || item.trap || `Learner caution: Pay attention to correct context when using "${wordStr}".`,
        riskLevel: item.riskLevel || ((item.strength ?? 0) <= 25 ? 'critical' : (item.strength ?? 0) <= 50 ? 'high' : 'moderate')
      };
    }).filter((item: any) => Boolean(item.word));
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

  // Parse advanced context story and CEFR diagnostic metrics
  let contextStory = undefined;
  if (raw.contextStory && typeof raw.contextStory === "object" && raw.contextStory.story) {
    contextStory = {
      title: String(raw.contextStory.title || "AI Context Immersion Micro-Story"),
      story: String(raw.contextStory.story),
      storyTranslation: raw.contextStory.storyTranslation ? String(raw.contextStory.storyTranslation) : undefined,
      featuredWords: Array.isArray(raw.contextStory.featuredWords) ? raw.contextStory.featuredWords : []
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
    contextStory,
    cefrLevel: raw.cefrLevel || raw.cefr_level || "B1 Intermediate",
    retentionHealthScore: typeof raw.retentionHealthScore === "number" ? raw.retentionHealthScore : (typeof raw.retention_health_score === "number" ? raw.retention_health_score : undefined)
  };
}

// 6. Analyze Performance with AI endpoint
app.post("/api/analyze-performance", async (req, res) => {
  try {
    const { 
      stats, 
      totalWords, 
      masteredWords = [], 
      improvingWords = [], 
      recentlyUsedWords = [], 
      neverUsedWords = [], 
      targetLanguage = "English", 
      nativeLanguage = "Vietnamese", 
      llmConfig 
    } = req.body;

    const masteredSampleStr = (masteredWords || []).slice(0, 15).map((w: any) => `${w.word} (${w.translation || w.definition})`).join(", ") || "None yet";
    const improvingSampleStr = (improvingWords || []).slice(0, 15).map((w: any) => `${w.word} (level ${w.strength ?? 0}, ${w.translation || w.definition})`).join(", ") || "None yet";
    const recentlyUsedStr = (recentlyUsedWords || []).slice(0, 15).map((w: any) => `${w.word} (strength ${w.strength ?? 0}/100, last reviewed: ${w.lastReviewed || 'recently'}, ${w.translation || w.definition})`).join(", ") || "None recorded";
    const neverUsedStr = (neverUsedWords || []).slice(0, 15).map((w: any) => `${w.word} (strength 0/100, never reviewed yet, ${w.translation || w.definition})`).join(", ") || "None (all words have been practiced)";

    const masteredCount = (masteredWords || []).length;
    const studiedCount = (masteredWords || []).length + (improvingWords || []).filter((w: any) => w.lastReviewed !== null || (w.strength ?? 0) > 0).length;

    const prompt = `You are an elite AI Language Learning Coach & Vocabulary Pedagogical Analyst. Analyze the following student performance data and provide a personalized, deeply insightful analytics report with memory hooks, mnemonics, and a curated list of the TOP 10 WORDS THE LEARNER NEEDS TO PRACTICE.

STUDENT PERFORMANCE DATA:
- Target Language: ${targetLanguage}
- Native Explanation Language: ${nativeLanguage}
- Total Vocabulary Words in Collection: ${totalWords || 0}
- Total Words Mastered: ${masteredCount}
- Total Words Studied/Reviewed: ${studiedCount}
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
- "cefrLevel": Estimated CEFR milestone (e.g. "A2 Elementary", "B1 Intermediate", "B2 Upper Intermediate").`;

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

    const text = await callLLM(prompt, systemInstruction, schemaDesc, llmConfig);
    const rawParsed = cleanAndParseJson(text);
    const result: any = normalizePerformanceAnalysis(rawParsed);
    if (rawParsed.provider) result.provider = rawParsed.provider;
    if (rawParsed.model) result.model = rawParsed.model;
    if (rawParsed.responseTimeMs !== undefined) result.responseTimeMs = rawParsed.responseTimeMs;
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

    const text = await callLLM(prompt, systemInstruction, schemaDesc, llmConfig);
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
      suggestedActions: finalActions
    });
  } catch (error: any) {
    console.error("Error in AI chat:", error);
    const parsed = parseServerError(error, req.body?.llmConfig?.provider || "gemini");
    const code = parsed.statusCode >= 400 && parsed.statusCode < 600 ? parsed.statusCode : 500;
    res.status(code).json({ error: parsed.userMessage, statusCode: parsed.statusCode, errorType: parsed.errorType });
  }
});

// Flashcard Generation endpoint (supports batch of 5 words or single word)
app.post(["/api/generate-flashcards", "/api/generate-flashcard"], async (req, res) => {
  try {
    const { words, word, targetLanguage = "English", nativeLanguage = "Vietnamese", llmConfig } = req.body;

    const wordsList = Array.isArray(words) ? words : word ? [word] : [];
    if (wordsList.length === 0) {
      return res.status(400).json({ error: "Word or words array is required" });
    }

    const systemInstruction = `You are a world-class AI Language Pedagogy Engine creating interactive flashcards for ${targetLanguage} learners (native language: ${nativeLanguage}).
Given target vocabulary words, generate a clean, focused, high-retention flashcard for EACH word.

FOR EACH WORD:
1. "word": The target vocabulary word in ${targetLanguage}.
2. "pronunciation": Accurate IPA pronunciation guide (e.g. /ɪˈfɛmərəl/).
3. "partOfSpeech": Part of speech (noun, verb, adjective, adverb, idiom, etc.).
4. "translation": Natural, accurate translation in ${nativeLanguage}.
5. "definition": Concise, clear definition in ${targetLanguage}.
6. "example": EXACTLY 1 natural, realistic example sentence demonstrating practical usage in context.
7. "exampleTranslation": Translation of the example sentence in ${nativeLanguage}.
8. "category": Thematic domain/tag (e.g. "Everyday", "Business", "Travel", "Academic", "Emotions").
9. "suggestedWords": Optional top 1 or 2 most natural collocations or paired expressions (keep it strictly concise, maximum 1-2 items per card).
   For each pairing, provide:
   - "word": The collocated expression in ${targetLanguage} (e.g., "heavy rain", "deep breath").
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
    "exampleTranslation": "string in ${nativeLanguage}",
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
      `- For each flashcard, include 1 natural example sentence with translation.\n` +
      `- For each flashcard, include at most 1 or 2 top commonly paired words/collocations ("suggestedWords") with their native translation (keep concise).`;

    const schemaDesc = `Array of Flashcard objects with word, pronunciation, partOfSpeech, translation, definition, example, exampleTranslation, category, suggestedWords (concise array of at most 1-2 items with word, translation, hint).`;

    const text = await callLLM(prompt, systemInstruction, schemaDesc, llmConfig);
    const cleaned = cleanJsonResponse(text);
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

    // Normalize each card and attach corresponding wordId
    const normalizedCards = cardsArray.map((card: any, idx: number) => {
      const originalWord = wordsList[idx] || wordsList.find((w: any) => w.word?.toLowerCase().trim() === card.word?.toLowerCase().trim()) || {};
      
      // Normalize suggestedWords (keep 1-3 top paired words)
      let suggestedWords: any[] = [];
      const rawSuggestions = card.suggestedWords || card.suggestedVocabulary || card.collocations || [];
      if (Array.isArray(rawSuggestions)) {
        suggestedWords = rawSuggestions.slice(0, 3).map((item: any) => {
          if (typeof item === "string") {
            return { word: item, translation: "", hint: "Common pairing" };
          }
          return {
            word: String(item.word || item.collocation || item.phrase || "").trim(),
            translation: String(item.translation || item.meaning || "").trim(),
            hint: String(item.hint || item.collocationType || item.type || item.partOfSpeech || "").trim()
          };
        }).filter((item: any) => Boolean(item.word));
      }

      return {
        wordId: originalWord.id,
        word: card.word || originalWord.word || "",
        pronunciation: card.pronunciation || originalWord.pronunciation || "",
        partOfSpeech: card.partOfSpeech || originalWord.partOfSpeech || "noun",
        translation: card.translation || originalWord.translation || "",
        definition: card.definition || originalWord.definition || "",
        example: card.example || card.extraExampleSentences?.[0]?.sentence || originalWord.example || "",
        exampleTranslation: card.exampleTranslation || card.extraExampleSentences?.[0]?.translation || originalWord.exampleTranslation || "",
        category: card.category || originalWord.category || "General",
        context: card.context || originalWord.context || originalWord.definition || "",
        suggestedWords: suggestedWords.slice(0, 3),
        suggestedVocabulary: suggestedWords.slice(0, 3)
      };
    });

    res.json({
      cards: normalizedCards,
      // If single card was requested, also expose top-level properties for backward compatibility
      ...(normalizedCards[0] || {})
    });
  } catch (error: any) {
    console.error("Error generating flashcard content:", error);
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

    const totalMasteredFromWords = (words || []).filter((w: any) => w.learned || (w.strength ?? 0) >= 3).length;
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
   - Ensure distractors are tricky enough to challenge and confuse the user, but not so obscure that they are irrelevant or nonsensical.
   - Never put the same option twice.
3. Adaptive Difficulty & Spaced Repetition Personalization:
   - Use each word's mastery stats (strength 0-4, daysSinceLastReview, memoryStatus, starred, learned) and overall stats (streak, accuracy, mastered count) to customize question difficulty:
     * Memory Decay / Overdue Words (daysSinceLastReview >= 5, or recalculated strength): The student may have forgotten this word since it hasn't been reviewed in a while. Generate targeted context fill-in-the-blank or usage questions with challenging distractors to test active memory recall.
     * Weak / New Words (strength 0-1, never reviewed): Generate foundational questions (e.g. direct definition matching or simple supportive sentences) with helpful hints to reinforce basic recall.
     * Starred / Priority Words: Focus on practical usage and clear context sentences to solidify active vocabulary.
     * High Strength / Recently Reviewed Words (strength 3-4): Challenge the learner with nuanced context or subtle distractor choices to ensure long-term mastery.
4. Question Types (mix across questions):
   - 'definition': "Which word matches the following definition?\n'[definition in ${targetLanguage}]'"
     * CRITICAL SINGULAR/PLURAL & COUNTABILITY RULE: Ensure the definition clearly aligns with the target word's grammatical number and part of speech. If the target word is singular or uncountable (e.g., 'junk', 'furniture', 'information', 'equipment'), do NOT phrase the definition in a misleading plural way or, if helpful, explicitly include part of speech / countability cues in the prompt (e.g., "Which word (uncountable noun) matches...").
   - 'sentence': "Fill in the blank for the sentence:\n'[sentence in ${targetLanguage} tailored strictly to the word's category/context with target word replaced by ______]'"
     * Ensure the sentence context matches the exact grammatical form (tense, singular/plural) of the target word.
   - 'listening': "Listen to the audio clip and select the correct matching word:" (options contain phonetically/morphologically similar words)
   - 'picture': "Which word matches the visual concept shown below?" (set imageKeyword to a 3-5 word comma-free search term capturing the visual concept of the word with relevance context and category for image search)
5. Context & Category Alignment:
   - Each word provided contains its stored 'category' and 'context'. You MUST tailor sentence blanks, definitions, and picture descriptions specifically around the word's given category and context scenario.
6. MANDATORY PICTURE/IMAGE QUESTION REQUIREMENT:
   - At least ONE question in the generated quiz MUST be a picture or image-based question ('type': 'picture').
   - For picture questions, set question to "Which word matches the visual concept shown below?" and set 'imageKeyword' to a 3-5 word comma-free search term capturing the visual concept of the word with relevance context and category for image search.

7. FREQUENTLY PAIRED WORDS / COLLOCATIONS REQUIREMENT:
   - For EVERY quiz question / vocabulary word, generate 1 to 3 suggestions for companion words, collocations, or phrases that frequently appear alongside this target word in natural usage ('suggestedWords': array of 1 to 3 items, where each item contains 'word' in ${targetLanguage}, 'translation' in ${nativeLanguage}, and 'hint' or brief collocation note explaining why/how they appear together, e.g. "frequent adjective + noun collocation" or "common idiomatic verb pairing").

8. Output Schema:
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
    "imageKeyword": "string (3-5 word comma-free search term capturing the visual concept of the word with relevance context and category for image search)",
    "suggestedWords": [
      {
        "word": "string (Companion word/collocation in ${targetLanguage})",
        "translation": "string (Translation in ${nativeLanguage})",
        "hint": "string (Brief note on how/why it frequently appears alongside the quiz word)"
      }
    ]
  }
]`;

    const prompt = `Generate 1 quiz question for each of these vocabulary words, adapting question depth and distractors according to the provided word stats and learner progress stats.

CRITICAL MANDATORY REQUIREMENTS:
1. Ensure at least ONE question in the generated quiz MUST be a picture or image-based question ('type': 'picture') with relevant 'imageKeyword' keywords.
2. For EVERY question, include 1 to 3 suggestions for words that frequently appear alongside the word used in the quiz ('suggestedWords' array with 'word', 'translation', and 'hint').\n\n` +
      (usefulStatsSummary ? `Learner Progress Stats:\n${JSON.stringify(usefulStatsSummary, null, 2)}\n\n` : "") +
      `Vocabulary Words with Word Mastery Stats:\n${JSON.stringify(wordDataSummary, null, 2)}`;
    const schemaDesc = `Array of QuizQuestion objects with id, wordId, word, type, question, options, correctAnswer, hint, imageKeyword, and suggestedWords (array of 1 to 3 items with word, translation, hint).`;

    const text = await callLLM(prompt, systemInstruction, schemaDesc, llmConfig);
    const cleaned = cleanJsonResponse(text);
    const result = cleanAndParseJson(cleaned);

    let provider = result.provider || llmConfig?.provider || "gemini";
    let model = result.model || sanitizeModel(provider, llmConfig?.model);
    let responseTimeMs = result.responseTimeMs;

    let questionsArray = result;
    if (!Array.isArray(result) && result && Array.isArray(result.questions)) {
      questionsArray = result.questions;
    }

    if (Array.isArray(questionsArray) && questionsArray.length > 0) {
      // Guarantee at least one picture question in result
      const hasPicture = questionsArray.some((q: any) => q.type === "picture");
      if (!hasPicture) {
        questionsArray[0].type = "picture";
        questionsArray[0].question = "Which word matches the visual concept shown below?";
        questionsArray[0].imageKeyword = questionsArray[0].word;
      }

      // Normalize suggestedWords on each question
      questionsArray.forEach((q: any, idx: number) => {
        const matchingWord = words.find((w: any) => w.id === q.wordId || (w.word || "").toLowerCase() === (q.word || "").toLowerCase()) || words[idx % words.length];
        
        let rawSuggestions = Array.isArray(q.suggestedWords) 
          ? q.suggestedWords 
          : (Array.isArray(q.suggestedVocabulary) ? q.suggestedVocabulary : (Array.isArray(q.collocations) ? q.collocations : []));
        
        if (rawSuggestions.length === 0 && matchingWord && Array.isArray(matchingWord.suggestedWords)) {
          rawSuggestions = matchingWord.suggestedWords;
        }

        const normalizedSuggestions = rawSuggestions.slice(0, 3).map((item: any) => {
          if (typeof item === "string") {
            return {
              word: item,
              translation: "",
              hint: `Frequently appears with ${q.word || matchingWord.word}`,
              pairedWith: q.word || matchingWord.word
            };
          }
          return {
            word: item.word || item.vocab || item.term || "",
            translation: item.translation || item.meaning || "",
            hint: item.hint || item.reason || item.relationship || item.usage || `Frequently appears with ${q.word || matchingWord.word}`,
            pairedWith: q.word || matchingWord.word
          };
        }).filter((s: any) => Boolean(s.word && s.word.trim()));

        q.suggestedWords = normalizedSuggestions;
      });

      await Promise.all(
        questionsArray.map(async (q: any) => {
          if (q.type === "picture" || q.imageKeyword || q.imageUrl) {
            const keywordText = q.imageKeyword || q.word;
            q.imageKeyword = keywordText;
            const imgUrl = await generateWorkerImage(keywordText);
            if (imgUrl) {
              q.imageUrl = imgUrl;
            } else {
              q.imageUrl = `https://image.nclong87.workers.dev?query=${encodeURIComponent(keywordText)}`;
            }
          }
        })
      );
    }

    res.json({
      questions: questionsArray,
      provider,
      model,
      responseTimeMs
    });
  } catch (error: any) {
    console.error("Error generating AI quiz:", error);
    const parsed = parseServerError(error, req.body?.llmConfig?.provider || "gemini");
    const code = parsed.statusCode >= 400 && parsed.statusCode < 600 ? parsed.statusCode : 500;
    res.status(code).json({ error: parsed.userMessage, statusCode: parsed.statusCode, errorType: parsed.errorType });
  }
});

// 9.5. Suggest Casual Reply
app.post("/api/suggest-casual-reply", async (req, res) => {
  try {
    const { imageDataUrl, systemPrompt, userText, provider, model  } = req.body;

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
        })
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
          return res.json(result);
        }
      }

    } else {
      // no image, just use the prompt directly with the LLM
    }
    throw new Error("Image analysis worker did not return valid JSON with suggestedReplies and vocabularyCandidates.");
      
  } catch (error: any) {
    console.error("Error suggesting casual reply:", error);
    const parsed = parseServerError(error, req.body?.llmConfig?.provider || "gemini");
    const code = parsed.statusCode >= 400 && parsed.statusCode < 600 ? parsed.statusCode : 500;
    res.status(code).json({ error: parsed.userMessage, statusCode: parsed.statusCode, errorType: parsed.errorType });
  }
});

// 10. Multimodal Image Vocabulary Analysis endpoint with Worker + Gemini Fallback
app.post("/api/analyze-image-vocab", async (req, res) => {
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
      })
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
        return res.json(result);
      }
    }
    throw new Error(`Image analysis worker failed with status ${workerRes.status}: ${await workerRes.text()}`);
    
  } catch (error: any) {
    console.error("Error analyzing image vocabulary:", error);
    res.status(500).json({ error: error.message || "Failed to analyze image vocabulary" });
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
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

