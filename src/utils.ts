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

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit & { timeoutMs?: number }
): Promise<Response> {
  const urlString = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
  const isImageAnalysisWorker = urlString.includes("image-analysis.nclong87.workers.dev");
  const timeoutMs = init?.timeoutMs !== undefined ? init.timeoutMs : (isImageAnalysisWorker ? 0 : 60000);

  if (timeoutMs <= 0) {
    const { timeoutMs: _, ...fetchInit } = init || {};
    return fetch(input, fetchInit);
  }

  const controller = new AbortController();
  const id = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  const { timeoutMs: _, ...fetchInit } = init || {};

  if (fetchInit.signal) {
    if (fetchInit.signal.aborted) {
      controller.abort();
    } else {
      fetchInit.signal.addEventListener("abort", () => controller.abort());
    }
  }

  try {
    const response = await fetch(input, {
      ...fetchInit,
      signal: controller.signal
    });

    const originalText = response.text.bind(response);
    const originalJson = response.json.bind(response);

    response.text = async () => {
      try {
        const textPromise = originalText();
        const timeoutPromise = new Promise<never>((_, reject) => {
          if (controller.signal.aborted) {
            reject(new Error(`API call timed out after ${Math.round(timeoutMs / 1000)} seconds.`));
          }
          controller.signal.addEventListener("abort", () => {
            reject(new Error(`API call timed out after ${Math.round(timeoutMs / 1000)} seconds.`));
          });
        });
        return await Promise.race([textPromise, timeoutPromise]);
      } finally {
        clearTimeout(id);
      }
    };

    response.json = async () => {
      try {
        const jsonPromise = originalJson();
        const timeoutPromise = new Promise<never>((_, reject) => {
          if (controller.signal.aborted) {
            reject(new Error(`API call timed out after ${Math.round(timeoutMs / 1000)} seconds.`));
          }
          controller.signal.addEventListener("abort", () => {
            reject(new Error(`API call timed out after ${Math.round(timeoutMs / 1000)} seconds.`));
          });
        });
        return await Promise.race([jsonPromise, timeoutPromise]);
      } finally {
        clearTimeout(id);
      }
    };

    return response;
  } catch (error: any) {
    clearTimeout(id);
    if (error.name === "AbortError" || controller.signal.aborted) {
      throw new Error(`API call timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
    }
    throw error;
  }
}
