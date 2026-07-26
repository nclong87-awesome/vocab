import { GoogleGenAI } from "@google/genai";
import { LLMConfig } from "../types";
import { PROVIDER_OPTIONS } from "../config/llmProviders";

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

const VALID_GEMINI_MODELS = ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.5-flash-lite", "gemini-2.0-flash", "gemini-1.5-flash"];

// Sanitize model names for provider
function sanitizeModel(provider: string, model?: string): string {
  if (provider === "gemini") {
    if (!model || !VALID_GEMINI_MODELS.includes(model)) {
      return "gemini-2.5-flash";
    }
  }
  return model || (provider === "gemini" ? "gemini-2.5-flash" : "gpt-5.4-mini");
}

// Client-side direct LLM API invocation
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
    throw new Error(`API Key is required for ${provider.toUpperCase()}. Please enter a valid API key in LLM settings.`);
  }

  const effectiveApiKey = apiKey || "local-token";

  if (provider === "gemini") {
    try {
      const ai = new GoogleGenAI({ apiKey: effectiveApiKey });
      const response = await ai.models.generateContent({
        model: model || "gemini-3.6-flash",
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
      if (err.name === "TypeError" || err.message?.includes("Failed to fetch")) {
        throw new Error("Gemini API Network Error: Unable to reach Google Gemini API from browser.");
      }
      throw err;
    }
  }

  if (provider === "anthropic") {
    const endpoint = (baseUrl || "https://api.anthropic.com") + "/v1/messages";
    try {
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
    } catch (err: any) {
      if (err.name === "TypeError" || err.message?.includes("Failed to fetch") || err.message?.includes("CORS")) {
        throw new Error(`Anthropic CORS/Network Error: Direct browser call to Anthropic blocked. Ensure API key is valid.`);
      }
      throw err;
    }
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

  try {
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
  } catch (err: any) {
    if (err.name === "TypeError" || err.message?.includes("Failed to fetch") || err.message?.includes("CORS")) {
      const isLocalHost = targetUrl.includes("localhost") || targetUrl.includes("127.0.0.1");

      if (isLocalHost) {
        throw new Error(
          `Local Network / CORS Error: Cannot connect to local LLM endpoint (${targetUrl}). ` +
          `Ensure local service is running.`
        );
      }

      throw new Error(
        `Browser Connection / CORS Error: ${provider.toUpperCase()} endpoint (${targetUrl}) blocked direct browser requests. ` +
        `Direct browser calls were blocked by CORS policy or the endpoint is unreachable.`
      );
    }
    throw err;
  }
}

// Helper to check if running in a pure static client host (e.g. GitHub Pages)
function isStaticHost(): boolean {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  return host.endsWith("github.io") || host.endsWith("netlify.app") || host.endsWith("vercel.app") || window.location.protocol === "file:";
}

// 1. Test LLM Connection
export async function testLlmConnection(llmConfig: LLMConfig): Promise<{ success: boolean; response?: string; error?: string }> {
  // If running on static host (GitHub Pages), skip backend /api call directly
  if (isStaticHost()) {
    try {
      const text = await callLLMClientSide(
        "Respond with a short json object: {\"status\": \"connected\", \"message\": \"LLM provider connection successful!\"}",
        "You are a helpful dictionary test assistant.",
        "{\n  \"status\": \"string\",\n  \"message\": \"string\"\n}",
        llmConfig
      );
      return { success: true, response: text };
    } catch (clientErr: any) {
      return { success: false, error: clientErr.message || "Failed to connect to LLM provider" };
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
      return data;
    }

    if (response.status === 405 || response.status === 404) {
      const text = await callLLMClientSide(
        "Respond with a short json object: {\"status\": \"connected\", \"message\": \"LLM provider connection successful!\"}",
        "You are a helpful dictionary test assistant.",
        "{\n  \"status\": \"string\",\n  \"message\": \"string\"\n}",
        llmConfig
      );
      return { success: true, response: text };
    }

    const errData = await response.json().catch(() => null);
    if (errData && errData.error) {
      return { success: false, error: errData.error };
    }
  } catch (err: any) {
    // Fallback to client-side
  }

  try {
    const text = await callLLMClientSide(
      "Respond with a short json object: {\"status\": \"connected\", \"message\": \"LLM provider connection successful!\"}",
      "You are a helpful dictionary test assistant.",
      "{\n  \"status\": \"string\",\n  \"message\": \"string\"\n}",
      llmConfig
    );
    return { success: true, response: text };
  } catch (clientErr: any) {
    return { success: false, error: clientErr.message || "Failed to connect to LLM provider" };
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
The user's native language for definitions and explanations is "${userNative}".

CRITICAL INSTRUCTIONS:
- "definition": Write clear, easy-to-understand definitions of each target word in the user's NATIVE language (${userNative}).
- "translation": Direct translation into the user's native language (${userNative}).
- "example": Example sentence in target language (${userTarget}).
- "exampleTranslation": Translation of the example sentence into the user's native language (${userNative}).
Ensure the words selected cover different skill levels and are practical for real conversation.`;

  const systemInstruction = `You are an expert language teacher specializing in creating vocabulary material for ${userNative} native speakers learning ${userTarget}.`;
  const schemaDesc = `{
  "name": "Creative deck title",
  "description": "Short description in ${userNative}",
  "words": [
    {
      "word": "string (target word in ${userTarget})",
      "pronunciation": "string (IPA format)",
      "partOfSpeech": "string",
      "definition": "string (definition written in ${userNative})",
      "translation": "string (direct translation in ${userNative})",
      "example": "string (sentence in ${userTarget})",
      "exampleTranslation": "string (sentence translation in ${userNative})"
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
  llmConfig?: LLMConfig;
}): Promise<any> {
  const { word, targetLanguage, nativeLanguage, llmConfig } = params;
  const userNative = nativeLanguage || "English";
  const userTarget = targetLanguage || "Spanish";

  const prompt = `Provide detailed vocabulary learning material for the word or expression "${word}".
Target language being learned: "${userTarget}".
User's native language: "${userNative}".

CRITICAL MANDATORY REQUIREMENT:
- "definition": You MUST write the definition/explanation in the user's native language (${userNative}) so the learner clearly understands it.
- "translation": Provide the direct, accurate translation of "${word}" into the user's native language (${userNative}).
- "pronunciation": International Phonetic Alphabet (IPA) pronunciation guide.
- "partOfSpeech": noun, verb, adjective, adverb, idiom, or expression.
- "example": A realistic, high-quality example sentence in the target language (${userTarget}).
- "exampleTranslation": Full translation of the example sentence into the user's native language (${userNative}).`;

  const systemInstruction = `You are a professional multilingual dictionary database engine. Always output definitions and translations in the user's native language (${userNative}).`;
  const schemaDesc = `{
  "word": "string",
  "pronunciation": "string",
  "partOfSpeech": "string",
  "definition": "string (definition in ${userNative})",
  "translation": "string (translation in ${userNative})",
  "example": "string (example in ${userTarget})",
  "exampleTranslation": "string (example translation in ${userNative})"
}`;

  if (isStaticHost()) {
    const text = await callLLMClientSide(prompt, systemInstruction, schemaDesc, llmConfig);
    return JSON.parse(text);
  }

  try {
    const res = await fetch("/api/autofill-word", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ word, targetLanguage: userTarget, nativeLanguage: userNative, llmConfig })
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
