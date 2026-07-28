import React, { useState, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  BarChart2, 
  Brain, 
  CheckCircle2, 
  AlertTriangle, 
  Search, 
  Star, 
  BookOpen, 
  Zap, 
  Flame, 
  RefreshCw,
  Layers
} from "lucide-react";
import { Word, UserStats, LLMConfig, TTSConfig } from "../types";
import { analyzePerformanceService, PerformanceAnalysisResult } from "../services/llmClientService";
import { speakText as speakTextService, DEFAULT_TTS_CONFIG } from "../utils/ttsService";
import { getDaysSinceLastReview } from "../utils/spacedRepetition";

import AiPerformanceCoachCard from "./analytics/AiPerformanceCoachCard";
import WordAnalyticsCard from "./analytics/WordAnalyticsCard";

interface AnalyticsDashboardProps {
  words: Word[];
  stats: UserStats;
  llmConfig?: LLMConfig;
  ttsConfig?: TTSConfig;
  onStartPracticeWeakWords: (weakWords: Word[]) => void;
  onToggleLearnedWord: (wordId: string) => void;
  onToggleStarWord: (wordId: string) => void;
  onNavigateToView: (view: 'dashboard' | 'learn' | 'quiz' | 'manage' | 'analytics' | 'settings') => void;
}

export default function AnalyticsDashboard({
  words,
  stats,
  llmConfig,
  ttsConfig = DEFAULT_TTS_CONFIG,
  onStartPracticeWeakWords,
  onToggleLearnedWord,
  onToggleStarWord,
}: AnalyticsDashboardProps) {
  // AI analysis state
  const [aiReport, setAiReport] = useState<PerformanceAnalysisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  // Filter & Search states for Words breakdown
  const [activeTab, setActiveTab] = useState<'improving' | 'mastered' | 'decayed' | 'all' | 'starred'>('improving');
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<'strength-asc' | 'strength-desc' | 'alpha' | 'recent'>('strength-asc');

  // TTS audio state
  const [speakingWordId, setSpeakingWordId] = useState<string | null>(null);

  const totalWordsCount = words.length;

  // Mastered words: learned === true OR strength >= 3
  const masteredWords = useMemo(() => {
    return words.filter(w => w.learned || w.strength >= 3);
  }, [words]);

  // Words needing improvement: !learned AND strength < 3
  const improvingWords = useMemo(() => {
    return words.filter(w => !w.learned && w.strength < 3);
  }, [words]);

  // Words needing memory refresher (decayed or overdue >= 5 days)
  const decayedWords = useMemo(() => {
    return words.filter(w => {
      const days = getDaysSinceLastReview(w);
      return days >= 5 || (w.strength < 3 && w.lastReviewed !== null);
    });
  }, [words]);

  const starredWords = useMemo(() => {
    return words.filter(w => w.starred);
  }, [words]);



  // Calculate overall accuracy rate
  const accuracyRate = useMemo(() => {
    if (!stats.totalQuizzesTaken || stats.totalQuizzesTaken === 0) return 0;
    const estimatedTotalQuestions = stats.totalQuizzesTaken * 5; 
    if (estimatedTotalQuestions === 0) return 0;
    return Math.min(100, Math.round((stats.totalCorrectAnswers / Math.max(stats.totalCorrectAnswers, estimatedTotalQuestions)) * 100));
  }, [stats]);

  // Run AI Analysis
  const handleRunAiAnalysis = async () => {
    setIsAnalyzing(true);
    setAnalysisError(null);
    try {
      const result = await analyzePerformanceService({
        stats,
        totalWords: totalWordsCount,
        masteredWords,
        improvingWords,
        llmConfig
      });

      setAiReport(result);
    } catch (err: any) {
      console.error("AI Performance Analysis failed:", err);
      setAnalysisError(err.message || "Unable to generate AI analysis. Please verify your LLM key or connection.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Speak word TTS
  const handleSpeakWord = (wordText: string, wordId: string, customLang?: string) => {
    setSpeakingWordId(wordId);
    speakTextService(
      wordText,
      ttsConfig,
      llmConfig,
      customLang || "en-US",
      () => setSpeakingWordId(wordId),
      () => setSpeakingWordId(null)
    );
  };

  // Filtered Words List according to active tab, search, and sorting
  const filteredWords = useMemo(() => {
    let source = words;

    if (activeTab === 'improving') {
      source = improvingWords;
    } else if (activeTab === 'mastered') {
      source = masteredWords;
    } else if (activeTab === 'decayed') {
      source = decayedWords;
    } else if (activeTab === 'starred') {
      source = starredWords;
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      source = source.filter(w => 
        w.word.toLowerCase().includes(q) ||
        w.definition.toLowerCase().includes(q) ||
        w.translation.toLowerCase().includes(q) ||
        (w.partOfSpeech && w.partOfSpeech.toLowerCase().includes(q))
      );
    }

    // Sort
    return [...source].sort((a, b) => {
      if (sortBy === 'strength-asc') {
        return (a.strength ?? 0) - (b.strength ?? 0);
      }
      if (sortBy === 'strength-desc') {
        return (b.strength ?? 0) - (a.strength ?? 0);
      }
      if (sortBy === 'alpha') {
        return a.word.localeCompare(b.word);
      }
      if (sortBy === 'recent') {
        const dateA = a.lastReviewed ? new Date(a.lastReviewed).getTime() : 0;
        const dateB = b.lastReviewed ? new Date(b.lastReviewed).getTime() : 0;
        return dateB - dateA;
      }
      return 0;
    });
  }, [words, improvingWords, masteredWords, starredWords, activeTab, searchQuery, sortBy]);

  // Overall Mastery Percentage
  const overallMasteryPercent = totalWordsCount > 0 
    ? Math.round((masteredWords.length / totalWordsCount) * 100) 
    : 0;

  return (
    <div className="space-y-8 max-w-6xl mx-auto" id="analytics-dashboard-root">
      {/* Top Header Banner */}
      <div className="bg-stone-900 text-white p-6 sm:p-8 border border-stone-800 flex flex-col md:flex-row md:items-center justify-between gap-6 shadow-2xs">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 bg-amber-400 text-stone-950 px-3 py-1 text-[10px] font-bold uppercase tracking-widest">
            <BarChart2 className="w-3.5 h-3.5" />
            <span>AI Vocabulary Analytics</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Performance & Mastery Dashboard</h1>
          <p className="text-xs text-stone-300 font-serif italic max-w-2xl">
            "Track memory retention, identify weak words needing practice, view mastered terms, and receive AI-guided cognitive learning insights."
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {improvingWords.length > 0 && (
            <button
              onClick={() => onStartPracticeWeakWords(improvingWords)}
              className="px-5 py-3 bg-amber-400 hover:bg-amber-300 text-stone-950 font-bold text-xs uppercase tracking-widest transition-all flex items-center gap-2 cursor-pointer shadow-xs"
              title="Launch a practice quiz focused on words needing improvement"
            >
              <Zap className="w-4 h-4 fill-stone-950" />
              <span>Practice Weak Words ({improvingWords.length})</span>
            </button>
          )}

          <button
            onClick={handleRunAiAnalysis}
            disabled={isAnalyzing}
            className="px-5 py-3 bg-stone-800 hover:bg-stone-700 text-stone-100 border border-stone-700 font-bold text-xs uppercase tracking-widest transition-all flex items-center gap-2 cursor-pointer"
          >
            {isAnalyzing ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin text-amber-400" />
                <span>Analyzing...</span>
              </>
            ) : (
              <>
                <Brain className="w-4 h-4 text-amber-400" />
                <span>{aiReport ? "Re-Analyze with AI" : "AI Performance Coach"}</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Primary KPI Metrics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4" id="kpi-metrics-grid">
        <div className="bg-white p-5 border border-stone-200 rounded-none space-y-2 border-l-4 border-l-emerald-600">
          <div className="flex justify-between items-center text-stone-500">
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-800">Mastered Words</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-3xl font-bold text-emerald-950 tracking-tight">{masteredWords.length}</div>
          <p className="text-[11px] text-emerald-700 font-serif italic">
            {overallMasteryPercent}% overall collection mastery
          </p>
        </div>

        <div className="bg-white p-5 border border-stone-200 rounded-none space-y-2 border-l-4 border-l-rose-500">
          <div className="flex justify-between items-center text-stone-500">
            <span className="text-[10px] font-bold uppercase tracking-wider text-rose-800">Need Improvement</span>
            <AlertTriangle className="w-4 h-4 text-rose-500" />
          </div>
          <div className="text-3xl font-bold text-rose-950 tracking-tight">{improvingWords.length}</div>
          <p className="text-[11px] text-rose-700 font-serif italic">
            Strength &lt; 3 or unlearned
          </p>
        </div>
      </div>

      {/* AI PERFORMANCE COACH REPORT CARD */}
      <AnimatePresence>
        {(aiReport || isAnalyzing || analysisError) && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            <AiPerformanceCoachCard
              aiReport={aiReport}
              isAnalyzing={isAnalyzing}
              analysisError={analysisError}
              setAiReport={setAiReport}
              onRunAiAnalysis={handleRunAiAnalysis}
            />
          </motion.div>
        )}
      </AnimatePresence>



      {/* DETAILED WORDS ANALYSIS & MANAGEMENT SECTION */}
      <div className="bg-white border border-stone-200 p-6 space-y-6 rounded-none shadow-2xs" id="words-breakdown-section">
        {/* Navigation Tabs Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-stone-200 pb-4">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setActiveTab('improving')}
              className={`px-4 py-2 text-xs font-bold uppercase tracking-wider flex items-center gap-2 transition-all cursor-pointer ${
                activeTab === 'improving'
                  ? "bg-rose-600 text-white shadow-xs"
                  : "bg-stone-100 text-stone-700 hover:bg-stone-200"
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>Words to Improve</span>
              <span className={`px-1.5 py-0.5 text-[10px] ${activeTab === 'improving' ? "bg-rose-800 text-white" : "bg-stone-200 text-stone-800"}`}>
                {improvingWords.length}
              </span>
            </button>

            <button
              onClick={() => setActiveTab('mastered')}
              className={`px-4 py-2 text-xs font-bold uppercase tracking-wider flex items-center gap-2 transition-all cursor-pointer ${
                activeTab === 'mastered'
                  ? "bg-emerald-700 text-white shadow-xs"
                  : "bg-stone-100 text-stone-700 hover:bg-stone-200"
              }`}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Mastered Words</span>
              <span className={`px-1.5 py-0.5 text-[10px] ${activeTab === 'mastered' ? "bg-emerald-900 text-white" : "bg-stone-200 text-stone-800"}`}>
                {masteredWords.length}
              </span>
            </button>

            <button
              onClick={() => setActiveTab('decayed')}
              className={`px-4 py-2 text-xs font-bold uppercase tracking-wider flex items-center gap-2 transition-all cursor-pointer ${
                activeTab === 'decayed'
                  ? "bg-orange-600 text-white shadow-xs"
                  : "bg-stone-100 text-stone-700 hover:bg-stone-200"
              }`}
              title="Words that had high strength but haven't been reviewed in a while and need memory refresher practice"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Memory Refresher</span>
              <span className={`px-1.5 py-0.5 text-[10px] ${activeTab === 'decayed' ? "bg-orange-800 text-white" : "bg-stone-200 text-stone-800"}`}>
                {decayedWords.length}
              </span>
            </button>

            <button
              onClick={() => setActiveTab('starred')}
              className={`px-4 py-2 text-xs font-bold uppercase tracking-wider flex items-center gap-2 transition-all cursor-pointer ${
                activeTab === 'starred'
                  ? "bg-amber-500 text-stone-950 shadow-xs"
                  : "bg-stone-100 text-stone-700 hover:bg-stone-200"
              }`}
            >
              <Star className="w-3.5 h-3.5 fill-current" />
              <span>Starred</span>
              <span className={`px-1.5 py-0.5 text-[10px] ${activeTab === 'starred' ? "bg-amber-700 text-white" : "bg-stone-200 text-stone-800"}`}>
                {starredWords.length}
              </span>
            </button>

            <button
              onClick={() => setActiveTab('all')}
              className={`px-4 py-2 text-xs font-bold uppercase tracking-wider flex items-center gap-2 transition-all cursor-pointer ${
                activeTab === 'all'
                  ? "bg-stone-900 text-white shadow-xs"
                  : "bg-stone-100 text-stone-700 hover:bg-stone-200"
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>All Words</span>
              <span className={`px-1.5 py-0.5 text-[10px] ${activeTab === 'all' ? "bg-stone-700 text-white" : "bg-stone-200 text-stone-800"}`}>
                {totalWordsCount}
              </span>
            </button>
          </div>

          {activeTab === 'improving' && improvingWords.length > 0 && (
            <button
              onClick={() => onStartPracticeWeakWords(improvingWords)}
              className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs uppercase tracking-wider flex items-center gap-1.5 cursor-pointer shrink-0 transition-all"
            >
              <Zap className="w-3.5 h-3.5 fill-current" />
              <span>Start Quiz on Weak Words</span>
            </button>
          )}
        </div>

        {/* Search & Sorting Bar */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="relative">
            <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search term, definition, or translation..."
              className="w-full pl-9 pr-3 py-2 bg-stone-50 border border-stone-200 text-xs text-stone-900 placeholder:text-stone-400 outline-none focus:border-stone-900 transition-all rounded-none"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-900 text-xs"
              >
                ✕
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-stone-500 text-xs font-semibold shrink-0">Sort:</span>
            <select
              value={sortBy}
              onChange={(e: any) => setSortBy(e.target.value)}
              className="w-full px-3 py-2 bg-stone-50 border border-stone-200 text-xs text-stone-900 outline-none focus:border-stone-900 rounded-none cursor-pointer"
            >
              <option value="strength-asc">Weakest / Lowest Strength First</option>
              <option value="strength-desc">Highest Strength / Mastered First</option>
              <option value="alpha">Alphabetical (A - Z)</option>
              <option value="recent">Recently Reviewed First</option>
            </select>
          </div>
        </div>

        {/* Word Cards Grid */}
        {filteredWords.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" id="filtered-words-grid">
            {filteredWords.map((word) => (
              <WordAnalyticsCard
                key={word.id}
                word={word}
                speakingWordId={speakingWordId}
                onSpeakWord={handleSpeakWord}
                onToggleStarWord={onToggleStarWord}
                onToggleLearnedWord={onToggleLearnedWord}
              />
            ))}
          </div>
        ) : (
          <div className="p-12 text-center bg-stone-50 border border-stone-200 space-y-3">
            <BookOpen className="w-8 h-8 text-stone-400 mx-auto" />
            <h4 className="font-bold text-sm text-stone-900">No Vocabulary Words Found</h4>
            <p className="text-xs text-stone-500 font-serif italic max-w-sm mx-auto">
              {activeTab === 'improving' && "Congratulations! You have zero weak words needing practice in this view!"}
              {activeTab === 'mastered' && "No words marked as mastered yet. Complete practice quizzes to build strength!"}
              {activeTab === 'starred' && "No starred words yet. Star items during practice or quizzes to filter them here."}
              {activeTab === 'all' && "No words match your search filter."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
