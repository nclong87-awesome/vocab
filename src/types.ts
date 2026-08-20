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
  autoPlayAudioInQuiz: boolean;
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
  | 'flashcard_review';

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
  imageKeyword?: string;
  imageUrl?: string;
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

export interface FlashcardItem {
  wordId?: string;
  word: string;
  pronunciation?: string;
  partOfSpeech?: string;
  definition: string;
  translation: string;
  example?: string;
  exampleTranslation?: string;
  category?: string;
  context?: string;
  suggestedWords?: SuggestedPairedWord[];
  imageKeyword?: string;
  imageUrl?: string;
  previousStrength?: number;
  newStrength?: number;
  strengthGained?: number;
}

export interface FlashcardData {
  cards?: FlashcardItem[];
  wordId?: string;
  word?: string;
  pronunciation?: string;
  partOfSpeech?: string;
  definition?: string;
  translation?: string;
  category?: string;
  context?: string;
  example?: string;
  exampleTranslation?: string;
  extraExampleSentences?: {
    sentence: string;
    translation: string;
    contextCategoryNote?: string;
  }[];
  usageNotes?: string;
  imageUrl?: string;
  imageKeyword?: string;
  suggestedVocabulary?: SuggestedVocabularyWord[];
  suggestedWords?: (string | SuggestedPairedWord)[];
  previousStrength?: number;
  newStrength?: number;
  strengthGained?: number;
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
  flashcardData?: FlashcardData;
  quizFinishedData?: QuizFinishedData;
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
