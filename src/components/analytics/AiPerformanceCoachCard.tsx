import { useState, useMemo } from "react";
import { 
  Brain, 
  X, 
  AlertTriangle, 
  Sparkles, 
  Target, 
  Volume2, 
  Clock, 
  Bookmark, 
  HelpCircle, 
  Layers, 
  PlusCircle, 
  ArrowRight 
} from "lucide-react";
import { PerformanceAnalysisResult } from "../../services/llmClientService";
import { Word } from "../../types";
import { getQuizCandidates, getFlashcardCandidates } from "../../utils/spacedRepetition";

interface AiPerformanceCoachCardProps {
  aiReport: PerformanceAnalysisResult | null;
  isAnalyzing: boolean;
  analysisError: string | null;
  words?: Word[];
  appLanguage?: string;
  setAiReport: (report: PerformanceAnalysisResult | null) => void;
  onRunAiAnalysis: () => void;
  onStartPracticeWords?: (words: Word[]) => void;
  onSpeakWord?: (wordText: string, wordId: string, customLang?: string) => void;
  onNavigateToView?: (view: 'chatview' | 'manage' | 'analytics' | 'settings') => void;
}

export default function AiPerformanceCoachCard({
  aiReport,
  isAnalyzing,
  analysisError,
  words = [],
  setAiReport,
  onRunAiAnalysis,
  onSpeakWord,
  onNavigateToView
}: AiPerformanceCoachCardProps) {
  const [practiceFilter, setPracticeFilter] = useState<'all' | 'recently_used' | 'never_used'>('all');

  // Potential Quiz and Flashcard Candidates
  const quizCandidates = useMemo(() => {
    return getQuizCandidates(words || []);
  }, [words]);

  const flashcardCandidates = useMemo(() => {
    return getFlashcardCandidates(words || []);
  }, [words]);

  const noQuizCandidates = quizCandidates.length === 0;
  const noFlashcardCandidates = flashcardCandidates.length === 0;
  const noCandidatesForEither = noQuizCandidates && noFlashcardCandidates;

  // Top practice words list from AI report
  const practiceWords = useMemo(() => {
    return aiReport?.topPracticeWords || [];
  }, [aiReport]);

  const recentPracticeWords = useMemo(() => {
    return practiceWords.filter(w => w.type === 'recently_used');
  }, [practiceWords]);

  const neverUsedPracticeWords = useMemo(() => {
    return practiceWords.filter(w => w.type === 'never_used');
  }, [practiceWords]);

  const filteredPracticeWords = useMemo(() => {
    if (practiceFilter === 'recently_used') return recentPracticeWords;
    if (practiceFilter === 'never_used') return neverUsedPracticeWords;
    return practiceWords;
  }, [practiceWords, recentPracticeWords, neverUsedPracticeWords, practiceFilter]);

  if (!aiReport && !isAnalyzing && !analysisError) return null;

  return (
    <div className="bg-white border border-stone-200/80 p-6 sm:p-8 space-y-6 rounded-2xl shadow-2xs hover:shadow-xs transition-shadow duration-300" id="ai-performance-coach-card">
      {/* Card Header */}
      <div className="flex items-center justify-between border-b border-stone-100 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-amber-50/60 border border-amber-200/60 rounded-xl flex items-center justify-center text-amber-700 shadow-3xs shrink-0">
            <Brain className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-stone-900 tracking-tight">AI Learning Coach Analysis</h3>
            <p className="text-xs text-stone-500 font-serif italic">Personalized cognitive assessment & top practice recommendations</p>
          </div>
        </div>

        {aiReport && (
          <button
            onClick={() => setAiReport(null)}
            className="p-2 border border-stone-200 rounded-lg hover:border-stone-400 text-stone-500 hover:text-stone-900 transition-colors cursor-pointer shadow-3xs"
            title="Dismiss AI report"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Loading Spinner */}
      {isAnalyzing && (
        <div className="py-8 text-center space-y-4">
          <div className="w-10 h-10 border-2 border-stone-200 border-t-amber-500 rounded-full animate-spin mx-auto" />
          <p className="text-xs text-stone-500 font-serif italic">
            Analyzing vocabulary mastery, quiz patterns, and word strength levels...
          </p>
        </div>
      )}

      {/* Error State */}
      {analysisError && (
        <div className="p-4 bg-rose-50 border border-rose-200 text-rose-900 text-xs space-y-3 rounded-xl">
          <div className="font-bold flex items-center gap-2 text-rose-800">
            <AlertTriangle className="w-4 h-4 text-rose-600" />
            <span>AI Analysis Error</span>
          </div>
          <p className="text-rose-700">{analysisError}</p>
          <button
            onClick={onRunAiAnalysis}
            className="px-3.5 py-1.5 bg-stone-900 hover:bg-stone-800 text-white font-bold text-[10px] uppercase tracking-wider rounded-lg shadow-xs cursor-pointer mt-2"
          >
            Try Again
          </button>
        </div>
      )}

      {/* Analysis Content */}
      {aiReport && !isAnalyzing && (
        <div className="space-y-6 text-xs">
          {/* Overall Trajectory Assessment */}
          <div className="bg-amber-50/15 p-5 border border-amber-200/30 rounded-xl space-y-2 shadow-3xs">
            <div className="flex items-center gap-2 text-stone-900 font-bold text-[10px] uppercase tracking-widest">
              <Sparkles className="w-4 h-4 text-amber-500" />
              <span>Overall Trajectory Assessment</span>
            </div>
            <p className="text-stone-800 text-sm leading-relaxed font-serif italic">
              "{aiReport.overallAssessment}"
            </p>
          </div>

          {/* PRACTICE READINESS & CANDIDATE SUMMARY SECTION */}
          <div className="bg-gradient-to-br from-stone-50/90 to-amber-50/20 border border-stone-200/90 p-5 rounded-2xl space-y-4 shadow-3xs" id="practice-candidates-summary-section">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-stone-200/60 pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 bg-amber-500 text-white font-black rounded-lg flex items-center justify-center text-xs shadow-3xs">
                    <Layers className="w-3.5 h-3.5" />
                  </span>
                  <h4 className="font-bold text-stone-900 text-sm tracking-tight">Practice Readiness & Candidate Summary</h4>
                </div>
                <p className="text-[11px] text-stone-500 font-serif italic mt-0.5">
                  Cognitive evaluation of eligible words for spaced quizzes and flashcards
                </p>
              </div>
            </div>

            {/* 2-Column Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Potential Quiz Candidates */}
              <div className={`p-4 border rounded-xl space-y-3 transition-all ${
                quizCandidates.length > 0
                  ? 'bg-white border-amber-200/90 shadow-3xs'
                  : 'bg-stone-100/60 border-stone-200 text-stone-600'
              }`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold ${
                      quizCandidates.length > 0 ? 'bg-amber-100 text-amber-900' : 'bg-stone-200 text-stone-500'
                    }`}>
                      <HelpCircle className="w-4 h-4" />
                    </div>
                    <div>
                      <h5 className="font-bold text-stone-900 text-xs">Potential Quiz Candidates</h5>
                      <span className="text-[10px] text-stone-500">Words ready for active recall testing</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className={`text-xl font-mono font-black ${
                      quizCandidates.length > 0 ? 'text-amber-600' : 'text-stone-400'
                    }`}>
                      {quizCandidates.length}
                    </span>
                    <span className="text-[10px] text-stone-400 block -mt-1 font-sans">words</span>
                  </div>
                </div>

                <p className="text-[11px] text-stone-600 leading-relaxed font-sans">
                  {quizCandidates.length > 0
                    ? `${quizCandidates.length} learned/studied words have completed review cooldown and are primed for quiz assessment.`
                    : 'No studied words are currently eligible for quiz testing (either none studied yet or all are in active review cooldown).'}
                </p>

                {quizCandidates.length > 0 && (
                  <div className="space-y-1.5 pt-1 border-t border-stone-100">
                    <span className="text-[10px] font-bold text-stone-500 uppercase tracking-wider block">Candidate Sample:</span>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {quizCandidates.slice(0, 5).map((w, i) => (
                        <span key={w.id || i} className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-50 text-amber-900 border border-amber-200/80 rounded-md text-[10px] font-medium">
                          <span>{w.word}</span>
                          <span className="text-amber-600/70 text-[9px]">({w.strength ?? 0}%)</span>
                        </span>
                      ))}
                      {quizCandidates.length > 5 && (
                        <span className="text-[10px] text-stone-400 font-serif italic">+{quizCandidates.length - 5} more</span>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Potential Flashcard Candidates */}
              <div className={`p-4 border rounded-xl space-y-3 transition-all ${
                flashcardCandidates.length > 0
                  ? 'bg-white border-indigo-200/90 shadow-3xs'
                  : 'bg-stone-100/60 border-stone-200 text-stone-600'
              }`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold ${
                      flashcardCandidates.length > 0 ? 'bg-indigo-100 text-indigo-900' : 'bg-stone-200 text-stone-500'
                    }`}>
                      <Bookmark className="w-4 h-4" />
                    </div>
                    <div>
                      <h5 className="font-bold text-stone-900 text-xs">Potential Flashcard Candidates</h5>
                      <span className="text-[10px] text-stone-500">Words ready for spaced repetition</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className={`text-xl font-mono font-black ${
                      flashcardCandidates.length > 0 ? 'text-indigo-600' : 'text-stone-400'
                    }`}>
                      {flashcardCandidates.length}
                    </span>
                    <span className="text-[10px] text-stone-400 block -mt-1 font-sans">words</span>
                  </div>
                </div>

                <p className="text-[11px] text-stone-600 leading-relaxed font-sans">
                  {flashcardCandidates.length > 0
                    ? `${flashcardCandidates.length} words available for study (unstudied terms, missed quiz items, or unlearned words past cooldown).`
                    : 'No words currently eligible for flashcards (all terms are mastered or in cooldown).'}
                </p>

                {flashcardCandidates.length > 0 && (
                  <div className="space-y-1.5 pt-1 border-t border-stone-100">
                    <span className="text-[10px] font-bold text-stone-500 uppercase tracking-wider block">Candidate Sample:</span>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {flashcardCandidates.slice(0, 5).map((w, i) => (
                        <span key={w.id || i} className="inline-flex items-center gap-1 px-2 py-0.5 bg-indigo-50 text-indigo-900 border border-indigo-200/80 rounded-md text-[10px] font-medium">
                          <span>{w.word}</span>
                          {w.translation && <span className="text-indigo-600/70 text-[9px]">({w.translation})</span>}
                        </span>
                      ))}
                      {flashcardCandidates.length > 5 && (
                        <span className="text-[10px] text-stone-400 font-serif italic">+{flashcardCandidates.length - 5} more</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Coach Recommendations when candidate counts are 0 */}
            {noCandidatesForEither ? (
              <div className="bg-amber-50/90 border border-amber-300/80 p-4 rounded-xl space-y-2.5" id="no-candidates-recommendation-alert">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 font-bold text-amber-900 text-xs">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>Coach Recommendation: Add More Words to Learn</span>
                  </div>
                  <span className="px-2 py-0.5 bg-amber-200/80 text-amber-950 font-bold text-[9px] uppercase tracking-wider rounded-md">
                    Action Recommended
                  </span>
                </div>
                <p className="text-[11px] text-amber-900/90 leading-relaxed font-sans">
                  You currently have <strong>0 potential quiz candidates</strong> and <strong>0 potential flashcard candidates</strong>. All words in your collection are either completely mastered or resting in their active cooldown window. We strongly recommend adding new vocabulary words to your collection to continue your daily momentum and unlock fresh study sessions!
                </p>
                {onNavigateToView && (
                  <div className="pt-1">
                    <button
                      onClick={() => onNavigateToView('chatview')}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold text-[11px] rounded-lg shadow-3xs transition-all cursor-pointer"
                    >
                      <PlusCircle className="w-3.5 h-3.5" />
                      <span>Add More Words to Learn</span>
                    </button>
                  </div>
                )}
              </div>
            ) : noQuizCandidates ? (
              <div className="bg-amber-50/70 border border-amber-200/80 p-3.5 rounded-xl space-y-2" id="no-quiz-candidates-recommendation">
                <div className="flex items-center gap-2 font-bold text-amber-900 text-xs">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                  <span>Coach Recommendation for Quizzes: Expand Your Learned Words</span>
                </div>
                <p className="text-[11px] text-amber-800 leading-relaxed">
                  You currently have 0 quiz candidates ready. Quizzes require words that have prior study exposure. Complete flashcard sessions for your {flashcardCandidates.length} flashcard candidate{flashcardCandidates.length === 1 ? '' : 's'} or add more words to build up your quiz pool!
                </p>
                {onNavigateToView && (
                  <button
                    onClick={() => onNavigateToView('chatview')}
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-800 hover:text-amber-950 underline cursor-pointer"
                  >
                    <span>Add more words in Chat</span>
                    <ArrowRight className="w-3 h-3" />
                  </button>
                )}
              </div>
            ) : noFlashcardCandidates ? (
              <div className="bg-indigo-50/70 border border-indigo-200/80 p-3.5 rounded-xl space-y-2" id="no-flashcard-candidates-recommendation">
                <div className="flex items-center gap-2 font-bold text-indigo-900 text-xs">
                  <AlertTriangle className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                  <span>Coach Recommendation for Flashcards: Add New Words</span>
                </div>
                <p className="text-[11px] text-indigo-800 leading-relaxed">
                  You currently have 0 flashcard candidates. All your current terms are mastered or cooling down. Take quizzes with your {quizCandidates.length} quiz candidate{quizCandidates.length === 1 ? '' : 's'} or add new words to keep expanding your vocabulary deck!
                </p>
                {onNavigateToView && (
                  <button
                    onClick={() => onNavigateToView('chatview')}
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-800 hover:text-indigo-950 underline cursor-pointer"
                  >
                    <span>Add new words to learn</span>
                    <ArrowRight className="w-3 h-3" />
                  </button>
                )}
              </div>
            ) : null}
          </div>

          {/* TOP 10 WORDS TO PRACTICE SECTION */}
          {practiceWords.length > 0 && (
            <div className="bg-gradient-to-br from-stone-50/80 to-amber-50/20 border border-amber-200/60 p-5 rounded-2xl space-y-4 shadow-3xs" id="top-words-to-practice-section">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-stone-200/60 pb-3.5">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 bg-amber-400 text-stone-950 font-black rounded-lg flex items-center justify-center text-xs shadow-3xs">
                      10
                    </span>
                    <h4 className="font-bold text-stone-900 text-sm tracking-tight">Top Words to Practice Today</h4>
                  </div>
                  <p className="text-[11px] text-stone-500 font-serif italic mt-0.5">
                    Curated by AI: Recently used terms needing reinforcement & untouched words to expand vocabulary
                  </p>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {/* Category Filter Tabs */}
                  <div className="inline-flex p-1 bg-stone-200/70 rounded-xl text-[10px] font-semibold">
                    <button
                      onClick={() => setPracticeFilter('all')}
                      className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                        practiceFilter === 'all'
                          ? 'bg-white text-stone-900 shadow-3xs font-bold'
                          : 'text-stone-600 hover:text-stone-900'
                      }`}
                    >
                      All ({practiceWords.length})
                    </button>
                    <button
                      onClick={() => setPracticeFilter('recently_used')}
                      className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                        practiceFilter === 'recently_used'
                          ? 'bg-amber-400 text-stone-950 shadow-3xs font-bold'
                          : 'text-stone-600 hover:text-stone-900'
                      }`}
                    >
                      Recent ({recentPracticeWords.length})
                    </button>
                    <button
                      onClick={() => setPracticeFilter('never_used')}
                      className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                        practiceFilter === 'never_used'
                          ? 'bg-indigo-600 text-white shadow-3xs font-bold'
                          : 'text-stone-600 hover:text-stone-900'
                      }`}
                    >
                      Never Used ({neverUsedPracticeWords.length})
                    </button>
                  </div>
                </div>
              </div>

              {/* 10 Words Cards Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {filteredPracticeWords.map((item, idx) => {
                  const isRecent = item.type === 'recently_used';

                  return (
                    <div
                      key={idx}
                      className={`p-3.5 border rounded-xl transition-all duration-200 space-y-2 relative ${
                        isRecent
                          ? 'bg-white/90 border-amber-200/80 hover:border-amber-400 hover:shadow-2xs'
                          : 'bg-indigo-50/20 border-indigo-200/80 hover:border-indigo-400 hover:shadow-2xs'
                      }`}
                    >
                      {/* Top status bar */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <span className="w-5 h-5 bg-stone-100 text-stone-700 font-mono text-[10px] font-bold rounded-md flex items-center justify-center border border-stone-200">
                            #{idx + 1}
                          </span>
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider rounded-md ${
                              isRecent
                                ? 'bg-amber-100/90 text-amber-900 border border-amber-300/60'
                                : 'bg-indigo-100/90 text-indigo-900 border border-indigo-300/60'
                            }`}
                          >
                            {isRecent ? (
                              <>
                                <Clock className="w-2.5 h-2.5" />
                                <span>Recently Used</span>
                              </>
                            ) : (
                              <>
                                <Bookmark className="w-2.5 h-2.5" />
                                <span>Never Used</span>
                              </>
                            )}
                          </span>
                        </div>

                        {/* Strength Indicator */}
                        <div className="flex items-center gap-1.5 text-[10px] font-mono">
                          <span className="text-stone-400 text-[9px]">Strength:</span>
                          <span
                            className={`font-bold ${
                              (item.strength ?? 0) >= 50
                                ? 'text-amber-600'
                                : (item.strength ?? 0) > 0
                                ? 'text-stone-700'
                                : 'text-indigo-600'
                            }`}
                          >
                            {item.strength ?? 0}%
                          </span>
                        </div>
                      </div>

                      {/* Word Title & Translation */}
                      <div className="flex items-start justify-between gap-2 pt-0.5">
                        <div>
                          <h5 className="font-bold text-stone-900 text-sm tracking-tight capitalize">
                            {item.word}
                          </h5>
                          {item.translation && (
                            <p className="text-stone-600 font-medium text-xs">
                              {item.translation}
                            </p>
                          )}
                        </div>

                        {/* Speaker Button */}
                        {onSpeakWord && (
                          <button
                            onClick={() => onSpeakWord(item.word, `coach-${item.word}-${idx}`)}
                            className="p-1.5 bg-stone-100 hover:bg-amber-100 text-stone-600 hover:text-amber-800 rounded-lg transition-colors cursor-pointer shrink-0"
                            title="Listen to pronunciation"
                          >
                            <Volume2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>

                      {/* Coach Pedagogical Reason */}
                      <div className="bg-stone-50/70 p-2 rounded-lg border border-stone-200/50 text-[11px] text-stone-700 leading-snug flex items-start gap-1.5">
                        <HelpCircle className="w-3.5 h-3.5 text-stone-400 shrink-0 mt-0.5" />
                        <span className="font-serif italic text-stone-600">
                          {item.reason}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Strengths & Weaknesses Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-emerald-50/15 p-5 border border-emerald-200/50 rounded-xl space-y-2">
              <div className="flex items-center gap-2 text-emerald-800 font-bold text-xs uppercase tracking-wider">
                <Target className="w-4 h-4 text-emerald-600" />
                <span>Key Mastery Strengths</span>
              </div>
              <p className="text-stone-700 leading-relaxed text-xs">
                {aiReport.strengthsSummary}
              </p>
            </div>

            <div className="bg-rose-50/15 p-5 border border-rose-250/50 rounded-xl space-y-2">
              <div className="flex items-center gap-2 text-rose-800 font-bold text-xs uppercase tracking-wider">
                <AlertTriangle className="w-4 h-4 text-rose-600" />
                <span>Target Areas Needing Focus</span>
              </div>
              <p className="text-stone-700 leading-relaxed text-xs">
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
                  <div key={idx} className="bg-stone-50/50 p-4 border border-stone-200/80 rounded-xl space-y-2">
                    <div className="font-bold text-stone-900 text-[11px] flex items-center gap-2">
                      <span className="w-5 h-5 bg-stone-900 text-white rounded-full flex items-center justify-center text-[10px] font-mono shadow-3xs shrink-0">
                        {idx + 1}
                      </span>
                      <span>Strategy {idx + 1}</span>
                    </div>
                    <p className="text-stone-600 text-xs leading-relaxed font-sans">{tip}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recommended Focus Topics & Motivation Quote */}
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pt-4 border-t border-stone-100">
            {aiReport.recommendedFocusTopics && aiReport.recommendedFocusTopics.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold text-stone-600 text-[10px] uppercase tracking-wider">AI Suggested Topics:</span>
                {aiReport.recommendedFocusTopics.map((topic, idx) => (
                  <span key={idx} className="bg-amber-50 text-amber-900 border border-amber-200/50 font-bold px-2.5 py-1 text-[10px] rounded-lg">
                    {topic}
                  </span>
                ))}
              </div>
            )}

            {aiReport.motivationQuote && (
              <p className="text-stone-400 font-serif italic text-xs">
                "{aiReport.motivationQuote}"
              </p>
            )}
          </div>

          {(aiReport.provider || aiReport.model || aiReport.responseTimeMs !== undefined) && (
            <div className="flex items-center gap-2 pt-2 text-[10px] text-stone-400 border-t border-stone-100/60 font-mono">
              <span className="bg-stone-100 text-stone-700 px-2 py-0.5 rounded font-semibold uppercase tracking-wider">
                {aiReport.provider || "AI"}
              </span>
              {aiReport.model && (
                <span className="text-stone-500 font-medium">
                  {aiReport.model}
                </span>
              )}
              {aiReport.responseTimeMs !== undefined && (
                <span className="text-stone-400 ml-auto font-mono">
                  {(aiReport.responseTimeMs / 1000).toFixed(1)}s
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
