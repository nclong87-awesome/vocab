import { useState, useEffect, useRef } from "react";
import { ChatMessage, Word, WordSense, LLMConfig, TTSConfig, UserStats, QuizQuestion, QuizSuggestedWord } from "../types";
import {
  sendChatMessageService,
  checkWordDefinitionsService,
  generateRandomWordsService,
  generateAiQuizQuestionsService,
  fixGrammarService,
  analyzeImageVocabService,
  suggestCasualReplyService,
} from "../services/llmClientService";
import { generateImmersionStoryService } from "../services/immersionStoryService";
import {
  getQuizCandidateWords,
  getCandidateWordsForImmersion,
  getQuizCandidates,
  getImmersionCandidates,
  isWordLearnedOrStudied,
  sortUnstudiedWordsOldestFirst,
  isWordOnReviewCooldown,
  isDueReviewCandidate,
  getDueReviewCandidates,
  hasUnresolvedQuizMistake,
} from "../utils/spacedRepetition";
import { getCertificateTopics, getGeneralTopics } from "../config/topicSuggestions";
import { saveAllWordsToDB, getAllWordsFromDB, getUserPersonalityProfileFromDB } from "../db/indexedDB";
import { recordStrengthHistory } from "../utils/strengthHistoryHelpers";
import { getRotatedVisionModel } from "../config/llmProviders";
import { extractOrGenerateTopicActions, getRemainingWordActions, formatExistingWordDetails } from "../utils/actionExtractor";
import { extractWordsFromPayload } from "../utils/jsonSanitizer";
import { lockModel } from "../utils/autoModeManager";
import { subscribeLlmRequestStart, notifyLlmRequestStartFromConfig } from "../utils/llmEvents";
import { t } from "../config/i18n";
import { speakText as speakTextService, registerSpeechTimer } from "../utils/ttsService";
import { areWordsEquivalent, findWordInCollection, isWordInCollection, isNoun, isCompletedWord, isIncompleteWord } from "../utils/wordNormalization";
import { extractPhrasalVerbsAndCollocationsFromSentence } from "../utils/quizGenerator";
import { recordUserInquiry, getRecentUserInquiries } from "../services/userInquiryService";

interface UseChatProps {
  words: Word[];
  setWords: React.Dispatch<React.SetStateAction<Word[]>>;
  stats: UserStats;
  llmConfig: LLMConfig;
  ttsConfig?: TTSConfig;
  targetLanguage: string;
  nativeLanguage: string;
  appLanguage?: string;
  handleAiApiError?: (err: any, currentConfig: LLMConfig, retryAction: (newConfig: LLMConfig) => void) => void;
  handleFinishQuiz: (score: number, total: number, correctWordIds?: string[], incorrectWordIds?: string[]) => void;
  onShowToast?: (msg: string) => void;
}

export function useChat({
  words,
  setWords,
  stats,
  llmConfig,
  ttsConfig,
  targetLanguage,
  nativeLanguage,
  appLanguage,
  handleFinishQuiz,
  onShowToast,
}: UseChatProps) {
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(() => {
    const currentAppLang = appLanguage || localStorage.getItem("vocab_learner_app_lang") || nativeLanguage;
    return [
      {
        id: "welcome-msg",
        role: "assistant",
        content: t("chat_welcome_msg", currentAppLang, { target: targetLanguage, native: nativeLanguage }),
        timestamp: new Date().toISOString(),
      },
    ];
  });

  const [isTyping, setIsTypingState] = useState(false);
  const [activeModelInfo, setActiveModelInfo] = useState<{ provider: string; model: string } | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Subscribe to LLM request start events so activeModelInfo is updated before worker execution
  useEffect(() => {
    const unsubscribe = subscribeLlmRequestStart((data) => {
      setActiveModelInfo({ provider: data.provider, model: data.model });
    });
    return () => unsubscribe();
  }, []);

  const startTypingWithConfig = (overrideConfig?: LLMConfig): LLMConfig => {
    const cfgToUse = overrideConfig || llmConfig;
    const activeInfo = notifyLlmRequestStartFromConfig(cfgToUse);
    setActiveModelInfo(activeInfo);
    setIsTypingState(true);
    return {
      ...cfgToUse,
      preferredProvider: activeInfo.provider,
      preferredModel: activeInfo.model,
    };
  };

  const setIsTyping = (val: boolean | ((prev: boolean) => boolean), overrideConfig?: LLMConfig) => {
    setIsTypingState((prev) => {
      const next = typeof val === "function" ? val(prev) : val;
      if (!next && prev) {
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
          abortControllerRef.current = null;
        }
        setActiveModelInfo(null);
      } else if (next) {
        startTypingWithConfig(overrideConfig);
      }
      return next;
    });
  };

  // Conversational state for prompting word addition & grammar fixing
  const [conversationalState, setConversationalState] = useState<
    "none" | "adding_word" | "confirming_add_word" | "generating_topic_subject" | "generating_topic_count" | "fixing_grammar" | "suggesting_reply"
  >("none");
  const [pendingTopicSubject, setPendingTopicSubject] = useState<string>("");
  const [pendingConfirmWord, setPendingConfirmWord] = useState<Word | null>(null);

  // Pending word senses for multi-definition disambiguation
  const [pendingWordSenses, setPendingWordSenses] = useState<{
    word: string;
    senses: WordSense[];
    suggestedWords?: (string | { word: string; translation?: string; hint?: string })[];
  } | null>(null);

  // In-Chat interactive conversational quiz state
  const [activeQuiz, setActiveQuiz] = useState<{
    questions: QuizQuestion[];
    currentIndex: number;
    score: number;
    correctIds: string[];
    incorrectIds: string[];
    isSandwichSession?: boolean;
    sandwichStep?: 1 | 2;
    warmupWordIds?: string[];
  } | null>(null);

  const wordsRef = useRef(words);
  useEffect(() => {
    wordsRef.current = words;
  }, [words]);

  const getEffectiveWords = async (includeIncomplete = false): Promise<Word[]> => {
    let result: Word[] = [];
    if (wordsRef.current && wordsRef.current.length > 0) {
      result = wordsRef.current;
    } else if (words && words.length > 0) {
      result = words;
    } else {
      try {
        const dbWords = await getAllWordsFromDB();
        if (dbWords && dbWords.length > 0) {
          setWords(dbWords);
          wordsRef.current = dbWords;
          result = dbWords;
        }
      } catch (e) {
        console.error("Failed to load words from DB in getEffectiveWords:", e);
      }
    }
    return includeIncomplete ? result : result.filter(w => w.completed !== false);
  };

  // Sync to local storage
  useEffect(() => {
    try {
      localStorage.setItem("vocab_learner_chat_history", JSON.stringify(chatMessages));
    } catch (e) {
      console.error(e);
    }
  }, [chatMessages, targetLanguage, nativeLanguage]);

  const pendingRetriesRef = useRef<Map<string, (newConfig: LLMConfig) => void>>(new Map());

  const triggerChatErrorWithCountdown = (
    err: any,
    currentConfig: LLMConfig,
    retryAction: (newConfig: LLMConfig) => void,
    prefix: string = "error"
  ) => {
    setIsTypingState(false);
    const rawMsg = err?.userMessage || err?.message || (typeof err === "string" ? err : "Failed to communicate with AI provider.");
    const isTimeout = Boolean(
      err?.isTimeout ||
      err?.name === "TimeoutError" ||
      rawMsg.toLowerCase().includes("timeout") ||
      rawMsg.toLowerCase().includes("timed out")
    );
    const failedProvider = err?.provider || currentConfig.provider;
    const failedModel = err?.model || currentConfig.model;

    if (failedProvider && failedModel && (currentConfig.provider === "auto" || currentConfig.model === "auto")) {
      lockModel(failedProvider, failedModel, 3600000, rawMsg);
    }

    const errorMsgId = `${prefix}-${Date.now()}`;
    pendingRetriesRef.current.set(errorMsgId, retryAction);

    const errorMsg: ChatMessage = {
      id: errorMsgId,
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
        isTimeout,
        canRetry: true,
      },
    };

    setChatMessages((prev) => [...prev, errorMsg]);
  };

  const handleRetryErrorMessage = (messageId: string) => {
    const retryFn = pendingRetriesRef.current.get(messageId);
    pendingRetriesRef.current.delete(messageId);
    // Remove the error message from the chat
    setChatMessages((prev) => prev.filter((m) => m.id !== messageId));
    if (retryFn) {
      retryFn(llmConfig);
    }
  };

  const handleCancelErrorMessage = (messageId: string) => {
    pendingRetriesRef.current.delete(messageId);
    setChatMessages((prev) =>
      prev.map((m) => {
        if (m.id === messageId && m.errorInfo) {
          return {
            ...m,
            errorInfo: {
              ...m.errorInfo,
              canRetry: false,
            },
          };
        }
        return m;
      })
    );
  };

  // Start the unified Practice flow: checks Quiz candidates first, then Immersion candidates, or displays no-words message
  const startPractice = async (
    overrideConfig?: LLMConfig,
    practiceMode: "auto" | "story_immersion" | "quiz_only" | "balanced" | "sandwich_duel" | "sandwich_quiz" | "confuser_duel" = "auto",
    options?: { warmupWordIds?: string[] }
  ) => {
    const configToUse = overrideConfig || llmConfig;
    setActiveQuiz(null);
    setConversationalState("none");
    setPendingWordSenses(null);
    setPendingTopicSubject("");
    setChatMessages([]);

    const activeWords = await getEffectiveWords();
    const currentAppLang = appLanguage || localStorage.getItem("vocab_learner_app_lang") || nativeLanguage || "Vietnamese";

    if (activeWords.length === 0) {
      const noWordsMsg: ChatMessage = {
        id: `practice-no-words-${Date.now()}`,
        role: "assistant",
        content: t("chat_quiz_no_words_warning", currentAppLang),
        timestamp: new Date().toISOString(),
        suggestedActions: [
          { label: t("qa_add_word_label", currentAppLang), action: "add_word" },
          { label: t("qa_generate_words_label", currentAppLang), action: "generate_topic" },
        ],
      };
      setChatMessages([noWordsMsg]);
      return;
    }

    const immersionCandidates = getImmersionCandidates(activeWords);
    const dueQuizCandidates = getQuizCandidates(activeWords);
    const unstudiedCandidates = activeWords.filter((w) => !isWordLearnedOrStudied(w));
    const nonCooldownActive = activeWords.filter((w) => !isWordOnReviewCooldown(w, new Date(), 2));

    const hasAvailablePractice =
      unstudiedCandidates.length > 0 ||
      dueQuizCandidates.length > 0 ||
      immersionCandidates.length > 0 ||
      nonCooldownActive.length > 0;

    if (!hasAvailablePractice) {
      const noCandidateMsg: ChatMessage = {
        id: `practice-no-candidates-${Date.now()}`,
        role: "assistant",
        content: t("chat_quiz_no_candidates_warning", currentAppLang),
        timestamp: new Date().toISOString(),
        suggestedActions: [
          { label: t("qa_add_word_label", currentAppLang), action: "add_word" },
          { label: t("qa_generate_words_label", currentAppLang), action: "generate_topic" },
        ],
      };
      setChatMessages([noCandidateMsg]);
      return;
    }

    // When practiceMode is 'auto', present practice session starter overview with details & choice
    if (practiceMode === "auto") {
      const immersionCount = immersionCandidates.length;
      const unstudiedCount = unstudiedCandidates.length;
      const dueReviews = getDueReviewCandidates(activeWords);
      const learnedWords = activeWords.filter(isWordLearnedOrStudied);
      const dueCount = dueReviews.length;
      const totalReady = immersionCount > 0 ? immersionCount : (unstudiedCount + dueCount);

      const actions: { label: string; action: string }[] = [];

      // Balanced Sandwich Loop is the premier, scientifically balanced learning mode
      if (activeWords.length >= 2) {
        actions.push({
          label: `🥪 Smart Balanced Session (Duel ➔ Quiz)`,
          action: "start_practice_balanced",
        });
      }

      // Rule: Confuser Duel -> ONLY new or unlearned words (or wrong answers in Quiz)
      const confuserCandidates = activeWords.filter(
        (w) => !isWordLearnedOrStudied(w) || hasUnresolvedQuizMistake(w)
      );
      const confuserCount = confuserCandidates.length;
      if (confuserCount >= 1) {
        actions.push({
          label: t("action_confuser_duel_count", currentAppLang, {
            count: String(confuserCount),
            label: confuserCount === 1 ? "word" : "words",
          }),
          action: "start_practice_confuser_duel",
        });
      }

      // Rule: Quiz Practice -> ONLY review words (learned words due for review or all learned words)
      const quizReviewCandidates = dueCount > 0 ? dueReviews : learnedWords;
      const quizReviewCount = quizReviewCandidates.length;
      if (quizReviewCount >= 1) {
        actions.push({
          label: t("action_quiz_practice_count", currentAppLang, {
            count: String(quizReviewCount),
            label: quizReviewCount === 1 ? "word" : "words",
          }),
          action: "start_practice_quiz_only",
        });
      }

      if (immersionCount > 0) {
        actions.push({
          label: `📖 Story Immersion (${immersionCount} ${immersionCount === 1 ? "word" : "words"})`,
          action: "start_practice_story_immersion",
        });
      }

      const breakdownText =
        unstudiedCount > 0 && dueCount > 0
          ? ` (**${unstudiedCount} new**, **${dueCount} review**)`
          : unstudiedCount > 0
          ? ` (**${unstudiedCount} new**)`
          : dueCount > 0
          ? ` (**${dueCount} review**)`
          : "";

      const choiceMsg: ChatMessage = {
        id: `practice-mode-choice-${Date.now()}`,
        role: "assistant",
        content: `### 🎯 Practice Session Overview\n\nYou have **${totalReady} word(s)** ready for practice${breakdownText}.\n\nHow would you like to practice?`,
        timestamp: new Date().toISOString(),
        suggestedActions: actions,
      };
      setChatMessages([choiceMsg]);
      return;
    }

    // --- BALANCED LEARNING LOOP STEP 1: Confuser Duel (Contrast Match) ---
    if (practiceMode === "sandwich_duel" || practiceMode === "balanced") {
      const warmupIds = new Set(options?.warmupWordIds || []);
      const warmupWords = activeWords.filter((w) => warmupIds.has(w.id));

      // Prioritize the warm-up words from Step 1 to test contrast and eliminate confusions
      let duelWords = [...warmupWords];
      if (duelWords.length === 0) {
        duelWords = getCandidateWordsForImmersion(activeWords, 3);
      }
      if (duelWords.length < 3) {
        const existingIds = new Set(duelWords.map((w) => w.id));
        const unstudied = sortUnstudiedWordsOldestFirst(
          activeWords.filter((w) => !isWordLearnedOrStudied(w) && !isWordOnReviewCooldown(w, new Date(), 2))
        );
        const nonCooldownWords = activeWords.filter((w) => !isWordOnReviewCooldown(w, new Date(), 2));
        const dueReviews = activeWords.filter((w) => isDueReviewCandidate(w, new Date(), 2));
        for (const w of [...unstudied, ...dueReviews, ...nonCooldownWords]) {
          if (!existingIds.has(w.id)) {
            duelWords.push(w);
            existingIds.add(w.id);
            if (duelWords.length >= 3) break;
          }
        }
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;
      const configForServer = startTypingWithConfig(configToUse);

      try {
        const quizResult = await generateAiQuizQuestionsService({
          words: duelWords.slice(0, 3),
          targetLanguage,
          nativeLanguage,
          llmConfig: configForServer,
          stats,
          signal: controller.signal,
          practiceMode: "sandwich_duel",
        });

        const rawQuestions = Array.isArray(quizResult) ? quizResult : (quizResult?.questions || []);
        const generatedQuestions = rawQuestions.slice(0, 3);
        const provider = Array.isArray(quizResult) ? undefined : quizResult?.provider;
        const model = Array.isArray(quizResult) ? undefined : quizResult?.model;
        const responseTimeMs = Array.isArray(quizResult) ? undefined : quizResult?.responseTimeMs;

        if (!generatedQuestions || generatedQuestions.length === 0) {
          throw new Error("No duel questions could be generated.");
        }

        const firstQ = generatedQuestions[0];

        setActiveQuiz({
          questions: generatedQuestions,
          currentIndex: 0,
          score: 0,
          correctIds: [],
          incorrectIds: [],
          isSandwichSession: true,
          sandwichStep: 1,
          warmupWordIds: Array.from(warmupIds.size > 0 ? warmupIds : duelWords.map((w) => w.id)),
        });

        const introMsg: ChatMessage = {
          id: `sandwich-duel-start-${Date.now()}`,
          role: "assistant",
          content: t("chat_sandwich_duel_intro", currentAppLang, {
            total: String(generatedQuestions.length),
            question: firstQ.question,
          }),
          timestamp: new Date().toISOString(),
          audioWord: undefined,
          quizSpeechText: firstQ.question,
          isConfuserDuel: true,
          confuserWord: firstQ.confuserWord,
          contrastRule: firstQ.contrastRule,
          suggestedActions: firstQ.options?.map((opt: any) => ({
            label: opt,
            action: "quiz_answer",
            payload: { answer: opt, wordId: firstQ.wordId },
          })) || [
            { label: firstQ.correctAnswer, action: "quiz_answer", payload: { answer: firstQ.correctAnswer, wordId: firstQ.wordId } },
          ],
          provider,
          model,
          responseTimeMs,
        };

        setChatMessages([introMsg]);
      } catch (e: any) {
        if (controller.signal.aborted || e?.name === "AbortError" || String(e).includes("aborted")) {
          console.log("Duel generation was cancelled by user.");
          return;
        }
        console.error("Error starting sandwich duel:", e);
        triggerChatErrorWithCountdown(e, configToUse, (newConfig) => startPractice(newConfig, practiceMode, options), "duel-error");
      } finally {
        setIsTyping(false);
      }
      return;
    }

    // --- CONFUSER DUEL (CONTRAST MATCH) MODE ---
    if (practiceMode === "confuser_duel") {
      // Candidate pool: strictly new/unlearned words OR words with unresolved quiz mistakes
      const confuserCandidates = activeWords.filter(
        (w) => !isWordLearnedOrStudied(w) || hasUnresolvedQuizMistake(w)
      );

      if (confuserCandidates.length === 0) {
        const noCandidateMsg: ChatMessage = {
          id: `practice-no-candidates-${Date.now()}`,
          role: "assistant",
          content: "🎉 **No candidate words for Confuser Duel right now!**\n\nConfuser Duel practices new/unlearned words or words with recent quiz errors. You currently have no unlearned words or unresolved quiz mistakes!",
          timestamp: new Date().toISOString(),
          suggestedActions: [
            { label: t("qa_add_word_label", currentAppLang), action: "add_word" },
            { label: t("qa_generate_words_label", currentAppLang), action: "generate_topic" },
          ],
        };
        setChatMessages([noCandidateMsg]);
        return;
      }

      // Priority order: 1. Unresolved quiz mistakes, 2. Unstudied / new words chronologically FIFO (oldest added first)
      const quizErrorWords = confuserCandidates.filter(hasUnresolvedQuizMistake);
      const unstudiedWords = sortUnstudiedWordsOldestFirst(
        confuserCandidates.filter((w) => !isWordLearnedOrStudied(w))
      );

      const prioritized = [...quizErrorWords, ...unstudiedWords];
      let duelWords: Word[] = [];
      const existingIds = new Set<string>();

      for (const w of prioritized) {
        if (!existingIds.has(w.id)) {
          duelWords.push(w);
          existingIds.add(w.id);
          if (duelWords.length >= 3) break;
        }
      }

      if (duelWords.length < 3 && confuserCandidates.length > duelWords.length) {
        for (const w of confuserCandidates) {
          if (!existingIds.has(w.id)) {
            duelWords.push(w);
            existingIds.add(w.id);
            if (duelWords.length >= 3) break;
          }
        }
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;
      const configForServer = startTypingWithConfig(configToUse);

      try {
        const quizResult = await generateAiQuizQuestionsService({
          words: duelWords.slice(0, 3),
          targetLanguage,
          nativeLanguage,
          llmConfig: configForServer,
          stats,
          signal: controller.signal,
          practiceMode: "confuser_duel",
        });

        const rawQuestions = Array.isArray(quizResult) ? quizResult : (quizResult?.questions || []);
        const generatedQuestions = rawQuestions.slice(0, 3);
        const provider = Array.isArray(quizResult) ? undefined : quizResult?.provider;
        const model = Array.isArray(quizResult) ? undefined : quizResult?.model;
        const responseTimeMs = Array.isArray(quizResult) ? undefined : quizResult?.responseTimeMs;

        if (!generatedQuestions || generatedQuestions.length === 0) {
          throw new Error("No duel questions could be generated.");
        }

        const firstQ = generatedQuestions[0];

        setActiveQuiz({
          questions: generatedQuestions,
          currentIndex: 0,
          score: 0,
          correctIds: [],
          incorrectIds: [],
        });

        const introMsg: ChatMessage = {
          id: `duel-start-${Date.now()}`,
          role: "assistant",
          content: `### ⚔️ Confuser Duel (Contrast Match)\n\nBreak fossilized habits with **${generatedQuestions.length} contrast challenge(s)**! Each challenge pits a word against its most easily confused rival.\n\n---\n**${firstQ.question}**`,
          timestamp: new Date().toISOString(),
          audioWord: undefined,
          quizSpeechText: firstQ.question,
          isConfuserDuel: true,
          confuserWord: firstQ.confuserWord,
          contrastRule: firstQ.contrastRule,
          suggestedActions: firstQ.options?.map((opt: any) => ({
            label: opt,
            action: "quiz_answer",
            payload: { answer: opt, wordId: firstQ.wordId },
          })) || [
            { label: firstQ.correctAnswer, action: "quiz_answer", payload: { answer: firstQ.correctAnswer, wordId: firstQ.wordId } },
          ],
          provider,
          model,
          responseTimeMs,
        };

        setChatMessages([introMsg]);
      } catch (e: any) {
        if (controller.signal.aborted || e?.name === "AbortError" || String(e).includes("aborted")) {
          console.log("Duel generation was cancelled by user.");
          return;
        }
        console.error("Error starting confuser duel:", e);
        triggerChatErrorWithCountdown(e, configToUse, (newConfig) => startPractice(newConfig, practiceMode), "quiz-error");
      } finally {
        setIsTyping(false);
      }
      return;
    }

    // Determine if we should launch Quiz mode (quiz_only OR sandwich_quiz Step 2)
    if (practiceMode === "quiz_only" || practiceMode === "sandwich_quiz") {
      const isSandwich = practiceMode === "sandwich_quiz";
      const dueReviews = getDueReviewCandidates(activeWords);
      const learnedWords = activeWords.filter(isWordLearnedOrStudied);

      // Prefer due reviews first; fallback to all learned/review words
      const candidateReviewPool = dueReviews.length > 0 ? dueReviews : learnedWords;

      if (candidateReviewPool.length === 0 && !isSandwich) {
        const noCandidateMsg: ChatMessage = {
          id: `practice-no-candidates-${Date.now()}`,
          role: "assistant",
          content: "🎉 **No review words available for Quiz Practice right now!**\n\nQuiz Practice is strictly for reviewing learned words. Please study new words first or wait until review dates are reached!",
          timestamp: new Date().toISOString(),
          suggestedActions: [
            { label: t("qa_add_word_label", currentAppLang), action: "add_word" },
            { label: t("qa_generate_words_label", currentAppLang), action: "generate_topic" },
          ],
        };
        setChatMessages([noCandidateMsg]);
        return;
      }

      // Strictly select ONLY review words (includeUnstudied: false)
      let effectiveQuizWords = getQuizCandidateWords(candidateReviewPool, {
        maxCandidates: 3,
        includeUnstudied: false,
      }).slice(0, 3);

      if (effectiveQuizWords.length === 0) {
        const nonCooldownPool = candidateReviewPool.filter((w) => !isWordOnReviewCooldown(w, new Date(), 2));
        effectiveQuizWords = nonCooldownPool.slice(0, 3);
      }

      // Top up to guarantee exactly 3 questions if non-cooldown words are available
      if (effectiveQuizWords.length < 3) {
        const existingIds = new Set(effectiveQuizWords.map((w) => w.id));
        for (const w of candidateReviewPool) {
          if (!existingIds.has(w.id) && !isWordOnReviewCooldown(w, new Date(), 2)) {
            effectiveQuizWords.push(w);
            existingIds.add(w.id);
            if (effectiveQuizWords.length >= 3) break;
          }
        }
      }
      if (effectiveQuizWords.length < 3) {
        const existingIds = new Set(effectiveQuizWords.map((w) => w.id));
        for (const w of activeWords) {
          if (!existingIds.has(w.id) && !isWordOnReviewCooldown(w, new Date(), 2)) {
            effectiveQuizWords.push(w);
            existingIds.add(w.id);
            if (effectiveQuizWords.length >= 3) break;
          }
        }
      }

      if (effectiveQuizWords.length === 0) {
        const noCandidateMsg: ChatMessage = {
          id: `practice-no-candidates-${Date.now()}`,
          role: "assistant",
          content: t("chat_quiz_no_candidates_warning", currentAppLang),
          timestamp: new Date().toISOString(),
          suggestedActions: [
            { label: t("qa_add_word_label", currentAppLang), action: "add_word" },
            { label: t("qa_generate_words_label", currentAppLang), action: "generate_topic" },
          ],
        };
        setChatMessages([noCandidateMsg]);
        return;
      }

      // Found Quiz candidates: proceed to generate and start Quiz using standard quiz generator
      const controller = new AbortController();
      abortControllerRef.current = controller;
      const configForServer = startTypingWithConfig(configToUse);

      try {
        const quizResult = await generateAiQuizQuestionsService({
          words: effectiveQuizWords.slice(0, 3),
          targetLanguage,
          nativeLanguage,
          llmConfig: configForServer,
          stats,
          signal: controller.signal,
          practiceMode: "quiz_only",
        });

        const rawQuestions = Array.isArray(quizResult) ? quizResult : (quizResult?.questions || []);
        const generatedQuestions = rawQuestions.slice(0, 3);
        const provider = Array.isArray(quizResult) ? undefined : quizResult?.provider;
        const model = Array.isArray(quizResult) ? undefined : quizResult?.model;
        const responseTimeMs = Array.isArray(quizResult) ? undefined : quizResult?.responseTimeMs;

        if (!generatedQuestions || generatedQuestions.length === 0) {
          throw new Error("No quiz questions were generated.");
        }

        const firstQ = generatedQuestions[0];

        setActiveQuiz({
          questions: generatedQuestions,
          currentIndex: 0,
          score: 0,
          correctIds: [],
          incorrectIds: [],
          isSandwichSession: isSandwich,
          sandwichStep: isSandwich ? 2 : undefined,
          warmupWordIds: options?.warmupWordIds,
        });

        const introMsg: ChatMessage = {
          id: isSandwich ? `sandwich-quiz-start-${Date.now()}` : `quiz-start-${Date.now()}`,
          role: "assistant",
          content: isSandwich
            ? t("chat_sandwich_quiz_intro", currentAppLang, {
                reviewCount: String(effectiveQuizWords.length),
                warmupCount: "0",
                total: String(generatedQuestions.length),
                question: firstQ.question,
                qTag: t("chat_sandwich_q_review_tag", currentAppLang),
              })
            : t("chat_quiz_intro", currentAppLang, {
                count: String(generatedQuestions.length),
                question: firstQ.question,
              }),
          timestamp: new Date().toISOString(),
          audioWord: firstQ.type === "listening" ? firstQ.word : undefined,
          quizSpeechText: (firstQ.type === "listening" || firstQ.type === "spelling") ? firstQ.word : firstQ.question,
          imageUrl: firstQ.imageUrl,
          imageKeyword: firstQ.imageKeyword,
          partOfSpeech: firstQ.partOfSpeech,
          suggestedActions: firstQ.options?.map((opt: any) => ({
            label: opt,
            action: "quiz_answer",
            payload: { answer: opt, wordId: firstQ.wordId },
          })) || [
            { label: firstQ.correctAnswer, action: "quiz_answer", payload: { answer: firstQ.correctAnswer, wordId: firstQ.wordId } },
          ],
          provider,
          model,
          responseTimeMs,
        };

        setChatMessages([introMsg]);
      } catch (e: any) {
        if (controller.signal.aborted || e?.name === "AbortError" || String(e).includes("aborted")) {
          console.log("Quiz generation was cancelled by user.");
          return;
        }
        console.error("Error starting quiz:", e);
        triggerChatErrorWithCountdown(e, configToUse, (newConfig) => startPractice(newConfig, practiceMode, options), "quiz-error");
      } finally {
        setIsTyping(false);
      }
      return;
    }

    // Step 2: Search for candidate words for Story Immersion (for story_immersion mode)
    const rawUnstudied = activeWords.filter((w) => !isWordLearnedOrStudied(w));
    const unstudiedWords = sortUnstudiedWordsOldestFirst(rawUnstudied);
    let batchStoryCandidates = getCandidateWordsForImmersion(activeWords, 5);
    if (practiceMode === "story_immersion" || unstudiedWords.length > 0) {
      if (unstudiedWords.length > 0) {
        batchStoryCandidates = unstudiedWords.slice(0, 5);
      } else if (immersionCandidates.length > 0) {
        batchStoryCandidates = immersionCandidates.slice(0, 5);
      }
    }
    if (batchStoryCandidates.length === 0 && activeWords.length > 0) {
      const nonCooldownWords = activeWords.filter((w) => !isWordOnReviewCooldown(w, new Date(), 2));
      batchStoryCandidates = nonCooldownWords.slice(0, 5);
    }
    if (batchStoryCandidates.length === 0) {
      const noCandidateMsg: ChatMessage = {
        id: `practice-no-candidates-${Date.now()}`,
        role: "assistant",
        content: t("chat_quiz_no_candidates_warning", currentAppLang),
        timestamp: new Date().toISOString(),
        suggestedActions: [
          { label: t("qa_add_word_label", currentAppLang), action: "add_word" },
          { label: t("qa_generate_words_label", currentAppLang), action: "generate_topic" },
        ],
      };
      setChatMessages([noCandidateMsg]);
      return;
    }
    if (batchStoryCandidates.length > 0) {
      const controller = new AbortController();
      abortControllerRef.current = controller;
      const configForServer = startTypingWithConfig(configToUse);

      try {
        const storyResult = await generateImmersionStoryService({
          targetWords: batchStoryCandidates,
          targetLanguage,
          nativeLanguage,
          cfg: configForServer,
        });

        // Update strength and review history for all studied words
        const candidateIds = new Set(batchStoryCandidates.map((w) => w.id));
        setWords((prevWords) => {
          const updatedWords = prevWords.map((w) => {
            if (candidateIds.has(w.id)) {
              const prevStrength = w.strength ?? 0;
              const calcNewStrength = Math.min(100, prevStrength + 10);
              const strengthGained = calcNewStrength - prevStrength;
              return recordStrengthHistory(
                w, 
                calcNewStrength, 
                'immersion_review', 
                `Studied Story Immersion (+${strengthGained}% strength gained)`
              );
            }
            return w;
          });
          saveAllWordsToDB(updatedWords).catch((e) => console.error("IndexedDB story word save error:", e));
          return updatedWords;
        });

        const storyMsg: ChatMessage = {
          id: `story-msg-${Date.now()}`,
          role: "assistant",
          content: `### 📖 Contextual Immersion & Dual Reader\n\nEnjoy this graded story crafted to naturally practice **${batchStoryCandidates.length} candidate words** with Comprehensible Input.`,
          timestamp: new Date().toISOString(),
          audioWord: batchStoryCandidates[0]?.word,
          storyData: storyResult,
          provider: storyResult.provider || configForServer?.provider,
          model: storyResult.model || configForServer?.model,
          responseTimeMs: storyResult.responseTimeMs,
          suggestedActions: [
            { label: "📖 Next Story Practice", action: "start_practice_story_immersion" },
            { label: "🏆 Quiz Practice", action: "start_practice_quiz_only" },
          ],
        };

        setChatMessages([storyMsg]);
      } catch (e: any) {
        console.error("Error generating immersion story:", e);
        triggerChatErrorWithCountdown(e, configToUse, (newConfig) => startPractice(newConfig, practiceMode), "practice-error");
      } finally {
        setIsTyping(false);
      }
      return;
    }

    // Step 3: If still none are available, show the message saying there are no words to practice today, and suggest coming back tomorrow or adding more words to learn
    const noCandidateMsg: ChatMessage = {
      id: `practice-no-candidates-${Date.now()}`,
      role: "assistant",
      content: t("chat_quiz_no_candidates_warning", currentAppLang),
      timestamp: new Date().toISOString(),
      suggestedActions: [
        { label: t("qa_add_word_label", currentAppLang), action: "add_word" },
        { label: t("qa_generate_words_label", currentAppLang), action: "generate_topic" },
      ],
    };
    setChatMessages([noCandidateMsg]);
  };

  // Handle conversational quiz answers
  const handleQuizAnswer = (userAnswer: string) => {
    if (!activeQuiz || !activeQuiz.questions || activeQuiz.questions.length === 0) return;

    const currentAppLang = appLanguage || localStorage.getItem("vocab_learner_app_lang") || nativeLanguage || "en";

    const currentQ = activeQuiz.questions[activeQuiz.currentIndex];
    const targetWordObj = words.find((w) => w.id === currentQ.wordId || w.word.toLowerCase() === currentQ.word.toLowerCase());

    const normalizedUser = userAnswer.toLowerCase().trim();
    const normalizedCorrect = currentQ.correctAnswer.toLowerCase().trim();

    let isCorrect = normalizedUser === normalizedCorrect || (targetWordObj && normalizedUser === targetWordObj.word.toLowerCase().trim());

    if (!isCorrect && currentQ.options && currentQ.options.length > 0) {
      const correctIdx = currentQ.options.findIndex((opt) => opt.toLowerCase().trim() === normalizedCorrect);
      if (correctIdx !== -1) {
        const letters = ["a", "b", "c", "d", "e"];
        const correctLetter = letters[correctIdx];

        const userMatchesLetter =
          normalizedUser === correctLetter ||
          normalizedUser === `${correctLetter})` ||
          normalizedUser === `${correctLetter}.` ||
          normalizedUser.startsWith(`${correctLetter})`) ||
          normalizedUser.startsWith(`${correctLetter}.`);

        if (userMatchesLetter) {
          isCorrect = true;
        }
      }
    }

    const wordId = targetWordObj ? targetWordObj.id : currentQ.wordId;
    const newScore = isCorrect ? activeQuiz.score + 1 : activeQuiz.score;
    const newCorrectIds = isCorrect ? [...activeQuiz.correctIds, wordId] : activeQuiz.correctIds;
    const newIncorrectIds = !isCorrect ? [...activeQuiz.incorrectIds, wordId] : activeQuiz.incorrectIds;

    // Immediately update target word practice data, lastReviewed timestamp and strength history upon answer
    setWords((prevWords) => {
      const updatedWords = prevWords.map((w) => {
        const originalId = w.id;
        const virtualId = `today-${w.id}`;
        const targetQWord = currentQ.word.toLowerCase().trim();
        const matchesWord =
          w.id === wordId ||
          originalId === wordId ||
          virtualId === wordId ||
          (targetWordObj && w.id === targetWordObj.id) ||
          w.word.toLowerCase().trim() === targetQWord;

        if (matchesWord) {
          const delta = isCorrect ? 20 : -20;
          const newStrength = isCorrect ? Math.min(100, w.strength + delta) : Math.max(0, w.strength + delta);
          const reason = isCorrect ? "quiz_correct" : "quiz_incorrect";
          const note = isCorrect ? "Practiced in Quiz (Correct)" : "Practiced in Quiz (Incorrect)";
          return recordStrengthHistory(w, newStrength, reason, note);
        }
        return w;
      });
      wordsRef.current = updatedWords;
      saveAllWordsToDB(updatedWords).catch((e) => console.error("IndexedDB quiz single word update error:", e));
      return updatedWords;
    });

    let feedback = "";
    if (isCorrect) {
      feedback = t("chat_quiz_feedback_correct_msg", currentAppLang, {
        questionTitle: currentQ.question.split("\n")[0],
        answer: currentQ.correctAnswer,
      });
      if (targetWordObj) {
        feedback += t("chat_quiz_word_details", currentAppLang, {
          word: targetWordObj.word,
          partOfSpeech: targetWordObj.partOfSpeech,
          pronunciation: targetWordObj.pronunciation || "",
          translation: targetWordObj.translation,
        });
      }
    } else {
      feedback = t("chat_quiz_feedback_incorrect_msg", currentAppLang, {
        answer: currentQ.correctAnswer,
        userAnswer: userAnswer,
      });
      if (targetWordObj) {
        feedback += t("chat_quiz_word_details", currentAppLang, {
          word: targetWordObj.word,
          partOfSpeech: targetWordObj.partOfSpeech,
          pronunciation: targetWordObj.pronunciation || "",
          translation: targetWordObj.translation,
        });
      }
    }

    // Determine complete sentence and its translation to display in feedback
    const blankPattern = /\[blank\]|\[BLANK\]|\(\s*_{2,}\s*\)|\(_+\)|_{2,}|\.{3,}/gi;

    let resolvedSentence = currentQ.sentence;
    let resolvedSentenceTranslation = "";
    if (!resolvedSentence) {
      const qText = currentQ.question || "";
      if (currentQ.type === "sentence" || blankPattern.test(qText)) {
        const cleanQ = qText
          .replace(/^Fill in the blank (?:for the sentence)?:\s*/i, "")
          .replace(/^Choose the (?:word|term)[^:\n]*:?\s*/i, "")
          .replace(/^["“]|["”]$/g, "")
          .trim();
        resolvedSentence = cleanQ;
      } else if (targetWordObj?.example) {
        resolvedSentence = targetWordObj.example;
      }
    }

    if (resolvedSentence) {
      if (blankPattern.test(resolvedSentence)) {
        resolvedSentence = resolvedSentence.replace(blankPattern, currentQ.correctAnswer);
      }
      // Highlight/bold the target word in the sentence if not already formatted with bold
      if (!resolvedSentence.includes("**")) {
        const escapedWord = currentQ.correctAnswer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const wordRegex = new RegExp(`\\b(${escapedWord})\\b`, "i");
        if (wordRegex.test(resolvedSentence)) {
          resolvedSentence = resolvedSentence.replace(wordRegex, "**$1**");
        }
      }
      resolvedSentence = resolvedSentence.replace(/^["“]|["”]$/g, "").trim();

      resolvedSentenceTranslation = (currentQ.sentenceTranslation || targetWordObj?.exampleTranslation || "").replace(/^["“]|["”]$/g, "").trim();

      if (resolvedSentenceTranslation) {
        if (blankPattern.test(resolvedSentenceTranslation)) {
          const primaryTrans = targetWordObj?.translation
            ? targetWordObj.translation.split(/[;,\/]/)[0].trim()
            : (currentQ.word || currentQ.correctAnswer);
          if (primaryTrans) {
            resolvedSentenceTranslation = resolvedSentenceTranslation.replace(blankPattern, primaryTrans);
          } else {
            resolvedSentenceTranslation = resolvedSentenceTranslation.replace(blankPattern, "").replace(/\s{2,}/g, " ").trim();
          }
        }
        resolvedSentenceTranslation = resolvedSentenceTranslation.replace(/^["“]|["”]$/g, "").trim();
      }

      if (resolvedSentenceTranslation) {
        feedback += t("chat_quiz_sentence_details", currentAppLang, {
          sentence: resolvedSentence,
          sentenceTranslation: resolvedSentenceTranslation,
        });
      } else {
        feedback += t("chat_quiz_sentence_only", currentAppLang, {
          sentence: resolvedSentence,
        });
      }
    }

    if (currentQ.type === "duel" && (currentQ.contrastRule || currentQ.confuserWord)) {
      feedback += `\n\n💡 **Contrast Match & Unlearning Rule:**\n${currentQ.contrastRule || `Watch out: '${currentQ.word}' is often confused with '${currentQ.confuserWord}'.`}`;
    }

    const nextIndex = activeQuiz.currentIndex + 1;
    const isLastQ = nextIndex >= activeQuiz.questions.length;

    setActiveQuiz({
      ...activeQuiz,
      currentIndex: nextIndex,
      score: newScore,
      correctIds: newCorrectIds,
      incorrectIds: newIncorrectIds,
    });

    const now = Date.now();
    const nextBtnText = isLastQ
      ? `🏆 ${t("chat_quiz_finish_summary_btn", currentAppLang)} ➔`
      : `➡️ ${t("chat_quiz_next_question_btn", currentAppLang)} (${nextIndex + 1}/${activeQuiz.questions.length}) ➔`;

    // Retrieve per-question suggested words specifically for this individual question
    let questionSuggestions: QuizSuggestedWord[] | undefined = undefined;
    const rawList = (Array.isArray(currentQ.suggestedWords) && currentQ.suggestedWords.length > 0)
      ? currentQ.suggestedWords
      : (targetWordObj && Array.isArray(targetWordObj.suggestedWords) && targetWordObj.suggestedWords.length > 0)
      ? targetWordObj.suggestedWords
      : undefined;

    if (rawList && rawList.length > 0) {
      questionSuggestions = rawList.slice(0, 3).map((item: any) => ({
        word: typeof item === "string" ? item : (item.word || ""),
        translation: typeof item === "object" ? (item.translation || "") : "",
        definition: typeof item === "object" ? (item.definition || "") : "",
        hint: typeof item === "object" ? (item.hint || `Based on "${currentQ.word}"`) : `Based on "${currentQ.word}"`,
        partOfSpeech: typeof item === "object" ? item.partOfSpeech : undefined,
        pairedWith: typeof item === "object" && item.pairedWith ? item.pairedWith : currentQ.word,
      }));
    }

    // Fallback: If suggestions have fewer than 3 items, derive high-value suggestions (rival duel word & context phrasal verbs/collocations)
    const sentenceToScan = resolvedSentence || currentQ.sentence || currentQ.question || "";
    if ((!questionSuggestions || questionSuggestions.length < 3) && sentenceToScan) {
      const derived: QuizSuggestedWord[] = questionSuggestions ? [...questionSuggestions] : [];
      const seenWords = new Set<string>(derived.map(d => d.word.toLowerCase()));
      if (currentQ.word) seenWords.add(currentQ.word.toLowerCase());

      // 1. For Confuser Duel, include the rival confuser word
      const rival = currentQ.confuserWord || (currentQ.type === "duel" && currentQ.options?.find(o => o.toLowerCase() !== currentQ.correctAnswer.toLowerCase()));
      if (rival && !seenWords.has(rival.toLowerCase())) {
        seenWords.add(rival.toLowerCase());
        let cleanRivalDef = "";
        if (currentQ.contrastRule) {
          const escapedRival = rival.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const m = currentQ.contrastRule.match(
            new RegExp(`(?:while|whereas)?\\s*(?:a|an)?\\s*['"]?${escapedRival}['"]?\\s*(?:refers to|means|is defined as|denotes|is)\\s*([^.;]+)`, "i")
          );
          if (m && m[1]) {
            cleanRivalDef = m[1].trim();
          } else {
            cleanRivalDef = currentQ.contrastRule;
          }
        }
        derived.unshift({
          word: rival,
          translation: "",
          definition: cleanRivalDef,
          partOfSpeech: targetWordObj?.partOfSpeech,
          pairedWith: currentQ.word,
        });
      }

      // 2. Extract phrasal verbs and collocations from sentenceToScan
      const extracted = extractPhrasalVerbsAndCollocationsFromSentence(
        sentenceToScan,
        currentQ.word,
        derived.map(d => d.word),
        nativeLanguage
      );
      for (const item of extracted) {
        if (derived.length >= 3) break;
        if (!seenWords.has(item.word.toLowerCase())) {
          seenWords.add(item.word.toLowerCase());
          derived.push({
            word: item.word,
            translation: item.translation || "",
            definition: item.definition || "",
            hint: item.hint || `Appears in context sentence`,
            partOfSpeech: item.partOfSpeech,
            pairedWith: currentQ.word,
          });
        }
      }

      if (derived.length > 0) {
        questionSuggestions = derived.slice(0, 3);
      }
    }

    const feedbackMsg: ChatMessage = {
      id: `quiz-feedback-${now}`,
      role: "assistant",
      content: feedback,
      timestamp: new Date(now).toISOString(),
      audioWord: targetWordObj ? targetWordObj.word : currentQ.word,
      quizSpeechText: isCorrect
        ? t("chat_quiz_speech_correct", targetLanguage, { answer: currentQ.correctAnswer })
        : t("chat_quiz_speech_incorrect", targetLanguage, { answer: currentQ.correctAnswer }),
      answeredQuizWordId: wordId,
      quizContext: {
        question: currentQ.question,
        userAnswer: userAnswer,
        correctAnswer: currentQ.correctAnswer,
        isCorrect: isCorrect,
        sentence: resolvedSentence,
        sentenceTranslation: resolvedSentenceTranslation,
        questionType: currentQ.type,
      },
      isConfuserDuel: currentQ.type === "duel" || Boolean(currentQ.confuserWord),
      confuserWord: currentQ.confuserWord,
      contrastRule: currentQ.contrastRule,
      suggestedWords: questionSuggestions,
      suggestedActions: [
        {
          label: nextBtnText,
          action: "next_quiz_question",
          payload: { nextIndex },
        },
      ],
    };

    setChatMessages((prev) => [...prev, feedbackMsg]);
  };

  const handleNextQuizQuestion = () => {
    if (!activeQuiz) return;
    const currentAppLang = appLanguage || localStorage.getItem("vocab_learner_app_lang") || nativeLanguage || "Vietnamese";

    const nextIndex = activeQuiz.currentIndex;

    if (nextIndex < activeQuiz.questions.length) {
      const nextQ = activeQuiz.questions[nextIndex];
      const isNextQWarmup = activeQuiz.isSandwichSession && activeQuiz.warmupWordIds?.includes(nextQ.wordId);
      const qTag = activeQuiz.isSandwichSession
        ? ` (${activeQuiz.sandwichStep === 1 ? t("chat_sandwich_q_duel_tag", currentAppLang) : isNextQWarmup ? t("chat_sandwich_q_warmup_tag", currentAppLang) : t("chat_sandwich_q_review_tag", currentAppLang)})`
        : "";

      const now = Date.now();
      const nextMsg: ChatMessage = {
        id: `quiz-next-${now}`,
        role: "assistant",
        content: `### ${t("chat_quiz_question_header", currentAppLang, { index: String(nextIndex + 1), total: String(activeQuiz.questions.length) })}${qTag}:\n**${nextQ.question}**`,
        timestamp: new Date(now).toISOString(),
        audioWord: nextQ.type === "listening" ? nextQ.word : undefined,
        quizSpeechText: (nextQ.type === "listening" || nextQ.type === "spelling") ? nextQ.word : nextQ.question,
        imageUrl: nextQ.imageUrl,
        imageKeyword: nextQ.imageKeyword,
        partOfSpeech: nextQ.partOfSpeech,
        isConfuserDuel: nextQ.type === "duel",
        confuserWord: nextQ.confuserWord,
        contrastRule: nextQ.contrastRule,
        suggestedActions: nextQ.options?.map((opt) => ({
          label: opt,
          action: "quiz_answer",
          payload: { answer: opt, wordId: nextQ.wordId },
        })) || [
          { label: nextQ.correctAnswer, action: "quiz_answer", payload: { answer: nextQ.correctAnswer, wordId: nextQ.wordId } },
        ],
      };

      setChatMessages((prev) => [...prev, nextMsg]);
    } else {
      const totalQs = activeQuiz.questions.length;
      const newScore = activeQuiz.score;
      const wasSandwichStep1 = Boolean(activeQuiz.isSandwichSession && activeQuiz.sandwichStep === 1);
      const wasSandwichStep2 = Boolean(activeQuiz.isSandwichSession && activeQuiz.sandwichStep === 2);
      const wasSandwich = Boolean(activeQuiz.isSandwichSession);
      const sandwichWarmupIds = activeQuiz.warmupWordIds || [];
      setActiveQuiz(null);

      handleFinishQuiz(newScore, totalQs);

      let finishedContent = wasSandwichStep1
        ? t("chat_sandwich_step1_finished_msg", currentAppLang, {
            feedback: "",
            score: String(newScore),
            total: String(totalQs),
            accuracy: String(Math.round((newScore / totalQs) * 100)),
          })
        : wasSandwichStep2 || wasSandwich
        ? t("chat_sandwich_finished_msg", currentAppLang, {
            feedback: "",
            score: String(newScore),
            total: String(totalQs),
            accuracy: String(Math.round((newScore / totalQs) * 100)),
          })
        : t("chat_quiz_finished_msg", currentAppLang, {
            feedback: "",
            score: String(newScore),
            total: String(totalQs),
            accuracy: String(Math.round((newScore / totalQs) * 100)),
          });

      finishedContent = finishedContent.replace(/^(\s*---\s*)+/, "").trim();

      const defaultActions = wasSandwichStep1
        ? [
            {
              label: t("chat_sandwich_start_quiz_action", currentAppLang),
              action: "start_sandwich_quiz",
              payload: { warmupWordIds: sandwichWarmupIds },
            },
            { label: t("action_next_balanced_session", currentAppLang), action: "start_practice_balanced" },
            { label: t("action_confuser_duel", currentAppLang), action: "start_practice_confuser_duel" },
          ]
        : wasSandwich
        ? [
            { label: t("action_next_balanced_session", currentAppLang), action: "start_practice_balanced" },
            { label: t("action_next_quiz", currentAppLang), action: "next_quiz" },
            { label: t("action_confuser_duel", currentAppLang), action: "start_practice_confuser_duel" },
          ]
        : [
            { label: t("action_next_quiz", currentAppLang), action: "next_quiz" },
            { label: t("action_confuser_duel", currentAppLang), action: "start_practice_confuser_duel" },
            { label: t("chat_quiz_common_phrases_action", currentAppLang), action: "common_phrases" },
          ];

      const now = Date.now();

      const finishedMsg: ChatMessage = {
        id: `quiz-end-${now}`,
        role: "assistant",
        content: finishedContent,
        timestamp: new Date(now).toISOString(),
        quizFinishedData: {
          score: newScore,
          total: totalQs,
          accuracy: Math.round((newScore / totalQs) * 100),
          testedWordIds: [...activeQuiz.correctIds, ...activeQuiz.incorrectIds],
        },
        suggestedActions: defaultActions,
      };

      setChatMessages((prev) => [...prev, finishedMsg]);
    }
  };

  // Add individual word directly from chat suggestions (or conversational input)
  const handleConversationalAddWord = async (wordText: string, hint?: string, overrideConfig?: LLMConfig) => {
    const configToUse = overrideConfig || llmConfig;
    const currentAppLang = appLanguage || localStorage.getItem("vocab_learner_app_lang") || nativeLanguage || "Vietnamese";

    const rawWordInput = wordText.trim();
    const existingMatch = findWordInCollection(words, rawWordInput);
    if (existingMatch) {
      const remainingActions = getRemainingWordActions(chatMessages, words, rawWordInput, currentAppLang);
      const existingDetails = formatExistingWordDetails(existingMatch, currentAppLang);
      const wordSpecificActions = [
        {
          label: `💡 ${t("action_add_related_words", currentAppLang, { word: existingMatch.word })}`,
          action: "send_message",
          payload: { message: `Suggest commonly paired words for "${existingMatch.word}"` },
        },
      ];
      const mergedActions = [...wordSpecificActions, ...remainingActions];
      setChatMessages((prev) => [
        ...prev,
        {
          id: `sys-exists-${Date.now()}`,
          role: "assistant",
          content: t("chat_word_already_in_collection", currentAppLang, {
            word: existingMatch.word,
            details: existingDetails,
          }),
          timestamp: new Date().toISOString(),
          suggestedActions: mergedActions,
          audioWord: existingMatch.word,
        },
      ]);
      setConversationalState("adding_word");
      return;
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;
    const configForServer = startTypingWithConfig(configToUse);
    const statusMsgId = `add-word-status-${Date.now()}`;
    const contextHintStr = hint ? t("chat_with_context_hint", currentAppLang, { hint }) : "";

    setChatMessages((prev) => [
      ...prev,
      {
        id: statusMsgId,
        role: "assistant",
        content: t("chat_lookup_status", currentAppLang, { word: rawWordInput, contextHintStr }),
        timestamp: new Date().toISOString(),
      },
    ]);

    try {
      const data = await checkWordDefinitionsService({
        word: rawWordInput,
        hint: hint,
        targetLanguage,
        nativeLanguage,
        cfg: configForServer,
        signal: controller.signal,
      });

      const validSenses = (data.senses || []).filter((s: any) => s && (s.definition || s.translation));

      if (data.notFound || validSenses.length === 0) {
        setChatMessages((prev) => {
          const filtered = prev.filter((m) => m.id !== statusMsgId);
          return [
            ...filtered,
            {
              id: `sys-not-found-${Date.now()}`,
              role: "assistant",
              content: t("chat_lookup_not_found", currentAppLang, { word: wordText, contextHintStr }),
              timestamp: new Date().toISOString(),
            },
          ];
        });
        setConversationalState("adding_word");
        return;
      }

      if (data.hasMultipleSenses && validSenses.length > 1) {
        setPendingWordSenses({
          word: wordText,
          senses: validSenses,
          suggestedWords: data.suggestedWords || undefined,
        });

        const actions = validSenses.map((sense: any, idx: number) => {
          const targetWord = sense.word || data.word || wordText;
          const translation = sense.translation && sense.translation !== "undefined" ? sense.translation : "";
          const definition = sense.definition || "";
          const example = sense.example || "";

          const partOfSpeech = sense.partOfSpeech || "word";
          let header = `[${partOfSpeech}]`;
          if (targetWord && targetWord.toLowerCase() !== wordText.toLowerCase()) {
            header += ` ${targetWord}${translation ? ` (${translation})` : ""}`;
          } else if (translation) {
            header += ` ${translation}`;
          }

          const fullLabel = `${header}: ${definition}${example ? ` — Ex: "${example}"` : ""}`;

          return {
            label: fullLabel,
            action: "select_definition",
            payload: {
              word: wordText,
              senseIndex: idx,
              translation: translation || data.translation || wordText,
              targetWord: targetWord,
              partOfSpeech: partOfSpeech,
              definition: definition,
              example: example,
            },
          };
        });

        setChatMessages((prev) => {
          const filtered = prev.filter((m) => m.id !== statusMsgId);
          return [
            ...filtered,
            {
              id: `sense-disambig-${Date.now()}`,
              role: "assistant",
              content: t("chat_disambiguation_prompt", currentAppLang, { word: wordText, targetLanguage }),
              timestamp: new Date().toISOString(),
              suggestedActions: actions,
              provider: data.provider,
              model: data.model,
              responseTimeMs: data.responseTimeMs,
            },
          ];
        });
        setConversationalState("adding_word");
      } else {
        const sense = validSenses[0];

        const partOfSpeechVal = sense?.partOfSpeech || data.partOfSpeech || "word";
        const pronunciationVal = sense?.pronunciation || data.pronunciation || "/.../";
        const definitionVal = sense?.definition || data.definition;
        const translationVal = sense?.translation || data.translation;
        const exampleVal = sense?.example || data.example || undefined;
        const exampleTranslationVal = sense?.exampleTranslation || data.exampleTranslation || undefined;

        if (!definitionVal || !translationVal) {
          setChatMessages((prev) => {
            const filtered = prev.filter((m) => m.id !== statusMsgId);
            return [
              ...filtered,
              {
                id: `sys-not-found-${Date.now()}`,
                role: "assistant",
                content: t("chat_lookup_not_found", currentAppLang, { word: wordText, contextHintStr }),
                timestamp: new Date().toISOString(),
                provider: data.provider,
                model: data.model,
                responseTimeMs: data.responseTimeMs,
              },
            ];
          });
          setConversationalState("adding_word");
          return;
        }

        const categoryVal = sense?.category || data.category || "General";
        const contextVal = sense?.context || data.context || hint || definitionVal;
        let targetWordStr = sense?.word || data.word || rawWordInput;

        // Safeguard against over-aggressive LLM headword isolation when the user intends to add a multi-word phrase
        const rawTrimmed = rawWordInput.trim();
        if (
          rawTrimmed.includes(" ") &&
          !rawTrimmed.startsWith("(") &&
          !/^(i want|how to|how do|what is|can we|can i|please add|add word|add |thêm từ|thêm )/i.test(rawTrimmed)
        ) {
          const shortenedMatch = findWordInCollection(words, targetWordStr);
          const fullMatch = findWordInCollection(words, rawTrimmed);
          if (shortenedMatch && !fullMatch && rawTrimmed.toLowerCase().startsWith(targetWordStr.toLowerCase())) {
            targetWordStr = rawTrimmed;
          }
        }

        const finalMatch = findWordInCollection(words, targetWordStr);
        if (finalMatch && isCompletedWord(finalMatch)) {
          const remainingActions = getRemainingWordActions(chatMessages, words, targetWordStr, currentAppLang);
          const existingDetails = formatExistingWordDetails(finalMatch, currentAppLang);
          setChatMessages((prev) => {
            const filtered = prev.filter((m) => m.id !== statusMsgId);
            return [
              ...filtered,
              {
                id: `sys-exists-${Date.now()}`,
                role: "assistant",
                content: t("chat_word_already_in_collection", currentAppLang, {
                  word: finalMatch.word,
                  details: existingDetails,
                }),
                timestamp: new Date().toISOString(),
                suggestedActions: remainingActions,
                audioWord: finalMatch.word,
                provider: data.provider,
                model: data.model,
                responseTimeMs: data.responseTimeMs,
              },
            ];
          });
          setConversationalState("adding_word");
          return;
        }

        const newWordObj: Word = {
          id: `conv-word-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
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
          createdAt: new Date().toISOString(),
          lastReviewed: null,
          strength: 0,
          imageKeyword: isNoun(partOfSpeechVal) ? (sense?.imageKeyword || data.imageKeyword || undefined) : undefined,
          imageUrls: isNoun(partOfSpeechVal) ? (sense?.imageUrls || data.imageUrls || undefined) : undefined,
          imageUrl: isNoun(partOfSpeechVal) ? (sense?.imageUrl || data.imageUrl || undefined) : undefined,
        };

        setPendingConfirmWord(newWordObj);
        setConversationalState("confirming_add_word");

        const remainingActions = getRemainingWordActions(chatMessages, words, targetWordStr, currentAppLang);
        const sessionActions = remainingActions.filter((a: any) => a?.action === "start_sandwich_quiz");

        const isUpgradingIncomplete = Boolean(finalMatch && isIncompleteWord(finalMatch));

        const confirmActions = [
          {
            label: isUpgradingIncomplete
              ? t("action_complete_adding_word", currentAppLang, { word: targetWordStr })
              : t("action_confirm_add_word", currentAppLang, { word: targetWordStr, details: translationVal }),
            action: "confirm_save_word",
            payload: newWordObj,
          },
          {
            label: t("action_cancel", currentAppLang),
            action: "send_message",
            payload: { message: "cancel" },
          },
          ...sessionActions,
        ];

        setChatMessages((prev) => {
          const filtered = prev.filter((m) => m.id !== statusMsgId);
          return [
            ...filtered,
            {
              id: `sys-confirm-word-${Date.now()}`,
              role: "assistant",
              content: t("chat_confirm_word_preview_prompt", currentAppLang, {
                word: targetWordStr,
                pronunciation: pronunciationVal,
                partOfSpeech: partOfSpeechVal,
                translation: translationVal,
                definition: definitionVal,
                exampleSection: (exampleVal ? `\n- **${t("label_example", currentAppLang)}**: "${exampleVal}"` : "") + (exampleTranslationVal ? `\n- **${t("label_example_translation", currentAppLang)}**: "${exampleTranslationVal}"` : "")
              }),
              timestamp: new Date().toISOString(),
              suggestedActions: confirmActions,
              provider: data.provider,
              model: data.model,
              responseTimeMs: data.responseTimeMs,
            },
          ];
        });
      }
    } catch (err: any) {
      setChatMessages((prev) => prev.filter((m) => m.id !== statusMsgId));
      if (controller.signal.aborted || err?.name === "AbortError" || String(err).includes("aborted")) {
        console.log("Conversational add word was aborted by user.");
        return;
      }
      console.error(err);
      triggerChatErrorWithCountdown(err, configToUse, (newConfig) => {
        handleConversationalAddWord(wordText, hint, newConfig);
      }, "add-word-error");
    } finally {
      setIsTyping(false);
      setConversationalState("adding_word");
    }
  };

  const getVisionModelConfig = (): LLMConfig | undefined => {
    const match = getRotatedVisionModel();
    if (match) {
      return {
        provider: match.provider,
        model: match.model,
        savedProviders: llmConfig.savedProviders || {},
        apiKey: "",
        isLoggedIn: false,
      };
    }
    return undefined;
  };

  const handleSendChatMessage = async (text: string, overrideConfig?: LLMConfig) => {
    if (!text.trim()) return;

    const configToUse = overrideConfig || llmConfig;

    let newUserMessage: ChatMessage | null = null;
    setChatMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.role === "user" && last.content === text.trim()) {
        newUserMessage = last;
        return prev;
      }
      newUserMessage = {
        id: `msg-${Date.now()}`,
        role: "user",
        content: text.trim(),
        timestamp: new Date().toISOString(),
      };
      return [...prev, newUserMessage];
    });

    if (activeQuiz) {
      if (text.trim() === "__next_quiz_question__") {
        setChatMessages((prev) => prev.filter((m) => m.content !== "__next_quiz_question__"));
        handleNextQuizQuestion();
        return;
      }
      handleQuizAnswer(text.trim());
      return;
    }

    if (conversationalState === "confirming_add_word") {
      const currentWord = pendingConfirmWord;
      const lower = text.trim().toLowerCase();

      const isPositive = [
        "yes", "y", "confirm", "add", "ok", "okay", "sure", "save", "accept",
        "đồng ý", "thêm", "chấp nhận", "có", "xác nhận", "cớ", "tiếp tục",
        "si", "sí", "oui", "ja", "はい", "是", "好的", "네", "확인"
      ].some((k) => lower === k || lower.startsWith(k + " ") || lower.endsWith(" " + k));

      const isNegative = [
        "no", "n", "cancel", "stop", "exit", "quit", "done", "skip",
        "hủy", "không", "khong", "dừng", "thoát", "non", "nein", "いいえ", "不", "取消", "아니오"
      ].some((k) => lower === k || lower.startsWith(k + " ") || lower.endsWith(" " + k));

      if (isPositive && currentWord) {
        setPendingConfirmWord(null);
        setConversationalState("adding_word");
        await handleAddMultipleWords([currentWord]);
        return;
      }

      if (isNegative) {
        setPendingConfirmWord(null);
        setConversationalState("adding_word");
        const currentAppLang = appLanguage || localStorage.getItem("vocab_learner_app_lang") || nativeLanguage || "Vietnamese";
        const wordName = currentWord?.word || text.trim();
        const remainingActions = getRemainingWordActions(chatMessages, words, undefined, currentAppLang);
        setChatMessages((prev) => [
          ...prev,
          {
            id: `sys-cancel-confirm-${Date.now()}`,
            role: "assistant",
            content: t("chat_cancelled_add_word", currentAppLang, { word: wordName }),
            timestamp: new Date().toISOString(),
            suggestedActions: remainingActions,
          },
        ]);
        return;
      }

      // If user typed a new word or natural phrase instead
      setPendingConfirmWord(null);
      setConversationalState("adding_word");
      await handleConversationalAddWord(text.trim(), undefined, configToUse);
      return;
    }

    if (conversationalState === "adding_word") {
      const lower = text.trim().toLowerCase();
      if (
        lower === "exit" ||
        lower === "cancel" ||
        lower === "stop" ||
        lower === "done" ||
        lower === "quit" ||
        lower === "no" ||
        lower === "stop adding" ||
        lower === "exit adding" ||
        lower === "done adding"
      ) {
        setConversationalState("none");
        const currentAppLang = appLanguage || localStorage.getItem("vocab_learner_app_lang") || nativeLanguage || "Vietnamese";
        const remainingActions = getRemainingWordActions(chatMessages, words, undefined, currentAppLang);
        setChatMessages((prev) => [
          ...prev,
          {
            id: `sys-exit-adding-${Date.now()}`,
            role: "assistant",
            content: t("chat_exited_word_adding", currentAppLang),
            timestamp: new Date().toISOString(),
            suggestedActions: remainingActions,
          },
        ]);
        return;
      }

      // Check if this input is a question, sentence, or conversational query
      const isQuestion = text.includes("?");
      const wordCount = text.trim().split(/\s+/).length;
      const startsWithQuestionWord = /^(what|how|why|who|where|can|could|is|are|do|does|tell|explain|give|show|please|translate|explain|suggest|ask|write|make|create|help)\b/i.test(text.trim());
      const hasConversationalTopic = /\b(sentence|example|meaning|definition|use|usage|pronounce|pronunciation|practice|paired|related|difference|compare|question|query|conversation)\b/i.test(text);

      if (isQuestion || wordCount >= 5 || startsWithQuestionWord || hasConversationalTopic) {
        setConversationalState("none");
        // Fall through to general chat
      } else {
        await handleConversationalAddWord(text.trim(), undefined, configToUse);
        return;
      }
    }

    if (conversationalState === "generating_topic_subject") {
      const topic = text.trim();
      setPendingTopicSubject(topic);
      setConversationalState("generating_topic_count");
      const currentAppLang = appLanguage || localStorage.getItem("vocab_learner_app_lang") || nativeLanguage || "Vietnamese";
      const countMsg: ChatMessage = {
        id: `gen-count-prompt-${Date.now()}`,
        role: "assistant",
        content: t("chat_generate_topic_count_prompt", currentAppLang, { topic }),
        timestamp: new Date().toISOString(),
        suggestedActions: [
          { label: t("chat_generate_count_option", currentAppLang, { count: "5" }), action: "send_message", payload: { message: "5" } },
          { label: t("chat_generate_count_option", currentAppLang, { count: "10" }), action: "send_message", payload: { message: "10" } },
          { label: t("chat_generate_count_option", currentAppLang, { count: "15" }), action: "send_message", payload: { message: "15" } },
          { label: t("chat_generate_count_option", currentAppLang, { count: "20" }), action: "send_message", payload: { message: "20" } },
        ],
      };
      setChatMessages((prev) => [...prev, countMsg]);
      return;
    }

    if (conversationalState === "generating_topic_count") {
      setConversationalState("none");
      const count = parseInt(text.trim(), 10) || 5;
      await handleConversationalGenerateWords(pendingTopicSubject, count, configToUse);
      return;
    }

    if (conversationalState === "fixing_grammar") {
      setConversationalState("none");
      await handleConversationalFixGrammar(text.trim());
      return;
    }

    if (conversationalState === "suggesting_reply") {
      setConversationalState("none");
      await handleSuggestCasualReply(null, text.trim());
      return;
    }

    // Check if user is explicitly asking to write or generate a story (e.g. historical story, real person story)
    const trimmedInput = text.trim();
    const isExplicitStoryRequest = 
      /^(?:write|tell|generate|create|kể|tạo|viết)?\s*(?:a\s+|an\s+|me\s+a\s+|bài\s+|một\s+)?(?:story|immersion\s+story|truyện|câu\s+chuyện)\b/i.test(trimmedInput) ||
      /\b(?:story|truyện|câu\s+chuyện)\s+(?:about|on|regarding|về)\b/i.test(trimmedInput) ||
      /\b(?:historical|real\s*(?:person|event|figure|history)|non-fiction|tiểu\s+sử|lịch\s+sử)\s+(?:story|truyện)\b/i.test(trimmedInput);

    if (isExplicitStoryRequest && !trimmedInput.toLowerCase().startsWith("why") && !trimmedInput.toLowerCase().startsWith("how")) {
      let extractedTopic: string | undefined = undefined;
      let genre = "Auto";

      if (/\b(?:historical|real\s*(?:person|event|figure|history)|non-fiction|tiểu\s+sử|lịch\s+sử)\b/i.test(trimmedInput)) {
        genre = "Historical Non-Fiction (Real Events & Figures)";
      } else if (/\b(?:mystery|trinh\s+thám|detective)\b/i.test(trimmedInput)) {
        genre = "Mystery & Intrigue";
      } else if (/\b(?:travel|adventure|du\s+lịch|phiêu\s+lưu)\b/i.test(trimmedInput)) {
        genre = "Travel & Cultural Discovery";
      } else if (/\b(?:funny|humor|comedy|hài|hài\s+hước)\b/i.test(trimmedInput)) {
        genre = "Humor & Lighthearted";
      } else if (/\b(?:daily|slice\s+of\s+life|đời\s+thường)\b/i.test(trimmedInput)) {
        genre = "Slice of Life & Everyday";
      } else if (/\b(?:fiction|fairy\s+tale|khoa\s+học\s+viễn\s+tưởng|sci-fi|fantasy)\b/i.test(trimmedInput)) {
        genre = "Creative Fiction & Adventure";
      }

      const topicMatch = trimmedInput.match(/(?:about|on|regarding|về)\s+([^.?!]+)/i);
      if (topicMatch && topicMatch[1]) {
        extractedTopic = topicMatch[1].trim();
      }

      await handleViewStoryImmersion(configToUse, { topic: extractedTopic, genre, keepHistory: true });
      return;
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;
    const configForServer = startTypingWithConfig(configToUse);

    try {
      const payloadMessages = chatMessages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const lastPayloadMsg = payloadMessages[payloadMessages.length - 1];
      if (!lastPayloadMsg || lastPayloadMsg.role !== "user" || lastPayloadMsg.content !== text.trim()) {
        payloadMessages.push({ role: "user", content: text.trim() });
      }

      recordUserInquiry(text.trim(), { source: "main_chat" });
      const recentInquiries = getRecentUserInquiries(8);
      const userProfile = await getUserPersonalityProfileFromDB().catch(() => null);

      const result = await sendChatMessageService({
        messages: payloadMessages,
        targetLanguage,
        nativeLanguage,
        llmConfig: configForServer,
        userInquiries: recentInquiries,
        userProfile,
        signal: controller.signal,
      });

      if (result && result.provider && result.model) {
        setActiveModelInfo({ provider: result.provider, model: result.model });
      }

      const currentAppLang = appLanguage || localStorage.getItem("vocab_learner_app_lang") || nativeLanguage || "Vietnamese";

      const resAny = result as any;
      const rawTextContent = result.text || resAny.content || resAny.message || resAny.response || resAny.reply || resAny.answer || "";
      const validActions = (result.suggestedActions || []).filter((act: any) => {
        if (!act || typeof act !== "object") return false;
        if (act.action === "select_definition") return Boolean(act.payload?.definition);
        const lbl = act.label ? String(act.label).trim() : "";
        const msgPayload = act.payload?.message ? String(act.payload.message).trim() : "";
        const wordPayload = act.payload?.word || act.word ? String(act.payload?.word || act.word).trim() : "";
        return lbl.length > 0 || msgPayload.length > 0 || wordPayload.length > 0;
      }).map((act: any) => {
        const cleaned = { ...act };
        if (!cleaned.label || !String(cleaned.label).trim()) {
          if (cleaned.payload?.message) cleaned.label = cleaned.payload.message;
          else if (cleaned.payload?.word) cleaned.label = t("action_add_to_col", currentAppLang, { word: cleaned.payload.word });
          else if (cleaned.word) cleaned.label = t("action_add_to_col", currentAppLang, { word: cleaned.word });
        }
        return cleaned;
      });

      const finalActions = extractOrGenerateTopicActions(
        rawTextContent,
        validActions,
        text,
        targetLanguage,
        nativeLanguage,
        currentAppLang
      );

      const fallbackContent = finalActions.length > 0
        ? t("chat_fallback_suggested_topics", currentAppLang, { targetLanguage })
        : t("chat_fallback_no_response", currentAppLang);

      const newAssistantMessage: ChatMessage = {
        id: `msg-${Date.now() + 1}`,
        role: "assistant",
        content: rawTextContent || fallbackContent,
        timestamp: new Date().toISOString(),
        suggestedActions: finalActions,
        provider: result.provider,
        model: result.model,
        responseTimeMs: result.responseTimeMs,
      };

      setChatMessages((prev) => [...prev, newAssistantMessage]);
    } catch (err: any) {
      if (controller.signal.aborted || err.name === "AbortError" || String(err).includes("aborted")) {
        console.log("Chat generation was aborted by the user.");
        return;
      }
      console.error("Chat error:", err);
      triggerChatErrorWithCountdown(err, configToUse, (newConfig) => {
        handleSendChatMessage(text, newConfig);
      }, "chat-error");
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      setIsTypingState(false);
    }
  };

  const handleAnalyzeImageVocab = async (imageDataUrl: string, customPrompt?: string) => {
    const overrideConfig = getVisionModelConfig();
    const configToUse = overrideConfig || llmConfig;
    const userMsgId = `user-img-${Date.now()}`;
    const statusMsgId = `status-img-${Date.now()}`;

    const currentAppLang = appLanguage || localStorage.getItem("vocab_learner_app_lang") || nativeLanguage || "Vietnamese";

    const userPromptText = customPrompt ? customPrompt : t("chat_photo_analyzed_for_vocab", currentAppLang);
    setChatMessages((prev) => [
      ...prev,
      {
        id: userMsgId,
        role: "user",
        content: `📷 **${t("chat_uploaded_photo_label", currentAppLang)}**: ${userPromptText}`,
        imageUrl: imageDataUrl,
        timestamp: new Date().toISOString(),
      },
      {
        id: statusMsgId,
        role: "assistant",
        content: t("chat_analyzing_photo_vocab", currentAppLang, { targetLanguage }),
        timestamp: new Date().toISOString(),
      },
    ]);

    const controller = new AbortController();
    abortControllerRef.current = controller;
    const configForServer = startTypingWithConfig(configToUse);

    try {
      const res = await analyzeImageVocabService({
        imageDataUrl,
        customPrompt,
        targetLanguage,
        nativeLanguage,
        llmConfig: configForServer,
        signal: controller.signal,
      });

      if (res && res.provider && res.model) {
        setActiveModelInfo({ provider: res.provider, model: res.model });
      }

      const items = res.vocabularyItems || [];
      const actions: any[] = [];
      const formattedItems: string[] = [];

      items.forEach((item: any, idx: number) => {
        const isAlreadySaved = isWordInCollection(words, item.word);
        const statusBadge = isAlreadySaved ? t("label_already_in_collection", currentAppLang) : "";

        formattedItems.push(
          `### ${idx + 1}. **${item.word}** \`${item.pronunciation || ""}\`${statusBadge}\n` +
            `- **${t("label_translation", currentAppLang)}**: ${item.translation} (${item.partOfSpeech || "item"})\n` +
            `- **${t("label_definition", currentAppLang)}**: *${item.definition}*\n` +
            (item.example ? `- **${t("label_example", currentAppLang)}**: "${item.example}"\n` : "") +
            (item.context ? `- **${t("label_in_photo", currentAppLang)}**: *${item.context}*\n` : "")
        );

        if (!isAlreadySaved) {
          actions.push({
            label: t("action_confirm_add", currentAppLang, { word: item.word, translation: item.translation }),
            action: "confirm_save_word",
            payload: {
              ...item,
              imageUrls: isNoun(item.partOfSpeech) ? (item.imageUrls || undefined) : undefined,
              imageUrl: isNoun(item.partOfSpeech) ? (item.imageUrl || undefined) : undefined,
              category: item.category || "Photo Vocabulary",
              context: item.context || item.definition || "",
            },
          });
        }
      });

      const unsavedItems = items.filter((item) => !isWordInCollection(words, item.word));

      if (unsavedItems.length > 1) {
        actions.unshift({
          label: t("action_add_all_photo_words", currentAppLang, { count: String(unsavedItems.length) }),
          action: "add_multiplewords",
          payload: { words: items },
        });
      }

      setChatMessages((prev) => {
        const filtered = prev.filter((m) => m.id !== statusMsgId);
        return [
          ...filtered,
          {
            id: `sys-img-res-${Date.now()}`,
            role: "assistant",
            content: t("chat_photo_analysis_result", currentAppLang, {
              description: res.imageDescription || t("chat_visual_scene", currentAppLang),
              count: String(items.length),
              items: formattedItems.join("\n")
            }),
            imageUrl: "",
            timestamp: new Date().toISOString(),
            suggestedActions: actions,
            provider: res.provider,
            model: res.model,
            responseTimeMs: res.responseTimeMs,
          },
        ];
      });
    } catch (err: any) {
      if (controller.signal.aborted || err?.name === "AbortError" || String(err).includes("aborted")) {
        console.log("Image analysis was aborted by the user.");
        setChatMessages((prev) => prev.filter((m) => m.id !== statusMsgId));
        return;
      }
      console.error("Image analysis error:", err);
      setChatMessages((prev) => prev.filter((m) => m.id !== statusMsgId));
      triggerChatErrorWithCountdown(err, configToUse, () => {
        handleAnalyzeImageVocab(imageDataUrl, customPrompt);
      }, "img-vocab-error");
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      setIsTypingState(false);
    }
  };

  const handleAddMultipleWords = async (candidateWords: any[]) => {
    if (!candidateWords || !Array.isArray(candidateWords) || candidateWords.length === 0) return;

    setPendingConfirmWord(null);
    const currentAppLang = appLanguage || localStorage.getItem("vocab_learner_app_lang") || nativeLanguage || "Vietnamese";

    const newWordsToAdd: Word[] = [];
    const skippedNames: string[] = [];

    candidateWords.forEach((c: any) => {
      const targetWord = (c.word || "").trim();
      if (!targetWord) return;

      const exists = isWordInCollection(words, targetWord) || newWordsToAdd.some((nw) => areWordsEquivalent(nw.word, targetWord));
      if (exists) {
        skippedNames.push(targetWord);
        return;
      }

      const defaultImageUrls = Array.isArray(c.imageUrls)
        ? c.imageUrls
        : (c.imageUrl ? [c.imageUrl] : undefined);

      const wordObj: Word = {
        id: `ai-word-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        word: targetWord,
        pronunciation: c.pronunciation || "/.../",
        partOfSpeech: c.partOfSpeech || "word",
        definition: c.definition || "Extracted vocabulary item",
        translation: c.translation || targetWord,
        example: c.example || undefined,
        exampleTranslation: c.exampleTranslation || undefined,
        category: c.category || "General",
        context: c.context || c.reason || c.definition,
        suggestedWords: c.suggestedWords || undefined,
        learned: false,
        starred: false,
        createdAt: new Date().toISOString(),
        lastReviewed: null,
        strength: 0,
        imageUrls: defaultImageUrls,
        imageUrl: c.imageUrl || defaultImageUrls?.[0] || undefined,
      };

      newWordsToAdd.push(wordObj);
    });

    if (newWordsToAdd.length === 0) {
      const skippedMatches = skippedNames
        .map((name) => findWordInCollection(words, name))
        .filter((w): w is Word => Boolean(w));

      const skippedDetails = skippedMatches
        .map((w) => formatExistingWordDetails(w, currentAppLang))
        .join("\n\n");

      setChatMessages((prev) => [
        ...prev,
        {
          id: `sys-batch-skipped-${Date.now()}`,
          role: "assistant",
          content: `${t("chat_batch_all_skipped", currentAppLang, { words: skippedNames.join(", ") })}${skippedDetails ? `\n\n${skippedDetails}` : ""}`,
          timestamp: new Date().toISOString(),
          audioWord: skippedMatches.length === 1 ? skippedMatches[0].word : undefined,
        },
      ]);
      return;
    }

    const updatedWords = [...newWordsToAdd, ...words];

    setWords((prev) => {
      const updated = [...newWordsToAdd, ...prev];
      saveAllWordsToDB(updated).catch((e) => console.error(e));
      return updated;
    });

    if (newWordsToAdd.length === 1) {
      const addedWord = newWordsToAdd[0];
      onShowToast?.(t("toast_added_word", currentAppLang, { word: addedWord.word }));

      // Auto-play audio if autoPlayAudioInChat setting is enabled
      const isAutoPlayEnabled = ttsConfig?.autoPlayAudioInChat ?? ttsConfig?.autoPlayAudioOnWordAdded ?? true;
      if (ttsConfig && isAutoPlayEnabled && addedWord.word) {
        const timerId = window.setTimeout(() => {
          const textToSpeak = addedWord.definition && addedWord.definition.trim()
            ? `${addedWord.word}. ${addedWord.definition}`
            : (addedWord.translation && addedWord.translation.trim() ? `${addedWord.word}. ${addedWord.translation}` : addedWord.word);
          speakTextService(textToSpeak, ttsConfig, llmConfig, targetLanguage || "English");
        }, 150);
        registerSpeechTimer(timerId);
      }

      const rawSuggested = Array.isArray(addedWord.suggestedWords) ? addedWord.suggestedWords : [];
      const collocatedSuggestions: QuizSuggestedWord[] = [];

      rawSuggested.forEach((sw) => {
        const swWord = typeof sw === "string" ? sw.trim() : sw?.word?.trim();
        if (!swWord) return;
        const existsAlready = isWordInCollection(updatedWords, swWord);
        if (!existsAlready) {
          const swObj = typeof sw === "object" && sw !== null ? sw : null;
          const hintVal = swObj?.definition || swObj?.translation || (swObj?.hint && !swObj.hint.startsWith("Paired with") ? swObj.hint : undefined);
          collocatedSuggestions.push({
            word: swWord,
            definition: swObj?.definition,
            translation: swObj?.translation || "",
            hint: hintVal || `Commonly paired with ${addedWord.word}`,
            partOfSpeech: swObj?.partOfSpeech,
            pairedWith: addedWord.word,
          });
        }
      });

      const remainingActions = getRemainingWordActions(chatMessages, updatedWords, addedWord.word, currentAppLang);

      setChatMessages((prev) => [
        ...prev,
        {
          id: `sys-single-success-${Date.now()}`,
          role: "assistant",
          content: t("chat_single_word_added_success", currentAppLang, {
            word: addedWord.word,
            translation: addedWord.translation || "",
            definition: addedWord.definition || "",
            collocatedSection: "",
          }),
          timestamp: new Date().toISOString(),
          suggestedWords: collocatedSuggestions.length > 0 ? collocatedSuggestions : undefined,
          suggestedActions: remainingActions,
        },
      ]);
    } else {
      onShowToast?.(t("toast_added_multiple_words", currentAppLang, { count: String(newWordsToAdd.length) }));
      const remainingActions = getRemainingWordActions(chatMessages, updatedWords, undefined, currentAppLang);
      setChatMessages((prev) => [
        ...prev,
        {
          id: `sys-batch-success-${Date.now()}`,
          role: "assistant",
          content: t("chat_batch_added_success", currentAppLang, {
            count: String(newWordsToAdd.length),
            addedList: newWordsToAdd.map((w) => `**${w.word}** (${w.translation})`).join(", "),
            skippedSection: skippedNames.length > 0 ? t("chat_batch_added_skipped_section", currentAppLang, { words: skippedNames.join(", ") }) : ""
          }),
          timestamp: new Date().toISOString(),
          suggestedActions: remainingActions,
        },
      ]);
    }
    setConversationalState("adding_word");
  };

  const handleSelectDefinition = async (word: string, senseIndex: number, translation: string) => {
    if (!pendingWordSenses || pendingWordSenses.word !== word) return;

    const currentAppLang = appLanguage || localStorage.getItem("vocab_learner_app_lang") || nativeLanguage || "Vietnamese";

    const sense = pendingWordSenses.senses[senseIndex];
    if (!sense) return;

    const targetWord = (sense.word || word).trim();
    const existingMatch = findWordInCollection(words, targetWord);
    if (existingMatch) {
      const remainingActions = getRemainingWordActions(chatMessages, words, targetWord, currentAppLang);
      const existingDetails = formatExistingWordDetails(existingMatch, currentAppLang);
      setChatMessages((prev) => [
        ...prev,
        {
          id: `sys-exists-${Date.now()}`,
          role: "assistant",
          content: t("chat_word_already_in_collection", currentAppLang, {
            word: existingMatch.word,
            details: existingDetails,
          }),
          timestamp: new Date().toISOString(),
          suggestedActions: remainingActions,
          audioWord: existingMatch.word,
        },
      ]);
      setPendingWordSenses(null);
      setConversationalState("adding_word");
      return;
    }

    const finalTranslation =
      translation && translation !== "undefined" ? translation : sense.translation && sense.translation !== "undefined" ? sense.translation : targetWord;

    const newWord: Word = {
      id: `ai-word-${Date.now()}`,
      word: targetWord,
      pronunciation: sense.pronunciation || "/.../",
      partOfSpeech: sense.partOfSpeech || "noun",
      definition: sense.definition,
      translation: sense.translation && sense.translation !== "undefined" ? sense.translation : finalTranslation,
      example: sense.example || undefined,
      exampleTranslation: sense.exampleTranslation || undefined,
      category: sense.category || "General",
      context: sense.context || sense.definition,
      suggestedWords: sense.suggestedWords || pendingWordSenses.suggestedWords || undefined,
      learned: false,
      starred: false,
      createdAt: new Date().toISOString(),
      lastReviewed: null,
      strength: 0,
      imageKeyword: isNoun(sense.partOfSpeech) ? sense.imageKeyword : undefined,
      imageUrls: isNoun(sense.partOfSpeech) ? sense.imageUrls || undefined : undefined,
      imageUrl: isNoun(sense.partOfSpeech) ? sense.imageUrl || undefined : undefined,
    };

    setPendingConfirmWord(newWord);
    setPendingWordSenses(null);
    setConversationalState("confirming_add_word");

    const remainingActions = getRemainingWordActions(chatMessages, words, targetWord, currentAppLang);
    const sessionActions = remainingActions.filter((a: any) => a?.action === "start_sandwich_quiz");

    const confirmActions = [
      {
        label: t("action_confirm_add_word", currentAppLang, { word: targetWord, details: newWord.translation }),
        action: "confirm_save_word",
        payload: newWord,
      },
      {
        label: t("action_cancel", currentAppLang),
        action: "send_message",
        payload: { message: "cancel" },
      },
      ...sessionActions,
    ];

    setChatMessages((prev) => [
      ...prev,
      {
        id: `sys-confirm-word-${Date.now()}`,
        role: "assistant",
        content: t("chat_confirm_word_preview_prompt", currentAppLang, {
          word: newWord.word,
          pronunciation: newWord.pronunciation || "",
          partOfSpeech: newWord.partOfSpeech,
          translation: newWord.translation,
          definition: newWord.definition,
          exampleSection: (newWord.example ? `\n- **${t("label_example", currentAppLang)}**: "${newWord.example}"` : "") + (newWord.exampleTranslation ? `\n- **${t("label_example_translation", currentAppLang)}**: "${newWord.exampleTranslation}"` : "")
        }),
        timestamp: new Date().toISOString(),
        suggestedActions: confirmActions,
      },
    ]);
  };

  const handleConversationalAddWordOrPrompt = (wordText?: string, hint?: string) => {
    setActiveQuiz(null);
    setPendingWordSenses(null);
    setPendingTopicSubject("");

    if (wordText && wordText.trim()) {
      handleConversationalAddWord(wordText.trim(), hint?.trim());
    } else {
      setConversationalState("adding_word");
      const currentAppLang = appLanguage || localStorage.getItem("vocab_learner_app_lang") || nativeLanguage || "Vietnamese";
      const addWordMsg: ChatMessage = {
        id: `add-word-prompt-${Date.now()}`,
        role: "assistant",
        content: t("chat_add_word_prompt", currentAppLang, { targetLanguage, nativeLanguage }),
        timestamp: new Date().toISOString(),
      };
      setChatMessages([addWordMsg]);
    }
  };

  const handleConversationalGenerateWordsPrompt = () => {
    setActiveQuiz(null);
    setPendingWordSenses(null);
    setConversationalState("generating_topic_subject");

    const currentAppLang = appLanguage || localStorage.getItem("vocab_learner_app_lang") || nativeLanguage || "Vietnamese";

    const certTopics = getCertificateTopics(targetLanguage, currentAppLang);
    const genTopics = getGeneralTopics(currentAppLang);

    const certList = certTopics.map((t) => `- **${t.name}** (${t.badge}): ${t.description}`).join("\n");
    const genList = genTopics.map((t) => `- **${t.name}**: ${t.description}`).join("\n");

    const promptMsg: ChatMessage = {
      id: `gen-topic-prompt-${Date.now()}`,
      role: "assistant",
      content: t("chat_generate_topic_prompt", currentAppLang, { certList, genList, targetLanguage }),
      timestamp: new Date().toISOString(),
      suggestedActions: [
        ...certTopics.map((t) => ({
          label: `🏆 ${t.name}`,
          action: "send_message",
          payload: { message: t.name },
        })),
        ...genTopics.map((t) => ({
          label: `🎨 ${t.name}`,
          action: "send_message",
          payload: { message: t.name },
        })),
      ],
    };
    setChatMessages([promptMsg]);
  };

  const handleConversationalGenerateWords = async (topic: string, count: number, overrideConfig?: LLMConfig) => {
    const configToUse = overrideConfig || llmConfig;
    const configForServer = startTypingWithConfig(configToUse);
    const statusMsgId = `gen-words-status-${Date.now()}`;
    const currentAppLang = appLanguage || localStorage.getItem("vocab_learner_app_lang") || nativeLanguage || "Vietnamese";

    setChatMessages((prev) => [
      ...prev,
      {
        id: statusMsgId,
        role: "assistant",
        content: t("chat_generating_topic_words_status", currentAppLang, { count: String(count), targetLanguage, topic }),
        timestamp: new Date().toISOString(),
      },
    ]);

    try {
      const targetTopicClean = topic.toLowerCase().trim();
      const existingCategoryWords = Array.from(
        new Set(
          words
            .filter((w) => {
              if (!w.category) return false;
              const catClean = w.category.toLowerCase().trim();
              return (
                catClean === targetTopicClean ||
                catClean.includes(targetTopicClean) ||
                targetTopicClean.includes(catClean)
              );
            })
            .map((w) => w.word.trim())
            .filter((w) => w.length > 0)
        )
      );

      const res = await generateRandomWordsService({
        topic: topic,
        targetLanguage,
        nativeLanguage,
        count,
        existingWords: existingCategoryWords,
        cfg: configForServer,
      });

      const rawList = extractWordsFromPayload(res);
      const generatedList = rawList
        .map((item: any) => {
          if (typeof item === "string") {
            return { word: item };
          }
          if (!item || typeof item !== "object") return null;
          return {
            ...item,
            word: item.word || item.term || item.vocab || item.headword || "",
            pronunciation: item.pronunciation || item.ipa || item.phonetic || "/.../",
            partOfSpeech: item.partOfSpeech || item.pos || item.type || "noun",
            definition: item.definition || item.meaning || item.desc || item.explanation || "",
            translation: item.translation || item.nativeTranslation || item.meaningNative || "",
            example: item.example || item.sentence || "",
            exampleTranslation: item.exampleTranslation || item.sentenceTranslation || "",
            category: item.category || topic || "General",
            context: item.context || item.usage || item.definition || "",
          };
        })
        .filter((item: any) => item && item.word && typeof item.word === "string" && item.word.trim().length > 0);

      const newUniqueWords = generatedList.filter((item: any) => item?.word && !isWordInCollection(words, item.word));

      if (newUniqueWords.length === 0) {
        setChatMessages((prev) => {
          const filtered = prev.filter((m) => m.id !== statusMsgId);
          return [
            ...filtered,
            {
              id: `gen-words-empty-${Date.now()}`,
              role: "assistant",
              content: t("chat_generate_topic_words_empty", currentAppLang, { topic }),
              timestamp: new Date().toISOString(),
            },
          ];
        });
        return;
      }

      const generatedWords: Word[] = [];
      newUniqueWords.forEach((item: any, idx: number) => {
        const newWord: Word = {
          id: `ai-word-${Date.now()}-${idx}-${Math.random().toString(36).substr(2, 4)}`,
          word: item.word,
          pronunciation: item.pronunciation || "/.../",
          partOfSpeech: item.partOfSpeech || "noun",
          definition: item.definition || `Vocabulary word "${item.word}"`,
          translation: item.translation || "Translation",
          example: item.example,
          exampleTranslation: item.exampleTranslation,
          category: item.category || topic || "General",
          context: item.context || item.definition,
          learned: false,
          starred: false,
          createdAt: new Date().toISOString(),
          lastReviewed: null,
          strength: 0,
          imageUrls: item.imageUrls || undefined,
          imageUrl: item.imageUrl || undefined,
        };
        generatedWords.push(newWord);
      });

      // Update words in both state and local database immediately without confirmation step
      setWords((prev) => {
        const updated = [...generatedWords, ...prev];
        saveAllWordsToDB(updated).catch((e) => console.error("Error auto-saving words to DB:", e));
        return updated;
      });

      const wordsListMarkdown = generatedWords
        .map(
          (w, idx) =>
            `${idx + 1}. **${w.word}** \`${w.pronunciation}\` (${w.partOfSpeech}) - **${w.translation}**\n   *Def:* ${w.definition}${
              w.example ? `\n   *Ex:* "${w.example}" (${w.exampleTranslation || ""})` : ""
            }`
        )
        .join("\n\n");

      let rawSuccessMsg = t("chat_generate_topic_words_success", currentAppLang, { topic, count: String(generatedWords.length), wordsListMarkdown });
      
      // Clean up localized trailing confirm-related prompts
      rawSuccessMsg = rawSuccessMsg
        .replace(/👇\s*\*Click[\s\S]*collection:\*/i, "")
        .replace(/👇\s*\*Nhấp[\s\S]*tập:\*/i, "")
        .replace(/👇\s*\*Haga[\s\S]*colección:\*/i, "")
        .replace(/👇\s*\*Cliquez[\s\S]*collection\s*\*:/i, "")
        .replace(/👇\s*\*Klicken[\s\S]*hinzuzufügen\s*\*:/i, "")
        .replace(/👇\s*\*コレクションに追加[\s\S]*ボタンをクリック[\s\S]*：\*/i, "")
        .replace(/👇\s*\*컬렉션에 추가[\s\S]*버튼을 클릭[\s\S]*:\*/i, "")
        .replace(/👇\s*\*点击下方[\s\S]*添加：\*/i, "");

      let autoAddedNotice = "";
      const code = currentAppLang.toLowerCase().trim();
      if (code.startsWith("vi")) {
        autoAddedNotice = "\n\n⚡ *Các từ này đã được tự động thêm vào bộ sưu tập của bạn để đơn giản hóa quá trình học!*";
      } else if (code.startsWith("es")) {
        autoAddedNotice = "\n\n⚡ *¡Estas palabras se han añadido automáticamente a tus colecciones para simplificar el proceso!*";
      } else if (code.startsWith("fr")) {
        autoAddedNotice = "\n\n⚡ *Ces mots ont été automatiquement ajoutés à vos collections pour simplifier le processus !*";
      } else if (code.startsWith("de")) {
        autoAddedNotice = "\n\n⚡ *Diese Wörter wurden automatisch zu Ihren Sammlungen hinzugefügt, um den Prozess zu vereinfachen!*";
      } else if (code.startsWith("ja")) {
        autoAddedNotice = "\n\n⚡ *プロセスの簡略化のため、これらの単語は自動的にコレクションに追加されました！*";
      } else if (code.startsWith("ko")) {
        autoAddedNotice = "\n\n⚡ *학습 과정을 단순화하기 위해 이 단어들이 컬렉션에 자동으로 추가되었습니다!*";
      } else if (code.startsWith("zh")) {
        autoAddedNotice = "\n\n⚡ *这些单词已自动添加到您的收藏中，以简化学习流程！*";
      } else {
        autoAddedNotice = "\n\n⚡ *These words have been automatically added to your collections to simplify the process!*";
      }

      const successContent = rawSuccessMsg.trim() + autoAddedNotice;

      const suggestedActions: any[] = [
        {
          label: t("action_generate_more_topic_words", currentAppLang, { topic }),
          action: "send_message",
          payload: { message: topic },
        },
        {
          label: t("chat_practice_start_today_action", currentAppLang),
          action: "start_practice",
        }
      ];

      setChatMessages((prev) => {
        const filtered = prev.filter((m) => m.id !== statusMsgId);
        return [
          ...filtered,
          {
            id: `gen-words-success-${Date.now()}`,
            role: "assistant",
            content: successContent,
            timestamp: new Date().toISOString(),
            suggestedActions: suggestedActions,
            provider: res.provider,
            model: res.model,
            responseTimeMs: res.responseTimeMs,
          },
        ];
      });
    } catch (err: any) {
      console.error("Failed to generate words from topic:", err);
      setChatMessages((prev) => prev.filter((m) => m.id !== statusMsgId));
      triggerChatErrorWithCountdown(err, configToUse, (newConfig) => {
        handleConversationalGenerateWords(topic, count, newConfig);
      }, "gen-words-error");
    } finally {
      setIsTyping(false);
    }
  };

  const handlePromptSuggestCasualReply = () => {
    setActiveQuiz(null);
    setPendingWordSenses(null);
    setConversationalState("suggesting_reply");
    const currentAppLang = appLanguage || localStorage.getItem("vocab_learner_app_lang") || nativeLanguage || "Vietnamese";
    const promptMsg: ChatMessage = {
      id: `suggest-reply-prompt-${Date.now()}`,
      role: "assistant",
      content: t("chat_suggest_reply_prompt_msg", currentAppLang),
      timestamp: new Date().toISOString(),
    };
    setChatMessages([promptMsg]);
  };

  const handleSuggestCasualReply = async (imageDataUrl: string | null, customPrompt: string) => {
    setConversationalState("none");
    const overrideConfig = imageDataUrl ? getVisionModelConfig() : undefined;
    const configToUse = overrideConfig || llmConfig;
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const configForServer = startTypingWithConfig(configToUse);
    const statusMsgId = `suggest-reply-status-${Date.now()}`;
    const currentAppLang = appLanguage || localStorage.getItem("vocab_learner_app_lang") || nativeLanguage || "Vietnamese";

    let userMsgContent = "";
    if (customPrompt) {
      userMsgContent += t("chat_suggest_reply_guiding_prefix", currentAppLang, { prompt: customPrompt });
    }

    setChatMessages((prev) => [
      ...prev,
      {
        id: `user-reply-req-${Date.now()}`,
        role: "user",
        content: userMsgContent || t("chat_suggest_reply_user_req_fallback", currentAppLang),
        timestamp: new Date().toISOString(),
        imageUrl: imageDataUrl || undefined,
      },
      {
        id: statusMsgId,
        role: "assistant",
        content: t("chat_suggest_reply_analyzing_status", currentAppLang),
        timestamp: new Date().toISOString(),
      },
    ]);

    try {
      const res = await suggestCasualReplyService({
        imageDataUrl,
        customPrompt,
        targetLanguage,
        nativeLanguage,
        llmConfig: configForServer,
        signal: controller.signal,
      });

      if (res && res.provider && res.model) {
        setActiveModelInfo({ provider: res.provider, model: res.model });
      }

      const replies = res.suggestedReplies || [];
      const rawCandidates = res.suggestedWords || res.vocabularyCandidates || [];

      const normalizedSuggestedWords: QuizSuggestedWord[] = rawCandidates
        .filter((c: any) => c && c.word)
        .map((c: any) => ({
          word: String(c.word).trim(),
          definition: c.definition || c.reason || "",
          translation: c.translation || "",
          partOfSpeech: c.partOfSpeech || "vocabulary",
          hint: c.reason || c.hint || c.definition || "",
        }));

      const actions: any[] = [];

      if (normalizedSuggestedWords && normalizedSuggestedWords.length > 0) {
        normalizedSuggestedWords.forEach((sw) => {
          actions.push({
            label: t("chat_suggest_reply_label", currentAppLang, { word: sw.word, reason: sw.hint || sw.translation }),
            action: "add_word",
            payload: { word: sw.word, definition: sw.definition, translation: sw.translation, partOfSpeech: sw.partOfSpeech, hint: sw.hint },
          });
        });
      }

      actions.push({
        label: t("action_suggest_another", currentAppLang),
        action: "suggest_another",
      });

      let contentMarkdown = t("chat_suggest_replies_header", currentAppLang);
      if (replies.length === 0) {
        contentMarkdown += t("chat_suggest_replies_empty", currentAppLang);
      }

      setChatMessages((prev) => {
        const filtered = prev.filter((m) => m.id !== statusMsgId);
        return [
          ...filtered,
          {
            id: `sys-reply-res-${Date.now()}`,
            role: "assistant",
            content: contentMarkdown.trim(),
            timestamp: new Date().toISOString(),
            suggestedActions: actions,
            suggestedReplies: replies,
            suggestedWords: normalizedSuggestedWords,
            provider: res.provider,
            model: res.model,
            responseTimeMs: res.responseTimeMs,
          },
        ];
      });
    } catch (err: any) {
      if (controller.signal.aborted || err?.name === "AbortError" || String(err).includes("aborted")) {
        console.log("Casual reply suggestion was aborted by the user.");
        setChatMessages((prev) => prev.filter((m) => m.id !== statusMsgId));
        return;
      }
      console.error("Suggest Casual Reply Error:", err);
      setChatMessages((prev) => prev.filter((m) => m.id !== statusMsgId));
      triggerChatErrorWithCountdown(err, configToUse, () => {
        handleSuggestCasualReply(imageDataUrl, customPrompt);
      }, "suggest-reply-error");
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      setIsTypingState(false);
    }
  };

  const handlePromptFixGrammar = () => {
    setActiveQuiz(null);
    setPendingWordSenses(null);
    setConversationalState("fixing_grammar");
    const currentAppLang = appLanguage || localStorage.getItem("vocab_learner_app_lang") || nativeLanguage || "Vietnamese";
    const promptMsg: ChatMessage = {
      id: `fix-grammar-prompt-${Date.now()}`,
      role: "assistant",
      content: t("chat_fix_grammar_prompt_msg", currentAppLang, { targetLanguage, nativeLanguage }),
      timestamp: new Date().toISOString(),
    };
    setChatMessages([promptMsg]);
  };

  const handleConversationalFixGrammar = async (userText: string, overrideConfig?: LLMConfig) => {
    const configToUse = overrideConfig || llmConfig;
    const configForServer = startTypingWithConfig(configToUse);
    const statusMsgId = `fix-grammar-status-${Date.now()}`;
    const currentAppLang = appLanguage || localStorage.getItem("vocab_learner_app_lang") || nativeLanguage || "Vietnamese";

    setChatMessages((prev) => [
      ...prev,
      {
        id: statusMsgId,
        role: "assistant",
        content: t("chat_fixing_grammar_analyzing_status", currentAppLang),
        timestamp: new Date().toISOString(),
      },
    ]);

    try {
      const res = await fixGrammarService({
        userText,
        targetLanguage,
        nativeLanguage,
        llmConfig: configForServer,
      });

      if (res && res.provider && res.model) {
        setActiveModelInfo({ provider: res.provider, model: res.model });
      }

      const fixedSentence = res.fixedSentence || userText;
      const explanation = res.explanation || "";
      const rawCandidates = res.suggestedWords || res.vocabularyCandidates || [];

      const normalizedSuggestedWords: QuizSuggestedWord[] = rawCandidates
        .filter((c: any) => c && c.word)
        .map((c: any) => ({
          word: String(c.word).trim(),
          definition: c.definition || c.reason || "",
          translation: c.translation || "",
          partOfSpeech: c.partOfSpeech || "vocabulary",
          hint: c.reason || c.hint || c.definition || "",
        }));

      const actions: any[] = [];

      actions.push({
        label: t("action_copy_fixed_sentence", currentAppLang),
        action: "copy_text",
        payload: { text: fixedSentence },
      });

      if (normalizedSuggestedWords && normalizedSuggestedWords.length > 0) {
        normalizedSuggestedWords.forEach((sw) => {
          actions.push({
            label: t("chat_suggest_reply_label", currentAppLang, { word: sw.word, reason: sw.hint || sw.translation }),
            action: "add_word",
            payload: {
              word: sw.word,
              definition: sw.definition,
              translation: sw.translation,
              partOfSpeech: sw.partOfSpeech,
              hint: sw.hint,
            },
          });
        });
      }

      actions.push({
        label: t("action_fix_another_sentence", currentAppLang),
        action: "fix_another",
      });

      let contentMarkdown = "";
      if (explanation) {
        contentMarkdown += `${explanation}\n\n`;
      }

      setChatMessages((prev) => {
        const filtered = prev.filter((m) => m.id !== statusMsgId);
        return [
          ...filtered,
          {
            id: `sys-grammar-res-${Date.now()}`,
            role: "assistant",
            content: contentMarkdown.trim(),
            timestamp: new Date().toISOString(),
            fixedSentence: fixedSentence,
            suggestedActions: actions,
            suggestedWords: normalizedSuggestedWords,
            provider: res.provider,
            model: res.model,
            responseTimeMs: res.responseTimeMs,
          },
        ];
      });
    } catch (err: any) {
      console.error("Fix Grammar Error:", err);
      setChatMessages((prev) => prev.filter((m) => m.id !== statusMsgId));
      triggerChatErrorWithCountdown(err, configToUse, () => {
        handleConversationalFixGrammar(userText);
      }, "fix-grammar-error");
    } finally {
      setIsTyping(false);
    }
  };

  const handleViewStoryImmersion = async (
    overrideConfig?: LLMConfig,
    options?: { topic?: string; genre?: string; difficulty?: "beginner" | "intermediate" | "advanced"; keepHistory?: boolean }
  ) => {
    const configToUse = overrideConfig || llmConfig;
    setActiveQuiz(null);
    setConversationalState("none");
    if (!options?.keepHistory) {
      setChatMessages([]);
    }

    const activeWords = await getEffectiveWords();
    const currentAppLang = appLanguage || localStorage.getItem("vocab_learner_app_lang") || nativeLanguage || "Vietnamese";

    if (activeWords.length === 0) {
      const noWordsMsg: ChatMessage = {
        id: `immersion-no-words-${Date.now()}`,
        role: "assistant",
        content: t("chat_quiz_no_words_warning", currentAppLang),
        timestamp: new Date().toISOString(),
      };
      setChatMessages((prev) => options?.keepHistory ? [...prev, noWordsMsg] : [noWordsMsg]);
      return;
    }

    const candidateWords = getCandidateWordsForImmersion(activeWords, 6);
    if (candidateWords.length === 0) {
      const noCandidateMsg: ChatMessage = {
        id: `immersion-no-candidates-${Date.now()}`,
        role: "assistant",
        content: t("chat_quiz_no_candidates_warning", currentAppLang),
        timestamp: new Date().toISOString(),
        suggestedActions: [
          { label: t("qa_add_word_label", currentAppLang), action: "add_word" },
          { label: t("qa_generate_words_label", currentAppLang), action: "generate_topic" },
          { label: t("chat_practice_start_today_action", currentAppLang), action: "start_practice" },
        ],
      };
      setChatMessages((prev) => options?.keepHistory ? [...prev, noCandidateMsg] : [noCandidateMsg]);
      return;
    }

    const configForServer = startTypingWithConfig(configToUse);

    try {
      const topic = options?.topic;
      const genre = options?.genre || "Auto";
      const difficulty = options?.difficulty || "intermediate";

      const storyResult = await generateImmersionStoryService({
        targetWords: candidateWords,
        topic,
        genre,
        difficulty,
        targetLanguage,
        nativeLanguage,
        cfg: configForServer,
      });

      // Update strength and review history for all studied words
      const candidateIds = new Set(candidateWords.map((w) => w.id));
      setWords((prevWords) => {
        const updatedWords = prevWords.map((w) => {
          if (candidateIds.has(w.id)) {
            const prevStrength = w.strength ?? 0;
            const calcNewStrength = Math.min(100, prevStrength + 10);
            const strengthGained = calcNewStrength - prevStrength;
            return recordStrengthHistory(
              w, 
              calcNewStrength, 
              'immersion_review', 
              `Studied Contextual Story Immersion (+${strengthGained}% strength gained)`
            );
          }
          return w;
        });
        saveAllWordsToDB(updatedWords).catch((e) => console.error("IndexedDB story word save error:", e));
        return updatedWords;
      });

      const resolvedTopic = storyResult.topic || topic || "Immersion Story";
      const isHistorical = genre && genre !== "Auto" && (genre.toLowerCase().includes("historical") || genre.toLowerCase().includes("non-fiction") || genre.toLowerCase().includes("real"));

      const storyMsg: ChatMessage = {
        id: `story-msg-${Date.now()}`,
        role: "assistant",
        content: isHistorical
          ? `### 📜 Real Event Immersion: ${resolvedTopic}\n\nEnjoy this factual account recounting real events while naturally practicing **${candidateWords.length} candidate words** with Comprehensible Input.`
          : `### 📖 Contextual Story Immersion: ${resolvedTopic}\n\nEnjoy this story crafted to naturally practice **${candidateWords.length} candidate words** with Comprehensible Input.`,
        timestamp: new Date().toISOString(),
        audioWord: candidateWords[0]?.word,
        storyData: storyResult,
        provider: configForServer?.provider,
        model: configForServer?.model,
        suggestedActions: [
          { label: "📖 Next Story Practice", action: "start_practice_story_immersion" },
          { label: "🏆 Quiz Practice", action: "start_practice_quiz_only" },
        ],
      };

      setChatMessages((prev) => options?.keepHistory ? [...prev, storyMsg] : [storyMsg]);
    } catch (e: any) {
      console.error("Error generating immersion story:", e);
      triggerChatErrorWithCountdown(e, configToUse, (newConfig) => handleViewStoryImmersion(newConfig, options), "view-immersion-error");
    } finally {
      setIsTyping(false);
    }
  };

  const handleClearChatHistory = () => {
    setActiveQuiz(null);
    setConversationalState("none");
    setPendingTopicSubject("");
    setPendingWordSenses(null);
    setPendingConfirmWord(null);
    const currentAppLang = appLanguage || localStorage.getItem("vocab_learner_app_lang") || nativeLanguage;
    const initialWelcome: ChatMessage[] = [
      {
        id: `welcome-msg-${Date.now()}`,
        role: "assistant",
        content: t("chat_welcome_msg", currentAppLang, { target: targetLanguage, native: nativeLanguage }),
        timestamp: new Date().toISOString(),
      },
    ];
    setChatMessages(initialWelcome);
    localStorage.removeItem("vocab_learner_chat_history");
  };

  const handleShowWordLibraries = () => {
    setActiveQuiz(null);
    setConversationalState("none");
    setPendingTopicSubject("");
    setPendingWordSenses(null);
    setPendingConfirmWord(null);
    const currentAppLang = appLanguage || localStorage.getItem("vocab_learner_app_lang") || nativeLanguage || "en";
    const libMsg: ChatMessage = {
      id: `word-library-msg-${Date.now()}`,
      role: "assistant",
      content: t("chat_library_intro", currentAppLang),
      timestamp: new Date().toISOString(),
      wordLibraries: true,
    };
    setChatMessages([libMsg]);
  };

  return {
    chatMessages,
    setChatMessages,
    isTyping,
    activeModelInfo,
    setIsTyping,
    conversationalState,
    setConversationalState,
    pendingTopicSubject,
    setPendingTopicSubject,
    pendingWordSenses,
    setPendingWordSenses,
    pendingConfirmWord,
    setPendingConfirmWord,
    activeQuiz,
    setActiveQuiz,
    startPractice,
    handleQuizAnswer,
    handleSendChatMessage,
    handleConversationalAddWord,
    handleAnalyzeImageVocab,
    handleAddMultipleWords,
    handleSelectDefinition,
    handleConversationalAddWordOrPrompt,
    handleConversationalGenerateWordsPrompt,
    handleConversationalGenerateWords,
    handlePromptSuggestCasualReply,
    handleSuggestCasualReply,
    handlePromptFixGrammar,
    handleConversationalFixGrammar,
    handleViewStoryImmersion,
    handleShowWordLibraries,
    handleClearChatHistory,
    handleRetryErrorMessage,
    handleCancelErrorMessage,
  };
}
