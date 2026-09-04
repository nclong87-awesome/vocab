import { Word, UserPersonalityProfile } from "../types";
import { getSettingFromDB, saveSettingToDB } from "../db/indexedDB";

export interface CustomQuickAction {
  id: string;
  label: string;
  iconEmoji: string;
  promptTemplate: string;
  category: "all" | "writing" | "study" | "vocab" | "chat" | "custom";
  scope: "both" | "ask_ai" | "chat";
  description?: string;
  isPinned?: boolean;
  createdAt: number;
  updatedAt?: number;
}

export type JitChipCategory =
  | "all"
  | "jit_context"
  | "nuance"
  | "workplace"
  | "grammar"
  | "memory"
  | "spoken"
  | "custom";

export interface JitActionChip {
  id: string;
  label: string;
  query: string;
  iconEmoji?: string;
  category: JitChipCategory;
  categoryLabel: string;
  isCustom?: boolean;
  source: "persona" | "context" | "custom" | "heuristic";
  confidence?: number;
  description?: string;
}

const STORAGE_CUSTOM_ACTIONS_KEY = "vocab_custom_quick_actions";
const DB_SETTINGS_CUSTOM_ACTIONS_KEY = "user_custom_action_chips";
export const CUSTOM_ACTIONS_UPDATED_EVENT = "vocab-custom-actions-updated";

/**
 * High-value starter custom action templates ready for one-click use.
 */
export const STARTER_PRESET_ACTIONS: CustomQuickAction[] = [
  {
    id: "preset-vietnamese-explanation",
    label: "Giải thích tiếng Việt",
    iconEmoji: "🇻🇳",
    promptTemplate: "Giải thích chi tiết nghĩa, sắc thái và cách dùng tự nhiên của '{word}' bằng tiếng Việt, kèm theo ví dụ song ngữ và lỗi người Việt hay gặp.",
    category: "study",
    scope: "both",
    description: "Giải thích sâu sắc thái bằng tiếng Việt cùng ví dụ ngữ cảnh thực tế",
    isPinned: true,
    createdAt: 1700000000001
  },
  {
    id: "preset-ielts-band8",
    label: "IELTS Band 8 Usage",
    iconEmoji: "🎓",
    promptTemplate: "Demonstrate how to use '{word}' in an IELTS Speaking Part 2/3 response or Writing Task 2 essay with Band 8+ vocabulary, collocations, and complex sentence structures.",
    category: "writing",
    scope: "both",
    description: "Academic band 8+ collocations, speaking dialogues, and essay phrases",
    isPinned: true,
    createdAt: 1700000000002
  },
  {
    id: "preset-workplace-email",
    label: "Workplace Email",
    iconEmoji: "💼",
    promptTemplate: "Draft a polite and professional workplace email between colleagues showing natural usage of '{word}'. Highlight alternative formal synonyms.",
    category: "writing",
    scope: "both",
    description: "Natural business correspondence and corporate email phrasing",
    isPinned: true,
    createdAt: 1700000000003
  },
  {
    id: "preset-common-mistakes",
    label: "Common Mistakes",
    iconEmoji: "⚠️",
    promptTemplate: "What are the most frequent grammatical, prepositional, or pronunciation mistakes learners make when using '{word}', and how do native speakers avoid them?",
    category: "study",
    scope: "both",
    description: "Frequent traps, wrong prepositions, and unnatural word pairings",
    isPinned: false,
    createdAt: 1700000000004
  },
  {
    id: "preset-casual-spoken",
    label: "Casual Spoken & Texting",
    iconEmoji: "🗣️",
    promptTemplate: "Show 3 realistic chat or texting dialogues between close friends using '{word}' in casual spoken English, including modern slang or contractions.",
    category: "chat",
    scope: "both",
    description: "Authentic texting, informal banter, and daily conversational usage",
    isPinned: false,
    createdAt: 1700000000005
  },
  {
    id: "preset-mnemonic-hook",
    label: "Vivid Memory Hook",
    iconEmoji: "🧠",
    promptTemplate: "Create an unforgettable visual mnemonic story or sound-association memory hook that connects the meaning and spelling of '{word}' so I never forget it.",
    category: "study",
    scope: "both",
    description: "Visual association, etymology connection, and memory cues",
    isPinned: false,
    createdAt: 1700000000006
  },
  {
    id: "preset-eli5-simple",
    label: "Explain Like I'm 5",
    iconEmoji: "⚡",
    promptTemplate: "Explain '{word}' like I'm 5 years old. Use a simple, tangible everyday metaphor or story without complicated jargon.",
    category: "study",
    scope: "both",
    description: "Ultra-simple explanation with intuitive metaphors",
    isPinned: false,
    createdAt: 1700000000007
  },
  {
    id: "preset-collocations-prepositions",
    label: "Collocations & Prepositions",
    iconEmoji: "🔗",
    promptTemplate: "List the top 5 essential collocations and prepositions that naturally pair with '{word}', with 1 clear example sentence for each.",
    category: "vocab",
    scope: "both",
    description: "Essential paired verbs, adjectives, and prepositional patterns",
    isPinned: false,
    createdAt: 1700000000008
  }
];

/**
 * Retrieves custom quick actions from localStorage (with auto-initialization from starter presets).
 */
export function getCustomQuickActions(): CustomQuickAction[] {
  try {
    const raw = localStorage.getItem(STORAGE_CUSTOM_ACTIONS_KEY);
    if (!raw) {
      // First time initialization with top starter presets
      const initial = STARTER_PRESET_ACTIONS.slice(0, 5);
      localStorage.setItem(STORAGE_CUSTOM_ACTIONS_KEY, JSON.stringify(initial));
      void saveSettingToDB(DB_SETTINGS_CUSTOM_ACTIONS_KEY, JSON.stringify(initial));
      return initial;
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.warn("Failed to load custom quick actions:", e);
    return STARTER_PRESET_ACTIONS.slice(0, 5);
  }
}

/**
 * Hydrates custom quick actions from IndexedDB settings if local storage is blank.
 */
export async function hydrateCustomQuickActionsFromDB(): Promise<CustomQuickAction[]> {
  try {
    const dbRaw = await getSettingFromDB(DB_SETTINGS_CUSTOM_ACTIONS_KEY);
    if (dbRaw) {
      const parsed = JSON.parse(dbRaw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        localStorage.setItem(STORAGE_CUSTOM_ACTIONS_KEY, dbRaw);
        dispatchCustomActionsUpdated();
        return parsed;
      }
    }
  } catch (e) {
    console.warn("Could not hydrate custom quick actions from DB:", e);
  }
  return getCustomQuickActions();
}

/**
 * Dispatches a window event so all UI components update in real-time.
 */
export function dispatchCustomActionsUpdated(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(CUSTOM_ACTIONS_UPDATED_EVENT));
  }
}

/**
 * Saves or updates a custom quick action.
 */
export async function saveCustomQuickAction(action: CustomQuickAction): Promise<void> {
  const current = getCustomQuickActions();
  const existingIdx = current.findIndex(a => a.id === action.id);
  let updated: CustomQuickAction[];

  const cleanAction: CustomQuickAction = {
    ...action,
    updatedAt: Date.now()
  };

  if (existingIdx >= 0) {
    updated = [...current];
    updated[existingIdx] = cleanAction;
  } else {
    updated = [cleanAction, ...current];
  }

  const jsonStr = JSON.stringify(updated);
  try {
    localStorage.setItem(STORAGE_CUSTOM_ACTIONS_KEY, jsonStr);
    await saveSettingToDB(DB_SETTINGS_CUSTOM_ACTIONS_KEY, jsonStr);
  } catch (e) {
    console.error("Failed to persist custom quick action:", e);
  }

  dispatchCustomActionsUpdated();
}

/**
 * Deletes a custom quick action by ID.
 */
export async function deleteCustomQuickAction(id: string): Promise<void> {
  const current = getCustomQuickActions();
  const updated = current.filter(a => a.id !== id);
  const jsonStr = JSON.stringify(updated);
  try {
    localStorage.setItem(STORAGE_CUSTOM_ACTIONS_KEY, jsonStr);
    await saveSettingToDB(DB_SETTINGS_CUSTOM_ACTIONS_KEY, jsonStr);
  } catch (e) {
    console.error("Failed to delete custom quick action:", e);
  }
  dispatchCustomActionsUpdated();
}

/**
 * Resets custom quick actions to the default starter presets.
 */
export async function resetCustomQuickActionsToDefault(): Promise<void> {
  const initial = STARTER_PRESET_ACTIONS.slice(0, 6);
  const jsonStr = JSON.stringify(initial);
  try {
    localStorage.setItem(STORAGE_CUSTOM_ACTIONS_KEY, jsonStr);
    await saveSettingToDB(DB_SETTINGS_CUSTOM_ACTIONS_KEY, jsonStr);
  } catch (e) {
    console.error("Failed to reset custom quick actions:", e);
  }
  dispatchCustomActionsUpdated();
}

/**
 * Formats a prompt template by replacing `{word}`, `{term}`, `{nativeLanguage}`, `{targetLanguage}` placeholders.
 */
export function formatPromptWithContext(
  template: string,
  vars: {
    word?: string;
    targetLanguage?: string;
    nativeLanguage?: string;
    context?: string;
  }
): string {
  let result = template;
  const wordVal = vars.word || "this term";
  const targetVal = vars.targetLanguage || "English";
  const nativeVal = vars.nativeLanguage || "Vietnamese";

  result = result.replace(/\{word\}|\{term\}|\{vocabulary\}/gi, wordVal);
  result = result.replace(/\{targetLanguage\}|\{target\}/gi, targetVal);
  result = result.replace(/\{nativeLanguage\}|\{native\}/gi, nativeVal);
  if (vars.context) {
    result = result.replace(/\{context\}/gi, vars.context);
  }

  return result.trim();
}

/**
 * Computes Dynamic JIT Action Chips for the "Ask AI" modal.
 * Adapts dynamically based on:
 * 1. The target word and its part of speech
 * 2. The most recent assistant response in the thread (Just-In-Time next steps)
 * 3. The learner's AI Personality Profile (Archetype & signals)
 * 4. Recent user inquiries
 * 5. Pinned custom user actions
 */
export function getDynamicJitChipsForWord(params: {
  word: Word;
  lastAssistantMessage?: string;
  personalityProfile?: UserPersonalityProfile | null;
  nativeLanguage?: string;
  targetLanguage?: string;
  selectedCategory?: JitChipCategory;
}): JitActionChip[] {
  const {
    word,
    lastAssistantMessage = "",
    personalityProfile,
    nativeLanguage = "Vietnamese",
    targetLanguage = "English",
    selectedCategory = "all"
  } = params;

  const w = word.word || "";
  const pos = (word.partOfSpeech || "").toLowerCase();
  const lowerMsg = lastAssistantMessage.toLowerCase();
  const archetype = personalityProfile?.archetype || "";
  const isSentence = Boolean(
    word.category === "Grammar & Expression" ||
    word.id?.startsWith("sentence-") ||
    (w.trim().split(/\s+/).length > 3 && !pos)
  );
  const isReply = Boolean(
    word.category === "Conversation Reply" ||
    word.id?.startsWith("reply-")
  );

  const chips: JitActionChip[] = [];

  // ==========================================
  // 1. JIT CONTEXT CHIPS (Follow-up to last AI turn)
  // ==========================================
  if (lastAssistantMessage.trim().length > 15) {
    if (lowerMsg.includes("grammar") || lowerMsg.includes("rule") || lowerMsg.includes("tense") || lowerMsg.includes("preposition")) {
      chips.push({
        id: `jit-grammar-common-err`,
        label: "Common Pitfalls",
        query: `What are 2 common mistakes learners make when applying this grammar rule with "${w}"?`,
        iconEmoji: "⚠️",
        category: "jit_context",
        categoryLabel: "Next Step",
        source: "context",
        confidence: 0.95
      });
      chips.push({
        id: `jit-grammar-quiz`,
        label: "Test My Understanding",
        query: `Give me 1 fill-in-the-blank practice sentence to test my understanding of this rule with "${w}".`,
        iconEmoji: "🎯",
        category: "jit_context",
        categoryLabel: "Next Step",
        source: "context",
        confidence: 0.9
      });
    } else if (lowerMsg.includes("synonym") || lowerMsg.includes("contrast") || lowerMsg.includes("nuance") || lowerMsg.includes("differ")) {
      chips.push({
        id: `jit-nuance-when-not`,
        label: "When NOT to use",
        query: `In what specific everyday contexts would using "${w}" sound awkward, unnatural, or inappropriate?`,
        iconEmoji: "🚫",
        category: "jit_context",
        categoryLabel: "Next Step",
        source: "context",
        confidence: 0.95
      });
      chips.push({
        id: `jit-nuance-most-natural`,
        label: "Which is Most Common?",
        query: `Between "${w}" and its synonyms, which one do native speakers use most often in everyday conversation?`,
        iconEmoji: "⚖️",
        category: "jit_context",
        categoryLabel: "Next Step",
        source: "context",
        confidence: 0.88
      });
    } else if (lowerMsg.includes("example") || lowerMsg.includes("dialogue") || lowerMsg.includes("sentence")) {
      chips.push({
        id: `jit-ex-how-to-reply`,
        label: "How to Reply?",
        query: `If someone says one of those examples containing "${w}" to me, what are 2 natural ways I can reply?`,
        iconEmoji: "🗣️",
        category: "jit_context",
        categoryLabel: "Next Step",
        source: "context",
        confidence: 0.92
      });
      chips.push({
        id: `jit-ex-more-dialogue`,
        label: "Real Dialogue",
        query: `Show a short, realistic 4-line conversation between friends demonstrating "${w}".`,
        iconEmoji: "💬",
        category: "jit_context",
        categoryLabel: "Next Step",
        source: "context",
        confidence: 0.85
      });
    } else {
      // General dynamic contextual follow-ups
      chips.push({
        id: `jit-general-simpler`,
        label: "Explain Simpler",
        query: `Can you explain your previous point about "${w}" more simply and concisely?`,
        iconEmoji: "⚡",
        category: "jit_context",
        categoryLabel: "Next Step",
        source: "context",
        confidence: 0.85
      });
      chips.push({
        id: `jit-general-drill`,
        label: "Quiz Me",
        query: `Give me a quick 1-question challenge to check if I can use "${w}" correctly.`,
        iconEmoji: "🎯",
        category: "jit_context",
        categoryLabel: "Next Step",
        source: "context",
        confidence: 0.8
      });
    }
  }

  // ==========================================
  // 2. PERSONALITY PROFILE ALIGNED CHIPS
  // ==========================================
  if (archetype.includes("Pragmatic") || archetype.includes("Business") || archetype.includes("Professional")) {
    chips.push({
      id: `persona-workplace-email`,
      label: "Workplace Email",
      query: `How do I naturally phrase a professional workplace email using "${w}"?`,
      iconEmoji: "💼",
      category: "workplace",
      categoryLabel: "Workplace",
      source: "persona",
      confidence: 0.95
    });
    chips.push({
      id: `persona-biz-collocations`,
      label: "Business Collocations",
      query: `What corporate and business collocations pair most frequently with "${w}"?`,
      iconEmoji: "📊",
      category: "workplace",
      categoryLabel: "Workplace",
      source: "persona",
      confidence: 0.9
    });
  } else if (archetype.includes("Analytical") || archetype.includes("Grammar") || archetype.includes("Linguist")) {
    chips.push({
      id: `persona-grammar-deep`,
      label: pos.includes("verb") ? "Preposition Guide" : "Grammar Structure",
      query: `Explain the exact grammar rules, syntax patterns, and prepositions associated with "${w}".`,
      iconEmoji: "📐",
      category: "grammar",
      categoryLabel: "Grammar",
      source: "persona",
      confidence: 0.95
    });
    chips.push({
      id: `persona-etymology`,
      label: "Word Origin & Root",
      query: `What is the word root or etymology of "${w}", and how does its history illuminate its current meaning?`,
      iconEmoji: "🌱",
      category: "grammar",
      categoryLabel: "Grammar",
      source: "persona",
      confidence: 0.85
    });
  } else if (archetype.includes("Storyteller") || archetype.includes("Visual") || archetype.includes("Creative")) {
    chips.push({
      id: `persona-memory-hook`,
      label: "Visual Mnemonic",
      query: `Give me a vivid, unforgettable visual scenario or mnemonic story to remember "${w}".`,
      iconEmoji: "🧠",
      category: "memory",
      categoryLabel: "Memory",
      source: "persona",
      confidence: 0.95
    });
    chips.push({
      id: `persona-story-context`,
      label: "Mini Story in Context",
      query: `Write an engaging 3-sentence micro-story that vividly illustrates the meaning of "${w}".`,
      iconEmoji: "📖",
      category: "memory",
      categoryLabel: "Memory",
      source: "persona",
      confidence: 0.88
    });
  } else if (archetype.includes("Conversational") || archetype.includes("Social")) {
    chips.push({
      id: `persona-spoken-chat`,
      label: "Spoken Dialogue",
      query: `Give me a realistic 4-line spoken conversation between friends using "${w}".`,
      iconEmoji: "🗣️",
      category: "spoken",
      categoryLabel: "Spoken",
      source: "persona",
      confidence: 0.95
    });
    chips.push({
      id: `persona-native-reaction`,
      label: "Native Reactions",
      query: `What would a native speaker typically say in response if I use "${w}" in conversation?`,
      iconEmoji: "💬",
      category: "spoken",
      categoryLabel: "Spoken",
      source: "persona",
      confidence: 0.9
    });
  }

  // ==========================================
  // 3. WORD & POS HEURISTIC CHIPS
  // ==========================================
  if (isSentence) {
    chips.push({
      id: `w-sent-casual-alt`,
      label: "Casual vs Formal Alt",
      query: `How can I rewrite this sentence to sound more casual in texting, or more formal for business?`,
      iconEmoji: "🔄",
      category: "nuance",
      categoryLabel: "Nuance",
      source: "heuristic"
    });
    chips.push({
      id: `w-sent-breakdown`,
      label: "Grammar Breakdown",
      query: `Break down the grammar pattern and key phrases in this sentence: "${w}".`,
      iconEmoji: "📐",
      category: "grammar",
      categoryLabel: "Grammar",
      source: "heuristic"
    });
  } else if (isReply) {
    chips.push({
      id: `w-reply-variations`,
      label: "3 Reply Variations",
      query: `Give me 3 alternative ways to express this reply, ranging from very polite to ultra casual.`,
      iconEmoji: "🎭",
      category: "spoken",
      categoryLabel: "Spoken",
      source: "heuristic"
    });
    chips.push({
      id: `w-reply-tone`,
      label: "Tone & Impression",
      query: `What emotional tone or social impression does using "${w}" convey?`,
      iconEmoji: "⚖️",
      category: "nuance",
      categoryLabel: "Nuance",
      source: "heuristic"
    });
  } else {
    // Standard Vocabulary Word
    chips.push({
      id: `w-nuance-formal-casual`,
      label: "Formal vs Casual",
      query: `How do native speakers use "${w}" in casual conversation vs formal writing?`,
      iconEmoji: "⚖️",
      category: "nuance",
      categoryLabel: "Nuance",
      source: "heuristic"
    });

    if (pos.includes("verb")) {
      chips.push({
        id: `w-verb-prep`,
        label: "Preposition Rules",
        query: `What prepositions pair with "${w}" and how does the meaning change with each preposition?`,
        iconEmoji: "🔗",
        category: "grammar",
        categoryLabel: "Grammar",
        source: "heuristic"
      });
      chips.push({
        id: `w-verb-active-passive`,
        label: "Active vs Passive",
        query: `Show how "${w}" behaves in active vs passive voice with natural examples.`,
        iconEmoji: "📐",
        category: "grammar",
        categoryLabel: "Grammar",
        source: "heuristic"
      });
    } else if (pos.includes("adj") || pos.includes("adv")) {
      chips.push({
        id: `w-adj-degrees`,
        label: "Intensity & Modifiers",
        query: `What adverbs (like 'deeply', 'utterly', 'highly') naturally intensify "${w}"?`,
        iconEmoji: "📈",
        category: "nuance",
        categoryLabel: "Nuance",
        source: "heuristic"
      });
      chips.push({
        id: `w-adj-antonyms`,
        label: "Exact Opposite",
        query: `What is the most precise antonym of "${w}" and how do their nuances contrast?`,
        iconEmoji: "↔️",
        category: "nuance",
        categoryLabel: "Nuance",
        source: "heuristic"
      });
    } else {
      chips.push({
        id: `w-collocations`,
        label: "Key Collocations",
        query: `What are the most common verbs and adjectives that naturally pair with "${w}"?`,
        iconEmoji: "🔗",
        category: "grammar",
        categoryLabel: "Grammar",
        source: "heuristic"
      });
    }

    chips.push({
      id: `w-memory-trick`,
      label: "Memory Trick",
      query: `Give me a mnemonic or memory trick to easily remember "${w}".`,
      iconEmoji: "🧠",
      category: "memory",
      categoryLabel: "Memory",
      source: "heuristic"
    });
  }

  // ==========================================
  // 4. CUSTOM USER ACTION CHIPS (Ask AI or Both)
  // ==========================================
  const customActions = getCustomQuickActions().filter(
    a => a.scope === "both" || a.scope === "ask_ai"
  );

  for (const custom of customActions) {
    const formattedQuery = formatPromptWithContext(custom.promptTemplate, {
      word: w,
      nativeLanguage,
      targetLanguage
    });
    chips.push({
      id: `custom-${custom.id}`,
      label: custom.label,
      query: formattedQuery,
      iconEmoji: custom.iconEmoji || "⭐",
      category: "custom",
      categoryLabel: "Custom",
      isCustom: true,
      source: "custom",
      description: custom.description
    });
  }

  // Filter by selected category if not "all"
  if (selectedCategory !== "all") {
    return chips.filter(c => c.category === selectedCategory);
  }

  // Deduplicate by query or label
  const seenLabels = new Set<string>();
  const uniqueChips: JitActionChip[] = [];
  for (const chip of chips) {
    const key = chip.label.toLowerCase().trim();
    if (!seenLabels.has(key)) {
      seenLabels.add(key);
      uniqueChips.push(chip);
    }
  }

  return uniqueChips;
}

/**
 * Computes Dynamic JIT Action Chips for the Main Chat view.
 * Provides contextual next-step prompts right above or within the chat input.
 */
export function getDynamicJitChipsForChat(params: {
  lastMessage?: string;
  personalityProfile?: UserPersonalityProfile | null;
  words?: Word[];
  nativeLanguage?: string;
  targetLanguage?: string;
}): JitActionChip[] {
  const {
    lastMessage = "",
    personalityProfile,
    nativeLanguage = "Vietnamese",
    targetLanguage = "English"
  } = params;

  const chips: JitActionChip[] = [];
  const lower = lastMessage.toLowerCase();
  const archetype = personalityProfile?.archetype || "";

  // 1. Contextual JIT chips based on active chat turn
  if (lastMessage.trim().length > 10) {
    if (lower.includes("error") || lower.includes("mistake") || lower.includes("correct") || lower.includes("fixed")) {
      chips.push({
        id: "chat-jit-why-wrong",
        label: "Why was that wrong?",
        query: "Can you explain the exact grammatical or cultural reason why that mistake sounded unnatural?",
        iconEmoji: "💡",
        category: "jit_context",
        categoryLabel: "Next Step",
        source: "context"
      });
      chips.push({
        id: "chat-jit-drill-error",
        label: "Give Me 2 Exercises",
        query: "Give me 2 short sentences with errors to fix so I can master this correction.",
        iconEmoji: "📝",
        category: "jit_context",
        categoryLabel: "Next Step",
        source: "context"
      });
    } else if (lower.includes("vocabulary") || lower.includes("words") || lower.includes("phrases")) {
      chips.push({
        id: "chat-jit-save-words",
        label: "Save Key Words",
        query: "Summarize the 3 most important vocabulary words from your answer with definitions and examples so I can review them.",
        iconEmoji: "📚",
        category: "jit_context",
        categoryLabel: "Next Step",
        source: "context"
      });
      chips.push({
        id: "chat-jit-make-quiz",
        label: "Quick Quiz on Words",
        query: "Give me a quick 3-question multiple choice quiz on the vocabulary introduced above.",
        iconEmoji: "🎯",
        category: "jit_context",
        categoryLabel: "Next Step",
        source: "context"
      });
    } else {
      chips.push({
        id: "chat-jit-explain-simpler",
        label: "Explain Simpler",
        query: "Can you explain your last message in simpler, easier words?",
        iconEmoji: "⚡",
        category: "jit_context",
        categoryLabel: "Next Step",
        source: "context"
      });
      chips.push({
        id: "chat-jit-spoken-version",
        label: "How to say naturally",
        query: "How would a native speaker express that in casual spoken English between friends?",
        iconEmoji: "🗣️",
        category: "spoken",
        categoryLabel: "Spoken",
        source: "context"
      });
    }
  }

  // 2. Personality-driven chips
  if (archetype.includes("Pragmatic") || archetype.includes("Business")) {
    chips.push({
      id: "chat-persona-email",
      label: "Draft Business Email",
      query: "Help me write a concise professional email to my supervisor using polite, natural business English.",
      iconEmoji: "💼",
      category: "workplace",
      categoryLabel: "Workplace",
      source: "persona"
    });
  } else if (archetype.includes("Analytical")) {
    chips.push({
      id: "chat-persona-grammar",
      label: "Analyze My Grammar",
      query: `I will write a sentence in ${targetLanguage}. Please thoroughly analyze its syntax, prepositions, and grammatical structures.`,
      iconEmoji: "📐",
      category: "grammar",
      categoryLabel: "Grammar",
      source: "persona"
    });
  }

  // 3. User custom quick actions (scoped to "both" or "chat")
  const customActions = getCustomQuickActions().filter(
    a => a.scope === "both" || a.scope === "chat"
  );
  for (const custom of customActions) {
    const formattedQuery = formatPromptWithContext(custom.promptTemplate, {
      nativeLanguage,
      targetLanguage
    });
    chips.push({
      id: `chat-custom-${custom.id}`,
      label: custom.label,
      query: formattedQuery,
      iconEmoji: custom.iconEmoji || "⭐",
      category: "custom",
      categoryLabel: "Custom",
      isCustom: true,
      source: "custom",
      description: custom.description
    });
  }

  return chips;
}
