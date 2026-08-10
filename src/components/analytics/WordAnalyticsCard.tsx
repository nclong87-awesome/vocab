import { useState } from "react";
import { AnimatePresence } from "motion/react";
import { Volume2, RefreshCw, History } from "lucide-react";
import { Word } from "../../types";
import { getDaysSinceLastReview } from "../../utils/spacedRepetition";
import StrengthHistoryModal from "./StrengthHistoryModal";

interface WordAnalyticsCardProps {
  key?: React.Key;
  word: Word;
  speakingWordId: string | null;
  onSpeakWord: (wordText: string, wordId: string) => void;
  onToggleStarWord?: (wordId: string) => void;
  onToggleLearnedWord?: (wordId: string) => void;
  onUpdateWord?: (updatedWord: Word) => void;
}

export default function WordAnalyticsCard({
  word: initialWord,
  speakingWordId,
  onSpeakWord,
  onToggleStarWord: _onToggleStarWord,
  onToggleLearnedWord: _onToggleLearnedWord,
  onUpdateWord
}: WordAnalyticsCardProps) {
  const [localWord, setLocalWord] = useState<Word | null>(null);
  const [showHistoryModal, setShowHistoryModal] = useState(false);

  const word = localWord || initialWord;

  const isMastered = word.learned || word.strength >= 80;
  const strengthLevel = word.strength ?? 0;
  const daysSinceReview = getDaysSinceLastReview(word);
  const isMemoryDecayed = daysSinceReview >= 5 || (word.lastReviewed !== null && strengthLevel < 80);

  const handleModalWordUpdate = (updated: Word) => {
    setLocalWord(updated);
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

        {/* Card Footer Status & Memory Strength */}
        <div className="pt-3 border-t border-stone-100 flex items-center gap-2 text-[11px] mt-auto">
          <span className={`shrink-0 font-semibold px-2.5 py-1 rounded-full text-[10px] flex items-center gap-1.5 ${
            isMastered 
              ? "bg-emerald-50 text-emerald-800 border border-emerald-200/70" 
              : "bg-amber-50/80 text-amber-900 border border-amber-200/70"
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${isMastered ? "bg-emerald-500" : "bg-amber-500"}`} />
            {isMastered ? "Mastered" : "Learning"}
          </span>

          <button
            type="button"
            onClick={() => setShowHistoryModal(true)}
            className="flex-1 min-w-0 flex items-center justify-between gap-2 cursor-pointer hover:bg-stone-50 px-2.5 py-1 rounded-md border border-stone-200/70 transition-colors bg-white shadow-2xs"
            title={`Memory Strength: ${strengthLevel}%. Click for strength history.`}
          >
            <span className="text-[9px] font-bold text-stone-400 uppercase tracking-wider shrink-0">Strength</span>
            <div className="h-1.5 flex-1 min-w-[2rem] bg-stone-150 rounded-full overflow-hidden">
              <div 
                className={`h-full transition-all duration-500 ${
                  strengthLevel >= 80 ? 'bg-emerald-500' : 
                  strengthLevel >= 40 ? 'bg-amber-500' : 
                  'bg-rose-450'
                }`} 
                style={{ width: `${Math.max(0, Math.min(100, strengthLevel))}%` }}
              />
            </div>
            <span className="text-[9px] font-mono font-bold text-stone-700 shrink-0">{Math.round(strengthLevel)}%</span>
          </button>

          {word.starred && (
            <span className="shrink-0 text-amber-700 font-bold flex items-center gap-1 text-[10px] uppercase tracking-wide bg-amber-50 border border-amber-200/70 px-2 py-1 rounded-md">
              ★
            </span>
          )}
        </div>
      </div>

      <AnimatePresence>
        {showHistoryModal && (
          <StrengthHistoryModal
            word={word}
            onClose={() => setShowHistoryModal(false)}
            onUpdateWord={handleModalWordUpdate}
          />
        )}
      </AnimatePresence>
    </>
  );
}
