import { Volume2, MessageSquare, History } from "lucide-react";
import { Word } from "../../types";

export interface WordReviewedBannerProps {
  word: Word;
  onPlayAudio?: (wordText: string) => void;
  onAskAi?: (word: Word) => void;
  onViewHistory?: (word: Word) => void;
  hideAskAiButton?: boolean;
  className?: string;
  prefixLabel?: string;
}

export default function WordReviewedBanner({
  word,
  onPlayAudio,
  onAskAi,
  onViewHistory,
  hideAskAiButton = true,
  className = "",
  prefixLabel = "Word Reviewed:"
}: WordReviewedBannerProps) {
  if (!word || !word.word) return null;

  return (
    <div 
      className={`my-2 p-2.5 px-3 bg-amber-50/90 border border-amber-200/90 rounded-xl flex items-center justify-between gap-2 shadow-2xs ${className}`}
      id={`word-reviewed-banner-${word.id || word.word.replace(/\s+/g, "_")}`}
    >
      <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap min-w-0">
          <span className="text-[10px] font-bold uppercase tracking-wider text-amber-900 font-mono">
            {prefixLabel}
          </span>
          <span className="text-xs sm:text-sm font-bold text-stone-900 font-serif">
            {word.word}
          </span>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {word.partOfSpeech && (
            <span className="text-[9px] font-bold uppercase bg-amber-200/70 text-amber-950 px-1.5 py-0.5 rounded font-mono">
              {word.partOfSpeech}
            </span>
          )}
          {word.strength !== undefined && (
            <span className="text-[10px] font-mono font-bold bg-white text-stone-700 px-1.5 py-0.5 rounded border border-amber-200/70 shadow-3xs">
              {word.strength}% strength
            </span>
          )}
          {word.translation && (
            <span className="text-[11px] text-stone-500 font-serif italic hidden md:inline truncate max-w-[160px]">
              "{word.translation}"
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {onPlayAudio && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onPlayAudio(word.word);
            }}
            className="p-1.5 px-2 bg-white hover:bg-amber-100 hover:border-amber-400 text-amber-800 hover:text-amber-950 rounded-lg border border-amber-200/80 transition-all flex items-center gap-1 text-[11px] font-semibold cursor-pointer shadow-3xs hover:scale-105"
            title={`Play audio for "${word.word}"`}
          >
            <Volume2 className="w-3.5 h-3.5 text-amber-700" />
            <span className="hidden sm:inline">Audio</span>
          </button>
        )}

        {!hideAskAiButton && onAskAi && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onAskAi(word);
            }}
            className="p-1.5 px-2 bg-white hover:bg-amber-100 hover:border-amber-400 text-indigo-700 hover:text-indigo-950 rounded-lg border border-amber-200/80 transition-all flex items-center gap-1 text-[11px] font-semibold cursor-pointer shadow-3xs hover:scale-105"
            title={`Ask AI about "${word.word}"`}
          >
            <MessageSquare className="w-3.5 h-3.5 text-indigo-600" />
            <span className="hidden sm:inline">Ask AI</span>
          </button>
        )}

        {onViewHistory && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onViewHistory(word);
            }}
            className="p-1.5 px-2 bg-white hover:bg-amber-100 hover:border-amber-400 text-amber-800 hover:text-amber-950 rounded-lg border border-amber-200/80 transition-all flex items-center gap-1 text-[11px] font-semibold cursor-pointer shadow-3xs hover:scale-105"
            title={`View Strength History for "${word.word}"`}
          >
            <History className="w-3.5 h-3.5 text-amber-600" />
            <span className="hidden sm:inline">Strength History</span>
          </button>
        )}
      </div>
    </div>
  );
}
