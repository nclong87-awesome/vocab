# Translation Challenge Feature: Comprehensive Specification & Clone Guide

> **Core Language Pair**:
> - **Native Language**: Vietnamese (`vi` / Tiếng Việt)
> - **Target Language**: English (`en` / Tiếng Anh)
>
> **Core Strategy: Mobile-First & Keep It Simple**:
> - **Mobile-First Priority**: Language learners primarily practice on smartphones in short, focused bursts. Start by implementing a clean, vertical single-column mobile layout (360px–430px viewport) with touch-friendly controls (≥ 44px tap targets), sticky thumb-level action buttons, and soft-keyboard-resilient containers before considering desktop expansion.
> - **Simplicity First**: Do not build complex sidebars, nested modal dialogs, or heavy multi-page routers. All interactions (prompt, hints, input, evaluation, vocab reward) fit cleanly within a single mobile card/screen stream.
> - **Vocabulary Collection & 24-Hour Recency Rule**: Users can add individual words or phrases to their personal collection. When generating a challenge, the system prioritizes words/phrases whose last appearance was **more than 1 day ago** (>24 hours). If no collection words satisfy this condition (or if the collection is empty), the system seamlessly falls back to common words and phrases used in daily English conversation.
> - **No Hardcoded Topics or Contexts (100% Free Context Selection)**: There are **NO hardcoded topics, predefined category dropdowns, or static contextual taxonomies**. The LLM model has **100% complete freedom to pick any realistic context** (e.g., borrowing a charger, negotiating deadlines, running into an old classmate, ordering coffee, commuting delays, grocery shopping, household chores). Within that freely chosen context, the LLM must choose **common, natural conversational sentences** that native speakers actually say in everyday life.
>
> This specification is written with **Vietnamese as the native language** and **English as the target language**. Learners are presented with natural, everyday conversational Vietnamese sentences and challenged to produce accurate, idiomatic English translations that incorporate priority vocabulary from their personal collection. All prompt templates, evaluation heuristics, mock responses, and UI strings in this guide reflect this Vietnamese-to-English setup.

This specification provides everything required to clone the **Translation Challenge** feature from this application into another web or mobile app. It includes architecture diagrams, TypeScript schemas, complete mock LLM responses, evaluation rubrics, prompt engineering templates, state/SRS integration logic, a complete drop-in mobile React component, and a standalone mock service to enable immediate plug-and-play development without API keys.

---

## 1. Feature Overview & Architecture

### What is the Translation Challenge?
The **Translation Challenge** is an AI-powered interactive language acquisition feature that prompts learners to translate natural, conversational sentences from their native language into a target language, specifically engineered to reinforce vocabulary and phrases from their personal collection.

Unlike generic quiz engines:
1. **Curated Words & Phrases with 24-Hour Recency**: Users can save single words (e.g., `resilience`, `setback`) or multi-word phrases/idioms (e.g., `adapt to`, `keep an eye on`) to their collection. The candidate picker prioritizes items that haven't appeared for **more than 1 day** (>24 hours).
2. **Daily Conversation Fallback**: If no saved words/phrases meet the >24-hour threshold (or if the user's collection is brand new/empty), the system does not fail or block practice—it automatically generates challenges centered on natural, high-frequency words and idioms used in daily conversation.
3. **Zero Hardcoded Topics & 100% Free Context Selection**: The system has **no predefined topic lists, category dropdowns, or static themes**. The LLM model is **100% free to imagine any authentic daily life context** (e.g., catching up with a coworker, asking for directions, negotiating rent, scheduling a haircut, chatting at dinner). Within that context, the model selects **common, realistic sentences** that native speakers frequently utter in everyday life.
4. **Native-First Conversational Naturalness**: Prompts are generated directly in natural native Vietnamese prose (not translated backward from textbook English), avoiding robotic machine-translation phrasing.
5. **Multi-Turn Resilience & Direct LLM Evaluation**:
   - Detects accidental/incomplete submissions (e.g., pressed Enter prematurely).
   - Handles empty submissions / "Reveal Answer & Skip" gracefully.
   - **Direct LLM Evaluation (No Programmatic Validation Gates)**: Relies directly on the LLM's authoritative assessment for `incorporatedTargetWord` and `incorporatedVocabClues`. Programmatic regex gates (`hasUserIncorporatedWord`) are avoided because rigid string matching creates false negatives on valid inflections (past tense, gerunds, plurals), adverbs (e.g. `-ly`), phrasal verb separations, and hyphen/space compound variations (e.g. `cost-effective` vs `cost effective`).
   - Pairs direct LLM evaluation with strict, comprehensive prompt engineering to ensure reliable, hallucination-free evaluation.
6. **Memory Strength Augmentation**: Awards SRS point bonuses (+30 points for incorporating target word, +10 for exposure, +30 for using vocabulary clues), stamps `lastAppearedAt = new Date().toISOString()`, and atomically updates the collection.
7. **Interactive Tutoring**: Includes an "Ask AI about this question" modal for contextual follow-up questions.

### Architecture Flowchart

```
┌────────────────────────────────────────────────────────────────────────┐
│ 1. CANDIDATE SELECTION & DYNAMIC CONTEXT GENERATION                    │
│                                                                        │
│   User Collection (Words & Phrases)                                    │
│                 │                                                      │
│                 ▼                                                      │
│   Check: Last appeared > 1 day ago?                                    │
│         ├── YES ──► Pick oldest & lowest-strength collection items     │
│         └── NO / EMPTY ──► Fallback: High-Frequency Daily Vocab/Phrases│
│                                           │                            │
│                                           ▼                            │
│   LLM Prompt Builder (Zero Hardcoded Topics / 100% Free Context)       │
│          │                                                             │
│          ▼                                                             │
│   LLM Generates: Free Context + Common Everyday Native Sentence        │
│          │                                                             │
│          ▼                                                             │
│   JSON Sanitizer & Loanword Cleaner                                    │
│          │                                                             │
│          ▼                                                             │
│   Active Challenge State ◄──── Mobile Challenge Card (Prompt UI)       │
└────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼ User Types Translation
┌────────────────────────────────────────────────────────────────────────┐
│ 2. EVALUATION & CORRECTION PHASE                                       │
│                                                                        │
│   Incomplete Check? ──── Yes ──► "Draft Detected" Repopulate Prompt    │
│          │ No                                                          │
│          ▼                                                             │
│   LLM Evaluation (or Mock) ──► Score (0-100), Verdict, Praise, Tips   │
│          │                                                             │
│          ▼                                                             │
│   Direct LLM Evaluation ──► incorporatedTargetWord & Vocab Clues       │
│                             (No Programmatic Regex Validation Gates)   │
│          │                                                             │
│          ▼                                                             │
│   SRS Augmentation (+30/+10) ──► Update strength & lastAppearedAt      │
│          │                                                             │
│          ▼                                                             │
│   Evaluation Card (Feedback UI) ──► Audio TTS / Add New Vocab / Ask AI │
└────────────────────────────────────────────────────────────────────────┘
```

### 1.1 Candidate Selection Logic (1-Day Threshold & Daily Conversation Fallback)

Learners can freely add individual words (e.g., `"resilience"`) or multi-word phrases (e.g., `"take into account"`, `"keep in touch"`) to their personal vocabulary collection.

> **Zero Topic/Context Pre-filtering**: Candidate selection only filters by the **1-day recency threshold** and sorts by appearance/strength. It **never filters or restricts candidates by topic or theme**. The LLM model is given 100% autonomy to decide which context best suits the chosen candidate, picking common conversational sentences that naturally fit that context.

When a new challenge is triggered, the system selects candidate words/phrases using a 2-tier priority rule:

```
                  ┌─────────────────────────────────────────┐
                  │ Learner's Vocabulary & Phrase Collection │
                  └────────────────────┬────────────────────┘
                                       │
                                       ▼
                  ┌─────────────────────────────────────────┐
                  │ Filter: (Now - lastAppearedAt) > 1 Day? │
                  └────────────────────┬────────────────────┘
                                       │
                    ┌──────────────────┴──────────────────┐
                 YES (≥ 1 Candidate)                   NO (0 Candidates)
                    │                                     │
                    ▼                                     ▼
        ┌───────────────────────┐            ┌───────────────────────────┐
        │ Priority Collection   │            │ Daily Conversation        │
        │ Candidates            │            │ Fallback Candidates       │
        │ - Sort: Oldest        │            │ - High-frequency everyday │
        │   appearance first    │            │   English words & phrases │
        │ - Secondary: Lowest   │            │   (e.g., ordering food,   │
        │   strength first      │            │   small talk, directions) │
        └───────────────────────┘            └───────────────────────────┘
```

#### TypeScript Implementation: Candidate Selector Function
```typescript
export interface UserVocabItem {
  id: string;
  word: string; // Word or phrase (e.g., "resilience", "adapt to", "break the ice")
  translation: string;
  definition?: string;
  partOfSpeech?: string;
  strength: number; // 0 - 100
  lastAppearedAt?: string; // ISO 8601 string of last quiz/challenge exposure
  addedAt: string;
}

// Fallback pool of common daily conversational words and phrases
export const DAILY_CONVERSATION_FALLBACK_POOL: Array<Omit<UserVocabItem, "id" | "addedAt">> = [
  { word: "catch up with", translation: "gặp gỡ trò chuyện sau thời gian dài", partOfSpeech: "phrase", strength: 0 },
  { word: "run out of", translation: "hết, cạn kiệt (tiền, pin, thời gian)", partOfSpeech: "phrase", strength: 0 },
  { word: "make an appointment", translation: "hẹn lịch, đặt hẹn", partOfSpeech: "phrase", strength: 0 },
  { word: "grab a bite", translation: "đi ăn nhanh một bữa", partOfSpeech: "phrase", strength: 0 },
  { word: "keep an eye on", translation: "để mắt tới, trông coi giúp", partOfSpeech: "phrase", strength: 0 },
  { word: "convenient", translation: "tiện lợi, thuận tiện", partOfSpeech: "adjective", strength: 0 },
  { word: "postpone", translation: "trì hoãn, dời lịch", partOfSpeech: "verb", strength: 0 },
  { word: "recommendation", translation: "sự giới thiệu, lời khuyên nên thử", partOfSpeech: "noun", strength: 0 },
];

const ONE_DAY_MS = 24 * 60 * 60 * 1000; // 86,400,000 ms (1 day)

export function selectChallengeCandidates(
  collection: UserVocabItem[],
  maxCandidates = 6,
  nowMs = Date.now()
): {
  candidates: UserVocabItem[];
  isDailyConversationFallback: boolean;
} {
  // 1. Filter: Words/phrases never appeared OR last appeared more than 1 day ago
  const eligibleFromCollection = collection.filter((item) => {
    if (!item.lastAppearedAt) return true; // Never tested before -> instantly eligible
    const timeSinceLastAppearance = nowMs - new Date(item.lastAppearedAt).getTime();
    return timeSinceLastAppearance > ONE_DAY_MS;
  });

  // 2. If eligible collection items exist, sort by oldest appearance first, then lowest strength
  if (eligibleFromCollection.length > 0) {
    const sorted = [...eligibleFromCollection].sort((a, b) => {
      const aTime = a.lastAppearedAt ? new Date(a.lastAppearedAt).getTime() : 0;
      const bTime = b.lastAppearedAt ? new Date(b.lastAppearedAt).getTime() : 0;
      if (aTime !== bTime) return aTime - bTime; // Oldest first
      return a.strength - b.strength; // Lowest strength first
    });

    return {
      candidates: sorted.slice(0, maxCandidates),
      isDailyConversationFallback: false,
    };
  }

  // 3. Fallback: Use common daily conversational words/phrases
  const fallbackCandidates: UserVocabItem[] = DAILY_CONVERSATION_FALLBACK_POOL.slice(0, maxCandidates).map(
    (item, index) => ({
      ...item,
      id: `fallback-${index}-${Date.now()}`,
      addedAt: new Date().toISOString(),
    })
  );

  return {
    candidates: fallbackCandidates,
    isDailyConversationFallback: true,
  };
}
```

### 1.2 Evaluation Strategy: Direct LLM Authority (Zero Programmatic Validation Gates)

A critical architectural decision in this system is **relying directly on the LLM's evaluation without secondary programmatic regex gates**:

#### The Problem with Programmatic Regex Gates
Earlier iterations utilized programmatic regex gates (`hasUserIncorporatedWord`) that ran over the user's submission to double-check the LLM's verdict. In practice, rigid string/regex checking produced false negatives:
- **Grammatical Inflections & Tenses**: If the target word was `challenge`, rigid regex often failed on valid inflections (`challenged`, `challenging`, `challenges`).
- **Compound Word Variations**: Target words like `cost-effective` resulted in false negatives if the learner wrote `cost effective` (spaced) or used adverbial derivations like `cost-effectively`.
- **Separable Phrasal Verbs**: For phrases like `turn down`, natural native sentences often split particles (e.g., `turned the job offer down`), failing simplistic substring checks.
- **Feedback Discrepancies**: The LLM praised the student for using the target word in `whatWentWell`, but the downstream programmatic gate overwrote `incorporatedTargetWord: false`. This triggered confusing UI banners claiming the word was omitted.

#### The Direct LLM Solution
1. **Direct Trust**: The system consumes `incorporatedTargetWord` (boolean) and `incorporatedVocabClues` (string array) directly from the LLM's JSON evaluation without modifying them via regex.
2. **Strict Prompt Contracts**: Strict system instructions define boundary conditions for the LLM:
   - Accept inflections, conjugations, adverbs, separable phrasal particles, and hyphen/space compound variants.
   - Strictly mark `false` if the user substituted a synonym or omitted the target word.
   - Align `whatWentWell` with `incorporatedTargetWord`—never praise the target word if `incorporatedTargetWord` is `false`.
   - Populate `incorporatedVocabClues` strictly with the designated clues the learner actually incorporated.

---

## 2. Core Data Models & TypeScript Contracts

Save these interfaces into your new app's `types.ts`:

```typescript
export interface UserVocabItem {
  id: string;
  word: string; // Supports single word or multi-word phrase
  translation: string;
  definition?: string;
  partOfSpeech?: string;
  strength: number; // 0 to 100
  lastAppearedAt?: string; // ISO timestamp of last appearance
  addedAt: string;
}

export interface ChallengeKeyWord {
  word: string;
  translation: string;
  partOfSpeech?: string;
  hint?: string;
}

export interface ChallengeData {
  id: string;
  nativeSentence: string;
  targetLanguage: string;
  nativeLanguage: string;
  topicContext?: string; // Descriptive 2-4 word label freely chosen by the LLM (e.g., "Kẹt xe giờ tan tầm", "Mượn đồ đồng nghiệp"). STRICT RULE: Never restrict to a hardcoded enum or static taxonomy!
  idealTranslation?: string;
  keyTargetWords?: ChallengeKeyWord[];
  targetWordFromCollection?: {
    id?: string;
    word: string; // Supports words and phrases
    translation?: string;
    definition?: string;
    hint?: string;
    strength?: number;
    partOfSpeech?: string;
    lastAppearedAt?: string;
  };
  isDailyConversationFallback?: boolean; // True when generated from common daily vocab
  personalityNote?: string;
  createdAt: string;
  provider?: string;
  model?: string;
  responseTimeMs?: number;
}

export interface ChallengeSuggestedVocab {
  word: string;
  translation: string;
  definition?: string;
  partOfSpeech?: string;
  hint?: string;
  example?: string;
  exampleTranslation?: string;
  askedByUser?: boolean;
}

export interface ChallengeAugmentedWord {
  word: string;
  translation?: string;
  prevStrength: number;
  newStrength: number;
  strengthGained: number;
  isTargetWord?: boolean;
  isVocabClue?: boolean;
  wasAlreadyInCollection?: boolean;
}

export interface ChallengeEvaluation {
  score: number; // 0 - 100
  scoreLabel: string;
  whatWentWell: string;
  areasForImprovement: string;
  correctedSentence: string;
  userTranslation: string;
  suggestedVocabulary: ChallengeSuggestedVocab[];
  incorporatedTargetWord?: boolean;
  targetWordUsed?: string;
  targetWordStrengthGained?: number;
  targetWordNewStrength?: number;
  targetWordPrevStrength?: number;
  augmentedWords?: ChallengeAugmentedWord[];
  incorporatedVocabClues?: string[];
  provider?: string;
  model?: string;
  responseTimeMs?: number;
}

export interface ChallengeTurnResult {
  intent: "submission" | "incomplete" | "assistance";
  agentReply?: string;
  suggestedActions?: Array<{
    label: string;
    action: string;
    payload?: any;
  }>;
  evaluation?: ChallengeEvaluation;
  provider?: string;
  model?: string;
  responseTimeMs?: number;
}
```

---

## 3. Mocked LLM Responses (Plug-and-Play Testing)

To clone this feature without configuring API keys or backend servers right away, use the following pre-built mock scenarios.

### Mock 1: Challenge Generation Response

#### Scenario: Learner practicing English with native Vietnamese (Target word: `resilience`)
```json
{
  "id": "challenge-mock-001",
  "nativeSentence": "Dù gặp nhiều thất bại ban đầu, cô ấy vẫn giữ vững tinh thần kiên cường đáng khâm phục.",
  "targetLanguage": "English",
  "nativeLanguage": "Vietnamese",
  "topicContext": "Ý chí & Vượt khó",
  "idealTranslation": "Despite many initial setbacks, she maintained an admirable resilience.",
  "targetWordFromCollection": {
    "id": "word-101",
    "word": "resilience",
    "translation": "sự kiên cường, khả năng phục hồi",
    "definition": "The capacity to recover quickly from difficulties; toughness.",
    "hint": "Danh từ chỉ ý chí bền bỉ vượt qua nghịch cảnh",
    "strength": 25
  },
  "keyTargetWords": [
    {
      "word": "resilience",
      "translation": "sự kiên cường",
      "hint": "noun"
    },
    {
      "word": "setback",
      "translation": "sự trở ngại, thất bại",
      "hint": "noun"
    },
    {
      "word": "admirable",
      "translation": "đáng ngưỡng mộ, khâm phục",
      "hint": "adjective"
    },
    {
      "word": "maintain",
      "translation": "duy trì, giữ vững",
      "hint": "verb"
    }
  ],
  "personalityNote": "Tình huống truyền cảm hứng giúp bạn thực hành từ vựng miêu tả phẩm chất tính cách và nghị lực trong công việc cũng như đời sống.",
  "createdAt": "2026-09-18T20:00:00.000Z",
  "provider": "mock-llm",
  "model": "mock-engine-v1",
  "responseTimeMs": 320
}
```

---

### Mock 2: High-Score Submission Evaluation (Score: 94)

#### User Input:
`"Despite facing multiple initial setbacks, she maintained admirable resilience."`

```json
{
  "intent": "submission",
  "evaluation": {
    "score": 94,
    "scoreLabel": "Xuất sắc! 🌟",
    "userTranslation": "Despite facing multiple initial setbacks, she maintained admirable resilience.",
    "incorporatedTargetWord": true,
    "targetWordUsed": "resilience",
    "targetWordPrevStrength": 25,
    "targetWordNewStrength": 55,
    "targetWordStrengthGained": 30,
    "incorporatedVocabClues": ["resilience", "setback", "admirable", "maintain"],
    "whatWentWell": "Bản dịch của bạn cực kỳ tự nhiên và chuẩn xác! Bạn đã kết hợp xuất sắc giới từ 'Despite' đi cùng cụm danh từ, sử dụng chính xác từ vựng mục tiêu 'resilience' và các từ ngữ nâng cao như 'setbacks' và 'admirable'.",
    "areasForImprovement": "Câu đã rất tốt. Nếu muốn câu văn mang sắc thái trang trọng hơn nữa trong văn viết học thuật, bạn có thể cân nhắc dùng cụm 'in the face of initial setbacks'.",
    "correctedSentence": "Despite many initial setbacks, she maintained an admirable resilience.",
    "suggestedVocabulary": [
      {
        "word": "resilience",
        "translation": "sự kiên cường, bền bỉ",
        "definition": "Ability to recover readily from illness, depression, or adversity.",
        "partOfSpeech": "noun",
        "hint": "uncountable noun",
        "example": "He showed great courage and resilience.",
        "exampleTranslation": "Anh ấy đã thể hiện lòng dũng cảm và sự kiên cường to lớn."
      },
      {
        "word": "setback",
        "translation": "bước lùi, trở ngại",
        "definition": "A reversal or check in progress.",
        "partOfSpeech": "noun",
        "hint": "countable noun",
        "example": "The team suffered a serious setback.",
        "exampleTranslation": "Đội tuyển đã phải chịu một bước lùi nghiêm trọng."
      },
      {
        "word": "admirable",
        "translation": "đáng khâm phục, đáng ngưỡng mộ",
        "definition": "Deserving respect or approval.",
        "partOfSpeech": "adjective",
        "hint": "adjective",
        "example": "Her dedication is truly admirable.",
        "exampleTranslation": "Sự tận tụy của cô ấy thật đáng ngưỡng mộ."
      }
    ],
    "augmentedWords": [
      {
        "word": "resilience",
        "translation": "sự kiên cường",
        "prevStrength": 25,
        "newStrength": 55,
        "strengthGained": 30,
        "isTargetWord": true,
        "isVocabClue": false,
        "wasAlreadyInCollection": true
      },
      {
        "word": "setback",
        "translation": "sự trở ngại",
        "prevStrength": 10,
        "newStrength": 40,
        "strengthGained": 30,
        "isTargetWord": false,
        "isVocabClue": true,
        "wasAlreadyInCollection": true
      }
    ]
  },
  "provider": "mock-llm",
  "model": "mock-evaluator-v1",
  "responseTimeMs": 410
}
```

---

### Mock 3: Fair/Mid-Score Submission (Score: 72)
*Learner conveyed the meaning with a synonym ('toughness') but missed the designated target word (`resilience`).*

#### User Input:
`"Although she had many failures at first, she still kept an admirable mental toughness."`

```json
{
  "intent": "submission",
  "evaluation": {
    "score": 72,
    "scoreLabel": "Khá tốt! 👍",
    "userTranslation": "Although she had many failures at first, she still kept an admirable mental toughness.",
    "incorporatedTargetWord": false,
    "targetWordUsed": "resilience",
    "targetWordPrevStrength": 25,
    "targetWordNewStrength": 35,
    "targetWordStrengthGained": 10,
    "incorporatedVocabClues": ["admirable"],
    "whatWentWell": "Bạn truyền tải trọn vẹn ý nghĩa của câu gốc. Việc sử dụng 'mental toughness' là một cách diễn đạt rất tự nhiên trong giao tiếp đời thường.",
    "areasForImprovement": "Hãy thử áp dụng từ vựng mục tiêu 'resilience' thay cho 'mental toughness'. Đồng thời, trong tiếng Anh, người ta thường dùng động từ 'maintain' hoặc 'demonstrate' thay vì 'keep' khi đi kèm với tinh thần bền bỉ.",
    "correctedSentence": "Despite many initial setbacks, she maintained an admirable resilience.",
    "suggestedVocabulary": [
      {
        "word": "resilience",
        "translation": "sự kiên cường",
        "definition": "The capacity to recover quickly from difficulties.",
        "partOfSpeech": "noun",
        "hint": "target word",
        "example": "She displayed remarkable resilience.",
        "exampleTranslation": "Cô ấy đã thể hiện sự kiên cường đáng kinh ngạc."
      },
      {
        "word": "mental toughness",
        "translation": "sức mạnh tinh thần, ý chí thép",
        "definition": "A measure of individual resilience and confidence.",
        "partOfSpeech": "noun phrase",
        "hint": "colloquial synonym",
        "example": "Elite athletes require immense mental toughness.",
        "exampleTranslation": "Vận động viên đỉnh cao cần ý chí tinh thần rất lớn."
      }
    ],
    "augmentedWords": [
      {
        "word": "resilience",
        "translation": "sự kiên cường",
        "prevStrength": 25,
        "newStrength": 35,
        "strengthGained": 10,
        "isTargetWord": true,
        "isVocabClue": false,
        "wasAlreadyInCollection": true
      }
    ]
  },
  "provider": "mock-llm",
  "model": "mock-evaluator-v1",
  "responseTimeMs": 390
}
```

---

### Mock 4: Incomplete Submission Detection

#### User Input (Accidentally submitted mid-typing):
`"Despite many initial"`

```json
{
  "intent": "incomplete",
  "agentReply": "⚠️ **Phát hiện câu trả lời chưa hoàn thành**\n\nCó vẻ như bạn đã gửi câu khi chưa gõ xong *(bạn có bấm nhầm phím Enter không? 😉)*\n\n**Bản nháp của bạn:** *\"Despite many initial\"*\n\n👉 Hãy tiếp tục gõ bản dịch hoàn chỉnh bên dưới hoặc bấm nút để điền lại bản nháp!",
  "suggestedActions": [
    {
      "label": "✏️ Repopulate draft: \"Despite many initial…\"",
      "action": "repopulate_input",
      "payload": {
        "text": "Despite many initial "
      }
    },
    {
      "label": "🏳️ Xem đáp án & bỏ qua",
      "action": "submit_empty_challenge"
    },
    {
      "label": "🏆 Tổng quan luyện tập",
      "action": "start_practice"
    }
  ],
  "provider": "local-rule-engine",
  "model": "instant-detection",
  "responseTimeMs": 15
}
```

---

### Mock 5: Skip / Reveal Answer Submission (Score: 0)

#### User Input:
`"skip"` or `"(no answer provided)"`

```json
{
  "intent": "submission",
  "evaluation": {
    "score": 0,
    "scoreLabel": "Xem đáp án & Học tập! 💡",
    "userTranslation": "(No answer provided)",
    "incorporatedTargetWord": false,
    "targetWordUsed": "resilience",
    "targetWordPrevStrength": 25,
    "targetWordNewStrength": 35,
    "targetWordStrengthGained": 10,
    "whatWentWell": "Bạn đã chủ động xem đáp án mẫu để củng cố cách diễn đạt và ghi nhớ từ vựng mục tiêu.",
    "areasForImprovement": "Hãy ghi nhớ cách dùng từ vựng 'resilience' trong câu mẫu: 'Despite many initial setbacks, she maintained an admirable resilience.'",
    "correctedSentence": "Despite many initial setbacks, she maintained an admirable resilience.",
    "suggestedVocabulary": [
      {
        "word": "resilience",
        "translation": "sự kiên cường, khả năng phục hồi",
        "definition": "The capacity to recover quickly from difficulties.",
        "partOfSpeech": "target word",
        "hint": "Featured target word from collection"
      },
      {
        "word": "setback",
        "translation": "sự trở ngại, thất bại",
        "definition": "A reversal or check in progress.",
        "partOfSpeech": "noun",
        "hint": "Key vocabulary from challenge"
      }
    ],
    "augmentedWords": [
      {
        "word": "resilience",
        "translation": "sự kiên cường",
        "prevStrength": 25,
        "newStrength": 35,
        "strengthGained": 10,
        "isTargetWord": true,
        "isVocabClue": false,
        "wasAlreadyInCollection": true
      }
    ]
  },
  "provider": "local-engine",
  "model": "instant-evaluation",
  "responseTimeMs": 25
}
```

---

## 4. Complete Mock Service (`mockChallengeService.ts`)

You can directly add this file to your new project to simulate the full backend without an LLM API, including candidate selection with the 1-day threshold and daily conversation fallback:

> **Important Note on Topics & Contexts**:
> In this mock file, static scenarios are used purely for local offline testing.
> In production with a live LLM, **there are ZERO hardcoded topics or contexts**. The LLM model has **100% complete freedom to invent any realistic communication context** and select **common everyday sentences** that native speakers actually say in that context.

```typescript
// mockChallengeService.ts
import { ChallengeData, ChallengeTurnResult, UserVocabItem } from "./types";
import { selectChallengeCandidates } from "./candidateSelector"; // see Section 1.1

// 1. Challenges anchored to user collection words/phrases (> 1 day old)
const COLLECTION_CHALLENGES: ChallengeData[] = [
  {
    id: "challenge-collection-001",
    nativeSentence: "Dù gặp nhiều thất bại ban đầu, cô ấy vẫn giữ vững tinh thần kiên cường đáng khâm phục.",
    targetLanguage: "English",
    nativeLanguage: "Vietnamese",
    topicContext: "Ý chí & Vượt khó",
    idealTranslation: "Despite many initial setbacks, she maintained an admirable resilience.",
    targetWordFromCollection: {
      word: "resilience",
      translation: "sự kiên cường, khả năng phục hồi",
      definition: "The capacity to recover quickly from difficulties.",
      strength: 25,
      lastAppearedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(), // 3 days ago
    },
    keyTargetWords: [
      { word: "resilience", translation: "sự kiên cường" },
      { word: "setback", translation: "sự trở ngại" },
      { word: "admirable", translation: "đáng khâm phục" },
      { word: "maintain", translation: "duy trì" },
    ],
    isDailyConversationFallback: false,
    personalityNote: "Tình huống rèn luyện từ vựng miêu tả phẩm chất ý chí trong đời thực.",
    createdAt: new Date().toISOString(),
    provider: "mock",
    model: "mock-llm-v1",
    responseTimeMs: 300,
  },
  {
    id: "challenge-collection-002",
    nativeSentence: "Chúng ta cần tinh chỉnh kế hoạch này một chút để thích nghi với tình hình mới.",
    targetLanguage: "English",
    nativeLanguage: "Vietnamese",
    topicContext: "Công việc & Kế hoạch",
    idealTranslation: "We need to tweak this plan slightly to adapt to the new circumstances.",
    targetWordFromCollection: {
      word: "tweak",
      translation: "tinh chỉnh, điều chỉnh nhỏ",
      definition: "To make fine adjustments.",
      strength: 40,
      lastAppearedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(), // 2 days ago
    },
    keyTargetWords: [
      { word: "tweak", translation: "tinh chỉnh" },
      { word: "slightly", translation: "một chút" },
      { word: "adapt to", translation: "thích nghi với" },
      { word: "circumstances", translation: "hoàn cảnh, tình thế" },
    ],
    isDailyConversationFallback: false,
    personalityNote: "Học cách diễn đạt linh hoạt trong các buổi thảo luận công việc thường ngày.",
    createdAt: new Date().toISOString(),
    provider: "mock",
    model: "mock-llm-v1",
    responseTimeMs: 280,
  }
];

// 2. Fallback challenges using common daily conversational words and phrases
const DAILY_CONVERSATION_FALLBACK_CHALLENGES: ChallengeData[] = [
  {
    id: "challenge-daily-001",
    nativeSentence: "Cuối tuần này rảnh không? Tụi mình đi ăn nhanh một bữa rồi trò chuyện nhé!",
    targetLanguage: "English",
    nativeLanguage: "Vietnamese",
    topicContext: "Hẹn gặp & Bạn bè",
    idealTranslation: "Are you free this weekend? Let's grab a bite and catch up!",
    targetWordFromCollection: {
      word: "grab a bite",
      translation: "đi ăn nhanh một bữa",
      definition: "To get something to eat quickly.",
      strength: 0,
    },
    keyTargetWords: [
      { word: "grab a bite", translation: "đi ăn nhanh một bữa" },
      { word: "catch up", translation: "trò chuyện hàn huyên" },
      { word: "free", translation: "rảnh rỗi" },
    ],
    isDailyConversationFallback: true,
    personalityNote: "Cụm từ giao tiếp cực kỳ thông dụng khi rủ bạn bè hoặc đồng nghiệp đi ăn trưa.",
    createdAt: new Date().toISOString(),
    provider: "mock",
    model: "mock-llm-v1",
    responseTimeMs: 260,
  },
  {
    id: "challenge-daily-002",
    nativeSentence: "Bạn có thể để mắt tới hành lý của tôi một lát trong khi tôi đi mua nước được không?",
    targetLanguage: "English",
    nativeLanguage: "Vietnamese",
    topicContext: "Giao tiếp nơi công cộng",
    idealTranslation: "Could you keep an eye on my luggage for a moment while I go buy some water?",
    targetWordFromCollection: {
      word: "keep an eye on",
      translation: "để mắt tới, trông coi giúp",
      definition: "To watch or take care of something carefully.",
      strength: 0,
    },
    keyTargetWords: [
      { word: "keep an eye on", translation: "để mắt tới, trông coi" },
      { word: "luggage", translation: "hành lý" },
      { word: "for a moment", translation: "một lát" },
    ],
    isDailyConversationFallback: true,
    personalityNote: "Cụm động từ tự nhiên và lịch sự dùng trong sân bay, quán cà phê hoặc nhà ga.",
    createdAt: new Date().toISOString(),
    provider: "mock",
    model: "mock-llm-v1",
    responseTimeMs: 270,
  }
];

export async function mockGenerateChallenge(userCollection: UserVocabItem[] = []): Promise<ChallengeData> {
  // Simulate network latency
  await new Promise((res) => setTimeout(res, 350));

  // Determine candidates via the 1-day threshold rule
  const { isDailyConversationFallback } = selectChallengeCandidates(userCollection);

  const pool = isDailyConversationFallback
    ? DAILY_CONVERSATION_FALLBACK_CHALLENGES
    : COLLECTION_CHALLENGES;

  const randomIndex = Math.floor(Math.random() * pool.length);
  return {
    ...pool[randomIndex],
    id: `challenge-${Date.now()}`,
    createdAt: new Date().toISOString(),
  };
}

export async function mockProcessChallengeTurn(
  challenge: ChallengeData,
  userMessage: string
): Promise<ChallengeTurnResult> {
  await new Promise((res) => setTimeout(res, 500));

  const trimmed = (userMessage || "").trim();
  const lower = trimmed.toLowerCase();

  // 1. Incomplete submission check
  const trailingConnectives = ["the", "a", "an", "is", "are", "to", "in", "with", "and", "or", "because", "if"];
  const words = trimmed.split(/\s+/).filter(Boolean);
  const lastWord = words[words.length - 1]?.toLowerCase();
  const isPunct = /[.?!…]$/.test(trimmed);

  if (!isPunct && (words.length <= 2 || (lastWord && trailingConnectives.includes(lastWord)))) {
    return {
      intent: "incomplete",
      agentReply: `⚠️ Có vẻ như bạn đã gửi câu khi chưa gõ xong: *"${trimmed}"*. Hãy hoàn tất câu dịch của bạn nhé!`,
      suggestedActions: [
        { label: `✏️ Điền lại: "${trimmed}…"`, action: "repopulate_input", payload: { text: trimmed + " " } },
        { label: "🏳️ Xem đáp án & bỏ qua", action: "submit_empty_challenge" }
      ],
      provider: "mock",
      model: "mock-rule",
      responseTimeMs: 30,
    };
  }

  // 2. Empty submission / Skip check
  if (!trimmed || lower === "skip" || lower === "(no answer provided)") {
    const targetWord = challenge.targetWordFromCollection?.word || "target word";
    return {
      intent: "submission",
      evaluation: {
        score: 0,
        scoreLabel: "Xem đáp án & Học tập! 💡",
        userTranslation: "(No answer provided)",
        incorporatedTargetWord: false,
        targetWordUsed: targetWord,
        incorporatedVocabClues: [],
        whatWentWell: "Bạn đã chủ động xem đáp án mẫu để củng cố ngữ pháp và từ vựng mục tiêu.",
        areasForImprovement: `Ghi nhớ câu chuẩn: "${challenge.idealTranslation}"`,
        correctedSentence: challenge.idealTranslation || "Optimal translation here.",
        suggestedVocabulary: (challenge.keyTargetWords || []).map((k) => ({
          word: k.word,
          translation: k.translation,
        })),
      },
      provider: "mock",
      model: "mock-evaluator",
      responseTimeMs: 50,
    };
  }

  // 3. Normal submission evaluation
  // NOTE: In production with real LLMs, we rely directly on the LLM's evaluation flags
  // (incorporatedTargetWord and incorporatedVocabClues) without programmatic regex validation gates.
  const targetWord = challenge.targetWordFromCollection?.word?.toLowerCase() || "";
  const didIncorporate = targetWord ? lower.includes(targetWord) : false;
  const score = didIncorporate ? 92 : 75;

  const usedClues = (challenge.keyTargetWords || [])
    .filter((k) => k.word && lower.includes(k.word.toLowerCase()))
    .map((k) => k.word);

  return {
    intent: "submission",
    evaluation: {
      score,
      scoreLabel: didIncorporate ? "Xuất sắc! 🌟" : "Làm tốt lắm! 👏",
      userTranslation: trimmed,
      incorporatedTargetWord: didIncorporate,
      targetWordUsed: challenge.targetWordFromCollection?.word,
      incorporatedVocabClues: usedClues,
      whatWentWell: didIncorporate
        ? `Tuyệt vời! Bạn đã sử dụng chính xác từ mục tiêu "${challenge.targetWordFromCollection?.word}" và diễn đạt tự nhiên.`
        : `Bạn đã truyền tải tốt ý nghĩa câu gốc bằng từ ngữ mạch lạc.`,
      areasForImprovement: didIncorporate
        ? "Cấu trúc câu rất ổn. Chú ý thêm về cách chọn mạo từ để câu hoàn hảo hơn."
        : `Thử vận dụng từ vựng mục tiêu "${challenge.targetWordFromCollection?.word}" để mở rộng vốn từ.`,
      correctedSentence: challenge.idealTranslation || "Optimal translation.",
      suggestedVocabulary: (challenge.keyTargetWords || []).map((k) => ({
        word: k.word,
        translation: k.translation,
      })),
      augmentedWords: challenge.targetWordFromCollection ? [
        {
          word: challenge.targetWordFromCollection.word,
          translation: challenge.targetWordFromCollection.translation,
          prevStrength: challenge.targetWordFromCollection.strength ?? 0,
          newStrength: Math.min(100, (challenge.targetWordFromCollection.strength ?? 0) + (didIncorporate ? 30 : 10)),
          strengthGained: didIncorporate ? 30 : 10,
          isTargetWord: true,
          wasAlreadyInCollection: true,
        }
      ] : []
    },
    provider: "mock",
    model: "mock-evaluator",
    responseTimeMs: 350,
  };
}
```

---

## 5. Production LLM Prompts & System Instructions

When connecting a real LLM (Gemini 2.5/Flash, GPT-4o, Claude, etc.), use the following production-tested prompt templates:

### 5.1 Challenge Generation Prompt

The generator dynamically adapts based on whether eligible candidates were retrieved from the user's collection (> 1 day old) or if the system fell back to common daily conversational words.

> **Zero Hardcoded Topics Rule**: The LLM model is **never constrained by a predefined list of topics or categories**. It has **100% complete autonomy to invent any realistic daily life situation** (e.g., catching a bus, dining out, borrowing a phone charger, asking a colleague for a hand, discussing grocery prices, rescheduling a dentist visit, talking about pets or weather) and choose **common sentences** that native speakers actually say in that situation.

```text
System Instruction:
You are an expert bilingual translation coach. Create a concise, authentic, and culturally natural conversational challenge for a language learner. 

Strict Mandates:
1. ZERO HARDCODED TOPICS OR CONTEXTS: You have 100% creative freedom to choose ANY realistic communication context (e.g., home, office, public transit, social banter, shopping, doctor's office, travel, neighborhood). Do not rely on textbook cliches or rigid categories.
2. COMMON SENTENCE SELECTION: Within your chosen context, select a COMMON, natural everyday sentence that native speakers frequently say in real life (6-14 words).
3. ZERO loanwords or untranslated target-language terms inside 'nativeSentence'.
4. Do NOT provide 'idealTranslation' during generation if target is English; allow native-first thinking.
5. Mode Handling:
   - MODE A (Collection Candidates Provided): Freely pick any realistic context that naturally incorporates one chosen candidate word or phrase as 'targetWordFromCollection'.
   - MODE B (Daily Conversation Fallback): Freely pick any everyday context, and anchor the challenge on common words or phrases frequently used in daily conversation.
6. 'topicContext': Summarize your freely chosen context in a concise, natural 2-4 word native label (e.g. 'Mượn đồ đồng nghiệp', 'Kẹt xe giờ tan tầm', 'Ghé tiệm cà phê', 'Hẹn giờ đón con'). NEVER select from a static list!

Prompt Template (Mode A - Collection Anchor):
Generate a translation challenge for a learner whose native language is {{nativeLanguage}} learning {{targetLanguage}}.
Choose any realistic context that naturally fits one of the candidate words/phrases, and select a COMMON sentence people frequently say in that situation.

LEARNER CANDIDATE VOCABULARY & PHRASES (Collection items last tested > 1 day ago):
{{#each candidates}}
- "{{this.word}}" (meaning: {{this.translation}}) [Strength: {{this.strength}}%] [Last appeared: {{this.lastAppearedAt}}]
{{/each}}

Prompt Template (Mode B - Daily Conversation Fallback):
The learner currently has no collection items due for review (or all items were reviewed in the past 24 hours).
Freely pick ANY everyday situation (e.g., dining, commuting, running errands, casual workplace interactions, making plans), and generate a translation challenge for {{nativeLanguage}} ➔ {{targetLanguage}} using a COMMON sentence people actually say in that context.

OUTPUT SCHEMA (STRICT JSON ONLY):
{
  "nativeSentence": "Common, natural spoken native sentence (6-14 words)",
  "topicContext": "Freely chosen 2-4 word context label in native language (e.g., 'Kẹt xe giờ cao điểm')",
  "targetWordFromCollection": {
    "word": "Verbatim target word or phrase",
    "translation": "Native meaning in context",
    "hint": "Brief usage hint"
  },
  "isDailyConversationFallback": false, // Set to true if generated via Mode B
  "keyTargetWords": [
    { "word": "target_term", "translation": "native_meaning", "hint": "part_of_speech" }
  ],
  "personalityNote": "Why this sentence and vocabulary is useful in daily life"
}
```

### 5.2 Challenge Evaluation Prompt

#### Production Vietnamese System Instruction & Evaluation Prompt
```text
System Instruction:
Bạn là chuyên gia đánh giá thử thách dịch thuật tiếng Việt sang English. Tạo câu dịch mẫu tự nhiên nhất ("correctedSentence") có chứa từ vựng mục tiêu "{{targetWord}}", đánh giá linh hoạt bản dịch của học viên, và đưa ra nhận xét bằng tiếng Việt chi tiết, dễ hiểu. Đánh giá chính xác "incorporatedTargetWord" (true nếu học viên thực sự dùng từ mục tiêu) và "incorporatedVocabClues" (danh sách các từ gợi ý mà học viên đã dùng). Trả về JSON thuần.

Prompt Template:
Bạn là chuyên gia thẩm định và chấm điểm bản dịch từ tiếng Việt sang English cho học viên.
Nhiệm vụ của bạn là đánh giá toàn diện câu trả lời của học viên và trả về kết quả bằng JSON thuần.

THÔNG TIN THỬ THÁCH:
- Câu tiếng Việt gốc: "{{challenge.nativeSentence}}"
- Ngữ cảnh thực tế: "{{challenge.topicContext}}"
- Từ vựng mục tiêu trọng tâm cần học viên vận dụng: "{{challenge.targetWordFromCollection.word}}"
- Danh sách từ vựng gợi ý của thử thách: {{json clueWordsList}}

CÂU TRẢ LỜI CỦA HỌC VIÊN:
"{{userSubmission}}"

QUY TẮC PHÂN LOẠI & ĐÁNH GIÁ (TUÂN THỦ TUYỆT ĐỐI):
1. KIỂM TRA TÍNH HOÀN CHỈNH CỦA CÂU:
   - Nếu học viên chỉ mới gõ dở dang (ví dụ bấm nhầm phím gửi khi câu chỉ mới có 1-2 từ, kết thúc lửng lơ ở từ nối như 'and', 'the', 'to', 'because'...):
     Trả về {"intent": "incomplete", "agentReply": "Nhắc nhở học viên nhẹ nhàng..."}

2. QUY TẮC ĐÁNH GIÁ KHI NỘP BẢN DỊCH HOÀN CHỈNH (intent: "submission"):
   - "correctedSentence": Đưa ra câu dịch tiếng Anh chuẩn mực, tự nhiên, tự nhiên như người bản xứ trong giao tiếp hàng ngày, và BẮT BUỘC lồng ghép chuẩn xác từ vựng mục tiêu "{{targetWord}}".
   - "score": Điểm số từ 0 đến 100 phản ánh độ chính xác, tự nhiên và ngữ pháp.
   - "scoreLabel": Nhãn khen ngợi (ví dụ "Xuất sắc! 🌟", "Tuyệt vời! 🎉", "Làm tốt lắm! 👏", "Cần cố gắng! 💪").

   - QUY TẮC CHÍNH XÁC CHO "incorporatedTargetWord" (TỪ VỰNG MỤC TIÊU):
     + Gán "incorporatedTargetWord": true NẾU VÀ CHỈ NẾU câu của học viên thực sự sử dụng từ vựng mục tiêu "{{targetWord}}" (chấp nhận cả các dạng chia thì, số nhiều/số ít, tiền tố/hậu tố, trạng từ -ly, phrasal verb tách rời, hoặc biến thể dấu gạch nối / khoảng trắng như "cost-effective" / "cost effective").
     + BẮT BUỘC gán "incorporatedTargetWord": false NẾU học viên KHÔNG dùng từ "{{targetWord}}" (ví dụ: dùng từ đồng nghĩa khác như 'affordable' hay 'come over', hoặc không nhắc đến, hoặc bỏ trống/bỏ qua).
     + Khi "incorporatedTargetWord" là false: TUYỆT ĐỐI KHÔNG khen trong "whatWentWell" rằng học viên đã dùng "{{targetWord}}". Thay vào đó, hãy khen ngợi từ đồng nghĩa/cấu trúc tự nhiên họ đã dùng trong "whatWentWell", và trong "areasForImprovement" hãy gợi ý cách lồng ghép từ mục tiêu "{{targetWord}}".
     + Khi "incorporatedTargetWord" là true: Hãy ghi nhận và khen ngợi cách dùng chuẩn xác của từ mục tiêu "{{targetWord}}" trong "whatWentWell".

   - QUY TẮC CHÍNH XÁC CHO "incorporatedVocabClues" (CÁC TỪ GỢI Ý ĐÃ DÙNG):
     + Đối chiếu câu dịch của học viên với danh sách từ gợi ý: {{json clueWordsList}}.
     + Trả về mảng "incorporatedVocabClues" chứa chính xác tên các từ gợi ý mà học viên ĐÃ THỰC SỰ SỬ DỤNG (ví dụ: ["service", "print"]).
     + Nếu học viên không dùng từ gợi ý nào, trả về mảng rỗng [].
     + TUYỆT ĐỐI KHÔNG đưa từ vào "incorporatedVocabClues" nếu học viên không hề viết từ đó trong bản dịch của họ.

3. TRƯỜNG HỢP HỌC VIÊN BỎ QUA / XEM ĐÁP ÁN:
   - score: 0, scoreLabel: "Xem đáp án & Học tập! 💡", userTranslation: "(No answer provided)", incorporatedTargetWord: false, incorporatedVocabClues: [].

CẤU TRÚC JSON ĐẦU RA BẮT BUỘC:
{
  "intent": "submission",
  "evaluation": {
    "score": 90,
    "scoreLabel": "Xuất sắc! 🌟",
    "userTranslation": "{{userSubmission}}",
    "incorporatedTargetWord": true,
    "targetWordUsed": "{{targetWord}}",
    "incorporatedVocabClues": ["clue1", "clue2"],
    "whatWentWell": "Nhận xét chi tiết bằng tiếng Việt...",
    "areasForImprovement": "Gợi ý cải thiện cấu trúc, từ vựng...",
    "correctedSentence": "Optimal English translation containing {{targetWord}}...",
    "suggestedVocabulary": [
      {
        "word": "vocabulary item",
        "translation": "nghĩa tiếng Việt",
        "definition": "English definition",
        "partOfSpeech": "noun / verb / adjective / phrase",
        "example": "Example sentence using the word",
        "exampleTranslation": "Bản dịch của câu ví dụ"
      }
    ]
  }
}
```

#### Production English / Multilingual System Instruction & Evaluation Prompt
```text
System Instruction:
You are an AI Translation Challenge Evaluation Coach. Evaluate translation attempts in strict JSON output. Strictly determine whether the learner incorporated the designated target word ("incorporatedTargetWord") and which clue words they incorporated ("incorporatedVocabClues").

Prompt Template:
Evaluate the user's translation attempt from {{nativeLanguage}} to {{targetLanguage}}.

CHALLENGE DETAILS:
- Native Sentence: "{{challenge.nativeSentence}}"
- Context: "{{challenge.topicContext}}"
- Designated Target Word: "{{challenge.targetWordFromCollection.word}}"
- Available Clue Words: {{json clueWordsList}}

USER SUBMISSION:
"{{userSubmission}}"

STRICT EVALUATION INSTRUCTIONS:
1. Incomplete submission check: If premature fragment, return intent: "incomplete".
2. Normal submission: Provide correctedSentence, score (0-100), and scoreLabel.
3. STRICT CHECK FOR "incorporatedTargetWord":
   - Set "incorporatedTargetWord": true IF AND ONLY IF the learner actually included the featured target word "{{targetWord}}" or its valid grammatical inflections / forms (e.g. past tense, gerund, plural, adverbial forms like -ly, separable phrasal verb particles, or hyphen/space compound variants like "cost-effective" / "cost effective").
   - Set "incorporatedTargetWord": false IF the learner used an alternative synonym (e.g. "affordable" instead of "{{targetWord}}"), omitted it, or skipped.
   - When "incorporatedTargetWord" is false: Never claim in "whatWentWell" that the user used "{{targetWord}}". Instead, praise their natural synonym/phrasing in "whatWentWell" and suggest how to apply "{{targetWord}}" in "areasForImprovement".
   - When "incorporatedTargetWord" is true: Acknowledge and praise their correct use of "{{targetWord}}" in "whatWentWell".
4. STRICT CHECK FOR "incorporatedVocabClues":
   - Check the learner's text against available clues: {{json clueWordsList}}.
   - Return an array of strings in "incorporatedVocabClues" containing the exact clue words the learner actually used.
   - Return an empty array [] if none were used.
   - Do NOT hallucinate or include any clue words that do not appear in the learner's text.
```

---

## 6. Mobile-First UI Architecture & Complete Drop-in Component

To keep development simple, **always start with mobile first**. A clean vertical stream (360px–430px wide) eliminates desktop layout bloat (sidebars, multi-column bento grids, nested dialogs) and guarantees a great experience where learners practice most: on their smartphones.

### 6.1 Mobile Ergonomics & Layout Wireframe

```
  ┌────────────────────────────────────────┐
  │ 390px Mobile Viewport                  │
  │                                        │
  │ [Ý chí & Vượt khó]       [🔊 Nghe câu] │ ◄── Category & Native Audio (min 44px)
  │                                        │
  │ "Dù gặp nhiều thất bại ban đầu, cô ấy   │ ◄── Large Vietnamese Prompt
  │  vẫn giữ vững tinh thần kiên cường..." │     (18-20px font, generous line height)
  │                                        │
  │ ─── 💡 Gợi ý từ vựng (Chạm để xem) ─── │ ◄── Expandable Clue Chips
  │ [resilience: sự kiên cường] [setback]  │     (Thumb-friendly chips)
  │                                        │
  │ ┌────────────────────────────────────┐ │
  │ │ Nhập bản dịch tiếng Anh của bạn... │ │ ◄── Soft-Keyboard Friendly Textarea
  │ │                                    │ │     (Auto-expands, 3-4 lines)
  │ └────────────────────────────────────┘ │
  │                                        │
  │ [ 🏳️ Bỏ qua ]      [ 🚀 Gửi bản dịch ] │ ◄── Thumb-Level Sticky Action Bar
  └────────────────────────────────────────┘     (High contrast, min 48px height)

                 EVALUATION STATE (AFTER SUBMISSION)
  ┌────────────────────────────────────────┐
  │ [ ⭐ 94/100 ] [ Xuất sắc! 🌟 ]          │ ◄── Prominent Score Banner
  │ [ +30 Điểm SRS: resilience (25% ➔ 55%) ]│ ◄── Memory Strength Bonus Pill
  │                                        │
  │ 📝 Bản dịch của bạn:                    │
  │ "Despite facing initial setbacks..."   │ ◄── User Submission Card
  │                                        │
  │ 💡 Bản dịch chuẩn & tự nhiên:          │
  │ "Despite many setbacks, she maintained │ ◄── Ideal Native Phrasing
  │  an admirable resilience." [🔊]        │     (With 1-click audio playback)
  │                                        │
  │ 💬 Nhận xét: Rất tự nhiên! Dùng tốt... │ ◄── Direct AI Praise & Micro-Tips
  │                                        │
  │ [ 🔄 Thử thách câu tiếp theo ]         │ ◄── Primary Bottom Action (Next)
  └────────────────────────────────────────┘
```

### 6.2 Mobile-First Implementation Rules (Keep It Simple)
1. **Container Constraint**: Wrap the component in `max-w-md mx-auto w-full min-h-[100dvh] p-4 flex flex-col`. It looks native on mobile phones and neat/centered on desktop screens without requiring media query branching.
2. **Touch Targets**: Buttons, clue chips, and audio icons must have a minimum dimension of 44x44px.
3. **Keyboard Safety**: Use `min-h-[100dvh]` or `h-[100dvh]` with `overflow-y-auto` so the user can easily scroll when the phone's virtual keyboard appears.
4. **Instant Native Speech (Web Speech API)**: Use browser-native `window.speechSynthesis` for instant zero-dependency audio pronunciation on both iOS and Android.

---

### 6.3 Complete Drop-in Mobile Component (`MobileTranslationChallenge.tsx`)

You can copy-paste this self-contained component directly into any React + Tailwind project. It connects seamlessly to `mockChallengeService.ts`:

```tsx
import React, { useState, useEffect } from "react";
import { ChallengeData, ChallengeTurnResult } from "./types";
import { mockGenerateChallenge, mockProcessChallengeTurn } from "./mockChallengeService";

export function MobileTranslationChallenge() {
  const [challenge, setChallenge] = useState<ChallengeData | null>(null);
  const [userTranslation, setUserTranslation] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ChallengeTurnResult | null>(null);
  const [showClues, setShowClues] = useState(false);

  // Load initial challenge
  useEffect(() => {
    loadNewChallenge();
  }, []);

  const loadNewChallenge = async () => {
    setLoading(true);
    setResult(null);
    setUserTranslation("");
    setShowClues(false);
    try {
      const data = await mockGenerateChallenge();
      setChallenge(data);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (overrideText?: string) => {
    if (!challenge) return;
    const textToSend = overrideText !== undefined ? overrideText : userTranslation;
    setSubmitting(true);
    try {
      const res = await mockProcessChallengeTurn(challenge, textToSend);
      setResult(res);
      if (res.intent === "incomplete" && res.suggestedActions?.[0]?.payload?.text) {
        setUserTranslation(res.suggestedActions[0].payload.text);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const playAudio = (text: string, lang = "en-US") => {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    window.speechSynthesis.speak(utterance);
  };

  if (loading) {
    return (
      <div className="max-w-md mx-auto min-h-screen flex flex-col items-center justify-center p-6 text-stone-600">
        <div className="w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mb-3"></div>
        <p className="text-sm font-medium">Đang tạo thử thách dịch thuật...</p>
      </div>
    );
  }

  if (!challenge) return null;

  return (
    <main className="max-w-md mx-auto w-full min-h-[100dvh] bg-stone-50 text-stone-900 flex flex-col justify-between p-4 sm:p-6 font-sans">
      {/* Top Bar: Topic & Collection Source Indicator */}
      <header className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">
            🎯 {challenge.topicContext || "Luyện dịch"}
          </span>
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium border ${
              challenge.isDailyConversationFallback
                ? "bg-amber-50 text-amber-700 border-amber-200"
                : "bg-blue-50 text-blue-700 border-blue-200"
            }`}
          >
            {challenge.isDailyConversationFallback ? "💬 Hội thoại thường ngày" : "📚 Bộ sưu tập của bạn (>1 ngày)"}
          </span>
        </div>
        <button
          onClick={() => playAudio(challenge.nativeSentence, "vi-VN")}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl bg-white border border-stone-200 text-stone-600 hover:bg-stone-100 active:scale-95 transition"
          aria-label="Phát âm câu tiếng Việt"
        >
          🔊
        </button>
      </header>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col gap-4">
        {/* Vietnamese Source Sentence Card */}
        <section className="bg-white rounded-2xl p-5 border border-stone-200 shadow-sm">
          <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-1">
            Dịch câu sau sang tiếng Anh:
          </p>
          <p className="text-lg sm:text-xl font-bold text-stone-900 leading-snug">
            "{challenge.nativeSentence}"
          </p>
        </section>

        {/* Expandable Clues Accordion (Mobile Friendly) */}
        {challenge.keyTargetWords && challenge.keyTargetWords.length > 0 && (
          <section className="bg-white rounded-2xl border border-stone-200 p-3 shadow-sm">
            <button
              onClick={() => setShowClues((prev) => !prev)}
              className="w-full min-h-[44px] flex items-center justify-between text-sm font-medium text-stone-700 px-2 active:bg-stone-50 rounded-lg"
            >
              <span>💡 Gợi ý từ/cụm từ ({challenge.keyTargetWords.length})</span>
              <span className="text-stone-400">{showClues ? "▲ Thu gọn" : "▼ Xem"}</span>
            </button>
            {showClues && (
              <div className="flex flex-wrap gap-2 pt-3 border-t border-stone-100 mt-2">
                {challenge.keyTargetWords.map((item, idx) => (
                  <div
                    key={idx}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-stone-100 border border-stone-200 text-xs"
                  >
                    <span className="font-bold text-stone-900">{item.word}:</span>
                    <span className="text-stone-600">{item.translation}</span>
                    <button
                      onClick={() => playAudio(item.word, "en-US")}
                      className="ml-1 text-stone-400 hover:text-stone-700"
                      title="Nghe phát âm"
                    >
                      🔊
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Evaluation Feedback View */}
        {result?.evaluation && (
          <section className="bg-white rounded-2xl p-5 border border-stone-200 shadow-sm flex flex-col gap-3 animate-fade-in">
            {/* Score & Tier Banner */}
            <div className="flex items-center justify-between">
              <span
                className={`px-3 py-1 rounded-xl text-sm font-bold text-white ${
                  result.evaluation.score >= 80
                    ? "bg-emerald-600"
                    : result.evaluation.score >= 60
                    ? "bg-amber-600"
                    : "bg-rose-600"
                }`}
              >
                ⭐ {result.evaluation.score}/100 - {result.evaluation.scoreLabel}
              </span>
              {result.evaluation.incorporatedTargetWord && (
                <span className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200">
                  +30 Điểm SRS 🎉
                </span>
              )}
            </div>

            {/* Side-by-side or stacked translations */}
            <div className="bg-stone-50 rounded-xl p-3 border border-stone-200">
              <p className="text-xs font-semibold text-stone-500 mb-0.5">Bản dịch của bạn:</p>
              <p className="text-sm font-medium text-stone-800 italic">
                "{result.evaluation.userTranslation || "(Chưa nhập câu trả lời)"}"
              </p>
            </div>

            <div className="bg-emerald-50 rounded-xl p-3 border border-emerald-200">
              <div className="flex items-center justify-between mb-0.5">
                <p className="text-xs font-semibold text-emerald-800">Bản dịch mẫu tự nhiên:</p>
                <button
                  onClick={() => playAudio(result.evaluation!.correctedSentence, "en-US")}
                  className="text-xs text-emerald-700 font-semibold flex items-center gap-1"
                >
                  🔊 Nghe
                </button>
              </div>
              <p className="text-sm font-bold text-emerald-950">
                "{result.evaluation.correctedSentence}"
              </p>
            </div>

            {/* Suggested Vocab / Add to collection */}
            {result.evaluation.suggestedVocabulary && result.evaluation.suggestedVocabulary.length > 0 && (
              <div className="border-t border-stone-100 pt-2.5">
                <p className="text-xs font-semibold text-stone-600 mb-2">Từ & cụm từ hay trong câu:</p>
                <div className="flex flex-col gap-1.5">
                  {result.evaluation.suggestedVocabulary.map((v, i) => (
                    <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-stone-50 border border-stone-200 text-xs">
                      <div>
                        <span className="font-bold text-stone-800">{v.word}</span>
                        <span className="text-stone-500 ml-1.5">— {v.translation}</span>
                      </div>
                      <button
                        onClick={() => alert(`Đã thêm "${v.word}" vào bộ sưu tập cá nhân!`)}
                        className="px-2 py-1 rounded bg-white border border-stone-300 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-50 active:scale-95 transition"
                      >
                        + Lưu từ
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Praise & Improvement Feedback */}
            <div className="text-xs text-stone-600 space-y-1 pt-1">
              <p><strong className="text-emerald-700">Điểm tốt:</strong> {result.evaluation.whatWentWell}</p>
              <p><strong className="text-amber-700">Góp ý:</strong> {result.evaluation.areasForImprovement}</p>
            </div>
          </section>
        )}

        {/* Incomplete Warning View */}
        {result?.intent === "incomplete" && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-xs text-amber-900 flex flex-col gap-2">
            <p className="font-bold">⚠️ Có vẻ như bạn đã gửi câu khi chưa gõ xong!</p>
            <p>Hệ thống đã giữ lại bản nháp trong ô bên dưới để bạn tiếp tục hoàn thành.</p>
          </div>
        )}
      </div>

      {/* Bottom Sticky Interactive Controls */}
      <footer className="mt-4 pt-2 flex flex-col gap-3">
        {!result?.evaluation ? (
          <>
            <textarea
              value={userTranslation}
              onChange={(e) => setUserTranslation(e.target.value)}
              placeholder="Gõ bản dịch tiếng Anh của bạn tại đây..."
              rows={3}
              className="w-full p-3.5 rounded-2xl bg-white border border-stone-300 text-stone-900 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent resize-none shadow-sm"
              disabled={submitting}
            />

            <div className="flex items-center gap-2">
              <button
                onClick={() => handleSubmit("skip")}
                disabled={submitting}
                className="min-h-[48px] px-4 rounded-xl border border-stone-300 bg-white text-stone-600 font-medium text-sm hover:bg-stone-100 active:scale-95 transition disabled:opacity-50"
              >
                🏳️ Bỏ qua
              </button>

              <button
                onClick={() => handleSubmit()}
                disabled={submitting || !userTranslation.trim()}
                className="flex-1 min-h-[48px] rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-bold text-sm shadow-sm transition disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {submitting ? (
                  <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                ) : (
                  <>🚀 Gửi bản dịch</>
                )}
              </button>
            </div>
          </>
        ) : (
          <button
            onClick={loadNewChallenge}
            className="w-full min-h-[50px] rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-bold text-base shadow-sm transition flex items-center justify-center gap-2"
          >
            🔄 Thử thách câu tiếp theo
          </button>
        )}
      </footer>
    </main>
  );
}
```

---

## 7. Step-by-Step Mobile-First Clone Checklist

| Step | Action | Output / Files |
| :--- | :--- | :--- |
| **Step 1: Setup Types** | Copy TypeScript interfaces into your types system (including `UserVocabItem` with phrases & `lastAppearedAt`). | `types.ts` |
| **Step 2: Candidate Selector** | Implement `selectChallengeCandidates()`: filter for items last tested > 1 day ago; fallback to daily conversational vocabulary. | `services/candidateSelector.ts` |
| **Step 3: Add Mock Service** | Add `mockChallengeService.ts` to simulate generation & evaluation offline without API keys. | `services/mockChallengeService.ts` |
| **Step 4: Drop in Mobile UI** | Copy `MobileTranslationChallenge.tsx` directly into your views or components. | `components/MobileTranslationChallenge.tsx` |
| **Step 5: Verify Mobile Ergonomics** | Test on mobile viewport (360px–430px): check touch targets (≥ 44px), virtual keyboard typing, and audio buttons. | In-browser DevTools Device Mode |
| **Step 6: Wire SRS Persistence** | Connect `evaluation.augmentedWords` (+30/+10 points) and update `lastAppearedAt = new Date().toISOString()` in your DB. | Storage Layer |
| **Step 7: Connect Real LLM** | Replace mock generation with the Mode A / Mode B prompt, giving the LLM 100% freedom to invent any realistic context and select common everyday sentences (zero hardcoded topics). | `server.ts` or API endpoint |
| **Step 8: Direct LLM Evaluation** | In evaluation pipeline, consume `incorporatedTargetWord` and `incorporatedVocabClues` directly from the LLM response without adding secondary programmatic regex validation gates that cause false negatives. | `challengeService.ts` / `server.ts` |

