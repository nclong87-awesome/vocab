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
export function lockModel(
  provider: string, 
  model: string, 
  durationMs: number = ONE_HOUR_MS,
  errorMsg?: string
): void {
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

  const metrics = getModelMetricsMap();
  const existing = metrics[key];
  const reason = errorMsg || existing?.lastError || "Model locked due to API request failure or rate limit";
  const prevCalls = existing?.totalCalls ?? (existing?.lastTestedAt ? 1 : 0);
  const prevSuccesses = existing?.totalSuccesses ?? (existing?.lastTestedAt && !existing?.lastError ? 1 : 0);

  const newTotalCalls = prevCalls <= prevSuccesses ? prevSuccesses + 1 : prevCalls;

  let existingLogs = existing?.failureLogs ? [...existing.failureLogs] : [];

  // Don't add duplicate failure log if one was logged in the last 500ms
  const isDuplicateRecent = existingLogs.length > 0 && (now - existingLogs[0].timestamp < 500);
  if (!isDuplicateRecent) {
    const newLogEntry: FailureLogEntry = {
      id: `${now}-${Math.random().toString(36).substring(2, 7)}`,
      timestamp: now,
      reason
    };
    existingLogs = [newLogEntry, ...existingLogs].slice(0, 10);
  }

  metrics[key] = {
    ...existing,
    provider,
    model,
    lastTestedAt: now,
    lastError: reason,
    totalCalls: newTotalCalls,
    totalSuccesses: prevSuccesses,
    failureLogs: existingLogs
  };
  saveModelMetricsMap(metrics);

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
    { provider: "openrouter", model: "inclusionai/ling-3.0-flash:free" },
    { provider: "gemini", model: "gemini-3.6-flash" },
    { provider: "9flare", model: "pro/claude-haiku-4-5" },
    { provider: "openai", model: "gpt-5.4-mini" },
    { provider: "ollama", model: "gemma4:31b" }
  ];
}

export type ModelStatusIndicator = 'strong' | 'medium' | 'weak' | 'offline' | 'untested';

export interface FailureLogEntry {
  id: string;
  timestamp: number;
  reason: string;
}

export interface ModelMetricsRecord {
  provider: string;
  model: string;
  lastResponseTimeMs?: number | null;
  lastTestedAt?: number | null;
  lastError?: string | null;
  totalCalls?: number;
  totalSuccesses?: number;
  failureLogs?: FailureLogEntry[];
}

export type ModelMetricsMap = Record<string, ModelMetricsRecord>;

const METRICS_STORAGE_KEY = "vocab_learner_model_metrics";

export function getModelMetricsMap(): ModelMetricsMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(METRICS_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as ModelMetricsMap;
  } catch (e) {
    return {};
  }
}

export function saveModelMetricsMap(map: ModelMetricsMap): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(METRICS_STORAGE_KEY, JSON.stringify(map));
  } catch (e) {
    // ignore
  }
}

export function recordModelResponse(provider: string, model: string, durationMs: number): void {
  if (!provider || !model || provider === "auto" || model === "auto") return;
  const key = `${provider}:${model}`;
  
  // Unlock if previously locked
  unlockModel(provider, model);

  const metrics = getModelMetricsMap();
  const existing = metrics[key];

  const prevCalls = existing?.totalCalls ?? (existing?.lastTestedAt ? 1 : 0);
  const prevSuccesses = existing?.totalSuccesses ?? (existing?.lastTestedAt && !existing?.lastError ? 1 : 0);

  metrics[key] = {
    ...existing,
    provider,
    model,
    lastResponseTimeMs: Math.max(1, Math.round(durationMs)),
    lastTestedAt: Date.now(),
    lastError: null,
    totalCalls: prevCalls + 1,
    totalSuccesses: prevSuccesses + 1,
    failureLogs: existing?.failureLogs ?? []
  };
  saveModelMetricsMap(metrics);
}

export function recordModelFailure(provider: string, model: string, errorMsg?: string, durationMs?: number): void {
  if (!provider || !model || provider === "auto" || model === "auto") return;
  const key = `${provider}:${model}`;

  // Lock model
  lockModel(provider, model);

  const metrics = getModelMetricsMap();
  const existing = metrics[key];
  const now = Date.now();
  const reason = errorMsg || "Request failed";

  const prevCalls = existing?.totalCalls ?? (existing?.lastTestedAt ? 1 : 0);
  const prevSuccesses = existing?.totalSuccesses ?? (existing?.lastTestedAt && !existing?.lastError ? 1 : 0);

  let existingLogs = existing?.failureLogs;
  if (!existingLogs || existingLogs.length === 0) {
    if (existing?.lastError && existing?.lastTestedAt) {
      existingLogs = [{
        id: `${existing.lastTestedAt}`,
        timestamp: existing.lastTestedAt,
        reason: existing.lastError
      }];
    } else {
      existingLogs = [];
    }
  }

  const newLogEntry: FailureLogEntry = {
    id: `${now}-${Math.random().toString(36).substring(2, 7)}`,
    timestamp: now,
    reason
  };

  // Keep only the last 10 failure log entries (newest first)
  const updatedLogs = [newLogEntry, ...existingLogs].slice(0, 10);

  metrics[key] = {
    ...existing,
    provider,
    model,
    lastResponseTimeMs: durationMs ? Math.round(durationMs) : existing?.lastResponseTimeMs ?? null,
    lastTestedAt: now,
    lastError: reason,
    totalCalls: prevCalls + 1,
    totalSuccesses: prevSuccesses,
    failureLogs: updatedLogs
  };
  saveModelMetricsMap(metrics);
}

export function clearModelFailureLogs(provider: string, model: string): void {
  if (!provider || !model) return;
  const key = `${provider}:${model}`;
  const metrics = getModelMetricsMap();
  if (metrics[key]) {
    metrics[key].failureLogs = [];
    metrics[key].lastError = null;
    saveModelMetricsMap(metrics);
  }
}

export interface ModelStatusItem {
  provider: string;
  providerName: string;
  model: string;
  isLocked: boolean;
  lockedAt?: number;
  expiresAt?: number;
  lastResponseTimeMs: number | null;
  lastTestedAt: number | null;
  lastError: string | null;
  status: ModelStatusIndicator;
  totalCalls: number;
  totalSuccesses: number;
  failureLogs: FailureLogEntry[];
}

export function getModelStatusIndicator(isLocked: boolean, responseTimeMs?: number | null): ModelStatusIndicator {
  if (isLocked) return 'offline';
  if (responseTimeMs === null || responseTimeMs === undefined) return 'untested';
  if (responseTimeMs < 10000) return 'strong';
  if (responseTimeMs <= 20000) return 'medium';
  return 'weak';
}

function extractModelStats(
  metric?: ModelMetricsRecord,
  isLocked?: boolean,
  lockedAt?: number,
  lastErrorFromLock?: string | null
) {
  let totalCalls = metric?.totalCalls ?? 0;
  let totalSuccesses = metric?.totalSuccesses ?? 0;
  let failureLogs: FailureLogEntry[] = metric?.failureLogs ? [...metric.failureLogs] : [];

  if (metric && metric.totalCalls === undefined && metric.lastTestedAt) {
    if (metric.lastError) {
      totalCalls = 1;
      totalSuccesses = 0;
      if (failureLogs.length === 0) {
        failureLogs = [{
          id: `${metric.lastTestedAt}`,
          timestamp: metric.lastTestedAt,
          reason: metric.lastError
        }];
      }
    } else {
      totalCalls = 1;
      totalSuccesses = 1;
    }
  }

  // If the model is locked, a failure must be reflected in totalCalls and failureLogs
  if (isLocked) {
    if (totalCalls <= totalSuccesses) {
      totalCalls = totalSuccesses + 1;
    }
    if (failureLogs.length === 0) {
      const timestamp = lockedAt || metric?.lastTestedAt || Date.now();
      const reason = metric?.lastError || lastErrorFromLock || "Model locked due to API request failure or rate limit";
      failureLogs = [{
        id: `lock-${timestamp}`,
        timestamp,
        reason
      }];
    }
  }

  if (failureLogs.length > 10) {
    failureLogs = failureLogs.slice(0, 10);
  }

  return { totalCalls, totalSuccesses, failureLogs };
}

export function getAllModelStatuses(llmConfig?: LLMConfig): ModelStatusItem[] {
  const lockedMap = getLockedModels();
  const metricsMap = getModelMetricsMap();
  const result: ModelStatusItem[] = [];

  const providersToInclude = PROVIDER_OPTIONS.filter(p => p.id !== "auto" && p.id !== "custom");
  if (
    llmConfig?.savedProviders?.custom?.baseUrl ||
    (llmConfig?.provider === "custom" && llmConfig.baseUrl)
  ) {
    const customMeta = PROVIDER_OPTIONS.find(p => p.id === "custom");
    if (customMeta) providersToInclude.push(customMeta);
  }

  for (const p of providersToInclude) {
    for (const m of p.models) {
      if (!m || m === "auto") continue;
      const key = `${p.id}:${m}`;
      const lockedInfo = lockedMap[key];
      const isLocked = Boolean(lockedInfo && lockedInfo.expiresAt > Date.now());
      const metric = metricsMap[key];

      const lastResponseTimeMs = metric?.lastResponseTimeMs ?? null;
      const status = getModelStatusIndicator(isLocked, lastResponseTimeMs);
      const { totalCalls, totalSuccesses, failureLogs } = extractModelStats(
        metric, 
        isLocked, 
        lockedInfo?.lockedAt, 
        metric?.lastError
      );

      result.push({
        provider: p.id,
        providerName: p.name,
        model: m,
        isLocked,
        lockedAt: lockedInfo?.lockedAt,
        expiresAt: lockedInfo?.expiresAt,
        lastResponseTimeMs,
        lastTestedAt: metric?.lastTestedAt ?? null,
        lastError: metric?.lastError ?? null,
        status,
        totalCalls,
        totalSuccesses,
        failureLogs
      });
    }
  }

  // Include any models present in metrics, locks, or active config that were not in static provider lists
  const addedKeys = new Set(result.map(r => `${r.provider}:${r.model}`));
  const extraKeys = new Set([
    ...Object.keys(metricsMap),
    ...Object.keys(lockedMap),
    ...(llmConfig?.provider && llmConfig?.model && llmConfig.provider !== "auto" && llmConfig.model !== "auto"
      ? [`${llmConfig.provider}:${llmConfig.model}`]
      : [])
  ]);

  for (const key of extraKeys) {
    if (!addedKeys.has(key)) {
      const [pId, ...mParts] = key.split(':');
      const m = mParts.join(':');
      if (!pId || !m || m === "auto") continue;

      const providerOpt = PROVIDER_OPTIONS.find(p => p.id === pId);
      const providerName = providerOpt?.name || pId;
      const lockedInfo = lockedMap[key];
      const isLocked = Boolean(lockedInfo && lockedInfo.expiresAt > Date.now());
      const metric = metricsMap[key];

      const lastResponseTimeMs = metric?.lastResponseTimeMs ?? null;
      const status = getModelStatusIndicator(isLocked, lastResponseTimeMs);
      const { totalCalls, totalSuccesses, failureLogs } = extractModelStats(
        metric, 
        isLocked, 
        lockedInfo?.lockedAt, 
        metric?.lastError
      );

      result.push({
        provider: pId,
        providerName,
        model: m,
        isLocked,
        lockedAt: lockedInfo?.lockedAt,
        expiresAt: lockedInfo?.expiresAt,
        lastResponseTimeMs,
        lastTestedAt: metric?.lastTestedAt ?? null,
        lastError: metric?.lastError ?? null,
        status,
        totalCalls,
        totalSuccesses,
        failureLogs
      });
      addedKeys.add(key);
    }
  }

  // Sort by fastest response time first
  result.sort((a, b) => {
    const getSortWeight = (item: ModelStatusItem) => {
      if (item.status === 'offline') {
        return 10000000 + (item.lastResponseTimeMs ?? 999999);
      }
      if (item.status === 'untested' || item.lastResponseTimeMs === null) {
        return 5000000;
      }
      return item.lastResponseTimeMs;
    };

    return getSortWeight(a) - getSortWeight(b);
  });

  return result;
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
