import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { 
  ArrowLeft, 
  X, 
  Send, 
  Square, 
  Sparkles, 
  RefreshCw 
} from "lucide-react";
import { ChatMessage, Word, TTSConfig, LLMConfig } from "../../types";
import { DEFAULT_TTS_CONFIG, stopSpeech } from "../../utils/ttsService";
import { 
  checkWordDefinitionsService, 
  sendChatMessageService, 
  generateJitSuggestedActionsService 
} from "../../services/llmClientService";
import { 
  recordUserInquiry, 
  getRecentUserInquiries, 
  getPersonalizedInitialActions 
} from "../../services/userInquiryService";
import { getUserPersonalityProfileFromDB } from "../../db/indexedDB";
import { useModalBackNavigation } from "../../hooks/useModalBackNavigation";
import { findWordInCollection, isCompletedWord, isIncompleteWord, isNoun, isPhrasalVerb, normalizeWordCategory, normalizeWordPartOfSpeech } from "../../utils/wordNormalization";
import { formatExistingWordDetails, getRemainingWordActions } from "../../utils/actionExtractor";
import { t } from "../../config/i18n";
import { subscribeLlmRequestStart, notifyLlmRequestStartFromConfig } from "../../utils/llmEvents";
import ChatMessageItem from "./ChatMessageItem";
import LlmProgressIndicator from "./LlmProgressIndicator";

export interface WordAddModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialWord?: string;
  initialHint?: string;
  initialData?: Partial<Word>;
  targetLanguage?: string;
  nativeLanguage?: string;
  appLanguage?: string;
  llmConfig?: LLMConfig;
  ttsConfig?: TTSConfig;
  words?: Word[];
  onWordAdded?: (newWord: Word) => void;
  showToast?: (msg: string) => void;
}

/**
 * Distinguishes conversational questions from single vocabulary entries to look up.
 */
function isLikelyQuestion(text: string): boolean {
  const clean = text.trim();
  if (clean.includes("?") || clean.includes("¿")) return true;

  const lower = clean.toLowerCase();

  const questionStarters = [
    "what", "how", "why", "when", "where", "who", "which", "whose", "whom",
    "can ", "could ", "would ", "should ", "is ", "are ", "do ", "does ", "did ",
    "explain", "clarify", "compare", "differentiate", "tell me", "give me",
    "usage of", "difference between", "how to use", "synonym", "antonym",
    "is it ", "can i ", "how do ",
    // Vietnamese question starters & keywords
    "tại sao", "sao ", "thế nào", "như thế nào", "là gì", "nghĩa là gì",
    "giải thích", "cho ví dụ", "phân biệt", "khác nhau", "sự khác biệt",
    "dùng như thế nào", "có thể ", "khi nào", "ở đâu", "ai ", "cách dùng",
    "từ đồng nghĩa", "từ trái nghĩa", "ngữ cảnh", "sắc thái", "formal"
  ];

  if (questionStarters.some((starter) => lower.startsWith(starter) || lower.includes(" " + starter))) {
    return true;
  }

  // If input contains more than 5 words, it is overwhelmingly likely a question/prompt
  const words = clean.split(/\s+/);
  if (words.length > 5) {
    return true;
  }

  return false;
}

export default function WordAddModal({
  isOpen,
  onClose,
  initialWord = "",
  initialHint = "",
  initialData,
  targetLanguage = "English",
  nativeLanguage = "Vietnamese",
  appLanguage = "vi",
  llmConfig = { provider: "auto", model: "auto", apiKey: "", isLoggedIn: false },
  ttsConfig = DEFAULT_TTS_CONFIG,
  words = [],
  onWordAdded,
  showToast,
}: WordAddModalProps) {
  const handleCloseModal = useCallback(() => {
    stopSpeech();
    onClose();
  }, [onClose]);

  useModalBackNavigation(isOpen, handleCloseModal);

  // Stop any active speech/audio when modal is closed or unmounted
  useEffect(() => {
    if (!isOpen) {
      stopSpeech();
    }
    return () => {
      stopSpeech();
    };
  }, [isOpen]);

  const currentAppLang = appLanguage || localStorage.getItem("vocab_learner_app_lang") || nativeLanguage || "vi";

  const [wordInput, setWordInput] = useState(initialWord || initialData?.word || "");
  const [inputText, setInputText] = useState("");
  const [currentWord, setCurrentWord] = useState<Word | null>(initialData ? (initialData as Word) : null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [activeModelInfo, setActiveModelInfo] = useState<{ provider: string; model: string } | null>(null);
  const [isGeneratingAiActions, setIsGeneratingAiActions] = useState(false);
  const [suggestedQuestions, setSuggestedQuestions] = useState<string[]>([]);

  const pendingWordSensesRef = useRef<{ word: string; senses: any[]; suggestedWords?: any[] } | null>(null);
  const pendingRetryRef = useRef<{ word: string; hint?: string } | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Auto scroll to bottom of modal messages
  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior, block: "end" });
    }, 60);
  }, []);

  const focusInput = useCallback(() => {
    inputRef.current?.focus();
  }, []);

  // Subscribe to LLM request start events to keep activeModelInfo updated with the live candidate model
  useEffect(() => {
    const unsubscribe = subscribeLlmRequestStart((data) => {
      setActiveModelInfo({ provider: data.provider, model: data.model });
    });
    return () => unsubscribe();
  }, []);

  // Keyboard shortcut: ESC to close
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleCloseModal();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, handleCloseModal]);

  // Cancel ongoing lookup or chat request
  const handleCancel = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsTyping(false);
    setActiveModelInfo(null);
  }, []);

  // Conversational chat question handler (allows asking questions while adding words)
  const handleQuestionChat = useCallback(
    async (questionText: string) => {
      if (isTyping) return;

      // Record inquiry to personalize future recommendations
      recordUserInquiry(questionText, {
        word: currentWord?.word,
        category: currentWord?.category,
        partOfSpeech: currentWord?.partOfSpeech,
        source: "add_word_modal",
      });

      const userMsgId = `user-q-${Date.now()}`;
      const userMsg: ChatMessage = {
        id: userMsgId,
        role: "user",
        content: questionText,
        timestamp: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, userMsg]);
      setIsTyping(true);
      const activeInfo = notifyLlmRequestStartFromConfig(llmConfig);
      setActiveModelInfo(activeInfo);
      scrollToBottom();

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const recentInquiries = getRecentUserInquiries(8);
        const userProfile = await getUserPersonalityProfileFromDB().catch(() => null);

        const wordContext = currentWord
          ? {
              word: currentWord.word,
              partOfSpeech: currentWord.partOfSpeech || "expression",
              pronunciation: currentWord.pronunciation || "",
              definition: currentWord.definition || "",
              translation: currentWord.translation || "",
              example: currentWord.example || "",
              exampleTranslation: currentWord.exampleTranslation || "",
              category: currentWord.category || "General",
              context: currentWord.context || "",
            }
          : undefined;

        const chatHistory = [
          ...messages.map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          })),
          { role: "user" as const, content: questionText },
        ];

        const res = await sendChatMessageService({
          messages: chatHistory,
          targetLanguage,
          nativeLanguage,
          llmConfig,
          wordContext,
          userInquiries: recentInquiries,
          userProfile,
          signal: controller.signal,
        });

        if (controller.signal.aborted) return;

        // Filter out redundant ask_ai actions
        const filteredActions = (res.suggestedActions || []).filter(
          (act: any) => act.action !== "ask_ai"
        );

        const assistantMsg: ChatMessage = {
          id: `assistant-q-${Date.now()}`,
          role: "assistant",
          content: res.text,
          timestamp: new Date().toISOString(),
          provider: res.provider,
          model: res.model,
          responseTimeMs: res.responseTimeMs,
          suggestedActions: filteredActions.length > 0 ? filteredActions : undefined,
        };

        setMessages((prev) => [...prev, assistantMsg]);
        scrollToBottom();
      } catch (err: any) {
        if (controller.signal.aborted || err?.name === "AbortError") {
          return;
        }
        console.error("WordAddModal chat question error:", err);
        const rawMsg =
          err?.userMessage ||
          err?.message ||
          (typeof err === "string" ? err : "Failed to communicate with AI provider.");
        const failedProvider = err?.provider || llmConfig?.provider || "AI";
        const failedModel = err?.model || llmConfig?.model || "model";

        const errorMsg: ChatMessage = {
          id: `error-${Date.now()}`,
          role: "assistant",
          content: rawMsg,
          timestamp: new Date().toISOString(),
          provider: failedProvider,
          model: failedModel,
          isError: true,
          errorInfo: {
            message: rawMsg,
            provider: failedProvider,
            model: failedModel,
            isTimeout: Boolean(err?.isTimeout || String(rawMsg).toLowerCase().includes("timeout")),
            canRetry: true,
          },
        };
        setMessages((prev) => [...prev, errorMsg]);
        scrollToBottom();
      } finally {
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
        setIsTyping(false);
        setActiveModelInfo(null);
      }
    },
    [isTyping, currentWord, llmConfig, scrollToBottom, messages, targetLanguage, nativeLanguage]
  );

  // Word lookup logic reusing Chat view pattern
  const handleLookup = useCallback(
    async (targetText?: string, targetHint?: string, overrideData?: Partial<Word>) => {
      const wordToLookup = (targetText ?? wordInput).trim();
      if (!wordToLookup) return;

      const effectiveHint =
        targetHint?.trim() ||
        overrideData?.context?.trim() ||
        (overrideData?.translation && overrideData.translation !== overrideData.word ? overrideData.translation.trim() : undefined) ||
        (overrideData?.definition && overrideData.definition !== overrideData.word ? overrideData.definition.trim() : undefined);

      pendingRetryRef.current = { word: wordToLookup, hint: effectiveHint || undefined };

      // Abort previous lookup if running
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;

      // 1. Add user message
      const userMsgId = `user-add-${Date.now()}`;
      const userMsg: ChatMessage = {
        id: userMsgId,
        role: "user",
        content: effectiveHint
          ? `Add word: **"${wordToLookup}"**\n*Context/Hint*: ${effectiveHint}`
          : `Add word: **"${wordToLookup}"**`,
        timestamp: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, userMsg]);
      setIsTyping(true);
      const activeInfo = notifyLlmRequestStartFromConfig(llmConfig);
      setActiveModelInfo(activeInfo);
      scrollToBottom();

      // Check if already in collection (only completed words count as existing)
      const existingMatch = findWordInCollection(words, wordToLookup);
      if (existingMatch && isCompletedWord(existingMatch)) {
        setIsTyping(false);
        setActiveModelInfo(null);
        setCurrentWord(existingMatch);
        const existingDetails = formatExistingWordDetails(existingMatch, currentAppLang);
        const remainingActions = getRemainingWordActions(messages, words, wordToLookup, currentAppLang);

        const existsMsg: ChatMessage = {
          id: `sys-exists-${Date.now()}`,
          role: "assistant",
          content: t("chat_word_already_in_collection", currentAppLang, {
            word: existingMatch.word,
            details: existingDetails,
          }),
          timestamp: new Date().toISOString(),
          audioWord: existingMatch.word,
          suggestedActions: [
            {
              label: `💡 ${t("action_add_related_words", currentAppLang, { word: existingMatch.word })}`,
              action: "send_message",
              payload: { message: `Suggest words related to "${existingMatch.word}"` },
            },
            {
              label: `➕ ${currentAppLang === "vi" ? "Thêm từ khác" : "Add another word"}`,
              action: "send_message",
              payload: { message: "add_another" },
            },
            ...remainingActions,
          ],
        };
        setMessages((prev) => [...prev, existsMsg]);
        scrollToBottom();
        return;
      }

      // Check if overrideData is ALREADY a fully completed word card (not a draft) with valid pronunciation and example sentence
      const isCompleteData =
        overrideData &&
        isCompletedWord(overrideData) &&
        overrideData.completed === true &&
        !(overrideData as any).forceLlmLookup;

      if (isCompleteData) {
        setIsTyping(false);
        setActiveModelInfo(null);
        const rawPos = overrideData.partOfSpeech || "word";
        const rawCat = overrideData.category || "General";
        const isPv = isPhrasalVerb(wordToLookup, rawPos, rawCat);
        const normPos = normalizeWordPartOfSpeech(rawPos, wordToLookup, rawCat);
        const normCat = isPv ? normalizeWordCategory(rawCat, wordToLookup, normPos) : rawCat;

        const newWordObj: Word = {
          id: overrideData.id || `word-${Date.now()}`,
          word: overrideData.word || wordToLookup,
          pronunciation: overrideData.pronunciation || "/.../",
          partOfSpeech: normPos,
          definition: overrideData.definition || "",
          translation: overrideData.translation || "",
          example: overrideData.example || undefined,
          exampleTranslation: overrideData.exampleTranslation || undefined,
          category: normCat,
          context: overrideData.context || effectiveHint || undefined,
          suggestedWords: overrideData.suggestedWords || undefined,
          learned: false,
          starred: false,
          createdAt: new Date().toISOString(),
          lastReviewed: null,
          strength: 0,
          imageUrls: overrideData.imageUrls || undefined,
          imageUrl: overrideData.imageUrl || undefined,
        };

        setCurrentWord(newWordObj);

        const isUpgradingIncomplete = Boolean(overrideData && isIncompleteWord(overrideData)) || Boolean(existingMatch && isIncompleteWord(existingMatch));

        const confirmActions = [
          {
            label: isUpgradingIncomplete
              ? t("action_complete_adding_word", currentAppLang, { word: newWordObj.word })
              : t("action_confirm_add_word", currentAppLang, {
                  word: newWordObj.word,
                  details: newWordObj.translation,
                }),
            action: "confirm_save_word" as const,
            payload: newWordObj,
          },
          {
            label: t("action_cancel", currentAppLang),
            action: "send_message" as const,
            payload: { message: "cancel" },
          },
        ];

        const confirmMsg: ChatMessage = {
          id: `sys-confirm-${Date.now()}`,
          role: "assistant",
          content: t("chat_confirm_word_preview_prompt", currentAppLang, {
            word: newWordObj.word,
            pronunciation: newWordObj.pronunciation || "",
            partOfSpeech: newWordObj.partOfSpeech,
            translation: newWordObj.translation,
            definition: newWordObj.definition,
            exampleSection:
              (isPv
                ? `\n- **${currentAppLang === "vi" ? "Thẻ" : "Tag"}**: 🏷️ **${currentAppLang === "vi" ? "Cụm động từ (Phrasal Verb)" : "Phrasal Verb"}**`
                : (normCat && normCat !== "General"
                  ? `\n- **${currentAppLang === "vi" ? "Chủ đề / Phân loại" : "Category"}**: 🏷️ ${normCat}`
                  : "")) +
              (newWordObj.example ? `\n- **${t("label_example", currentAppLang)}**: "${newWordObj.example}"` : "") +
              (newWordObj.exampleTranslation
                ? `\n- **${t("label_example_translation", currentAppLang)}**: "${newWordObj.exampleTranslation}"`
                : ""),
          }),
          timestamp: new Date().toISOString(),
          suggestedActions: confirmActions,
        };
        setMessages((prev) => [...prev, confirmMsg]);
        scrollToBottom();
        return;
      }

      try {
        const data = await checkWordDefinitionsService({
          word: wordToLookup,
          hint: effectiveHint || undefined,
          targetLanguage,
          nativeLanguage,
          cfg: llmConfig,
          signal: controller.signal,
        });

        if (controller.signal.aborted) return;

        const rawSenses = Array.isArray(data.senses) && data.senses.length > 0 ? data.senses : [];
        const validSenses = rawSenses.filter((s) => Boolean(s && (s.definition || s.translation)));

        // Multiple senses: disambiguation prompt
        if (validSenses.length > 1) {
          pendingWordSensesRef.current = {
            word: wordToLookup,
            senses: validSenses,
            suggestedWords: data.suggestedWords,
          };

          const disambigActions = validSenses.map((sense, idx) => {
            const translation = sense.translation || data.translation || "";
            const definition = sense.definition || data.definition || "";
            const partOfSpeech = sense.partOfSpeech || data.partOfSpeech || "word";
            const targetWord = sense.word || data.word || wordToLookup;
            const example = sense.example || data.example || "";

            let label = `(${partOfSpeech}) ${translation || definition}`;
            if (label.length > 50) label = label.slice(0, 47) + "...";

            return {
              label,
              action: "select_definition" as const,
              payload: {
                word: wordToLookup,
                senseIndex: idx,
                translation: translation || wordToLookup,
                targetWord,
                partOfSpeech,
                definition,
                example,
              },
            };
          });

          const disambigMsg: ChatMessage = {
            id: `sense-disambig-${Date.now()}`,
            role: "assistant",
            content: t("chat_disambiguation_prompt", currentAppLang, { word: wordToLookup, targetLanguage }),
            timestamp: new Date().toISOString(),
            suggestedActions: disambigActions,
            provider: data.provider,
            model: data.model,
            responseTimeMs: data.responseTimeMs,
          };

          setMessages((prev) => [...prev, disambigMsg]);
          scrollToBottom();
          return;
        }

        // Single sense or resolved sense
        const sense = validSenses[0];
        const targetWordStr = sense?.word || data.word || wordToLookup;
        const rawPos = sense?.partOfSpeech || data.partOfSpeech || overrideData?.partOfSpeech || "word";
        const rawCat = sense?.category || data.category || overrideData?.category || "General";
        const isPv = isPhrasalVerb(targetWordStr, rawPos, rawCat);
        const partOfSpeechVal = normalizeWordPartOfSpeech(rawPos, targetWordStr, rawCat);
        const categoryVal = isPv ? normalizeWordCategory(rawCat, targetWordStr, partOfSpeechVal) : rawCat;
        const pronunciationVal = sense?.pronunciation || data.pronunciation || "/.../";
        const definitionVal = sense?.definition || data.definition;
        const translationVal = sense?.translation || data.translation;
        const exampleVal = sense?.example || data.example || undefined;
        const exampleTranslationVal = sense?.exampleTranslation || data.exampleTranslation || undefined;

        if (!definitionVal || !translationVal) {
          const notFoundMsg: ChatMessage = {
            id: `sys-not-found-${Date.now()}`,
            role: "assistant",
            content: t("chat_lookup_not_found", currentAppLang, {
              word: wordToLookup,
              contextHintStr: effectiveHint ? ` (${effectiveHint})` : "",
            }),
            timestamp: new Date().toISOString(),
            provider: data.provider,
            model: data.model,
            responseTimeMs: data.responseTimeMs,
          };
          setMessages((prev) => [...prev, notFoundMsg]);
          scrollToBottom();
          return;
        }

        const contextVal = sense?.context || data.context || effectiveHint || definitionVal;

        const newWordObj: Word = {
          id: overrideData?.id || existingMatch?.id || `word-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
          word: targetWordStr,
          pronunciation: pronunciationVal,
          partOfSpeech: partOfSpeechVal,
          definition: definitionVal,
          translation: translationVal,
          example: exampleVal,
          exampleTranslation: exampleTranslationVal,
          category: categoryVal,
          context: contextVal,
          suggestedWords: sense?.suggestedWords || data.suggestedWords || undefined,
          learned: false,
          starred: false,
          createdAt: overrideData?.createdAt || existingMatch?.createdAt || new Date().toISOString(),
          lastReviewed: null,
          strength: 0,
          completed: true,
          imageKeyword: isNoun(partOfSpeechVal) ? (sense?.imageKeyword || data.imageKeyword || undefined) : undefined,
          imageUrls: isNoun(partOfSpeechVal) ? (sense?.imageUrls || data.imageUrls || undefined) : undefined,
          imageUrl: isNoun(partOfSpeechVal) ? (sense?.imageUrl || data.imageUrl || undefined) : undefined,
        };

        setCurrentWord(newWordObj);

        const isUpgradingIncomplete = Boolean(overrideData && isIncompleteWord(overrideData)) || Boolean(existingMatch && isIncompleteWord(existingMatch));

        const confirmActions = [
          {
            label: isUpgradingIncomplete
              ? t("action_complete_adding_word", currentAppLang, { word: targetWordStr })
              : t("action_confirm_add_word", currentAppLang, {
                  word: targetWordStr,
                  details: translationVal,
                }),
            action: "confirm_save_word" as const,
            payload: newWordObj,
          },
          {
            label: t("action_cancel", currentAppLang),
            action: "send_message" as const,
            payload: { message: "cancel" },
          },
        ];

        const confirmMsg: ChatMessage = {
          id: `sys-confirm-${Date.now()}`,
          role: "assistant",
          content: t("chat_confirm_word_preview_prompt", currentAppLang, {
            word: targetWordStr,
            pronunciation: pronunciationVal,
            partOfSpeech: partOfSpeechVal,
            translation: translationVal,
            definition: definitionVal,
            exampleSection:
              (isPv
                ? `\n- **${currentAppLang === "vi" ? "Thẻ" : "Tag"}**: 🏷️ **${currentAppLang === "vi" ? "Cụm động từ (Phrasal Verb)" : "Phrasal Verb"}**`
                : (categoryVal && categoryVal !== "General"
                  ? `\n- **${currentAppLang === "vi" ? "Chủ đề / Phân loại" : "Category"}**: 🏷️ ${categoryVal}`
                  : "")) +
              (exampleVal ? `\n- **${t("label_example", currentAppLang)}**: "${exampleVal}"` : "") +
              (exampleTranslationVal
                ? `\n- **${t("label_example_translation", currentAppLang)}**: "${exampleTranslationVal}"`
                : ""),
          }),
          timestamp: new Date().toISOString(),
          suggestedActions: confirmActions,
          provider: data.provider,
          model: data.model,
          responseTimeMs: data.responseTimeMs,
        };

        setMessages((prev) => [...prev, confirmMsg]);
        scrollToBottom();
      } catch (err: any) {
        if (controller.signal.aborted || err?.name === "AbortError") {
          return;
        }
        console.error("WordAddModal lookup error:", err);
        const rawMsg =
          err?.userMessage ||
          err?.message ||
          (typeof err === "string" ? err : "Failed to communicate with AI provider.");
        const failedProvider = err?.provider || llmConfig?.provider || "AI";
        const failedModel = err?.model || llmConfig?.model || "model";

        const errorMsg: ChatMessage = {
          id: `error-${Date.now()}`,
          role: "assistant",
          content: rawMsg,
          timestamp: new Date().toISOString(),
          provider: failedProvider,
          model: failedModel,
          isError: true,
          errorInfo: {
            message: rawMsg,
            provider: failedProvider,
            model: failedModel,
            isTimeout: Boolean(err?.isTimeout || String(rawMsg).toLowerCase().includes("timeout")),
            canRetry: true,
          },
        };
        setMessages((prev) => [...prev, errorMsg]);
        scrollToBottom();
      } finally {
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
        setIsTyping(false);
        setActiveModelInfo(null);
      }
    },
    [wordInput, words, currentAppLang, targetLanguage, nativeLanguage, llmConfig, messages, scrollToBottom]
  );

  // Initialize modal state on open
  useEffect(() => {
    if (!isOpen) return;

    if (initialWord || initialData?.word) {
      const w = initialWord || initialData?.word || "";
      const h = initialHint || initialData?.context || (initialData?.category !== "General" ? initialData?.category : "") || "";
      setWordInput(w);
      setMessages([]);
      handleLookup(w, h, initialData);
    } else {
      setWordInput("");
      setCurrentWord(null);
      setMessages([
        {
          id: `welcome-${Date.now()}`,
          role: "assistant",
          content:
            currentAppLang === "vi"
              ? "👋 **Chào mừng bạn đến với Thêm Từ Vựng!**\n\nBạn có thể:\n• Nhập từ vựng cần thêm vào ô trò chuyện bên dưới để AI tự động tra nghĩa, phiên âm và ví dụ.\n• Hoặc đặt bất kỳ câu hỏi nào về ngữ cảnh, cách dùng, sắc thái từ ngữ với AI."
              : "👋 **Welcome to Add Vocabulary Word!**\n\nYou can:\n• Type any word or phrase in the chat box below to look up definitions, pronunciation, and examples.\n• Or ask any questions about usage, nuances, collocations, or grammar with AI.",
          timestamp: new Date().toISOString(),
        },
      ]);
      setTimeout(() => focusInput(), 100);
    }
  }, [isOpen, initialWord, initialHint, initialData]);

  // Handle select sense disambiguation
  const handleSelectDefinition = useCallback(
    (word: string, senseIndex: number, translation: string) => {
      const pending = pendingWordSensesRef.current;
      if (!pending || pending.word !== word) return;

      const sense = pending.senses[senseIndex];
      if (!sense) return;

      const targetWord = (sense.word || word).trim();
      const existingMatch = findWordInCollection(words, targetWord);
      if (existingMatch && isCompletedWord(existingMatch)) {
        setCurrentWord(existingMatch);
        const existingDetails = formatExistingWordDetails(existingMatch, currentAppLang);
        const existsMsg: ChatMessage = {
          id: `sys-exists-${Date.now()}`,
          role: "assistant",
          content: t("chat_word_already_in_collection", currentAppLang, {
            word: existingMatch.word,
            details: existingDetails,
          }),
          timestamp: new Date().toISOString(),
          audioWord: existingMatch.word,
        };
        setMessages((prev) => [...prev, existsMsg]);
        pendingWordSensesRef.current = null;
        scrollToBottom();
        return;
      }

      const finalTranslation =
        translation && translation !== "undefined"
          ? translation
          : sense.translation && sense.translation !== "undefined"
          ? sense.translation
          : targetWord;

      const rawPos = sense.partOfSpeech || "noun";
      const rawCat = sense.category || "General";
      const isPv = isPhrasalVerb(targetWord, rawPos, rawCat);
      const normPos = normalizeWordPartOfSpeech(rawPos, targetWord, rawCat);
      const normCat = isPv ? normalizeWordCategory(rawCat, targetWord, normPos) : rawCat;

      const newWord: Word = {
        id: `word-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        word: targetWord,
        pronunciation: sense.pronunciation || "/.../",
        partOfSpeech: normPos,
        definition: sense.definition,
        translation: finalTranslation,
        example: sense.example || undefined,
        exampleTranslation: sense.exampleTranslation || undefined,
        category: normCat,
        context: sense.context || sense.definition,
        suggestedWords: sense.suggestedWords || pending.suggestedWords || undefined,
        learned: false,
        starred: false,
        createdAt: new Date().toISOString(),
        lastReviewed: null,
        strength: 0,
        imageKeyword: isNoun(normPos) ? sense.imageKeyword : undefined,
        imageUrls: isNoun(normPos) ? sense.imageUrls : undefined,
        imageUrl: isNoun(normPos) ? sense.imageUrl : undefined,
      };

      setCurrentWord(newWord);

      const isUpgradingIncomplete = Boolean(existingMatch && isIncompleteWord(existingMatch));

      const confirmActions = [
        {
          label: isUpgradingIncomplete
            ? t("action_complete_adding_word", currentAppLang, { word: targetWord })
            : t("action_confirm_add_word", currentAppLang, {
                word: targetWord,
                details: newWord.translation,
              }),
          action: "confirm_save_word" as const,
          payload: newWord,
        },
        {
          label: t("action_cancel", currentAppLang),
          action: "send_message" as const,
          payload: { message: "cancel" },
        },
      ];

      const confirmMsg: ChatMessage = {
        id: `sys-confirm-${Date.now()}`,
        role: "assistant",
        content: t("chat_confirm_word_preview_prompt", currentAppLang, {
          word: newWord.word,
          pronunciation: newWord.pronunciation || "",
          partOfSpeech: newWord.partOfSpeech,
          translation: newWord.translation,
          definition: newWord.definition,
          exampleSection:
            (isPv
              ? `\n- **${currentAppLang === "vi" ? "Thẻ" : "Tag"}**: 🏷️ **${currentAppLang === "vi" ? "Cụm động từ (Phrasal Verb)" : "Phrasal Verb"}**`
              : (normCat && normCat !== "General"
                ? `\n- **${currentAppLang === "vi" ? "Chủ đề / Phân loại" : "Category"}**: 🏷️ ${normCat}`
                : "")) +
            (newWord.example ? `\n- **${t("label_example", currentAppLang)}**: "${newWord.example}"` : "") +
            (newWord.exampleTranslation
              ? `\n- **${t("label_example_translation", currentAppLang)}**: "${newWord.exampleTranslation}"`
              : ""),
        }),
        timestamp: new Date().toISOString(),
        suggestedActions: confirmActions,
      };

      setMessages((prev) => [...prev, confirmMsg]);
      pendingWordSensesRef.current = null;
      scrollToBottom();
    },
    [words, currentAppLang, scrollToBottom]
  );

  // Handle saving word to vocabulary collection
  const handleConfirmAddWord = useCallback(
    (wordsToAdd: any[]) => {
      if (!wordsToAdd || wordsToAdd.length === 0) return;
      const rawWord = wordsToAdd[0] as Word;
      const isPv = isPhrasalVerb(rawWord.word, rawWord.partOfSpeech, rawWord.category);
      const newWord: Word = {
        ...rawWord,
        completed: true,
        partOfSpeech: normalizeWordPartOfSpeech(rawWord.partOfSpeech, rawWord.word, rawWord.category),
        category: isPv
          ? normalizeWordCategory(rawWord.category, rawWord.word, rawWord.partOfSpeech)
          : (rawWord.category || "General"),
      };

      setCurrentWord(newWord);

      if (onWordAdded) {
        onWordAdded(newWord);
      }

      showToast?.(
        t("toast_added_word", currentAppLang, { word: newWord.word }) || `Added "${newWord.word}" to collection!`
      );

      const successMsg: ChatMessage = {
        id: `sys-saved-${Date.now()}`,
        role: "assistant",
        content:
          currentAppLang === "vi"
            ? `🎉 **Đã lưu từ "${newWord.word}"** (*${newWord.translation}*) vào bộ từ vựng thành công!\n\nBạn có thể hỏi bất kỳ câu hỏi nào về từ này ngay trong ô chat bên dưới, hoặc chọn thêm từ khác.`
            : `🎉 **Successfully saved "${newWord.word}"** (*${newWord.translation}*) to your vocabulary library!\n\nYou can now ask any questions about this word in the chat box below, or add another word.`,
        timestamp: new Date().toISOString(),
        suggestedActions: [
          {
            label: `✨ ${currentAppLang === "vi" ? "Gợi ý câu hỏi về từ này" : "Suggest questions about this word"}`,
            action: "send_message",
            payload: { message: currentAppLang === "vi" ? `Hãy gợi ý một số câu hỏi hay về từ "${newWord.word}"` : `Suggest some useful questions about "${newWord.word}"` },
          },
          {
            label: `➕ ${currentAppLang === "vi" ? "Thêm từ khác" : "Add another word"}`,
            action: "send_message",
            payload: { message: "add_another" },
          },
          {
            label: `✓ ${currentAppLang === "vi" ? "Đóng" : "Done / Close"}`,
            action: "send_message",
            payload: { message: "close" },
          },
        ],
      };

      setMessages((prev) => [...prev, successMsg]);
      scrollToBottom();
    },
    [onWordAdded, showToast, currentAppLang, scrollToBottom]
  );

  // Handle message sending (chat commands like cancel, add_another, questions or new lookups)
  const handleSendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      if (trimmed === "cancel" || trimmed === "close") {
        handleCloseModal();
        return;
      }

      if (trimmed === "add_another") {
        setCurrentWord(null);
        setWordInput("");
        setSuggestedQuestions([]);
        const promptMsg: ChatMessage = {
          id: `sys-another-${Date.now()}`,
          role: "assistant",
          content:
            currentAppLang === "vi"
              ? "📝 Hãy nhập từ vựng mới hoặc đặt câu hỏi vào ô bên dưới."
              : "📝 Enter a new vocabulary word or ask any question in the box below.",
          timestamp: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, promptMsg]);
        scrollToBottom();
        setTimeout(() => focusInput(), 100);
        return;
      }

      // Explicit command routing:
      // "ask:" or "hỏi:" or starts with "?"
      if (/^(ask:|hỏi:|\?)\s*/i.test(trimmed)) {
        const q = trimmed.replace(/^(ask:|hỏi:|\?)\s*/i, "").trim();
        if (q) {
          handleQuestionChat(q);
          return;
        }
      }

      // "add:" or "thêm:" or "lookup:" or "tra:" or "+"
      if (/^(add:|thêm:|lookup:|tra:|\+)\s*/i.test(trimmed)) {
        const w = trimmed.replace(/^(add:|thêm:|lookup:|tra:|\+)\s*/i, "").trim();
        if (w) {
          setWordInput(w);
          handleLookup(w);
          return;
        }
      }

      // Smart routing: is it a question or a word to look up?
      if (isLikelyQuestion(trimmed)) {
        handleQuestionChat(trimmed);
      } else {
        setWordInput(trimmed);
        handleLookup(trimmed);
      }
    },
    [handleCloseModal, focusInput, handleLookup, handleQuestionChat, currentAppLang, scrollToBottom]
  );

  // Handle user submitting text through the bottom input form
  const handleSendInput = () => {
    const text = inputText.trim();
    if (!text || isTyping) return;
    setInputText("");
    handleSendMessage(text);
  };

  // Generate suggested questions using the user's historical inquiries
  const handleGenerateSuggestedQuestions = useCallback(async () => {
    if (isGeneratingAiActions || isTyping) return;
    setIsGeneratingAiActions(true);

    try {
      const recentInquiries = getRecentUserInquiries(8);

      const targetWordObj: Word = currentWord || {
        id: `temp-${Date.now()}`,
        word: wordInput.trim() || targetLanguage,
        pronunciation: "/.../",
        definition: "Current inquiry focus",
        translation: "",
        example: "",
        exampleTranslation: "",
        learned: false,
        starred: false,
        createdAt: new Date().toISOString(),
        lastReviewed: null,
        strength: 0,
        partOfSpeech: "expression",
      };

      let actions = await generateJitSuggestedActionsService({
        word: targetWordObj,
        targetLanguage,
        nativeLanguage,
        llmConfig,
        userInquiries: recentInquiries,
      });

      if (!actions || actions.length === 0) {
        actions = getPersonalizedInitialActions(targetWordObj, nativeLanguage).actions;
      }

      if (actions && actions.length > 0) {
        const questions = actions
          .map((a) => (a.payload?.message || a.label).replace(/^[✨💡❓🃏➕]\s*/, "").trim())
          .filter(Boolean);

        setSuggestedQuestions(questions.slice(0, 5));
      }
    } catch (err) {
      console.warn("Error generating suggested questions:", err);
      const fallback = currentWord
        ? [
            currentAppLang === "vi" ? `Sự khác nhau giữa "${currentWord.word}" và từ đồng nghĩa?` : `Differences between "${currentWord.word}" and synonyms?`,
            currentAppLang === "vi" ? `3 cụm từ (collocations) phổ biến với "${currentWord.word}"` : `3 common collocations with "${currentWord.word}"`,
            currentAppLang === "vi" ? `Từ này dùng trong ngữ cảnh trang trọng hay thân mật?` : `Is "${currentWord.word}" formal or informal?`,
          ]
        : [
            currentAppLang === "vi" ? "Cách phân biệt các từ dễ nhầm lẫn?" : "How to distinguish easily confused words?",
            currentAppLang === "vi" ? "Gợi ý các cụm từ collocations hữu ích" : "Suggest high-frequency collocations",
            currentAppLang === "vi" ? "Cách đặt câu tự nhiên nhất" : "How to form natural conversational sentences",
          ];
      setSuggestedQuestions(fallback);
    } finally {
      setIsGeneratingAiActions(false);
    }
  }, [isGeneratingAiActions, isTyping, currentWord, wordInput, targetLanguage, nativeLanguage, llmConfig, currentAppLang]);

  // Retry error message handler
  const handleRetryErrorMessage = useCallback(
    (messageId: string) => {
      setMessages((prev) => prev.filter((m) => m.id !== messageId));
      if (pendingRetryRef.current) {
        handleLookup(pendingRetryRef.current.word, pendingRetryRef.current.hint);
      }
    },
    [handleLookup]
  );

  // Cancel error message handler
  const handleCancelErrorMessage = useCallback((messageId: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== messageId));
  }, []);

  const isCurrentWordPhrasalVerb = currentWord
    ? isPhrasalVerb(currentWord.word, currentWord.partOfSpeech, currentWord.category)
    : false;

  const handleTogglePhrasalVerbTag = useCallback(() => {
    if (!currentWord) return;
    const isPvNow = isPhrasalVerb(currentWord.word, currentWord.partOfSpeech, currentWord.category);
    const updatedWord: Word = {
      ...currentWord,
      partOfSpeech: isPvNow ? "verb" : "phrasal verb",
      category: isPvNow ? "General" : "Phrasal Verbs",
    };
    setCurrentWord(updatedWord);

    // Also update any pending confirm_save_word action in the chat stream so saving captures the new category & POS
    setMessages((prev) =>
      prev.map((m) => {
        if (m.suggestedActions && m.suggestedActions.some((a) => a.action === "confirm_save_word")) {
          return {
            ...m,
            suggestedActions: m.suggestedActions.map((a) =>
              a.action === "confirm_save_word" ? { ...a, payload: updatedWord } : a
            ),
          };
        }
        return m;
      })
    );

    showToast?.(
      isPvNow
        ? (currentAppLang === "vi" ? `Đã bỏ thẻ "Cụm động từ" cho "${currentWord.word}"` : `Removed "Phrasal Verb" tag from "${currentWord.word}"`)
        : (currentAppLang === "vi" ? `Đã gắn thẻ "Cụm động từ" cho "${currentWord.word}"` : `Tagged "${currentWord.word}" as Phrasal Verb`)
    );
  }, [currentWord, currentAppLang, showToast]);

  if (!isOpen) return null;

  return createPortal(
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-labelledby="word-add-modal-title"
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 15 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-50 bg-white flex flex-col h-full w-full overflow-hidden"
    >
      {/* Full-Screen Header identical to WordChatModal (Ask AI) */}
      <header className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-stone-200 bg-white shrink-0 shadow-2xs z-10">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={handleCloseModal}
            className="p-2 -ml-1 rounded-full text-stone-600 hover:text-stone-950 hover:bg-stone-100 transition-colors cursor-pointer"
            aria-label="Back"
            title="Close"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 id="word-add-modal-title" className="text-base sm:text-lg font-bold text-stone-900 tracking-tight truncate">
                {currentAppLang === "vi" ? "Thêm từ vựng & Hỏi AI" : "Add Vocabulary & Ask AI"}
              </h2>
              <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300 font-mono">
                {targetLanguage}
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs text-stone-500 truncate">
              <span>{targetLanguage} &bull; {nativeLanguage}</span>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={handleCloseModal}
          className="hidden sm:inline-flex p-2 rounded-full text-stone-400 hover:text-stone-700 hover:bg-stone-100 transition-colors cursor-pointer"
          title="Close"
        >
          <X className="w-5 h-5" />
        </button>
      </header>

      {/* Active Word & Phrasal Verb Tag Bar */}
      {currentWord && (
        <div className="bg-amber-50/70 border-b border-amber-200/70 px-4 sm:px-6 py-2 shrink-0 flex items-center justify-between gap-3 flex-wrap transition-all">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <span className="text-xs font-bold text-stone-900 tracking-tight">
              {currentWord.word}
            </span>
            {currentWord.pronunciation && (
              <span className="text-[11px] text-stone-500 font-mono">
                {currentWord.pronunciation}
              </span>
            )}
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-white text-stone-700 font-medium border border-stone-200">
              {currentWord.partOfSpeech || "word"}
            </span>

            {/* Phrasal Verb Tag Badge / Toggle Button */}
            <button
              type="button"
              onClick={handleTogglePhrasalVerbTag}
              className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium border transition-all cursor-pointer shadow-3xs active:scale-95 ${
                isCurrentWordPhrasalVerb
                  ? "bg-amber-200/90 text-amber-950 border-amber-400 font-semibold"
                  : "bg-white text-stone-600 border-stone-300 hover:bg-amber-100/70 hover:text-amber-900 hover:border-amber-300"
              }`}
              title={
                isCurrentWordPhrasalVerb
                  ? (currentAppLang === "vi" ? "Thẻ: Cụm động từ (nhấp để bỏ gắn thẻ)" : "Tagged: Phrasal Verb (click to toggle off)")
                  : (currentAppLang === "vi" ? "Nhấp để gắn thẻ Cụm động từ (Phrasal Verb)" : "Click to tag as Phrasal Verb")
              }
            >
              <span>🏷️</span>
              <span>{isCurrentWordPhrasalVerb ? (currentAppLang === "vi" ? "Cụm động từ" : "Phrasal Verb") : (currentAppLang === "vi" ? "+ Thẻ Cụm động từ" : "+ Tag Phrasal Verb")}</span>
            </button>

            {currentWord.category && currentWord.category !== "Phrasal Verbs" && currentWord.category !== "General" && (
              <span className="text-[10.5px] px-2 py-0.5 rounded-full bg-white text-stone-700 border border-stone-200">
                {currentWord.category}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11px] text-stone-600 truncate max-w-xs sm:max-w-md font-medium">
              {currentWord.translation}
            </span>
          </div>
        </div>
      )}

      {/* Main Conversation Stream */}
      <main className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 space-y-4 max-w-4xl w-full mx-auto">
        {messages.map((msg, idx) => (
          <ChatMessageItem
            key={msg.id || idx}
            msg={msg}
            isLatestMessage={idx === messages.length - 1}
            messages={messages}
            targetLanguage={targetLanguage}
            nativeLanguage={nativeLanguage}
            appLanguage={currentAppLang}
            ttsConfig={ttsConfig}
            llmConfig={llmConfig}
            onSendMessage={handleSendMessage}
            onAddWord={(w, h, extra) => handleLookup(w, h, extra)}
            onAddMultipleWords={handleConfirmAddWord}
            onSelectDefinition={handleSelectDefinition}
            onRetryErrorMessage={handleRetryErrorMessage}
            onCancelErrorMessage={handleCancelErrorMessage}
            showToast={showToast || (() => {})}
            scrollToBottom={scrollToBottom}
            focusInput={focusInput}
            words={words}
            startPractice={() => {}}
            onFixGrammar={() => {}}
            setIsPhotoModalOpen={() => {}}
            handleRecordActionUse={() => {}}
            hideAskAiButton={true}
          />
        ))}

        {/* Typing / Progress Indicator */}
        {isTyping && (
          <div className="pt-2">
            <LlmProgressIndicator
              llmConfig={llmConfig}
              activeModelInfo={activeModelInfo}
              onCancel={handleCancel}
            />
          </div>
        )}

        <div ref={messagesEndRef} />
      </main>

      {/* Clean Bottom Chat Footer matching Ask AI / Chat view */}
      <footer className="border-t border-stone-200 bg-white px-3 sm:px-6 pt-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))] shrink-0 z-10">
        <div className="max-w-4xl w-full mx-auto space-y-2.5">
          {/* Suggested Questions Section */}
          <div className="flex flex-col gap-2">
            {suggestedQuestions.length > 0 ? (
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
                {suggestedQuestions.map((q, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => handleSendMessage(q)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 shrink-0 transition-colors cursor-pointer active:scale-95"
                  >
                    <Sparkles className="w-3 h-3 text-amber-600 shrink-0" />
                    <span className="truncate max-w-[260px] sm:max-w-md">{q}</span>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={handleGenerateSuggestedQuestions}
                  disabled={isGeneratingAiActions || isTyping}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs text-stone-600 hover:text-stone-900 bg-stone-100 hover:bg-stone-200/80 border border-stone-200 shrink-0 transition-all cursor-pointer disabled:opacity-50"
                  title={currentAppLang === "vi" ? "Làm mới gợi ý câu hỏi" : "Refresh suggested questions"}
                >
                  <RefreshCw className={`w-3 h-3 ${isGeneratingAiActions ? "animate-spin text-indigo-600" : ""}`} />
                  <span className="hidden sm:inline">{currentAppLang === "vi" ? "Đổi gợi ý" : "Refresh"}</span>
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={handleGenerateSuggestedQuestions}
                  disabled={isGeneratingAiActions || isTyping}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium text-stone-600 bg-stone-100 hover:bg-stone-200/80 hover:text-stone-900 border border-stone-200 transition-all cursor-pointer disabled:opacity-50 active:scale-95 shadow-2xs"
                >
                  {isGeneratingAiActions ? (
                    <>
                      <RefreshCw className="w-3 h-3 text-indigo-600 animate-spin shrink-0" />
                      <span>
                        {currentAppLang === "vi"
                          ? "Đang tạo gợi ý câu hỏi từ lịch sử..."
                          : "Generating questions based on history..."}
                      </span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3 h-3 text-amber-500 shrink-0" />
                      <span>
                        {currentAppLang === "vi"
                          ? "Gợi ý câu hỏi dựa trên lịch sử"
                          : "Suggest questions based on history"}
                      </span>
                    </>
                  )}
                </button>

                {currentWord && (
                  <span className="text-[11px] text-stone-500 truncate hidden sm:inline-flex items-center gap-1.5">
                    <span>
                      {currentAppLang === "vi"
                        ? `Từ hiện tại: "${currentWord.word}"`
                        : `Current word: "${currentWord.word}"`}
                    </span>
                    {isCurrentWordPhrasalVerb && (
                      <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-amber-100 text-amber-900 border border-amber-300 font-semibold">
                        {currentAppLang === "vi" ? "🏷️ Cụm động từ" : "🏷️ Phrasal Verb"}
                      </span>
                    )}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Text Input Row */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSendInput();
            }}
            className="flex items-center gap-2"
          >
            <div className="relative flex-1">
              <input
                ref={inputRef}
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder={
                  currentWord
                    ? currentAppLang === "vi"
                      ? `Hỏi về "${currentWord.word}" hoặc nhập từ mới...`
                      : `Ask about "${currentWord.word}" or add word...`
                    : currentAppLang === "vi"
                    ? "Nhập từ cần thêm hoặc hỏi AI..."
                    : "Add a word or ask AI..."
                }
                className="w-full h-11 px-4 pr-10 bg-stone-100 border border-transparent focus:border-stone-300 focus:bg-white rounded-full text-sm text-stone-900 placeholder:text-stone-400 focus:outline-hidden transition-all truncate shadow-2xs"
                disabled={isTyping}
              />
              {inputText && (
                <button
                  type="button"
                  onClick={() => {
                    setInputText("");
                    inputRef.current?.focus();
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-stone-400 hover:text-stone-700 rounded-full cursor-pointer transition-colors"
                  aria-label="Clear input"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {isTyping ? (
              <button
                type="button"
                onClick={handleCancel}
                className="w-11 h-11 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-full transition-all flex items-center justify-center shadow-2xs cursor-pointer shrink-0 active:scale-95"
                title={currentAppLang === "vi" ? "Dừng tạo" : "Stop"}
              >
                <Square className="w-4 h-4 fill-current" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!inputText.trim()}
                className="w-11 h-11 bg-stone-900 hover:bg-stone-800 disabled:bg-stone-200 text-white disabled:text-stone-400 rounded-full transition-all flex items-center justify-center shadow-2xs cursor-pointer disabled:cursor-not-allowed shrink-0 active:scale-95"
                aria-label="Send message"
              >
                <Send className="w-4 h-4" />
              </button>
            )}
          </form>
        </div>
      </footer>
    </motion.div>,
    document.body
  );
}
