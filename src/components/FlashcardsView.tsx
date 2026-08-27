import React, { useState, useMemo, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Volume2, 
  Star, 
  CheckCircle, 
  ArrowLeft, 
  ArrowRight, 
  RefreshCw, 
  Check, 
  HelpCircle, 
  Trophy, 
  List, 
  Layers, 
  Sparkles, 
  Clock, 
  Filter, 
  History, 
  Languages, 
  ArrowUpDown,
  BookOpen
} from "lucide-react";
import { Word, TTSConfig, LLMConfig } from "../types";
import { isWordEligibleForReview, isWordLearnedOrStudied, getWordCreationTimestamp } from "../utils/spacedRepetition";
import { speakText as speakTextService, stopSpeech, DEFAULT_TTS_CONFIG, getLanguageCode } from "../utils/ttsService";
import { t } from "../config/i18n";
import StrengthHistoryModal from "./analytics/StrengthHistoryModal";
import WordDetailsModal from "./deckManager/WordDetailsModal";

interface FlashcardsViewProps {
  words: Word[];
  onToggleStar: (wordId: string) => void;
  onToggleLearned: (wordId: string) => void;
  onGoBack: () => void;
  startPractice: () => void;
  ttsConfig?: TTSConfig;
  llmConfig?: LLMConfig;
  targetLanguage?: string;
  appLanguage?: string;
  onUpdateWords?: (updatedWords: Word[]) => void;
}

export default function FlashcardsView({
  words,
  onToggleStar,
  onToggleLearned,
  onGoBack,
  startPractice,
  ttsConfig = DEFAULT_TTS_CONFIG,
  llmConfig,
  targetLanguage = "English",
  appLanguage = "Vietnamese",
  onUpdateWords
}: FlashcardsViewProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [viewMode, setViewMode] = useState<"card" | "list">("card");
  const [filterCategory, setFilterCategory] = useState<"all" | "new" | "due" | "starred">("all");
  const [sortBy, setSortBy] = useState<"smart" | "oldest" | "newest" | "alpha">("smart");
  const [selectedHistoryWord, setSelectedHistoryWord] = useState<Word | null>(null);
  const [selectedDetailsWord, setSelectedDetailsWord] = useState<Word | null>(null);
  const [showExampleTranslation, setShowExampleTranslation] = useState(false);
  const [expandedListTranslations, setExpandedListTranslations] = useState<Record<string, boolean>>({});
  const cardContainerRef = useRef<HTMLDivElement>(null);

  const scrollToCardTop = () => {
    if (cardContainerRef.current) {
      try {
        cardContainerRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
      } catch {
        cardContainerRef.current.scrollIntoView();
      }
    }
  };

  const filterCounts = useMemo(() => {
    if (!words) return { all: 0, new: 0, due: 0, starred: 0 };
    const now = new Date();
    let newCount = 0;
    let dueCount = 0;
    let starredCount = 0;

    for (const w of words) {
      if (w.starred) starredCount++;
      if (!isWordLearnedOrStudied(w)) newCount++;
      else if (isWordEligibleForReview(w, now)) dueCount++;
    }

    return { all: words.length, new: newCount, due: dueCount, starred: starredCount };
  }, [words]);

  const sortedWords = useMemo(() => {
    if (!words || words.length === 0) return [];

    const now = new Date();
    let subset = [...words];

    if (filterCategory === "new") {
      subset = subset.filter(w => !isWordLearnedOrStudied(w));
    } else if (filterCategory === "due") {
      subset = subset.filter(w => isWordLearnedOrStudied(w) && isWordEligibleForReview(w, now));
    } else if (filterCategory === "starred") {
      subset = subset.filter(w => w.starred);
    }

    const list = subset.map((w, originalIndex) => ({ word: w, originalIndex }));

    list.sort((a, b) => {
      const tA = getWordCreationTimestamp(a.word, a.originalIndex);
      const tB = getWordCreationTimestamp(b.word, b.originalIndex);

      if (sortBy === "oldest") {
        if (tA !== tB) return tA - tB;
        return a.originalIndex - b.originalIndex;
      }

      if (sortBy === "newest") {
        if (tA !== tB) return tB - tA;
        return b.originalIndex - a.originalIndex;
      }

      if (sortBy === "alpha") {
        return a.word.word.localeCompare(b.word.word);
      }

      // Default "smart" mode:
      // Priority 1: Starred & Due review items
      // Priority 2: Unstudied words ordered chronologically FIFO (oldest added first, e.g. yesterday before today)
      // Priority 3: Mastered / learned words
      const isDueA = isWordEligibleForReview(a.word, now) && isWordLearnedOrStudied(a.word);
      const isDueB = isWordEligibleForReview(b.word, now) && isWordLearnedOrStudied(b.word);
      const isUnstudiedA = !isWordLearnedOrStudied(a.word);
      const isUnstudiedB = !isWordLearnedOrStudied(b.word);

      const rank = (isDue: boolean, isUnstudied: boolean, starred?: boolean) => {
        if (starred && isDue) return 0;
        if (isDue) return 1;
        if (starred && isUnstudied) return 2;
        if (isUnstudied) return 3;
        return 4;
      };

      const rankA = rank(isDueA, isUnstudiedA, a.word.starred);
      const rankB = rank(isDueB, isUnstudiedB, b.word.starred);

      if (rankA !== rankB) return rankA - rankB;

      // Within unstudied tier: oldest added first (FIFO) so yesterday's words come before today's
      if (isUnstudiedA && isUnstudiedB) {
        if (tA !== tB) return tA - tB;
        return a.originalIndex - b.originalIndex;
      }

      // Within due tier or other: oldest created first
      if (tA !== tB) return tA - tB;
      return a.originalIndex - b.originalIndex;
    });

    return list.map(item => item.word);
  }, [words, filterCategory, sortBy]);

  const handleSelectFilter = (category: "all" | "new" | "due" | "starred") => {
    setFilterCategory(category);
    setCurrentIndex(0);
    setIsFlipped(false);
    setShowExampleTranslation(false);
  };

  const currentWord = sortedWords[currentIndex];

  if (!sortedWords || sortedWords.length === 0) {
    return (
      <div className="text-center py-16 space-y-4 max-w-md mx-auto">
        <h2 className="text-xl font-bold text-stone-900 font-serif">{t("flashcards_empty_title", appLanguage)}</h2>
        <p className="text-xs text-stone-500 font-serif italic">{t("flashcards_empty_desc", appLanguage)}</p>
        <div className="flex justify-center gap-3 pt-2">
          <button 
            onClick={onGoBack}
            className="px-5 py-2.5 bg-stone-900 text-white font-semibold text-xs hover:bg-black transition-colors cursor-pointer"
          >
            {t("flashcards_back_dash", appLanguage)}
          </button>
        </div>
      </div>
    );
  }

  // Stop speech when unmounting
  useEffect(() => {
    return () => {
      stopSpeech();
    };
  }, []);

  const handleNext = () => {
    setIsFlipped(false);
    setShowExampleTranslation(false);
    stopSpeech();
    if (currentIndex < sortedWords.length - 1) {
      const nextIdx = currentIndex + 1;
      setCurrentIndex(nextIdx);
      const nextWord = sortedWords[nextIdx];
      if (nextWord && nextWord.word && (ttsConfig?.autoPlayAudioInChat ?? ttsConfig?.autoPlayAudioInQuiz ?? true)) {
        speakWord(nextWord.word);
      }
      setTimeout(scrollToCardTop, 30);
    }
  };

  const handlePrev = () => {
    setIsFlipped(false);
    setShowExampleTranslation(false);
    stopSpeech();
    if (currentIndex > 0) {
      setCurrentIndex(prev => prev - 1);
      setTimeout(scrollToCardTop, 30);
    }
  };

  const handleFlip = () => {
    setIsFlipped(!isFlipped);
  };

  // Modern robust Text-to-Speech using configured TTS service
  const speakWord = (text: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();

    const code = getLanguageCode(targetLanguage);

    speakTextService(
      text,
      ttsConfig,
      llmConfig,
      code,
      () => setIsSpeaking(true),
      () => setIsSpeaking(false)
    );
  };

  const percentage = Math.round(((currentIndex + 1) / sortedWords.length) * 100);

  // Statistics for completion screen

  return (
    <div className="h-full overflow-y-auto p-2 sm:p-4 space-y-6 sm:space-y-8 max-w-3xl mx-auto w-full" id="flashcard-collection-view">
      {/* Collection Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-4 border-b border-stone-200">
        <div>
          <button 
            onClick={onGoBack}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-stone-500 hover:text-stone-900 transition-colors mb-2 cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> {t("flashcards_back_dash", appLanguage)}
          </button>
          <h2 className="text-2xl font-bold tracking-tight text-stone-900">Vocabulary</h2>
          <p className="text-xs text-stone-500 mt-1 font-serif italic">{sortedWords.length} {t("col_terms_count", appLanguage)}</p>
        </div>

        {/* Mode Toggle Button */}
        <div className="flex bg-stone-100 p-1 border border-stone-200" id="mode-selector">
          <button
            onClick={() => setViewMode("card")}
            className={`px-4 py-2 text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
              viewMode === "card" 
                ? "bg-white text-stone-900 border border-stone-200" 
                : "text-stone-500 hover:text-stone-900"
            }`}
          >
            <Layers className="w-3.5 h-3.5" /> {t("flashcards_card_mode", appLanguage)}
          </button>
          <button
            onClick={() => setViewMode("list")}
            className={`px-4 py-2 text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
              viewMode === "list" 
                ? "bg-white text-stone-900 border border-stone-200" 
                : "text-stone-500 hover:text-stone-900"
            }`}
          >
            <List className="w-3.5 h-3.5" /> {t("flashcards_list_mode", appLanguage)}
          </button>
        </div>
      </div>

      {/* Category Filter Pills and Sort Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-2 border-b border-stone-100" id="flashcard-filter-tabs">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => handleSelectFilter("all")}
            className={`px-3 py-1.5 text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
              filterCategory === "all"
                ? "bg-stone-900 text-white shadow-xs"
                : "bg-stone-100 hover:bg-stone-200 text-stone-700 border border-stone-200"
            }`}
          >
            <Filter className="w-3.5 h-3.5" /> All Words ({filterCounts.all})
          </button>

          <button
            onClick={() => handleSelectFilter("new")}
            className={`px-3 py-1.5 text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
              filterCategory === "new"
                ? "bg-amber-500 text-stone-950 shadow-xs"
                : "bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200"
            }`}
            title="Filter for newly added words that have not been studied yet (prioritized oldest to newest)"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-700 fill-amber-300" /> New / Unstudied ({filterCounts.new})
          </button>

          <button
            onClick={() => handleSelectFilter("due")}
            className={`px-3 py-1.5 text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
              filterCategory === "due"
                ? "bg-stone-900 text-white shadow-xs"
                : "bg-stone-100 hover:bg-stone-200 text-stone-700 border border-stone-200"
            }`}
            title="Filter for words scheduled for spaced repetition review"
          >
            <Clock className="w-3.5 h-3.5 text-stone-500" /> Due Review ({filterCounts.due})
          </button>

          <button
            onClick={() => handleSelectFilter("starred")}
            className={`px-3 py-1.5 text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
              filterCategory === "starred"
                ? "bg-stone-900 text-white shadow-xs"
                : "bg-stone-100 hover:bg-stone-200 text-stone-700 border border-stone-200"
            }`}
          >
            <Star className="w-3.5 h-3.5 fill-current text-amber-400" /> Starred ({filterCounts.starred})
          </button>
        </div>

        {/* Sort Order Selector */}
        <div className="flex items-center gap-1.5 self-end sm:self-auto text-xs" id="flashcard-sort-selector">
          <ArrowUpDown className="w-3.5 h-3.5 text-stone-400" />
          <select
            value={sortBy}
            onChange={(e) => {
              setSortBy(e.target.value as any);
              setCurrentIndex(0);
              setIsFlipped(false);
            }}
            className="bg-white border border-stone-200 text-stone-700 text-xs px-2.5 py-1 font-medium focus:outline-none focus:border-stone-900 cursor-pointer"
            title="Sort flashcard presentation order"
          >
            <option value="smart">Smart Backlog (Oldest Unstudied First)</option>
            <option value="oldest">Oldest Added First (FIFO)</option>
            <option value="newest">Newest Added First (LIFO)</option>
            <option value="alpha">Alphabetical (A–Z)</option>
          </select>
        </div>
      </div>

      {viewMode === "card" ? (
        <div className="space-y-8">
          {/* Progress Tracker */}
          <div className="bg-white px-6 py-4 border border-stone-200 flex items-center justify-between gap-4">
            <span className="text-xs font-semibold text-stone-500 font-mono">
              Word {currentIndex + 1} of {sortedWords.length}
            </span>
            <div className="flex-1 h-[2px] bg-stone-100 overflow-hidden">
              <div 
                className="h-full bg-stone-900 transition-all duration-300"
                style={{ width: `${percentage}%` }}
              />
            </div>
            <span className="text-xs font-semibold text-stone-900 font-mono">{percentage}%</span>
          </div>

          {/* Flashcard Animation */}
          <div ref={cardContainerRef} className="relative min-h-[400px] sm:min-h-[440px] w-full preserve-3d scroll-mt-4" id="flashcard-container">
            <AnimatePresence mode="wait">
              {currentWord && (
                <motion.div
                  key={currentWord.id}
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  transition={{ duration: 0.2 }}
                  className="w-full h-full relative cursor-pointer group flex flex-col"
                  onClick={handleFlip}
                >
                  {/* Card Shell */}
                  <div className="w-full min-h-[400px] sm:min-h-[440px] bg-white border border-stone-200 flex flex-col justify-between p-4 sm:p-6 relative">
                    
                    {/* Background Decorative Element */}
                    <div className="absolute -right-16 -top-16 w-32 h-32 rounded-full bg-stone-50 blur-2xl pointer-events-none" />

                    {/* Quick Star & Audio Indicators */}
                    <div className="flex justify-between items-center z-10">
                      <span className="text-xs font-semibold text-stone-500 font-mono">
                        {currentWord.partOfSpeech}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleStar(currentWord.id);
                          }}
                          className={`p-1.5 rounded-lg border transition-colors cursor-pointer shadow-2xs ${
                            currentWord.starred 
                              ? "text-amber-500 border-amber-300 bg-amber-50" 
                              : "text-stone-400 border-stone-200 hover:border-stone-400 bg-white"
                          }`}
                          title={currentWord.starred ? "Unstar word" : "Star word"}
                        >
                          <Star className="w-4 h-4 fill-current" />
                        </button>
                        <button
                          onClick={(e) => speakWord(currentWord.word, e)}
                          className={`p-1.5 rounded-lg border transition-all cursor-pointer shadow-2xs ${
                            isSpeaking 
                              ? "text-stone-950 bg-amber-400 border-amber-500" 
                              : "text-stone-600 border-stone-200 hover:border-stone-400 bg-white"
                          }`}
                          title="Listen Pronunciation"
                        >
                          <Volume2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* Word Display (Body) with Scroll Support */}
                    <div className="text-center py-2 my-auto flex flex-col items-center justify-center flex-1 w-full overflow-y-auto max-h-[300px] sm:max-h-[340px] pr-1 z-10">
                      <AnimatePresence mode="wait">
                        {!isFlipped ? (
                          <motion.div 
                            key="front"
                            initial={{ opacity: 0, y: 5 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -5 }}
                            className="space-y-4 my-auto"
                          >
                            <h3 className="text-4xl md:text-5xl font-bold tracking-tight text-stone-950 break-words max-w-full">
                              {currentWord.word}
                            </h3>
                            <p className="text-sm font-mono text-stone-400 italic break-words">
                              {currentWord.pronunciation}
                            </p>
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-stone-50 text-stone-500 border border-stone-200 text-xs font-medium mt-4">
                              <RefreshCw className="w-3 h-3 text-stone-400 animate-spin" /> {t("flashcards_click_flip", appLanguage)}
                            </span>
                          </motion.div>
                        ) : (
                          <motion.div 
                            key="back"
                            initial={{ opacity: 0, y: 5 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -5 }}
                            className="space-y-3 w-full my-auto"
                          >
                            <div className="space-y-1.5">
                              <span className="text-xs font-semibold text-stone-500 font-mono">{t("flashcards_meaning_trans", appLanguage)}</span>
                              <h4 className="text-xl sm:text-2xl font-bold text-stone-900 leading-tight font-serif italic break-words">
                                "{currentWord.translation}"
                              </h4>
                              <p className="text-xs sm:text-sm text-stone-600 max-w-md mx-auto leading-relaxed pt-0.5 font-sans">
                                {currentWord.definition}
                              </p>
                            </div>

                            <div 
                              className="bg-stone-50 p-3.5 border border-stone-200 text-left space-y-1.5 mt-2 max-h-48 overflow-y-auto"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-semibold text-stone-500 font-mono">{t("flashcards_example_usage", appLanguage)}</span>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  {currentWord.exampleTranslation && (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setShowExampleTranslation(prev => !prev);
                                      }}
                                      className={`p-1 rounded border transition-colors flex items-center justify-center cursor-pointer ${
                                        showExampleTranslation
                                          ? "bg-amber-100 text-amber-900 border-amber-300"
                                          : "bg-white hover:bg-stone-100 text-stone-500 hover:text-stone-800 border-stone-200"
                                      }`}
                                      title={showExampleTranslation ? "Hide translation" : "Show translation"}
                                    >
                                      <Languages className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={(e) => speakWord(currentWord.example, e)}
                                    className={`p-1 rounded border transition-colors flex items-center justify-center cursor-pointer ${
                                      isSpeaking
                                        ? "bg-amber-400 text-stone-950 border-amber-500"
                                        : "bg-white hover:bg-stone-100 text-stone-500 hover:text-stone-800 border-stone-200"
                                    }`}
                                    title="Listen to example sentence"
                                  >
                                    <Volume2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>
                              <p className="text-xs md:text-sm text-stone-800 font-serif italic leading-relaxed break-words">
                                "{currentWord.example}"
                              </p>
                              {currentWord.exampleTranslation && showExampleTranslation && (
                                <p className="text-xs text-stone-500 italic pt-1 border-t border-stone-200/80">
                                  "{currentWord.exampleTranslation}"
                                </p>
                              )}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>

                    {/* Bottom Word Display Area Buttons: Strength History & Word Details */}
                    <div className="flex items-center justify-center sm:justify-end gap-2 pt-2.5 pb-1 border-t border-stone-100 z-10">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedHistoryWord(currentWord);
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-stone-200 bg-stone-50/80 hover:bg-amber-50 hover:border-amber-300 text-stone-700 hover:text-amber-900 transition-all text-xs font-semibold shadow-2xs cursor-pointer active:scale-95"
                        title="View Strength History"
                      >
                        <History className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                        <span>Strength History</span>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedDetailsWord(currentWord);
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-stone-200 bg-stone-50/80 hover:bg-white hover:border-stone-400 text-stone-700 hover:text-stone-950 transition-all text-xs font-semibold shadow-2xs cursor-pointer active:scale-95"
                        title="View Word Details"
                      >
                        <BookOpen className="w-3.5 h-3.5 text-stone-600 shrink-0" />
                        <span>Word Details</span>
                      </button>
                    </div>



                    {/* Mastery Toggle */}
                    <div className="flex justify-between items-center z-10 pt-3 border-t border-stone-100 text-xs">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleLearned(currentWord.id);
                        }}
                        className={`inline-flex items-center gap-1.5 px-4 py-2 transition-all font-semibold text-xs cursor-pointer ${
                          currentWord.learned 
                            ? "bg-stone-900 text-white" 
                            : "bg-white text-stone-600 hover:border-stone-900 border border-stone-200"
                        }`}
                      >
                        {currentWord.learned ? (
                          <>
                            <Check className="w-3.5 h-3.5 stroke-[3]" /> {t("flashcards_mastered", appLanguage)}
                          </>
                        ) : (
                          <>
                            <CheckCircle className="w-3.5 h-3.5" /> {t("flashcards_mark_mastered", appLanguage)}
                          </>
                        )}
                      </button>
                      <span className="text-xs text-stone-500 font-mono font-medium flex items-center gap-1">
                        <HelpCircle className="w-3.5 h-3.5" /> {t("flashcards_click_flip", appLanguage)}
                      </span>
                    </div>

                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Navigation Controls */}
          <div className="flex justify-between items-center">
            <button
              onClick={handlePrev}
              disabled={currentIndex === 0}
              className="px-6 py-3 border border-stone-200 hover:border-stone-900 bg-white text-stone-700 font-semibold rounded-none disabled:opacity-30 disabled:hover:border-stone-200 transition-colors text-xs flex items-center gap-1.5 cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" /> {t("flashcards_previous", appLanguage)}
            </button>

            {currentIndex < sortedWords.length - 1 ? (
              <button
                onClick={handleNext}
                className="px-6 py-3 bg-stone-900 hover:bg-black text-white font-semibold rounded-none transition-all text-xs flex items-center gap-1.5 cursor-pointer"
              >
                {t("flashcards_next_word", appLanguage)} <ArrowRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                onClick={startPractice}
                className="px-6 py-3 bg-stone-950 hover:bg-black text-white font-semibold rounded-none transition-all text-xs flex items-center gap-1.5 cursor-pointer"
              >
                {t("flashcards_take_quiz", appLanguage)} <Trophy className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      ) : (
        /* List Mode View */
        <div className="bg-white border border-stone-200 overflow-hidden" id="collection-list-view">
          <div className="divide-y divide-stone-100">
            {sortedWords.map((w, idx) => (
              <div 
                key={w.id} 
                className="p-3.5 sm:p-6 hover:bg-stone-50/50 transition-all flex flex-col sm:flex-row sm:items-start justify-between gap-4 sm:gap-6"
              >
                <div className="space-y-2 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[10px] font-mono font-bold text-stone-900 bg-stone-100 px-2 py-0.5 border border-stone-200">
                      {idx + 1}
                    </span>
                    <h4 className="text-base font-bold text-stone-950">{w.word}</h4>
                    <span className="text-xs text-stone-400 font-mono italic">{w.pronunciation}</span>
                    <span className="text-xs text-stone-500 font-semibold bg-stone-50 px-2 py-0.5 border border-stone-200">
                      {w.partOfSpeech}
                    </span>
                  </div>
                  <p className="text-xs font-serif italic text-stone-700">
                    <span className="font-sans font-bold text-stone-500 text-xs not-italic mr-1">Meaning:</span> {w.translation}
                  </p>
                  <p className="text-xs text-stone-500 font-sans leading-relaxed">
                    <span className="font-bold text-stone-500 text-xs mr-1">Definition:</span> {w.definition}
                  </p>
                  {w.example && (
                    <div className="text-xs border-l-2 border-stone-900 pl-3 mt-2 py-1 bg-stone-50 space-y-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="italic text-stone-800 font-serif min-w-0 flex-1">"{w.example}"</p>
                        {w.exampleTranslation && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedListTranslations(prev => ({ ...prev, [w.id]: !prev[w.id] }));
                            }}
                            className={`p-1 rounded border transition-colors flex items-center justify-center cursor-pointer shrink-0 ${
                              expandedListTranslations[w.id]
                                ? "bg-amber-100 text-amber-900 border-amber-300"
                                : "bg-white hover:bg-stone-100 text-stone-500 hover:text-stone-800 border-stone-200"
                            }`}
                            title={expandedListTranslations[w.id] ? "Hide translation" : "Show translation"}
                          >
                            <Languages className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                      {w.exampleTranslation && expandedListTranslations[w.id] && (
                        <p className="italic text-stone-500 text-[11px] pt-1 border-t border-stone-200/70">
                          "{w.exampleTranslation}"
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* Star / Learn control row */}
                <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-start gap-3 pt-2 sm:pt-0">
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedHistoryWord(w);
                      }}
                      className="p-1.5 rounded-lg border border-stone-200 hover:border-amber-400 hover:bg-amber-50 text-stone-500 hover:text-amber-700 transition-colors cursor-pointer shadow-2xs"
                      title="View Strength History"
                    >
                      <History className="w-4 h-4 text-amber-600" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedDetailsWord(w);
                      }}
                      className="p-1.5 rounded-lg border border-stone-200 hover:border-stone-400 hover:bg-stone-100 text-stone-500 hover:text-stone-900 transition-colors cursor-pointer shadow-2xs bg-white"
                      title="View Word Details"
                    >
                      <BookOpen className="w-4 h-4 text-stone-600" />
                    </button>
                    <button
                      onClick={() => speakWord(w.word)}
                      className="p-1.5 rounded-lg border border-stone-200 hover:border-stone-400 text-stone-600 hover:text-stone-900 transition-colors cursor-pointer bg-white shadow-2xs"
                      title="Speak"
                    >
                      <Volume2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => onToggleStar(w.id)}
                      className={`p-1.5 rounded-lg border transition-colors cursor-pointer shadow-2xs ${
                        w.starred ? "text-amber-500 border-amber-300 bg-amber-50" : "text-stone-400 border-stone-200 hover:border-stone-400 bg-white"
                      }`}
                    >
                      <Star className="w-4 h-4 fill-current" />
                    </button>
                  </div>

                  <button
                    onClick={() => onToggleLearned(w.id)}
                    className={`text-xs font-semibold px-3 py-1 border transition-all cursor-pointer ${
                      w.learned 
                        ? "bg-stone-900 border-stone-900 text-white" 
                        : "bg-white text-stone-600 hover:border-stone-900 border-stone-200"
                    }`}
                  >
                    {w.learned ? "Mastered" : "Study"}
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="p-6 bg-stone-50 border-t border-stone-200 text-center">
            <button
              onClick={startPractice}
              className="inline-flex items-center gap-1.5 px-8 py-3 bg-stone-950 hover:bg-black text-white font-semibold rounded-none text-xs transition-all cursor-pointer"
            >
              Start Practice <Trophy className="w-4 h-4 text-white" />
            </button>
          </div>
        </div>
      )}

      {/* Strength History Modal */}
      <AnimatePresence>
        {selectedHistoryWord && (
          <StrengthHistoryModal
            word={selectedHistoryWord}
            onClose={() => setSelectedHistoryWord(null)}
            onUpdateWord={(updated) => {
              setSelectedHistoryWord(updated);
              if (onUpdateWords) {
                const nextWords = words.map((w) => (w.id === updated.id ? updated : w));
                onUpdateWords(nextWords);
              }
            }}
          />
        )}
      </AnimatePresence>

      {/* Word Details Modal */}
      <AnimatePresence>
        {selectedDetailsWord && (
          <WordDetailsModal
            word={selectedDetailsWord}
            isOpen={Boolean(selectedDetailsWord)}
            onClose={() => setSelectedDetailsWord(null)}
            ttsConfig={ttsConfig}
            llmConfig={llmConfig}
            targetLanguage={targetLanguage}
            appLanguage={appLanguage}
            onToggleStar={onToggleStar}
            onToggleLearned={onToggleLearned}
            onUpdateWord={(updated) => {
              setSelectedDetailsWord(updated);
              if (onUpdateWords) {
                const nextWords = words.map((w) => (w.id === updated.id ? updated : w));
                onUpdateWords(nextWords);
              }
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
