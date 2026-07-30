import { Word } from "../types";

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
    const days = getDaysSinceLastReview(w, now);
    return days >= 5 || (w.strength < 3 && w.lastReviewed !== null);
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
    w.strength < 3
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
 * Returns the recalculated strength (0 to 4) and learned flag for a word.
 */
export function calculateDecayedWordStrength(word: Word, now: Date = new Date()): {
  newStrength: number;
  newLearned: boolean;
  hasDecayed: boolean;
  daysSinceReview: number;
} {
  const daysSinceReview = getDaysSinceLastReview(word, now);
  const currentStrength = word.strength ?? 0;
  
  if (daysSinceReview <= 0) {
    return {
      newStrength: currentStrength,
      newLearned: word.learned,
      hasDecayed: false,
      daysSinceReview: 0
    };
  }

  let newStrength = currentStrength;

  // Spaced repetition decay logic:
  // Level 4 (Mastered / Max Strength):
  // - 21+ days without review -> decays to 1 (needs full review, learned = false)
  // - 10+ days without review -> decays to 2 (needs practice, learned = false)
  // - 5+ days without review  -> decays to 3 (refresher recommended, learned = true)
  if (currentStrength === 4) {
    if (daysSinceReview >= 21) {
      newStrength = 1;
    } else if (daysSinceReview >= 10) {
      newStrength = 2;
    } else if (daysSinceReview >= 5) {
      newStrength = 3;
    }
  } 
  // Level 3 (Learned / Strong):
  // - 14+ days without review -> decays to 1
  // - 5+ days without review  -> decays to 2
  else if (currentStrength === 3) {
    if (daysSinceReview >= 14) {
      newStrength = 1;
    } else if (daysSinceReview >= 5) {
      newStrength = 2;
    }
  }
  // Level 2 (Familiar):
  // - 4+ days without review  -> decays to 1
  else if (currentStrength === 2) {
    if (daysSinceReview >= 4) {
      newStrength = 1;
    }
  }
  // Level 1 (Weak):
  // - 2+ days without review  -> decays to 0
  else if (currentStrength === 1) {
    if (daysSinceReview >= 2) {
      newStrength = 0;
    }
  }

  // A word is considered fully learned only if strength is >= 3
  const newLearned = newStrength >= 3 ? word.learned : false;
  const hasDecayed = newStrength < currentStrength || (word.learned && !newLearned);

  return {
    newStrength,
    newLearned,
    hasDecayed,
    daysSinceReview
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
    const { newStrength, newLearned, hasDecayed } = calculateDecayedWordStrength(word, now);
    if (hasDecayed) {
      decayedCount++;
      return {
        ...word,
        strength: newStrength,
        learned: newLearned
      };
    }
    return word;
  });

  return { updatedWords, decayedCount };
}
