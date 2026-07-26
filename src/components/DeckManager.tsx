import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Plus, 
  Search, 
  Sparkles, 
  Trash2, 
  Star, 
  CheckCircle, 
  Layers, 
  X,
  Volume2,
  BookOpen,
  Loader2,
  AlertCircle
} from "lucide-react";
import { Deck, Word, LLMConfig, TTSConfig } from "../types";
import { speakText as speakTextService, DEFAULT_TTS_CONFIG } from "../utils/ttsService";

interface DeckManagerProps {
  decks: Deck[];
  selectedDeckId: string | null;
  llmConfig?: LLMConfig;
  ttsConfig?: TTSConfig;
  onSelectDeck: (deckId: string) => void;
  onAddCustomWord: (deckId: string, wordData: Omit<Word, "id" | "learned" | "starred" | "createdAt" | "lastReviewed" | "strength">) => void;
  onDeleteWord: (deckId: string, wordId: string) => void;
  onToggleStar: (wordId: string) => void;
  onToggleLearned: (wordId: string) => void;
  onAddCustomDeck: (name: string, description: string, targetLanguage: string, nativeLanguage: string) => void;
}

export default function DeckManager({
  decks,
  selectedDeckId,
  llmConfig,
  ttsConfig = DEFAULT_TTS_CONFIG,
  onSelectDeck,
  onAddCustomWord,
  onDeleteWord,
  onToggleStar,
  onToggleLearned,
  onAddCustomDeck
}: DeckManagerProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [activeFilter, setActiveFilter] = useState<"all" | "starred" | "mastered" | "learning">("all");
  const [showAddWordModal, setShowAddWordModal] = useState(false);
  const [showAddDeckModal, setShowAddDeckModal] = useState(false);

  // New Word Form State
  const [newWord, setNewWord] = useState("");
  const [newPronunciation, setNewPronunciation] = useState("");
  const [newPartOfSpeech, setNewPartOfSpeech] = useState("noun");
  const [newDefinition, setNewDefinition] = useState("");
  const [newTranslation, setNewTranslation] = useState("");
  const [newExample, setNewExample] = useState("");
  const [newExampleTranslation, setNewExampleTranslation] = useState("");
  
  // New Deck Form State
  const [newDeckName, setNewDeckName] = useState("");
  const [newDeckDesc, setNewDeckDesc] = useState("");
  const [newDeckTarget, setNewDeckTarget] = useState("English");
  const [newDeckNative, setNewDeckNative] = useState("Spanish");

  // AI Autofill Status
  const [isAutofilling, setIsAutofilling] = useState(false);
  const [autofillError, setAutofillError] = useState("");

  const activeDeck = decks.find(d => d.id === selectedDeckId) || decks[0] || null;

  // Search and filter words within the active deck
  const filteredWords = activeDeck 
    ? activeDeck.words.filter(w => {
        const matchesSearch = w.word.toLowerCase().includes(searchTerm.toLowerCase()) ||
          w.definition.toLowerCase().includes(searchTerm.toLowerCase()) ||
          w.translation.toLowerCase().includes(searchTerm.toLowerCase());
        
        if (activeFilter === "starred") return matchesSearch && w.starred;
        if (activeFilter === "mastered") return matchesSearch && w.learned;
        if (activeFilter === "learning") return matchesSearch && !w.learned;
        return matchesSearch;
      })
    : [];

  // Trigger Gemini AI details autofill
  const handleAIAutofill = async () => {
    const wordToFill = newWord.trim();
    if (!wordToFill) {
      setAutofillError("Please type a word first");
      return;
    }

    setIsAutofilling(true);
    setAutofillError("");

    try {
      const response = await fetch("/api/autofill-word", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          word: wordToFill,
          targetLanguage: activeDeck?.targetLanguage || "English",
          nativeLanguage: activeDeck?.nativeLanguage || "Spanish",
          llmConfig
        })
      });

      if (!response.ok) {
        throw new Error("Failed to consult Gemini for details.");
      }

      const data = await response.json();
      setNewPronunciation(data.pronunciation || "");
      setNewPartOfSpeech(data.partOfSpeech || "noun");
      setNewDefinition(data.definition || "");
      setNewTranslation(data.translation || "");
      setNewExample(data.example || "");
      setNewExampleTranslation(data.exampleTranslation || "");
    } catch (err: any) {
      console.error(err);
      setAutofillError(err.message || "Autofill failed. Check internet/secrets.");
    } finally {
      setIsAutofilling(false);
    }
  };

  const handleAddWordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeDeck || !newWord.trim() || !newDefinition.trim() || !newTranslation.trim()) return;

    onAddCustomWord(activeDeck.id, {
      word: newWord.trim(),
      pronunciation: newPronunciation.trim() || "/.../",
      partOfSpeech: newPartOfSpeech,
      definition: newDefinition.trim(),
      translation: newTranslation.trim(),
      example: newExample.trim() || "No example provided.",
      exampleTranslation: newExampleTranslation.trim() || "No translation provided."
    });

    // Reset Form
    setNewWord("");
    setNewPronunciation("");
    setNewPartOfSpeech("noun");
    setNewDefinition("");
    setNewTranslation("");
    setNewExample("");
    setNewExampleTranslation("");
    setShowAddWordModal(false);
  };

  const handleAddDeckSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDeckName.trim()) return;

    onAddCustomDeck(
      newDeckName.trim(),
      newDeckDesc.trim() || "A custom vocabulary notebook.",
      newDeckTarget,
      newDeckNative
    );

    setNewDeckName("");
    setNewDeckDesc("");
    setShowAddDeckModal(false);
  };

  const speakWord = (text: string) => {
    const langCode = activeDeck?.targetLanguage === "English" ? "en-US" : "es-ES";
    speakTextService(text, ttsConfig, llmConfig, langCode);
  };

  return (
    <div className="space-y-6" id="deck-manager-container">
      
      {/* Top Banner Row */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-4 border-b border-stone-200">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-stone-900 flex items-center gap-2">
            <Layers className="w-5 h-5 text-stone-900" /> Deck Workshop
          </h2>
          <p className="text-xs text-stone-400 font-serif italic mt-0.5">Organize vocabulary items, manage manual logs, and invoke AI dictionaries.</p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setShowAddDeckModal(true)}
            className="px-4 py-2.5 border border-stone-200 hover:border-stone-950 bg-stone-50 text-stone-800 text-xs font-bold uppercase tracking-widest rounded-none transition-all cursor-pointer"
          >
            Create Notebook
          </button>
          {activeDeck && (
            <button
              onClick={() => setShowAddWordModal(true)}
              className="px-4 py-2.5 bg-stone-900 hover:bg-black text-white text-xs font-bold uppercase tracking-widest rounded-none transition-all cursor-pointer"
            >
              Add Word
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Hand side select column */}
        <div className="lg:col-span-4 space-y-3">
          <label className="block text-[10px] font-bold text-stone-400 uppercase tracking-widest">Your Active Decks</label>
          <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
            {decks.map(deck => (
              <button
                key={deck.id}
                onClick={() => onSelectDeck(deck.id)}
                className={`w-full text-left p-4 rounded-none border transition-all flex justify-between items-center group cursor-pointer ${
                  selectedDeckId === deck.id 
                    ? "border-stone-900 bg-stone-50" 
                    : "border-stone-200 bg-white hover:border-stone-400"
                }`}
              >
                <div>
                  <h4 className={`text-xs md:text-sm font-bold tracking-tight transition-colors ${
                    selectedDeckId === deck.id ? "text-stone-950" : "text-stone-800"
                  }`}>
                    {deck.name}
                  </h4>
                  <p className="text-[10px] text-stone-400 line-clamp-1 mt-0.5 font-serif italic">"{deck.description}"</p>
                </div>
                <span className="text-[10px] font-mono font-bold text-stone-600 bg-stone-100 border border-stone-200 px-2.5 py-0.5 rounded-none">
                  {deck.words.length} words
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Right Hand side word browser column */}
        <div className="lg:col-span-8 space-y-4">
          {activeDeck ? (
            <div className="bg-white border border-stone-200 p-6 space-y-6 rounded-none" id="word-browser">
              
              {/* Filter Row */}
              <div className="flex flex-col md:flex-row gap-4 justify-between items-start md:items-center">
                <div className="relative w-full md:max-w-xs">
                  <Search className="absolute left-3 top-2.5 w-4 h-4 text-stone-400" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search word, meaning, context..."
                    className="w-full bg-stone-50 border border-stone-200 rounded-none pl-9 pr-4 py-2 text-xs font-semibold text-stone-800 outline-none focus:border-stone-950 focus:bg-white transition-all font-serif"
                  />
                </div>

                <div className="flex flex-wrap gap-1">
                  {(["all", "starred", "mastered", "learning"] as const).map((filter) => (
                    <button
                      key={filter}
                      onClick={() => setActiveFilter(filter)}
                      className={`px-3 py-1.5 rounded-none text-[10px] font-bold uppercase tracking-widest transition-all cursor-pointer ${
                        activeFilter === filter 
                          ? "bg-stone-900 text-white" 
                          : "bg-stone-50 border border-stone-200 text-stone-500 hover:text-stone-950 hover:border-stone-450"
                      }`}
                    >
                      {filter}
                    </button>
                  ))}
                </div>
              </div>

              {/* Word List table */}
              <div className="divide-y divide-stone-100 max-h-[480px] overflow-y-auto pr-1">
                {filteredWords.length === 0 ? (
                  <div className="py-12 text-center text-stone-400 space-y-4">
                    <BookOpen className="w-12 h-12 text-stone-200 mx-auto" />
                    <p className="text-sm font-bold uppercase tracking-widest text-stone-600">No entries matched</p>
                    <p className="text-xs font-serif italic">"Try adjusting your keyword filter or check another category list."</p>
                  </div>
                ) : (
                  filteredWords.map((word) => (
                    <div key={word.id} className="py-4 flex justify-between items-start gap-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-bold text-stone-900">{word.word}</h4>
                          <span className="text-[10px] text-stone-400 font-mono italic">{word.pronunciation}</span>
                          <span className="text-[9px] font-bold text-stone-500 uppercase tracking-widest bg-stone-50 border border-stone-200 px-1.5 py-0.5 rounded-none font-mono">
                            {word.partOfSpeech}
                          </span>
                        </div>
                        <p className="text-xs font-bold text-stone-950">Meaning: {word.translation}</p>
                        <p className="text-xs text-stone-500 font-serif italic">Definition: "{word.definition}"</p>
                        <p className="text-[11px] text-stone-400 font-mono">Context: {word.example}</p>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={() => speakWord(word.word)}
                          className="p-1.5 border border-stone-200 text-stone-400 hover:text-stone-950 hover:border-stone-900 rounded-none transition-all cursor-pointer"
                          title="Listen Pronunciation"
                        >
                          <Volume2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => onToggleStar(word.id)}
                          className={`p-1.5 border border-stone-200 rounded-none transition-all cursor-pointer ${
                            word.starred 
                              ? "bg-stone-50 text-stone-950 border-stone-900" 
                              : "text-stone-300 hover:text-stone-600"
                          }`}
                        >
                          <Star className="w-4 h-4 fill-current" />
                        </button>
                        <button
                          onClick={() => onToggleLearned(word.id)}
                          className={`p-1.5 border border-stone-200 rounded-none transition-all cursor-pointer ${
                            word.learned 
                              ? "bg-stone-50 text-stone-950 border-stone-900" 
                              : "text-stone-300 hover:text-stone-600"
                          }`}
                          title={word.learned ? "Mastered" : "Mark Mastered"}
                        >
                          <CheckCircle className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => onDeleteWord(activeDeck.id, word.id)}
                          className="p-1.5 border border-stone-200 text-stone-300 hover:text-red-600 hover:border-red-600 rounded-none transition-all cursor-pointer"
                          title="Remove Entry"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>

            </div>
          ) : (
            <div className="bg-stone-50 border border-stone-200 rounded-none p-12 text-center space-y-4">
              <Layers className="w-12 h-12 text-stone-300 mx-auto" />
              <h3 className="text-xs font-bold text-stone-900 uppercase tracking-widest">Select an Active Deck</h3>
              <p className="text-xs text-stone-400 font-serif italic">Choose one of your notebooks from the sidebar list to browse vocabulary entries.</p>
            </div>
          )}
        </div>
      </div>

      {/* Add Word Modal */}
      <AnimatePresence>
        {showAddWordModal && activeDeck && (
          <div className="fixed inset-0 bg-stone-950/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ scale: 0.98, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.98, opacity: 0 }}
              className="bg-white border border-stone-200 p-8 w-full max-w-lg space-y-6 rounded-none shadow-xl"
            >
              <div className="flex justify-between items-center pb-4 border-b border-stone-100">
                <div>
                  <h3 className="text-sm font-bold text-stone-900 uppercase tracking-widest">Add New Word</h3>
                  <p className="text-[10px] text-stone-400 font-serif italic mt-0.5">Notebook: {activeDeck.name}</p>
                </div>
                <button onClick={() => setShowAddWordModal(false)} className="p-1 text-stone-400 hover:text-stone-900 cursor-pointer">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleAddWordSubmit} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                  <div className="md:col-span-8 text-xs">
                    <label className="block text-[10px] font-bold text-stone-500 uppercase tracking-widest mb-1.5">Vocabulary Word</label>
                    <input
                      type="text"
                      required
                      value={newWord}
                      onChange={(e) => setNewWord(e.target.value)}
                      placeholder="e.g., Ubiquitous"
                      className="w-full border border-stone-200 bg-stone-50 rounded-none px-3 py-2 text-stone-950 font-bold outline-none focus:border-stone-950 focus:bg-white transition-all text-xs"
                    />
                  </div>
                  <div className="md:col-span-4">
                    <button
                      type="button"
                      onClick={handleAIAutofill}
                      disabled={isAutofilling || !newWord.trim()}
                      className="w-full py-2 bg-stone-900 text-white disabled:bg-stone-50 disabled:text-stone-300 disabled:border-stone-200 border border-stone-900 hover:bg-black font-bold text-[10px] uppercase tracking-widest flex items-center justify-center gap-1 transition-all cursor-pointer rounded-none"
                    >
                      {isAutofilling ? (
                        <>
                          <Loader2 className="w-3 h-3 animate-spin" /> Fetching...
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-3 h-3" /> AI Autofill
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {autofillError && (
                  <p className="text-xs font-semibold text-red-700 flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5" /> {autofillError}
                  </p>
                )}

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <label className="block text-[10px] font-bold text-stone-500 uppercase tracking-widest mb-1.5">Pronunciation Guide</label>
                    <input
                      type="text"
                      value={newPronunciation}
                      onChange={(e) => setNewPronunciation(e.target.value)}
                      placeholder="e.g., /yo͞oˈbikwədəs/"
                      className="w-full border border-stone-200 bg-stone-50 rounded-none px-3 py-2 text-stone-955 outline-none focus:border-stone-950 focus:bg-white transition-all text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-stone-500 uppercase tracking-widest mb-1.5">Part of Speech</label>
                    <select
                      value={newPartOfSpeech}
                      onChange={(e) => setNewPartOfSpeech(e.target.value)}
                      className="w-full border border-stone-200 bg-stone-50 rounded-none px-3 py-2 text-stone-955 font-bold outline-none focus:border-stone-950 focus:bg-white transition-all text-xs cursor-pointer"
                    >
                      <option value="noun">noun</option>
                      <option value="verb">verb</option>
                      <option value="adjective">adjective</option>
                      <option value="adverb">adverb</option>
                      <option value="idiom">idiom</option>
                      <option value="expression">expression</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <label className="block text-[10px] font-bold text-stone-500 uppercase tracking-widest mb-1.5">Translation</label>
                    <input
                      type="text"
                      required
                      value={newTranslation}
                      onChange={(e) => setNewTranslation(e.target.value)}
                      placeholder="Meaning in native tongue"
                      className="w-full border border-stone-200 bg-stone-50 rounded-none px-3 py-2 text-stone-955 outline-none focus:border-stone-950 focus:bg-white transition-all text-xs font-serif"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-stone-500 uppercase tracking-widest mb-1.5">Definition</label>
                    <input
                      type="text"
                      required
                      value={newDefinition}
                      onChange={(e) => setNewDefinition(e.target.value)}
                      placeholder="Definition in target tongue"
                      className="w-full border border-stone-200 bg-stone-50 rounded-none px-3 py-2 text-stone-955 outline-none focus:border-stone-950 focus:bg-white transition-all text-xs font-serif"
                    />
                  </div>
                </div>

                <div className="text-xs">
                  <label className="block text-[10px] font-bold text-stone-500 uppercase tracking-widest mb-1.5">Context Example Sentence</label>
                  <textarea
                    rows={2}
                    value={newExample}
                    onChange={(e) => setNewExample(e.target.value)}
                    placeholder="Use the word in a high-quality example sentence..."
                    className="w-full border border-stone-200 bg-stone-50 rounded-none px-3 py-2 text-stone-955 outline-none focus:border-stone-950 focus:bg-white transition-all text-xs resize-none font-serif"
                  />
                </div>

                <div className="text-xs">
                  <label className="block text-[10px] font-bold text-stone-500 uppercase tracking-widest mb-1.5">Example Sentence Translation</label>
                  <textarea
                    rows={2}
                    value={newExampleTranslation}
                    onChange={(e) => setNewExampleTranslation(e.target.value)}
                    placeholder="Translation of example sentence..."
                    className="w-full border border-stone-200 bg-stone-50 rounded-none px-3 py-2 text-stone-955 outline-none focus:border-stone-950 focus:bg-white transition-all text-xs resize-none font-serif"
                  />
                </div>

                <div className="flex gap-2 justify-end pt-3">
                  <button
                    type="button"
                    onClick={() => setShowAddWordModal(false)}
                    className="px-4 py-2 text-xs font-bold uppercase tracking-widest text-stone-400 hover:text-stone-900 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-6 py-2 bg-stone-900 hover:bg-black text-white font-bold text-xs uppercase tracking-widest rounded-none transition-all cursor-pointer"
                  >
                    Save Word
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Add Deck Modal */}
      <AnimatePresence>
        {showAddDeckModal && (
          <div className="fixed inset-0 bg-stone-950/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ scale: 0.98, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.98, opacity: 0 }}
              className="bg-white border border-stone-200 p-8 w-full max-w-md space-y-6 rounded-none shadow-xl"
            >
              <div className="flex justify-between items-center pb-4 border-b border-stone-100">
                <h3 className="text-sm font-bold text-stone-900 uppercase tracking-widest">Create Empty Notebook</h3>
                <button onClick={() => setShowAddDeckModal(false)} className="p-1 text-stone-400 hover:text-stone-900 cursor-pointer">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleAddDeckSubmit} className="space-y-4 text-xs">
                <div>
                  <label className="block text-[10px] font-bold text-stone-500 uppercase tracking-widest mb-1.5">Notebook / Deck Name</label>
                  <input
                    type="text"
                    required
                    value={newDeckName}
                    onChange={(e) => setNewDeckName(e.target.value)}
                    placeholder="e.g., Italian Kitchen Words"
                    className="w-full border border-stone-200 bg-stone-50 rounded-none px-3 py-2 text-stone-955 font-bold outline-none focus:border-stone-950 focus:bg-white transition-all text-xs"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-stone-500 uppercase tracking-widest mb-1.5">Description</label>
                  <input
                    type="text"
                    value={newDeckDesc}
                    onChange={(e) => setNewDeckDesc(e.target.value)}
                    placeholder="e.g., Handy words learned while cooking"
                    className="w-full border border-stone-200 bg-stone-50 rounded-none px-3 py-2 text-stone-955 outline-none focus:border-stone-950 focus:bg-white transition-all text-xs font-serif italic"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-stone-500 uppercase tracking-widest mb-1.5">Target Language</label>
                    <select 
                      value={newDeckTarget} 
                      onChange={(e) => setNewDeckTarget(e.target.value)}
                      className="w-full border border-stone-200 bg-stone-50 rounded-none px-3 py-2 text-stone-955 font-bold outline-none focus:border-stone-950 focus:bg-white transition-all text-xs cursor-pointer"
                    >
                      <option value="English">English</option>
                      <option value="Spanish">Spanish (Español)</option>
                      <option value="French">French (Français)</option>
                      <option value="German">German (Deutsch)</option>
                      <option value="Italian">Italian (Italiano)</option>
                      <option value="Vietnamese">Vietnamese (Tiếng Việt)</option>
                      <option value="Japanese">Japanese (日本語)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-stone-500 uppercase tracking-widest mb-1.5">Native Language</label>
                    <select 
                      value={newDeckNative} 
                      onChange={(e) => setNewDeckNative(e.target.value)}
                      className="w-full border border-stone-200 bg-stone-50 rounded-none px-3 py-2 text-stone-955 font-bold outline-none focus:border-stone-950 focus:bg-white transition-all text-xs cursor-pointer"
                    >
                      <option value="English">English</option>
                      <option value="Spanish">Spanish (Español)</option>
                      <option value="French">French (Français)</option>
                      <option value="German">German (Deutsch)</option>
                      <option value="Italian">Italian (Italiano)</option>
                      <option value="Vietnamese">Vietnamese (Tiếng Việt)</option>
                      <option value="Japanese">Japanese (日本語)</option>
                    </select>
                  </div>
                </div>

                <div className="flex gap-2 justify-end pt-3">
                  <button
                    type="button"
                    onClick={() => setShowAddDeckModal(false)}
                    className="px-4 py-2 font-bold uppercase tracking-widest text-stone-400 hover:text-stone-900 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-6 py-2 bg-stone-900 hover:bg-black text-white font-bold text-xs uppercase tracking-widest rounded-none transition-all cursor-pointer"
                  >
                    Create Notebook
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}

