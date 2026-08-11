import { Word } from "../types";
import { recordStrengthHistory } from "./strengthHistoryHelpers";

/**
 * Calculates hours elapsed since the word was last reviewed or created.
 */
export function getHoursSinceLastReview(word: Word, now: Date = new Date()): number {
  const dateStr = word.lastReviewed;
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
}

/**
 * Selects candidate words for a new quiz based on recency, memory decay, and cooldown rules.
 * Words reviewed within `cooldownHours` (e.g. 12 hours) are excluded to prevent showing
 * the same words repeatedly.
 */
export function getQuizCandidateWords(words: Word[], options: CandidateWordsOptions = {}): Word[] {
  if (!words || words.length === 0) return [];

  const { maxCandidates = 10, cooldownHours = 12 } = options;
  const now = new Date();

  // 1. Filter out words that were reviewed recently (within cooldownHours)
  const eligibleWords = words.filter(word => {
    if (!word.lastReviewed) return true; // Never reviewed -> always eligible
    const hours = getHoursSinceLastReview(word, now);
    return hours >= cooldownHours;
  });

  // If fewer than 2 eligible words, return [] to trigger "No words to practice today" state
  if (eligibleWords.length < 2) {
    return [];
  }

  // 2. Categorize eligible words into priority tiers
  const starred = eligibleWords.filter(w => w.starred);

  const memoryDecay = eligibleWords.filter(w => {
    if (starred.includes(w)) return false;
    if (!w.learned) return false; // Only mastered words undergo memory decay
    const days = getDaysSinceLastReview(w, now);
    return days >= 5 || (w.strength < 80 && w.lastReviewed !== null && days >= 1);
  });

  const neverReviewed = eligibleWords.filter(w => 
    !starred.includes(w) && 
    !memoryDecay.includes(w) && 
    !w.lastReviewed
  );

  const weak = eligibleWords.filter(w => 
    !starred.includes(w) && 
    !memoryDecay.includes(w) && 
    !neverReviewed.includes(w) && 
    w.strength < 50
  );

  const rest = eligibleWords.filter(w => 
    !starred.includes(w) && 
    !memoryDecay.includes(w) && 
    !neverReviewed.includes(w) && 
    !weak.includes(w)
  );

  // Helper to shuffle an array randomly to provide variety across quiz sessions
  const shuffle = <T>(arr: T[]): T[] => [...arr].sort(() => 0.5 - Math.random());

  const orderedCandidateList = [
    ...shuffle(starred),
    ...shuffle(memoryDecay),
    ...shuffle(neverReviewed),
    ...shuffle(weak),
    ...shuffle(rest)
  ];

  return orderedCandidateList.slice(0, maxCandidates);
}

/**
 * Calculates days elapsed since the word was last reviewed or created.
 */
export function getDaysSinceLastReview(word: Word, now: Date = new Date()): number {
  const dateStr = word.lastReviewed || word.createdAt;
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
 * Rule: Starting from the last practice time (lastReviewed/createdAt), strength decreases
 * by 10 points per day elapsed (1 day = -10 points).
 */
export function calculateDecayedWordStrength(word: Word, now: Date = new Date()): {
  newStrength: number;
  newLearned: boolean;
  hasDecayed: boolean;
  daysSinceReview: number;
  decayAmount: number;
} {
  const daysSinceReview = getDaysSinceLastReview(word, now);
  const currentStrength = word.strength ?? 0;
  
  // Memory decay only applies to mastered (learned) words
  if (!word.learned || daysSinceReview <= 0) {
    return {
      newStrength: currentStrength,
      newLearned: word.learned,
      hasDecayed: false,
      daysSinceReview: 0,
      decayAmount: 0
    };
  }

  // Decay 10 points per day since last review/practice (1 day = -10 points)
  const decayAmount = daysSinceReview * 10;
  const newStrength = Math.max(0, currentStrength - decayAmount);

  // A word is considered fully learned only if strength is >= 80
  const newLearned = newStrength >= 80 ? word.learned : false;
  const hasDecayed = newStrength < currentStrength || (word.learned && !newLearned);

  return {
    newStrength,
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
    const { newStrength, hasDecayed, daysSinceReview, decayAmount } = calculateDecayedWordStrength(word, now);
    if (hasDecayed) {
      decayedCount++;
      const note = `Memory decayed by -${decayAmount}% (${daysSinceReview} day${daysSinceReview > 1 ? 's' : ''} since last practice at -10%/day)`;
      return recordStrengthHistory(word, newStrength, "memory_decay", note);
    }
    return word;
  });

  return { updatedWords, decayedCount };
}

/**
 * Selects a candidate word for flashcard viewing applying the same candidate rules as quiz question selection.
 */
export function getCandidateWordForFlashcard(words: Word[]): Word | null {
  if (!words || words.length === 0) return null;

  // 1. First try quiz candidates with standard 12h cooldown
  const cooldownCandidates = getQuizCandidateWords(words, { maxCandidates: 10, cooldownHours: 12 });
  if (cooldownCandidates.length > 0) {
    return cooldownCandidates[Math.floor(Math.random() * Math.min(cooldownCandidates.length, 3))];
  }

  // 2. If no candidate met cooldown rules, fallback to candidate priority tiers without cooldown restriction
  const now = new Date();
  const starred = words.filter(w => w.starred);

  const memoryDecay = words.filter(w => {
    if (starred.includes(w)) return false;
    if (!w.learned) return false; // Only mastered words undergo memory decay
    const days = getDaysSinceLastReview(w, now);
    return days >= 5 || (w.strength < 80 && w.lastReviewed !== null && days >= 1);
  });

  const neverReviewed = words.filter(w => 
    !starred.includes(w) && 
    !memoryDecay.includes(w) && 
    !w.lastReviewed
  );

  const weak = words.filter(w => 
    !starred.includes(w) && 
    !memoryDecay.includes(w) && 
    !neverReviewed.includes(w) && 
    w.strength < 50
  );

  const rest = words.filter(w => 
    !starred.includes(w) && 
    !memoryDecay.includes(w) && 
    !neverReviewed.includes(w) && 
    !weak.includes(w)
  );

  const shuffle = <T>(arr: T[]): T[] => [...arr].sort(() => 0.5 - Math.random());

  const orderedList = [
    ...shuffle(starred),
    ...shuffle(memoryDecay),
    ...shuffle(neverReviewed),
    ...shuffle(weak),
    ...shuffle(rest)
  ];

  return orderedList[0] || words[0] || null;
}
