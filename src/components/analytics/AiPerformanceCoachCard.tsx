import { Brain, X, AlertTriangle, Sparkles, Target } from "lucide-react";
import { PerformanceAnalysisResult } from "../../services/llmClientService";

interface AiPerformanceCoachCardProps {
  aiReport: PerformanceAnalysisResult | null;
  isAnalyzing: boolean;
  analysisError: string | null;
  setAiReport: (report: PerformanceAnalysisResult | null) => void;
  onRunAiAnalysis: () => void;
}

export default function AiPerformanceCoachCard({
  aiReport,
  isAnalyzing,
  analysisError,
  setAiReport,
  onRunAiAnalysis
}: AiPerformanceCoachCardProps) {
  if (!aiReport && !isAnalyzing && !analysisError) return null;

  return (
    <div className="bg-white border border-stone-200/80 p-6 sm:p-8 space-y-6 rounded-2xl shadow-2xs hover:shadow-xs transition-shadow duration-300" id="ai-performance-coach-card">
      <div className="flex items-center justify-between border-b border-stone-100 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-amber-50/60 border border-amber-200/60 rounded-xl flex items-center justify-center text-amber-700 shadow-3xs shrink-0">
            <Brain className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-stone-900 tracking-tight">AI Learning Coach Analysis</h3>
            <p className="text-xs text-stone-500 font-serif italic">Personalized cognitive assessment & memory guidance</p>
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

      {isAnalyzing && (
        <div className="py-8 text-center space-y-4">
          <div className="w-10 h-10 border-2 border-stone-200 border-t-amber-500 rounded-full animate-spin mx-auto" />
          <p className="text-xs text-stone-500 font-serif italic">
            Analyzing vocabulary mastery, quiz patterns, and word strength levels...
          </p>
        </div>
      )}

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
        </div>
      )}
    </div>
  );
}
