# LLM Estimated Response Time & Request Retry Architecture Guide
## General Architecture & Engineering Specification

---

### Executive Summary

In high-reliability AI applications, Large Language Model (LLM) inference requests are subject to variable generation latencies, token streaming times, cloud queue delays, rate limits (HTTP 429), and upstream provider outages (HTTP 500/502/503/504). Ensuring an optimal and resilient user experience requires two decoupled yet coordinated subsystems:

1. **Estimated Response Time Engine**: A predictive, dynamic feedback system that determines the active provider and model prior to dispatch, computes expected latency based on historical benchmarks, and provides real-time elapsed and remaining seconds without prematurely reaching 100%.
2. **Multi-Layer Request Retry & Resilience Engine**: A 3-tier defense-in-depth architecture spanning transport-level exponential backoff with jitter, protocol-level payload self-healing, dynamic multi-candidate circuit-breaker lockouts, and an automated countdown retry mechanism with manual bypass and transparent failover routing.

This document serves as a generalized engineering specification and blueprint for implementing these systems across AI-assisted applications.

---

### 1. Architectural Overview & System Flow

```
                      ┌─────────────────────────────────┐
                      │    User Triggers LLM Action     │
                      └────────────────┬────────────────┘
                                       │
                                       ▼
       [ Pre-Flight Candidate Resolution & Event Broadcast ]
         • Non-advancing candidate lookahead: inspect next operational model
         • Event emission: publish request start event (provider, model, timestamp)
                                       │
                 ┌─────────────────────┴─────────────────────┐
                 ▼                                           ▼
┌─────────────────────────────────┐         ┌─────────────────────────────────┐
│     Progress Indicator UX       │         │   Transport Dispatch Layer      │
│ • Subscribes to start events    │         │ • High-level client wrapper     │
│ • Resolves target benchmark     │         │ • Configured abort timeout      │
│ • High-frequency clock tick     │         │ • Exponential backoff loop      │
│ • Progress capped at 99% max    │         └────────────────┬────────────────┘
│ • "Just a moment..." overflow   │                          │
└─────────────────────────────────┘                          │
                                                             ▼
                                                [ Request Outcome Check ]
                                                /                       \
                                      (Success: 200 OK)         (Failure: 429/5xx/Net/Timeout)
                                            /                               \
                                           ▼                                 ▼
                     ┌───────────────────────────┐         ┌───────────────────────────┐
                     │ Metric & History Logging  │         │   Circuit Breaker Lock    │
                     │ • Record model response   │         │ • Record model failure    │
                     │ • Rolling avg recalculation│        │ • Dynamic lock (1h - 96h) │
                     │ • Dismiss typing indicator│         └─────────────┬─────────────┘
                     └───────────────────────────┘                       │
                                                                         ▼
                                                           ┌───────────────────────────┐
                                                           │ Error Presentation Layer  │
                                                           │ • Automated Countdown     │
                                                           │ • "Try again now" bypass  │
                                                           │ • "Cancel" override       │
                                                           └─────────────┬─────────────┘
                                                                         │ (Countdown reaches 0s
                                                                         │  or user clicks retry)
                                                                         ▼
                                                           ┌───────────────────────────┐
                                                           │ Execute Retry Handler     │
                                                           │ • Previous model locked   │
                                                           │ • Auto-router selects next│
                                                           │   healthy candidate       │
                                                           └───────────────────────────┘
```

---

### 2. Logic for Displaying Estimated Response Time

The estimated response time system provides continuous, non-blocking visual feedback to the user while an LLM inference request is pending. It prevents perceived freezing, communicates operational transparency, and provides immediate control via an abort/cancel trigger.

#### 2.1 Pre-Flight Candidate Resolution & Start Notification

Before initiating the network request, the application must immediately resolve and publish the active provider and model to the presentation layer. This eliminates any lag between when the user submits an input and when the progress UI appears.

1. **Pre-Request Event Bus Pattern**:
   - The UI components subscribe to a decoupled event emitter rather than relying on synchronous props or delayed network hooks.
   - The event payload transmits:
     ```typescript
     interface RequestStartEvent {
       provider: string;
       model: string;
       timestamp: number;
     }
     ```
2. **Non-Advancing Candidate Lookahead**:
   - When dynamic multi-model auto-routing is enabled, the router peeks at the upcoming candidate without incrementing the global round-robin rotation index.
   - When fixed mode is enabled, the configured provider and model are validated against available credentials.
   - The resolved tuple is published immediately to the event bus and returned to the caller.
   - If an automated fallback switches models mid-flight, a new start event is emitted so the UI reflects the updated model and its specific latency expectation instantly.

#### 2.2 Expected Duration Formulation ($T_{\text{expected}}$)

The estimated response duration $T_{\text{expected}}$ is resolved using an adaptive hierarchy:

```
[ Model Latency Resolution Hierarchy ]
  1. Rolling Historical Average (from verified successful requests)
       └─ If unavailable ──> 2. Most Recent Single Latency Benchmark
                                └─ If untested ──> 3. Conservative Default Fallback (e.g. 20.0s)
```

##### 1. Rolling Historical Average
Derived from up to $K$ recent successful requests recorded for the exact provider/model pair:
$$\text{avgResponseTimeMs} = \operatorname{round}\left(\frac{1}{K} \sum_{i=1}^{K} d_i\right)$$
where $d_i$ represents the verified duration in milliseconds of each successful request $i$, and $K \ge 1$ (typically $K = 50\text{ to }100$).

##### 2. Single Benchmark Sample
Used when a model has only been executed once or when cold-start benchmarks are being established.

##### 3. Default Conservative Fallback ($20{,}000\text{ ms} = 20.0\text{ s}$)
If a model is completely untested (e.g., a newly introduced endpoint or an unbenchmarked custom model), the system falls back to a conservative default of $20{,}000\text{ ms}$. This represents an empirical median for complex multi-turn generation tasks across cloud and edge providers.

#### 2.3 Real-Time Clock & Progress Math

The progress indicator mounts a high-frequency interval timer (e.g., every 100ms) to update the elapsed duration:

$$t_{\text{elapsed}} = \text{Date.now()} - t_{\text{start}}$$

##### Mathematical Formulations:

1. **Elapsed Time**:
   Displayed in whole seconds:
   $$\text{Elapsed Seconds} = \lfloor t_{\text{elapsed}} / 1000 \rfloor\text{s}$$

2. **Progress Percentage ($P$)**:
   $$P(t) = \min\left(99, \frac{t_{\text{elapsed}}}{T_{\text{expected}}} \times 100\right)$$
   
   > **The 99% Clamping Rule**:
   > The progress percentage must be strictly capped at **99%**. In generative AI, a progress bar must **never** reach 100% until the HTTP response payload has arrived, been parsed, and verified. If a progress bar displays 100% while the network connection is still waiting for upstream tokens, the user perceives the application as crashed or frozen.

3. **Remaining Estimated Time ($T_{\text{remaining}}$)**:
   $$T_{\text{remaining}} = \max\left(0, \frac{T_{\text{expected}} - t_{\text{elapsed}}}{1000}\right)$$

##### Soft Overtime Transition:
- While $t_{\text{elapsed}} < T_{\text{expected}}$: The label displays remaining time with single-decimal precision (e.g., `~4.2s left`).
- When $t_{\text{elapsed}} \ge T_{\text{expected}}$: Rather than displaying `~0.0s left` or freezing, the UI gracefully transitions the remaining label to:
  $$\text{"Just a moment..."}$$
  while the progress bar maintains 99% and the elapsed counter continues to increment smoothly (`21s elapsed`, `22s elapsed`, etc.).

#### 2.4 User Interface Component Specifications

| UI Element | Presentation / Interaction | Functional Purpose |
| :--- | :--- | :--- |
| **Pulsing Accent Line** | Top border with horizontal animated gradient | Visual cue that generation is actively streaming. |
| **Activity Beacon** | Dual-layer pulsing beacon (outer ping + solid center) | Optical confirmation of background network vitality. |
| **Provider Badge** | Subtle pill badge with provider branding | Identifies which upstream platform is processing the request. |
| **Model Label** | Monospace typography with overflow truncation | Displays the active model identifier clearly. |
| **Routing Mode Indicator** | Distinctive badge shown during auto-routing | Informs the user that intelligent load balancing is managing candidate selection. |
| **Cancellation Trigger** | Direct abort button with close icon | Aborts the active fetch via `AbortController` and resets application state cleanly. |
| **Dynamic Progress Bar** | Smooth proportional bar reflecting $P(t) \in [0\%, 99\%]$ | Visual pacing benchmark based on expected latency. |
| **Status Breakdown** | Clock icon + elapsed seconds, integer percentage, remaining time or soft overflow | Scannable, typography-aligned progress overview. |

#### 2.5 Post-Request Metric Updates

When an LLM response successfully returns:
1. The model's circuit breaker lock is immediately cleared if one was previously pending.
2. The verified duration is appended to the model's sliding window of recent outcomes and response times.
3. The rolling average response time is recalculated and persisted to local client storage.
4. The transaction is logged to permanent local storage (such as IndexedDB) with status, timestamp, prompt tokens, and duration for auditability.

---

### 3. Logic for Retrying Failed Requests

A robust LLM integration implements a **Three-Tier Defense-in-Depth Resilience Architecture** to handle transient network disruptions, HTTP 429 rate limit saturation, provider downtime, and schema incompatibilities.

```
┌─────────────────────────────────────────────────────────────────────────┐
│ TIER 1: Transport-Level Retry                                           │
│ • Wraps individual HTTP network requests                                │
│ • Exponential backoff with random jitter (e.g., 1000ms -> 2000ms)       │
│ • Protocol self-healing (strips unsupported JSON/reasoning parameters)  │
│ • Filters out non-retryable errors (401, 403, invalid endpoint)         │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │ (Fails after transport retries)
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ TIER 2: Multi-Candidate Auto-Routing & Circuit Breaker                  │
│ • Records failure outcome with error reason in telemetry                │
│ • Calculates multi-factor adaptive lock duration (1h up to 96h)         │
│ • Locks failed model in persistent client storage                       │
│ • Auto-router excludes locked model and selects next healthy candidate  │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │ (Error surfaced to application)
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ TIER 3: User-Facing Error Presentation & Automated Countdown Retry      │
│ • Displays error presentation banner with diagnostic details            │
│ • Starts automated 5-second countdown timer                             │
│ • "Try again now" button for instantaneous manual retry                 │
│ • "Cancel" button to halt countdown and switch to manual on-demand mode │
│ • On trigger: re-executes action using next operational model           │
└─────────────────────────────────────────────────────────────────────────┘
```

---

### 4. Deep-Dive: Tier 1 – Transport-Level Retry

All low-level API invocations pass through a resilient network execution wrapper before returning to higher application layers.

#### 4.1 Error Classification & Retryability Matrix

When an exception occurs during network dispatch or payload parsing, errors are categorized into retryable and non-retryable classes:

| HTTP / Code | Category | Classification | Retryable | Action Taken |
| :--- | :--- | :--- | :--- | :--- |
| **401** | `INVALID_KEY` | Unauthorized / Invalid API Key | **No** | Fail immediately. Do not retry. Guide user to verify credentials. |
| **403** | `PERMISSION_DENIED` | Forbidden / Project/Tier Blocked | **No** | Fail immediately. Do not retry. |
| **400** | `LOCATION_UNSUPPORTED` | Region Restricted | **No** | Fail immediately. Do not retry. Provide IP configuration instructions. |
| **404** | `NOT_FOUND` | Model Not Found / Bad Route | **No** | Fail immediately. Model identifier does not exist on target host. |
| **429** | `RATE_LIMIT` | Quota Exceeded / Too Many Requests | **Yes** | **Retryable**. Apply exponential backoff with jitter. |
| **500 / 502 / 503 / 504** | `SERVER_ERROR` | Upstream Server / Gateway Outage | **Yes** | **Retryable**. Upstream service temporarily unavailable. |
| **0 / Network** | `NETWORK_ERROR` | Socket Drop, CORS, Offline | **Yes** (unless user aborted) | **Retryable**. Transient connection interruption. |
| **422** | `INVALID_RESPONSE` | Malformed or Unparseable JSON Payload | **Yes** | **Retryable**. Upstream service produced invalid payload. |

#### 4.2 Exponential Backoff with Jitter Formulation

When an error is flagged as retryable, the network wrapper delays subsequent attempts using exponential backoff with additive uniform random jitter:

$$t_{\text{delay}} = \min\left(t_{\text{max}}, t_{\text{initial}} \times b^{(\text{attempt} - 1)}\right) + \operatorname{rand}(0, \text{jitter}_{\text{max}})$$

- Standard Recommended Parameters:
  - $t_{\text{initial}} = 1000\text{ ms}$
  - $t_{\text{max}} = 4000\text{ ms}$
  - $b (\text{backoffFactor}) = 2.0$
  - $\text{jitter}_{\text{max}} = 200\text{ ms}$
  - $\text{maxTransportRetries} = 1$ (1 immediate retry at the transport layer before escalating to Tier 2 multi-candidate failover)

#### 4.3 Protocol Self-Healing (Parameter Stripping Retry)

Certain upstream models or proxy endpoints reject requests with HTTP 400 when sent modern parameters such as structured JSON schemas (`response_format: { type: "json_object" }`) or extended reasoning flags:

```typescript
// Parameter Stripping Self-Healing Pattern
if (!response.ok && hasAdvancedParameters(requestPayload)) {
  const errorText = await response.clone().text().catch(() => "");
  if (isSchemaOrReasoningRejection(errorText) || response.status === 400) {
    const sanitizedPayload = stripAdvancedParameters(requestPayload);
    response = await executeFetch(endpointUrl, sanitizedPayload, abortSignal);
  }
}
```

This protocol-level self-healing ensures that format incompatibilities are resolved automatically before triggering a full provider failover.

---

### 5. Deep-Dive: Tier 2 – Multi-Candidate Auto-Routing & Circuit Breaker

When an error persists beyond transport-level retries, the Auto-Routing Circuit Breaker intervenes to protect system stability.

#### 5.1 Failure Recording & Circuit Breaker Invocation

When a candidate model fails:
1. The failure outcome, timestamp, latency, and error message are appended to the model's metrics record.
2. The model is placed into a temporary circuit-breaker lockout state.
3. The lockout duration is dynamically computed using an adaptive multi-factor formulation.

#### 5.2 Adaptive Lock Duration Calculation

The lockout duration is determined by evaluating five distinct factors:

##### Factor 1: Consecutive Failure Streak Base Duration
The number of consecutive failures at the tail of recent outcomes establishes an exponential penalty base:
- **1 failure**: $1\text{ hour}$ ($3{,}600{,}000\text{ ms}$)
- **2 consecutive failures**: $4\text{ hours}$ ($14{,}400{,}000\text{ ms}$)
- **3 consecutive failures**: $24\text{ hours}$ ($1\text{ day}$)
- **4 consecutive failures**: $54\text{ hours}$ ($2.25\text{ days}$)
- **5 consecutive failures**: $78\text{ hours}$ ($3.25\text{ days}$)
- **$\ge 6$ consecutive failures**: $96\text{ hours}$ ($4\text{ days}$)

##### Factor 2: Accumulated Failure History with Recency Decay
All recorded failures within a rolling 5-day window ($120\text{ hours}$) are evaluated, weighting older failures less than recent ones using a power decay curve:

$$\text{Weight}_i = \max\left(0.05, \left(1 - \frac{\text{age}_i}{5\text{ days}}\right)^{1.4}\right)$$
$$\text{Penalty}_{\text{recency}} = \sum_{i} \left(1\text{ hour} \times \text{Weight}_i\right)$$

$$\text{BaseDuration} = \text{Base}_{\text{consecutive}} + \text{Penalty}_{\text{recency}}$$

##### Factor 3: High Latency Multiplier ($M_{\text{latency}}$)
Models that were already exhibiting degraded response times ($> 15\text{s}$) receive prolonged lockouts:
$$M_{\text{latency}} = \begin{cases} 
1.0 & \text{if } \text{avgResponseTimeMs} \le 15000 \\ 
\min\left(3.0, \frac{\text{avgResponseTimeMs}}{15000}\right) & \text{if } \text{avgResponseTimeMs} > 15000 
\end{cases}$$

##### Factor 4: Historical Reliability Factor ($M_{\text{reliability}}$)
For models with an established operational history (e.g., at least 3 historical requests):
- $\ge 90\%$ success rate and $\le 1$ failure: $M_{\text{reliability}} = 0.5$ (50% discount for rare anomalies on reliable models).
- $< 50\%$ success rate: $M_{\text{reliability}} = 2.0$ ($2\times$ lockout penalty).
- $50\% - 75\%$ success rate: $M_{\text{reliability}} = 1.5$ ($1.5\times$ lockout penalty).

##### Factor 5: Boundary Clamping
$$\text{Duration}_{\text{final}} = \operatorname{clamp}\left(1\text{ hour}, 4\text{ days}, \operatorname{round}(\text{BaseDuration} \times M_{\text{latency}} \times M_{\text{reliability}})\right)$$

The lockout duration is strictly bounded between **1 hour** and **4 days (96 hours)**.

#### 5.3 Candidate Exclusion & Transparent Failover

1. The locked model is stored with an explicit expiration epoch timestamp in persistent client storage.
2. On subsequent requests, the candidate selector filters out any locked models:
   ```typescript
   const availableCandidates = allCandidates.filter(candidate => {
     const lock = getModelLock(candidate.provider, candidate.model);
     return !lock || lock.expiresAt <= Date.now();
   });
   ```
3. Selection proceeds using priority tiering:
   - **Tier 1**: Untested probes or fast models ($<15$s average latency)
   - **Tier 2**: Medium-speed models ($15$s to $25$s average latency)
   - **Tier 3**: Demoted slow models ($>25$s average latency)
4. **Anti-Deadlock Lockout Reset**: If widespread network outages cause every candidate across all providers to become locked, the engine detects that `availableCandidates.length === 0`, purges all active locks, logs a diagnostic warning, and restores candidate availability to prevent permanent application starvation.

---

### 6. Deep-Dive: Tier 3 – Error Presentation & Automated Countdown Retry

When an unrecoverable error reaches the presentation layer, the user-facing retry lifecycle takes over.

```
                  [ LLM Call Fails in Application Layer ]
                                  │
                                  ▼
                [ Trigger Error Presentation State ]
             • Dismiss active progress indicator
             • Register retry action callback in memory
             • Mount error notification banner
                                  │
                                  ▼
                  [ Countdown Timer Initialized ]
                  • Starts 5-second countdown ticker (1s interval)
                  • Displays visual status & automated switch note
                                  │
                 ┌────────────────┴────────────────┐
                 │                                 │
          (User clicks "Cancel")           (Seconds reach 0s or
                 │                          User clicks "Try again now")
                 ▼                                 │
      [ Countdown Cancelled ]                      ▼
      • Clear interval timer               [ Execute Retry Dispatch ]
      • Switch to on-demand                • Clear interval timer
        manual trigger                     • Set retrying indicator
                                           • Invoke registered callback
                                                   │
                                                   ▼
                                     [ Re-Execute with Auto-Failover ]
                                     • Dismiss error banner
                                     • Execute original request action
                                     • Auto-router targets next operational model
```

#### 6.1 Automated Countdown Specifications

1. **Initial Countdown State**: The error notification mounts with an initial duration of **5 seconds** and a 1-second interval ticker.
2. **Visual Feedback**:
   - Displays a pulsing status beacon indicating an active countdown.
   - Shows live remaining seconds: `"Retrying automatically in 5s..."`, decrementing every second.
   - Displays diagnostic context indicating that auto-routing will switch to a different operational model.
3. **User Action Options**:
   - **"Try again now" (Immediate Manual Bypass)**: Instantly halts the countdown timer and dispatches the retry immediately.
   - **"Cancel" (Manual Mode Override)**: Halts the countdown timer, marks the countdown as cancelled, and replaces the timer with a stationary `"Retry"` trigger for manual re-execution at the user's convenience.

#### 6.2 Clean Re-Execution & History Sanitization

When retry triggers (either automatically when reaching 0s or manually via button press):
1. The error message/banner is removed from the active view.
2. The pending retry callback closure is retrieved and executed.
3. Because the failing model was already locked in Tier 2, the auto-router automatically selects the next healthy model.
4. The progress indicator reappears showing the new model's name and its specific expected response time, providing a seamless recovery experience.

---

### 7. Edge Cases & Safety Mechanisms

| Scenario | Risk | System Mitigation |
| :--- | :--- | :--- |
| **User Abort / Cancel** | Dangling network requests and orphan token consumption. | Clicking the abort trigger on the progress indicator signals the `AbortController`. The catch handler verifies `signal.aborted`, cancels without locking the model, and cleanly dismisses all indicators without showing error alerts. |
| **Generation Exceeds $T_{\text{expected}}$** | Progress bar reaches 100% or remaining seconds drop below zero. | Progress percentage is strictly clamped to $\min(99, \dots)$. Remaining seconds are clamped to $\max(0, \dots)$. When elapsed time exceeds expected duration, the label shifts to `"Just a moment..."`. |
| **Corrupted / Truncated JSON Output** | Model outputs incomplete markdown formatting or broken JSON. | Multi-stage regex sanitization parses and repairs JSON syntax. If unrecoverable, an invalid response error is raised, triggering Tier 1 retry and Tier 2 circuit breaker lock. |
| **Upstream Schema Rejection (HTTP 400)** | Provider rejects structured output format or reasoning flags. | Protocol self-healing intercepts 400 status codes, strips advanced formatting flags, and re-executes immediately. |
| **Cascading Multi-Provider Outage** | Every registered model across all providers becomes locked. | The candidate selector detects an empty available pool, triggers an automatic anti-deadlock reset, clears all locks, and restores the candidate roster. |
| **Geo-Location IP Blocking (HTTP 400)** | Request rejected due to geographic IP restrictions. | Classified as non-retryable; skips retry cycles and surfaces explicit network proxy configuration instructions to the user. |

---

### 8. Architectural Checklist for Implementation

When integrating this architecture into an AI application or service, ensure the following core capabilities are in place:

- [ ] **Decoupled Pre-Flight Event Bus**: Emit a request start event prior to network dispatch containing provider, model, and timestamp.
- [ ] **Historical Metric Store**: Track rolling averages ($K \ge 50$) and single-run latencies for each operational model.
- [ ] **Clamped Progress Math**: Implement $P(t) = \min(99, (t / T) \times 100)$ with a soft overtime label (`"Just a moment..."`).
- [ ] **Cancellation Integration**: Provide an accessible abort button connected directly to an `AbortController`.
- [ ] **Transport-Level Retry**: Implement exponential backoff with jitter for HTTP 429 and 5xx errors; strip unsupported schema parameters on HTTP 400.
- [ ] **Adaptive Circuit Breaker**: Calculate dynamic lock durations (1h to 96h) based on consecutive failures, recency decay, and historical latency.
- [ ] **Anti-Deadlock Fallback**: Automatically purge active locks if all available candidates become exhausted.
- [ ] **User-Facing Countdown Banner**: Display a 5-second countdown timer with instant bypass ("Try again now") and cancel controls.
- [ ] **Transparent Failover**: Ensure retries re-route through the model selector to pick the next healthy candidate.
