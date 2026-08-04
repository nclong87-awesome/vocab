import { LLMConfig, LLMProvider } from "../types";
import { PROVIDER_OPTIONS } from "../config/llmProviders";

const STORAGE_KEY = "vocab_learner_locked_models";
const ONE_HOUR_MS = 60 * 60 * 1000;

export interface LockedModelInfo {
  provider: string;
  model: string;
  lockedAt: number;
  expiresAt: number;
}

export type LockedModelsMap = Record<string, LockedModelInfo>;

/**
 * Gets currently locked models map from localStorage or memory.
 */
export function getLockedModels(): LockedModelsMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: LockedModelsMap = JSON.parse(raw);
    const now = Date.now();
    const active: LockedModelsMap = {};
    let changed = false;

    for (const key of Object.keys(parsed)) {
      if (parsed[key] && parsed[key].expiresAt > now) {
        active[key] = parsed[key];
      } else {
        changed = true; // Clean up expired lockouts
      }
    }

    if (changed) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(active));
    }

    return active;
  } catch (e) {
    return {};
  }
}

/**
 * Checks if a model is currently locked.
 */
export function isModelLocked(provider: string, model: string): boolean {
  const locked = getLockedModels();
  const key = `${provider}:${model}`;
  return Boolean(locked[key] && locked[key].expiresAt > Date.now());
}

/**
 * Locks a model for durationMs (defaults to 1 hour = 3,600,000 ms).
 */
export function lockModel(provider: string, model: string, durationMs: number = ONE_HOUR_MS): void {
  if (provider === "auto" || model === "auto") return;
  const locked = getLockedModels();
  const key = `${provider}:${model}`;
  const now = Date.now();
  
  locked[key] = {
    provider,
    model,
    lockedAt: now,
    expiresAt: now + durationMs
  };

  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(locked));
    } catch (e) {
      // ignore storage error
    }
  }

  console.warn(`[Auto Mode] Locked model ${key} for ${Math.round(durationMs / 60000)} minutes until ${new Date(now + durationMs).toLocaleTimeString()}`);
}

/**
 * Unlocks a specific model manually.
 */
export function unlockModel(provider: string, model: string): void {
  const locked = getLockedModels();
  const key = `${provider}:${model}`;
  if (locked[key]) {
    delete locked[key];
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(locked));
      } catch (e) {}
    }
  }
}

/**
 * Clears all model locks.
 */
export function clearAllLocks(): void {
  if (typeof window !== "undefined") {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {}
  }
}

export interface AutoCandidate {
  provider: LLMProvider;
  model: string;
}

/**
 * Constructs candidate model list from all providers (except "auto").
 */
export function getAutoModelCandidates(llmConfig?: LLMConfig): AutoCandidate[] {
  const candidates: AutoCandidate[] = [];
  const providersToInclude = PROVIDER_OPTIONS.filter(p => p.id !== "auto" && p.id !== "custom");

  // Include custom if user has saved custom endpoint or custom provider config
  if (
    llmConfig?.savedProviders?.custom?.baseUrl ||
    (llmConfig?.provider === "custom" && llmConfig.baseUrl)
  ) {
    const customMeta = PROVIDER_OPTIONS.find(p => p.id === "custom");
    if (customMeta) providersToInclude.push(customMeta);
  }

  const maxModels = Math.max(...providersToInclude.map(p => p.models.length), 0);

  // Interleave models across providers so rotation alternates providers
  for (let i = 0; i < maxModels; i++) {
    for (const p of providersToInclude) {
      if (p.models[i] && p.models[i] !== "auto") {
        candidates.push({ provider: p.id, model: p.models[i] });
      }
    }
  }

  return candidates.length > 0 ? candidates : [
    { provider: "groq", model: "openai/gpt-oss-120b" },
    { provider: "openrouter", model: "deepseek/deepseek-chat" },
    { provider: "gemini", model: "gemini-3.6-flash" },
    { provider: "9flare", model: "pro/claude-haiku-4-5" },
    { provider: "openai", model: "gpt-5.4-mini" },
    { provider: "ollama", model: "gemma4:31b" }
  ];
}

let autoRotationIndex = 0;

/**
 * Picks the next unlocked candidate in rotation order.
 * If all models are locked, it auto-clears locks so the system continues seamlessly!
 */
export function getNextAutoCandidate(
  llmConfig?: LLMConfig,
  excludedKeys?: Set<string>
): AutoCandidate {
  const candidates = getAutoModelCandidates(llmConfig);
  const lockedMap = getLockedModels();

  // Find candidate that is NOT locked and NOT excluded in this request attempt
  for (let i = 0; i < candidates.length; i++) {
    const idx = (autoRotationIndex + i) % candidates.length;
    const cand = candidates[idx];
    const key = `${cand.provider}:${cand.model}`;

    if (!lockedMap[key] && (!excludedKeys || !excludedKeys.has(key))) {
      autoRotationIndex = (idx + 1) % candidates.length; // Advance index for next call
      return cand;
    }
  }

  // Fallback: If all candidates are locked or excluded, find candidate with earliest lock expiration or clear locks
  console.warn("[Auto Mode] All candidate models are currently locked or failed. Resetting locks to prevent total lock-out.");
  clearAllLocks();
  autoRotationIndex = (autoRotationIndex + 1) % candidates.length;
  return candidates[0];
}
