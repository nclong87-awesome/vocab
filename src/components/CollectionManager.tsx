import React, { useState, useMemo, useCallback, useEffect, useRef, useDeferredValue } from "react";
import { 
  BookOpen, 
  Search, 
  Grid, 
  List, 
  Globe2,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Zap
} from "lucide-react";
import { Word, LLMConfig, TTSConfig } from "../types";
import { speakText as speakTextService, DEFAULT_TTS_CONFIG } from "../utils/ttsService";
import { autofillWordService } from "../services/llmClientService";

import WordCard from "./deckManager/WordCard";
import WordRow from "./deckManager/WordRow";
import VirtualizedWordCollection from "./deckManager/VirtualizedWordCollection";
import { t } from "../config/i18n";

interface CollectionManagerProps {
  words: Word[];
  onAddWord?: (
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
  appLanguage?: string;
  onLlmApiError?: (err: any, currentConfig: LLMConfig, retryAction: (newConfig: LLMConfig) => void) => void;
}

function CollectionManager({
  words,
  onAddWord: _onAddWord,
  onDeleteWord,
  onToggleStar,
  onToggleLearned,
  onUpdateWords,
  llmConfig,
  ttsConfig = DEFAULT_TTS_CONFIG,
  targetLanguage = "English",
  nativeLanguage = "Vietnamese",
  appLanguage = "Vietnamese",
  onLlmApiError
}: CollectionManagerProps) {
  // Re-generate individual word loading states
  const [regeneratingWordId, setRegeneratingWordId] = useState<string | null>(null);
  const [regeneratedSuccessWordId, setRegeneratedSuccessWordId] = useState<string | null>(null);

  // UI layout, sort, and search states
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<"newest" | "oldest" | "alpha" | "unlearned">("newest");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [brokenImageIds, setBrokenImageIds] = useState<Set<string>>(new Set());

  // Handle image load errors gracefully
  const handleImageError = useCallback((wordId: string) => {
    setBrokenImageIds(prev => {
      const next = new Set(prev);
      next.add(wordId);
      return next;
    });
  }, []);

  // Speak word TTS
  const speakWord = useCallback((text: string) => {
    speakTextService(text, ttsConfig, llmConfig, targetLanguage);
  }, [ttsConfig, llmConfig, targetLanguage]);

  // Re-generate details for an existing word using AI
  const handleRegenerateWord = useCallback(async (word: Word, overrideConfig?: LLMConfig) => {
    const configToUse = overrideConfig || llmConfig;
    setRegeneratingWordId(word.id);
    setRegeneratedSuccessWordId(null);

    try {
      if (!configToUse) {
        throw new Error("No LLM configuration available.");
      }

      const details = await autofillWordService({
        word: word.word,
        category: word.category,
        context: word.context,
        hint: word.context || word.category,
        targetLanguage,
        nativeLanguage,
        cfg: configToUse
      });

      if (onUpdateWords) {
        const updatedWords = words.map(w => {
          if (w.id === word.id) {
            return {
              ...w,
              pronunciation: details.pronunciation || w.pronunciation,
              definition: details.definition || w.definition,
              translation: details.translation || w.translation,
              example: details.example || w.example,
              exampleTranslation: details.exampleTranslation || w.exampleTranslation
            };
          }
          return w;
        });

        onUpdateWords(updatedWords);

        setRegeneratedSuccessWordId(word.id);
        setTimeout(() => setRegeneratedSuccessWordId(null), 4000);
      }
    } catch (err: any) {
      console.error("Failed to re-generate word details:", err);
      if (onLlmApiError && configToUse) {
        onLlmApiError(err, configToUse, (newConfig) => handleRegenerateWord(word, newConfig));
      } else {
        alert("Unable to re-generate word details. Please verify your AI Key.");
      }
    } finally {
      setRegeneratingWordId(null);
    }
  }, [llmConfig, targetLanguage, nativeLanguage, onUpdateWords, words, onLlmApiError]);

  const wordsRef = useRef(words);
  wordsRef.current = words;

  const handleSingleWordUpdate = useCallback((updatedWord: Word) => {
    if (onUpdateWords) {
      const currentWords = wordsRef.current;
      const updatedWords = currentWords.map(w => w.id === updatedWord.id ? updatedWord : w);
      onUpdateWords(updatedWords);
    }
  }, [onUpdateWords]);

  const handleCardAddWord = useCallback((wText: string, hint?: string) => {
    _onAddWord?.({ word: wText, hint: hint || "" } as any);
  }, [_onAddWord]);

  const deferredSearchQuery = useDeferredValue(searchQuery);

  // Filter and sort words by search query and selected sort mode (defaults to newest first)
  const filteredWords = useMemo(() => {
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

    // Map words with original array index and pre-calculated timestamp
    let list = words.map((w, originalIndex) => ({
      word: w,
      originalIndex,
      timestamp: getWordTimestamp(w, originalIndex)
    }));

    if (deferredSearchQuery.trim()) {
      const q = deferredSearchQuery.toLowerCase().trim();
      list = list.filter(({ word: w }) => 
        w.word.toLowerCase().includes(q) ||
        w.translation.toLowerCase().includes(q) ||
        w.definition.toLowerCase().includes(q)
      );
    }

    list.sort((a, b) => {
      const tA = a.timestamp;
      const tB = b.timestamp;

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
  }, [words, deferredSearchQuery, sortBy]);

  // Pagination & Virtualization states
  const [isVirtualized, setIsVirtualized] = useState<boolean>(true);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [itemsPerPage, setItemsPerPage] = useState<number>(20);
  const topScrollRef = useRef<HTMLDivElement>(null);

  // Reset pagination to page 1 whenever search query, sort mode, or items per page changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, sortBy, itemsPerPage]);

  const totalFiltered = filteredWords.length;
  const isAllContinuous = itemsPerPage >= 999999;
  const totalPages = isAllContinuous ? 1 : Math.max(1, Math.ceil(totalFiltered / itemsPerPage));
  const validPage = Math.min(Math.max(1, currentPage), totalPages);

  const startIndex = totalFiltered === 0 ? 0 : (validPage - 1) * itemsPerPage;
  const endIndex = isAllContinuous ? totalFiltered : Math.min(startIndex + itemsPerPage, totalFiltered);

  const paginatedWords = useMemo(() => {
    if (isAllContinuous) {
      return filteredWords;
    }
    return filteredWords.slice(startIndex, endIndex);
  }, [filteredWords, isAllContinuous, startIndex, endIndex]);

  const handlePageChange = useCallback((newPage: number) => {
    const boundedPage = Math.min(Math.max(1, newPage), totalPages);
    setCurrentPage(boundedPage);
    if (topScrollRef.current) {
      topScrollRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [totalPages]);

  const renderPaginationBar = useCallback(() => {
    if (totalFiltered === 0) return null;

    return (
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-stone-50 p-3 border border-stone-200 text-xs my-1">
        {/* Summary Info */}
        <div className="flex items-center gap-2 text-stone-600 font-medium text-xs">
          {isAllContinuous ? (
            <span className="flex items-center gap-1.5 font-semibold text-stone-800">
              {isVirtualized && <Zap className="w-3.5 h-3.5 text-amber-600 fill-amber-500" />}
              <span>
                {t("col_page_showing", appLanguage, {
                  start: "1",
                  end: totalFiltered.toString(),
                  total: totalFiltered.toString(),
                })}
              </span>
              <span className="text-stone-500 font-normal">
                ({isVirtualized ? t("col_virtualized_on", appLanguage) : "Continuous"})
              </span>
            </span>
          ) : (
            <span>
              {t("col_page_showing", appLanguage, {
                start: (startIndex + 1).toString(),
                end: endIndex.toString(),
                total: totalFiltered.toString(),
              })}
            </span>
          )}
          {totalFiltered < words.length && (
            <span className="text-stone-400 font-mono text-[11px]">
              ({words.length} total)
            </span>
          )}
        </div>

        {/* Right Controls: Items Per Page & Page Navigation */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Items Per Page Select */}
          <div className="flex items-center gap-1.5 bg-white border border-stone-200 px-2 py-1 text-xs">
            <span className="text-[11px] font-bold text-stone-500 uppercase tracking-wider">
              {t("col_per_page", appLanguage)}
            </span>
            <select
              value={itemsPerPage}
              onChange={(e) => setItemsPerPage(Number(e.target.value))}
              className="font-bold text-stone-900 bg-transparent outline-none cursor-pointer"
            >
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={200}>200</option>
              <option value={999999}>{t("col_all_virtual", appLanguage)}</option>
            </select>
          </div>

          {/* Page Nav Buttons (hidden when showing all continuous) */}
          {!isAllContinuous && totalPages > 1 && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => handlePageChange(1)}
                disabled={validPage <= 1}
                title={t("col_first_page", appLanguage)}
                className="p-1.5 border bg-white border-stone-200 text-stone-700 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-stone-100 transition-colors cursor-pointer"
              >
                <ChevronsLeft className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => handlePageChange(validPage - 1)}
                disabled={validPage <= 1}
                title={t("col_prev_page", appLanguage)}
                className="p-1.5 border bg-white border-stone-200 text-stone-700 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-stone-100 transition-colors cursor-pointer"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>

              {/* Direct Page Select Dropdown */}
              <div className="flex items-center bg-white border border-stone-200 px-2 py-1">
                <select
                  value={validPage}
                  onChange={(e) => handlePageChange(Number(e.target.value))}
                  className="text-xs font-bold text-stone-900 bg-transparent outline-none cursor-pointer"
                >
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                    <option key={p} value={p}>
                      {p} / {totalPages}
                    </option>
                  ))}
                </select>
              </div>

              <button
                onClick={() => handlePageChange(validPage + 1)}
                disabled={validPage >= totalPages}
                title={t("col_next_page", appLanguage)}
                className="p-1.5 border bg-white border-stone-200 text-stone-700 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-stone-100 transition-colors cursor-pointer"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => handlePageChange(totalPages)}
                disabled={validPage >= totalPages}
                title={t("col_last_page", appLanguage)}
                className="p-1.5 border bg-white border-stone-200 text-stone-700 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-stone-100 transition-colors cursor-pointer"
              >
                <ChevronsRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }, [totalFiltered, isAllContinuous, isVirtualized, startIndex, endIndex, appLanguage, words.length, itemsPerPage, totalPages, validPage, handlePageChange]);

  return (
    <div className="space-y-8" id="collection-manager-container">
      <div ref={topScrollRef} />
      <div className="space-y-4">
        <div className="bg-white border border-stone-200 p-4 space-y-6 shadow-2xs">
            {/* Active List Title & Info */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-xs font-mono font-bold text-stone-500">
                  <Globe2 className="w-3.5 h-3.5 text-stone-900" />
                  <span>{targetLanguage} ↔ {nativeLanguage}</span>
                  <span className="text-stone-300">•</span>
                  <span className="text-stone-900">{words.length} {t("col_terms_count", appLanguage)}</span>
                </div>
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
                  placeholder={t("col_filter_placeholder", appLanguage)}
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
                  <span className="text-[11px] font-bold text-stone-500 uppercase tracking-wider hidden sm:inline">{t("col_sort_label", appLanguage)}</span>
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as "newest" | "oldest" | "alpha" | "unlearned")}
                    className="text-xs font-bold text-stone-900 bg-transparent outline-none cursor-pointer"
                  >
                    <option value="newest">{t("col_sort_newest", appLanguage)}</option>
                    <option value="oldest">{t("col_sort_oldest", appLanguage)}</option>
                    <option value="alpha">{t("col_sort_alpha", appLanguage)}</option>
                    <option value="unlearned">{t("col_sort_unlearned", appLanguage)}</option>
                  </select>
                </div>

                <div className="flex items-center gap-1 border-l border-stone-200 pl-2">
                  <button
                    onClick={() => setIsVirtualized(!isVirtualized)}
                    className={`px-2 py-1.5 border text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                      isVirtualized
                        ? "bg-amber-50 text-amber-900 border-amber-300 shadow-3xs"
                        : "bg-white text-stone-500 border-stone-200 hover:text-stone-900"
                    }`}
                    title={isVirtualized ? "react-window virtualized list rendering (peak performance for large vocabulary)" : "Standard DOM rendering"}
                  >
                    <Zap className={`w-3.5 h-3.5 ${isVirtualized ? "text-amber-600 fill-amber-500" : "text-stone-400"}`} />
                    <span className="hidden sm:inline">{isVirtualized ? t("col_virtualized_on", appLanguage) : t("col_virtualized_off", appLanguage)}</span>
                  </button>

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

            {/* Words Display Grid/List with Pagination or Virtualization */}
            {filteredWords.length > 0 ? (
              <div className="space-y-4">
                {renderPaginationBar()}

                {isVirtualized ? (
                  <VirtualizedWordCollection
                    words={paginatedWords}
                    viewMode={viewMode}
                    speakWord={speakWord}
                    handleRegenerateWord={handleRegenerateWord}
                    regeneratingWordId={regeneratingWordId}
                    regeneratedSuccessWordId={regeneratedSuccessWordId}
                    onToggleStar={onToggleStar}
                    onToggleLearned={onToggleLearned}
                    onDeleteWord={onDeleteWord}
                    brokenImageIds={brokenImageIds}
                    handleImageError={handleImageError}
                    onUpdateWord={handleSingleWordUpdate}
                    llmConfig={llmConfig}
                    targetLanguage={targetLanguage}
                    nativeLanguage={nativeLanguage}
                    ttsConfig={ttsConfig}
                    allWords={words}
                    onAddWord={_onAddWord ? handleCardAddWord : undefined}
                  />
                ) : viewMode === "grid" ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4" id="words-grid-container">
                    {paginatedWords.map((word) => (
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
                        onUpdateWord={handleSingleWordUpdate}
                        llmConfig={llmConfig}
                        targetLanguage={targetLanguage}
                        nativeLanguage={nativeLanguage}
                        ttsConfig={ttsConfig}
                        words={words}
                        onAddWord={_onAddWord ? handleCardAddWord : undefined}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="space-y-3" id="words-list-container">
                    {paginatedWords.map((word) => (
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
                        onUpdateWord={handleSingleWordUpdate}
                        llmConfig={llmConfig}
                        targetLanguage={targetLanguage}
                        nativeLanguage={nativeLanguage}
                        ttsConfig={ttsConfig}
                        words={words}
                        onAddWord={_onAddWord ? handleCardAddWord : undefined}
                      />
                    ))}
                  </div>
                )}

                {!isAllContinuous && totalPages > 1 && renderPaginationBar()}
              </div>
            ) : (
              <div className="p-12 text-center bg-stone-50 border border-stone-200 space-y-3">
                <BookOpen className="w-8 h-8 text-stone-400 mx-auto" />
                <h4 className="font-bold text-sm text-stone-900">{t("col_no_words_found", appLanguage)}</h4>
                <p className="text-xs text-stone-500 font-serif italic max-w-sm mx-auto">
                  {searchQuery ? t("col_empty_search", appLanguage) : t("col_empty_list", appLanguage)}
                </p>
              </div>
            )}
          </div>
        </div>
    </div>
  );
}

export default React.memo(CollectionManager);
