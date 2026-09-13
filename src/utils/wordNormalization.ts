import pluralize from "pluralize";
import { Word } from "../types";

const singularCache = new Map<string, string>();
const pluralCache = new Map<string, string>();
const equivalentCache = new Map<string, boolean>();

/**
 * Normalizes a word for loose vocabulary comparison.
 * Trims whitespace, converts to lowercase, and converts to singular form.
 */
export function normalizeWordForComparison(word?: string | null): string {
  if (!word || typeof word !== "string") return "";
  const cleaned = word.trim().toLowerCase();
  if (!cleaned) return "";

  const cached = singularCache.get(cleaned);
  if (cached !== undefined) return cached;

  let singular = cleaned;
  try {
    singular = pluralize.singular(cleaned) || cleaned;
  } catch {
    singular = cleaned;
  }
  singularCache.set(cleaned, singular);
  return singular;
}

/**
 * Gets the plural form of a word for comparison, with caching.
 */
export function getPluralForComparison(word: string): string {
  const cached = pluralCache.get(word);
  if (cached !== undefined) return cached;
  let p = word;
  try {
    p = pluralize.plural(word) || word;
  } catch {
    p = word;
  }
  pluralCache.set(word, p);
  return p;
}

/**
 * Checks if two words are equivalent in vocabulary context.
 * Considers exact case-insensitive matches, as well as singular/plural variants
 * (e.g. "benchmark" and "benchmarks", "apple" and "apples", "criteria" and "criterion").
 */
export function areWordsEquivalent(word1?: string | null, word2?: string | null): boolean {
  if (!word1 || !word2) return false;
  const w1 = word1.trim().toLowerCase();
  const w2 = word2.trim().toLowerCase();

  // 1. Exact case-insensitive match
  if (w1 === w2) return true;
  if (!w1 || !w2) return false;

  const cacheKey = w1 < w2 ? `${w1}|||${w2}` : `${w2}|||${w1}`;
  const cached = equivalentCache.get(cacheKey);
  if (cached !== undefined) return cached;

  let result = false;
  // 2. Normalized singular comparison
  const s1 = normalizeWordForComparison(w1);
  const s2 = normalizeWordForComparison(w2);
  if (s1 && s2 && s1 === s2) {
    result = true;
  } else {
    // 3. Plural check
    try {
      const p1 = getPluralForComparison(w1);
      const p2 = getPluralForComparison(w2);
      if (p1 && p2 && p1 === p2) result = true;
      else if (p1 === w2 || p2 === w1 || s1 === w2 || s2 === w1) result = true;
    } catch {
      result = false;
    }
  }

  equivalentCache.set(cacheKey, result);
  return result;
}

/**
 * Finds a matching word in the user's collection, taking into account
 * singular and plural forms (e.g. searching "benchmarks" will find "benchmark" or vice-versa).
 */
export function findWordInCollection(words: Word[], targetWord?: string | null): Word | undefined {
  if (!words || !Array.isArray(words) || words.length === 0 || !targetWord) return undefined;
  const targetClean = targetWord.trim().toLowerCase();
  if (!targetClean) return undefined;

  // Fast path 1: Exact string match (no pluralize needed)
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w.word && w.word.trim().toLowerCase() === targetClean) {
      return w;
    }
  }

  // Fast path 2: Normalized singular match
  const targetSingular = normalizeWordForComparison(targetClean);
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w.word) {
      const wSingular = normalizeWordForComparison(w.word);
      if (wSingular === targetSingular) {
        return w;
      }
    }
  }

  // Fast path 3: Full equivalence check
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (areWordsEquivalent(w.word, targetClean)) {
      return w;
    }
  }

  return undefined;
}

/**
 * Checks if a word (or its singular/plural form) already exists in the collection.
 */
export function isWordInCollection(words: Word[], targetWord?: string | null): boolean {
  return Boolean(findWordInCollection(words, targetWord));
}

/**
 * Checks if a word is marked as incomplete (temporarily added from suggestions, pending completion, or missing details like pronunciation or example).
 */
export function isIncompleteWord(word?: Partial<Word> | null): boolean {
  if (!word) return true;
  if (word.completed === false) return true;
  if (!word.pronunciation || word.pronunciation === "/.../" || word.pronunciation === "/ ... /" || !word.pronunciation.trim()) return true;
  if (!word.definition || !word.definition.trim()) return true;
  if (!word.translation || !word.translation.trim()) return true;
  if (!word.example || !word.example.trim()) return true;
  return false;
}

/**
 * Checks if a word is fully completed.
 */
export function isCompletedWord(word?: Partial<Word> | null): boolean {
  if (!word) return false;
  return !isIncompleteWord(word);
}

/**
 * Checks if a given part-of-speech string indicates that the word is a noun.
 * Supports standard English POS tags ("noun", "proper noun", "countable noun", "n.", "n"),
 * compound phrases ("noun, verb"), and common multilingual variants.
 */
export function isNoun(partOfSpeech?: string | null): boolean {
  if (!partOfSpeech || typeof partOfSpeech !== "string") return false;
  const pos = partOfSpeech.trim().toLowerCase();
  if (pos === "n" || pos === "n.") return true;
  if (
    pos.includes("noun") ||
    pos.includes("danh từ") ||
    pos.includes("sustantivo") ||
    pos.includes("substantiv") ||
    pos.includes("nom") ||
    pos.includes("명사") ||
    pos.includes("名詞") ||
    pos.includes("名词")
  ) {
    return true;
  }
  return false;
}

/**
 * Checks if a word, part-of-speech string, or category indicates a phrasal verb.
 * Detects explicit tags/POS ("phrasal verb", "cụm động từ", etc.),
 * multi-word verb phrases with known particles (e.g. "laugh it off", "look forward to", "break down"),
 * or category tags matching phrasal verbs.
 */
export function isPhrasalVerb(
  word?: string | null,
  partOfSpeech?: string | null,
  category?: string | null
): boolean {
  if (partOfSpeech && typeof partOfSpeech === "string") {
    const pos = partOfSpeech.trim().toLowerCase();
    if (
      pos.includes("phrasal verb") ||
      pos.includes("phrasal") ||
      pos.includes("cụm động từ") ||
      pos.includes("verbo frasal") ||
      pos.includes("verbe à particule") ||
      pos === "pv"
    ) {
      return true;
    }
  }

  if (category && typeof category === "string") {
    const cat = category.trim().toLowerCase();
    if (
      cat.includes("phrasal verb") ||
      cat.includes("phrasal") ||
      cat.includes("cụm động từ")
    ) {
      return true;
    }
  }

  if (word && typeof word === "string") {
    const trimmed = word.trim().toLowerCase();
    // Common English phrasal verb particles
    const particleRegex = /\b(off|out|up|down|in|on|away|over|through|back|into|around|along|across|by|for)\b/i;
    if (particleRegex.test(trimmed) && trimmed.includes(" ")) {
      const parts = trimmed.split(/\s+/);
      // Typical phrasal verbs have between 2 and 4 tokens (e.g. "look into", "laugh it off", "look forward to")
      if (parts.length >= 2 && parts.length <= 4) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Normalizes word category to explicitly include 'Phrasal Verbs' if detected.
 */
export function normalizeWordCategory(
  category?: string | null,
  word?: string | null,
  partOfSpeech?: string | null
): string {
  if (isPhrasalVerb(word, partOfSpeech, category)) {
    if (!category || category === "General" || category === "Vocabulary" || category === "word" || category.trim() === "") {
      return "Phrasal Verbs";
    }
    if (/phrasal/i.test(category)) {
      return "Phrasal Verbs";
    }
    return category;
  }
  return category || "General";
}

/**
 * Normalizes part-of-speech string to 'phrasal verb' if the word is recognized as a phrasal verb.
 */
export function normalizeWordPartOfSpeech(
  partOfSpeech?: string | null,
  word?: string | null,
  category?: string | null
): string {
  if (isPhrasalVerb(word, partOfSpeech, category)) {
    if (
      !partOfSpeech ||
      partOfSpeech === "word" ||
      partOfSpeech === "verb" ||
      partOfSpeech === "expression" ||
      partOfSpeech === "phrase" ||
      partOfSpeech.trim() === ""
    ) {
      return "phrasal verb";
    }
  }
  return partOfSpeech || "word";
}

/**
 * Checks if a user's response text incorporates a specific target word,
 * handling case insensitivity, punctuation, word boundaries, plural/singular forms,
 * and common verb inflections (e.g. "streamlined", "streamlining", "streamlines").
 */
export function hasUserIncorporatedWord(text?: string | null, targetWord?: string | null): boolean {
  if (!text || !targetWord) return false;
  const t = text.trim().toLowerCase();
  const tw = targetWord.trim().toLowerCase();
  if (!t || !tw) return false;

  // 1. Direct whole-word regex check with non-word boundary matching
  const escaped = tw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const boundaryRegex = new RegExp(`(?:^|[^a-zA-Z0-9_-])${escaped}(?:$|[^a-zA-Z0-9_-])`, 'i');
  if (boundaryRegex.test(t)) return true;

  // 2. Singular / Plural regex check
  const singular = normalizeWordForComparison(tw);
  const plural = getPluralForComparison(tw);
  if (singular && singular !== tw) {
    const escSingular = singular.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(?:^|[^a-zA-Z0-9_-])${escSingular}(?:$|[^a-zA-Z0-9_-])`, 'i').test(t)) return true;
  }
  if (plural && plural !== tw) {
    const escPlural = plural.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(?:^|[^a-zA-Z0-9_-])${escPlural}(?:$|[^a-zA-Z0-9_-])`, 'i').test(t)) return true;
  }

  // 3. Multi-word phrase check (e.g. phrasal verbs "look into", "bring up")
  if (tw.includes(" ")) {
    const phrasePattern = tw.split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
    if (new RegExp(`(?:^|[^a-zA-Z0-9_-])${phrasePattern}(?:$|[^a-zA-Z0-9_-])`, 'i').test(t)) {
      return true;
    }
  }

  // 4. Token-by-token check with grammatical inflections and equivalence
  const tokens = t.replace(/[^\w\s-]/g, ' ').split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    if (areWordsEquivalent(token, tw)) return true;
    if (singular && normalizeWordForComparison(token) === singular) return true;
    if (tw.length >= 4) {
      const baseStem = tw.endsWith('e') ? tw.slice(0, -1) : tw;
      if (
        token === `${baseStem}ed` ||
        token === `${baseStem}ing` ||
        token === `${tw}s` ||
        token === `${tw}es` ||
        token === `${tw}d`
      ) {
        return true;
      }
    }
  }

  return false;
}



