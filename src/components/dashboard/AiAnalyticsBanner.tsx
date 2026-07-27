import React from "react";
import { Brain, ArrowRight } from "lucide-react";

interface AiAnalyticsBannerProps {
  onSelectTab: (tab: "learn" | "quiz" | "decks" | "analytics") => void;
}

export default function AiAnalyticsBanner({ onSelectTab }: AiAnalyticsBannerProps) {
  return (
    <div 
      onClick={() => onSelectTab("analytics")}
      className="bg-stone-900 text-white p-5 sm:p-6 border border-stone-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 cursor-pointer hover:border-amber-400 transition-all group shadow-2xs"
      id="analytics-callout-banner"
    >
      <div className="flex items-center gap-4">
        <div className="w-10 h-10 bg-amber-400 text-stone-950 flex items-center justify-center font-bold shrink-0">
          <Brain className="w-5 h-5" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold tracking-tight text-white group-hover:text-amber-400 transition-colors">
              AI Analytics & Mastery Dashboard
            </h3>
            <span className="bg-amber-400/20 text-amber-300 text-[10px] px-2 py-0.5 border border-amber-400/30 uppercase tracking-widest font-mono">
              AI Coach
            </span>
          </div>
          <p className="text-xs text-stone-400 font-serif italic mt-0.5">
            Analyze performance, target weak words needing practice, and view mastered terms with AI insights.
          </p>
        </div>
      </div>

      <button className="px-4 py-2 bg-amber-400 hover:bg-amber-300 text-stone-950 font-bold text-xs uppercase tracking-wider flex items-center gap-2 shrink-0 transition-all">
        <span>View Analytics</span>
        <ArrowRight className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
