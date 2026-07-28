import { Word } from "../types";

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
