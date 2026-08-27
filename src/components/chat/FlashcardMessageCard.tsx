import React, { useState, useMemo, useRef, useEffect } from "react";
import { AnimatePresence } from "motion/react";
import { 
  Volume2, 
  ChevronLeft, 
  ChevronRight, 
  Layers, 
  LayoutGrid,
  History,
  Languages,
  BookOpen
} from "lucide-react";
import { FlashcardData, FlashcardItem, SuggestedPairedWord, TTSConfig, LLMConfig, Word } from "../../types";
import { getProviderBadgeStyle, formatResponseTime } from "../../utils/llmHelpers";
import { speakText, stopSpeech, getLanguageCode } from "../../utils/ttsService";
import { t } from "../../config/i18n";
import { areWordsEquivalent } from "../../utils/wordNormalization";
import StrengthHistoryModal from "../analytics/StrengthHistoryModal";
import WordDetailsModal from "../deckManager/WordDetailsModal";

interface FlashcardMessageCardProps {
  data: FlashcardData;
  targetLanguage: string;
  nativeLanguage: string;
  appLanguage?: string;
  ttsConfig: TTSConfig;
  llmConfig: LLMConfig;
  provider?: string;
  model?: string;
  responseTimeMs?: number;
  words?: Word[];
  onUpdateWords?: (updatedWords: Word[]) => void;
  onAddWord?: (word: string, hint?: string) => void;
  onAddMultipleWords?: (words: { word: string; translation?: string; definition?: string }[]) => void;
  showToast?: (msg: string) => void;
}

function normalizeSuggestedWords(rawList?: (string | SuggestedPairedWord)[]): SuggestedPairedWord[] {
  if (!rawList || !Array.isArray(rawList)) return [];
  return rawList.map((item) => {
    if (typeof item === "string") {
      return {
        word: item,
        translation: "",
        relationship: "Collocation"
      };
    }
    return {
      word: item.word || "",
      translation: item.translation || "",
      relationship: item.relationship || item.partOfSpeech || "Collocation",
      hint: item.hint
    };
  }).filter((item) => Boolean(item.word));
}

function FlashcardMessageCard({
  data,
  targetLanguage,
  nativeLanguage,
  appLanguage,
  ttsConfig,
  llmConfig,
  provider,
  model,
  responseTimeMs,
  words,
  onUpdateWords
}: FlashcardMessageCardProps) {
  const [speakingText, setSpeakingText] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [viewMode, setViewMode] = useState<"deck" | "grid">("deck");
  const [selectedHistoryWord, setSelectedHistoryWord] = useState<Word | null>(null);
  const [selectedDetailsWord, setSelectedDetailsWord] = useState<Word | null>(null);
  const [expandedTranslations, setExpandedTranslations] = useState<Record<string, boolean>>({});
  const cardContainerRef = useRef<HTMLDivElement>(null);

  const toggleTranslation = (key: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setExpandedTranslations((prev) => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  const currentAppLang = appLanguage || localStorage.getItem("vocab_learner_app_lang") || nativeLanguage || "en";

  const getWordObjectForCard = (card: FlashcardItem): Word => {
    const matched = (words || []).find(
      (w) => (card.wordId && w.id === card.wordId) || areWordsEquivalent(w.word, card.word)
    );
    if (matched) return matched;
    return {
      id: card.wordId || `temp-${card.word}`,
      word: card.word,
      translation: card.translation || "",
      definition: card.definition || "",
      partOfSpeech: card.partOfSpeech || "noun",
      pronunciation: card.pronunciation || "",
      example: card.example || "",
      exampleTranslation: card.exampleTranslation || "",
      category: card.category || "General",
      context: card.context || "",
      starred: false,
      learned: false,
      createdAt: new Date().toISOString(),
      lastReviewed: null,
      strength: 0,
      strengthHistory: []
    };
  };

  const handleModalWordUpdate = (updated: Word) => {
    setSelectedHistoryWord(updated);
    if (onUpdateWords && words) {
      const nextWords = words.map((w) => (w.id === updated.id ? updated : w));
      onUpdateWords(nextWords);
    }
  };

  // Normalize data to always produce an array of up to 5 FlashcardItems
  const cards: FlashcardItem[] = useMemo(() => {
    if (!data) return [];
    if (data.cards && Array.isArray(data.cards) && data.cards.length > 0) {
      return data.cards.map((c) => ({
        ...c,
        suggestedWords: normalizeSuggestedWords(c.suggestedWords)
      }));
    }
    if (data.word) {
      const topSuggested: SuggestedPairedWord[] = (data.suggestedWords && data.suggestedWords.length > 0)
        ? normalizeSuggestedWords(data.suggestedWords).slice(0, 3)
        : (data.suggestedVocabulary || []).slice(0, 3).map((v: any) => ({
            word: v.word,
            translation: v.translation,
            relationship: v.partOfSpeech || "Collocation"
          }));

      return [{
        wordId: data.wordId,
        word: data.word,
        pronunciation: data.pronunciation,
        partOfSpeech: data.partOfSpeech,
        definition: data.definition || "",
        translation: data.translation || "",
        example: data.example || (data.extraExampleSentences && data.extraExampleSentences[0]?.sentence) || "",
        exampleTranslation: data.exampleTranslation || (data.extraExampleSentences && data.extraExampleSentences[0]?.translation) || "",
        category: data.category,
        context: data.context,
        suggestedWords: topSuggested
      }];
    }
    return [];
  }, [data]);

  if (!cards || cards.length === 0) return null;

  const currentCard = cards[Math.min(currentIndex, cards.length - 1)] || cards[0];

  const handleSpeak = (textToSpeak: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!textToSpeak) return;
    const langCode = getLanguageCode(targetLanguage);
    speakText(
      textToSpeak,
      ttsConfig,
      llmConfig,
      langCode,
      () => setSpeakingText(textToSpeak),
      () => setSpeakingText(null)
    );
  };

  const scrollToCardTop = () => {
    if (cardContainerRef.current) {
      try {
        cardContainerRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
      } catch {
        cardContainerRef.current.scrollIntoView();
      }
    }
  };

  // Stop any playing audio when card unmounts
  useEffect(() => {
    return () => {
      stopSpeech();
    };
  }, []);

  const handlePrevious = () => {
    if (currentIndex <= 0) return;
    stopSpeech();
    setCurrentIndex((prev) => Math.max(0, prev - 1));
    setTimeout(scrollToCardTop, 30);
  };

  const handleNext = () => {
    if (currentIndex >= cards.length - 1) return;
    stopSpeech();
    const nextIndex = Math.min(cards.length - 1, currentIndex + 1);
    setCurrentIndex(nextIndex);
    const nextCard = cards[nextIndex];
    if (nextCard && nextCard.word && (ttsConfig?.autoPlayAudioInChat ?? ttsConfig?.autoPlayAudioInQuiz ?? true)) {
      handleSpeak(nextCard.word);
    }
    setTimeout(scrollToCardTop, 30);
  };

  return (
    <div ref={cardContainerRef} className="bg-white border border-stone-200/90 rounded-2xl overflow-hidden my-2 max-w-full font-sans shadow-xs transition-all scroll-mt-4">
      {/* Deck Header Bar */}
      <div className="bg-stone-900 text-white px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-6 h-6 rounded-lg bg-amber-400 text-stone-950 flex items-center justify-center font-bold text-xs shrink-0 shadow-2xs">
            🃏
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold tracking-wide uppercase text-amber-300">
                Flashcard Deck
              </span>
              <span className="text-[10px] font-mono bg-stone-800 text-stone-300 px-2 py-0.5 rounded-full border border-stone-700">
                {cards.length} {cards.length === 1 ? "Word" : "Words"}
              </span>
            </div>
          </div>
        </div>

        {/* View Mode Switcher */}
        <div className="flex items-center gap-1 bg-stone-800 p-0.5 rounded-lg border border-stone-700/80">
          <button
            type="button"
            onClick={() => setViewMode("deck")}
            className={`px-2.5 py-1 rounded-md text-[11px] font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
              viewMode === "deck"
                ? "bg-amber-400 text-stone-950 shadow-2xs"
                : "text-stone-300 hover:text-white"
            }`}
            title="Step by step deck mode"
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Deck</span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode("grid")}
            className={`px-2.5 py-1 rounded-md text-[11px] font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
              viewMode === "grid"
                ? "bg-amber-400 text-stone-950 shadow-2xs"
                : "text-stone-300 hover:text-white"
            }`}
            title="View all cards in grid"
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            <span>All ({cards.length})</span>
          </button>
        </div>
      </div>

      {/* MODE 1: DECK VIEW (Card by card navigation) */}
      {viewMode === "deck" && (
        <div className="p-3 sm:p-4 space-y-3">
          {/* Active Card Body */}
          <div className="bg-stone-50/70 border border-stone-200/80 rounded-2xl p-4 sm:p-5 space-y-3.5 shadow-2xs">
            {/* Word Heading, Part of Speech, Pronunciation, Audio */}
            <div className="flex items-start justify-between gap-2.5">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-2 flex-wrap min-w-0">
                  <h3 className="text-2xl sm:text-3xl font-extrabold text-stone-900 tracking-tight break-words max-w-full leading-tight">
                    {currentCard.word}
                  </h3>
                  {currentCard.partOfSpeech && (
                    <span className="px-2 py-0.5 text-xs font-bold uppercase tracking-wider bg-amber-100 text-amber-900 border border-amber-200 rounded-md shrink-0">
                      {currentCard.partOfSpeech}
                    </span>
                  )}
                  {currentCard.category && (
                    <span className="bg-stone-200/80 text-stone-700 text-[10px] font-semibold px-2 py-0.5 rounded-md truncate max-w-[160px] sm:max-w-xs">
                      {currentCard.category}
                    </span>
                  )}
                </div>

                {currentCard.pronunciation && (
                  <p className="text-xs sm:text-sm font-mono font-semibold text-amber-700 break-words">
                    {currentCard.pronunciation}
                  </p>
                )}
              </div>

              {/* Action buttons: Speaker only (History moved to bottom) */}
              <div className="flex items-center gap-1.5 shrink-0 self-start pt-0.5">
                <button
                  type="button"
                  onClick={(e) => handleSpeak(currentCard.word, e)}
                  className={`p-1.5 sm:p-2 rounded-lg border transition-colors cursor-pointer shadow-2xs flex items-center justify-center shrink-0 ${
                    speakingText === currentCard.word
                      ? "bg-amber-400 border-amber-500 text-stone-950 scale-105 ring-2 ring-amber-300"
                      : "bg-white border-stone-200 text-stone-700 hover:bg-stone-100 hover:text-stone-950"
                  }`}
                  title={`Listen to "${currentCard.word}" pronunciation`}
                >
                  <Volume2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Translation & Definition */}
            <div className="bg-white p-3.5 rounded-xl border border-stone-200/70 space-y-2">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-stone-400 block mb-0.5">
                  {t("fc_native_translation", currentAppLang, { nativeLanguage })}
                </span>
                <p className="text-base sm:text-lg font-bold text-stone-900 break-words">
                  "{currentCard.translation}"
                </p>
              </div>

              {currentCard.definition && (
                <div className="pt-1.5 border-t border-stone-100">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-stone-400 block mb-0.5">
                    {t("fc_definition_header", currentAppLang, { targetLanguage })}
                  </span>
                  <p className="text-xs sm:text-sm text-stone-700 font-medium leading-relaxed">
                    {currentCard.definition}
                  </p>
                </div>
              )}
            </div>

            {/* 1 Example Sentence */}
            {currentCard.example && (() => {
              const cardKey = currentCard.wordId || currentCard.word || String(currentIndex);
              const isTranslationOpen = Boolean(expandedTranslations[cardKey]);
              return (
                <div className="bg-white border border-stone-200/70 rounded-xl p-3.5 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700">
                      Example Sentence
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {currentCard.exampleTranslation && (
                        <button
                          type="button"
                          onClick={(e) => toggleTranslation(cardKey, e)}
                          className={`p-1.5 rounded-lg border transition-colors cursor-pointer shrink-0 ${
                            isTranslationOpen
                              ? "bg-amber-100 text-amber-900 border-amber-300 shadow-2xs"
                              : "bg-white hover:bg-stone-100 text-stone-500 hover:text-stone-800 border-stone-200"
                          }`}
                          title={isTranslationOpen ? "Hide sentence translation" : "Show sentence translation"}
                        >
                          <Languages className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={(e) => handleSpeak(currentCard.example!, e)}
                        className={`p-1.5 rounded-lg border transition-colors cursor-pointer shrink-0 ${
                          speakingText === currentCard.example
                            ? "bg-amber-400 border-amber-500 text-stone-950 shadow-2xs"
                            : "bg-white hover:bg-stone-100 text-stone-500 hover:text-stone-800 border-stone-200"
                        }`}
                        title="Listen to example sentence"
                      >
                        <Volume2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <p className="text-xs sm:text-sm font-semibold text-stone-900 leading-snug break-words">
                    {currentCard.example}
                  </p>

                  {currentCard.exampleTranslation && isTranslationOpen && (
                    <div className="pt-2 border-t border-stone-100">
                      <p className="text-xs text-stone-600 font-medium italic">
                        "{currentCard.exampleTranslation}"
                      </p>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Bottom Word Display Area Buttons: Strength History & Word Details */}
            <div className="flex items-center justify-end gap-2 pt-2.5 border-t border-stone-200/70">
              <button
                type="button"
                onClick={() => setSelectedHistoryWord(getWordObjectForCard(currentCard))}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-stone-200 bg-white hover:bg-amber-50 hover:border-amber-300 text-stone-700 hover:text-amber-900 transition-colors text-xs font-semibold shadow-2xs cursor-pointer active:scale-95"
                title={`View Strength History for "${currentCard.word}"`}
              >
                <History className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                <span>Strength History</span>
              </button>
              <button
                type="button"
                onClick={() => setSelectedDetailsWord(getWordObjectForCard(currentCard))}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-stone-200 bg-white hover:bg-stone-100 hover:border-stone-400 text-stone-700 hover:text-stone-950 transition-colors text-xs font-semibold shadow-2xs cursor-pointer active:scale-95"
                title={`View Word Details for "${currentCard.word}"`}
              >
                <BookOpen className="w-3.5 h-3.5 text-stone-600 shrink-0" />
                <span>Word Details</span>
              </button>
            </div>
          </div>

          {/* Stepper Navigation Footer */}
          <div className="grid grid-cols-3 gap-2 pt-1 w-full">
            <button
              type="button"
              onClick={handlePrevious}
              disabled={currentIndex === 0}
              className={`w-full py-2.5 px-2 rounded-xl font-bold text-xs flex items-center justify-center gap-1 transition-all cursor-pointer min-w-0 ${
                currentIndex === 0
                  ? "bg-stone-100 text-stone-400 cursor-not-allowed"
                  : "bg-white border border-stone-200 hover:bg-stone-50 text-stone-800 shadow-2xs active:scale-98"
              }`}
            >
              <ChevronLeft className="w-4 h-4 shrink-0" />
              <span className="truncate">Previous</span>
            </button>

            <button
              type="button"
              onClick={() => handleSpeak(currentCard.word)}
              className="w-full py-2.5 px-2 bg-stone-100 hover:bg-stone-200 text-stone-800 font-semibold text-xs rounded-xl transition-all flex items-center justify-center gap-1 cursor-pointer min-w-0 active:scale-98"
              title="Speak word"
            >
              <Volume2 className="w-4 h-4 text-amber-600 shrink-0" />
              <span className="truncate">Pronounce</span>
            </button>

            <button
              type="button"
              onClick={handleNext}
              disabled={currentIndex === cards.length - 1}
              className={`w-full py-2.5 px-2 rounded-xl font-bold text-xs flex items-center justify-center gap-1 transition-all cursor-pointer min-w-0 ${
                currentIndex === cards.length - 1
                  ? "bg-stone-100 text-stone-400 cursor-not-allowed"
                  : "bg-stone-900 hover:bg-stone-800 text-amber-300 shadow-2xs active:scale-98"
              }`}
            >
              <span className="truncate">Next</span>
              <ChevronRight className="w-4 h-4 shrink-0" />
            </button>
          </div>
        </div>
      )}

      {/* MODE 2: GRID VIEW (View all 5 cards simultaneously) */}
      {viewMode === "grid" && (
        <div className="p-3 sm:p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {cards.map((card, cIdx) => {
              const gridCardKey = card.wordId || card.word || `grid-${cIdx}`;
              const isGridTranslationOpen = Boolean(expandedTranslations[gridCardKey]);
              return (
                <div
                  key={cIdx}
                  className="bg-stone-50/80 border border-stone-200 hover:border-amber-300/80 rounded-xl p-3.5 space-y-2.5 transition-all shadow-2xs flex flex-col justify-between"
                >
                  {/* Header info */}
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                          <span className="text-[10px] font-mono font-bold bg-stone-200 text-stone-700 px-1.5 py-0.2 rounded shrink-0">
                            #{cIdx + 1}
                          </span>
                          <h4 className="text-lg font-bold text-stone-900 break-words">
                            {card.word}
                          </h4>
                          {card.partOfSpeech && (
                            <span className="text-[10px] font-bold uppercase bg-amber-100 text-amber-900 px-1.5 py-0.2 rounded shrink-0">
                              {card.partOfSpeech}
                            </span>
                          )}
                        </div>
                        {card.pronunciation && (
                          <p className="text-xs font-mono text-amber-700 mt-0.5 break-words">
                            {card.pronunciation}
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={(e) => handleSpeak(card.word, e)}
                          className={`p-1.5 rounded-lg shrink-0 cursor-pointer shadow-2xs transition-colors border ${
                            speakingText === card.word
                              ? "bg-amber-400 border-amber-500 text-stone-950"
                              : "bg-white border-stone-200 text-stone-700 hover:bg-stone-100"
                          }`}
                          title={`Listen to ${card.word}`}
                        >
                          <Volume2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Translation & Definition */}
                    <div className="bg-white p-2.5 rounded-lg border border-stone-200/60 space-y-1">
                      <p className="text-sm font-bold text-stone-900 break-words">
                        "{card.translation}"
                      </p>
                      {card.definition && (
                        <p className="text-xs text-stone-600 line-clamp-2">
                          {card.definition}
                        </p>
                      )}
                    </div>

                    {/* Example */}
                    {card.example && (
                      <div className="bg-white p-2.5 rounded-lg border border-stone-200/60 space-y-1">
                        <div className="flex items-start justify-between gap-1">
                          <p className="text-xs font-semibold text-stone-800 line-clamp-2 min-w-0 flex-1">
                            {card.example}
                          </p>
                          <div className="flex items-center gap-1 shrink-0">
                            {card.exampleTranslation && (
                              <button
                                type="button"
                                onClick={(e) => toggleTranslation(gridCardKey, e)}
                                className={`p-1 rounded border transition-colors flex items-center justify-center cursor-pointer ${
                                  isGridTranslationOpen
                                    ? "bg-amber-100 text-amber-900 border-amber-300"
                                    : "bg-white hover:bg-stone-100 text-stone-500 hover:text-stone-800 border-stone-200"
                                }`}
                                title={isGridTranslationOpen ? "Hide translation" : "Show translation"}
                              >
                                <Languages className="w-3.5 h-3.5" />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={(e) => handleSpeak(card.example!, e)}
                              className={`p-1 rounded border transition-colors flex items-center justify-center cursor-pointer ${
                                speakingText === card.example
                                  ? "bg-amber-400 text-stone-950 border-amber-500"
                                  : "bg-white hover:bg-stone-100 text-stone-500 hover:text-stone-800 border-stone-200"
                              }`}
                              title="Listen to example"
                            >
                              <Volume2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                        {card.exampleTranslation && isGridTranslationOpen && (
                          <p className="text-[11px] text-stone-600 italic pt-1 border-t border-stone-100">
                            "{card.exampleTranslation}"
                          </p>
                        )}
                      </div>
                    )}

                    {/* Bottom Word Display Area Buttons: Strength History & Word Details */}
                    <div className="flex items-center justify-end gap-1.5 pt-2 border-t border-stone-200/60">
                      <button
                        type="button"
                        onClick={() => setSelectedHistoryWord(getWordObjectForCard(card))}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-stone-200 bg-white hover:bg-amber-50 hover:border-amber-300 text-stone-700 hover:text-amber-900 transition-colors text-[11px] font-semibold shadow-2xs cursor-pointer active:scale-95"
                        title={`View Strength History for "${card.word}"`}
                      >
                        <History className="w-3 h-3 text-amber-600 shrink-0" />
                        <span>History</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedDetailsWord(getWordObjectForCard(card))}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-stone-200 bg-white hover:bg-stone-100 hover:border-stone-400 text-stone-700 hover:text-stone-950 transition-colors text-[11px] font-semibold shadow-2xs cursor-pointer active:scale-95"
                        title={`View Word Details for "${card.word}"`}
                      >
                        <BookOpen className="w-3 h-3 text-stone-600 shrink-0" />
                        <span>Details</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* AI Metadata Footer */}
      {(provider || model || responseTimeMs !== undefined) && (
        <div className="px-4 py-2 bg-stone-50/80 border-t border-stone-100 flex items-center justify-between text-[11px] select-none gap-1.5 flex-nowrap whitespace-nowrap min-w-0 w-full overflow-hidden">
          <div className="flex items-center gap-1.5 flex-nowrap min-w-0 overflow-hidden shrink">
            {provider && (() => {
              const style = getProviderBadgeStyle(provider);
              return (
                <span className={`text-[10px] px-2 py-0.5 rounded-md border shadow-2xs font-semibold shrink-0 ${style.bg} ${style.text} ${style.border}`}>
                  {style.label}
                </span>
              );
            })()}
            {model && (
              <span className="font-mono text-[10.5px] text-stone-600 font-medium bg-white px-1.5 py-0.5 rounded border border-stone-200/60 truncate min-w-0 max-w-[130px] sm:max-w-[220px]" title={model}>
                {model}
              </span>
            )}
          </div>
          {responseTimeMs !== undefined && (() => {
            const rt = formatResponseTime(responseTimeMs);
            return (
              <div 
                className={`flex items-center gap-1 shrink-0 text-[10.5px] px-2 py-0.5 rounded-md border shadow-2xs font-mono ${rt.style}`}
                title={`AI Response Time: ${responseTimeMs}ms (${rt.badgeText})`}
              >
                <span>{rt.icon}</span>
                <span>{rt.text}</span>
              </div>
            );
          })()}
        </div>
      )}

      {/* Strength History Modal */}
      <AnimatePresence>
        {selectedHistoryWord && (
          <StrengthHistoryModal
            word={selectedHistoryWord}
            onClose={() => setSelectedHistoryWord(null)}
            onUpdateWord={handleModalWordUpdate}
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
            appLanguage={currentAppLang}
            onUpdateWord={(updated) => {
              setSelectedDetailsWord(updated);
              handleModalWordUpdate(updated);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

export default React.memo(FlashcardMessageCard);
