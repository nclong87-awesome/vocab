import { 
  Word, 
  LLMConfig, 
  KeywordMnemonic, 
  ImmersionStory, 
  MinedSentence, 
  MemoryPalace, 
  SentenceEvaluation, 
  TargetWordMission, 
  StickyNoteItem, 
  RealWorldUtilityList, 
  GoldlistNotebook,
  GoldlistDistillationTier 
} from "../types";
import { cleanAndParseJson } from "../utils/jsonSanitizer";
import { callLLMClientSide, getOverrideConfig } from "./llmClientService";
import { notifyLlmRequestStartFromConfig } from "../utils/llmEvents";

// Helper for LLM prompt completions
async function sendLlmRequest(params: {
  prompt: string;
  systemInstruction?: string;
  schemaDescription?: string;
  llmConfig?: LLMConfig;
  action?: string;
}): Promise<string> {
  const effectiveConfig = getOverrideConfig(params.llmConfig);
  notifyLlmRequestStartFromConfig(effectiveConfig);
  return await callLLMClientSide(
    params.prompt,
    params.systemInstruction || "You are an expert language learning assistant.",
    params.schemaDescription || "JSON object",
    effectiveConfig
  );
}

// LocalStorage Keys
const GOLDLIST_STORAGE_KEY = "vocab_goldlist_notebooks_v1";
const MEMORY_PALACES_STORAGE_KEY = "vocab_memory_palaces_v1";
const MINED_SENTENCES_STORAGE_KEY = "vocab_mined_sentences_v1";

/* ========================================================================== */
/* 1. The Goldlist Method Engine                                              */
/* ========================================================================== */

export function getStoredGoldlistNotebooks(): GoldlistNotebook[] {
  try {
    const raw = localStorage.getItem(GOLDLIST_STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch (e) {
    console.error("Failed to load Goldlist notebooks:", e);
    return [];
  }
}

export function saveGoldlistNotebooks(notebooks: GoldlistNotebook[]): void {
  try {
    localStorage.setItem(GOLDLIST_STORAGE_KEY, JSON.stringify(notebooks));
  } catch (e) {
    console.error("Failed to save Goldlist notebooks:", e);
  }
}

export function createNewGoldlistNotebook(
  words: Word[],
  targetLanguage: string,
  nativeLanguage: string,
  title?: string
): GoldlistNotebook {
  const now = new Date();
  const gestationDate = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000); // 14 days later

  const initialTier: GoldlistDistillationTier = {
    tierNumber: 0,
    title: "Headlist (Original 100%)",
    wordIds: words.map(w => w.id),
    createdAt: now.toISOString(),
    gestationUntilDate: gestationDate.toISOString(),
    isReadyForDistillation: false
  };

  const newBook: GoldlistNotebook = {
    id: `goldlist_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    title: title || `Goldlist #${getStoredGoldlistNotebooks().length + 1} (${words.length} terms)`,
    targetLanguage,
    nativeLanguage,
    createdAt: now.toISOString(),
    headlistWords: words,
    tiers: [initialTier],
    status: "gestating"
  };

  const existing = getStoredGoldlistNotebooks();
  saveGoldlistNotebooks([newBook, ...existing]);
  return newBook;
}

export function processDistillation(
  notebookId: string,
  tierIndex: number,
  retainedWordIds: string[]
): GoldlistNotebook | null {
  const notebooks = getStoredGoldlistNotebooks();
  const bookIndex = notebooks.findIndex(b => b.id === notebookId);
  if (bookIndex === -1) return null;

  const book = notebooks[bookIndex];
  const currentTier = book.tiers[tierIndex];
  if (!currentTier) return null;

  const now = new Date();
  currentTier.testedAt = now.toISOString();
  currentTier.retainedWordIds = retainedWordIds;

  // The remaining 70% that weren't immediately recalled get distilled into the next tier
  const distilledWordIds = currentTier.wordIds.filter(id => !retainedWordIds.includes(id));
  currentTier.distilledWordIds = distilledWordIds;

  // If there are distilled words and we haven't exceeded Bronze/Silver/Gold tiers:
  if (distilledWordIds.length > 0 && currentTier.tierNumber < 3) {
    const nextTierNum = currentTier.tierNumber + 1;
    const tierNames = ["Headlist", "Bronze Distillation (1st)", "Silver Distillation (2nd)", "Gold Mastered Tier (3rd)"];
    const nextGestation = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

    const nextTier: GoldlistDistillationTier = {
      tierNumber: nextTierNum,
      title: tierNames[nextTierNum] || `Distillation #${nextTierNum}`,
      wordIds: distilledWordIds,
      createdAt: now.toISOString(),
      gestationUntilDate: nextGestation.toISOString(),
      isReadyForDistillation: false
    };

    book.tiers.push(nextTier);
    book.status = "gestating";
  } else {
    book.status = "completed";
  }

  notebooks[bookIndex] = book;
  saveGoldlistNotebooks(notebooks);
  return book;
}

/* ========================================================================== */
/* 2. Contextual Immersion & Dual Reader Service                              */
/* ========================================================================== */

export async function generateImmersionStoryService(params: {
  targetWords: Word[];
  topic?: string;
  genre?: string;
  difficulty?: "beginner" | "intermediate" | "advanced";
  targetLanguage: string;
  nativeLanguage: string;
  cfg?: LLMConfig;
}): Promise<ImmersionStory> {
  const { targetWords, topic = "Daily Adventure", genre = "Slice of Life", difficulty = "intermediate", targetLanguage, nativeLanguage, cfg } = params;

  const wordListFormatted = targetWords.slice(0, 10).map(w => `"${w.word}" (${w.translation || w.definition})`).join(", ");

  const prompt = `Write an engaging, cohesive short story (3 to 4 paragraphs) in ${targetLanguage} that naturally integrates the following target vocabulary words:
Target Vocabulary to emphasize: [${wordListFormatted}]

Comprehensible Input Guidelines:
- Difficulty Level: ${difficulty} (aim for ~90-95% comprehensible phrasing with natural syntax).
- Genre: ${genre}
- Topic: ${topic}
- Provide an accurate paragraph-by-paragraph parallel translation in ${nativeLanguage}.
- Make the story vivid and enjoyable to read.

Return JSON in this EXACT schema:
{
  "title": "Story title in ${targetLanguage}",
  "titleTranslation": "Story title translated in ${nativeLanguage}",
  "topic": "${topic}",
  "genre": "${genre}",
  "difficulty": "${difficulty}",
  "targetWords": [
    {
      "word": "original base word",
      "targetInStory": "exact form used in story text",
      "translation": "translation in ${nativeLanguage}",
      "definition": "simple definition in ${targetLanguage}",
      "pronunciation": "/phonetic/"
    }
  ],
  "paragraphs": [
    {
      "id": "p1",
      "targetText": "Paragraph 1 in ${targetLanguage}...",
      "nativeText": "Paragraph 1 translation in ${nativeLanguage}..."
    }
  ]
}`;

  const systemInstruction = `You are an expert language pedagogue specializing in Stephen Krashen's Comprehensible Input and contextual immersion storytelling. Output ONLY valid JSON matching the requested schema.`;

  try {
    const rawRes = await sendLlmRequest({
      prompt,
      systemInstruction,
      schemaDescription: "ImmersionStory JSON",
      llmConfig: cfg,
      action: "Generate Immersion Story"
    });

    const parsed = cleanAndParseJson(rawRes);
    return {
      id: `story_${Date.now()}`,
      title: parsed.title || "Contextual Immersion Story",
      titleTranslation: parsed.titleTranslation || "Truyện ngữ cảnh",
      topic: parsed.topic || topic,
      genre: parsed.genre || genre,
      difficulty: parsed.difficulty || difficulty,
      targetLanguage,
      nativeLanguage,
      targetWords: parsed.targetWords || targetWords.map(w => ({ word: w.word, targetInStory: w.word, translation: w.translation, definition: w.definition })),
      paragraphs: parsed.paragraphs || [
        {
          id: "p1",
          targetText: `A wonderful day began as we explored ${topic}.`,
          nativeText: `Một ngày tuyệt vời bắt đầu khi chúng tôi khám phá ${topic}.`
        }
      ],
      createdAt: new Date().toISOString()
    };
  } catch (error) {
    console.error("Story generation failed, returning fallback story:", error);
    // Fallback template
    return {
      id: `story_${Date.now()}`,
      title: `A Day with ${targetWords[0]?.word || "New Words"}`,
      titleTranslation: `Một ngày cùng từ vựng mới`,
      topic,
      genre,
      difficulty,
      targetLanguage,
      nativeLanguage,
      targetWords: targetWords.map(w => ({ word: w.word, targetInStory: w.word, translation: w.translation, definition: w.definition })),
      paragraphs: [
        {
          id: "p1",
          targetText: `Every morning brings new opportunities to learn. Today we encounter ${targetWords.map(w => w.word).join(", ")}. In our daily conversations, using these words opens up vibrant expressions.`,
          nativeText: `Mỗi buổi sáng mang đến những cơ hội mới để học tập. Hôm nay chúng ta bắt gặp ${targetWords.map(w => w.translation || w.word).join(", ")}. Trong giao tiếp hàng ngày, việc sử dụng các từ này mở ra nhiều cách biểu đạt phong phú.`
        }
      ],
      createdAt: new Date().toISOString()
    };
  }
}

// Mined Sentences Local Persistence
export function getStoredMinedSentences(): MinedSentence[] {
  try {
    const raw = localStorage.getItem(MINED_SENTENCES_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveMinedSentence(mined: Omit<MinedSentence, "id" | "createdAt">): MinedSentence {
  const existing = getStoredMinedSentences();
  const newItem: MinedSentence = {
    ...mined,
    id: `mined_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    createdAt: new Date().toISOString()
  };
  localStorage.setItem(MINED_SENTENCES_STORAGE_KEY, JSON.stringify([newItem, ...existing]));
  return newItem;
}

export function deleteMinedSentence(id: string): void {
  const existing = getStoredMinedSentences();
  localStorage.setItem(MINED_SENTENCES_STORAGE_KEY, JSON.stringify(existing.filter(i => i.id !== id)));
}

/* ========================================================================== */
/* 3. Mnemonics & Memory Palace Service                                       */
/* ========================================================================== */

export async function generateKeywordMnemonicService(params: {
  word: Word;
  targetLanguage: string;
  nativeLanguage: string;
  cfg?: LLMConfig;
}): Promise<KeywordMnemonic> {
  const { word, targetLanguage, nativeLanguage, cfg } = params;

  const prompt = `Create a memorable Mnemonic using the Keyword Method and Absurd Visual Association for the vocabulary word in ${targetLanguage}:
Word: "${word.word}"
Pronunciation: "${word.pronunciation || ""}"
Translation in ${nativeLanguage}: "${word.translation}"
Definition: "${word.definition}"

Instructions:
1. Keyword Method: Find a word or phrase in ${nativeLanguage} (or universal phonetic) that SOUNDS VERY SIMILAR to "${word.word}". (e.g. for Spanish "pájaro" -> sounds like "pajama", or "ventana" -> sounds like "ventilation").
2. Absurd Imagery: Create a bizarre, hilarious, highly visual mental story that firmly ties the sound-alike keyword to the TRUE meaning ("${word.translation}").
3. Visual Cue: A 1-sentence prompt describing the mental snapshot.
4. Station Recommendation: Suggest an optimal spot in a house (e.g., "Front Door", "Living Room Sofa", "Kitchen Fridge", "Bookshelf", "Balcony").

Return strictly JSON:
{
  "word": "${word.word}",
  "translation": "${word.translation}",
  "pronunciation": "${word.pronunciation || ""}",
  "keywordSoundAlike": "Phonetic sound-alike in ${nativeLanguage}",
  "vividImageryStory": "Hilarious and absurd 2-3 sentence memory story connecting the sound to the meaning...",
  "humorousVisualCue": "Absurd visual image snapshot description",
  "stationRecommendation": "Suggested memory palace station"
}`;

  const systemInstruction = `You are a world memory championship coach specializing in mnemonic keyword associations and the Method of Loci. Be creative, vivid, absurd, and memorable. Return ONLY JSON.`;

  try {
    const raw = await sendLlmRequest({
      prompt,
      systemInstruction,
      schemaDescription: "KeywordMnemonic JSON",
      llmConfig: cfg,
      action: "Generate Mnemonic"
    });

    const parsed = cleanAndParseJson(raw);
    return {
      wordId: word.id,
      word: word.word,
      translation: word.translation,
      pronunciation: word.pronunciation,
      keywordSoundAlike: parsed.keywordSoundAlike || `Sounds like ${word.word}`,
      vividImageryStory: parsed.vividImageryStory || `Imagine a vivid scene where ${word.word} represents ${word.translation}.`,
      humorousVisualCue: parsed.humorousVisualCue || `Picture ${word.word} brightly displayed.`,
      stationRecommendation: parsed.stationRecommendation || "Front Porch"
    };
  } catch (error) {
    console.error("Mnemonic generation error:", error);
    return {
      wordId: word.id,
      word: word.word,
      translation: word.translation,
      pronunciation: word.pronunciation,
      keywordSoundAlike: `Phonetic: ${word.pronunciation || word.word}`,
      vividImageryStory: `Connect "${word.word}" to a vivid, unforgettable image representing "${word.translation}". Whenever you walk past your station, recall this snapshot!`,
      humorousVisualCue: `Vivid glowing sign of "${word.word}"`,
      stationRecommendation: "Living Room Sofa"
    };
  }
}

// Default Memory Palaces
export const DEFAULT_MEMORY_PALACES: MemoryPalace[] = [
  {
    id: "palace_cozy_home",
    name: "Cozy Penthouse Residence",
    theme: "home",
    description: "A familiar, comfortable home with high emotional anchors across every room.",
    createdAt: new Date().toISOString(),
    stations: [
      { id: "s1", name: "Front Entryway & Doormat", icon: "🚪", order: 1 },
      { id: "s2", name: "Hallway Coat Rack & Mirror", icon: "🧥", order: 2 },
      { id: "s3", name: "Living Room Plush Sofa", icon: "🛋️", order: 3 },
      { id: "s4", name: "Center Glass Coffee Table", icon: "☕", order: 4 },
      { id: "s5", name: "Kitchen Marble Island", icon: "🍳", order: 5 },
      { id: "s6", name: "Refrigerator Door & Freezer", icon: "🧊", order: 6 },
      { id: "s7", name: "Sunlit Bookshelf Nook", icon: "📚", order: 7 },
      { id: "s8", name: "Master Bedroom Bedside Lamp", icon: "🛏️", order: 8 },
      { id: "s9", name: "Open Garden Balcony Railing", icon: "🌿", order: 9 }
    ]
  },
  {
    id: "palace_artisan_cafe",
    name: "Artisan Coffee Roastery",
    theme: "cafe",
    description: "A bustling aromatic coffee house with distinct seating zones and coffee stations.",
    createdAt: new Date().toISOString(),
    stations: [
      { id: "s1", name: "Entrance Bell & Menu Chalkboard", icon: "🔔", order: 1 },
      { id: "s2", name: "Espresso Machine & Steam Wand", icon: "☕", order: 2 },
      { id: "s3", name: "Pastry Glass Display Case", icon: "🥐", order: 3 },
      { id: "s4", name: "Barista Counter Register", icon: "💳", order: 4 },
      { id: "s5", name: "Corner Velvet Armchair", icon: "🪑", order: 5 },
      { id: "s6", name: "Communal Oak Wood Table", icon: "🪵", order: 6 },
      { id: "s7", name: "Vinyl Record Player Shelf", icon: "🎵", order: 7 },
      { id: "s8", name: "Outdoor Patio Umbrella", icon: "⛱️", order: 8 }
    ]
  },
  {
    id: "palace_ancient_library",
    name: "Grand Vault Library",
    theme: "library",
    description: "A majestic classical library with soaring wooden shelves, brass lamps, and stone arches.",
    createdAt: new Date().toISOString(),
    stations: [
      { id: "s1", name: "Grand Double Oak Doors", icon: "🏛️", order: 1 },
      { id: "s2", name: "Librarian's Circular Desk", icon: "📖", order: 2 },
      { id: "s3", name: "Rolling Wooden Ladder", icon: "🪜", order: 3 },
      { id: "s4", name: "Green Banker's Study Lamp", icon: "💡", order: 4 },
      { id: "s5", name: "Antique Globe on Pedestal", icon: "🌍", order: 5 },
      { id: "s6", name: "Spiral Iron Staircase", icon: "🌀", order: 6 },
      { id: "s7", name: "Stained Glass Rose Window", icon: "🪟", order: 7 },
      { id: "s8", name: "Rare Manuscript Vault", icon: "🗝️", order: 8 }
    ]
  }
];

export function getStoredMemoryPalaces(): MemoryPalace[] {
  try {
    const raw = localStorage.getItem(MEMORY_PALACES_STORAGE_KEY);
    if (!raw) {
      localStorage.setItem(MEMORY_PALACES_STORAGE_KEY, JSON.stringify(DEFAULT_MEMORY_PALACES));
      return DEFAULT_MEMORY_PALACES;
    }
    return JSON.parse(raw);
  } catch {
    return DEFAULT_MEMORY_PALACES;
  }
}

export function saveMemoryPalaces(palaces: MemoryPalace[]): void {
  try {
    localStorage.setItem(MEMORY_PALACES_STORAGE_KEY, JSON.stringify(palaces));
  } catch (e) {
    console.error("Failed to save memory palaces:", e);
  }
}

export function assignWordToStation(
  palaceId: string,
  stationId: string,
  word: Word,
  mnemonic?: KeywordMnemonic
): MemoryPalace[] {
  const palaces = getStoredMemoryPalaces();
  const updated = palaces.map(p => {
    if (p.id === palaceId) {
      return {
        ...p,
        stations: p.stations.map(s => {
          if (s.id === stationId) {
            return {
              ...s,
              wordId: word.id,
              word: word.word,
              translation: word.translation,
              mnemonic: mnemonic || s.mnemonic
            };
          }
          return s;
        })
      };
    }
    return p;
  });
  saveMemoryPalaces(updated);
  return updated;
}

export function clearStationWord(palaceId: string, stationId: string): MemoryPalace[] {
  const palaces = getStoredMemoryPalaces();
  const updated = palaces.map(p => {
    if (p.id === palaceId) {
      return {
        ...p,
        stations: p.stations.map(s => {
          if (s.id === stationId) {
            const { wordId: _, word: __, translation: ___, mnemonic: ____, visualAnchorNote: _____, ...rest } = s;
            return rest as any;
          }
          return s;
        })
      };
    }
    return p;
  });
  saveMemoryPalaces(updated);
  return updated;
}

/* ========================================================================== */
/* 4. Deep Processing & WRAP Studio Services                                  */
/* ========================================================================== */

export async function evaluatePersonalSentenceService(params: {
  word: Word;
  userSentence: string;
  targetLanguage: string;
  nativeLanguage: string;
  cfg?: LLMConfig;
}): Promise<SentenceEvaluation> {
  const { word, userSentence, targetLanguage, nativeLanguage, cfg } = params;

  const prompt = `Critique and evaluate a student's personal sentence written in ${targetLanguage} using the target vocabulary word:
Target Word: "${word.word}" (Definition: "${word.definition}", Meaning: "${word.translation}")
Student's Sentence: "${userSentence}"

Deep Processing Evaluation Goals:
1. Score from 0 to 100 based on grammatical precision, natural phrasing, correct collocation, and semantic accuracy.
2. Naturalness label: Choose one of ["Natural & Native-like", "Grammatically Correct but Stiff", "Contains Minor Nuance Flaws", "Needs Correction"].
3. Actionable Feedback: 1-2 constructive sentences in ${nativeLanguage} explaining what worked and how to elevate it.
4. Polished Sentence: A refined, elegant version in ${targetLanguage}.
5. Alternative Variations: 2 other natural ways native speakers would express this idea.
6. Collocation Tips: 1-2 common natural word pairings with "${word.word}".

Return strictly JSON:
{
  "score": 92,
  "naturalness": "Natural & Native-like",
  "feedback": "Feedback in ${nativeLanguage}",
  "polishedSentence": "Polished version in ${targetLanguage}",
  "alternativeVariations": ["Alt 1", "Alt 2"],
  "collocationTips": "Collocations advice in ${nativeLanguage}",
  "grammarNotes": "Optional grammar detail"
}`;

  const systemInstruction = `You are a warm, encouraging language coach giving instant deep-processing feedback. Return ONLY valid JSON.`;

  try {
    const raw = await sendLlmRequest({
      prompt,
      systemInstruction,
      schemaDescription: "SentenceEvaluation JSON",
      llmConfig: cfg,
      action: "Evaluate Deep Processing Sentence"
    });

    const parsed = cleanAndParseJson(raw);
    return {
      score: typeof parsed.score === "number" ? parsed.score : 85,
      naturalness: parsed.naturalness || "Natural & Native-like",
      feedback: parsed.feedback || "Good usage of the target word!",
      polishedSentence: parsed.polishedSentence || userSentence,
      alternativeVariations: parsed.alternativeVariations || [],
      collocationTips: parsed.collocationTips || "",
      grammarNotes: parsed.grammarNotes || ""
    };
  } catch (error) {
    console.error("Sentence evaluation failed:", error);
    return {
      score: 80,
      naturalness: "Grammatically Correct but Stiff",
      feedback: `You successfully incorporated "${word.word}" into your sentence! Active production builds much stronger neural memory traces than passive reading.`,
      polishedSentence: userSentence,
      alternativeVariations: [`In my daily routine, I often experience ${word.word}.`],
      collocationTips: `Try combining "${word.word}" with natural adjectives and verbs.`
    };
  }
}

export async function generateTargetWordMissionService(params: {
  targetWords: Word[];
  targetLanguage: string;
  nativeLanguage: string;
  cfg?: LLMConfig;
}): Promise<TargetWordMission> {
  const { targetWords, targetLanguage, nativeLanguage, cfg } = params;
  const wordSummary = targetWords.slice(0, 5).map(w => `"${w.word}" (${w.translation})`).join(", ");

  const prompt = `Create an exciting, real-world mini conversational roleplay mission in ${targetLanguage} designed to actively test and elicit these target vocabulary words with explanations in ${nativeLanguage}:
Target Words: [${wordSummary}]

Scenario examples:
- Ordering an intricate customized order at a boutique cafe
- Solving a flight delay or hotel check-in misunderstanding with a concierge
- Interviewing a curious guest or planning a road trip with a local friend

Return strictly JSON:
{
  "title": "Mission Title",
  "scenario": "Short 2-sentence scenario setup explaining the situation and goal",
  "aiRole": "AI's Persona (e.g. Hotel Concierge, Coffee Barista, Travel Partner)",
  "userRole": "User's Persona (e.g. Weary Traveler, Customer, Colleague)",
  "suggestedOpening": "First conversational line from the AI in ${targetLanguage} to kick off the mission"
}`;

  const systemInstruction = `You are a language immersion mission designer. Return ONLY JSON.`;

  try {
    const raw = await sendLlmRequest({
      prompt,
      systemInstruction,
      schemaDescription: "TargetWordMission JSON",
      llmConfig: cfg,
      action: "Generate Mission"
    });

    const parsed = cleanAndParseJson(raw);
    return {
      id: `mission_${Date.now()}`,
      title: parsed.title || "Conversational Vocabulary Mission",
      scenario: parsed.scenario || `Use your target words in a natural conversation with the AI companion.`,
      aiRole: parsed.aiRole || "Conversational Partner",
      userRole: parsed.userRole || "You",
      suggestedOpening: parsed.suggestedOpening || `Hello! How can I assist you with your plans today?`,
      targetWords: targetWords.map(w => ({ word: w.word, translation: w.translation, used: false }))
    };
  } catch (error) {
    return {
      id: `mission_${Date.now()}`,
      title: `Daily Scenario Practice with ${targetWords[0]?.word || "Vocabulary"}`,
      scenario: `Engage in a friendly dialogue using the words: ${wordSummary}.`,
      aiRole: "Local Friend",
      userRole: "Visitor",
      suggestedOpening: `Hi there! I was just thinking about our upcoming plans. What do you think we should do today?`,
      targetWords: targetWords.map(w => ({ word: w.word, translation: w.translation, used: false }))
    };
  }
}

/* ========================================================================== */
/* 5. Physical Environment & Real-World Utility Services                      */
/* ========================================================================== */

export async function generateStickyNotesService(params: {
  words: Word[];
  targetLanguage: string;
  nativeLanguage: string;
  roomTheme?: string;
  cfg?: LLMConfig;
}): Promise<StickyNoteItem[]> {
  const { words, targetLanguage, nativeLanguage, roomTheme = "Household & Daily Life", cfg } = params;
  const wordList = words.slice(0, 12).map(w => `"${w.word}" (${w.translation || w.definition})`).join(", ");

  const prompt = `Generate printable Post-It / Sticky Note labels for physical environment immersion in ${targetLanguage} (Theme: ${roomTheme}).
Words: [${wordList}]

For each word, provide:
1. Clear phonetic pronunciation guide
2. Part of speech
3. Translation in ${nativeLanguage}
4. A short, punchy micro-sentence or actionable instruction in ${targetLanguage} (e.g., "Press button to heat", "Keep closed after use")
5. The specific household object or room spot to affix this sticky note (e.g., "Affix to Microwave", "Affix to Front Door Mirror", "Affix to Coffee Maker", "Affix to Bookshelf", "Affix to Refrigerator").

Return strictly JSON array:
[
  {
    "word": "microwave",
    "translation": "lò vi sóng",
    "pronunciation": "/ˈmaɪkrəweɪv/",
    "partOfSpeech": "noun",
    "contextSentence": "Heat food evenly for 2 minutes.",
    "roomAffixLocation": "Affix to Microwave Oven Door",
    "tips": "Say the word aloud every time you warm a meal!"
  }
]`;

  const systemInstruction = `You are a physical environment language immersion expert. Return ONLY a JSON array.`;

  try {
    const raw = await sendLlmRequest({
      prompt,
      systemInstruction,
      schemaDescription: "StickyNoteItem Array JSON",
      llmConfig: cfg,
      action: "Generate Sticky Notes"
    });

    const parsed = cleanAndParseJson(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((item, idx) => ({
        id: `sticky_${idx}_${Date.now()}`,
        word: item.word || words[idx]?.word || "Word",
        translation: item.translation || words[idx]?.translation || "Nghĩa",
        pronunciation: item.pronunciation || words[idx]?.pronunciation || "",
        partOfSpeech: item.partOfSpeech || words[idx]?.partOfSpeech || "noun",
        contextSentence: item.contextSentence || words[idx]?.example || `Use ${item.word} daily.`,
        roomAffixLocation: item.roomAffixLocation || "Affix to Desk / Mirror",
        tips: item.tips || "Say this word aloud whenever you see it!"
      }));
    }
  } catch (error) {
    console.error("Sticky notes generation error:", error);
  }

  // Fallback
  return words.map((w, idx) => ({
    id: `sticky_${idx}_${Date.now()}`,
    word: w.word,
    translation: w.translation,
    pronunciation: w.pronunciation || "",
    partOfSpeech: w.partOfSpeech || "noun",
    contextSentence: w.example || `Notice and name this object in ${targetLanguage}.`,
    roomAffixLocation: `Affix to Object #${idx + 1}`,
    tips: "Say aloud when passing by!"
  }));
}

export async function generateRealWorldUtilityListService(params: {
  type: "grocery" | "todo" | "device_ui" | "restaurant_menu";
  targetWords?: Word[];
  targetLanguage: string;
  nativeLanguage: string;
  cfg?: LLMConfig;
}): Promise<RealWorldUtilityList> {
  const { type, targetWords = [], targetLanguage, nativeLanguage, cfg } = params;
  const wordSample = targetWords.slice(0, 8).map(w => w.word).join(", ");

  const typeNames = {
    grocery: "Supermarket Grocery Shopping List",
    todo: "Daily Morning & Work To-Do Routine",
    device_ui: "Smartphone & App UI Settings Cheat-Sheet",
    restaurant_menu: "Bistro Menu & Ordering Guide"
  };

  const prompt = `Generate an authentic real-world utility document in ${targetLanguage} for: ${typeNames[type]}.
Native Language for translations: ${nativeLanguage}
Target words to incorporate where natural: [${wordSample}]

Return JSON matching this schema:
{
  "title": "${typeNames[type]}",
  "type": "${type}",
  "items": [
    {
      "targetText": "Item or phrase in ${targetLanguage}",
      "nativeText": "Meaning in ${nativeLanguage}",
      "category": "Category name (e.g. Produce, Settings, Urgency, Aisle 2)",
      "phonetic": "/phonetic/",
      "actionHint": "Practical real-world usage instruction"
    }
  ]
}`;

  const systemInstruction = `You are a practical polyglot creating functional real-world immersion guides. Return ONLY JSON.`;

  try {
    const raw = await sendLlmRequest({
      prompt,
      systemInstruction,
      schemaDescription: "RealWorldUtilityList JSON",
      llmConfig: cfg,
      action: "Generate Real World List"
    });

    const parsed = cleanAndParseJson(raw);
    return {
      id: `util_${type}_${Date.now()}`,
      title: parsed.title || typeNames[type],
      type,
      items: (parsed.items || []).map((item: any) => ({
        targetText: item.targetText || "Example",
        nativeText: item.nativeText || "Ví dụ",
        category: item.category || "General",
        phonetic: item.phonetic || "",
        actionHint: item.actionHint || "",
        checked: false
      }))
    };
  } catch (error) {
    console.error("Utility list generation error:", error);
    return {
      id: `util_${type}_${Date.now()}`,
      title: typeNames[type],
      type,
      items: [
        { targetText: "Fresh Produce", nativeText: "Nông sản tươi", category: "Pantry", checked: false },
        { targetText: "Review Notifications", nativeText: "Xem thông báo", category: "Daily Routine", checked: false },
        { targetText: "Settings & Privacy", nativeText: "Cài đặt & Quyền riêng tư", category: "Device UI", checked: false }
      ]
    };
  }
}

export const generateRealWorldListService = generateRealWorldUtilityListService;
