import React, { useState, useMemo, useEffect } from "react";
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
  Filter
} from "lucide-react";
import { Word, TTSConfig, LLMConfig } from "../types";
import { isWordEligibleForReview } from "../utils/spacedRepetition";
import { speakText as speakTextService, stopSpeech, DEFAULT_TTS_CONFIG, getLanguageCode } from "../utils/ttsService";
import { t } from "../config/i18n";

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
  appLanguage = "Vietnamese"
}: FlashcardsViewProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [viewMode, setViewMode] = useState<"card" | "list">("card");
  const [filterCategory, setFilterCategory] = useState<"all" | "new" | "due" | "starred">("all");

  const filterCounts = useMemo(() => {
    if (!words) return { all: 0, new: 0, due: 0, starred: 0 };
    const now = new Date();
    let newCount = 0;
    let dueCount = 0;
    let starredCount = 0;

    for (const w of words) {
      if (w.starred) starredCount++;
      if (!w.lastReviewed || (!w.learned && (w.strength ?? 0) === 0)) newCount++;
      else if (isWordEligibleForReview(w, now)) dueCount++;
    }

    return { all: words.length, new: newCount, due: dueCount, starred: starredCount };
  }, [words]);

  const sortedWords = useMemo(() => {
    if (!words || words.length === 0) return [];

    const now = new Date();
    let subset = [...words];

    if (filterCategory === "new") {
      subset = subset.filter(w => !w.lastReviewed || (!w.learned && (w.strength ?? 0) === 0));
    } else if (filterCategory === "due") {
      subset = subset.filter(w => isWordEligibleForReview(w, now));
    } else if (filterCategory === "starred") {
      subset = subset.filter(w => w.starred);
    }

    const list = subset.map((w, originalIndex) => ({ word: w, originalIndex }));
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
      if (tA !== tB) return tB - tA;
      return b.originalIndex - a.originalIndex;
    });
    return list.map(item => item.word);
  }, [words, filterCategory]);

  const handleSelectFilter = (category: "all" | "new" | "due" | "starred") => {
    setFilterCategory(category);
    setCurrentIndex(0);
    setIsFlipped(false);
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
    stopSpeech();
    if (currentIndex < sortedWords.length - 1) {
      const nextIdx = currentIndex + 1;
      setCurrentIndex(nextIdx);
      const nextWord = sortedWords[nextIdx];
      if (nextWord && nextWord.word && (ttsConfig?.autoPlayAudioInChat ?? ttsConfig?.autoPlayAudioInQuiz ?? true)) {
        speakWord(nextWord.word);
      }
    }
  };

  const handlePrev = () => {
    setIsFlipped(false);
    stopSpeech();
    if (currentIndex > 0) {
      setCurrentIndex(prev => prev - 1);
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

      {/* Category Filter Pills (All, New/Unstudied, Due Review, Starred) */}
      <div className="flex flex-wrap items-center gap-2 pb-2 border-b border-stone-100" id="flashcard-filter-tabs">
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
          title="Filter for newly added words that have not been studied yet"
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
          <div className="relative min-h-[400px] sm:min-h-[440px] w-full preserve-3d" id="flashcard-container">
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
                      <div className="flex gap-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleStar(currentWord.id);
                          }}
                          className={`p-2 border transition-colors cursor-pointer ${
                            currentWord.starred 
                              ? "text-stone-900 border-stone-900 bg-stone-50" 
                              : "text-stone-400 border-stone-200 hover:border-stone-900"
                          }`}
                        >
                          <Star className="w-4 h-4 fill-current" />
                        </button>
                        <button
                          onClick={(e) => speakWord(currentWord.word, e)}
                          className={`p-2 border transition-all cursor-pointer ${
                            isSpeaking 
                              ? "text-stone-900 bg-stone-100 border-stone-900 scale-100" 
                              : "text-stone-400 border-stone-200 hover:border-stone-900"
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
                            <h3 className="text-4xl md:text-5xl font-bold tracking-tight text-stone-950">
                              {currentWord.word}
                            </h3>
                            <p className="text-sm font-mono text-stone-400 italic">
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
                              <h4 className="text-xl sm:text-2xl font-bold text-stone-900 leading-tight font-serif italic">
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
                              <span className="text-xs font-semibold text-stone-500 font-mono">{t("flashcards_example_usage", appLanguage)}</span>
                              <p className="text-xs md:text-sm text-stone-800 font-serif italic leading-relaxed">
                                "{currentWord.example}"
                              </p>
                              <p className="text-xs text-stone-500 italic">
                                "{currentWord.exampleTranslation}"
                              </p>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
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
                  <div className="text-xs border-l-2 border-stone-900 pl-3 mt-2 py-1 bg-stone-50">
                    <p className="italic text-stone-800 font-serif">"{w.example}"</p>
                    <p className="italic text-stone-400 text-[11px] mt-0.5">"{w.exampleTranslation}"</p>
                  </div>
                </div>

                {/* Star / Learn control row */}
                <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-start gap-3 pt-2 sm:pt-0">
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => speakWord(w.word)}
                      className="p-1.5 border border-stone-200 hover:border-stone-900 text-stone-400 hover:text-stone-900 transition-colors cursor-pointer"
                      title="Speak"
                    >
                      <Volume2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => onToggleStar(w.id)}
                      className={`p-1.5 border transition-colors cursor-pointer ${
                        w.starred ? "text-stone-900 border-stone-900 bg-stone-50" : "text-stone-400 border-stone-200 hover:border-stone-900"
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
    </div>
  );
}
