import React, { useState, useEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { 
  ArrowLeft,
  X, 
  Send, 
  Volume2, 
  Copy, 
  Check, 
  Sparkles, 
  RotateCcw, 
  Square,
  Plus,
  RefreshCw
} from "lucide-react";
import { Word, TTSConfig, LLMConfig } from "../../types";
import { speakText, DEFAULT_TTS_CONFIG } from "../../utils/ttsService";
import { sendChatMessageService, generateJitSuggestedActionsService, ChatMessageResult } from "../../services/llmClientService";
import { 
  recordUserInquiry, 
  getRecentUserInquiries, 
  getPersonalizedInitialActions, 
  getAdaptiveBottomChips
} from "../../services/userInquiryService";
import { useModalBackNavigation } from "../../hooks/useModalBackNavigation";
import FormattedMessage from "./FormattedMessage";
import LlmResponseMetadata from "./LlmResponseMetadata";

interface WordChatModalProps {
  word: Word | null;
  isOpen?: boolean;
  onClose: () => void;
  ttsConfig?: TTSConfig;
  llmConfig?: LLMConfig;
  targetLanguage?: string;
  nativeLanguage?: string;
  appLanguage?: string;
  onAddWord?: (word: Partial<Word>) => void;
  onUpdateWord?: (updatedWord: Word) => void;
  words?: Word[];
}

interface ChatItem {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  suggestedActions?: {
    label: string;
    action: "add_word" | "start_practice" | "send_message";
    payload?: any;
  }[];
  provider?: string;
  model?: string;
  responseTimeMs?: number;
}

export default function WordChatModal({
  word,
  isOpen = true,
  onClose,
  ttsConfig = DEFAULT_TTS_CONFIG,
  llmConfig,
  targetLanguage = "English",
  nativeLanguage = "Vietnamese",
  appLanguage = "vi",
  onAddWord
}: WordChatModalProps) {
  useModalBackNavigation(Boolean(isOpen && word), onClose);

  const [messages, setMessages] = useState<ChatItem[]>([]);
  const [inputText, setInputText] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [isGeneratingAiActions, setIsGeneratingAiActions] = useState(false);
  const [generatingMessageIndex, setGeneratingMessageIndex] = useState<number | null>(null);

  const bottomChips = useMemo(() => {
    if (!word) return [];
    return getAdaptiveBottomChips(word);
  }, [word?.id, word?.word, word?.category, word?.partOfSpeech]);

  const latestResponseRef = useRef<HTMLDivElement | null>(null);
  const typingIndicatorRef = useRef<HTMLDivElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // Initialize conversation when word changes or modal opens
  useEffect(() => {
    if (word && isOpen) {
      const isSentence = Boolean(
        word.category === "Grammar & Expression" ||
        word.id?.startsWith("sentence-") ||
        (word.word && word.word.trim().split(/\s+/).length > 3 && !word.partOfSpeech)
      );
      const isReply = Boolean(
        word.category === "Conversation Reply" ||
        word.id?.startsWith("reply-")
      );
      const isQuizFeedback = Boolean(
        word.category === "Quiz Recommendation" ||
        word.id?.startsWith("quiz-")
      );

      let welcomeText = `Hello! How can I help you with the word **${word.word}**${word.translation ? ` (*${word.translation}*)` : ""}?
You can ask for natural examples, collocations, grammar patterns, or synonyms.`;

      if (isSentence) {
        welcomeText = `Hello! Let's explore this polished sentence: **"${word.word}"**${word.translation ? ` (*${word.translation}*)` : ""}.
You can ask about grammar structures, nuances, formal vs casual phrasing, or conversational contexts.`;
      } else if (isReply) {
        welcomeText = `Hello! Let's explore this suggested reply: **"${word.word}"**${word.translation ? ` (*${word.translation}*)` : ""}.
You can ask about its tone, when to use it, or how to adapt it for different people.`;
      } else if (isQuizFeedback) {
        welcomeText = `Hello! Let's explore the quiz vocabulary **${word.word}**${word.translation ? ` (*${word.translation}*)` : ""}.
${word.context ? `Context: ${word.context}\n` : ""}You can ask about its usage in questions, collocations, or memory tips.`;
      }

      setMessages([
        {
          id: `welcome-${word.id || word.word}-${Date.now()}`,
          role: "assistant",
          content: welcomeText,
          timestamp: new Date().toISOString()
        }
      ]);
      setInputText("");
      setErrorMsg(null);
      setIsTyping(false);
    }
  }, [word?.id, word?.word, isOpen, nativeLanguage]);

  // Scroll to top of the latest response/message when displaying answers
  useEffect(() => {
    if (!isOpen) return;

    // Small timeout ensures DOM elements have rendered their updated height
    const timer = setTimeout(() => {
      if (latestResponseRef.current) {
        latestResponseRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
      } else if (isTyping && typingIndicatorRef.current) {
        typingIndicatorRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 50);

    return () => clearTimeout(timer);
  }, [messages, isTyping, isOpen]);

  // Keyboard shortcut: ESC to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  if (!isOpen || !word) return null;

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

  const handleGenerateAiActions = async (targetMsgIndex?: number) => {
    if (!word || isGeneratingAiActions || isTyping) return;
    const msgIdx = targetMsgIndex ?? (messages.length - 1);
    setIsGeneratingAiActions(true);
    setGeneratingMessageIndex(msgIdx);
    try {
      const recentInquiries = getRecentUserInquiries(8);
      let aiActions = await generateJitSuggestedActionsService({
        word,
        targetLanguage,
        nativeLanguage,
        llmConfig,
        userInquiries: recentInquiries
      });
      if (!aiActions || aiActions.length === 0) {
        aiActions = getPersonalizedInitialActions(word, nativeLanguage).actions;
      }
      if (aiActions && aiActions.length > 0) {
        setMessages(prev => {
          if (prev.length === 0) return prev;
          const updated = [...prev];
          const validIdx = Math.max(0, Math.min(msgIdx, updated.length - 1));
          const currentActions = updated[validIdx]?.suggestedActions || [];
          const existingAddWordActions = currentActions.filter(a => a.action === "add_word");
          const existingActionLabels = new Set(existingAddWordActions.map(a => a.label.toLowerCase()));
          const newUniqueActions = aiActions.filter(a => !existingActionLabels.has(a.label.toLowerCase()));

          updated[validIdx] = {
            ...updated[validIdx],
            suggestedActions: [
              ...existingAddWordActions,
              ...(newUniqueActions.length > 0 ? newUniqueActions : aiActions)
            ]
          };
          return updated;
        });
      }
    } catch (err) {
      console.warn("Failed to generate AI actions:", err);
      const fallbackActions = getPersonalizedInitialActions(word, nativeLanguage).actions;
      if (fallbackActions.length > 0) {
        setMessages(prev => {
          if (prev.length === 0) return prev;
          const updated = [...prev];
          const validIdx = Math.max(0, Math.min(msgIdx, updated.length - 1));
          const currentActions = updated[validIdx]?.suggestedActions || [];
          const existingAddWordActions = currentActions.filter(a => a.action === "add_word");
          updated[validIdx] = {
            ...updated[validIdx],
            suggestedActions: [
              ...existingAddWordActions,
              ...fallbackActions
            ]
          };
          return updated;
        });
      }
    } finally {
      setIsGeneratingAiActions(false);
      setGeneratingMessageIndex(null);
    }
  };

  const populateInput = (text: string) => {
    const cleanText = text.trim();
    if (!cleanText) return;
    setInputText(cleanText);
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        inputRef.current.setSelectionRange(cleanText.length, cleanText.length);
        inputRef.current.style.height = "auto";
        inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 120)}px`;
      }
    }, 50);
  };

  const handleSendMessage = async (textToSend?: string) => {
    const messageContent = (textToSend !== undefined ? textToSend : inputText).trim();
    if (!messageContent || isTyping) return;

    setErrorMsg(null);
    setInputText("");
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
    }

    // Record user inquiry immediately to build personalized learning history without background loops
    recordUserInquiry(messageContent, {
      word: word.word,
      category: word.category,
      partOfSpeech: word.partOfSpeech
    });

    const userMessage: ChatItem = {
      id: `user-${Date.now()}`,
      role: "user",
      content: messageContent,
      timestamp: new Date().toISOString()
    };

    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setIsTyping(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const wordContext = {
        word: word.word,
        partOfSpeech: word.partOfSpeech || "noun",
        pronunciation: word.pronunciation || "",
        definition: word.definition || "",
        translation: word.translation || "",
        example: word.example || "",
        exampleTranslation: word.exampleTranslation || "",
        category: word.category || "General",
        context: word.context || "",
        suggestedWords: word.suggestedWords || [],
        learned: Boolean(word.learned),
        starred: Boolean(word.starred)
      };

      const chatHistory = nextMessages.map(m => ({
        role: m.role,
        content: m.content
      }));

      const recentInquiries = getRecentUserInquiries(8);

      const res: ChatMessageResult = await sendChatMessageService({
        messages: chatHistory,
        targetLanguage: targetLanguage || "English",
        nativeLanguage: nativeLanguage || "Vietnamese",
        llmConfig,
        wordContext,
        userInquiries: recentInquiries,
        signal: controller.signal
      });

      const filteredSuggestedActions = (res.suggestedActions || []).filter((act: any) => {
        if (!act) return false;
        if (act.action === "start_practice") return false;
        const label = (act.label || "").toLowerCase();
        if (label.includes("quiz") || label.includes("practice")) return false;
        return true;
      });

      let cleanText = res.text || "I'm sorry, I couldn't formulate a response. Please try asking again.";
      cleanText = cleanText
        .replace(/,\s*practice with a short quiz,?/gi, "")
        .replace(/or practice with a short quiz\??/gi, "")
        .replace(/practice with a short quiz,?\s*/gi, "");

      const assistantMessage: ChatItem = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: cleanText,
        timestamp: new Date().toISOString(),
        suggestedActions: filteredSuggestedActions as any,
        provider: res.provider,
        model: res.model,
        responseTimeMs: res.responseTimeMs
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (err: any) {
      if (err?.name === "AbortError" || controller.signal.aborted) {
        return;
      }
      console.error("Word Chat error:", err);
      setErrorMsg(err?.message || "Failed to get AI response. Please try again.");
    } finally {
      setIsTyping(false);
      abortControllerRef.current = null;
    }
  };

  const handleActionClick = (action: { label: string; action: string; payload?: any }) => {
    if (action.action === "add_word" && onAddWord && action.payload?.word) {
      onAddWord({
        word: action.payload.word,
        definition: action.payload.definition || "",
        translation: action.payload.translation || action.payload.hint || "",
        partOfSpeech: action.payload.partOfSpeech || "noun",
        category: word.category || "General"
      });
      setMessages(prev => [
        ...prev,
        {
          id: `added-${Date.now()}`,
          role: "assistant",
          content: `✅ Added **${action.payload.word}** to your vocabulary deck!`,
          timestamp: new Date().toISOString()
        }
      ]);
      return;
    }

    // Automatically populate the input text box with the option content so the user can review and edit before sending
    const textToPopulate = action.payload?.message || action.label || "";
    if (textToPopulate) {
      populateInput(textToPopulate);
    }
  };

  const isSentence = Boolean(
    word.category === "Grammar & Expression" ||
    word.id?.startsWith("sentence-") ||
    (word.word && word.word.trim().split(/\s+/).length > 3 && !word.partOfSpeech)
  );
  const isReply = Boolean(
    word.category === "Conversation Reply" ||
    word.id?.startsWith("reply-")
  );
  const isQuizFeedback = Boolean(
    word.category === "Quiz Recommendation" ||
    word.id?.startsWith("quiz-")
  );

  return createPortal(
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-labelledby="word-chat-title"
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 15 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-50 bg-white flex flex-col h-full w-full overflow-hidden"
    >
      {/* Clean Full-Screen Header */}
      <header className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-stone-200 bg-white shrink-0 shadow-2xs z-10">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onClose}
            className="p-2 -ml-1 rounded-full text-stone-600 hover:text-stone-950 hover:bg-stone-100 transition-colors cursor-pointer"
            aria-label="Back"
            title="Close"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 id="word-chat-title" className="text-base sm:text-lg font-bold text-stone-900 tracking-tight truncate">
                {isSentence ? "Polished Sentence" : isReply ? "Suggested Reply" : isQuizFeedback ? "Quiz Feedback" : word.word}
              </h2>
              {isSentence ? (
                <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300 font-mono">
                  Grammar & Polish
                </span>
              ) : isReply ? (
                <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300 font-mono">
                  Casual Reply
                </span>
              ) : isQuizFeedback ? (
                <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300 font-mono">
                  Quiz Review
                </span>
              ) : word.partOfSpeech ? (
                <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-stone-100 text-stone-600 border border-stone-200 font-mono">
                  {word.partOfSpeech}
                </span>
              ) : null}
            </div>

            <div className="flex items-center gap-2 text-xs text-stone-500 truncate">
              {isSentence || isReply || isQuizFeedback ? (
                <span className="text-stone-700 font-medium truncate font-serif italic">"{word.word}"</span>
              ) : (
                <>
                  {word.pronunciation && (
                    <span className="font-mono text-stone-500">{word.pronunciation}</span>
                  )}
                  {word.translation && (
                    <span className="text-stone-700 font-medium truncate">• {word.translation}</span>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={(e) => handleSpeak(word.word, e)}
            className="p-2 rounded-full text-stone-600 hover:text-stone-900 hover:bg-stone-100 transition-colors cursor-pointer"
            title={`Pronounce "${word.word}"`}
          >
            <Volume2 className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="hidden sm:inline-flex p-2 rounded-full text-stone-400 hover:text-stone-700 hover:bg-stone-100 transition-colors cursor-pointer"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Main Conversation Stream */}
      <main className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-4 max-w-3xl w-full mx-auto">
        {messages.map((m, idx) => {
          const isUser = m.role === "user";
          const isLast = idx === messages.length - 1;
          const isThisMessageGenerating = isGeneratingAiActions && generatingMessageIndex === idx;
          const hasActions = Array.isArray(m.suggestedActions) && m.suggestedActions.length > 0;
          const hasTopicSuggestions = hasActions && m.suggestedActions!.some(a => a.action === "send_message");
          return (
            <div
              key={m.id || idx}
              ref={isLast ? latestResponseRef : null}
              className={`scroll-mt-4 flex flex-col ${isUser ? "items-end" : "items-start"} space-y-1.5`}
            >
              <div
                className={`relative max-w-[90%] sm:max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                  isUser
                    ? "bg-stone-900 text-white rounded-tr-xs shadow-2xs"
                    : "bg-stone-50 text-stone-900 border border-stone-200/80 rounded-tl-xs shadow-2xs"
                }`}
              >
                {isUser ? (
                  <p className="whitespace-pre-wrap font-normal">{m.content}</p>
                ) : (
                  <div className="space-y-2.5">
                    <FormattedMessage
                      text={m.content}
                      suggestedActions={m.suggestedActions}
                      onActionClick={handleActionClick}
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

                    {/* AI Metadata Footer (Provider, Model, Response Time) */}
                    <LlmResponseMetadata
                      provider={m.provider}
                      model={m.model}
                      responseTimeMs={m.responseTimeMs}
                    />
                  </div>
                )}
              </div>

              {/* Action Chips for Assistant responses */}
              {!isUser && hasActions && (
                <div className="flex flex-col gap-1.5 pt-1.5 max-w-[95%]">
                  <div className="flex items-center justify-between text-[11px] text-stone-500 font-medium px-0.5">
                    <div className="flex items-center gap-1.5">
                      <Sparkles className="w-3 h-3 text-amber-500 shrink-0" />
                      <span>Suggested topics</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleGenerateAiActions(idx)}
                      disabled={isGeneratingAiActions || isTyping}
                      className="inline-flex items-center gap-1 text-stone-500 hover:text-stone-800 disabled:opacity-50 cursor-pointer font-medium hover:underline transition-colors"
                      title="Generate new topics"
                    >
                      <RefreshCw className={`w-2.5 h-2.5 ${isThisMessageGenerating ? "animate-spin" : ""}`} />
                      <span>{isThisMessageGenerating ? "Updating..." : "Refresh"}</span>
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {m.suggestedActions!.map((act, actIdx) => (
                      <button
                        key={actIdx}
                        type="button"
                        onClick={() => handleActionClick(act)}
                        disabled={isTyping}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-white border border-stone-200 text-stone-700 hover:border-stone-400 hover:bg-stone-50 transition-all shadow-2xs cursor-pointer active:scale-95 disabled:opacity-50 text-left"
                      >
                        {act.action === "add_word" ? (
                          <Plus className="w-3 h-3 text-indigo-600 shrink-0" />
                        ) : (
                          <Sparkles className="w-3 h-3 text-amber-500 shrink-0" />
                        )}
                        <span>{act.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* On-demand topic suggestion button: always shown at the end of every assistant answer */}
              {!isUser && (
                <div className={hasActions ? "pt-1.5" : "pt-2"}>
                  <button
                    type="button"
                    onClick={() => handleGenerateAiActions(idx)}
                    disabled={isGeneratingAiActions || isTyping}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium text-stone-600 bg-stone-100 hover:bg-stone-200/80 hover:text-stone-900 border border-stone-200 transition-all cursor-pointer disabled:opacity-50 active:scale-95 shadow-2xs"
                  >
                    {isThisMessageGenerating ? (
                      <>
                        <RefreshCw className="w-3 h-3 text-indigo-600 animate-spin shrink-0" />
                        <span>Generating topics based on history...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3 h-3 text-amber-500 shrink-0" />
                        <span>
                          {hasTopicSuggestions
                            ? "Suggest new topics based on history"
                            : "Suggest topics based on history"}
                        </span>
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {/* Typing indicator */}
        {isTyping && (
          <div
            ref={typingIndicatorRef}
            className="scroll-mt-4 flex items-center gap-2 text-xs text-stone-500 bg-stone-50 border border-stone-200 rounded-full px-4 py-2 w-fit"
          >
            <div className="flex space-x-1">
              <div className="w-1.5 h-1.5 bg-stone-500 rounded-full animate-bounce [animation-delay:-0.3s]" />
              <div className="w-1.5 h-1.5 bg-stone-500 rounded-full animate-bounce [animation-delay:-0.15s]" />
              <div className="w-1.5 h-1.5 bg-stone-500 rounded-full animate-bounce" />
            </div>
            <span className="text-stone-600 font-medium">Thinking...</span>
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
                const lastUserMsg = [...messages].reverse().find(m => m.role === "user");
                if (lastUserMsg) {
                  handleSendMessage(lastUserMsg.content);
                }
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1 bg-rose-600 text-white font-medium rounded-md hover:bg-rose-700 transition-colors cursor-pointer shrink-0"
            >
              <RotateCcw className="w-3 h-3" /> Retry
            </button>
          </div>
        )}
      </main>

      {/* Clean Bottom Input Area */}
      <footer className="border-t border-stone-200 bg-white px-4 sm:px-6 py-3 shrink-0">
        <div className="max-w-3xl w-full mx-auto space-y-2">
          {/* Quick suggestions scroll */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar text-xs">
            {bottomChips.map((chip, chipIdx) => (
              <button
                key={chipIdx}
                type="button"
                onClick={() => populateInput(chip.query || chip.label)}
                disabled={isTyping}
                className="px-3 py-1 rounded-full bg-stone-100 hover:bg-stone-200 text-stone-700 shrink-0 font-medium transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap flex items-center gap-1.5 active:scale-95"
              >
                <span>{chip.label}</span>
              </button>
            ))}
          </div>

          {/* Text Input Row */}
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
                placeholder={
                  isSentence
                    ? `Ask anything about this sentence or grammar...`
                    : isReply
                    ? `Ask about this reply's tone, nuance, or usage...`
                    : `Ask any question about "${word.word}"...`
                }
                className="w-full px-4 py-3 bg-stone-100 border border-transparent focus:border-stone-300 focus:bg-white rounded-2xl text-sm text-stone-900 placeholder:text-stone-400 focus:outline-hidden resize-none transition-all max-h-[120px]"
                disabled={isTyping}
              />
            </div>

            <button
              type="submit"
              disabled={!inputText.trim() || isTyping}
              className="w-11 h-11 bg-stone-900 hover:bg-stone-800 disabled:bg-stone-200 text-white disabled:text-stone-400 rounded-full transition-all flex items-center justify-center shadow-2xs cursor-pointer disabled:cursor-not-allowed shrink-0 active:scale-95"
              aria-label="Send message"
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
