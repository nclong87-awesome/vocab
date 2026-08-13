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
  // Filter out memory_decay entries to find real practice events
  const practiceEntries = history.filter(
    entry => entry.reason !== "memory_decay"
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

  // Fallback if no non-decay history exists yet:
  const practiceDate = word.lastReviewed || word.createdAt || null;
  const fallbackStrength = word.learned
    ? Math.max(80, word.strength ?? 100)
    : (word.strength ?? 0);

  return {
    baselineStrength: fallbackStrength,
    lastPracticeDate: practiceDate
  };
}

/**
 * Calculates hours elapsed since the word was last reviewed or created.
 */
export function getHoursSinceLastReview(word: Word, now: Date = new Date()): number {
  const { lastPracticeDate } = getLastPracticeBaseline(word);
  const dateStr = lastPracticeDate || word.lastReviewed || word.createdAt;
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

export interface WeightedCandidate {
  word: Word;
  tier: "starred" | "memoryDecay" | "neverReviewed" | "weak" | "rest";
  weight: number;
}

/**
 * Assigns probability weight based on word urgency tier:
 * - Starred: weight 5
 * - Memory Decay: weight 4
 * - Never Reviewed: weight 3
 * - Weak (strength < 50): weight 3
 * - Rest: weight 1
 */
export function getWordTierAndWeight(word: Word, now: Date = new Date()): {
  tier: "starred" | "memoryDecay" | "neverReviewed" | "weak" | "rest";
  weight: number;
} {
  if (word.starred) {
    return { tier: "starred", weight: 5 };
  }

  const days = getDaysSinceLastReview(word, now);
  if (word.learned && (days >= 5 || (word.strength < 80 && word.lastReviewed !== null && days >= 1))) {
    return { tier: "memoryDecay", weight: 4 };
  }

  if (!word.lastReviewed) {
    return { tier: "neverReviewed", weight: 3 };
  }

  if (word.strength < 50) {
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
 * Gathers a candidate pool across non-cooldown tiers (e.g. 20-30 words) and applies
 * weighted random sampling (starred: weight 5, memoryDecay: weight 4, weak/neverReviewed: weight 3, rest: weight 1)
 * to ensure urgent words are favored overall while dramatically reducing overlap across devices/sessions.
 */
export function getQuizCandidateWords(words: Word[], options: CandidateWordsOptions = {}): Word[] {
  if (!words || words.length === 0) return [];

  const { maxCandidates = 10, cooldownHours = 12, candidatePoolSize = 30 } = options;
  const now = new Date();

  // 1. Filter out words that were reviewed recently (within cooldownHours)
  const eligibleWords = words.filter(word => {
    if (!word.lastReviewed) return true; // Never reviewed -> always eligible
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

  // 2. Categorize eligible words into priority tiers
  const starred: Word[] = [];
  const memoryDecay: Word[] = [];
  const neverReviewed: Word[] = [];
  const weak: Word[] = [];
  const rest: Word[] = [];

  for (const word of eligibleWords) {
    const { tier } = getWordTierAndWeight(word, now);
    if (tier === "starred") starred.push(word);
    else if (tier === "memoryDecay") memoryDecay.push(word);
    else if (tier === "neverReviewed") neverReviewed.push(word);
    else if (tier === "weak") weak.push(word);
    else rest.push(word);
  }

  // Helper to shuffle an array randomly
  const shuffle = <T>(arr: T[]): T[] => [...arr].sort(() => 0.5 - Math.random());

  // 3. Gather candidate pool (e.g., 20–30 eligible words across all non-cooldown tiers)
  const candidatePool: WeightedCandidate[] = [];
  const addTierToPool = (tierWords: Word[], tier: "starred" | "memoryDecay" | "neverReviewed" | "weak" | "rest", weight: number) => {
    const shuffled = shuffle(tierWords);
    for (const word of shuffled) {
      if (candidatePool.length >= candidatePoolSize) break;
      candidatePool.push({ word, tier, weight });
    }
  };

  addTierToPool(starred, "starred", 5);
  addTierToPool(memoryDecay, "memoryDecay", 4);
  addTierToPool(neverReviewed, "neverReviewed", 3);
  addTierToPool(weak, "weak", 3);
  addTierToPool(rest, "rest", 1);

  // 4. Perform Weighted Random Sampling from the enlarged candidate pool
  return sampleWeightedCandidates(candidatePool, maxCandidates);
}

/**
 * Calculates days elapsed since the word was last reviewed or created.
 */
export function getDaysSinceLastReview(word: Word, now: Date = new Date()): number {
  const { lastPracticeDate } = getLastPracticeBaseline(word);
  const dateStr = lastPracticeDate || word.lastReviewed || word.createdAt;
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
 * Selects a candidate word for flashcard viewing applying the same candidate pool and weighted random sampling rules as quiz selection.
 */
export function getCandidateWordForFlashcard(words: Word[]): Word | null {
  if (!words || words.length === 0) return null;

  // 1. First try quiz candidates with standard 12h cooldown using candidate pool & weighted random sampling
  const cooldownCandidates = getQuizCandidateWords(words, { maxCandidates: 5, cooldownHours: 12, candidatePoolSize: 30 });
  if (cooldownCandidates.length > 0) {
    return cooldownCandidates[Math.floor(Math.random() * cooldownCandidates.length)];
  }

  // 2. If no candidate met cooldown rules, fallback to weighted random sampling without cooldown restriction
  const fallbackCandidates = getQuizCandidateWords(words, { maxCandidates: 5, cooldownHours: 0, candidatePoolSize: 30 });
  return fallbackCandidates[0] || words[Math.floor(Math.random() * words.length)] || null;
}
