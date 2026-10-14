import React, { useState, useEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import { 
  ArrowLeft,
  X, 
  Send, 
  Volume2, 
  Copy, 
  Check, 
  Square,
  Lightbulb,
  BookOpen,
  Sparkles,
  MessageSquare,
  AlertTriangle,
  RefreshCw,
  Plus,
  BookPlus,
  Tag,
} from "lucide-react";
import { ChallengeData, ChallengeEvaluation, Word, TTSConfig, LLMConfig } from "../../types";
import { speakText, stopSpeech, DEFAULT_TTS_CONFIG } from "../../utils/ttsService";
import { callLLMClientSideWithMeta, getOverrideConfig, formatLlmResponseText } from "../../services/llmClientService";
import { useModalBackNavigation } from "../../hooks/useModalBackNavigation";
import { isWordInCollection } from "../../utils/wordNormalization";
import FormattedMessage from "./FormattedMessage";
import LlmResponseMetadata from "./LlmResponseMetadata";
import { recordUserInquiry } from "../../services/userInquiryService";
import { extractCleanErrorMessage } from "../../utils/llmHelpers";
import { t } from "../../config/i18n";

interface TranslationChallengeAskAiModalProps {
  isOpen: boolean;
  onClose: () => void;
  challenge?: ChallengeData;
  evaluation?: ChallengeEvaluation;
  nativeLanguage?: string;
  targetLanguage?: string;
  appLanguage?: string;
  ttsConfig?: TTSConfig;
  llmConfig?: LLMConfig;
  words?: Word[];
  onAddIncompleteWord?: (wordData: Partial<Word>) => void;
  onAddWord?: (wordText?: string, hint?: string, extraData?: Partial<Word>) => void;
  showToast?: (msg: string) => void;
}

interface ChatItem {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  suggestedActions?: {
    label: string;
    action: string;
    payload?: any;
  }[];
  provider?: string;
  model?: string;
  responseTimeMs?: number;
}

/**
 * Extracts potential bold or backticked vocabulary candidate terms from an AI response.
 */
function extractPotentialVocab(content: string): string[] {
  if (!content) return [];
  const found = new Set<string>();
  
  // Match bold phrases: **word** or __word__
  const boldRegex = /(?:\*\*|__)(.*?)(?:\*\*|__)/g;
  let match: RegExpExecArray | null;
  while ((match = boldRegex.exec(content)) !== null) {
    const raw = match[1].trim().replace(/^["“'‘(]|["”'’)]$/g, "").trim();
    if (
      raw &&
      raw.length >= 2 &&
      raw.length <= 40 &&
      !raw.includes("\n") &&
      !/[.!?]$/.test(raw) &&
      !raw.startsWith("#") &&
      !raw.toLowerCase().startsWith("http")
    ) {
      found.add(raw);
    }
  }

  // Match inline backticks: `word`
  const codeRegex = /`([^`]+)`/g;
  while ((match = codeRegex.exec(content)) !== null) {
    const raw = match[1].trim().replace(/^["“'‘(]|["”'’)]$/g, "").trim();
    if (
      raw &&
      raw.length >= 2 &&
      raw.length <= 40 &&
      !raw.includes("\n") &&
      !/[.!?]$/.test(raw) &&
      !raw.startsWith("#")
    ) {
      found.add(raw);
    }
  }

  return Array.from(found);
}

export default function TranslationChallengeAskAiModal({
  isOpen,
  onClose,
  challenge,
  evaluation,
  nativeLanguage = "Vietnamese",
  targetLanguage = "English",
  appLanguage = "vi",
  ttsConfig = DEFAULT_TTS_CONFIG,
  llmConfig,
  words = [],
  onAddIncompleteWord,
  onAddWord,
  showToast,
}: TranslationChallengeAskAiModalProps) {
  const handleCloseModal = React.useCallback(() => {
    stopSpeech();
    onClose();
  }, [onClose]);

  useModalBackNavigation(isOpen, handleCloseModal);

  useEffect(() => {
    if (!isOpen) {
      stopSpeech();
    }
    return () => {
      stopSpeech();
    };
  }, [isOpen]);

  const [messages, setMessages] = useState<ChatItem[]>([]);
  const [inputText, setInputText] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(5);
  const [isCountdownCancelled, setIsCountdownCancelled] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  // Quick Add Incomplete Word Modal states
  const [isQuickAddModalOpen, setIsQuickAddModalOpen] = useState(false);
  const [quickAddWord, setQuickAddWord] = useState("");
  const [quickAddTranslation, setQuickAddTranslation] = useState("");
  const [quickAddPos, setQuickAddPos] = useState("");
  const [addedWordKeys, setAddedWordKeys] = useState<Record<string, boolean>>({});
  const [inModalToast, setInModalToast] = useState<string | null>(null);

  const latestResponseRef = useRef<HTMLDivElement | null>(null);
  const typingIndicatorRef = useRef<HTMLDivElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const quickAddInputRef = useRef<HTMLInputElement | null>(null);
  const retryAttemptsRef = useRef<number>(0);
  const retryTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Auto-clear in-modal toast
  useEffect(() => {
    if (!inModalToast) return;
    const tId = setTimeout(() => setInModalToast(null), 3500);
    return () => clearTimeout(tId);
  }, [inModalToast]);

  // Focus quick-add input when modal opens
  useEffect(() => {
    if (isQuickAddModalOpen) {
      const timer = setTimeout(() => quickAddInputRef.current?.focus(), 80);
      return () => clearTimeout(timer);
    }
  }, [isQuickAddModalOpen]);

  // Initialize conversation stream when modal opens or challenge changes
  useEffect(() => {
    if (isOpen) {
      retryAttemptsRef.current = 0;
      const promptSentence = challenge?.nativeSentence || "Translation Challenge";
      
      let welcomeText = `Hello! I'm your **AI Challenge Assistant**.

Ask me about specific words, sentence patterns, or request a subtle hint for:
> **"${promptSentence}"**

*(I will guide you step-by-step without giving away the full answer!)*`;

      if (evaluation) {
        welcomeText = `Hello! I'm your **AI Challenge Assistant**.

Let's review your translation for:
> **"${promptSentence}"**
> *Score:* **${evaluation.score}/100** (${evaluation.scoreLabel})

Ask me anything about the feedback, word nuances, or grammar!`;
      }

      setMessages([
        {
          id: `welcome-challenge-${Date.now()}`,
          role: "assistant",
          content: welcomeText,
          timestamp: new Date().toISOString(),
        },
      ]);
      setInputText("");
      setErrorMsg(null);
      setIsTyping(false);
    }
  }, [isOpen, challenge?.id, evaluation]);

  // Scroll to latest message
  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => {
      if (latestResponseRef.current) {
        latestResponseRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
      } else if (isTyping && typingIndicatorRef.current) {
        typingIndicatorRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [messages, isTyping, isOpen]);

  // Escape key listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleCloseModal();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleCloseModal]);

  const handleSpeak = (text: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    speakText(text, ttsConfig, llmConfig, targetLanguage);
  };

  const handleCopyMessage = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const handleStopGenerating = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsTyping(false);
  };

  // Open quick-add modal with optional prefilled word/translation
  const handleOpenQuickAddModal = (initialWord?: string, initialTranslation?: string, initialPos?: string) => {
    const rawWord = (initialWord || "").trim();
    setQuickAddWord(rawWord);
    setQuickAddTranslation((initialTranslation || "").trim());
    setQuickAddPos((initialPos || "").trim());
    setIsQuickAddModalOpen(true);
  };

  // One-click quick add incomplete word (e.g. from detected vocabulary chips)
  const handleQuickAddIncompleteDirect = (wordToAdd: string, translationToAdd?: string) => {
    const trimmedWord = wordToAdd.trim();
    if (!trimmedWord) return;

    const payload: Partial<Word> = {
      word: trimmedWord,
      translation: translationToAdd?.trim() || "",
      definition: translationToAdd?.trim() || `Key term from Ask AI: "${challenge?.nativeSentence || ''}"`,
      partOfSpeech: "expression",
      category: challenge?.topicContext || "Challenge Practice",
      completed: false, // Incomplete word
      context: challenge?.nativeSentence
        ? `From challenge: "${challenge.nativeSentence}"`
        : evaluation?.correctedSentence
        ? `From challenge: "${evaluation.correctedSentence}"`
        : undefined,
    };

    if (onAddIncompleteWord) {
      onAddIncompleteWord(payload);
    } else if (onAddWord) {
      onAddWord(payload.word, payload.translation, payload);
    }

    setAddedWordKeys((prev) => ({ ...prev, [trimmedWord.toLowerCase()]: true }));

    const toastMsg = t("toast_added_incomplete_word", appLanguage, { word: trimmedWord }) ||
      `Added "${trimmedWord}" to collection (incomplete)!`;
    setInModalToast(toastMsg);
    showToast?.(toastMsg);
  };

  // Save incomplete word from the modal form
  const handleSaveIncompleteWord = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmedWord = quickAddWord.trim();
    if (!trimmedWord) return;

    const payload: Partial<Word> = {
      word: trimmedWord,
      translation: quickAddTranslation.trim(),
      definition: quickAddTranslation.trim() || `Key term from Ask AI: "${challenge?.nativeSentence || ''}"`,
      partOfSpeech: quickAddPos.trim() || "expression",
      category: challenge?.topicContext || "Challenge Practice",
      completed: false, // Incomplete word
      context: challenge?.nativeSentence
        ? `From challenge: "${challenge.nativeSentence}"`
        : evaluation?.correctedSentence
        ? `From challenge: "${evaluation.correctedSentence}"`
        : undefined,
    };

    if (onAddIncompleteWord) {
      onAddIncompleteWord(payload);
    } else if (onAddWord) {
      onAddWord(payload.word, payload.translation, payload);
    }

    setAddedWordKeys((prev) => ({ ...prev, [trimmedWord.toLowerCase()]: true }));

    const toastMsg = t("toast_added_incomplete_word", appLanguage, { word: trimmedWord }) ||
      `Added "${trimmedWord}" to collection (incomplete)!`;
    setInModalToast(toastMsg);
    showToast?.(toastMsg);

    setIsQuickAddModalOpen(false);
    setQuickAddWord("");
    setQuickAddTranslation("");
    setQuickAddPos("");
  };

  // Candidate vocabulary suggestions derived from challenge context and chat messages
  const suggestedPills = useMemo(() => {
    const list: { word: string; translation?: string; pos?: string }[] = [];
    const seen = new Set<string>();

    // From challenge target word
    if (challenge?.targetWordFromCollection?.word) {
      const w = challenge.targetWordFromCollection.word.trim();
      const lower = w.toLowerCase();
      if (!seen.has(lower)) {
        seen.add(lower);
        list.push({
          word: w,
          translation: challenge.targetWordFromCollection.translation,
          pos: challenge.targetWordFromCollection.partOfSpeech,
        });
      }
    }

    // From key target words
    if (challenge?.keyTargetWords && challenge.keyTargetWords.length > 0) {
      for (const kw of challenge.keyTargetWords) {
        if (!kw.word) continue;
        const w = kw.word.trim();
        const lower = w.toLowerCase();
        if (!seen.has(lower)) {
          seen.add(lower);
          list.push({ word: w, translation: kw.translation });
        }
      }
    }

    // From suggested vocabulary in evaluation
    if (evaluation?.suggestedVocabulary && evaluation.suggestedVocabulary.length > 0) {
      for (const sv of evaluation.suggestedVocabulary) {
        if (!sv.word) continue;
        const w = sv.word.trim();
        const lower = w.toLowerCase();
        if (!seen.has(lower)) {
          seen.add(lower);
          list.push({ word: w, translation: sv.translation, pos: sv.partOfSpeech });
        }
      }
    }

    // From latest assistant message
    const lastAssistantMsg = [...messages].reverse().find((m) => m.role === "assistant");
    if (lastAssistantMsg) {
      const extracted = extractPotentialVocab(lastAssistantMsg.content);
      for (const w of extracted) {
        const lower = w.toLowerCase();
        if (!seen.has(lower)) {
          seen.add(lower);
          list.push({ word: w });
        }
      }
    }

    return list.slice(0, 8);
  }, [challenge, evaluation, messages]);

  const handleSendMessage = async (textToSend?: string, overrideConfig?: LLMConfig) => {
    const query = (textToSend !== undefined ? textToSend : inputText).trim();
    if (!query || isTyping) return;

    recordUserInquiry(query, {
      source: "ask_ai_dialog",
      word: challenge?.targetWordFromCollection?.word || undefined,
      category: challenge?.topicContext || "Translation Challenge",
    });

    if (retryTimerRef.current) {
      clearInterval(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    setErrorMsg(null);
    setIsCountdownCancelled(false);
    setInputText("");
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
    }

    const userMessage: ChatItem = {
      id: `user-${Date.now()}`,
      role: "user",
      content: query,
      timestamp: new Date().toISOString(),
    };

    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setIsTyping(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const effectiveConfig = getOverrideConfig(overrideConfig || llmConfig);
      const promptSentence = challenge?.nativeSentence || "";
      const idealTranslation = challenge?.idealTranslation || "";
      const topicContext = challenge?.topicContext || "Daily Conversation";
      const keyVocab = JSON.stringify(challenge?.keyTargetWords || []);
      const targetWordCol = challenge?.targetWordFromCollection?.word || "";

      let evaluationContextStr = "";
      if (evaluation) {
        evaluationContextStr = `
USER EVALUATION RESULTS:
- Learner Answer: "${evaluation.userTranslation || "(No answer)"}"
- Score: ${evaluation.score}/100 (${evaluation.scoreLabel})
- Ideal Translation Reference: "${evaluation.correctedSentence || idealTranslation}"
- Praise: "${evaluation.whatWentWell || "Good attempt"}"
- Areas for Improvement: "${evaluation.areasForImprovement || "Keep practicing"}"
`;
      }

      const conversationHistoryStr = nextMessages
        .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
        .join("\n");

      const explanationLang = appLanguage === "vi" || nativeLanguage.toLowerCase().includes("vietnamese") ? "Vietnamese" : "English";

      const systemInstruction = `You are a concise, helpful AI Language Tutor assisting a learner in an active Translation Challenge.

CURRENT CHALLENGE CONTEXT:
- Original Sentence to Translate (${nativeLanguage}): "${promptSentence}"
- Target Language: ${targetLanguage}
- Topic: ${topicContext}
- Featured Vocabulary: "${targetWordCol}"
- Key Vocabulary Clues: ${keyVocab}
${evaluation ? `POST-CHALLENGE REVIEW MODE: The learner has already submitted their translation (Score: ${evaluation.score}/100). You may explain their score and ideal translations.` : `ACTIVE CHALLENGE MODE: The learner is actively solving this challenge.`}
${evaluationContextStr}

CRITICAL RULES:
1. STRICT ANTI-SPOIL RULE:
   ${!evaluation ? `- NEVER output the full, complete translation sentence for "${promptSentence}". Doing so ruins the learning challenge.
   - If the learner asks for the translation of a specific word or short phrase (e.g. "${query}"): Give ONLY the direct translation of that specific word/phrase and its short meaning. Do NOT construct the full sentence for them.
   - If the learner asks for the full translation or how to translate the entire sentence: Politely refuse to give the complete answer. Instead, give a structural pattern hint (e.g. [Subject] + [Verb] + [Object]) or list key vocabulary terms, encouraging them to construct the final sentence themselves.` : `- Explain any mistakes, feedback, or alternative ways to express the sentence clearly and directly.`}

2. KEEP RESPONSES SIMPLE, COMPACT & CLEAN:
   - Zero fluff or filler: Do NOT include long greetings (e.g. "Chào bạn!", "Rất vui được hỗ trợ..."), introductory preamble ("Dưới đây là..."), or long closing questions.
   - Jump straight to the core answer or hint.
   - Keep the entire response short and scannable (2 to 5 lines maximum).
   - Format: Clean, direct Markdown with bold key terms. Do NOT write multi-paragraph lectures or redundant example lists.

3. LANGUAGE & FORMAT:
   - Explain in ${explanationLang} (with ${targetLanguage} for translated terms/keywords).
   - Output ONLY plain text Markdown. NEVER output JSON, code blocks, or raw string arrays.`;

      const promptPayload = `CONVERSATION HISTORY:
${conversationHistoryStr}

USER LATEST INQUIRY:
"${query}"`;

      const schemaDescription = ""; // Free text response

      const resWithMeta = await callLLMClientSideWithMeta(
        promptPayload,
        systemInstruction,
        schemaDescription,
        effectiveConfig,
        controller.signal,
        { action: "Challenge Ask AI" }
      );

      const formattedContent = formatLlmResponseText(resWithMeta.text);

      const assistantMessage: ChatItem = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: formattedContent,
        timestamp: new Date().toISOString(),
        provider: resWithMeta.provider,
        model: resWithMeta.model,
        responseTimeMs: resWithMeta.responseTimeMs,
      };

      setMessages((prev) => [...prev, assistantMessage]);
      retryAttemptsRef.current = 0;
    } catch (err: any) {
      if (err?.name === "AbortError" || controller.signal.aborted) {
        return;
      }
      console.error("Challenge Ask AI error:", err);
      const rawMsg =
        err?.userMessage ||
        err?.message ||
        (typeof err === "string" ? err : "Failed to get AI response. Please try again.");
      const cleanMsg = extractCleanErrorMessage(rawMsg) || rawMsg;
      setErrorMsg(cleanMsg);
      setCountdown(5);
      setIsCountdownCancelled(false);
    } finally {
      setIsTyping(false);
      abortControllerRef.current = null;
    }
  };

  // Automated 5-second countdown timer for retrying failed requests
  useEffect(() => {
    if (!errorMsg || isTyping || isCountdownCancelled) {
      if (retryTimerRef.current) {
        clearInterval(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      return;
    }

    setCountdown(5);
    retryTimerRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          if (retryTimerRef.current) {
            clearInterval(retryTimerRef.current);
            retryTimerRef.current = null;
          }
          const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
          if (lastUserMsg) {
            handleSendMessage(lastUserMsg.content);
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (retryTimerRef.current) {
        clearInterval(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, [errorMsg, isTyping, isCountdownCancelled, messages, isOpen]);

  if (!isOpen) return null;

  return createPortal(
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-labelledby="challenge-ask-ai-title"
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 15 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-50 bg-white flex flex-col h-full w-full overflow-hidden"
    >
      {/* In-Modal Notification Banner */}
      <AnimatePresence>
        {inModalToast && (
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            className="absolute top-16 left-1/2 -translate-x-1/2 z-50 bg-stone-900/95 text-amber-300 border border-amber-400/40 px-4 py-2 rounded-full text-xs font-bold shadow-xl flex items-center gap-2 pointer-events-none backdrop-blur-xs"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span>{inModalToast}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-stone-200 bg-white shrink-0 shadow-2xs z-10">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            type="button"
            onClick={handleCloseModal}
            className="p-1.5 -ml-1 rounded-full text-stone-600 hover:text-stone-900 hover:bg-stone-100 transition-colors cursor-pointer"
            aria-label="Back"
            title="Close support dialog"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-2 min-w-0">
            <span className="p-1.5 bg-indigo-600 text-white rounded-lg shrink-0 shadow-3xs">
              <Sparkles className="w-4 h-4" />
            </span>
            <h2 id="challenge-ask-ai-title" className="text-base font-bold text-stone-900 truncate">
              Ask AI Support
            </h2>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Header Action Button to Quick Add Incomplete Word */}
          <button
            type="button"
            id="btn-ask-ai-header-add-word"
            onClick={() => handleOpenQuickAddModal()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white font-bold rounded-xl text-xs transition-all cursor-pointer shadow-3xs"
            title="Quickly add new word (as incomplete word)"
          >
            <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
            <span>{appLanguage === "vi" ? "Thêm từ mới" : "Add Word"}</span>
          </button>

          <button
            type="button"
            onClick={handleCloseModal}
            className="p-1.5 rounded-full text-stone-500 hover:text-stone-900 hover:bg-stone-100 transition-colors cursor-pointer"
            aria-label="Close"
            title="Close dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 space-y-4 max-w-4xl w-full mx-auto">
        {/* Conversation Stream */}
        {messages.map((m, idx) => {
          const isUser = m.role === "user";
          const isLast = idx === messages.length - 1;
          const detectedWords = !isUser ? extractPotentialVocab(m.content) : [];

          return (
            <div
              key={m.id || idx}
              ref={isLast ? latestResponseRef : null}
              className={`scroll-mt-4 flex flex-col ${
                isUser ? "items-end ml-auto max-w-[88%] sm:max-w-[78%]" : "items-stretch w-full"
              } space-y-1.5`}
            >
              <div
                className={`relative rounded-2xl text-sm leading-relaxed ${
                  isUser
                    ? "bg-stone-900 text-white rounded-tr-xs shadow-2xs px-4 py-3"
                    : "w-full bg-stone-50 text-stone-900 border border-stone-200/80 rounded-tl-xs shadow-2xs px-4 sm:px-5 py-3.5"
                }`}
              >
                {isUser ? (
                  <p className="whitespace-pre-wrap font-normal">{m.content}</p>
                ) : (
                  <div className="space-y-2.5">
                    <FormattedMessage
                      text={m.content}
                      appLanguage={appLanguage}
                    />

                    {/* Detected Vocabulary Chips for 1-click Incomplete Word Addition */}
                    {detectedWords.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap pt-2 border-t border-stone-200/60">
                        <span className="text-[11px] font-semibold text-stone-500 flex items-center gap-1">
                          <Plus className="w-3 h-3 text-indigo-500" />
                          <span>{appLanguage === "vi" ? "Lưu nhanh:" : "Quick add:"}</span>
                        </span>
                        {detectedWords.map((cand) => {
                          const isSaved = addedWordKeys[cand.toLowerCase()] || (words && isWordInCollection(words, cand));
                          return (
                            <button
                              key={cand}
                              type="button"
                              onClick={() => {
                                if (!isSaved) {
                                  handleQuickAddIncompleteDirect(cand);
                                }
                              }}
                              disabled={isSaved}
                              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                                isSaved
                                  ? "bg-emerald-50 text-emerald-800 border border-emerald-200 cursor-default"
                                  : "bg-indigo-50 hover:bg-indigo-100 text-indigo-700 hover:text-indigo-900 border border-indigo-200/90 active:scale-95 shadow-3xs"
                              }`}
                              title={isSaved ? "Already in collection" : `Add "${cand}" as incomplete word`}
                            >
                              {isSaved ? (
                                <>
                                  <Check className="w-3 h-3 text-emerald-600 stroke-[2.5]" />
                                  <span>{cand}</span>
                                </>
                              ) : (
                                <>
                                  <Plus className="w-3 h-3 text-indigo-600 stroke-[2.5]" />
                                  <span>{cand}</span>
                                </>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {/* Action buttons (Copy / Speak / Add Word) */}
                    <div className="flex items-center justify-end gap-1 pt-1.5 border-t border-stone-200/50 text-stone-400">
                      <button
                        type="button"
                        onClick={() => handleOpenQuickAddModal()}
                        className="p-1 px-1.5 rounded hover:bg-stone-200/60 text-stone-500 hover:text-indigo-600 transition-colors cursor-pointer flex items-center gap-1 text-xs"
                        title="Quickly add new word (as incomplete word)"
                      >
                        <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                        <span className="text-[11px] font-medium hidden sm:inline">{appLanguage === "vi" ? "Thêm từ" : "Add Word"}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSpeak(m.content)}
                        className="p-1 rounded hover:bg-stone-200/60 text-stone-400 hover:text-stone-700 transition-colors cursor-pointer"
                        title="Speak aloud"
                      >
                        <Volume2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleCopyMessage(m.content, idx)}
                        className="p-1 rounded hover:bg-stone-200/60 text-stone-400 hover:text-stone-700 transition-colors cursor-pointer"
                        title="Copy text"
                      >
                        {copiedIndex === idx ? (
                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>

                    {/* AI Metadata Footer */}
                    <LlmResponseMetadata
                      provider={m.provider}
                      model={m.model}
                      responseTimeMs={m.responseTimeMs}
                    />
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* Quick Action Presets below the agent message */}
        {!isTyping && (
          <div className="p-3 bg-stone-50/80 border border-stone-200/80 rounded-2xl flex flex-wrap gap-1.5">
            {/* Quick Add Word action button in presets */}
            <button
              type="button"
              id="btn-preset-quick-add-word"
              onClick={() => handleOpenQuickAddModal()}
              className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100/90 border border-indigo-200 rounded-xl text-xs font-semibold text-indigo-900 transition-all cursor-pointer flex items-center gap-1.5 active:scale-95 shadow-3xs"
              title="Quickly add new word (as incomplete word)"
            >
              <Plus className="w-3.5 h-3.5 text-indigo-600 stroke-[2.5]" />
              <span>{appLanguage === "vi" ? "Thêm từ mới" : "Quick Add Word"}</span>
            </button>

            {!evaluation ? (
              <>
                <button
                  type="button"
                  onClick={() => handleSendMessage(`Give me a quick hint or clue to help me translate this sentence without giving away the full answer.`)}
                  disabled={isTyping}
                  className="px-3 py-1.5 bg-amber-50 hover:bg-amber-100/80 border border-amber-200 rounded-xl text-xs font-semibold text-amber-900 transition-all cursor-pointer flex items-center gap-1.5 active:scale-95 disabled:opacity-50"
                >
                  <Lightbulb className="w-3.5 h-3.5 text-amber-600" />
                  <span>Give me a hint</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleSendMessage(`What are the key vocabulary words or terms I should use for this sentence? List just the key terms without translating the whole sentence.`)}
                  disabled={isTyping}
                  className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100/80 border border-indigo-200 rounded-xl text-xs font-semibold text-indigo-900 transition-all cursor-pointer flex items-center gap-1.5 active:scale-95 disabled:opacity-50"
                >
                  <BookOpen className="w-3.5 h-3.5 text-indigo-600" />
                  <span>Key Vocabulary Clues</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleSendMessage(`What sentence structure or grammatical pattern should I follow to translate this sentence?`)}
                  disabled={isTyping}
                  className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100/80 border border-emerald-200 rounded-xl text-xs font-semibold text-emerald-900 transition-all cursor-pointer flex items-center gap-1.5 active:scale-95 disabled:opacity-50"
                >
                  <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Sentence Structure Pattern</span>
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => handleSendMessage(`Can you explain the main mistakes in my translation and how to improve?`)}
                  disabled={isTyping}
                  className="px-3 py-1.5 bg-amber-50 hover:bg-amber-100/80 border border-amber-200 rounded-xl text-xs font-semibold text-amber-900 transition-all cursor-pointer flex items-center gap-1.5 active:scale-95 disabled:opacity-50"
                >
                  <Lightbulb className="w-3.5 h-3.5 text-amber-600" />
                  <span>Explain My Mistakes</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleSendMessage(`Provide 3 different natural ways to express this sentence in ${targetLanguage}.`)}
                  disabled={isTyping}
                  className="px-3 py-1.5 bg-purple-50 hover:bg-purple-100/80 border border-purple-200 rounded-xl text-xs font-semibold text-purple-900 transition-all cursor-pointer flex items-center gap-1.5 active:scale-95 disabled:opacity-50"
                >
                  <MessageSquare className="w-3.5 h-3.5 text-purple-600" />
                  <span>3 Alternative Translations</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleSendMessage(`Break down the sentence structure and grammar rules for this sentence step by step.`)}
                  disabled={isTyping}
                  className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100/80 border border-indigo-200 rounded-xl text-xs font-semibold text-indigo-900 transition-all cursor-pointer flex items-center gap-1.5 active:scale-95 disabled:opacity-50"
                >
                  <BookOpen className="w-3.5 h-3.5 text-indigo-600" />
                  <span>Grammar Deep Dive</span>
                </button>
              </>
            )}
          </div>
        )}

        {/* Typing indicator */}
        {isTyping && (
          <div
            ref={typingIndicatorRef}
            className="scroll-mt-4 flex items-center gap-2 text-xs text-stone-500 bg-indigo-50/70 border border-indigo-200 rounded-full px-4 py-2 w-fit"
          >
            <div className="flex space-x-1">
              <div className="w-1.5 h-1.5 bg-indigo-600 rounded-full animate-bounce [animation-delay:-0.3s]" />
              <div className="w-1.5 h-1.5 bg-indigo-600 rounded-full animate-bounce [animation-delay:-0.15s]" />
              <div className="w-1.5 h-1.5 bg-indigo-600 rounded-full animate-bounce" />
            </div>
            <span className="text-indigo-950 font-medium">Support Agent is thinking...</span>
            <button
              type="button"
              onClick={handleStopGenerating}
              className="ml-2 inline-flex items-center gap-1 text-[11px] font-semibold text-rose-600 hover:text-rose-800 cursor-pointer"
            >
              <Square className="w-2.5 h-2.5 fill-current" /> Stop
            </button>
          </div>
        )}

        {/* Error message with 5s retry countdown */}
        {errorMsg && (
          <div className="p-3.5 bg-gradient-to-r from-rose-50 to-amber-50/50 border border-rose-200 rounded-2xl text-xs text-rose-900 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs animate-fade-in">
            <div className="flex items-start gap-2.5 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-rose-100 flex items-center justify-center text-rose-600 shrink-0 mt-0.5">
                <AlertTriangle className="w-4 h-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-rose-950 break-words">{errorMsg}</p>
                {!isCountdownCancelled && !isTyping ? (
                  <div className="flex items-center gap-2 mt-1.5 text-xs font-semibold text-amber-900">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                    </span>
                    <span>
                      {t("chat_error_auto_retry_countdown", appLanguage, { seconds: String(countdown) })}
                    </span>
                  </div>
                ) : (
                  <span className="text-[11px] text-stone-500 italic mt-1 block">
                    {t("chat_error_retry_cancelled", appLanguage)}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
              <button
                type="button"
                onClick={() => {
                  if (retryTimerRef.current) {
                    clearInterval(retryTimerRef.current);
                    retryTimerRef.current = null;
                  }
                  const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
                  if (lastUserMsg) {
                    handleSendMessage(lastUserMsg.content);
                  }
                }}
                disabled={isTyping}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-rose-600 hover:bg-rose-700 active:scale-95 text-white font-medium rounded-xl transition-all shadow-xs cursor-pointer text-xs"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>{t("chat_error_try_again_now", appLanguage)}</span>
              </button>
              {!isCountdownCancelled && !isTyping && (
                <button
                  type="button"
                  onClick={() => {
                    if (retryTimerRef.current) {
                      clearInterval(retryTimerRef.current);
                      retryTimerRef.current = null;
                    }
                    setIsCountdownCancelled(true);
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-white hover:bg-stone-100 border border-stone-200 text-stone-600 font-medium rounded-xl transition-colors cursor-pointer text-xs"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>{t("chat_error_cancel_retry", appLanguage)}</span>
                </button>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Input Footer */}
      <footer className="border-t border-stone-200 bg-white px-3 sm:px-6 py-3 shrink-0">
        <div className="max-w-4xl w-full mx-auto space-y-2">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSendMessage();
            }}
            className="flex items-center gap-2"
          >
            {/* Quick Add Word Button in input bar */}
            <button
              type="button"
              onClick={() => handleOpenQuickAddModal(inputText)}
              className="w-11 h-11 bg-stone-100 hover:bg-indigo-50 hover:text-indigo-600 text-stone-500 border border-stone-200/80 rounded-2xl transition-all flex items-center justify-center cursor-pointer shrink-0 active:scale-95 shadow-3xs"
              title="Quickly add new word (as incomplete word)"
            >
              <Plus className="w-4 h-4 stroke-[2.5]" />
            </button>

            <div className="relative flex-1">
              <textarea
                ref={inputRef}
                value={inputText}
                onChange={(e) => {
                  setInputText(e.target.value);
                  e.target.style.height = "auto";
                  e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
                rows={1}
                placeholder={`Ask AI support about words, hints, or grammar in this sentence...`}
                className="w-full px-4 py-3 bg-stone-100 border border-transparent focus:border-indigo-300 focus:bg-white rounded-2xl text-sm text-stone-900 placeholder:text-stone-400 focus:outline-hidden resize-none transition-all max-h-[120px]"
                disabled={isTyping}
              />
            </div>

            <button
              type="submit"
              disabled={!inputText.trim() || isTyping}
              className="w-11 h-11 bg-indigo-600 hover:bg-indigo-700 disabled:bg-stone-200 text-white disabled:text-stone-400 rounded-full transition-all flex items-center justify-center shadow-2xs cursor-pointer disabled:cursor-not-allowed shrink-0 active:scale-95"
              aria-label="Send message to AI support agent"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      </footer>

      {/* Quick Add Incomplete Word Modal */}
      <AnimatePresence>
        {isQuickAddModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-60 bg-stone-900/50 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4"
            onClick={() => setIsQuickAddModalOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              transition={{ duration: 0.18 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-3xl max-w-md w-full shadow-2xl border border-stone-200 overflow-hidden flex flex-col max-h-[90vh]"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-stone-100 bg-stone-50/80">
                <div className="flex items-center gap-2">
                  <span className="p-1.5 bg-indigo-600 text-white rounded-xl shrink-0 shadow-2xs">
                    <BookPlus className="w-4 h-4" />
                  </span>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <h3 className="text-sm font-bold text-stone-900">
                        {appLanguage === "vi" ? "Thêm từ mới" : "Quick Add Word"}
                      </h3>
                      <span className="px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-900 border border-amber-300/80 rounded-md">
                        {appLanguage === "vi" ? "Chưa hoàn thiện" : "Draft / Incomplete"}
                      </span>
                    </div>
                    <p className="text-[11px] text-stone-500">
                      {appLanguage === "vi"
                        ? "Từ sẽ được AI tự động làm giàu chi tiết trong nền"
                        : "AI will auto-enrich definition & audio in the background"}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setIsQuickAddModalOpen(false)}
                  className="p-1.5 rounded-full text-stone-400 hover:text-stone-700 hover:bg-stone-200/60 transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Form */}
              <form onSubmit={handleSaveIncompleteWord} className="p-5 space-y-4 overflow-y-auto">
                {/* Suggestions pills if available */}
                {suggestedPills.length > 0 && (
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold text-stone-500 uppercase tracking-wider block">
                      {appLanguage === "vi" ? "Gợi ý từ ngữ cảnh:" : "Suggested from context:"}
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {suggestedPills.map((sug) => {
                        const isAlready = addedWordKeys[sug.word.toLowerCase()] || (words && isWordInCollection(words, sug.word));
                        return (
                          <button
                            key={sug.word}
                            type="button"
                            onClick={() => {
                              setQuickAddWord(sug.word);
                              if (sug.translation) setQuickAddTranslation(sug.translation);
                              if (sug.pos) setQuickAddPos(sug.pos);
                            }}
                            className={`px-2.5 py-1 text-xs font-semibold rounded-lg border transition-all cursor-pointer flex items-center gap-1 ${
                              quickAddWord.toLowerCase() === sug.word.toLowerCase()
                                ? "bg-indigo-600 text-white border-indigo-600 shadow-2xs"
                                : isAlready
                                ? "bg-stone-100 text-stone-500 border-stone-200"
                                : "bg-stone-50 hover:bg-indigo-50 text-stone-800 border-stone-200/90 hover:border-indigo-300"
                            }`}
                          >
                            <span>{sug.word}</span>
                            {sug.translation && (
                              <span className={`text-[10px] ${quickAddWord.toLowerCase() === sug.word.toLowerCase() ? "text-indigo-200" : "text-stone-400"}`}>
                                ({sug.translation})
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Word Input */}
                <div className="space-y-1">
                  <label className="text-xs font-bold text-stone-700 flex items-center justify-between">
                    <span>{appLanguage === "vi" ? "Từ / Cụm từ cần lưu" : "Target Word / Phrase"} <span className="text-rose-500">*</span></span>
                    {quickAddWord.trim() && words && isWordInCollection(words, quickAddWord.trim()) && (
                      <span className="text-[11px] font-semibold text-amber-600 flex items-center gap-0.5">
                        <AlertTriangle className="w-3 h-3" />
                        <span>{appLanguage === "vi" ? "Đã có trong bộ sưu tập" : "Already in collection"}</span>
                      </span>
                    )}
                  </label>
                  <input
                    ref={quickAddInputRef}
                    type="text"
                    value={quickAddWord}
                    onChange={(e) => setQuickAddWord(e.target.value)}
                    placeholder={appLanguage === "vi" ? "ví dụ: aurora, Northern Lights..." : "e.g. aurora, Northern Lights..."}
                    className="w-full px-3.5 py-2.5 bg-stone-50 border border-stone-200 focus:border-indigo-500 focus:bg-white rounded-xl text-sm font-semibold text-stone-900 placeholder:text-stone-400 focus:outline-hidden transition-all shadow-inner"
                    required
                  />
                </div>

                {/* Meaning / Translation Input */}
                <div className="space-y-1">
                  <label className="text-xs font-bold text-stone-700">
                    <span>{appLanguage === "vi" ? "Nghĩa / Dịch nghĩa (tuỳ chọn)" : "Meaning / Translation (optional)"}</span>
                  </label>
                  <input
                    type="text"
                    value={quickAddTranslation}
                    onChange={(e) => setQuickAddTranslation(e.target.value)}
                    placeholder={appLanguage === "vi" ? "ví dụ: cực quang" : "e.g. northern lights / polar lights"}
                    className="w-full px-3.5 py-2.5 bg-stone-50 border border-stone-200 focus:border-indigo-500 focus:bg-white rounded-xl text-sm text-stone-900 placeholder:text-stone-400 focus:outline-hidden transition-all shadow-inner"
                  />
                </div>

                {/* Part of Speech */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-stone-700 flex items-center gap-1">
                    <Tag className="w-3 h-3 text-stone-400" />
                    <span>{appLanguage === "vi" ? "Từ loại (tuỳ chọn)" : "Part of Speech (optional)"}</span>
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {["noun", "verb", "adjective", "adverb", "phrasal verb", "expression"].map((pos) => (
                      <button
                        key={pos}
                        type="button"
                        onClick={() => setQuickAddPos(quickAddPos === pos ? "" : pos)}
                        className={`px-2 py-1 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                          quickAddPos === pos
                            ? "bg-indigo-100 text-indigo-900 border-indigo-300 font-bold"
                            : "bg-stone-50 text-stone-600 border-stone-200 hover:bg-stone-100"
                        }`}
                      >
                        {pos}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Context Note */}
                {challenge?.nativeSentence && (
                  <div className="p-2.5 bg-stone-50 border border-stone-200/70 rounded-xl text-xs text-stone-600">
                    <span className="font-semibold text-stone-700">{appLanguage === "vi" ? "Ngữ cảnh:" : "Context:"}</span>{" "}
                    <span className="italic">"{challenge.nativeSentence}"</span>
                  </div>
                )}

                {/* Submit / Cancel Footer */}
                <div className="pt-2 flex items-center justify-end gap-2 border-t border-stone-100">
                  <button
                    type="button"
                    onClick={() => setIsQuickAddModalOpen(false)}
                    className="px-4 py-2 rounded-xl text-xs font-semibold text-stone-600 hover:text-stone-900 hover:bg-stone-100 transition-colors cursor-pointer"
                  >
                    {appLanguage === "vi" ? "Huỷ" : "Cancel"}
                  </button>
                  <button
                    type="submit"
                    disabled={!quickAddWord.trim()}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 active:scale-95 disabled:bg-stone-200 text-white disabled:text-stone-400 text-xs font-bold rounded-xl transition-all shadow-xs flex items-center gap-1.5 cursor-pointer disabled:cursor-not-allowed"
                  >
                    <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                    <span>{appLanguage === "vi" ? "Lưu từ nháp" : "Add as Incomplete Word"}</span>
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>,
    document.body
  );
}
