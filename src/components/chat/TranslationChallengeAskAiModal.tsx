import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
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
} from "lucide-react";
import { ChallengeData, ChallengeEvaluation, Word, TTSConfig, LLMConfig } from "../../types";
import { speakText, stopSpeech, DEFAULT_TTS_CONFIG } from "../../utils/ttsService";
import { callLLMClientSideWithMeta, getOverrideConfig, formatLlmResponseText } from "../../services/llmClientService";
import { useModalBackNavigation } from "../../hooks/useModalBackNavigation";
import FormattedMessage from "./FormattedMessage";
import LlmResponseMetadata from "./LlmResponseMetadata";
import { recordUserInquiry } from "../../services/userInquiryService";
import { publishLlmApiError } from "../../utils/llmEvents";
import { extractCleanErrorMessage } from "../../utils/llmHelpers";

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
  onAddIncompleteWord: _onAddIncompleteWord,
  onAddWord: _onAddWord,
  showToast: _showToast,
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
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const latestResponseRef = useRef<HTMLDivElement | null>(null);
  const typingIndicatorRef = useRef<HTMLDivElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const retryAttemptsRef = useRef<number>(0);

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

  if (!isOpen) return null;

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

  const handleSendMessage = async (textToSend?: string, overrideConfig?: LLMConfig) => {
    const query = (textToSend !== undefined ? textToSend : inputText).trim();
    if (!query || isTyping) return;

    recordUserInquiry(query, {
      source: "ask_ai_dialog",
      word: challenge?.targetWordFromCollection?.word || undefined,
      category: challenge?.topicContext || "Translation Challenge",
    });

    setErrorMsg(null);
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

      const prevAttempts = retryAttemptsRef.current || 0;
      const currentAttempt = prevAttempts >= 3 ? 1 : prevAttempts + 1;
      retryAttemptsRef.current = currentAttempt;

      publishLlmApiError({
        errorMessage: cleanMsg,
        provider: err?.provider || overrideConfig?.provider || llmConfig?.provider || "auto",
        model: err?.model || overrideConfig?.model || llmConfig?.model || "auto",
        action: "challenge_ask_ai",
        retryAttempt: currentAttempt,
        maxRetries: 3,
        onRetry: (newConfig) => {
          setErrorMsg(null);
          // Remove the last user message to avoid duplication when retrying
          setMessages((prev) => prev.slice(0, -1));
          handleSendMessage(query, newConfig || overrideConfig || llmConfig);
        },
      });
    } finally {
      setIsTyping(false);
      abortControllerRef.current = null;
    }
  };

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
      {/* Simple Header */}
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
            <span className="p-1.5 bg-indigo-600 text-white rounded-lg shrink-0">
              <Sparkles className="w-4 h-4" />
            </span>
            <h2 id="challenge-ask-ai-title" className="text-base font-bold text-stone-900 truncate">
              Ask AI Support
            </h2>
          </div>
        </div>

        <button
          type="button"
          onClick={handleCloseModal}
          className="p-1.5 rounded-full text-stone-500 hover:text-stone-900 hover:bg-stone-100 transition-colors cursor-pointer"
          aria-label="Close"
          title="Close dialog"
        >
          <X className="w-5 h-5" />
        </button>
      </header>

      {/* Main Container */}
      <main className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 space-y-4 max-w-4xl w-full mx-auto">
        {/* Conversation Stream */}
        {messages.map((m, idx) => {
          const isUser = m.role === "user";
          const isLast = idx === messages.length - 1;
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

                    {/* Action buttons (Copy / Speak) */}
                    <div className="flex items-center justify-end gap-1 pt-1.5 border-t border-stone-200/50 text-stone-400">
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

        {/* Error message */}
        {errorMsg && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-center justify-between gap-2">
            <span>{errorMsg}</span>
            <button
              type="button"
              onClick={() => {
                const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
                if (lastUserMsg) {
                  handleSendMessage(lastUserMsg.content);
                }
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1 bg-rose-600 text-white font-medium rounded-md hover:bg-rose-700 transition-colors cursor-pointer shrink-0"
            >
              Retry
            </button>
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
    </motion.div>,
    document.body
  );
}
