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
import { speakText as speakTextService } from "../utils/ttsService";
import { isWordInCollection } from "../utils/wordNormalization";

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
  }, []);

  const handleAddCustomWord = useCallback((
    wordData: Omit<Word, "id" | "learned" | "strength" | "createdAt" | "lastReviewed"> & {
      createdAt?: string;
      lastReviewed?: string | null;
    },
    ttsConfig?: TTSConfig,
    llmConfig?: LLMConfig,
    targetLanguage?: string
  ) => {
    setWords(prev => {
      const exists = isWordInCollection(prev, wordData.word);
      if (exists) {
        console.warn(`Word "${wordData.word}" already exists in collection (exact or singular/plural). Skipping duplicate.`);
        return prev;
      }
      const newWord: Word = recordStrengthHistory(
        {
          ...wordData,
          id: `manual-word-${Date.now()}`,
          learned: false,
          starred: wordData.starred || false,
          createdAt: new Date().toISOString(),
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
        setTimeout(() => {
          const textToSpeak = newWord.definition && newWord.definition.trim()
            ? `${newWord.word}. ${newWord.definition}`
            : (newWord.translation && newWord.translation.trim() ? `${newWord.word}. ${newWord.translation}` : newWord.word);
          speakTextService(textToSpeak, ttsConfig, llmConfig, targetLanguage || "English");
        }, 150);
      }

      return updated;
    });
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

  const handleFinishQuiz = useCallback((
    score: number, 
    _total: number, 
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
  }, []);

  return {
    words,
    setWords,
    stats,
    setStats,
    handleToggleStar,
    handleToggleLearned,
    handleAddCustomWord,
    handleDeleteWord,
    handleUpdateWords,
    handleFinishQuiz,
  };
}
