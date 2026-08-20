import { LLMConfig, LLMProvider } from "../types";
import { PROVIDER_OPTIONS } from "../config/llmProviders";

const STORAGE_KEY = "vocab_learner_locked_models";
export const ONE_HOUR_MS = 60 * 60 * 1000;
export const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
export const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;

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
        const info = parsed[key];
        const providerOpt = PROVIDER_OPTIONS.find(p => p.id === info.provider);
        if (providerOpt) {
          if (info.provider !== "custom" && !providerOpt.models.includes(info.model)) {
            changed = true; // Clean up removed model lockout
            continue;
          }
        } else if (info.provider !== "custom") {
          changed = true; // Clean up removed provider lockout
          continue;
        }
        active[key] = info;
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
 * Calculates an optimal lock duration (in ms) based on a model's metrics history,
 * failure rates, recency-weighted accumulation over the last 3 days, and response times.
 * Bounds: Minimum 1 hour, Maximum 2 days (48 hours).
 */
export function calculateOptimalLockDuration(
  provider: string,
  model: string,
  errorReason?: string
): number {
  const key = `${provider}:${model}`;
  const metrics = getModelMetricsMap();
  const metric = metrics[key];

  // Base fallback if no metrics yet: 1 hour minimum
  if (!metric) {
    return ONE_HOUR_MS;
  }

  const now = Date.now();
  const totalCalls = metric.totalCalls ?? 0;
  const totalSuccesses = metric.totalSuccesses ?? 0;

  // 1. Calculate accumulated base duration from failure frequency over the last 3 days (72 hours)
  const threeDaysAgo = now - THREE_DAYS_MS;
  const recentFailures = (metric.failureLogs || []).filter(log => log.timestamp >= threeDaysAgo);
  
  // Flag indicating whether this calculation is triggered by an active/immediate failure
  const isCurrentlyFailing = errorReason !== undefined;

  let accumulatedBaseDurationMs = 0;

  // If currently failing, add base 1-hour unit for the immediate failure (age = 0, weight = 1.0)
  if (isCurrentlyFailing) {
    accumulatedBaseDurationMs += ONE_HOUR_MS;
  }

  // Accumulate recency-weighted lockout for each separate historical failure in the 3-day window.
  // Recent failures (e.g. 10m ago or 1h ago) contribute strongly (~1h), while older failures
  // from 1-3 days ago decay gracefully down to a small fraction.
  for (const log of recentFailures) {
    const ageMs = Math.max(0, now - log.timestamp);
    // If this failure log corresponds to the current immediate failure, avoid double-counting
    if (isCurrentlyFailing && ageMs < 2000) {
      continue;
    }
    if (ageMs <= THREE_DAYS_MS) {
      const normalizedAge = Math.min(1, ageMs / THREE_DAYS_MS);
      // Smooth decay curve from 1.0 (now) down to 0.08 (3 days ago)
      const recencyWeight = Math.max(0.08, Math.pow(1 - normalizedAge, 1.4));
      accumulatedBaseDurationMs += ONE_HOUR_MS * recencyWeight;
    }
  }

  // Fallback safety if no failures were accumulated
  if (accumulatedBaseDurationMs <= 0) {
    accumulatedBaseDurationMs = ONE_HOUR_MS;
  }

  // 2. Response Time Multiplier
  // Models with consistently high response times are locked out for longer
  let responseTimeMultiplier = 1.0;
  const avgResponseTimeMs = metric.avgResponseTimeMs ?? metric.lastResponseTimeMs ?? 0;
  if (avgResponseTimeMs > 15000) {
    // Scales from 1.0 up to 3.0 at 45 seconds or more
    responseTimeMultiplier = Math.min(3.0, avgResponseTimeMs / 15000);
  }

  // 3. Historical Reliability Factor
  // Models with high success rates get discounts; consistently failing models get penalties.
  let reliabilityMultiplier = 1.0;
  if (totalCalls >= 3) {
    const successRate = totalSuccesses / totalCalls;
    if (successRate >= 0.9) {
      reliabilityMultiplier = 0.5; // Halve lock duration for highly reliable models
    } else if (successRate < 0.5) {
      reliabilityMultiplier = 2.0; // Double lock duration for highly unreliable models
    } else if (successRate < 0.75) {
      reliabilityMultiplier = 1.5; // 1.5x penalty for moderately unreliable models
    }
  }

  // Apply multipliers to accumulated base
  const finalDurationMs = accumulatedBaseDurationMs * responseTimeMultiplier * reliabilityMultiplier;

  // 4. Clamping boundaries: 1 hour minimum, 2 days (48 hours) maximum
  const MIN_LOCK_MS = ONE_HOUR_MS; // 1 hour (3,600,000 ms)
  const MAX_LOCK_MS = TWO_DAYS_MS; // 2 days (172,800,000 ms)

  return Math.max(MIN_LOCK_MS, Math.min(MAX_LOCK_MS, Math.round(finalDurationMs)));
}

/**
 * Locks a model for durationMs (defaults to 1 hour = 3,600,000 ms, which triggers dynamic optimal calculation).
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
  
  // If the standard duration (ONE_HOUR_MS), 3600000 ms, or no duration is passed, upgrade to smart calculation
  let resolvedDurationMs = durationMs;
  if (resolvedDurationMs === ONE_HOUR_MS || resolvedDurationMs === 3600000 || !durationMs) {
    resolvedDurationMs = calculateOptimalLockDuration(provider, model, errorMsg);
  }
  
  locked[key] = {
    provider,
    model,
    lockedAt: now,
    expiresAt: now + resolvedDurationMs
  };

  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(locked));
    } catch (e) {
      // ignore storage error
    }
  }

  const durationHours = (resolvedDurationMs / ONE_HOUR_MS).toFixed(1);
  console.warn(`[Auto Mode] Locked model ${key} dynamically for ${durationHours}h (${Math.round(resolvedDurationMs / 60000)} mins) until ${new Date(now + resolvedDurationMs).toLocaleString()} (Error: ${errorMsg || "None"})`);
}

/**
 * Synchronizes server model locks into client localStorage.
 */
export function syncServerLocks(serverLocks?: { key: string; expiresAt: number }[] | string[]): void {
  if (!serverLocks || !Array.isArray(serverLocks) || serverLocks.length === 0) return;
  const locked = getLockedModels();
  let changed = false;
  const now = Date.now();

  for (const item of serverLocks) {
    if (typeof item === "string") {
      const [p, ...mParts] = item.split(":");
      const m = mParts.join(":");
      if (p && m) {
        locked[`${p}:${m}`] = {
          provider: p,
          model: m,
          lockedAt: now,
          expiresAt: now + ONE_HOUR_MS,
        };
        changed = true;
      }
    } else if (item && item.key && item.expiresAt > now) {
      const [p, ...mParts] = item.key.split(":");
      const m = mParts.join(":");
      if (p && m) {
        locked[item.key] = {
          provider: p,
          model: m,
          lockedAt: now,
          expiresAt: item.expiresAt,
        };
        changed = true;
      }
    }
  }

  if (changed && typeof window !== "undefined") {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(locked));
    } catch (e) {}
  }
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

const AUTO_ROTATION_STORAGE_KEY = "vocab_auto_mode_rotation_index";

export function getAutoRotationIndex(): number {
  if (typeof window === "undefined") return autoRotationIndex;
  try {
    const val = localStorage.getItem(AUTO_ROTATION_STORAGE_KEY);
    if (val !== null) {
      const parsed = parseInt(val, 10);
      if (!isNaN(parsed) && parsed >= 0) {
        autoRotationIndex = parsed;
        return parsed;
      }
    }
  } catch (e) {}
  return autoRotationIndex;
}

export function saveAutoRotationIndex(idx: number): void {
  autoRotationIndex = idx;
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(AUTO_ROTATION_STORAGE_KEY, String(idx));
    } catch (e) {}
  }
}

export function advanceAutoRotationIndex(): void {
  const current = getAutoRotationIndex();
  saveAutoRotationIndex(current + 1);
}

/**
 * Resets all model states, including locks, failure logs, error messages, 
 * total calls, success rates, response times, and internal rotation counters.
 */
export function resetAllModelStates(): void {
  if (typeof window !== "undefined") {
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(METRICS_STORAGE_KEY);
      localStorage.removeItem(AUTO_ROTATION_STORAGE_KEY);
    } catch (e) {
      console.error("Error clearing model storage keys from localStorage:", e);
    }
  }
  autoRotationIndex = 0;
  explorationCallCounter = 0;
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
  let providersToInclude = PROVIDER_OPTIONS.filter(p => p.id !== "auto" && p.id !== "custom");

  if (llmConfig?.provider && llmConfig.provider !== "auto" && llmConfig.provider !== "custom") {
    providersToInclude = providersToInclude.filter(p => p.id === llmConfig.provider);
  }

  // Include custom if user has saved custom endpoint or custom provider config
  if (
    llmConfig?.savedProviders?.custom?.baseUrl ||
    (llmConfig?.provider === "custom" && llmConfig.baseUrl)
  ) {
    if (!llmConfig?.provider || llmConfig.provider === "auto" || llmConfig.provider === "custom") {
      const customMeta = PROVIDER_OPTIONS.find(p => p.id === "custom");
      if (customMeta && !providersToInclude.some(p => p.id === "custom")) {
        providersToInclude.push(customMeta);
      }
    }
  }

  const maxModels = Math.max(...providersToInclude.map(p => p.models.length), 0);

  // Interleave models across providers so rotation alternates providers
  for (let i = 0; i < maxModels; i++) {
    for (const p of providersToInclude) {
      if (p.models[i] && p.models[i] !== "auto") {
        const modelName = p.models[i];
        candidates.push({ provider: p.id, model: modelName });
      }
    }
  }
  if (candidates.length > 0) {
    return candidates;
  }
  const fallbackCandidates = PROVIDER_OPTIONS.filter(p => p.id !== "auto" && p.id !== "custom").map(p => ({
    provider: p.id,
    model: p.defaultModel
  }));
  return fallbackCandidates;
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
  avgResponseTimeMs?: number | null;
  recentResponseTimes?: number[];
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
    const parsed = JSON.parse(raw) as ModelMetricsMap;
    const active: ModelMetricsMap = {};
    let changed = false;

    for (const key of Object.keys(parsed)) {
      const entry = parsed[key];
      if (!entry || !entry.provider || !entry.model) {
        changed = true;
        continue;
      }
      const providerOpt = PROVIDER_OPTIONS.find(p => p.id === entry.provider);
      if (providerOpt) {
        const isModelValid = 
          entry.provider === "custom" || 
          providerOpt.models.includes(entry.model) ||
          Boolean(providerOpt.visionModels?.includes(entry.model)) ||
          Boolean(providerOpt.tts_models?.includes(entry.model));

        if (!isModelValid) {
          changed = true;
          continue;
        }
      } else if (entry.provider !== "custom") {
        changed = true;
        continue;
      }
      active[key] = entry;
    }

    if (changed) {
      saveModelMetricsMap(active);
    }

    return active;
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

  const validDuration = Math.max(1, Math.round(durationMs));
  const prevTimes = Array.isArray(existing?.recentResponseTimes)
    ? existing.recentResponseTimes
    : (typeof existing?.lastResponseTimeMs === "number" && existing.lastResponseTimeMs > 0 ? [existing.lastResponseTimeMs] : []);

  // Maintain the last 10 successful requests (skip failed requests)
  const updatedRecentTimes = [...prevTimes, validDuration].slice(-10);
  const avgTime = Math.round(
    updatedRecentTimes.reduce((sum, t) => sum + t, 0) / updatedRecentTimes.length
  );

  metrics[key] = {
    ...existing,
    provider,
    model,
    lastResponseTimeMs: avgTime,
    avgResponseTimeMs: avgTime,
    recentResponseTimes: updatedRecentTimes,
    lastTestedAt: Date.now(),
    lastError: null,
    totalCalls: prevCalls + 1,
    totalSuccesses: prevSuccesses + 1,
    failureLogs: existing?.failureLogs ?? []
  };
  saveModelMetricsMap(metrics);
}

export function deduplicateFailureLogs(logs: FailureLogEntry[]): FailureLogEntry[] {
  if (!logs || logs.length === 0) return [];
  const result: FailureLogEntry[] = [];

  for (const log of logs) {
    const isDup = result.some(existing => {
      const timeDiff = Math.abs(existing.timestamp - log.timestamp);
      if (timeDiff < 2000) {
        if (
          existing.reason === log.reason ||
          existing.reason.includes("Model locked") ||
          log.reason.includes("Model locked")
        ) {
          return true;
        }
      }
      return false;
    });

    if (!isDup) {
      result.push(log);
    }
  }

  return result;
}

export function recordModelFailure(provider: string, model: string, errorMsg?: string, _durationMs?: number): void {
  if (!provider || !model || provider === "auto" || model === "auto") return;
  const key = `${provider}:${model}`;
  const now = Date.now();
  const reason = errorMsg || "Request failed";

  // Lock model
  lockModel(provider, model, ONE_HOUR_MS, reason);

  const metrics = getModelMetricsMap();
  const existing = metrics[key];

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

  // Keep deduplicated failure logs from the last 3 days (up to 50 entries)
  const threeDaysAgo = now - THREE_DAYS_MS;
  const updatedLogs = deduplicateFailureLogs([newLogEntry, ...existingLogs])
    .filter(log => log.timestamp >= threeDaysAgo)
    .slice(0, 50);

  // Preserve existing successful response times; failed requests are skipped
  const existingTimes = Array.isArray(existing?.recentResponseTimes)
    ? existing.recentResponseTimes
    : (typeof existing?.lastResponseTimeMs === "number" && existing.lastResponseTimeMs > 0 ? [existing.lastResponseTimeMs] : []);

  const avgTime = existingTimes.length > 0
    ? Math.round(existingTimes.reduce((sum, t) => sum + t, 0) / existingTimes.length)
    : null;

  metrics[key] = {
    ...existing,
    provider,
    model,
    lastResponseTimeMs: avgTime,
    avgResponseTimeMs: avgTime,
    recentResponseTimes: existingTimes,
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
  unlockModel(provider, model);
}

export function resetModelFullState(provider: string, model: string): void {
  if (!provider || !model) return;
  const key = `${provider}:${model}`;
  const metrics = getModelMetricsMap();
  if (metrics[key]) {
    delete metrics[key];
    saveModelMetricsMap(metrics);
  }
  unlockModel(provider, model);
}

export type PerformanceTierNumber = 1 | 2 | 3 | 4;

export const METRIC_STALE_MS = 15 * 60 * 1000; // 15 minutes helper for reference

export function isMetricStale(lastTestedAt: number | null): boolean {
  if (!lastTestedAt) return true;
  return Date.now() - lastTestedAt > METRIC_STALE_MS;
}

export interface PerformanceTierInfo {
  tier: PerformanceTierNumber;
  name: string;
  badgeLabel: string;
  shortLabel: string;
  description: string;
  colorClass: string;
}

export function getModelPerformanceTier(
  status: ModelStatusIndicator, 
  responseTimeMs?: number | null,
  totalSuccesses?: number
): PerformanceTierNumber {
  if (status === 'offline') return 4;
  
  // Untested models (0 successful requests or null response time) are placed in Tier 1 as Probes so they get benchmarked immediately
  if (status === 'untested' || responseTimeMs === null || responseTimeMs === undefined || (totalSuccesses !== undefined && totalSuccesses < 1)) {
    return 1;
  }
  
  if (status === 'strong' || responseTimeMs < 15000) return 1;
  if (status === 'medium' || responseTimeMs < 25000) return 2;
  return 4; // 'weak' / slow models (>= 25s)
}

export function getPerformanceTierMeta(
  tier: PerformanceTierNumber,
  isUntested?: boolean
): PerformanceTierInfo {
  switch (tier) {
    case 1:
      return {
        tier: 1,
        name: "Tier 1: High-Speed Priority & New Probes",
        badgeLabel: isUntested ? "Tier 1 (Probe/New)" : "Tier 1 (Fast)",
        shortLabel: "Tier 1: Fast",
        description: isUntested 
          ? "Untested model prioritized in Tier 1 for benchmark probing. Once it completes 1 successful request, it graduates to regular Tier 1 rotation."
          : "Fast response times (0–15s). First priority choice rotating evenly across all models.",
        colorClass: isUntested 
          ? "bg-sky-50 text-sky-800 border-sky-200" 
          : "bg-emerald-50 text-emerald-700 border-emerald-200"
      };
    case 2:
      return {
        tier: 2,
        name: "Tier 2: Medium Performance",
        badgeLabel: "Tier 2 (Medium)",
        shortLabel: "Tier 2: Medium",
        description: "Medium response times (15–25s). Automatically re-probed periodically for promotion to Tier 1.",
        colorClass: "bg-amber-50 text-amber-700 border-amber-200"
      };
    case 3:
      return {
        tier: 3,
        name: "Tier 3: Moderate Backup",
        badgeLabel: "Tier 3 (Backup)",
        shortLabel: "Tier 3: Backup",
        description: "Secondary backup tier.",
        colorClass: "bg-stone-100 text-stone-700 border-stone-200"
      };
    case 4:
    default:
      return {
        tier: 4,
        name: "Tier 4: Demoted Fallback",
        badgeLabel: "Tier 4 (Slow Fallback)",
        shortLabel: "Tier 4: Slow",
        description: "Slow response (25s or more). Demoted as emergency backups, but periodically re-evaluated to detect performance recovery.",
        colorClass: "bg-orange-50 text-orange-800 border-orange-200"
      };
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
  avgResponseTimeMs: number | null;
  recentResponseTimes: number[];
  recentSamplesCount: number;
  lastTestedAt: number | null;
  lastError: string | null;
  status: ModelStatusIndicator;
  performanceTier: PerformanceTierNumber;
  totalCalls: number;
  totalSuccesses: number;
  failureLogs: FailureLogEntry[];
}

export function getModelStatusIndicator(
  isLocked: boolean, 
  responseTimeMs?: number | null,
  _hasLastError?: boolean,
  _totalCalls?: number,
  _totalSuccesses?: number
): ModelStatusIndicator {
  if (isLocked) return 'offline';
  if (responseTimeMs === null || responseTimeMs === undefined) return 'untested';
  if (responseTimeMs < 15000) return 'strong';
  if (responseTimeMs < 25000) return 'medium';
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

  // Deduplicate failure logs so redundant/duplicate entries (e.g. from previous double logging) are cleaned up
  failureLogs = deduplicateFailureLogs(failureLogs);

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

  const threeDaysAgo = Date.now() - THREE_DAYS_MS;
  failureLogs = failureLogs.filter(log => log.timestamp >= threeDaysAgo);
  if (failureLogs.length > 50) {
    failureLogs = failureLogs.slice(0, 50);
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
      const hasLastError = Boolean(metric?.lastError);

      const { totalCalls, totalSuccesses, failureLogs } = extractModelStats(
        metric, 
        isLocked, 
        lockedInfo?.lockedAt, 
        metric?.lastError
      );

      const recentResponseTimes: number[] = Array.isArray(metric?.recentResponseTimes)
        ? metric.recentResponseTimes
        : (typeof metric?.lastResponseTimeMs === 'number' && metric.lastResponseTimeMs > 0 ? [metric.lastResponseTimeMs] : []);

      const avgResponseTimeMs = recentResponseTimes.length > 0
        ? Math.round(recentResponseTimes.reduce((acc, val) => acc + val, 0) / recentResponseTimes.length)
        : (typeof metric?.avgResponseTimeMs === 'number' ? metric.avgResponseTimeMs : (totalSuccesses > 0 ? metric?.lastResponseTimeMs ?? null : null));

      // Effective response time is the average of recent successful requests (null if 0 successes)
      const effectiveResponseTimeMs = (totalCalls > 0 && totalSuccesses === 0) ? null : avgResponseTimeMs;

      const lastTestedAt = metric?.lastTestedAt ?? null;
      const status = getModelStatusIndicator(isLocked, effectiveResponseTimeMs, hasLastError, totalCalls, totalSuccesses);
      const performanceTier = getModelPerformanceTier(status, effectiveResponseTimeMs, totalSuccesses);

      result.push({
        provider: p.id,
        providerName: p.name,
        model: m,
        isLocked,
        lockedAt: lockedInfo?.lockedAt,
        expiresAt: lockedInfo?.expiresAt,
        lastResponseTimeMs: effectiveResponseTimeMs,
        avgResponseTimeMs: effectiveResponseTimeMs,
        recentResponseTimes,
        recentSamplesCount: recentResponseTimes.length,
        lastTestedAt,
        lastError: metric?.lastError ?? null,
        status,
        performanceTier,
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

      // Filter out models belonging to standard providers that have been removed from PROVIDER_OPTIONS
      if (providerOpt) {
        if (pId !== "custom" && !providerOpt.models.includes(m)) {
          continue;
        }
      } else if (pId !== "custom") {
        continue;
      }

      const providerName = providerOpt?.name || pId;
      const lockedInfo = lockedMap[key];
      const isLocked = Boolean(lockedInfo && lockedInfo.expiresAt > Date.now());
      const metric = metricsMap[key];
      const hasLastError = Boolean(metric?.lastError);

      const { totalCalls, totalSuccesses, failureLogs } = extractModelStats(
        metric, 
        isLocked, 
        lockedInfo?.lockedAt, 
        metric?.lastError
      );

      const recentResponseTimes: number[] = Array.isArray(metric?.recentResponseTimes)
        ? metric.recentResponseTimes
        : (typeof metric?.lastResponseTimeMs === 'number' && metric.lastResponseTimeMs > 0 ? [metric.lastResponseTimeMs] : []);

      const avgResponseTimeMs = recentResponseTimes.length > 0
        ? Math.round(recentResponseTimes.reduce((acc, val) => acc + val, 0) / recentResponseTimes.length)
        : (typeof metric?.avgResponseTimeMs === 'number' ? metric.avgResponseTimeMs : (totalSuccesses > 0 ? metric?.lastResponseTimeMs ?? null : null));

      const effectiveResponseTimeMs = (totalCalls > 0 && totalSuccesses === 0) ? null : avgResponseTimeMs;

      const lastTestedAt = metric?.lastTestedAt ?? null;
      const status = getModelStatusIndicator(isLocked, effectiveResponseTimeMs, hasLastError, totalCalls, totalSuccesses);
      const performanceTier = getModelPerformanceTier(status, effectiveResponseTimeMs, totalSuccesses);

      result.push({
        provider: pId,
        providerName,
        model: m,
        isLocked,
        lockedAt: lockedInfo?.lockedAt,
        expiresAt: lockedInfo?.expiresAt,
        lastResponseTimeMs: effectiveResponseTimeMs,
        avgResponseTimeMs: effectiveResponseTimeMs,
        recentResponseTimes,
        recentSamplesCount: recentResponseTimes.length,
        lastTestedAt,
        lastError: metric?.lastError ?? null,
        status,
        performanceTier,
        totalCalls,
        totalSuccesses,
        failureLogs
      });
      addedKeys.add(key);
    }
  }

  // Sort by performance tier first (Tier 1 -> Tier 2 -> Tier 3 -> Tier 4), then by response time
  result.sort((a, b) => {
    const getSortWeight = (item: ModelStatusItem) => {
      if (item.status === 'offline') {
        return 10000000 + (item.lastResponseTimeMs ?? 999999);
      }
      return (item.performanceTier * 1000000) + (item.lastResponseTimeMs ?? 500000);
    };

    return getSortWeight(a) - getSortWeight(b);
  });

  return result;
}

let autoRotationIndex = 0;
let explorationCallCounter = 0;

/**
 * Performance-Tiered Priority Candidate Selection:
 * 1. Untested (Probe/New) models (0 successful requests) are placed in Tier 1 and preferred first
 *    so newly added models get sampled immediately.
 * 2. Once a Probe/New model completes 1 successful request, it is considered tested and immediately
 *    joins the normal round-robin rotation alongside all other Tier 1 models.
 * 3. Epsilon-Greedy Exploration Sampling:
 *    Every 12th call, if Tier 2 or Tier 4 candidates exist, one is selected as an exploratory probe
 *    to give slower or demoted models a chance to refresh their response times and get promoted.
 * 4. Priority routing targets Tier 1 first -> Tier 2 -> Tier 4.
 */
export function getNextAutoCandidate(
  llmConfig?: LLMConfig,
  excludedKeys?: Set<string>,
  advance: boolean = true
): AutoCandidate {
  const candidates = getAutoModelCandidates(llmConfig);
  const lockedMap = getLockedModels();
  const metricsMap = getModelMetricsMap();

  const available = candidates.filter(cand => {
    const key = `${cand.provider}:${cand.model}`;
    const isLocked = Boolean(lockedMap[key] && lockedMap[key].expiresAt > Date.now());
    const isExcluded = Boolean(excludedKeys && excludedKeys.has(key));
    return !isLocked && !isExcluded;
  });

  if (available.length > 0) {
    const tier1Probes: AutoCandidate[] = [];
    const tier1Tested: { cand: AutoCandidate; time: number }[] = [];
    const tier2: { cand: AutoCandidate; time: number }[] = [];
    const tier4: { cand: AutoCandidate; time: number }[] = [];

    for (const cand of available) {
      const key = `${cand.provider}:${cand.model}`;
      const metric = metricsMap[key];
      const time = metric?.lastResponseTimeMs ?? null;
      const totalCalls = metric?.totalCalls ?? 0;
      const totalSuccesses = metric?.totalSuccesses ?? 0;
      const isUntested = time === null || totalSuccesses < 1 || (totalCalls > 0 && totalSuccesses === 0);

      if (isUntested) {
        // Untested (0 successes) -> Priority Tier 1 Probe Queue
        tier1Probes.push(cand);
      } else if (time < 15000) {
        // Fast (0–15s) -> Tier 1 Regular Rotation
        tier1Tested.push({ cand, time });
      } else if (time < 25000) {
        // Medium (15–25s) -> Tier 2
        tier2.push({ cand, time });
      } else {
        // Slow (25s or more) -> Tier 4 (Demoted)
        tier4.push({ cand, time });
      }
    }

    tier2.sort((a, b) => a.time - b.time);
    tier4.sort((a, b) => a.time - b.time);

    if (advance) {
      explorationCallCounter++;
    }

    // Low-frequency Epsilon-Greedy Exploration: Every 12th call, probe a Tier 2 or Tier 4 model if Tier 1 is non-empty
    // to give slower models a chance to re-evaluate latency and get promoted!
    const isExplorationTurn = explorationCallCounter > 0 && explorationCallCounter % 12 === 0;
    if (isExplorationTurn && (tier2.length > 0 || tier4.length > 0)) {
      const probePool = [...tier2.map(t => t.cand), ...tier4.map(t => t.cand)];
      const rotIdx = getAutoRotationIndex();
      const idx = rotIdx % probePool.length;
      if (advance) {
        saveAutoRotationIndex(rotIdx + 1);
      }
      const probeCandidate = probePool[idx];
      console.log(`[Auto Mode - Epsilon Exploration Probe] Probing Tier 2/4 candidate to re-evaluate response time: ${probeCandidate.provider}:${probeCandidate.model}`);
      return probeCandidate;
    }

    // 1. Probe/New Selection: If there are any untested models (0 successful requests),
    // prioritize them first with fair round-robin rotation so new models get probed immediately without crowding out.
    // Once a model completes 1 successful request, it graduates and joins the normal Tier 1 rotation.
    if (tier1Probes.length > 0) {
      const rotIdx = getAutoRotationIndex();
      const idx = rotIdx % tier1Probes.length;
      const selected = tier1Probes[idx];

      if (advance) {
        saveAutoRotationIndex(rotIdx + 1);
      }

      console.log(`[Auto Mode - Probe/New Selection] Probing untested candidate (0 successes): ${selected.provider}:${selected.model}`);
      return selected;
    }

    // 2. Standard Tier 1 Round-Robin Rotation:
    // All tested Tier 1 models rotate equally with equal probability across queries.
    if (tier1Tested.length > 0) {
      const rotIdx = getAutoRotationIndex();
      const idx = rotIdx % tier1Tested.length;
      if (advance) {
        saveAutoRotationIndex(rotIdx + 1);
      }
      return tier1Tested[idx].cand;
    }

    if (tier2.length > 0) {
      const rotIdx = getAutoRotationIndex();
      const idx = rotIdx % tier2.length;
      if (advance) {
        saveAutoRotationIndex(rotIdx + 1);
      }
      return tier2[idx].cand;
    }

    if (tier4.length > 0) {
      const rotIdx = getAutoRotationIndex();
      const idx = rotIdx % tier4.length;
      if (advance) {
        saveAutoRotationIndex(rotIdx + 1);
      }
      console.warn(`[Auto Mode - Tier 4 Priority Routing] Tier 1 & 2 exhausted. Using Tier 4 demoted fallback: ${tier4[idx].cand.provider}:${tier4[idx].cand.model}`);
      return tier4[idx].cand;
    }
  }

  // Fallback: Reset locks if all candidates locked or failed
  console.warn("[Auto Mode] All candidate models are locked or failed. Resetting locks to prevent total lock-out.");
  clearAllLocks();
  const rotIdx = getAutoRotationIndex();
  const idx = rotIdx % candidates.length;
  if (advance) {
    saveAutoRotationIndex(rotIdx + 1);
  }
  return candidates[idx];
}

export function getAutoCandidateWithMeta(
  llmConfig?: LLMConfig,
  excludedKeys?: Set<string>,
  advance: boolean = true
): { candidate: AutoCandidate; tier: PerformanceTierNumber; tierMeta: PerformanceTierInfo } {
  const candidate = getNextAutoCandidate(llmConfig, excludedKeys, advance);
  const key = `${candidate.provider}:${candidate.model}`;
  const metricsMap = getModelMetricsMap();
  const metric = metricsMap[key];
  const isLocked = isModelLocked(candidate.provider, candidate.model);
  const hasLastError = Boolean(metric?.lastError);
  const totalCalls = metric?.totalCalls ?? 0;
  const totalSuccesses = metric?.totalSuccesses ?? 0;
  const effectiveTime = (isLocked || hasLastError || (totalCalls > 0 && totalSuccesses === 0))
    ? null
    : (metric?.lastResponseTimeMs ?? null);
  const status = getModelStatusIndicator(isLocked, effectiveTime, hasLastError, totalCalls, totalSuccesses);
  const isUntested = status === 'untested' || effectiveTime === null || totalSuccesses < 1;
  const tier = getModelPerformanceTier(status, effectiveTime, totalSuccesses);
  const tierMeta = getPerformanceTierMeta(tier, isUntested);

  return { candidate, tier, tierMeta };
}
