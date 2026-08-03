import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

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

// Helper to fix unescaped control characters (newlines/tabs) inside string literals in JSON
function sanitizeUnescapedJsonStrings(str: string): string {
  return str.replace(/"([^"\\]*(\\.[^"\\]*)*)"/g, (match) => {
    return match
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "\\r")
      .replace(/\t/g, "\\t");
  });
}

// Helper to clean JSON response text
function cleanJsonResponse(rawText: string): string {
  if (!rawText) return "";
  let cleaned = rawText.trim();

  // 1. If raw string is ALREADY valid JSON, return it immediately
  try {
    JSON.parse(cleaned);
    return cleaned;
  } catch {
    // Continue cleaning
  }

  // 2. Handle markdown code fences wrapping the entire output
  // e.g. ```json\n{ ... }\n``` or ```\n{ ... }\n```
  if (cleaned.startsWith("```")) {
    const unquoted = cleaned
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    try {
      JSON.parse(unquoted);
      return unquoted;
    } catch {
      cleaned = unquoted;
    }
  }

  // 3. Extract JSON object/array from surrounding conversational text or preambles
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
    const candidate = cleaned.substring(startIdx, endIdx + 1).trim();
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      cleaned = candidate;
    }
  }

  // 4. Try fixing unescaped control characters inside JSON strings
  try {
    const sanitized = sanitizeUnescapedJsonStrings(cleaned);
    JSON.parse(sanitized);
    return sanitized;
  } catch {
    // Return best effort candidate string
    return cleaned;
  }
}

const VALID_GEMINI_MODELS = ["gemini-3.6-flash", "gemini-3.6-flash-lite", "gemini-3.5-flash", "gemini-3.5-flash-lite"];

// Sanitize model names for provider
function sanitizeModel(provider: string, model?: string): string {
  if (provider === "chatjimmy") {
    return model || "llama3.1-8B";
  }
  if (provider === "groq") {
    return model || "openai/gpt-oss-20b";
  }
  if (provider === "openrouter") {
    return model || "deepseek/deepseek-chat";
  }
  if (provider === "gemini") {
    if (!model || !VALID_GEMINI_MODELS.includes(model)) {
      return "gemini-3.6-flash";
    }
  }
  return model || (provider === "chatjimmy" ? "llama3.1-8B" : provider === "groq" ? "openai/gpt-oss-20b" : provider === "openrouter" ? "deepseek/deepseek-chat" : provider === "gemini" ? "gemini-3.6-flash" : "deepseek/deepseek-chat");
}

function getProviderDisplayName(provider?: string): string {
  if (!provider) return "Selected AI";
  if (provider === "gemini") return "Google Gemini";
  if (provider === "openai") return "OpenAI";
  if (provider === "groq") return "Groq";
  if (provider === "openrouter") return "OpenRouter";
  if (provider === "chatjimmy") return "ChatJimmy AI";
  if (provider === "ollama") return "Ollama";
  if (provider === "9flare") return "9Flare";
  if (provider === "custom") return "Custom Endpoint";
  return provider;
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

// Call LLM based on provider
async function callLLM(
  prompt: string, 
  systemInstruction: string, 
  schemaDescription: string,
  llmConfig?: LLMRequestConfig
): Promise<string> {
  const provider = llmConfig?.provider || "openrouter";
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
          systemPrompt: systemInstruction + "\n\nCRITICAL INSTRUCTION: Output STRICTLY raw valid JSON-only matching schema:\n" + schemaDescription + "\nDo not include any conversational filler outside the JSON.",
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
    const effectiveGeminiUrl = baseUrl || "https://gemini.nclong87.workers.dev/v1beta";
    const isCustomOrProxyUrl = Boolean(effectiveGeminiUrl && !effectiveGeminiUrl.includes("googleapis.com"));

    if (!isCustomOrProxyUrl) {
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
      const fallbackModels = ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite"].filter(m => m !== primaryModel);

      let lastError: any = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        const activeModel = attempt === 1 ? primaryModel : (fallbackModels[0] || "gemini-3.6-flash");
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
    } else {
      // Worker proxy handling for Gemini (uses native generateContent endpoint rather than /chat/completions)
      const primaryModel = model || "gemini-3.6-flash";
      const cleanBaseUrl = effectiveGeminiUrl.replace(/\/$/, "");
      const targetEndpoint = `${cleanBaseUrl}/models/${primaryModel}:generateContent${effectiveApiKey ? `?key=${effectiveApiKey}` : ""}`;

      const headers: Record<string, string> = {
        "Content-Type": "application/json"
      };
      if (effectiveProxyKey) {
        headers["X-Proxy-Key"] = effectiveProxyKey;
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
        throw new Error(`Gemini Worker Proxy Error (${res.status}): ${errText}`);
      }

      const data: any = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
      if (!text) {
        throw new Error("Empty text response from Gemini worker proxy.");
      }
      return cleanJsonResponse(text);
    }
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
        system: systemInstruction + "\nOutput MUST be strictly valid raw JSON-only complying with schema:\n" + schemaDescription + "\nDo not include any conversational filler outside the JSON.",
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

  // OpenAI-compatible providers: openai, 9flare, ollama, groq, openrouter, custom, gemini (when using worker/proxy)
  let defaultBaseUrl = "https://openai.nclong87.workers.dev/v1";
  if (provider === "groq") defaultBaseUrl = "https://groq.nclong87.workers.dev/openai/v1";
  if (provider === "openrouter") defaultBaseUrl = "https://openrouter.nclong87.workers.dev/api/v1";
  if (provider === "9flare") defaultBaseUrl = "https://9flare.nclong87.workers.dev/api/v1";
  if (provider === "ollama") defaultBaseUrl = "http://localhost:11434/v1";
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
    headers["HTTP-Referer"] = "https://aistudio.google.com";
    headers["X-Title"] = "Vocabulary Learner";
  }

  if (effectiveProxyKey || (effectiveTargetBaseUrl && (effectiveTargetBaseUrl.includes("workers.dev") || effectiveTargetBaseUrl.includes("worker.dev") || effectiveTargetBaseUrl.includes("cloudflare.com")))) {
    headers["X-Proxy-Key"] = effectiveProxyKey || effectiveApiKey;
  }

  const reqBody: any = {
    model: model || (provider === "openrouter" ? "deepseek/deepseek-chat" : provider === "gemini" ? "gemini-3.6-flash" : "deepseek/deepseek-chat"),
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

  let res = await fetch(targetUrl, {
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
      res = await fetch(targetUrl, {
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
async function generateWorkerImage(promptText: string, effectiveProxyKey: string): Promise<string> {
  if (!promptText) return "";
  try {
    const workerUrl = `https://image.nclong87.workers.dev?prompt=${encodeURIComponent(promptText)}`;
    const response = await fetch(workerUrl, {
      method: "GET",
      headers: {
        "X-Proxy-Key": effectiveProxyKey || ""
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

// Multimodal LLM invocation (for Vision / Image analysis)
async function callLLMWithImage(
  prompt: string,
  imageDataUrl: string,
  systemInstruction: string,
  schemaDescription: string,
  llmConfig?: LLMRequestConfig
): Promise<string> {
  const provider = llmConfig?.provider || "gemini";
  const model = sanitizeModel(provider, llmConfig?.model);

  // Parse image Data URL into mimeType and raw base64 data
  let mimeType = "image/jpeg";
  let base64Data = imageDataUrl;
  if (imageDataUrl.startsWith("data:")) {
    const parts = imageDataUrl.split(";base64,");
    mimeType = parts[0].replace("data:", "") || "image/jpeg";
    base64Data = parts[1] || "";
  }

  // Provider 1: Gemini or Gemini models
  if (provider === "gemini" || model.includes("gemini")) {
    const geminiConfig = llmConfig?.savedProviders?.gemini;
    const apiKey = geminiConfig?.apiKey || (llmConfig?.provider === "gemini" ? llmConfig?.apiKey : "") || process.env.GEMINI_API_KEY || "";
    const sharedProxyKey = llmConfig?.proxyKey ||
      (llmConfig?.savedProviders ? (Object.values(llmConfig.savedProviders) as any[]).find((p: any) => Boolean(p?.proxyKey))?.proxyKey : "") ||
      process.env.PROXY_KEY || process.env.PROXY_SECRET || process.env.X_PROXY_KEY || "";
    const proxyKey = geminiConfig?.proxyKey || sharedProxyKey;
    
    let effectiveGeminiUrl = geminiConfig?.baseUrl || (llmConfig?.provider === "gemini" ? llmConfig?.baseUrl : "") || "https://gemini.nclong87.workers.dev/v1beta";
    if (effectiveGeminiUrl && !effectiveGeminiUrl.includes("gemini") && !effectiveGeminiUrl.includes("googleapis.com")) {
      effectiveGeminiUrl = "https://gemini.nclong87.workers.dev/v1beta";
    }

    let effectiveApiKey = apiKey || process.env.GEMINI_API_KEY || "";
    const effectiveProxyKey = proxyKey || effectiveApiKey || process.env.PROXY_KEY || process.env.PROXY_SECRET || process.env.X_PROXY_KEY || "";

    const isCustomOrProxyUrl = Boolean(effectiveGeminiUrl && !effectiveGeminiUrl.includes("googleapis.com"));

    if (!isCustomOrProxyUrl) {
      const ai = new GoogleGenAI({
        apiKey: effectiveApiKey || effectiveProxyKey || "local-key",
        httpOptions: { 
          headers: { 
            'User-Agent': 'aistudio-build',
            ...(effectiveProxyKey ? { 'X-Proxy-Key': effectiveProxyKey } : {})
          } 
        }
      });

      const activeModel = model || "gemini-3.6-flash";
      const response = await ai.models.generateContent({
        model: activeModel,
        contents: [
          {
            role: "user",
            parts: [
              { inlineData: { mimeType, data: base64Data } },
              { text: prompt }
            ]
          }
        ],
        config: {
          systemInstruction,
          responseMimeType: "application/json"
        }
      });

      if (!response.text) {
        throw new Error("Empty response received from Gemini Vision model.");
      }
      return cleanJsonResponse(response.text);
    } else {
      const activeModel = model || "gemini-3.6-flash";
      const cleanBaseUrl = effectiveGeminiUrl.replace(/\/$/, "");
      const targetEndpoint = `${cleanBaseUrl}/models/${activeModel}:generateContent${effectiveApiKey ? `?key=${effectiveApiKey}` : ""}`;

      const headers: Record<string, string> = {
        "Content-Type": "application/json"
      };
      if (effectiveProxyKey) {
        headers["X-Proxy-Key"] = effectiveProxyKey;
      }
      if (effectiveApiKey) {
        headers["x-goog-api-key"] = effectiveApiKey;
      }

      const payload = {
        contents: [
          {
            role: "user",
            parts: [
              { inlineData: { mimeType, data: base64Data } },
              { text: prompt }
            ]
          }
        ],
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
        throw new Error(`Gemini Vision Worker Proxy Error (${res.status}): ${errText}`);
      }

      const data: any = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
      if (!text) {
        throw new Error("Empty text response from Gemini Vision worker proxy.");
      }
      return cleanJsonResponse(text);
    }
  }

  // Provider 2: OpenAI / OpenRouter / Groq / Ollama / 9Flare / Custom Vision model
  let defaultBaseUrl = "https://openai.nclong87.workers.dev/v1";
  if (provider === "groq") defaultBaseUrl = "https://groq.nclong87.workers.dev/openai/v1";
  if (provider === "openrouter") defaultBaseUrl = "https://openrouter.nclong87.workers.dev/api/v1";
  if (provider === "9flare") defaultBaseUrl = "https://9flare.nclong87.workers.dev/api/v1";
  if (provider === "ollama") defaultBaseUrl = "http://localhost:11434/v1";
  if (provider === "custom") defaultBaseUrl = "http://localhost:11434/v1";

  const providerSavedConfig = llmConfig?.savedProviders?.[provider];
  const apiKey = providerSavedConfig?.apiKey || llmConfig?.apiKey || "";
  const baseUrl = providerSavedConfig?.baseUrl || llmConfig?.baseUrl || "";
  const sharedProxyKey = llmConfig?.proxyKey ||
    (llmConfig?.savedProviders ? (Object.values(llmConfig.savedProviders) as any[]).find((p: any) => Boolean(p?.proxyKey))?.proxyKey : "") ||
    process.env.X_PROXY_KEY || process.env.PROXY_KEY || process.env.PROXY_SECRET || "";
  const proxyKey = providerSavedConfig?.proxyKey || sharedProxyKey;

  const effectiveApiKey = apiKey;
  const effectiveProxyKey = proxyKey || process.env.X_PROXY_KEY || process.env.PROXY_KEY || process.env.PROXY_SECRET || "";
  const activeKey = effectiveApiKey || effectiveProxyKey;

  let effectiveTargetBaseUrl = (baseUrl && baseUrl.trim()) ? baseUrl.trim() : defaultBaseUrl;
  effectiveTargetBaseUrl = effectiveTargetBaseUrl.replace(/\/+$/, "");
  if (effectiveTargetBaseUrl.endsWith("/chat/completions")) {
    effectiveTargetBaseUrl = effectiveTargetBaseUrl.slice(0, -"/chat/completions".length).replace(/\/+$/, "");
  }

  const targetUrl = effectiveTargetBaseUrl + "/chat/completions";

  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };

  if (activeKey) {
    headers["Authorization"] = `Bearer ${activeKey}`;
  }

  if (provider === "openrouter") {
    headers["HTTP-Referer"] = "https://aistudio.google.com";
    headers["X-Title"] = "Vocabulary Learner";
  }

  if (effectiveProxyKey || activeKey || (effectiveTargetBaseUrl && (effectiveTargetBaseUrl.includes("workers.dev") || effectiveTargetBaseUrl.includes("worker.dev") || effectiveTargetBaseUrl.includes("cloudflare.com")))) {
    headers["X-Proxy-Key"] = effectiveProxyKey || activeKey || "";
  }

  const reqBody = {
    model: model,
    messages: [
      {
        role: "system",
        content: systemInstruction + "\nOutput MUST be strictly valid raw JSON-only matching:\n" + schemaDescription + "\nDo not include any conversational filler outside the JSON."
      },
      {
        role: "user",
        content: [
          {
            type: "image_url",
            "image_url": {
              url: imageDataUrl
            }
          },
          {
            type: "text",
            text: prompt
          }
        ]
      }
    ]
  };

  const res = await fetch(targetUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(reqBody)
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`${getProviderDisplayName(provider)} Vision Error (${res.status}): ${errText}`);
  }

  const data: any = await res.json();
  const content = data.choices?.[0]?.message?.content || "";
  if (!content) {
    throw new Error(`Empty text response from ${getProviderDisplayName(provider)} Vision model.`);
  }
  return cleanJsonResponse(content);
}

// 1. Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// Image Generation Endpoint via worker https://image.nclong87.workers.dev
app.post("/api/generate-image", async (req, res) => {
  try {
    const { prompt, proxyKey, llmConfig } = req.body || {};
    const promptText = prompt || req.query.prompt || "";
    if (!promptText) {
      return res.status(400).json({ error: "Prompt parameter is required" });
    }
    const sharedProxyKey = llmConfig?.proxyKey ||
      (llmConfig?.savedProviders ? (Object.values(llmConfig.savedProviders) as any[]).find((p: any) => Boolean(p?.proxyKey))?.proxyKey : "") ||
      "";
    const effectiveProxyKey = proxyKey || sharedProxyKey || (req.headers["x-proxy-key"] as string) || process.env.PROXY_KEY || process.env.PROXY_SECRET || process.env.X_PROXY_KEY || process.env.GEMINI_API_KEY || "";

    const imageUrl = await generateWorkerImage(promptText, effectiveProxyKey);
    if (!imageUrl) {
      return res.status(500).json({ error: "Failed to generate image from worker" });
    }
    res.json({ imageUrl, prompt: promptText });
  } catch (error: any) {
    console.error("Error generating image via worker:", error);
    res.status(500).json({ error: error.message || "Failed to generate image" });
  }
});

app.get("/api/generate-image", async (req, res) => {
  try {
    const promptText = (req.query.prompt as string) || "";
    const clientProxyKey = (req.query.proxyKey as string) || (req.headers["x-proxy-key"] as string) || "";
    if (!promptText) {
      return res.status(400).json({ error: "Prompt query parameter is required" });
    }
    const effectiveProxyKey = clientProxyKey || process.env.PROXY_KEY || process.env.PROXY_SECRET || process.env.X_PROXY_KEY || process.env.GEMINI_API_KEY || "";

    const imageUrl = await generateWorkerImage(promptText, effectiveProxyKey);
    if (!imageUrl) {
      return res.status(500).json({ error: "Failed to generate image from worker" });
    }
    res.json({ imageUrl, prompt: promptText });
  } catch (error: any) {
    console.error("Error generating image via worker GET:", error);
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
1. NATURAL LANGUAGE REQUEST OR DESCRIPTION:
   - If "${word}" is a descriptive sentence, phrase, or request asking for a word (e.g., "i want to add a word in programming, related to if condition simplify", "word for feeling persistent", "how to say thank you formally"):
     * DEDUCE and IDENTIFY the exact single best vocabulary term or expression in "${userTarget}" (e.g. "Ternary operator", "Perseverance", "Much obliged").
     * Set the "word" field strictly to this deduced Target Language word/expression.
     * Set "translation" strictly to its direct translation in "${userNative}".
2. SINGLE WORD / EXPRESSION ENTRY:
   - If "${word}" is in the user's Native Language ("${userNative}"), e.g. "xin chào": translate it into "${userTarget}" (e.g. "hello"). Set "word" to "${userTarget}" term and "translation" to "${userNative}" term.
   - If "${word}" is already in "${userTarget}" (e.g. "hello"): set "word" strictly to "${word}" and "translation" to "${userNative}".

- "definition": Write clear, concise definition/explanation STRICTLY in the TARGET language (${userTarget}) for target language immersion.
- "pronunciation": International Phonetic Alphabet (IPA) pronunciation guide for the target language word.
- "partOfSpeech": noun, verb, adjective, adverb, idiom, interjection, or expression.
- "example": A realistic, high-quality example sentence in the target language (${userTarget}), e.g. "Hello, how are you?".
- "exampleTranslation": Full translation of the example sentence into the user's native language (${userNative}), e.g. "Xin chào, bạn khỏe không?".
- "category": High-level category or topic classification (e.g. "Technology & Programming", "Travel & Hospitality", "Business & Work", "Daily Life", "Emotions & Mind", "Education", "Food & Dining", etc.).
- "context": A concise 1-sentence description of the specific real-world scenario, domain, or usage context where this term is typically used.`;

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
1. NATURAL LANGUAGE REQUEST / CONCEPT DESCRIPTION:
   - The user input "${word}" might be a sentence, description, or request asking for a word (e.g., "i want to add a word in programming, related to if condition simplify", "a word for persistent in Spanish", "how to say thank you formally").
   - If "${word}" is a description, request, or question:
     * DEDUCE and IDENTIFY 1 to 3 candidate vocabulary words or expressions in "${userTarget}" that best match the described concept (e.g. "Ternary operator", "Guard clause", "Short-circuit evaluation").
     * Set the top-level "word" field to the primary deduced Target Language word.
     * Set "translation" strictly to its translation in "${userNative}".
2. DIRECT WORD / EXPRESSION LOOKUP:
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
     "imagePrompt": string,
     "category": string,
     "context": string`;

    const systemInstruction = `You are an elite multilingual vocabulary extraction & dictionary engine. You automatically detect input language, deduce target vocabulary terms from natural language descriptions or requests, and output structured JSON with target language words, definitions, and native language translations. Output strictly valid JSON-only output when requested. Do not include any conversational filler outside the JSON.`;
    const schemaDesc = `{
  "word": "string (the primary target word/expression STRICTLY in target language ${userTarget}, e.g. 'hello')",
  "notFound": boolean,
  "hasMultipleSenses": boolean,
  "senses": [
    {
      "word": "string (the target word/expression STRICTLY in target language ${userTarget}, e.g. 'hello')",
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

    const systemInstruction = `You are an encouraging, expert AI vocabulary coach. Output strictly valid JSON-only analytics when requested. Do not include any conversational filler outside the JSON.`;
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
- You MUST strictly output valid JSON-only output when requested matching the schema below.
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
   - 'picture': "Which word matches the visual concept shown below?" (set imagePrompt to a clear English visual prompt description strongly illustrating the target word itself and definition, e.g. "a clear photograph strongly highlighting the concept of 'VOLUNTEER' (a person freely offering help), clear subject focus, realistic photograph")
5. Context & Category Alignment:
   - Each word provided contains its stored 'category' and 'context'. You MUST tailor sentence blanks, definitions, and picture descriptions specifically around the word's given category and context scenario.

5. Output Schema:
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
    "imagePrompt": "string (visual prompt description for picture questions)"
  }
]`;

    const prompt = `Generate 1 quiz question for each of these vocabulary words, adapting question depth and distractors according to the provided word stats and learner progress stats:\n\n` +
      (usefulStatsSummary ? `Learner Progress Stats:\n${JSON.stringify(usefulStatsSummary, null, 2)}\n\n` : "") +
      `Vocabulary Words with Word Mastery Stats:\n${JSON.stringify(wordDataSummary, null, 2)}`;
    const schemaDesc = `Array of QuizQuestion objects with id, wordId, word, type, question, options, correctAnswer, hint, imagePrompt.`;

    const text = await callLLM(prompt, systemInstruction, schemaDesc, llmConfig);
    const cleaned = cleanJsonResponse(text);
    const result = JSON.parse(cleaned);

    if (Array.isArray(result)) {
      const sharedProxyKey = llmConfig?.proxyKey ||
        (llmConfig?.savedProviders ? (Object.values(llmConfig.savedProviders) as any[]).find((p: any) => Boolean(p?.proxyKey))?.proxyKey : "") ||
        "";
      const effectiveProxyKey = sharedProxyKey || (req.headers["x-proxy-key"] as string) || process.env.PROXY_KEY || process.env.PROXY_SECRET || process.env.X_PROXY_KEY || process.env.GEMINI_API_KEY || "";

      await Promise.all(
        result.map(async (q: any) => {
          if (q.type === "picture" || q.imagePrompt || q.imageUrl) {
            const promptText = q.imagePrompt || (q.imageUrl && !q.imageUrl.startsWith("http")
              ? q.imageUrl
              : `a clear photograph strongly highlighting the concept of "${q.word}", clear subject focus on ${q.word}, realistic photograph`);
            
            q.imagePrompt = promptText;
            const imgUrl = await generateWorkerImage(promptText, effectiveProxyKey);
            if (imgUrl) {
              q.imageUrl = imgUrl;
            } else {
              q.imageUrl = `https://image.nclong87.workers.dev?prompt=${encodeURIComponent(promptText)}`;
            }
          }
        })
      );
    }

    res.json(result);
  } catch (error: any) {
    console.error("Error generating AI quiz:", error);
    const parsed = parseServerError(error, req.body?.llmConfig?.provider || "gemini");
    const code = parsed.statusCode >= 400 && parsed.statusCode < 600 ? parsed.statusCode : 500;
    res.status(code).json({ error: parsed.userMessage, statusCode: parsed.statusCode, errorType: parsed.errorType });
  }
});

// 9. Analyze conversation history to auto-detect candidate words to add
app.post("/api/analyze-chat-words", async (req, res) => {
  try {
    const { messages, targetLanguage = "English", nativeLanguage = "Vietnamese", llmConfig } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "Messages array is required" });
    }

    const chatHistoryStr = messages
      .slice(-12)
      .map((m: any) => `${m.role === "user" ? "User" : "AI Coach"}: ${m.content}`)
      .join("\n\n");

    const prompt = `Analyze the following recent conversation thread between the user and their AI language coach:

${chatHistoryStr}

TASK: Identify candidate vocabulary words or expressions in "${targetLanguage}" (or native terms translated into "${targetLanguage}") that were discussed, introduced, used, or that the user wants to add to their vocabulary collection.

For each candidate word detected:
- Target word in "${targetLanguage}"
- Translation in "${nativeLanguage}"
- International Phonetic Alphabet (IPA) pronunciation guide
- Part of speech (noun, verb, adjective, adverb, idiom, expression, etc.)
- Clear definition in "${targetLanguage}"
- Natural example sentence in "${targetLanguage}"
- Translation of example sentence in "${nativeLanguage}"
- Suitable category (e.g. Daily Life, Travel, Business, Academic, Emotions, etc.)
- Short reason why this word was detected from the conversation.`;

    const systemInstruction = `You are an expert AI Vocabulary Analyzer. You examine conversation transcripts and detect the most valuable vocabulary words the user should add to their learning collection. Output strictly valid JSON-only output when requested. Do not include any conversational filler outside the JSON.`;

    const schemaDesc = `{
  "summary": "string (Short 1-2 sentence overview of discovered words from the chat)",
  "detectedWords": [
    {
      "word": "string (word in target language ${targetLanguage})",
      "translation": "string (translation in native language ${nativeLanguage})",
      "pronunciation": "string (IPA pronunciation)",
      "partOfSpeech": "string",
      "definition": "string",
      "example": "string",
      "exampleTranslation": "string",
      "category": "string",
      "context": "string",
      "reason": "string (Short reason why this word was extracted from conversation)"
    }
  ]
}`;

    const text = await callLLM(prompt, systemInstruction, schemaDesc, llmConfig);
    const result = JSON.parse(text);
    res.json(result);
  } catch (error: any) {
    console.error("Error analyzing chat words:", error);
    const parsed = parseServerError(error, req.body?.llmConfig?.provider || "gemini");
    const code = parsed.statusCode >= 400 && parsed.statusCode < 600 ? parsed.statusCode : 500;
    res.status(code).json({ error: parsed.userMessage, statusCode: parsed.statusCode, errorType: parsed.errorType });
  }
});

// 10. Multimodal Image Vocabulary Analysis endpoint using Cloudflare Worker
app.post("/api/analyze-image-vocab", async (req, res) => {
  try {
    const { imageDataUrl, customPrompt, targetLanguage = "English", nativeLanguage = "Vietnamese", llmConfig } = req.body;

    if (!imageDataUrl) {
      return res.status(400).json({ error: "Image Data (imageDataUrl) is required" });
    }

    let base64Data = imageDataUrl;
    if (imageDataUrl.startsWith("data:")) {
      const parts = imageDataUrl.split(";base64,");
      base64Data = parts[1] || imageDataUrl;
    }

    const sharedProxyKey = llmConfig?.proxyKey || 
      (llmConfig?.savedProviders ? (Object.values(llmConfig.savedProviders) as any[]).find((p: any) => Boolean(p?.proxyKey))?.proxyKey : "") || 
      llmConfig?.apiKey ||
      process.env.PROXY_KEY || process.env.PROXY_SECRET || process.env.X_PROXY_KEY || process.env.GEMINI_API_KEY || "";

    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };
    if (sharedProxyKey) {
      headers["X-Proxy-Key"] = sharedProxyKey;
    }

    const workerRes = await fetch("https://image-analysis.nclong87.workers.dev/", {
      method: "POST",
      headers,
      body: JSON.stringify({
        nativeLanguage,
        targetLanguage,
        imageData: base64Data,
        customPrompt
      })
    });

    if (!workerRes.ok) {
      const errText = await workerRes.text().catch(() => workerRes.statusText);
      throw new Error(`Image Analysis Worker Error (${workerRes.status}): ${errText}`);
    }

    const rawText = await workerRes.text();
    let result;
    try {
      result = JSON.parse(rawText);
    } catch {
      const cleaned = rawText.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      result = JSON.parse(cleaned);
    }

    res.json(result);
  } catch (error: any) {
    console.error("Error analyzing image vocabulary via worker:", error);
    res.status(500).json({ error: error.message || "Failed to analyze image vocabulary via Cloudflare worker" });
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

