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

export type LLMProvider = 'gemini' | 'openai' | 'anthropic' | 'groq' | 'openrouter' | 'custom' | (string & {});

export interface LLMProviderOption {
  id: LLMProvider;
  name: string;
  tagline: string;
  defaultModel: string;
  models: string[];
  defaultBaseUrl?: string;
  requiresKey: boolean;
}

export interface SavedProviderConfig {
  provider: LLMProvider;
  model: string;
  apiKey: string;
  baseUrl?: string;
  isLoggedIn: boolean;
  lastUsedAt?: string;
}

export type SavedProvidersMap = Record<string, SavedProviderConfig>;

export interface LLMConfig {
  provider: LLMProvider;
  model: string;
  apiKey: string;
  baseUrl?: string;
  isLoggedIn: boolean;
  savedProviders?: SavedProvidersMap;
}

export interface Word {
  id: string;
  word: string;
  pronunciation: string;
  partOfSpeech: string;
  definition: string;
  translation: string;
  example: string;
  exampleTranslation: string;
  learned: boolean;
  starred: boolean;
  createdAt: string;
  lastReviewed: string | null;
  strength: number; // 0 to 4 (representing levels of familiarity)
}

export interface Deck {
  id: string;
  name: string;
  description: string;
  words: Word[];
  isCustom: boolean;
  targetLanguage: string;
  nativeLanguage: string;
}

export interface QuizQuestion {
  id: string;
  wordId: string;
  word: string;
  type: 'definition' | 'translation' | 'sentence' | 'spelling' | 'listening';
  question: string;
  options?: string[]; // For multiple choice
  correctAnswer: string;
  hint?: string;
}

export interface Streak {
  count: number;
  lastActiveDate: string; // YYYY-MM-DD
  history: string[]; // List of YYYY-MM-DD strings
}

export interface UserStats {
  totalWordsStudied: number;
  totalWordsMastered: number;
  totalQuizzesTaken: number;
  totalCorrectAnswers: number;
  streak: Streak;
}
