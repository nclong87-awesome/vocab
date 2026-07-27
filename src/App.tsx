import { useState, useEffect, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";

import { Deck, Word, UserStats, LLMConfig, TTSConfig, LLMProvider } from "./types";
import { DEFAULT_DECKS } from "./defaultDecks";
import { calculateNewStreak } from "./utils";
import { switchActiveProvider } from "./utils/llmHelpers";
import { generateDeckService } from "./services/llmClientService";
import { 
  getAllDecksFromDB, 
  saveAllDecksToDB, 
  saveSingleDeckToDB,
  deleteDeckFromDB,
  getStatsFromDB, 
  saveStatsToDB, 
  getLLMConfigFromDB, 
  saveLLMConfigToDB,
  getTTSConfigFromDB,
  saveTTSConfigToDB
} from "./db/indexedDB";
import { DEFAULT_TTS_CONFIG } from "./utils/ttsService";

import Dashboard from "./components/Dashboard";
import FlashcardDeck from "./components/FlashcardDeck";
import QuizView from "./components/QuizView";
import DeckManager from "./components/DeckManager";
import SettingsView from "./components/SettingsView";
import AnalyticsDashboard from "./components/AnalyticsDashboard";
import LlmLoginModal from "./components/LlmLoginModal";

import AppHeader from "./components/layout/AppHeader";
import AppFooter from "./components/layout/AppFooter";

export default function App() {
  const [decks, setDecks] = useState<Deck[]>([]);
  const [selectedDeckId, setSelectedDeckId] = useState<string | null>(null);
  const [currentView, setCurrentView] = useState<"dashboard" | "learn" | "quiz" | "manage" | "analytics" | "settings">("dashboard");
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("");
  
  // LLM Provider Login Config state
  const [llmConfig, setLlmConfig] = useState<LLMConfig>({
    provider: "gemini",
    model: "gemini-3.6-flash",
    apiKey: "",
    isLoggedIn: true
  });

  // TTS Config state
  const [ttsConfig, setTtsConfig] = useState<TTSConfig>(DEFAULT_TTS_CONFIG);

  const [isLlmModalOpen, setIsLlmModalOpen] = useState<boolean>(false);

  const [stats, setStats] = useState<UserStats>({
    totalWordsStudied: 0,
    totalWordsMastered: 0,
    totalQuizzesTaken: 0,
    totalCorrectAnswers: 0,
    streak: { count: 0, lastActiveDate: "", history: [] }
  });

  const [isDataLoaded, setIsDataLoaded] = useState(false);

  // Initialize and load from IndexedDB on mount
  const reloadAllDataFromDB = async () => {
    try {
      const loadedDecks = await getAllDecksFromDB();
      setDecks(loadedDecks);

      const loadedStats = await getStatsFromDB({
        totalWordsStudied: 0,
        totalWordsMastered: 0,
        totalQuizzesTaken: 0,
        totalCorrectAnswers: 0,
        streak: { count: 0, lastActiveDate: "", history: [] }
      });
      setStats(loadedStats);

      const loadedConfig = await getLLMConfigFromDB({
        provider: "gemini",
        model: "gemini-3.6-flash",
        apiKey: "",
        isLoggedIn: true
      });

      const sanitizedProvider = loadedConfig.provider || "gemini";
      let sanitizedModel = loadedConfig.model || "gemini-3.6-flash";
      const validGeminiModels = [
        "gemini-3.6-flash",
        "gemini-3.6-flash-lite",
        "gemini-3.5-flash",
        "gemini-3.5-flash-lite",
        "gemini-2.5-flash",
        "gemini-2.5-pro",
        "gemini-2.5-flash-lite",
        "gemini-2.0-flash",
        "gemini-1.5-flash"
      ];
      if (sanitizedProvider === "gemini" && (sanitizedModel === "gemini-2.5-flash" || !validGeminiModels.includes(sanitizedModel))) {
        sanitizedModel = "gemini-3.6-flash";
      }

      const activeConfig: LLMConfig = {
        ...loadedConfig,
        provider: sanitizedProvider as any,
        model: sanitizedModel,
        isLoggedIn: loadedConfig.isLoggedIn || sanitizedProvider === "gemini"
      };

      setLlmConfig(activeConfig);
      await saveLLMConfigToDB(activeConfig);

      if (!activeConfig.isLoggedIn && activeConfig.provider !== "gemini") {
        setIsLlmModalOpen(true);
      }

      const loadedTTS = await getTTSConfigFromDB(DEFAULT_TTS_CONFIG);
      setTtsConfig(loadedTTS);
    } catch (e) {
      console.error("IndexedDB load error:", e);
      setDecks(DEFAULT_DECKS);
    } finally {
      setIsDataLoaded(true);
    }
  };

  useEffect(() => {
    reloadAllDataFromDB();
  }, []);

  useEffect(() => {
    if (isDataLoaded && (!llmConfig.isLoggedIn || !llmConfig.provider)) {
      setIsLlmModalOpen(true);
    }
  }, [llmConfig.isLoggedIn, llmConfig.provider, isDataLoaded]);

  const handleSaveTTSConfig = (newConfig: TTSConfig) => {
    setTtsConfig(newConfig);
    saveTTSConfigToDB(newConfig).catch(e => console.error("IndexedDB TTS save error:", e));
  };

  // Save decks to IndexedDB when changed
  const saveDecksToStorage = useCallback((updatedDecks: Deck[]) => {
    setDecks(updatedDecks);
    saveAllDecksToDB(updatedDecks).catch(e => console.error("IndexedDB deck save error:", e));
  }, []);

  // Word interactions (starred state)
  const handleToggleStar = useCallback((wordId: string) => {
    setDecks(prevDecks => {
      let modifiedDeck: Deck | null = null;
      const updatedDecks = prevDecks.map(deck => {
        const wordIdx = deck.words.findIndex(w => w.id === wordId);
        if (wordIdx !== -1) {
          const updatedWords = [...deck.words];
          updatedWords[wordIdx] = { 
            ...updatedWords[wordIdx], 
            starred: !updatedWords[wordIdx].starred 
          };
          modifiedDeck = { ...deck, words: updatedWords };
          return modifiedDeck;
        }
        return deck;
      });

      if (modifiedDeck) {
        saveSingleDeckToDB(modifiedDeck).catch(e => console.error("IndexedDB star save error:", e));
      }
      return updatedDecks;
    });
  }, []);

  // Word mastery interaction
  const handleToggleLearned = useCallback((wordId: string) => {
    setDecks(prevDecks => {
      let modifiedDeck: Deck | null = null;
      const updatedDecks = prevDecks.map(deck => {
        const wordIdx = deck.words.findIndex(w => w.id === wordId);
        if (wordIdx !== -1) {
          const updatedWords = [...deck.words];
          const isNowMastered = !updatedWords[wordIdx].learned;
          updatedWords[wordIdx] = { 
            ...updatedWords[wordIdx], 
            learned: isNowMastered,
            lastReviewed: new Date().toISOString(),
            strength: isNowMastered ? 4 : 0
          };
          modifiedDeck = { ...deck, words: updatedWords };
          return modifiedDeck;
        }
        return deck;
      });

      if (modifiedDeck) {
        saveSingleDeckToDB(modifiedDeck).catch(e => console.error("IndexedDB learned save error:", e));
      }

      setStats(prevStats => {
        const updatedStreak = calculateNewStreak(prevStats.streak);
        const totalMasteredCount = updatedDecks.reduce((acc, d) => 
          acc + d.words.filter(w => w.learned).length, 0
        );
        const totalStudiedCount = updatedDecks.reduce((acc, d) => 
          acc + d.words.filter(w => w.lastReviewed !== null).length, 0
        );
        const newStats = {
          ...prevStats,
          totalWordsMastered: totalMasteredCount,
          totalWordsStudied: totalStudiedCount,
          streak: updatedStreak
        };
        saveStatsToDB(newStats).catch(e => console.error("IndexedDB stats save error:", e));
        return newStats;
      });

      return updatedDecks;
    });
  }, []);

  // Open LLM Modal with optional target provider
  const handleOpenLlmModal = (initialProvider?: LLMProvider) => {
    if (initialProvider && initialProvider !== llmConfig.provider) {
      const switched = switchActiveProvider(llmConfig, initialProvider);
      setLlmConfig(switched);
      saveLLMConfigToDB(switched).catch(e => console.error("IndexedDB config save error:", e));
      try {
        localStorage.setItem("vocab_learner_llm_config", JSON.stringify(switched));
      } catch (e) {
        console.error("Failed to save LLM config to localStorage", e);
      }
    }
    setIsLlmModalOpen(true);
  };

  // Save LLM Config
  const handleSaveLlmConfig = (newConfig: LLMConfig) => {
    setLlmConfig(newConfig);
    saveLLMConfigToDB(newConfig).catch(e => console.error("IndexedDB config save error:", e));
    try {
      localStorage.setItem("vocab_learner_llm_config", JSON.stringify(newConfig));
    } catch (e) {
      console.error("Failed to save LLM config to localStorage", e);
    }
    setIsLlmModalOpen(false);
  };

  // Save Onboarding (Languages + LLM Config)
  const handleSaveOnboarding = (
    userData: { email: string; nativeLanguage: string; targetLanguage: string },
    newConfig: LLMConfig
  ) => {
    setLlmConfig(newConfig);
    saveLLMConfigToDB(newConfig).catch(e => console.error("IndexedDB config save error:", e));
    try {
      localStorage.setItem("vocab_learner_llm_config", JSON.stringify(newConfig));
      if (userData.email) {
        localStorage.setItem("vocab_learner_user_email", userData.email);
      }
      if (userData.nativeLanguage) {
        localStorage.setItem("vocab_learner_native_lang", userData.nativeLanguage);
      }
      if (userData.targetLanguage) {
        localStorage.setItem("vocab_learner_target_lang", userData.targetLanguage);
      }
    } catch (e) {
      console.error("Failed to save onboarding settings to localStorage", e);
    }

    if (userData.targetLanguage && userData.nativeLanguage && decks.length > 0) {
      const updatedDecks = decks.map(deck => ({
        ...deck,
        targetLanguage: userData.targetLanguage,
        nativeLanguage: userData.nativeLanguage
      }));
      saveDecksToStorage(updatedDecks);
    }

    setIsLlmModalOpen(false);
  };

  // Handle AI deck generation
  const handleGenerateDeck = async (
    topic: string, 
    targetLanguage: string, 
    nativeLanguage: string, 
    quantity: number
  ) => {
    if (!llmConfig.isLoggedIn && llmConfig.provider !== "gemini") {
      setIsLlmModalOpen(true);
      return;
    }

    setIsLoading(true);
    setLoadingMessage(`Sourcing rich target vocabulary via ${llmConfig.provider.toUpperCase()} (${llmConfig.model})...`);

    try {
      const timeoutMsgId = setTimeout(() => {
        setLoadingMessage("Translating words and engineering phonetic audio tags...");
      }, 3500);

      const generatedData = await generateDeckService({ 
        topic, 
        targetLanguage, 
        nativeLanguage, 
        quantity,
        llmConfig
      });

      clearTimeout(timeoutMsgId);

      if (!generatedData || !Array.isArray(generatedData.words) || generatedData.words.length === 0) {
        throw new Error(generatedData?.error || "Unable to generate vocabulary for this topic. Please try again or check your LLM configuration.");
      }

      // Transform raw words to include system learning status and example image
      const mappedWords: Word[] = (generatedData.words || []).map((w: any, idx: number) => ({
        id: `ai-word-${Date.now()}-${idx}`,
        word: w.word,
        pronunciation: w.pronunciation || "/.../",
        partOfSpeech: w.partOfSpeech || "noun",
        definition: w.definition,
        translation: w.translation,
        example: w.example,
        exampleTranslation: w.exampleTranslation,
        imageUrl: w.imageUrl || `https://image.pollinations.ai/prompt/${encodeURIComponent(w.word || topic)}?width=800&height=600&nologo=true`,
        learned: false,
        starred: false,
        createdAt: new Date().toISOString(),
        lastReviewed: null,
        strength: 0
      }));

      const newDeck: Deck = {
        id: `custom-${Date.now()}`,
        name: generatedData.name || topic,
        description: generatedData.description || `Generated by ${llmConfig.provider === "gemini" ? "Gemini 3.6-Flash" : llmConfig.model}.`,
        words: mappedWords,
        isCustom: true,
        targetLanguage,
        nativeLanguage
      };

      const finalDecks = [newDeck, ...decks];
      saveDecksToStorage(finalDecks);
      setSelectedDeckId(newDeck.id);
      setCurrentView("learn");
    } catch (e: any) {
      console.error(e);
      alert(e.message || "An error occurred while communicating with Gemini API.");
    } finally {
      setIsLoading(false);
    }
  };

  // Add custom manual word
  const handleAddCustomWord = useCallback((
    deckId: string, 
    wordData: Omit<Word, "id" | "learned" | "strength" | "createdAt" | "lastReviewed"> & {
      createdAt?: string;
      lastReviewed?: string | null;
    }
  ) => {
    setDecks(prevDecks => {
      let modifiedDeck: Deck | null = null;
      const updatedDecks = prevDecks.map(deck => {
        if (deck.id === deckId) {
          const imageUrl = wordData.imageUrl?.trim() || `https://image.pollinations.ai/prompt/${encodeURIComponent(wordData.word)}?width=800&height=600&nologo=true`;
          const newWordItem: Word = {
            ...wordData,
            imageUrl,
            id: `manual-word-${Date.now()}`,
            learned: false,
            starred: wordData.starred || false,
            createdAt: new Date().toISOString(),
            lastReviewed: null,
            strength: 0
          };
          modifiedDeck = { ...deck, words: [...deck.words, newWordItem] };
          return modifiedDeck;
        }
        return deck;
      });

      if (modifiedDeck) {
        saveSingleDeckToDB(modifiedDeck).catch(e => console.error("IndexedDB add word save error:", e));
      }
      return updatedDecks;
    });
  }, []);

  // Delete individual word
  const handleDeleteWord = useCallback((deckId: string, wordId: string) => {
    setDecks(prevDecks => {
      let modifiedDeck: Deck | null = null;
      const updatedDecks = prevDecks.map(deck => {
        if (deck.id === deckId) {
          modifiedDeck = { ...deck, words: deck.words.filter(w => w.id !== wordId) };
          return modifiedDeck;
        }
        return deck;
      });

      if (modifiedDeck) {
        saveSingleDeckToDB(modifiedDeck).catch(e => console.error("IndexedDB delete word save error:", e));
      }
      return updatedDecks;
    });
  }, []);

  // Update whole list of words inside a deck
  const handleUpdateDeckWords = useCallback((deckId: string, updatedWords: Word[]) => {
    setDecks(prevDecks => {
      const updatedDecks = prevDecks.map(deck => {
        if (deck.id === deckId) {
          const mod = { ...deck, words: updatedWords };
          saveSingleDeckToDB(mod).catch(e => console.error("IndexedDB update deck words error:", e));
          return mod;
        }
        return deck;
      });
      return updatedDecks;
    });
  }, []);

  // Create an empty custom notebook
  const handleCreateDeck = useCallback((deckData: Omit<Deck, "id">) => {
    const newDeck: Deck = {
      ...deckData,
      id: `custom-${Date.now()}`
    };
    setDecks(prevDecks => {
      const updated = [newDeck, ...prevDecks];
      saveAllDecksToDB(updated).catch(e => console.error("IndexedDB create deck save error:", e));
      return updated;
    });
    setSelectedDeckId(newDeck.id);
  }, []);

  // Handle deck deletion
  const handleDeleteDeck = useCallback((deckId: string) => {
    setDecks(prevDecks => prevDecks.filter(d => d.id !== deckId));
    deleteDeckFromDB(deckId).catch(e => console.error("IndexedDB delete deck error:", e));
    setSelectedDeckId(prev => prev === deckId ? null : prev);
  }, []);

  // Memoize Today's Practice Deck so object reference remains stable across renders
  const todayPracticeDeck = useMemo((): Deck => {
    // Gather all unique words from active decks
    const allUniqueWordsMap = new Map<string, Word>();
    
    decks.forEach(d => {
      d.words.forEach(w => {
        allUniqueWordsMap.set(w.word.toLowerCase(), w);
      });
    });

    const allWords = Array.from(allUniqueWordsMap.values());

    const starred = allWords.filter(w => w.starred);
    const unlearned = allWords.filter(w => !w.learned && !w.starred);
    const weak = allWords.filter(w => w.learned && w.strength < 3 && !w.starred);
    const rest = allWords.filter(w => !starred.includes(w) && !unlearned.includes(w) && !weak.includes(w));

    const orderedWords = [...starred, ...unlearned, ...weak, ...rest];
    const todayWords = orderedWords.slice(0, 10);

    return {
      id: "today-practice",
      name: "Today's Practice",
      description: "Daily memory reinforcement session curated based on active decks.",
      words: todayWords,
      isCustom: false,
      targetLanguage: "English",
      nativeLanguage: "Spanish"
    };
  }, [decks]);

  // Quiz completion handler
  const handleFinishQuiz = useCallback((
    score: number, 
    total: number, 
    correctWordIds?: string[], 
    incorrectWordIds?: string[]
  ) => {
    setDecks(prevDecks => {
      let updatedDecks = [...prevDecks];
      if (correctWordIds || incorrectWordIds) {
        updatedDecks = updatedDecks.map(deck => {
          const updatedWords = deck.words.map(word => {
            const originalId = word.id;
            const virtualId = `today-${word.id}`;
            
            if (correctWordIds?.includes(originalId) || correctWordIds?.includes(virtualId)) {
              const newStrength = Math.min(4, word.strength + 1);
              return {
                ...word,
                strength: newStrength,
                learned: newStrength >= 3 ? true : word.learned,
                lastReviewed: new Date().toISOString()
              };
            }
            if (incorrectWordIds?.includes(originalId) || incorrectWordIds?.includes(virtualId)) {
              const newStrength = Math.max(0, word.strength - 1);
              return {
                ...word,
                strength: newStrength,
                lastReviewed: new Date().toISOString()
              };
            }
            return word;
          });
          return { ...deck, words: updatedWords };
        });
        saveAllDecksToDB(updatedDecks).catch(e => console.error("IndexedDB quiz decks save error:", e));
      }

      setStats(prevStats => {
        const updatedStreak = calculateNewStreak(prevStats.streak);
        const totalMasteredCount = updatedDecks.reduce((acc, d) => 
          acc + d.words.filter(w => w.learned).length, 0
        );

        const totalStudiedCount = updatedDecks.reduce((acc, d) => 
          acc + d.words.filter(w => w.lastReviewed !== null).length, 0
        );

        const newStats = {
          ...prevStats,
          totalQuizzesTaken: prevStats.totalQuizzesTaken + 1,
          totalCorrectAnswers: prevStats.totalCorrectAnswers + score,
          totalWordsMastered: totalMasteredCount > 0 ? totalMasteredCount : prevStats.totalWordsMastered,
          totalWordsStudied: totalStudiedCount > 0 ? totalStudiedCount : prevStats.totalWordsStudied,
          streak: updatedStreak
        };
        saveStatsToDB(newStats).catch(e => console.error("IndexedDB stats save error:", e));
        return newStats;
      });

      return updatedDecks;
    });
  }, []);

  const activeDeck = useMemo(() => {
    return decks.find(d => d.id === selectedDeckId) || null;
  }, [decks, selectedDeckId]);

  return (
    <div className="min-h-screen bg-stone-50/40 text-stone-900 flex flex-col antialiased border-0 sm:border-[12px] md:border-[18px] border-stone-100/70">
      
      {/* Visual Top Header */}
      <AppHeader
        currentView={currentView}
        setCurrentView={setCurrentView}
        setSelectedDeckId={setSelectedDeckId}
        setIsLlmModalOpen={setIsLlmModalOpen}
        llmConfig={llmConfig}
        stats={stats}
      />

      {/* Main Viewport Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-3 sm:p-4 md:p-6 pb-8">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentView}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
          >
            {currentView === "dashboard" && (
              <Dashboard 
                stats={stats}
                decks={decks}
                todayPracticeDeck={todayPracticeDeck}
                onSelectDeck={(deckId) => {
                  setSelectedDeckId(deckId);
                  setCurrentView("learn");
                }}
                onSelectTab={(tab) => {
                  if (tab === "decks") setCurrentView("manage");
                  if (tab === "quiz") setCurrentView("quiz");
                  if (tab === "analytics") setCurrentView("analytics");
                }}
                onGenerateDeck={handleGenerateDeck}
                onDeleteDeck={handleDeleteDeck}
                isLoading={isLoading}
                loadingMessage={loadingMessage}
                onFinishQuiz={handleFinishQuiz}
              />
            )}

            {currentView === "learn" && (
              <FlashcardDeck 
                deck={activeDeck}
                onToggleStar={handleToggleStar}
                onToggleLearned={handleToggleLearned}
                onGoBack={() => {
                  setCurrentView("dashboard");
                  setSelectedDeckId(null);
                }}
                onStartQuiz={() => setCurrentView("quiz")}
                ttsConfig={ttsConfig}
                llmConfig={llmConfig}
              />
            )}

            {currentView === "quiz" && (
              <QuizView 
                deck={activeDeck}
                onFinishQuiz={handleFinishQuiz}
                onToggleStar={handleToggleStar}
                onGoBack={() => {
                  setCurrentView("dashboard");
                  setSelectedDeckId(null);
                }}
                ttsConfig={ttsConfig}
                llmConfig={llmConfig}
              />
            )}

            {currentView === "manage" && (
              <DeckManager 
                decks={decks}
                selectedDeckId={selectedDeckId}
                llmConfig={llmConfig}
                ttsConfig={ttsConfig}
                onSelectDeck={setSelectedDeckId}
                onAddWord={handleAddCustomWord}
                onDeleteWord={handleDeleteWord}
                onToggleStar={handleToggleStar}
                onToggleLearned={handleToggleLearned}
                onCreateDeck={handleCreateDeck}
                onDeleteDeck={handleDeleteDeck}
                onUpdateDeckWords={handleUpdateDeckWords}
              />
            )}

            {currentView === "analytics" && (
              <AnalyticsDashboard 
                decks={decks}
                stats={stats}
                llmConfig={llmConfig}
                ttsConfig={ttsConfig}
                onStartPracticeWeakWords={(weakWords) => {
                  const practiceDeck: Deck = {
                    id: "weak-words-practice",
                    name: "Weak Words Practice Quiz",
                    description: "Targeted practice session focused exclusively on words needing improvement.",
                    words: weakWords,
                    isCustom: false,
                    targetLanguage: "English",
                    nativeLanguage: "Spanish"
                  };
                  setSelectedDeckId("weak-words-practice");
                  setDecks(prev => {
                    const filtered = prev.filter(d => d.id !== "weak-words-practice");
                    return [practiceDeck, ...filtered];
                  });
                  setCurrentView("quiz");
                }}
                onToggleLearnedWord={(deckId, wordId) => handleToggleLearned(wordId)}
                onToggleStarWord={(wordId) => handleToggleStar(wordId)}
                onNavigateToView={(view) => {
                  setCurrentView(view);
                  if (view === 'dashboard') setSelectedDeckId(null);
                }}
              />
            )}

            {currentView === "settings" && (
              <SettingsView 
                ttsConfig={ttsConfig}
                llmConfig={llmConfig}
                onSaveTTSConfig={handleSaveTTSConfig}
                onSaveLLMConfig={handleSaveLlmConfig}
                onOpenLlmModal={handleOpenLlmModal}
                onReloadData={reloadAllDataFromDB}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* LLM Login & Onboarding Modal */}
      <LlmLoginModal
        isOpen={isLlmModalOpen}
        currentConfig={llmConfig}
        onSaveConfig={handleSaveLlmConfig}
        onSaveOnboarding={handleSaveOnboarding}
        onClose={() => setIsLlmModalOpen(false)}
        canDismiss={Boolean(llmConfig.isLoggedIn && llmConfig.provider)}
      />

      {/* Footer */}
      <AppFooter />

    </div>
  );
}
