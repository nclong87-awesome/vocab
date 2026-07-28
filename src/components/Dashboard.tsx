import React, { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Sparkles, Plus, Compass } from "lucide-react";
import { LLMConfig, LLMProvider, UserStats, Word } from "../types";
import { getSettingFromDB, saveSettingToDB } from "../db/indexedDB";

import TodayFocusHero from "./dashboard/TodayFocusHero";
import StatsGrid from "./dashboard/StatsGrid";
import AiAnalyticsBanner from "./dashboard/AiAnalyticsBanner";

interface DashboardProps {
  stats: UserStats;
  words: Word[];
  todayPracticeWords: Word[];
  onSelectTab: (tab: "learn" | "quiz" | "collection" | "analytics") => void;
  onGenerateWords?: (topic: string, targetLanguage: string, nativeLanguage: string, quantity: number) => Promise<void>;
  isLoading: boolean;
  loadingMessage: string;
  onFinishQuiz: (score: number, total: number, correctWordIds?: string[], incorrectWordIds?: string[]) => void;
  llmConfig?: LLMConfig;
  onSwitchProvider?: (providerId: LLMProvider, modelOverride?: string) => void;
  onOpenLlmModal?: (providerId?: LLMProvider) => void;
  targetLanguage?: string;
  nativeLanguage?: string;
}

export default function Dashboard({
  stats,
  words,
  todayPracticeWords,
  onSelectTab,
  isLoading,
  loadingMessage,
  onFinishQuiz,
  targetLanguage = "English",
  nativeLanguage = "Spanish",
}: DashboardProps) {
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
        todayPracticeWords={todayPracticeWords}
        onDailyQuizFinish={handleDailyQuizFinish}
        streakCount={stats.streak.count}
        targetLanguage={targetLanguage}
      />

      {/* Stats Blocks */}
      <StatsGrid stats={stats} pastSevenDays={pastSevenDays} />

      {/* AI Performance & Weak Words Banner Callout */}
      <AiAnalyticsBanner onSelectTab={onSelectTab} />

    </div>
  );
}
