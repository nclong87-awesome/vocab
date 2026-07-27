import { useState, useEffect, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";

import { Word, UserStats, LLMConfig, TTSConfig, LLMProvider } from "./types";
import { DEFAULT_WORDS } from "./defaultWords";
import { calculateNewStreak } from "./utils";
import { switchActiveProvider } from "./utils/llmHelpers";
import { generateDeckService } from "./services/llmClientService";
import { 
  getAllWordsFromDB, 
  saveAllWordsToDB, 
  saveWordToDB,
  deleteWordFromDB,
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
  const [words, setWords] = useState<Word[]>([]);
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

  // Global Language Preferences
  const [targetLanguage, setTargetLanguage] = useState<string>(() => {
    return localStorage.getItem("vocab_learner_target_lang") || "English";
  });
  const [nativeLanguage, setNativeLanguage] = useState<string>(() => {
    return localStorage.getItem("vocab_learner_native_lang") || "Spanish";
  });

  const handleSelectLanguages = useCallback((targetLang: string, nativeLang: string, applyToDecks: boolean = false) => {
    setTargetLanguage(targetLang);
    setNativeLanguage(nativeLang);
    try {
      localStorage.setItem("vocab_learner_target_lang", targetLang);
      localStorage.setItem("vocab_learner_native_lang", nativeLang);
    } catch (e) {
      console.error("Failed to save language preferences to localStorage", e);
    }
  }, []);

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
      const loadedWords = await getAllWordsFromDB();
      setWords(loadedWords);

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
      setWords(DEFAULT_WORDS);
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

  // Save words to IndexedDB when changed
  const saveWordsToStorage = useCallback((updatedWords: Word[]) => {
    setWords(updatedWords);
    saveAllWordsToDB(updatedWords).catch(e => console.error("IndexedDB word save error:", e));
  }, []);

  // Word interactions (starred state)
  const handleToggleStar = useCallback((wordId: string) => {
    setWords(prevWords => {
      const updatedWords = prevWords.map(w => {
        if (w.id === wordId) {
          const updated = { ...w, starred: !w.starred };
          saveWordToDB(updated).catch(e => console.error("IndexedDB star save error:", e));
          return updated;
        }
        return w;
      });
      return updatedWords;
    });
  }, []);

  // Word mastery interaction
  const handleToggleLearned = useCallback((wordId: string) => {
    setWords(prevWords => {
      const updatedWords = prevWords.map(w => {
        if (w.id === wordId) {
          const isNowMastered = !w.learned;
          const updated = {
            ...w,
            learned: isNowMastered,
            lastReviewed: new Date().toISOString(),
            strength: isNowMastered ? 4 : 0
          };
          saveWordToDB(updated).catch(e => console.error("IndexedDB learned save error:", e));
          return updated;
        }
        return w;
      });

      setStats(prevStats => {
        const updatedStreak = calculateNewStreak(prevStats.streak);
        const totalMasteredCount = updatedWords.filter(w => w.learned).length;
        const totalStudiedCount = updatedWords.filter(w => w.lastReviewed !== null).length;
        const newStats = {
          ...prevStats,
          totalWordsMastered: totalMasteredCount,
          totalWordsStudied: totalStudiedCount,
          streak: updatedStreak
        };
        saveStatsToDB(newStats).catch(e => console.error("IndexedDB stats save error:", e));
        return newStats;
      });

      return updatedWords;
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

  // Quick switch active LLM provider or model
  const handleSwitchProviderQuick = useCallback((providerId: LLMProvider, modelOverride?: string) => {
    let switched = switchActiveProvider(llmConfig, providerId);
    if (modelOverride) {
      switched = { ...switched, model: modelOverride };
    }
    setLlmConfig(switched);
    saveLLMConfigToDB(switched).catch(e => console.error("IndexedDB config save error:", e));
    try {
      localStorage.setItem("vocab_learner_llm_config", JSON.stringify(switched));
    } catch (e) {
      console.error("Failed to save LLM config to localStorage", e);
    }
  }, [llmConfig]);

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

    if (userData.targetLanguage && userData.nativeLanguage) {
      setTargetLanguage(userData.targetLanguage);
      setNativeLanguage(userData.nativeLanguage);
    }

    setIsLlmModalOpen(false);
  };

  // Handle AI word generation
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

      // Add generated words to the flat list
      const finalWords = [...mappedWords, ...words];
      saveWordsToStorage(finalWords);
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
    wordData: Omit<Word, "id" | "learned" | "strength" | "createdAt" | "lastReviewed"> & {
      createdAt?: string;
      lastReviewed?: string | null;
    }
  ) => {
    const imageUrl = wordData.imageUrl?.trim() || `https://image.pollinations.ai/prompt/${encodeURIComponent(wordData.word)}?width=800&height=600&nologo=true`;
    const newWord: Word = {
      ...wordData,
      imageUrl,
      id: `manual-word-${Date.now()}`,
      learned: false,
      starred: wordData.starred || false,
      createdAt: new Date().toISOString(),
      lastReviewed: null,
      strength: 0
    };
    setWords(prev => {
      const updated = [newWord, ...prev];
      saveAllWordsToDB(updated).catch(e => console.error("IndexedDB add word save error:", e));
      return updated;
    });
  }, []);

  // Delete individual word
  const handleDeleteWord = useCallback((wordId: string) => {
    setWords(prev => prev.filter(w => w.id !== wordId));
    deleteWordFromDB(wordId).catch(e => console.error("IndexedDB delete word save error:", e));
  }, []);

  // Update words list
  const handleUpdateWords = useCallback((updatedWords: Word[]) => {
    setWords(updatedWords);
    saveAllWordsToDB(updatedWords).catch(e => console.error("IndexedDB update words error:", e));
  }, []);

  // Memoize Today's Practice words
  const todayPracticeWords = useMemo((): Word[] => {
    const starred = words.filter(w => w.starred);
    const unlearned = words.filter(w => !w.learned && !w.starred);
    const weak = words.filter(w => w.learned && w.strength < 3 && !w.starred);
    const rest = words.filter(w => !starred.includes(w) && !unlearned.includes(w) && !weak.includes(w));

    const orderedWords = [...starred, ...unlearned, ...weak, ...rest];
    return orderedWords.slice(0, 10);
  }, [words]);

  // Quiz completion handler
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
        saveAllWordsToDB(updatedWords).catch(e => console.error("IndexedDB quiz words save error:", e));
      }

      setStats(prevStats => {
        const updatedStreak = calculateNewStreak(prevStats.streak);
        const totalMasteredCount = updatedWords.filter(w => w.learned).length;
        const totalStudiedCount = updatedWords.filter(w => w.lastReviewed !== null).length;

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

      return updatedWords;
    });
  }, []);

  return (
    <div className="min-h-screen bg-stone-50/40 text-stone-900 flex flex-col antialiased border-0 sm:border-[12px] md:border-[18px] border-stone-100/70">
      
      {/* Visual Top Header */}
      <AppHeader
        currentView={currentView}
        setCurrentView={setCurrentView}
        setIsLlmModalOpen={setIsLlmModalOpen}
        llmConfig={llmConfig}
        stats={stats}
        onSwitchProvider={handleSwitchProviderQuick}
        onOpenLlmModal={handleOpenLlmModal}
        targetLanguage={targetLanguage}
        nativeLanguage={nativeLanguage}
        onSelectLanguages={handleSelectLanguages}
        onReloadData={reloadAllDataFromDB}
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
                words={words}
                todayPracticeWords={todayPracticeWords}
                onSelectTab={(tab) => {
                  if (tab === "decks") setCurrentView("manage");
                  if (tab === "quiz") setCurrentView("quiz");
                  if (tab === "analytics") setCurrentView("analytics");
                }}
                onGenerateWords={handleGenerateDeck}
                isLoading={isLoading}
                loadingMessage={loadingMessage}
                onFinishQuiz={handleFinishQuiz}
                llmConfig={llmConfig}
                onSwitchProvider={handleSwitchProviderQuick}
                onOpenLlmModal={handleOpenLlmModal}
                targetLanguage={targetLanguage}
                nativeLanguage={nativeLanguage}
              />
            )}

            {currentView === "learn" && (
              <FlashcardDeck 
                words={words}
                onToggleStar={handleToggleStar}
                onToggleLearned={handleToggleLearned}
                onGoBack={() => setCurrentView("dashboard")}
                onStartQuiz={() => setCurrentView("quiz")}
                ttsConfig={ttsConfig}
                llmConfig={llmConfig}
              />
            )}

            {currentView === "quiz" && (
              <QuizView 
                words={words}
                onFinishQuiz={handleFinishQuiz}
                onToggleStar={handleToggleStar}
                onGoBack={() => setCurrentView("dashboard")}
                ttsConfig={ttsConfig}
                llmConfig={llmConfig}
              />
            )}

            {currentView === "manage" && (
              <DeckManager 
                words={words}
                llmConfig={llmConfig}
                ttsConfig={ttsConfig}
                onAddWord={handleAddCustomWord}
                onDeleteWord={handleDeleteWord}
                onToggleStar={handleToggleStar}
                onToggleLearned={handleToggleLearned}
                onUpdateWords={handleUpdateWords}
                targetLanguage={targetLanguage}
                nativeLanguage={nativeLanguage}
              />
            )}

            {currentView === "analytics" && (
              <AnalyticsDashboard 
                words={words}
                stats={stats}
                llmConfig={llmConfig}
                ttsConfig={ttsConfig}
                onStartPracticeWeakWords={(weakWords) => {
                  setCurrentView("quiz");
                }}
                onToggleLearnedWord={(wordId) => handleToggleLearned(wordId)}
                onToggleStarWord={(wordId) => handleToggleStar(wordId)}
                onNavigateToView={(view) => setCurrentView(view)}
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
                targetLanguage={targetLanguage}
                nativeLanguage={nativeLanguage}
                onSelectLanguages={handleSelectLanguages}
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
