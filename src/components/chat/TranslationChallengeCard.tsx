import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { AnimatePresence } from "motion/react";
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
  ChevronRight,
  Volume2,
  Square,
  Mic,
  Send,
  CornerDownLeft,
  Flag,
  Globe,
  Play,
  Timer
} from "lucide-react";
import { ChallengeData, ChallengeEvaluation, Word, ChallengeSuggestedVocab, TTSConfig, LLMConfig, PoorSentenceReport } from "../../types";
import { isWordInCollection, findWordInCollection } from "../../utils/wordNormalization";
import { speakText, stopSpeech, buildEssentialChallengeAudioText } from "../../utils/ttsService";
import { useSpeechToText, removeImmediateWordDuplications } from "../../hooks/useSpeechToText";
import { useVirtualKeyboard } from "../../hooks/useVirtualKeyboard";
import { getPoorSentenceReportsFromDB, savePoorSentenceReportToDB } from "../../db/indexedDB";
import { callLLMClientSideWithMeta } from "../../services/llmClientService";
import LlmResponseMetadata from "./LlmResponseMetadata";
import TranslationChallengeAskAiModal from "./TranslationChallengeAskAiModal";
import ReportPoorSentenceModal from "./ReportPoorSentenceModal";
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
  const vocabHintsRef = useRef<HTMLDivElement>(null);
  const hintsContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const voiceBaseTextRef = useRef("");
  const [userAnswer, setUserAnswer] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAutoTranslating, setIsAutoTranslating] = useState(false);
  const [isPlayingEssentialAudio, setIsPlayingEssentialAudio] = useState(false);
  const [playingItemKey, setPlayingItemKey] = useState<string | null>(null);
  const [isAskAiModalOpen, setIsAskAiModalOpen] = useState(false);
  const [selectedHistoryWord, setSelectedHistoryWord] = useState<Word | null>(null);
  const [selectedChatWord, setSelectedChatWord] = useState<Word | null>(null);

  // Poorly generated sentence reporting state
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [existingReport, setExistingReport] = useState<PoorSentenceReport | null>(null);
  const [isReported, setIsReported] = useState(false);

  const activeProvider = evaluation
    ? (evaluation.provider || provider || challenge?.provider)
    : (provider || challenge?.provider || evaluation?.provider);
  const activeModel = evaluation
    ? (evaluation.model || model || challenge?.model)
    : (model || challenge?.model || evaluation?.model);
  const activeResponseTimeMs = evaluation
    ? (evaluation.responseTimeMs ?? responseTimeMs ?? challenge?.responseTimeMs)
    : (responseTimeMs ?? challenge?.responseTimeMs ?? evaluation?.responseTimeMs);

  const handleFlagClick = async () => {
    if (!challenge?.nativeSentence) return;
    if (!isReported) {
      try {
        const report: PoorSentenceReport = {
          id: `poor_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          timestamp: new Date().toISOString(),
          challengeId: challenge.id,
          nativeSentence: challenge.nativeSentence.trim(),
          targetLanguage: challenge.targetLanguage || targetLanguage || "English",
          nativeLanguage: challenge.nativeLanguage || "Vietnamese",
          topicContext: challenge.topicContext,
          targetWord: challenge.targetWordFromCollection?.word || evaluation?.targetWordUsed || undefined,
          keyTargetWords: challenge.keyTargetWords,
          idealTranslation: evaluation?.correctedSentence || challenge.idealTranslation || undefined,
          userTranslation: evaluation?.userTranslation?.trim() || undefined,
          evaluationScore: evaluation?.score,
          evaluationFeedback: evaluation
            ? `${evaluation.whatWentWell ? `Well: ${evaluation.whatWentWell}. ` : ""}${evaluation.areasForImprovement ? `Improve: ${evaluation.areasForImprovement}` : ""}`.trim()
            : undefined,
          provider: activeProvider,
          model: activeModel,
          responseTimeMs: activeResponseTimeMs,
          reason: "Unnatural Phrasing",
          phase: evaluation ? "evaluation" : "prompt",
        };
        await savePoorSentenceReportToDB(report);
        setIsReported(true);
        setExistingReport(report);
        showToast?.("Sentence collected for LLM enhancement dataset!");
      } catch (err) {
        showToast?.("Failed to flag sentence.");
      }
    } else {
      setIsReportModalOpen(true);
    }
  };

  useEffect(() => {
    let isMounted = true;
    const checkReportedStatus = async () => {
      const sentence = challenge?.nativeSentence;
      if (!sentence) {
        if (isMounted) {
          setIsReported(false);
          setExistingReport(null);
        }
        return;
      }
      try {
        const all = await getPoorSentenceReportsFromDB();
        const found = all.find(
          (r) =>
            (challenge?.id && r.challengeId === challenge.id) ||
            (r.nativeSentence && r.nativeSentence.trim().toLowerCase() === sentence.trim().toLowerCase())
        );
        if (isMounted) {
          setIsReported(Boolean(found));
          setExistingReport(found || null);
        }
      } catch (e) {
        // ignore
      }
    };

    checkReportedStatus();

    const handleUpdate = () => {
      checkReportedStatus();
    };

    window.addEventListener("vocab-poor-sentences-updated", handleUpdate);
    return () => {
      isMounted = false;
      window.removeEventListener("vocab-poor-sentences-updated", handleUpdate);
    };
  }, [challenge?.id, challenge?.nativeSentence]);

  const scrollToVocabHints = useCallback((behavior: ScrollBehavior = "smooth") => {
    const target = vocabHintsRef.current || hintsContainerRef.current;
    if (!target) return;

    const scrollContainer = target.closest("#chat-messages-body, .chat-message-body") as HTMLElement | null;
    if (scrollContainer) {
      const containerRect = scrollContainer.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const offsetTop = targetRect.top - containerRect.top + scrollContainer.scrollTop - 12;
      scrollContainer.scrollTo({
        top: Math.max(0, offsetTop),
        behavior,
      });
    }

    try {
      target.scrollIntoView({ behavior, block: "start" });
    } catch {
      // Fallback
    }
  }, []);

  const reviewedWords = useMemo(() => {
    const list: Word[] = [];
    const seenWords = new Set<string>();

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

  const isKeyboardOpen = useVirtualKeyboard({ inputRef: textareaRef });

  useEffect(() => {
    if (!isKeyboardOpen || evaluation) return;
    const t1 = setTimeout(() => scrollToVocabHints("smooth"), 60);
    const t2 = setTimeout(() => scrollToVocabHints("smooth"), 180);
    const t3 = setTimeout(() => scrollToVocabHints("smooth"), 360);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [isKeyboardOpen, evaluation, scrollToVocabHints]);

  useEffect(() => {
    return () => {
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("vocab-textarea-focus-change", { detail: { focused: false } })
        );
      }
    };
  }, []);

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
        const base = voiceBaseTextRef.current.trim();
        const cleanTranscript = removeImmediateWordDuplications(transcript.trim());
        const combined = base ? `${base} ${cleanTranscript}` : cleanTranscript;
        setUserAnswer(removeImmediateWordDuplications(combined));
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
      voiceBaseTextRef.current = userAnswer;
      startListening(effectiveTargetLang);
    }
  };

  const handleSubmitTranslation = useCallback(async (answerOverride?: string) => {
    const domVal = textareaRef.current?.value ?? "";
    const effectiveText = answerOverride !== undefined ? answerOverride : (domVal.trim() || userAnswer.trim());
    if (!effectiveText && answerOverride === undefined) return;
    if (isListening) {
      stopListening();
    }
    voiceBaseTextRef.current = "";
    textareaRef.current?.blur();
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("vocab-textarea-focus-change", { detail: { focused: false } })
      );
    }
    setIsSubmitting(true);
    try {
      if (onSubmitAnswer) {
        await onSubmitAnswer(effectiveText, { source: "challenge_card" });
      }
      setUserAnswer("");
      if (textareaRef.current) {
        textareaRef.current.value = "";
      }
    } catch (err: any) {
      showToast?.(err?.message || "Failed to submit answer.");
    } finally {
      setIsSubmitting(false);
    }
  }, [userAnswer, isListening, stopListening, onSubmitAnswer, showToast]);

  const lastSubmitTimeRef = useRef(0);
  const touchStartPosRef = useRef<{ x: number; y: number; time: number } | null>(null);

  const triggerSubmit = useCallback((answerOverride?: string) => {
    const now = Date.now();
    if (now - lastSubmitTimeRef.current < 600) return;
    lastSubmitTimeRef.current = now;
    handleSubmitTranslation(answerOverride);
  }, [handleSubmitTranslation]);

  const handleTouchStartOnSubmit = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      touchStartPosRef.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
        time: Date.now(),
      };
    }
  }, []);

  const handleTouchEndOnSubmit = useCallback((e: React.TouchEvent, customAnswer?: string) => {
    if (!touchStartPosRef.current) return;
    const touch = e.changedTouches[0];
    if (touch) {
      const dx = Math.abs(touch.clientX - touchStartPosRef.current.x);
      const dy = Math.abs(touch.clientY - touchStartPosRef.current.y);
      const dt = Date.now() - touchStartPosRef.current.time;
      if (dx < 12 && dy < 12 && dt < 600) {
        e.preventDefault();
        triggerSubmit(customAnswer);
      }
    }
    touchStartPosRef.current = null;
  }, [triggerSubmit]);

  const handleAnswerKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (((e.key === "Enter" || e.keyCode === 13) && !e.shiftKey) || ((e.ctrlKey || e.metaKey) && (e.key === "Enter" || e.keyCode === 13))) {
      e.preventDefault();
      textareaRef.current?.blur();
      triggerSubmit();
    }
  };

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

  const handleAiAutoTranslate = async () => {
    if (!challenge?.nativeSentence || isAutoTranslating) return;
    setIsAutoTranslating(true);
    try {
      const promptPayload = `Translate the following ${challenge.nativeLanguage || "Vietnamese"} sentence into ${effectiveTargetLang}:
"${challenge.nativeSentence}"

Provide ONLY the direct translation without any quotes, preamble, or extra notes.`;
      
      const systemInstruction = `You are a professional translator. Output ONLY the translated sentence in ${effectiveTargetLang}. No quotes or extra commentary.`;

      const res = await callLLMClientSideWithMeta(
        promptPayload,
        systemInstruction,
        "",
        llmConfig,
        undefined,
        { action: "Auto Translate Challenge" }
      );

      const clean = res.text?.trim().replace(/^["']|["']$/g, "") || "";
      if (clean) {
        setUserAnswer(clean);
        if (textareaRef.current) {
          textareaRef.current.value = clean;
        }
        showToast?.("AI translation generated!");
      } else {
        showToast?.("Failed to generate translation.");
      }
    } catch (e: any) {
      showToast?.("Auto-translate error: " + (e?.message || "Failed"));
    } finally {
      setIsAutoTranslating(false);
    }
  };

  // 1. RENDER CHALLENGE PROMPT CARD (Aesthetics matching target screenshot)
  if (challenge && !evaluation) {
    return (
      <div className="w-full space-y-4 max-w-full">
        {/* Card 1: Main Challenge Prompt Card */}
        <div id="challenge-prompt-card" className="w-full p-4 sm:p-6 bg-white rounded-3xl border border-slate-200/80 shadow-md space-y-4 overflow-hidden">
          {/* Header Row */}
          <div className="flex items-center justify-between gap-2 sm:gap-4 pb-3 border-b border-slate-100 min-w-0">
            <h3 className="font-bold text-sm sm:text-base text-slate-800 tracking-wide uppercase whitespace-nowrap shrink-0">
              Language Challenge
            </h3>
            <span className="px-3 py-1 bg-[#e0f2fe] text-[#0369a1] rounded-full text-[11px] sm:text-xs font-semibold whitespace-nowrap truncate max-w-[140px] sm:max-w-[220px] shrink border-none">
              {challenge.topicContext || "General Practice"}
            </span>
          </div>

          {/* Language Direction Line */}
          <div className="flex items-center justify-between gap-2 text-xs font-bold text-slate-500 uppercase tracking-wider min-w-0">
            <div className="flex items-center gap-1.5 min-w-0 truncate">
              <Globe className="w-4 h-4 text-slate-500 shrink-0" />
              <span className="truncate">Translate into: {effectiveTargetLang}</span>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                id="btn-report-poor-challenge-prompt"
                type="button"
                onClick={handleFlagClick}
                className={`p-1.5 rounded-lg text-xs font-medium flex items-center gap-1 transition-all cursor-pointer ${
                  isReported
                    ? "bg-amber-500 text-white shadow-2xs"
                    : "text-slate-400 hover:text-amber-700 hover:bg-amber-50"
                }`}
                title={isReported ? "Flagged for LLM tuning" : "Flag poor sentence"}
              >
                <Flag className={`w-3.5 h-3.5 ${isReported ? "fill-white text-white" : ""}`} />
              </button>
              <button
                id="btn-play-prompt-sentence"
                type="button"
                onClick={() => handlePlayText(challenge.nativeSentence, challenge.nativeLanguage || "Vietnamese", "prompt-sentence")}
                className="p-1.5 text-slate-400 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                title="Listen to native sentence"
              >
                {playingItemKey === "prompt-sentence" ? (
                  <Square className="w-4 h-4 text-amber-600 fill-amber-600 animate-pulse" />
                ) : (
                  <Volume2 className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

          {/* Big Bold Native Sentence (No quotes) */}
          <div className="py-0.5 min-w-0">
            <p className="text-lg sm:text-xl font-extrabold text-slate-900 leading-snug tracking-tight font-sans break-words select-text">
              {challenge.nativeSentence.trim()}
            </p>
          </div>

          {/* Answer Input Field Container */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 min-w-0">
              <label
                htmlFor={`challenge-answer-${challenge.id || "prompt"}`}
                className="text-xs sm:text-sm font-semibold text-slate-700 truncate"
              >
                Your translation ({effectiveTargetLang}):
              </label>
              
              {/* Vocab Hints Toggle Button */}
              {((challenge.keyTargetWords && challenge.keyTargetWords.length > 0) || challenge.personalityNote) && (
                <button
                  id="btn-toggle-vocab-hints"
                  type="button"
                  onClick={() => {
                    setShowVocabHints(prev => {
                      const next = !prev;
                      if (next) {
                        setTimeout(() => scrollToVocabHints("smooth"), 80);
                      }
                      return next;
                    });
                  }}
                  className="bg-[#fef3c7] hover:bg-[#fde68a] text-[#92400e] text-xs font-bold px-3 py-1 sm:px-3.5 sm:py-1.5 rounded-full flex items-center gap-1.5 cursor-pointer transition-all shrink-0 border-none shadow-none"
                >
                  <Lightbulb className="w-3.5 h-3.5 text-[#d97706] fill-[#f59e0b]/20 shrink-0" />
                  <span className="whitespace-nowrap">Vocab Hints</span>
                  {showVocabHints ? <ChevronUp className="w-3.5 h-3.5 shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 shrink-0" />}
                </button>
              )}
            </div>

            {/* Collapsible Hints Panel */}
            {showVocabHints && ((challenge.keyTargetWords && challenge.keyTargetWords.length > 0) || challenge.personalityNote) && (
              <div ref={hintsContainerRef} id="challenge-vocab-hints-content" className="p-3.5 bg-amber-50/90 border border-amber-200/80 rounded-2xl space-y-2.5 text-xs overflow-hidden">
                {challenge.personalityNote && (
                  <div className="flex items-start gap-1.5 text-amber-900 text-xs leading-relaxed">
                    <Sparkles className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                    <span>{challenge.personalityNote}</span>
                  </div>
                )}
                {challenge.keyTargetWords && challenge.keyTargetWords.length > 0 && (
                  <div className="space-y-2 pt-1">
                    <span className="font-bold text-amber-900 block text-[11px] uppercase tracking-wider font-mono">
                      Vocab Clues & Options:
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {challenge.keyTargetWords.map((kw, i) => {
                        const inCol = isWordInCollection(words, kw.word) || addedWordKeys[kw.word.toLowerCase()];
                        return (
                          <div
                            key={i}
                            className={`px-3 py-1.5 rounded-xl flex items-center gap-2 border text-xs font-medium transition-all ${
                              inCol
                                ? "bg-emerald-50 border-emerald-200 text-emerald-900"
                                : "bg-white border-amber-200/90 text-amber-950 shadow-3xs"
                            }`}
                          >
                            <span className="font-bold">{kw.word}</span>
                            <span className="text-stone-500">({kw.translation})</span>
                            <button
                              type="button"
                              onClick={() => {
                                setUserAnswer((prev) => {
                                  const trimmed = prev.trim();
                                  return trimmed ? `${trimmed} ${kw.word}` : kw.word;
                                });
                                textareaRef.current?.focus();
                              }}
                              className="p-1 text-amber-700 hover:text-amber-950 rounded cursor-pointer transition-colors"
                              title={`Insert "${kw.word}"`}
                            >
                              <CornerDownLeft className="w-3 h-3" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Textarea Input Card */}
            <div className="relative border border-slate-200 focus-within:border-slate-300 focus-within:ring-2 focus-within:ring-slate-100 bg-white rounded-2xl transition-all shadow-3xs overflow-hidden">
              <textarea
                ref={textareaRef}
                id={`challenge-answer-${challenge.id || "prompt"}`}
                value={userAnswer}
                onChange={(e) => {
                  setUserAnswer(e.target.value);
                  if (isListening) voiceBaseTextRef.current = e.target.value;
                }}
                onKeyDown={handleAnswerKeyDown}
                placeholder={`Start typing your ${effectiveTargetLang} translation...`}
                rows={3}
                className="w-full bg-transparent p-3.5 sm:p-4 pr-10 text-xs sm:text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:outline-none resize-none min-h-[80px] leading-relaxed font-sans"
              />

              {/* Vertical right side mic and audio actions */}
              <div className="absolute right-3 top-3 bottom-3 flex flex-col justify-between items-center pointer-events-none">
                {isSpeechSupported && (
                  <button
                    type="button"
                    onClick={handleToggleVoice}
                    className={`p-1.5 rounded-full transition-all cursor-pointer pointer-events-auto ${
                      isListening
                        ? "bg-rose-500 text-white animate-pulse shadow-md"
                        : "text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                    }`}
                    title={isListening ? "Stop listening" : "Voice input"}
                  >
                    <Mic className="w-4 h-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (userAnswer.trim()) {
                      handlePlayText(userAnswer, effectiveTargetLang, "draft-audio");
                    }
                  }}
                  disabled={!userAnswer.trim()}
                  className="p-1.5 text-slate-300 hover:text-slate-600 disabled:opacity-30 rounded-full transition-all cursor-pointer pointer-events-auto"
                  title="Play draft audio"
                >
                  <Play className="w-4 h-4 fill-current" />
                </button>
              </div>
            </div>
          </div>

          {/* Action Buttons Row */}
          <div className="flex items-center justify-between gap-2.5 pt-2 flex-wrap">
            <div className="flex items-center gap-2">
              {/* Submit Answer Button (Green) */}
              <button
                id="btn-submit-challenge-answer"
                type="button"
                onPointerDown={(e) => e.preventDefault()}
                onMouseDown={(e) => e.preventDefault()}
                onTouchStart={handleTouchStartOnSubmit}
                onTouchEnd={(e) => handleTouchEndOnSubmit(e)}
                onClick={(e) => {
                  e.preventDefault();
                  triggerSubmit();
                }}
                disabled={isSubmitting}
                className="bg-[#059669] hover:bg-[#047857] active:scale-98 text-white font-bold text-xs sm:text-sm px-4 sm:px-5 py-2.5 rounded-xl flex items-center gap-1.5 sm:gap-2 shadow-xs transition-all cursor-pointer select-none touch-manipulation"
              >
                <Send className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                <span className="whitespace-nowrap">{isSubmitting ? "Submitting..." : "Submit Answer"}</span>
              </button>

              {/* Ask AI Button (Violet / Purple) */}
              <button
                id="btn-ask-ai-challenge-prompt"
                type="button"
                onClick={() => setIsAskAiModalOpen(true)}
                className="bg-[#7c3aed] hover:bg-[#6d28d9] active:scale-98 text-white font-bold text-xs sm:text-sm px-4 sm:px-5 py-2.5 rounded-xl flex items-center gap-1.5 sm:gap-2 shadow-xs transition-all cursor-pointer select-none"
              >
                <Sparkles className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                <span className="whitespace-nowrap">Ask AI</span>
              </button>
            </div>

            {/* Reveal Answer link */}
            <div className="flex items-center gap-1 text-xs text-slate-500 font-medium ml-auto">
              <span className="hidden sm:inline">Don't know?</span>
              <button
                type="button"
                onPointerDown={(e) => e.preventDefault()}
                onMouseDown={(e) => e.preventDefault()}
                onTouchStart={handleTouchStartOnSubmit}
                onTouchEnd={(e) => handleTouchEndOnSubmit(e, "(No answer provided)")}
                onClick={(e) => {
                  e.preventDefault();
                  triggerSubmit("(No answer provided)");
                }}
                disabled={isSubmitting}
                className="text-slate-700 hover:text-slate-900 underline font-semibold cursor-pointer select-none touch-manipulation whitespace-nowrap"
              >
                Reveal answer
              </button>
            </div>
          </div>
        </div>

        {/* Card 2: AI Auto-Translate & AI Explanation Panel (Dark Glass Card) */}
        <div id="challenge-ai-quick-panel" className="bg-gradient-to-b from-[#1e293b] via-[#0f172a] to-[#020617] text-white p-4 sm:p-5 rounded-2xl border border-slate-700/60 shadow-lg space-y-3 relative overflow-hidden">
          {/* Button 1: AI Auto-Translate */}
          <button
            id="btn-ai-auto-translate"
            type="button"
            onClick={handleAiAutoTranslate}
            disabled={isAutoTranslating}
            className="w-full p-3.5 sm:p-4 bg-slate-700/30 hover:bg-slate-700/50 active:scale-[0.99] border border-slate-600/40 rounded-xl flex items-center justify-between text-slate-100 font-bold text-xs sm:text-sm cursor-pointer transition-all shadow-xs"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="p-2 bg-slate-600/40 text-slate-200 rounded-lg shrink-0">
                <Languages className="w-4 h-4" />
              </span>
              <span className="tracking-wide uppercase font-bold truncate">
                {isAutoTranslating ? "Translating with AI..." : "AI AUTO-TRANSLATE"}
              </span>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400 shrink-0 ml-2" />
          </button>

          {/* Button 2: AI Explanation */}
          <button
            id="btn-ai-explanation"
            type="button"
            onClick={() => setIsAskAiModalOpen(true)}
            className="w-full p-3.5 sm:p-4 bg-slate-700/30 hover:bg-slate-700/50 active:scale-[0.99] border border-slate-600/40 rounded-xl flex items-center justify-between text-slate-100 font-bold text-xs sm:text-sm cursor-pointer transition-all shadow-xs relative overflow-hidden group"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="p-2 bg-purple-600/30 text-purple-200 rounded-lg shrink-0">
                <Sparkles className="w-4 h-4" />
              </span>
              <span className="tracking-wide uppercase font-bold truncate">
                AI EXPLANATION
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0 ml-2">
              <Sparkles className="w-4 h-4 text-purple-400 animate-pulse" />
              <ChevronRight className="w-4 h-4 text-slate-400" />
            </div>
          </button>

          {/* Footer Status Metadata Row */}
          <div className="pt-1 flex items-center justify-center gap-3 sm:gap-4 text-[11px] font-mono text-slate-400 opacity-90 flex-wrap">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-0.5 bg-slate-400 inline-block rounded-full" />
              <span>{activeProvider || "OpenRouter"}</span>
            </span>
            <span className="flex items-center gap-1 text-purple-300">
              <Sparkles className="w-3 h-3 text-purple-400" />
              <span>{activeModel || "Gemini-3.8"}</span>
            </span>
            <span className="flex items-center gap-1">
              <Timer className="w-3 h-3 text-slate-400" />
              <span>{activeResponseTimeMs ? `${(activeResponseTimeMs / 1000).toFixed(1)}s` : "Timer"}</span>
            </span>
          </div>
        </div>

        {/* Translation Challenge Ask AI Modal */}
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

        {/* Report Poor Sentence Modal */}
        <ReportPoorSentenceModal
          isOpen={isReportModalOpen}
          onClose={() => setIsReportModalOpen(false)}
          challenge={challenge}
          evaluation={evaluation}
          provider={activeProvider}
          model={activeModel}
          responseTimeMs={activeResponseTimeMs}
          targetLanguage={targetLanguage}
          nativeLanguage={_nativeLanguage}
          existingReport={existingReport}
          onReportSaved={(rep) => {
            setExistingReport(rep);
            setIsReported(true);
          }}
          onReportDeleted={() => {
            setExistingReport(null);
            setIsReported(false);
          }}
          showToast={showToast}
        />
      </div>
    );
  }

  // 2. RENDER EVALUATION RESULT CARD
  if (evaluation) {
    const rawScore = typeof evaluation.score === "number" ? evaluation.score : 0;
    const clampedScore = Math.max(0, Math.min(100, Math.round(rawScore)));

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

    return (
      <div id="challenge-evaluation-card" className="w-full p-5 sm:p-6 bg-white/95 backdrop-blur-md border border-stone-200/90 rounded-3xl shadow-sm space-y-4">
        {/* Top Header */}
        <div className="flex items-center justify-between gap-2 pb-3 border-b border-stone-100">
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

          <div className="flex items-center gap-1.5 shrink-0">
            {/* Flag Poor Sentence Button */}
            <button
              id="btn-report-poor-challenge-evaluation"
              type="button"
              onClick={handleFlagClick}
              className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer shadow-3xs ${
                isReported
                  ? "bg-amber-500 hover:bg-amber-600 text-white shadow-2xs"
                  : "bg-stone-50 hover:bg-amber-50 text-stone-600 hover:text-amber-800 border border-stone-200 hover:border-amber-200"
              }`}
              title={isReported ? "Flagged for LLM tuning" : "Flag poor sentence"}
            >
              <Flag className={`w-3.5 h-3.5 ${isReported ? "fill-white text-white" : "text-stone-500"}`} />
              <span className="text-[11px] hidden sm:inline">
                {isReported ? "Flagged" : "Flag sentence"}
              </span>
            </button>

            {/* Audio Feedback Playback Button */}
            <button
              id="btn-play-essential-challenge-feedback"
              type="button"
              onClick={handlePlayEssentialAudio}
              className={`px-2.5 sm:px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer shadow-3xs hover:scale-102 active:scale-98 whitespace-nowrap ${
                isPlayingEssentialAudio
                  ? "bg-amber-500 text-white border-amber-600 animate-pulse"
                  : "bg-stone-50 hover:bg-stone-100 text-stone-700 border-stone-200"
              }`}
              title="Play feedback"
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
        </div>

        {/* Score Showcase Banner */}
        <div id="score-showcase-banner" className={`p-4 sm:p-4.5 rounded-2xl border ${scoreVerdict.cardBgClass} space-y-3 shadow-xs`}>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3.5">
              <div className={`px-3.5 py-1.5 sm:px-4 sm:py-2 rounded-2xl border flex items-baseline gap-1 shadow-xs ${scoreVerdict.scorePillClass}`}>
                <span className="text-2xl sm:text-3xl font-black tracking-tight leading-none">{clampedScore}</span>
                <span className="text-xs sm:text-sm font-bold opacity-80 leading-none">/100</span>
              </div>

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

          <p className="text-xs text-stone-700 leading-relaxed font-medium">
            {scoreVerdict.verdictDesc}
          </p>

          {/* 3-Zone Visual Meter */}
          <div className="space-y-1.5 pt-1 border-t border-stone-200/50">
            <div className="relative w-full h-3 bg-stone-200/70 rounded-full overflow-hidden flex border border-stone-300/60 shadow-inner">
              <div className="h-full bg-rose-200 border-r border-white relative" style={{ width: "60%" }}>
                <div 
                  className="h-full bg-gradient-to-r from-rose-500 to-rose-600 transition-all duration-700" 
                  style={{ width: clampedScore < 60 ? `${(clampedScore / 60) * 100}%` : "100%" }} 
                />
              </div>
              <div className="h-full bg-amber-200 border-r border-white relative" style={{ width: "20%" }}>
                {clampedScore >= 60 && (
                  <div 
                    className="h-full bg-gradient-to-r from-amber-400 to-amber-500 transition-all duration-700" 
                    style={{ width: clampedScore < 80 ? `${((clampedScore - 60) / 20) * 100}%` : "100%" }} 
                  />
                )}
              </div>
              <div className="h-full bg-emerald-200 relative" style={{ width: "20%" }}>
                {clampedScore >= 80 && (
                  <div 
                    className="h-full bg-gradient-to-r from-emerald-500 to-emerald-600 transition-all duration-700" 
                    style={{ width: `${((clampedScore - 80) / 20) * 100}%` }} 
                  />
                )}
              </div>
            </div>

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
                <div className="p-3 bg-stone-50 border border-stone-200/70 rounded-2xl space-y-1">
                  <span className="text-[10px] font-bold text-stone-500 uppercase tracking-wider font-mono block">
                    Your Submission
                  </span>
                  <p className="text-xs sm:text-sm font-medium text-stone-800 break-words">
                    "{userSub}"
                  </p>
                </div>
              )}

              <div className="p-3 bg-emerald-50/80 border border-emerald-200/80 rounded-2xl space-y-1 relative group">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider font-mono block">
                    Ideal Target Translation
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={handleFlagClick}
                      className={`p-1 rounded-md text-xs transition-colors cursor-pointer ${
                        isReported
                          ? "text-amber-800 hover:text-amber-950 bg-amber-100"
                          : "text-emerald-700/70 hover:text-emerald-950 hover:bg-emerald-100/70"
                      }`}
                      title={isReported ? "Flagged" : "Flag poor translation"}
                    >
                      <Flag className={`w-3 h-3 ${isReported ? "fill-amber-700 text-amber-700" : ""}`} />
                    </button>
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
                    title={inCol ? "Saved in collection" : "Click to add to collection"}
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

        {/* AI Response Metadata */}
        <LlmResponseMetadata
          provider={activeProvider}
          model={activeModel}
          responseTimeMs={activeResponseTimeMs}
        />

        {/* Modals */}
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

        <ReportPoorSentenceModal
          isOpen={isReportModalOpen}
          onClose={() => setIsReportModalOpen(false)}
          challenge={challenge}
          evaluation={evaluation}
          provider={activeProvider}
          model={activeModel}
          responseTimeMs={activeResponseTimeMs}
          targetLanguage={targetLanguage}
          nativeLanguage={_nativeLanguage}
          existingReport={existingReport}
          onReportSaved={(rep) => {
            setExistingReport(rep);
            setIsReported(true);
          }}
          onReportDeleted={() => {
            setExistingReport(null);
            setIsReported(false);
          }}
          showToast={showToast}
        />
      </div>
    );
  }

  return null;
}
