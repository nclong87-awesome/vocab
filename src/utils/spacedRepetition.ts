import { Word, StrengthHistoryReason, StrengthHistoryTuple } from "../types";
import { recordStrengthHistory, sanitizeAndHealWordHistory } from "./strengthHistoryHelpers";
import { areWordsEquivalent } from "./wordNormalization";

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
    const sorted = [...practiceEntries].sort((a, b) => (a?.[0] ?? 0) - (b?.[0] ?? 0));
    const lastPractice = sorted[sorted.length - 1];
    if (lastPractice && lastPractice.length >= 2) {
      const ms = lastPractice[0] > 1e11 ? lastPractice[0] : lastPractice[0] * 1000;
      return {
        baselineStrength: lastPractice[1],
        lastPracticeDate: new Date(ms).toISOString()
      };
    }
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
 * 2. Consecutive Success Streak: Successive correct reviews expand retention interval by full days (1d -> 2d -> 4d -> 7d -> 14d -> 30d).
 * 3. Memory Strength Modulation: Higher memory strength safely scales multi-day intervals while preserving a minimum 1-day (24h) baseline for correct reviews.
 * 4. Priority / Starred Modifier: Starred words receive an interval reduction to surface sooner for extra practice.
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
    if (reason === "quiz_correct" || reason === "mastered") {
      consecutiveSuccesses++;
    }
  }

  // If calculating for a new correct practice event right now, count it
  if (overrideReason === "quiz_correct" || overrideReason === "mastered") {
    if (lastEntry?.[2] === "quiz_incorrect") {
      consecutiveSuccesses = 1;
    }
  }

  // 3. Positive success streak: Schedule reviews in day increments (minimum 24 hours / 1 day)
  // This keeps review intervals aligned with daily study routines instead of scheduling odd middle-of-the-night hours.
  if (consecutiveSuccesses >= 1) {
    let baseDays: number;
    if (consecutiveSuccesses === 1) {
      baseDays = 1; // 1 day (24 hours)
    } else if (consecutiveSuccesses === 2) {
      baseDays = 2; // 2 days (48 hours)
    } else if (consecutiveSuccesses === 3) {
      baseDays = 4; // 4 days (96 hours)
    } else if (consecutiveSuccesses === 4) {
      baseDays = 7; // 7 days (1 week)
    } else if (consecutiveSuccesses === 5) {
      baseDays = 14; // 14 days (2 weeks)
    } else {
      // Mature long-term retention: exponential expansion up to 30 days
      baseDays = Math.min(30, Math.round(14 * Math.pow(1.5, consecutiveSuccesses - 5)));
    }

    // For positive streaks, strength scales retention outward (1.0x at low/normal strength up to 1.3x at 100% strength)
    // Never shrinks below 1 day (24 hours) for a correct answer
    const streakStrengthMultiplier = Math.max(1.0, Math.min(1.3, 0.7 + (currentStrength / 100) * 0.6));
    let calculatedDays = Math.max(1, Math.round(baseDays * streakStrengthMultiplier));

    // Starred modifier: if user marked word as starred, review sooner if > 1 day
    if (word.starred && calculatedDays > 1) {
      calculatedDays = Math.max(1, Math.round(calculatedDays * 0.75));
    }

    return Math.min(720, calculatedDays * 24);
  }

  // 4. Words with streak = 0 (unpracticed or neutral state without error):
  const baseIntervalHours = currentStrength >= 50 ? 18 : 12;
  const strengthMultiplier = Math.max(0.6, Math.min(1.3, 0.6 + (currentStrength / 100) * 0.7));
  let calculatedHours = baseIntervalHours * strengthMultiplier;
  if (word.starred) {
    calculatedHours *= 0.75;
  }
  return Math.max(4, Math.min(24, Math.round(calculatedHours)));
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
 * Minimum cooldown interval in hours after a review before a word can be reviewed again.
 * A word practiced recently (e.g. within 2 hours) is protected from re-testing.
 */
export const MIN_REVIEW_COOLDOWN_HOURS = 2;

/**
 * Checks whether a word was reviewed recently and is currently in its cooldown window.
 * Words on cooldown are shielded from being reused in quizzes, duels, or review fallbacks.
 */
export function isWordOnReviewCooldown(
  word: Word,
  now: Date = new Date(),
  minCooldownHours: number = MIN_REVIEW_COOLDOWN_HOURS
): boolean {
  if (!word.lastReviewed) return false;

  // Strict time check: if reviewed within the minimum cooldown window, it is on cooldown
  const hoursSince = getHoursSinceLastReview(word, now);
  if (hoursSince < minCooldownHours) {
    return true;
  }

  // Dynamic scheduled interval check: if before scheduled practice time, it is on cooldown
  const { lastPracticeDate } = getLastPracticeBaseline(word);
  const baselineStr = lastPracticeDate || word.lastReviewed;
  if (baselineStr) {
    const baselineTime = new Date(baselineStr);
    if (!isNaN(baselineTime.getTime())) {
      const intervalHours = calculateNextReviewIntervalHours(word);
      const scheduledTime = baselineTime.getTime() + intervalHours * 60 * 60 * 1000;
      if (now.getTime() < scheduledTime) {
        return true;
      }
    }
  } else if (word.nextReviewDate) {
    const nextReviewTime = new Date(word.nextReviewDate).getTime();
    if (!isNaN(nextReviewTime) && now.getTime() < nextReviewTime) {
      return true;
    }
  }

  return false;
}

/**
 * Checks whether a word has reached or passed its scheduled next review time.
 */
export function isWordEligibleForReview(
  word: Word,
  now: Date = new Date(),
  minCooldownHours: number = MIN_REVIEW_COOLDOWN_HOURS
): boolean {
  // Incomplete words are never eligible for review or practice
  if (word.completed === false) {
    return false;
  }

  // If never reviewed, it is immediately eligible for initial review/practice
  if (!word.lastReviewed) {
    return true;
  }

  // Mandatory cooldown: a word reviewed very recently is never eligible for review
  if (minCooldownHours > 0) {
    const hoursSince = getHoursSinceLastReview(word, now);
    if (hoursSince < minCooldownHours) {
      return false;
    }
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
  let targetIso: string;

  // Unreviewed words are immediately due for initial study
  if (!word.lastReviewed) {
    targetIso = new Date(now.getTime() - 1000).toISOString();
  } else {
    // Dynamic recalculation using last practice baseline and current adaptive interval
    const { lastPracticeDate } = getLastPracticeBaseline(word);
    const fromDate = lastPracticeDate ? new Date(lastPracticeDate) : new Date(word.lastReviewed);
    if (!isNaN(fromDate.getTime())) {
      targetIso = calculateNextReviewDate(word, word.strength, undefined, fromDate);
    } else {
      targetIso = word.nextReviewDate || new Date().toISOString();
    }
  }

  const targetDate = new Date(targetIso);
  const diffMs = targetDate.getTime() - now.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  const diffDays = Math.ceil(diffHours / 24);
  const isDue = !word.lastReviewed || diffMs <= 0;

  let formattedCountdown = "Ready for Review";
  if (!isDue) {
    if (diffHours < 1) {
      const minutes = Math.max(1, Math.round(diffMs / (1000 * 60)));
      formattedCountdown = `In ${minutes}m`;
    } else if (diffHours < 20) {
      formattedCountdown = `In ${Math.round(diffHours)}h`;
    } else if (diffHours <= 36) {
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
  includeUnstudied?: boolean;
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
  if (word.completed === false) return false;
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
  const result: Word[] = [];
  for (const s of sampled) {
    if (!result.some(w => w.id === s.word.id || areWordsEquivalent(w.word, s.word.word))) {
      result.push(s.word);
      if (result.length >= count) break;
    }
  }
  return result;
}

/**
 * Selects candidate words for a new quiz based on dynamic spaced repetition eligibility and vocabulary backlog.
 * 1. Prioritizes words that have been learned or studied previously and are due for review (isWordEligibleForReview),
 *    applying A-Res weighted sampling across priority tiers (starred: 5, memoryDecay: 4, weak: 3, rest: 1).
 * 2. If due review words are insufficient to meet maxCandidates (or if the user has thousands of unstudied words
 *    waiting to be practiced), seamlessly fills remaining slots from unstudied words (sorted oldest/starred first),
 *    strictly excluding any words on review cooldown.
 * 3. Never returns words that were reviewed within the mandatory review cooldown window unless no other words exist.
 */
export function getQuizCandidateWords(words: Word[], options: CandidateWordsOptions = {}): Word[] {
  if (!words || words.length === 0) return [];

  // Incomplete words are strictly excluded from practice
  const validWords = words.filter(w => w.completed !== false);
  if (validWords.length === 0) return [];

  const { maxCandidates = 10, candidatePoolSize = 30, includeUnstudied = true } = options;
  const now = new Date();

  // Helper to check if a word is already represented in a list (by id or vocabulary equivalence)
  const isAlreadySelected = (candidate: Word, list: Word[]): boolean => {
    return list.some(w => w.id === candidate.id || areWordsEquivalent(w.word, candidate.word));
  };

  // 1. Find words that have been studied and are currently due for spaced repetition review (excluding cooldown)
  const learnedWords = validWords.filter(isWordLearnedOrStudied);
  const eligibleDueWords = learnedWords.filter(word => isWordEligibleForReview(word, now, MIN_REVIEW_COOLDOWN_HOURS));

  let selectedWords: Word[] = [];

  if (eligibleDueWords.length > 0) {
    // Categorize eligible learned words into priority tiers
    const starred: Word[] = [];
    const memoryDecay: Word[] = [];
    const weak: Word[] = [];
    const rest: Word[] = [];

    for (const word of eligibleDueWords) {
      const { tier } = getWordTierAndWeight(word, now);
      if (tier === "starred") starred.push(word);
      else if (tier === "memoryDecay") memoryDecay.push(word);
      else if (tier === "weak") weak.push(word);
      else rest.push(word);
    }

    // Helper to shuffle an array randomly
    const shuffle = <T>(arr: T[]): T[] => [...arr].sort(() => 0.5 - Math.random());

    // Gather candidate pool across all priority tiers (ensuring no duplicate equivalent words in the pool)
    const candidatePool: WeightedCandidate[] = [];
    const addTierToPool = (tierWords: Word[], tier: "starred" | "memoryDecay" | "weak" | "rest", weight: number) => {
      const shuffled = shuffle(tierWords);
      for (const word of shuffled) {
        if (candidatePool.length >= candidatePoolSize) break;
        if (!candidatePool.some(item => item.word.id === word.id || areWordsEquivalent(item.word.word, word.word))) {
          candidatePool.push({ word, tier, weight });
        }
      }
    };

    addTierToPool(starred, "starred", 5);
    addTierToPool(memoryDecay, "memoryDecay", 4);
    addTierToPool(weak, "weak", 3);
    addTierToPool(rest, "rest", 1);

    // Perform Weighted Random Sampling from the candidate pool
    selectedWords = sampleWeightedCandidates(candidatePool, maxCandidates);
  }

  // 2. If we need more candidates to reach maxCandidates and includeUnstudied is enabled,
  // pull from unstudied / new words that are NOT on cooldown (strictly preventing duplicate words)
  if (includeUnstudied && selectedWords.length < maxCandidates) {
    const unstudied = validWords.filter(
      w => !isAlreadySelected(w, selectedWords) && !isWordLearnedOrStudied(w) && !isWordOnReviewCooldown(w, now, MIN_REVIEW_COOLDOWN_HOURS)
    );

    if (unstudied.length > 0) {
      const sortedUnstudied = sortUnstudiedWordsOldestFirst(unstudied);
      for (const w of sortedUnstudied) {
        if (selectedWords.length >= maxCandidates) break;
        if (!isAlreadySelected(w, selectedWords)) {
          selectedWords.push(w);
        }
      }
    }
  }

  // 3. If still under maxCandidates (e.g. all unstudied and due words are exhausted),
  // supplement with any other available words that are NOT on review cooldown (shuffled and deduplicated)
  if (selectedWords.length < maxCandidates) {
    const otherAvailable = validWords.filter(
      w => !isAlreadySelected(w, selectedWords) && !isWordOnReviewCooldown(w, now, MIN_REVIEW_COOLDOWN_HOURS)
    );
    if (otherAvailable.length > 0) {
      const shuffled = [...otherAvailable].sort(() => 0.5 - Math.random());
      for (const w of shuffled) {
        if (selectedWords.length >= maxCandidates) break;
        if (!isAlreadySelected(w, selectedWords)) {
          selectedWords.push(w);
        }
      }
    }
  }

  return selectedWords;
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
 * Gets a reliable numerical creation timestamp for a word.
 * Checks createdAt ISO string, regex match on ID, or falls back to original index.
 */
export function getWordCreationTimestamp(word: Word, fallbackIndex: number = 0): number {
  if (word.createdAt) {
    const t = new Date(word.createdAt).getTime();
    if (!isNaN(t) && t > 0) return t;
  }
  const match = word.id.match(/\d{10,13}/);
  if (match) {
    const parsed = parseInt(match[0], 10);
    if (!isNaN(parsed) && parsed > 1000000000) return parsed;
  }
  return fallbackIndex;
}

/**
 * Sorts unstudied / new words chronologically in FIFO order (oldest created first).
 * This ensures that a backlog of unreviewed words (e.g. added yesterday) is prioritized
 * before newer words added today.
 */
export function sortUnstudiedWordsOldestFirst(words: Word[]): Word[] {
  return [...words].sort((a, b) => {
    // 1. Starred unstudied words always take highest priority
    if (a.starred && !b.starred) return -1;
    if (!a.starred && b.starred) return 1;

    // 2. FIFO order (oldest created first)
    const tA = getWordCreationTimestamp(a);
    const tB = getWordCreationTimestamp(b);
    return tA - tB;
  });
}

/**
 * Checks whether a word is brand new and has never been studied/practiced.
 */
export function isNewUnstudiedWord(word: Word): boolean {
  if (word.completed === false) return false;
  return !isWordLearnedOrStudied(word);
}

/**
 * Determines whether a word is eligible as a candidate for immersion/reading study:
 * 1. Unstudied / new words (!isWordLearnedOrStudied) -> ALWAYS eligible immediately.
 * 2. Words with prior study -> eligible when their scheduled review date is reached (isWordEligibleForReview)
 *    or when custom cooldown hours (if specified) have elapsed.
 */
export function isImmersionCandidate(word: Word, now: Date = new Date(), customCooldownHours?: number): boolean {
  // Incomplete words are strictly excluded from practice
  if (word.completed === false) return false;

  // 1. Never studied / brand new words are immediately eligible for initial immersion introduction
  if (!isWordLearnedOrStudied(word) || !word.lastReviewed) {
    return true;
  }

  // 2. Cooldown check: custom override or default MIN_REVIEW_COOLDOWN_HOURS
  const cooldown = customCooldownHours !== undefined ? customCooldownHours : MIN_REVIEW_COOLDOWN_HOURS;
  if (cooldown > 0) {
    const hoursSinceReview = getHoursSinceLastReview(word, now);
    if (hoursSinceReview < cooldown) {
      return false;
    }
  }

  // 3. Dynamic eligibility check based on word's scheduled nextReviewDate
  return isWordEligibleForReview(word, now, cooldown);
}

/**
 * Selects candidate words for immersion study (default up to 3) strictly from words meeting
 * the dynamic candidate criteria (scheduled date reached, never learned, unresolved quiz mistake, or idle > 7 days).
 * Returns empty array if no words meet the conditions.
 */
export function getCandidateWordsForImmersion(
  words: Word[],
  count: number = 3,
  now: Date = new Date(),
  customCooldownHours?: number
): Word[] {
  if (!words || words.length === 0) return [];

  // Filter ONLY words that meet the candidate criteria (incomplete words are excluded)
  const validWords = words.filter(w => w.completed !== false);
  const eligibleWords = validWords.filter(word => isImmersionCandidate(word, now, customCooldownHours));

  if (eligibleWords.length === 0) {
    return [];
  }

  // Categorize eligible words by priority to give the most impactful words first:
  // 1. Words with unresolved quiz errors (urgent remedial review)
  // 2. Never learned / unreviewed words
  // 3. Due spaced repetition reviews
  const quizErrorWords: Word[] = [];
  const neverLearnedWords: Word[] = [];
  const srsDueWords: Word[] = [];

  for (const word of eligibleWords) {
    if (hasUnresolvedQuizMistake(word)) {
      quizErrorWords.push(word);
    } else if (!isWordLearnedOrStudied(word) || !word.lastReviewed) {
      neverLearnedWords.push(word);
    } else {
      srsDueWords.push(word);
    }
  }

  // Prioritize unstudied words chronologically FIFO (oldest added first, e.g. yesterday before today)
  const sortedNeverLearned = sortUnstudiedWordsOldestFirst(neverLearnedWords);
  const rawPrioritized = [
    ...quizErrorWords,
    ...sortedNeverLearned,
    ...srsDueWords,
  ];

  const prioritized: Word[] = [];
  for (const w of rawPrioritized) {
    if (!prioritized.some(p => p.id === w.id || areWordsEquivalent(p.word, w.word))) {
      prioritized.push(w);
      if (prioritized.length >= count) break;
    }
  }

  return prioritized;
}

/**
 * Selects a candidate word for immersion viewing strictly from eligible words.
 */
export function getCandidateWordForImmersion(words: Word[], now: Date = new Date(), customCooldownHours?: number): Word | null {
  if (!words || words.length === 0) return null;
  const candidates = getCandidateWordsForImmersion(words, 1, now, customCooldownHours);
  return candidates[0] || null;
}

/**
 * Checks whether a word is an eligible potential candidate for taking a quiz.
 * 1. Incomplete words are strictly excluded.
 * 2. Words on review cooldown (e.g. reviewed within the last 2 hours) are strictly excluded.
 * 3. Unstudied / new words are immediately eligible to be practiced and introduced via quiz.
 * 4. Previously studied words are eligible when their scheduled review date is reached.
 */
export function isQuizCandidate(word: Word, now: Date = new Date(), customCooldownHours?: number): boolean {
  // Incomplete words are strictly excluded from practice
  if (word.completed === false) return false;

  const cooldown = customCooldownHours !== undefined ? customCooldownHours : MIN_REVIEW_COOLDOWN_HOURS;
  if (cooldown > 0) {
    const hours = getHoursSinceLastReview(word, now);
    if (hours < cooldown) {
      return false;
    }
  }

  // Brand new, unstudied words are eligible for initial quiz practice
  if (!isWordLearnedOrStudied(word) || !word.lastReviewed) {
    return true;
  }

  return isWordEligibleForReview(word, now, cooldown);
}

/**
 * Checks whether a previously studied word is strictly due for spaced repetition review.
 */
export function isDueReviewCandidate(word: Word, now: Date = new Date(), customCooldownHours?: number): boolean {
  if (word.completed === false) return false;
  if (!isWordLearnedOrStudied(word) || !word.lastReviewed) {
    return false;
  }
  const cooldown = customCooldownHours !== undefined ? customCooldownHours : MIN_REVIEW_COOLDOWN_HOURS;
  if (cooldown > 0) {
    const hours = getHoursSinceLastReview(word, now);
    if (hours < cooldown) {
      return false;
    }
  }
  return isWordEligibleForReview(word, now, cooldown);
}

/**
 * Gets all words that are strictly due for spaced repetition review.
 */
export function getDueReviewCandidates(words: Word[], now: Date = new Date(), customCooldownHours?: number): Word[] {
  if (!words || words.length === 0) return [];
  return words.filter(word => word.completed !== false && isDueReviewCandidate(word, now, customCooldownHours));
}

/**
 * Gets all words that are potential candidates for quizzes (both unstudied words + due reviews).
 */
export function getQuizCandidates(words: Word[], now: Date = new Date(), customCooldownHours?: number): Word[] {
  if (!words || words.length === 0) return [];
  return words.filter(word => word.completed !== false && isQuizCandidate(word, now, customCooldownHours));
}

/**
 * Gets all words that are potential candidates for immersion study.
 */
export function getImmersionCandidates(words: Word[], now: Date = new Date(), customCooldownHours?: number): Word[] {
  if (!words || words.length === 0) return [];
  return words.filter(word => word.completed !== false && isImmersionCandidate(word, now, customCooldownHours));
}

/**
 * Gets all unique words that are ready for practice (both Quiz review + Immersion study).
 */
export function getAllPracticeCandidates(words: Word[], now: Date = new Date(), customCooldownHours?: number): Word[] {
  if (!words || words.length === 0) return [];
  const validWords = words.filter(w => w.completed !== false);
  const practiceList: Word[] = [];

  const quizList = getQuizCandidates(validWords, now, customCooldownHours);
  for (const w of quizList) {
    if (!practiceList.some(p => p.id === w.id || areWordsEquivalent(p.word, w.word))) {
      practiceList.push(w);
    }
  }

  const immersionList = getImmersionCandidates(validWords, now, customCooldownHours);
  for (const w of immersionList) {
    if (!practiceList.some(p => p.id === w.id || areWordsEquivalent(p.word, w.word))) {
      practiceList.push(w);
    }
  }

  return practiceList;
}
