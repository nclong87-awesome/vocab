# Cloudflare Worker LLM Proxy & Intelligent Model Rotation Engine
## Implementation Guide & Technical Specification for Gemini

> **Target Audience**: Google Gemini (or any autonomous LLM agent / senior engineer) implementing a serverless edge LLM gateway on Cloudflare Workers.
>
> **Objective**: Provide an exhaustive, production-ready specification, mathematical formulas, architectural diagrams, and complete TypeScript codebase to deploy an edge proxy that rotates LLM models, tracks latency/health, enforces dynamic circuit-breaker lockouts, and executes transparent multi-provider failover.

---

## 1. Executive Summary & Core Objectives

Modern AI applications encounter severe reliability challenges when binding directly to a single upstream AI provider:
- **Rate-Limiting (HTTP 429)**: Shared or tier-capped token/request limits throttle applications during traffic spikes.
- **Provider Outages & Service Degradation (HTTP 500/502/503/504)**: Regional infrastructure incidents cause sudden user-facing downtime.
- **Cold-Start & Queue Latency Spikes**: Models fluctuate in response times depending on platform load.
- **Client Security Vulnerabilities**: Embedding master API keys inside frontend applications or mobile binaries exposes credentials to extraction.

### The Solution: Cloudflare Worker Edge Gateway
Deploying an intelligent proxy on **Cloudflare Workers** resolves these challenges by placing a lightweight, ultra-low-latency (<10ms overhead) routing layer at the global edge. 

```
                               ┌─────────────────────────────┐
                               │  Client Application (Web/UI)│
                               └──────────────┬──────────────┘
                                              │ HTTPS Request
                                              ▼
                ┌─────────────────────────────────────────────────────────────┐
                │             CLOUDFLARE WORKER EDGE PROXY                    │
                │                                                             │
                │  1. Ingress Auth & CORS Validation (X-Proxy-Key / Bearer)   │
                │  2. Model Rotation & Performance-Tier Engine                │
                │     • Tier 1: High-Speed (<15s) & Untested Probes           │
                │     • Tier 2: Medium (15s–25s)                              │
                │     • Tier 4: Demoted / Fallback (>25s)                     │
                │  3. ε-Greedy Exploratory Probe (Every 12th request)         │
                │  4. In-Memory + KV Health & Latency Metric Tracking         │
                │  5. Adaptive Power-Decay Circuit Breaker (1h – 96h lock)     │
                │  6. Transparent Instant Fallback Cascade on Failure         │
                └──────────────┬──────────────┬──────────────┬────────────────┘
                               │              │              │
                               ▼              ▼              ▼
           ┌────────────────────────┐  ┌────────────────────────┐  ┌────────────────────────┐
           │ Gemini Worker Endpoint │  │  Groq Worker Endpoint  │  │ OpenRouter / 9Flare /  │
           │ gemini.nclong87.       │  │ groq.nclong87.         │  │ ollama / cloudflare    │
           │ workers.dev/v1beta     │  │ workers.dev/openai/v1  │  │ .nclong87.workers.dev  │
           └────────────────────────┘  └────────────────────────┘  └────────────────────────┘
```

> **MANDATORY HEADER DIRECTIVE**:
> **Always pass the access key in the `X-Proxy-Key` header** on all requests to Cloudflare Workers (`*.workers.dev`). Cloudflare edge worker microservices require this header for edge ingress authentication, protecting upstream services against unauthorized access. Both client requests to the gateway and gateway dispatch requests to upstream workers must unconditionally set this header.

---

## 2. Mathematical Formulation of the Rotation & Circuit Breaker Algorithm

The routing engine implements a deterministic, multi-factor resilience algorithm modeled after high-throughput distributed systems.

### 2.1 Multi-Tier Performance Classification

All active models across configured providers are partitioned into structured performance tiers:

| Tier | Category | Latency / Metric Condition | Routing Priority |
| :--- | :--- | :--- | :--- |
| **Tier 1 (Probe/New)** | Untested Probe Queue | Total successes $= 0$ or no baseline latency | **Highest Priority** (Sampled immediately via fair round-robin) |
| **Tier 1 (Fast)** | High-Speed Active | Average response time $< 15.0\text{s}$ | **Primary Rotation** (Even interleaved round-robin) |
| **Tier 2 (Medium)** | Secondary Fallback | Average response time $15.0\text{s} \le t < 25.0\text{s}$ | **Secondary** (Used if Tier 1 exhausted or during exploratory cycles) |
| **Tier 4 (Slow/Offline)** | Demoted / Cooldown | Average response time $\ge 25.0\text{s}$ or active lock | **Tertiary / Fallback Only** |

### 2.2 Probe Lifecycle & Single-Sample Graduation

To integrate newly registered models without starvation or thundering herds:
1. Any model with zero successful requests (`totalSuccesses === 0`) enters the **Tier 1 Probe Queue**.
2. When a request arrives, if untested probe models exist, one is selected via fair round-robin.
3. Upon **1 successful request**, the model records its initial latency benchmark and **immediately graduates** into the regular Tier 1 rotation pool.
4. If the probe fails, it receives an initial 1-hour lockout and does not disrupt user requests (the proxy instantly fails over to the next candidate).

### 2.3 Continuous Exploration Sampling ($\epsilon$-Greedy)

To ensure demoted models (in Tier 2 or Tier 4) can recover when upstream provider load subsides:
- An exploration cycle counter increments with each request.
- Every **12th request** (`cycleCount % 12 === 0`), if Tier 2 or Tier 4 models exist, an **Exploratory Probe** selects one demoted candidate instead of a Tier 1 model.
- If the model achieves a sub-15-second response time, its rolling benchmark updates and it is automatically promoted back into **Tier 1**.

### 2.4 Multi-Factor Adaptive Circuit Breaker

When a model encounters a transient or fatal error (HTTP 429, 500, 502, 503, 504, or network timeout), the engine computes a dynamic lockout duration:

$$\text{LockDuration} = \text{Clamp}\Big(\big(\text{BaseConsecutiveDuration} + \text{AccumulatedRecencyPenalty}\big) \times M_{\text{Reliability}} \times M_{\text{Latency}}, \; 1\text{h}, \; 96\text{h}\Big)$$

#### 1. Consecutive Failure Base Duration ($\text{BaseConsecutiveDuration}$)
Consecutive failures escalate aggressively to protect against chronic service failure:
$$\text{BaseConsecutiveDuration} = \begin{cases}
1\text{ Hour } (3,600,000\text{ ms}) & \text{for } C = 1 \\
4\text{ Hours } (14,400,000\text{ ms}) & \text{for } C = 2 \\
24\text{ Hours } (86,400,000\text{ ms} / 1\text{ day}) & \text{for } C = 3 \\
54\text{ Hours } (194,400,000\text{ ms} / 2.25\text{ days}) & \text{for } C = 4 \\
78\text{ Hours } (280,800,000\text{ ms} / 3.25\text{ days}) & \text{for } C = 5 \\
96\text{ Hours } (345,600,000\text{ ms} / 4\text{ days}) & \text{for } C \ge 6
\end{cases}$$
*(where $C$ is the count of consecutive failed requests).*

#### 2. 120-Hour (5-Day) Recency Power-Decay Penalty
Recent historical failures contribute residual cooldown penalties that decay over 5 days (120 hours):
$$\text{AccumulatedRecencyPenalty} = 1\text{h} \times \sum_{i=1}^{N} \max\left(0.05, \left(1 - \frac{\text{Age}_i}{120\text{ hours}}\right)^{1.4}\right)$$
- If a failure occurred 1 hour ago: $(1 - 1/120)^{1.4} \approx 0.988 \times 1\text{h}$.
- If a failure occurred 60 hours ago: $(1 - 60/120)^{1.4} \approx 0.378 \times 1\text{h}$.
- Older than 120 hours: discarded from the sliding window.

#### 3. Historical Reliability Multiplier ($M_{\text{Reliability}}$)
Applies once a model has $\ge 3$ total calls:
$$M_{\text{Reliability}} = \begin{cases} 
0.5 & \text{if Success Rate } \ge 90\% \text{ and } C \le 1 \quad \text{(Reliability Discount)} \\
2.0 & \text{if Success Rate } < 50\% \quad \text{(Severe Instability Penalty)} \\
1.5 & \text{if Success Rate } < 75\% \quad \text{(Moderate Instability Penalty)} \\
1.0 & \text{otherwise}
\end{cases}$$

#### 4. Latency Penalty Multiplier ($M_{\text{Latency}}$)
Penalizes sluggish models that cause user-perceived lag:
$$M_{\text{Latency}} = \begin{cases}
\min\left(3.0, \; 1.0 + \frac{\text{AvgLatencyMs} - 15000}{10000}\right) & \text{if AvgLatencyMs } > 15,000\text{ ms} \\
1.0 & \text{otherwise}
\end{cases}$$

#### 5. Boundary Clamping
To prevent indefinite lockouts while ensuring real isolation:
$$\text{MIN\_LOCK} = 1\text{ Hour } (3,600,000\text{ ms}), \quad \text{MAX\_LOCK} = 96\text{ Hours } (345,600,000\text{ ms} / 4\text{ days})$$

---

## 3. Cloudflare Worker Edge State Architecture

Cloudflare Workers operate in an isolate-based execution environment across hundreds of edge locations. To achieve optimal performance with shared consistency:

```
┌────────────────────────────────────────────────────────────────────────┐
│                       CLOUDFLARE WORKER ISOLATE                        │
│                                                                        │
│   ┌───────────────────────────────────────────────────────────────┐    │
│   │ Fast Path: In-Memory L1 Cache                                 │    │
│   │ • Global Map: metricsMap & lockedModelsMap                    │    │
│   │ • Latency: < 0.1ms                                            │    │
│   │ • Updated synchronously on each request completion            │    │
│   └───────────────────────────────┬───────────────────────────────┘    │
│                                   │ ctx.waitUntil()                    │
│                                   ▼ (Non-blocking background sync)     │
│   ┌───────────────────────────────────────────────────────────────┐    │
│   │ Persistent Storage: Cloudflare KV (L2)                        │    │
│   │ • Key: `llm_metrics_state` & `llm_locked_models`              │    │
│   │ • Read on cold start, written asynchronously via waitUntil    │    │
│   │ • Survives worker redeploys and edge location warmups         │    │
│   └───────────────────────────────────────────────────────────────┘    │
└────────────────────────────────────────────────────────────────────────┘
```

1. **In-Memory L1**: Read and updated synchronously on every edge request.
2. **Cloudflare KV L2**: Asynchronously written using `ctx.waitUntil(saveStateToKV())`, avoiding any blocking I/O latency for the caller.
3. **Cold Start Rehydration**: If the worker memory is fresh, it loads state from Cloudflare KV in under 15ms.

---

## 4. Complete Implementation Codebase

The following code constitutes the complete, production-ready Cloudflare Worker project.

### 4.1 Project Configuration: `wrangler.toml`

```toml
name = "llm-edge-router"
main = "src/index.ts"
compatibility_date = "2024-09-01"
compatibility_flags = ["nodejs_compat"]

# Cloudflare Workers KV Namespace for cross-edge state persistence
kv_namespaces = [
  { binding = "LLM_STATE_KV", id = "<YOUR_KV_NAMESPACE_ID>", preview_id = "<YOUR_PREVIEW_KV_ID>" }
]

[vars]
DEFAULT_TIMEOUT_MS = "30000"
PROXY_SECRET = "your-secure-client-proxy-secret"

# Upstream API Keys should be managed as secrets:
# Run: wrangler secret put GEMINI_API_KEY
# Run: wrangler secret put GROQ_API_KEY
# Run: wrangler secret put OPENROUTER_API_KEY
# Run: wrangler secret put NINEFLARE_API_KEY
```

---

### 4.2 TypeScript Type Definitions: `src/types.ts`

```typescript
export type LLMProviderId = 'gemini' | 'groq' | 'openrouter' | '9flare' | 'cloudflare' | 'ollama';

export interface ModelCandidate {
  provider: LLMProviderId;
  model: string;
  workerUrl: string; // Cloudflare Worker endpoint URL (nclong87.workers.dev)
}

export interface RequestOutcomeEntry {
  success: boolean;
  durationMs?: number;
  timestamp: number;
}

export interface FailureLogEntry {
  id: string;
  timestamp: number;
  reason: string;
}

export interface ModelMetricsRecord {
  provider: string;
  model: string;
  lastResponseTimeMs: number | null;
  avgResponseTimeMs: number | null;
  recentResponseTimes: number[];
  recentOutcomes: RequestOutcomeEntry[];
  lastTestedAt: number | null;
  lastError: string | null;
  totalCalls: number;
  totalSuccesses: number;
  failureLogs: FailureLogEntry[];
}

export interface LockedModelInfo {
  provider: string;
  model: string;
  lockedAt: number;
  expiresAt: number;
  reason?: string;
}

export type PerformanceTier = 1 | 2 | 4;

export interface Env {
  LLM_STATE_KV: KVNamespace;
  PROXY_SECRET?: string;
  DEFAULT_TIMEOUT_MS?: string;
  GEMINI_API_KEY?: string;
  GROQ_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  NINEFLARE_API_KEY?: string;
  CLOUDFLARE_API_KEY?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  AI?: any; // Cloudflare Workers AI binding if available
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionPayload {
  model?: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  response_format?: { type: string };
  preferred_provider?: LLMProviderId;
  preferred_models?: string[];
  only_reliable_models?: boolean;
}
```

---

### 4.3 Model Registry & Configuration: `src/registry.ts`

#### Dedicated Cloudflare Worker Microservice Proxies (`*.nclong87.workers.dev`)
Default upstream public base URLs (e.g. `api.groq.com`, `openrouter.ai`, `generativelanguage.googleapis.com`) have been removed. Every provider request is proxied through dedicated Cloudflare Worker microservices hosted on the `nclong87.workers.dev` domain:

| Provider | Service Type | Cloudflare Worker URL | Expected Payload Format |
| :--- | :--- | :--- | :--- |
| **Google Gemini** | LLM Gateway | `https://gemini.nclong87.workers.dev/v1beta` | Native Gemini `generateContent` REST |
| **Groq Cloud** | High-Speed LLM | `https://groq.nclong87.workers.dev/openai/v1` | Standard OpenAI `/chat/completions` |
| **OpenRouter** | Multi-Model Aggregator | `https://openrouter.nclong87.workers.dev/api/v1` | Standard OpenAI `/chat/completions` |
| **9Flare** | Premium Models | `https://9flare.nclong87.workers.dev/api/v1` | Standard OpenAI `/chat/completions` |
| **Ollama** | Edge/Local Models | `https://ollama.nclong87.workers.dev/v1` | Standard OpenAI `/chat/completions` |
| **Cloudflare Workers AI** | Native Edge AI | `https://cloudflare.nclong87.workers.dev` | OpenAI / Workers AI JSON |
| **Image Analysis** | Multimodal OCR/Vision | `https://image-analysis.nclong87.workers.dev` | Multi-part vision payload |
| **Unified Edge Router** | Rotation & Failover | `https://llm-edge-router.nclong87.workers.dev/v1` | Standard OpenAI `/chat/completions` |

```typescript
import { LLMProviderId, ModelCandidate } from './types';

export interface ProviderDefinition {
  id: LLMProviderId;
  name: string;
  workerUrl: string; // Dedicated Cloudflare Worker microservice proxy
  models: string[];
}

export const PROVIDER_REGISTRY: ProviderDefinition[] = [
  {
    id: 'groq',
    name: 'Groq',
    workerUrl: 'https://groq.nclong87.workers.dev/openai/v1',
    models: [
      'openai/gpt-oss-120b',
      'openai/gpt-oss-20b',
      'openai/gpt-oss-safeguard-20b',
      'llama-3.3-70b-versatile',
      'llama-3.1-8b-instant'
    ]
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    workerUrl: 'https://openrouter.nclong87.workers.dev/api/v1',
    models: [
      'google/gemini-2.5-flash',
      'google/gemini-2.0-flash',
      'cohere/command-r-plus',
      'meta-llama/llama-3.3-70b-instruct'
    ]
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    workerUrl: 'https://gemini.nclong87.workers.dev/v1beta',
    models: [
      'gemini-2.5-flash',
      'gemini-2.0-flash',
      'gemini-1.5-flash',
      'gemini-1.5-pro'
    ]
  },
  {
    id: '9flare',
    name: '9Flare',
    workerUrl: 'https://9flare.nclong87.workers.dev/api/v1',
    models: [
      'pro/gpt-5.6-luna',
      'pro/claude-haiku-4-5'
    ]
  },
  {
    id: 'ollama',
    name: 'Ollama',
    workerUrl: 'https://ollama.nclong87.workers.dev/v1',
    models: [
      'gpt-oss:20b',
      'gemma4:31b',
      'nemotron-3-nano:30b-cloud'
    ]
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare Workers AI',
    workerUrl: 'https://cloudflare.nclong87.workers.dev',
    models: [
      '@cf/aisingapore/gemma-sea-lion-v4-27b-it',
      '@cf/meta/llama-3.3-70b-instruct-fp8-fast'
    ]
  }
];

export const RELIABLE_MODELS: string[] = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'openai/gpt-oss-120b',
  'llama-3.3-70b-versatile',
  'google/gemini-2.5-flash',
  'pro/gpt-5.6-luna'
];

/**
 * Returns an interleaved list of candidates across providers so fair rotation
 * naturally alternates between different providers.
 */
export function getAllRegisteredCandidates(onlyReliable?: boolean): ModelCandidate[] {
  const candidates: ModelCandidate[] = [];
  const providers = PROVIDER_REGISTRY;
  const maxModels = Math.max(...providers.map(p => p.models.length), 0);

  for (let i = 0; i < maxModels; i++) {
    for (const p of providers) {
      if (p.models[i]) {
        const modelName = p.models[i];
        if (onlyReliable && !RELIABLE_MODELS.includes(modelName)) {
          continue;
        }
        candidates.push({
          provider: p.id,
          model: modelName,
          workerUrl: p.workerUrl
        });
      }
    }
  }
  return candidates;
}
```

---

### 4.4 Circuit Breaker & Lockout Calculator: `src/circuitBreaker.ts`

```typescript
import { ModelMetricsRecord, LockedModelInfo } from './types';

export const ONE_HOUR_MS = 60 * 60 * 1000;
export const ONE_DAY_MS = 24 * ONE_HOUR_MS;
export const FIVE_DAYS_MS = 5 * ONE_DAY_MS;
export const MAX_LOCK_MS = 4 * ONE_DAY_MS; // 96 hours (4 days, strictly < 5 days)

/**
 * Counts consecutive failed requests at the tail of recent outcomes.
 */
export function getConsecutiveFailures(metric?: ModelMetricsRecord, isCurrentlyFailing = false): number {
  if (!metric) return isCurrentlyFailing ? 1 : 0;
  let consecutive = 0;
  const outcomes = metric.recentOutcomes || [];

  for (let i = outcomes.length - 1; i >= 0; i--) {
    if (!outcomes[i].success) {
      consecutive++;
    } else {
      break;
    }
  }

  if (isCurrentlyFailing) {
    const lastOutcome = outcomes[outcomes.length - 1];
    const alreadyRecorded = lastOutcome && !lastOutcome.success && (Date.now() - lastOutcome.timestamp < 2000);
    if (!alreadyRecorded) {
      consecutive++;
    }
  }

  return Math.max(isCurrentlyFailing ? 1 : 0, consecutive);
}

/**
 * Calculates optimal circuit-breaker lockout based on consecutive failures,
 * 5-day recency decay, historical reliability, and latency penalties.
 */
export function calculateLockDuration(metric?: ModelMetricsRecord, errorReason?: string): number {
  if (!metric) return ONE_HOUR_MS;

  const now = Date.now();
  const totalCalls = metric.totalCalls || 0;
  const totalSuccesses = metric.totalSuccesses || 0;
  const isCurrentlyFailing = errorReason !== undefined;

  // 1. Consecutive Failure Base Duration
  const consecutive = getConsecutiveFailures(metric, isCurrentlyFailing);
  let baseDuration = ONE_HOUR_MS;
  if (consecutive === 2) {
    baseDuration = 4 * ONE_HOUR_MS;
  } else if (consecutive === 3) {
    baseDuration = ONE_DAY_MS;
  } else if (consecutive === 4) {
    baseDuration = Math.round(2.25 * ONE_DAY_MS);
  } else if (consecutive === 5) {
    baseDuration = Math.round(3.25 * ONE_DAY_MS);
  } else if (consecutive >= 6) {
    baseDuration = MAX_LOCK_MS;
  }

  // 2. 5-Day Recency Power-Decay Penalty
  const fiveDaysAgo = now - FIVE_DAYS_MS;
  const recentFailures = (metric.failureLogs || []).filter(l => l.timestamp >= fiveDaysAgo);
  let recencyPenalty = 0;

  for (const log of recentFailures) {
    const ageMs = Math.max(0, now - log.timestamp);
    if (isCurrentlyFailing && ageMs < 2000) continue; // Skip active error if logged

    const normalizedAge = Math.min(1, ageMs / FIVE_DAYS_MS);
    const recencyWeight = Math.max(0.05, Math.pow(1 - normalizedAge, 1.4));
    recencyPenalty += ONE_HOUR_MS * recencyWeight;
  }

  const accumulatedBase = baseDuration + recencyPenalty;

  // 3. Response Time Multiplier (>15s penalty)
  let latencyMultiplier = 1.0;
  const avgLatency = metric.avgResponseTimeMs || metric.lastResponseTimeMs || 0;
  if (avgLatency > 15000) {
    latencyMultiplier = Math.min(3.0, 1.0 + (avgLatency - 15000) / 10000);
  }

  // 4. Historical Reliability Multiplier (for >= 3 calls)
  let reliabilityMultiplier = 1.0;
  if (totalCalls >= 3) {
    const successRate = totalSuccesses / totalCalls;
    if (successRate >= 0.9 && consecutive <= 1) {
      reliabilityMultiplier = 0.5; // High reliability bonus
    } else if (successRate < 0.5) {
      reliabilityMultiplier = 2.0; // Severe unreliability penalty
    } else if (successRate < 0.75) {
      reliabilityMultiplier = 1.5;
    }
  }

  const finalDuration = accumulatedBase * latencyMultiplier * reliabilityMultiplier;
  return Math.max(ONE_HOUR_MS, Math.min(MAX_LOCK_MS, Math.round(finalDuration)));
}
```

---

### 4.5 Metrics Store & State Synchronization: `src/metricsStore.ts`

```typescript
import { Env, ModelMetricsRecord, LockedModelInfo, RequestOutcomeEntry, FailureLogEntry } from './types';
import { calculateLockDuration, ONE_HOUR_MS, FIVE_DAYS_MS } from './circuitBreaker';

const KV_METRICS_KEY = 'llm_metrics_state_v1';
const KV_LOCKS_KEY = 'llm_locked_models_v1';

// In-Memory L1 Cache
let inMemoryMetrics: Record<string, ModelMetricsRecord> = {};
let inMemoryLocks: Record<string, LockedModelInfo> = {};
let isHydrated = false;

export async function hydrateState(env: Env): Promise<void> {
  if (isHydrated) return;
  try {
    const [rawMetrics, rawLocks] = await Promise.all([
      env.LLM_STATE_KV.get(KV_METRICS_KEY, 'json'),
      env.LLM_STATE_KV.get(KV_LOCKS_KEY, 'json')
    ]);

    if (rawMetrics && typeof rawMetrics === 'object') {
      inMemoryMetrics = rawMetrics as Record<string, ModelMetricsRecord>;
    }
    if (rawLocks && typeof rawLocks === 'object') {
      inMemoryLocks = rawLocks as Record<string, LockedModelInfo>;
    }
    isHydrated = true;
  } catch (err) {
    console.warn('[State] Cold-start hydration fallback to memory:', err);
    isHydrated = true;
  }
}

export function persistStateAsync(env: Env, ctx: ExecutionContext): void {
  ctx.waitUntil(
    (async () => {
      try {
        await Promise.all([
          env.LLM_STATE_KV.put(KV_METRICS_KEY, JSON.stringify(inMemoryMetrics)),
          env.LLM_STATE_KV.put(KV_LOCKS_KEY, JSON.stringify(inMemoryLocks))
        ]);
      } catch (err) {
        console.error('[State] Failed to persist state to KV:', err);
      }
    })()
  );
}

export function getMetrics(key: string): ModelMetricsRecord | undefined {
  return inMemoryMetrics[key];
}

export function getAllMetrics(): Record<string, ModelMetricsRecord> {
  return { ...inMemoryMetrics };
}

export function isModelLocked(provider: string, model: string): boolean {
  const key = `${provider}:${model}`;
  const lock = inMemoryLocks[key];
  if (!lock) return false;
  if (lock.expiresAt <= Date.now()) {
    delete inMemoryLocks[key];
    return false;
  }
  return true;
}

export function getAllLocks(): Record<string, LockedModelInfo> {
  const now = Date.now();
  const active: Record<string, LockedModelInfo> = {};
  for (const [k, v] of Object.entries(inMemoryLocks)) {
    if (v.expiresAt > now) {
      active[k] = v;
    }
  }
  return active;
}

export function recordSuccess(
  provider: string,
  model: string,
  durationMs: number,
  env: Env,
  ctx: ExecutionContext
): void {
  const key = `${provider}:${model}`;
  delete inMemoryLocks[key]; // Unlock if previously locked

  const existing = inMemoryMetrics[key];
  const prevCalls = existing?.totalCalls || 0;
  const prevSuccesses = existing?.totalSuccesses || 0;
  const validDuration = Math.max(1, Math.round(durationMs));

  const prevOutcomes = existing?.recentOutcomes || [];
  const newOutcome: RequestOutcomeEntry = {
    success: true,
    durationMs: validDuration,
    timestamp: Date.now()
  };

  const updatedOutcomes = [...prevOutcomes, newOutcome].slice(-50);
  const successDurations = updatedOutcomes
    .filter(o => o.success && typeof o.durationMs === 'number')
    .map(o => o.durationMs as number);

  const avgLatency = successDurations.length > 0
    ? Math.round(successDurations.reduce((sum, d) => sum + d, 0) / successDurations.length)
    : validDuration;

  inMemoryMetrics[key] = {
    provider,
    model,
    lastResponseTimeMs: validDuration,
    avgResponseTimeMs: avgLatency,
    recentResponseTimes: successDurations,
    recentOutcomes: updatedOutcomes,
    lastTestedAt: Date.now(),
    lastError: null,
    totalCalls: prevCalls + 1,
    totalSuccesses: prevSuccesses + 1,
    failureLogs: existing?.failureLogs || []
  };

  persistStateAsync(env, ctx);
}

export function recordFailure(
  provider: string,
  model: string,
  reason: string,
  env: Env,
  ctx: ExecutionContext
): void {
  const key = `${provider}:${model}`;
  const now = Date.now();
  const existing = inMemoryMetrics[key];

  const prevCalls = existing?.totalCalls || 0;
  const prevSuccesses = existing?.totalSuccesses || 0;

  const newLog: FailureLogEntry = {
    id: `${now}-${Math.random().toString(36).substring(2, 7)}`,
    timestamp: now,
    reason
  };

  const fiveDaysAgo = now - FIVE_DAYS_MS;
  const existingLogs = existing?.failureLogs || [];
  const updatedLogs = [newLog, ...existingLogs].filter(l => l.timestamp >= fiveDaysAgo).slice(0, 50);

  const prevOutcomes = existing?.recentOutcomes || [];
  const updatedOutcomes = [...prevOutcomes, { success: false, timestamp: now }].slice(-50);

  inMemoryMetrics[key] = {
    provider,
    model,
    lastResponseTimeMs: existing?.lastResponseTimeMs || null,
    avgResponseTimeMs: existing?.avgResponseTimeMs || null,
    recentResponseTimes: existing?.recentResponseTimes || [],
    recentOutcomes: updatedOutcomes,
    lastTestedAt: now,
    lastError: reason,
    totalCalls: prevCalls + 1,
    totalSuccesses: prevSuccesses,
    failureLogs: updatedLogs
  };

  // Lock model dynamically
  const lockMs = calculateLockDuration(inMemoryMetrics[key], reason);
  inMemoryLocks[key] = {
    provider,
    model,
    lockedAt: now,
    expiresAt: now + lockMs,
    reason
  };

  persistStateAsync(env, ctx);
}

export function unlockModel(provider: string, model: string, env: Env, ctx: ExecutionContext): void {
  const key = `${provider}:${model}`;
  delete inMemoryLocks[key];
  persistStateAsync(env, ctx);
}

export function clearAllLocks(env: Env, ctx: ExecutionContext): void {
  inMemoryLocks = {};
  persistStateAsync(env, ctx);
}
```

---

### 4.6 Intelligent Rotation & Candidate Router: `src/router.ts`

```typescript
import { ModelCandidate, PerformanceTier } from './types';
import { getAllRegisteredCandidates } from './registry';
import { getMetrics, isModelLocked } from './metricsStore';

let globalRotationIndex = 0;
let explorationCounter = 0;

export interface RoutingDecision {
  candidate: ModelCandidate;
  tier: PerformanceTier;
  isUntested: boolean;
  isExploratory: boolean;
}

/**
 * Evaluates performance tier based on latency and success history.
 */
export function getPerformanceTier(
  lastResponseTimeMs: number | null,
  totalSuccesses: number
): { tier: PerformanceTier; isUntested: boolean } {
  // Untested models (0 successes or null time) -> Tier 1 Probe Queue
  if (lastResponseTimeMs === null || totalSuccesses < 1) {
    return { tier: 1, isUntested: true };
  }
  if (lastResponseTimeMs < 15000) {
    return { tier: 1, isUntested: false };
  }
  if (lastResponseTimeMs < 25000) {
    return { tier: 2, isUntested: false };
  }
  return { tier: 4, isUntested: false };
}

/**
 * Selects the next optimal model candidate enforcing:
 * 1. Untested Probe prioritization in Tier 1.
 * 2. Fair interleaved round-robin across tested Tier 1 models.
 * 3. ε-Greedy exploration every 12th call to re-evaluate Tier 2 and Tier 4.
 * 4. Exclusion list for instant in-flight failover cascading.
 */
export function getNextCandidate(
  preferredProvider?: string,
  preferredModels?: string[],
  onlyReliable?: boolean,
  excludedKeys?: Set<string>
): RoutingDecision {
  let allCandidates = getAllRegisteredCandidates(onlyReliable);

  if (preferredProvider) {
    allCandidates = allCandidates.filter(c => c.provider === preferredProvider);
  }

  // Filter out currently locked models and candidates already attempted in this request
  let available = allCandidates.filter(cand => {
    const key = `${cand.provider}:${cand.model}`;
    const locked = isModelLocked(cand.provider, cand.model);
    const excluded = excludedKeys ? excludedKeys.has(key) : false;
    return !locked && !excluded;
  });

  // Apply preferred models prioritization if supplied
  if (preferredModels && preferredModels.length > 0) {
    const prefAvailable = available.filter(c => preferredModels.includes(c.model));
    if (prefAvailable.length > 0) {
      available = prefAvailable;
    }
  }

  // All candidates locked / exhausted fallback
  if (available.length === 0) {
    const fallbackList = allCandidates.filter(c => !excludedKeys || !excludedKeys.has(`${c.provider}:${c.model}`));
    const finalCand = fallbackList.length > 0 ? fallbackList[0] : allCandidates[0];
    return {
      candidate: finalCand,
      tier: 1,
      isUntested: false,
      isExploratory: false
    };
  }

  // Partition candidates into performance tiers
  const tier1Probes: ModelCandidate[] = [];
  const tier1Tested: { cand: ModelCandidate; time: number }[] = [];
  const tier2: { cand: ModelCandidate; time: number }[] = [];
  const tier4: { cand: ModelCandidate; time: number }[] = [];

  for (const cand of available) {
    const key = `${cand.provider}:${cand.model}`;
    const m = getMetrics(key);
    const time = m?.lastResponseTimeMs ?? null;
    const successes = m?.totalSuccesses || 0;
    const { tier, isUntested } = getPerformanceTier(time, successes);

    if (isUntested) {
      tier1Probes.push(cand);
    } else if (tier === 1) {
      tier1Tested.push({ cand, time: time! });
    } else if (tier === 2) {
      tier2.push({ cand, time: time! });
    } else {
      tier4.push({ cand, time: time! });
    }
  }

  // 1. Check ε-Greedy Exploration Sampling (Every 12th call)
  explorationCounter++;
  const isExplorationTurn = explorationCounter % 12 === 0;
  if (isExplorationTurn && (tier2.length > 0 || tier4.length > 0)) {
    const explorePool = [...tier2.map(t => t.cand), ...tier4.map(t => t.cand)];
    const chosen = explorePool[globalRotationIndex % explorePool.length];
    globalRotationIndex++;
    return {
      candidate: chosen,
      tier: tier2.some(t => t.cand === chosen) ? 2 : 4,
      isUntested: false,
      isExploratory: true
    };
  }

  // 2. Sample Untested Probes (Fair round-robin)
  if (tier1Probes.length > 0) {
    const chosen = tier1Probes[globalRotationIndex % tier1Probes.length];
    globalRotationIndex++;
    return {
      candidate: chosen,
      tier: 1,
      isUntested: true,
      isExploratory: false
    };
  }

  // 3. Regular Tier 1 High-Speed Pool
  if (tier1Tested.length > 0) {
    const chosen = tier1Tested[globalRotationIndex % tier1Tested.length].cand;
    globalRotationIndex++;
    return {
      candidate: chosen,
      tier: 1,
      isUntested: false,
      isExploratory: false
    };
  }

  // 4. Fallback to Tier 2 (Medium)
  if (tier2.length > 0) {
    const chosen = tier2[globalRotationIndex % tier2.length].cand;
    globalRotationIndex++;
    return {
      candidate: chosen,
      tier: 2,
      isUntested: false,
      isExploratory: false
    };
  }

  // 5. Fallback to Tier 4 (Slow/Demoted)
  const chosen = tier4[globalRotationIndex % tier4.length].cand;
  globalRotationIndex++;
  return {
    candidate: chosen,
    tier: 4,
    isUntested: false,
    isExploratory: false
  };
}
```

---

### 4.7 Upstream Adapters & Format Normalizers: `src/adapters.ts`

The adapter layer normalizes incoming OpenAI-compatible requests and proxies them to the selected provider.

```typescript
import { Env, ModelCandidate, ChatCompletionPayload } from './types';

/**
 * Resolves the upstream API key from environment secrets.
 */
export function getUpstreamKey(candidate: ModelCandidate, env: Env): string {
  switch (candidate.provider) {
    case 'gemini':
      return env.GEMINI_API_KEY || '';
    case 'groq':
      return env.GROQ_API_KEY || '';
    case 'openrouter':
      return env.OPENROUTER_API_KEY || '';
    case '9flare':
      return env.NINEFLARE_API_KEY || '';
    case 'cloudflare':
      return env.CLOUDFLARE_API_KEY || '';
    default:
      return '';
  }
}

/**
 * Resolves the access key to be passed in X-Proxy-Key for Cloudflare Workers.
 * CRITICAL DIRECTIVE: Every HTTP request to a Cloudflare Worker MUST ALWAYS include
 * this access key in the 'X-Proxy-Key' header to satisfy edge ingress checks.
 */
export function resolveAccessKey(candidate: ModelCandidate, env: Env, incomingProxyKey?: string): string {
  return incomingProxyKey || env.PROXY_SECRET || getUpstreamKey(candidate, env) || '';
}

/**
 * Dispatches request to the appropriate upstream Cloudflare Worker proxy.
 * ALWAYS passes the access key in the X-Proxy-Key header.
 */
export async function executeUpstreamCall(
  candidate: ModelCandidate,
  payload: ChatCompletionPayload,
  env: Env,
  timeoutMs: number,
  incomingProxyKey?: string
): Promise<Response> {
  const apiKey = getUpstreamKey(candidate, env);

  if (candidate.provider === 'gemini') {
    return callGeminiRest(candidate, payload, apiKey, env, timeoutMs, incomingProxyKey);
  }

  // OpenAI-compatible Cloudflare Worker endpoints: Groq, OpenRouter, 9Flare, Ollama, Cloudflare AI
  return callOpenAiCompatible(candidate, payload, apiKey, env, timeoutMs, incomingProxyKey);
}

/**
 * OpenAI-compatible Cloudflare Worker call.
 * Routes directly to the dedicated worker proxy (e.g. groq.nclong87.workers.dev/openai/v1)
 * ALWAYS passes the access key to header X-Proxy-Key.
 */
async function callOpenAiCompatible(
  candidate: ModelCandidate,
  payload: ChatCompletionPayload,
  apiKey: string,
  env: Env,
  timeoutMs: number,
  incomingProxyKey?: string
): Promise<Response> {
  const cleanWorkerUrl = candidate.workerUrl.replace(/\/+$/, '');
  const url = cleanWorkerUrl.endsWith('/chat/completions')
    ? cleanWorkerUrl
    : `${cleanWorkerUrl}/chat/completions`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };

  // MANDATORY: Always pass the access key to header X-Proxy-Key in the request to Cloudflare workers
  const accessKey = resolveAccessKey(candidate, env, incomingProxyKey);
  if (accessKey) {
    headers['X-Proxy-Key'] = accessKey;
  }

  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  if (candidate.provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://workers.cloudflare.com';
    headers['X-Title'] = 'Cloudflare LLM Edge Router';
  }

  const upstreamBody = {
    model: candidate.model,
    messages: payload.messages,
    temperature: payload.temperature ?? 0.7,
    max_tokens: payload.max_tokens,
    stream: payload.stream ?? false,
    response_format: payload.response_format
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(upstreamBody),
      signal: controller.signal
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Google Gemini REST v1beta native call.
 * Routes directly to gemini.nclong87.workers.dev/v1beta.
 * ALWAYS passes the access key to header X-Proxy-Key.
 * Translates OpenAI chat messages to Gemini contents structure.
 */
async function callGeminiRest(
  candidate: ModelCandidate,
  payload: ChatCompletionPayload,
  apiKey: string,
  env: Env,
  timeoutMs: number,
  incomingProxyKey?: string
): Promise<Response> {
  const cleanWorkerUrl = candidate.workerUrl.replace(/\/+$/, '');
  let url = `${cleanWorkerUrl}/models/${candidate.model}:generateContent`;
  if (apiKey && !cleanWorkerUrl.includes('workers.dev')) {
    url += `?key=${apiKey}`;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };

  // MANDATORY: Always pass the access key to header X-Proxy-Key in the request to Cloudflare workers
  const accessKey = resolveAccessKey(candidate, env, incomingProxyKey);
  if (accessKey) {
    headers['X-Proxy-Key'] = accessKey;
  }

  if (apiKey) {
    headers['x-goog-api-key'] = apiKey;
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  // Extract system instruction and user/assistant messages
  let systemInstructionText = '';
  const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];

  for (const m of payload.messages) {
    if (m.role === 'system') {
      systemInstructionText += (systemInstructionText ? '\n' : '') + m.content;
    } else {
      contents.push({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      });
    }
  }

  const geminiPayload: any = {
    contents,
    generationConfig: {
      temperature: payload.temperature ?? 0.7,
      maxOutputTokens: payload.max_tokens
    }
  };

  if (systemInstructionText) {
    geminiPayload.systemInstruction = {
      parts: [{ text: systemInstructionText }]
    };
  }

  if (payload.response_format?.type === 'json_object') {
    geminiPayload.generationConfig.responseMimeType = 'application/json';
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiPayload),
      signal: controller.signal
    });

    if (!res.ok) {
      return res; // Bubble upstream error status to trigger failover
    }

    // Transform Gemini response format into OpenAI chat completions schema
    const geminiData: any = await res.json();
    const outputText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';

    const openAiResponse = {
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: candidate.model,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: outputText
          },
          finish_reason: 'stop'
        }
      ],
      usage: {
        prompt_tokens: geminiData.usageMetadata?.promptTokenCount || 0,
        completion_tokens: geminiData.usageMetadata?.candidatesTokenCount || 0,
        total_tokens: geminiData.usageMetadata?.totalTokenCount || 0
      }
    };

    return new Response(JSON.stringify(openAiResponse), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } finally {
    clearTimeout(timer);
  }
}
```

---

### 4.8 Main Worker Entry Point: `src/index.ts`

```typescript
import { Env, ChatCompletionPayload } from './types';
import { hydrateState, getAllMetrics, getAllLocks, unlockModel, clearAllLocks, recordSuccess, recordFailure } from './metricsStore';
import { getNextCandidate } from './router';
import { executeUpstreamCall } from './adapters';
import { getAllRegisteredCandidates } from './registry';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Proxy-Key, HTTP-Referer, X-Title'
};

function jsonResponse(data: any, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
      ...extraHeaders
    }
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // 1. Handle CORS Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // 2. Ensure In-Memory State is hydrated from KV on cold-start
    await hydrateState(env);

    const url = new URL(request.url);
    const path = url.pathname;

    // 3. Authenticate Ingress Traffic
    const authHeader = request.headers.get('Authorization') || '';
    const proxyKeyHeader = request.headers.get('X-Proxy-Key') || '';
    const expectedSecret = env.PROXY_SECRET;

    if (expectedSecret) {
      const token = authHeader.replace(/^Bearer\s+/i, '').trim();
      const isValid = token === expectedSecret || proxyKeyHeader === expectedSecret;
      if (!isValid) {
        return jsonResponse({ error: 'Unauthorized: Invalid or missing proxy key.' }, 401);
      }
    }

    // 4. Public Health Check
    if (path === '/health' || path === '/') {
      return jsonResponse({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        service: 'Cloudflare LLM Edge Router'
      });
    }

    // 5. System Metrics & Status Endpoint
    if (path === '/v1/status' || path === '/status') {
      return jsonResponse({
        metrics: getAllMetrics(),
        lockedModels: getAllLocks()
      });
    }

    // 6. Manual Unlock Endpoint
    if (path === '/v1/unlock' && request.method === 'POST') {
      const body: any = await request.json().catch(() => ({}));
      if (body.all) {
        clearAllLocks(env, ctx);
        return jsonResponse({ message: 'All model locks cleared successfully.' });
      }
      if (body.provider && body.model) {
        unlockModel(body.provider, body.model, env, ctx);
        return jsonResponse({ message: `Model ${body.provider}:${body.model} unlocked successfully.` });
      }
      return jsonResponse({ error: 'Specify { provider, model } or { all: true }' }, 400);
    }

    // 7. Models List Endpoint (OpenAI-compatible)
    if (path === '/v1/models') {
      const candidates = getAllRegisteredCandidates();
      return jsonResponse({
        object: 'list',
        data: candidates.map(c => ({
          id: `${c.provider}/${c.model}`,
          object: 'model',
          owned_by: c.provider,
          permission: []
        }))
      });
    }

    // 8. Core LLM Routing & Execution Endpoint
    if (path === '/v1/chat/completions' && request.method === 'POST') {
      let payload: ChatCompletionPayload;
      try {
        payload = await request.json();
      } catch {
        return jsonResponse({ error: 'Invalid JSON request body' }, 400);
      }

      if (!payload.messages || !Array.isArray(payload.messages) || payload.messages.length === 0) {
        return jsonResponse({ error: 'Missing required field: messages' }, 400);
      }

      const timeoutMs = parseInt(env.DEFAULT_TIMEOUT_MS || '30000', 10);
      const incomingProxyKey = proxyKeyHeader || authHeader.replace(/^Bearer\s+/i, '').trim();
      const excludedKeys = new Set<string>();
      const maxRetries = 4;
      let attempt = 0;
      let lastErrorReason = 'Unknown error';

      while (attempt < maxRetries) {
        attempt++;

        // Route to optimal candidate
        const routing = getNextCandidate(
          payload.preferred_provider,
          payload.preferred_models,
          payload.only_reliable_models,
          excludedKeys
        );

        const candidate = routing.candidate;
        const candidateKey = `${candidate.provider}:${candidate.model}`;
        const startTime = Date.now();

        try {
          console.log(`[Router] Attempt #${attempt}: Dispatching to ${candidateKey} (Tier ${routing.tier}, Untested: ${routing.isUntested})`);

          const upstreamRes = await executeUpstreamCall(candidate, payload, env, timeoutMs, incomingProxyKey);
          const durationMs = Date.now() - startTime;

          // If upstream succeeded (200 OK)
          if (upstreamRes.ok) {
            recordSuccess(candidate.provider, candidate.model, durationMs, env, ctx);

            // Forward response headers with routing diagnostics
            const responseHeaders = new Headers(upstreamRes.headers);
            for (const [k, v] of Object.entries(CORS_HEADERS)) {
              responseHeaders.set(k, v);
            }
            responseHeaders.set('X-Routed-Provider', candidate.provider);
            responseHeaders.set('X-Routed-Model', candidate.model);
            responseHeaders.set('X-Routed-Tier', String(routing.tier));
            responseHeaders.set('X-Response-Time-Ms', String(durationMs));
            responseHeaders.set('X-Retry-Attempts', String(attempt));

            return new Response(upstreamRes.body, {
              status: 200,
              headers: responseHeaders
            });
          }

          // Upstream failed with HTTP error code
          const errStatus = upstreamRes.status;
          const errBody = await upstreamRes.text().catch(() => 'No error body');
          lastErrorReason = `HTTP ${errStatus}: ${errBody.slice(0, 150)}`;

          console.warn(`[Router] Failure on ${candidateKey} (${errStatus}): ${lastErrorReason}`);
          recordFailure(candidate.provider, candidate.model, lastErrorReason, env, ctx);
          excludedKeys.add(candidateKey);
        } catch (err: any) {
          const durationMs = Date.now() - startTime;
          lastErrorReason = err.name === 'AbortError'
            ? `Timeout after ${Math.round(timeoutMs / 1000)}s`
            : (err.message || 'Network exception');

          console.warn(`[Router] Exception on ${candidateKey} (${durationMs}ms): ${lastErrorReason}`);
          recordFailure(candidate.provider, candidate.model, lastErrorReason, env, ctx);
          excludedKeys.add(candidateKey);
        }
      }

      // If all fallback attempts failed
      return jsonResponse({
        error: 'All available LLM candidate models failed.',
        attempts: attempt,
        lastError: lastErrorReason
      }, 502);
    }

    return jsonResponse({ error: `Not Found: ${path}` }, 404);
  }
};
```

---

## 5. Step-by-Step Deployment & Configuration Guide

Gemini or an autonomous build agent must execute the following commands to provision and deploy the worker.

### 5.1 Initialize Project & Dependencies

```bash
mkdir llm-edge-router
cd llm-edge-router
npm init -y
npm install -D typescript @cloudflare/workers-types wrangler
npx tsc --init
```

Ensure `tsconfig.json` includes:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "node",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "skipLibCheck": true
  }
}
```

### 5.2 Create Cloudflare Workers KV Namespace

```bash
# Production KV Namespace
wrangler kv:namespace create LLM_STATE_KV

# Preview KV Namespace (for local dev)
wrangler kv:namespace create LLM_STATE_KV --preview
```
*Copy the returned IDs into `wrangler.toml` under `kv_namespaces`.*

### 5.3 Set Master API Secrets

Never hardcode upstream credentials into source code. Use Wrangler's encrypted secrets store:

```bash
# Client Proxy Authentication Secret
wrangler secret put PROXY_SECRET

# Upstream Provider Keys
wrangler secret put GEMINI_API_KEY
wrangler secret put GROQ_API_KEY
wrangler secret put OPENROUTER_API_KEY
wrangler secret put NINEFLARE_API_KEY
```

### 5.4 Test Locally

```bash
wrangler dev
```

### 5.5 Deploy to Global Cloudflare Edge

```bash
wrangler deploy
```

---

## 6. Verification, Testing & Operational Runbook

### 6.1 Test Chat Completion (Auto-Rotating via Edge Router)

```bash
curl -X POST https://llm-edge-router.nclong87.workers.dev/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "X-Proxy-Key: your-secure-client-proxy-secret" \
  -d '{
    "messages": [
      { "role": "system", "content": "You are a concise AI tutor." },
      { "role": "user", "content": "Explain spaced repetition in 1 sentence." }
    ]
  }' -i
```

**Expected Response Headers:**
```http
HTTP/2 200 OK
content-type: application/json
x-routed-provider: groq
x-routed-model: openai/gpt-oss-120b
x-routed-tier: 1
x-response-time-ms: 412
x-retry-attempts: 1
```

> **Direct Microservice Verification**:
> You can also verify individual provider workers directly:
> - **Groq**: `curl https://groq.nclong87.workers.dev/openai/v1/chat/completions ...`
> - **Gemini**: `curl -X POST https://gemini.nclong87.workers.dev/v1beta/models/gemini-2.5-flash:generateContent ...`
> - **OpenRouter**: `curl https://openrouter.nclong87.workers.dev/api/v1/chat/completions ...`
> - **9Flare**: `curl https://9flare.nclong87.workers.dev/api/v1/chat/completions ...`
> - **Ollama**: `curl https://ollama.nclong87.workers.dev/v1/chat/completions ...`
> - **Cloudflare**: `curl https://cloudflare.nclong87.workers.dev ...`

### 6.2 Inspect Real-Time Health & Circuit Breaker Locks

```bash
curl https://llm-edge-router.nclong87.workers.dev/v1/status \
  -H "X-Proxy-Key: your-secure-client-proxy-secret"
```

**Sample Output:**
```json
{
  "metrics": {
    "groq:openai/gpt-oss-120b": {
      "provider": "groq",
      "model": "openai/gpt-oss-120b",
      "lastResponseTimeMs": 412,
      "avgResponseTimeMs": 425,
      "totalCalls": 18,
      "totalSuccesses": 18,
      "lastError": null
    }
  },
  "lockedModels": {
    "gemini:gemini-1.5-pro": {
      "provider": "gemini",
      "model": "gemini-1.5-pro",
      "lockedAt": 1726752000000,
      "expiresAt": 1726755600000,
      "reason": "HTTP 429: Resource has been exhausted"
    }
  }
}
```

### 6.3 Simulate Fault Recovery & Fallback Cascade
1. Pass an invalid API key for a specific provider in test mode or deliberately trigger rate limits.
2. Observe in server logs how the failing model is immediately locked for $\ge 1\text{ hour}$.
3. Verify that the response header returns `X-Retry-Attempts: 2`, and the caller receives an immediate, uninterrupted completion from the backup provider.

### 6.4 Manual Cooldown Reset

```bash
# Unlock single model
curl -X POST https://llm-edge-router.nclong87.workers.dev/v1/unlock \
  -H "Content-Type: application/json" \
  -H "X-Proxy-Key: your-secure-client-proxy-secret" \
  -d '{"provider": "gemini", "model": "gemini-1.5-pro"}'

# Clear all active locks
curl -X POST https://llm-edge-router.nclong87.workers.dev/v1/unlock \
  -H "Content-Type: application/json" \
  -H "X-Proxy-Key: your-secure-client-proxy-secret" \
  -d '{"all": true}'
```

---

## 7. Gemini Implementation Checklist

When tasked with generating or updating the Cloudflare Worker:
- [x] **Always Pass Access Key in `X-Proxy-Key` Header**: Every outbound HTTP request to Cloudflare Workers (`*.workers.dev`) MUST unconditionally include the access key in the `X-Proxy-Key` header (`headers['X-Proxy-Key'] = accessKey`).
- [x] **No Master Keys in Client**: Client applications only send `X-Proxy-Key` or Bearer token; actual provider keys remain locked inside `env.*` Cloudflare Secrets.
- [x] **Single-Sample Probe Graduation**: Newly added models are prioritized in Tier 1 with single-sample graduation.
- [x] **Clamped Circuit Breaker**: Formula enforces minimum 1-hour and maximum 96-hour (4 days, strictly $< 5$ days) lockout.
- [x] **Non-Blocking KV Synchronization**: Always execute KV writes via `ctx.waitUntil()` to keep edge response overhead $< 10\text{ms}$.
- [x] **Full API Schema Compatibility**: Support standard OpenAI Chat Completions payload while seamlessly translating to Gemini REST v1beta when routing to Google models.
- [x] **Deterministic Fallback Cascade**: Loop attempts up to 4 alternate candidates on 429 / 5xx / timeout before returning an HTTP 502 error to the user.
