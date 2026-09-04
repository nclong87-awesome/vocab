import { recordLearningInteraction } from "./userPersonalityProfileService";

export type InquirySource = "main_chat" | "ask_ai_dialog" | "quiz_intervention" | "quick_action";

export interface UserInquiryRecord {
  id: string;
  question: string;
  source?: InquirySource;
  word?: string;
  category?: string;
  partOfSpeech?: string;
  timestamp: number;
}

const STORAGE_KEY = "vocab_learner_user_inquiries";
const MAX_STORED_INQUIRIES = 50;

/**
 * Retrieves all stored user inquiries from localStorage.
 */
export function getAllUserInquiries(): UserInquiryRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.warn("Failed to load user inquiries from storage:", e);
    return [];
  }
}

/**
 * Saves user inquiries to localStorage.
 */
function saveUserInquiries(inquiries: UserInquiryRecord[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(inquiries.slice(-MAX_STORED_INQUIRIES)));
  } catch (e) {
    console.warn("Failed to save user inquiries to storage:", e);
  }
}

/**
 * Records a new user question or inquiry into local storage.
 * Deduplicates immediate consecutive repeats and limits history to MAX_STORED_INQUIRIES.
 */
export function recordUserInquiry(
  question: string,
  context?: { word?: string; category?: string; partOfSpeech?: string; source?: InquirySource }
): void {
  const trimmed = (question || "").trim();
  if (!trimmed || trimmed.length < 3) return;

  // Filter out automated system actions or pure add_word tags
  if (trimmed.startsWith("<<<") || trimmed.startsWith("System:") || trimmed.startsWith("[AUTO]")) {
    return;
  }

  const existing = getAllUserInquiries();
  const last = existing[existing.length - 1];

  // Prevent immediate duplicates within 10 seconds
  if (last && last.question.toLowerCase() === trimmed.toLowerCase() && Date.now() - last.timestamp < 10000) {
    return;
  }

  const newRecord: UserInquiryRecord = {
    id: `inq-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    question: trimmed,
    source: context?.source || (context?.word ? "ask_ai_dialog" : "main_chat"),
    word: context?.word,
    category: context?.category,
    partOfSpeech: context?.partOfSpeech,
    timestamp: Date.now()
  };

  saveUserInquiries([...existing, newRecord]);
  recordLearningInteraction("inquiry", {
    word: context?.word,
    source: newRecord.source
  });
}

/**
 * Returns the most recent user inquiries (default: 10).
 */
export function getRecentUserInquiries(limit = 10): UserInquiryRecord[] {
  const all = getAllUserInquiries();
  return all.slice(-limit);
}

export interface InquiryProfile {
  primaryTheme: string;
  themeDescription: string;
  topInterests: string[];
  totalInquiries: number;
}

/**
 * Analyzes local inquiries using zero-cost heuristics to detect user learning patterns.
 */
export function analyzeUserInquiryPatterns(): InquiryProfile {
  const inquiries = getAllUserInquiries();
  if (inquiries.length === 0) {
    return {
      primaryTheme: "balanced",
      themeDescription: "Balanced Learning",
      topInterests: ["conversation", "collocations", "synonyms"],
      totalInquiries: 0
    };
  }

  const counts: Record<string, number> = {
    business: 0,
    grammar_preposition: 0,
    nuance_synonym: 0,
    conversation_slang: 0,
    memory_mnemonic: 0,
    exam_academic: 0
  };

  const businessRegex = /\b(business|email|work|office|boss|formal|professional|corporate|client|colleague|meeting)\b/i;
  const grammarRegex = /\b(preposition|with|between|for|at|in|on|grammar|tense|passive|verb form|clause|rule|sentence structure)\b/i;
  const nuanceRegex = /\b(vs|difference|differ|contrast|synonym|nuance|subtle|distinguish|compare|alternative)\b/i;
  const conversationRegex = /\b(conversation|casual|chat|slang|natural|speak|spoken|texting|friend|daily)\b/i;
  const memoryRegex = /\b(remember|mnemonic|trick|easy way|origin|etymology|root|memorize)\b/i;
  const examRegex = /\b(ielts|toefl|toeic|academic|band|essay|advanced|score|c1|c2)\b/i;

  for (const item of inquiries) {
    const q = item.question;
    if (businessRegex.test(q)) counts.business += 2;
    if (grammarRegex.test(q)) counts.grammar_preposition += 2;
    if (nuanceRegex.test(q)) counts.nuance_synonym += 2;
    if (conversationRegex.test(q)) counts.conversation_slang += 2;
    if (memoryRegex.test(q)) counts.memory_mnemonic += 2;
    if (examRegex.test(q)) counts.exam_academic += 2;
  }

  // Find top theme
  const sortedThemes = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const [topKey, topScore] = sortedThemes[0];

  if (topScore === 0) {
    return {
      primaryTheme: "balanced",
      themeDescription: "Balanced Exploration",
      topInterests: ["natural conversation", "collocations", "synonyms"],
      totalInquiries: inquiries.length
    };
  }

  const themeMeta: Record<string, { label: string; interests: string[] }> = {
    business: {
      label: "Business & Workplace Communication",
      interests: ["professional emails", "workplace scenarios", "formal tone"]
    },
    grammar_preposition: {
      label: "Grammar & Preposition Precision",
      interests: ["dependent prepositions", "sentence structures", "common errors"]
    },
    nuance_synonym: {
      label: "Nuance & Synonym Differentiation",
      interests: ["word comparisons", "subtle distinctions", "precise connotations"]
    },
    conversation_slang: {
      label: "Natural Spoken Conversation",
      interests: ["everyday dialogues", "casual phrasing", "native reactions"]
    },
    memory_mnemonic: {
      label: "Memory Tricks & Etymology",
      interests: ["mnemonics", "word roots", "visual association"]
    },
    exam_academic: {
      label: "Academic & Exam Preparation",
      interests: ["band 7+ vocabulary", "formal essays", "academic registers"]
    }
  };

  const meta = themeMeta[topKey] || {
    label: "Balanced Learning",
    interests: ["conversation", "collocations", "nuances"]
  };

  return {
    primaryTheme: topKey,
    themeDescription: meta.label,
    topInterests: meta.interests,
    totalInquiries: inquiries.length
  };
}

/**
 * Returns personalized initial suggested actions tailored to the user's inquiry history
 * and the target word's grammatical properties (verb, noun, adjective, sentence, etc.).
 */
export function getPersonalizedInitialActions(
  word: { word: string; partOfSpeech?: string; translation?: string; category?: string },
  _nativeLanguage = "Vietnamese"
): {
  actions: Array<{ label: string; action: "send_message"; payload: { message: string } }>;
  themeLabel: string;
} {
  const profile = analyzeUserInquiryPatterns();
  const pos = (word.partOfSpeech || "").toLowerCase();
  const w = word.word;

  const actions: Array<{ label: string; action: "send_message"; payload: { message: string } }> = [];

  // Theme-specific customization
  switch (profile.primaryTheme) {
    case "business":
      actions.push({
        label: `💼 Workplace email using "${w}"`,
        action: "send_message",
        payload: { message: `Give me 2 realistic professional email examples using "${w}" with a polite, natural tone.` }
      });
      if (pos.includes("verb")) {
        actions.push({
          label: `🔗 Who/What to "${w}" with`,
          action: "send_message",
          payload: { message: `In a corporate or workplace setting, who or what do you typically "${w}" with? Provide key collocations.` }
        });
      } else {
        actions.push({
          label: `🤝 Meeting & negotiation usage`,
          action: "send_message",
          payload: { message: `How is "${w}" used in business meetings or discussions? Provide practical phrases.` }
        });
      }
      actions.push({
        label: `⚖️ Formal vs Casual alternatives`,
        action: "send_message",
        payload: { message: `Compare "${w}" with its more casual and more formal equivalents. When should I choose each?` }
      });
      break;

    case "grammar_preposition":
      if (pos.includes("verb")) {
        actions.push({
          label: `🔗 Preposition pairs for "${w}"`,
          action: "send_message",
          payload: { message: `What exact prepositions pair with the verb "${w}" (e.g. with, to, between)? Explain the grammatical difference.` }
        });
        actions.push({
          label: `⚠️ Common grammar mistakes`,
          action: "send_message",
          payload: { message: `What are the most common grammatical or preposition mistakes learners make when using "${w}"?` }
        });
      } else {
        actions.push({
          label: `📐 Sentence structure & patterns`,
          action: "send_message",
          payload: { message: `What are the most natural grammatical patterns and dependent words paired with "${w}"?` }
        });
        actions.push({
          label: `⚠️ Common learner mistakes`,
          action: "send_message",
          payload: { message: `What mistakes do learners commonly make with "${w}", and how do I avoid them?` }
        });
      }
      actions.push({
        label: `💡 3 natural sentence structures`,
        action: "send_message",
        payload: { message: `Give me 3 varied sentence structures (simple, compound, complex) naturally featuring "${w}".` }
      });
      break;

    case "nuance_synonym":
      actions.push({
        label: `⚖️ Compare top synonyms for "${w}"`,
        action: "send_message",
        payload: { message: `What are the closest synonyms for "${w}", and what is the exact difference in nuance and tone?` }
      });
      actions.push({
        label: `🎭 Nuance spectrum & degrees`,
        action: "send_message",
        payload: { message: `On a spectrum from mild to strong, where does "${w}" sit compared to related words?` }
      });
      actions.push({
        label: `💡 3 contrastive sentence pairs`,
        action: "send_message",
        payload: { message: `Show me side-by-side contrastive sentences comparing "${w}" with its nearest synonym.` }
      });
      break;

    case "conversation_slang":
      actions.push({
        label: `💬 2 natural dialogues using "${w}"`,
        action: "send_message",
        payload: { message: `Create 2 short, lively everyday conversation dialogues showing how native speakers naturally use "${w}".` }
      });
      actions.push({
        label: `🗣️ Casual phrasing & texting`,
        action: "send_message",
        payload: { message: `How would native speakers use "${w}" in casual spoken English or messaging apps?` }
      });
      actions.push({
        label: `❓ How would a native reply?`,
        action: "send_message",
        payload: { message: `If someone uses "${w}" in a conversation with me, what are natural ways I can reply?` }
      });
      break;

    case "memory_mnemonic":
      actions.push({
        label: `🧠 Memorable mnemonic for "${w}"`,
        action: "send_message",
        payload: { message: `Give me a clever, unforgettable mnemonic or memory hook to easily remember the meaning of "${w}".` }
      });
      actions.push({
        label: `🌱 Word origin & etymology`,
        action: "send_message",
        payload: { message: `What is the word root, origin, or etymology of "${w}", and how does that explain its current meaning?` }
      });
      actions.push({
        label: `💡 3 vivid imagery examples`,
        action: "send_message",
        payload: { message: `Provide 3 vivid, memorable visual scenarios that make the meaning of "${w}" stick in my mind.` }
      });
      break;

    default:
      // Balanced / Default with part-of-speech awareness
      if (pos.includes("verb")) {
        actions.push({
          label: `💡 3 conversation examples`,
          action: "send_message",
          payload: { message: `Give me 3 realistic conversation examples using the word "${w}".` }
        });
        actions.push({
          label: `🔗 Common Prepositions & Collocations`,
          action: "send_message",
          payload: { message: `What are the most common prepositions and collocations paired with "${w}"?` }
        });
        actions.push({
          label: `⚖️ Compare Synonyms & Nuance`,
          action: "send_message",
          payload: { message: `What are common synonyms for "${w}" and how do they differ in nuance?` }
        });
      } else {
        actions.push({
          label: `💡 3 natural example sentences`,
          action: "send_message",
          payload: { message: `Give me 3 natural example sentences demonstrating how to use "${w}".` }
        });
        actions.push({
          label: `🔗 Key Collocations & Phrases`,
          action: "send_message",
          payload: { message: `What are the most common words and expressions that pair with "${w}"?` }
        });
        actions.push({
          label: `⚖️ Compare with Synonyms`,
          action: "send_message",
          payload: { message: `What are common synonyms for "${w}" and how do they differ?` }
        });
      }
      break;
  }

  return {
    actions,
    themeLabel: profile.themeDescription
  };
}

/**
 * Returns adaptive quick chips for the bottom scroll based on the user's inquiry history.
 */
export function getAdaptiveBottomChips(word: { word: string; partOfSpeech?: string }): Array<{ label: string; query: string }> {
  const profile = analyzeUserInquiryPatterns();
  const w = word.word;
  const pos = (word.partOfSpeech || "").toLowerCase();

  const chips: Array<{ label: string; query: string }> = [];

  // Tailored chips based on primary focus
  if (profile.primaryTheme === "business") {
    chips.push({ label: "💼 Email Phrasing", query: `How do I write a natural workplace email containing "${w}"?` });
    chips.push({ label: "Formal vs Casual", query: `How do native speakers use "${w}" in casual conversation vs formal writing?` });
    chips.push({ label: "Common Mistakes", query: `What are common mistakes professionals make when using "${w}"?` });
    chips.push({ label: "Collocations", query: `What corporate and business collocations pair with "${w}"?` });
  } else if (profile.primaryTheme === "grammar_preposition") {
    chips.push({ label: pos.includes("verb") ? "🔗 Preposition Guide" : "📐 Grammar Patterns", query: `Explain the exact grammar rules and prepositions associated with "${w}".` });
    chips.push({ label: "Common Mistakes", query: `What are common grammatical errors learners make with "${w}"?` });
    chips.push({ label: "Passive vs Active", query: `Show how "${w}" behaves in active vs passive voice with examples.` });
    chips.push({ label: "Casual vs Formal", query: `How do native speakers use "${w}" in casual conversation vs formal writing?` });
  } else if (profile.primaryTheme === "nuance_synonym") {
    chips.push({ label: "⚖️ Nuance Breakdown", query: `Give me a deep dive into the nuances of "${w}" compared to similar terms.` });
    chips.push({ label: "Casual vs Formal", query: `How do native speakers use "${w}" in casual conversation vs formal writing?` });
    chips.push({ label: "When NOT to use", query: `In what contexts would using "${w}" sound awkward, wrong, or unnatural?` });
    chips.push({ label: "Memory Trick", query: `Give me a mnemonic or memory trick to easily remember "${w}".` });
  } else if (profile.primaryTheme === "conversation_slang") {
    chips.push({ label: "🗣️ Spoken Dialogue", query: `Give me a natural 4-line spoken dialogue between friends using "${w}".` });
    chips.push({ label: "Casual vs Formal", query: `How do native speakers use "${w}" in casual conversation vs formal writing?` });
    chips.push({ label: "Native Reactions", query: `What would a native speaker typically say in response if I use "${w}"?` });
    chips.push({ label: "Memory Trick", query: `Give me a mnemonic or memory trick to easily remember "${w}".` });
  } else {
    chips.push({ label: "Casual vs Formal", query: `How do native speakers use "${w}" in casual conversation vs formal writing?` });
    chips.push({ label: "Common Mistakes", query: `What are common mistakes learners make when using "${w}"?` });
    chips.push({ label: "Memory Trick", query: `Give me a mnemonic or memory trick to easily remember "${w}".` });
    chips.push({ label: "Prepositions", query: `What prepositions and phrases pair most naturally with "${w}"?` });
  }

  return chips;
}
