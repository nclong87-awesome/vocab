# Translation Challenge Feature: Comprehensive Specification & Clone Guide

> **Core Language Pair**:
> - **Native Language**: Vietnamese (`vi` / Tiếng Việt)
> - **Target Language**: English (`en` / Tiếng Anh)
>
> **Core Strategy: Mobile-First & Keep It Simple**:
> - **Mobile-First Priority**: Language learners primarily practice on smartphones in short, focused bursts. Start by implementing a clean, vertical single-column mobile layout (360px–430px viewport) with touch-friendly controls (≥ 44px tap targets), sticky thumb-level action buttons, and soft-keyboard-resilient containers before considering desktop expansion.
> - **Simplicity First**: Do not build complex sidebars, nested modal dialogs, or heavy multi-page routers. All interactions (prompt, hints, input, evaluation, vocab reward) fit cleanly within a single mobile card/screen stream.
>
> This specification is written with **Vietnamese as the native language** and **English as the target language**. Learners are presented with natural, everyday conversational Vietnamese sentences and challenged to produce accurate, idiomatic English translations that incorporate priority vocabulary from their personal collection. All prompt templates, evaluation heuristics, mock responses, and UI strings in this guide reflect this Vietnamese-to-English setup.

This specification provides everything required to clone the **Translation Challenge** feature from this application into another web or mobile app. It includes architecture diagrams, TypeScript schemas, complete mock LLM responses, evaluation rubrics, prompt engineering templates, state/SRS integration logic, a complete drop-in mobile React component, and a standalone mock service to enable immediate plug-and-play development without API keys.

---

## 1. Feature Overview & Architecture

### What is the Translation Challenge?
The **Translation Challenge** is an AI-powered interactive language acquisition feature that prompts learners to translate natural, conversational sentences from their native language into a target language, specifically engineered to reinforce vocabulary items from their personal collection.

Unlike generic quiz engines:
1. **Vocabulary-Anchored Generation**: Challenges prioritize words in the user's collection that have low memory strength or are due for review based on Spaced Repetition (SRS).
2. **Native-First Conversational Naturalness**: Prompts are generated directly in natural native prose (not translated backward from textbook English), preventing "machine-translation flavor".
3. **Multi-Turn Resilience**:
   - Detects accidental/incomplete submissions (e.g., pressed Enter prematurely).
   - Handles empty submissions / "Reveal Answer & Skip" gracefully.
   - Accepts diverse valid phrasings and synonyms while strictly tracking whether the designated target word was incorporated.
4. **Memory Strength Augmentation**: Awards SRS point bonuses (+30 points for incorporating target word, +10 for exposure, +30 for using vocabulary clues) and atomically updates the user's database.
5. **Interactive Tutoring**: Includes an "Ask AI about this question" modal for contextual follow-up questions.

### Architecture Flowchart

```
┌────────────────────────────────────────────────────────────────────────┐
│ 1. GENERATION PHASE                                                    │
│                                                                        │
│   User Collection (SRS) ──────► Candidate Picker (Low Strength/Due)    │
│                                           │                            │
│                                           ▼                            │
│   LLM Prompt Builder ◄────── User Profile (Archetype/Interests)        │
│          │                                                             │
│          ▼                                                             │
│   LLM Generation (or Mock) ──► JSON Sanitizer & Loanword Cleaner       │
│                                           │                            │
│                                           ▼                            │
│   Active Challenge State ◄──── Challenge Card (Prompt UI)              │
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
│   Target Word & Clue Matcher ──► Programmatic Word Presence Gate       │
│          │                                                             │
│          ▼                                                             │
│   SRS Augmentation (+30/+10) ──► Atomically Update Collection DB       │
│          │                                                             │
│          ▼                                                             │
│   Evaluation Card (Feedback UI) ──► Audio TTS / Add New Vocab / Ask AI │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Core Data Models & TypeScript Contracts

Save these interfaces into your new app's `types.ts`:

```typescript
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
  topicContext?: string;
  idealTranslation?: string;
  keyTargetWords?: ChallengeKeyWord[];
  targetWordFromCollection?: {
    id?: string;
    word: string;
    translation?: string;
    definition?: string;
    hint?: string;
    strength?: number;
    partOfSpeech?: string;
  };
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

You can directly add this file to your new project to simulate the full backend without an LLM API:

```typescript
// mockChallengeService.ts
import { ChallengeData, ChallengeTurnResult } from "./types";

const MOCK_CHALLENGES: ChallengeData[] = [
  {
    id: "challenge-mock-001",
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
    },
    keyTargetWords: [
      { word: "resilience", translation: "sự kiên cường" },
      { word: "setback", translation: "sự trở ngại" },
      { word: "admirable", translation: "đáng khâm phục" },
      { word: "maintain", translation: "duy trì" },
    ],
    personalityNote: "Tình huống rèn luyện từ vựng miêu tả phẩm chất ý chí trong đời thực.",
    createdAt: new Date().toISOString(),
    provider: "mock",
    model: "mock-llm-v1",
    responseTimeMs: 300,
  },
  {
    id: "challenge-mock-002",
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
    },
    keyTargetWords: [
      { word: "tweak", translation: "tinh chỉnh" },
      { word: "slightly", translation: "một chút" },
      { word: "adapt to", translation: "thích nghi với" },
      { word: "circumstances", translation: "hoàn cảnh, tình thế" },
    ],
    personalityNote: "Học cách diễn đạt linh hoạt trong các buổi thảo luận công việc thường ngày.",
    createdAt: new Date().toISOString(),
    provider: "mock",
    model: "mock-llm-v1",
    responseTimeMs: 280,
  }
];

export async function mockGenerateChallenge(): Promise<ChallengeData> {
  // Simulate network latency
  await new Promise((res) => setTimeout(res, 400));
  const randomIndex = Math.floor(Math.random() * MOCK_CHALLENGES.length);
  return {
    ...MOCK_CHALLENGES[randomIndex],
    id: `challenge-${Date.now()}`,
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
  const targetWord = challenge.targetWordFromCollection?.word?.toLowerCase() || "";
  const didIncorporate = targetWord ? lower.includes(targetWord) : false;
  const score = didIncorporate ? 92 : 75;

  return {
    intent: "submission",
    evaluation: {
      score,
      scoreLabel: didIncorporate ? "Xuất sắc! 🌟" : "Làm tốt lắm! 👏",
      userTranslation: trimmed,
      incorporatedTargetWord: didIncorporate,
      targetWordUsed: challenge.targetWordFromCollection?.word,
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
```text
System Instruction:
You are an expert bilingual translation coach. Create a concise, authentic, and culturally natural conversational challenge for a language learner. 
Strict Mandates:
1. 'nativeSentence' MUST be 100% natural, everyday spoken native language (6-14 words).
2. ZERO loanwords or untranslated target-language terms inside 'nativeSentence'.
3. Do NOT provide 'idealTranslation' during generation if target is English; allow native-first thinking.
4. MUST choose one exact word from the provided candidates list as 'targetWordFromCollection'.

Prompt Template:
Generate a translation challenge for a learner whose native language is {{nativeLanguage}} learning {{targetLanguage}}.

LEARNER CANDIDATE VOCABULARY (FROM DATABASE):
{{#each candidates}}
- "{{this.word}}" (meaning: {{this.translation}}) [Strength: {{this.strength}}%]
{{/each}}

OUTPUT SCHEMA (STRICT JSON ONLY):
{
  "nativeSentence": "Natural spoken native sentence (6-14 words)",
  "topicContext": "2-4 word topic label (e.g. 'Coffee Shop Encounter')",
  "targetWordFromCollection": {
    "word": "Verbatim word from candidate list",
    "translation": "Native meaning in context",
    "hint": "Brief usage hint"
  },
  "keyTargetWords": [
    { "word": "target_term", "translation": "native_meaning", "hint": "part_of_speech" }
  ],
  "personalityNote": "Why this sentence and vocabulary is useful in daily life"
}
```

### 5.2 Challenge Evaluation Prompt
```text
System Instruction:
You are an AI Translation Challenge Evaluation Coach. Evaluate translation attempts in strict JSON output. Check whether the learner incorporated the designated target word or if the answer is incomplete.

Prompt Template:
Evaluate the user's translation attempt.

CHALLENGE DETAILS:
- Native Sentence: "{{challenge.nativeSentence}}"
- Designated Target Word: "{{challenge.targetWordFromCollection.word}}"
- Key Target Words: {{json challenge.keyTargetWords}}
- Target Language: {{targetLanguage}}
- Native Language: {{nativeLanguage}}

USER SUBMISSION:
"{{userSubmission}}"

EVALUATION RULES:
1. If the submission is an incomplete sentence fragment (premature submission), return intent: "incomplete".
2. If submitted normally, return intent: "submission" and evaluate:
   - Provide optimal native phrasing in "correctedSentence" incorporating the target word.
   - Calculate accuracy score (0-100).
   - Check if the learner typed the designated target word. If they used an alternative valid synonym, award a high score and praise their natural choice in "whatWentWell", but set "incorporatedTargetWord": false.
   - Extract 3-5 vocabulary items with definitions and examples in "suggestedVocabulary".

OUTPUT SCHEMA (STRICT JSON ONLY):
{
  "intent": "submission" | "incomplete",
  "agentReply": "String explanation if incomplete",
  "evaluation": {
    "score": 85,
    "scoreLabel": "Great Job! 👏",
    "userTranslation": "{{userSubmission}}",
    "incorporatedTargetWord": true,
    "targetWordUsed": "{{targetWord}}",
    "whatWentWell": "Detailed positive feedback in native language...",
    "areasForImprovement": "Constructive tips on grammar, nuance, or prepositions...",
    "correctedSentence": "Optimal target translation...",
    "suggestedVocabulary": [
      {
        "word": "term",
        "translation": "native meaning",
        "definition": "definition",
        "partOfSpeech": "noun/verb",
        "example": "example sentence",
        "exampleTranslation": "translation of example"
      }
    ]
  }
}
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
      {/* Top Bar: Topic & Audio */}
      <header className="flex items-center justify-between gap-2 mb-3">
        <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">
          🎯 {challenge.topicContext || "Luyện dịch ngữ cảnh"}
        </span>
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
              <span>💡 Gợi ý từ vựng ({challenge.keyTargetWords.length} từ)</span>
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
| **Step 1: Setup Types** | Copy TypeScript interfaces into your types system. | `types.ts` |
| **Step 2: Add Mock Service** | Add `mockChallengeService.ts` to simulate generation & evaluation offline without API keys. | `services/mockChallengeService.ts` |
| **Step 3: Drop in Mobile UI** | Copy `MobileTranslationChallenge.tsx` directly into your views or components. | `components/MobileTranslationChallenge.tsx` |
| **Step 4: Verify Mobile Ergonomics** | Test on mobile viewport (360px–430px): check touch targets (≥ 44px), virtual keyboard typing, and audio buttons. | In-browser DevTools Device Mode |
| **Step 5: Wire SRS Persistence** | Connect `evaluation.augmentedWords` (+30/+10 points) to your local SQLite/IndexedDB or LocalStorage. | Storage Layer |
| **Step 6: Connect Real LLM** | When ready, replace the mock service calls with your real backend API route (Gemini / Claude / OpenAI). | `server.ts` or API endpoint |

