import React from "react";
import { Volume2, Star, Check, RefreshCw } from "lucide-react";
import { Word } from "../../types";
import { getDaysSinceLastReview } from "../../utils/spacedRepetition";

interface WordAnalyticsCardProps {
  key?: React.Key;
  word: Word;
  speakingWordId: string | null;
  onSpeakWord: (wordText: string, wordId: string) => void;
  onToggleStarWord: (wordId: string) => void;
  onToggleLearnedWord: (wordId: string) => void;
}

export default function WordAnalyticsCard({
  word,
  speakingWordId,
  onSpeakWord,
  onToggleStarWord,
  onToggleLearnedWord
}: WordAnalyticsCardProps) {
  const isMastered = word.learned || word.strength >= 3;
  const strengthLevel = word.strength ?? 0;
  const daysSinceReview = getDaysSinceLastReview(word);
  const isMemoryDecayed = daysSinceReview >= 5 || (word.lastReviewed !== null && strengthLevel < 3);

  return (
    <div 
      className={`bg-stone-50 border p-4 space-y-3 relative flex flex-col justify-between transition-all hover:border-stone-400 ${
        isMemoryDecayed ? "border-orange-300 hover:border-orange-500 bg-orange-50/20" : isMastered ? "border-emerald-200 hover:border-emerald-400" : "border-rose-200 hover:border-rose-400"
      }`}
    >
      {/* Top Word Header */}
      <div className="space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h4 className="text-base font-bold text-stone-950 font-serif flex items-center gap-2">
              {word.word}
              {isMemoryDecayed && (
                <span className="text-[9px] font-bold text-orange-800 bg-orange-100 border border-orange-200 px-1.5 py-0.5 rounded-none font-mono flex items-center gap-0.5" title={`Last reviewed ${daysSinceReview} day(s) ago. Refresher recommended!`}>
                  <RefreshCw className="w-2.5 h-2.5 text-orange-600" />
                  {daysSinceReview > 0 ? `${daysSinceReview}d ago` : "Refresher"}
                </span>
              )}
            </h4>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {/* Audio Pronunciation Button */}
            <button
              onClick={() => onSpeakWord(word.word, word.id)}
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
          onClick={() => onToggleLearnedWord(word.id)}
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
}
