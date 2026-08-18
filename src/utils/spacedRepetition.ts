import { Word } from "../types";
import { recordStrengthHistory, sanitizeAndHealWordHistory } from "./strengthHistoryHelpers";

export interface BaselinePracticeInfo {
  baselineStrength: number;
  lastPracticeDate: string | null;
}

/**
 * Gets the baseline strength and timestamp from the last non-decay practice/review event.
 */
export function getLastPracticeBaseline(word: Word): BaselinePracticeInfo {
  const history = word.strengthHistory || [];
  // Filter out memory_decay, created, and manual_adjust entries to find real practice events
  const practiceEntries = history.filter(
    entry => entry.reason !== "memory_decay" && entry.reason !== "created" && entry.reason !== "manual_adjust"
  );

  if (practiceEntries.length > 0) {
    const sorted = [...practiceEntries].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
    const lastPractice = sorted[sorted.length - 1];
    return {
      baselineStrength: lastPractice.strength,
      lastPracticeDate: lastPractice.timestamp
    };
  }

  // Fallback if no practice history exists yet:
  const practiceDate = word.lastReviewed || null;
  const fallbackStrength = word.learned
    ? Math.max(80, word.strength ?? 100)
    : (word.strength ?? 0);

  return {
    baselineStrength: fallbackStrength,
    lastPracticeDate: practiceDate
  };
}

/**
 * Calculates hours elapsed since the word was last reviewed or practiced.
 */
export function getHoursSinceLastReview(word: Word, now: Date = new Date()): number {
  const { lastPracticeDate } = getLastPracticeBaseline(word);
  const dateStr = lastPracticeDate || word.lastReviewed || null;
  if (!dateStr) return Infinity; // Never reviewed

  const reviewDate = new Date(dateStr);
  if (isNaN(reviewDate.getTime())) return Infinity;

  const diffMs = now.getTime() - reviewDate.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  return Math.max(0, diffHours);
}

export interface CandidateWordsOptions {
  maxCandidates?: number;
  cooldownHours?: number;
  candidatePoolSize?: number;
}

export const DEFAULT_COOLDOWN_HOURS = 72; // 3 days (72 hours)

export interface WeightedCandidate {
  word: Word;
  tier: "starred" | "memoryDecay" | "weak" | "rest";
  weight: number;
}

/**
 * Checks whether a word has ever been learned or studied (prior exposure).
 * A word is considered learned/studied if:
 * - Marked as learned (`word.learned === true`)
 * - Has been reviewed previously (`word.lastReviewed !== null`)
 * - Has memory strength > 0 (`word.strength > 0`)
 * - Has relevant study history entries (e.g. flashcard_review, quiz_correct, quiz_incorrect, mastered, etc.)
 */
export function isWordLearnedOrStudied(word: Word): boolean {
  if (word.learned) return true;
  if (word.lastReviewed) return true;
  if ((word.strength ?? 0) > 0) return true;
  if (word.strengthHistory && word.strengthHistory.length > 0) {
    const hasStudyHistory = word.strengthHistory.some(
      entry => entry.reason !== "created" && entry.reason !== "manual_adjust"
    );
    if (hasStudyHistory) return true;
  }
  return false;
}

/**
 * Assigns probability weight based on word urgency tier for learned/studied words:
 * - Starred: weight 5
 * - Memory Decay: weight 4
 * - Weak (strength < 50): weight 3
 * - Rest: weight 1
 */
export function getWordTierAndWeight(word: Word, now: Date = new Date()): {
  tier: "starred" | "memoryDecay" | "weak" | "rest";
  weight: number;
} {
  if (word.starred) {
    return { tier: "starred", weight: 5 };
  }

  const days = getDaysSinceLastReview(word, now);
  if (word.learned && (days >= 5 || (word.strength < 80 && word.lastReviewed !== null && days >= 1))) {
    return { tier: "memoryDecay", weight: 4 };
  }

  if ((word.strength ?? 0) < 50) {
    return { tier: "weak", weight: 3 };
  }

  return { tier: "rest", weight: 1 };
}

/**
 * Performs weighted random sampling without replacement from a pool of candidates using the A-Res algorithm (Efraimidis and Spirakis).
 */
export function sampleWeightedCandidates(candidates: WeightedCandidate[], count: number): Word[] {
  if (!candidates || candidates.length === 0) return [];

  const sampled = candidates.map(item => {
    // Generate key u^(1/w) where u ~ Uniform(0, 1)
    const u = Math.max(Number.EPSILON, Math.random());
    const key = Math.pow(u, 1 / Math.max(0.1, item.weight));
    return { word: item.word, key };
  });

  sampled.sort((a, b) => b.key - a.key);
  return sampled.slice(0, count).map(s => s.word);
}

/**
 * Selects candidate words for a new quiz based on recency, memory decay, and cooldown rules.
 * Strictly selects from words that have been learned or studied previously (excluding unlearned words),
 * gathers a candidate pool across non-cooldown priority tiers (starred: 5, memoryDecay: 4, weak: 3, rest: 1),
 * and applies weighted random sampling (A-Res algorithm) to pick candidate words.
 */
export function getQuizCandidateWords(words: Word[], options: CandidateWordsOptions = {}): Word[] {
  if (!words || words.length === 0) return [];

  const { maxCandidates = 10, cooldownHours = DEFAULT_COOLDOWN_HOURS, candidatePoolSize = 30 } = options;
  const now = new Date();

  // 1. Strictly filter for words that have actually been learned or studied before
  const learnedWords = words.filter(isWordLearnedOrStudied);
  if (learnedWords.length === 0) {
    return [];
  }

  // 2. Filter out words that were reviewed recently (within cooldownHours)
  const eligibleWords = learnedWords.filter(word => {
    if (!word.lastReviewed) return true; // Learned but hasn't had a spaced review yet -> eligible
    const hours = getHoursSinceLastReview(word, now);
    return hours >= cooldownHours;
  });

  // If fewer than 2 eligible words when cooldown > 0, return [] to trigger "No words to practice today" state
  if (eligibleWords.length < 2 && cooldownHours > 0) {
    return [];
  }
  if (eligibleWords.length === 0) {
    return [];
  }

  // 3. Categorize eligible learned words into priority tiers
  const starred: Word[] = [];
  const memoryDecay: Word[] = [];
  const weak: Word[] = [];
  const rest: Word[] = [];

  for (const word of eligibleWords) {
    const { tier } = getWordTierAndWeight(word, now);
    if (tier === "starred") starred.push(word);
    else if (tier === "memoryDecay") memoryDecay.push(word);
    else if (tier === "weak") weak.push(word);
    else rest.push(word);
  }

  // Helper to shuffle an array randomly
  const shuffle = <T>(arr: T[]): T[] => [...arr].sort(() => 0.5 - Math.random());

  // 4. Gather candidate pool across all non-cooldown tiers
  const candidatePool: WeightedCandidate[] = [];
  const addTierToPool = (tierWords: Word[], tier: "starred" | "memoryDecay" | "weak" | "rest", weight: number) => {
    const shuffled = shuffle(tierWords);
    for (const word of shuffled) {
      if (candidatePool.length >= candidatePoolSize) break;
      candidatePool.push({ word, tier, weight });
    }
  };

  addTierToPool(starred, "starred", 5);
  addTierToPool(memoryDecay, "memoryDecay", 4);
  addTierToPool(weak, "weak", 3);
  addTierToPool(rest, "rest", 1);

  // 5. Perform Weighted Random Sampling from the candidate pool
  return sampleWeightedCandidates(candidatePool, maxCandidates);
}

/**
 * Calculates days elapsed since the word was last reviewed or practiced.
 */
export function getDaysSinceLastReview(word: Word, now: Date = new Date()): number {
  const { lastPracticeDate } = getLastPracticeBaseline(word);
  const dateStr = lastPracticeDate || word.lastReviewed || null;
  if (!dateStr) return 0;

  const reviewDate = new Date(dateStr);
  if (isNaN(reviewDate.getTime())) return 0;

  const diffMs = now.getTime() - reviewDate.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return Math.max(0, diffDays);
}

/**
 * Evaluates memory decay based on spaced repetition principles.
 * Returns the recalculated strength (0 to 100) and learned flag for a word.
 * Rule: Starting from the last practice baseline, strength decreases
 * by 10 points per day elapsed (1 day = -10 points).
 */
export function calculateDecayedWordStrength(word: Word, now: Date = new Date()): {
  newStrength: number;
  newLearned: boolean;
  hasDecayed: boolean;
  daysSinceReview: number;
  decayAmount: number;
} {
  const { baselineStrength } = getLastPracticeBaseline(word);
  const daysSinceReview = getDaysSinceLastReview(word, now);
  const currentStrength = word.strength ?? 0;
  
  // Memory decay applies to mastered (learned) words or words whose last practice baseline was mastered (>= 80)
  const isMasteredBaseline = word.learned || baselineStrength >= 80;
  if (!isMasteredBaseline || daysSinceReview <= 0) {
    return {
      newStrength: currentStrength,
      newLearned: word.learned,
      hasDecayed: false,
      daysSinceReview: 0,
      decayAmount: 0
    };
  }

  // Decay 10 points per day since last practice (1 day = -10 points)
  const decayAmount = daysSinceReview * 10;
  const targetStrength = Math.max(0, baselineStrength - decayAmount);

  // A word remains mastered only if strength >= 80
  const newLearned = targetStrength >= 80;

  // Has decayed if target strength is strictly lower than current strength,
  // or if learned status changed from true to false due to decay
  const hasDecayed = targetStrength < currentStrength || (word.learned && !newLearned);

  return {
    newStrength: targetStrength,
    newLearned,
    hasDecayed,
    daysSinceReview,
    decayAmount
  };
}

/**
 * Sweeps an array of words and recalculates strength for any words affected by memory decay.
 */
export function recalculateWordsMemoryDecay(words: Word[], now: Date = new Date()): {
  updatedWords: Word[];
  decayedCount: number;
} {
  let decayedCount = 0;

  const updatedWords = words.map(word => {
    const { newStrength, newLearned, hasDecayed, daysSinceReview, decayAmount } = calculateDecayedWordStrength(word, now);
    if (hasDecayed) {
      decayedCount++;
      const { lastPracticeDate } = getLastPracticeBaseline(word);
      const baselineMs = lastPracticeDate ? new Date(lastPracticeDate).getTime() : 0;
      const stableId = `hist-decay-${word.id || word.word}-${baselineMs}-${daysSinceReview}`;
      const note = `Memory decayed by -${decayAmount}% (${daysSinceReview} day${daysSinceReview > 1 ? 's' : ''} since last practice at -10%/day)`;
      return recordStrengthHistory(word, newStrength, "memory_decay", note, stableId);
    } else if (newStrength !== word.strength || newLearned !== word.learned) {
      // Self-heal corrupted strength levels from previous reloads
      return sanitizeAndHealWordHistory(word, newStrength, newLearned);
    }
    return word;
  });

  return { updatedWords, decayedCount };
}

/**
 * Checks if a word has an unresolved quiz mistake (i.e. its most recent practice/review was a quiz error).
 */
export function hasUnresolvedQuizMistake(word: Word): boolean {
  const history = word.strengthHistory || [];
  const practiceEntries = history.filter(entry => entry.reason !== "memory_decay");
  if (practiceEntries.length === 0) return false;
  const lastPractice = practiceEntries[practiceEntries.length - 1];
  return lastPractice?.reason === "quiz_incorrect";
}

/**
 * Determines whether a word is eligible as a candidate for flashcard study:
 * 1. Has not been reviewed recently (within cooldownHours, default 72 hours / 3 days)
 * 2. Meets at least one of the following criteria:
 *    a. Has never been reviewed/practiced before (!word.lastReviewed or no practice baseline)
 *    b. Has an unresolved quiz error (the most recent practice event was 'quiz_incorrect')
 *    c. Is unlearned/unmastered (!word.learned) and has passed cooldown
 *    d. Mastered word that hasn't been practiced/reviewed in over 7 days (diffDays > 7)
 */
export function isFlashcardCandidate(word: Word, now: Date = new Date(), cooldownHours: number = DEFAULT_COOLDOWN_HOURS): boolean {
  const { lastPracticeDate } = getLastPracticeBaseline(word);
  const isNeverPracticed = !lastPracticeDate && !word.lastReviewed;

  // Condition 1: Never reviewed / never practiced before (brand new word) -> ALWAYS eligible immediately!
  if (isNeverPracticed) {
    return true;
  }

  // Condition 2: Has an unresolved quiz mistake (most recent practice was a quiz error)
  if (hasUnresolvedQuizMistake(word)) {
    return true;
  }

  // 0. Cooldown check: If reviewed within cooldownHours, exclude from candidates
  if (cooldownHours > 0) {
    const hoursSinceReview = getHoursSinceLastReview(word, now);
    if (hoursSinceReview < cooldownHours) {
      return false;
    }
  }

  // Condition 3: Unlearned / unmastered word that has passed cooldown
  if (!word.learned) {
    return true;
  }

  // Condition 4: Mastered word that hasn't been used for flashcard or quiz in over 7 days
  const daysSinceReview = getDaysSinceLastReview(word, now);
  if (daysSinceReview > 7) {
    return true;
  }

  return false;
}

/**
 * Selects candidate words for flashcard study (default up to 5) strictly from words meeting
 * the candidate criteria (cooldown passed, never learned, unresolved quiz mistake, or idle > 7 days).
 * Returns empty array if no words meet the conditions.
 */
export function getCandidateWordsForFlashcards(
  words: Word[],
  count: number = 5,
  now: Date = new Date(),
  cooldownHours: number = DEFAULT_COOLDOWN_HOURS
): Word[] {
  if (!words || words.length === 0) return [];

  // Filter ONLY words that meet the candidate criteria (including cooldown)
  const eligibleWords = words.filter(word => isFlashcardCandidate(word, now, cooldownHours));

  if (eligibleWords.length === 0) {
    return [];
  }

  // Categorize eligible words by priority to give the most impactful words first:
  // 1. Words with unresolved quiz errors (urgent remedial review)
  // 2. Never learned / unreviewed words
  // 3. Words idle > 7 days
  const quizErrorWords: Word[] = [];
  const neverLearnedWords: Word[] = [];
  const idleSevenDaysWords: Word[] = [];

  for (const word of eligibleWords) {
    if (hasUnresolvedQuizMistake(word)) {
      quizErrorWords.push(word);
    } else if (!word.learned || !word.lastReviewed) {
      neverLearnedWords.push(word);
    } else {
      idleSevenDaysWords.push(word);
    }
  }

  // Shuffle within categories for variety
  const shuffle = <T>(arr: T[]): T[] => [...arr].sort(() => 0.5 - Math.random());
  const prioritized = [
    ...shuffle(quizErrorWords),
    ...shuffle(neverLearnedWords),
    ...shuffle(idleSevenDaysWords),
  ];

  return prioritized.slice(0, count);
}

/**
 * Selects a candidate word for flashcard viewing strictly from eligible words.
 */
export function getCandidateWordForFlashcard(words: Word[], now: Date = new Date(), cooldownHours: number = DEFAULT_COOLDOWN_HOURS): Word | null {
  if (!words || words.length === 0) return null;
  const candidates = getCandidateWordsForFlashcards(words, 1, now, cooldownHours);
  return candidates[0] || null;
}

/**
 * Checks whether a word is an eligible potential candidate for taking a quiz.
 * A word is a quiz candidate if it has prior exposure (learned or studied before)
 * and is not currently in review cooldown (>= cooldownHours since last review, or unreviewed since initial study).
 */
export function isQuizCandidate(word: Word, now: Date = new Date(), cooldownHours: number = DEFAULT_COOLDOWN_HOURS): boolean {
  if (!isWordLearnedOrStudied(word)) return false;
  if (!word.lastReviewed) return true;
  const hours = getHoursSinceLastReview(word, now);
  return hours >= cooldownHours;
}

/**
 * Gets all words that are potential candidates for quizzes.
 */
export function getQuizCandidates(words: Word[], now: Date = new Date(), cooldownHours: number = DEFAULT_COOLDOWN_HOURS): Word[] {
  if (!words || words.length === 0) return [];
  return words.filter(word => isQuizCandidate(word, now, cooldownHours));
}

/**
 * Gets all words that are potential candidates for flashcards.
 */
export function getFlashcardCandidates(words: Word[], now: Date = new Date(), cooldownHours: number = DEFAULT_COOLDOWN_HOURS): Word[] {
  if (!words || words.length === 0) return [];
  return words.filter(word => isFlashcardCandidate(word, now, cooldownHours));
}
