# Intelligent Multi-Provider Auto-Routing & Resilience Engine
## System Architecture & Technical Whitepaper

---

### Executive Summary

Modern AI applications face significant availability, latency, and cost hurdles when relying on single-provider LLM infrastructure. API rate limits (HTTP 429), regional outages (HTTP 500/503), cold-start latency variations, and token constraints demand an adaptive, self-healing routing architecture.

The **Intelligent Multi-Provider Auto-Routing & Resilience Engine** provides a decentralized, multi-tiered LLM routing and fault-recovery system. It combines dynamic health tracking, sample-efficient probe graduation, $\epsilon$-greedy exploratory sampling, and a multi-factor adaptive circuit breaker with continuous recency decay.

---

### 1. Architectural Overview

```
                          ┌──────────────────────────┐
                          │   Incoming LLM Request   │
                          └─────────────┬────────────┘
                                        │
                         [ Is Auto Mode Enabled? ]
                                 │             │
                             (No)│             │(Yes)
                                 ▼             ▼
                       ┌──────────────┐   ┌─────────────────────────────┐
                       │ Direct Model │   │ Dynamic Auto-Routing Engine │
                       │  Execution   │   │  (Performance Tiering Queue)│
                       └──────────────┘   └──────────────┬──────────────┘
                                                         │
               ┌─────────────────────────────────────────┼─────────────────────────────────────────┐
               ▼                                         ▼                                         ▼
   ┌───────────────────────┐                 ┌───────────────────────┐                 ┌───────────────────────┐
   │  Tier 1: Probes &     │                 │   Tier 2: Medium      │                 │    Tier 4: Slow /     │
   │  High-Speed Priority  │                 │    (15s – 25s)        │                 │    Demoted (>25s)     │
   │  (0s – 15s / 0-succ)  │                 └───────────────────────┘                 └───────────────────────┘
   └───────────┬───────────┘
               │
    [ Execute Request ] ──(Success: 200 OK)──► [ Record Latency (Rolling Avg) + Graduate Probe ]
               │
          (Failure: 429 / 500 / 503 / Timeout)
               │
               ▼
    [ Adaptive Circuit Breaker Calculation ] ──► [ Apply Clamped Lockout (1h – 48h) & Fallback Cascade ]
```

---

### 2. Multi-Tier Performance Classification

The engine categorizes available models across all configured providers (Google Gemini, OpenRouter, Ollama, Cloudflare Workers AI, Groq, 9Flare, Cohere, DeepSeek, etc.) into structured operational tiers based on verified response latency and health status:

| Tier | Category | Criteria | Routing Priority |
| :--- | :--- | :--- | :--- |
| **Tier 1 (Probe/New)** | Untested Probe Queue | Total successes $= 0$ or no baseline metric | **Highest Priority** (Sampled immediately via fair round-robin) |
| **Tier 1 (Fast)** | High-Speed Active | Average response time $< 15.0\text{s}$ | **Primary Rotation** (Even round-robin distribution) |
| **Tier 2 (Medium)** | Secondary Fallback | Average response time between $15.0\text{s} - 25.0\text{s}$ | **Secondary** (Used if Tier 1 exhausted or during exploratory cycles) |
| **Tier 4 (Slow/Offline)** | Demoted / Cooldown | Average response time $> 25.0\text{s}$ or active lock | **Tertiary / Fallback Only** |

---

### 3. Probe Lifecycle & Cold-Start Balancing

To prevent newly introduced models from being starved while avoiding "thundering herd" bottlenecks, the engine implements a **Sample-Efficient Probe & Graduation Lifecycle**:

1. **Immediate Discovery**: When a new model is configured or added to a provider, it enters the **Tier 1 Probe Queue** (`isUntested = true`).
2. **Fair Round-Robin Probing**: Unsampled models are probed in sequence without monopolizing traffic.
3. **Single-Sample Graduation**: Upon completing **1 successful request**, the model is confirmed operational, receives its initial benchmark latency, and **immediately graduates** to the standard Tier 1 round-robin pool.
4. **Equal Workload Distribution**: All tested Tier 1 models rotate with equal probability, eliminating call-count disparity and preserving provider rate limits.

---

### 4. Continuous Exploration Sampling ($\epsilon$-Greedy)

To ensure that models demoted due to temporary network congestion or warm-up delays can regain Tier 1 status:

- Every **12th request** (`cycleCount % 12 === 0`), the engine triggers an **Exploratory Probe**.
- If Tier 2 or Tier 4 candidates exist, one candidate is selected for execution.
- If the model achieves a sub-15-second response time, its rolling benchmark updates and it is automatically promoted back into **Tier 1**.

---

### 5. Adaptive Circuit Breaker & Fault Recovery

When a model encounters a transient or fatal failure (HTTP 429 rate limit, 500/503 server outage, or timeout), the engine invokes `calculateOptimalLockDuration` to apply a dynamic, multi-factor cooldown lockout. If a model experiences a consecutive series of failed requests, the lock duration extends progressively up to several days (capped at 4 days / 96 hours, strictly less than 5 days).

```
                  [ Model Request Fails (429 / 500 / 503 / Timeout) ]
                                           │
                                           ▼
                    [ Analyze Consecutive Failures & 5-Day History ]
                                           │
                                           ▼
             ┌───────────────────────────────────────────────────────────┐
             │       Calculate Dynamic Lock Duration Formulation         │
             │                                                           │
             │   1. Consecutive Failure Base Duration:                   │
             │      • 1 Failure: 1h                                      │
             │      • 2 Failures: 4h                                     │
             │      • 3 Failures: 24h (1 day)                            │
             │      • 4 Failures: 54h (2.25 days)                        │
             │      • 5 Failures: 78h (3.25 days)                        │
             │      • 6+ Failures: 96h (4 days - less than 5 days)       │
             │   2. Recency Decay Penalty: Sum of (1 - age/120h)^1.4     │
             │   3. Historical Reliability Multiplier: 0.5x to 2.0x      │
             │   4. Latency Penalty Multiplier: Up to 3.0x (>15s)        │
             └─────────────────────────────┬─────────────────────────────┘
                                           │
                                           ▼
                          [ Apply Boundary Clamping ]
                          • Minimum Cooldown: 1 Hour
                          • Maximum Cooldown: 4 Days (96 Hours)
                                           │
                                           ▼
                      [ Lock Model & Cascade to Fallback ]
```

#### 5.1 Mathematical Formulation

$$\text{LockDuration} = \text{Clamp}\Big(\big(\text{BaseConsecutiveDuration} + \text{AccumulatedPenalty}\big) \times M_{\text{Reliability}} \times M_{\text{Latency}}, \; 1\text{h}, \; 96\text{h}\Big)$$

Where:

1. **Consecutive Failure Base Cooldown ($\text{BaseConsecutiveDuration}$)**:
   $$\text{BaseConsecutiveDuration} = \begin{cases}
   1\text{ Hour } (3,600,000\text{ ms}) & \text{for } C = 1 \\
   4\text{ Hours } (14,400,000\text{ ms}) & \text{for } C = 2 \\
   24\text{ Hours } (86,400,000\text{ ms} / 1\text{ day}) & \text{for } C = 3 \\
   54\text{ Hours } (194,400,000\text{ ms} / 2.25\text{ days}) & \text{for } C = 4 \\
   78\text{ Hours } (280,800,000\text{ ms} / 3.25\text{ days}) & \text{for } C = 5 \\
   96\text{ Hours } (345,600,000\text{ ms} / 4\text{ days}) & \text{for } C \ge 6
   \end{cases}$$
   *(where $C$ is the count of consecutive failed requests).*

2. **120-Hour (5-Day) Recency Power-Decay Penalty**:
   $$\text{AccumulatedPenalty} = 1\text{h} \times \sum_{i=1}^{N} \max\left(0.05, \left(1 - \frac{\text{Age}_i}{120\text{ hours}}\right)^{1.4}\right)$$
   *Recent repeated failures contribute strong additional lockout time, while older failures from days prior decay progressively.*

3. **Historical Reliability Multiplier ($M_{\text{Reliability}}$)** (for total calls $\ge 3$):
   $$M_{\text{Reliability}} = \begin{cases} 
   0.5 & \text{if Success Rate } \ge 90\% \text{ and } C \le 1 \quad \text{(Reliability Discount)} \\
   2.0 & \text{if Success Rate } < 50\% \quad \text{(Severe Instability Penalty)} \\
   1.5 & \text{if Success Rate } < 75\% \quad \text{(Moderate Instability Penalty)} \\
   1.0 & \text{otherwise}
   \end{cases}$$

4. **Latency Penalty Multiplier ($M_{\text{Latency}}$)**:
   $$M_{\text{Latency}} = \begin{cases}
   \min\left(3.0, \; 1.0 + \frac{\text{AvgLatencyMs} - 15000}{10000}\right) & \text{if AvgLatencyMs } > 15,000\text{ ms} \\
   1.0 & \text{otherwise}
   \end{cases}$$

---

### 6. Resilience & Graceful Fallback Cascades

If an active model fails mid-request:
1. The failing model is locked immediately according to the dynamic circuit breaker duration.
2. The orchestrator transparently re-routes the payload to the next highest-ranking candidate in Tier 1.
3. If Tier 1 candidates are exhausted, execution cascades cleanly to Tier 2 and Tier 4 candidates before surfacing any user-facing errors.
4. Users can manually inspect individual model health, rolling latencies, and success metrics or invoke a full state reset at any time via the **Model Status Dashboard**.

---

### 7. Key Operational Benefits

- **Zero-Config Onboarding**: New models automatically receive immediate, safe validation without manual benchmarking.
- **Anti-Thundering Herd Protection**: Eliminates single-model traffic saturation by enforcing strict round-robin rotation post-graduation.
- **Self-Healing Infrastructure**: Dynamic power-decay locks ensure healthy models return quickly (30m–1h) while persistently unstable providers are locked out for a few days (up to 4 days / 96h, < 5 days).
- **Sub-Second Failover**: Instant fallback ensures uninterrupted user experience across distributed multi-cloud endpoints.
