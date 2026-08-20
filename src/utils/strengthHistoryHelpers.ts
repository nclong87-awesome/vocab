import { Word, StrengthHistoryTuple, StrengthHistoryEntry, StrengthHistoryReason } from "../types";
import { calculateNextReviewDate } from "./spacedRepetition";

/**
 * Generates descriptive human-readable note on the fly from reason and delta.
 */
export function getReasonDefaultNote(reason: StrengthHistoryReason, delta: number): string {
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
    case "flashcard_review":
      return `Studied flashcard (${sign}%)`;
    case "manual_adjust":
      return `Manually updated strength (${sign}%)`;
    default:
      return `Strength updated (${sign}%)`;
  }
}

/**
 * Converts a stored compact tuple into a rich UI StrengthHistoryEntry on the fly.
 */
export function tupleToEntry(
  tuple: StrengthHistoryTuple,
  index: number = 0,
  prevStrength: number = 0
): StrengthHistoryEntry {
  const [timestampSec, strength, reason] = tuple;
  const ms = timestampSec > 1e11 ? timestampSec : timestampSec * 1000;
  const iso = new Date(ms).toISOString();
  const delta = strength - prevStrength;

  return {
    id: `hist-${Math.floor(ms / 1000)}-${reason}-${index}`,
    timestamp: iso,
    strength,
    delta,
    reason,
    note: getReasonDefaultNote(reason, delta)
  };
}

/**
 * Helper to convert any timestamp format to Unix epoch seconds.
 */
export function toTimestampSec(timeInput?: string | number | Date | null): number {
  if (!timeInput) return Math.floor(Date.now() / 1000);
  if (typeof timeInput === "number") {
    return timeInput > 1e11 ? Math.floor(timeInput / 1000) : Math.floor(timeInput);
  }
  const parsed = new Date(timeInput).getTime();
  return isNaN(parsed) ? Math.floor(Date.now() / 1000) : Math.floor(parsed / 1000);
}

/**
 * Gets or synthesizes a clean, chronological strength history for a word.
 * Expands stored compact tuples into rich UI entries with dynamically generated notes and deltas.
 */
export function getEffectiveStrengthHistory(word: Word): StrengthHistoryEntry[] {
  const tuples: StrengthHistoryTuple[] = (word.strengthHistory || []).filter(
    (t): t is StrengthHistoryTuple => Array.isArray(t) && t.length >= 3
  );

  let sortedTuples = [...tuples].sort((a, b) => a[0] - b[0]);

  if (sortedTuples.length === 0) {
    const createdAtSec = toTimestampSec(word.createdAt);
    const initialStrength = Math.max(0, Math.min(30, (word.strength || 0) > 50 ? 20 : 0));
    sortedTuples.push([createdAtSec, initialStrength, "created"]);

    if (word.lastReviewed) {
      const reviewSec = toTimestampSec(word.lastReviewed);
      if (reviewSec > createdAtSec + 1) {
        const currentStrength = word.strength || 0;
        const reviewReason: StrengthHistoryReason = word.learned
          ? "mastered"
          : currentStrength > 50
          ? "quiz_correct"
          : "manual_adjust";
        sortedTuples.push([reviewSec, currentStrength, reviewReason]);
      }
    }
  }

  // Deduplicate adjacent decay entries with identical strength
  const dedupedTuples: StrengthHistoryTuple[] = [];
  for (const tuple of sortedTuples) {
    const last = dedupedTuples[dedupedTuples.length - 1];
    if (
      last &&
      tuple[2] === "memory_decay" &&
      last[2] === "memory_decay" &&
      tuple[1] === last[1]
    ) {
      continue;
    }
    dedupedTuples.push(tuple);
  }

  // Convert tuples to rich StrengthHistoryEntry objects
  const entries: StrengthHistoryEntry[] = [];
  let prevStrength = 0;
  for (let i = 0; i < dedupedTuples.length; i++) {
    const tuple = dedupedTuples[i];
    const entry = tupleToEntry(tuple, i, i === 0 ? (tuple[2] === "created" ? tuple[1] : 0) : prevStrength);
    entries.push(entry);
    prevStrength = tuple[1];
  }

  return entries;
}

/**
 * Cleans up corrupted history entries (e.g. repeated decay entries)
 * and sets word strength to its clean target value using compact tuples.
 */
export function sanitizeAndHealWordHistory(
  word: Word,
  targetStrength: number,
  targetLearned: boolean
): Word {
  const existingTuples = (word.strengthHistory || []).filter(
    (t): t is StrengthHistoryTuple => Array.isArray(t) && t.length >= 3
  );
  // Keep all non-decay practice entries
  const practiceTuples = existingTuples.filter(t => t[2] !== "memory_decay");

  const cleanHistory: StrengthHistoryTuple[] = [...practiceTuples];

  if (practiceTuples.length > 0) {
    const lastPractice = practiceTuples[practiceTuples.length - 1];
    if (targetStrength < lastPractice[1]) {
      cleanHistory.push([lastPractice[0], targetStrength, "memory_decay"]);
    }
  }

  const updatedWord: Word = {
    ...word,
    strength: targetStrength,
    learned: targetLearned,
    strengthHistory: cleanHistory.slice(-30)
  };

  return {
    ...updatedWord,
    nextReviewDate: word.nextReviewDate || calculateNextReviewDate(updatedWord, targetStrength)
  };
}

/**
 * Appends a new strength event tuple [timestampSec, strength, reason] to the word's history.
 */
export function recordStrengthHistory(
  word: Word,
  newStrength: number,
  reason: StrengthHistoryReason,
  _note?: string,
  _idOverride?: string
): Word {
  const boundedStrength = Math.max(0, Math.min(100, Math.round(newStrength)));
  const nowSec = Math.floor(Date.now() / 1000);
  const nowIso = new Date(nowSec * 1000).toISOString();

  const existingTuples: StrengthHistoryTuple[] = (word.strengthHistory || []).filter(
    (t): t is StrengthHistoryTuple => Array.isArray(t) && t.length >= 3
  );

  // If this is a newly created word without prior history, create a single creation event
  if (existingTuples.length === 0 && reason === "created") {
    const createdAtSec = toTimestampSec(word.createdAt || nowIso);
    const initialTuple: StrengthHistoryTuple = [createdAtSec, boundedStrength, "created"];

    const newWord: Word = {
      ...word,
      strength: boundedStrength,
      learned: boundedStrength >= 80 ? true : boundedStrength === 0 ? false : word.learned,
      createdAt: word.createdAt || nowIso,
      strengthHistory: [initialTuple]
    };

    const computedNextReview = boundedStrength === 0
      ? nowIso
      : calculateNextReviewDate(newWord, boundedStrength, reason, new Date());

    return {
      ...newWord,
      nextReviewDate: word.nextReviewDate || computedNextReview
    };
  }

  const sortedTuples = [...existingTuples].sort((a, b) => a[0] - b[0]);
  const lastTuple = sortedTuples[sortedTuples.length - 1];

  // Prevent duplicate decay entries if the last entry is already a memory_decay entry with the exact same strength
  if (
    reason === "memory_decay" &&
    lastTuple &&
    lastTuple[2] === "memory_decay" &&
    lastTuple[1] === boundedStrength
  ) {
    return {
      ...word,
      strength: boundedStrength,
      learned: boundedStrength >= 80 ? word.learned : false,
      nextReviewDate: word.nextReviewDate || nowIso
    };
  }

  const newTuple: StrengthHistoryTuple = [nowSec, boundedStrength, reason];

  // Keep up to 30 history tuples max
  const updatedHistory = [...sortedTuples, newTuple].slice(-30);

  const newLearnedState = reason === "memory_decay"
    ? boundedStrength >= 80
    : (boundedStrength >= 80 ? true : boundedStrength === 0 ? false : word.learned);

  const interimWord: Word = {
    ...word,
    strength: boundedStrength,
    learned: newLearnedState,
    lastReviewed: reason === "memory_decay" ? word.lastReviewed : nowIso,
    strengthHistory: updatedHistory
  };

  const nextReviewDate = reason === "memory_decay"
    ? (word.nextReviewDate && new Date(word.nextReviewDate).getTime() < Date.now() ? word.nextReviewDate : nowIso)
    : calculateNextReviewDate(interimWord, boundedStrength, reason, new Date());

  return {
    ...interimWord,
    nextReviewDate
  };
}
