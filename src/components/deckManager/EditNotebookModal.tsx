import React, { useState, useEffect } from "react";
import { X, Languages, Globe, Save } from "lucide-react";
import { Deck } from "../../types";
import { SUPPORTED_LANGUAGES } from "../../config/languages";

interface EditNotebookModalProps {
  isOpen: boolean;
  onClose: () => void;
  deck: Deck;
  onUpdateDeckDetails: (deckId: string, updates: { name: string; description: string; targetLanguage: string; nativeLanguage: string }) => void;
}

export default function EditNotebookModal({
  isOpen,
  onClose,
  deck,
  onUpdateDeckDetails
}: EditNotebookModalProps) {
  const [name, setName] = useState(deck.name);
  const [description, setDescription] = useState(deck.description);
  const [targetLanguage, setTargetLanguage] = useState(deck.targetLanguage || "English");
  const [nativeLanguage, setNativeLanguage] = useState(deck.nativeLanguage || "Spanish");

  useEffect(() => {
    setName(deck.name);
    setDescription(deck.description);
    setTargetLanguage(deck.targetLanguage || "English");
    setNativeLanguage(deck.nativeLanguage || "Spanish");
  }, [deck]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    onUpdateDeckDetails(deck.id, {
      name: name.trim(),
      description: description.trim(),
      targetLanguage,
      nativeLanguage
    });

    onClose();
  };

  return (
    <div className="fixed inset-0 bg-stone-950/80 backdrop-blur-xs z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="bg-white border-2 border-stone-900 w-full max-w-lg p-5 sm:p-7 space-y-6 my-8 shadow-xl">
        
        <div className="flex justify-between items-start border-b border-stone-200 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-stone-900 text-white">
              <Languages className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-black text-stone-950">Notebook & Language Settings</h3>
              <p className="text-xs text-stone-500 font-serif italic mt-0.5">Edit topic name, target language, and explanation language.</p>
            </div>
          </div>
          <button 
            type="button" 
            onClick={onClose}
            className="p-1 text-stone-400 hover:text-stone-900 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 text-xs font-semibold">
          <div className="space-y-1">
            <label className="text-stone-800 font-bold">Notebook Name / Topic *</label>
            <input 
              type="text" 
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full border border-stone-300 bg-stone-50 px-3 py-2.5 font-bold text-stone-950 text-sm outline-none focus:border-stone-900"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-stone-800 font-bold flex items-center gap-1">
                <Globe className="w-3.5 h-3.5 text-blue-600" />
                Target Language (Learning)
              </label>
              <select 
                value={targetLanguage} 
                onChange={(e) => setTargetLanguage(e.target.value)}
                className="w-full border border-stone-300 bg-stone-50 px-3 py-2.5 text-xs font-bold text-stone-900 outline-none focus:border-stone-900 cursor-pointer"
              >
                {SUPPORTED_LANGUAGES.map(lang => (
                  <option key={lang.code} value={lang.code}>{lang.flag} {lang.name}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-stone-800 font-bold flex items-center gap-1">
                <Globe className="w-3.5 h-3.5 text-emerald-600" />
                Native Language (Explanation)
              </label>
              <select 
                value={nativeLanguage} 
                onChange={(e) => setNativeLanguage(e.target.value)}
                className="w-full border border-stone-300 bg-stone-50 px-3 py-2.5 text-xs font-bold text-stone-900 outline-none focus:border-stone-900 cursor-pointer"
              >
                {SUPPORTED_LANGUAGES.map(lang => (
                  <option key={lang.code} value={lang.code}>{lang.flag} {lang.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-stone-800 font-bold">Short Description</label>
            <textarea 
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full border border-stone-300 bg-stone-50 px-3 py-2 text-xs font-serif text-stone-900 outline-none focus:border-stone-900"
            />
          </div>

          <div className="pt-3 border-t border-stone-200 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-stone-300 bg-white hover:bg-stone-100 text-stone-700 font-semibold cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 bg-stone-900 hover:bg-black text-white font-bold flex items-center gap-1.5 shadow-md cursor-pointer"
            >
              <Save className="w-4 h-4 text-emerald-400" />
              <span>Save Notebook Settings</span>
            </button>
          </div>
        </form>

      </div>
    </div>
  );
}
