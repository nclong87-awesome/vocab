import React from "react";
import { Volume2, RefreshCw, Star, CheckCircle, Trash2 } from "lucide-react";
import { Word } from "../../types";

interface WordRowProps {
  key?: React.Key;
  word: Word;
  activeDeckId: string;
  speakWord: (text: string) => void;
  handleRegenerateWord: (word: Word) => void;
  regeneratingWordId: string | null;
  onToggleStar: (wordId: string) => void;
  onToggleLearned: (wordId: string) => void;
  onDeleteWord: (deckId: string, wordId: string) => void;
  brokenImageIds: Set<string>;
  handleImageError: (wordId: string) => void;
}

export default function WordRow({
  word,
  activeDeckId,
  speakWord,
  handleRegenerateWord,
  regeneratingWordId,
  onToggleStar,
  onToggleLearned,
  onDeleteWord,
  brokenImageIds,
  handleImageError
}: WordRowProps) {
  return (
    <div 
      className="bg-white border border-stone-200 hover:border-stone-400 p-3.5 transition-all flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-2xs group"
    >
      <div className="flex items-start md:items-center gap-3.5 min-w-0 flex-1">
        {/* Optional Image thumbnail in compact list */}
        {word.imageUrl && !brokenImageIds.has(word.id) && (
          <img 
            src={word.imageUrl} 
            alt={word.word} 
            referrerPolicy="no-referrer" 
            onError={() => handleImageError(word.id)}
            className="w-12 h-12 object-cover border border-stone-200 shrink-0 hidden sm:block" 
          />
        )}
        <div className="space-y-1 min-w-0 flex-1">
          <div className="flex items-baseline gap-2 flex-wrap">
            <h4 className="text-base font-black text-stone-900">{word.word}</h4>
            {word.pronunciation && (
              <span className="text-[10px] font-mono text-stone-500">[{word.pronunciation}]</span>
            )}
            <span className="text-[10px] font-bold uppercase font-mono bg-stone-900 text-white px-1.5 py-0.2">
              {word.partOfSpeech || "noun"}
            </span>
          </div>
          <p className="text-xs font-bold text-amber-950">{word.translation}</p>
          {word.definition && (
            <p className="text-xs text-stone-600 font-serif italic truncate">{word.definition}</p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 border-t md:border-t-0 pt-2.5 md:pt-0 border-stone-100 justify-between md:justify-end shrink-0">
        <span className={`text-[10px] font-bold px-2 py-0.5 border ${
          word.learned 
            ? "bg-emerald-50 text-emerald-800 border-emerald-200" 
            : "bg-stone-100 text-stone-600 border-stone-200"
        }`}>
          {word.learned ? "Mastered" : "Learning"}
        </span>

        <div className="flex items-center gap-1 bg-stone-50 p-1 border border-stone-200">
          <button
            type="button"
            onClick={() => speakWord(word.word)}
            className="p-1.5 text-stone-500 hover:text-stone-950 hover:bg-white transition-all cursor-pointer"
            title="Listen Pronunciation"
          >
            <Volume2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => handleRegenerateWord(word)}
            disabled={regeneratingWordId === word.id}
            className="p-1.5 text-stone-500 hover:text-amber-600 hover:bg-white transition-all cursor-pointer disabled:opacity-50"
            title="Re-generate details with AI"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${regeneratingWordId === word.id ? "animate-spin text-amber-600" : ""}`} />
          </button>
          <button
            type="button"
            onClick={() => onToggleStar(word.id)}
            className={`p-1.5 transition-all cursor-pointer ${
              word.starred ? "text-amber-500 fill-current bg-white shadow-2xs" : "text-stone-300 hover:text-stone-600"
            }`}
          >
            <Star className="w-3.5 h-3.5 fill-current" />
          </button>
          <button
            type="button"
            onClick={() => onToggleLearned(word.id)}
            className={`p-1.5 transition-all cursor-pointer ${
              word.learned ? "text-emerald-600 bg-white shadow-2xs" : "text-stone-300 hover:text-stone-600"
            }`}
          >
            <CheckCircle className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onDeleteWord(activeDeckId, word.id)}
            className="p-1.5 text-stone-300 hover:text-red-600 hover:bg-white transition-all cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
