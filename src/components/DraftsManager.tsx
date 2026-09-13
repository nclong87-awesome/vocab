import { useState, useMemo, useCallback, useEffect, useRef, useDeferredValue } from "react";
import { 
  Clock, 
  Search, 
  Sparkles, 
  Loader2, 
  X, 
  CheckCircle2, 
  AlertCircle, 
  Volume2, 
  Trash2, 
  Edit3, 
  BookOpen, 
  Plus 
} from "lucide-react";
import { Word, LLMConfig, TTSConfig } from "../types";
import { speakText as speakTextService, DEFAULT_TTS_CONFIG } from "../utils/ttsService";
import {
  enrichSingleWord,
  enrichIncompleteWordsQueue,
  cancelBatchEnrichment,
  subscribeEnrichmentProgress,
  BatchEnrichmentProgress
} from "../services/backgroundEnrichmentService";
import { t } from "../config/i18n";

interface DraftsManagerProps {
  words: Word[];
  onAddWord?: (
    wordOrData?: string | any,
    hint?: string,
    initialData?: Partial<Word>
  ) => void;
  onDeleteWord: (wordId: string) => void;
  onToggleStar?: (wordId: string) => void;
  onToggleLearned?: (wordId: string) => void;
  onUpdateWords?: (updatedWords: Word[]) => void;
  onUpdateWord?: (updatedWord: Word) => void;
  llmConfig?: LLMConfig;
  ttsConfig?: TTSConfig;
  targetLanguage?: string;
  nativeLanguage?: string;
  appLanguage?: string;
  onLlmApiError?: (err: any, currentConfig: LLMConfig, retryAction: (newConfig: LLMConfig) => void) => void;
  autoEnrichEnabled?: boolean;
  onToggleAutoEnrich?: (val?: boolean) => void;
  onEnrichWord?: (word: Word) => Promise<any>;
  onEnrichAllIncomplete?: (customIncompleteList?: Word[]) => Promise<void>;
  onCancelEnrichment?: () => void;
  enrichmentProgress?: BatchEnrichmentProgress;
  activeEnrichingIds?: Set<string>;
  onNavigateToCollection?: () => void;
}

export default function DraftsManager({
  words,
  onAddWord,
  onDeleteWord,
  onUpdateWords,
  onUpdateWord,
  llmConfig,
  ttsConfig = DEFAULT_TTS_CONFIG,
  targetLanguage = "English",
  nativeLanguage = "Vietnamese",
  appLanguage = "Vietnamese",
  onLlmApiError: _onLlmApiError,
  autoEnrichEnabled,
  onToggleAutoEnrich,
  onEnrichWord,
  onEnrichAllIncomplete,
  onCancelEnrichment,
  enrichmentProgress,
  activeEnrichingIds,
  onNavigateToCollection
}: DraftsManagerProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [filterMode, setFilterMode] = useState<"all" | "auto_ready" | "needs_selection">("all");
  const deferredSearchQuery = useDeferredValue(searchQuery);

  const wordsRef = useRef(words);
  wordsRef.current = words;

  // Extract incomplete / draft words
  const incompleteWords = useMemo(() => {
    return words.filter(w => w.completed === false);
  }, [words]);

  const wordsWithMultipleDefinitions = useMemo(() => {
    return incompleteWords.filter(w => 
      w.hasMultipleDefinitions || (w.senses && w.senses.length > 1) || w.enrichmentStatus === "has_multiple_definitions"
    );
  }, [incompleteWords]);

  const autoEnrichableWords = useMemo(() => {
    return incompleteWords.filter(w => 
      !(w.hasMultipleDefinitions || (w.senses && w.senses.length > 1) || w.enrichmentStatus === "has_multiple_definitions")
    );
  }, [incompleteWords]);

  const [localBatchProgress, setLocalBatchProgress] = useState<BatchEnrichmentProgress>({
    isRunning: false,
    total: 0,
    processed: 0,
    completedCount: 0,
    multipleDefCount: 0,
    errorCount: 0
  });
  const [localEnrichingIds, setLocalEnrichingIds] = useState<Set<string>>(new Set());

  // Listen to background batch progress from the service
  useEffect(() => {
    const unsub = subscribeEnrichmentProgress((p) => {
      setLocalBatchProgress(p);
    });
    return () => unsub();
  }, []);

  const activeProgress = enrichmentProgress || localBatchProgress;
  const isBatchRunning = activeProgress.isRunning;
  const effectiveEnrichingIds = useMemo(() => {
    const set = new Set<string>(activeEnrichingIds || []);
    localEnrichingIds.forEach(id => set.add(id));
    return set;
  }, [activeEnrichingIds, localEnrichingIds]);

  // Speak word TTS
  const speakWord = useCallback((text: string) => {
    speakTextService(text, ttsConfig, llmConfig, targetLanguage);
  }, [ttsConfig, llmConfig, targetLanguage]);

  const handleEnrichSingle = useCallback(async (incWord: Word) => {
    if (onEnrichWord) {
      await onEnrichWord(incWord);
    } else {
      setLocalEnrichingIds(prev => new Set(prev).add(incWord.id));
      try {
        const res = await enrichSingleWord(incWord, {
          targetLanguage,
          nativeLanguage,
          llmConfig
        });
        if (onUpdateWord) {
          onUpdateWord(res.updatedWord);
        } else if (onUpdateWords) {
          const updated = wordsRef.current.map(w => w.id === incWord.id ? res.updatedWord : w);
          onUpdateWords(updated);
        }
      } finally {
        setLocalEnrichingIds(prev => {
          const next = new Set(prev);
          next.delete(incWord.id);
          return next;
        });
      }
    }
  }, [onEnrichWord, onUpdateWord, onUpdateWords, targetLanguage, nativeLanguage, llmConfig]);

  const handleEnrichAll = useCallback(async () => {
    if (onEnrichAllIncomplete) {
      await onEnrichAllIncomplete(incompleteWords);
    } else {
      incompleteWords.forEach(w => setLocalEnrichingIds(prev => new Set(prev).add(w.id)));
      await enrichIncompleteWordsQueue(incompleteWords, {
        targetLanguage,
        nativeLanguage,
        llmConfig,
        onWordUpdated: (updatedWord) => {
          setLocalEnrichingIds(prev => {
            const next = new Set(prev);
            next.delete(updatedWord.id);
            return next;
          });
          if (onUpdateWord) {
            onUpdateWord(updatedWord);
          } else if (onUpdateWords) {
            const updated = wordsRef.current.map(w => w.id === updatedWord.id ? updatedWord : w);
            onUpdateWords(updated);
          }
        },
        onComplete: () => {
          setLocalEnrichingIds(new Set());
        }
      });
    }
  }, [onEnrichAllIncomplete, incompleteWords, targetLanguage, nativeLanguage, llmConfig, onUpdateWord, onUpdateWords]);

  const handleCancelBatch = useCallback(() => {
    if (onCancelEnrichment) {
      onCancelEnrichment();
    } else {
      cancelBatchEnrichment();
    }
    setLocalEnrichingIds(new Set());
  }, [onCancelEnrichment]);

  const handleOpenIncompleteWord = useCallback((incWord: Word) => {
    onAddWord?.(incWord.word, incWord.context || incWord.definition || incWord.translation, incWord);
  }, [onAddWord]);

  // Filtered draft list
  const filteredDrafts = useMemo(() => {
    let list = incompleteWords;

    if (filterMode === "auto_ready") {
      list = autoEnrichableWords;
    } else if (filterMode === "needs_selection") {
      list = wordsWithMultipleDefinitions;
    }

    if (deferredSearchQuery.trim()) {
      const q = deferredSearchQuery.toLowerCase().trim();
      list = list.filter(w => 
        w.word.toLowerCase().includes(q) ||
        (w.translation && w.translation.toLowerCase().includes(q)) ||
        (w.definition && w.definition.toLowerCase().includes(q)) ||
        (w.context && w.context.toLowerCase().includes(q))
      );
    }

    return list;
  }, [incompleteWords, autoEnrichableWords, wordsWithMultipleDefinitions, filterMode, deferredSearchQuery]);

  return (
    <div className="space-y-6" id="drafts-manager-container">
      <div className="bg-white border border-stone-200 p-4 sm:p-5 space-y-6 shadow-2xs">
        {/* Main Banner / Control Center */}
        <div className="bg-gradient-to-br from-amber-50/95 via-orange-50/50 to-amber-50/80 border border-amber-300 rounded-xl p-4 sm:p-5 space-y-4 shadow-xs">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-amber-500/15 border border-amber-400/40 flex items-center justify-center text-amber-700 shrink-0 mt-0.5">
                <Clock className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-sm font-bold text-stone-900 tracking-tight">
                    {t("incomplete_words_section_title", appLanguage, { count: String(incompleteWords.length) })}
                  </h3>
                  <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-amber-200 text-amber-900 border border-amber-300">
                    {t("incomplete_word_badge", appLanguage)}
                  </span>
                  {wordsWithMultipleDefinitions.length > 0 && (
                    <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-purple-100 text-purple-800 border border-purple-300">
                      {wordsWithMultipleDefinitions.length} {t("badge_need_selection", appLanguage)}
                    </span>
                  )}
                </div>
                <p className="text-xs text-stone-600 max-w-xl leading-relaxed">
                  {t("incomplete_words_rule_explainer", appLanguage)}
                </p>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-2.5 shrink-0 flex-wrap">
              {onToggleAutoEnrich && typeof autoEnrichEnabled === "boolean" && (
                <button
                  type="button"
                  onClick={() => onToggleAutoEnrich()}
                  className={`px-3 py-2 text-xs font-semibold rounded-lg border transition-all cursor-pointer flex items-center gap-1.5 shadow-3xs ${
                    autoEnrichEnabled
                      ? "bg-amber-100/90 text-amber-900 border-amber-300"
                      : "bg-white/90 text-stone-600 border-stone-200 hover:bg-white"
                  }`}
                  title="Automatically enrich new incomplete words in the background"
                >
                  <Sparkles className={`w-3.5 h-3.5 ${autoEnrichEnabled ? "text-amber-600" : "text-stone-400"}`} />
                  <span>Auto: {autoEnrichEnabled ? "ON" : "OFF"}</span>
                </button>
              )}

              {isBatchRunning ? (
                <button
                  type="button"
                  onClick={handleCancelBatch}
                  className="px-3.5 py-2 text-xs font-bold rounded-lg bg-rose-100 hover:bg-rose-200 text-rose-800 border border-rose-300 flex items-center gap-1.5 transition-colors cursor-pointer shadow-3xs"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>{t("auto_enrich_stop", appLanguage)}</span>
                </button>
              ) : autoEnrichableWords.length > 0 ? (
                <button
                  type="button"
                  onClick={handleEnrichAll}
                  className="px-3.5 py-2 text-xs font-bold rounded-lg bg-amber-600 hover:bg-amber-700 text-white shadow-xs hover:shadow-sm flex items-center gap-1.5 transition-all cursor-pointer"
                  title={t("auto_enrich_all_tooltip", appLanguage)}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>{t("auto_enrich_all_btn", appLanguage, { count: String(autoEnrichableWords.length) })}</span>
                </button>
              ) : wordsWithMultipleDefinitions.length > 0 ? (
                <div
                  className="px-3 py-2 text-xs font-bold rounded-lg bg-purple-100 text-purple-900 border border-purple-300 flex items-center gap-1.5 cursor-default"
                  title={t("incomplete_multiple_defs_tooltip", appLanguage)}
                >
                  <AlertCircle className="w-3.5 h-3.5 text-purple-700 shrink-0" />
                  <span>{t("auto_enrich_manual_review_needed", appLanguage, { count: String(wordsWithMultipleDefinitions.length) })}</span>
                </div>
              ) : null}
            </div>
          </div>

          {/* Batch Progress Bar Banner */}
          {isBatchRunning && (
            <div className="bg-amber-100/90 border border-amber-300 rounded-lg p-3 space-y-2 text-xs shadow-3xs">
              <div className="flex items-center justify-between text-amber-950 font-medium">
                <div className="flex items-center gap-2 min-w-0">
                  <Loader2 className="w-4 h-4 animate-spin text-amber-700 shrink-0" />
                  <span className="truncate font-semibold">
                    {t("auto_enrich_progress_label", appLanguage, {
                      processed: String(activeProgress.processed),
                      total: String(activeProgress.total),
                      currentWord: activeProgress.currentWordText || ""
                    })}
                  </span>
                </div>
                <span className="font-mono text-xs font-bold text-amber-800 shrink-0">
                  {Math.round((activeProgress.processed / (activeProgress.total || 1)) * 100)}%
                </span>
              </div>
              <div className="w-full bg-amber-200/70 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-amber-600 h-2 transition-all duration-300 rounded-full"
                  style={{
                    width: `${Math.min(100, Math.round((activeProgress.processed / (activeProgress.total || 1)) * 100))}%`
                  }}
                />
              </div>
              <div className="flex items-center justify-between text-[11px] text-amber-900 pt-0.5">
                <span className="flex items-center gap-1 font-medium">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  <span>{activeProgress.completedCount} auto-completed (1 definition)</span>
                </span>
                <span className="flex items-center gap-1 font-medium text-purple-800">
                  <AlertCircle className="w-3.5 h-3.5 text-purple-600" />
                  <span>{activeProgress.multipleDefCount} marked incomplete (&gt;1 definitions)</span>
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Filter Chips & Search Bar */}
        {incompleteWords.length > 0 && (
          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-stone-50 p-2.5 border border-stone-200">
              {/* Filter Tabs */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  type="button"
                  onClick={() => setFilterMode("all")}
                  className={`px-2.5 py-1 text-xs font-bold transition-colors cursor-pointer border ${
                    filterMode === "all"
                      ? "bg-stone-900 text-white border-stone-900"
                      : "bg-white text-stone-600 border-stone-200 hover:bg-stone-100"
                  }`}
                >
                  All ({incompleteWords.length})
                </button>
                <button
                  type="button"
                  onClick={() => setFilterMode("auto_ready")}
                  className={`px-2.5 py-1 text-xs font-bold transition-colors cursor-pointer border flex items-center gap-1 ${
                    filterMode === "auto_ready"
                      ? "bg-amber-600 text-white border-amber-600"
                      : "bg-white text-amber-800 border-stone-200 hover:bg-amber-50"
                  }`}
                >
                  <Sparkles className="w-3 h-3" />
                  <span>Auto-Enrich Ready ({autoEnrichableWords.length})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setFilterMode("needs_selection")}
                  className={`px-2.5 py-1 text-xs font-bold transition-colors cursor-pointer border flex items-center gap-1 ${
                    filterMode === "needs_selection"
                      ? "bg-purple-700 text-white border-purple-700"
                      : "bg-white text-purple-800 border-stone-200 hover:bg-purple-50"
                  }`}
                >
                  <AlertCircle className="w-3 h-3" />
                  <span>Needs Selection ({wordsWithMultipleDefinitions.length})</span>
                </button>
              </div>

              {/* Search input */}
              <div className="relative min-w-[200px] sm:w-64">
                <Search className="w-3.5 h-3.5 text-stone-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter draft words..."
                  className="w-full pl-8 pr-7 py-1 bg-white border border-stone-200 text-xs text-stone-900 placeholder:text-stone-400 outline-none focus:border-stone-950 font-medium"
                />
                {searchQuery && (
                  <button 
                    onClick={() => setSearchQuery("")} 
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-900 text-xs"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>

            {/* Draft Cards Grid */}
            {filteredDrafts.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pt-1">
                {filteredDrafts.map((incWord) => {
                  const isEnriching = effectiveEnrichingIds.has(incWord.id);
                  const hasMultipleDefs = incWord.hasMultipleDefinitions || (incWord.senses && incWord.senses.length > 1);
                  const defCount = incWord.senses?.length || 0;

                  return (
                    <div
                      key={incWord.id}
                      onClick={() => handleOpenIncompleteWord(incWord)}
                      className={`group relative flex items-start justify-between gap-3 p-3.5 bg-white hover:bg-stone-50/80 border rounded-lg transition-all cursor-pointer shadow-3xs hover:shadow-2xs hover:-translate-y-0.5 ${
                        hasMultipleDefs
                          ? "border-purple-300 hover:border-purple-400 bg-purple-50/20"
                          : "border-amber-200 hover:border-amber-400"
                      }`}
                      title={
                        hasMultipleDefs
                          ? t("incomplete_multiple_defs_tooltip", appLanguage)
                          : t("incomplete_word_click_prompt", appLanguage)
                      }
                    >
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-sm font-bold text-stone-900 group-hover:text-amber-900 tracking-tight">
                            {incWord.word}
                          </span>
                          {incWord.partOfSpeech && incWord.partOfSpeech !== "word" && (
                            <span className="text-[10px] font-mono px-1.5 py-0.5 bg-stone-100 text-stone-600 rounded border border-stone-200">
                              {incWord.partOfSpeech}
                            </span>
                          )}
                          {hasMultipleDefs && (
                            <span className="px-1.5 py-0.5 text-[9px] font-bold rounded-full bg-purple-100 text-purple-800 border border-purple-200 flex items-center gap-0.5">
                              <span>{defCount > 1 ? `${defCount} definitions` : t("badge_multiple_definitions_short", appLanguage)}</span>
                            </span>
                          )}
                        </div>

                        <p className="text-xs text-stone-600 line-clamp-2">
                          {isEnriching ? (
                            <span className="text-amber-600 flex items-center gap-1.5 text-xs font-medium animate-pulse">
                              <Loader2 className="w-3 h-3 animate-spin" />
                              <span>Auto-enriching with AI...</span>
                            </span>
                          ) : hasMultipleDefs ? (
                            <span className="text-purple-700 text-xs font-medium flex items-center gap-1">
                              <span>⚠️</span>
                              <span>{t("multiple_definitions_select_prompt", appLanguage, { count: String(defCount) })}</span>
                            </span>
                          ) : (
                            incWord.translation || incWord.definition || (
                              <span className="text-amber-700 italic text-xs">
                                {t("incomplete_word_click_prompt", appLanguage)}
                              </span>
                            )
                          )}
                        </p>
                      </div>

                      {/* Action buttons */}
                      <div className="flex items-center gap-1 shrink-0 pt-0.5">
                        {/* Auto-enrich single word or Manual Review */}
                        {hasMultipleDefs ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenIncompleteWord(incWord);
                            }}
                            className="p-1.5 rounded text-purple-700 hover:text-purple-950 hover:bg-purple-100 transition-colors cursor-pointer"
                            title={t("auto_enrich_manual_review_title", appLanguage)}
                          >
                            <Edit3 className="w-4 h-4 text-purple-700 group-hover:scale-110 transition-transform" />
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={isEnriching}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleEnrichSingle(incWord);
                            }}
                            className={`p-1.5 rounded transition-colors cursor-pointer ${
                              isEnriching
                                ? "text-amber-600 bg-amber-50"
                                : "text-stone-400 hover:text-amber-700 hover:bg-amber-50"
                            }`}
                            title={t("auto_enrich_single_title", appLanguage)}
                          >
                            {isEnriching ? (
                              <Loader2 className="w-4 h-4 animate-spin text-amber-600" />
                            ) : (
                              <Sparkles className="w-4 h-4 text-amber-600 group-hover:scale-110 transition-transform" />
                            )}
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            speakWord(incWord.word);
                          }}
                          className="p-1.5 rounded text-stone-400 hover:text-stone-900 hover:bg-stone-100 transition-colors cursor-pointer"
                          title="Listen Pronunciation"
                        >
                          <Volume2 className="w-4 h-4" />
                        </button>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteWord(incWord.id);
                          }}
                          className="p-1.5 rounded text-stone-300 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                          title="Discard Draft"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>

                        <div
                          className="p-1.5 rounded text-amber-600 group-hover:text-amber-800 transition-colors"
                          title="Complete Word"
                        >
                          <Edit3 className="w-4 h-4" />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="p-8 text-center bg-stone-50 border border-stone-200 space-y-2">
                <Search className="w-6 h-6 text-stone-400 mx-auto" />
                <h4 className="font-bold text-xs text-stone-800">No matching draft words</h4>
                <p className="text-xs text-stone-500">
                  Try adjusting your filter or search query.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Empty State when no incomplete words exist at all */}
        {incompleteWords.length === 0 && (
          <div className="p-10 sm:p-14 text-center bg-stone-50/70 border border-stone-200 space-y-4 rounded-xl">
            <div className="w-12 h-12 bg-emerald-50 text-emerald-600 border border-emerald-200 rounded-full flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div className="space-y-1 max-w-md mx-auto">
              <h4 className="font-bold text-sm sm:text-base text-stone-900">
                {t("drafts_empty_title", appLanguage) || "No Draft Words to Complete"}
              </h4>
              <p className="text-xs text-stone-600 leading-relaxed">
                {t("drafts_empty_desc", appLanguage) || "All your vocabulary words are complete and ready for practice! When you add new words or capture photos without full definitions, they will appear here."}
              </p>
            </div>
            <div className="flex items-center justify-center gap-3 pt-2">
              {onAddWord && (
                <button
                  type="button"
                  onClick={() => onAddWord()}
                  className="px-3.5 py-2 text-xs font-bold text-white bg-stone-900 hover:bg-stone-800 transition-colors flex items-center gap-1.5 cursor-pointer shadow-3xs"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{t("add_word_btn", appLanguage)}</span>
                </button>
              )}
              {onNavigateToCollection && (
                <button
                  type="button"
                  onClick={onNavigateToCollection}
                  className="px-3.5 py-2 text-xs font-semibold text-stone-700 bg-white hover:bg-stone-100 border border-stone-300 transition-colors flex items-center gap-1.5 cursor-pointer shadow-3xs"
                >
                  <BookOpen className="w-3.5 h-3.5 text-stone-500" />
                  <span>{t("nav_collection", appLanguage)}</span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
