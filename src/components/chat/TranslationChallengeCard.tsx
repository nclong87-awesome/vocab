import { useState, useMemo, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import { 
  Languages, 
  Sparkles, 
  CheckCircle2, 
  AlertCircle, 
  AlertTriangle,
  TrendingUp,
  Trophy,
  Plus, 
  Check, 
  Lightbulb, 
  Brain,
  ChevronDown,
  ChevronUp,
  Volume2,
  Square,
  Mic,
  Send,
  X,
  CornerDownLeft
} from "lucide-react";
import { ChallengeData, ChallengeEvaluation, Word, ChallengeSuggestedVocab, TTSConfig, LLMConfig } from "../../types";
import { isWordInCollection, findWordInCollection } from "../../utils/wordNormalization";
import { speakText, stopSpeech, buildEssentialChallengeAudioText } from "../../utils/ttsService";
import { useSpeechToText } from "../../hooks/useSpeechToText";
import { useVirtualKeyboard } from "../../hooks/useVirtualKeyboard";
import LlmResponseMetadata from "./LlmResponseMetadata";
import TranslationChallengeAskAiModal from "./TranslationChallengeAskAiModal";
import WordReviewedBanner from "./WordReviewedBanner";
import StrengthHistoryModal from "../analytics/StrengthHistoryModal";
import WordChatModal from "./WordChatModal";

interface TranslationChallengeCardProps {
  challenge?: ChallengeData;
  evaluation?: ChallengeEvaluation;
  appLanguage?: string;
  targetLanguage?: string;
  nativeLanguage?: string;
  ttsConfig?: TTSConfig;
  llmConfig?: LLMConfig;
  provider?: string;
  model?: string;
  responseTimeMs?: number;
  words?: Word[];
  onAddWord?: (wordText?: string, hint?: string, extraData?: Partial<Word>) => void;
  onAddIncompleteWord?: (wordData: Partial<Word>) => void;
  onAddMultipleWords?: (words: any[]) => void;
  onUpdateWords?: (updatedWords: Word[]) => void;
  onPlayAudio?: (wordText: string) => void;
  onViewHistory?: (word: Word) => void;
  onAskAi?: (word: Word) => void;
  showToast?: (msg: string) => void;
  onSubmitAnswer?: (answer: string, options?: { source?: string }) => Promise<void> | void;
}

export default function TranslationChallengeCard({
  challenge,
  evaluation,
  appLanguage: _appLanguage,
  targetLanguage = "English",
  nativeLanguage: _nativeLanguage,
  ttsConfig,
  llmConfig,
  provider,
  model,
  responseTimeMs,
  words = [],
  onAddWord,
  onAddIncompleteWord,
  onAddMultipleWords,
  onUpdateWords,
  onPlayAudio,
  onViewHistory,
  onAskAi,
  showToast,
  onSubmitAnswer,
}: TranslationChallengeCardProps) {
  const [showVocabHints, setShowVocabHints] = useState(false);
  const [addedWordKeys, setAddedWordKeys] = useState<Record<string, boolean>>({});
  const hintsContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [userAnswer, setUserAnswer] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPlayingEssentialAudio, setIsPlayingEssentialAudio] = useState(false);
  const [playingItemKey, setPlayingItemKey] = useState<string | null>(null);
  const [isAskAiModalOpen, setIsAskAiModalOpen] = useState(false);
  const [selectedHistoryWord, setSelectedHistoryWord] = useState<Word | null>(null);
  const [selectedChatWord, setSelectedChatWord] = useState<Word | null>(null);

  // Virtual keyboard detection: ONLY show the in-card sentence banner when virtual keyboard is open
  const isKeyboardOpen = useVirtualKeyboard({ inputRef: textareaRef });

  const effectiveTargetLang = challenge?.targetLanguage || targetLanguage || "English";

  const {
    isListening,
    isSupported: isSpeechSupported,
    startListening,
    stopListening,
  } = useSpeechToText({
    targetLanguage: effectiveTargetLang,
    onTranscript: (transcript) => {
      if (transcript) {
        setUserAnswer((prev) => {
          const trimmed = prev.trim();
          if (!trimmed) return transcript;
          return `${trimmed} ${transcript}`;
        });
      }
    },
    onError: (err) => {
      showToast?.(err);
    },
  });

  const handleToggleVoice = () => {
    if (isListening) {
      stopListening();
    } else {
      startListening(effectiveTargetLang);
    }
  };

  const handleSubmitTranslation = async (answerOverride?: string) => {
    const textToSubmit = answerOverride !== undefined ? answerOverride : userAnswer.trim();
    if (!textToSubmit && answerOverride === undefined) return;
    if (isListening) {
      stopListening();
    }
    setIsSubmitting(true);
    try {
      if (onSubmitAnswer) {
        await onSubmitAnswer(textToSubmit, { source: "challenge_card" });
      }
      setUserAnswer("");
    } catch (err: any) {
      showToast?.(err?.message || "Failed to submit answer.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAnswerKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.key === "Enter" && !e.shiftKey) || ((e.ctrlKey || e.metaKey) && e.key === "Enter")) {
      e.preventDefault();
      handleSubmitTranslation();
    }
  };

  const activeProvider = provider || challenge?.provider || evaluation?.provider;
  const activeModel = model || challenge?.model || evaluation?.model;
  const activeResponseTimeMs = responseTimeMs ?? challenge?.responseTimeMs ?? evaluation?.responseTimeMs;

  const handlePlayEssentialAudio = () => {
    if (!evaluation) return;

    if (isPlayingEssentialAudio) {
      stopSpeech();
      setIsPlayingEssentialAudio(false);
      return;
    }

    stopSpeech();
    setPlayingItemKey(null);

    const targetWordText = evaluation.targetWordUsed || challenge?.targetWordFromCollection?.word;
    const audioText = buildEssentialChallengeAudioText(
      evaluation.score,
      evaluation.scoreLabel,
      evaluation.correctedSentence,
      targetWordText
    );

    speakText(
      audioText,
      ttsConfig,
      llmConfig,
      targetLanguage || "English",
      () => setIsPlayingEssentialAudio(true),
      () => setIsPlayingEssentialAudio(false)
    ).catch(() => setIsPlayingEssentialAudio(false));
  };

  const handlePlayText = (text: string, customLang?: string, itemKey?: string) => {
    if (!text?.trim()) return;

    if (playingItemKey === itemKey && itemKey) {
      stopSpeech();
      setPlayingItemKey(null);
      return;
    }

    stopSpeech();
    setIsPlayingEssentialAudio(false);

    if (itemKey) setPlayingItemKey(itemKey);

    speakText(
      text,
      ttsConfig,
      llmConfig,
      customLang || targetLanguage || "English",
      () => {
        if (itemKey) setPlayingItemKey(itemKey);
      },
      () => {
        if (itemKey) setPlayingItemKey((current) => (current === itemKey ? null : current));
      }
    ).catch(() => {
      if (itemKey) setPlayingItemKey((current) => (current === itemKey ? null : current));
    });
  };

  const handleAddSingleWord = (
    item:
      | ChallengeSuggestedVocab
      | { word: string; translation: string; hint?: string; partOfSpeech?: string; definition?: string }
  ) => {
    const wordKey = item.word.toLowerCase();
    if (addedWordKeys[wordKey] || isWordInCollection(words, item.word)) return;

    if (onAddIncompleteWord) {
      onAddIncompleteWord({
        word: item.word.trim(),
        translation: item.translation || "",
        definition: (item as any).definition || item.translation || `Key term from translation challenge`,
        partOfSpeech: item.partOfSpeech || "expression",
        category: "Challenge Practice",
        completed: false,
        context: challenge?.nativeSentence
          ? `From challenge: "${challenge.nativeSentence}"`
          : evaluation?.correctedSentence
          ? `From challenge: "${evaluation.correctedSentence}"`
          : undefined,
      });
      setAddedWordKeys((prev) => ({ ...prev, [wordKey]: true }));
    } else if (onAddWord) {
      onAddWord(item.word, (item as any).hint || item.translation, {
        translation: item.translation,
        definition: (item as any).definition || `Key term from translation challenge`,
        partOfSpeech: item.partOfSpeech || "expression",
        category: "Challenge Practice",
      });
      setAddedWordKeys((prev) => ({ ...prev, [wordKey]: true }));
      showToast?.(`Added "${item.word}" to your collection!`);
    }
  };

  const handleAddAllVocab = (vocabList: ChallengeSuggestedVocab[]) => {
    const itemsToAdd = vocabList.filter(
      (v) => !addedWordKeys[v.word.toLowerCase()] && !isWordInCollection(words, v.word)
    );
    if (itemsToAdd.length === 0) return;

    if (onAddIncompleteWord) {
      itemsToAdd.forEach((v) => {
        onAddIncompleteWord({
          word: v.word.trim(),
          translation: v.translation || "",
          definition: v.definition || v.translation || `Key term from translation challenge`,
          partOfSpeech: v.partOfSpeech || "expression",
          category: "Challenge Practice",
          completed: false,
          context: evaluation?.correctedSentence
            ? `From challenge: "${evaluation.correctedSentence}"`
            : undefined,
        });
      });
      const newKeys = { ...addedWordKeys };
      itemsToAdd.forEach((v) => {
        newKeys[v.word.toLowerCase()] = true;
      });
      setAddedWordKeys(newKeys);
      return;
    }

    if (onAddMultipleWords) {
      const formattedWords = itemsToAdd.map((v) => ({
        word: v.word,
        translation: v.translation,
        definition: v.definition || `Key term from translation challenge`,
        partOfSpeech: v.partOfSpeech || "expression",
        category: "Challenge Practice",
        learned: false,
        starred: false,
        completed: false,
        createdAt: new Date().toISOString(),
        lastReviewed: null,
        strength: 0,
      }));

      onAddMultipleWords(formattedWords);

      const newKeys = { ...addedWordKeys };
      itemsToAdd.forEach((v) => {
        newKeys[v.word.toLowerCase()] = true;
      });
      setAddedWordKeys(newKeys);
      showToast?.(`Added ${itemsToAdd.length} words to your collection!`);
    }
  };

  // 1. RENDER CHALLENGE PROMPT CARD (Clean & simplified, no target word revealed)
  if (challenge && !evaluation) {
    return (
      <div id="challenge-prompt-card" className="w-full p-4 sm:p-5 bg-white border border-stone-200/90 rounded-2xl shadow-xs space-y-4">
        {/* Header Badge & Topic Context */}
        <div className="flex items-center justify-between gap-2 flex-wrap pb-1 border-b border-stone-100">
          <div className="flex items-center gap-2">
            <span className="p-1.5 bg-stone-900 text-amber-400 rounded-lg shadow-2xs">
              <Languages className="w-4 h-4" />
            </span>
            <span className="font-bold text-xs sm:text-sm text-stone-900 tracking-tight">
              Translation Challenge
            </span>
          </div>
          {challenge.topicContext && (
            <span className="px-2.5 py-0.5 bg-stone-100 text-stone-700 border border-stone-200 rounded-full text-[11px] font-medium">
              {challenge.topicContext}
            </span>
          )}
        </div>

        {/* Challenge Prompt Sentence */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider font-mono">
              Translate into {challenge.targetLanguage || "English"}:
            </span>
            <button
              id="btn-play-prompt-sentence"
              type="button"
              onClick={() => handlePlayText(challenge.nativeSentence, challenge.nativeLanguage || "Vietnamese", "prompt-sentence")}
              className="p-1 text-stone-400 hover:text-stone-700 hover:bg-stone-100 rounded-lg transition-colors cursor-pointer"
              title="Listen sentence"
            >
              {playingItemKey === "prompt-sentence" ? (
                <Square className="w-3.5 h-3.5 text-amber-600 fill-amber-600 animate-pulse" />
              ) : (
                <Volume2 className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
          <p className="text-base sm:text-lg font-semibold text-stone-900 leading-relaxed font-sans">
            "{challenge.nativeSentence}"
          </p>
        </div>

        {/* Optional Context & Hints */}
        <div className="pt-1 flex items-center justify-between gap-2 flex-wrap text-xs text-stone-600">
          {challenge.personalityNote ? (
            <div className="flex items-center gap-1.5 text-stone-500 text-xs">
              <Sparkles className="w-3.5 h-3.5 text-amber-500 shrink-0" />
              <span className="line-clamp-2">{challenge.personalityNote}</span>
            </div>
          ) : <div />}

          {challenge.keyTargetWords && challenge.keyTargetWords.length > 0 && (
            <button
              id="btn-toggle-vocab-hints"
              type="button"
              onClick={() => {
                setShowVocabHints(prev => {
                  const next = !prev;
                  if (next) {
                    setTimeout(() => {
                      hintsContainerRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
                    }, 80);
                  }
                  return next;
                });
              }}
              className="text-[11px] font-medium text-stone-600 hover:text-stone-900 flex items-center gap-1 transition-colors cursor-pointer ml-auto py-1 px-2 rounded-md hover:bg-stone-100"
            >
              <Lightbulb className="w-3.5 h-3.5 text-amber-500" />
              <span>{showVocabHints ? "Hide Hints" : "Vocab Hints"}</span>
              {showVocabHints ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
          )}
        </div>

        {/* Collapsible Key Target Words Hints */}
        {showVocabHints && challenge.keyTargetWords && (
          <div ref={hintsContainerRef} className="p-3 bg-stone-50 border border-stone-200/80 rounded-xl space-y-2 text-xs">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="font-semibold text-stone-700 block text-[11px] uppercase tracking-wider font-mono">
                Vocab Clues & Options:
              </span>
              {(() => {
                const countInCol = challenge.keyTargetWords.filter(
                  (kw) => isWordInCollection(words, kw.word) || addedWordKeys[kw.word.toLowerCase()]
                ).length;
                return (
                  <span className="text-[11px] text-stone-500">
                    {countInCol > 0 ? (
                      <span className="text-emerald-700 font-medium">
                        {countInCol} {countInCol === 1 ? "word" : "words"} in your collection
                      </span>
                    ) : (
                      <span>Multiple valid options</span>
                    )}
                  </span>
                );
              })()}
            </div>
            <div className="flex flex-wrap gap-2">
              {challenge.keyTargetWords.map((kw, i) => {
                const inCol = isWordInCollection(words, kw.word) || addedWordKeys[kw.word.toLowerCase()];
                const isPlayingKw = playingItemKey === `kw-${i}`;
                return (
                  <div
                    key={i}
                    onClick={() => {
                      if (!inCol) handleAddSingleWord(kw);
                    }}
                    title={inCol ? "Saved in collection" : "Click to add to collection"}
                    className={`px-2.5 py-1 rounded-lg flex items-center gap-2 border transition-all ${
                      inCol
                        ? "bg-emerald-50 border-emerald-200 text-emerald-800 cursor-default"
                        : "bg-white hover:bg-stone-100 border-stone-200 hover:border-stone-300 cursor-pointer active:scale-95"
                    }`}
                  >
                    <button
                      id={`btn-play-clue-${i}`}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handlePlayText(kw.word, challenge.targetLanguage || "English", `kw-${i}`);
                      }}
                      className="text-stone-400 hover:text-stone-800 p-0.5 rounded cursor-pointer transition-colors"
                      title={`Listen "${kw.word}"`}
                    >
                      {isPlayingKw ? (
                        <Square className="w-3 h-3 text-amber-600 fill-amber-600 animate-pulse" />
                      ) : (
                        <Volume2 className="w-3 h-3" />
                      )}
                    </button>
                    <span className="font-medium text-stone-800">{kw.word}</span>
                    <span className="text-stone-500">({kw.translation})</span>
                    {(onAddIncompleteWord || onAddWord) && (
                      <button
                        id={`btn-add-clue-${i}`}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAddSingleWord(kw);
                        }}
                        disabled={inCol}
                        className="ml-1 text-stone-500 hover:text-stone-800 disabled:text-emerald-700 transition-colors cursor-pointer"
                        title={inCol ? "Saved" : "Add to collection"}
                      >
                        {inCol ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Plus className="w-3.5 h-3.5" />}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setUserAnswer((prev) => {
                          const trimmed = prev.trim();
                          return trimmed ? `${trimmed} ${kw.word}` : kw.word;
                        });
                        textareaRef.current?.focus();
                      }}
                      className="text-stone-400 hover:text-stone-700 p-0.5 rounded transition-colors cursor-pointer ml-0.5"
                      title={`Insert "${kw.word}" into your translation`}
                    >
                      <CornerDownLeft className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Answer Textarea Field - Placed right above the Ask AI button */}
        <div className="pt-2 space-y-2">
          {/* Sentence Reference Banner above Textarea - ONLY visible when virtual keyboard is open */}
          <AnimatePresence>
            {isKeyboardOpen && (
              <motion.div
                initial={{ opacity: 0, y: -6, height: 0 }}
                animate={{ opacity: 1, y: 0, height: "auto" }}
                exit={{ opacity: 0, y: -6, height: 0 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className="overflow-hidden"
              >
                <div className="p-2.5 sm:p-3 bg-amber-50/95 border border-amber-300/90 rounded-xl shadow-2xs space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-bold text-amber-900 uppercase tracking-wider font-mono flex items-center gap-1">
                      <Languages className="w-3.5 h-3.5 text-amber-700" />
                      Translate into {effectiveTargetLang}:
                    </span>
                    <button
                      type="button"
                      onClick={() => handlePlayText(challenge.nativeSentence, challenge.nativeLanguage || "Vietnamese", "prompt-sentence-ref")}
                      className="p-1 text-amber-800 hover:text-amber-950 hover:bg-amber-100 rounded-lg transition-colors cursor-pointer"
                      title="Listen sentence"
                    >
                      {playingItemKey === "prompt-sentence-ref" ? (
                        <Square className="w-3.5 h-3.5 text-amber-600 fill-amber-600 animate-pulse" />
                      ) : (
                        <Volume2 className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                  <p className="text-sm sm:text-base font-bold text-stone-900 leading-snug select-text">
                    "{challenge.nativeSentence}"
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex items-center justify-between text-xs px-0.5">
            <label
              htmlFor={`challenge-answer-${challenge.id || "prompt"}`}
              className="font-semibold text-stone-700 flex items-center gap-1.5"
            >
              <span>Your translation ({effectiveTargetLang}):</span>
            </label>
            <span className="text-[11px] text-stone-400 hidden sm:inline font-mono">
              Press Enter ↵ to submit · Shift+Enter for new line
            </span>
          </div>

          <div className="relative border border-stone-200/90 hover:border-stone-300 focus-within:border-stone-400 focus-within:ring-2 focus-within:ring-stone-900/5 bg-stone-50/70 focus-within:bg-white rounded-xl transition-all shadow-xs overflow-hidden">
            <textarea
              ref={textareaRef}
              id={`challenge-answer-${challenge.id || "prompt"}`}
              value={userAnswer}
              onChange={(e) => setUserAnswer(e.target.value)}
              onKeyDown={handleAnswerKeyDown}
              disabled={isSubmitting}
              placeholder={`Type your ${effectiveTargetLang} translation here...`}
              rows={2}
              className="w-full bg-transparent p-3 sm:p-3.5 text-xs sm:text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none resize-y min-h-[68px] max-h-48 leading-relaxed font-sans disabled:opacity-50"
            />

            {/* In-Textarea Action Toolbar */}
            <div className="flex items-center justify-between gap-2 px-3 py-2 bg-stone-100/70 border-t border-stone-200/60">
              <div className="flex items-center gap-2">
                {isSpeechSupported && (
                  <button
                    type="button"
                    onClick={handleToggleVoice}
                    disabled={isSubmitting}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                      isListening
                        ? "bg-rose-100 text-rose-700 border border-rose-300 animate-pulse"
                        : "bg-white hover:bg-stone-200 text-stone-600 border border-stone-200/80 shadow-3xs"
                    }`}
                    title={isListening ? "Stop listening" : `Speak your translation in ${effectiveTargetLang}`}
                  >
                    <Mic className={`w-3.5 h-3.5 ${isListening ? "text-rose-600 animate-pulse" : "text-stone-500"}`} />
                    <span className="text-[11px] font-medium">{isListening ? "Listening..." : "Voice"}</span>
                  </button>
                )}

                {userAnswer.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setUserAnswer("")}
                    disabled={isSubmitting}
                    className="inline-flex items-center gap-1 text-[11px] text-stone-400 hover:text-stone-700 transition-colors p-1 cursor-pointer"
                    title="Clear text"
                  >
                    <X className="w-3 h-3" />
                    <span>Clear</span>
                  </button>
                )}

                {!userAnswer.trim() && (
                  <button
                    type="button"
                    onClick={() => handleSubmitTranslation("(No answer provided)")}
                    disabled={isSubmitting}
                    className="text-[11px] text-stone-400 hover:text-stone-600 underline decoration-stone-300 transition-colors cursor-pointer"
                    title="Reveal answer without typing"
                  >
                    Don't know? Reveal answer
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  id="btn-submit-challenge-answer"
                  type="button"
                  onClick={() => handleSubmitTranslation()}
                  disabled={!userAnswer.trim() || isSubmitting}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 shadow-2xs ${
                    userAnswer.trim() && !isSubmitting
                      ? "bg-stone-900 hover:bg-stone-800 active:scale-95 text-amber-400 cursor-pointer"
                      : "bg-stone-200/80 text-stone-400 cursor-not-allowed"
                  }`}
                >
                  <Send className="w-3 h-3" />
                  <span>{isSubmitting ? "Submitting..." : "Submit Answer"}</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Ask AI Support Button */}
        <div className="pt-1">
          <button
            id="btn-ask-ai-challenge-prompt"
            type="button"
            onClick={() => setIsAskAiModalOpen(true)}
            className="w-full sm:w-auto px-4 py-2 bg-indigo-600 hover:bg-indigo-700 active:scale-98 text-white font-bold text-xs sm:text-sm rounded-xl transition-all cursor-pointer shadow-3xs flex items-center justify-center gap-2"
          >
            <Sparkles className="w-4 h-4" />
            <span>Ask AI about this question</span>
          </button>
        </div>

        {/* AI Response Metadata */}
        <LlmResponseMetadata
          provider={activeProvider}
          model={activeModel}
          responseTimeMs={activeResponseTimeMs}
        />

        {/* Translation Challenge Ask AI Support Modal */}
        <TranslationChallengeAskAiModal
          isOpen={isAskAiModalOpen}
          onClose={() => setIsAskAiModalOpen(false)}
          challenge={challenge}
          evaluation={evaluation}
          nativeLanguage={_nativeLanguage}
          targetLanguage={targetLanguage}
          appLanguage={_appLanguage}
          ttsConfig={ttsConfig}
          llmConfig={llmConfig}
          onAddIncompleteWord={onAddIncompleteWord}
          onAddWord={onAddWord}
          showToast={showToast}
        />
      </div>
    );
  }

  // 2. RENDER EVALUATION RESULT CARD
  if (evaluation) {
    const rawScore = typeof evaluation.score === "number" ? evaluation.score : 0;
    const clampedScore = Math.max(0, Math.min(100, Math.round(rawScore)));

    // Qualitative Tiers:
    // Good: >= 80 (80-100)
    // So-so: 60 - 79
    // Needs Practice / Bad: < 60
    const isGood = clampedScore >= 80;
    const isSoso = clampedScore >= 60 && clampedScore < 80;
    const isBad = clampedScore < 60;

    const isVietnamese = _appLanguage === "vi" || localStorage.getItem("vocab_learner_app_lang") === "vi";

    const scoreVerdict = {
      tier: isGood ? "good" : isSoso ? "soso" : "bad",
      badgeLabel: isGood 
        ? (clampedScore >= 90 ? (isVietnamese ? "XUẤT SẮC" : "EXCELLENT") : (isVietnamese ? "ĐẠT CHUẨN / TỐT" : "GOOD ANSWER"))
        : isSoso 
        ? (isVietnamese ? "TƯƠNG ĐỐI / KHÁ" : "SO-SO / FAIR")
        : (isVietnamese ? "CẦN CẢI THIỆN" : "NEEDS PRACTICE"),
      verdictTitle: isGood
        ? (clampedScore >= 90 
            ? (isVietnamese ? "Bản dịch xuất sắc • Độ chính xác cao" : "Masterful Translation • High Accuracy")
            : (isVietnamese ? "Bản dịch tốt & tự nhiên" : "Good Translation • Natural & Clear"))
        : isSoso
        ? (isVietnamese ? "Bản dịch tương đối • Cần trau chuốt nhẹ" : "So-so Translation • Needs Minor Polish")
        : (isVietnamese ? "Chưa đạt • Hãy xem câu mẫu chuẩn bên dưới" : "Needs Practice • Review Ideal Phrasing"),
      verdictDesc: isGood
        ? (isVietnamese ? "Bạn đã truyền tải ý nghĩa chính xác với cấu trúc câu tự nhiên và chuẩn xác." : "You captured the meaning accurately with natural phrasing and appropriate vocabulary.")
        : isSoso
        ? (isVietnamese ? "Hiểu được ý chính, nhưng có vài điểm ngữ pháp hoặc từ vựng cần tinh chỉnh để tự nhiên hơn." : "The main idea is conveyed, but minor grammar or vocabulary refinements are needed.")
        : (isVietnamese ? "Câu dịch còn thiếu từ vựng quan trọng hoặc sai cấu trúc câu. Hãy đối chiếu với mẫu chuẩn bên dưới!" : "The translation had key word omissions or structural inaccuracies. Study the ideal translation below!"),
      cardBgClass: isGood
        ? "bg-gradient-to-br from-emerald-500/10 via-emerald-500/5 to-teal-50/40 border-emerald-300"
        : isSoso
        ? "bg-gradient-to-br from-amber-500/10 via-amber-500/5 to-yellow-50/40 border-amber-300"
        : "bg-gradient-to-br from-rose-500/10 via-rose-500/5 to-orange-50/40 border-rose-300",
      scorePillClass: isGood
        ? "bg-emerald-600 text-white border-emerald-700 shadow-emerald-200/50"
        : isSoso
        ? "bg-amber-500 text-white border-amber-600 shadow-amber-200/50"
        : "bg-rose-600 text-white border-rose-700 shadow-rose-200/50",
      badgeClass: isGood
        ? "bg-emerald-600 text-white border-emerald-700"
        : isSoso
        ? "bg-amber-500 text-white border-amber-600"
        : "bg-rose-600 text-white border-rose-700",
      icon: isGood ? (
        clampedScore >= 90 ? <Trophy className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />
      ) : isSoso ? (
        <TrendingUp className="w-3.5 h-3.5" />
      ) : (
        <AlertTriangle className="w-3.5 h-3.5" />
      ),
    };

    const allVocabAdded = evaluation.suggestedVocabulary?.every(
      (v) => addedWordKeys[v.word.toLowerCase()] || isWordInCollection(words, v.word)
    );

    const targetWordText = evaluation.targetWordUsed || challenge?.targetWordFromCollection?.word;

    const reviewedWords = useMemo(() => {
      const list: Word[] = [];
      const seenWords = new Set<string>();

      // 1. If evaluation.augmentedWords is present, build Word objects for all augmented words that exist in collection
      if (evaluation?.augmentedWords && evaluation.augmentedWords.length > 0) {
        for (const aug of evaluation.augmentedWords) {
          const lower = aug.word.toLowerCase().trim();
          if (seenWords.has(lower)) continue;
          seenWords.add(lower);

          const matched = words?.length ? findWordInCollection(words, aug.word) : undefined;
          if (matched) {
            list.push({
              ...matched,
              strength: typeof aug.newStrength === "number" ? aug.newStrength : matched.strength,
            });
          }
        }
      }

      // 2. Fallback to single target word if list is empty, but ONLY if it exists in the collection
      if (list.length === 0) {
        const rawTargetWord = evaluation?.targetWordUsed || challenge?.targetWordFromCollection?.word;
        if (rawTargetWord || challenge?.targetWordFromCollection) {
          let matchedWord: Word | undefined = undefined;
          if (challenge?.targetWordFromCollection?.id && words?.length) {
            matchedWord = words.find((w) => w.id === challenge.targetWordFromCollection?.id);
          }
          if (!matchedWord && rawTargetWord && words?.length) {
            matchedWord = findWordInCollection(words, rawTargetWord);
          }

          if (matchedWord) {
            list.push({
              ...matchedWord,
              strength: typeof evaluation?.targetWordNewStrength === "number" ? evaluation.targetWordNewStrength : matchedWord.strength,
            });
          }
        }
      }

      return list;
    }, [words, evaluation, challenge]);

    return (
      <div id="challenge-evaluation-card" className="w-full p-4 sm:p-5 bg-white border border-stone-200/90 rounded-2xl shadow-xs space-y-3.5">
        {/* Top Header */}
        <div className="flex items-center justify-between gap-2 pb-2 border-b border-stone-100">
          <div className="flex items-center gap-2 min-w-0">
            <span className="p-1.5 bg-stone-900 text-amber-400 rounded-lg shadow-2xs shrink-0">
              <Sparkles className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <h4 className="font-bold text-xs sm:text-sm text-stone-900 leading-tight truncate">
                Challenge Feedback
              </h4>
              <span className="text-[11px] text-stone-500 font-medium block truncate">Evaluation Results</span>
            </div>
          </div>

          {/* Essential Audio Feedback Playback Button - Top Right */}
          <button
            id="btn-play-essential-challenge-feedback"
            type="button"
            onClick={handlePlayEssentialAudio}
            className={`shrink-0 px-2.5 sm:px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer shadow-3xs hover:scale-102 active:scale-98 whitespace-nowrap ${
              isPlayingEssentialAudio
                ? "bg-amber-500 text-white border-amber-600 animate-pulse"
                : "bg-stone-50 hover:bg-stone-100 text-stone-700 border-stone-200"
            }`}
            title="Play essential feedback (Score, Ideal translation, and Target word)"
          >
            {isPlayingEssentialAudio ? (
              <>
                <Square className="w-3.5 h-3.5 fill-current" />
                <span>Stop Audio</span>
              </>
            ) : (
              <>
                <Volume2 className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                <span>Listen Feedback</span>
              </>
            )}
          </button>
        </div>

        {/* Enhanced Obvious Score Showcase Banner */}
        <div id="score-showcase-banner" className={`p-4 sm:p-4.5 rounded-2xl border ${scoreVerdict.cardBgClass} space-y-3 shadow-xs`}>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            {/* Left: Big Score & Performance Level */}
            <div className="flex items-center gap-3.5">
              {/* Big Score Block */}
              <div className={`px-3.5 py-1.5 sm:px-4 sm:py-2 rounded-2xl border flex items-baseline gap-1 shadow-xs ${scoreVerdict.scorePillClass}`}>
                <span className="text-2xl sm:text-3xl font-black tracking-tight leading-none">{clampedScore}</span>
                <span className="text-xs sm:text-sm font-bold opacity-80 leading-none">/100</span>
              </div>

              {/* Status Level & Title */}
              <div className="space-y-0.5">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-black uppercase tracking-wider flex items-center gap-1 shadow-2xs ${scoreVerdict.badgeClass}`}>
                    {scoreVerdict.icon}
                    <span>{scoreVerdict.badgeLabel}</span>
                  </span>
                  {evaluation.scoreLabel && (
                    <span className="text-xs text-stone-600 font-semibold">
                      {evaluation.scoreLabel}
                    </span>
                  )}
                </div>
                <h5 className="text-xs sm:text-sm font-bold text-stone-900 leading-tight">
                  {scoreVerdict.verdictTitle}
                </h5>
              </div>
            </div>
          </div>

          {/* Verdict Description */}
          <p className="text-xs text-stone-700 leading-relaxed font-medium">
            {scoreVerdict.verdictDesc}
          </p>

          {/* 3-Zone Visual Meter with Score Pointer Marker */}
          <div className="space-y-1.5 pt-1 border-t border-stone-200/50">
            {/* Segmented Track */}
            <div className="relative w-full h-3 bg-stone-200/70 rounded-full overflow-hidden flex border border-stone-300/60 shadow-inner">
              {/* Zone 1: Bad / Needs Work (0 to 59) -> 60% */}
              <div className="h-full bg-rose-200 border-r border-white relative" style={{ width: "60%" }}>
                <div 
                  className="h-full bg-gradient-to-r from-rose-500 to-rose-600 transition-all duration-700" 
                  style={{ width: clampedScore < 60 ? `${(clampedScore / 60) * 100}%` : "100%" }} 
                />
              </div>

              {/* Zone 2: So-so / Fair (60 to 79) -> 20% */}
              <div className="h-full bg-amber-200 border-r border-white relative" style={{ width: "20%" }}>
                {clampedScore >= 60 && (
                  <div 
                    className="h-full bg-gradient-to-r from-amber-400 to-amber-500 transition-all duration-700" 
                    style={{ width: clampedScore < 80 ? `${((clampedScore - 60) / 20) * 100}%` : "100%" }} 
                  />
                )}
              </div>

              {/* Zone 3: Good / Excellent (80 to 100) -> 20% */}
              <div className="h-full bg-emerald-200 relative" style={{ width: "20%" }}>
                {clampedScore >= 80 && (
                  <div 
                    className="h-full bg-gradient-to-r from-emerald-500 to-emerald-600 transition-all duration-700" 
                    style={{ width: `${((clampedScore - 80) / 20) * 100}%` }} 
                  />
                )}
              </div>
            </div>

            {/* Zone Markers / Legend */}
            <div className="flex items-center justify-between text-[10px] sm:text-[11px] font-mono font-medium gap-1">
              <span className={`flex items-center gap-1 shrink-0 transition-all ${isBad ? "font-bold text-rose-700" : "text-stone-400 opacity-80"}`}>
                <span className={`w-2 h-2 rounded-full shrink-0 ${isBad ? "bg-rose-500 ring-2 ring-rose-300 animate-pulse" : "bg-rose-300"}`} />
                <span className="whitespace-nowrap">&lt;60 Needs Work</span>
              </span>
              <span className={`flex items-center gap-1 shrink-0 transition-all ${isSoso ? "font-bold text-amber-700" : "text-stone-400 opacity-80"}`}>
                <span className={`w-2 h-2 rounded-full shrink-0 ${isSoso ? "bg-amber-500 ring-2 ring-amber-300 animate-pulse" : "bg-amber-300"}`} />
                <span className="whitespace-nowrap">60–79 So-so</span>
              </span>
              <span className={`flex items-center gap-1 shrink-0 transition-all ${isGood ? "font-bold text-emerald-700" : "text-stone-400 opacity-80"}`}>
                <span className={`w-2 h-2 rounded-full shrink-0 ${isGood ? "bg-emerald-500 ring-2 ring-emerald-300 animate-pulse" : "bg-emerald-300"}`} />
                <span className="whitespace-nowrap">80–100 Good</span>
              </span>
            </div>
          </div>
        </div>

        {/* Translation Comparison Block */}
        {(() => {
          const userSub = evaluation.userTranslation?.trim();
          const isPlayingIdeal = playingItemKey === "ideal-sentence";

          return (
            <div className={`grid grid-cols-1 ${userSub ? "md:grid-cols-2" : ""} gap-3`}>
              {userSub && (
                <div className="p-3 bg-stone-50 border border-stone-200/70 rounded-xl space-y-1">
                  <span className="text-[10px] font-bold text-stone-500 uppercase tracking-wider font-mono block">
                    Your Submission
                  </span>
                  <p className="text-xs sm:text-sm font-medium text-stone-800 break-words">
                    "{userSub}"
                  </p>
                </div>
              )}

              <div className="p-3 bg-emerald-50/80 border border-emerald-200/80 rounded-xl space-y-1 relative group">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider font-mono block">
                    Ideal Target Translation
                  </span>
                  <button
                    id="btn-play-ideal-translation"
                    type="button"
                    onClick={() => handlePlayText(evaluation.correctedSentence, targetLanguage || "English", "ideal-sentence")}
                    className="p-1 rounded-md text-emerald-700 hover:text-emerald-950 hover:bg-emerald-100/70 transition-colors cursor-pointer"
                    title="Listen to ideal translation"
                  >
                    {isPlayingIdeal ? (
                      <Square className="w-3.5 h-3.5 fill-emerald-800 text-emerald-800 animate-pulse" />
                    ) : (
                      <Volume2 className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
                <p className="text-xs sm:text-sm font-bold text-emerald-950 break-words">
                  "{evaluation.correctedSentence}"
                </p>
              </div>
            </div>
          );
        })()}

        {/* Word Reviewed Banner(s) */}
        {reviewedWords.map((rw) => (
          <WordReviewedBanner
            key={rw.id || rw.word}
            word={rw}
            prefixLabel="Word Reviewed:"
            onPlayAudio={(text) => {
              if (onPlayAudio) onPlayAudio(text);
              else handlePlayText(text, targetLanguage || "English", `reviewed-word-${rw.word}`);
            }}
            onViewHistory={(w) => {
              if (onViewHistory) onViewHistory(w);
              else setSelectedHistoryWord(w);
            }}
            onAskAi={(w) => {
              if (onAskAi) onAskAi(w);
              else setSelectedChatWord(w);
            }}
          />
        ))}

        {/* Target Word Incorporation Celebration Banner */}
        {evaluation.incorporatedTargetWord && evaluation.targetWordUsed && (
          <div className="p-3.5 bg-gradient-to-r from-emerald-500/10 via-emerald-500/5 to-teal-50/50 border border-emerald-300 rounded-xl shadow-2xs space-y-1.5">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="p-1.5 bg-emerald-600 text-white rounded-lg shadow-2xs">
                  <Sparkles className="w-4 h-4" />
                </span>
                <span className="font-bold text-xs sm:text-sm text-emerald-950">
                  Target Word Successfully Incorporated!
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  id="btn-play-target-word-incorporated"
                  type="button"
                  onClick={() => handlePlayText(evaluation.targetWordUsed!, targetLanguage || "English", "target-word-inc")}
                  className="p-1 rounded-md text-emerald-800 hover:text-emerald-950 hover:bg-emerald-100 transition-colors cursor-pointer"
                  title={`Pronounce "${evaluation.targetWordUsed}"`}
                >
                  {playingItemKey === "target-word-inc" ? (
                    <Square className="w-3.5 h-3.5 fill-emerald-800 text-emerald-800 animate-pulse" />
                  ) : (
                    <Volume2 className="w-3.5 h-3.5" />
                  )}
                </button>
                <span className="px-2.5 py-0.5 bg-emerald-600 text-white text-[11px] font-black rounded-full shadow-2xs">
                  +30 Strength Points
                </span>
              </div>
            </div>
            <p className="text-xs text-emerald-900 leading-relaxed">
              {isVietnamese ? (
                <>Bạn đã sử dụng từ <strong className="font-bold font-mono">"{evaluation.targetWordUsed}"</strong> từ bộ sưu tập trong bài dịch.</>
              ) : (
                <>You incorporated <strong className="font-bold font-mono">"{evaluation.targetWordUsed}"</strong> from your collection in your translation.</>
              )}
              {typeof evaluation.targetWordPrevStrength === "number" && typeof evaluation.targetWordNewStrength === "number" && (
                <span className="block text-[11px] font-medium text-emerald-800 mt-0.5">
                  {isVietnamese ? "Độ ghi nhớ tăng cường: " : "Memory strength augmented: "}
                  {evaluation.targetWordPrevStrength}% → <strong className="font-bold text-emerald-950">{evaluation.targetWordNewStrength}%</strong>
                </span>
              )}
            </p>
          </div>
        )}

        {/* Vocab Clues Incorporation Celebration Banner */}
        {(() => {
          const incorporatedClues = evaluation.augmentedWords?.filter((a) => a.isVocabClue && a.strengthGained > 0) || [];
          if (incorporatedClues.length === 0) return null;
          return (
            <div className="p-3.5 bg-gradient-to-r from-teal-500/10 via-emerald-500/5 to-cyan-50/50 border border-teal-300 rounded-xl shadow-2xs space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="p-1.5 bg-teal-600 text-white rounded-lg shadow-2xs">
                    <Sparkles className="w-4 h-4" />
                  </span>
                  <span className="font-bold text-xs sm:text-sm text-teal-950">
                    Collection Vocab Clues Boosted! ({incorporatedClues.length} {incorporatedClues.length === 1 ? "word" : "words"})
                  </span>
                </div>
                <span className="px-2.5 py-0.5 bg-teal-600 text-white text-[11px] font-black rounded-full shadow-2xs">
                  +30 Strength Points Each
                </span>
              </div>
              <p className="text-xs text-teal-900 leading-relaxed">
                Great job using vocabulary from your collection in your response! Memory strength has been boosted by <strong className="font-bold font-mono">+30%</strong> for each term.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                {incorporatedClues.map((clue) => (
                  <div
                    key={clue.word}
                    className="flex items-center justify-between p-2.5 bg-white/95 border border-teal-200/80 rounded-xl shadow-3xs gap-2"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-bold text-xs sm:text-sm text-stone-900 font-serif truncate">
                          {clue.word}
                        </span>
                        {clue.translation && (
                          <span className="text-[11px] text-stone-500 italic truncate max-w-[140px]">
                            "{clue.translation}"
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] font-mono font-medium text-teal-800">
                        {clue.prevStrength}% → <strong className="font-bold text-teal-950">{clue.newStrength}%</strong> (+{clue.strengthGained}%)
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handlePlayText(clue.word, targetLanguage || "English", `clue-${clue.word}`)}
                      className="p-1.5 rounded-lg text-teal-800 hover:text-teal-950 hover:bg-teal-100 transition-colors cursor-pointer shrink-0 border border-teal-200/60"
                      title={`Pronounce "${clue.word}"`}
                    >
                      {playingItemKey === `clue-${clue.word}` ? (
                        <Square className="w-3.5 h-3.5 fill-teal-800 text-teal-800 animate-pulse" />
                      ) : (
                        <Volume2 className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {/* Target Word Feedback Banner (When NOT Incorporated) */}
        {!evaluation.incorporatedTargetWord && targetWordText && (() => {
          const targetWordMeaning =
            challenge?.targetWordFromCollection?.translation ||
            challenge?.targetWordFromCollection?.definition ||
            words.find((w) => w.word.toLowerCase() === targetWordText.toLowerCase())?.translation;

          return (
            <div className="p-3.5 bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-orange-50/50 border border-amber-300 rounded-xl shadow-2xs space-y-1.5">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="p-1.5 bg-amber-600 text-white rounded-lg shadow-2xs">
                    <Lightbulb className="w-4 h-4" />
                  </span>
                  <span className="font-bold text-xs sm:text-sm text-amber-950">
                    Featured Target Word: "{targetWordText}"
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    id="btn-play-target-word-featured"
                    type="button"
                    onClick={() => handlePlayText(targetWordText, targetLanguage || "English", "target-word-feat")}
                    className="p-1 rounded-md text-amber-800 hover:text-amber-950 hover:bg-amber-100 transition-colors cursor-pointer"
                    title={`Pronounce "${targetWordText}"`}
                  >
                    {playingItemKey === "target-word-feat" ? (
                      <Square className="w-3.5 h-3.5 fill-amber-800 text-amber-800 animate-pulse" />
                    ) : (
                      <Volume2 className="w-3.5 h-3.5" />
                    )}
                  </button>
                  <span className="px-2.5 py-0.5 bg-amber-600 text-white text-[11px] font-black rounded-full shadow-2xs">
                    +10 Points • Marked Learned
                  </span>
                </div>
              </div>
              <p className="text-xs text-amber-900 leading-relaxed">
                <strong className="font-bold font-mono">"{targetWordText}"</strong>
                {targetWordMeaning && <span> ({targetWordMeaning})</span>}{" "}
                {isVietnamese
                  ? "chưa có trong câu trả lời, nhưng đã được tính là đã học để chuyển tiếp lượt ôn tập."
                  : "was not used, but marked as learned to rotate your study queue."}
                {typeof evaluation.targetWordPrevStrength === "number" && typeof evaluation.targetWordNewStrength === "number" && (
                  <span className="block text-[11px] font-medium text-amber-800 mt-0.5">
                    {isVietnamese ? "Độ ghi nhớ cập nhật: " : "Memory strength updated: "}
                    {evaluation.targetWordPrevStrength}% → <strong className="font-bold text-amber-950">{evaluation.targetWordNewStrength}%</strong>
                  </span>
                )}
              </p>
            </div>
          );
        })()}

        {/* Insights Section */}
        <div className="space-y-2 text-xs">
          {evaluation.whatWentWell && (
            <div className="p-3 bg-emerald-50/50 border border-emerald-100 rounded-xl flex items-start gap-2 text-emerald-950">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <strong className="font-bold block text-emerald-900">What Went Well:</strong>
                <span>{evaluation.whatWentWell}</span>
              </div>
            </div>
          )}

          {evaluation.areasForImprovement && (
            <div className="p-3 bg-amber-50/50 border border-amber-100 rounded-xl flex items-start gap-2 text-amber-950">
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <strong className="font-bold block text-amber-900">Areas for Improvement:</strong>
                <span>{evaluation.areasForImprovement}</span>
              </div>
            </div>
          )}
        </div>

        {/* Mined Suggested Vocabulary Grid */}
        {evaluation.suggestedVocabulary && evaluation.suggestedVocabulary.length > 0 && (
          <div className="pt-2 space-y-2.5 border-t border-stone-100">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-stone-800 flex items-center gap-1.5">
                <Brain className="w-3.5 h-3.5 text-amber-600" />
                <span>Featured Challenge Vocabulary</span>
              </span>
              {(onAddIncompleteWord || onAddMultipleWords) && !allVocabAdded && (
                <button
                  id="btn-add-all-challenge-vocab"
                  type="button"
                  onClick={() => handleAddAllVocab(evaluation.suggestedVocabulary!)}
                  className="px-2.5 py-1 bg-amber-500 hover:bg-amber-600 active:scale-95 text-white text-[11px] font-bold rounded-lg transition-all cursor-pointer flex items-center gap-1 shadow-2xs"
                >
                  <Plus className="w-3 h-3" />
                  <span>Add All ({evaluation.suggestedVocabulary.length})</span>
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {evaluation.suggestedVocabulary.map((v, idx) => {
                const inCol = isWordInCollection(words, v.word) || addedWordKeys[v.word.toLowerCase()];
                const isPlayingVocab = playingItemKey === `vocab-${idx}`;
                return (
                  <div
                    key={idx}
                    onClick={() => {
                      if (!inCol) handleAddSingleWord(v);
                    }}
                    title={inCol ? "Saved in collection" : "Click to temporarily add to collection as incomplete word"}
                    className={`p-2.5 border rounded-xl flex items-center justify-between gap-2 transition-all ${
                      inCol
                        ? "bg-stone-50/90 border-stone-200/80 cursor-default"
                        : "bg-stone-50 hover:bg-amber-50/70 border-stone-200/80 hover:border-amber-300 cursor-pointer active:scale-[0.99]"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <button
                          id={`btn-play-vocab-${idx}`}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handlePlayText(v.word, targetLanguage || "English", `vocab-${idx}`);
                          }}
                          className="text-stone-400 hover:text-stone-800 p-0.5 rounded cursor-pointer transition-colors"
                          title={`Pronounce "${v.word}"`}
                        >
                          {isPlayingVocab ? (
                            <Square className="w-3 h-3 text-amber-600 fill-amber-600 animate-pulse" />
                          ) : (
                            <Volume2 className="w-3 h-3" />
                          )}
                        </button>
                        <span className="font-bold text-xs text-stone-900 truncate">{v.word}</span>
                        {v.partOfSpeech && (
                          <span className="text-[10px] text-stone-400 font-mono">({v.partOfSpeech})</span>
                        )}
                      </div>
                      <p className="text-[11px] text-stone-600 truncate">{v.translation}</p>
                    </div>

                    {(onAddIncompleteWord || onAddWord) && (
                      <button
                        id={`btn-add-vocab-${idx}`}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAddSingleWord(v);
                        }}
                        disabled={inCol}
                        className={`px-2 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1 transition-all cursor-pointer shrink-0 ${
                          inCol
                            ? "bg-emerald-100 text-emerald-800 opacity-80 cursor-default"
                            : "bg-stone-900 hover:bg-stone-800 text-amber-400 shadow-2xs active:scale-95"
                        }`}
                      >
                        {inCol ? (
                          <>
                            <Check className="w-3 h-3 text-emerald-700" />
                            <span>Saved</span>
                          </>
                        ) : (
                          <>
                            <Plus className="w-3 h-3" />
                            <span>Add</span>
                          </>
                        )}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* AI Response Metadata (Provider, Model, Response Time) */}
        <LlmResponseMetadata
          provider={activeProvider}
          model={activeModel}
          responseTimeMs={activeResponseTimeMs}
        />

        {/* Strength History Modal Fallback */}
        <AnimatePresence>
          {selectedHistoryWord && (
            <StrengthHistoryModal
              word={selectedHistoryWord}
              onClose={() => setSelectedHistoryWord(null)}
              onUpdateWord={(updated) => {
                setSelectedHistoryWord(updated);
                if (onUpdateWords && words) {
                  onUpdateWords(words.map((w) => (w.id === updated.id ? updated : w)));
                }
              }}
            />
          )}
        </AnimatePresence>

        {/* Word Chat Modal Fallback */}
        <AnimatePresence>
          {selectedChatWord && (
            <WordChatModal
              word={selectedChatWord}
              isOpen={Boolean(selectedChatWord)}
              onClose={() => setSelectedChatWord(null)}
              targetLanguage={targetLanguage}
              nativeLanguage={_nativeLanguage}
              ttsConfig={ttsConfig}
              llmConfig={llmConfig}
              onAddWord={onAddWord ? (w) => onAddWord(w.word, w.definition || w.translation) : undefined}
            />
          )}
        </AnimatePresence>
      </div>
    );
  }

  return null;
}
