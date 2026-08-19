import { Word, StrengthHistoryEntry } from "../types";
import { calculateNextReviewDate } from "./spacedRepetition";

/**
 * Gets or synthesizes a clean, chronological strength history for a word.
 * If the word lacks history, creates a single initial creation checkpoint,
 * and a review entry only if the word has actually been reviewed later.
 * Also appends current memory decay entry if strength is lower than the last recorded event.
 */
export function getEffectiveStrengthHistory(word: Word): StrengthHistoryEntry[] {
  let history: StrengthHistoryEntry[] = [];

  if (word.strengthHistory && word.strengthHistory.length > 0) {
    history = [...word.strengthHistory].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
  } else {
    // Synthesize history if none exists yet
    const createdAt = word.createdAt || new Date().toISOString();

    // 1. Single initial creation entry
    const initialStrength = Math.max(0, Math.min(30, (word.strength || 0) > 50 ? 20 : 0));
    history.push({
      id: `hist-init-${word.id}`,
      timestamp: createdAt,
      strength: initialStrength,
      delta: initialStrength,
      reason: "created",
      note: "Added to vocabulary collection"
    });

    // 2. Add review event ONLY if word was actually reviewed/practiced later
    if (word.lastReviewed) {
      const reviewDate = new Date(word.lastReviewed);
      const createdDate = new Date(createdAt);
      if (!isNaN(reviewDate.getTime()) && reviewDate.getTime() > createdDate.getTime() + 1000) {
        const currentStrength = word.strength || 0;
        history.push({
          id: `hist-review-${word.id}`,
          timestamp: word.lastReviewed,
          strength: currentStrength,
          delta: currentStrength - initialStrength,
          reason: word.learned ? "mastered" : currentStrength > 50 ? "quiz_correct" : "manual_adjust",
          note: word.learned ? "Marked as mastered" : `Practice review (Strength: ${Math.round(currentStrength)}%)`
        });
      }
    }
  }

  // Deduplicate adjacent decay entries with identical strength
  const dedupedHistory: StrengthHistoryEntry[] = [];
  for (const entry of history) {
    const last = dedupedHistory[dedupedHistory.length - 1];
    if (
      last &&
      entry.reason === "memory_decay" &&
      last.reason === "memory_decay" &&
      entry.strength === last.strength
    ) {
      continue;
    }
    dedupedHistory.push(entry);
  }

  return dedupedHistory;
}

/**
 * Cleans up corrupted history entries (e.g. repeated decay entries from page reloads)
 * and sets word strength to its clean target value.
 */
export function sanitizeAndHealWordHistory(
  word: Word,
  targetStrength: number,
  targetLearned: boolean
): Word {
  const history = word.strengthHistory || [];
  // Keep all non-decay practice entries
  const practiceEntries = history.filter(e => e.reason !== "memory_decay");

  let cleanHistory: StrengthHistoryEntry[] = [...practiceEntries];

  if (practiceEntries.length > 0) {
    const lastPractice = practiceEntries[practiceEntries.length - 1];
    if (targetStrength < lastPractice.strength) {
      const delta = targetStrength - lastPractice.strength;
      const baselineMs = lastPractice.timestamp ? new Date(lastPractice.timestamp).getTime() : 0;
      cleanHistory.push({
        id: `hist-decay-${word.id || word.word}-${baselineMs}-heal`,
        timestamp: lastPractice.timestamp || new Date().toISOString(),
        strength: targetStrength,
        delta,
        reason: "memory_decay",
        note: `Memory strength decayed over time (${delta}% at -10%/day)`
      });
    }
  }

  const updatedWord: Word = {
    ...word,
    strength: targetStrength,
    learned: targetLearned,
    strengthHistory: cleanHistory
  };

  return {
    ...updatedWord,
    nextReviewDate: word.nextReviewDate || calculateNextReviewDate(updatedWord, targetStrength)
  };
}

/**
 * Appends a new strength event entry to the word's history and updates strength metrics.
 */
export function recordStrengthHistory(
  word: Word,
  newStrength: number,
  reason: StrengthHistoryEntry["reason"],
  note?: string,
  idOverride?: string
): Word {
  const boundedStrength = Math.max(0, Math.min(100, Math.round(newStrength)));
  const nowIso = new Date().toISOString();

  // If this is a newly created word without prior history, create a single creation event
  if ((!word.strengthHistory || word.strengthHistory.length === 0) && reason === "created") {
    const initialEntry: StrengthHistoryEntry = {
      id: idOverride || `hist-created-${word.id || Date.now()}`,
      timestamp: word.createdAt || nowIso,
      strength: boundedStrength,
      delta: 0,
      reason: "created",
      note: note || "Added to vocabulary collection"
    };

    const newWord: Word = {
      ...word,
      strength: boundedStrength,
      learned: boundedStrength >= 80 ? true : boundedStrength === 0 ? false : word.learned,
      createdAt: word.createdAt || nowIso,
      strengthHistory: [initialEntry]
    };

    // For brand new words with 0 strength, nextReviewDate is immediately nowIso
    // If created with preset strength (e.g. marked learned on creation), calculate appropriate interval
    const computedNextReview = boundedStrength === 0
      ? nowIso
      : calculateNextReviewDate(newWord, boundedStrength, reason, new Date());

    return {
      ...newWord,
      nextReviewDate: word.nextReviewDate || computedNextReview
    };
  }

  const previousHistory = getEffectiveStrengthHistory(word);
  const lastEntry = previousHistory[previousHistory.length - 1];

  // Prevent duplicate decay entries if the last entry is already a memory_decay entry with the exact same strength
  if (
    reason === "memory_decay" &&
    lastEntry &&
    lastEntry.reason === "memory_decay" &&
    lastEntry.strength === boundedStrength
  ) {
    return {
      ...word,
      strength: boundedStrength,
      learned: boundedStrength >= 80 ? word.learned : false,
      // Keep existing next review date or mark due
      nextReviewDate: word.nextReviewDate || nowIso
    };
  }

  const delta = boundedStrength - (lastEntry ? lastEntry.strength : word.strength || 0);

  const newEntry: StrengthHistoryEntry = {
    id: idOverride || `hist-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    timestamp: nowIso,
    strength: boundedStrength,
    delta,
    reason,
    note: note || getReasonDefaultNote(reason, delta)
  };

  // Keep up to 50 history entries max
  const updatedHistory = [...previousHistory, newEntry].slice(-50);

  const newLearnedState = reason === "memory_decay"
    ? boundedStrength >= 80
    : (boundedStrength >= 80 ? true : boundedStrength === 0 ? false : word.learned);

  const interimWord: Word = {
    ...word,
    strength: boundedStrength,
    learned: newLearnedState,
    // Keep original practice date if reason is memory_decay, otherwise set lastReviewed to now
    lastReviewed: reason === "memory_decay" ? word.lastReviewed : nowIso,
    strengthHistory: updatedHistory
  };

  // Calculate dynamic next review date:
  // If memory decay, word is already due for refresh -> preserve or set to now
  const nextReviewDate = reason === "memory_decay"
    ? (word.nextReviewDate && new Date(word.nextReviewDate).getTime() < Date.now() ? word.nextReviewDate : nowIso)
    : calculateNextReviewDate(interimWord, boundedStrength, reason, new Date());

  return {
    ...interimWord,
    nextReviewDate
  };
}

function getReasonDefaultNote(reason: StrengthHistoryEntry["reason"], delta: number): string {
  const sign = delta >= 0 ? `+${delta}` : `${delta}`;
  switch (reason) {
    case "created":
      return "Word added to collection";
    case "quiz_correct":
      return `Correct answer in quiz (${sign}%)`;
    case "quiz_incorrect":
      return `Incorrect answer in quiz (${sign}%)`;
    case "mastered":
      return "Marked as Mastered (100%)";
    case "unmastered":
      return "Marked as Learning (0%)";
    case "memory_decay":
      return `Memory strength decayed over time (${sign}%)`;
    case "manual_adjust":
      return `Manually updated strength (${sign}%)`;
    default:
      return `Strength updated (${sign}%)`;
  }
}
