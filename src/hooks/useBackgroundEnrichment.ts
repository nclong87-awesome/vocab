import { useState, useEffect, useCallback, useRef } from "react";
import { Word, LLMConfig } from "../types";
import {
  enrichSingleWord,
  enrichIncompleteWordsQueue,
  cancelBatchEnrichment,
  subscribeEnrichmentProgress,
  BatchEnrichmentProgress,
  BatchEnrichmentSummary,
  EnrichmentResult,
  getAutoEnrichmentSetting,
  setAutoEnrichmentSetting
} from "../services/backgroundEnrichmentService";
import { t } from "../config/i18n";

interface UseBackgroundEnrichmentOptions {
  words: Word[];
  targetLanguage: string;
  nativeLanguage: string;
  llmConfig?: LLMConfig;
  onUpdateWord?: (updatedWord: Word) => void;
  onUpdateWords?: (updatedWords: Word[]) => void;
  showToast?: (itemOrMsg: any, duration?: number) => void;
  onOpenEnrichedGallery?: (words: Word[], initialIndex?: number) => void;
  appLanguage?: string;
}

export function useBackgroundEnrichment(options: UseBackgroundEnrichmentOptions) {
  const {
    words,
    targetLanguage,
    nativeLanguage,
    llmConfig,
    onUpdateWord,
    onUpdateWords,
    showToast,
    onOpenEnrichedGallery,
    appLanguage = "en"
  } = options;

  const [autoEnrichEnabled, setAutoEnrichEnabledState] = useState<boolean>(getAutoEnrichmentSetting);
  const [recentlyEnrichedWords, setRecentlyEnrichedWords] = useState<Word[]>([]);
  const [lastEnrichSummary, setLastEnrichSummary] = useState<BatchEnrichmentSummary | null>(null);
  const [progress, setProgress] = useState<BatchEnrichmentProgress>({
    isRunning: false,
    total: 0,
    processed: 0,
    completedCount: 0,
    multipleDefCount: 0,
    errorCount: 0
  });

  const [activeEnrichingIds, setActiveEnrichingIds] = useState<Set<string>>(new Set());
  const wordsRef = useRef(words);
  wordsRef.current = words;

  const targetLangRef = useRef(targetLanguage);
  targetLangRef.current = targetLanguage;

  const nativeLangRef = useRef(nativeLanguage);
  nativeLangRef.current = nativeLanguage;

  const llmConfigRef = useRef(llmConfig);
  llmConfigRef.current = llmConfig;

  // Listen to batch progress
  useEffect(() => {
    const unsubscribe = subscribeEnrichmentProgress((p) => {
      setProgress(p);
    });
    return () => unsubscribe();
  }, []);

  // Listen to storage changes across tabs or components
  useEffect(() => {
    const handleSettingChange = (e: any) => {
      if (typeof e.detail?.enabled === "boolean") {
        setAutoEnrichEnabledState(e.detail.enabled);
      }
    };
    window.addEventListener("vocab-auto-enrich-setting-changed", handleSettingChange);
    return () => {
      window.removeEventListener("vocab-auto-enrich-setting-changed", handleSettingChange);
    };
  }, []);

  const toggleAutoEnrich = useCallback((val?: boolean) => {
    const nextVal = typeof val === "boolean" ? val : !autoEnrichEnabled;
    setAutoEnrichmentSetting(nextVal);
    setAutoEnrichEnabledState(nextVal);
  }, [autoEnrichEnabled]);

  /**
   * Enriches a single word in the background.
   */
  const enrichWord = useCallback(
    async (word: Word, forceRecheck?: boolean): Promise<EnrichmentResult> => {
      // If the word already has multiple definitions and forceRecheck is not requested, prompt manual review
      if (!forceRecheck && (word.hasMultipleDefinitions || (word.senses && word.senses.length > 1) || word.enrichmentStatus === "has_multiple_definitions")) {
        if (showToast) {
          const isVi = appLanguage === "vi";
          showToast(
            isVi
              ? `⚠️ "${word.word}" có nhiều định nghĩa. Vui lòng bấm vào từ để chọn nghĩa thủ công.`
              : `⚠️ "${word.word}" has multiple definitions. Please click the word to review and select a definition.`
          );
        }
        return {
          updatedWord: word,
          hasMultipleDefinitions: true,
          definitionCount: word.senses?.length || 2
        };
      }

      setActiveEnrichingIds((prev) => new Set(prev).add(word.id));
      try {
        const result = await enrichSingleWord(word, {
          targetLanguage: targetLangRef.current,
          nativeLanguage: nativeLangRef.current,
          llmConfig: llmConfigRef.current,
          forceRecheck
        });

        // Update single word
        if (onUpdateWord) {
          onUpdateWord(result.updatedWord);
        } else if (onUpdateWords) {
          const currentWords = wordsRef.current;
          const updated = currentWords.map((w) => (w.id === word.id ? result.updatedWord : w));
          onUpdateWords(updated);
        }

        if (result.updatedWord.completed) {
          setRecentlyEnrichedWords((prev) => [result.updatedWord, ...prev.filter((w) => w.id !== result.updatedWord.id)]);
        }

        if (showToast) {
          if (result.hasMultipleDefinitions) {
            const isVi = appLanguage === "vi";
            showToast(
              isVi
                ? `⚠️ "${word.word}" có ${result.definitionCount} định nghĩa. Đã giữ ở trạng thái nháp để bạn chọn!`
                : `⚠️ "${word.word}" has ${result.definitionCount} definitions. Marked as incomplete for your review.`
            );
          } else if (result.updatedWord.completed) {
            const isVi = appLanguage === "vi";
            showToast({
              id: `single-enrich-${result.updatedWord.id}`,
              message: isVi
                ? `✨ Đã tự động hoàn thành từ "${word.word}" (1 định nghĩa)!`
                : `✨ Auto-completed "${word.word}" (1 definition found)!`,
              type: "success",
              action: onOpenEnrichedGallery
                ? {
                    label: t("toast_view_enriched_gallery", appLanguage) || "🔍 View Word",
                    onClick: () => onOpenEnrichedGallery([result.updatedWord], 0),
                    icon: "sparkles",
                    variant: "primary"
                  }
                : undefined
            }, 6000);
          }
        }

        return result;
      } finally {
        setActiveEnrichingIds((prev) => {
          const next = new Set(prev);
          next.delete(word.id);
          return next;
        });
      }
    },
    [onUpdateWord, onUpdateWords, showToast, onOpenEnrichedGallery, appLanguage]
  );

  /**
   * Starts background queue enrichment for all incomplete words.
   */
  const enrichAllIncomplete = useCallback(
    async (customIncompleteList?: Word[]) => {
      const incomplete = customIncompleteList || wordsRef.current.filter((w) => w.completed === false);
      if (incomplete.length === 0) return;

      incomplete.forEach((w) => {
        setActiveEnrichingIds((prev) => new Set(prev).add(w.id));
      });

      await enrichIncompleteWordsQueue(incomplete, {
        targetLanguage: targetLangRef.current,
        nativeLanguage: nativeLangRef.current,
        llmConfig: llmConfigRef.current,
        onWordUpdated: (updatedWord) => {
          setActiveEnrichingIds((prev) => {
            const next = new Set(prev);
            next.delete(updatedWord.id);
            return next;
          });

          if (onUpdateWord) {
            onUpdateWord(updatedWord);
          } else if (onUpdateWords) {
            const currentWords = wordsRef.current;
            const updated = currentWords.map((w) => (w.id === updatedWord.id ? updatedWord : w));
            onUpdateWords(updated);
          }
        },
        onComplete: (summary) => {
          setActiveEnrichingIds(new Set());
          setLastEnrichSummary(summary);
          if (summary.enrichedWords && summary.enrichedWords.length > 0) {
            setRecentlyEnrichedWords(summary.enrichedWords);
          }

          if (showToast) {
            const isVi = appLanguage === "vi";
            const summaryMsg = isVi
              ? `Hoàn tất làm giàu: ${summary.completedCount} từ tự động hoàn thành, ${summary.multipleDefCount} từ giữ nháp vì có nhiều định nghĩa.`
              : `Enrichment complete: ${summary.completedCount} auto-completed, ${summary.multipleDefCount} marked incomplete (multiple definitions).`;

            if (summary.completedCount > 0 && onOpenEnrichedGallery) {
              const enrichedWordsList = summary.enrichedWords && summary.enrichedWords.length > 0
                ? summary.enrichedWords
                : wordsRef.current.filter((w) => w.completed === true);

              showToast({
                id: `batch-enrich-complete-${Date.now()}`,
                message: summaryMsg,
                type: "success",
                action: {
                  label: t("toast_view_enriched_gallery", appLanguage) || "🔍 View Words",
                  onClick: () => onOpenEnrichedGallery(enrichedWordsList, 0),
                  icon: "sparkles",
                  variant: "primary"
                }
              }, 8000);
            } else {
              showToast(summaryMsg);
            }
          }
        }
      });
    },
    [onUpdateWord, onUpdateWords, showToast, onOpenEnrichedGallery, appLanguage]
  );

  const cancelEnrichment = useCallback(() => {
    cancelBatchEnrichment();
    setActiveEnrichingIds(new Set());
  }, []);

  return {
    autoEnrichEnabled,
    toggleAutoEnrich,
    enrichWord,
    enrichAllIncomplete,
    cancelEnrichment,
    progress,
    isBatchRunning: progress.isRunning,
    activeEnrichingIds,
    recentlyEnrichedWords,
    lastEnrichSummary
  };
}

