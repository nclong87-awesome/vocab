import React, { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import {
  ArrowLeft,
  X,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Volume2,
  RefreshCw,
  CheckCircle2,
  Star,
  BookOpen,
  Edit3,
  Languages,
  Check,
  Plus,
  Bot
} from "lucide-react";
import { Word, LLMConfig, TTSConfig } from "../../types";
import { useModalBackNavigation } from "../../hooks/useModalBackNavigation";
import { speakText as speakTextService, DEFAULT_TTS_CONFIG } from "../../utils/ttsService";
import { autofillWordService } from "../../services/llmClientService";
import { WordImageGallery } from "../common/WordImageGallery";
import MemoryStrengthBar from "../common/MemoryStrengthBar";
import { t } from "../../config/i18n";
import { normalizeWordCategory, normalizeWordPartOfSpeech, isPhrasalVerb } from "../../utils/wordNormalization";
import { formatModelDisplayName } from "../../utils/llmHelpers";
import { getAutoCandidateWithMeta } from "../../utils/autoModeManager";
import { PROVIDER_OPTIONS } from "../../config/llmProviders";
import LlmResponseMetadata from "../chat/LlmResponseMetadata";

export interface EnrichedWordsGalleryModalProps {
  isOpen: boolean;
  words: Word[];
  initialIndex?: number;
  onClose: () => void;
  onUpdateWord?: (updatedWord: Word) => void;
  onUpdateWords?: (updatedWords: Word[]) => void;
  onDeleteWord?: (wordId: string) => void;
  onToggleStar?: (wordId: string) => void;
  onToggleLearned?: (wordId: string) => void;
  onAddWord?: (wordOrData?: string | any, hint?: string, initialData?: Partial<Word>) => void;
  onAskAi?: (word: Word) => void;
  targetLanguage?: string;
  nativeLanguage?: string;
  appLanguage?: string;
  llmConfig?: LLMConfig;
  ttsConfig?: TTSConfig;
  onLlmApiError?: (err: any, currentConfig: LLMConfig, retryAction: (newConfig: LLMConfig) => void) => void;
}

export const EnrichedWordsGalleryModal: React.FC<EnrichedWordsGalleryModalProps> = ({
  isOpen,
  words: propWords,
  initialIndex = 0,
  onClose,
  onUpdateWord,
  onToggleStar,
  onToggleLearned,
  onAddWord,
  onAskAi,
  targetLanguage = "English",
  nativeLanguage = "Vietnamese",
  appLanguage = "en",
  llmConfig,
  ttsConfig = DEFAULT_TTS_CONFIG,
  onLlmApiError
}) => {
  useModalBackNavigation(isOpen, onClose);

  // Local copy of words to reflect updates immediately
  const [localWords, setLocalWords] = useState<Word[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [navDirection, setNavDirection] = useState<-1 | 1>(1);
  const [isRegenerating, setIsRegenerating] = useState<boolean>(false);
  const [regeneratedSuccessId, setRegeneratedSuccessId] = useState<string | null>(null);
  const [showExampleTranslation, setShowExampleTranslation] = useState<boolean>(true);
  const [addedSuggestedWords, setAddedSuggestedWords] = useState<Set<string>>(new Set());

  const touchStartXRef = useRef<number | null>(null);
  const wordPillsRef = useRef<HTMLDivElement>(null);

  // Sync internal words with props
  useEffect(() => {
    if (propWords && propWords.length > 0) {
      setLocalWords(propWords);
      if (initialIndex >= 0 && initialIndex < propWords.length) {
        setCurrentIndex(initialIndex);
      } else {
        setCurrentIndex(0);
      }
    }
  }, [propWords, initialIndex]);

  // Keep local index bounded
  const wordsCount = localWords.length;
  const safeIndex = wordsCount > 0 ? Math.min(Math.max(0, currentIndex), wordsCount - 1) : 0;
  const currentWord: Word | undefined = localWords[safeIndex];

  const [lastEnrichmentMetadata, setLastEnrichmentMetadata] = useState<{
    provider?: string;
    model?: string;
    responseTimeMs?: number;
  } | null>(null);

  // Determine effective AI model and provider for current word
  let fallbackCand: { provider: string; model: string } | null = null;
  try {
    fallbackCand = getAutoCandidateWithMeta(llmConfig, undefined, false).candidate;
  } catch {
    fallbackCand = { provider: "groq", model: "openai/gpt-oss-120b" };
  }

  let effectiveWordModel = (regeneratedSuccessId === currentWord?.id ? lastEnrichmentMetadata?.model : undefined) || currentWord?.enrichmentModel;
  let effectiveWordProvider = (regeneratedSuccessId === currentWord?.id ? lastEnrichmentMetadata?.provider : undefined) || currentWord?.enrichmentProvider;

  // Never show "auto" or "Auto Model" - always resolve to the actual model used / auto candidate
  if (!effectiveWordModel || effectiveWordModel.toLowerCase() === "auto" || effectiveWordModel.toLowerCase() === "auto model") {
    effectiveWordModel = (llmConfig?.model && llmConfig.model !== "auto") ? llmConfig.model : fallbackCand?.model || "openai/gpt-oss-120b";
  }
  if (!effectiveWordProvider || effectiveWordProvider.toLowerCase() === "auto" || effectiveWordProvider.toLowerCase() === "auto mode") {
    effectiveWordProvider = (llmConfig?.provider && llmConfig.provider !== "auto") ? llmConfig.provider : fallbackCand?.provider || "groq";
  }

  const formattedModelName = formatModelDisplayName(effectiveWordModel);
  const providerMeta = PROVIDER_OPTIONS.find((p) => p.id === effectiveWordProvider);
  const providerDisplayName = providerMeta && providerMeta.id !== "auto"
    ? providerMeta.name.replace(/\s*\(Default\)/i, "").trim()
    : (effectiveWordProvider && effectiveWordProvider !== "auto" ? effectiveWordProvider.charAt(0).toUpperCase() + effectiveWordProvider.slice(1) : "");

  // Auto scroll current word thumbnail into view
  useEffect(() => {
    if (wordPillsRef.current) {
      const activePill = wordPillsRef.current.querySelector(`[data-index="${safeIndex}"]`);
      if (activePill) {
        activePill.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
      }
    }
  }, [safeIndex]);

  // Audio speech
  const speakText = useCallback(
    (text: string) => {
      if (!text) return;
      speakTextService(text, ttsConfig, llmConfig, targetLanguage);
    },
    [ttsConfig, llmConfig, targetLanguage]
  );

  // Navigation handlers
  const handlePrev = useCallback(() => {
    if (wordsCount <= 1) return;
    setNavDirection(-1);
    setCurrentIndex((prev) => (prev > 0 ? prev - 1 : wordsCount - 1));
  }, [wordsCount]);

  const handleNext = useCallback(() => {
    if (wordsCount <= 1) return;
    setNavDirection(1);
    setCurrentIndex((prev) => (prev < wordsCount - 1 ? prev + 1 : 0));
  }, [wordsCount]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input
      if (["INPUT", "TEXTAREA", "SELECT"].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        handlePrev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        handleNext();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === " " && currentWord) {
        e.preventDefault();
        speakText(currentWord.word);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, handlePrev, handleNext, onClose, currentWord, speakText]);

  // Touch swipe support
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartXRef.current = e.touches[0].clientX;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartXRef.current === null) return;
    const diff = e.changedTouches[0].clientX - touchStartXRef.current;
    touchStartXRef.current = null;
    if (diff > 50) {
      handlePrev();
    } else if (diff < -50) {
      handleNext();
    }
  };

  // Regeneration of current word
  const handleRegenerateWord = useCallback(async () => {
    if (!currentWord || isRegenerating) return;

    setIsRegenerating(true);
    setRegeneratedSuccessId(null);

    const retryAction = async (newConfig: LLMConfig) => {
      try {
        setIsRegenerating(true);
        const data = await autofillWordService({
          word: currentWord.word,
          hint: currentWord.context || currentWord.definition || currentWord.translation,
          targetLanguage,
          nativeLanguage,
          cfg: newConfig,
          action: "regenerate_word"
        });

        if (data && data.word) {
          const isPv = isPhrasalVerb(data.word, data.partOfSpeech, data.category);
          const normalizedPos = normalizeWordPartOfSpeech(data.partOfSpeech, data.word, data.category);
          const normalizedCategory = isPv
            ? normalizeWordCategory(data.category, data.word, normalizedPos)
            : data.category || currentWord.category || "General";

          let usedProvider = data.provider;
          let usedModel = data.model;
          if (!usedModel || usedModel === "auto" || !usedProvider || usedProvider === "auto") {
            try {
              const cand = getAutoCandidateWithMeta(newConfig, undefined, false).candidate;
              if (!usedProvider || usedProvider === "auto") usedProvider = cand.provider;
              if (!usedModel || usedModel === "auto") usedModel = cand.model;
            } catch {
              if (!usedProvider || usedProvider === "auto") usedProvider = "groq";
              if (!usedModel || usedModel === "auto") usedModel = "openai/gpt-oss-120b";
            }
          }

          setLastEnrichmentMetadata({
            provider: usedProvider,
            model: usedModel,
            responseTimeMs: data.responseTimeMs
          });

          const updated: Word = {
            ...currentWord,
            pronunciation: data.pronunciation || currentWord.pronunciation,
            partOfSpeech: normalizedPos,
            category: normalizedCategory,
            definition: data.definition || currentWord.definition,
            translation: data.translation || currentWord.translation,
            example: data.example || currentWord.example,
            exampleTranslation: data.exampleTranslation || currentWord.exampleTranslation,
            context: data.context || currentWord.context,
            suggestedWords: data.suggestedWords || currentWord.suggestedWords,
            imageKeyword: data.imageKeyword || currentWord.imageKeyword,
            completed: true,
            enrichmentModel: usedModel,
            enrichmentProvider: usedProvider,
            enrichedAt: new Date().toISOString()
          };

          // Update local state
          setLocalWords((prev) => prev.map((w) => (w.id === currentWord.id ? updated : w)));
          onUpdateWord?.(updated);
          setRegeneratedSuccessId(currentWord.id);
          setTimeout(() => setRegatedSuccessIdNull(), 4000);
        }
      } catch (innerErr: any) {
        if (onLlmApiError) {
          onLlmApiError(innerErr, newConfig, retryAction);
        }
      } finally {
        setIsRegenerating(false);
      }
    };

    const setRegatedSuccessIdNull = () => {
      setRegeneratedSuccessId(null);
    };

    try {
      const data = await autofillWordService({
        word: currentWord.word,
        hint: currentWord.context || currentWord.definition || currentWord.translation,
        targetLanguage,
        nativeLanguage,
        cfg: llmConfig,
        action: "regenerate_word"
      });

      if (data && data.word) {
        const isPv = isPhrasalVerb(data.word, data.partOfSpeech, data.category);
        const normalizedPos = normalizeWordPartOfSpeech(data.partOfSpeech, data.word, data.category);
        const normalizedCategory = isPv
          ? normalizeWordCategory(data.category, data.word, normalizedPos)
          : data.category || currentWord.category || "General";

        let usedProvider = data.provider;
        let usedModel = data.model;
        if (!usedModel || usedModel === "auto" || !usedProvider || usedProvider === "auto") {
          try {
            const cand = getAutoCandidateWithMeta(llmConfig, undefined, false).candidate;
            if (!usedProvider || usedProvider === "auto") usedProvider = cand.provider;
            if (!usedModel || usedModel === "auto") usedModel = cand.model;
          } catch {
            if (!usedProvider || usedProvider === "auto") usedProvider = "groq";
            if (!usedModel || usedModel === "auto") usedModel = "openai/gpt-oss-120b";
          }
        }

        setLastEnrichmentMetadata({
          provider: usedProvider,
          model: usedModel,
          responseTimeMs: data.responseTimeMs
        });

        const updated: Word = {
          ...currentWord,
          pronunciation: data.pronunciation || currentWord.pronunciation,
          partOfSpeech: normalizedPos,
          category: normalizedCategory,
          definition: data.definition || currentWord.definition,
          translation: data.translation || currentWord.translation,
          example: data.example || currentWord.example,
          exampleTranslation: data.exampleTranslation || currentWord.exampleTranslation,
          context: data.context || currentWord.context,
          suggestedWords: data.suggestedWords || currentWord.suggestedWords,
          imageKeyword: data.imageKeyword || currentWord.imageKeyword,
          completed: true,
          enrichmentModel: usedModel,
          enrichmentProvider: usedProvider,
          enrichedAt: new Date().toISOString()
        };

        // Update local state
        setLocalWords((prev) => prev.map((w) => (w.id === currentWord.id ? updated : w)));
        onUpdateWord?.(updated);
        setRegeneratedSuccessId(currentWord.id);
        setTimeout(() => setRegeneratedSuccessId(null), 4000);
      }
    } catch (err: any) {
      if (onLlmApiError) {
        onLlmApiError(err, llmConfig || ({} as any), retryAction);
      }
    } finally {
      setIsRegenerating(false);
    }
  }, [currentWord, isRegenerating, targetLanguage, nativeLanguage, llmConfig, onUpdateWord, onLlmApiError]);

  // Image updates
  const handleImagesChange = useCallback(
    (newUrls: string[]) => {
      if (!currentWord) return;
      const updated: Word = {
        ...currentWord,
        imageUrls: newUrls,
        imageUrl: newUrls[0] || undefined
      };
      setLocalWords((prev) => prev.map((w) => (w.id === currentWord.id ? updated : w)));
      onUpdateWord?.(updated);
    },
    [currentWord, onUpdateWord]
  );

  // Add suggested word to collection
  const handleAddSuggestedWord = (sWordText: string, sWordTranslation?: string) => {
    if (!sWordText) return;
    onAddWord?.(sWordText, sWordTranslation);
    setAddedSuggestedWords((prev) => new Set(prev).add(sWordText));
  };

  if (!isOpen) return null;

  return createPortal(
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-labelledby="gallery-modal-title"
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 15 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-50 bg-white flex flex-col h-full w-full overflow-hidden"
    >
      {/* Full-Screen Header identical to WordChatModal (Ask AI) */}
      <header className="flex items-center justify-between px-3 sm:px-6 py-2.5 sm:py-3 border-b border-stone-200 bg-white shrink-0 shadow-2xs z-10">
        <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 sm:p-2 -ml-1 rounded-full text-stone-600 hover:text-stone-950 hover:bg-stone-100 transition-colors cursor-pointer"
            aria-label="Back"
            title="Close"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>

          <div className="min-w-0">
            <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
              <h2 id="gallery-modal-title" className="text-sm sm:text-lg font-bold text-stone-900 tracking-tight truncate">
                {t("gallery_enriched_modal_title", appLanguage) || "Enriched Words Gallery"}
              </h2>
              {wordsCount > 0 && (
                <span className="text-[9px] sm:text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300 font-mono">
                  {safeIndex + 1} / {wordsCount}
                </span>
              )}
              {/* AI Model Badge in Modal Header */}
              <span
                className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-stone-100 text-stone-700 border border-stone-200 flex items-center gap-1.5 shrink-0"
                title={`AI Model: ${formattedModelName}${providerDisplayName ? ` (${providerDisplayName})` : ""}`}
              >
                <Bot className="w-3 h-3 text-stone-500 shrink-0" />
                <span className="truncate max-w-[130px] sm:max-w-[200px]">
                  {formattedModelName}
                </span>
                {providerDisplayName && (
                  <span className="text-stone-400 text-[9px] font-sans font-normal hidden sm:inline">
                    • {providerDisplayName}
                  </span>
                )}
              </span>
            </div>

            <div className="flex items-center gap-2 text-[11px] sm:text-xs text-stone-500 truncate leading-tight">
              {currentWord ? (
                <>
                  <span className="text-stone-800 font-medium truncate font-serif italic">"{currentWord.word}"</span>
                  {currentWord.partOfSpeech && (
                    <span className="font-mono text-stone-500">• {currentWord.partOfSpeech}</span>
                  )}
                  {currentWord.translation && (
                    <span className="text-stone-600 truncate">• {currentWord.translation}</span>
                  )}
                </>
              ) : (
                <span>{targetLanguage} &bull; {nativeLanguage}</span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {currentWord && (
            <button
              type="button"
              onClick={() => speakText(currentWord.word)}
              className="p-1.5 sm:p-2 rounded-full text-stone-600 hover:text-stone-950 hover:bg-stone-100 transition-colors cursor-pointer"
              title={`Pronounce "${currentWord.word}"`}
            >
              <Volume2 className="w-5 h-5" />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 sm:p-2 rounded-full text-stone-400 hover:text-stone-700 hover:bg-stone-100 transition-colors cursor-pointer"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Word Thumbnail / Pills Selector Strip */}
      {wordsCount > 1 && (
        <div
          ref={wordPillsRef}
          className="px-3 sm:px-6 py-2 bg-stone-50/80 border-b border-stone-200/80 flex items-center gap-1.5 overflow-x-auto scrollbar-none shrink-0"
        >
          {localWords.map((w, idx) => {
            const isSelected = idx === safeIndex;
            return (
              <button
                key={w.id || idx}
                data-index={idx}
                type="button"
                onClick={() => {
                  setNavDirection(idx > safeIndex ? 1 : -1);
                  setCurrentIndex(idx);
                }}
                className={`px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 shrink-0 cursor-pointer ${
                  isSelected
                    ? "bg-stone-900 text-white font-bold shadow-xs scale-102"
                    : "bg-white hover:bg-stone-100 text-stone-700 border border-stone-200 hover:text-stone-950"
                }`}
              >
                <span className="font-mono text-[10px] opacity-60">{idx + 1}.</span>
                <span className="truncate max-w-[120px]">{w.word}</span>
                {w.completed && <CheckCircle2 className={`w-3 h-3 ${isSelected ? "text-amber-400" : "text-emerald-600"}`} />}
              </button>
            );
          })}
        </div>
      )}

      {/* Main Content Area */}
      <main
        className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 sm:py-6 space-y-4 max-w-4xl w-full mx-auto bg-stone-50/30"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {currentWord ? (
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={currentWord.id || safeIndex}
              initial={{ opacity: 0, x: navDirection * 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -navDirection * 20 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className="space-y-4"
            >
              {/* Success Banner if Regenerated */}
              {regeneratedSuccessId === currentWord.id && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-900 text-xs font-medium flex items-center justify-between gap-2 flex-wrap shadow-2xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span className="font-semibold">{t("gallery_regenerated_success", appLanguage) || "Word details regenerated successfully with AI!"}</span>
                  </div>
                  {lastEnrichmentMetadata?.model && (
                    <span className="font-mono text-[11px] text-emerald-800 bg-white px-2 py-0.5 rounded border border-emerald-300 flex items-center gap-1 shrink-0">
                      <Bot className="w-3 h-3 text-emerald-600" />
                      {lastEnrichmentMetadata.model}
                    </span>
                  )}
                </div>
              )}

              {/* Word Card container */}
              <div className="bg-white border border-stone-200 rounded-2xl p-4 sm:p-6 space-y-5 shadow-xs">
                {/* Top Word Header Row */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-stone-200">
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <h2 className="text-2xl sm:text-3xl font-bold text-stone-900 tracking-tight font-serif">
                        {currentWord.word}
                      </h2>
                      <button
                        type="button"
                        onClick={() => speakText(currentWord.word)}
                        className="p-1.5 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-700 border border-stone-200 transition-colors cursor-pointer"
                        title="Listen Pronunciation"
                      >
                        <Volume2 className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Meta Tags Row */}
                    <div className="flex items-center gap-2 flex-wrap">
                      {currentWord.pronunciation && (
                        <span className="text-xs font-mono text-stone-600 bg-stone-100 border border-stone-200 px-2 py-0.5 rounded">
                          {currentWord.pronunciation}
                        </span>
                      )}
                      <span className="text-[10px] font-bold uppercase font-mono bg-stone-100 text-stone-700 px-2 py-0.5 rounded tracking-wider border border-stone-200">
                        {currentWord.partOfSpeech || "word"}
                      </span>
                      {currentWord.category && (
                        <span className="text-[10px] font-medium bg-amber-50 text-amber-800 border border-amber-200 px-2 py-0.5 rounded flex items-center gap-1">
                          <span>🏷️</span>
                          <span>{currentWord.category}</span>
                        </span>
                      )}
                      <span className="text-[10px] font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded flex items-center gap-1">
                        <Sparkles className="w-2.5 h-2.5 text-emerald-600" />
                        <span>Auto-Enriched</span>
                      </span>
                      {/* Enriched AI Model Pill */}
                      <span
                        className="text-[10px] font-mono font-semibold text-sky-800 bg-sky-50 border border-sky-200 px-2 py-0.5 rounded flex items-center gap-1.5 shadow-2xs"
                        title={`AI Model used to enrich: ${formattedModelName}${providerDisplayName ? ` via ${providerDisplayName}` : ""}`}
                      >
                        <Bot className="w-2.5 h-2.5 text-sky-600 shrink-0" />
                        <span>{formattedModelName}</span>
                        {providerDisplayName && (
                          <span className="text-sky-600 text-[9px] font-sans font-normal">({providerDisplayName})</span>
                        )}
                      </span>
                    </div>
                  </div>

                  {/* Quick Card Controls */}
                  <div className="flex items-center gap-2 shrink-0 flex-wrap">
                    {onToggleStar && (
                      <button
                        type="button"
                        onClick={() => onToggleStar(currentWord.id)}
                        className={`p-2 rounded-xl border transition-colors cursor-pointer ${
                          currentWord.starred
                            ? "bg-amber-50 text-amber-600 border-amber-300"
                            : "bg-white text-stone-400 border-stone-200 hover:text-stone-700 hover:bg-stone-50"
                        }`}
                        title="Toggle Star"
                      >
                        <Star className={`w-4 h-4 ${currentWord.starred ? "fill-amber-400 text-amber-500" : ""}`} />
                      </button>
                    )}

                    {onToggleLearned && (
                      <button
                        type="button"
                        onClick={() => onToggleLearned(currentWord.id)}
                        className={`px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
                          currentWord.learned
                            ? "bg-emerald-50 text-emerald-800 border-emerald-300"
                            : "bg-white text-stone-600 border-stone-200 hover:bg-stone-50"
                        }`}
                      >
                        <span className={`w-2 h-2 rounded-full ${currentWord.learned ? "bg-emerald-500" : "bg-stone-400"}`} />
                        <span>{currentWord.learned ? "Mastered" : "Learning"}</span>
                      </button>
                    )}

                    {onAddWord && (
                      <button
                        type="button"
                        onClick={() => onAddWord(currentWord.word, currentWord.context || currentWord.definition || currentWord.translation, currentWord)}
                        className="p-2 rounded-xl bg-white hover:bg-stone-50 text-stone-600 border border-stone-200 transition-colors cursor-pointer"
                        title="Edit word details"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>
                    )}

                    {onAskAi && (
                      <button
                        type="button"
                        onClick={() => onAskAi(currentWord)}
                        className="px-3 py-1.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                        title="Ask AI about this word"
                      >
                        <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                        <span>Ask AI</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Meaning Highlight Block */}
                <div className="bg-amber-50/80 border border-amber-200/80 p-4 rounded-xl space-y-1">
                  <span className="text-[10px] font-bold uppercase text-amber-900 tracking-wider block font-mono">
                    Meaning / Translation
                  </span>
                  <p className="text-base sm:text-lg font-bold text-stone-900 leading-snug">
                    {currentWord.translation || "No translation available"}
                  </p>
                </div>

                {/* Definition Block */}
                {currentWord.definition && (
                  <div className="space-y-1 bg-stone-50 border border-stone-200/80 p-3.5 sm:p-4 rounded-xl">
                    <span className="text-[10px] font-mono font-bold uppercase text-stone-500 tracking-wider block">
                      Definition ({targetLanguage})
                    </span>
                    <p className="text-xs sm:text-sm text-stone-800 font-serif italic leading-relaxed">
                      "{currentWord.definition}"
                    </p>
                  </div>
                )}

                {/* Context & Usage Domain */}
                {currentWord.context && (
                  <div className="space-y-1 bg-stone-50/70 border border-stone-200/70 p-3.5 rounded-xl">
                    <span className="text-[10px] font-mono font-bold uppercase text-stone-500 tracking-wider block">
                      Usage Context & Domain
                    </span>
                    <p className="text-xs text-stone-700 leading-relaxed font-sans">
                      {currentWord.context}
                    </p>
                  </div>
                )}

                {/* Context Example Sentence */}
                {currentWord.example && (
                  <div className="bg-stone-50 border border-stone-200/80 p-4 rounded-xl space-y-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-stone-500 block">
                        Example Sentence
                      </span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {currentWord.exampleTranslation && (
                          <button
                            type="button"
                            onClick={() => setShowExampleTranslation((prev) => !prev)}
                            className={`px-2 py-1 rounded-lg border text-[11px] transition-colors flex items-center gap-1 cursor-pointer ${
                              showExampleTranslation
                                ? "bg-amber-100 text-amber-900 border-amber-300 font-semibold"
                                : "bg-white text-stone-600 border-stone-200 hover:bg-stone-50"
                            }`}
                            title={showExampleTranslation ? "Hide sentence translation" : "Show sentence translation"}
                          >
                            <Languages className="w-3.5 h-3.5" />
                            <span className="text-[10px]">{showExampleTranslation ? "Hide" : "Translate"}</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => speakText(currentWord.example!)}
                          className="p-1 rounded-lg border border-stone-200 bg-white hover:bg-stone-50 text-stone-700 transition-colors flex items-center justify-center cursor-pointer"
                          title="Listen to example sentence"
                        >
                          <Volume2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <p className="font-serif italic text-stone-900 text-sm leading-relaxed">
                      "{currentWord.example}"
                    </p>

                    {currentWord.exampleTranslation && showExampleTranslation && (
                      <p className="text-xs text-stone-600 font-sans border-t border-stone-200 pt-2 mt-1.5">
                        {currentWord.exampleTranslation}
                      </p>
                    )}
                  </div>
                )}

                {/* Suggested Companion Vocabulary */}
                {currentWord.suggestedWords && currentWord.suggestedWords.length > 0 && (
                  <div className="space-y-2 pt-1">
                    <span className="text-[10px] font-mono font-bold uppercase text-stone-500 tracking-wider block">
                      Commonly Paired Vocabulary
                    </span>
                    <div className="flex items-center gap-2 flex-wrap">
                      {currentWord.suggestedWords.map((s, idx) => {
                        const sWordText = typeof s === "string" ? s : s.word;
                        const sWordTranslation = typeof s === "string" ? undefined : s.translation;
                        const isAdded = addedSuggestedWords.has(sWordText);
                        return (
                          <div
                            key={idx}
                            className="px-2.5 py-1 rounded-lg bg-stone-100 border border-stone-200 flex items-center gap-2 text-xs"
                          >
                            <span className="font-bold text-stone-800">{sWordText}</span>
                            {sWordTranslation && <span className="text-stone-500 text-[11px]">— {sWordTranslation}</span>}
                            {onAddWord && (
                              <button
                                type="button"
                                onClick={() => handleAddSuggestedWord(sWordText, sWordTranslation)}
                                disabled={isAdded}
                                className={`p-1 rounded text-[10px] font-semibold transition-colors cursor-pointer ${
                                  isAdded
                                    ? "text-emerald-700 bg-emerald-100"
                                    : "text-amber-800 hover:text-amber-900 bg-amber-100 hover:bg-amber-200"
                                }`}
                                title={isAdded ? "Added to collection" : "Add to collection"}
                              >
                                {isAdded ? <Check className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Visual Word Images Section */}
                <div className="pt-2 border-t border-stone-200">
                  <WordImageGallery
                    word={currentWord}
                    onImagesChange={handleImagesChange}
                    llmConfig={llmConfig}
                    className="rounded-xl border-stone-200 bg-stone-50/50"
                  />
                </div>

                {/* Memory Strength, SRS Info, & AI Model */}
                <div className="pt-3 border-t border-stone-200 flex flex-wrap items-center justify-between gap-2.5 text-xs text-stone-600">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[10px] text-stone-500 uppercase font-mono">Memory Strength:</span>
                    <MemoryStrengthBar strength={currentWord.strength || 0} />
                  </div>

                  <div className="flex items-center gap-3 shrink-0 flex-wrap">
                    <div className="flex items-center gap-1.5 text-[10px] font-mono">
                      <span className="text-stone-500">{t("gallery_model_label", appLanguage) || "Model"}:</span>
                      <span className="text-stone-800 bg-stone-100 px-2 py-0.5 rounded border border-stone-200 flex items-center gap-1 font-semibold">
                        <Bot className="w-2.5 h-2.5 text-stone-600" />
                        {formattedModelName}
                        {providerDisplayName && <span className="opacity-70 font-normal">({providerDisplayName})</span>}
                      </span>
                    </div>

                    {currentWord.lastReviewed && (
                      <span className="text-[10px] text-stone-500 font-mono">
                        Reviewed: {new Date(currentWord.lastReviewed).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </div>

                {/* Regenerated Response Metadata */}
                {lastEnrichmentMetadata && regeneratedSuccessId === currentWord.id && (
                  <LlmResponseMetadata
                    provider={lastEnrichmentMetadata.provider || effectiveWordProvider}
                    model={lastEnrichmentMetadata.model || effectiveWordModel}
                    responseTimeMs={lastEnrichmentMetadata.responseTimeMs}
                    dark={false}
                    className="mt-2 pt-2 border-stone-200"
                  />
                )}
              </div>
            </motion.div>
          </AnimatePresence>
        ) : (
          <div className="p-12 text-center space-y-3 bg-white rounded-2xl border border-stone-200 shadow-xs">
            <BookOpen className="w-8 h-8 text-stone-400 mx-auto" />
            <h4 className="text-sm font-bold text-stone-800">
              {t("gallery_empty_title", appLanguage) || "No Enriched Words Found"}
            </h4>
            <p className="text-xs text-stone-500 max-w-sm mx-auto">
              {t("gallery_empty_desc", appLanguage) || "No auto-completed words are available to display right now."}
            </p>
          </div>
        )}
      </main>

      {/* Gallery Navigation and Action Bar Footer matching Ask AI / WordAddModal */}
      <footer className="border-t border-stone-200 bg-white p-3 sm:px-6 py-2.5 sm:py-3 shrink-0 shadow-2xs z-10">
        <div className="max-w-4xl w-full mx-auto flex items-center justify-between gap-3">
          {/* Previous Button */}
          <button
            type="button"
            onClick={handlePrev}
            disabled={wordsCount <= 1}
            className="px-3.5 py-2 rounded-xl bg-white hover:bg-stone-50 disabled:opacity-40 disabled:cursor-not-allowed text-stone-700 border border-stone-200 font-semibold text-xs flex items-center gap-1.5 transition-all cursor-pointer shadow-2xs"
            title="Previous Word (Arrow Left)"
          >
            <ChevronLeft className="w-4 h-4" />
            <span className="hidden sm:inline">{t("gallery_nav_prev", appLanguage) || "Previous"}</span>
          </button>

          {/* Center: Regenerate Current Word Button */}
          <button
            type="button"
            onClick={handleRegenerateWord}
            disabled={!currentWord || isRegenerating}
            className="px-4 py-2 sm:px-5 sm:py-2.5 rounded-xl bg-stone-900 hover:bg-stone-800 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-xs sm:text-sm flex items-center gap-2 transition-all cursor-pointer shadow-xs active:scale-98"
            title="Regenerate this word's definition and examples with AI (R)"
          >
            <RefreshCw className={`w-4 h-4 ${isRegenerating ? "animate-spin" : ""}`} />
            <span>
              {isRegenerating
                ? t("gallery_regenerating", appLanguage) || "Regenerating..."
                : t("gallery_regenerate_word", appLanguage) || "Regenerate Word"}
            </span>
          </button>

          {/* Next Button */}
          <button
            type="button"
            onClick={handleNext}
            disabled={wordsCount <= 1}
            className="px-3.5 py-2 rounded-xl bg-white hover:bg-stone-50 disabled:opacity-40 disabled:cursor-not-allowed text-stone-700 border border-stone-200 font-semibold text-xs flex items-center gap-1.5 transition-all cursor-pointer shadow-2xs"
            title="Next Word (Arrow Right)"
          >
            <span className="hidden sm:inline">{t("gallery_nav_next", appLanguage) || "Next"}</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </footer>
    </motion.div>,
    document.body
  );
};

export default EnrichedWordsGalleryModal;
