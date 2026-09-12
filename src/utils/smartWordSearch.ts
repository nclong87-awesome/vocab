import { Word } from "../types";
import { areWordsEquivalent } from "./wordNormalization";

export type WordSearchFilter = "all" | "starred" | "review" | "mastered" | "incomplete";

export type MatchedField = "word" | "translation" | "definition" | "example" | "category" | "partOfSpeech" | "pronunciation";

export interface ScoredSearchResult {
  word: Word;
  score: number;
  matchedFields: MatchedField[];
}

/**
 * Calculates Damerau-Levenshtein distance between two strings.
 * Accounts for insertions, deletions, substitutions, and adjacent transpositions.
 */
export function damerauLevenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;

  const lenA = a.length;
  const lenB = b.length;
  const matrix: number[][] = Array.from({ length: lenA + 1 }, () => new Array(lenB + 1).fill(0));

  for (let i = 0; i <= lenA; i++) matrix[i][0] = i;
  for (let j = 0; j <= lenB; j++) matrix[0][j] = j;

  for (let i = 1; i <= lenA; i++) {
    for (let j = 1; j <= lenB; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,       // deletion
        matrix[i][j - 1] + 1,       // insertion
        matrix[i - 1][j - 1] + cost  // substitution
      );

      // Transposition check
      if (
        i > 1 &&
        j > 1 &&
        a[i - 1] === b[j - 2] &&
        a[i - 2] === b[j - 1]
      ) {
        matrix[i][j] = Math.min(matrix[i][j], matrix[i - 2][j - 2] + 1);
      }
    }
  }

  return matrix[lenA][lenB];
}

/**
 * Calculates maximum allowed edit distance based on query length.
 */
export function getMaxAllowedDistance(queryLength: number): number {
  if (queryLength <= 2) return 0; // strict matching for 1-2 chars
  if (queryLength <= 5) return 1; // 1 typo allowed for 3-5 chars
  if (queryLength <= 9) return 2; // 2 typos allowed for 6-9 chars
  return 3; // 3 typos allowed for 10+ chars
}

export interface FuzzyMatchResult {
  isMatch: boolean;
  distance: number;
  matchType: "exact" | "prefix" | "contains" | "fuzzy";
}

/**
 * Evaluates match quality between a target text field and a user query.
 */
export function checkFuzzyMatch(target: string, query: string): FuzzyMatchResult {
  if (!target || !query) return { isMatch: false, distance: 999, matchType: "fuzzy" };

  const normTarget = removeAccents(target.toLowerCase());
  const normQuery = removeAccents(query.toLowerCase());

  if (normTarget === normQuery) {
    return { isMatch: true, distance: 0, matchType: "exact" };
  }
  if (normTarget.startsWith(normQuery)) {
    return { isMatch: true, distance: 0, matchType: "prefix" };
  }
  if (normTarget.includes(normQuery)) {
    return { isMatch: true, distance: 0, matchType: "contains" };
  }

  const qLen = normQuery.length;
  const maxAllowed = getMaxAllowedDistance(qLen);
  if (maxAllowed === 0) {
    return { isMatch: false, distance: 999, matchType: "fuzzy" };
  }

  // Check full string Damerau-Levenshtein
  let bestDistance = damerauLevenshteinDistance(normTarget, normQuery);

  // Split target into word tokens
  const tokens = normTarget.split(/[\s,./\\_()\-:]+/).filter(Boolean);

  for (const token of tokens) {
    if (token === normQuery) return { isMatch: true, distance: 0, matchType: "exact" };
    if (token.startsWith(normQuery)) return { isMatch: true, distance: 0, matchType: "prefix" };
    if (token.includes(normQuery)) return { isMatch: true, distance: 0, matchType: "contains" };

    const tokenDist = damerauLevenshteinDistance(token, normQuery);
    if (tokenDist < bestDistance) {
      bestDistance = tokenDist;
    }

    // Prefix fuzzy check for tokens longer than query
    if (token.length > normQuery.length) {
      const tokenPrefix = token.substring(0, normQuery.length + 1);
      const prefixDist = damerauLevenshteinDistance(tokenPrefix, normQuery);
      if (prefixDist < bestDistance) {
        bestDistance = prefixDist;
      }
    }
  }

  if (bestDistance <= maxAllowed) {
    return { isMatch: true, distance: bestDistance, matchType: "fuzzy" };
  }

  return { isMatch: false, distance: bestDistance, matchType: "fuzzy" };
}
export function removeAccents(str: string): string {
  if (!str) return "";
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .trim();
}

/**
 * Checks if a word is due for spaced-repetition review
 */
export function isWordDueForReview(word: Word): boolean {
  if (word.completed === false) return true;
  if (!word.learned && (word.strength === undefined || word.strength < 70)) return true;
  if (!word.lastReviewed) return true;
  
  // If reviewed more than 2 days ago and strength is not high
  const lastRev = new Date(word.lastReviewed).getTime();
  if (!isNaN(lastRev)) {
    const hoursSince = (Date.now() - lastRev) / (1000 * 60 * 60);
    if (hoursSince > 48 && (word.strength || 0) < 85) return true;
  }
  return false;
}

/**
 * Intelligent multi-field search and ranking engine for vocabulary words.
 */
export function searchWordsSmart(
  words: Word[],
  query: string,
  filter: WordSearchFilter = "all"
): ScoredSearchResult[] {
  if (!Array.isArray(words) || words.length === 0) return [];

  const rawQuery = query.trim().toLowerCase();

  // Apply active category/status filter first
  let candidateWords = words;
  if (filter === "starred") {
    candidateWords = candidateWords.filter(w => Boolean(w.starred));
  } else if (filter === "review") {
    candidateWords = candidateWords.filter(w => isWordDueForReview(w));
  } else if (filter === "mastered") {
    candidateWords = candidateWords.filter(w => Boolean(w.learned) || (w.strength !== undefined && w.strength >= 80));
  } else if (filter === "incomplete") {
    candidateWords = candidateWords.filter(w => w.completed === false);
  }

  // If query is blank, return words sorted by priority (e.g. due for review, starred, newest)
  if (!rawQuery) {
    return candidateWords.map((word, idx) => {
      let score = 50;
      if (word.starred) score += 20;
      if (isWordDueForReview(word)) score += 30;
      if (word.completed === false) score += 40;
      return {
        word,
        score: score - idx * 0.1, // preserve relative order
        matchedFields: ["word" as MatchedField],
      };
    }).sort((a, b) => b.score - a.score);
  }

  const results: ScoredSearchResult[] = [];

  for (const w of candidateWords) {
    const rawWord = (w.word || "").trim().toLowerCase();
    const rawPron = (w.pronunciation || "").trim().toLowerCase().replace(/[/\[\]]/g, "");
    const rawPos = (w.partOfSpeech || "").trim().toLowerCase();
    const rawCat = (w.category || "").trim().toLowerCase();

    let score = 0;
    const matchedFields: ScoredSearchResult["matchedFields"] = [];

    // 1. Word Field Match
    const wordResult = checkFuzzyMatch(w.word || "", query);
    if (wordResult.isMatch) {
      matchedFields.push("word");
      if (wordResult.matchType === "exact") {
        score += 1000;
      } else if (areWordsEquivalent(rawWord, rawQuery)) {
        score += 900;
      } else if (wordResult.matchType === "prefix") {
        score += 550;
      } else if (wordResult.matchType === "contains") {
        score += 250;
      } else if (wordResult.matchType === "fuzzy") {
        if (wordResult.distance === 1) score += 210;
        else if (wordResult.distance === 2) score += 150;
        else score += 90;
      }
    }

    // 2. Translation Match
    if (w.translation) {
      const transResult = checkFuzzyMatch(w.translation, query);
      if (transResult.isMatch) {
        matchedFields.push("translation");
        if (transResult.matchType === "exact") score += 450;
        else if (transResult.matchType === "prefix") score += 320;
        else if (transResult.matchType === "contains") score += 180;
        else if (transResult.matchType === "fuzzy") {
          if (transResult.distance === 1) score += 140;
          else if (transResult.distance === 2) score += 90;
          else score += 50;
        }
      }
    }

    // 3. Pronunciation Match
    if (rawPron) {
      const pronResult = checkFuzzyMatch(rawPron, query);
      if (pronResult.isMatch) {
        score += Math.max(40, 120 - pronResult.distance * 20);
        matchedFields.push("pronunciation");
      }
    }

    // 4. Definition Match
    if (w.definition) {
      const defResult = checkFuzzyMatch(w.definition, query);
      if (defResult.isMatch) {
        score += Math.max(30, 100 - defResult.distance * 15);
        matchedFields.push("definition");
      }
    }

    // 5. Part of Speech / Category Match
    if (rawPos || rawCat) {
      const posResult = checkFuzzyMatch(rawPos, query);
      const catResult = checkFuzzyMatch(rawCat, query);
      if (posResult.isMatch || catResult.isMatch) {
        score += 80;
        matchedFields.push(posResult.isMatch ? "partOfSpeech" : "category");
      }
    }

    // 6. Example Sentence Match
    if (w.example) {
      const exResult = checkFuzzyMatch(w.example, query);
      if (exResult.isMatch) {
        score += Math.max(20, 60 - exResult.distance * 10);
        matchedFields.push("example");
      }
    }

    // Boosts for active learner flags
    if (score > 0) {
      if (w.starred) score += 15;
      if (isWordDueForReview(w)) score += 20;
      if (w.completed === false) score += 25;

      results.push({
        word: w,
        score,
        matchedFields: Array.from(new Set(matchedFields)),
      });
    }
  }

  // Sort descending by calculated relevance score
  return results.sort((a, b) => b.score - a.score);
}
