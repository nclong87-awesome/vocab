import { ChallengeData, ChallengeTurnResult, UserPersonalityProfile, Word, LLMConfig } from "../types";
import { fetchWithTimeout, safeParseResponseJson, isStaticHost } from "../utils";
import { callLLMClientSideWithMeta, cleanJsonResponse } from "./llmClientService";

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
 * Client-side LLM call using Cloudflare Workers / direct provider for translation challenge generation
 */
async function generateChallengeClientSide(params: GenerateChallengeParams, randomSeed: string): Promise<ChallengeData> {
  const nativeLanguage = params.nativeLanguage || "Vietnamese";
  const targetLanguage = params.targetLanguage || "English";
  const profile = params.personalityProfile;
  const archetype = profile?.archetype || "Pragmatic Professional";
  const interests = (profile?.detectedInterests || ["Workplace", "Daily Life", "Travel"]).join(", ");
  const traits = (profile?.archetypeTraits || ["Practical", "Goal-oriented"]).join(", ");
  const modality = profile?.learningPreferences?.primaryModality || "contextual_examples";

  const prompt = `Generate a single personalized translation challenge for a language learner.

RANDOM DIVERSITY SEED (MUST INFLUENCE CREATIVITY & SCENARIO): ${randomSeed}

LEARNER CONTEXT:
- Native Language: ${nativeLanguage}
- Target Language: ${targetLanguage}
- Learner Archetype: ${archetype}
- Learner Traits: ${traits}
- Topics/Interests: ${interests}
- Primary Learning Modality: ${modality}

INSTRUCTIONS:
1. Create a fresh, creative, and realistic sentence (10-22 words) in the user's NATIVE language (${nativeLanguage}) that they must translate into their TARGET language (${targetLanguage}).
2. HIGH DIVERSITY MANDATE: Make this sentence completely distinct, novel, and creative. Choose a specific scenario (e.g. project management, creative problem solving, casual social interaction, travel logistics, personal development, technology trend, or daily discussion).
3. Provide the ideal, polished, natural translation in ${targetLanguage}.
4. List 2-3 key target vocabulary words contained in the sentence with their native translation and hint.
5. Provide a short note (personalityNote) explaining why this sentence was selected for their profile.

Return STRICTLY raw JSON-only matching this schema:
{
  "nativeSentence": "Sentence in ${nativeLanguage}",
  "idealTranslation": "Ideal translation in ${targetLanguage}",
  "topicContext": "Topic label",
  "keyTargetWords": [
    { "word": "word_in_target", "translation": "translation_in_native", "hint": "part of speech or context" }
  ],
  "personalityNote": "Explanation of profile alignment"
}`;

  const systemInstruction = `You are a personalized AI Language Coach creating translation challenges tailored to learner personality profiles. Always output strictly raw valid JSON without markdown formatting.`;
  const schemaDescription = `JSON object with nativeSentence, idealTranslation, topicContext, keyTargetWords array, and personalityNote string.`;

  const startTime = performance.now();
  const resWithMeta = await callLLMClientSideWithMeta(prompt, systemInstruction, schemaDescription, params.llmConfig);
  const cleaned = cleanJsonResponse(resWithMeta.text);
  const parsed = JSON.parse(cleaned);

  if (!parsed || !parsed.nativeSentence || !parsed.idealTranslation) {
    throw new Error("Invalid payload structure returned from AI model for translation challenge");
  }

  const duration = resWithMeta.responseTimeMs || Math.round(performance.now() - startTime);

  return {
    id: `challenge-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    nativeSentence: parsed.nativeSentence,
    targetLanguage,
    nativeLanguage,
    topicContext: parsed.topicContext || "Personalized Practice",
    idealTranslation: parsed.idealTranslation,
    keyTargetWords: parsed.keyTargetWords || [],
    personalityNote: parsed.personalityNote,
    createdAt: new Date().toISOString(),
    provider: resWithMeta.provider,
    model: resWithMeta.model,
    responseTimeMs: duration,
  };
}

/**
 * Generate a new personalized translation challenge via backend API or Cloudflare Worker LLM
 */
export async function generateChallenge(params: GenerateChallengeParams): Promise<ChallengeData> {
  const randomSeed = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

  // 1. Static host environment (e.g. GitHub Pages): use Cloudflare Worker / client-side LLM directly
  if (isStaticHost()) {
    return generateChallengeClientSide(params, randomSeed);
  }

  // 2. Full-stack host environment: try Express backend with automatic fallback to Cloudflare Worker LLM
  try {
    const res = await fetchWithTimeout("/api/generate-challenge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params)
    });

    const data = await safeParseResponseJson(res);

    if (res.ok && data && data.nativeSentence) {
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
    throw new Error(data?.error || `Server returned status ${res.status}`);
  } catch (err: any) {
    console.warn("Backend /api/generate-challenge endpoint unavailable, falling back to Cloudflare Worker / client-side LLM:", err);
    return generateChallengeClientSide(params, randomSeed);
  }
}

/**
 * Client-side LLM call using Cloudflare Workers / direct provider for evaluating challenge turn
 */
async function processChallengeTurnClientSide(params: ChallengeTurnParams): Promise<ChallengeTurnResult> {
  const { challenge, userMessage, chatHistory = [], nativeLanguage = "Vietnamese", targetLanguage = "English", llmConfig } = params;

  const nativeSentence = challenge.nativeSentence;
  const idealTranslation = challenge.idealTranslation;
  const keyTargetWords = JSON.stringify(challenge.keyTargetWords || []);

  const formattedHistory = chatHistory.map((m: any) => `${m.sender.toUpperCase()}: ${m.text}`).join("\n");

  const prompt = `Evaluate or assist a language learner during a Translation Challenge.

CHALLENGE DETAILS:
- Native Sentence (${nativeLanguage}): "${nativeSentence}"
- Ideal Target Translation (${targetLanguage}): "${idealTranslation}"
- Key Target Words: ${keyTargetWords}
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
- List "whatWentWell": specific praise for correct grammar, vocabulary, or phrasing.
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

  const systemInstruction = `You are an AI Language Evaluation Coach. Classify intent as assistance or submission and return strict JSON output.`;
  const schemaDescription = `JSON object with intent ("assistance" | "submission"), agentReply, askedWord, and evaluation object (including userTranslation) if submission.`;

  const startTime = performance.now();
  const resWithMeta = await callLLMClientSideWithMeta(prompt, systemInstruction, schemaDescription, llmConfig);
  const cleaned = cleanJsonResponse(resWithMeta.text);
  const parsed = JSON.parse(cleaned);

  if (!parsed || !parsed.intent) {
    throw new Error("Invalid challenge turn structure returned from AI model.");
  }

  if (parsed.evaluation) {
    parsed.evaluation.userTranslation = parsed.evaluation.userTranslation?.trim() || userMessage.trim();
  }

  const duration = resWithMeta.responseTimeMs || Math.round(performance.now() - startTime);

  return {
    ...parsed,
    provider: resWithMeta.provider,
    model: resWithMeta.model,
    responseTimeMs: duration,
  } as ChallengeTurnResult;
}

/**
 * Process a turn in the interactive challenge via backend API or Cloudflare Worker LLM
 */
export async function processChallengeTurn(params: ChallengeTurnParams): Promise<ChallengeTurnResult> {
  // 1. Static host environment (e.g. GitHub Pages): use Cloudflare Worker / client-side LLM directly
  if (isStaticHost()) {
    return processChallengeTurnClientSide(params);
  }

  // 2. Full-stack host environment: try Express backend with automatic fallback to Cloudflare Worker LLM
  try {
    const res = await fetchWithTimeout("/api/challenge-turn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params)
    });

    const data = await safeParseResponseJson(res);

    if (res.ok && data && data.intent) {
      if (data.evaluation) {
        data.evaluation.userTranslation = data.evaluation.userTranslation?.trim() || params.userMessage.trim();
      }
      return data as ChallengeTurnResult;
    }
    throw new Error(data?.error || `Server returned status ${res.status}`);
  } catch (err: any) {
    console.warn("Backend /api/challenge-turn endpoint unavailable, falling back to Cloudflare Worker / client-side LLM:", err);
    return processChallengeTurnClientSide(params);
  }
}
