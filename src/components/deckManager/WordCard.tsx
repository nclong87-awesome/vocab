import React from "react";
import { Volume2, RefreshCw, Star, CheckCircle, Trash2 } from "lucide-react";
import { Word } from "../../types";

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
}

export default function WordCard({
  word,
  speakWord,
  handleRegenerateWord,
  regeneratingWordId,
  regeneratedSuccessWordId,
  onToggleStar,
  onToggleLearned,
  onDeleteWord,
  brokenImageIds: _brokenImageIds,
  handleImageError: _handleImageError
}: WordCardProps) {
  return (
    <div 
      className={`p-5 transition-all duration-300 flex flex-col justify-between space-y-4 rounded-xl border ${
        word.learned
          ? "border-emerald-200/80 bg-emerald-50/10 shadow-[0_1px_3px_rgba(16,185,129,0.02)]"
          : "border-stone-200/80 bg-white shadow-2xs"
      } hover:-translate-y-0.5 hover:border-stone-350 hover:shadow-xs group relative`}
    >
      {/* Card Header & Controls */}
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-3 border-b border-stone-100 pb-3">
          <div className="space-y-1.5 min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="text-base font-bold text-stone-900 tracking-tight leading-snug truncate">{word.word}</h4>
              <button
                type="button"
                onClick={() => speakWord(word.word)}
                className="p-1.5 rounded-md text-stone-500 hover:text-stone-950 hover:bg-stone-50 border border-stone-200/60 bg-white transition-all cursor-pointer shadow-3xs"
                title="Listen Pronunciation"
              >
                <Volume2 className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {word.pronunciation && (
                <span className="text-[10px] font-mono text-stone-500 bg-stone-50 border border-stone-150 px-2 py-0.5 rounded">
                  {word.pronunciation}
                </span>
              )}
              <span className="text-[10px] font-bold uppercase font-mono bg-stone-900 text-white px-2 py-0.5 rounded tracking-wider">
                {word.partOfSpeech || "noun"}
              </span>
              {word.category && (
                <span className="text-[10px] font-bold bg-amber-50 text-amber-850 border border-amber-200/50 px-2 py-0.5 rounded flex items-center gap-1">
                  <span>🏷️</span>
                  <span>{word.category}</span>
                </span>
              )}
            </div>
          </div>

          {/* Action Buttons Bar */}
          <div className="word-card-actions">
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
              onClick={() => handleRegenerateWord(word)}
              disabled={regeneratingWordId === word.id}
              className="p-1.5 rounded-md text-stone-400 hover:text-amber-600 hover:bg-white transition-all cursor-pointer disabled:opacity-50"
              title="Re-generate details with AI"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${regeneratingWordId === word.id ? "animate-spin text-amber-600" : ""}`} />
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
            <span className="text-[9px] font-mono font-bold uppercase tracking-wider text-stone-400 block">Context Example</span>
            <p className="font-serif italic text-stone-800 leading-relaxed">"{word.example}"</p>
            {word.exampleTranslation && (
              <p className="text-[11px] text-stone-500 font-sans leading-normal border-t border-stone-100 pt-1 mt-1">{word.exampleTranslation}</p>
            )}
          </div>
        )}
      </div>

      {/* Card Footer Status Pill */}
      <div className="pt-3 border-t border-stone-100 flex items-center justify-between text-[11px]">
        <div className="flex items-center gap-3">
          <span className={`font-semibold px-2.5 py-0.5 rounded-full text-[10px] flex items-center gap-1.5 ${
            word.learned 
              ? "bg-emerald-50 text-emerald-800 border border-emerald-200/60" 
              : "bg-stone-100 text-stone-600 border border-stone-200/60"
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${word.learned ? "bg-emerald-500" : "bg-stone-450"}`} />
            {word.learned ? "Mastered" : "Learning"}
          </span>
          <div className="flex items-center gap-1.5" title={`Memory Strength: ${word.strength || 0}%`}>
            <div className="h-1.5 w-12 bg-stone-100 border border-stone-150 rounded-full overflow-hidden">
              <div 
                className={`h-full transition-all duration-500 ${
                  (word.strength || 0) >= 80 ? 'bg-emerald-500' : 
                  (word.strength || 0) >= 40 ? 'bg-amber-400' : 
                  'bg-rose-400'
                }`} 
                style={{ width: `${Math.max(0, Math.min(100, word.strength || 0))}%` }}
              />
            </div>
            <span className="text-[9px] font-bold text-stone-400">{Math.round(word.strength || 0)}%</span>
          </div>
        </div>
        {word.starred && (
          <span className="text-amber-600 font-bold flex items-center gap-1 text-[10px] uppercase tracking-wide">
            ★ Starred
          </span>
        )}
      </div>
    </div>
  );
}
