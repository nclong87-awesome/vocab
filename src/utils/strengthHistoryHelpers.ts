import { Word, StrengthHistoryEntry } from "../types";

/**
 * Gets or synthesizes a clean, chronological strength history for a word.
 * If the word lacks history, creates a single initial creation checkpoint,
 * and a review entry only if the word has actually been reviewed later.
 */
export function getEffectiveStrengthHistory(word: Word): StrengthHistoryEntry[] {
  if (word.strengthHistory && word.strengthHistory.length > 0) {
    return [...word.strengthHistory].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
  }

  // Synthesize history if none exists yet
  const createdAt = word.createdAt || new Date().toISOString();
  const history: StrengthHistoryEntry[] = [];

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

  return history;
}

/**
 * Appends a new strength event entry to the word's history and updates strength metrics.
 */
export function recordStrengthHistory(
  word: Word,
  newStrength: number,
  reason: StrengthHistoryEntry["reason"],
  note?: string
): Word {
  const boundedStrength = Math.max(0, Math.min(100, Math.round(newStrength)));
  const nowIso = new Date().toISOString();

  // If this is a newly created word without prior history, create a single creation event
  if ((!word.strengthHistory || word.strengthHistory.length === 0) && reason === "created") {
    const initialEntry: StrengthHistoryEntry = {
      id: `hist-created-${word.id || Date.now()}`,
      timestamp: word.createdAt || nowIso,
      strength: boundedStrength,
      delta: 0,
      reason: "created",
      note: note || "Added to vocabulary collection"
    };

    return {
      ...word,
      strength: boundedStrength,
      learned: boundedStrength >= 80 ? true : boundedStrength === 0 ? false : word.learned,
      createdAt: word.createdAt || nowIso,
      strengthHistory: [initialEntry]
    };
  }

  const previousHistory = getEffectiveStrengthHistory(word);
  const lastEntry = previousHistory[previousHistory.length - 1];
  const delta = boundedStrength - (lastEntry ? lastEntry.strength : word.strength || 0);

  const newEntry: StrengthHistoryEntry = {
    id: `hist-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    timestamp: nowIso,
    strength: boundedStrength,
    delta,
    reason,
    note: note || getReasonDefaultNote(reason, delta)
  };

  // Keep up to 50 history entries max
  const updatedHistory = [...previousHistory, newEntry].slice(-50);

  return {
    ...word,
    strength: boundedStrength,
    learned: boundedStrength >= 80 ? true : boundedStrength === 0 ? false : word.learned,
    lastReviewed: nowIso,
    strengthHistory: updatedHistory
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
