import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

interface LLMRequestConfig {
  provider?: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
}

// Helper to clean JSON response text
function cleanJsonResponse(rawText: string): string {
  let cleaned = rawText.trim();
  if (cleaned.startsWith("```json")) {
    cleaned = cleaned.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```\s*/, "").replace(/```$/i, "").trim();
  }
  return cleaned;
}

// Call LLM based on provider
async function callLLM(
  prompt: string, 
  systemInstruction: string, 
  schemaDescription: string,
  llmConfig?: LLMRequestConfig
): Promise<string> {
  const provider = llmConfig?.provider || "gemini";
  const model = llmConfig?.model || (provider === "gemini" ? "gemini-2.5-flash" : "gpt-5.4-mini");
  const apiKey = llmConfig?.apiKey || (provider === "gemini" ? process.env.GEMINI_API_KEY : "");
  const baseUrl = llmConfig?.baseUrl || "";

  const requiresKey = provider !== "ollama" && provider !== "custom";
  let effectiveApiKey = apiKey || (provider === "gemini" ? process.env.GEMINI_API_KEY || "" : "");

  if (requiresKey && !effectiveApiKey) {
    throw new Error(`API Key is required for provider: ${provider}. Please enter a valid API key in the LLM settings.`);
  }

  if (!effectiveApiKey) {
    effectiveApiKey = "local-token";
  }

  if (provider === "gemini") {
    const ai = new GoogleGenAI({
      apiKey: effectiveApiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
    });

    const response = await ai.models.generateContent({
      model: model || "gemini-2.5-flash",
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
  } 

  if (provider === "anthropic") {
    const endpoint = (baseUrl || "https://api.anthropic.com") + "/v1/messages";
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "x-api-key": effectiveApiKey,
        "anthropic-version": "2023-06-01",
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
  if (provider === "github") defaultBaseUrl = "https://models.github.ai/inference";
  if (provider === "9flare") defaultBaseUrl = "https://9flare.com/api/v1";
  if (provider === "ollama") defaultBaseUrl = "http://localhost:11434/v1";
  if (provider === "custom") defaultBaseUrl = "http://localhost:11434/v1";

  let rawBaseUrl = baseUrl || defaultBaseUrl;
  if (rawBaseUrl.includes("ollama.com/v1")) {
    rawBaseUrl = "http://localhost:11434/v1";
  }
  const targetUrl = rawBaseUrl.replace(/\/$/, "") + "/chat/completions";

  const headers: Record<string, string> = {
    "Authorization": `Bearer ${effectiveApiKey}`,
    "Content-Type": "application/json"
  };

  if (provider === "openrouter") {
    headers["HTTP-Referer"] = "https://aistudio.google.com";
    headers["X-Title"] = "Vocabulary Learner";
  }

  const reqBody: any = {
    model: model || "gpt-5.4-mini",
    messages: [
      { role: "system", content: systemInstruction + "\nOutput MUST be strictly valid raw JSON matching:\n" + schemaDescription },
      { role: "user", content: prompt }
    ]
  };

  // Many OpenAI compatible endpoints accept response_format: { type: "json_object" }
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

// 1. Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// 2. Test LLM Connection endpoint
app.post("/api/test-llm", async (req, res) => {
  try {
    const { llmConfig } = req.body;
    const text = await callLLM(
      "Respond with a short json object: {\"status\": \"connected\", \"message\": \"LLM provider connection successful!\"}",
      "You are a helpful dictionary test assistant.",
      "{\n  \"status\": \"string\",\n  \"message\": \"string\"\n}",
      llmConfig
    );
    res.json({ success: true, response: text });
  } catch (error: any) {
    console.error("LLM Test Error:", error);
    res.status(400).json({ success: false, error: error.message || "Failed to connect to LLM provider" });
  }
});

// 3. Generate custom vocabulary deck
app.post("/api/generate-deck", async (req, res) => {
  try {
    const { topic, targetLanguage, nativeLanguage, quantity = 8, llmConfig } = req.body;

    if (!topic) {
      return res.status(400).json({ error: "Topic is required" });
    }

    const userNative = nativeLanguage || localStorage?.getItem?.("vocab_learner_native_lang") || "English";
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

    const text = await callLLM(prompt, systemInstruction, schemaDesc, llmConfig);
    const result = JSON.parse(text);
    res.json(result);
  } catch (error: any) {
    console.error("Error generating deck:", error);
    res.status(500).json({ error: error.message || "Failed to generate vocabulary deck" });
  }
});

// 4. Auto-fill a single word
app.post("/api/autofill-word", async (req, res) => {
  try {
    const { word, targetLanguage, nativeLanguage, llmConfig } = req.body;

    if (!word) {
      return res.status(400).json({ error: "Word is required" });
    }

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

    const text = await callLLM(prompt, systemInstruction, schemaDesc, llmConfig);
    const result = JSON.parse(text);
    res.json(result);
  } catch (error: any) {
    console.error("Error autofilling word:", error);
    res.status(500).json({ error: error.message || "Failed to auto-fill word details" });
  }
});

// 5. Text-to-Speech API
app.post("/api/tts", async (req, res) => {
  try {
    const { text, engine, model, voice, apiKey, customEndpoint, llmConfig } = req.body;

    if (!text) {
      return res.status(400).json({ error: "Text is required for TTS generation" });
    }

    const effectiveApiKey = apiKey || llmConfig?.apiKey || (engine === "gemini" ? process.env.GEMINI_API_KEY : "");

    if (engine === "gemini") {
      const keyToUse = effectiveApiKey || process.env.GEMINI_API_KEY;
      if (!keyToUse) {
        return res.status(400).json({ error: "Gemini API key is required for Gemini AI TTS model" });
      }

      const ai = new GoogleGenAI({
        apiKey: keyToUse,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
      });

      const response = await ai.models.generateContent({
        model: model || "gemini-2.5-flash",
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
        const base64Data = part.inlineData.data;
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
    console.error("TTS API Error:", error);
    res.status(500).json({ error: error.message || "Failed to generate speech with AI TTS model" });
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

