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

export type LLMProvider = 'ollama' | 'openai' | 'groq' | 'openrouter' | 'custom' | (string & {});

export interface LLMProviderOption {
  id: LLMProvider;
  name: string;
  tagline: string;
  defaultModel: string;
  models: string[];
  tts_models?: string[];
  defaultBaseUrl?: string;
  directBaseUrl?: string;
  requiresKey: boolean;
}

export interface SavedProviderConfig {
  provider: LLMProvider;
  model: string;
  apiKey: string;
  proxyKey?: string;
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
  proxyKey?: string;
  baseUrl?: string;
  isLoggedIn: boolean;
  useProxy?: boolean;
  savedProviders?: SavedProvidersMap;
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
  strength: number; // 0 to 100
  imageUrl?: string;
  imageKeyword?: string;
  category?: string;
  context?: string;
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
}

export interface FlashcardData {
  wordId?: string;
  word: string;
  pronunciation?: string;
  partOfSpeech?: string;
  definition: string;
  translation: string;
  category?: string;
  context?: string;
  extraExampleSentences?: {
    sentence: string;
    translation: string;
    contextCategoryNote?: string;
  }[];
  usageNotes?: string;
  imageUrl?: string;
  imageKeyword?: string;
  suggestedVocabulary?: SuggestedVocabularyWord[];
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
  suggestedReplies?: {
    reply: string;
    translation: string;
    tone: string;
    explanation: string;
  }[];
  provider?: string;
  model?: string;
  responseTimeMs?: number;
}
