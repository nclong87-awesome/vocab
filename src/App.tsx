import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Sparkles, 
  Flame, 
  BookOpen, 
  GraduationCap, 
  Layers, 
  Settings,
  HelpCircle,
  TrendingUp,
  Award
} from "lucide-react";

import { Deck, Word, UserStats } from "./types";
import { DEFAULT_DECKS } from "./defaultDecks";
import { calculateNewStreak, getTodayStr } from "./utils";

import Dashboard from "./components/Dashboard";
import FlashcardDeck from "./components/FlashcardDeck";
import QuizView from "./components/QuizView";
import DeckManager from "./components/DeckManager";

export default function App() {
  const [decks, setDecks] = useState<Deck[]>([]);
  const [selectedDeckId, setSelectedDeckId] = useState<string | null>(null);
  const [currentView, setCurrentView] = useState<"dashboard" | "learn" | "quiz" | "manage">("dashboard");
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("");
  
  const [stats, setStats] = useState<UserStats>({
    totalWordsStudied: 0,
    totalWordsMastered: 0,
    totalQuizzesTaken: 0,
    totalCorrectAnswers: 0,
    streak: { count: 0, lastActiveDate: "", history: [] }
  });

  // Initialize and load from LocalStorage on mount
  useEffect(() => {
    try {
      const storedDecks = localStorage.getItem("vocab_learner_decks");
      if (storedDecks) {
        setDecks(JSON.parse(storedDecks));
      } else {
        setDecks(DEFAULT_DECKS);
        localStorage.setItem("vocab_learner_decks", JSON.stringify(DEFAULT_DECKS));
      }

      const storedStats = localStorage.getItem("vocab_learner_stats");
      if (storedStats) {
        setStats(JSON.parse(storedStats));
      } else {
        localStorage.setItem("vocab_learner_stats", JSON.stringify(stats));
      }
    } catch (e) {
      console.error("LocalStorage load failed", e);
      setDecks(DEFAULT_DECKS);
    }
  }, []);

  // Save decks to LocalStorage when changed
  const saveDecksToStorage = (updatedDecks: Deck[]) => {
    setDecks(updatedDecks);
    try {
      localStorage.setItem("vocab_learner_decks", JSON.stringify(updatedDecks));
    } catch (e) {
      console.error("Failed to save decks", e);
    }
  };

  // Save stats to LocalStorage when changed
  const saveStatsToStorage = (updatedStats: UserStats) => {
    setStats(updatedStats);
    try {
      localStorage.setItem("vocab_learner_stats", JSON.stringify(updatedStats));
    } catch (e) {
      console.error("Failed to save stats", e);
    }
  };

  // Word interactions (starred state)
  const handleToggleStar = (wordId: string) => {
    const updatedDecks = decks.map(deck => {
      const wordIdx = deck.words.findIndex(w => w.id === wordId);
      if (wordIdx !== -1) {
        const updatedWords = [...deck.words];
        updatedWords[wordIdx] = { 
          ...updatedWords[wordIdx], 
          starred: !updatedWords[wordIdx].starred 
        };
        return { ...deck, words: updatedWords };
      }
      return deck;
    });
    saveDecksToStorage(updatedDecks);
  };

  // Word mastery interaction
  const handleToggleLearned = (wordId: string) => {
    let isNowMastered = false;
    const updatedDecks = decks.map(deck => {
      const wordIdx = deck.words.findIndex(w => w.id === wordId);
      if (wordIdx !== -1) {
        const updatedWords = [...deck.words];
        isNowMastered = !updatedWords[wordIdx].learned;
        updatedWords[wordIdx] = { 
          ...updatedWords[wordIdx], 
          learned: isNowMastered,
          lastReviewed: new Date().toISOString(),
          strength: isNowMastered ? 4 : 0
        };
        return { ...deck, words: updatedWords };
      }
      return deck;
    });
    
    saveDecksToStorage(updatedDecks);

    // Update statistics
    const todayStr = getTodayStr();
    const updatedStreak = calculateNewStreak(stats.streak);

    const totalMasteredCount = updatedDecks.reduce((acc, d) => 
      acc + d.words.filter(w => w.learned).length, 0
    );

    const totalStudiedCount = updatedDecks.reduce((acc, d) => 
      acc + d.words.filter(w => w.lastReviewed !== null).length, 0
    );

    saveStatsToStorage({
      ...stats,
      totalWordsMastered: totalMasteredCount,
      totalWordsStudied: totalStudiedCount,
      streak: updatedStreak
    });
  };

  // Handle deck deletion
  const handleDeleteDeck = (deckId: string) => {
    const updatedDecks = decks.filter(d => d.id !== deckId);
    saveDecksToStorage(updatedDecks);
    if (selectedDeckId === deckId) {
      setSelectedDeckId(null);
    }
  };

  // Handle AI deck generation
  const handleGenerateDeck = async (
    topic: string, 
    targetLanguage: string, 
    nativeLanguage: string, 
    quantity: number
  ) => {
    setIsLoading(true);
    setLoadingMessage("Sourcing rich target vocabulary...");

    try {
      const timeoutMsgId = setTimeout(() => {
        setLoadingMessage("Translating words and engineering phonetic audio tags...");
      }, 3500);

      const response = await fetch("/api/generate-deck", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, targetLanguage, nativeLanguage, quantity })
      });

      clearTimeout(timeoutMsgId);

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "Failed to generate vocabulary material.");
      }

      const generatedData = await response.json();

      // Transform raw words to include system learning status
      const mappedWords: Word[] = (generatedData.words || []).map((w: any, idx: number) => ({
        id: `ai-word-${Date.now()}-${idx}`,
        word: w.word,
        pronunciation: w.pronunciation || "/.../",
        partOfSpeech: w.partOfSpeech || "noun",
        definition: w.definition,
        translation: w.translation,
        example: w.example,
        exampleTranslation: w.exampleTranslation,
        learned: false,
        starred: false,
        createdAt: new Date().toISOString(),
        lastReviewed: null,
        strength: 0
      }));

      const newDeck: Deck = {
        id: `custom-${Date.now()}`,
        name: generatedData.name || topic,
        description: generatedData.description || "Generated by Gemini 3.5-Flash.",
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
  const handleAddCustomWord = (
    deckId: string, 
    wordData: Omit<Word, "id" | "learned" | "starred" | "createdAt" | "lastReviewed" | "strength">
  ) => {
    const updatedDecks = decks.map(deck => {
      if (deck.id === deckId) {
        const newWordItem: Word = {
          ...wordData,
          id: `manual-word-${Date.now()}`,
          learned: false,
          starred: false,
          createdAt: new Date().toISOString(),
          lastReviewed: null,
          strength: 0
        };
        return { ...deck, words: [...deck.words, newWordItem] };
      }
      return deck;
    });

    saveDecksToStorage(updatedDecks);
  };

  // Delete individual word
  const handleDeleteWord = (deckId: string, wordId: string) => {
    const updatedDecks = decks.map(deck => {
      if (deck.id === deckId) {
        return { ...deck, words: deck.words.filter(w => w.id !== wordId) };
      }
      return deck;
    });
    saveDecksToStorage(updatedDecks);
  };

  // Create an empty custom notebook
  const handleAddCustomDeck = (
    name: string, 
    description: string, 
    targetLanguage: string, 
    nativeLanguage: string
  ) => {
    const newDeck: Deck = {
      id: `custom-${Date.now()}`,
      name,
      description,
      words: [],
      isCustom: true,
      targetLanguage,
      nativeLanguage
    };
    saveDecksToStorage([newDeck, ...decks]);
    setSelectedDeckId(newDeck.id);
  };

  // Helper to generate Today's Practice Deck
  const getTodayPracticeDeck = (): Deck => {
    const activeDecksList = decks.length > 0 ? decks : DEFAULT_DECKS;
    
    // Gather all unique words
    const allUniqueWordsMap = new Map<string, Word>();
    
    // First, add all default words as a base
    DEFAULT_DECKS.forEach(d => {
      d.words.forEach(w => {
        allUniqueWordsMap.set(w.word.toLowerCase(), w);
      });
    });

    // Then overlay user's active decks to ensure custom progress is prioritized
    activeDecksList.forEach(d => {
      d.words.forEach(w => {
        allUniqueWordsMap.set(w.word.toLowerCase(), w);
      });
    });

    const allWords = Array.from(allUniqueWordsMap.values());

    // Prioritize today's practice:
    // 1. Starred words (starred === true)
    // 2. Unlearned words (learned === false)
    // 3. Low strength (strength < 3)
    // 4. Everything else
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
  };

  // Quiz completion handler
  const handleFinishQuiz = (
    score: number, 
    total: number, 
    correctWordIds?: string[], 
    incorrectWordIds?: string[]
  ) => {
    const updatedStreak = calculateNewStreak(stats.streak);
    
    // Update individual words' strength and learned status if passed
    let updatedDecks = decks.length > 0 ? [...decks] : [...DEFAULT_DECKS];
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
      saveDecksToStorage(updatedDecks);
    }

    const totalMasteredCount = updatedDecks.reduce((acc, d) => 
      acc + d.words.filter(w => w.learned).length, 0
    );

    const totalStudiedCount = updatedDecks.reduce((acc, d) => 
      acc + d.words.filter(w => w.lastReviewed !== null).length, 0
    );

    saveStatsToStorage({
      ...stats,
      totalQuizzesTaken: stats.totalQuizzesTaken + 1,
      totalCorrectAnswers: stats.totalCorrectAnswers + score,
      totalWordsMastered: totalMasteredCount > 0 ? totalMasteredCount : stats.totalWordsMastered,
      totalWordsStudied: totalStudiedCount > 0 ? totalStudiedCount : stats.totalWordsStudied,
      streak: updatedStreak
    });
  };

  const activeDeck = decks.find(d => d.id === selectedDeckId) || null;

  return (
    <div className="min-h-screen bg-stone-50/40 text-stone-900 flex flex-col antialiased border-[12px] md:border-[18px] border-stone-100/70">
      
      {/* Visual Top Header */}
      <header className="bg-white border-b border-stone-200 py-6 px-6 sm:px-12 sticky top-0 z-40" id="main-header">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          
          {/* Logo / Title */}
          <div 
            onClick={() => {
              setCurrentView("dashboard");
              setSelectedDeckId(null);
            }} 
            className="flex items-center gap-4 cursor-pointer group"
            id="brand-logo"
          >
            <div className="w-10 h-10 bg-stone-900 text-white flex items-center justify-center font-black text-xl tracking-tight transition-transform duration-300 group-hover:scale-105">
              V
            </div>
            <div>
              <h1 className="text-base font-black text-black tracking-widest uppercase leading-none flex items-center gap-2">
                VOCAB.
                <span className="text-[9px] border border-stone-900 text-stone-900 font-bold px-1.5 py-0.5 rounded-none uppercase tracking-widest">PRO</span>
              </h1>
              <p className="text-[10px] text-stone-400 font-bold tracking-widest uppercase mt-1">Clean Minimalist Learning Coach</p>
            </div>
          </div>

          {/* Quick Menu */}
          <div className="flex items-center gap-8 text-[11px] font-bold uppercase tracking-widest">
            <button
              onClick={() => {
                setCurrentView("dashboard");
                setSelectedDeckId(null);
              }}
              className={`transition-colors cursor-pointer ${
                currentView === "dashboard" ? "text-stone-950 underline underline-offset-4 decoration-2" : "text-stone-400 hover:text-stone-950"
              }`}
            >
              Practice
            </button>
            
            <button
              onClick={() => {
                setCurrentView("manage");
              }}
              className={`transition-colors cursor-pointer ${
                currentView === "manage" ? "text-stone-950 underline underline-offset-4 decoration-2" : "text-stone-400 hover:text-stone-950"
              }`}
            >
              Collection
            </button>

            {/* Quick stats highlight */}
            <div className="hidden md:flex items-center gap-3 pl-4 border-l border-stone-200">
              <span className="text-[10px] uppercase tracking-widest font-bold text-stone-300">Streak</span>
              <div className="flex gap-1">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div 
                    key={i} 
                    className={`w-4 h-1 transition-all ${
                      i < stats.streak.count ? "bg-stone-900" : "bg-stone-200"
                    }`}
                  />
                ))}
              </div>
            </div>
          </div>

        </div>
      </header>

      {/* Main Viewport Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6 pb-12">
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
                todayPracticeDeck={getTodayPracticeDeck()}
                onSelectDeck={(deckId) => {
                  setSelectedDeckId(deckId);
                  setCurrentView("learn");
                }}
                onSelectTab={(tab) => {
                  if (tab === "decks") setCurrentView("manage");
                  if (tab === "quiz") setCurrentView("quiz");
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
              />
            )}

            {currentView === "quiz" && (
              <QuizView 
                deck={activeDeck}
                onFinishQuiz={handleFinishQuiz}
                onGoBack={() => {
                  setCurrentView("dashboard");
                  setSelectedDeckId(null);
                }}
              />
            )}

            {currentView === "manage" && (
              <DeckManager 
                decks={decks}
                selectedDeckId={selectedDeckId}
                onSelectDeck={setSelectedDeckId}
                onAddCustomWord={handleAddCustomWord}
                onDeleteWord={handleDeleteWord}
                onToggleStar={handleToggleStar}
                onToggleLearned={handleToggleLearned}
                onAddCustomDeck={handleAddCustomDeck}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Humble footer */}
      <footer className="bg-white border-t border-stone-200 py-6 px-6 text-center text-stone-400 text-xs">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-3">
          <p>© 2026 Vocabulary Learner. Designed with extreme typographic precision and absolute utility.</p>
          <div className="flex gap-4 font-bold text-stone-500 uppercase tracking-widest text-[10px]">
            <span>Powered by Gemini AI</span>
          </div>
        </div>
      </footer>

    </div>
  );
}
