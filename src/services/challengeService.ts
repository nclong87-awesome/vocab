import { ChallengeData, ChallengeTurnResult, ChallengeSuggestedVocab, UserPersonalityProfile, Word, LLMConfig } from "../types";
import { fetchWithTimeout, safeParseResponseJson, isStaticHost } from "../utils";
import { callLLMClientSideWithMeta, cleanJsonResponse, getOverrideConfig } from "./llmClientService";
import { sortWordsByLastPracticeTime } from "../utils/spacedRepetition";
import { findWordInCollection, hasUserIncorporatedWord } from "../utils/wordNormalization";

export interface GenerateChallengeParams {
  nativeLanguage?: string;
  targetLanguage?: string;
  personalityProfile?: UserPersonalityProfile | null;
  words?: Word[];
  recentSentences?: string[];
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

function buildChallengePrompt(params: GenerateChallengeParams, randomSeed: string): {
  prompt: string;
  candidateCollectionWords: Word[];
} {
  const nativeLanguage = params.nativeLanguage || "Vietnamese";
  const targetLanguage = params.targetLanguage || "English";
  const profile = params.personalityProfile;
  const archetype = profile?.archetype || "Practical Learner";
  const interests = (profile?.detectedInterests || ["Daily Life", "Workplace", "Casual Discussion"]).join(", ");
  const traits = (profile?.archetypeTraits || ["Practical", "Conversational"]).join(", ");
  const modality = profile?.learningPreferences?.primaryModality || "contextual_examples";

  // Grounding in user vocabulary words: endeavor to select the single most suitable word from collection
  let vocabAnchorSection = "";
  let candidateCollectionWords: Word[] = [];
  if (params.words && params.words.length > 0) {
    const validWords = params.words.filter((w) => w.completed !== false);
    const sortedCandidates = sortWordsByLastPracticeTime(validWords);
    candidateCollectionWords = sortedCandidates.slice(0, 8);
    if (candidateCollectionWords.length > 0) {
      vocabAnchorSection = `
USER'S WORDS COLLECTION CANDIDATES (FROM DATABASE):
${candidateCollectionWords.map((w) => `- "${w.word}" (${w.translation || w.definition || "target term"}) [Strength: ${w.strength ?? 0}%]`).join("\n")}

WORDS COLLECTION TARGET IDENTIFICATION MANDATE:
- Carefully evaluate the candidate words from the user's database above.
- Select the SINGLE MOST SUITABLE word that fits naturally in everyday spoken conversation or daily workplace chat.
- Construct a natural, commonly used sentence whose ideal translation incorporates this selected word.
- CRITICAL LANGUAGE PURITY MANDATE: The "nativeSentence" MUST be 100% written in the learner's NATIVE language (${nativeLanguage}).
  NEVER include untranslated words in the target language (${targetLanguage}) directly inside "nativeSentence".
  Instead, express the concept/meaning purely in natural ${nativeLanguage}, and use the actual target vocabulary term only in "idealTranslation" (${targetLanguage}).
- Explicitly output this word in the "targetWordFromCollection" field so that when the user incorporates this word in their translation response, its strength is boosted by 30 points.`;
    }
  }

  // Avoid recently generated sentences
  let recentAvoidanceSection = "";
  if (params.recentSentences && params.recentSentences.length > 0) {
    const recentList = params.recentSentences.slice(0, 8).map((s) => `- "${s}"`).join("\n");
    recentAvoidanceSection = `
PREVIOUSLY GENERATED SENTENCES TO AVOID (DO NOT DUPLICATE OR RESEMBLE THESE):
${recentList}
`;
  }

  const prompt = `Generate a single personalized translation challenge for a language learner based on common sentences used in daily conversation and real-life interactions.

DIVERSITY SEED: ${randomSeed}

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
1. COMMON DAILY CONVERSATION FOCUS: Create a practical, authentic sentence commonly spoken in everyday life, daily workplace chats, social interactions, errands, dining, commuting, or casual discussion. Avoid overly formal or contrived jargon unless naturally fitting the learner's vocabulary.
2. DYNAMIC TOPIC CATEGORY: Dynamically determine a relevant, concise 2-4 word topic label (e.g. "Everyday Routine", "Ordering at a Cafe", "Coffee Break Chat", "Team Sync", "Weekend Plans", "Travel & Commuting", "Tech Discussion") that accurately describes the context of the sentence, and return it in "topicContext".
3. CONCISE SENTENCE STRUCTURE: Aim for a concise, compact, and punchy sentence structure (strictly 6 to 14 words). Avoid verbose rambling or convoluted multi-clause sentences. Keep the phrasing natural, modern, clear, and direct.
4. ZERO TARGET-LANGUAGE LOANWORDS IN NATIVE SENTENCE: Create the concise sentence (6-14 words) entirely in the user's NATIVE language (${nativeLanguage}). The 'nativeSentence' MUST NOT contain any ${targetLanguage} words, English loanwords, or untranslated target terms. Express every concept strictly in natural ${nativeLanguage}.
5. NATURAL IDIOMATIC PHRASING: Ensure the sentence sounds completely natural, authentic, and idiomatic for real-life conversational speech in ${nativeLanguage}.
6. IDEAL POLISHED TRANSLATION: Provide the ideal, concise, and polished natural translation in ${targetLanguage}. The target vocabulary word MUST appear in this 'idealTranslation'.
7. FEATURE VOCABULARY: Endeavor to feature the chosen word from the user's database and output it in "targetWordFromCollection".
8. VOCABULARY HINTS: List 2-3 key target vocabulary words contained in the sentence with their native translation and hint.
9. PROFILE NOTE: Provide a short note (personalityNote) explaining why this specific scenario and vocabulary were selected.

Return STRICTLY raw JSON-only matching this schema:
{
  "nativeSentence": "Concise sentence in ${nativeLanguage} (6-14 words, ZERO ${targetLanguage} words)",
  "idealTranslation": "Concise ideal translation in ${targetLanguage}",
  "topicContext": "Concise 2-4 word topic category dynamically created by AI",
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

  return { prompt, candidateCollectionWords };
}

/**
 * Resolves the identified target word from the collection against the user's words array.
 */
function resolveTargetWordFromCollection(
  parsed: any,
  words?: Word[],
  candidateWords: Word[] = []
): ChallengeData["targetWordFromCollection"] {
  if (!words || words.length === 0) return undefined;

  const rawWord = parsed.targetWordFromCollection?.word ||
    (typeof parsed.targetWordFromCollection === "string" ? parsed.targetWordFromCollection : undefined) ||
    parsed.targetWord?.word ||
    parsed.featuredWord?.word;

  let matched: Word | undefined = rawWord ? findWordInCollection(words, rawWord) : undefined;

  // If not directly matched, check keyTargetWords against collection
  if (!matched && Array.isArray(parsed.keyTargetWords)) {
    for (const kw of parsed.keyTargetWords) {
      if (kw?.word) {
        const found = findWordInCollection(words, kw.word);
        if (found) {
          matched = found;
          break;
        }
      }
    }
  }

  // If still not matched, check candidate collection words against ideal translation
  if (!matched && candidateWords.length > 0 && parsed.idealTranslation) {
    for (const cand of candidateWords) {
      if (hasUserIncorporatedWord(parsed.idealTranslation, cand.word)) {
        matched = cand;
        break;
      }
    }
  }

  // Final check: check any word in words collection against ideal translation
  if (!matched && parsed.idealTranslation) {
    const validWords = words.filter((w) => w.completed !== false);
    for (const w of validWords.slice(0, 15)) {
      if (hasUserIncorporatedWord(parsed.idealTranslation, w.word)) {
        matched = w;
        break;
      }
    }
  }

  if (matched) {
    return {
      id: matched.id,
      word: matched.word,
      translation: matched.translation || parsed.targetWordFromCollection?.translation,
      definition: matched.definition,
      hint: parsed.targetWordFromCollection?.hint || matched.translation,
      strength: matched.strength ?? 0,
    };
  }

  return undefined;
}

/**
 * Sanitizes the native sentence to ensure target words (in targetLanguage, e.g. English)
 * are not accidentally left untranslated as loanwords in the native sentence (e.g. Vietnamese).
 */
export function sanitizeNativeSentence(
  nativeSentence: string,
  targetWord?: { word: string; translation?: string },
  keyTargetWords?: Array<{ word: string; translation?: string }>
): string {
  if (!nativeSentence || typeof nativeSentence !== "string") return nativeSentence;
  let result = nativeSentence;

  const pairsToReplace: Array<{ word: string; translation: string }> = [];

  if (targetWord?.word && targetWord?.translation) {
    pairsToReplace.push({ word: targetWord.word.trim(), translation: targetWord.translation.trim() });
  }

  if (Array.isArray(keyTargetWords)) {
    for (const kw of keyTargetWords) {
      if (kw?.word && kw?.translation) {
        pairsToReplace.push({ word: kw.word.trim(), translation: kw.translation.trim() });
      }
    }
  }

  for (const { word, translation } of pairsToReplace) {
    if (!word || !translation || word.toLowerCase() === translation.toLowerCase()) continue;
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`\\b${escaped}\\b`, "gi");
    if (regex.test(result)) {
      result = result.replace(regex, (matched) => {
        if (matched[0] === matched[0].toUpperCase() && matched[0] !== matched[0].toLowerCase()) {
          return translation.charAt(0).toUpperCase() + translation.slice(1);
        }
        return translation.toLowerCase();
      });
    }
  }

  return result;
}

/**
 * Client-side LLM call using Cloudflare Workers / direct provider for translation challenge generation
 */
async function generateChallengeClientSide(params: GenerateChallengeParams, randomSeed: string): Promise<ChallengeData> {
  const effectiveConfig = getOverrideConfig(params.llmConfig);
  const nativeLanguage = params.nativeLanguage || "Vietnamese";
  const targetLanguage = params.targetLanguage || "English";
  const { prompt, candidateCollectionWords } = buildChallengePrompt(params, randomSeed);

  const systemInstruction = `You are a personalized AI Language Coach creating concise, diverse, real-world translation challenges tailored to learner profiles. Always output strictly raw valid JSON without markdown formatting. MANDATORY: The 'nativeSentence' MUST be 100% in ${nativeLanguage} with ZERO ${targetLanguage} loanwords or untranslated target terms, concise (6-14 words), and its idealTranslation must incorporate the target word.`;
  const schemaDescription = `JSON object with nativeSentence, idealTranslation, topicContext, targetWordFromCollection object, keyTargetWords array, and personalityNote string.`;

  const startTime = performance.now();
  const resWithMeta = await callLLMClientSideWithMeta(prompt, systemInstruction, schemaDescription, effectiveConfig);
  const cleaned = cleanJsonResponse(resWithMeta.text);
  const parsed = JSON.parse(cleaned);

  if (!parsed || !parsed.nativeSentence || !parsed.idealTranslation) {
    throw new Error("Invalid payload structure returned from AI model for translation challenge");
  }

  const duration = resWithMeta.responseTimeMs || Math.round(performance.now() - startTime);
  const targetWordFromCollection = resolveTargetWordFromCollection(parsed, params.words, candidateCollectionWords);

  const sanitizedSentence = sanitizeNativeSentence(
    parsed.nativeSentence,
    targetWordFromCollection || parsed.targetWordFromCollection,
    parsed.keyTargetWords
  );

  return {
    id: `challenge-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    nativeSentence: sanitizedSentence,
    targetLanguage,
    nativeLanguage,
    topicContext: parsed.topicContext || "Daily Conversation",
    idealTranslation: parsed.idealTranslation,
    targetWordFromCollection,
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
  const effectiveConfig = getOverrideConfig(params.llmConfig);
  const effectiveParams = { ...params, llmConfig: effectiveConfig };

  // 1. Static host environment (e.g. GitHub Pages): use Cloudflare Worker / client-side LLM directly
  if (isStaticHost()) {
    return generateChallengeClientSide(effectiveParams, randomSeed);
  }

  // 2. Full-stack host environment: try Express backend with automatic fallback to Cloudflare Worker LLM
  try {
    const res = await fetchWithTimeout("/api/generate-challenge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(effectiveParams)
    });

    const data = await safeParseResponseJson(res);

    if (res.ok && data && data.nativeSentence) {
      let targetWord = data.targetWordFromCollection;
      if (!targetWord && effectiveParams.words && effectiveParams.words.length > 0) {
        targetWord = resolveTargetWordFromCollection(data, effectiveParams.words);
      }

      const sanitizedSentence = sanitizeNativeSentence(
        data.nativeSentence,
        targetWord || data.targetWordFromCollection,
        data.keyTargetWords
      );

      return {
        id: `challenge-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        nativeSentence: sanitizedSentence,
        targetLanguage: effectiveParams.targetLanguage || "English",
        nativeLanguage: effectiveParams.nativeLanguage || "Vietnamese",
        topicContext: data.topicContext || "Personalized Practice",
        idealTranslation: data.idealTranslation,
        targetWordFromCollection: targetWord,
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
    return generateChallengeClientSide(effectiveParams, randomSeed);
  }
}

/**
 * Checks whether user message is an empty submission / give-up attempt
 */
export function isEmptySubmissionMessage(msg?: string): boolean {
  if (!msg || !msg.trim()) return true;
  const lower = msg.trim().toLowerCase();
  return (
    lower === "(no answer provided)" ||
    lower === "(submit empty answer)" ||
    lower === "submit empty answer" ||
    lower === "submit empty" ||
    lower.includes("submit empty") ||
    lower === "skip" ||
    lower === "give up" ||
    lower === "reveal answer" ||
    lower === "bỏ qua" ||
    lower === "xem đáp án"
  );
}

/**
 * Creates a complete evaluation for an empty submission showing ideal translation and target word
 */
export function createEmptySubmissionEvaluation(params: ChallengeTurnParams): ChallengeTurnResult {
  const { challenge } = params;
  const targetCol = challenge.targetWordFromCollection;
  const targetWord = targetCol?.word || (challenge.keyTargetWords?.[0]?.word || "");

  const suggestedVocabulary: ChallengeSuggestedVocab[] = [];
  if (targetCol) {
    suggestedVocabulary.push({
      word: targetCol.word,
      translation: targetCol.translation || "",
      definition: targetCol.definition || "",
      hint: targetCol.hint || "Featured target word from collection",
      partOfSpeech: "target word",
      askedByUser: false,
    });
  }
  if (Array.isArray(challenge.keyTargetWords)) {
    for (const kw of challenge.keyTargetWords) {
      if (kw?.word && (!targetCol || kw.word.toLowerCase() !== targetCol.word.toLowerCase())) {
        suggestedVocabulary.push({
          word: kw.word,
          translation: kw.translation || "",
          definition: "",
          hint: kw.hint || "Key vocabulary from challenge",
          partOfSpeech: kw.hint || "",
          askedByUser: false,
        });
      }
    }
  }

  return {
    intent: "submission",
    evaluation: {
      score: 0,
      scoreLabel: "Review & Learn! 💡",
      userTranslation: "(No answer provided)",
      incorporatedTargetWord: false,
      targetWordUsed: targetWord,
      whatWentWell: "You took this opportunity to review the sentence structure and learn the target vocabulary.",
      areasForImprovement: `Study the ideal translation: "${challenge.idealTranslation}" and practice incorporating the target word "${targetWord}" into future sentences.`,
      correctedSentence: challenge.idealTranslation,
      suggestedVocabulary,
    },
    provider: "local",
    model: "instant-evaluation",
    responseTimeMs: 50,
  };
}

/**
 * Client-side LLM call using Cloudflare Workers / direct provider for evaluating challenge turn
 */
async function processChallengeTurnClientSide(params: ChallengeTurnParams): Promise<ChallengeTurnResult> {
  const { challenge, userMessage, chatHistory = [], nativeLanguage = "Vietnamese", targetLanguage = "English", llmConfig } = params;

  if (isEmptySubmissionMessage(userMessage)) {
    return createEmptySubmissionEvaluation(params);
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

  const startTime = performance.now();
  const resWithMeta = await callLLMClientSideWithMeta(prompt, systemInstruction, schemaDescription, llmConfig);
  const cleaned = cleanJsonResponse(resWithMeta.text);
  const parsed = JSON.parse(cleaned);

  if (!parsed || !parsed.intent) {
    throw new Error("Invalid challenge turn structure returned from AI model.");
  }

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
        const targetWord = params.challenge.targetWordFromCollection?.word;
        if (targetWord) {
          const incorporated = data.evaluation.incorporatedTargetWord === true ||
            hasUserIncorporatedWord(data.evaluation.userTranslation, targetWord) ||
            hasUserIncorporatedWord(params.userMessage, targetWord);
          data.evaluation.incorporatedTargetWord = incorporated;
          data.evaluation.targetWordUsed = targetWord;
        }
      }
      return data as ChallengeTurnResult;
    }
    throw new Error(data?.error || `Server returned status ${res.status}`);
  } catch (err: any) {
    console.warn("Backend /api/challenge-turn endpoint unavailable, falling back to Cloudflare Worker / client-side LLM:", err);
    return processChallengeTurnClientSide(params);
  }
}

