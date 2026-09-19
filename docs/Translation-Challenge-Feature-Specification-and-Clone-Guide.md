# Translation Challenge Feature: Comprehensive Specification & Clone Guide

> **Core Language Pair**:
> - **Native Language**: Vietnamese (`vi` / Tiếng Việt)
> - **Target Language**: English (`en` / Tiếng Anh)
>
> This specification is written with **Vietnamese as the native language** and **English as the target language**. Learners are presented with natural, everyday conversational Vietnamese sentences and challenged to produce accurate, idiomatic English translations that incorporate priority vocabulary from their personal collection. All prompt templates, evaluation heuristics, mock responses, and UI strings in this guide reflect this Vietnamese-to-English setup.

This specification provides everything required to clone the **Translation Challenge** feature from this application into another web or mobile app. It includes architecture diagrams, TypeScript schemas, complete mock LLM responses, evaluation rubrics, prompt engineering templates, state/SRS integration logic, and a standalone mock service to enable immediate plug-and-play development without API keys.

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

## 6. UI/UX Blueprint & Best Practices

The user interface consists of two synchronized view states:

### 1. Challenge Prompt View (Before Submission)
- **Top Badge**: Displays category/topic label (e.g., `Ý chí & Vượt khó` or `Workplace Discussions`).
- **Prompt Sentence**: Rendered in prominent font (18-20px) with quotation marks and an instant audio playback button (`Volume2`).
- **Collapsible Clues**: A "Vocab Hints" drawer listing 3-5 `keyTargetWords`. Each item features:
  - Pronounce audio button.
  - In-collection indicator badge (e.g., "Saved" vs "Add +").
- **Ask AI Button**: Directly launches an interactive assistant modal to explain vocabulary nuance without spoiling the answer.

### 2. Evaluation Feedback View (After Submission)
- **Score Showcase Banner**:
  - Distinct score block: Big bold numeric pill (`94/100`).
  - 3 qualitative color tiers:
    - **Good (80-100)**: Emerald palette (`bg-emerald-600`), icon `CheckCircle2` or `Trophy`.
    - **So-so (60-79)**: Amber palette (`bg-amber-500`), icon `TrendingUp`.
    - **Needs Work (<60)**: Rose palette (`bg-rose-600`), icon `AlertTriangle`.
  - Continuous 3-zone color meter showing exact position.
- **Side-by-Side Comparison**:
  - `Your Submission` (neutral stone card).
  - `Ideal Target Translation` (emerald card with one-click audio).
- **Target Word Incorporation Celebration Banner**:
  - Renders when `incorporatedTargetWord === true`.
  - Shows `+30 Strength Points` badge, with before/after progress (e.g. `25% → 55%`).
- **Vocab Clues Boost Banner**:
  - Celebrates any additional vocabulary words from the user's collection used in the sentence with `+30 points` each.
- **Review Banners**:
  - Displays what went well & areas for improvement.
- **Mined Suggested Vocabulary**:
  - Grid of extracted words from the challenge. Each item has a 1-click **"Add to collection"** button so users can harvest new words.

---

## 7. Step-by-Step Clone Checklist for Any New App

| Step | Action | Files Needed |
| :--- | :--- | :--- |
| **Step 1** | Copy TypeScript interfaces into your types system. | `types.ts` |
| **Step 2** | Add `mockChallengeService.ts` to provide immediate offline and local preview testing. | `services/mockChallengeService.ts` |
| **Step 3** | Implement UI components for **Prompt Card** and **Evaluation Feedback**. | `components/TranslationChallengeCard.tsx` |
| **Step 4** | Hook submission handler into your chat or quiz screen, updating state on `"incomplete"` or `"submission"`. | `hooks/useChallenge.ts` |
| **Step 5** | Wire Spaced Repetition (SRS) DB updates: Add `+30` strength when `incorporatedTargetWord` is true, and save to LocalStorage or DB. | Storage / State Layer |
| **Step 6** | Connect real LLM endpoint (Gemini / OpenAI / Anthropic) by swapping the mock service for the server prompt handler. | `server.ts` or API route |
