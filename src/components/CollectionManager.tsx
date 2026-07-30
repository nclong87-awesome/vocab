import React, { useState, useEffect, useMemo } from "react";
import { 
  BookOpen, 
  Plus, 
  Search, 
  Sparkles, 
  Wand2, 
  Grid, 
  List, 
  Globe2,
  ArrowUpDown
} from "lucide-react";
import { Word, LLMConfig, TTSConfig } from "../types";
import { speakText as speakTextService, DEFAULT_TTS_CONFIG } from "../utils/ttsService";
import { autofillWordService, generateRandomWordsService } from "../services/llmClientService";

import WordCard from "./deckManager/WordCard";
import WordRow from "./deckManager/WordRow";
import AddWordModal from "./deckManager/AddWordModal";
import RandomWordsModal from "./deckManager/RandomWordsModal";

interface CollectionManagerProps {
  words: Word[];
  onAddWord: (
    word: Omit<Word, "id" | "learned" | "strength" | "createdAt" | "lastReviewed"> & {
      createdAt?: string;
      lastReviewed?: string | null;
    }
  ) => void;
  onDeleteWord: (wordId: string) => void;
  onToggleStar: (wordId: string) => void;
  onToggleLearned: (wordId: string) => void;
  onUpdateWords?: (updatedWords: Word[]) => void;
  llmConfig?: LLMConfig;
  ttsConfig?: TTSConfig;
  targetLanguage?: string;
  nativeLanguage?: string;
}

export default function CollectionManager({
  words,
  onAddWord,
  onDeleteWord,
  onToggleStar,
  onToggleLearned,
  onUpdateWords,
  llmConfig,
  ttsConfig = DEFAULT_TTS_CONFIG,
  targetLanguage = "English",
  nativeLanguage = "Vietnamese",
}: CollectionManagerProps) {
  // Modal states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isRandomWordsModalOpen, setIsRandomWordsModalOpen] = useState(false);

  // Form input states for adding a single word
  const [wordInput, setWordInput] = useState("");
  const [translationInput, setTranslationInput] = useState("");
  const [definitionInput, setDefinitionInput] = useState("");
  const [partOfSpeechInput, setPartOfSpeechInput] = useState("noun");
  const [pronunciationInput, setPronunciationInput] = useState("");
  const [exampleInput, setExampleInput] = useState("");
  const [exampleTranslationInput, setExampleTranslationInput] = useState("");
  const [categoryInput, setCategoryInput] = useState("");
  const [contextInput, setContextInput] = useState("");
  const [autofilling, setAutofilling] = useState(false);

  // Form input states for generating N random words
  const [randomCount, setRandomCount] = useState(5);
  const [randomWordsTopic, setRandomWordsTopic] = useState("");
  const [isGeneratingRandomWords, setIsGeneratingRandomWords] = useState(false);

  // Re-generate individual word loading states
  const [regeneratingWordId, setRegeneratingWordId] = useState<string | null>(null);
  const [regeneratedSuccessWordId, setRegeneratedSuccessWordId] = useState<string | null>(null);

  // UI layout, sort, and search states
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<"newest" | "oldest" | "alpha" | "unlearned">("newest");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [brokenImageIds, setBrokenImageIds] = useState<Set<string>>(new Set());

  // Handle image load errors gracefully
  const handleImageError = (wordId: string) => {
    setBrokenImageIds(prev => {
      const next = new Set(prev);
      next.add(wordId);
      return next;
    });
  };

  // Speak word TTS
  const speakWord = (text: string) => {
    speakTextService(text, ttsConfig, llmConfig, targetLanguage);
  };

  // Re-generate details for an existing word using AI
  const handleRegenerateWord = async (word: Word) => {
    setRegeneratingWordId(word.id);
    setRegeneratedSuccessWordId(null);

    try {
      const details = await autofillWordService({
        word: word.word,
        targetLanguage,
        nativeLanguage,
        llmConfig
      });

      if (onUpdateWords) {
        const updatedWords = words.map(w => {
          if (w.id === word.id) {
            return {
              ...w,
              translation: details.translation || w.translation,
              definition: details.definition || w.definition,
              partOfSpeech: details.partOfSpeech || w.partOfSpeech,
              pronunciation: details.pronunciation || w.pronunciation,
              example: details.example || w.example,
              exampleTranslation: details.exampleTranslation || w.exampleTranslation,
              category: details.category || w.category,
              context: details.context || w.context
            };
          }
          return w;
        });

        onUpdateWords(updatedWords);

        setRegeneratedSuccessWordId(word.id);
        setTimeout(() => setRegeneratedSuccessWordId(null), 4000);
      }
    } catch (err) {
      console.error("Failed to re-generate word details:", err);
      alert("Unable to re-generate word details. Please verify your AI Key.");
    } finally {
      setRegeneratingWordId(null);
    }
  };

  // AI Auto-Fill for the Add Word form
  const handleAiAutofill = async () => {
    if (!wordInput.trim()) return;
    setAutofilling(true);
    try {
      const details = await autofillWordService({
        word: wordInput.trim(),
        targetLanguage,
        nativeLanguage,
        llmConfig
      });

      if (details.translation) setTranslationInput(details.translation);
      if (details.definition) setDefinitionInput(details.definition);
      if (details.partOfSpeech) setPartOfSpeechInput(details.partOfSpeech);
      if (details.pronunciation) setPronunciationInput(details.pronunciation);
      if (details.example) setExampleInput(details.example);
      if (details.exampleTranslation) setExampleTranslationInput(details.exampleTranslation);
      if (details.category) setCategoryInput(details.category);
      if (details.context) setContextInput(details.context);
    } catch (err) {
      console.error("Failed to autofill word:", err);
      alert("AI Auto-fill failed. Please verify your LLM Key in Settings.");
    } finally {
      setAutofilling(false);
    }
  };

  // AI Suggest Unlearned Word for Add Word form
  const handleAiSuggestRelatedWord = async () => {
    setAutofilling(true);
    try {
      const existingWords = words.map(w => w.word);
      const res = await generateRandomWordsService({
        topic: "vocabulary",
        targetLanguage,
        nativeLanguage,
        count: 5,
        existingWords,
        llmConfig
      });

      const generatedList = res.words || [];
      const freshWordObj = generatedList.find((item: any) => !existingWords.includes(item.word)) || generatedList[0];

      if (freshWordObj) {
        setWordInput(freshWordObj.word);
        setTranslationInput(freshWordObj.translation);
        setDefinitionInput(freshWordObj.definition);
        setPartOfSpeechInput(freshWordObj.partOfSpeech || "noun");
        setPronunciationInput(freshWordObj.pronunciation || "");
        setExampleInput(freshWordObj.example || "");
        setExampleTranslationInput(freshWordObj.exampleTranslation || "");
        if (freshWordObj.category) setCategoryInput(freshWordObj.category);
        if (freshWordObj.context) setContextInput(freshWordObj.context);
      }
    } catch (err) {
      console.error("AI word suggestion failed:", err);
    } finally {
      setAutofilling(false);
    }
  };

  // Handle Add Word Form Submit
  const handleAddWordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!wordInput.trim() || !translationInput.trim()) return;

    onAddWord({
      word: wordInput.trim(),
      translation: translationInput.trim(),
      definition: definitionInput.trim(),
      partOfSpeech: partOfSpeechInput,
      pronunciation: pronunciationInput.trim() || undefined,
      example: exampleInput.trim() || undefined,
      exampleTranslation: exampleTranslationInput.trim() || undefined,
      category: categoryInput.trim() || undefined,
      context: contextInput.trim() || undefined,
      starred: false
    });

    // Reset inputs
    setWordInput("");
    setTranslationInput("");
    setDefinitionInput("");
    setPartOfSpeechInput("noun");
    setPronunciationInput("");
    setExampleInput("");
    setExampleTranslationInput("");
    setCategoryInput("");
    setContextInput("");
    setIsModalOpen(false);
  };

  // Generate N Random Words
  const handleGenerateRandomWordsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    setIsGeneratingRandomWords(true);
    try {
      const existingWords = words.map(w => w.word);
      const res = await generateRandomWordsService({
        topic: randomWordsTopic.trim() || "vocabulary",
        targetLanguage,
        nativeLanguage,
        count: randomCount + 2,
        existingWords,
        llmConfig
      });

      const generatedList = res.words || [];

      const newUniqueWords = generatedList.filter((item: any) => !existingWords.includes(item.word)).slice(0, randomCount);

      newUniqueWords.forEach((item: any) => {
        onAddWord({
          word: item.word,
          translation: item.translation,
          definition: item.definition,
          partOfSpeech: item.partOfSpeech || "noun",
          pronunciation: item.pronunciation,
          example: item.example,
          exampleTranslation: item.exampleTranslation,
          category: item.category || randomWordsTopic.trim() || "General",
          context: item.context || item.definition,
          starred: false
        });
      });

      setRandomWordsTopic("");
      setIsRandomWordsModalOpen(false);
    } catch (err) {
      console.error("Failed to generate random words:", err);
      alert("Unable to generate random words. Please verify your LLM Key.");
    } finally {
      setIsGeneratingRandomWords(false);
    }
  };

  // Filter and sort words by search query and selected sort mode (defaults to newest first)
  const filteredWords = useMemo(() => {
    // Map words with original array index for fallback ordering
    let list = words.map((w, originalIndex) => ({ word: w, originalIndex }));

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(({ word: w }) => 
        w.word.toLowerCase().includes(q) ||
        w.translation.toLowerCase().includes(q) ||
        w.definition.toLowerCase().includes(q)
      );
    }

    const getWordTimestamp = (w: Word, originalIndex: number): number => {
      if (w.createdAt) {
        const t = new Date(w.createdAt).getTime();
        if (!isNaN(t) && t > 0) return t;
      }
      const match = w.id.match(/\d{10,13}/);
      if (match) {
        const parsed = parseInt(match[0], 10);
        if (!isNaN(parsed) && parsed > 1000000000) return parsed;
      }
      return originalIndex;
    };

    list.sort((a, b) => {
      const tA = getWordTimestamp(a.word, a.originalIndex);
      const tB = getWordTimestamp(b.word, b.originalIndex);

      if (sortBy === "newest") {
        if (tA !== tB) return tB - tA; // Newest timestamp/created first
        return b.originalIndex - a.originalIndex; // Later array insertion index first
      } else if (sortBy === "oldest") {
        if (tA !== tB) return tA - tB;
        return a.originalIndex - b.originalIndex;
      } else if (sortBy === "alpha") {
        return a.word.word.localeCompare(b.word.word);
      } else if (sortBy === "unlearned") {
        if (a.word.learned !== b.word.learned) {
          return a.word.learned ? 1 : -1;
        }
        if (tA !== tB) return tB - tA;
        return b.originalIndex - a.originalIndex;
      }
      return 0;
    });

    return list.map(item => item.word);
  }, [words, searchQuery, sortBy]);

  return (
    <div className="space-y-8" id="collection-manager-container">
      <div className="space-y-4">
        <div className="bg-white border border-stone-200 p-4 space-y-6 shadow-2xs">
            {/* Active List Title & Quick Controls */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-stone-200 pb-5">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-xs font-mono font-bold text-stone-500">
                  <Globe2 className="w-3.5 h-3.5 text-stone-900" />
                  <span>{targetLanguage} ↔ {nativeLanguage}</span>
                  <span className="text-stone-300">•</span>
                  <span className="text-stone-900">{words.length} terms</span>
                </div>
                <h2 className="text-xl font-bold text-stone-950">Vocabulary List</h2>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => setIsRandomWordsModalOpen(true)}
                  className="px-3.5 py-2 bg-amber-400 hover:bg-amber-300 font-bold text-[11px] uppercase tracking-wider flex items-center gap-1.5 cursor-pointer border border-amber-500 transition-all shadow-2xs"
                  title="Generate random non-duplicate words with AI"
                >
                  <Wand2 className="w-3.5 h-3.5" />
                  <span>Random Words</span>
                </button>
                <button
                  onClick={() => setIsModalOpen(true)}
                  className="px-3.5 py-2 bg-stone-900 hover:bg-black text-white font-bold text-[11px] uppercase tracking-wider flex items-center gap-1.5 cursor-pointer transition-all shadow-xs"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Word</span>
                </button>
              </div>
            </div>

              {/* Search, Sort & Layout View Bar */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-stone-50 p-3 border border-stone-200">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Filter terms by spelling, translation, or definition..."
                    className="w-full pl-9 pr-3 py-2 bg-white border border-stone-200 text-xs text-stone-900 placeholder:text-stone-400 outline-none focus:border-stone-950 font-medium"
                  />
                  {searchQuery && (
                    <button 
                      onClick={() => setSearchQuery("")} 
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-900 text-xs"
                    >
                      ✕
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {/* Sort Order Selector */}
                  <div className="flex items-center gap-1.5 bg-white border border-stone-200 px-2.5 py-1.5 shrink-0">
                    <ArrowUpDown className="w-3.5 h-3.5 text-amber-600" />
                    <span className="text-[11px] font-bold text-stone-500 uppercase tracking-wider hidden sm:inline">Sort:</span>
                    <select
                      value={sortBy}
                      onChange={(e) => setSortBy(e.target.value as "newest" | "oldest" | "alpha" | "unlearned")}
                      className="text-xs font-bold text-stone-900 bg-transparent outline-none cursor-pointer"
                    >
                      <option value="newest">New Words First</option>
                      <option value="oldest">Oldest First</option>
                      <option value="alpha">Alphabetical (A-Z)</option>
                      <option value="unlearned">Unlearned First</option>
                    </select>
                  </div>

                  <div className="flex items-center gap-1 border-l border-stone-200 pl-2">
                    <button
                      onClick={() => setViewMode("grid")}
                      className={`p-2 border transition-all cursor-pointer ${
                        viewMode === "grid" 
                          ? "bg-stone-900 text-white border-stone-900" 
                          : "bg-white text-stone-500 border-stone-200 hover:text-stone-900"
                      }`}
                      title="Grid Card View"
                    >
                      <Grid className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setViewMode("list")}
                      className={`p-2 border transition-all cursor-pointer ${
                        viewMode === "list" 
                          ? "bg-stone-900 text-white border-stone-900" 
                          : "bg-white text-stone-500 border-stone-200 hover:text-stone-900"
                      }`}
                      title="Compact Row List View"
                    >
                      <List className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Words Display Grid/List */}
              {filteredWords.length > 0 ? (
                viewMode === "grid" ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4" id="words-grid-container">
                    {filteredWords.map((word) => (
                      <WordCard
                        key={word.id}
                        word={word}
                        speakWord={speakWord}
                        handleRegenerateWord={handleRegenerateWord}
                        regeneratingWordId={regeneratingWordId}
                        regeneratedSuccessWordId={regeneratedSuccessWordId}
                        onToggleStar={onToggleStar}
                        onToggleLearned={onToggleLearned}
                        onDeleteWord={onDeleteWord}
                        brokenImageIds={brokenImageIds}
                        handleImageError={handleImageError}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="space-y-3" id="words-list-container">
                    {filteredWords.map((word) => (
                      <WordRow
                        key={word.id}
                        word={word}
                        speakWord={speakWord}
                        handleRegenerateWord={handleRegenerateWord}
                        regeneratingWordId={regeneratingWordId}
                        onToggleStar={onToggleStar}
                        onToggleLearned={onToggleLearned}
                        onDeleteWord={onDeleteWord}
                        brokenImageIds={brokenImageIds}
                        handleImageError={handleImageError}
                      />
                    ))}
                  </div>
                )
              ) : (
                <div className="p-12 text-center bg-stone-50 border border-stone-200 space-y-3">
                  <BookOpen className="w-8 h-8 text-stone-400 mx-auto" />
                  <h4 className="font-bold text-sm text-stone-900">No Vocabulary Words Found</h4>
                  <p className="text-xs text-stone-500 font-serif italic max-w-sm mx-auto">
                    {searchQuery ? "No terms match your search filter." : "Your vocabulary list is empty. Click 'Add Word' or 'AI Random Words' to begin adding vocabulary!"}
                  </p>
                </div>
              )}
            </div>
          </div>

      {/* Add Word Modal */}
      <AddWordModal
        isModalOpen={isModalOpen}
        setIsModalOpen={setIsModalOpen}
        wordInput={wordInput}
        setWordInput={setWordInput}
        translationInput={translationInput}
        setTranslationInput={setTranslationInput}
        definitionInput={definitionInput}
        setDefinitionInput={setDefinitionInput}
        partOfSpeechInput={partOfSpeechInput}
        setPartOfSpeechInput={setPartOfSpeechInput}
        pronunciationInput={pronunciationInput}
        setPronunciationInput={setPronunciationInput}
        exampleInput={exampleInput}
        setExampleInput={setExampleInput}
        exampleTranslationInput={exampleTranslationInput}
        setExampleTranslationInput={setExampleTranslationInput}
        categoryInput={categoryInput}
        setCategoryInput={setCategoryInput}
        contextInput={contextInput}
        setContextInput={setContextInput}
        autofilling={autofilling}
        targetLanguage={targetLanguage}
        nativeLanguage={nativeLanguage}
        handleAiAutofill={handleAiAutofill}
        handleAiSuggestRelatedWord={handleAiSuggestRelatedWord}
        handleAddWordSubmit={handleAddWordSubmit}
      />

      {/* Random Words Modal */}
      <RandomWordsModal
        isRandomWordsModalOpen={isRandomWordsModalOpen}
        setIsRandomWordsModalOpen={setIsRandomWordsModalOpen}
        randomCount={randomCount}
        setRandomCount={setRandomCount}
        randomWordsTopic={randomWordsTopic}
        setRandomWordsTopic={setRandomWordsTopic}
        isGeneratingRandomWords={isGeneratingRandomWords}
        targetLanguage={targetLanguage}
        nativeLanguage={nativeLanguage}
        handleGenerateRandomWordsSubmit={handleGenerateRandomWordsSubmit}
      />
    </div>
  );
}
