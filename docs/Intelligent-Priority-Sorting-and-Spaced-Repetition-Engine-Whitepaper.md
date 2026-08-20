# Intelligent Priority Sorting & Spaced Repetition Engine
## System Architecture, Mathematical Formulation & Backlog Resilience Technical Whitepaper

---

### Executive Summary

In algorithmic language learning and spaced repetition systems (SRS), user hiatuses (such as skipping practice for several days or weeks) inevitably cause massive review backlogs. Traditional SRS algorithms (e.g., standard Leitner or rigid SuperMemo SM-2 variants) present all overdue items simultaneously in a flat, unranked queue. For a learner returning to hundreds of overdue items, this creates acute cognitive overload, demotivation, and high abandonment rates.

The **Intelligent Priority Sorting & Spaced Repetition Engine** addresses this fundamental usability failure. It combines:
1. **Dynamic Memory Decay Modeling**: Continuous $-10\%\text{/day}$ baseline degradation with automatic status demotion.
2. **Multi-Tier Priority Classification**: Stratified partitioning into Starred (Weight: 5), Memory Decay (Weight: 4), Weak (Weight: 3), and Standard Retention (Weight: 1) tiers.
3. **A-Res Weighted Reservoir Sampling**: Order-statistic based stochastic sampling ($k_i = u_i^{1/w_i}$) for bias-free, high-impact review batching.
4. **Adaptive Interval Re-Spreading**: Remedial error throttling (4–12h) and exponential streak expansion ($1\text{d} \to 2\text{d} \to 4\text{d} \to 7\text{d} \to 14\text{d} \to 30\text{d}$) that naturally redistributes backlogs across subsequent days.

---

### 1. System Architecture & Queue Pipeline

```
                                  ┌───────────────────────────┐
                                  │   Learner Word Database   │
                                  │  (Vocabulary & History)   │
                                  └─────────────┬─────────────┘
                                                │
                                                ▼
                         ┌─────────────────────────────────────────────┐
                         │      Continuous Memory Decay Evaluator      │
                         │   ΔK = -10 pts/day elapsed from baseline    │
                         └──────────────────────┬──────────────────────┘
                                                │
                                                ▼
                         ┌─────────────────────────────────────────────┐
                         │   Spaced Repetition Eligibility Filter      │
                         │      (now >= target nextReviewDate)         │
                         └──────────────────────┬──────────────────────┘
                                                │
                ┌───────────────────────────────┼───────────────────────────────┐
                ▼                               ▼                               ▼
    ┌───────────────────────┐       ┌───────────────────────┐       ┌───────────────────────┐
    │    Tier 1: Starred    │       │ Tier 2: Memory Decay  │       │     Tier 3: Weak      │
    │      (Weight = 5)     │       │     (Weight = 4)      │       │     (Weight = 3)      │
    └───────────┬───────────┘       └───────────┬───────────┘       └───────────┬───────────┘
                │                               │                               │
                └───────────────────────┬───────┴───────────────────────────────┘
                                        │ (Plus Tier 4: Standard Retention, Weight = 1)
                                        ▼
                         ┌─────────────────────────────────────────────┐
                         │      Candidate Pool Assembly (Pool ≤ 30)    │
                         └──────────────────────┬──────────────────────┘
                                                │
                                                ▼
                         ┌─────────────────────────────────────────────┐
                         │     A-Res Weighted Reservoir Sampling       │
                         │         Key: k_i = (u_i)^(1 / w_i)          │
                         └──────────────────────┬──────────────────────┘
                                                │
                                                ▼
                         ┌─────────────────────────────────────────────┐
                         │  Capped Active Practice Batch (10–20 Words) │
                         │    (Flashcards / Interactive Quizzes)       │
                         └──────────────────────┬──────────────────────┘
                                                │
                        ┌───────────────────────┴───────────────────────┐
                        │                                               │
             (Correct Response)                               (Incorrect Response)
                        │                                               │
                        ▼                                               ▼
         [ Advance Streak (n + 1) ]                      [ Reset Streak (n = 0) ]
         [ Expand Interval: 24h – 720h ]                 [ Remedial Clamping: 4h – 12h ]
         [ Schedule to Future Days ]                     [ Prioritize for Next Session ]
```

---

### 2. Spaced Repetition Interval Formulation

The engine dynamically calculates the next review interval $I$ (in hours) as a function of the user's consecutive success streak, current bounded memory strength, recent quiz accuracy, and user priority markers.

#### 2.1 Streak-to-Base-Interval Mapping

Let $S$ denote the number of consecutive successful reviews recorded in the word's strength history without an intervening error:

$$
I_{\text{base}}(S) = 
\begin{cases} 
12\text{ hours} & \text{if } S = 0 \text{ and } K < 50 \\
18\text{ hours} & \text{if } S = 0 \text{ and } K \ge 50 \\
24\text{ hours (1 day)} & \text{if } S = 1 \\
48\text{ hours (2 days)} & \text{if } S = 2 \\
96\text{ hours (4 days)} & \text{if } S = 3 \\
168\text{ hours (7 days)} & \text{if } S = 4 \\
336\text{ hours (14 days)} & \text{if } S = 5 \\
\min\left(720, \text{round}\left(336 \cdot 1.5^{S - 5}\right)\right) & \text{if } S \ge 6 
\end{cases}
$$

Where $K \in [0, 100]$ represents current memory strength.

#### 2.2 Memory Strength Modulation Multiplier

Firmly consolidated memories retain stability longer than nascent memories. The strength scaling factor $M(K)$ smoothly scales the base interval:

$$
M(K) = \text{clamp}\left(0.6 + 0.7 \cdot \frac{K}{100}, \, [0.6, \, 1.3]\right)
$$

- At $K = 0\%$, $M(K) = 0.6$ (shortens review interval by $40\%$).
- At $K = 100\%$, $M(K) = 1.3$ (expands review interval by $+30\%$).

#### 2.3 Priority & Remedial Modifiers

1. **User Starred Modifier ($P_{\text{star}}$):** If a word is starred/pinned by the user, its review interval is shortened by $25\%$ ($P_{\text{star}} = 0.75$) to increase study frequency. Otherwise, $P_{\text{star}} = 1.0$.
2. **Remedial Error Clamping:** If the most recent active event was a quiz failure (`quiz_incorrect`), normal streak expansion is bypassed in favor of urgent remediation:
   $$
   I_{\text{remedial}} = 
   \begin{cases} 
   4\text{ hours} & \text{if } K < 30 \\
   8\text{ hours} & \text{if } 30 \le K < 60 \\
   12\text{ hours} & \text{if } K \ge 60 
   \end{cases}
   $$

#### 2.4 Final Interval Bounds

The final scheduled interval $I_{\text{final}}$ is clamped within strict operational bounds:

$$
I_{\text{final}} = \text{clamp}\left(\text{round}\left(I_{\text{base}}(S) \cdot M(K) \cdot P_{\text{star}}\right), \, [4\text{h}, \, 720\text{h}]\right)
$$

The target timestamp is computed as:

$$
T_{\text{next}} = T_{\text{baseline}} + I_{\text{final}} \cdot 3600\text{ seconds}
$$

---

### 3. Continuous Memory Decay Engine

To accurately simulate the Ebbinghaus forgetting curve without incurring heavy server cron jobs, the engine evaluates memory decay on demand using relative time deltas from the last verified active practice baseline $T_{\text{practice}}$.

#### 3.1 Decay Formulation

Let $\Delta t_{\text{days}} = \left\lfloor \frac{t_{\text{now}} - T_{\text{practice}}}{86400} \right\rfloor$.

For any word whose practice baseline was mastered ($K_{\text{baseline}} \ge 80$ or $\text{learned} = \text{true}$):

$$
K(t) = \max\left(0, \, K_{\text{baseline}} - 10 \cdot \Delta t_{\text{days}}\right)
$$

$$
\text{Learned Status} = 
\begin{cases} 
\text{true} & \text{if } K(t) \ge 80 \\
\text{false (Demoted)} & \text{if } K(t) < 80 
\end{cases}
$$

#### 3.2 Idempotent History Auditing

When a decay event is detected:
- A deterministic entry ID is generated: `hist-decay-{wordId}-{baselineTimestamp}-{daysElapsed}`.
- This prevents duplicate decay records if the application reloads multiple times within the same day.
- A descriptive audit note is stored: `Memory decayed by -{decayAmount}% ({days} days since last practice at -10%/day)`.

---

### 4. Multi-Tier Priority Classification Matrix

When selecting candidate vocabulary for practice sessions, eligible due words are partitioned into four priority tiers:

| Tier | Category | Identification Criteria | Weight ($w_i$) | Relative Probability |
| :--- | :--- | :--- | :--- | :--- |
| **Tier 1** | **Starred / Focus** | `word.starred === true` | **5** | **Highest Priority** (Surfaced immediately) |
| **Tier 2** | **Memory Decay** | `word.learned === true` and ($\Delta t_{\text{days}} \ge 5$ or $K < 80$) | **4** | **Urgent Retention** (Prevents total forgetting) |
| **Tier 3** | **Weak Vocabulary** | Current memory strength $K < 50$ | **3** | **Remedial Practice** (Consolidates fragile items) |
| **Tier 4** | **Standard Retention** | All remaining eligible due words | **1** | **Maintenance** (Scheduled maintenance review) |

---

### 5. A-Res Weighted Reservoir Sampling Algorithm

To select a representative, non-repeating practice batch of size $k$ (e.g., $k = 10$ or $20$) from a candidate pool of size $N$ without starvation, the engine uses the **A-Res Algorithm (Algorithm by Efraimidis and Spirakis)** for weighted random sampling without replacement.

#### 5.1 Algorithm Steps

For each item $i$ in the candidate pool with weight $w_i$:
1. Generate an independent standard uniform random variable:
   $$
   u_i \sim U(0, 1)
   $$
2. Compute the stochastic ranking key $k_i$:
   $$
   k_i = u_i^{1 / w_i}
   $$
3. Sort all candidates in descending order of their generated keys $k_i$:
   $$
   \text{Ranked List} = \text{SortByDescending}(\{ (i, k_i) \})
   $$
4. Extract the top $k$ items:
   $$
   \text{Selection} = \text{Ranked List}[0 \dots k-1]
   $$

#### 5.2 Mathematical Properties & Advantages

1. **Exact Invariant**: The probability of item $i$ being selected first is strictly proportional to its weight:
   $$
   P(i \text{ selected 1st}) = \frac{w_i}{\sum_{j} w_j}
   $$
2. **Sampling Without Replacement**: Prevents duplicate word questions within the same quiz session.
3. **Anti-Starvation Variety**: Because $u_i \in (0, 1)$, low-weight items (Tier 4) still possess a non-zero probability of selection, ensuring that standard retention words are never permanently blocked by weak words.
4. **Computational Efficiency**: Operates in $O(N \log N)$ time and $O(N)$ space, executing in under 2 milliseconds on standard client devices.

---

### 6. Backlog Recovery & Cognitive Load Management

When a user returns after an extended break (e.g., 7 days with a 320+ word backlog), the engine prevents study paralysis through **session bounding and natural re-spreading**:

```
                       [ 320+ Words Due After 7-Day Break ]
                                         │
                                         ▼
            [ User Launches Quick 15-Word Session (5 minutes) ]
                                         │
                                         ▼
            [ A-Res Selects 15 Most Critical Items (Tiers 1 & 2) ]
                                         │
                                         ▼
               ┌─────────────────────────┴─────────────────────────┐
               │                                                   │
    (13 Correct Answers)                                  (2 Incorrect Answers)
               │                                                   │
               ▼                                                   ▼
  [ Advanced: +2d, +4d, +7d ]                             [ Remedial: 4h – 12h ]
  [ Dispersed to Aug 22, 24, 27 ]                         [ Queued for next batch ]
               │                                                   │
               └─────────────────────────┬─────────────────────────┘
                                         │
                                         ▼
             [ Remaining Backlog Smoothly Cleared Over 3–4 Days ]
```

- **Session Bounding:** Quizzes and flashcards enforce configurable caps (10, 20, or 30 words), insulating the user from the aggregate backlog volume.
- **Dynamic Re-Spreading:** As each 15-word batch is practiced, correct items are immediately pushed into future intervals ($+2\text{d}, +4\text{d}, +7\text{d}, +14\text{d}$), decomposing the single large bottleneck into a balanced, multi-day schedule.
- **Zero Manual Rescheduling:** The learner does not need to manually configure "vacation modes" or re-sort spreadsheets; the system self-heals in real time.

---

### 7. Performance & Algorithmic Complexity

| Operation | Implementation | Time Complexity | Space Complexity |
| :--- | :--- | :--- | :--- |
| **Decay Recalculation** | Array Map + History Timestamp Delta | $O(N)$ | $O(N)$ |
| **Eligibility Filtering** | Date Comparison vs. $T_{\text{next}}$ | $O(N)$ | $O(N)$ |
| **Tier Classification** | Single-pass Partitioning | $O(N)$ | $O(N)$ |
| **A-Res Stochastic Sampling** | Random Key Generation + Array Sort | $O(M \log M)$ ($M \le 30$) | $O(M)$ |
| **Interval Recomputation** | History Trace + Streak Accumulation | $O(H)$ ($H \le 50$ per word) | $O(1)$ |

*All algorithms execute entirely client-side in sub-frame time ($< 5\text{ms}$), ensuring zero latency across mobile and desktop environments.*
