import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// Lazy-initialized Gemini Client
let aiInstance: GoogleGenAI | null = null;

function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY environment variable is required. Please configure it in the Secrets panel.");
  }
  if (!aiInstance) {
    aiInstance = new GoogleGenAI({
      apiKey: apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  }
  return aiInstance;
}

// 1. Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// 2. Generate custom vocabulary deck
app.post("/api/generate-deck", async (req, res) => {
  try {
    const { topic, targetLanguage, nativeLanguage, quantity = 8 } = req.body;

    if (!topic) {
      return res.status(400).json({ error: "Topic is required" });
    }

    const ai = getGeminiClient();
    const prompt = `Generate a high-quality list of ${quantity} vocabulary words/expressions on the topic: "${topic}".
The target language that the user wants to learn is "${targetLanguage || 'English'}".
The user's native language for translation is "${nativeLanguage || 'Spanish'}".
Ensure the words selected cover different skill levels (beginner, intermediate, advanced) and are practical.
Provide clear definitions, pronunciations, parts of speech, and illustrative example sentences with translations.`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        systemInstruction: "You are an expert language teacher specializing in creating optimal vocabulary learning material.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING, description: "A creative, concise name for this vocabulary list (e.g., 'At the Airport', 'Business Idioms')" },
            description: { type: Type.STRING, description: "A short, engaging description summarizing what words are included and why" },
            words: {
              type: Type.ARRAY,
              description: `Exactly ${quantity} vocabulary items`,
              items: {
                type: Type.OBJECT,
                properties: {
                  word: { type: Type.STRING, description: "The word or common expression in the target language" },
                  pronunciation: { type: Type.STRING, description: "Phonetic transcription or simple pronunciation helper, e.g. /pər-ˈspɛk-tɪv/" },
                  partOfSpeech: { type: Type.STRING, description: "noun, verb, adjective, adverb, idiom, expression, etc." },
                  definition: { type: Type.STRING, description: "A simple, clear definition in the target language" },
                  translation: { type: Type.STRING, description: "The direct meaning or translation in the native language" },
                  example: { type: Type.STRING, description: "A practical, contextual sentence in the target language demonstrating typical usage" },
                  exampleTranslation: { type: Type.STRING, description: "The translation of the example sentence in the native language" }
                },
                required: ["word", "pronunciation", "partOfSpeech", "definition", "translation", "example", "exampleTranslation"]
              }
            }
          },
          required: ["name", "description", "words"]
        }
      }
    });

    const text = response.text;
    if (!text) {
      throw new Error("Empty response received from AI model");
    }

    const result = JSON.parse(text.trim());
    res.json(result);
  } catch (error: any) {
    console.error("Error generating deck:", error);
    res.status(500).json({ error: error.message || "Failed to generate vocabulary deck" });
  }
});

// 3. Auto-fill a single word
app.post("/api/autofill-word", async (req, res) => {
  try {
    const { word, targetLanguage, nativeLanguage } = req.body;

    if (!word) {
      return res.status(400).json({ error: "Word is required" });
    }

    const ai = getGeminiClient();
    const prompt = `Provide detailed vocabulary learning material for the word "${word}".
Target language being learned: "${targetLanguage || 'English'}".
Native language for translation: "${nativeLanguage || 'Spanish'}".`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        systemInstruction: "You are a professional dictionary database engine and linguistic tutor.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            word: { type: Type.STRING },
            pronunciation: { type: Type.STRING, description: "Phonetic spelling or pronunciation guide" },
            partOfSpeech: { type: Type.STRING, description: "noun, verb, adjective, adverb, expression, etc." },
            definition: { type: Type.STRING, description: "Clear and simple definition in target language" },
            translation: { type: Type.STRING, description: "Direct translation in native language" },
            example: { type: Type.STRING, description: "High-quality example sentence in target language" },
            exampleTranslation: { type: Type.STRING, description: "Translation of example sentence in native language" }
          },
          required: ["word", "pronunciation", "partOfSpeech", "definition", "translation", "example", "exampleTranslation"]
        }
      }
    });

    const text = response.text;
    if (!text) {
      throw new Error("Empty response received from AI model");
    }

    const result = JSON.parse(text.trim());
    res.json(result);
  } catch (error: any) {
    console.error("Error autofilling word:", error);
    res.status(500).json({ error: error.message || "Failed to auto-fill word details" });
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
