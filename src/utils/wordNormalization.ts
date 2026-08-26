import pluralize from "pluralize";
import { Word } from "../types";

/**
 * Normalizes a word for loose vocabulary comparison.
 * Trims whitespace, converts to lowercase, and converts to singular form.
 */
export function normalizeWordForComparison(word?: string | null): string {
  if (!word || typeof word !== "string") return "";
  const cleaned = word.trim().toLowerCase();
  if (!cleaned) return "";

  // Use pluralize.singular to get the canonical singular form
  try {
    const singular = pluralize.singular(cleaned);
    return singular || cleaned;
  } catch {
    return cleaned;
  }
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

  // 2. Normalized singular comparison
  const s1 = normalizeWordForComparison(w1);
  const s2 = normalizeWordForComparison(w2);
  if (s1 && s2 && s1 === s2) return true;

  // 3. Plural check
  try {
    const p1 = pluralize.plural(w1);
    const p2 = pluralize.plural(w2);
    if (p1 && p2 && p1 === p2) return true;
    if (p1 === w2 || p2 === w1 || s1 === w2 || s2 === w1) return true;
  } catch {
    // Fallback to strict comparison
  }

  return false;
}

/**
 * Finds a matching word in the user's collection, taking into account
 * singular and plural forms (e.g. searching "benchmarks" will find "benchmark" or vice-versa).
 */
export function findWordInCollection(words: Word[], targetWord?: string | null): Word | undefined {
  if (!words || !Array.isArray(words) || words.length === 0 || !targetWord) return undefined;
  return words.find((w) => areWordsEquivalent(w.word, targetWord));
}

/**
 * Checks if a word (or its singular/plural form) already exists in the collection.
 */
export function isWordInCollection(words: Word[], targetWord?: string | null): boolean {
  return Boolean(findWordInCollection(words, targetWord));
}
