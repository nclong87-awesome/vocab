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
  brokenImageIds,
  handleImageError
}: WordCardProps) {
  return (
    <div 
      className="p-4 bg-white border border-stone-200 hover:border-stone-400 transition-all flex flex-col justify-between space-y-3.5 shadow-2xs group relative"
    >
      {/* Card Header & Controls */}
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-2 border-b border-stone-100 pb-2.5">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h4 className="text-base font-black text-stone-900 tracking-tight leading-snug">{word.word}</h4>
              <button
                type="button"
                onClick={() => speakWord(word.word)}
                className="p-1.5 text-stone-500 hover:text-stone-950 hover:bg-white transition-all cursor-pointer"
                title="Listen Pronunciation"
              >
                <Volume2 className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {word.pronunciation && (
                <span className="text-[10px] font-mono text-stone-500 bg-stone-100 border border-stone-200 px-1.5 py-0.5">
                  {word.pronunciation}
                </span>
              )}
              <span className="text-[10px] font-bold uppercase font-mono bg-stone-900 text-white px-1.5 py-0.5">
                {word.partOfSpeech || "noun"}
              </span>
              {word.category && (
                <span className="text-[10px] font-semibold bg-amber-100 text-amber-900 border border-amber-300 px-1.5 py-0.5">
                  🏷️ {word.category}
                </span>
              )}
            </div>
          </div>

          {/* Action Buttons Bar */}
          <div className="word-card-actions">
            <button
              type="button"
              onClick={() => onToggleStar(word.id)}
              className={`p-1.5 transition-all cursor-pointer ${
                word.starred ? "text-amber-500 fill-current bg-white shadow-2xs" : "text-stone-300 hover:text-stone-600"
              }`}
              title={word.starred ? "Unstar" : "Star"}
            >
              <Star className="w-3.5 h-3.5 fill-current" />
            </button>
            <button
              type="button"
              onClick={() => handleRegenerateWord(word)}
              disabled={regeneratingWordId === word.id}
              className="p-1.5 text-stone-300 hover:text-red-600 hover:bg-white transition-all cursor-pointer"
              title="Re-generate definition & translation with AI"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${regeneratingWordId === word.id ? "animate-spin text-amber-600" : ""}`} />
            </button>
            <button
              type="button"
              onClick={() => onToggleLearned(word.id)}
              className={`p-1.5 transition-all cursor-pointer ${
                word.learned ? "text-emerald-600 bg-white shadow-2xs" : "text-stone-300 hover:text-stone-600"
              }`}
              title={word.learned ? "Mastered" : "Mark Mastered"}
            >
              <CheckCircle className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onDeleteWord(word.id)}
              className="p-1.5 text-stone-300 hover:text-red-600 hover:bg-white transition-all cursor-pointer"
              title="Delete Entry"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Success message badge after regeneration */}
        {regeneratedSuccessWordId === word.id && (
          <div className="p-1.5 bg-emerald-50 border border-emerald-200 text-emerald-800 text-[10px] font-bold flex items-center gap-1">
            <CheckCircle className="w-3 h-3 text-emerald-600 shrink-0" />
            <span>AI details updated!</span>
          </div>
        )}

        {/* Meaning Highlight Block */}
        <div className="bg-amber-50/80 border border-amber-200/90 p-2.5 space-y-0.5">
          <span className="text-[10px] font-mono font-bold uppercase text-amber-800 tracking-wider block">Meaning</span>
          <p className="text-xs font-black text-amber-950">{word.translation}</p>
        </div>

        {/* Domain / Context Description */}
        {word.context && (
          <div className="text-[11px] text-stone-700 bg-stone-50 border-l-2 border-amber-500 px-2 py-1 space-y-0.5">
            <span className="font-mono font-bold uppercase text-[9px] text-amber-800 tracking-wider block">Usage Context</span>
            <p className="text-[11px] leading-tight text-stone-700">{word.context}</p>
          </div>
        )}

        {/* Definition Text */}
        {word.definition && (
          <div className="space-y-0.5 pt-1">
            <span className="text-[10px] font-mono font-bold uppercase text-stone-400 block">Definition</span>
            <p className="text-xs text-stone-700 font-serif italic leading-relaxed">
              "{word.definition}"
            </p>
          </div>
        )}

        {word.example && (
          <div className="bg-stone-50 border border-stone-200 p-2.5 space-y-1 text-xs">
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-stone-400 block">Context</span>
            <p className="font-serif italic text-stone-800 leading-snug">"{word.example}"</p>
            {word.exampleTranslation && (
              <p className="text-[11px] text-stone-500 font-sans">{word.exampleTranslation}</p>
            )}
          </div>
        )}
      </div>

      {/* Card Footer Status Pill */}
      <div className="pt-2 border-t border-stone-100 flex items-center justify-between text-[11px]">
        <span className={`font-semibold px-2 py-0.5 flex items-center gap-1 ${
          word.learned 
            ? "bg-emerald-50 text-emerald-800 border border-emerald-200" 
            : "bg-stone-100 text-stone-600 border border-stone-200"
        }`}>
          {word.learned ? "✓ Mastered" : "• Learning"}
        </span>
        {word.starred && (
          <span className="text-amber-700 font-semibold flex items-center gap-1">
            ★ Starred
          </span>
        )}
      </div>
    </div>
  );
}
