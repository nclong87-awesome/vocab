import React from "react";
import { Sparkles, Wand2, X, BookOpen } from "lucide-react";

interface RandomWordsModalProps {
  isRandomWordsModalOpen: boolean;
  setIsRandomWordsModalOpen: (open: boolean) => void;
  randomCount: number;
  setRandomCount: (count: number) => void;
  randomWordsTopic: string;
  setRandomWordsTopic: (topic: string) => void;
  isGeneratingRandomWords: boolean;
  activeDeck: { name: string; description?: string; targetLanguage: string; nativeLanguage: string } | null;
  handleGenerateRandomWordsSubmit: (e: React.FormEvent) => void;
}

export default function RandomWordsModal({
  isRandomWordsModalOpen,
  setIsRandomWordsModalOpen,
  randomCount,
  setRandomCount,
  randomWordsTopic,
  setRandomWordsTopic,
  isGeneratingRandomWords,
  activeDeck,
  handleGenerateRandomWordsSubmit
}: RandomWordsModalProps) {
  if (!isRandomWordsModalOpen) return null;

  return (
    <div className="fixed inset-0 bg-stone-950/80 backdrop-blur-xs z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="bg-white border-2 border-stone-900 w-full max-w-lg p-5 sm:p-7 space-y-5 my-8 shadow-xl">
        <div className="flex justify-between items-start border-b border-stone-200 pb-3">
          <div>
            <h3 className="text-lg font-black text-stone-950">Add Random AI Words</h3>
            <p className="text-xs text-stone-500 font-serif italic mt-0.5">
              AI will generate new vocabulary words and images matched to your deck.
            </p>
          </div>
          <button 
            type="button" 
            onClick={() => setIsRandomWordsModalOpen(false)}
            className="p-1 text-stone-400 hover:text-stone-900 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Deck Context Banner */}
        {activeDeck && (
          <div className="bg-stone-100 border border-stone-300 p-3.5 space-y-1.5 rounded-none shadow-2xs">
            <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-stone-600">
              <span className="flex items-center gap-1.5 font-mono text-stone-800">
                <BookOpen className="w-3.5 h-3.5 text-amber-600" />
                Target Deck Context
              </span>
              <span className="bg-amber-400 text-stone-950 px-2 py-0.5 font-bold text-[10px]">
                {activeDeck.targetLanguage} ↔ {activeDeck.nativeLanguage}
              </span>
            </div>
            <div className="text-sm font-black text-stone-950 font-serif">
              {activeDeck.name}
            </div>
            {activeDeck.description && (
              <p className="text-xs text-stone-600 font-serif italic line-clamp-2">
                "{activeDeck.description}"
              </p>
            )}
            {isGeneratingRandomWords && (
              <div className="mt-2 pt-2 border-t border-stone-200 flex items-center gap-2 text-[11px] font-bold text-amber-700 animate-pulse">
                <Sparkles className="w-3.5 h-3.5 animate-spin text-amber-600" />
                <span>AI is generating {randomCount} terms & visual images for "{activeDeck.name}"...</span>
              </div>
            )}
          </div>
        )}

        <form onSubmit={handleGenerateRandomWordsSubmit} className="space-y-4 text-xs font-semibold">
          <div className="space-y-1">
            <label className="text-stone-800">How many random words to generate?</label>
            <div className="flex gap-2">
              {[3, 5, 8, 10].map((num) => (
                <button
                  key={num}
                  type="button"
                  onClick={() => setRandomCount(num)}
                  className={`flex-1 py-2 border text-center font-bold text-xs transition-all cursor-pointer ${
                    randomCount === num 
                      ? "border-stone-900 bg-stone-900 text-white" 
                      : "border-stone-200 bg-stone-50 text-stone-700 hover:border-stone-400"
                  }`}
                >
                  {num} Words
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-stone-800">Specific Sub-Topic / Vibe Focus (Optional)</label>
            <input 
              type="text" 
              value={randomWordsTopic}
              onChange={(e) => setRandomWordsTopic(e.target.value)}
              placeholder="e.g., Slang, Formal, Adjectives, Restaurant ordering"
              className="w-full border border-stone-300 bg-stone-50 px-3 py-2.5 font-medium text-stone-900 text-xs outline-none focus:border-stone-900"
            />
            <p className="text-[10px] text-stone-400 italic">
              AI will automatically avoid adding duplicate words already present in this deck.
            </p>
          </div>

          <div className="pt-4 flex justify-end gap-3 border-t border-stone-200">
            <button 
              type="button" 
              onClick={() => setIsRandomWordsModalOpen(false)}
              className="px-4 py-2 border border-stone-300 hover:bg-stone-100 text-stone-800 font-bold text-xs uppercase cursor-pointer"
            >
              Cancel
            </button>
            <button 
              type="submit" 
              disabled={isGeneratingRandomWords}
              className="px-6 py-2 bg-amber-400 hover:bg-amber-300 border border-amber-500 text-stone-950 font-bold text-xs uppercase tracking-wider flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-50"
            >
              <Wand2 className={`w-3.5 h-3.5 ${isGeneratingRandomWords ? "animate-spin" : ""}`} />
              <span>{isGeneratingRandomWords ? "Generating..." : `Generate ${randomCount} Words`}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
