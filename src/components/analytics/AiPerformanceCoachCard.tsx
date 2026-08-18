import { useState, useMemo } from "react";
import { motion } from "motion/react";
import { 
  Brain, 
  X, 
  AlertTriangle, 
  Sparkles, 
  Target, 
  Volume2, 
  Zap, 
  Lightbulb, 
  BookOpen, 
  ShieldAlert, 
  Award, 
  CheckCircle2, 
  ChevronRight, 
  Flame, 
  RefreshCw, 
  Activity, 
  Check 
} from "lucide-react";
import { PerformanceAnalysisResult } from "../../services/llmClientService";
import { Word, UserStats } from "../../types";
import { getDaysSinceLastReview } from "../../utils/spacedRepetition";
import MemoryStrengthBar from "../common/MemoryStrengthBar";

interface AiPerformanceCoachCardProps {
  aiReport: PerformanceAnalysisResult | null;
  isAnalyzing: boolean;
  analysisError: string | null;
  words?: Word[];
  stats?: UserStats;
  appLanguage?: string;
  setAiReport: (report: PerformanceAnalysisResult | null) => void;
  onRunAiAnalysis: () => void;
  onSpeakWord?: (wordText: string, wordId: string, customLang?: string) => void;
}

export default function AiPerformanceCoachCard({
  aiReport,
  isAnalyzing,
  analysisError,
  words = [],
  stats,
  appLanguage: _appLanguage = "Vietnamese",
  setAiReport,
  onRunAiAnalysis,
  onSpeakWord,
}: AiPerformanceCoachCardProps) {
  // Filter state for the Top 10 Words table/grid
  const [filterType, setFilterType] = useState<'all' | 'recently_used' | 'never_used' | 'at_risk'>('all');
  const [showMicroStory, setShowMicroStory] = useState(true);
  const [copiedMnemonic, setCopiedMnemonic] = useState<string | null>(null);

  // Performance calculations
  const performanceStats = useMemo(() => {
    const totalWords = words.length;
    const mastered = words.filter(w => w.learned || (w.strength ?? 0) >= 80).length;
    const atRisk = words.filter(w => {
      const days = getDaysSinceLastReview(w);
      return (w.strength ?? 0) < 50 || (w.learned && days >= 5);
    }).length;
    const untouched = words.filter(w => w.lastReviewed === null && (w.strength ?? 0) === 0 && !w.learned).length;
    const inProgress = totalWords - mastered - untouched;

    const avgStrength = totalWords > 0 
      ? Math.round(words.reduce((acc, w) => acc + (w.strength ?? 0), 0) / totalWords)
      : 0;

    const quizAccuracy = stats && stats.totalQuizzesTaken > 0
      ? Math.round((stats.totalCorrectAnswers / stats.totalQuizzesTaken) * 100)
      : null;

    return {
      totalWords,
      mastered,
      atRisk,
      untouched,
      inProgress,
      avgStrength,
      quizAccuracy,
      streakCount: stats?.streak?.count ?? 0,
    };
  }, [words, stats]);

  // Filtered practice words
  const practiceWords = useMemo(() => {
    const list = aiReport?.topPracticeWords || [];
    if (filterType === 'recently_used') {
      return list.filter(w => w.type === 'recently_used');
    }
    if (filterType === 'never_used') {
      return list.filter(w => w.type === 'never_used');
    }
    if (filterType === 'at_risk') {
      return list.filter(w => w.riskLevel === 'critical' || w.riskLevel === 'high' || w.strength < 40);
    }
    return list;
  }, [aiReport?.topPracticeWords, filterType]);

  const copyMnemonic = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedMnemonic(id);
    setTimeout(() => setCopiedMnemonic(null), 2000);
  };

  // Loading state
  if (isAnalyzing) {
    return (
      <div className="bg-white border border-stone-200/90 p-8 rounded-2xl shadow-3xs space-y-5" id="ai-coach-loading">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-700">
            <Brain className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <h3 className="text-base font-bold text-stone-900">AI Performance Diagnostics</h3>
            <p className="text-xs text-stone-500">Evaluating learning velocity, memory decay curves, and recent review accuracy...</p>
          </div>
        </div>
        <div className="h-1.5 w-full bg-stone-100 rounded-full overflow-hidden">
          <motion.div 
            className="h-full bg-amber-500 rounded-full"
            animate={{ x: ["-100%", "100%"] }}
            transition={{ repeat: Infinity, duration: 1.5, ease: "easeInOut" }}
          />
        </div>
      </div>
    );
  }

  // Error state
  if (analysisError) {
    return (
      <div className="bg-rose-50/50 border border-rose-200 p-6 rounded-2xl space-y-4" id="ai-coach-error">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2.5 text-rose-800">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <h4 className="font-bold text-sm">Diagnostic Generation Unavailable</h4>
          </div>
          <button 
            onClick={() => setAiReport(null)}
            className="text-stone-400 hover:text-stone-700 p-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-xs text-rose-700 leading-relaxed font-mono bg-white/70 p-3 rounded-lg border border-rose-200/50">
          {analysisError}
        </p>
        <button
          onClick={onRunAiAnalysis}
          className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold transition-all flex items-center gap-2 cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Retry Analysis</span>
        </button>
      </div>
    );
  }

  if (!aiReport) return null;

  return (
    <div className="bg-white border border-stone-200/90 rounded-2xl shadow-3xs overflow-hidden space-y-6" id="ai-coach-report-card">
      {/* 1. Header Bar with Level Badge & Actions */}
      <div className="p-6 pb-0 flex flex-wrap items-center justify-between gap-4 border-b border-stone-100 pb-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-200/80 flex items-center justify-center text-amber-700 shadow-2xs shrink-0">
            <Brain className="w-5 h-5 text-amber-700" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-stone-900 tracking-tight">AI Performance & Activity Diagnosis</h2>
              {aiReport.cefrLevel && (
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-100/70 text-amber-900 border border-amber-200 font-mono">
                  {aiReport.cefrLevel}
                </span>
              )}
            </div>
            <p className="text-xs text-stone-500 font-serif italic">
              Pedagogical analysis based on your recent activity, review accuracy, and memory decay rates.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onRunAiAnalysis}
            className="px-3 py-1.5 bg-stone-50 hover:bg-stone-100 text-stone-700 border border-stone-200/80 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 cursor-pointer shadow-3xs"
            title="Refresh AI Analysis"
          >
            <RefreshCw className="w-3.5 h-3.5 text-stone-500" />
            <span>Re-analyze</span>
          </button>

          <button
            onClick={() => setAiReport(null)}
            className="p-1.5 text-stone-400 hover:text-stone-700 hover:bg-stone-100 rounded-lg transition-all cursor-pointer"
            title="Dismiss Diagnostic View"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="px-6 space-y-6">
        {/* 2. Key Performance & Activity Metrics Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5" id="diagnostic-kpi-grid">
          {/* Retention Health */}
          <div className="p-4 bg-stone-50/70 border border-stone-200/70 rounded-xl space-y-1.5">
            <div className="flex items-center justify-between text-stone-500">
              <span className="text-[10px] font-bold uppercase tracking-wider text-stone-600">Retention Health</span>
              <Activity className="w-3.5 h-3.5 text-amber-600" />
            </div>
            <div className="text-2xl font-bold text-stone-900 tracking-tight">
              {aiReport.retentionHealthScore || performanceStats.avgStrength}%
            </div>
            <div className="text-[11px] text-stone-500 font-serif italic">
              {performanceStats.avgStrength >= 70 ? "Optimal retention" : "Needs reinforcement"}
            </div>
          </div>

          {/* Quiz Accuracy */}
          <div className="p-4 bg-stone-50/70 border border-stone-200/70 rounded-xl space-y-1.5">
            <div className="flex items-center justify-between text-stone-500">
              <span className="text-[10px] font-bold uppercase tracking-wider text-stone-600">Quiz Accuracy</span>
              <Award className="w-3.5 h-3.5 text-emerald-600" />
            </div>
            <div className="text-2xl font-bold text-stone-900 tracking-tight">
              {performanceStats.quizAccuracy !== null ? `${performanceStats.quizAccuracy}%` : "—"}
            </div>
            <div className="text-[11px] text-stone-500 font-serif italic">
              {stats && stats.totalQuizzesTaken > 0 ? `${stats.totalCorrectAnswers}/${stats.totalQuizzesTaken} questions correct` : "No quizzes taken yet"}
            </div>
          </div>

          {/* Activity Consistency */}
          <div className="p-4 bg-stone-50/70 border border-stone-200/70 rounded-xl space-y-1.5">
            <div className="flex items-center justify-between text-stone-500">
              <span className="text-[10px] font-bold uppercase tracking-wider text-stone-600">Study Streak</span>
              <Flame className="w-3.5 h-3.5 text-orange-500 fill-orange-500" />
            </div>
            <div className="text-2xl font-bold text-stone-900 tracking-tight">
              {performanceStats.streakCount} <span className="text-xs font-normal text-stone-500">days</span>
            </div>
            <div className="text-[11px] text-stone-500 font-serif italic">
              {performanceStats.streakCount > 0 ? "Active study momentum" : "Start a streak today"}
            </div>
          </div>

          {/* Decay / At-Risk Vocabulary */}
          <div className="p-4 bg-stone-50/70 border border-stone-200/70 rounded-xl space-y-1.5">
            <div className="flex items-center justify-between text-stone-500">
              <span className="text-[10px] font-bold uppercase tracking-wider text-rose-700">At-Risk Terms</span>
              <ShieldAlert className="w-3.5 h-3.5 text-rose-500" />
            </div>
            <div className="text-2xl font-bold text-rose-950 tracking-tight">
              {performanceStats.atRisk}
            </div>
            <div className="text-[11px] text-rose-700 font-serif italic">
              {performanceStats.atRisk > 0 ? "Fading memory / Overdue" : "All words well-retained"}
            </div>
          </div>
        </div>

        {/* 3. Executive Assessment & Strengths / Weaknesses Breakdown */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4" id="assessment-and-breakdown">
          {/* Assessment Overview */}
          <div className="lg:col-span-1 p-5 bg-amber-50/25 border border-amber-200/70 rounded-xl space-y-3 flex flex-col justify-between">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-amber-900 font-bold text-xs uppercase tracking-wider">
                <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                <span>Coach's Trajectory Assessment</span>
              </div>
              <p className="text-xs text-stone-700 leading-relaxed font-serif">
                {aiReport.overallAssessment || "Your vocabulary acquisition is progressing steadily. Focus on reviewing high-decay words to maintain recall accuracy."}
              </p>
            </div>

            {aiReport.motivationQuote && (
              <div className="pt-3 border-t border-amber-200/50">
                <p className="text-[11px] text-amber-950 italic font-serif">
                  "{aiReport.motivationQuote}"
                </p>
              </div>
            )}
          </div>

          {/* Strengths & Vulnerabilities */}
          <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {/* Strengths */}
            <div className="p-4 bg-emerald-50/20 border border-emerald-200/60 rounded-xl space-y-2">
              <div className="flex items-center gap-1.5 text-emerald-800 text-xs font-bold">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span>Key Strengths & Mastery</span>
              </div>
              <p className="text-xs text-stone-700 leading-relaxed">
                {aiReport.strengthsSummary || "High retention on learned verbs and consistent vocabulary exploration."}
              </p>
            </div>

            {/* Vulnerabilities */}
            <div className="p-4 bg-rose-50/20 border border-rose-200/60 rounded-xl space-y-2">
              <div className="flex items-center gap-1.5 text-rose-800 text-xs font-bold">
                <AlertTriangle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                <span>Improvement Areas & Gaps</span>
              </div>
              <p className="text-xs text-stone-700 leading-relaxed">
                {aiReport.weaknessesSummary || "Untouched vocabulary and words with over 5 days since the last active quiz review."}
              </p>
            </div>

            {/* Actionable Tips (spans 2 cols) */}
            {aiReport.actionableTips && aiReport.actionableTips.length > 0 && (
              <div className="sm:col-span-2 p-4 bg-stone-50 border border-stone-200/70 rounded-xl space-y-2">
                <div className="flex items-center gap-1.5 text-stone-800 text-xs font-bold">
                  <Lightbulb className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                  <span>Actionable Study Recommendations</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {aiReport.actionableTips.slice(0, 4).map((tip, idx) => (
                    <div key={idx} className="flex items-start gap-2 text-xs text-stone-600">
                      <ChevronRight className="w-3 h-3 text-amber-600 shrink-0 mt-0.5" />
                      <span>{tip}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 4. Context Immersion Micro-Story (Collapsible) */}
        {aiReport.contextStory && aiReport.contextStory.story && (
          <div className="border border-stone-200/80 rounded-xl overflow-hidden bg-stone-50/40">
            <button
              onClick={() => setShowMicroStory(!showMicroStory)}
              className="w-full px-4 py-3 flex items-center justify-between bg-stone-50/80 hover:bg-stone-100/80 text-left transition-all cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-amber-600" />
                <span className="text-xs font-bold text-stone-900">
                  {aiReport.contextStory.title || "AI Context Immersion Micro-Story"}
                </span>
                <span className="text-[10px] text-stone-500 font-mono">
                  (Target vocabulary in authentic context)
                </span>
              </div>
              <span className="text-xs font-medium text-stone-500">
                {showMicroStory ? "Hide" : "Show"}
              </span>
            </button>

            {showMicroStory && (
              <div className="p-4 bg-white border-t border-stone-200/60 space-y-2.5">
                <p className="text-xs sm:text-sm text-stone-800 leading-relaxed font-serif">
                  {aiReport.contextStory.story.split(/(\*\*.*?\*\*)/).map((part, i) => {
                    if (part.startsWith('**') && part.endsWith('**')) {
                      return (
                        <span key={i} className="font-bold text-amber-900 bg-amber-100/70 px-1 py-0.5 rounded font-sans">
                          {part.slice(2, -2)}
                        </span>
                      );
                    }
                    return part;
                  })}
                </p>
                {aiReport.contextStory.storyTranslation && (
                  <p className="text-xs text-stone-500 italic border-t border-stone-100 pt-2 font-serif">
                    {aiReport.contextStory.storyTranslation}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* 5. Top 10 Prioritized Words for Practice */}
        <div className="space-y-4 pt-2">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-stone-900 flex items-center gap-2">
                <Target className="w-4 h-4 text-amber-600" />
                <span>Top Recommended Target Vocabulary ({aiReport.topPracticeWords?.length || 0})</span>
              </h3>
              <p className="text-xs text-stone-500 font-serif italic">
                Identified based on low retention, memory decay, and untouched vocabulary in your library.
              </p>
            </div>

            {/* Filter Tabs */}
            <div className="flex items-center gap-1 bg-stone-100 p-1 rounded-lg border border-stone-200/80 shrink-0 text-xs">
              <button
                onClick={() => setFilterType('all')}
                className={`px-2.5 py-1 rounded-md font-medium transition-all cursor-pointer ${
                  filterType === 'all' ? "bg-white text-stone-900 font-bold shadow-3xs" : "text-stone-600 hover:text-stone-900"
                }`}
              >
                All ({aiReport.topPracticeWords?.length || 0})
              </button>
              <button
                onClick={() => setFilterType('recently_used')}
                className={`px-2.5 py-1 rounded-md font-medium transition-all cursor-pointer ${
                  filterType === 'recently_used' ? "bg-white text-stone-900 font-bold shadow-3xs" : "text-stone-600 hover:text-stone-900"
                }`}
              >
                Recent / Low Strength
              </button>
              <button
                onClick={() => setFilterType('never_used')}
                className={`px-2.5 py-1 rounded-md font-medium transition-all cursor-pointer ${
                  filterType === 'never_used' ? "bg-white text-stone-900 font-bold shadow-3xs" : "text-stone-600 hover:text-stone-900"
                }`}
              >
                Untouched
              </button>
              <button
                onClick={() => setFilterType('at_risk')}
                className={`px-2.5 py-1 rounded-md font-medium transition-all cursor-pointer ${
                  filterType === 'at_risk' ? "bg-white text-rose-700 font-bold shadow-3xs" : "text-stone-600 hover:text-stone-900"
                }`}
              >
                At Risk
              </button>
            </div>
          </div>

          {/* Words List Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5" id="top-practice-words-grid">
            {practiceWords.map((item, idx) => {
              const matchedWord = words.find(w => w.word.toLowerCase() === item.word.toLowerCase());
              const isAtRisk = item.riskLevel === 'critical' || item.riskLevel === 'high' || item.strength < 40;
              const isNeverUsed = item.type === 'never_used';

              return (
                <div
                  key={idx}
                  className={`p-4 rounded-xl border transition-all space-y-3 flex flex-col justify-between ${
                    isAtRisk 
                      ? "border-rose-200/80 bg-rose-50/10 hover:border-rose-300"
                      : isNeverUsed
                        ? "border-stone-200/90 bg-stone-50/20 hover:border-stone-300"
                        : "border-amber-200/70 bg-amber-50/10 hover:border-amber-300"
                  }`}
                >
                  {/* Top: Word, POS, Strength & Audio */}
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="text-base font-bold text-stone-900 tracking-tight">
                            {item.word}
                          </h4>
                          {item.pos && (
                            <span className="text-[10px] text-stone-500 font-mono uppercase bg-stone-100 px-1.5 py-0.5 rounded border border-stone-200/60">
                              {item.pos}
                            </span>
                          )}
                          {isNeverUsed ? (
                            <span className="text-[9px] font-bold text-stone-600 bg-stone-100 px-1.5 py-0.5 rounded border border-stone-200">
                              Untouched
                            </span>
                          ) : (
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${
                              isAtRisk 
                                ? "text-rose-700 bg-rose-50 border-rose-200" 
                                : "text-amber-800 bg-amber-50 border-amber-200"
                            }`}>
                              {item.strength}% Strength
                            </span>
                          )}
                        </div>
                        <p className="text-xs font-semibold text-stone-700 mt-0.5">
                          {item.translation}
                        </p>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        {onSpeakWord && (
                          <button
                            onClick={() => onSpeakWord(item.word, matchedWord?.id || `rec-${idx}`)}
                            className="p-1.5 rounded-lg border border-stone-200 bg-white text-stone-600 hover:text-stone-900 transition-all cursor-pointer shadow-3xs"
                            title="Listen Pronunciation"
                          >
                            <Volume2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Diagnostic Reason */}
                    <div className="p-2 bg-white/80 rounded-lg border border-stone-200/60 text-xs space-y-1">
                      <div className="flex items-center gap-1 text-[10px] font-bold text-stone-600 uppercase tracking-wide">
                        <Zap className="w-3 h-3 text-amber-600" />
                        <span>Why Review This:</span>
                      </div>
                      <p className="text-[11px] text-stone-700 leading-relaxed font-serif italic">
                        {item.reason}
                      </p>
                    </div>

                    {/* Memory Mnemonic Hook */}
                    {item.mnemonic && (
                      <div className="p-2 bg-amber-50/50 rounded-lg border border-amber-200/50 text-xs space-y-1">
                        <div className="flex items-center justify-between text-[10px] font-bold text-amber-900 uppercase tracking-wide">
                          <span className="flex items-center gap-1">
                            <Sparkles className="w-3 h-3 text-amber-600" />
                            Memory Hook / Mnemonic
                          </span>
                          <button
                            onClick={() => copyMnemonic(item.mnemonic!, `rec-${idx}`)}
                            className="text-[10px] text-amber-700 hover:text-amber-950 font-sans normal-case cursor-pointer"
                          >
                            {copiedMnemonic === `rec-${idx}` ? "Copied!" : "Copy"}
                          </button>
                        </div>
                        <p className="text-[11px] text-amber-950 leading-relaxed">
                          {item.mnemonic}
                        </p>
                      </div>
                    )}

                    {/* Context Example Sentence */}
                    {item.exampleSentence && (
                      <div className="text-[11px] text-stone-600 space-y-0.5 pt-0.5">
                        <p className="font-serif italic text-stone-800">"{item.exampleSentence}"</p>
                        {item.exampleTranslation && (
                          <p className="text-[10px] text-stone-400 font-serif">{item.exampleTranslation}</p>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Bottom: Memory Strength Bar */}
                  <div className="pt-2 border-t border-stone-100">
                    <MemoryStrengthBar strength={item.strength || 0} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Bottom Footer Information */}
      <div className="p-4 bg-stone-50 border-t border-stone-100 flex items-center justify-between gap-3 text-xs text-stone-500">
        <div className="flex items-center gap-2">
          <Check className="w-3.5 h-3.5 text-emerald-600" />
          <span>Diagnostic updates continuously incorporate your recent review sessions and recall strength.</span>
        </div>
      </div>
    </div>
  );
}
