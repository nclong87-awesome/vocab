export type TTSEngine = 'browser' | 'gemini' | 'openai' | 'custom';

export interface TTSConfig {
  engine: TTSEngine;
  voiceURI?: string;
  speed: number;
  pitch: number;
  model: string;
  voice: string;
  apiKey?: string;
  customEndpoint?: string;
  autoPlayAudioInChat: boolean;
  autoPlayAudioInQuiz?: boolean;
  autoPlayAudioOnWordAdded?: boolean;
}

export type LLMProvider = 'ollama' | 'openai' | 'groq' | 'openrouter' | 'gemini' | '9flare' | 'cloudflare' | 'custom' | (string & {});

export interface LLMProviderOption {
  id: LLMProvider;
  name: string;
  tagline: string;
  defaultModel: string;
  models: string[];
  visionModels?: string[];
  tts_models?: string[];
  defaultBaseUrl?: string;
  directBaseUrl?: string;
  requiresKey: boolean;
}

export interface SavedProviderConfig {
  provider: LLMProvider;
  model: string;
  apiKey: string;
  baseUrl?: string;
  isLoggedIn: boolean;
  useProxy?: boolean;
  lastUsedAt?: string;
}

export type SavedProvidersMap = Record<string, SavedProviderConfig>;

export interface LLMConfig {
  provider: LLMProvider;
  model: string;
  apiKey: string;
  baseUrl?: string;
  isLoggedIn: boolean;
  useProxy?: boolean;
  savedProviders?: SavedProvidersMap;
  preferredProvider?: string;
  preferredModel?: string;
}

export type StrengthHistoryReason = 
  | 'created' 
  | 'quiz_correct' 
  | 'quiz_incorrect' 
  | 'mastered' 
  | 'unmastered' 
  | 'memory_decay' 
  | 'manual_adjust' 
  | 'immersion_review'
  | 'study_method';

/**
 * Compact tuple representation for persistent storage and cloud sync:
 * [timestampSec (Unix timestamp in seconds), strength (0-100), reason]
 * Example: [1724131200, 50, "quiz_correct"]
 */
export type StrengthHistoryTuple = [
  timestampSec: number,
  strength: number,
  reason: StrengthHistoryReason
];

/**
 * Rich UI object representation computed on-the-fly from tuples.
 */
export interface StrengthHistoryEntry {
  id: string;
  timestamp: string;
  strength: number;
  delta?: number;
  reason: StrengthHistoryReason;
  note?: string;
}

export interface Word {
  id: string;
  word: string;
  pronunciation: string | undefined;
  partOfSpeech: string;
  definition: string;
  translation: string;
  example: string | undefined;
  exampleTranslation: string | undefined;
  learned: boolean;
  starred: boolean;
  createdAt: string;
  lastReviewed: string | null;
  nextReviewDate?: string | null; // Exact ISO timestamp when this word becomes eligible for next review/quiz
  strength: number; // 0 to 100
  imageUrl?: string;
  imageUrls?: string[]; // Field to store word's image URLs
  imageKeyword?: string;
  category?: string;
  context?: string;
  suggestedWords?: (string | { word: string; translation?: string; definition?: string; hint?: string })[];
  strengthHistory?: StrengthHistoryTuple[];
}

export interface WordSense {
  word?: string;
  partOfSpeech: string;
  definition: string;
  translation: string;
  pronunciation: string;
  example: string;
  exampleTranslation: string;
  imageKeyword: string;
  imageUrl?: string;
  imageUrls?: string[];
  category?: string;
  context?: string;
  suggestedWords?: (string | { word: string; translation?: string; definition?: string; hint?: string })[];
}



export interface QuizSuggestedWord {
  word: string;
  translation?: string;
  hint?: string;
  pairedWith?: string;
  relationship?: string;
  partOfSpeech?: string;
}

export interface QuizFinishedData {
  score: number;
  total: number;
  accuracy: number;
  suggestedWords?: QuizSuggestedWord[];
  testedWordIds?: string[];
}

export interface QuizQuestion {
  id: string;
  wordId: string;
  word: string;
  type: 'definition' | 'translation' | 'sentence' | 'spelling' | 'listening' | 'picture';
  question: string;
  options?: string[]; // For multiple choice
  correctAnswer: string;
  hint?: string;
  sentence?: string; // Complete sentence with target word
  sentenceTranslation?: string; // Full sentence translation in native language
  imageKeyword?: string;
  imageUrl?: string;
  imageUrls?: string[];
  suggestedWords?: (string | QuizSuggestedWord | SuggestedPairedWord)[];
}

export interface Streak {
  count: number;
  lastActiveDate: string; // YYYY-MM-DD
  history: string[]; // List of YYYY-MM-DD strings
}

export interface UserStats {
  totalWordsStudied?: number;
  totalWordsMastered?: number;
  totalQuizzesTaken: number;
  totalCorrectAnswers: number;
  streak: Streak;
}

export interface SuggestedVocabularyWord {
  word: string;
  translation: string;
  partOfSpeech?: string;
  definition?: string;
  hint?: string;
}

export interface SuggestedPairedWord {
  word: string;
  translation: string;
  relationship?: string;
  hint?: string;
  partOfSpeech?: string;
  phrase?: string;
}

export interface ApiRequestLog {
  id: string;
  timestamp: string; // ISO string
  provider: string;
  model: string;
  action?: string; // e.g. "Chat", "Autofill Word", "Definition Lookup", "Grammar Check", "Quiz Generator", "Test Connection", etc.
  prompt: string;
  systemInstruction?: string;
  schemaDescription?: string;
  response: string;
  rawResponse?: string;
  responseTimeMs: number;
  status: 'success' | 'error';
  statusCode?: number;
  errorMessage?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  suggestedActions?: { label: string; action: string; payload?: any }[];
  audioWord?: string;
  imageUrl?: string;
  imageKeyword?: string;
  quizSpeechText?: string;
  nextQuestionSpeechText?: string;
  fixedSentence?: string;
  storyData?: ImmersionStory;
  quizFinishedData?: QuizFinishedData;
  wordLibraries?: boolean;
  answeredQuizWordId?: string;
  suggestedReplies?: {
    reply: string;
    translation: string;
    tone: string;
    explanation: string;
  }[];
  provider?: string;
  model?: string;
  responseTimeMs?: number;
  isError?: boolean;
  errorInfo?: {
    message: string;
    provider?: string;
    model?: string;
    isTimeout?: boolean;
    canRetry?: boolean;
  };
}

export type LearnerArchetype =
  | "Pragmatic Professional"
  | "Curious Explorer"
  | "Meticulous Perfectionist"
  | "Casual Conversationalist"
  | "Academic Achiever";

export interface UserPersonalityProfile {
  version: number;
  lastUpdated: number;
  interactionCountAnalyzed: number;
  confidenceScore: number; // 0 - 100
  archetype: LearnerArchetype;
  archetypeSummary: string;
  archetypeTraits: string[];
  learningPreferences: {
    primaryModality: "contextual_examples" | "grammar_mechanics" | "visual_mnemonics" | "etymological_roots";
    explanationDepth: "punchy_concise" | "deep_nuance" | "dialogue_driven";
    formalityPreference: "formal" | "business_casual" | "relaxed_slang";
    challengeAttitude: "gentle_scaffolding" | "direct_critique" | "fast_paced_gamified";
  };
  detectedInterests: string[];
  frequentQuestionTypes: ("nuance_comparison" | "collocations" | "pronunciation" | "grammar" | "formality" | "usage_context")[];
  diagnostics: {
    strengths: string[];
    blindSpots: string[];
    actionableAdvice: string;
  };
  tailoredSystemPromptPatch: string;
  modelUsed?: string;
  providerUsed?: string;
}

// ==========================================
// Advanced Science-Backed Learning Methods
// ==========================================

export type StudyMethodTab = 
  | "goldlist" 
  | "immersion" 
  | "palace" 
  | "wrap" 
  | "physical" 
  | "guide";

// 1. Goldlist Method Types
export interface GoldlistDistillationTier {
  tierNumber: number; // 0 = Headlist, 1 = Bronze, 2 = Silver, 3 = Gold (Mastered)
  title: string;
  wordIds: string[];
  createdAt: string;
  gestationUntilDate: string; // 14 days from creation
  isReadyForDistillation: boolean;
  testedAt?: string;
  retainedWordIds?: string[];
  distilledWordIds?: string[];
}

export interface GoldlistNotebook {
  id: string;
  title: string;
  targetLanguage: string;
  nativeLanguage: string;
  createdAt: string;
  headlistWords: Word[];
  tiers: GoldlistDistillationTier[];
  notes?: string;
  status: "gestating" | "ready_to_distill" | "completed";
}

// 2. Contextual Immersion & Dual Reader Types
export interface ImmersionStoryWord {
  word: string;
  targetInStory: string;
  translation: string;
  definition?: string;
  pronunciation?: string;
  partOfSpeech?: string;
  isCollectionWord?: boolean;
}

export interface ImmersionStoryParagraph {
  id: string;
  targetText: string;
  nativeText: string;
  audioText?: string;
}

export interface ImmersionStory {
  id: string;
  title: string;
  titleTranslation: string;
  topic: string;
  genre: string;
  difficulty: "beginner" | "intermediate" | "advanced";
  targetLanguage: string;
  nativeLanguage: string;
  targetWords: ImmersionStoryWord[];
  suggestedWords?: ImmersionStoryWord[];
  paragraphs: ImmersionStoryParagraph[];
  provider?: string;
  model?: string;
  responseTimeMs?: number;
  createdAt: string;
}

export interface MinedSentence {
  id: string;
  targetSentence: string;
  translation: string;
  sourceStoryTitle?: string;
  minedWords: string[];
  createdAt: string;
  userNotes?: string;
}

// 3. Mnemonics & Memory Palace Types
export interface KeywordMnemonic {
  wordId?: string;
  word: string;
  translation: string;
  pronunciation?: string;
  keywordSoundAlike: string; // Native phonetic sound-alike (e.g., "pajama" for "pájaro")
  vividImageryStory: string; // Vivid, absurd memorable story
  humorousVisualCue: string; // Short visual snapshot prompt
  stationRecommendation?: string; // e.g. "Kitchen Fridge", "Front Door"
}

export interface PalaceStation {
  id: string;
  name: string; // e.g. "Front Porch", "Cozy Sofa", "Coffee Machine", "Balcony View"
  icon: string;
  order: number;
  wordId?: string;
  word?: string;
  translation?: string;
  mnemonic?: KeywordMnemonic;
  visualAnchorNote?: string;
}

export interface MemoryPalace {
  id: string;
  name: string;
  theme: "home" | "cafe" | "library" | "villa" | "scifi";
  description: string;
  stations: PalaceStation[];
  createdAt: string;
  lastWalkedAt?: string;
}

// 4. WRAP Studio & Deep Processing Types
export interface WrapStepState {
  wordId: string;
  word: string;
  translation: string;
  writtenText: string; // W - Write
  repeatAudioCount: number; // R - Repeat
  personalAssociation: string; // A - Associate
  visualSceneDescription: string; // P - Picture
  completedAt?: string;
}

export interface SentenceEvaluation {
  score: number; // 0 - 100
  naturalness: "Natural & Native-like" | "Grammatically Correct but Stiff" | "Contains Minor Nuance Flaws" | "Needs Correction";
  feedback: string;
  polishedSentence: string;
  alternativeVariations?: string[];
  collocationTips?: string;
  grammarNotes?: string;
}

export interface TargetWordMission {
  id: string;
  title: string;
  scenario: string;
  aiRole: string;
  userRole: string;
  targetWords: { word: string; translation: string; used: boolean }[];
  suggestedOpening: string;
}

// 5. Physical Environment & Real-World Utility Types
export interface StickyNoteItem {
  id: string;
  word: string;
  translation: string;
  pronunciation: string;
  partOfSpeech: string;
  contextSentence: string;
  roomAffixLocation: string; // e.g. "Affix to Microwave", "Affix to Bathroom Mirror"
  tips?: string;
}

export interface RealWorldUtilityList {
  id: string;
  type: "grocery" | "todo" | "device_ui" | "restaurant_menu";
  title: string;
  items: {
    targetText: string;
    nativeText: string;
    category?: string;
    phonetic?: string;
    actionHint?: string;
    checked?: boolean;
  }[];
}
