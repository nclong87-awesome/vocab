import React from "react";
import { Globe2, Trash2, GraduationCap } from "lucide-react";
import { Deck } from "../../types";

interface DeckCardProps {
  key?: React.Key;
  deck: Deck;
  onSelectDeck: (deckId: string) => void;
  onSelectTab: (tab: "learn" | "quiz" | "decks" | "analytics") => void;
  setDeckToDelete: (deck: { id: string; name: string } | null) => void;
}

export default function DeckCard({
  deck,
  onSelectDeck,
  onSelectTab,
  setDeckToDelete
}: DeckCardProps) {
  const totalWords = deck.words.length;
  const masteredWords = deck.words.filter(w => w.learned).length;
  const percentMastered = totalWords > 0 ? Math.round((masteredWords / totalWords) * 100) : 0;

  return (
    <div 
      className="group bg-white p-4 sm:p-8 border border-stone-200 hover:border-stone-900 transition-all duration-300 relative"
      id={`deck-card-${deck.id}`}
    >
      <div className="flex justify-between items-start">
        <div className="space-y-2 pr-6">
          <div className="flex flex-wrap items-center gap-3">
            <span className="px-2.5 py-0.5 border border-stone-200 text-stone-600 bg-stone-50 text-[11px] font-semibold">
              {deck.isCustom ? "Custom" : "Standard"}
            </span>
            <span className="text-xs font-mono font-semibold text-stone-500 flex items-center gap-1">
              <Globe2 className="w-3.5 h-3.5" /> 
              {deck.targetLanguage} ↔ {deck.nativeLanguage}
            </span>
          </div>
          <h3 className="text-xl font-bold text-stone-900 group-hover:text-stone-700 transition-colors pt-1">
            {deck.name}
          </h3>
          <p className="text-xs text-stone-400 font-serif italic max-w-lg leading-relaxed">
            {deck.description}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setDeckToDelete({ id: deck.id, name: deck.name });
            }}
            className="p-1.5 text-stone-300 hover:text-red-600 hover:bg-stone-100 transition-all cursor-pointer"
            title="Delete Deck"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="mt-8 grid grid-cols-1 sm:grid-cols-12 gap-4 items-center pt-6 border-t border-stone-100">
        <div className="sm:col-span-5 flex items-center gap-2 text-xs font-semibold text-stone-600">
          <GraduationCap className="w-4 h-4 text-stone-900" />
          <span>{totalWords} Words</span>
          <span className="text-stone-300">•</span>
          <span className="text-stone-900">{masteredWords} mastered</span>
        </div>

        <div className="sm:col-span-4 flex items-center gap-3 w-full">
          <div className="h-[2px] bg-stone-100 flex-1 overflow-hidden">
            <div 
              className="h-full bg-stone-900 transition-all duration-500" 
              style={{ width: `${percentMastered}%` }}
            />
          </div>
          <span className="text-[10px] font-mono font-bold text-stone-500 w-8 text-right">
            {percentMastered}%
          </span>
        </div>

        <div className="sm:col-span-3 flex gap-2 justify-end">
          <button
            onClick={() => onSelectDeck(deck.id)}
            className="px-3.5 py-1.5 border border-stone-200 hover:border-stone-900 bg-white transition-colors text-stone-900 text-xs font-semibold cursor-pointer"
          >
            Learn
          </button>
          <button
            onClick={() => {
              onSelectDeck(deck.id);
              onSelectTab("quiz");
            }}
            className="px-3.5 py-1.5 bg-stone-900 hover:bg-black transition-colors text-white text-xs font-semibold cursor-pointer"
          >
            Quiz
          </button>
        </div>
      </div>
    </div>
  );
}
