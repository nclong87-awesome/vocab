import React, { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Sparkles, Plus, Compass } from "lucide-react";
import { Deck, UserStats } from "../types";
import { getSettingFromDB, saveSettingToDB } from "../db/indexedDB";
import { ConfirmModal } from "./ConfirmModal";

import TodayFocusHero from "./dashboard/TodayFocusHero";
import StatsGrid from "./dashboard/StatsGrid";
import AiAnalyticsBanner from "./dashboard/AiAnalyticsBanner";
import DeckCard from "./dashboard/DeckCard";
import AiDeckGenerator from "./dashboard/AiDeckGenerator";

interface DashboardProps {
  stats: UserStats;
  decks: Deck[];
  todayPracticeDeck: Deck;
  onSelectDeck: (deckId: string) => void;
  onSelectTab: (tab: "learn" | "quiz" | "decks" | "analytics") => void;
  onGenerateDeck: (topic: string, targetLanguage: string, nativeLanguage: string, quantity: number) => Promise<void>;
  onDeleteDeck: (deckId: string) => void;
  isLoading: boolean;
  loadingMessage: string;
  onFinishQuiz: (score: number, total: number, correctWordIds?: string[], incorrectWordIds?: string[]) => void;
}

const PRESET_TOPICS = [
  { label: "Travel & Airport", emoji: "✈️", topic: "Airport transit, lodging, exploring cities, and dining out" },
  { label: "Business English", emoji: "💼", topic: "Professional business vocabulary, corporate meetings, negotiations, and leadership" },
  { label: "Tech & Artificial Intelligence", emoji: "🤖", topic: "Modern artificial intelligence, coding, technology, web dev, and cybersecurity" },
  { label: "Everyday Slang & Idioms", emoji: "💬", topic: "Informal street expressions, idioms, and causal slang used by native speakers" },
  { label: "Culinary & Dining", emoji: "🍳", topic: "Gourmet terms, cooking methods, kitchen tools, and restaurant interactions" },
  { label: "Academic / TOEFL High-Scoring", emoji: "🎓", topic: "Advanced vocabulary for university lectures, TOEFL preparation, and research" },
];

const LANGUAGES = [
  { code: "English", name: "English" },
  { code: "Spanish", name: "Spanish (Español)" },
  { code: "French", name: "French (Français)" },
  { code: "German", name: "German (Deutsch)" },
  { code: "Italian", name: "Italian (Italiano)" },
  { code: "Vietnamese", name: "Vietnamese (Tiếng Việt)" },
  { code: "Japanese", name: "Japanese (日本語)" },
  { code: "Korean", name: "Korean (한국어)" },
  { code: "Chinese", name: "Chinese (中文)" },
];

export default function Dashboard({
  stats,
  decks,
  todayPracticeDeck,
  onSelectDeck,
  onSelectTab,
  onGenerateDeck,
  onDeleteDeck,
  isLoading,
  loadingMessage,
  onFinishQuiz,
}: DashboardProps) {
  const [customTopic, setCustomTopic] = useState("");
  const [targetLanguage, setTargetLanguage] = useState("English");
  const [nativeLanguage, setNativeLanguage] = useState("Spanish");
  const [quantity, setQuantity] = useState(8);
  const [deckToDelete, setDeckToDelete] = useState<{ id: string; name: string } | null>(null);

  // Today's practice quiz states
  const [isQuizActive, setIsQuizActive] = useState(false);
  const [completedToday, setCompletedToday] = useState<boolean>(false);
  const [sessionScore, setSessionScore] = useState<{ score: number; total: number } | null>(null);

  useEffect(() => {
    async function checkDailyQuizStatus() {
      const today = new Date().toISOString().split("T")[0];
      const savedDate = await getSettingFromDB("last_completed_daily_quiz_date");
      if (savedDate === today) {
        setCompletedToday(true);
      }
    }
    checkDailyQuizStatus();
  }, []);

  const handleDailyQuizFinish = async (score: number, total: number, correctWordIds?: string[], incorrectWordIds?: string[]) => {
    const today = new Date().toISOString().split("T")[0];
    await saveSettingToDB("last_completed_daily_quiz_date", today);
    localStorage.setItem("last_completed_daily_quiz_date", today);
    setCompletedToday(true);
    setIsQuizActive(false);
    setSessionScore({ score, total });
    onFinishQuiz(score, total, correctWordIds, incorrectWordIds);
  };

  const handleSubmitCustomTopic = (e: React.FormEvent) => {
    e.preventDefault();
    const topic = customTopic.trim();
    if (!topic) return;
    onGenerateDeck(topic, targetLanguage, nativeLanguage, quantity);
    setCustomTopic("");
  };

  const handlePresetClick = (topic: string) => {
    onGenerateDeck(topic, targetLanguage, nativeLanguage, quantity);
  };

  // Helper to check study calendar history
  const pastSevenDays = useMemo(() => {
    const days = [];
    const date = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(date);
      d.setDate(date.getDate() - i);
      const str = d.toISOString().split("T")[0];
      days.push({
        dateStr: str,
        dayName: d.toLocaleDateString(undefined, { weekday: "short" }),
        dayNum: d.getDate(),
        studied: stats.streak.history.includes(str)
      });
    }
    return days;
  }, [stats.streak.history]);

  return (
    <div className="space-y-12" id="dashboard-container">
      {/* Loading Overlay */}
      <AnimatePresence>
        {isLoading && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-stone-950/90 backdrop-blur-sm z-50 flex flex-col items-center justify-center p-6 text-center"
            id="loading-overlay"
          >
            <div className="relative mb-8">
              <motion.div 
                animate={{ rotate: 360 }}
                transition={{ repeat: Infinity, duration: 4, ease: "linear" }}
                className="w-24 h-24 border-t border-stone-100 flex items-center justify-center"
              />
              <Sparkles className="absolute inset-0 m-auto text-stone-100 w-8 h-8 animate-pulse" />
            </div>
            <motion.h3 
              initial={{ y: 10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="text-lg font-bold text-white mb-3 font-sans"
            >
              Curating Vocabulary material
            </motion.h3>
            <motion.p 
              initial={{ y: 10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.4 }}
              className="text-stone-400 max-w-sm text-xs font-mono"
            >
              {loadingMessage}
            </motion.p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Dynamic Today's Practice Session Hero Module */}
      <TodayFocusHero
        isQuizActive={isQuizActive}
        setIsQuizActive={setIsQuizActive}
        completedToday={completedToday}
        sessionScore={sessionScore}
        todayPracticeDeck={todayPracticeDeck}
        onDailyQuizFinish={handleDailyQuizFinish}
        streakCount={stats.streak.count}
      />

      {/* Stats Blocks */}
      <StatsGrid stats={stats} pastSevenDays={pastSevenDays} />

      {/* AI Performance & Weak Words Banner Callout */}
      <AiAnalyticsBanner onSelectTab={onSelectTab} />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-8">
        {/* Decks Column */}
        <div className="lg:col-span-7 space-y-6" id="dashboard-left-column">
          <div className="flex justify-between items-center border-b border-stone-200 pb-4">
            <h2 className="text-sm font-bold text-stone-950 flex items-center gap-2">
              Collection Decks
            </h2>
            <button 
              onClick={() => onSelectTab("decks")} 
              className="text-xs font-semibold text-stone-500 hover:text-stone-950 flex items-center gap-1 cursor-pointer"
            >
              Add Custom Deck <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="space-y-4 sm:space-y-6">
            {decks.length === 0 ? (
              <div className="bg-white border border-stone-200 p-6 sm:p-12 text-center text-stone-500">
                <Compass className="w-12 h-12 text-stone-300 mx-auto mb-4" />
                <p className="font-bold text-stone-800 text-xs">No decks available</p>
                <p className="text-xs text-stone-400 mt-2 font-serif italic">"Design custom learning lists on the right panel to begin."</p>
              </div>
            ) : (
              decks.map((deck) => (
                <DeckCard
                  key={deck.id}
                  deck={deck}
                  onSelectDeck={onSelectDeck}
                  onSelectTab={onSelectTab}
                  setDeckToDelete={setDeckToDelete}
                />
              ))
            )}
          </div>
        </div>

        {/* AI Generator Column */}
        <div className="lg:col-span-5" id="dashboard-right-column">
          <AiDeckGenerator
            targetLanguage={targetLanguage}
            setTargetLanguage={setTargetLanguage}
            nativeLanguage={nativeLanguage}
            setNativeLanguage={setNativeLanguage}
            quantity={quantity}
            setQuantity={setQuantity}
            customTopic={customTopic}
            setCustomTopic={setCustomTopic}
            onSubmitCustomTopic={handleSubmitCustomTopic}
            onPresetClick={handlePresetClick}
            isLoading={isLoading}
            languages={LANGUAGES}
            presetTopics={PRESET_TOPICS}
          />
        </div>
      </div>

      <ConfirmModal
        isOpen={Boolean(deckToDelete)}
        title="Delete Notebook"
        message={`Are you sure you want to delete "${deckToDelete?.name}"? All words inside this notebook will be deleted.`}
        onConfirm={() => {
          if (deckToDelete) {
            onDeleteDeck(deckToDelete.id);
            setDeckToDelete(null);
          }
        }}
        onCancel={() => setDeckToDelete(null)}
      />
    </div>
  );
}
