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

// Client-side direct LLM API invocation
export async function callLLMClientSide(
  prompt: string, 
  systemInstruction: string, 
  schemaDescription: string,
  llmConfig?: LLMConfig
): Promise<string> {
  const provider = llmConfig?.provider || "gemini";
  const model = llmConfig?.model || (provider === "gemini" ? "gemini-2.5-flash" : "gpt-5.4-mini");
  const apiKey = llmConfig?.apiKey || "";
  const baseUrl = llmConfig?.baseUrl || "";

  const requiresKey = provider !== "ollama" && provider !== "custom";
  if (requiresKey && !apiKey) {
    throw new Error(`API Key is required for ${provider.toUpperCase()}. Please enter a valid key in LLM settings.`);
  }

  const effectiveApiKey = apiKey || "local-token";

  if (provider === "gemini") {
    const ai = new GoogleGenAI({ apiKey: effectiveApiKey });
    const response = await ai.models.generateContent({
      model: model || "gemini-2.5-flash",
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
  }

  if (provider === "anthropic") {
    const endpoint = (baseUrl || "https://api.anthropic.com") + "/v1/messages";
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
  if (provider === "github") defaultBaseUrl = "https://models.inference.ai.azure.com";
  if (provider === "9flare") defaultBaseUrl = "https://9flare.com/api/v1";
  if (provider === "ollama" || provider === "custom") defaultBaseUrl = "http://localhost:11434/v1";

  const targetUrl = (baseUrl || defaultBaseUrl).replace(/\/$/, "") + "/chat/completions";

  const headers: Record<string, string> = {
    "Authorization": `Bearer ${effectiveApiKey}`,
    "Content-Type": "application/json"
  };

  if (provider === "openrouter") {
    if (typeof window !== "undefined") {
      headers["HTTP-Referer"] = window.location.origin;
    }
    headers["X-Title"] = "Vocabulary Learner";
  }

  const reqBody: any = {
    model: model || "gpt-5.4-mini",
    messages: [
      { role: "system", content: systemInstruction + "\nOutput MUST be strictly valid raw JSON matching:\n" + schemaDescription },
      { role: "user", content: prompt }
    ]
  };

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

// 1. Test LLM Connection
export async function testLlmConnection(llmConfig: LLMConfig): Promise<{ success: boolean; response?: string; error?: string }> {
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

    // 405 (Method Not Allowed - e.g. GitHub Pages static server) or 404 or server error
    if (response.status === 405 || response.status === 404 || !response.ok) {
      console.warn(`Backend /api/test-llm returned HTTP ${response.status}. Falling back to direct client-side LLM call.`);
      const text = await callLLMClientSide(
        "Respond with a short json object: {\"status\": \"connected\", \"message\": \"LLM provider connection successful!\"}",
        "You are a helpful dictionary test assistant.",
        "{\n  \"status\": \"string\",\n  \"message\": \"string\"\n}",
        llmConfig
      );
      return { success: true, response: text };
    }
  } catch (err: any) {
    console.warn("Server endpoint call failed, attempting client-side direct LLM execution:", err);
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

  return { success: false, error: "Unable to reach LLM provider." };
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
      console.warn(`Backend /api/generate-deck returned HTTP ${res.status}. Executing client-side LLM call.`);
      const text = await callLLMClientSide(prompt, systemInstruction, schemaDesc, llmConfig);
      return JSON.parse(text);
    }

    const errData = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(errData.error || `Server Error ${res.status}`);
  } catch (err: any) {
    console.warn("Backend request failed, executing client-side direct LLM call:", err);
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
      console.warn(`Backend /api/autofill-word returned HTTP ${res.status}. Executing client-side LLM call.`);
      const text = await callLLMClientSide(prompt, systemInstruction, schemaDesc, llmConfig);
      return JSON.parse(text);
    }

    const errData = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(errData.error || `Server Error ${res.status}`);
  } catch (err: any) {
    console.warn("Backend request failed, executing client-side direct LLM call:", err);
    const text = await callLLMClientSide(prompt, systemInstruction, schemaDesc, llmConfig);
    return JSON.parse(text);
  }
}
