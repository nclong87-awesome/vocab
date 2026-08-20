import { Word, StrengthHistoryReason, StrengthHistoryTuple } from "../types";
import { recordStrengthHistory, sanitizeAndHealWordHistory } from "./strengthHistoryHelpers";

export interface BaselinePracticeInfo {
  baselineStrength: number;
  lastPracticeDate: string | null;
}

/**
 * Gets the baseline strength and timestamp from the last non-decay practice/review event.
 */
export function getLastPracticeBaseline(word: Word): BaselinePracticeInfo {
  const history: StrengthHistoryTuple[] = (word.strengthHistory || []).filter(
    (t): t is StrengthHistoryTuple => Array.isArray(t) && t.length >= 3
  );
  // Filter out memory_decay, created, and manual_adjust entries to find real practice events
  const practiceEntries = history.filter(
    t => t[2] !== "memory_decay" && t[2] !== "created" && t[2] !== "manual_adjust"
  );

  if (practiceEntries.length > 0) {
    const sorted = [...practiceEntries].sort((a, b) => a[0] - b[0]);
    const lastPractice = sorted[sorted.length - 1];
    const ms = lastPractice[0] > 1e11 ? lastPractice[0] : lastPractice[0] * 1000;
    return {
      baselineStrength: lastPractice[1],
      lastPracticeDate: new Date(ms).toISOString()
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

/**
 * Adaptive Spaced Repetition Algorithm based on Strength History:
 * Computes the optimal review interval (in hours) before a word should be reintroduced.
 *
 * Factors evaluated from strength history:
 * 1. Recent Mistake Factor: If the last practice was incorrect, shortens interval to 4-12 hours for urgent remediation.
 * 2. Consecutive Success Streak: Successive correct reviews expand retention interval exponentially (1d -> 2d -> 4d -> 7d -> 14d -> 30d).
 * 3. Memory Strength Modulation: Higher bounded memory strength expands the interval (firmly mastered words last longer).
 * 4. Priority / Starred Modifier: Starred words receive a 25% interval reduction to surface sooner for extra practice.
 */
export function calculateNextReviewIntervalHours(
  word: Word,
  overrideStrength?: number,
  overrideReason?: StrengthHistoryReason
): number {
  const history: StrengthHistoryTuple[] = (word.strengthHistory || []).filter(
    (t): t is StrengthHistoryTuple => Array.isArray(t) && t.length >= 3
  );
  const currentStrength = overrideStrength !== undefined ? overrideStrength : (word.strength ?? 0);

  // Filter out passive decay and manual adjustments to focus on active learning events
  const activeEntries = history.filter(
    t => t[2] !== "memory_decay" && t[2] !== "manual_adjust"
  );

  // Determine last practice reason (using override if provided)
  const lastEntry = activeEntries.length > 0 ? activeEntries[activeEntries.length - 1] : null;
  const effectiveReason = overrideReason || lastEntry?.[2] || (word.learned ? "mastered" : "created");

  // 1. If recent practice was an incorrect quiz answer, provide fast remedial spacing (4 - 12 hours)
  if (effectiveReason === "quiz_incorrect") {
    if (currentStrength < 30) return 4;
    if (currentStrength < 60) return 8;
    return 12;
  }

  // 2. Count consecutive successful practice sessions working backwards from history
  let consecutiveSuccesses = 0;
  for (let i = activeEntries.length - 1; i >= 0; i--) {
    const tuple = activeEntries[i];
    const reason = tuple[2];
    if (reason === "quiz_incorrect" || reason === "unmastered") {
      break;
    }
    if (reason === "quiz_correct" || reason === "flashcard_review" || reason === "mastered") {
      consecutiveSuccesses++;
    }
  }

  // If calculating for a new correct practice event right now, count it
  if (overrideReason === "quiz_correct" || overrideReason === "flashcard_review" || overrideReason === "mastered") {
    if (lastEntry?.[2] === "quiz_incorrect") {
      consecutiveSuccesses = 1;
    }
  }

  // 3. Base interval in hours calculated from retention streak:
  let baseIntervalHours: number;
  if (consecutiveSuccesses <= 0) {
    baseIntervalHours = currentStrength >= 50 ? 18 : 12;
  } else if (consecutiveSuccesses === 1) {
    baseIntervalHours = 24; // 1 day
  } else if (consecutiveSuccesses === 2) {
    baseIntervalHours = 48; // 2 days
  } else if (consecutiveSuccesses === 3) {
    baseIntervalHours = 96; // 4 days
  } else if (consecutiveSuccesses === 4) {
    baseIntervalHours = 168; // 7 days (1 week)
  } else if (consecutiveSuccesses === 5) {
    baseIntervalHours = 336; // 14 days (2 weeks)
  } else {
    // Mature long-term retention: exponential expansion up to 30 days (720 hours)
    baseIntervalHours = Math.min(720, Math.round(336 * Math.pow(1.5, consecutiveSuccesses - 5)));
  }

  // 4. Strength Multiplier: (0.6x for 0% strength to 1.3x for 100% strength)
  const strengthMultiplier = Math.max(0.6, Math.min(1.3, 0.6 + (currentStrength / 100) * 0.7));
  let calculatedHours = baseIntervalHours * strengthMultiplier;

  // 5. Starred Modifier: If user marked this word with a star, review 25% sooner
  if (word.starred) {
    calculatedHours *= 0.75;
  }

  // Bound interval between 4 hours and 720 hours (30 days)
  return Math.max(4, Math.min(720, Math.round(calculatedHours)));
}

/**
 * Calculates the exact ISO date and time when the word is scheduled for its next review.
 */
export function calculateNextReviewDate(
  word: Word,
  overrideStrength?: number,
  overrideReason?: StrengthHistoryReason,
  fromDate: Date = new Date()
): string {
  const intervalHours = calculateNextReviewIntervalHours(word, overrideStrength, overrideReason);
  const targetTime = fromDate.getTime() + intervalHours * 60 * 60 * 1000;
  return new Date(targetTime).toISOString();
}

/**
 * Checks whether a word has reached or passed its scheduled next review time.
 */
export function isWordEligibleForReview(word: Word, now: Date = new Date()): boolean {
  // If exact nextReviewDate is present, check against it
  if (word.nextReviewDate) {
    const reviewTime = new Date(word.nextReviewDate).getTime();
    if (!isNaN(reviewTime)) {
      return now.getTime() >= reviewTime;
    }
  }

  // Fallback for words without nextReviewDate:
  // If never reviewed, it's eligible
  if (!word.lastReviewed) {
    return true;
  }

  // Compute dynamic next review date from history baseline
  const { lastPracticeDate } = getLastPracticeBaseline(word);
  const baselineStr = lastPracticeDate || word.lastReviewed;
  if (!baselineStr) return true;

  const baselineTime = new Date(baselineStr);
  if (isNaN(baselineTime.getTime())) return true;

  const intervalHours = calculateNextReviewIntervalHours(word);
  const scheduledTime = baselineTime.getTime() + intervalHours * 60 * 60 * 1000;
  return now.getTime() >= scheduledTime;
}

export interface NextReviewInfo {
  isDue: boolean;
  nextReviewDate: string;
  remainingHours: number;
  remainingDays: number;
  formattedCountdown: string;
  intervalHours: number;
}

/**
 * Returns human-readable review scheduling details and countdown for a word.
 */
export function getNextReviewInfo(word: Word, now: Date = new Date()): NextReviewInfo {
  let targetIso = word.nextReviewDate;
  if (!targetIso) {
    const { lastPracticeDate } = getLastPracticeBaseline(word);
    const fromDate = lastPracticeDate ? new Date(lastPracticeDate) : new Date();
    targetIso = calculateNextReviewDate(word, word.strength, undefined, fromDate);
  }

  const targetDate = new Date(targetIso);
  const diffMs = targetDate.getTime() - now.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  const diffDays = Math.ceil(diffHours / 24);
  const isDue = diffMs <= 0;

  let formattedCountdown = "Ready for Review";
  if (!isDue) {
    if (diffHours < 1) {
      const minutes = Math.max(1, Math.round(diffMs / (1000 * 60)));
      formattedCountdown = `In ${minutes}m`;
    } else if (diffHours < 24) {
      formattedCountdown = `In ${Math.round(diffHours)}h`;
    } else if (diffDays === 1) {
      formattedCountdown = `In 1 day`;
    } else if (diffDays < 7) {
      formattedCountdown = `In ${diffDays} days`;
    } else {
      const weeks = Math.round(diffDays / 7);
      formattedCountdown = weeks <= 1 ? `In 1 week` : `In ${weeks} weeks`;
    }
  }

  return {
    isDue,
    nextReviewDate: targetIso,
    remainingHours: Math.max(0, diffHours),
    remainingDays: Math.max(0, diffDays),
    formattedCountdown,
    intervalHours: calculateNextReviewIntervalHours(word)
  };
}

export interface CandidateWordsOptions {
  maxCandidates?: number;
  candidatePoolSize?: number;
}

export interface WeightedCandidate {
  word: Word;
  tier: "starred" | "memoryDecay" | "weak" | "rest";
  weight: number;
}

/**
 * Checks whether a word has ever been learned or studied (prior exposure).
 */
export function isWordLearnedOrStudied(word: Word): boolean {
  if (word.learned) return true;
  if (word.lastReviewed) return true;
  if ((word.strength ?? 0) > 0) return true;
  if (word.strengthHistory && word.strengthHistory.length > 0) {
    const hasStudyHistory = word.strengthHistory.some(
      t => Array.isArray(t) && t[2] !== "created" && t[2] !== "manual_adjust"
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
 * Performs weighted random sampling without replacement from a pool of candidates using the A-Res algorithm.
 */
export function sampleWeightedCandidates(candidates: WeightedCandidate[], count: number): Word[] {
  if (!candidates || candidates.length === 0) return [];

  const sampled = candidates.map(item => {
    const u = Math.max(Number.EPSILON, Math.random());
    const key = Math.pow(u, 1 / Math.max(0.1, item.weight));
    return { word: item.word, key };
  });

  sampled.sort((a, b) => b.key - a.key);
  return sampled.slice(0, count).map(s => s.word);
}

/**
 * Selects candidate words for a new quiz based on dynamic spaced repetition eligibility.
 * Strictly selects from words that have been learned or studied previously and are due for review (isWordEligibleForReview),
 * gathers a candidate pool across priority tiers (starred: 5, memoryDecay: 4, weak: 3, rest: 1),
 * and applies weighted random sampling to pick candidate words.
 */
export function getQuizCandidateWords(words: Word[], options: CandidateWordsOptions = {}): Word[] {
  if (!words || words.length === 0) return [];

  const { maxCandidates = 10, candidatePoolSize = 30 } = options;
  const now = new Date();

  // 1. Strictly filter for words that have actually been learned or studied before
  const learnedWords = words.filter(isWordLearnedOrStudied);
  if (learnedWords.length === 0) {
    return [];
  }

  // 2. Filter for words whose dynamic nextReviewDate is reached/due
  const eligibleWords = learnedWords.filter(word => isWordEligibleForReview(word, now));

  // If fewer than 2 eligible words, return [] to allow falling back to flashcard study / word addition
  if (eligibleWords.length < 2) {
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

  // 4. Gather candidate pool across all priority tiers
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
  const history: StrengthHistoryTuple[] = (word.strengthHistory || []).filter(
    (t): t is StrengthHistoryTuple => Array.isArray(t) && t.length >= 3
  );
  const practiceEntries = history.filter(t => t[2] !== "memory_decay");
  if (practiceEntries.length === 0) return false;
  const lastPractice = practiceEntries[practiceEntries.length - 1];
  return lastPractice?.[2] === "quiz_incorrect";
}

/**
 * Determines whether a word is eligible as a candidate for flashcard study:
 * 1. Has never been reviewed/practiced before (!word.lastReviewed or no practice baseline) -> ALWAYS eligible immediately.
 * 2. Has an unresolved quiz error (the most recent practice event was 'quiz_incorrect') -> ALWAYS eligible immediately for remedial study.
 * 3. Has reached its calculated dynamic review date (isWordEligibleForReview) or passed cooldown.
 * 4. Mastered word that hasn't been practiced/reviewed in over 7 days (diffDays > 7) or has decayed.
 */
export function isFlashcardCandidate(word: Word, now: Date = new Date(), customCooldownHours?: number): boolean {
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

  // Custom cooldown override if explicitly passed (> 0)
  if (customCooldownHours !== undefined && customCooldownHours > 0) {
    const hoursSinceReview = getHoursSinceLastReview(word, now);
    if (hoursSinceReview < customCooldownHours) {
      return false;
    }
  } else {
    // Dynamic eligibility check based on word's scheduled nextReviewDate
    if (!isWordEligibleForReview(word, now)) {
      return false;
    }
  }

  // Condition 3: Unlearned / unmastered word that is eligible
  if (!word.learned) {
    return true;
  }

  // Condition 4: Mastered word that hasn't been used for flashcard or quiz in over 7 days or is due
  const daysSinceReview = getDaysSinceLastReview(word, now);
  if (daysSinceReview > 7 || isWordEligibleForReview(word, now)) {
    return true;
  }

  return false;
}

/**
 * Selects candidate words for flashcard study (default up to 3) strictly from words meeting
 * the dynamic candidate criteria (scheduled date reached, never learned, unresolved quiz mistake, or idle > 7 days).
 * Returns empty array if no words meet the conditions.
 */
export function getCandidateWordsForFlashcards(
  words: Word[],
  count: number = 3,
  now: Date = new Date(),
  customCooldownHours?: number
): Word[] {
  if (!words || words.length === 0) return [];

  // Filter ONLY words that meet the candidate criteria
  const eligibleWords = words.filter(word => isFlashcardCandidate(word, now, customCooldownHours));

  if (eligibleWords.length === 0) {
    return [];
  }

  // Categorize eligible words by priority to give the most impactful words first:
  // 1. Words with unresolved quiz errors (urgent remedial review)
  // 2. Never learned / unreviewed words
  // 3. Words idle > 7 days or memory decayed
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
export function getCandidateWordForFlashcard(words: Word[], now: Date = new Date(), customCooldownHours?: number): Word | null {
  if (!words || words.length === 0) return null;
  const candidates = getCandidateWordsForFlashcards(words, 1, now, customCooldownHours);
  return candidates[0] || null;
}

/**
 * Checks whether a word is an eligible potential candidate for taking a quiz.
 * A word is a quiz candidate if it has prior exposure (learned or studied before)
 * and has reached its scheduled review date according to its strength history.
 */
export function isQuizCandidate(word: Word, now: Date = new Date(), customCooldownHours?: number): boolean {
  if (!isWordLearnedOrStudied(word)) return false;
  if (!word.lastReviewed) return true;
  if (customCooldownHours !== undefined && customCooldownHours > 0) {
    const hours = getHoursSinceLastReview(word, now);
    return hours >= customCooldownHours;
  }
  return isWordEligibleForReview(word, now);
}

/**
 * Gets all words that are potential candidates for quizzes.
 */
export function getQuizCandidates(words: Word[], now: Date = new Date(), customCooldownHours?: number): Word[] {
  if (!words || words.length === 0) return [];
  return words.filter(word => isQuizCandidate(word, now, customCooldownHours));
}

/**
 * Gets all words that are potential candidates for flashcards.
 */
export function getFlashcardCandidates(words: Word[], now: Date = new Date(), customCooldownHours?: number): Word[] {
  if (!words || words.length === 0) return [];
  return words.filter(word => isFlashcardCandidate(word, now, customCooldownHours));
}
