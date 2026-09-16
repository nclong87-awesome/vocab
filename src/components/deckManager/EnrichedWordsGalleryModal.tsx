import React, { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import {
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
  const activeAutoCand = (!llmConfig?.provider || llmConfig.provider === "auto" || !llmConfig.model || llmConfig.model === "auto")
    ? getAutoCandidateWithMeta(llmConfig, undefined, false).candidate
    : null;

  const currentWordEnrichmentModel = currentWord?.enrichmentModel || (regeneratedSuccessId === currentWord?.id ? lastEnrichmentMetadata?.model : undefined) || (activeAutoCand ? activeAutoCand.model : llmConfig?.model) || "gemini-3.5-flash-lite";
  const currentWordEnrichmentProvider = currentWord?.enrichmentProvider || (regeneratedSuccessId === currentWord?.id ? lastEnrichmentMetadata?.provider : undefined) || (activeAutoCand ? activeAutoCand.provider : llmConfig?.provider) || "auto";

  const formattedModelName = formatModelDisplayName(currentWordEnrichmentModel);
  const providerMeta = PROVIDER_OPTIONS.find((p) => p.id === currentWordEnrichmentProvider);
  const providerDisplayName = providerMeta ? providerMeta.name.replace(/\s*\(Default\)/i, "") : (currentWordEnrichmentProvider && currentWordEnrichmentProvider !== "auto" ? currentWordEnrichmentProvider.charAt(0).toUpperCase() + currentWordEnrichmentProvider.slice(1) : "");

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
          cfg: newConfig
        });

        if (data && data.word) {
          const isPv = isPhrasalVerb(data.word, data.partOfSpeech, data.category);
          const normalizedPos = normalizeWordPartOfSpeech(data.partOfSpeech, data.word, data.category);
          const normalizedCategory = isPv
            ? normalizeWordCategory(data.category, data.word, normalizedPos)
            : data.category || currentWord.category || "General";

          const usedProvider = data.provider || newConfig.provider || llmConfig?.provider || "auto";
          const usedModel = data.model || newConfig.model || llmConfig?.model || "auto";

          setLastEnrichmentMetadata({
            provider: usedProvider,
            model: formatModelDisplayName(usedModel),
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
            enrichmentModel: data.model || usedModel,
            enrichmentProvider: data.provider || usedProvider,
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
        cfg: llmConfig
      });

      if (data && data.word) {
        const isPv = isPhrasalVerb(data.word, data.partOfSpeech, data.category);
        const normalizedPos = normalizeWordPartOfSpeech(data.partOfSpeech, data.word, data.category);
        const normalizedCategory = isPv
          ? normalizeWordCategory(data.category, data.word, normalizedPos)
          : data.category || currentWord.category || "General";

        const usedProvider = data.provider || llmConfig?.provider || "auto";
        const usedModel = data.model || llmConfig?.model || "auto";

        setLastEnrichmentMetadata({
          provider: usedProvider,
          model: formatModelDisplayName(usedModel),
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
          enrichmentModel: data.model || usedModel,
          enrichmentProvider: data.provider || usedProvider,
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-stone-950/75 backdrop-blur-xs overflow-y-auto">
      <div className="relative w-full max-w-3xl my-auto bg-stone-900 border border-stone-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header Bar */}
        <div className="px-4 py-3.5 sm:px-6 bg-stone-900 border-b border-stone-800 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
              <Sparkles className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm sm:text-base font-bold text-stone-100 truncate">
                  {t("gallery_enriched_modal_title", appLanguage) || "Enriched Words Gallery"}
                </h3>
                {wordsCount > 0 && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 shrink-0">
                    {t("gallery_word_counter", appLanguage, {
                      current: String(safeIndex + 1),
                      total: String(wordsCount)
                    }) || `${safeIndex + 1} / ${wordsCount}`}
                  </span>
                )}
                {/* AI Model Badge in Modal Header */}
                <span
                  className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-sky-950/80 text-sky-300 border border-sky-600/50 flex items-center gap-1.5 shrink-0 shadow-2xs"
                  title={`AI Model: ${formattedModelName}${providerDisplayName ? ` (${providerDisplayName})` : ""}`}
                >
                  <Bot className="w-3 h-3 text-sky-400 shrink-0" />
                  <span className="truncate max-w-[130px] sm:max-w-[200px]">
                    {formattedModelName}
                  </span>
                  {providerDisplayName && (
                    <span className="text-sky-400/70 text-[9px] font-sans font-normal hidden sm:inline">
                      • {providerDisplayName}
                    </span>
                  )}
                </span>
              </div>
              <p className="text-[11px] text-stone-400 truncate">
                {t("incomplete_words_rule_explainer", appLanguage) || "Review enriched words, navigate forward/backward, and regenerate with AI."}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-stone-400 hover:text-stone-100 hover:bg-stone-800 transition-colors cursor-pointer"
              title="Close Gallery (Esc)"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Word Thumbnail / Pills Selector Strip */}
        {wordsCount > 1 && (
          <div
            ref={wordPillsRef}
            className="px-4 py-2 bg-stone-950/60 border-b border-stone-800/80 flex items-center gap-1.5 overflow-x-auto scrollbar-none shrink-0"
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
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 shrink-0 cursor-pointer ${
                    isSelected
                      ? "bg-amber-500 text-stone-950 font-bold shadow-xs scale-102"
                      : "bg-stone-800/80 hover:bg-stone-800 text-stone-300 border border-stone-700/60 hover:text-white"
                  }`}
                >
                  <span className="font-mono text-[10px] opacity-75">{idx + 1}.</span>
                  <span className="truncate max-w-[120px]">{w.word}</span>
                  {w.completed && <CheckCircle2 className={`w-3 h-3 ${isSelected ? "text-stone-950" : "text-emerald-400"}`} />}
                </button>
              );
            })}
          </div>
        )}

        {/* Main Content Area */}
        <div
          className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-4 bg-stone-900"
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
                  <div className="p-3 bg-emerald-950/70 border border-emerald-500/40 rounded-xl text-emerald-200 text-xs font-bold flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 min-w-0">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                      <span>{t("gallery_regenerated_success", appLanguage) || "Word details regenerated successfully with AI!"}</span>
                    </div>
                    {lastEnrichmentMetadata?.model && (
                      <span className="font-mono text-[11px] text-emerald-300 bg-emerald-900/60 px-2 py-0.5 rounded border border-emerald-700/50 flex items-center gap-1 shrink-0">
                        <Bot className="w-3 h-3 text-emerald-400" />
                        {lastEnrichmentMetadata.model}
                      </span>
                    )}
                  </div>
                )}

                {/* Word Card Cardboard container */}
                <div className="bg-stone-850 border border-stone-700 rounded-xl p-4 sm:p-5 space-y-4 shadow-md">
                  {/* Top Word Header Row */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-stone-750">
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <h2 className="text-2xl sm:text-3xl font-bold text-stone-100 tracking-tight font-serif">
                          {currentWord.word}
                        </h2>
                        <button
                          type="button"
                          onClick={() => speakText(currentWord.word)}
                          className="p-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 transition-colors cursor-pointer"
                          title="Listen Pronunciation (Space)"
                        >
                          <Volume2 className="w-4 h-4" />
                        </button>
                      </div>

                      {/* Meta Tags Row: Pronunciation, Part of Speech, Category */}
                      <div className="flex items-center gap-2 flex-wrap">
                        {currentWord.pronunciation && (
                          <span className="text-xs font-mono text-stone-300 bg-stone-800 border border-stone-700 px-2 py-0.5 rounded">
                            {currentWord.pronunciation}
                          </span>
                        )}
                        <span className="text-[10px] font-bold uppercase font-mono bg-stone-700 text-amber-300 px-2 py-0.5 rounded tracking-wider border border-stone-600">
                          {currentWord.partOfSpeech || "word"}
                        </span>
                        {currentWord.category && (
                          <span className="text-[10px] font-medium bg-amber-950/60 text-amber-300 border border-amber-800/60 px-2 py-0.5 rounded flex items-center gap-1">
                            <span>🏷️</span>
                            <span>{currentWord.category}</span>
                          </span>
                        )}
                        <span className="text-[10px] font-semibold text-emerald-300 bg-emerald-950/60 border border-emerald-800/60 px-2 py-0.5 rounded flex items-center gap-1">
                          <Sparkles className="w-2.5 h-2.5" />
                          <span>Auto-Enriched</span>
                        </span>
                        {/* Enriched AI Model Pill */}
                        <span
                          className="text-[10px] font-mono font-semibold text-sky-300 bg-sky-950/70 border border-sky-600/50 px-2 py-0.5 rounded flex items-center gap-1.5 shadow-2xs"
                          title={`AI Model used to enrich: ${formattedModelName}${providerDisplayName ? ` via ${providerDisplayName}` : ""}`}
                        >
                          <Bot className="w-2.5 h-2.5 text-sky-400 shrink-0" />
                          <span>{formattedModelName}</span>
                          {providerDisplayName && (
                            <span className="text-sky-400/70 text-[9px] font-sans font-normal">({providerDisplayName})</span>
                          )}
                        </span>
                      </div>
                    </div>

                    {/* Quick Card Controls */}
                    <div className="flex items-center gap-2 shrink-0">
                      {onToggleStar && (
                        <button
                          type="button"
                          onClick={() => onToggleStar(currentWord.id)}
                          className={`p-2 rounded-lg border transition-colors cursor-pointer ${
                            currentWord.starred
                              ? "bg-amber-500/20 text-amber-400 border-amber-500/40"
                              : "bg-stone-800 text-stone-400 border-stone-700 hover:text-stone-200"
                          }`}
                          title="Toggle Star"
                        >
                          <Star className={`w-4 h-4 ${currentWord.starred ? "fill-amber-400" : ""}`} />
                        </button>
                      )}

                      {onToggleLearned && (
                        <button
                          type="button"
                          onClick={() => onToggleLearned(currentWord.id)}
                          className={`px-3 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
                            currentWord.learned
                              ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                              : "bg-stone-800 text-stone-300 border-stone-700 hover:text-stone-100"
                          }`}
                        >
                          <span className={`w-2 h-2 rounded-full ${currentWord.learned ? "bg-emerald-400" : "bg-stone-500"}`} />
                          <span>{currentWord.learned ? "Mastered" : "Learning"}</span>
                        </button>
                      )}

                      {onAddWord && (
                        <button
                          type="button"
                          onClick={() => onAddWord(currentWord.word, currentWord.context || currentWord.definition || currentWord.translation, currentWord)}
                          className="p-2 rounded-lg bg-stone-800 hover:bg-stone-750 text-stone-300 border border-stone-700 transition-colors cursor-pointer"
                          title="Edit word details"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Meaning Highlight Block */}
                  <div className="bg-amber-950/30 border border-amber-500/30 p-3.5 rounded-xl space-y-1">
                    <span className="text-[10px] font-bold uppercase text-amber-400 tracking-wider block">
                      Meaning / Translation
                    </span>
                    <p className="text-base sm:text-lg font-bold text-stone-100 leading-snug">
                      {currentWord.translation || "No translation available"}
                    </p>
                  </div>

                  {/* Definition Block */}
                  {currentWord.definition && (
                    <div className="space-y-1 bg-stone-900/90 border border-stone-750 p-3 rounded-xl">
                      <span className="text-[10px] font-mono font-bold uppercase text-stone-400 tracking-wider block">
                        Definition ({targetLanguage})
                      </span>
                      <p className="text-xs sm:text-sm text-stone-200 font-serif italic leading-relaxed">
                        "{currentWord.definition}"
                      </p>
                    </div>
                  )}

                  {/* Context & Usage Domain */}
                  {currentWord.context && (
                    <div className="space-y-1 bg-stone-900/60 border border-stone-800 p-3 rounded-xl">
                      <span className="text-[10px] font-mono font-bold uppercase text-stone-400 tracking-wider block">
                        Usage Context & Domain
                      </span>
                      <p className="text-xs text-stone-300 leading-relaxed font-sans">
                        {currentWord.context}
                      </p>
                    </div>
                  )}

                  {/* Context Example Sentence */}
                  {currentWord.example && (
                    <div className="bg-stone-900/80 border border-stone-750 p-3.5 rounded-xl space-y-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-stone-400 block">
                          Example Sentence
                        </span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {currentWord.exampleTranslation && (
                            <button
                              type="button"
                              onClick={() => setShowExampleTranslation((prev) => !prev)}
                              className={`p-1 rounded border text-[11px] transition-colors flex items-center gap-1 cursor-pointer ${
                                showExampleTranslation
                                  ? "bg-amber-500/20 text-amber-300 border-amber-500/30"
                                  : "bg-stone-800 text-stone-400 border-stone-700 hover:text-stone-200"
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
                            className="p-1 rounded border border-stone-700 bg-stone-800 hover:bg-stone-750 text-stone-300 transition-colors flex items-center justify-center cursor-pointer"
                            title="Listen to example sentence"
                          >
                            <Volume2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      <p className="font-serif italic text-stone-100 text-sm leading-relaxed">
                        "{currentWord.example}"
                      </p>

                      {currentWord.exampleTranslation && showExampleTranslation && (
                        <p className="text-xs text-stone-400 font-sans border-t border-stone-800 pt-1.5 mt-1">
                          {currentWord.exampleTranslation}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Suggested Companion Vocabulary */}
                  {currentWord.suggestedWords && currentWord.suggestedWords.length > 0 && (
                    <div className="space-y-2 pt-1">
                      <span className="text-[10px] font-mono font-bold uppercase text-stone-400 tracking-wider block">
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
                              className="px-2.5 py-1 rounded-lg bg-stone-800 border border-stone-700 flex items-center gap-2 text-xs"
                            >
                              <span className="font-bold text-stone-200">{sWordText}</span>
                              {sWordTranslation && <span className="text-stone-400 text-[11px]">— {sWordTranslation}</span>}
                              {onAddWord && (
                                <button
                                  type="button"
                                  onClick={() => handleAddSuggestedWord(sWordText, sWordTranslation)}
                                  disabled={isAdded}
                                  className={`p-1 rounded text-[10px] font-semibold transition-colors cursor-pointer ${
                                    isAdded
                                      ? "text-emerald-400 bg-emerald-950/40"
                                      : "text-amber-400 hover:text-amber-300 bg-amber-500/15 hover:bg-amber-500/25"
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
                  <div className="pt-2 border-t border-stone-800">
                    <WordImageGallery
                      word={currentWord}
                      onImagesChange={handleImagesChange}
                      llmConfig={llmConfig}
                      className="rounded-xl border-stone-700 bg-stone-900"
                    />
                  </div>

                  {/* Memory Strength, SRS Info, & AI Model */}
                  <div className="pt-3 border-t border-stone-800 flex flex-wrap items-center justify-between gap-2.5 text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[10px] text-stone-400 uppercase font-mono">Memory Strength:</span>
                      <MemoryStrengthBar strength={currentWord.strength || 0} />
                    </div>

                    <div className="flex items-center gap-3 shrink-0 flex-wrap">
                      <div className="flex items-center gap-1.5 text-[10px] font-mono">
                        <span className="text-stone-400">{t("gallery_model_label", appLanguage) || "Model"}:</span>
                        <span className="text-sky-300 bg-sky-950/60 px-2 py-0.5 rounded border border-sky-800/60 flex items-center gap-1 font-semibold">
                          <Bot className="w-2.5 h-2.5 text-sky-400" />
                          {formattedModelName}
                          {providerDisplayName && <span className="opacity-70 font-normal">({providerDisplayName})</span>}
                        </span>
                      </div>

                      {currentWord.lastReviewed && (
                        <span className="text-[10px] text-stone-400 font-mono">
                          Reviewed: {new Date(currentWord.lastReviewed).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Regenerated Response Metadata */}
                  {lastEnrichmentMetadata && regeneratedSuccessId === currentWord.id && (
                    <LlmResponseMetadata
                      provider={lastEnrichmentMetadata.provider || currentWordEnrichmentProvider}
                      model={lastEnrichmentMetadata.model || formattedModelName}
                      responseTimeMs={lastEnrichmentMetadata.responseTimeMs}
                      dark={true}
                      className="mt-2 pt-2 border-stone-800"
                    />
                  )}
                </div>
              </motion.div>
            </AnimatePresence>
          ) : (
            <div className="p-12 text-center space-y-3 bg-stone-850 rounded-xl border border-stone-800">
              <BookOpen className="w-8 h-8 text-stone-500 mx-auto" />
              <h4 className="text-sm font-bold text-stone-200">
                {t("gallery_empty_title", appLanguage) || "No Enriched Words Found"}
              </h4>
              <p className="text-xs text-stone-400 max-w-sm mx-auto">
                {t("gallery_empty_desc", appLanguage) || "No auto-completed words are available to display right now."}
              </p>
            </div>
          )}
        </div>

        {/* Gallery Navigation and Action Bar Footer */}
        <div className="px-4 py-3 sm:px-6 bg-stone-900 border-t border-stone-800 flex items-center justify-between gap-3 shrink-0">
          {/* Previous Button */}
          <button
            type="button"
            onClick={handlePrev}
            disabled={wordsCount <= 1}
            className="px-3.5 py-2 rounded-xl bg-stone-800 hover:bg-stone-750 disabled:opacity-40 disabled:cursor-not-allowed text-stone-200 border border-stone-700 font-semibold text-xs flex items-center gap-1.5 transition-all cursor-pointer shadow-xs"
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
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-amber-400 hover:from-amber-400 hover:to-amber-300 disabled:opacity-50 disabled:cursor-not-allowed text-stone-950 font-bold text-xs flex items-center gap-2 transition-all cursor-pointer shadow-sm hover:shadow-amber-500/20"
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
            className="px-3.5 py-2 rounded-xl bg-stone-800 hover:bg-stone-750 disabled:opacity-40 disabled:cursor-not-allowed text-stone-200 border border-stone-700 font-semibold text-xs flex items-center gap-1.5 transition-all cursor-pointer shadow-xs"
            title="Next Word (Arrow Right)"
          >
            <span className="hidden sm:inline">{t("gallery_nav_next", appLanguage) || "Next"}</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default EnrichedWordsGalleryModal;
