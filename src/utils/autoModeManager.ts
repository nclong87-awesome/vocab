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
 * Locks a model for durationMs (defaults to 1 hour = 3,600,000 ms).
 */
export function lockModel(
  provider: string, 
  model: string, 
  durationMs: number = ONE_HOUR_MS,
  _errorMsg?: string
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

  // Keep only up to 10 deduplicated failure log entries (newest first)
  const updatedLogs = deduplicateFailureLogs([newLogEntry, ...existingLogs]).slice(0, 10);

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

export const METRIC_STALE_MS = 15 * 60 * 1000; // 15 minutes until metrics expire and trigger a re-test probe

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
  lastTestedAt?: number | null
): PerformanceTierNumber {
  if (status === 'offline') return 4;
  
  // Untested models or stale metrics (>15 min) are promoted to Tier 1 as Probes so newly added models & changing models get benchmarked immediately
  if (status === 'untested' || responseTimeMs === null || responseTimeMs === undefined || isMetricStale(lastTestedAt ?? null)) {
    return 1;
  }
  
  if (status === 'strong' || responseTimeMs < 15000) return 1;
  if (status === 'medium' || responseTimeMs < 25000) return 2;
  return 4; // 'weak' / slow models (>= 25s)
}

export function getPerformanceTierMeta(
  tier: PerformanceTierNumber,
  isUntestedOrStale?: boolean
): PerformanceTierInfo {
  switch (tier) {
    case 1:
      return {
        tier: 1,
        name: "Tier 1: High-Speed Priority & New Probes",
        badgeLabel: isUntestedOrStale ? "Tier 1 (Probe/New)" : "Tier 1 (Fast)",
        shortLabel: "Tier 1: Fast",
        description: isUntestedOrStale 
          ? "Untested or stale model boosted to Tier 1 for immediate benchmark sampling."
          : "Fast response times (0–14s). First priority choice for all queries.",
        colorClass: isUntestedOrStale 
          ? "bg-sky-50 text-sky-800 border-sky-200" 
          : "bg-emerald-50 text-emerald-700 border-emerald-200"
      };
    case 2:
      return {
        tier: 2,
        name: "Tier 2: Medium Performance",
        badgeLabel: "Tier 2 (Medium)",
        shortLabel: "Tier 2: Medium",
        description: "Medium response times (15–24s). Automatically re-probed periodically for promotion to Tier 1.",
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
      const performanceTier = getModelPerformanceTier(status, effectiveResponseTimeMs, lastTestedAt);

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
      const performanceTier = getModelPerformanceTier(status, effectiveResponseTimeMs, lastTestedAt);

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
 * 1. Untested models & stale models (>15m) are automatically placed into Tier 1 (Probe Queue)
 *    so newly added models or changed models get benchmarked immediately.
 * 2. Epsilon-Greedy Exploration Sampling (15% rate):
 *    Every ~6th call, if Tier 2 or Tier 4 candidates exist, one is selected as an exploratory probe
 *    to give slower or demoted models a chance to refresh their response times and get promoted to Tier 1.
 * 3. Priority routing targets Tier 1 first -> Tier 2 -> Tier 4.
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
    const tier1: { cand: AutoCandidate; time: number | null; isUntestedOrStale: boolean }[] = [];
    const tier2: { cand: AutoCandidate; time: number }[] = [];
    const tier4: { cand: AutoCandidate; time: number }[] = [];

    for (const cand of available) {
      const key = `${cand.provider}:${cand.model}`;
      const metric = metricsMap[key];
      const time = metric?.lastResponseTimeMs ?? null;
      const lastTestedAt = metric?.lastTestedAt ?? null;
      const stale = isMetricStale(lastTestedAt);

      if (time === null || stale) {
        // Untested or Stale -> Priority Tier 1 Probe!
        tier1.push({ cand, time, isUntestedOrStale: true });
      } else if (time < 15000) {
        // Fast (0–14s) -> Tier 1
        tier1.push({ cand, time, isUntestedOrStale: false });
      } else if (time < 25000) {
        // Medium (15–24s) -> Tier 2
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

    // 15% Epsilon-Greedy Exploration: Every 6th call, probe a Tier 2 or Tier 4 model if Tier 1 is non-empty
    // to give slower models a chance to re-evaluate latency and get promoted!
    const isExplorationTurn = explorationCallCounter > 0 && explorationCallCounter % 6 === 0;
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

    // Probe Selection: If there are any untested or stale models in Tier 1, prioritize them cleanly
    // and rotate among them (lowest calls first) so every new request or retry picks the next model.
    const untestedOrStale = tier1.filter(t => t.isUntestedOrStale);
    if (untestedOrStale.length > 0) {
      // Find candidate(s) with minimum call count
      const minCalls = Math.min(...untestedOrStale.map(t => {
        const key = `${t.cand.provider}:${t.cand.model}`;
        return metricsMap[key]?.totalCalls ?? 0;
      }));
      const minCallCandidates = untestedOrStale.filter(t => {
        const key = `${t.cand.provider}:${t.cand.model}`;
        return (metricsMap[key]?.totalCalls ?? 0) === minCalls;
      });

      const rotIdx = getAutoRotationIndex();
      const idx = rotIdx % minCallCandidates.length;
      const selected = minCallCandidates[idx].cand;

      if (advance) {
        saveAutoRotationIndex(rotIdx + 1);
      }

      console.log(`[Auto Mode - Probe Selection] Selected untested/stale candidate (calls: ${metricsMap[`${selected.provider}:${selected.model}`]?.totalCalls ?? 0}): ${selected.provider}:${selected.model}`);
      return selected;
    }

    // Standard Tier Priority Selection (Tier 1 -> Tier 2 -> Tier 4)
    if (tier1.length > 0) {
      const rotIdx = getAutoRotationIndex();
      const idx = rotIdx % tier1.length;
      if (advance) {
        saveAutoRotationIndex(rotIdx + 1);
      }
      return tier1[idx].cand;
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
  const isStale = isMetricStale(metric?.lastTestedAt ?? null);
  const isUntestedOrStale = status === 'untested' || effectiveTime === null || isStale;
  const tier = getModelPerformanceTier(status, effectiveTime, metric?.lastTestedAt);
  const tierMeta = getPerformanceTierMeta(tier, isUntestedOrStale);

  return { candidate, tier, tierMeta };
}
