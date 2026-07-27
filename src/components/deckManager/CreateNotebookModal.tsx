import React from "react";
import { Sparkles, Wand2, X } from "lucide-react";

interface CreateNotebookModalProps {
  isCreateDeckModalOpen: boolean;
  setIsCreateDeckModalOpen: (open: boolean) => void;
  newDeckName: string;
  setNewDeckName: (val: string) => void;
  newDeckDesc: string;
  setNewDeckDesc: (val: string) => void;
  newDeckTargetLang: string;
  setNewDeckTargetLang: (val: string) => void;
  newDeckNativeLang: string;
  setNewDeckNativeLang: (val: string) => void;
  isAiGeneratingDeck: boolean;
  handleCreateDeckSubmit: (e: React.FormEvent) => void;
  handleAiGenerateWholeDeck: () => void;
}

export default function CreateNotebookModal({
  isCreateDeckModalOpen,
  setIsCreateDeckModalOpen,
  newDeckName,
  setNewDeckName,
  newDeckDesc,
  setNewDeckDesc,
  newDeckTargetLang,
  setNewDeckTargetLang,
  newDeckNativeLang,
  setNewDeckNativeLang,
  isAiGeneratingDeck,
  handleCreateDeckSubmit,
  handleAiGenerateWholeDeck
}: CreateNotebookModalProps) {
  if (!isCreateDeckModalOpen) return null;

  return (
    <div className="fixed inset-0 bg-stone-950/80 backdrop-blur-xs z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="bg-white border-2 border-stone-900 w-full max-w-lg p-5 sm:p-7 space-y-6 my-8 shadow-xl">
        <div className="flex justify-between items-start border-b border-stone-200 pb-4">
          <div>
            <h3 className="text-lg font-black text-stone-950">Create Vocabulary Notebook</h3>
            <p className="text-xs text-stone-500 font-serif italic mt-0.5">Define your target topic or let AI generate a complete deck.</p>
          </div>
          <button 
            type="button" 
            onClick={() => setIsCreateDeckModalOpen(false)}
            className="p-1 text-stone-400 hover:text-stone-900 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleCreateDeckSubmit} className="space-y-4 text-xs font-semibold">
          <div className="space-y-1">
            <label className="text-stone-800">Notebook Name / Topic *</label>
            <input 
              type="text" 
              required
              value={newDeckName}
              onChange={(e) => setNewDeckName(e.target.value)}
              placeholder="e.g., French Bistro Dining, Advanced Medical Terms"
              className="w-full border border-stone-300 bg-stone-50 px-3 py-2.5 font-bold text-stone-950 text-sm outline-none focus:border-stone-900"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-stone-800">Target Language *</label>
              <input 
                type="text" 
                required
                value={newDeckTargetLang}
                onChange={(e) => setNewDeckTargetLang(e.target.value)}
                placeholder="e.g. English, French, Japanese"
                className="w-full border border-stone-300 bg-stone-50 px-3 py-2 text-xs font-medium text-stone-900 outline-none focus:border-stone-900"
              />
            </div>
            <div className="space-y-1">
              <label className="text-stone-800">Native Language *</label>
              <input 
                type="text" 
                required
                value={newDeckNativeLang}
                onChange={(e) => setNewDeckNativeLang(e.target.value)}
                placeholder="e.g. Spanish, German, Vietnamese"
                className="w-full border border-stone-300 bg-stone-50 px-3 py-2 text-xs font-medium text-stone-900 outline-none focus:border-stone-900"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-stone-800">Short Description</label>
            <textarea 
              rows={2}
              value={newDeckDesc}
              onChange={(e) => setNewDeckDesc(e.target.value)}
              placeholder="Overview of what vocabulary this notebook covers..."
              className="w-full border border-stone-300 bg-stone-50 px-3 py-2 text-xs font-serif text-stone-900 outline-none focus:border-stone-900"
            />
          </div>

          <div className="pt-3 border-t border-stone-200 flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3">
            <button
              type="button"
              onClick={handleAiGenerateWholeDeck}
              disabled={!newDeckName.trim() || isAiGeneratingDeck}
              className="px-4 py-2 bg-amber-400 hover:bg-amber-300 disabled:bg-stone-100 disabled:text-stone-400 border border-amber-500 text-stone-950 text-xs font-bold flex items-center justify-center gap-2 cursor-pointer transition-all shadow-2xs"
            >
              <Sparkles className={`w-4 h-4 ${isAiGeneratingDeck ? "animate-spin" : ""}`} />
              <span>{isAiGeneratingDeck ? "Generating..." : "Generate 8 Words with AI"}</span>
            </button>

            <div className="flex gap-2 justify-end">
              <button 
                type="button" 
                onClick={() => setIsCreateDeckModalOpen(false)}
                className="px-3 py-2 border border-stone-300 hover:bg-stone-100 text-stone-800 font-bold text-xs uppercase cursor-pointer"
              >
                Cancel
              </button>
              <button 
                type="submit" 
                className="px-5 py-2 bg-stone-900 hover:bg-black text-white font-bold text-xs uppercase tracking-wider cursor-pointer shadow-xs"
              >
                Create Blank
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
