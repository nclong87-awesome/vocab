# LLM Estimated Response Time & Request Retry Architecture Guide
## Technical Specification & Implementation Guide

---

### Executive Summary

In high-reliability AI-assisted learning applications, Large Language Model (LLM) requests are subject to variable generation latencies, token streaming times, cloud queue delays, rate limits (HTTP 429), and upstream service outages (HTTP 500/502/503/504). Providing an intuitive, transparent user experience requires two coupled subsystems:

1. **Estimated Response Time Engine**: A predictive, dynamic feedback system that resolves the active provider and model prior to dispatch, computes expected latency based on rolling historical benchmarks, and renders an animated progress indicator with real-time elapsed and remaining seconds without prematurely jumping to 100%.
2. **Multi-Layer Request Retry & Resilience Engine**: A 3-tier defense-in-depth architecture spanning transport-level exponential backoff with jitter, protocol-level payload self-healing, dynamic multi-candidate circuit-breaker lockouts, and an automated 5-second in-chat countdown card with instant manual overrides and transparent failover routing.

This document details the end-to-end data flow, mathematical formulations, state lifecycles, and component architectures governing both systems.

---

### 1. Architectural Overview & System Flow

```
                      ┌─────────────────────────────────┐
                      │    User Triggers LLM Action     │
                      │ (Chat / Quiz / Definition / Fix)│
                      └────────────────┬────────────────┘
                                       │
                                       ▼
       [ Pre-Flight Candidate Resolution & Event Broadcast ]
         • notifyLlmRequestStartFromConfig(llmConfig)
         • Non-advancing candidate lookahead: getNextAutoCandidate()
         • Event emission: publishLlmRequestStart({ provider, model })
                                       │
                 ┌─────────────────────┴─────────────────────┐
                 ▼                                           ▼
┌─────────────────────────────────┐         ┌─────────────────────────────────┐
│     LlmProgressIndicator UX     │         │   Transport Dispatch Layer      │
│ • Subscribes to start events    │         │ • callLLMClientSideWithMeta()   │
│ • Resolves target avgTimeMs     │         │ • fetchWithTimeout (30s abort)  │
│ • 100ms interval clock tick     │         │ • callWithRetry() backoff loop  │
│ • Progress capped strictly at 99%│         └────────────────┬────────────────┘
│ • "just a moment..." overflow   │                          │
└─────────────────────────────────┘                          │
                                                             ▼
                                                [ Request Outcome Check ]
                                                /                       \
                                      (Success: 200 OK)         (Failure: 429/5xx/Net/Timeout)
                                            /                               \
                                           ▼                                 ▼
                     ┌───────────────────────────┐         ┌───────────────────────────┐
                     │ Metric & History Logging  │         │   Circuit Breaker Lock    │
                     │ • recordModelResponse()   │         │ • recordModelFailure()    │
                     │ • Rolling avg recalculation│         │ • Dynamic lock (1h - 96h) │
                     │ • Dismiss typing indicator│         └─────────────┬─────────────┘
                     └───────────────────────────┘                       │
                                                                         ▼
                                                           ┌───────────────────────────┐
                                                           │ ChatErrorMessageCard UI   │
                                                           │ • 5s Auto-Retry Countdown │
                                                           │ • "Try again now" bypass  │
                                                           │ • "Cancel" override       │
                                                           └─────────────┬─────────────┘
                                                                         │ (Countdown reaches 0s
                                                                         │  or user clicks retry)
                                                                         ▼
                                                           ┌───────────────────────────┐
                                                           │ Execute Retry Handler     │
                                                           │ • Previous model locked   │
                                                           │ • Auto Mode selects next  │
                                                           │   healthy candidate       │
                                                           └───────────────────────────┘
```

---

### 2. Logic for Displaying Estimated Response Time

The estimated response time system provides continuous, non-blocking visual feedback to the user while an LLM inference request is pending. It prevents user abandonment, communicates operational transparency, and provides immediate control via a cancellation trigger.

#### 2.1 Pre-Flight Candidate Resolution & Start Notification

Before initiating the network request, the application must immediately inform the UI which provider and model will handle the request. This eliminates latency between when the user submits a message and when the progress UI appears.

1. **Pre-Request Event Bus (`src/utils/llmEvents.ts`)**:
   - An event listener pattern decoupled from React rendering cycles:
     ```typescript
     export interface LlmRequestStartEvent {
       provider: string;
       model: string;
       timestamp?: number;
     }
     ```
   - `publishLlmRequestStart(data)` broadcasts the event to all registered subscribers.
   - `notifyLlmRequestStartFromConfig(llmConfig)` performs pre-flight resolution:
     - If `provider === "auto"` or `model === "auto"`, it calls `getNextAutoCandidate(llmConfig, undefined, false)` with `advance = false`. This peeks at the upcoming candidate without incrementing the global round-robin rotation index.
     - In fixed mode, it sanitizes the provider and model against available options.
     - Dispatches `{ provider, model, timestamp: Date.now() }` and returns the resolved tuple.
2. **Hook Integration (`src/hooks/useChat.ts`)**:
   - When initiating generation, `startTypingWithConfig()` calls `notifyLlmRequestStartFromConfig(cfgToUse)`.
   - Sets local state `activeModelInfo` and sets `isTypingState = true`.
   - A secondary listener inside `LlmProgressIndicator.tsx` guarantees that even if the active candidate changes mid-flight (e.g. during an automated fallback), the UI immediately reflects the updated model.

#### 2.2 Expected Duration Formulation ($T_{\text{expected}}$)

In `src/components/chat/LlmProgressIndicator.tsx`, the estimated response time $T_{\text{expected}}$ (`avgTimeMs`) is resolved using the model metrics engine:

```typescript
const statuses = getAllModelStatuses(llmConfig);
const match = statuses.find((s) => s.provider === provider && s.model === model);
const avgTimeMs = match?.avgResponseTimeMs ?? match?.lastResponseTimeMs ?? 20000;
```

##### Fallback Hierarchy:
1. **`match.avgResponseTimeMs` (Rolling Historical Average)**:
   - Derived from up to 100 historical successful requests recorded in `ModelMetricsRecord.recentResponseTimes` and IndexedDB logs.
   - Calculated as:
     $$\text{avgResponseTimeMs} = \operatorname{round}\left(\frac{1}{K} \sum_{i=1}^{K} d_i\right)$$
     where $d_i$ represents the verified duration in milliseconds of each successful request $i$, and $K \ge 1$.
2. **`match.lastResponseTimeMs` (Single Benchmark Sample)**:
   - Used when a model has only been executed once or when rolling averages are being initialized.
3. **Default Benchmark Fallback ($20{,}000\text{ ms} = 20.0\text{ s}$)**:
   - If a model is completely untested (e.g., a newly introduced Tier 1 probe with 0 previous calls, or an unbenchmarked custom endpoint), the system defaults to $20{,}000\text{ ms}$. This represents the conservative empirical median for multi-turn generative language tasks across edge providers.

#### 2.3 Real-Time Clock & Progress Math

The progress indicator mounts a high-resolution 100ms interval timer:

```typescript
const [elapsedMs, setElapsedMs] = useState(0);

useEffect(() => {
  const startTime = Date.now();
  const interval = setInterval(() => {
    setElapsedMs(Date.now() - startTime);
  }, 100);
  return () => clearInterval(interval);
}, []);
```

##### Mathematical Formulations:

1. **Elapsed Time**:
   $$t_{\text{elapsed}} = \text{Date.now()} - t_{\text{start}}$$
   Displayed in whole seconds: $\lfloor t_{\text{elapsed}} / 1000 \rfloor\text{s}$.

2. **Progress Percentage ($P$)**:
   $$P(t) = \min\left(99, \frac{t_{\text{elapsed}}}{T_{\text{expected}}} \times 100\right)$$
   
   > **The 99% Clamping Rule**:
   > The progress calculation is strictly capped at **99%**. In generative AI, a progress bar must **never** reach 100% until the HTTP response payload has arrived, been parsed, and verified. If a progress bar displays 100% while the network connection is still waiting for upstream tokens, the user perceives the application as crashed or frozen.

3. **Remaining Estimated Time ($T_{\text{remaining}}$)**:
   $$T_{\text{remaining}} = \max\left(0, \frac{T_{\text{expected}} - t_{\text{elapsed}}}{1000}\right)$$

##### Soft Overtime Transition:
- While $t_{\text{elapsed}} < T_{\text{expected}}$: The label displays `~X.Xs left` (formatted with 1 decimal precision, e.g., `~4.2s left`).
- When $t_{\text{elapsed}} \ge T_{\text{expected}}$: Rather than displaying `~0.0s left` or freezing, the UI gracefully transitions the remaining label to:
  $$\text{"just a moment..."}$$
  while the progress bar maintains 99% and the elapsed counter continues to increment smoothly (`21s elapsed`, `22s elapsed`, etc.).

#### 2.4 User Interface Specifications (`LlmProgressIndicator.tsx`)

| UI Element | Styling / Behavior | Functional Purpose |
| :--- | :--- | :--- |
| **Pulsing Accent Line** | `h-[3px] bg-gradient-to-r from-amber-400 via-amber-500 to-amber-600 animate-pulse` | Top border indication that generation is actively streaming. |
| **Pulsing Beacon** | Outer: `w-5 h-5 bg-amber-400/30 animate-ping`; Inner: `w-2.5 h-2.5 bg-amber-500` | Optical confirmation that the network worker is alive. |
| **Provider Pill** | `text-[10.5px] font-semibold bg-stone-200/80 px-1.5 py-0.5 rounded` | Identifies whether Gemini, Cloudflare, OpenRouter, Groq, etc., is responding. |
| **Model Label** | `text-xs font-bold font-mono text-stone-800 truncate` | Shows the active model name (e.g. `gemini-2.5-flash`, `llama-3.3-70b`). |
| **Auto Badge** | `text-[9.5px] text-amber-800 bg-amber-100/90 border border-amber-300/60` | Appears exclusively when Auto-Routing is managing selection. |
| **Cancel Button** | `text-[10px] bg-stone-100 hover:bg-stone-200 border rounded-lg` with `X` icon | Aborts the active `fetch` via `AbortController.abort()` and cleans state. |
| **Dynamic Progress Bar** | Height `1.5px`, `rounded-full`, amber-to-orange gradient, CSS `transition-all duration-100 ease-out` | Proportional bar reflecting $P(t) \in [0\%, 99\%]$. |
| **Metadata Row** | Left: Clock icon + elapsed seconds; Center: Integer percentage; Right: Remaining time or `"just a moment..."` | Scannable, typography-aligned status breakdown. |

#### 2.5 Post-Request Metric Updates

When the response successfully returns:
1. `recordModelResponse(provider, model, durationMs)` is invoked in `src/utils/autoModeManager.ts`.
2. Any existing lock on the model is immediately cleared (`unlockModel(provider, model)`).
3. The verified duration is appended to `recentOutcomes` and `recentResponseTimes` (sliding window up to $100$ entries).
4. `avgResponseTimeMs` is re-averaged and persisted to `localStorage` under `vocab_learner_model_metrics`.
5. The request is persisted to IndexedDB via `logApiRequest()`, providing permanent auditability.

---

### 3. Logic for Retrying Failed Requests

The application implements a **Three-Tier Defense-in-Depth Resilience Architecture** to handle transient network blips, HTTP 429 rate limit saturation, provider downtime, and syntax incompatibilities.

```
┌─────────────────────────────────────────────────────────────────────────┐
│ TIER 1: Low-Level Transport Retry (callWithRetry in llmClientService)   │
│ • Wraps individual HTTP fetch calls                                     │
│ • Exponential backoff with random jitter (1000ms -> 2000ms -> 4000ms)    │
│ • Protocol self-healing (strips unsupported JSON/reasoning schemas)     │
│ • Filters out fatal non-retryable errors (401, 403, 400 location)       │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │ (Fails after transport retries)
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ TIER 2: Auto-Mode Failover & Circuit Breaker (autoModeManager.ts)       │
│ • Records failure outcome with error message in metrics                 │
│ • Calculates multi-factor adaptive lock duration (1h up to 96h)         │
│ • Locks failed model in localStorage & memory                           │
│ • Auto Mode excludes locked model and selects next healthy candidate     │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │ (Error surfaces to application)
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ TIER 3: In-Chat Error Presentation & Automated Countdown (useChat.ts)   │
│ • Displays ChatErrorMessageCard with error details and badges           │
│ • Starts automatic 5-second countdown timer with pulsing red beacon     │
│ • "Try again now" button for instantaneous manual retry                 │
│ • "Cancel" button to stop countdown and switch to manual trigger        │
│ • On trigger: removes error card and re-executes with next candidate    │
└─────────────────────────────────────────────────────────────────────────┘
```

---

### 4. Deep-Dive: Tier 1 – Transport-Level Retry (`callWithRetry`)

All client-side API invocations pass through `callWithRetry<T>` in `src/services/llmClientService.ts`.

#### 4.1 Error Classification & Retryability Matrix

When an exception occurs during fetch or response parsing, `parseLlmError(err, provider)` inspects HTTP status codes, GoogleGenAI SDK error JSON strings, Cloudflare worker headers, and network exceptions:

| HTTP / Code | Error Type | Classification | Retryable (`isRetryable`) | Action Taken |
| :--- | :--- | :--- | :--- | :--- |
| **401** | `INVALID_KEY` | Unauthorized / Invalid API Key | **`false`** | Throw immediately. Do NOT retry. Prompt user to check LLM Settings. |
| **403** | `PERMISSION_DENIED` | Forbidden / Geo/Project Blocked | **`false`** | Throw immediately. Do NOT retry. |
| **400** | `LOCATION_UNSUPPORTED` | Region Restricted | **`false`** | Throw immediately. Guide user on proxy header IP stripping. |
| **404** | `NOT_FOUND` | Model Not Found / Bad Endpoint | **`false`** | Throw immediately. Model name invalid for this provider. |
| **429** | `RATE_LIMIT` | Quota Exceeded / Too Many Requests | **`true`** | **Retryable**. Apply exponential backoff with jitter. |
| **500 / 502 / 503 / 504** | `SERVER_ERROR` | Provider Internal / Overloaded | **`true`** | **Retryable**. Provider temporarily unavailable. |
| **0 / Network** | `NETWORK_ERROR` | Socket Drop, CORS, Offline | **`true`** (unless 30s timeout) | **Retryable**. Transient connection interruption. |
| **422** | `INVALID_RESPONSE` | Empty or Unparseable JSON Payload | **`true`** | **Retryable**. Provider returned corrupted payload. |

#### 4.2 Exponential Backoff with Jitter Formulation

When `parsed.isRetryable === true`, the engine pauses execution using exponential backoff with additive random jitter:

$$t_{\text{delay}} = \min\left(t_{\text{max}}, t_{\text{initial}} \times b^{(\text{attempt} - 1)}\right) + \operatorname{rand}(0, 200\text{ ms})$$

- Default Parameters:
  - $t_{\text{initial}} = 1000\text{ ms}$
  - $t_{\text{max}} = 4000\text{ ms}$
  - $b (\text{backoffFactor}) = 2.0$
  - $\text{maxRetries} = 1$ (1 immediate backoff retry at the transport layer before escalating to Tier 2 multi-candidate failover)

#### 4.3 Protocol Self-Healing (Parameter Stripping Retry)

Certain upstream models (e.g. specialized OpenRouter models or older Ollama variants) return HTTP 400 when sent modern OpenAI-compatible parameters such as `response_format: { type: "json_object" }` or `reasoning_format: "hidden"`:

```typescript
// If request failed with 400 due to response_format or reasoning, retry once without those parameters
if (!res.ok && (reqBody.response_format || reqBody.reasoning_format || reqBody.include_reasoning !== undefined)) {
  const errClone = res.clone();
  const errText = await errClone.text().catch(() => "");
  if (errText.includes("JSON mode") || errText.includes("response_format") || errText.includes("reasoning") || res.status === 400) {
    delete reqBody.response_format;
    delete reqBody.reasoning_format;
    delete reqBody.include_reasoning;
    res = await fetchWithTimeout(targetUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(reqBody),
      signal
    });
  }
}
```

This protocol-level self-healing ensures that format incompatibilities are resolved automatically before failing over.

---

### 5. Deep-Dive: Tier 2 – Multi-Candidate Auto-Routing & Circuit Breaker

When an error persists beyond Tier 1 transport retries, the Auto Mode Resilience Engine intervenes.

#### 5.1 Failure Recording & Circuit Breaker Invocation

In `callLLMClientSideWithMeta`, if a candidate model throws:
1. `recordModelFailure(candidate.provider, candidate.model, err.message, candidateDuration)` is executed.
2. `lockModel(candidate.provider, candidate.model, 3600000, err.message)` is triggered.
3. Passing standard duration (`3600000` or 1 hour) automatically invokes `calculateOptimalLockDuration(provider, model, errorReason)`.

#### 5.2 Adaptive Lock Duration Calculation (`calculateOptimalLockDuration`)

The engine calculates an optimal penalty lockout period based on four distinct metrics:

##### Factor 1: Consecutive Failure Streak Base Duration
The number of consecutive failures at the tail of recent outcomes dictates an exponential penalty base:
- **1 failure**: $1\text{ hour}$ ($3{,}600{,}000\text{ ms}$)
- **2 consecutive failures**: $4\text{ hours}$ ($14{,}400{,}000\text{ ms}$)
- **3 consecutive failures**: $24\text{ hours}$ ($1\text{ day}$)
- **4 consecutive failures**: $54\text{ hours}$ ($2.25\text{ days}$)
- **5 consecutive failures**: $78\text{ hours}$ ($3.25\text{ days}$)
- **$\ge 6$ consecutive failures**: $96\text{ hours}$ ($4\text{ days}$)

##### Factor 2: Accumulated 5-Day Failure History with Recency Decay
The engine inspects all failure logs within the rolling 5-day window ($120\text{ hours}$), weighting older failures less than recent ones using a power decay curve:

$$\text{Weight}_i = \max\left(0.05, \left(1 - \frac{\text{age}_i}{5\text{ days}}\right)^{1.4}\right)$$
$$\text{Penalty}_{\text{recency}} = \sum_{i} \left(1\text{ hour} \times \text{Weight}_i\right)$$

$$\text{BaseDuration} = \text{Base}_{\text{consecutive}} + \text{Penalty}_{\text{recency}}$$

##### Factor 3: High Latency Multiplier ($M_{\text{latency}}$)
Models that were already exhibiting slow response times ($> 15\text{s}$) receive prolonged lockouts:
$$M_{\text{latency}} = \begin{cases} 
1.0 & \text{if } \text{avgResponseTimeMs} \le 15000 \\ 
\min\left(3.0, \frac{\text{avgResponseTimeMs}}{15000}\right) & \text{if } \text{avgResponseTimeMs} > 15000 
\end{cases}$$

##### Factor 4: Historical Reliability Factor ($M_{\text{reliability}}$)
For models with at least 3 historical calls:
- $\ge 90\%$ success rate and $\le 1$ failure: $M_{\text{reliability}} = 0.5$ (50% discount for rare glitches on reliable models).
- $< 50\%$ success rate: $M_{\text{reliability}} = 2.0$ ($2\times$ lockout penalty).
- $50\% - 75\%$ success rate: $M_{\text{reliability}} = 1.5$ ($1.5\times$ lockout penalty).

##### Factor 5: Boundary Clamping
$$\text{Duration}_{\text{final}} = \operatorname{clamp}\left(1\text{ hour}, 4\text{ days}, \operatorname{round}(\text{BaseDuration} \times M_{\text{latency}} \times M_{\text{reliability}})\right)$$
The lock duration is strictly bounded between **1 hour** and **4 days (96 hours)**, ensuring it never exceeds 5 days.

#### 5.3 Candidate Exclusion & Automatic Failover

1. The locked model is written to `localStorage["vocab_learner_locked_models"]` with an explicit `expiresAt` epoch timestamp.
2. When the user or system triggers a subsequent call, `getNextAutoCandidate()` filters the available candidates:
   ```typescript
   let available = candidates.filter(cand => {
     const key = `${cand.provider}:${cand.model}`;
     const isLocked = Boolean(lockedMap[key] && lockedMap[key].expiresAt > Date.now());
     return !isLocked;
   });
   ```
3. Routing selects from remaining available candidates:
   - **Tier 1 Untested Probes** $\to$ **Tier 1 Fast ($<15$s)** $\to$ **Tier 2 Medium ($15$–$25$s)** $\to$ **Tier 4 Demoted ($>25$s)**.
4. **Anti-Deadlock Lockout Reset (`clearAllLocks`)**: If an extreme network partition causes every registered model across all providers to become locked, the engine detects that `available.length === 0`, invokes `clearAllLocks()`, logs a warning, and re-enables all models to prevent application starvation.

---

### 6. Deep-Dive: Tier 3 – In-Chat Error Presentation & Automated Countdown Retry

When an error bubbles up to the application layer (`src/hooks/useChat.ts`), it enters the user-facing retry lifecycle.

```
                  [ LLM Call Throws in useChat.ts ]
                                  │
                                  ▼
             [ triggerChatErrorWithCountdown() Invoked ]
             • setIsTypingState(false)
             • Store retry callback in pendingRetriesRef
             • Append ChatMessage with isError: true & errorInfo
                                  │
                                  ▼
                  [ ChatErrorMessageCard Mounted ]
                  • Starts 5-second countdown ticker
                  • Renders pulsing indicator & Auto Mode switch note
                                  │
                 ┌────────────────┴────────────────┐
                 │                                 │
          (User clicks "Cancel")           (Seconds reach 0s or
                 │                          User clicks "Try again now")
                 ▼                                 │
      [ Countdown Cancelled ]                      ▼
      • clearInterval()                    [ handleTriggerRetry() ]
      • Switches to manual                 • clearInterval()
        "Retry" button state               • setIsRetrying(true)
                                           • Invokes onRetry() callback
                                                   │
                                                   ▼
                                     [ handleRetryErrorMessage() ]
                                     • Removes error card from chat
                                     • Invokes stored retryAction(llmConfig)
                                     • Auto Mode selects next healthy model
```

#### 6.1 Chat Error Message Registration

In `useChat.ts`:
```typescript
const triggerChatErrorWithCountdown = (
  err: any,
  currentConfig: LLMConfig,
  retryAction: (newConfig: LLMConfig) => void,
  prefix: string = "error"
) => {
  setIsTypingState(false);
  const rawMsg = err?.userMessage || err?.message || "Failed to communicate with AI provider.";
  const isTimeout = Boolean(
    err?.isTimeout ||
    err?.name === "TimeoutError" ||
    rawMsg.toLowerCase().includes("timeout") ||
    rawMsg.toLowerCase().includes("timed out")
  );
  const failedProvider = err?.provider || currentConfig.provider;
  const failedModel = err?.model || currentConfig.model;

  if (failedProvider && failedModel && (currentConfig.provider === "auto" || currentConfig.model === "auto")) {
    lockModel(failedProvider, failedModel, 3600000, rawMsg);
  }

  const errorMsgId = `${prefix}-${Date.now()}`;
  pendingRetriesRef.current.set(errorMsgId, retryAction);

  const errorMsg: ChatMessage = {
    id: errorMsgId,
    role: "assistant",
    content: rawMsg,
    timestamp: new Date().toISOString(),
    provider: failedProvider,
    model: failedModel,
    isError: true,
    errorInfo: {
      message: rawMsg,
      provider: failedProvider,
      model: failedModel,
      isTimeout,
      canRetry: true,
    },
  };

  setChatMessages((prev) => [...prev, errorMsg]);
};
```

#### 6.2 The 5-Second Countdown Loop (`ChatErrorMessageCard.tsx`)

`ChatErrorMessageCard` mounts with `secondsLeft = 5` and runs a 1-second interval:

```typescript
useEffect(() => {
  if (isCancelled || isRetrying) return;

  timerRef.current = setInterval(() => {
    setSecondsLeft((prev) => {
      if (prev <= 1) {
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        handleTriggerRetry();
        return 0;
      }
      return prev - 1;
    });
  }, 1000);

  return () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };
}, [isCancelled, isRetrying]);
```

#### 6.3 User Controls & State Transitions

1. **Automatic Expiration**: When `secondsLeft` counts down from `5` to `0`, `handleTriggerRetry()` automatically calls `onRetry()`.
2. **Immediate Manual Bypass ("Try again now")**:
   - The user can click the primary rose-colored button at any time.
   - Clears the interval timer immediately.
   - Sets `isRetrying = true` and triggers `onRetry()` without delay.
3. **Cancellation Override ("Cancel")**:
   - The user clicks the white outline "Cancel" button.
   - Clears the countdown interval.
   - Sets `isCancelled = true`.
   - The UI replaces the countdown with an italicized notice: `"Automatic retry cancelled"`, and reveals a neutral dark button labeled `"Retry"` for manual on-demand execution later.

#### 6.4 Clean History Re-Execution

When retry triggers:
1. `handleRetryErrorMessage(messageId)` removes the error card message from `chatMessages`.
2. Retrieves the stored closure `retryAction` from `pendingRetriesRef` and deletes the entry.
3. Invokes `retryAction(llmConfig)`.
4. Because the failed provider/model was already locked during step 6.1, `callLLMClientSideWithMeta` and `getNextAutoCandidate` automatically route the retry to the next best operational model in the cluster.
5. The user experiences a clean, seamless transition: the error card disappears, the typing indicator re-appears with the new model's name and its estimated latency, and the response streams in.

---

### 7. Edge Cases & Safety Mechanisms

| Scenario | Risk | System Mitigation |
| :--- | :--- | :--- |
| **User Abort / Cancel** | Dangling network requests and orphan token generation. | Clicking "Cancel" on `LlmProgressIndicator` aborts the `AbortController`. The catch block detects `err.name === 'AbortError'` or `signal.aborted`, re-throws without locking the model, and resets typing state cleanly without error cards. |
| **Generation Time Exceeds $T_{\text{expected}}$** | Progress bar reaches 100% or remaining time shows negative seconds. | Progress is strictly clamped to $\min(99, \dots)$. Remaining seconds clamp to $\max(0, \dots)$. When $t_{\text{elapsed}} \ge T_{\text{expected}}$, label shifts to `"just a moment..."`. |
| **Corrupted / Truncated JSON Output** | Model outputs incomplete markdown or malformed JSON syntax. | `jsonSanitizer.ts` executes multi-stage regex repairs (`cleanJsonResponse`, `cleanAndParseJson`). If unrecoverable, an `INVALID_RESPONSE` error (422) is raised, triggering Tier 1 retry and Tier 2 circuit breaker. |
| **OpenAI JSON Mode Rejection (HTTP 400)** | Provider rejects `response_format: { type: "json_object" }`. | Protocol self-healing intercepts 400 responses, strips `response_format` and reasoning parameters, and re-executes immediately. |
| **Cascading Cluster Outage (All Models Locked)** | Entire provider ecosystem unreachable or rate limited. | `getNextAutoCandidate` checks `available.length`. If 0, it calls `clearAllLocks()`, clearing all locks across providers and preventing total application lockout. |
| **Geo-Location IP Blocking (Gemini HTTP 400)** | Cloudflare worker forwards client IP from restricted country. | `parseLlmError` identifies `LOCATION_UNSUPPORTED` (400), marks `isRetryable = false`, and outputs explicit configuration guidance on proxy header IP stripping. |

---

### 8. Key Implementation Files Reference

| Subsystem | File Path | Primary Responsibilities |
| :--- | :--- | :--- |
| **Progress Indicator UI** | `src/components/chat/LlmProgressIndicator.tsx` | Visual timer, 100ms interval loop, 99% progress bar clamping, remaining seconds calculation, cancellation button. |
| **Start Event Bus** | `src/utils/llmEvents.ts` | Decoupled event emitter (`publishLlmRequestStart`, `notifyLlmRequestStartFromConfig`, `subscribeLlmRequestStart`). |
| **Auto Mode & Circuit Breaker** | `src/utils/autoModeManager.ts` | Multi-tier candidate routing, `getAllModelStatuses`, `calculateOptimalLockDuration`, `lockModel`, `recordModelResponse`, `recordModelFailure`. |
| **Transport & Retry Service** | `src/services/llmClientService.ts` | `callWithRetry`, `parseLlmError`, `callLLMClientSideWithMeta`, parameter self-healing, provider endpoints. |
| **Chat State Controller** | `src/hooks/useChat.ts` | `triggerChatErrorWithCountdown`, `handleRetryErrorMessage`, `pendingRetriesRef`, start typing notifications. |
| **Error Countdown Card** | `src/components/chat/ChatErrorMessageCard.tsx` | 5-second countdown loop, automatic retry dispatch, "Try again now" and "Cancel" buttons. |
| **Timeout Wrapper** | `src/utils.ts` | `fetchWithTimeout` (30-second default abort timeout, `X-Proxy-Key` injection). |
| **Audit Log Store** | `src/services/requestHistoryService.ts` | `logApiRequest`, IndexedDB persistence of latency, status, prompts, and raw responses. |
