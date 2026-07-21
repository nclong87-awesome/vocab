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
  type: 'definition' | 'translation' | 'sentence' | 'spelling';
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
