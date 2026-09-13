import { Word, StrengthHistoryReason, StrengthHistoryTuple } from "../types";
import { recordStrengthHistory, sanitizeAndHealWordHistory } from "./strengthHistoryHelpers";
import { areWordsEquivalent, normalizeWordForComparison } from "./wordNormalization";

export interface BaselinePracticeInfo {
  baselineStrength: number;
  lastPracticeDate: string | null;
}

/**
 * Calculates or retrieves the total review/practice count for a word.
 * Evaluates explicitly set word.reviewCount or counts active practice events in strength history.
 */
export function getWordReviewCount(word: Word): number {
  if (typeof word.reviewCount === "number" && !isNaN(word.reviewCount) && word.reviewCount >= 0) {
    return word.reviewCount;
  }
  const history: StrengthHistoryTuple[] = (word.strengthHistory || []).filter(
    (t): t is StrengthHistoryTuple => Array.isArray(t) && t.length >= 3
  );
  const practiceEntries = history.filter(
    t => t[2] !== "created" && t[2] !== "manual_adjust" && t[2] !== "memory_decay"
  );
  return practiceEntries.length;
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

  // Fallback if no practice history exists yet (checking lastReviewedAt or lastReviewed):
  const practiceDate = word.lastReviewedAt || word.lastReviewed || null;
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
  const dateStr = word.lastReviewedAt || lastPracticeDate || word.lastReviewed || null;
  if (!dateStr) return Infinity; // Never reviewed

  const reviewDate = new Date(dateStr);
  if (isNaN(reviewDate.getTime())) return Infinity;

  const diffMs = now.getTime() - reviewDate.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  return Math.max(0, diffHours);
}

/**
 * Adaptive Spaced Repetition Algorithm based on Strength History & Review Count:
 * Computes the optimal review interval (in hours) before a word should be reintroduced.
 *
 * Factors evaluated:
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
  const lastReviewedTime = word.lastReviewedAt || word.lastReviewed;
  if (!lastReviewedTime) return false;

  // Strict time check: if reviewed within the minimum cooldown window, it is on cooldown
  const hoursSince = getHoursSinceLastReview(word, now);
  if (hoursSince < minCooldownHours) {
    return true;
  }

  // Dynamic scheduled interval check: if before scheduled practice time, it is on cooldown
  const { lastPracticeDate } = getLastPracticeBaseline(word);
  const baselineStr = word.lastReviewedAt || lastPracticeDate || word.lastReviewed;
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

  const lastReviewedTime = word.lastReviewedAt || word.lastReviewed;
  // If never reviewed, it is immediately eligible for initial review/practice
  if (!lastReviewedTime) {
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
  const baselineStr = word.lastReviewedAt || lastPracticeDate || word.lastReviewed;
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
  const lastReviewedTime = word.lastReviewedAt || word.lastReviewed;

  // Unreviewed words are immediately due for initial study
  if (!lastReviewedTime) {
    targetIso = new Date(now.getTime() - 1000).toISOString();
  } else {
    // Dynamic recalculation using last practice baseline and current adaptive interval
    const { lastPracticeDate } = getLastPracticeBaseline(word);
    const fromDateStr = word.lastReviewedAt || lastPracticeDate || word.lastReviewed;
    const fromDate = fromDateStr ? new Date(fromDateStr) : new Date();
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
  const isDue = !lastReviewedTime || diffMs <= 0;

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
  if (word.lastReviewedAt || word.lastReviewed) return true;
  if ((word.strength ?? 0) > 0) return true;
  if (typeof word.reviewCount === "number" && word.reviewCount > 0) return true;
  if (word.strengthHistory && word.strengthHistory.length > 0) {
    const hasStudyHistory = word.strengthHistory.some(
      t => Array.isArray(t) && t[2] !== "created" && t[2] !== "manual_adjust"
    );
    if (hasStudyHistory) return true;
  }
  return false;
}

/**
 * Assigns probability weight based on word urgency tier, incorporating
 * practice recency, the 'lastReviewedAt' timestamp, and 'reviewCount'.
 * - Words that have NEVER appeared in practice (unlearned words) receive high weight to ensure they are actively practiced.
 * - Older words (long elapsed days since practice, lower review count) receive higher priority.
 * - Frequently / recently appearing words receive a recency penalty to prevent repeated selection.
 */
export function getWordTierAndWeight(word: Word, now: Date = new Date()): {
  tier: "starred" | "memoryDecay" | "weak" | "unstudied" | "rest";
  weight: number;
} {
  const lastPractice = getWordLastPracticeTimestamp(word);
  const days = getDaysSinceLastReview(word, now);
  const reviewCount = getWordReviewCount(word);

  let tier: "starred" | "memoryDecay" | "weak" | "unstudied" | "rest";
  let baseWeight: number;

  if (word.starred) {
    tier = "starred";
    baseWeight = 8;
  } else if (lastPractice === null || !isWordLearnedOrStudied(word)) {
    // Unstudied / never practiced word waiting in queue -> high priority to introduce
    tier = "unstudied";
    baseWeight = 6;
  } else {
    const { baselineStrength } = getLastPracticeBaseline(word);
    const wasMastered = word.learned || baselineStrength >= 80;

    // Tier 2: Memory Decay - Only applies to words that reached mastery and are at risk of forgetting
    // (e.g. neglected for >= 5 days or decayed below 80%)
    if (wasMastered && (days >= 5 || (word.strength ?? 0) < 80)) {
      tier = "memoryDecay";
      baseWeight = 5;
    } else if ((word.strength ?? 0) < 50 || hasUnresolvedQuizMistake(word)) {
      tier = "weak";
      baseWeight = 4;
    } else {
      tier = "rest";
      baseWeight = 2;
    }
  }

  // Recency penalty: words that have appeared in practice very recently (within 12-48 hours)
  // receive a steep weight reduction to prevent them from repeating continually
  let recencyMultiplier = 1.0;
  if (lastPractice !== null) {
    const hoursSincePractice = (now.getTime() - lastPractice) / (1000 * 60 * 60);
    if (hoursSincePractice < 12) {
      recencyMultiplier = 0.2; // Steep penalty for words practiced in last 12 hours
    } else if (hoursSincePractice < 24) {
      recencyMultiplier = 0.4; // Moderate penalty for words practiced in last 24 hours
    } else if (hoursSincePractice < 48) {
      recencyMultiplier = 0.7;
    }
  }

  // Calculate Neglect Ratio: days elapsed since last review relative to total review count.
  const neglectRatio = days / Math.max(1, reviewCount);
  const neglectMultiplier = Math.min(2.5, 1.0 + Math.min(neglectRatio, 10) * 0.15);
  const finalWeight = Math.max(1, Math.round(baseWeight * recencyMultiplier * neglectMultiplier));

  return { tier, weight: finalWeight };
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
  const seenIds = new Set<string>();
  const seenNorm = new Set<string>();

  for (const s of sampled) {
    if (seenIds.has(s.word.id)) continue;
    const norm = normalizeWordForComparison(s.word.word);
    if (norm && seenNorm.has(norm)) continue;
    seenIds.add(s.word.id);
    if (norm) seenNorm.add(norm);
    result.push(s.word);
    if (result.length >= count) break;
  }
  return result;
}

/**
 * Selects candidate words for a new quiz, prioritizing words based on the most recent time
 * they have appeared in practice:
 * 1. Unlearned words that have NEVER appeared in practice have the highest priority.
 * 2. Words that have appeared in practice are ordered by least recent practice (oldest practice date first).
 * 3. Words practiced very recently receive a recency penalty to prevent repetitive selection.
 */
export function getQuizCandidateWords(words: Word[], options: CandidateWordsOptions = {}): Word[] {
  if (!words || words.length === 0) return [];

  // Incomplete words are strictly excluded from practice
  const validWords = words.filter(w => w.completed !== false);
  if (validWords.length === 0) return [];

  const { maxCandidates = 10, candidatePoolSize = 30, includeUnstudied = true } = options;
  const now = new Date();

  // Sweep memory decay so fresh decayed strengths are evaluated
  const { updatedWords: freshWords } = recalculateWordsMemoryDecay(validWords, now);

  // Helper to check if a word is already represented in a list (by id or vocabulary equivalence)
  const isAlreadySelected = (candidate: Word, list: Word[]): boolean => {
    return list.some(w => w.id === candidate.id || areWordsEquivalent(w.word, candidate.word));
  };

  // Filter candidates avoiding words on review cooldown (practiced < 2 hours ago)
  let eligibleCandidates = freshWords.filter(w => !isWordOnReviewCooldown(w, now, MIN_REVIEW_COOLDOWN_HOURS));
  if (eligibleCandidates.length === 0) {
    eligibleCandidates = freshWords;
  }

  // Filter unstudied if explicitly requested not to include them (default is true)
  if (!includeUnstudied) {
    const studiedOnly = eligibleCandidates.filter(isWordLearnedOrStudied);
    if (studiedOnly.length > 0) {
      eligibleCandidates = studiedOnly;
    }
  }

  // Prioritize candidates based on the most recent time they have appeared in practice
  // (never practiced first, then oldest practiced date first)
  const sortedCandidates = sortWordsByLastPracticeTime(eligibleCandidates, now);

  // Assemble candidate pool across priority tiers with weights reflecting recency and neglect
  const candidatePool: WeightedCandidate[] = [];
  const poolSeenIds = new Set<string>();
  const poolSeenNorm = new Set<string>();

  for (const word of sortedCandidates) {
    if (candidatePool.length >= candidatePoolSize) break;
    if (poolSeenIds.has(word.id)) continue;
    const norm = normalizeWordForComparison(word.word);
    if (norm && poolSeenNorm.has(norm)) continue;
    poolSeenIds.add(word.id);
    if (norm) poolSeenNorm.add(norm);

    const { tier, weight } = getWordTierAndWeight(word, now);
    candidatePool.push({
      word,
      tier: tier === "unstudied" ? "weak" : tier,
      weight,
    });
  }

  // Perform Weighted Random Sampling (A-Res) from the candidate pool
  const selectedWords = sampleWeightedCandidates(candidatePool, maxCandidates);

  // If selectedWords is under maxCandidates, top up from sortedCandidates (respecting least recent practice priority)
  if (selectedWords.length < maxCandidates) {
    for (const word of sortedCandidates) {
      if (selectedWords.length >= maxCandidates) break;
      if (!isAlreadySelected(word, selectedWords)) {
        selectedWords.push(word);
      }
    }
  }

  // Fallback to any remaining words in freshWords if still needed
  if (selectedWords.length < maxCandidates) {
    const sortedAll = sortWordsByLastPracticeTime(freshWords, now);
    for (const word of sortedAll) {
      if (selectedWords.length >= maxCandidates) break;
      if (!isAlreadySelected(word, selectedWords)) {
        selectedWords.push(word);
      }
    }
  }

  return selectedWords;
}

/**
 * Calculates days elapsed since the word was last reviewed or practiced.
 * For unreviewed words, calculates elapsed days since creation date so older unpracticed words
 * have a higher neglect ratio than newly added unpracticed words.
 */
export function getDaysSinceLastReview(word: Word, now: Date = new Date()): number {
  const { lastPracticeDate } = getLastPracticeBaseline(word);
  const dateStr = word.lastReviewedAt || lastPracticeDate || word.lastReviewed || null;
  if (!dateStr) {
    if (word.createdAt) {
      const createdTime = new Date(word.createdAt).getTime();
      if (!isNaN(createdTime) && createdTime > 0) {
        return Math.max(0, (now.getTime() - createdTime) / (1000 * 60 * 60 * 24));
      }
    }
    return 30; // Default neglect for unreviewed words
  }

  const reviewDate = new Date(dateStr);
  if (isNaN(reviewDate.getTime())) return 0;

  const diffMs = now.getTime() - reviewDate.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return Math.max(0, diffDays);
}

/**
 * Evaluates memory decay based on spaced repetition principles, incorporating
 * the 'lastReviewedAt' timestamp and 'reviewCount'.
 *
 * Mathematical formulation:
 * 1. Time Delta: Days elapsed since the last review timestamp (lastReviewedAt / lastReviewed / practice baseline).
 * 2. Review Count Modulation (Memory Stability):
 *    Words reviewed many times (high reviewCount, e.g. frequently appearing 'express') have higher stability,
 *    reducing their daily decay rate (e.g., 10 / (1 + 0.25 * (reviewCount - 1))).
 * 3. Neglect Penalty & Demotion:
 *    Older words with low reviewCount (e.g., 'knit') decay faster per day when neglected,
 *    causing their strength to decrease more rapidly so they are flagged for remediation and higher review priority.
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
  const reviewCount = getWordReviewCount(word);

  // Memory decay STRICTLY applies ONLY to words that have achieved Mastered status (learned === true or baselineStrength >= 80)
  const isMastered = word.learned || baselineStrength >= 80;
  if (!isMastered || daysSinceReview <= 0) {
    // Unmastered words retain their earned baseline strength without passive decay.
    // If an unmastered word previously had its strength reduced below baseline due to old decay, restore it.
    const restoredStrength = !isMastered && baselineStrength > currentStrength
      ? baselineStrength
      : currentStrength;

    return {
      newStrength: restoredStrength,
      newLearned: word.learned,
      hasDecayed: false,
      daysSinceReview: 0,
      decayAmount: 0
    };
  }

  // Memory Stability Factor (S): High reviewCount moderates daily decay (higher retention stability).
  // Low reviewCount words decay at standard rate (~10% per day), whereas high reviewCount words (e.g. 5+ reviews) decay slower.
  const stabilityFactor = Math.max(1.0, Math.min(3.0, 1.0 + 0.25 * Math.max(0, reviewCount - 1)));
  const effectiveDailyDecayRate = 10 / stabilityFactor;

  // Total decay amount based on days elapsed since lastReviewedAt / lastPracticeDate
  const rawDecayAmount = daysSinceReview * effectiveDailyDecayRate;
  const decayAmount = Math.round(rawDecayAmount);
  const targetStrength = Math.max(0, Math.round(baselineStrength - decayAmount));

  // A word remains mastered only if strength >= 80
  const newLearned = targetStrength >= 80;

  // Has decayed if target strength is strictly lower than current strength,
  // or if learned status changed from true to false due to decay
  const hasDecayed = targetStrength < currentStrength || (word.learned && !newLearned);

  return {
    newStrength: targetStrength,
    newLearned,
    hasDecayed,
    daysSinceReview: Math.round(daysSinceReview * 10) / 10,
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
  let healedCount = 0;

  const updatedWords = words.map(word => {
    const { newStrength, newLearned, hasDecayed, daysSinceReview, decayAmount } = calculateDecayedWordStrength(word, now);
    if (hasDecayed) {
      decayedCount++;
      const { lastPracticeDate } = getLastPracticeBaseline(word);
      const baselineMs = lastPracticeDate ? new Date(lastPracticeDate).getTime() : 0;
      const elapsedDays = Math.floor(daysSinceReview);
      const stableId = `hist-decay-${word.id || word.word}-${baselineMs}-${elapsedDays}`;
      const note = `Memory decayed by -${decayAmount}% (${elapsedDays} day${elapsedDays === 1 ? '' : 's'} since last practice)`;
      return recordStrengthHistory(word, newStrength, "memory_decay", note, stableId);
    } else {
      // Check if word needs healing:
      // 1. Unmastered word with memory_decay entries in strengthHistory
      // 2. Unmastered word with strength lower than baseline due to old decay
      // 3. Mismatch between newStrength/newLearned and word.strength/word.learned
      const { baselineStrength } = getLastPracticeBaseline(word);
      const isMastered = word.learned || baselineStrength >= 80;
      const history = word.strengthHistory || [];
      const hasUnwantedDecayHistory = !isMastered && history.some(t => Array.isArray(t) && t[2] === "memory_decay");

      if (hasUnwantedDecayHistory || newStrength !== word.strength || newLearned !== word.learned) {
        healedCount++;
        return sanitizeAndHealWordHistory(word, newStrength, newLearned);
      }
      return word;
    }
  });

  return { updatedWords, decayedCount: decayedCount + healedCount };
}

/**
 * Returns the numerical timestamp (in milliseconds) of the most recent time
 * the word appeared in active practice or review.
 * Returns null if the word has never appeared in practice.
 */
export function getWordLastPracticeTimestamp(word: Word): number | null {
  const history: StrengthHistoryTuple[] = (word.strengthHistory || []).filter(
    (t): t is StrengthHistoryTuple => Array.isArray(t) && t.length >= 3
  );
  // Active practice events: e.g. quiz_correct, quiz_incorrect, mastered, unmastered, practice, immersion
  // (strictly excluding created, manual_adjust, and memory_decay)
  const practiceEntries = history.filter(
    t => t[2] !== "memory_decay" && t[2] !== "created" && t[2] !== "manual_adjust"
  );

  if (practiceEntries.length > 0) {
    const sorted = [...practiceEntries].sort((a, b) => (a?.[0] ?? 0) - (b?.[0] ?? 0));
    const lastPractice = sorted[sorted.length - 1];
    if (lastPractice && lastPractice.length >= 2) {
      const ms = lastPractice[0] > 1e11 ? lastPractice[0] : lastPractice[0] * 1000;
      return ms;
    }
  }

  // Fallback to lastReviewedAt or lastReviewed if set
  const dateStr = word.lastReviewedAt || word.lastReviewed;
  if (dateStr) {
    const parsed = new Date(dateStr).getTime();
    if (!isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return null;
}

/**
 * Checks whether a word has ever appeared in practice.
 */
export function hasWordEverBeenPracticed(word: Word): boolean {
  return getWordLastPracticeTimestamp(word) !== null;
}

/**
 * Checks if a word has an unresolved quiz mistake (i.e. its most recent practice/review was a quiz error).
 */
export function hasUnresolvedQuizMistake(word: Word): boolean {
  const history: StrengthHistoryTuple[] = (word.strengthHistory || []).filter(
    (t): t is StrengthHistoryTuple => Array.isArray(t) && t.length >= 3
  );
  const practiceEntries = history.filter(
    t => t[2] !== "memory_decay" && t[2] !== "created" && t[2] !== "manual_adjust"
  );
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
 * Sorts candidate words prioritizing those that have appeared least recently in practice:
 * 1. Highest Priority: Words that have NEVER appeared in practice (unlearned / unstudied words).
 *    Among unpracticed words:
 *      - Starred words first
 *      - Oldest creation date first (FIFO: words waiting longest get practiced first)
 * 2. Second Priority: Words that have appeared in practice, ordered by least recent practice
 *    (oldest practice date first = longest elapsed time since last practice).
 *    Among words practiced around the same time (e.g. within 6 hours):
 *      - Starred words first
 *      - Unresolved quiz mistakes / weak strength (< 50)
 *      - Higher neglect ratio (days since review / review count)
 *      - Lower review count
 */
export function sortWordsByLastPracticeTime(words: Word[], now: Date = new Date()): Word[] {
  if (!words || words.length <= 1) return words ? [...words] : [];

  return [...words].sort((a, b) => {
    const timeA = getWordLastPracticeTimestamp(a);
    const timeB = getWordLastPracticeTimestamp(b);

    // Words that have NEVER appeared in practice take highest priority over previously practiced words
    if (timeA === null && timeB !== null) return -1;
    if (timeA !== null && timeB === null) return 1;

    // Both words have never appeared in practice:
    if (timeA === null && timeB === null) {
      if (a.starred && !b.starred) return -1;
      if (!a.starred && b.starred) return 1;
      return getWordCreationTimestamp(a) - getWordCreationTimestamp(b);
    }

    // Both words have appeared in practice:
    // Sort ascending by last practice timestamp (oldest practice date first)
    const diffTime = (timeA as number) - (timeB as number);
    // If the difference is more than 6 hours, strictly sort by oldest practice date
    if (Math.abs(diffTime) > 6 * 60 * 60 * 1000) {
      return diffTime;
    }

    // Secondary criteria for words practiced in similar timeframe:
    if (a.starred && !b.starred) return -1;
    if (!a.starred && b.starred) return 1;

    const mistakeA = hasUnresolvedQuizMistake(a);
    const mistakeB = hasUnresolvedQuizMistake(b);
    if (mistakeA && !mistakeB) return -1;
    if (!mistakeA && mistakeB) return 1;

    const daysA = getDaysSinceLastReview(a, now);
    const daysB = getDaysSinceLastReview(b, now);
    const countA = getWordReviewCount(a);
    const countB = getWordReviewCount(b);
    const ratioA = daysA / Math.max(1, countA);
    const ratioB = daysB / Math.max(1, countB);
    if (Math.abs(ratioB - ratioA) > 0.1) {
      return ratioB - ratioA;
    }

    const strA = a.strength ?? 0;
    const strB = b.strength ?? 0;
    if (strA !== strB) {
      return strA - strB;
    }

    return diffTime;
  });
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

  const lastReviewedTime = word.lastReviewedAt || word.lastReviewed;
  // 1. Never studied / brand new words are immediately eligible for initial immersion introduction
  if (!isWordLearnedOrStudied(word) || !lastReviewedTime) {
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
 * Selects candidate words for immersion study (default up to 3), prioritizing words
 * based on the most recent time they have appeared in practice:
 * 1. Words that have never appeared in practice (unlearned/unstudied) FIFO
 * 2. Words whose last practice was longest ago (oldest practice date first)
 */
export function getCandidateWordsForImmersion(
  words: Word[],
  count: number = 3,
  now: Date = new Date(),
  customCooldownHours?: number
): Word[] {
  if (!words || words.length === 0) return [];

  // Filter ONLY words that meet candidate criteria (incomplete words are excluded)
  const validWords = words.filter(w => w.completed !== false);
  let eligibleWords = validWords.filter(word => isImmersionCandidate(word, now, customCooldownHours));

  if (eligibleWords.length === 0) {
    eligibleWords = validWords.filter(w => !isWordOnReviewCooldown(w, now, customCooldownHours ?? MIN_REVIEW_COOLDOWN_HOURS));
    if (eligibleWords.length === 0) {
      eligibleWords = validWords;
    }
  }

  // Prioritize candidates based on the most recent time they appeared in practice:
  // 1. Words that have never appeared in practice (unlearned/unstudied) FIFO
  // 2. Words whose last practice was longest ago (oldest practice date first)
  const sorted = sortWordsByLastPracticeTime(eligibleWords, now);

  const prioritized: Word[] = [];
  const seenIds = new Set<string>();
  const seenNorm = new Set<string>();

  for (const w of sorted) {
    if (seenIds.has(w.id)) continue;
    const norm = normalizeWordForComparison(w.word);
    if (norm && seenNorm.has(norm)) continue;
    seenIds.add(w.id);
    if (norm) seenNorm.add(norm);
    prioritized.push(w);
    if (prioritized.length >= count) break;
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

  const lastReviewedTime = word.lastReviewedAt || word.lastReviewed;
  // Brand new, unstudied words are eligible for initial quiz practice
  if (!isWordLearnedOrStudied(word) || !lastReviewedTime) {
    return true;
  }

  return isWordEligibleForReview(word, now, cooldown);
}

/**
 * Checks whether a previously studied word is strictly due for spaced repetition review.
 */
export function isDueReviewCandidate(word: Word, now: Date = new Date(), customCooldownHours?: number): boolean {
  if (word.completed === false) return false;
  const lastReviewedTime = word.lastReviewedAt || word.lastReviewed;
  if (!isWordLearnedOrStudied(word) || !lastReviewedTime) {
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
  const seenIds = new Set<string>();
  const seenNorm = new Set<string>();

  const addWord = (w: Word) => {
    if (seenIds.has(w.id)) return;
    const norm = normalizeWordForComparison(w.word);
    if (norm && seenNorm.has(norm)) return;
    seenIds.add(w.id);
    if (norm) seenNorm.add(norm);
    practiceList.push(w);
  };

  const quizList = getQuizCandidates(validWords, now, customCooldownHours);
  for (let i = 0; i < quizList.length; i++) {
    addWord(quizList[i]);
  }

  const immersionList = getImmersionCandidates(validWords, now, customCooldownHours);
  for (let i = 0; i < immersionList.length; i++) {
    addWord(immersionList[i]);
  }

  return sortWordsByLastPracticeTime(practiceList, now);
}
