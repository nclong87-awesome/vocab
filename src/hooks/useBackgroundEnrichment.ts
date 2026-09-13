import { useState, useEffect, useCallback, useRef } from "react";
import { Word, LLMConfig } from "../types";
import {
  enrichSingleWord,
  enrichIncompleteWordsQueue,
  cancelBatchEnrichment,
  subscribeEnrichmentProgress,
  BatchEnrichmentProgress,
  EnrichmentResult,
  getAutoEnrichmentSetting,
  setAutoEnrichmentSetting
} from "../services/backgroundEnrichmentService";

interface UseBackgroundEnrichmentOptions {
  words: Word[];
  targetLanguage: string;
  nativeLanguage: string;
  llmConfig?: LLMConfig;
  onUpdateWord?: (updatedWord: Word) => void;
  onUpdateWords?: (updatedWords: Word[]) => void;
  showToast?: (message: string) => void;
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
    appLanguage = "en"
  } = options;

  const [autoEnrichEnabled, setAutoEnrichEnabledState] = useState<boolean>(getAutoEnrichmentSetting);
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
    async (word: Word): Promise<EnrichmentResult> => {
      // If the word already has multiple definitions, do not auto-enhance
      if (word.hasMultipleDefinitions || (word.senses && word.senses.length > 1) || word.enrichmentStatus === "has_multiple_definitions") {
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
          llmConfig: llmConfigRef.current
        });

        // Update single word
        if (onUpdateWord) {
          onUpdateWord(result.updatedWord);
        } else if (onUpdateWords) {
          const currentWords = wordsRef.current;
          const updated = currentWords.map((w) => (w.id === word.id ? result.updatedWord : w));
          onUpdateWords(updated);
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
            showToast(
              isVi
                ? `✨ Đã tự động hoàn thành từ "${word.word}" (1 định nghĩa)!`
                : `✨ Auto-completed "${word.word}" (1 definition found)!`
            );
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
    [onUpdateWord, onUpdateWords, showToast, appLanguage]
  );

  /**
   * Starts background queue enrichment for all incomplete words.
   */
  const enrichAllIncomplete = useCallback(
    async (customIncompleteList?: Word[]) => {
      const incomplete = customIncompleteList || wordsRef.current.filter((w) => w.completed === false);
      if (incomplete.length === 0) return;

      const enrichable = incomplete.filter(
        (w) => !(w.hasMultipleDefinitions === true || (w.senses && w.senses.length > 1) || w.enrichmentStatus === "has_multiple_definitions")
      );

      if (enrichable.length === 0) {
        if (showToast) {
          const isVi = appLanguage === "vi";
          showToast(
            isVi
              ? `⚠️ Tất cả ${incomplete.length} từ nháp đều có nhiều định nghĩa. Vui lòng bấm vào từng từ để duyệt thủ công.`
              : `⚠️ All ${incomplete.length} draft words have multiple definitions. Please click each word to review manually.`
          );
        }
        return;
      }

      enrichable.forEach((w) => {
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
          if (showToast) {
            const isVi = appLanguage === "vi";
            showToast(
              isVi
                ? `Hoàn tất làm giàu: ${summary.completedCount} từ tự động hoàn thành, ${summary.multipleDefCount} từ giữ nháp vì có nhiều định nghĩa.`
                : `Enrichment complete: ${summary.completedCount} auto-completed, ${summary.multipleDefCount} marked incomplete (multiple definitions).`
            );
          }
        }
      });
    },
    [onUpdateWord, onUpdateWords, showToast, appLanguage]
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
    activeEnrichingIds
  };
}
