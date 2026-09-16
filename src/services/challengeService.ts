import { ChallengeData, ChallengeKeyWord, ChallengeTurnResult, ChallengeSuggestedVocab, UserPersonalityProfile, Word, LLMConfig } from "../types";
import { fetchWithTimeout, safeParseResponseJson, isStaticHost } from "../utils";
import { callLLMClientSideWithMeta, cleanJsonResponse, getOverrideConfig } from "./llmClientService";
import { getQuizCandidateWords } from "../utils/spacedRepetition";
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
  const rawInterests = profile?.detectedInterests && profile.detectedInterests.length > 0
    ? profile.detectedInterests
    : ["Daily Life & Routines", "Travel & Transit", "Food & Dining", "Casual Social Chats", "Hobbies & Entertainment", "Practical Living"];
  const interests = rawInterests.join(", ");
  const traits = (profile?.archetypeTraits || ["Practical", "Conversational"]).join(", ");
  const modality = profile?.learningPreferences?.primaryModality || "contextual_examples";

  // Diverse domain inspirations for rotating vibrant real-life scenarios
  const DIVERSE_DOMAINS = [
    "Casual Social & Friendship (coffee chats, catching up with friends, weekend plans, sharing humorous stories, casual banter)",
    "Food, Dining & Culinary (ordering at restaurants, street food exploration, tasting new recipes, coffee breaks, market shopping)",
    "Travel, Transit & Exploration (airport journeys, train stations, asking for directions, hotel check-ins, exploring vibrant city streets)",
    "Daily Life, Home & Errands (neighborhood strolls, grocery shopping, morning routines, home improvement, pet care, weather reactions)",
    "Culture, Entertainment & Hobbies (movies, music events, sports, fitness routines, gaming, books, cultural festivals)",
    "Personal Lifestyle & Friendly Opinions (sharing thoughts on daily habits, lighthearted advice, casual debates, lifestyle choices)"
  ];
  const suggestedDomain = DIVERSE_DOMAINS[Math.floor(Math.random() * DIVERSE_DOMAINS.length)];

  // Grounding in user vocabulary words: endeavor to select the single most suitable word from collection
  let vocabAnchorSection = "";
  let candidateCollectionWords: Word[] = [];
  if (params.words && params.words.length > 0) {
    const validWords = params.words.filter((w) => w.completed !== false);
    candidateCollectionWords = getQuizCandidateWords(validWords, {
      maxCandidates: 18,
      includeUnstudied: true,
      balanceStratified: true,
    });
    if (candidateCollectionWords.length > 0) {
      vocabAnchorSection = `
USER'S WORDS COLLECTION CANDIDATES (FROM DATABASE):
${candidateCollectionWords.map((w) => `- "${w.word}" (${w.translation || w.definition || "target term"}) [Strength: ${w.strength ?? 0}%]`).join("\n")}

WORDS COLLECTION TARGET IDENTIFICATION MANDATE:
- Carefully evaluate the candidate words from the user's database above.
- Select the SINGLE MOST SUITABLE word that fits naturally in everyday spoken conversation, social chats, travel, dining, or practical real-world life as the primary target word.
- Construct a natural, commonly used sentence whose ideal translation incorporates this selected word.
- TARGET WORD PRESENCE IN NATIVE SENTENCE MANDATE: The "nativeSentence" MUST explicitly, clearly, and unmistakably contain the exact native translation/meaning of the selected target word (e.g. if target word is "set off" with native translation "khởi hành, lên đường", "nativeSentence" MUST explicitly contain "khởi hành" or "lên đường"). The learner MUST be prompted to use the target word by encountering its direct native meaning in "nativeSentence"! NEVER omit or drop the native meaning of the target word.
- CRITICAL LANGUAGE PURITY MANDATE: The "nativeSentence" MUST be 100% written in the learner's NATIVE language (${nativeLanguage}).
  NEVER include untranslated words in the target language (${targetLanguage}) directly inside "nativeSentence".
  Instead, express the concept/meaning purely in natural ${nativeLanguage}, and use the actual target vocabulary term only in "idealTranslation" (${targetLanguage}).
- Explicitly output this word in the "targetWordFromCollection" field so that when the user incorporates this word in their translation response, its strength is boosted by 30 points.
- COLLECTION VOCAB SYNERGY: If other words from the candidate collection list above fit as natural vocabulary or alternative translations in this sentence, prioritize including them in "keyTargetWords"!`;
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
SUGGESTED SCENARIO DOMAIN: ${suggestedDomain}
(Feel free to explore this domain or any other dynamic everyday scenario. Actively avoid defaulting to corporate meetings, business emails, or office tasks.)

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
1. BROAD REAL-WORLD SITUATIONAL DIVERSITY (ANTI-WORKPLACE-BIAS MANDATE):
   - Actively vary scenarios across the rich spectrum of real-life human experiences:
     * Casual Social & Friendship: Meeting friends, coffee chats, weekend plans, humorous remarks, neighborhood gossip.
     * Food, Dining & Cafes: Ordering food, culinary preferences, street food, cooking together, cafe interactions.
     * Travel, Transit & Exploration: Flights, road trips, hotels, navigating unfamiliar transit, discovering local spots.
     * Daily Life, Home & Errands: Morning routines, home repairs, shopping, appointments, fitness, weather reactions.
     * Leisure, Culture & Hobbies: Watching movies, listening to music, sports, outdoor adventures, gaming, reading.
   - DO NOT OVER-INDEX ON OFFICE/WORKPLACE SCENARIOS: Avoid defaulting to corporate offices, staff downsizing, technical system backups, team syncs, boardroom meetings, or formal business correspondence. Even if the learner profile indicates a pragmatic or career-focused style, real fluency requires engaging across all human social and lifestyle contexts. Real-life professionals also eat, travel, shop, relax, and socialize. Strictly reserve workplace contexts for when a chosen vocabulary word specifically and exclusively demands it.
2. DYNAMIC TOPIC CATEGORY: Dynamically determine a vivid, specific 2-4 word topic label (e.g. "Coffee Shop Catch-up", "Street Food Discovery", "Weekend Getaway", "Airport Navigation", "Grocery Run", "Home Cooking", "Fitness Routine", "Movie Night", "Neighborhood Walk", "Casual Banter", "Outdoor Adventure") that accurately describes the context of the sentence, and return it in "topicContext".
3. CONCISE SENTENCE STRUCTURE: Aim for a concise, compact, and punchy sentence structure (strictly 6 to 14 words). Avoid verbose rambling or convoluted multi-clause sentences. Keep the phrasing natural, modern, clear, and direct.
4. ZERO TARGET-LANGUAGE LOANWORDS IN NATIVE SENTENCE: Create the concise sentence (6-14 words) entirely in the user's NATIVE language (${nativeLanguage}). The 'nativeSentence' MUST NOT contain any ${targetLanguage} words, English loanwords, or untranslated target terms. Express every concept strictly in natural ${nativeLanguage}.
5. NATURAL IDIOMATIC PHRASING: Ensure the sentence sounds completely natural, authentic, and idiomatic for real-life conversational speech in ${nativeLanguage}.
6. IDEAL POLISHED TRANSLATION: Provide the ideal, concise, and polished natural translation in ${targetLanguage}. The target vocabulary word MUST appear in this 'idealTranslation'.
7. FEATURE VOCABULARY: Endeavor to feature the chosen word from the user's database and output it in "targetWordFromCollection".
8. WIDE VARIETY OF VOCABULARY CLUES & SYNONYMS (5-8 CLUES):
   - Provide a rich, diverse list of 5 to 8 vocabulary clues in "keyTargetWords" covering the key actions, entities, modifiers, and expressions from the sentence.
   - Crucially include natural synonyms and alternative valid translations for the key concepts (e.g. if the sentence has "chờ đợi", provide both "await" and "wait for"; if "phản hồi", provide both "feedback" and "response"; if "khách hàng", provide both "client" and "customer"; if "hợp đồng", provide both "contract" and "agreement").
   - Prefer words and synonyms that match candidate words from the user's collection whenever appropriate.
   - This empowers learners to write multiple correct, idiomatic translations of the sentence while dramatically increasing the likelihood that words they use already exist in their collection (earning them memory strength boosts).
   - Ensure the primary featured target word is included in this list.
9. PROFILE NOTE: Provide a short note (personalityNote) explaining why this specific scenario and vocabulary were selected. For pragmatic or goal-oriented learners, emphasize how this vocabulary supports versatile, effective communication across real-life daily, travel, dining, and social settings rather than repetitive office work.
10. TARGET WORD PRESENCE IN NATIVE SENTENCE: The chosen target word's native translation/meaning MUST appear explicitly in 'nativeSentence' so that the learner is directly prompted to translate it into the target word. For example, if target word is "set off" ("khởi hành, lên đường"), 'nativeSentence' MUST contain "khởi hành" or "lên đường".
11. STRICT 1-TO-1 BIDIRECTIONAL SEMANTIC EQUIVALENCE: 'nativeSentence' and 'idealTranslation' MUST be exact 1-to-1 semantic translations of each other. Every single clause, action, or verb phrase in 'idealTranslation' MUST correspond directly to a clause in 'nativeSentence', and vice versa. NEVER drop clauses (e.g. keeping "settle" while dropping "set off"), NEVER invent extra actions in 'idealTranslation' not present in 'nativeSentence', and NEVER confuse false-friend verbs (e.g. confusing "set off" or "settle" with "set up / thiết lập").

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
    { "word": "word_or_synonym_in_target", "translation": "translation_in_native", "hint": "synonym or part of speech" }
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
 * Enriches and deduplicates key target words (vocab clues):
 * - Guarantees the primary featured target word from the collection is included as the top clue.
 * - Adds all AI-generated clues (synonyms and alternate valid translations).
 * - Scans user's words collection for any words appearing in the idealTranslation or candidate collection words and appends them.
 */
export function enrichKeyTargetWords(
  rawKeyWords: any[],
  targetWord?: ChallengeData["targetWordFromCollection"],
  words?: Word[],
  idealTranslation?: string,
  candidateWords: Word[] = []
): ChallengeKeyWord[] {
  const result: ChallengeKeyWord[] = [];
  const seen = new Set<string>();

  const addClue = (word: string, translation: string, hint?: string) => {
    const trimmed = (word || "").trim();
    if (!trimmed) return;
    const lower = trimmed.toLowerCase();
    if (seen.has(lower)) return;
    seen.add(lower);
    result.push({
      word: trimmed,
      translation: (translation || "").trim(),
      hint: hint?.trim() || undefined,
    });
  };

  // 1. Featured target word always prioritized first if available
  if (targetWord?.word) {
    addClue(targetWord.word, targetWord.translation || targetWord.definition || "", targetWord.hint || "Featured target word");
  }

  // 2. Add AI-generated clues (rich variety with synonyms and alternative translations)
  if (Array.isArray(rawKeyWords)) {
    for (const kw of rawKeyWords) {
      if (kw?.word) {
        addClue(kw.word, kw.translation || "", kw.hint);
      }
    }
  }

  // 3. Check candidate collection words and entire collection to see if any match words in the ideal translation
  const pool = candidateWords.length > 0 ? candidateWords : (words || []);
  if (pool.length > 0 && idealTranslation) {
    for (const w of pool) {
      if (w?.word && hasUserIncorporatedWord(idealTranslation, w.word)) {
        addClue(w.word, w.translation || w.definition || "", "From your collection");
      }
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

  const systemInstruction = `You are a personalized AI Language Coach creating concise, diverse, real-world translation challenges across vibrant daily life, travel, dining, leisure, social, and cultural contexts. Always output strictly raw valid JSON without markdown formatting. MANDATORY: The 'nativeSentence' MUST be 100% in ${nativeLanguage} with ZERO ${targetLanguage} loanwords or untranslated target terms, MUST explicitly contain the exact native translation of the selected targetWordFromCollection (e.g. 'lên đường' for 'set off'), and MUST have strict 1-to-1 semantic equivalence with 'idealTranslation' without missing or dropped clauses. Concise (6-14 words). Actively avoid defaulting to corporate office or business management scenarios.`;
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

  const keyTargetWords = enrichKeyTargetWords(
    parsed.keyTargetWords,
    targetWordFromCollection || parsed.targetWordFromCollection,
    params.words,
    parsed.idealTranslation,
    candidateCollectionWords
  );

  const sanitizedSentence = sanitizeNativeSentence(
    parsed.nativeSentence,
    targetWordFromCollection || parsed.targetWordFromCollection,
    keyTargetWords
  );

  return {
    id: `challenge-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    nativeSentence: sanitizedSentence,
    targetLanguage,
    nativeLanguage,
    topicContext: parsed.topicContext || "Daily Conversation",
    idealTranslation: parsed.idealTranslation,
    targetWordFromCollection,
    keyTargetWords,
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

      const keyTargetWords = enrichKeyTargetWords(
        data.keyTargetWords,
        targetWord || data.targetWordFromCollection,
        effectiveParams.words,
        data.idealTranslation
      );

      const sanitizedSentence = sanitizeNativeSentence(
        data.nativeSentence,
        targetWord || data.targetWordFromCollection,
        keyTargetWords
      );

      return {
        id: `challenge-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        nativeSentence: sanitizedSentence,
        targetLanguage: effectiveParams.targetLanguage || "English",
        nativeLanguage: effectiveParams.nativeLanguage || "Vietnamese",
        topicContext: data.topicContext || "Personalized Practice",
        idealTranslation: data.idealTranslation,
        targetWordFromCollection: targetWord,
        keyTargetWords,
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
 * Detects whether a user submission looks like an accidental/incomplete sentence fragment.
 * E.g., user accidentally pressed Enter mid-sentence while typing.
 */
export function isIncompleteSubmission(userMessage: string, challenge: ChallengeData): boolean {
  if (!userMessage || !userMessage.trim()) return false;
  if (isEmptySubmissionMessage(userMessage)) return false;

  const text = userMessage.trim();

  // If text ends with sentence-ending punctuation, user likely intended it as a complete sentence
  if (/[.?!…]$/.test(text)) {
    return false;
  }

  const userWords = text.split(/\s+/).filter(Boolean);
  const idealWords = (challenge.idealTranslation || challenge.nativeSentence || "").split(/\s+/).filter(Boolean);

  // Case 1: Ideal translation is a full sentence (5+ words), but user submitted only 1-2 words
  if (idealWords.length >= 5 && userWords.length <= 2) {
    return true;
  }

  // Case 2: Ideal translation is 25+ chars long, but user submitted < 12 chars
  if ((challenge.idealTranslation || "").length >= 25 && text.length < 12) {
    return true;
  }

  // Case 3: Ends with trailing conjunctions/prepositions/auxiliaries indicating an unfinished phrase
  const trailingConnectives = [
    "the", "a", "an", "is", "are", "was", "were", "to", "in", "at", "of", "for", "with",
    "that", "this", "and", "or", "because", "if", "when", "while", "as", "how", "what",
    "will", "would", "should", "could", "can", "may", "might"
  ];
  const lastWord = userWords[userWords.length - 1]?.toLowerCase();
  if (idealWords.length >= 4 && lastWord && trailingConnectives.includes(lastWord)) {
    return true;
  }

  return false;
}

/**
 * Creates an incomplete submission turn result prompting the user to complete their answer
 */
export function createIncompleteSubmissionResponse(params: ChallengeTurnParams): ChallengeTurnResult {
  const { userMessage } = params;
  const draft = userMessage.trim();
  const shortDraft = draft.length > 25 ? draft.slice(0, 25) + "…" : draft;

  return {
    intent: "incomplete",
    agentReply: `⚠️ **Incomplete Answer Detected**\n\nIt looks like your answer was sent before you finished typing *(did you press Enter by mistake? 😉)*\n\n**Your draft:** *"${draft}"*\n\n👉 Please type your full translation below or tap the button to repopulate your draft!`,
    suggestedActions: [
      {
        label: `✏️ Repopulate draft: "${shortDraft}"`,
        action: "repopulate_input",
        payload: { text: draft }
      },
      { label: "🏳️ Reveal answer & skip", action: "submit_empty_challenge" },
      { label: "🏆 Practice overview", action: "start_practice" }
    ],
    provider: "local",
    model: "instant-detection",
    responseTimeMs: 15,
  };
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

  if (isIncompleteSubmission(userMessage, challenge)) {
    return createIncompleteSubmissionResponse(params);
  }

  const nativeSentence = challenge.nativeSentence;
  const idealTranslation = challenge.idealTranslation;
  const keyTargetWords = JSON.stringify(challenge.keyTargetWords || []);
  const targetWord = challenge.targetWordFromCollection?.word || "";

  const formattedHistory = chatHistory.map((m: any) => `${m.sender.toUpperCase()}: ${m.text}`).join("\n");

  const prompt = `Evaluate a language learner's translation attempt during a Translation Challenge.

CHALLENGE DETAILS:
- Native Sentence (${nativeLanguage}): "${nativeSentence}"
- Ideal Target Translation (${targetLanguage}): "${idealTranslation}"
- Key Target Words: ${keyTargetWords}
- Featured Target Word from Collection: "${targetWord}"
- Target Language: ${targetLanguage}
- Native Language: ${nativeLanguage}

CONVERSATION HISTORY SO FAR:
${formattedHistory || "(No prior messages in this challenge session)"}

LATEST USER SUBMISSION:
"${userMessage}"

TASK:
1. Check if the user's submission is an incomplete fragment (e.g. accidentally pressed Enter before finishing the sentence).
   If it is clearly an incomplete sentence fragment, set intent: "incomplete" and provide agentReply in ${nativeLanguage} or simple English noting that their answer looks incomplete.

2. Otherwise, treat as a complete translation attempt (intent: "submission"):
   - Evaluate their translation against the native sentence and ideal target translation.
   - FLEXIBILITY FOR MULTIPLE CORRECT TRANSLATIONS & SYNONYMS:
     Real-world language has multiple valid ways to express the same thought. Acknowledge and credit valid alternative vocabulary, natural synonyms (e.g., using "client" vs "customer", "feedback" vs "response", "contract" vs "agreement", "await" vs "wait for", etc.), and different correct grammatical structures that accurately convey the native sentence.
     Do NOT penalize the learner for choosing valid synonyms or natural phrasing alternatives. Reward authentic, accurate communication!
   - Calculate an overall accuracy score from 0 to 100 based on grammatical correctness, semantic faithfulness, and naturalness.
   - Provide a scoreLabel (e.g. "Mastery! 🌟" for 90-100, "Great Job! 👏" for 75-89, "Good Attempt! 👍" for 60-74, "Keep Practicing! 💪" for <60).
   - Provide "userTranslation": the learner's submitted translation attempt.
   - SPECIFIC TARGET WORD INCORPORATION CHECK: Check whether the user's submission incorporates the specific featured target word "${targetWord}" (or its natural grammatical variants such as past tense, plural, or inflected forms). Set "incorporatedTargetWord": true if used, false otherwise. Set "targetWordUsed": "${targetWord}". If they used a valid synonym instead, praise their alternative choice in "whatWentWell" and gently mention how "${targetWord}" also works in "areasForImprovement".
   - VOCAB CLUES INCORPORATED: Check which words from "Key Target Words" (or their synonyms) the learner used in their translation. List all incorporated clue words in "incorporatedVocabClues".
   - List "whatWentWell": specific praise for correct grammar, vocabulary, or phrasing (mentioning the target word or synonyms if used).
   - List "areasForImprovement": constructive tips for grammar, prepositions, natural phrasing, or alternative choices.
   - Provide "correctedSentence": the optimal target translation.
   - Provide "suggestedVocabulary": an array of 3-5 vocabulary items containing key terms from the challenge.

Return STRICTLY raw JSON matching:
{
  "intent": "submission" | "incomplete",
  "agentReply": "Helpful reply if intent is incomplete",
  "evaluation": {
    "score": 85,
    "scoreLabel": "Great Job! 👏",
    "userTranslation": "learner's submitted translation text",
    "incorporatedTargetWord": true,
    "targetWordUsed": "${targetWord}",
    "incorporatedVocabClues": ["word1", "word2"],
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
        "askedByUser": false
      }
    ]
  }
}`;

  const systemInstruction = `You are an AI Language Evaluation Coach. Evaluate translation attempts in strict JSON output. Check whether the learner incorporated the designated target word or if the answer is incomplete.`;
  const schemaDescription = `JSON object with intent ("submission" | "incomplete"), agentReply if incomplete, and evaluation object (including userTranslation, incorporatedTargetWord) if submission.`;

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
    if (Array.isArray(challenge.keyTargetWords)) {
      const incClues: string[] = [];
      for (const kw of challenge.keyTargetWords) {
        if (kw?.word && (hasUserIncorporatedWord(parsed.evaluation.userTranslation, kw.word) || hasUserIncorporatedWord(userMessage, kw.word))) {
          incClues.push(kw.word);
        }
      }
      parsed.evaluation.incorporatedVocabClues = incClues;
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
        if (Array.isArray(params.challenge.keyTargetWords)) {
          const incClues: string[] = [];
          for (const kw of params.challenge.keyTargetWords) {
            if (kw?.word && (hasUserIncorporatedWord(data.evaluation.userTranslation, kw.word) || hasUserIncorporatedWord(params.userMessage, kw.word))) {
              incClues.push(kw.word);
            }
          }
          data.evaluation.incorporatedVocabClues = incClues;
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

