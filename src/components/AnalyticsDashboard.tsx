import  { useState, useMemo, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  BarChart2, 
  Brain, 
  CheckCircle2, 
  AlertTriangle, 
  Search, 
  BookOpen, 
  RefreshCw,
  Calendar,
  Layers,
  Timer,
  ChevronLeft,
  ChevronRight
} from "lucide-react";
import { Word, UserStats, LLMConfig, TTSConfig } from "../types";
import { analyzePerformanceService, PerformanceAnalysisResult } from "../services/llmClientService";
import { speakText as speakTextService, DEFAULT_TTS_CONFIG } from "../utils/ttsService";
import { getDaysSinceLastReview, isWordEligibleForReview } from "../utils/spacedRepetition";
import { t } from "../config/i18n";

import AiPerformanceCoachCard from "./analytics/AiPerformanceCoachCard";
import WordAnalyticsCard from "./analytics/WordAnalyticsCard";
import PracticeTimeline from "./analytics/PracticeTimeline";

interface AnalyticsDashboardProps {
  words: Word[];
  stats: UserStats;
  llmConfig?: LLMConfig;
  ttsConfig?: TTSConfig;
  appLanguage?: string;
  onStartPracticeWeakWords: (weakWords: Word[]) => void;
  onToggleLearnedWord: (wordId: string) => void;
  onToggleStarWord: (wordId: string) => void;
  onNavigateToView: (view: 'chatview' | 'manage' | 'analytics' | 'settings') => void;
}

export default function AnalyticsDashboard({
  words = [],
  stats,
  llmConfig,
  ttsConfig = DEFAULT_TTS_CONFIG,
  appLanguage = "Vietnamese",
  onStartPracticeWeakWords: _onStartPracticeWeakWords,
  onToggleLearnedWord,
  onToggleStarWord,
  onNavigateToView: _onNavigateToView,
}: AnalyticsDashboardProps) {
  const safeWords = Array.isArray(words) ? words : [];

  // AI analysis state
  const [aiReport, setAiReport] = useState<PerformanceAnalysisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  // View Mode: 'breakdown' (Library & Performance) vs 'timeline' (Practice Timeline)
  const [dashboardView, setDashboardView] = useState<'breakdown' | 'timeline'>('breakdown');

  // Filter & Search states for Words breakdown - default to 'all' so mastered words are visible
  const [activeTab, setActiveTab] = useState<'improving' | 'mastered' | 'decayed' | 'all' | 'starred'>('all');
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<'strength-asc' | 'strength-desc' | 'alpha' | 'recent'>('recent');

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 18; // Perfect multiple of 3 columns for desktop grid, compact for mobile

  // Reset pagination on filter change
  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab, searchQuery, sortBy]);

  // TTS audio state
  const [speakingWordId, setSpeakingWordId] = useState<string | null>(null);

  const totalWordsCount = safeWords.length;

  // Words currently eligible/due for spaced review
  const dueWords = useMemo(() => {
    return safeWords.filter(w => isWordEligibleForReview(w));
  }, [safeWords]);

  // Mastered words: learned === true OR strength >= 80
  const masteredWords = useMemo(() => {
    return safeWords.filter(w => w.learned || w.strength >= 80);
  }, [safeWords]);

  // Words needing improvement: !learned AND strength < 50
  const improvingWords = useMemo(() => {
    return safeWords.filter(w => !w.learned && w.strength < 50);
  }, [safeWords]);

  // Words used / reviewed recently (sorted by most recent review)
  const recentlyUsedWords = useMemo(() => {
    return safeWords
      .filter(w => w.lastReviewed !== null || (w.strength ?? 0) > 0)
      .sort((a, b) => {
        const dateA = a.lastReviewed ? new Date(a.lastReviewed).getTime() : 0;
        const dateB = b.lastReviewed ? new Date(b.lastReviewed).getTime() : 0;
        return dateB - dateA;
      });
  }, [safeWords]);

  // Words never used / never reviewed yet
  const neverUsedWords = useMemo(() => {
    return safeWords.filter(w => w.lastReviewed === null && (w.strength ?? 0) === 0 && !w.learned);
  }, [safeWords]);

  // Words needing memory refresher (decayed or overdue >= 5 days)
  const decayedWords = useMemo(() => {
    return safeWords.filter(w => {
      if (!w.learned) return false; // Only mastered words undergo memory decay
      const days = getDaysSinceLastReview(w);
      return days >= 5 || (w.strength < 80 && w.lastReviewed !== null && days >= 1);
    });
  }, [safeWords]);

  const starredWords = useMemo(() => {
    return safeWords.filter(w => w.starred);
  }, [safeWords]);



  // Calculate overall accuracy rate

  // Run AI Analysis
  const handleRunAiAnalysis = async () => {
    const configToUse = llmConfig;
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
        recentlyUsedWords,
        neverUsedWords,
        allWords: safeWords.slice(0, 50),
        targetLanguage: "English",
        nativeLanguage: appLanguage,
        llmConfig: configToUse
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
    let source = safeWords;

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

  // Paginated subset of filtered words for display
  const paginatedWords = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return filteredWords.slice(startIndex, startIndex + pageSize);
  }, [filteredWords, currentPage, pageSize]);

  const totalPages = Math.ceil(filteredWords.length / pageSize);

  return (
    <div className="space-y-8 max-w-6xl mx-auto" id="analytics-dashboard-root">
      {/* Top Header Banner */}
      <div className="bg-stone-900 text-white p-6 sm:p-8 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-6 shadow-sm overflow-hidden relative">
        <div className="space-y-2.5">
          <div className="inline-flex items-center gap-1.5 bg-amber-400 text-stone-950 px-3 py-1 text-[10px] font-black uppercase tracking-widest rounded-md">
            <BarChart2 className="w-3.5 h-3.5" />
            <span>{t("analytics_title", appLanguage)}</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{t("analytics_headline", appLanguage)}</h1>
          <p className="text-xs text-stone-300 font-serif italic max-w-2xl leading-relaxed">
            {t("analytics_quote", appLanguage)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => handleRunAiAnalysis()}
            disabled={isAnalyzing}
            className="px-5 py-3 bg-stone-800 hover:bg-stone-700 hover:scale-[1.01] active:scale-[0.99] text-stone-100 border border-stone-700 font-bold text-xs uppercase tracking-widest transition-all flex items-center gap-2 cursor-pointer rounded-xl"
          >
            {isAnalyzing ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin text-amber-400" />
                <span>{t("analytics_analyzing", appLanguage)}</span>
              </>
            ) : (
              <>
                <Brain className="w-4 h-4 text-amber-400" />
                <span>{aiReport ? t("analytics_reanalyze", appLanguage) : t("analytics_coach", appLanguage)}</span>
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
              words={safeWords}
              stats={stats}
              appLanguage={appLanguage}
              setAiReport={setAiReport}
              onRunAiAnalysis={handleRunAiAnalysis}
              onSpeakWord={handleSpeakWord}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Primary View Switcher: Breakdown vs Practice Timeline */}
      <div className="flex items-center justify-between gap-3 border-b border-stone-200/80 pb-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setDashboardView('breakdown')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
              dashboardView === 'breakdown'
                ? 'bg-stone-900 text-white shadow-xs'
                : 'bg-white text-stone-600 border border-stone-200/80 hover:bg-stone-50'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Performance & Library</span>
          </button>

          <button
            onClick={() => setDashboardView('timeline')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
              dashboardView === 'timeline'
                ? 'bg-amber-400 text-stone-950 shadow-xs'
                : 'bg-white text-stone-600 border border-stone-200/80 hover:bg-stone-50'
            }`}
          >
            <Calendar className="w-3.5 h-3.5 text-stone-800" />
            <span>Practice Timeline</span>
            {dueWords.length > 0 && (
              <span className={`px-1.5 py-0.2 rounded-full text-[9px] font-mono font-black ${
                dashboardView === 'timeline' ? 'bg-stone-950 text-amber-400' : 'bg-amber-100 text-amber-900 border border-amber-300'
              }`}>
                {dueWords.length} due
              </span>
            )}
          </button>
        </div>

        <span className="text-[11px] text-stone-400 font-mono hidden sm:inline">
          {dashboardView === 'timeline' ? 'Scheduled Spaced Intervals' : `${totalWordsCount} Total Vocabulary Items`}
        </span>
      </div>

      {dashboardView === 'timeline' ? (
        /* PRACTICE TIMELINE VIEW */
        <PracticeTimeline
          words={safeWords}
          speakingWordId={speakingWordId}
          onSpeakWord={handleSpeakWord}
          onToggleStarWord={onToggleStarWord}
          onToggleLearnedWord={onToggleLearnedWord}
          onStartPractice={_onStartPracticeWeakWords}
        />
      ) : (
        /* PERFORMANCE BREAKDOWN VIEW */
        <>
          {/* Primary KPI Metrics Grid */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5" id="kpi-metrics-grid">
            {/* Total Words & Mastery */}
            <button 
              onClick={() => setActiveTab('all')}
              className={`p-4 border text-left transition-all duration-200 cursor-pointer rounded-xl space-y-2 ${
                activeTab === 'all' 
                  ? 'bg-stone-50 border-stone-400 ring-2 ring-stone-900/10 shadow-xs' 
                  : 'bg-white border-stone-200 hover:border-stone-300'
              }`}
              title="Click to view all vocabulary"
            >
              <div className="flex justify-between items-center text-stone-500">
                <span className="text-[10px] font-bold uppercase tracking-wider text-stone-700">Vocabulary Size</span>
                <BookOpen className="w-3.5 h-3.5 text-stone-600" />
              </div>
              <div className="text-2xl font-bold text-stone-900 tracking-tight">{totalWordsCount}</div>
              <p className="text-[11px] text-stone-500 font-serif italic">
                Total active words in library
              </p>
            </button>

            {/* Mastered Words */}
            <button 
              onClick={() => setActiveTab('mastered')}
              className={`p-4 border text-left transition-all duration-200 cursor-pointer rounded-xl space-y-2 ${
                activeTab === 'mastered' 
                  ? 'bg-emerald-50/30 border-emerald-400 ring-2 ring-emerald-500/10 shadow-xs' 
                  : 'bg-white border-stone-200 hover:border-emerald-300'
              }`}
              title="Click to view mastered words"
            >
              <div className="flex justify-between items-center text-stone-500">
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-800">Mastered Words</span>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              </div>
              <div className="text-2xl font-bold text-emerald-950 tracking-tight">{masteredWords.length}</div>
              <p className="text-[11px] text-emerald-700 font-serif italic">
                {overallMasteryPercent}% mastery rate (≥80% strength)
              </p>
            </button>

            {/* Need Improvement */}
            <button 
              onClick={() => setActiveTab('improving')}
              className={`p-4 border text-left transition-all duration-200 cursor-pointer rounded-xl space-y-2 ${
                activeTab === 'improving' 
                  ? 'bg-rose-50/30 border-rose-400 ring-2 ring-rose-500/10 shadow-xs' 
                  : 'bg-white border-stone-200 hover:border-rose-300'
              }`}
              title="Click to view words needing improvement"
            >
              <div className="flex justify-between items-center text-stone-500">
                <span className="text-[10px] font-bold uppercase tracking-wider text-rose-800">Need Practice</span>
                <AlertTriangle className="w-3.5 h-3.5 text-rose-500" />
              </div>
              <div className="text-2xl font-bold text-rose-950 tracking-tight">{improvingWords.length}</div>
              <p className="text-[11px] text-rose-700 font-serif italic">
                Low strength (&lt;50%) or unlearned
              </p>
            </button>

            {/* Memory Refresher / Decayed / Timeline Jump */}
            <button 
              onClick={() => setDashboardView('timeline')}
              className="p-4 border border-amber-200/80 bg-amber-50/30 hover:border-amber-400 text-left transition-all duration-200 cursor-pointer rounded-xl space-y-2 shadow-2xs hover:shadow-xs group"
              title="Click to open Practice Timeline"
            >
              <div className="flex justify-between items-center text-stone-500">
                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-900">Practice Timeline</span>
                <Timer className="w-3.5 h-3.5 text-amber-600 group-hover:scale-110 transition-transform" />
              </div>
              <div className="text-2xl font-bold text-amber-950 tracking-tight">
                {dueWords.length} <span className="text-xs font-normal text-amber-800 font-mono">due</span>
              </div>
              <p className="text-[11px] text-amber-700 font-serif italic flex items-center justify-between">
                <span>View review schedule</span>
                <span className="font-sans font-bold text-amber-800">→</span>
              </p>
            </button>
          </div>

          {/* DETAILED WORDS ANALYSIS & MANAGEMENT SECTION */}
          <div className="bg-white border border-stone-200/80 p-6 space-y-6 rounded-2xl shadow-3xs" id="words-breakdown-section">
            {/* Tab Selection Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-100 pb-4">
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  onClick={() => setActiveTab('all')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    activeTab === 'all' 
                      ? 'bg-stone-900 text-white shadow-3xs' 
                      : 'bg-stone-100 text-stone-600 hover:bg-stone-200 hover:text-stone-900'
                  }`}
                >
                  All ({totalWordsCount})
                </button>
                <button
                  onClick={() => setActiveTab('improving')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    activeTab === 'improving' 
                      ? 'bg-rose-600 text-white shadow-3xs' 
                      : 'bg-rose-50 text-rose-700 hover:bg-rose-100'
                  }`}
                >
                  Need Practice ({improvingWords.length})
                </button>
                <button
                  onClick={() => setActiveTab('mastered')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    activeTab === 'mastered' 
                      ? 'bg-emerald-600 text-white shadow-3xs' 
                      : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                  }`}
                >
                  Mastered ({masteredWords.length})
                </button>
                <button
                  onClick={() => setActiveTab('decayed')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    activeTab === 'decayed' 
                      ? 'bg-amber-600 text-white shadow-3xs' 
                      : 'bg-amber-50 text-amber-800 hover:bg-amber-100'
                  }`}
                >
                  Decay Risk ({decayedWords.length})
                </button>
                <button
                  onClick={() => setActiveTab('starred')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    activeTab === 'starred' 
                      ? 'bg-amber-500 text-stone-950 font-bold shadow-3xs' 
                      : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                  }`}
                >
                  ★ Starred ({starredWords.length})
                </button>
              </div>

              <div className="text-xs text-stone-500 font-mono">
                Showing {filteredWords.length} words
              </div>
            </div>
            
            {/* Search & Sorting Bar */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="relative">
                <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t("analytics_search_placeholder", appLanguage)}
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
                <span className="text-stone-500 text-xs font-semibold shrink-0">{t("analytics_sort_label", appLanguage)}</span>
                <select
                  value={sortBy}
                  onChange={(e: any) => setSortBy(e.target.value)}
                  className="w-full px-3 py-2 bg-stone-50 border border-stone-200 text-xs text-stone-900 outline-none focus:border-stone-400 focus:bg-white rounded-lg cursor-pointer"
                >
                  <option value="strength-asc">{t("analytics_sort_weakest", appLanguage)}</option>
                  <option value="strength-desc">{t("analytics_sort_highest", appLanguage)}</option>
                  <option value="alpha">{t("analytics_sort_alpha", appLanguage)}</option>
                  <option value="recent">{t("analytics_sort_recent", appLanguage)}</option>
                </select>
              </div>
            </div>

            {/* Word Cards Grid */}
            {filteredWords.length > 0 ? (
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" id="filtered-words-grid">
                  {paginatedWords.map((word) => (
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

                {/* Pagination Controls */}
                {totalPages > 1 && (
                  <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-6 border-t border-stone-150 mt-6" id="analytics-pagination">
                    <div className="text-xs text-stone-500 font-mono">
                      Showing <span className="font-semibold text-stone-800">{((currentPage - 1) * pageSize) + 1}</span> to{" "}
                      <span className="font-semibold text-stone-800">
                        {Math.min(currentPage * pageSize, filteredWords.length)}
                      </span>{" "}
                      of <span className="font-semibold text-stone-800">{filteredWords.length}</span> words
                    </div>

                    <div className="flex items-center gap-1.5 flex-wrap">
                      <button
                        onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                        disabled={currentPage === 1}
                        className="p-2 rounded-lg border border-stone-200 bg-white text-stone-600 hover:text-stone-900 hover:bg-stone-50 disabled:opacity-40 disabled:hover:bg-white disabled:hover:text-stone-600 disabled:cursor-not-allowed transition-all cursor-pointer"
                        title="Previous Page"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>

                      {/* Render page numbers */}
                      {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => {
                        if (
                          page === 1 ||
                          page === totalPages ||
                          Math.abs(page - currentPage) <= 1
                        ) {
                          return (
                            <button
                              key={page}
                              onClick={() => setCurrentPage(page)}
                              className={`w-8 h-8 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                                currentPage === page
                                  ? "bg-stone-900 text-white shadow-2xs"
                                  : "border border-stone-200 bg-white text-stone-600 hover:text-stone-900 hover:bg-stone-50"
                              }`}
                            >
                              {page}
                            </button>
                          );
                        }
                        if (
                          page === 2 ||
                          page === totalPages - 1
                        ) {
                          return (
                            <span key={page} className="text-xs text-stone-400 px-1 font-mono select-none">
                              ...
                        </span>
                          );
                        }
                        return null;
                      })}

                      <button
                        onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                        disabled={currentPage === totalPages}
                        className="p-2 rounded-lg border border-stone-200 bg-white text-stone-600 hover:text-stone-900 hover:bg-stone-50 disabled:opacity-40 disabled:hover:bg-white disabled:hover:text-stone-600 disabled:cursor-not-allowed transition-all cursor-pointer"
                        title="Next Page"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}
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
        </>
      )}
    </div>
  );
}
