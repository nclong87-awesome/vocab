import React, { useState, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  BarChart2, 
  Brain, 
  Sparkles, 
  CheckCircle2, 
  AlertTriangle, 
  TrendingUp, 
  Search, 
  Filter, 
  Volume2, 
  Star, 
  BookOpen, 
  Check, 
  X, 
  Zap, 
  Flame, 
  Award, 
  Target, 
  ArrowRight, 
  RefreshCw,
  Layers,
  HelpCircle
} from "lucide-react";
import { 
  BarChart as RechartsBarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  Tooltip, 
  ResponsiveContainer, 
  Cell, 
  PieChart, 
  Pie 
} from "recharts";
import { Word, Deck, UserStats, LLMConfig, TTSConfig } from "../types";
import { analyzePerformanceService, PerformanceAnalysisResult } from "../services/llmClientService";
import { speakText as speakTextService, DEFAULT_TTS_CONFIG } from "../utils/ttsService";

interface AnalyticsDashboardProps {
  decks: Deck[];
  stats: UserStats;
  llmConfig?: LLMConfig;
  ttsConfig?: TTSConfig;
  onStartPracticeWeakWords: (weakWords: Word[]) => void;
  onToggleLearnedWord: (deckId: string, wordId: string) => void;
  onToggleStarWord: (wordId: string) => void;
  onNavigateToView: (view: 'dashboard' | 'learn' | 'quiz' | 'manage' | 'analytics' | 'settings') => void;
}

export default function AnalyticsDashboard({
  decks,
  stats,
  llmConfig,
  ttsConfig = DEFAULT_TTS_CONFIG,
  onStartPracticeWeakWords,
  onToggleLearnedWord,
  onToggleStarWord,
  onNavigateToView
}: AnalyticsDashboardProps) {
  // AI analysis state
  const [aiReport, setAiReport] = useState<PerformanceAnalysisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  // Filter & Search states for Words breakdown
  const [activeTab, setActiveTab] = useState<'improving' | 'mastered' | 'all' | 'starred'>('improving');
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDeckId, setSelectedDeckId] = useState<string>("all");
  const [sortBy, setSortBy] = useState<'strength-asc' | 'strength-desc' | 'alpha' | 'recent'>('strength-asc');

  // TTS audio state
  const [speakingWordId, setSpeakingWordId] = useState<string | null>(null);

  // Flatten all words with their parent deck context
  const allWordsWithDeck = useMemo(() => {
    const list: { word: Word; deckId: string; deckName: string }[] = [];
    decks.forEach(deck => {
      deck.words.forEach(w => {
        list.push({
          word: w,
          deckId: deck.id,
          deckName: deck.name
        });
      });
    });
    return list;
  }, [decks]);

  const totalWordsCount = allWordsWithDeck.length;

  // Mastered words: learned === true OR strength >= 3
  const masteredWords = useMemo(() => {
    return allWordsWithDeck.filter(item => item.word.learned || item.word.strength >= 3);
  }, [allWordsWithDeck]);

  // Words needing improvement: !learned AND strength < 3
  const improvingWords = useMemo(() => {
    return allWordsWithDeck.filter(item => !item.word.learned && item.word.strength < 3);
  }, [allWordsWithDeck]);

  const starredWords = useMemo(() => {
    return allWordsWithDeck.filter(item => item.word.starred);
  }, [allWordsWithDeck]);

  // Familiarity strength levels distribution
  const strengthDistribution = useMemo(() => {
    const counts = [0, 0, 0, 0, 0]; // Index 0 to 4
    allWordsWithDeck.forEach(item => {
      const s = Math.min(4, Math.max(0, item.word.strength ?? 0));
      counts[s]++;
    });
    return [
      { level: "Level 0", label: "New / Unstudied", count: counts[0], color: "#78716c" },
      { level: "Level 1", label: "Weak / Needs Focus", count: counts[1], color: "#f43f5e" },
      { level: "Level 2", label: "Developing", count: counts[2], color: "#f59e0b" },
      { level: "Level 3", label: "Familiar", count: counts[3], color: "#10b981" },
      { level: "Level 4", label: "Mastered", count: counts[4], color: "#059669" }
    ];
  }, [allWordsWithDeck]);

  // Deck Performance Breakdown Data for Charts
  const deckPerformanceData = useMemo(() => {
    return decks.map(deck => {
      const total = deck.words.length;
      const mastered = deck.words.filter(w => w.learned || w.strength >= 3).length;
      const percent = total > 0 ? Math.round((mastered / total) * 100) : 0;
      return {
        name: deck.name.length > 15 ? deck.name.substring(0, 15) + "..." : deck.name,
        fullName: deck.name,
        total,
        mastered,
        improving: total - mastered,
        masteryPercent: percent
      };
    });
  }, [decks]);

  // Calculate overall accuracy rate
  const accuracyRate = useMemo(() => {
    if (!stats.totalQuizzesTaken || stats.totalQuizzesTaken === 0) return 0;
    // Estimate based on questions answered
    const estimatedTotalQuestions = stats.totalQuizzesTaken * 5; 
    if (estimatedTotalQuestions === 0) return 0;
    return Math.min(100, Math.round((stats.totalCorrectAnswers / Math.max(stats.totalCorrectAnswers, estimatedTotalQuestions)) * 100));
  }, [stats]);

  // Run AI Analysis
  const handleRunAiAnalysis = async () => {
    setIsAnalyzing(true);
    setAnalysisError(null);
    try {
      const decksSummary = decks.map(d => ({
        name: d.name,
        totalWords: d.words.length,
        masteredCount: d.words.filter(w => w.learned || w.strength >= 3).length
      }));

      const result = await analyzePerformanceService({
        stats,
        totalWords: totalWordsCount,
        masteredWords: masteredWords.map(i => i.word),
        improvingWords: improvingWords.map(i => i.word),
        decksSummary,
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

  // Filtered Words List according to active tab, search, deck, and sorting
  const filteredWords = useMemo(() => {
    let source = allWordsWithDeck;

    if (activeTab === 'improving') {
      source = improvingWords;
    } else if (activeTab === 'mastered') {
      source = masteredWords;
    } else if (activeTab === 'starred') {
      source = starredWords;
    }

    if (selectedDeckId !== "all") {
      source = source.filter(i => i.deckId === selectedDeckId);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      source = source.filter(i => 
        i.word.word.toLowerCase().includes(q) ||
        i.word.definition.toLowerCase().includes(q) ||
        i.word.translation.toLowerCase().includes(q) ||
        (i.word.partOfSpeech && i.word.partOfSpeech.toLowerCase().includes(q))
      );
    }

    // Sort
    return [...source].sort((a, b) => {
      if (sortBy === 'strength-asc') {
        return (a.word.strength ?? 0) - (b.word.strength ?? 0);
      }
      if (sortBy === 'strength-desc') {
        return (b.word.strength ?? 0) - (a.word.strength ?? 0);
      }
      if (sortBy === 'alpha') {
        return a.word.word.localeCompare(b.word.word);
      }
      if (sortBy === 'recent') {
        const dateA = a.word.lastReviewed ? new Date(a.word.lastReviewed).getTime() : 0;
        const dateB = b.word.lastReviewed ? new Date(b.word.lastReviewed).getTime() : 0;
        return dateB - dateA;
      }
      return 0;
    });
  }, [allWordsWithDeck, improvingWords, masteredWords, starredWords, activeTab, selectedDeckId, searchQuery, sortBy]);

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
              onClick={() => onStartPracticeWeakWords(improvingWords.map(i => i.word))}
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
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4" id="kpi-metrics-grid">
        {/* Total Tracked Words */}
        <div className="bg-white p-5 border border-stone-200 rounded-none space-y-2">
          <div className="flex justify-between items-center text-stone-500">
            <span className="text-[10px] font-bold uppercase tracking-wider">Total Collection</span>
            <BookOpen className="w-4 h-4 text-stone-400" />
          </div>
          <div className="text-3xl font-bold text-stone-950 tracking-tight">{totalWordsCount}</div>
          <p className="text-[11px] text-stone-500 font-serif italic">Across {decks.length} vocabulary decks</p>
        </div>

        {/* Mastered Words */}
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

        {/* Words Needing Improvement */}
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

        {/* Quiz Accuracy / Streak */}
        <div className="bg-white p-5 border border-stone-200 rounded-none space-y-2 border-l-4 border-l-amber-500">
          <div className="flex justify-between items-center text-stone-500">
            <span className="text-[10px] font-bold uppercase tracking-wider text-amber-900">Quiz Accuracy</span>
            <Flame className="w-4 h-4 text-amber-500 fill-amber-500" />
          </div>
          <div className="text-3xl font-bold text-amber-950 tracking-tight">{accuracyRate}%</div>
          <p className="text-[11px] text-stone-500 font-serif italic">
            {stats.streak?.count || 0} day study streak
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
            className="bg-white border-2 border-stone-900 p-6 sm:p-8 space-y-6 rounded-none shadow-sm"
            id="ai-performance-coach-card"
          >
            <div className="flex items-center justify-between border-b border-stone-200 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-amber-400 border border-stone-900 flex items-center justify-center text-stone-950 font-bold">
                  <Brain className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-stone-950">AI Learning Coach Analysis</h3>
                  <p className="text-xs text-stone-500 font-serif italic">Personalized cognitive assessment & memory guidance</p>
                </div>
              </div>

              {aiReport && (
                <button
                  onClick={() => setAiReport(null)}
                  className="p-2 border border-stone-200 hover:border-stone-900 text-stone-500 hover:text-stone-950 cursor-pointer"
                  title="Dismiss AI report"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {isAnalyzing && (
              <div className="py-8 text-center space-y-4">
                <div className="w-10 h-10 border-2 border-stone-900 border-t-amber-400 rounded-full animate-spin mx-auto" />
                <p className="text-xs text-stone-600 font-serif italic">
                  Analyzing vocabulary mastery, quiz patterns, and word strength levels...
                </p>
              </div>
            )}

            {analysisError && (
              <div className="p-4 bg-rose-50 border border-rose-200 text-rose-900 text-xs space-y-2">
                <div className="font-bold flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-600" />
                  <span>AI Analysis Error</span>
                </div>
                <p>{analysisError}</p>
                <button
                  onClick={handleRunAiAnalysis}
                  className="px-3 py-1.5 bg-rose-900 text-white font-bold text-[10px] uppercase tracking-wider cursor-pointer mt-2"
                >
                  Try Again
                </button>
              </div>
            )}

            {aiReport && !isAnalyzing && (
              <div className="space-y-6 text-xs">
                {/* Overall Trajectory Badge & Assessment */}
                <div className="bg-stone-50 p-5 border border-stone-200 space-y-2">
                  <div className="flex items-center gap-2 text-stone-950 font-bold text-xs uppercase tracking-widest">
                    <Sparkles className="w-4 h-4 text-amber-500" />
                    <span>Overall Trajectory Assessment</span>
                  </div>
                  <p className="text-stone-800 text-sm leading-relaxed font-serif">
                    "{aiReport.overallAssessment}"
                  </p>
                </div>

                {/* Strengths & Weaknesses Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="bg-emerald-50/60 p-4 border border-emerald-200 space-y-2">
                    <div className="flex items-center gap-2 text-emerald-900 font-bold text-xs">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      <span>Key Mastery Strengths</span>
                    </div>
                    <p className="text-emerald-950 leading-relaxed">
                      {aiReport.strengthsSummary}
                    </p>
                  </div>

                  <div className="bg-amber-50/60 p-4 border border-amber-200 space-y-2">
                    <div className="flex items-center gap-2 text-amber-900 font-bold text-xs">
                      <AlertTriangle className="w-4 h-4 text-amber-600" />
                      <span>Target Areas Needing Focus</span>
                    </div>
                    <p className="text-amber-950 leading-relaxed">
                      {aiReport.weaknessesSummary}
                    </p>
                  </div>
                </div>

                {/* Actionable Tips */}
                {aiReport.actionableTips && aiReport.actionableTips.length > 0 && (
                  <div className="space-y-3">
                    <h4 className="font-bold text-stone-900 text-xs uppercase tracking-wider flex items-center gap-2">
                      <Target className="w-4 h-4 text-stone-900" />
                      Actionable Memory Retention Strategies
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      {aiReport.actionableTips.map((tip, idx) => (
                        <div key={idx} className="bg-stone-50 p-4 border border-stone-200 space-y-1">
                          <div className="font-bold text-stone-900 text-[11px] flex items-center gap-1.5">
                            <span className="w-4 h-4 bg-stone-900 text-white rounded-full flex items-center justify-center text-[9px]">
                              {idx + 1}
                            </span>
                            <span>Strategy {idx + 1}</span>
                          </div>
                          <p className="text-stone-700 text-xs leading-relaxed">{tip}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Recommended Focus Topics & Motivation Quote */}
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pt-4 border-t border-stone-200">
                  {aiReport.recommendedFocusTopics && aiReport.recommendedFocusTopics.length > 0 && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-stone-700 text-[11px] uppercase tracking-wider">AI Suggested Decks:</span>
                      {aiReport.recommendedFocusTopics.map((topic, idx) => (
                        <span key={idx} className="bg-amber-100 text-amber-900 border border-amber-300 font-semibold px-2.5 py-1 text-[11px]">
                          {topic}
                        </span>
                      ))}
                    </div>
                  )}

                  {aiReport.motivationQuote && (
                    <p className="text-stone-500 font-serif italic text-xs">
                      "{aiReport.motivationQuote}"
                    </p>
                  )}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Visual Analytics Charts Section */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6" id="analytics-charts-section">
        {/* Familiarity Level Distribution Chart */}
        <div className="bg-white p-6 border border-stone-200 space-y-4 rounded-none">
          <div className="flex items-center justify-between border-b border-stone-100 pb-3">
            <div>
              <h3 className="font-bold text-sm text-stone-950 flex items-center gap-2">
                <BarChart2 className="w-4 h-4 text-stone-900" />
                Word Familiarity Distribution
              </h3>
              <p className="text-[11px] text-stone-500 font-serif italic">Breakdown of words by mastery strength level (0-4)</p>
            </div>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <RechartsBarChart data={strengthDistribution} margin={{ top: 10, right: 10, left: -20, bottom: 20 }}>
                <XAxis dataKey="level" tick={{ fontSize: 10 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
                <Tooltip 
                  formatter={(value: any, name: any, item: any) => [`${value} words`, item.payload.label]}
                  contentStyle={{ backgroundColor: "#1c1917", color: "#ffffff", border: "none", fontSize: "12px" }}
                />
                <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                  {strengthDistribution.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Bar>
              </RechartsBarChart>
            </ResponsiveContainer>
          </div>

          {/* Strength Level Legend */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-2 border-t border-stone-100 text-[10px]">
            {strengthDistribution.map((item, idx) => (
              <div key={idx} className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-none shrink-0" style={{ backgroundColor: item.color }} />
                <span className="text-stone-700 font-medium">{item.level}: {item.label} ({item.count})</span>
              </div>
            ))}
          </div>
        </div>

        {/* Deck Mastery Percentage Chart */}
        <div className="bg-white p-6 border border-stone-200 space-y-4 rounded-none">
          <div className="flex items-center justify-between border-b border-stone-100 pb-3">
            <div>
              <h3 className="font-bold text-sm text-stone-950 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-stone-900" />
                Mastery by Vocabulary Deck
              </h3>
              <p className="text-[11px] text-stone-500 font-serif italic">Percentage of mastered words per collection</p>
            </div>
          </div>

          <div className="h-64 w-full">
            {deckPerformanceData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <RechartsBarChart data={deckPerformanceData} layout="vertical" margin={{ top: 5, right: 20, left: 30, bottom: 5 }}>
                  <XAxis type="number" domain={[0, 100]} unit="%" tick={{ fontSize: 10 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={80} />
                  <Tooltip 
                    formatter={(value: any, name: any, item: any) => [
                      `${value}% Mastered (${item.payload.mastered}/${item.payload.total} words)`, 
                      item.payload.fullName
                    ]}
                    contentStyle={{ backgroundColor: "#1c1917", color: "#ffffff", border: "none", fontSize: "12px" }}
                  />
                  <Bar dataKey="masteryPercent" fill="#10b981" radius={[0, 2, 2, 0]} />
                </RechartsBarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-stone-400 italic">
                No decks created yet
              </div>
            )}
          </div>

          <div className="pt-2 border-t border-stone-100 text-[11px] text-stone-500 font-serif italic text-right">
            Mastery requires strength level 3 or manual learned flag
          </div>
        </div>
      </div>

      {/* DETAILED WORDS ANALYSIS & MANAGEMENT SECTION */}
      <div className="bg-white border border-stone-200 p-6 space-y-6 rounded-none shadow-2xs" id="words-breakdown-section">
        {/* Navigation Tabs Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-stone-200 pb-4">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Needs Improvement Tab */}
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

            {/* Mastered Tab */}
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

            {/* Starred Tab */}
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

            {/* All Tab */}
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

          {/* Practice Action for Weak Words */}
          {activeTab === 'improving' && improvingWords.length > 0 && (
            <button
              onClick={() => onStartPracticeWeakWords(improvingWords.map(i => i.word))}
              className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs uppercase tracking-wider flex items-center gap-1.5 cursor-pointer shrink-0 transition-all"
            >
              <Zap className="w-3.5 h-3.5 fill-current" />
              <span>Start Quiz on Weak Words</span>
            </button>
          )}
        </div>

        {/* Search, Filter & Sorting Bar */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* Search Input */}
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

          {/* Filter by Deck */}
          <div className="flex items-center gap-2">
            <Filter className="w-3.5 h-3.5 text-stone-500 shrink-0" />
            <select
              value={selectedDeckId}
              onChange={(e) => setSelectedDeckId(e.target.value)}
              className="w-full px-3 py-2 bg-stone-50 border border-stone-200 text-xs text-stone-900 outline-none focus:border-stone-900 rounded-none cursor-pointer"
            >
              <option value="all">All Decks ({decks.length})</option>
              {decks.map(deck => (
                <option key={deck.id} value={deck.id}>
                  {deck.name} ({deck.words.length} words)
                </option>
              ))}
            </select>
          </div>

          {/* Sort By */}
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
            {filteredWords.map(({ word, deckId, deckName }) => {
              const isMastered = word.learned || word.strength >= 3;
              const strengthLevel = word.strength ?? 0;

              return (
                <div 
                  key={`${deckId}-${word.id}`}
                  className={`bg-stone-50 border p-4 space-y-3 relative flex flex-col justify-between transition-all hover:border-stone-400 ${
                    isMastered ? "border-emerald-200 hover:border-emerald-400" : "border-rose-200 hover:border-rose-400"
                  }`}
                >
                  {/* Top Word Header */}
                  <div className="space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="text-[9px] font-bold uppercase tracking-widest text-stone-500 block">
                          {deckName}
                        </span>
                        <h4 className="text-base font-bold text-stone-950 font-serif">{word.word}</h4>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        {/* Audio Pronunciation Button */}
                        <button
                          onClick={() => handleSpeakWord(word.word, word.id)}
                          className={`p-1.5 border border-stone-200 bg-white hover:border-stone-900 text-stone-700 transition-all cursor-pointer ${
                            speakingWordId === word.id ? "bg-amber-100 text-amber-900 animate-pulse" : ""
                          }`}
                          title="Listen Pronunciation"
                        >
                          <Volume2 className="w-3.5 h-3.5" />
                        </button>

                        {/* Star Toggle */}
                        <button
                          onClick={() => onToggleStarWord(word.id)}
                          className={`p-1.5 border bg-white transition-all cursor-pointer ${
                            word.starred 
                              ? "border-amber-400 text-amber-500 fill-amber-400" 
                              : "border-stone-200 text-stone-400 hover:text-stone-900"
                          }`}
                          title={word.starred ? "Unstar word" : "Star word for priority review"}
                        >
                          <Star className={`w-3.5 h-3.5 ${word.starred ? "fill-amber-400" : ""}`} />
                        </button>
                      </div>
                    </div>

                    {/* Pronunciation & Part of speech */}
                    <div className="flex items-center gap-2 text-xs text-stone-500 font-mono">
                      {word.pronunciation && <span>/{word.pronunciation}/</span>}
                      {word.partOfSpeech && (
                        <span className="text-[10px] bg-stone-200 px-1.5 py-0.5 text-stone-800 font-semibold font-sans">
                          {word.partOfSpeech}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Definitions & Translations */}
                  <div className="space-y-1 text-xs pt-1 border-t border-stone-200/60">
                    <p className="text-stone-800 font-serif italic leading-snug">
                      "{word.definition}"
                    </p>
                    {word.translation && (
                      <p className="text-stone-600 text-[11px]">
                        <span className="font-semibold text-stone-900">Translation: </span>
                        {word.translation}
                      </p>
                    )}
                    {word.example && (
                      <p className="text-[10px] text-stone-500 font-mono bg-white p-2 border border-stone-100 mt-2">
                        "{word.example}"
                      </p>
                    )}
                  </div>

                  {/* Bottom Strength Bar & Mastery Toggle */}
                  <div className="pt-3 border-t border-stone-200 flex items-center justify-between gap-2 mt-auto">
                    {/* Strength visual bar */}
                    <div className="space-y-1">
                      <span className="text-[9px] font-bold text-stone-500 uppercase tracking-widest block">
                        Strength: Lvl {strengthLevel}/4
                      </span>
                      <div className="flex items-center gap-1">
                        {[0, 1, 2, 3, 4].map(step => (
                          <span 
                            key={step} 
                            className={`w-3 h-1.5 rounded-none ${
                              step <= strengthLevel 
                                ? (strengthLevel >= 3 ? "bg-emerald-600" : strengthLevel === 2 ? "bg-amber-500" : "bg-rose-500") 
                                : "bg-stone-200"
                            }`} 
                          />
                        ))}
                      </div>
                    </div>

                    {/* Toggle Mastered Button */}
                    <button
                      onClick={() => onToggleLearnedWord(deckId, word.id)}
                      className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 border transition-all cursor-pointer ${
                        isMastered 
                          ? "bg-emerald-50 border-emerald-300 text-emerald-800 hover:bg-emerald-100" 
                          : "bg-white border-stone-300 text-stone-700 hover:border-stone-900"
                      }`}
                      title={isMastered ? "Click to mark as needing improvement" : "Click to mark as mastered"}
                    >
                      {isMastered ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-600" />
                          <span>Mastered</span>
                        </>
                      ) : (
                        <span>Mark Mastered</span>
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* Empty State */
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
