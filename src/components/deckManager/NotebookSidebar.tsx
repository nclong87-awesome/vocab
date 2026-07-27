import React from "react";
import { PanelLeftClose, Trash2 } from "lucide-react";
import { Deck } from "../../types";

interface NotebookSidebarProps {
  decks: Deck[];
  selectedDeckId: string | null;
  onSelectDeck: (deckId: string) => void;
  setIsSidebarOpen: (open: boolean) => void;
  setDeckToDelete: (deck: { id: string; name: string } | null) => void;
  onDeleteDeck?: (deckId: string) => void;
}

export default function NotebookSidebar({
  decks,
  selectedDeckId,
  onSelectDeck,
  setIsSidebarOpen,
  setDeckToDelete,
  onDeleteDeck
}: NotebookSidebarProps) {
  return (
    <div className="lg:col-span-4 space-y-3">
      <div className="flex items-center justify-between">
        <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider">Your Notebooks</label>
        <button
          type="button"
          onClick={() => setIsSidebarOpen(false)}
          className="hidden lg:flex items-center gap-1 text-[11px] font-semibold text-stone-500 hover:text-stone-900 transition-colors cursor-pointer"
          title="Collapse notebook sidebar to expand word view"
        >
          <PanelLeftClose className="w-3.5 h-3.5" />
          <span>Collapse</span>
        </button>
      </div>

      <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
        {decks.map(deck => (
          <div
            key={deck.id}
            onClick={() => onSelectDeck(deck.id)}
            className={`w-full text-left p-3.5 border transition-all flex justify-between items-center group cursor-pointer ${
              selectedDeckId === deck.id 
                ? "border-stone-900 bg-stone-50 shadow-2xs" 
                : "border-stone-200 bg-white hover:border-stone-400"
            }`}
          >
            <div className="pr-2 min-w-0">
              <h4 className={`text-xs md:text-sm font-bold tracking-tight transition-colors truncate ${
                selectedDeckId === deck.id ? "text-stone-950" : "text-stone-800"
              }`}>
                {deck.name}
              </h4>
              <p className="text-[10px] text-stone-400 line-clamp-1 mt-0.5 font-serif italic">"{deck.description}"</p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-[10px] font-mono font-bold text-stone-600 bg-stone-100 border border-stone-200 px-2 py-0.5">
                {deck.words.length} words
              </span>
              {onDeleteDeck && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeckToDelete({ id: deck.id, name: deck.name });
                  }}
                  className="p-1 text-stone-400 hover:text-red-600 hover:bg-stone-200 transition-colors cursor-pointer rounded"
                  title="Delete Notebook"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
