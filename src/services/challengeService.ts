import { ChallengeData, ChallengeTurnResult, UserPersonalityProfile, Word, LLMConfig } from "../types";

export interface GenerateChallengeParams {
  nativeLanguage?: string;
  targetLanguage?: string;
  personalityProfile?: UserPersonalityProfile | null;
  words?: Word[];
  llmConfig?: LLMConfig;
}

export interface ChallengeTurnParams {
  challenge: ChallengeData;
  userMessage: string;
  chatHistory?: Array<{ sender: "user" | "agent"; text: string }>;
  nativeLanguage?: string;
  targetLanguage?: string;
  llmConfig?: LLMConfig;
}

/**
 * Fallback static generator for instant responsiveness or offline operation
 */
export function generateFallbackChallenge(params: GenerateChallengeParams): ChallengeData {
  const nativeLanguage = params.nativeLanguage || "Vietnamese";
  const targetLanguage = params.targetLanguage || "English";
  const profile = params.personalityProfile;
  const archetype = profile?.archetype || "Pragmatic Professional";

  // Curate tailored fallback challenges based on archetype & interests
  const fallbackBank: Array<{ native: string; ideal: string; topic: string; words: Array<{ word: string; translation: string; hint?: string }> }> = [
    {
      native: nativeLanguage.toLowerCase().includes("viet")
        ? "Tôi rất muốn tham gia buổi họp nhưng tôi phải hoàn thành báo cáo này trước."
        : "I would love to join the meeting, but I must finish this report first.",
      ideal: "I would love to join the meeting, but I must finish this report first.",
      topic: "Workplace & Meetings",
      words: [
        { word: "join", translation: "tham gia", hint: "verb" },
        { word: "meeting", translation: "buổi họp", hint: "noun" },
        { word: "report", translation: "báo cáo", hint: "noun" }
      ]
    },
    {
      native: nativeLanguage.toLowerCase().includes("viet")
        ? "Xin lỗi, cho tôi hỏi quán cà phê gần nhất nằm ở đâu?"
        : "Excuse me, could you tell me where the nearest coffee shop is?",
      ideal: "Excuse me, could you tell me where the nearest coffee shop is?",
      topic: "Travel & Daily Navigation",
      words: [
        { word: "nearest", translation: "gần nhất", hint: "adjective" },
        { word: "coffee shop", translation: "quán cà phê", hint: "noun phrase" },
        { word: "excuse me", translation: "xin lỗi", hint: "polite expression" }
      ]
    },
    {
      native: nativeLanguage.toLowerCase().includes("viet")
        ? "Dự án này đòi hỏi sự kiên trì và làm việc nhóm hiệu quả."
        : "This project requires perseverance and effective teamwork.",
      ideal: "This project requires perseverance and effective teamwork.",
      topic: "Career & Project Management",
      words: [
        { word: "perseverance", translation: "sự kiên trì", hint: "noun" },
        { word: "effective", translation: "hiệu quả", hint: "adjective" },
        { word: "teamwork", translation: "làm việc nhóm", hint: "noun" }
      ]
    },
    {
      native: nativeLanguage.toLowerCase().includes("viet")
        ? "Họ quyết định hoãn chuyến đi vì thời tiết xấu ngoài dự kiến."
        : "They decided to postpone the trip due to unexpected bad weather.",
      ideal: "They decided to postpone the trip due to unexpected bad weather.",
      topic: "Travel & Scheduling",
      words: [
        { word: "postpone", translation: "hoãn", hint: "verb" },
        { word: "unexpected", translation: "ngoài dự kiến", hint: "adjective" },
        { word: "weather", translation: "thời tiết", hint: "noun" }
      ]
    }
  ];

  // Pick candidate matching interest if possible
  const chosen = fallbackBank[Math.floor(Math.random() * fallbackBank.length)];

  return {
    id: `challenge-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    nativeSentence: chosen.native,
    targetLanguage,
    nativeLanguage,
    topicContext: chosen.topic,
    idealTranslation: chosen.ideal,
    keyTargetWords: chosen.words,
    personalityNote: `Tailored for ${archetype} focusing on ${chosen.topic}.`,
    createdAt: new Date().toISOString()
  };
}

/**
 * Generate a new personalized translation challenge via backend API
 */
export async function generateChallenge(params: GenerateChallengeParams): Promise<ChallengeData> {
  const res = await fetch("/api/generate-challenge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params)
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data?.error || `Failed to generate translation challenge (Status ${res.status})`);
  }

  if (data && data.nativeSentence) {
    return {
      id: `challenge-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      nativeSentence: data.nativeSentence,
      targetLanguage: params.targetLanguage || "English",
      nativeLanguage: params.nativeLanguage || "Vietnamese",
      topicContext: data.topicContext || "Personalized Practice",
      idealTranslation: data.idealTranslation,
      keyTargetWords: data.keyTargetWords || [],
      personalityNote: data.personalityNote,
      createdAt: new Date().toISOString(),
      provider: data.provider,
      model: data.model,
      responseTimeMs: data.responseTimeMs,
    };
  }

  throw new Error("Received invalid payload structure from AI model for translation challenge.");
}

/**
 * Process a turn in the interactive challenge (assistance vs submission evaluation)
 */
export async function processChallengeTurn(params: ChallengeTurnParams): Promise<ChallengeTurnResult> {
  const res = await fetch("/api/challenge-turn", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params)
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data?.error || `Failed to evaluate challenge response (Status ${res.status})`);
  }

  if (data && data.intent) {
    return data as ChallengeTurnResult;
  }

  throw new Error("Received invalid challenge turn response from AI model.");
}
