import React, { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { 
  Search, 
  X, 
  Volume2, 
  Sparkles, 
  BookOpen, 
  Star, 
  ArrowUpRight, 
  Plus, 
  CheckCircle2,
  Clock,
  MessageSquare,
  History,
  Trash2
} from "lucide-react";
import { Word, TTSConfig, LLMConfig } from "../../types";
import { searchWordsSmart, WordSearchFilter, removeAccents, checkFuzzyMatch } from "../../utils/smartWordSearch";
import { speakText, DEFAULT_TTS_CONFIG } from "../../utils/ttsService";
import { t } from "../../config/i18n";

export interface WordSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  words: Word[];
  targetLanguage: string;
  nativeLanguage: string;
  appLanguage?: string;
  ttsConfig?: TTSConfig;
  llmConfig?: LLMConfig;
  onOpenWordChat?: (word: Word) => void;
  onOpenWordDetails?: (word: Word) => void;
  onInsertToChat?: (text: string) => void;
  onSendMessage?: (text: string) => Promise<void>;
  onAddWord?: (word?: string, hint?: string, extraData?: Partial<Word>) => void;
  onToggleStarWord?: (wordId: string) => void;
  onToast?: (msg: string) => void;
}

const RECENT_SEARCHES_KEY = "vocab_recent_word_searches";

export default function WordSearchModal({
  isOpen,
  onClose,
  words,
  targetLanguage,
  nativeLanguage,
  appLanguage = "vi",
  ttsConfig = DEFAULT_TTS_CONFIG,
  llmConfig,
  onOpenWordChat,
  onOpenWordDetails,
  onInsertToChat,
  onSendMessage,
  onAddWord,
  onToggleStarWord,
  onToast,
}: WordSearchModalProps) {
  const [query, setQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<WordSearchFilter>("all");
  const [recentSearches, setRecentSearches] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(RECENT_SEARCHES_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 60);
    }
  }, [isOpen]);

  // Global ESC key listener
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const saveRecentSearch = useCallback((term: string) => {
    const trimmed = term.trim();
    if (!trimmed) return;
    setRecentSearches(prev => {
      const filtered = prev.filter(t => t.toLowerCase() !== trimmed.toLowerCase());
      const updated = [trimmed, ...filtered].slice(0, 6);
      try {
        localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));
      } catch (err) {
        console.error("Failed to save recent search", err);
      }
      return updated;
    });
  }, []);

  const clearRecentSearches = useCallback(() => {
    setRecentSearches([]);
    try {
      localStorage.removeItem(RECENT_SEARCHES_KEY);
    } catch (err) {
      console.error("Failed to clear recent searches", err);
    }
  }, []);

  // Compute stats counts for filter badges
  const stats = useMemo(() => {
    let starredCount = 0;
    let reviewCount = 0;
    let masteredCount = 0;

    for (const w of words) {
      if (w.starred) starredCount++;
      if (Boolean(w.learned) || (w.strength !== undefined && w.strength >= 80)) {
        masteredCount++;
      } else {
        reviewCount++;
      }
    }

    return {
      total: words.length,
      starredCount,
      reviewCount,
      masteredCount,
    };
  }, [words]);

  // Execute smart search
  const searchResults = useMemo(() => {
    return searchWordsSmart(words, query, activeFilter);
  }, [words, query, activeFilter]);

  const parentRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: searchResults.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 140,
    overscan: 6,
  });

  // Reset scroll position on query or filter change
  useEffect(() => {
    if (parentRef.current) {
      parentRef.current.scrollTop = 0;
    }
  }, [query, activeFilter]);

  const handleSpeakWord = useCallback((wText: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    speakText(wText, ttsConfig, llmConfig, targetLanguage);
  }, [ttsConfig, llmConfig, targetLanguage]);

  const handleSelectWordDetails = useCallback((w: Word) => {
    saveRecentSearch(w.word);
    onClose();
    onOpenWordDetails?.(w);
  }, [onOpenWordDetails, onClose, saveRecentSearch]);

  const handleSelectWordChat = useCallback((w: Word, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    saveRecentSearch(w.word);
    onClose();
    onOpenWordChat?.(w);
  }, [onOpenWordChat, onClose, saveRecentSearch]);

  const handleInsertToChat = useCallback((textToInsert: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    saveRecentSearch(textToInsert);
    onClose();
    onInsertToChat?.(textToInsert);
    onToast?.(`Inserted "${textToInsert}" into chat input`);
  }, [onInsertToChat, onClose, onToast, saveRecentSearch]);

  const handleTriggerAiExplain = useCallback((searchTerm: string) => {
    const term = searchTerm.trim();
    if (!term) return;
    saveRecentSearch(term);
    onClose();
    setQuery("");
    const prompt = `Please explain the word "${term}" in ${targetLanguage} with clear definition, phonetic pronunciation, nuance, and 3 example sentences translated to ${nativeLanguage}.`;
    onSendMessage?.(prompt);
  }, [targetLanguage, nativeLanguage, onSendMessage, onClose, saveRecentSearch]);

  const handleAddNewWord = useCallback((term?: string) => {
    onClose();
    const w = term || query;
    if (w.trim()) saveRecentSearch(w.trim());
    onAddWord?.(w.trim() || undefined);
  }, [query, onAddWord, onClose, saveRecentSearch]);

  // Helper to highlight matching text in word name or fields (including fuzzy matches)
  const renderHighlighted = (text: string, highlight: string) => {
    const trimmed = highlight.trim();
    if (!trimmed || !text) return <span>{text}</span>;

    const normText = removeAccents(text.toLowerCase());
    const normHighlight = removeAccents(trimmed.toLowerCase());
    const index = normText.indexOf(normHighlight);

    if (index !== -1) {
      const before = text.substring(0, index);
      const match = text.substring(index, index + trimmed.length);
      const after = text.substring(index + trimmed.length);

      return (
        <span>
          {before}
          <mark className="bg-amber-200 text-stone-900 rounded-xs px-0.5 font-bold">
            {match}
          </mark>
          {after}
        </span>
      );
    }

    // Fuzzy match fallback: if this text field fuzzy matches the query, highlight the text with a distinct wavy underline styling
    const matchRes = checkFuzzyMatch(text, trimmed);
    if (matchRes.isMatch && matchRes.matchType === "fuzzy") {
      return (
        <mark className="bg-amber-100 text-stone-900 rounded-xs px-0.5 font-semibold underline decoration-amber-400 decoration-wavy">
          {text}
        </mark>
      );
    }

    return <span>{text}</span>;
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div 
        className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-2.5 sm:p-4 bg-stone-900/60 backdrop-blur-xs overflow-y-auto"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 12 }}
          transition={{ duration: 0.18 }}
          className="bg-white rounded-2xl border border-stone-200 shadow-2xl w-full max-w-2xl max-h-[90vh] sm:max-h-[85vh] flex flex-col overflow-hidden text-stone-900 mt-2 sm:mt-0"
          id="quick-word-search-modal"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Modal Header */}
          <div className="p-3.5 sm:p-4 border-b border-stone-200 bg-stone-50/90 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-700 flex items-center justify-center shrink-0 shadow-2xs">
                <Search className="w-4 h-4 sm:w-4.5 sm:h-4.5" />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm sm:text-base font-extrabold text-stone-950 flex items-center gap-2 truncate">
                  <span>{t("qa_search_word_title", appLanguage) || "Vocabulary Search"}</span>
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-stone-200 text-stone-700 border border-stone-300/80 shrink-0">
                    {stats.total} {t("word_count", appLanguage) || "words"}
                  </span>
                </h3>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <span className="hidden sm:inline-flex text-[11px] font-mono text-stone-400 bg-stone-100 px-2 py-0.5 rounded border border-stone-200 select-none">
                ESC
              </span>
              <button
                type="button"
                onClick={onClose}
                className="w-8 h-8 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-600 hover:text-stone-900 flex items-center justify-center transition-colors cursor-pointer"
                title="Close search modal"
                id="close-word-search-modal-btn"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Search Input Bar */}
          <div className="p-3 sm:p-4 border-b border-stone-200 bg-white space-y-2.5">
            <div className="relative flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400 pointer-events-none" />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("chat_search_word_placeholder", appLanguage) || "Search word, meaning, IPA, topic, or ask AI..."}
                  className="w-full pl-10 pr-9 py-2 sm:py-2.5 rounded-xl border border-stone-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none text-xs sm:text-sm text-stone-900 placeholder:text-stone-400 transition-all font-medium bg-stone-50/50 focus:bg-white"
                  id="modal-word-search-input"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => {
                      setQuery("");
                      inputRef.current?.focus();
                    }}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-700 p-1 rounded-md transition-colors"
                    title="Clear search"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Add New Word Quick Button */}
              {onAddWord && (
                <button
                  type="button"
                  onClick={() => handleAddNewWord(query)}
                  className="px-3 py-2 sm:py-2.5 rounded-xl bg-stone-900 hover:bg-stone-800 text-white font-bold text-xs flex items-center gap-1.5 transition-all shadow-2xs shrink-0 cursor-pointer"
                  title="Add new word to vocabulary"
                  id="modal-quick-add-word-btn"
                >
                  <Plus className="w-3.5 h-3.5 text-amber-300" />
                  <span className="hidden sm:inline">Add Word</span>
                </button>
              )}
            </div>

            {/* Filter Pills */}
            <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none pb-0.5">
              <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wider shrink-0 select-none mr-1">
                Filter:
              </span>
              {[
                { id: "all", label: `All (${stats.total})` },
                { id: "starred", label: `⭐ Starred (${stats.starredCount})` },
                { id: "review", label: `⏳ Needs Review (${stats.reviewCount})` },
                { id: "mastered", label: `✅ Mastered (${stats.masteredCount})` },
              ].map((filter) => (
                <button
                  key={filter.id}
                  type="button"
                  onClick={() => setActiveFilter(filter.id as WordSearchFilter)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                    activeFilter === filter.id
                      ? "bg-stone-900 text-white shadow-2xs"
                      : "bg-stone-100 hover:bg-stone-200/80 text-stone-600 border border-stone-200/60"
                  }`}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          </div>

          {/* Modal Results Body */}
          <div 
            ref={parentRef}
            className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-2.5"
          >
            {/* Recent Searches Chips when query is empty */}
            {!query.trim() && recentSearches.length > 0 && (
              <div className="pb-3 border-b border-stone-100">
                <div className="flex items-center justify-between text-[11px] font-bold text-stone-400 uppercase tracking-wider mb-2">
                  <span className="flex items-center gap-1.5">
                    <History className="w-3.5 h-3.5 text-stone-400" />
                    Recent Searches
                  </span>
                  <button
                    type="button"
                    onClick={clearRecentSearches}
                    className="text-[10px] text-stone-400 hover:text-stone-600 flex items-center gap-1 lowercase font-normal cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" />
                    clear
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {recentSearches.map((term, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setQuery(term)}
                      className="px-2.5 py-1 rounded-lg bg-stone-100 hover:bg-indigo-50 hover:text-indigo-900 text-stone-700 text-xs font-semibold border border-stone-200/80 transition-all cursor-pointer flex items-center gap-1"
                    >
                      <Search className="w-3 h-3 text-stone-400" />
                      <span>{term}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Virtualized Search Results List */}
            {searchResults.length > 0 ? (
              <div
                style={{
                  height: `${rowVirtualizer.getTotalSize()}px`,
                  width: "100%",
                  position: "relative",
                }}
              >
                {rowVirtualizer.getVirtualItems().map((virtualItem) => {
                  const { word: w, matchedFields } = searchResults[virtualItem.index];
                  return (
                    <div
                      key={w.id || virtualItem.key}
                      data-index={virtualItem.index}
                      ref={rowVirtualizer.measureElement}
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        transform: `translateY(${virtualItem.start}px)`,
                      }}
                      className="pb-2.5"
                    >
                      <div
                        onClick={() => handleSelectWordDetails(w)}
                        className="group flex flex-col gap-2 p-2.5 sm:p-3 rounded-xl bg-white hover:bg-stone-50 border border-stone-200/70 hover:border-indigo-200/80 hover:shadow-2xs transition-all cursor-pointer"
                      >
                        {/* Top Row: Word, Pronunciation, Tags, Star */}
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-baseline gap-2 flex-wrap min-w-0">
                            <h4 className="text-sm sm:text-base font-extrabold text-stone-900 group-hover:text-indigo-950">
                              {renderHighlighted(w.word, query)}
                            </h4>
                            {w.pronunciation && (
                              <span className="text-xs font-mono text-stone-500">
                                {renderHighlighted(w.pronunciation, query)}
                              </span>
                            )}
                            {w.partOfSpeech && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-stone-200/70 text-stone-700 uppercase tracking-wider">
                                {w.partOfSpeech}
                              </span>
                            )}
                            {w.category && (
                              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200/60">
                                {w.category}
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            {/* Audio Button */}
                            <button
                              type="button"
                              onClick={(e) => handleSpeakWord(w.word, e)}
                              className="w-8 h-8 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-700 flex items-center justify-center transition-colors cursor-pointer"
                              title="Pronounce word"
                            >
                              <Volume2 className="w-4 h-4" />
                            </button>

                            {/* Star Toggle */}
                            {onToggleStarWord && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onToggleStarWord(w.id);
                                }}
                                className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors cursor-pointer ${
                                  w.starred 
                                    ? "text-amber-500 hover:text-amber-600 bg-amber-50" 
                                    : "text-stone-400 hover:text-stone-600 bg-stone-100 hover:bg-stone-200"
                                }`}
                                title={w.starred ? "Starred (Click to unstar)" : "Star this word"}
                              >
                                <Star className={`w-4 h-4 ${w.starred ? "fill-amber-400" : ""}`} />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Meaning & Definition */}
                        <div className="text-xs sm:text-sm text-stone-700 space-y-1">
                          {w.translation && (
                            <p className="font-semibold text-stone-900 leading-snug">
                              {renderHighlighted(w.translation, query)}
                            </p>
                          )}
                          {w.definition && (
                            <p className="text-xs text-stone-500 leading-snug line-clamp-2">
                              {renderHighlighted(w.definition, query)}
                            </p>
                          )}
                          {w.example && (
                            <p className="text-xs italic text-stone-600 bg-stone-100/70 px-2.5 py-1.5 rounded-lg border border-stone-200/60 mt-1 line-clamp-2">
                              "{renderHighlighted(w.example, query)}"
                              {w.exampleTranslation && (
                                <span className="block text-[11px] not-italic text-stone-500 mt-0.5">
                                  → {renderHighlighted(w.exampleTranslation, query)}
                                </span>
                              )}
                            </p>
                          )}
                        </div>

                        {/* Action Buttons Row */}
                        <div className="flex items-center justify-between gap-2 pt-1 flex-wrap">
                          <div className="flex items-center gap-1.5 text-[10px] text-stone-400">
                            {w.learned ? (
                              <span className="flex items-center gap-1 text-emerald-600 font-bold">
                                <CheckCircle2 className="w-3 h-3" /> Mastered
                              </span>
                            ) : (
                              <span className="flex items-center gap-1 text-stone-500 font-medium">
                                <Clock className="w-3 h-3 text-stone-400" />
                                {w.strength !== undefined ? `${w.strength}% strength` : "Needs Review"}
                              </span>
                            )}
                            {matchedFields && matchedFields.length > 0 && query.trim() && (
                              <span className="hidden sm:inline text-stone-400">
                                • matched in {matchedFields.join(", ")}
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0 ml-auto">
                            {/* Ask AI about this word */}
                            <button
                              type="button"
                              onClick={(e) => handleSelectWordChat(w, e)}
                              className="px-2.5 py-1 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 text-xs font-bold transition-all flex items-center gap-1 cursor-pointer"
                              title="Open interactive AI word study"
                            >
                              <Sparkles className="w-3 h-3 text-amber-600" />
                              <span>Ask AI</span>
                            </button>

                            {/* Insert into chat input */}
                            {onInsertToChat && (
                              <button
                                type="button"
                                onClick={(e) => handleInsertToChat(w.word, e)}
                                className="px-2.5 py-1 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-700 text-xs font-semibold transition-all flex items-center gap-1 cursor-pointer"
                                title="Insert word text into chat input"
                              >
                                <MessageSquare className="w-3 h-3 text-stone-500" />
                                <span>Insert to Chat</span>
                              </button>
                            )}

                            {/* View full card details */}
                            <button
                              type="button"
                              onClick={() => handleSelectWordDetails(w)}
                              className="px-2 py-1 rounded-lg bg-white hover:bg-stone-100 text-stone-500 hover:text-stone-900 border border-stone-200 text-xs font-medium transition-all flex items-center gap-1 cursor-pointer"
                              title="View complete flashcard details"
                            >
                              <ArrowUpRight className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : query.trim() ? (
              // Empty Search State with Helpful AI Suggestions
              <div className="py-8 text-center space-y-4">
                <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto border border-amber-200 shadow-2xs">
                  <BookOpen className="w-6 h-6" />
                </div>
                <div className="space-y-1">
                  <h4 className="text-sm font-bold text-stone-900">
                    No words found for "{query}"
                  </h4>
                  <p className="text-xs text-stone-500 max-w-sm mx-auto">
                    This term is not yet in your vocabulary collection. You can add it now or ask AI to explain it in Chat.
                  </p>
                </div>

                <div className="flex flex-col sm:flex-row items-center justify-center gap-2 pt-2 max-w-md mx-auto">
                  {onAddWord && (
                    <button
                      type="button"
                      onClick={() => handleAddNewWord(query)}
                      className="w-full sm:w-auto px-4 py-2 rounded-xl bg-stone-900 hover:bg-stone-800 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition-all shadow-xs cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5 text-amber-300" />
                      <span>Add "{query}" to Deck</span>
                    </button>
                  )}

                  {onSendMessage && (
                    <button
                      type="button"
                      onClick={() => handleTriggerAiExplain(query)}
                      className="w-full sm:w-auto px-4 py-2 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-950 font-bold text-xs border border-amber-300/80 flex items-center justify-center gap-1.5 transition-all shadow-2xs cursor-pointer"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                      <span>Ask AI in Chat</span>
                    </button>
                  )}
                </div>
              </div>
            ) : (
              // Empty initial list if user has no words at all
              <div className="py-8 text-center text-xs text-stone-400 font-medium">
                Type above to quickly find words, meanings, or pronunciations in your collection.
              </div>
            )}
          </div>

          {/* Modal Footer */}
          <div className="p-3 bg-stone-50 border-t border-stone-200 flex items-center justify-between text-xs text-stone-500 font-medium">
            <span className="text-[11px] text-stone-500">
              Showing {searchResults.length} {searchResults.length === 1 ? "match" : "matches"}
            </span>
            <span className="hidden sm:inline text-[11px] text-stone-400">
              Press <kbd className="px-1.5 py-0.5 rounded bg-white border border-stone-200 font-mono text-[10px]">ESC</kbd> to close
            </span>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
