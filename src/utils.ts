import { Streak } from "./types";

export function getTodayStr(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getYesterdayStr(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function calculateNewStreak(currentStreak?: Streak): Streak {
  const today = getTodayStr();
  const yesterday = getYesterdayStr();
  
  const safeStreak = currentStreak || { count: 0, lastActiveDate: "", history: [] };
  const history = Array.isArray(safeStreak.history) ? [...safeStreak.history] : [];
  let count = typeof safeStreak.count === "number" ? safeStreak.count : 0;

  // If already studied today, history has it, do not double-increment count
  if (history.includes(today)) {
    return {
      count,
      lastActiveDate: today,
      history
    };
  }

  // Add today to history
  history.push(today);

  // Check last active date to update streak count
  if (safeStreak.lastActiveDate === yesterday) {
    count += 1;
  } else if (safeStreak.lastActiveDate === today) {
    // No change
  } else {
    // Streak broken or brand new
    count = 1;
  }

  return {
    count,
    lastActiveDate: today,
    history
  };
}
