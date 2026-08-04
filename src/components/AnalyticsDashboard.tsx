import  { useState, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  BarChart2, 
  Brain, 
  CheckCircle2, 
  AlertTriangle, 
  Search, 
  
  BookOpen, 
  Zap, 
  
  RefreshCw
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
  onNavigateToView: (view: 'chatview' | 'manage' | 'analytics' | 'settings') => void;
  onLlmApiError?: (err: any, currentConfig: LLMConfig, retryAction: (newConfig: LLMConfig) => void) => void;
}

export default function AnalyticsDashboard({
  words,
  stats,
  llmConfig,
  ttsConfig = DEFAULT_TTS_CONFIG,
  onStartPracticeWeakWords,
  onToggleLearnedWord,
  onToggleStarWord,
  onLlmApiError
}: AnalyticsDashboardProps) {
  // AI analysis state
  const [aiReport, setAiReport] = useState<PerformanceAnalysisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  // Filter & Search states for Words breakdown - default to 'all' so mastered words are visible
  const [activeTab, setActiveTab] = useState<'improving' | 'mastered' | 'decayed' | 'all' | 'starred'>('all');
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<'strength-asc' | 'strength-desc' | 'alpha' | 'recent'>('strength-desc');

  // TTS audio state
  const [speakingWordId, setSpeakingWordId] = useState<string | null>(null);

  const totalWordsCount = words.length;

  // Mastered words: learned === true OR strength >= 80
  const masteredWords = useMemo(() => {
    return words.filter(w => w.learned || w.strength >= 80);
  }, [words]);

  // Words needing improvement: !learned AND strength < 50
  const improvingWords = useMemo(() => {
    return words.filter(w => !w.learned && w.strength < 50);
  }, [words]);

  // Words needing memory refresher (decayed or overdue >= 5 days)
  const decayedWords = useMemo(() => {
    return words.filter(w => {
      const days = getDaysSinceLastReview(w);
      return days >= 5 || (w.strength < 80 && w.lastReviewed !== null);
    });
  }, [words]);

  const starredWords = useMemo(() => {
    return words.filter(w => w.starred);
  }, [words]);



  // Calculate overall accuracy rate

  // Run AI Analysis
  const handleRunAiAnalysis = async (overrideConfig?: LLMConfig) => {
    const configToUse = overrideConfig || llmConfig;
    setIsAnalyzing(true);
    setAnalysisError(null);
    try {
      if (!configToUse) {
        throw new Error("No LLM configuration available.");
      }

      const result = await analyzePerformanceService({
        stats,
        totalWords: totalWordsCount,
        masteredWords,
        improvingWords,
        llmConfig: configToUse
      });

      setAiReport(result);
    } catch (err: any) {
      console.error("AI Performance Analysis failed:", err);
      if (onLlmApiError && configToUse) {
        onLlmApiError(err, configToUse, (newConfig) => handleRunAiAnalysis(newConfig));
      } else {
        setAnalysisError(err.message || "Unable to generate AI analysis. Please verify your LLM key or connection.");
      }
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
        const isMasteredA = (a.learned || (a.strength ?? 0) >= 80) ? 1 : 0;
        const isMasteredB = (b.learned || (b.strength ?? 0) >= 80) ? 1 : 0;
        if (isMasteredA !== isMasteredB) {
          return isMasteredB - isMasteredA;
        }
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
  }, [words, improvingWords, masteredWords, starredWords, decayedWords, activeTab, searchQuery, sortBy]);

  // Overall Mastery Percentage
  const overallMasteryPercent = totalWordsCount > 0 
    ? Math.round((masteredWords.length / totalWordsCount) * 100) 
    : 0;

  return (
    <div className="space-y-8 max-w-6xl mx-auto" id="analytics-dashboard-root">
      {/* Top Header Banner */}
      <div className="bg-stone-900 text-white p-6 sm:p-8 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-6 shadow-sm overflow-hidden relative">
        <div className="space-y-2.5">
          <div className="inline-flex items-center gap-1.5 bg-amber-400 text-stone-950 px-3 py-1 text-[10px] font-black uppercase tracking-widest rounded-md">
            <BarChart2 className="w-3.5 h-3.5" />
            <span>AI Vocabulary Analytics</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Performance & Mastery Dashboard</h1>
          <p className="text-xs text-stone-300 font-serif italic max-w-2xl leading-relaxed">
            "Track memory retention, identify weak words needing practice, view mastered terms, and receive AI-guided cognitive learning insights."
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {improvingWords.length > 0 && (
            <button
              onClick={() => onStartPracticeWeakWords(improvingWords)}
              className="px-5 py-3 bg-amber-400 hover:bg-amber-300 hover:scale-[1.01] active:scale-[0.99] text-stone-950 font-bold text-xs uppercase tracking-widest transition-all flex items-center gap-2 cursor-pointer shadow-xs rounded-xl"
              title="Launch a practice quiz focused on words needing improvement"
            >
              <Zap className="w-4 h-4 fill-stone-950" />
              <span>Practice Weak Words ({improvingWords.length})</span>
            </button>
          )}

          <button
            onClick={() => handleRunAiAnalysis()}
            disabled={isAnalyzing}
            className="px-5 py-3 bg-stone-800 hover:bg-stone-700 hover:scale-[1.01] active:scale-[0.99] text-stone-100 border border-stone-700 font-bold text-xs uppercase tracking-widest transition-all flex items-center gap-2 cursor-pointer rounded-xl"
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


      {/* Primary KPI Metrics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4" id="kpi-metrics-grid">
        <button 
          onClick={() => setActiveTab('mastered')}
          className={`p-6 border text-left transition-all duration-300 cursor-pointer rounded-2xl space-y-3 ${
            activeTab === 'mastered' 
              ? 'bg-emerald-50/20 border-emerald-300 ring-2 ring-emerald-500/10 shadow-xs' 
              : 'bg-white border-stone-200/80 hover:border-emerald-350 hover:shadow-2xs hover:bg-emerald-50/5'
          }`}
          title="Click to view mastered words"
        >
          <div className="flex justify-between items-center text-stone-500">
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-800">Mastered Words</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-3xl font-bold text-emerald-950 tracking-tight">{masteredWords.length}</div>
          <p className="text-[11px] text-emerald-700 font-serif italic">
            {overallMasteryPercent}% overall collection mastery (click to filter)
          </p>
        </button>

        <button 
          onClick={() => setActiveTab('improving')}
          className={`p-6 border text-left transition-all duration-300 cursor-pointer rounded-2xl space-y-3 ${
            activeTab === 'improving' 
              ? 'bg-rose-50/20 border-rose-300 ring-2 ring-rose-500/10 shadow-xs' 
              : 'bg-white border-stone-200/80 hover:border-rose-350 hover:shadow-2xs hover:bg-rose-50/5'
          }`}
          title="Click to view words needing improvement"
        >
          <div className="flex justify-between items-center text-stone-500">
            <span className="text-[10px] font-bold uppercase tracking-wider text-rose-800">Need Improvement</span>
            <AlertTriangle className="w-4 h-4 text-rose-500" />
          </div>
          <div className="text-3xl font-bold text-rose-950 tracking-tight">{improvingWords.length}</div>
          <p className="text-[11px] text-rose-700 font-serif italic">
            Strength &lt; 50% or unlearned (click to filter)
          </p>
        </button>
      </div>

      {/* DETAILED WORDS ANALYSIS & MANAGEMENT SECTION */}
      <div className="bg-white border border-stone-200/80 p-6 sm:p-8 space-y-6 rounded-2xl shadow-3xs" id="words-breakdown-section">
        
        {/* Category Filter Tab Bar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-stone-100 pb-4" id="words-filter-tabs">
          <button
            onClick={() => setActiveTab('all')}
            className={`px-3.5 py-1.5 text-xs font-bold transition-all rounded-lg cursor-pointer ${
              activeTab === 'all'
                ? 'bg-stone-900 text-white'
                : 'bg-stone-50 border border-stone-200/60 text-stone-600 hover:bg-stone-100 hover:text-stone-900'
            }`}
          >
            All Words ({totalWordsCount})
          </button>
          <button
            onClick={() => setActiveTab('improving')}
            className={`px-3.5 py-1.5 text-xs font-bold transition-all rounded-lg cursor-pointer ${
              activeTab === 'improving'
                ? 'bg-rose-600 text-white shadow-3xs'
                : 'bg-stone-50 border border-stone-200/60 text-stone-600 hover:bg-stone-100 hover:text-rose-700'
            }`}
          >
            Need Improvement ({improvingWords.length})
          </button>
          <button
            onClick={() => setActiveTab('mastered')}
            className={`px-3.5 py-1.5 text-xs font-bold transition-all rounded-lg cursor-pointer ${
              activeTab === 'mastered'
                ? 'bg-emerald-600 text-white shadow-3xs'
                : 'bg-stone-50 border border-stone-200/60 text-stone-600 hover:bg-stone-100 hover:text-emerald-700'
            }`}
          >
            Mastered Words ({masteredWords.length})
          </button>
          <button
            onClick={() => setActiveTab('decayed')}
            className={`px-3.5 py-1.5 text-xs font-bold transition-all rounded-lg cursor-pointer ${
              activeTab === 'decayed'
                ? 'bg-amber-600 text-white shadow-3xs'
                : 'bg-stone-50 border border-stone-200/60 text-stone-600 hover:bg-stone-100 hover:text-amber-700'
            }`}
          >
            Refresher Due ({decayedWords.length})
          </button>
          {starredWords.length > 0 && (
            <button
              onClick={() => setActiveTab('starred')}
              className={`px-3.5 py-1.5 text-xs font-bold transition-all rounded-lg cursor-pointer ${
                activeTab === 'starred'
                  ? 'bg-amber-500 text-white shadow-3xs'
                  : 'bg-stone-50 border border-stone-200/60 text-stone-600 hover:bg-stone-100 hover:text-amber-700'
              }`}
            >
              Starred ({starredWords.length})
            </button>
          )}
        </div>

        {/* Search & Sorting Bar */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="relative">
            <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search term, definition, or translation..."
              className="w-full pl-9 pr-3 py-2 bg-stone-50 border border-stone-200 text-xs text-stone-900 placeholder:text-stone-400 outline-none focus:border-stone-400 focus:bg-white transition-all rounded-lg"
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
              className="w-full px-3 py-2 bg-stone-50 border border-stone-200 text-xs text-stone-900 outline-none focus:border-stone-400 focus:bg-white rounded-lg cursor-pointer"
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
          <div className="p-12 text-center bg-stone-50/50 border border-stone-200/60 rounded-xl space-y-3">
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
