import React, { useRef, useEffect } from "react";
import { Sparkles, Wand2, X, BookOpen, Layers } from "lucide-react";

interface AddWordModalProps {
  isModalOpen: boolean;
  setIsModalOpen: (open: boolean) => void;
  wordInput: string;
  setWordInput: (val: string) => void;
  translationInput: string;
  setTranslationInput: (val: string) => void;
  definitionInput: string;
  setDefinitionInput: (val: string) => void;
  partOfSpeechInput: string;
  setPartOfSpeechInput: (val: string) => void;
  pronunciationInput: string;
  setPronunciationInput: (val: string) => void;
  exampleInput: string;
  setExampleInput: (val: string) => void;
  exampleTranslationInput: string;
  setExampleTranslationInput: (val: string) => void;
  autofilling: boolean;
  targetLanguage: string;
  nativeLanguage: string;
  handleAiAutofill: () => void;
  handleAiSuggestRelatedWord: () => void;
  handleAddWordSubmit: (e: React.FormEvent) => void;
}

export default function AddWordModal({
  isModalOpen,
  setIsModalOpen,
  wordInput,
  setWordInput,
  translationInput,
  setTranslationInput,
  definitionInput,
  setDefinitionInput,
  partOfSpeechInput,
  setPartOfSpeechInput,
  pronunciationInput,
  setPronunciationInput,
  exampleInput,
  setExampleInput,
  exampleTranslationInput,
  setExampleTranslationInput,
  autofilling,
  targetLanguage,
  nativeLanguage,
  handleAiAutofill,
  handleAiSuggestRelatedWord,
  handleAddWordSubmit
}: AddWordModalProps) {
  const wordInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isModalOpen) {
      setTimeout(() => {
        wordInputRef.current?.focus();
      }, 100);
    }
  }, [isModalOpen]);

  if (!isModalOpen) return null;

  return (
    <div className="fixed inset-0 bg-stone-950/80 backdrop-blur-xs z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="bg-white border-2 border-stone-900 w-full max-w-lg p-5 sm:p-7 space-y-5 my-8 shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-start border-b border-stone-200 pb-3">
          <div>
            <h3 className="text-lg font-black text-stone-950">Add Vocabulary Term</h3>
            <p className="text-xs text-stone-500 font-serif italic mt-0.5">
              Fill details manually or let AI auto-generate definition and context image.
            </p>
          </div>
          <button 
            type="button" 
            onClick={() => setIsModalOpen(false)}
            className="p-1 text-stone-400 hover:text-stone-900 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Language Context Banner */}
        <div className="bg-stone-100 border border-stone-300 p-3.5 space-y-1.5 rounded-none shadow-2xs">
          <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-stone-600">
            <span className="flex items-center gap-1.5 font-mono text-stone-800">
              <BookOpen className="w-3.5 h-3.5 text-amber-600" />
              Language Context
            </span>
            <span className="bg-amber-400 text-stone-950 px-2 py-0.5 font-bold text-[10px]">
              {targetLanguage} ↔ {nativeLanguage}
            </span>
          </div>
          {autofilling && (
            <div className="mt-2 pt-2 border-t border-stone-200 flex items-center gap-2 text-[11px] font-bold text-amber-700 animate-pulse">
              <Sparkles className="w-3.5 h-3.5 animate-spin text-amber-600" />
              <span>AI is generating definitions & visual image...</span>
            </div>
          )}
        </div>

        <form onSubmit={handleAddWordSubmit} className="space-y-4 text-xs font-semibold">
          {/* Target Word Input */}
          <div className="space-y-1.5">
            <div className="flex justify-between items-center">
              <label className="text-stone-800">Word or Expression ({targetLanguage}) *</label>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={handleAiSuggestRelatedWord}
                  disabled={autofilling}
                  className="px-2 py-1 bg-stone-100 hover:bg-stone-200 border border-stone-300 text-stone-800 text-[10px] font-bold flex items-center gap-1 cursor-pointer transition-all"
                  title="AI will suggest a vocabulary word for you"
                >
                  <Wand2 className={`w-3 h-3 text-stone-700 ${autofilling ? "animate-spin" : ""}`} />
                  <span>Suggest Word</span>
                </button>
                <button
                  type="button"
                  onClick={handleAiAutofill}
                  disabled={!wordInput.trim() || autofilling}
                  className="px-2.5 py-1 bg-amber-400 hover:bg-amber-300 disabled:bg-stone-100 disabled:text-stone-400 border border-amber-500 text-stone-950 text-[10px] font-bold flex items-center gap-1 cursor-pointer transition-all shadow-2xs"
                  title="Auto-fill definition, translation & context image with AI"
                >
                  <Sparkles className={`w-3 h-3 ${autofilling ? "animate-spin" : ""}`} />
                  <span>{autofilling ? "Autofilling..." : "AI Auto-Fill Details"}</span>
                </button>
              </div>
            </div>
            <input 
              ref={wordInputRef}
              type="text" 
              required
              value={wordInput}
              onChange={(e) => setWordInput(e.target.value)}
              placeholder="e.g., Ubiquitous"
              className="w-full border border-stone-300 bg-stone-50 px-3 py-2.5 font-bold text-stone-950 text-sm outline-none focus:border-stone-900 focus:bg-white"
            />
          </div>

          {/* Quick Word Helper Suggestion Chips */}
          <div className="bg-stone-50 border border-stone-200 p-2.5 space-y-1.5">
            <span className="text-[10px] font-mono text-stone-500 uppercase tracking-wider block">Suggested Word Category Ideas:</span>
            <div className="flex flex-wrap gap-1.5">
              {["Ephemeral", "Resilience", "Serendipity", "Pragmatic", "Eloquent", "Meticulous"].map((sug) => (
                <button
                  key={sug}
                  type="button"
                  onClick={() => {
                    setWordInput(sug);
                    wordInputRef.current?.focus();
                  }}
                  className="px-2 py-0.5 bg-white border border-stone-200 hover:border-stone-900 text-stone-800 text-[10px] font-semibold transition-all cursor-pointer"
                >
                  {sug}
                </button>
              ))}
            </div>
          </div>

          {/* Translation & Part of Speech */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-stone-800">Meaning / Translation ({nativeLanguage}) *</label>
              <input 
                type="text" 
                required
                value={translationInput}
                onChange={(e) => setTranslationInput(e.target.value)}
                placeholder="Meaning in native language"
                className="w-full border border-stone-300 bg-stone-50 px-3 py-2 text-xs font-medium text-stone-900 outline-none focus:border-stone-900"
              />
            </div>
            <div className="space-y-1">
              <label className="text-stone-800">Part of Speech</label>
              <select 
                value={partOfSpeechInput}
                onChange={(e) => setPartOfSpeechInput(e.target.value)}
                className="w-full border border-stone-300 bg-stone-50 px-3 py-2 text-xs font-medium text-stone-900 outline-none focus:border-stone-900 cursor-pointer"
              >
                <option value="noun">noun</option>
                <option value="verb">verb</option>
                <option value="adjective">adjective</option>
                <option value="adverb">adverb</option>
                <option value="idiom">idiom/phrase</option>
              </select>
            </div>
          </div>

          {/* Pronunciation */}
          <div className="space-y-1">
            <label className="text-stone-800">IPA / Phonetic Pronunciation</label>
            <input 
              type="text" 
              value={pronunciationInput}
              onChange={(e) => setPronunciationInput(e.target.value)}
              placeholder="e.g., yoo-BIK-wih-tuss"
              className="w-full border border-stone-300 bg-stone-50 px-3 py-2 text-xs font-mono text-stone-900 outline-none focus:border-stone-900"
            />
          </div>

          {/* Definition */}
          <div className="space-y-1">
            <label className="text-stone-800">English / Target Definition</label>
            <textarea 
              rows={2}
              value={definitionInput}
              onChange={(e) => setDefinitionInput(e.target.value)}
              placeholder="Detailed definition of the term..."
              className="w-full border border-stone-300 bg-stone-50 px-3 py-2 text-xs font-serif text-stone-900 outline-none focus:border-stone-900"
            />
          </div>

          {/* Example Sentence & Example Translation */}
          <div className="space-y-3 pt-2 border-t border-stone-200">
            <div className="space-y-1">
              <label className="text-stone-800">Context Example Sentence</label>
              <input 
                type="text" 
                value={exampleInput}
                onChange={(e) => setExampleInput(e.target.value)}
                placeholder="Target language context example..."
                className="w-full border border-stone-300 bg-stone-50 px-3 py-2 text-xs font-serif italic text-stone-900 outline-none focus:border-stone-900"
              />
            </div>
            <div className="space-y-1">
              <label className="text-stone-800">Example Sentence Translation</label>
              <input 
                type="text" 
                value={exampleTranslationInput}
                onChange={(e) => setExampleTranslationInput(e.target.value)}
                placeholder="Native language translation of the example sentence..."
                className="w-full border border-stone-300 bg-stone-50 px-3 py-2 text-xs text-stone-900 outline-none focus:border-stone-900"
              />
            </div>
          </div>

          <div className="pt-4 flex justify-end gap-3 border-t border-stone-200">
            <button 
              type="button" 
              onClick={() => setIsModalOpen(false)}
              className="px-4 py-2 border border-stone-300 hover:bg-stone-100 text-stone-800 font-bold text-xs uppercase cursor-pointer"
            >
              Cancel
            </button>
            <button 
              type="submit" 
              className="px-6 py-2 bg-stone-900 hover:bg-black text-white font-bold text-xs uppercase tracking-wider cursor-pointer shadow-xs"
            >
              Save Word Entry
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
