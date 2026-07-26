import React, { useState, useMemo } from "react";
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
  AlertCircle,
  Edit3,
  ChevronDown,
  ChevronUp,
  Lightbulb,
  Wand2,
  LayoutGrid,
  List,
  PanelLeftClose,
  PanelLeft,
  Maximize2,
  Minimize2
} from "lucide-react";
import { Deck, Word, LLMConfig, TTSConfig } from "../types";
import { speakText as speakTextService, DEFAULT_TTS_CONFIG } from "../utils/ttsService";
import { autofillWordService } from "../services/llmClientService";

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
  onGenerateDeck?: (topic: string, targetLanguage: string, nativeLanguage: string, quantity: number) => Promise<void>;
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
  onAddCustomDeck,
  onGenerateDeck
}: DeckManagerProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [activeFilter, setActiveFilter] = useState<"all" | "starred" | "mastered" | "learning">("all");
  const [viewMode, setViewMode] = useState<"grid" | "row">("grid");
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
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
  const [showManualFields, setShowManualFields] = useState(false);
  
  // New Deck Form State (Manual)
  const [newDeckName, setNewDeckName] = useState("");
  const [newDeckDesc, setNewDeckDesc] = useState("");
  const [newDeckTarget, setNewDeckTarget] = useState(() => {
    return localStorage.getItem("vocab_learner_target_lang") || "English";
  });
  const [newDeckNative, setNewDeckNative] = useState(() => {
    return localStorage.getItem("vocab_learner_native_lang") || "Spanish";
  });

  // AI Deck Form State
  const [deckTopicInput, setDeckTopicInput] = useState("");
  const [deckQuantity, setDeckQuantity] = useState<number>(8);
  const [isManualCreateMode, setIsManualCreateMode] = useState(false);
  const [isGeneratingDeck, setIsGeneratingDeck] = useState(false);
  const [deckGenError, setDeckGenError] = useState("");

  const POPULAR_TOPICS = [
    { label: "Chess ♟️", value: "Chess" },
    { label: "Kitchen & Cooking 🍳", value: "Cooking & Kitchen" },
    { label: "Airport & Travel ✈️", value: "Airport & Travel" },
    { label: "Business & Career 💼", value: "Business & Work" },
    { label: "Medical Terms 🩺", value: "Medical & Health" },
    { label: "Software & Coding 💻", value: "Software & Technology" },
  ];

  // AI Autofill Status
  const [isAutofilling, setIsAutofilling] = useState(false);
  const [autofillError, setAutofillError] = useState("");

  const activeDeck = useMemo(() => {
    return decks.find(d => d.id === selectedDeckId) || decks[0] || null;
  }, [decks, selectedDeckId]);

  // Search and filter words within the active deck
  const filteredWords = useMemo(() => {
    if (!activeDeck) return [];
    const query = searchTerm.trim().toLowerCase();
    
    return activeDeck.words.filter(w => {
      const matchesSearch = !query || 
        w.word.toLowerCase().includes(query) ||
        (w.definition && w.definition.toLowerCase().includes(query)) ||
        (w.translation && w.translation.toLowerCase().includes(query));
      
      if (activeFilter === "starred") return matchesSearch && w.starred;
      if (activeFilter === "mastered") return matchesSearch && w.learned;
      if (activeFilter === "learning") return matchesSearch && !w.learned;
      return matchesSearch;
    });
  }, [activeDeck, searchTerm, activeFilter]);

  // Trigger Gemini AI details autofill
  const handleAIAutofill = async (overrideWord?: string) => {
    const wordToFill = (overrideWord !== undefined ? overrideWord : newWord).trim();
    if (!wordToFill) {
      setAutofillError("Please enter a word first");
      return;
    }

    if (overrideWord !== undefined) {
      setNewWord(overrideWord);
    }

    setIsAutofilling(true);
    setAutofillError("");

    try {
      const userNativeLang = activeDeck?.nativeLanguage || localStorage.getItem("vocab_learner_native_lang") || "English";
      const userTargetLang = activeDeck?.targetLanguage || localStorage.getItem("vocab_learner_target_lang") || "Spanish";

      const data = await autofillWordService({
        word: wordToFill,
        targetLanguage: userTargetLang,
        nativeLanguage: userNativeLang,
        llmConfig
      });
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

  const handleAddWordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeDeck || !newWord.trim()) return;

    // If definition or translation is empty, trigger AI autofill first
    if (!newDefinition.trim() || !newTranslation.trim()) {
      await handleAIAutofill();
      return;
    }

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
    setShowManualFields(false);
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

  const handleAIGenerateDeckSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const topic = deckTopicInput.trim();
    if (!topic) return;

    if (onGenerateDeck) {
      setIsGeneratingDeck(true);
      setDeckGenError("");
      try {
        await onGenerateDeck(
          topic,
          newDeckTarget,
          newDeckNative,
          deckQuantity
        );
        setDeckTopicInput("");
        setShowAddDeckModal(false);
      } catch (err: any) {
        console.error(err);
        setDeckGenError(err.message || "Failed to generate notebook with AI.");
      } finally {
        setIsGeneratingDeck(false);
      }
    } else {
      onAddCustomDeck(
        topic,
        `AI generated notebook for ${topic}.`,
        newDeckTarget,
        newDeckNative
      );
      setDeckTopicInput("");
      setShowAddDeckModal(false);
    }
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
            className="px-4 py-2 border border-stone-200 hover:border-stone-950 bg-stone-50 text-stone-800 text-xs font-semibold transition-all cursor-pointer"
          >
            Create Notebook
          </button>
          {activeDeck && (
            <button
              onClick={() => setShowAddWordModal(true)}
              className="px-4 py-2 bg-stone-900 hover:bg-black text-white text-xs font-semibold transition-all cursor-pointer"
            >
              Add Word
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Hand side notebook selection column (collapsible) */}
        {isSidebarOpen && (
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
                <button
                  key={deck.id}
                  onClick={() => onSelectDeck(deck.id)}
                  className={`w-full text-left p-3.5 border transition-all flex justify-between items-center group cursor-pointer ${
                    selectedDeckId === deck.id 
                      ? "border-stone-900 bg-stone-50 shadow-2xs" 
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
                  <span className="text-[10px] font-mono font-bold text-stone-600 bg-stone-100 border border-stone-200 px-2 py-0.5">
                    {deck.words.length} words
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Right Hand side word collection browser column */}
        <div className={isSidebarOpen ? "lg:col-span-8 space-y-4" : "lg:col-span-12 space-y-4"}>
          {activeDeck ? (
            <div className="bg-white border border-stone-200 p-4 sm:p-6 space-y-5 shadow-2xs" id="word-browser">
              
              {/* Header Info & Controls Bar */}
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-stone-100 pb-4">
                <div className="flex items-center gap-3">
                  {!isSidebarOpen && (
                    <button
                      type="button"
                      onClick={() => setIsSidebarOpen(true)}
                      className="p-1.5 bg-stone-100 hover:bg-stone-200 text-stone-800 border border-stone-300 transition-all cursor-pointer flex items-center gap-1 text-xs font-semibold"
                      title="Show notebook sidebar"
                    >
                      <PanelLeft className="w-4 h-4" />
                      <span className="hidden sm:inline">Notebooks</span>
                    </button>
                  )}
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-base sm:text-lg font-black text-stone-900">{activeDeck.name}</h3>
                      <span className="text-xs font-mono font-semibold bg-stone-100 border border-stone-200 text-stone-700 px-2 py-0.5">
                        {activeDeck.targetLanguage} → {activeDeck.nativeLanguage}
                      </span>
                    </div>
                    <p className="text-xs text-stone-500 font-serif italic mt-0.5">
                      Showing {filteredWords.length} of {activeDeck.words.length} vocabulary entries
                    </p>
                  </div>
                </div>

                {/* View Mode & Layout Actions */}
                <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
                  <div className="flex bg-stone-100 p-0.5 border border-stone-200">
                    <button
                      type="button"
                      onClick={() => setViewMode("grid")}
                      className={`px-2.5 py-1 text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                        viewMode === "grid" 
                          ? "bg-stone-900 text-white shadow-2xs" 
                          : "text-stone-600 hover:text-stone-950"
                      }`}
                      title="Card Grid View"
                    >
                      <LayoutGrid className="w-3.5 h-3.5" />
                      <span className="hidden min-[480px]:inline">Grid</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode("row")}
                      className={`px-2.5 py-1 text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                        viewMode === "row" 
                          ? "bg-stone-900 text-white shadow-2xs" 
                          : "text-stone-600 hover:text-stone-950"
                      }`}
                      title="Compact List View"
                    >
                      <List className="w-3.5 h-3.5" />
                      <span className="hidden min-[480px]:inline">List</span>
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                    className="p-1.5 bg-stone-50 hover:bg-stone-100 border border-stone-200 text-stone-700 text-xs font-semibold flex items-center gap-1 transition-all cursor-pointer"
                    title={isSidebarOpen ? "Expand to Full Width" : "Show Notebook Sidebar"}
                  >
                    {isSidebarOpen ? <Maximize2 className="w-3.5 h-3.5" /> : <Minimize2 className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              {/* Search & Filter Row */}
              <div className="flex flex-col md:flex-row gap-3 justify-between items-start md:items-center">
                <div className="relative w-full md:max-w-xs">
                  <Search className="absolute left-3 top-2.5 w-4 h-4 text-stone-400" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search word, meaning, context..."
                    className="w-full bg-stone-50 border border-stone-200 pl-9 pr-8 py-2 text-xs font-semibold text-stone-800 outline-none focus:border-stone-950 focus:bg-white transition-all font-serif"
                  />
                  {searchTerm && (
                    <button 
                      onClick={() => setSearchTerm("")} 
                      className="absolute right-2.5 top-2.5 text-stone-400 hover:text-stone-900 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {(["all", "starred", "mastered", "learning"] as const).map((filter) => {
                    let count = activeDeck.words.length;
                    if (filter === "starred") count = activeDeck.words.filter(w => w.starred).length;
                    if (filter === "mastered") count = activeDeck.words.filter(w => w.learned).length;
                    if (filter === "learning") count = activeDeck.words.filter(w => !w.learned).length;

                    return (
                      <button
                        key={filter}
                        onClick={() => setActiveFilter(filter)}
                        className={`px-3 py-1.5 text-xs font-semibold capitalize transition-all cursor-pointer flex items-center gap-1.5 ${
                          activeFilter === filter 
                            ? "bg-stone-900 text-white border border-stone-900 shadow-2xs" 
                            : "bg-stone-50 border border-stone-200 text-stone-600 hover:text-stone-950 hover:border-stone-400"
                        }`}
                      >
                        <span>{filter}</span>
                        <span className={`text-[10px] font-mono px-1.5 py-0.2 ${
                          activeFilter === filter ? "bg-stone-800 text-stone-200" : "bg-stone-200/80 text-stone-700"
                        }`}>
                          {count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Word Collection Container */}
              {filteredWords.length === 0 ? (
                <div className="py-16 text-center text-stone-400 space-y-4 border border-dashed border-stone-200 bg-stone-50/50">
                  <BookOpen className="w-12 h-12 text-stone-300 mx-auto" />
                  <div>
                    <p className="text-sm font-bold text-stone-700">No entries matched your search</p>
                    <p className="text-xs font-serif italic mt-1 text-stone-500">
                      "Try adjusting your keyword query or switching filter tabs."
                    </p>
                  </div>
                </div>
              ) : viewMode === "grid" ? (
                /* GRID VIEW CARDS */
                <div className={`grid grid-cols-1 ${isSidebarOpen ? "md:grid-cols-2" : "md:grid-cols-2 lg:grid-cols-3"} gap-4 max-h-[680px] overflow-y-auto pr-1`}>
                  {filteredWords.map((word) => (
                    <div 
                      key={word.id} 
                      className="p-4 bg-white border border-stone-200 hover:border-stone-400 transition-all flex flex-col justify-between space-y-3.5 shadow-2xs group relative"
                    >
                      {/* Card Header & Controls */}
                      <div className="space-y-2">
                        <div className="flex items-start justify-between gap-2 border-b border-stone-100 pb-2.5">
                          <div className="space-y-1">
                            <h4 className="text-base font-black text-stone-900 tracking-tight leading-snug">{word.word}</h4>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {word.pronunciation && (
                                <span className="text-[10px] font-mono text-stone-500 bg-stone-100 border border-stone-200 px-1.5 py-0.5">
                                  {word.pronunciation}
                                </span>
                              )}
                              <span className="text-[10px] font-bold uppercase font-mono bg-stone-900 text-white px-1.5 py-0.5">
                                {word.partOfSpeech || "noun"}
                              </span>
                            </div>
                          </div>

                          {/* Top-Right Action Buttons Bar (Always spacious, never overlaps) */}
                          <div className="flex items-center gap-1 shrink-0 bg-stone-50 p-1 border border-stone-200">
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
                              onClick={() => onDeleteWord(activeDeck.id, word.id)}
                              className="p-1.5 text-stone-300 hover:text-red-600 hover:bg-white transition-all cursor-pointer"
                              title="Delete Entry"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* Meaning Highlight Block */}
                        <div className="bg-amber-50/80 border border-amber-200/90 p-2.5 space-y-0.5">
                          <span className="text-[10px] font-mono font-bold uppercase text-amber-800 tracking-wider block">Meaning</span>
                          <p className="text-xs font-black text-amber-950">{word.translation}</p>
                        </div>

                        {/* Definition Text */}
                        {word.definition && (
                          <div className="space-y-0.5 pt-1">
                            <span className="text-[10px] font-mono font-bold uppercase text-stone-400 block">Definition</span>
                            <p className="text-xs text-stone-700 font-serif italic leading-relaxed">
                              "{word.definition}"
                            </p>
                          </div>
                        )}

                        {/* Context Example Box */}
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
                  ))}
                </div>
              ) : (
                /* COMPACT LIST VIEW ROWS */
                <div className="space-y-2.5 max-h-[680px] overflow-y-auto pr-1">
                  {filteredWords.map((word) => (
                    <div 
                      key={word.id} 
                      className="p-4 bg-white border border-stone-200 hover:border-stone-400 transition-all grid grid-cols-1 lg:grid-cols-12 gap-3 items-center shadow-2xs"
                    >
                      {/* Col 1: Word & Meaning */}
                      <div className="lg:col-span-4 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="text-sm font-bold text-stone-900">{word.word}</h4>
                          {word.pronunciation && (
                            <span className="text-[10px] text-stone-400 font-mono italic">{word.pronunciation}</span>
                          )}
                          <span className="text-[10px] font-semibold text-stone-600 bg-stone-100 border border-stone-200 px-1.5 py-0.5 font-mono">
                            {word.partOfSpeech}
                          </span>
                        </div>
                        <p className="text-xs font-bold text-stone-900 bg-amber-50 px-2 py-1 border border-amber-200 inline-block">
                          Meaning: {word.translation}
                        </p>
                      </div>

                      {/* Col 2: Definition & Example Context */}
                      <div className="lg:col-span-5 space-y-0.5 text-xs">
                        <p className="text-stone-600 font-serif italic line-clamp-2">
                          "{word.definition}"
                        </p>
                        {word.example && (
                          <p className="text-[11px] text-stone-400 font-mono line-clamp-1">
                            Context: {word.example}
                          </p>
                        )}
                      </div>

                      {/* Col 3: Status & Action Buttons */}
                      <div className="lg:col-span-3 flex items-center justify-between lg:justify-end gap-2 shrink-0">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 ${
                          word.learned ? "bg-emerald-50 text-emerald-800 border border-emerald-200" : "bg-stone-100 text-stone-600"
                        }`}>
                          {word.learned ? "Mastered" : "Learning"}
                        </span>

                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => speakWord(word.word)}
                            className="p-1.5 border border-stone-200 text-stone-500 hover:text-stone-950 hover:bg-stone-50 transition-all cursor-pointer"
                            title="Listen Pronunciation"
                          >
                            <Volume2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onToggleStar(word.id)}
                            className={`p-1.5 border transition-all cursor-pointer ${
                              word.starred 
                                ? "bg-amber-50 text-amber-600 border-amber-300" 
                                : "border-stone-200 text-stone-300 hover:text-stone-600"
                            }`}
                          >
                            <Star className="w-3.5 h-3.5 fill-current" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onToggleLearned(word.id)}
                            className={`p-1.5 border transition-all cursor-pointer ${
                              word.learned 
                                ? "bg-emerald-50 text-emerald-700 border-emerald-300" 
                                : "border-stone-200 text-stone-300 hover:text-stone-600"
                            }`}
                            title={word.learned ? "Mastered" : "Mark Mastered"}
                          >
                            <CheckCircle className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteWord(activeDeck.id, word.id)}
                            className="p-1.5 border border-stone-200 text-stone-300 hover:text-red-600 hover:border-red-300 transition-all cursor-pointer"
                            title="Remove Entry"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

            </div>
          ) : (
            <div className="bg-stone-50 border border-stone-200 p-12 text-center space-y-4">
              <Layers className="w-12 h-12 text-stone-300 mx-auto" />
              <h3 className="text-sm font-semibold text-stone-900">Select an Active Deck</h3>
              <p className="text-xs text-stone-400 font-serif italic">Choose one of your notebooks from the sidebar list to browse vocabulary entries.</p>
            </div>
          )}
        </div>
      </div>

      {/* Add Word Modal */}
      <AnimatePresence>
        {showAddWordModal && activeDeck && (
          <div className="fixed inset-0 bg-stone-950/40 backdrop-blur-xs z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
            <motion.div 
              initial={{ scale: 0.98, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.98, opacity: 0 }}
              className="bg-white border border-stone-200 p-5 sm:p-7 w-full max-w-lg space-y-5 shadow-2xl my-auto max-h-[92vh] flex flex-col overflow-hidden"
            >
              {/* Modal Header */}
              <div className="flex justify-between items-start pb-3 border-b border-stone-100 shrink-0">
                <div>
                  <div className="inline-flex items-center gap-1.5 text-xs font-semibold bg-stone-100 text-stone-700 px-2 py-0.5 mb-1">
                    <Sparkles className="w-3.5 h-3.5 text-amber-500" /> AI-Powered Flashcard Creation
                  </div>
                  <h3 className="text-base sm:text-lg font-bold text-stone-900 tracking-tight">Add Word or Phrase</h3>
                  <p className="text-xs text-stone-500 font-serif italic">Saving to Notebook: <strong className="font-semibold text-stone-700 not-italic">{activeDeck.name}</strong> ({activeDeck.targetLanguage} → {activeDeck.nativeLanguage})</p>
                </div>
                <button 
                  onClick={() => setShowAddWordModal(false)} 
                  className="p-1 text-stone-400 hover:text-stone-900 cursor-pointer transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleAddWordSubmit} className="space-y-4 overflow-y-auto flex-1 pr-1">
                {/* Single Primary Input Box */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-stone-700">
                    Enter Target Vocabulary Word / Expression
                  </label>
                  <div className="relative flex items-center">
                    <input
                      type="text"
                      required
                      autoFocus
                      value={newWord}
                      onChange={(e) => setNewWord(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !isAutofilling) {
                          e.preventDefault();
                          handleAIAutofill();
                        }
                      }}
                      placeholder={`e.g., Ubiquitous, Serendipity, or a phrase`}
                      className="w-full border-2 border-stone-900 bg-stone-50/50 px-3.5 py-2.5 text-sm font-bold text-stone-900 placeholder:text-stone-400 placeholder:font-normal focus:bg-white focus:outline-none transition-all pr-28"
                    />
                    <button
                      type="button"
                      onClick={() => handleAIAutofill()}
                      disabled={isAutofilling || !newWord.trim()}
                      className="absolute right-1 px-3 py-1.5 bg-stone-900 hover:bg-black text-white text-xs font-semibold flex items-center gap-1.5 transition-all disabled:opacity-40 cursor-pointer"
                    >
                      {isAutofilling ? (
                        <>
                          <Loader2 className="w-3 h-3 animate-spin" />
                          <span>Generating...</span>
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-3 h-3 text-amber-300" />
                          <span>AI Fill</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* AI Suggestions Row */}
                <div className="bg-stone-50/80 p-3 border border-stone-200/80 space-y-1.5">
                  <span className="text-xs font-semibold text-stone-700 flex items-center gap-1">
                    <Lightbulb className="w-3.5 h-3.5 text-amber-500" /> Topic Suggestions for {activeDeck.targetLanguage}:
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {(activeDeck.targetLanguage === "Spanish"
                      ? ["Inefable", "Resiliencia", "Efímero", "Serendipia", "Perspicaz"]
                      : activeDeck.targetLanguage === "French"
                      ? ["Éphémère", "Inouï", "Bienveillance", "Savoir-faire", "Dépaysement"]
                      : activeDeck.targetLanguage === "German"
                      ? ["Feingefühl", "Sehnsucht", "Wanderlust", "Zeitgeist", "Fingerspitzengefühl"]
                      : ["Ubiquitous", "Serendipity", "Pragmatic", "Eloquent", "Resilient", "Ephemeral"]
                    ).map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        onClick={() => handleAIAutofill(suggestion)}
                        disabled={isAutofilling}
                        className="px-2.5 py-1 text-xs font-medium bg-white hover:bg-stone-900 hover:text-white text-stone-800 transition-all border border-stone-200 cursor-pointer shadow-2xs hover:border-stone-900"
                      >
                        + {suggestion}
                      </button>
                    ))}
                  </div>
                </div>

                {autofillError && (
                  <div className="p-2.5 bg-red-50 border border-red-200 text-xs text-red-700 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                    <span>{autofillError}</span>
                  </div>
                )}

                {/* AI Generated Details Card Preview */}
                {isAutofilling ? (
                  <div className="p-5 bg-stone-50 border border-stone-200 text-center space-y-2 animate-pulse">
                    <Loader2 className="w-5 h-5 text-stone-600 mx-auto animate-spin" />
                    <p className="text-xs font-semibold text-stone-700">Consulting AI for definitions, IPA pronunciation & contextual sentence...</p>
                  </div>
                ) : (newDefinition || newTranslation) ? (
                  <div className="p-4 bg-stone-50 border border-stone-200 space-y-3">
                    <div className="flex items-start justify-between border-b border-stone-200 pb-2">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-base font-extrabold text-stone-900">{newWord}</span>
                          {newPronunciation && (
                            <span className="text-xs font-mono text-stone-600 bg-stone-200/70 px-1.5 py-0.5">{newPronunciation}</span>
                          )}
                          {newPartOfSpeech && (
                            <span className="text-xs font-semibold bg-stone-900 text-white px-1.5 py-0.5">{newPartOfSpeech}</span>
                          )}
                        </div>
                        {newTranslation && (
                          <p className="text-xs font-serif italic text-stone-800 mt-1">
                            <span className="font-sans text-xs font-semibold text-stone-500 not-italic mr-1.5">Translation:</span>
                            {newTranslation}
                          </p>
                        )}
                      </div>
                    </div>

                    {newDefinition && (
                      <p className="text-xs text-stone-800 leading-relaxed">
                        <span className="font-sans text-xs font-semibold text-stone-500 block mb-0.5">Definition ({activeDeck.nativeLanguage || "Native Language"}):</span>
                        {newDefinition}
                      </p>
                    )}

                    {newExample && (
                      <div className="bg-white p-2.5 border border-stone-200 text-xs font-serif space-y-1">
                        <p className="text-stone-900">"{newExample}"</p>
                        {newExampleTranslation && (
                          <p className="text-stone-500 italic text-[11px]">{newExampleTranslation}</p>
                        )}
                      </div>
                    )}
                  </div>
                ) : null}

                {/* Manual Edit Toggle */}
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => setShowManualFields(!showManualFields)}
                    className="text-xs font-semibold text-stone-500 hover:text-stone-900 flex items-center gap-1 cursor-pointer transition-colors"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>{showManualFields ? "Hide manual form fields" : "Edit fields manually"}</span>
                    {showManualFields ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </button>
                </div>

                {/* Expandable Manual Form Fields */}
                {showManualFields && (
                  <motion.div 
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="space-y-3 pt-2 border-t border-stone-200"
                  >
                    <div className="grid grid-cols-2 gap-2.5 text-xs">
                      <div>
                        <label className="block text-xs font-semibold text-stone-700 mb-1">Pronunciation IPA</label>
                        <input
                          type="text"
                          value={newPronunciation}
                          onChange={(e) => setNewPronunciation(e.target.value)}
                          placeholder="e.g., /yo͞oˈbikwədəs/"
                          className="w-full border border-stone-200 bg-stone-50 px-2.5 py-1.5 text-stone-900 outline-none focus:border-stone-950 focus:bg-white text-xs font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-stone-700 mb-1">Part of Speech</label>
                        <select
                          value={newPartOfSpeech}
                          onChange={(e) => setNewPartOfSpeech(e.target.value)}
                          className="w-full border border-stone-200 bg-stone-50 px-2.5 py-1.5 text-stone-900 font-bold outline-none focus:border-stone-950 focus:bg-white text-xs cursor-pointer"
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

                    <div className="grid grid-cols-2 gap-2.5 text-xs">
                      <div>
                        <label className="block text-xs font-semibold text-stone-700 mb-1">Translation ({activeDeck.nativeLanguage})</label>
                        <input
                          type="text"
                          value={newTranslation}
                          onChange={(e) => setNewTranslation(e.target.value)}
                          placeholder="Meaning in native tongue"
                          className="w-full border border-stone-200 bg-stone-50 px-2.5 py-1.5 text-stone-900 outline-none focus:border-stone-950 focus:bg-white text-xs font-serif"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-stone-700 mb-1">Definition ({activeDeck.targetLanguage})</label>
                        <input
                          type="text"
                          value={newDefinition}
                          onChange={(e) => setNewDefinition(e.target.value)}
                          placeholder="Definition in target tongue"
                          className="w-full border border-stone-200 bg-stone-50 px-2.5 py-1.5 text-stone-900 outline-none focus:border-stone-950 focus:bg-white text-xs font-serif"
                        />
                      </div>
                    </div>

                    <div className="text-xs">
                      <label className="block text-xs font-semibold text-stone-700 mb-1">Context Example Sentence</label>
                      <textarea
                        rows={2}
                        value={newExample}
                        onChange={(e) => setNewExample(e.target.value)}
                        placeholder="Use the word in a high-quality example sentence..."
                        className="w-full border border-stone-200 bg-stone-50 px-2.5 py-1.5 text-stone-900 outline-none focus:border-stone-950 focus:bg-white text-xs resize-none font-serif"
                      />
                    </div>

                    <div className="text-xs">
                      <label className="block text-xs font-semibold text-stone-700 mb-1">Example Sentence Translation</label>
                      <textarea
                        rows={2}
                        value={newExampleTranslation}
                        onChange={(e) => setNewExampleTranslation(e.target.value)}
                        placeholder="Translation of example sentence..."
                        className="w-full border border-stone-200 bg-stone-50 px-2.5 py-1.5 text-stone-900 outline-none focus:border-stone-950 focus:bg-white text-xs resize-none font-serif"
                      />
                    </div>
                  </motion.div>
                )}

                {/* Form Footer Action Buttons */}
                <div className="flex gap-2 justify-end pt-3 border-t border-stone-200 shrink-0">
                  <button
                    type="button"
                    onClick={() => setShowAddWordModal(false)}
                    className="px-4 py-2 text-xs font-semibold text-stone-500 hover:text-stone-900 cursor-pointer transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={!newWord.trim() || isAutofilling}
                    className="px-6 py-2.5 bg-stone-900 hover:bg-black text-white font-semibold text-xs transition-all cursor-pointer disabled:opacity-40 flex items-center gap-1.5"
                  >
                    <Plus className="w-4 h-4" /> Save Word
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
              className="bg-white border border-stone-200 p-6 sm:p-8 w-full max-w-lg space-y-5 shadow-2xl"
            >
              <div className="flex justify-between items-start pb-3 border-b border-stone-100">
                <div>
                  <div className="inline-flex items-center gap-1.5 text-xs font-semibold bg-amber-50 text-amber-800 px-2 py-0.5 border border-amber-200/80 mb-1">
                    <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                    {isManualCreateMode ? "Manual Creation" : "Gemini AI Generator"}
                  </div>
                  <h3 className="text-lg font-bold text-stone-900">
                    {isManualCreateMode ? "Create Blank Notebook" : "Create AI Notebook"}
                  </h3>
                  <p className="text-xs text-stone-500 font-serif italic mt-0.5">
                    {isManualCreateMode 
                      ? "Set up an empty custom notebook and add words manually." 
                      : "Type a topic (e.g. Chess) and AI will auto-create title, description & vocabulary!"}
                  </p>
                </div>
                <button 
                  onClick={() => setShowAddDeckModal(false)} 
                  className="p-1.5 text-stone-400 hover:text-stone-900 cursor-pointer rounded-none"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {!isManualCreateMode ? (
                /* AI Notebook Form */
                <form onSubmit={handleAIGenerateDeckSubmit} className="space-y-4 text-xs">
                  <div>
                    <label className="block text-xs font-semibold text-stone-900 mb-1.5">
                      Topic or Subject to Learn
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        required
                        autoFocus
                        value={deckTopicInput}
                        onChange={(e) => setDeckTopicInput(e.target.value)}
                        placeholder="e.g., Chess, Italian Dining, Medical Terms, Airport..."
                        className="w-full border border-stone-300 bg-stone-50 px-3.5 py-2.5 text-stone-900 font-semibold text-xs outline-none focus:border-stone-950 focus:bg-white transition-all shadow-2xs"
                      />
                    </div>
                  </div>

                  {/* Popular Quick Topics */}
                  <div className="space-y-1.5">
                    <span className="text-[11px] font-semibold text-stone-500">Quick Topics:</span>
                    <div className="flex flex-wrap gap-1.5">
                      {POPULAR_TOPICS.map((topic) => (
                        <button
                          key={topic.value}
                          type="button"
                          onClick={() => setDeckTopicInput(topic.value)}
                          className={`px-2.5 py-1 text-xs font-medium border transition-all cursor-pointer ${
                            deckTopicInput === topic.value
                              ? "bg-stone-900 text-white border-stone-900"
                              : "bg-stone-50 hover:bg-stone-100 text-stone-700 border-stone-200"
                          }`}
                        >
                          {topic.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Languages Row */}
                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <div>
                      <label className="block text-xs font-semibold text-stone-700 mb-1">Target Language</label>
                      <select 
                        value={newDeckTarget} 
                        onChange={(e) => setNewDeckTarget(e.target.value)}
                        className="w-full border border-stone-200 bg-stone-50 px-3 py-2 text-stone-900 font-semibold outline-none focus:border-stone-950 focus:bg-white text-xs cursor-pointer"
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
                      <label className="block text-xs font-semibold text-stone-700 mb-1">Native Language</label>
                      <select 
                        value={newDeckNative} 
                        onChange={(e) => setNewDeckNative(e.target.value)}
                        className="w-full border border-stone-200 bg-stone-50 px-3 py-2 text-stone-900 font-semibold outline-none focus:border-stone-950 focus:bg-white text-xs cursor-pointer"
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

                  {/* Words Quantity */}
                  <div>
                    <label className="block text-xs font-semibold text-stone-700 mb-1.5">Vocabulary Items to Generate</label>
                    <div className="flex gap-2">
                      {[5, 8, 12, 15].map((cnt) => (
                        <button
                          key={cnt}
                          type="button"
                          onClick={() => setDeckQuantity(cnt)}
                          className={`flex-1 py-1.5 border text-xs font-semibold transition-all cursor-pointer ${
                            deckQuantity === cnt
                              ? "bg-stone-900 text-white border-stone-900"
                              : "bg-stone-50 hover:bg-stone-100 text-stone-700 border-stone-200"
                          }`}
                        >
                          {cnt} Words
                        </button>
                      ))}
                    </div>
                  </div>

                  {deckGenError && (
                    <div className="p-3 bg-red-50 border border-red-200 text-red-800 text-xs flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
                      <span>{deckGenError}</span>
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-3 border-t border-stone-100">
                    <button
                      type="button"
                      onClick={() => setIsManualCreateMode(true)}
                      className="text-xs text-stone-500 hover:text-stone-900 underline underline-offset-2 cursor-pointer font-medium"
                    >
                      Or create an empty notebook manually
                    </button>

                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setShowAddDeckModal(false)}
                        disabled={isGeneratingDeck}
                        className="px-3.5 py-2 text-xs font-semibold text-stone-500 hover:text-stone-900 cursor-pointer disabled:opacity-40"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={!deckTopicInput.trim() || isGeneratingDeck}
                        className="px-5 py-2.5 bg-stone-900 hover:bg-black text-white font-semibold text-xs transition-all cursor-pointer disabled:opacity-40 flex items-center gap-2 shadow-xs"
                      >
                        {isGeneratingDeck ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin text-amber-300" />
                            Creating AI Notebook...
                          </>
                        ) : (
                          <>
                            <Wand2 className="w-4 h-4 text-amber-400" />
                            Generate AI Notebook
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </form>
              ) : (
                /* Blank Manual Notebook Form */
                <form onSubmit={handleAddDeckSubmit} className="space-y-4 text-xs">
                  <div>
                    <label className="block text-xs font-semibold text-stone-700 mb-1.5">Notebook / Deck Name</label>
                    <input
                      type="text"
                      required
                      value={newDeckName}
                      onChange={(e) => setNewDeckName(e.target.value)}
                      placeholder="e.g., Italian Kitchen Words"
                      className="w-full border border-stone-200 bg-stone-50 px-3 py-2 text-stone-900 font-semibold outline-none focus:border-stone-950 focus:bg-white transition-all text-xs"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-stone-700 mb-1.5">Description</label>
                    <input
                      type="text"
                      value={newDeckDesc}
                      onChange={(e) => setNewDeckDesc(e.target.value)}
                      placeholder="e.g., Handy words learned while cooking"
                      className="w-full border border-stone-200 bg-stone-50 px-3 py-2 text-stone-900 outline-none focus:border-stone-950 focus:bg-white transition-all text-xs font-serif italic"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-stone-700 mb-1.5">Target Language</label>
                      <select 
                        value={newDeckTarget} 
                        onChange={(e) => setNewDeckTarget(e.target.value)}
                        className="w-full border border-stone-200 bg-stone-50 px-3 py-2 text-stone-900 font-semibold outline-none focus:border-stone-950 focus:bg-white transition-all text-xs cursor-pointer"
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
                      <label className="block text-xs font-semibold text-stone-700 mb-1.5">Native Language</label>
                      <select 
                        value={newDeckNative} 
                        onChange={(e) => setNewDeckNative(e.target.value)}
                        className="w-full border border-stone-200 bg-stone-50 px-3 py-2 text-stone-900 font-semibold outline-none focus:border-stone-950 focus:bg-white transition-all text-xs cursor-pointer"
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

                  <div className="flex items-center justify-between pt-3 border-t border-stone-100">
                    <button
                      type="button"
                      onClick={() => setIsManualCreateMode(false)}
                      className="text-xs text-stone-500 hover:text-stone-900 underline underline-offset-2 cursor-pointer font-medium"
                    >
                      ← Switch to AI Generator
                    </button>

                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setShowAddDeckModal(false)}
                        className="px-4 py-2 text-xs font-semibold text-stone-500 hover:text-stone-900 cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="px-5 py-2.5 bg-stone-900 hover:bg-black text-white font-semibold text-xs transition-all cursor-pointer"
                      >
                        Create Blank Notebook
                      </button>
                    </div>
                  </div>
                </form>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}

