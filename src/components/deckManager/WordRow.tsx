import { useState } from "react";
import { AnimatePresence } from "motion/react";
import { Volume2, RefreshCw, Star, CheckCircle, Trash2, History } from "lucide-react";
import { Word } from "../../types";
import StrengthHistoryModal from "../analytics/StrengthHistoryModal";

interface WordRowProps {
  key?: React.Key;
  word: Word;
  speakWord: (text: string) => void;
  handleRegenerateWord: (word: Word) => void;
  regeneratingWordId: string | null;
  onToggleStar: (wordId: string) => void;
  onToggleLearned: (wordId: string) => void;
  onDeleteWord: (wordId: string) => void;
  brokenImageIds: Set<string>;
  handleImageError: (wordId: string) => void;
  onUpdateWord?: (updatedWord: Word) => void;
}

export default function WordRow({
  word: initialWord,
  speakWord,
  handleRegenerateWord,
  regeneratingWordId,
  onToggleStar,
  onToggleLearned,
  onDeleteWord,
  brokenImageIds: _brokenImageIds,
  handleImageError: _handleImageError,
  onUpdateWord
}: WordRowProps) {
  const [localWord, setLocalWord] = useState<Word | null>(null);
  const [showHistoryModal, setShowHistoryModal] = useState(false);

  const word = localWord || initialWord;

  const handleModalWordUpdate = (updated: Word) => {
    setLocalWord(updated);
    if (onUpdateWord) {
      onUpdateWord(updated);
    }
  };

  return (
    <>
      <div 
        className={`p-4 transition-all duration-300 flex flex-col md:flex-row md:items-center justify-between gap-4 rounded-xl border ${
          word.learned
            ? "border-emerald-250 bg-emerald-50/5 hover:border-emerald-300"
            : "border-stone-200 bg-white hover:border-stone-300 hover:shadow-2xs"
        } group`}
      >
        <div className="flex items-start md:items-center gap-3.5 min-w-0 flex-1">
          <div className="space-y-1.5 min-w-0 flex-1">
            <div className="flex items-baseline gap-2 flex-wrap">
              <h4 className="text-base font-bold text-stone-900 tracking-tight">{word.word}</h4>
              {word.pronunciation && (
                <span className="text-[10px] font-mono text-stone-400">/{word.pronunciation}/</span>
              )}
              <span className="text-[9px] font-bold uppercase font-mono bg-stone-100 text-stone-600 px-1.5 py-0.5 rounded tracking-wide">
                {word.partOfSpeech || "noun"}
              </span>
              {word.category && (
                <span className="text-[9px] font-bold bg-amber-50 text-amber-800 border border-amber-200/50 px-1.5 py-0.5 rounded flex items-center gap-1">
                  <span>🏷️</span>
                  <span>{word.category}</span>
                </span>
              )}
            </div>
            <div className="flex items-baseline gap-2">
              <p className="text-xs font-bold text-stone-805">{word.translation}</p>
              {word.definition && (
                <p className="text-xs text-stone-500 font-serif italic truncate max-w-md hidden sm:block">
                  — "{word.definition}"
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 border-t md:border-t-0 pt-3 md:pt-0 border-stone-100 justify-between md:justify-end shrink-0">
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => setShowHistoryModal(true)}
              className="flex flex-col items-center justify-center hidden sm:flex cursor-pointer hover:opacity-80 transition-opacity"
              title={`Memory Strength: ${word.strength || 0}%. Click for strength history.`}
            >
              <div className="h-1.5 w-12 bg-stone-100 border border-stone-200/60 rounded-full overflow-hidden mb-0.5">
                <div 
                  className={`h-full transition-all duration-500 ${
                    (word.strength || 0) >= 80 ? 'bg-emerald-500' : 
                    (word.strength || 0) >= 40 ? 'bg-amber-400' : 
                    'bg-rose-450'
                  }`} 
                  style={{ width: `${Math.max(0, Math.min(100, word.strength || 0))}%` }}
                />
              </div>
              <span className="text-[8px] font-bold text-stone-400 leading-none">{Math.round(word.strength || 0)}%</span>
            </button>

            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
              word.learned 
                ? "bg-emerald-50 text-emerald-800 border-emerald-200/60" 
                : "bg-stone-100 text-stone-600 border-stone-200/60"
            }`}>
              {word.learned ? "Mastered" : "Learning"}
            </span>
          </div>

          <div className="flex items-center gap-1 bg-stone-50 p-1 border border-stone-150 rounded-lg shrink-0 shadow-3xs">
            <button
              type="button"
              onClick={() => setShowHistoryModal(true)}
              className="p-1.5 rounded-md text-amber-700 hover:text-amber-950 hover:bg-white transition-all cursor-pointer"
              title="View Strength History"
            >
              <History className="w-3.5 h-3.5 text-amber-600" />
            </button>
            <button
              type="button"
              onClick={() => speakWord(word.word)}
              className="p-1.5 rounded-md text-stone-450 hover:text-stone-950 hover:bg-white transition-all cursor-pointer"
              title="Listen Pronunciation"
            >
              <Volume2 className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => handleRegenerateWord(word)}
              disabled={regeneratingWordId === word.id}
              className="p-1.5 rounded-md text-stone-450 hover:text-amber-600 hover:bg-white transition-all cursor-pointer disabled:opacity-50"
              title="Re-generate details with AI"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${regeneratingWordId === word.id ? "animate-spin text-amber-600" : ""}`} />
            </button>
            <button
              type="button"
              onClick={() => onToggleStar(word.id)}
              className={`p-1.5 rounded-md transition-all cursor-pointer ${
                word.starred ? "text-amber-500 fill-amber-500 bg-white shadow-3xs" : "text-stone-400 hover:text-stone-700"
              }`}
              title={word.starred ? "Unstar" : "Star"}
            >
              <Star className="w-3.5 h-3.5 fill-current" />
            </button>
            <button
              type="button"
              onClick={() => onToggleLearned(word.id)}
              className={`p-1.5 rounded-md transition-all cursor-pointer ${
                word.learned ? "text-emerald-600 bg-white shadow-3xs" : "text-stone-400 hover:text-stone-700"
              }`}
              title={word.learned ? "Mastered" : "Mark Mastered"}
            >
              <CheckCircle className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onDeleteWord(word.id)}
              className="p-1.5 rounded-md text-stone-400 hover:text-red-600 hover:bg-white transition-all cursor-pointer"
              title="Delete Entry"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
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
