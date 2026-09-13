import { useState, useCallback } from "react";
import { Word, UserStats, TTSConfig, LLMConfig } from "../types";
import { calculateNewStreak } from "../utils";
import { 
  saveWordToDB, 
  saveAllWordsToDB, 
  deleteWordFromDB, 
  saveStatsToDB 
} from "../db/indexedDB";
import { recordStrengthHistory } from "../utils/strengthHistoryHelpers";
import { speakText as speakTextService, registerSpeechTimer } from "../utils/ttsService";
import { isWordInCollection, isPhrasalVerb, normalizeWordCategory, normalizeWordPartOfSpeech, areWordsEquivalent } from "../utils/wordNormalization";
import { recordLearningInteraction } from "../services/userPersonalityProfileService";

export function useVocabulary() {
  const [words, setWords] = useState<Word[]>([]);
  const [stats, setStats] = useState<UserStats>({
    totalQuizzesTaken: 0,
    totalCorrectAnswers: 0,
    streak: { count: 0, lastActiveDate: "", history: [] }
  });

  const handleToggleStar = useCallback((wordId: string) => {
    setWords(prevWords => {
      return prevWords.map(w => {
        if (w.id === wordId) {
          const updated = { ...w, starred: !w.starred };
          saveWordToDB(updated).catch(e => console.error("IndexedDB star save error:", e));
          return updated;
        }
        return w;
      });
    });
  }, []);

  const handleToggleLearned = useCallback((wordId: string) => {
    setWords(prevWords => {
      return prevWords.map(w => {
        if (w.id === wordId) {
          const isNowMastered = !w.learned;
          const targetStrength = isNowMastered ? 100 : 0;
          const reason = isNowMastered ? 'mastered' : 'unmastered';
          const updated = recordStrengthHistory(w, targetStrength, reason);
          saveWordToDB(updated).catch(e => console.error("IndexedDB learned save error:", e));
          return updated;
        }
        return w;
      });
    });

    setStats(prevStats => {
      const updatedStreak = calculateNewStreak(prevStats.streak);
      const newStats = {
        ...prevStats,
        streak: updatedStreak
      };
      saveStatsToDB(newStats).catch(e => console.error("IndexedDB stats save error:", e));
      return newStats;
    });

    recordLearningInteraction("word_learned", { wordId });
  }, []);

  const handleAddCustomWord = useCallback((
    wordData: Omit<Word, "id" | "learned" | "strength" | "createdAt" | "lastReviewed"> & {
      id?: string;
      createdAt?: string;
      lastReviewed?: string | null;
    },
    ttsConfig?: TTSConfig,
    llmConfig?: LLMConfig,
    targetLanguage?: string
  ) => {
    setWords(prev => {
      const defaultUrls = wordData.imageUrls && wordData.imageUrls.length > 0
        ? wordData.imageUrls
        : (wordData.imageUrl ? [wordData.imageUrl] : undefined);

      const isPv = isPhrasalVerb(wordData.word, wordData.partOfSpeech, wordData.category);
      const normalizedPos = normalizeWordPartOfSpeech(wordData.partOfSpeech, wordData.word, wordData.category);
      const normalizedCategory = isPv
        ? normalizeWordCategory(wordData.category, wordData.word, normalizedPos)
        : (wordData.category || "General");

      // Check if word already exists in collection (including incomplete words)
      const existingIndex = prev.findIndex(w => 
        (wordData.id && w.id === wordData.id) || areWordsEquivalent(w.word, wordData.word)
      );

      if (existingIndex >= 0) {
        const existingWord = prev[existingIndex];
        const updatedWord: Word = {
          ...existingWord,
          ...wordData,
          id: existingWord.id,
          completed: true, // Marked as fully completed
          partOfSpeech: normalizedPos,
          category: normalizedCategory,
          imageUrls: defaultUrls || existingWord.imageUrls,
          imageUrl: wordData.imageUrl || defaultUrls?.[0] || existingWord.imageUrl,
          learned: existingWord.learned || false,
          starred: wordData.starred !== undefined ? wordData.starred : existingWord.starred,
          lastReviewed: existingWord.lastReviewed || null,
        };
        const updated = [...prev];
        updated[existingIndex] = updatedWord;
        saveAllWordsToDB(updated).catch(e => console.error("IndexedDB complete word save error:", e));

        // Auto-play audio if autoPlayAudioInChat setting is enabled
        const isAutoPlayEnabled = ttsConfig?.autoPlayAudioInChat ?? ttsConfig?.autoPlayAudioOnWordAdded ?? true;
        if (ttsConfig && isAutoPlayEnabled && updatedWord.word) {
          const timerId = window.setTimeout(() => {
            const textToSpeak = updatedWord.definition && updatedWord.definition.trim()
              ? `${updatedWord.word}. ${updatedWord.definition}`
              : (updatedWord.translation && updatedWord.translation.trim() ? `${updatedWord.word}. ${updatedWord.translation}` : updatedWord.word);
            speakTextService(textToSpeak, ttsConfig, llmConfig, targetLanguage || "English");
          }, 150);
          registerSpeechTimer(timerId);
        }

        return updated;
      }

      const newWord: Word = recordStrengthHistory(
        {
          ...wordData,
          partOfSpeech: normalizedPos,
          category: normalizedCategory,
          imageUrls: defaultUrls,
          imageUrl: wordData.imageUrl || defaultUrls?.[0] || undefined,
          id: wordData.id || `manual-word-${Date.now()}`,
          learned: false,
          starred: wordData.starred || false,
          completed: true,
          createdAt: wordData.createdAt || new Date().toISOString(),
          lastReviewed: null,
          strength: 0
        },
        0,
        "created"
      );
      const updated = [newWord, ...prev];
      saveAllWordsToDB(updated).catch(e => console.error("IndexedDB add word save error:", e));

      // Auto-play audio if autoPlayAudioInChat setting is enabled
      const isAutoPlayEnabled = ttsConfig?.autoPlayAudioInChat ?? ttsConfig?.autoPlayAudioOnWordAdded ?? true;
      if (ttsConfig && isAutoPlayEnabled && newWord.word) {
        const timerId = window.setTimeout(() => {
          const textToSpeak = newWord.definition && newWord.definition.trim()
            ? `${newWord.word}. ${newWord.definition}`
            : (newWord.translation && newWord.translation.trim() ? `${newWord.word}. ${newWord.translation}` : newWord.word);
          speakTextService(textToSpeak, ttsConfig, llmConfig, targetLanguage || "English");
        }, 150);
        registerSpeechTimer(timerId);
      }

      return updated;
    });
  }, []);

  const handleAddIncompleteWord = useCallback((
    wordData: {
      word: string;
      translation?: string;
      definition?: string;
      partOfSpeech?: string;
      category?: string;
      context?: string;
      pronunciation?: string;
      example?: string;
      exampleTranslation?: string;
      suggestedWords?: any[];
    }
  ): Word | null => {
    let createdWord: Word | null = null;
    setWords(prev => {
      const exists = isWordInCollection(prev, wordData.word);
      if (exists) {
        return prev;
      }
      const isPv = isPhrasalVerb(wordData.word, wordData.partOfSpeech, wordData.category);
      const normalizedPos = normalizeWordPartOfSpeech(wordData.partOfSpeech, wordData.word, wordData.category);
      const normalizedCategory = isPv
        ? normalizeWordCategory(wordData.category, wordData.word, normalizedPos)
        : (wordData.category || "General");

      const newWord: Word = recordStrengthHistory(
        {
          id: `incomplete-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          word: wordData.word.trim(),
          pronunciation: wordData.pronunciation || undefined,
          partOfSpeech: normalizedPos,
          category: normalizedCategory,
          definition: wordData.definition || "",
          translation: wordData.translation || "",
          example: wordData.example || undefined,
          exampleTranslation: wordData.exampleTranslation || undefined,
          context: wordData.context || undefined,
          suggestedWords: wordData.suggestedWords || undefined,
          learned: false,
          starred: false,
          completed: false, // Mark as NOT completed
          createdAt: new Date().toISOString(),
          lastReviewed: null,
          strength: 0,
        },
        0,
        "created"
      );
      createdWord = newWord;
      const updated = [newWord, ...prev];
      saveAllWordsToDB(updated).catch(e => console.error("IndexedDB add incomplete word save error:", e));
      return updated;
    });
    return createdWord;
  }, []);

  const handleDeleteWord = useCallback((wordId: string) => {
    setWords(prev => {
      const targetWord = prev.find(w => w.id === wordId);
      const updated = prev.filter(w => w.id !== wordId);
      deleteWordFromDB(wordId, targetWord?.word).catch(e => console.error("IndexedDB delete word save error:", e));
      return updated;
    });
  }, []);

  const handleUpdateWords = useCallback((updatedWords: Word[]) => {
    setWords(updatedWords);
    saveAllWordsToDB(updatedWords).catch(e => console.error("IndexedDB update words error:", e));
  }, []);

  const handleUpdateSingleWord = useCallback((updatedWord: Word) => {
    setWords(prev => {
      const idx = prev.findIndex(w => w.id === updatedWord.id);
      if (idx === -1) return prev;
      const copy = [...prev];
      copy[idx] = updatedWord;
      saveWordToDB(updatedWord).catch(e => console.error("IndexedDB update single word error:", e));
      return copy;
    });
  }, []);

  const handleFinishQuiz = useCallback((
    score: number, 
    total: number, 
    correctWordIds?: string[], 
    incorrectWordIds?: string[]
  ) => {
    setWords(prevWords => {
      let updatedWords = [...prevWords];
      if (correctWordIds || incorrectWordIds) {
        updatedWords = updatedWords.map(word => {
          const originalId = word.id;
          const virtualId = `today-${word.id}`;
          
          if (correctWordIds?.includes(originalId) || correctWordIds?.includes(virtualId)) {
            const newStrength = Math.min(100, word.strength + 20);
            return recordStrengthHistory(word, newStrength, 'quiz_correct', 'Practiced in Quiz (Correct)');
          }
          if (incorrectWordIds?.includes(originalId) || incorrectWordIds?.includes(virtualId)) {
            const newStrength = Math.max(0, word.strength - 20);
            return recordStrengthHistory(word, newStrength, 'quiz_incorrect', 'Practiced in Quiz (Incorrect)');
          }
          return word;
        });
        saveAllWordsToDB(updatedWords).catch(e => console.error("IndexedDB quiz words save error:", e));
      }
      return updatedWords;
    });

    setStats(prevStats => {
      const updatedStreak = calculateNewStreak(prevStats.streak);

      const newStats = {
        ...prevStats,
        totalQuizzesTaken: prevStats.totalQuizzesTaken + 1,
        totalCorrectAnswers: prevStats.totalCorrectAnswers + score,
        streak: updatedStreak
      };
      saveStatsToDB(newStats).catch(e => console.error("IndexedDB stats save error:", e));
      return newStats;
    });

    recordLearningInteraction("quiz", { score, total });
  }, []);

  return {
    words,
    setWords,
    stats,
    setStats,
    handleToggleStar,
    handleToggleLearned,
    handleAddCustomWord,
    handleAddIncompleteWord,
    handleDeleteWord,
    handleUpdateWords,
    handleUpdateSingleWord,
    handleFinishQuiz,
  };
}
