import React, { useState, useEffect } from "react";
import { AnimatePresence } from "motion/react";
import { Volume2, RefreshCw, CheckCircle, Trash2, History, Languages } from "lucide-react";
import { Word } from "../../types";
import StrengthHistoryModal from "../analytics/StrengthHistoryModal";
import MemoryStrengthBar from "../common/MemoryStrengthBar";

interface WordCardProps {
  key?: React.Key;
  word: Word;
  speakWord: (text: string) => void;
  handleRegenerateWord: (word: Word) => void;
  regeneratingWordId: string | null;
  regeneratedSuccessWordId: string | null;
  onToggleStar: (wordId: string) => void;
  onToggleLearned: (wordId: string) => void;
  onDeleteWord: (wordId: string) => void;
  brokenImageIds: Set<string>;
  handleImageError: (wordId: string) => void;
  onUpdateWord?: (updatedWord: Word) => void;
}

function WordCard({
  word: initialWord,
  speakWord,
  handleRegenerateWord,
  regeneratingWordId,
  regeneratedSuccessWordId,
  onToggleStar: _onToggleStar,
  onToggleLearned: _onToggleLearned,
  onDeleteWord,
  brokenImageIds: _brokenImageIds,
  handleImageError: _handleImageError,
  onUpdateWord
}: WordCardProps) {
  const [localWord, setLocalWord] = useState<Word | null>(null);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [showTranslation, setShowTranslation] = useState(false);

  useEffect(() => {
    setLocalWord(initialWord);
  }, [initialWord]);

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
        className={`p-5 transition-all duration-300 flex flex-col justify-between space-y-4 rounded-xl border ${
          word.learned
            ? "border-emerald-200/80 bg-emerald-50/10 shadow-[0_1px_3px_rgba(16,185,129,0.02)]"
            : "border-stone-200/80 bg-white shadow-2xs"
        } hover:-translate-y-0.5 hover:border-stone-350 hover:shadow-xs group relative`}
      >
        {/* Card Header & Controls */}
        <div className="space-y-2.5 border-b border-stone-100 pb-3">
          {/* Top Row: Word Title & Action Bar */}
          <div className="flex items-start justify-between gap-2.5">
            <div className="flex items-center gap-2 min-w-0 flex-1 flex-wrap">
              <h4 className="text-lg font-bold text-stone-900 tracking-tight leading-snug break-words max-w-full">{word.word}</h4>
            </div>

            {/* Action Buttons Bar */}
            <div className="flex items-center gap-0.5 bg-stone-50/80 p-0.5 border border-stone-200/80 rounded-lg shrink-0 shadow-2xs">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  speakWord(word.word);
                }}
                className="p-1.5 rounded-md text-stone-500 hover:text-stone-950 hover:bg-stone-100 transition-all cursor-pointer"
                title="Listen Pronunciation"
              >
                <Volume2 className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowHistoryModal(true);
                }}
                className="p-1.5 rounded-md text-amber-700 hover:text-amber-950 hover:bg-amber-100/80 transition-all cursor-pointer"
                title="View Strength History"
              >
                <History className="w-3.5 h-3.5 text-amber-600" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleRegenerateWord(word);
                }}
                disabled={regeneratingWordId === word.id}
                className="p-1.5 rounded-md text-stone-400 hover:text-amber-600 hover:bg-white transition-all cursor-pointer disabled:opacity-50"
                title="Re-generate details with AI"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${regeneratingWordId === word.id ? "animate-spin text-amber-600" : ""}`} />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteWord(word.id);
                }}
                className="p-1.5 rounded-md text-stone-400 hover:text-red-600 hover:bg-white transition-all cursor-pointer"
                title="Delete Entry"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Meta Tags Row: Pronunciation, Part of Speech, Category */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {word.pronunciation && (
              <span className="text-[10px] font-mono text-stone-600 bg-stone-100/80 border border-stone-200/80 px-2 py-0.5 rounded">
                {word.pronunciation}
              </span>
            )}
            <span className="text-[10px] font-bold uppercase font-mono bg-stone-900 text-white px-2 py-0.5 rounded tracking-wider">
              {word.partOfSpeech || "noun"}
            </span>
            {word.category && (
              <span className="text-[10px] font-medium bg-amber-50 text-amber-900 border border-amber-200/70 px-2 py-0.5 rounded flex items-center gap-1">
                <span>🏷️</span>
                <span>{word.category}</span>
              </span>
            )}
          </div>
        </div>

        {/* Card Body Content */}
        <div className="space-y-3 flex-1">
          {/* Success message badge after regeneration */}
          {regeneratedSuccessWordId === word.id && (
            <div className="p-2 bg-emerald-50 border border-emerald-200 text-emerald-800 text-[10px] font-bold flex items-center gap-1.5 rounded-lg">
              <CheckCircle className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <span>AI details updated successfully!</span>
            </div>
          )}

          {/* Meaning Highlight Block */}
          <div className="bg-amber-50/30 border border-amber-200/60 p-3 rounded-lg space-y-1">
            <span className="text-[9px] font-bold uppercase text-amber-800 tracking-wider block">Meaning</span>
            <p className="text-sm font-bold text-stone-850 leading-tight">{word.translation}</p>
          </div>

          {/* Domain / Context Description */}
          {word.context && (
            <div className="text-[11px] text-stone-700 bg-stone-50 border border-stone-200/80 p-3 rounded-lg space-y-1">
              <span className="font-mono font-bold uppercase text-[9px] text-stone-400 tracking-wider block">Usage Context</span>
              <p className="text-[11px] leading-relaxed text-stone-700 font-sans">{word.context}</p>
            </div>
          )}

          {/* Definition Text */}
          {word.definition && (
            <div className="space-y-1 pt-1">
              <span className="text-[9px] font-mono font-bold uppercase text-stone-400 tracking-wider block">Definition</span>
              <p className="text-xs text-stone-750 font-serif italic leading-relaxed">
                "{word.definition}"
              </p>
            </div>
          )}

          {word.example && (
            <div className="bg-stone-50 border border-stone-150 p-3 rounded-lg space-y-1.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[9px] font-mono font-bold uppercase tracking-wider text-stone-400 block">Context Example</span>
                <div className="flex items-center gap-1.5 shrink-0">
                  {word.exampleTranslation && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowTranslation(prev => !prev);
                      }}
                      className={`p-1 rounded border transition-colors flex items-center justify-center cursor-pointer ${
                        showTranslation
                          ? "bg-amber-100 text-amber-900 border-amber-300"
                          : "bg-white hover:bg-stone-100 text-stone-500 hover:text-stone-800 border-stone-200"
                      }`}
                      title={showTranslation ? "Hide translation" : "Show translation"}
                    >
                      <Languages className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      speakWord(word.example!);
                    }}
                    className="p-1 rounded border border-stone-200 bg-white hover:bg-stone-100 text-stone-500 hover:text-stone-800 transition-colors flex items-center justify-center cursor-pointer"
                    title="Listen to example sentence"
                  >
                    <Volume2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <p className="font-serif italic text-stone-800 leading-relaxed">"{word.example}"</p>
              {word.exampleTranslation && showTranslation && (
                <p className="text-[11px] text-stone-500 font-sans leading-normal border-t border-stone-100 pt-1 mt-1">
                  {word.exampleTranslation}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Card Footer Status & Memory Strength */}
        <div className="pt-3 border-t border-stone-100 flex items-center gap-2 text-[11px] min-w-0">
          <span className={`shrink-0 font-semibold px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-full text-[10px] flex items-center gap-1.5 ${
            word.learned 
              ? "bg-emerald-50 text-emerald-800 border border-emerald-200/70" 
              : "bg-amber-50/80 text-amber-900 border border-amber-200/70"
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${word.learned ? "bg-emerald-500" : "bg-amber-500"}`} />
            <span className="truncate">{word.learned ? "Mastered" : "Learning"}</span>
          </span>

          <MemoryStrengthBar
            strength={word.strength || 0}
            onClick={() => setShowHistoryModal(true)}
          />

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

export default React.memo(WordCard);

