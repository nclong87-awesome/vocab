import React, { useState } from "react";
import { Volume2, Star, Check, RefreshCw, History } from "lucide-react";
import { Word } from "../../types";
import { getDaysSinceLastReview } from "../../utils/spacedRepetition";
import StrengthHistoryModal from "./StrengthHistoryModal";

interface WordAnalyticsCardProps {
  key?: React.Key;
  word: Word;
  speakingWordId: string | null;
  onSpeakWord: (wordText: string, wordId: string) => void;
  onToggleStarWord: (wordId: string) => void;
  onToggleLearnedWord: (wordId: string) => void;
  onUpdateWord?: (updatedWord: Word) => void;
}

export default function WordAnalyticsCard({
  word: initialWord,
  speakingWordId,
  onSpeakWord,
  onToggleStarWord,
  onToggleLearnedWord,
  onUpdateWord
}: WordAnalyticsCardProps) {
  const [word, setWord] = useState<Word>(initialWord);
  const [showHistoryModal, setShowHistoryModal] = useState(false);

  // Keep internal word in sync if parent passes new word prop
  React.useEffect(() => {
    setWord(initialWord);
  }, [initialWord]);

  const isMastered = word.learned || word.strength >= 80;
  const strengthLevel = word.strength ?? 0;
  const daysSinceReview = getDaysSinceLastReview(word);
  const isMemoryDecayed = daysSinceReview >= 5 || (word.lastReviewed !== null && strengthLevel < 80);

  const handleModalWordUpdate = (updated: Word) => {
    setWord(updated);
    if (onUpdateWord) {
      onUpdateWord(updated);
    }
  };

  return (
    <>
      <div 
        className={`p-5 space-y-4 relative flex flex-col justify-between transition-all duration-300 rounded-xl border ${
          isMemoryDecayed 
            ? "border-amber-300/80 bg-amber-50/15 shadow-[0_1px_3px_rgba(245,158,11,0.03)] hover:border-amber-400 hover:shadow-xs" 
            : isMastered 
              ? "border-emerald-200/80 bg-emerald-50/10 shadow-[0_1px_3px_rgba(16,185,129,0.02)] hover:border-emerald-300 hover:shadow-xs" 
              : "border-stone-200/80 bg-white shadow-2xs hover:border-stone-300 hover:shadow-xs"
        } hover:-translate-y-0.5`}
      >
        {/* Top Word Header */}
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h4 className="text-lg font-bold text-stone-900 tracking-tight flex flex-wrap items-center gap-2">
                <span className="truncate">{word.word}</span>
                {isMemoryDecayed && (
                  <span className="inline-flex items-center gap-1 text-[9px] font-bold text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full font-mono shrink-0" title={`Last reviewed ${daysSinceReview} day(s) ago. Refresher recommended!`}>
                    <RefreshCw className="w-2.5 h-2.5 text-amber-600 animate-spin-slow" />
                    <span>{daysSinceReview > 0 ? `${daysSinceReview}d ago` : "Refresher"}</span>
                  </span>
                )}
              </h4>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {/* Audio Pronunciation Button */}
              <button
                onClick={() => onSpeakWord(word.word, word.id)}
                className={`p-2 rounded-lg border border-stone-200/80 bg-white text-stone-600 hover:text-stone-900 hover:border-stone-300 transition-all cursor-pointer shadow-3xs ${
                  speakingWordId === word.id ? "bg-amber-50 text-amber-900 border-amber-300 animate-pulse" : ""
                }`}
                title="Listen Pronunciation"
              >
                <Volume2 className="w-3.5 h-3.5" />
              </button>

              {/* Strength History Button */}
              <button
                onClick={() => setShowHistoryModal(true)}
                className="p-2 rounded-lg border border-amber-200/80 bg-amber-50/50 text-amber-800 hover:text-amber-950 hover:bg-amber-100 hover:border-amber-300 transition-all cursor-pointer shadow-3xs flex items-center gap-1"
                title="View word's strength history"
              >
                <History className="w-3.5 h-3.5 text-amber-600" />
              </button>

              {/* Star Toggle */}
              <button
                onClick={() => onToggleStarWord(word.id)}
                className={`p-2 rounded-lg border bg-white transition-all cursor-pointer shadow-3xs ${
                  word.starred 
                    ? "border-amber-300 text-amber-500 bg-amber-50/30" 
                    : "border-stone-200/80 text-stone-400 hover:text-stone-700 hover:border-stone-300"
                }`}
                title={word.starred ? "Unstar word" : "Star word for priority review"}
              >
                <Star className={`w-3.5 h-3.5 ${word.starred ? "fill-amber-400 text-amber-500" : ""}`} />
              </button>
            </div>
          </div>

          {/* Pronunciation & Part of speech */}
          <div className="flex items-center gap-2 text-xs text-stone-500 font-mono">
            {word.pronunciation && (
              <span className="text-stone-400">/{word.pronunciation}/</span>
            )}
            {word.pronunciation && word.partOfSpeech && (
              <span className="text-stone-300">•</span>
            )}
            {word.partOfSpeech && (
              <span className="text-[10px] bg-stone-100 text-stone-600 font-bold px-2 py-0.5 rounded font-sans tracking-wide">
                {word.partOfSpeech}
              </span>
            )}
          </div>
        </div>

        {/* Definitions & Translations */}
        <div className="space-y-2.5 pt-2.5 border-t border-stone-100">
          <p className="text-stone-700 font-serif italic text-xs leading-relaxed">
            "{word.definition}"
          </p>
          
          {word.translation && (
            <div className="text-xs bg-stone-50/50 p-2 border border-stone-100 rounded-lg">
              <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wider block mb-0.5">Translation</span>
              <p className="font-semibold text-stone-800 text-xs">{word.translation}</p>
            </div>
          )}

          {word.example && (
            <div className="p-2.5 bg-stone-50 border border-stone-200/60 rounded-lg mt-2 text-[11px] text-stone-600 font-mono">
              <span className="text-[9px] font-bold text-stone-400 uppercase tracking-wider block mb-1">Context</span>
              <p className="leading-normal font-sans italic text-stone-700">"{word.example}"</p>
            </div>
          )}
        </div>

        {/* Bottom Strength Bar & Mastery Toggle */}
        <div className="pt-3.5 border-t border-stone-100 flex items-center justify-between gap-3 mt-auto">
          {/* Strength visual bar */}
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] font-bold text-stone-400 uppercase tracking-wider block">
                Strength: {strengthLevel}%
              </span>
              <button
                type="button"
                onClick={() => setShowHistoryModal(true)}
                className="text-[9px] font-bold text-amber-800 hover:text-amber-950 bg-amber-50 hover:bg-amber-100 border border-amber-200/80 px-1.5 py-0.5 rounded flex items-center gap-1 cursor-pointer transition-all"
                title="View strength retention history"
              >
                <History className="w-2.5 h-2.5 text-amber-600" />
                <span>History</span>
              </button>
            </div>

            <div 
              className="flex items-center gap-1.5 cursor-pointer" 
              onClick={() => setShowHistoryModal(true)}
              title="Click to view strength history"
            >
              {[0, 20, 40, 60, 80].map((step) => {
                const isActive = step <= strengthLevel;
                return (
                  <span 
                    key={step} 
                    className={`w-3.5 h-1.5 rounded-full transition-colors duration-300 ${
                      isActive 
                        ? (strengthLevel >= 80 ? "bg-emerald-500" : strengthLevel >= 40 ? "bg-amber-400" : "bg-rose-400") 
                        : "bg-stone-150"
                    }`} 
                  />
                );
              })}
            </div>
          </div>

          {/* Toggle Mastered Button */}
          <button
            onClick={() => onToggleLearnedWord(word.id)}
            className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 border rounded-lg transition-all cursor-pointer shadow-3xs hover:scale-102 active:scale-98 ${
              isMastered 
                ? "bg-emerald-50 border-emerald-200 text-emerald-800 hover:bg-emerald-100/80" 
                : "bg-white border-stone-200 text-stone-600 hover:text-stone-900 hover:border-stone-300"
            }`}
            title={isMastered ? "Click to mark as needing improvement" : "Click to mark as mastered"}
          >
            {isMastered ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span>Mastered</span>
              </>
            ) : (
              <span>Mark Mastered</span>
            )}
          </button>
        </div>
      </div>

      {showHistoryModal && (
        <StrengthHistoryModal
          word={word}
          onClose={() => setShowHistoryModal(false)}
          onUpdateWord={handleModalWordUpdate}
        />
      )}
    </>
  );
}
