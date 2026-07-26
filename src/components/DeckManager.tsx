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
  AlertCircle,
  Edit3,
  ChevronDown,
  ChevronUp,
  Lightbulb,
  Wand2
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

      const response = await fetch("/api/autofill-word", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          word: wordToFill,
          targetLanguage: userTargetLang,
          nativeLanguage: userNativeLang,
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
        {/* Left Hand side select column */}
        <div className="lg:col-span-4 space-y-3">
          <label className="block text-xs font-semibold text-stone-500">Your Active Decks</label>
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
                      className={`px-3 py-1.5 rounded-none text-xs font-medium capitalize transition-all cursor-pointer ${
                        activeFilter === filter 
                          ? "bg-stone-900 text-white font-semibold" 
                          : "bg-stone-50 border border-stone-200 text-stone-600 hover:text-stone-950 hover:border-stone-450"
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
                    <p className="text-sm font-semibold text-stone-600">No entries matched</p>
                    <p className="text-xs font-serif italic">"Try adjusting your keyword filter or check another category list."</p>
                  </div>
                ) : (
                  filteredWords.map((word) => (
                    <div key={word.id} className="py-4 flex justify-between items-start gap-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-bold text-stone-900">{word.word}</h4>
                          <span className="text-[10px] text-stone-400 font-mono italic">{word.pronunciation}</span>
                          <span className="text-[10px] font-semibold text-stone-600 bg-stone-50 border border-stone-200 px-1.5 py-0.5 rounded-none font-mono">
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

