import { useState, useEffect, useRef } from "react";
import { ChatMessage, Word, WordSense, LLMConfig, UserStats, QuizQuestion } from "../types";
import {
  sendChatMessageService,
  checkWordDefinitionsService,
  generateRandomWordsService,
  generateAiQuizQuestionsService,
  fixGrammarService,
  analyzeImageVocabService,
  generateFlashcardContentService,
  suggestCasualReplyService,
} from "../services/llmClientService";
import { getQuizCandidateWords, getCandidateWordForFlashcard } from "../utils/spacedRepetition";
import { getCertificateTopics, getGeneralTopics } from "../config/topicSuggestions";
import { saveAllWordsToDB, getAllWordsFromDB } from "../db/indexedDB";
import { recordStrengthHistory } from "../utils/strengthHistoryHelpers";
import { getRotatedVisionModel } from "../config/llmProviders";
import { extractOrGenerateTopicActions, getRemainingWordActions } from "../utils/actionExtractor";
import { extractWordsFromPayload } from "../utils/jsonSanitizer";
import { t } from "../config/i18n";

interface UseChatProps {
  words: Word[];
  setWords: React.Dispatch<React.SetStateAction<Word[]>>;
  stats: UserStats;
  llmConfig: LLMConfig;
  targetLanguage: string;
  nativeLanguage: string;
  appLanguage?: string;
  handleAiApiError: (err: any, currentConfig: LLMConfig, retryAction: (newConfig: LLMConfig) => void) => void;
  handleFinishQuiz: (score: number, total: number, correctWordIds?: string[], incorrectWordIds?: string[]) => void;
}

export function useChat({
  words,
  setWords,
  stats,
  llmConfig,
  targetLanguage,
  nativeLanguage,
  appLanguage,
  handleAiApiError,
  handleFinishQuiz,
}: UseChatProps) {
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(() => {
    try {
      const stored = localStorage.getItem("vocab_learner_chat_history");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {
      console.error(e);
    }
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

  const [isTyping, setIsTyping] = useState(false);

  // Conversational state for prompting word addition & grammar fixing
  const [conversationalState, setConversationalState] = useState<
    "none" | "adding_word" | "generating_topic_subject" | "generating_topic_count" | "fixing_grammar" | "suggesting_reply"
  >("none");
  const [pendingTopicSubject, setPendingTopicSubject] = useState<string>("");

  // Pending word senses for multi-definition disambiguation
  const [pendingWordSenses, setPendingWordSenses] = useState<{
    word: string;
    senses: WordSense[];
  } | null>(null);

  // In-Chat interactive conversational quiz state
  const [activeQuiz, setActiveQuiz] = useState<{
    questions: QuizQuestion[];
    currentIndex: number;
    score: number;
    correctIds: string[];
    incorrectIds: string[];
  } | null>(null);

  const wordsRef = useRef(words);
  useEffect(() => {
    wordsRef.current = words;
  }, [words]);

  const getEffectiveWords = async (): Promise<Word[]> => {
    if (wordsRef.current && wordsRef.current.length > 0) {
      return wordsRef.current;
    }
    if (words && words.length > 0) {
      return words;
    }
    try {
      const dbWords = await getAllWordsFromDB();
      if (dbWords && dbWords.length > 0) {
        setWords(dbWords);
        wordsRef.current = dbWords;
        return dbWords;
      }
    } catch (e) {
      console.error("Failed to load words from DB in getEffectiveWords:", e);
    }
    return [];
  };

  // Sync to local storage
  useEffect(() => {
    try {
      localStorage.setItem("vocab_learner_chat_history", JSON.stringify(chatMessages));
    } catch (e) {
      console.error(e);
    }
  }, [chatMessages, targetLanguage, nativeLanguage]);

  // Start the conversational in-chat quiz
  const startChatQuiz = async (overrideConfig?: LLMConfig) => {
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
        id: `quiz-no-words-${Date.now()}`,
        role: "assistant",
        content: t("chat_quiz_no_words_warning", currentAppLang),
        timestamp: new Date().toISOString(),
      };
      setChatMessages([noWordsMsg]);
      return;
    }

    const quizWords = getQuizCandidateWords(activeWords, { maxCandidates: 5, cooldownHours: 12 });
    if (quizWords.length < 2) {
      const noCandidateMsg: ChatMessage = {
        id: `quiz-no-candidates-${Date.now()}`,
        role: "assistant",
        content: t("chat_quiz_no_candidates_warning", currentAppLang),
        timestamp: new Date().toISOString(),
      };
      setChatMessages([noCandidateMsg]);
      return;
    }

    setIsTyping(true);

    try {
      const quizResult = await generateAiQuizQuestionsService({
        words: quizWords,
        targetLanguage,
        nativeLanguage,
        llmConfig: configToUse,
        stats,
      });

      const generatedQuestions = Array.isArray(quizResult) ? quizResult : (quizResult?.questions || []);
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
      });

      const introMsg: ChatMessage = {
        id: `quiz-start-${Date.now()}`,
        role: "assistant",
        content: t("chat_quiz_intro", currentAppLang, {
          count: String(generatedQuestions.length),
          question: firstQ.question,
        }),
        timestamp: new Date().toISOString(),
        audioWord: firstQ.type === "listening" ? firstQ.word : undefined,
        quizSpeechText: (firstQ.type === "listening" || firstQ.type === "spelling") ? firstQ.word : firstQ.question,
        imageUrl: firstQ.imageUrl,
        imageKeyword: firstQ.imageKeyword,
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
      console.error("Error starting chat quiz:", e);
      handleAiApiError(e, configToUse, (newConfig) => startChatQuiz(newConfig));
    } finally {
      setIsTyping(false);
    }
  };

  // Handle conversational quiz answers
  const handleQuizAnswer = (userAnswer: string) => {
    if (!activeQuiz || !activeQuiz.questions || activeQuiz.questions.length === 0) return;

    setIsTyping(true);

    setTimeout(() => {
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

      const nextIndex = activeQuiz.currentIndex + 1;

      if (nextIndex < activeQuiz.questions.length) {
        const nextQ = activeQuiz.questions[nextIndex];

        setActiveQuiz({
          ...activeQuiz,
          currentIndex: nextIndex,
          score: newScore,
          correctIds: newCorrectIds,
          incorrectIds: newIncorrectIds,
        });

        const nextMsg: ChatMessage = {
          id: `quiz-next-${Date.now()}`,
          role: "assistant",
          content: `${feedback}\n\n---\n\n### ${t("chat_quiz_question_header", currentAppLang, { index: String(nextIndex + 1), total: String(activeQuiz.questions.length) })}:\n**${nextQ.question}**`,
          timestamp: new Date().toISOString(),
          audioWord: nextQ.type === "listening" ? nextQ.word : undefined,
          quizSpeechText: isCorrect
            ? t("chat_quiz_speech_correct", targetLanguage, { answer: currentQ.correctAnswer })
            : t("chat_quiz_speech_incorrect", targetLanguage, { answer: currentQ.correctAnswer }),
          nextQuestionSpeechText: (nextQ.type === "listening" || nextQ.type === "spelling") ? nextQ.word : nextQ.question,
          imageUrl: nextQ.imageUrl,
          imageKeyword: nextQ.imageKeyword,
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
        setActiveQuiz(null);

        handleFinishQuiz(newScore, totalQs, newCorrectIds, newIncorrectIds);

        const finishedMsg: ChatMessage = {
          id: `quiz-end-${Date.now()}`,
          role: "assistant",
          content: t("chat_quiz_finished_msg", currentAppLang, {
            feedback: feedback,
            score: String(newScore),
            total: String(totalQs),
            accuracy: String(Math.round((newScore / totalQs) * 100)),
          }),
          timestamp: new Date().toISOString(),
          suggestedActions: [
            { label: t("chat_quiz_start_today_action", currentAppLang), action: "start_quiz" },
            { label: t("chat_quiz_common_phrases_action", currentAppLang), action: "common_phrases" },
          ],
        };

        setChatMessages((prev) => [...prev, finishedMsg]);
      }
      setIsTyping(false);
    }, 600);
  };

  // Add individual word directly from chat suggestions (or conversational input)
  const handleConversationalAddWord = async (wordText: string, hint?: string, overrideConfig?: LLMConfig) => {
    const configToUse = overrideConfig || llmConfig;
    const currentAppLang = appLanguage || localStorage.getItem("vocab_learner_app_lang") || nativeLanguage || "Vietnamese";

    const rawWordInput = wordText.trim();
    const normalizedWordText = rawWordInput.toLowerCase();
    const existingMatch = words.find((w) => w.word.trim().toLowerCase() === normalizedWordText);
    if (existingMatch) {
      const remainingActions = getRemainingWordActions(chatMessages, words, normalizedWordText, currentAppLang);
      setChatMessages((prev) => [
        ...prev,
        {
          id: `sys-exists-${Date.now()}`,
          role: "assistant",
          content: t("chat_word_already_in_collection", currentAppLang, { word: existingMatch.word }),
          timestamp: new Date().toISOString(),
          suggestedActions: remainingActions,
        },
      ]);
      setConversationalState("adding_word");
      return;
    }

    setIsTyping(true);
    const statusMsgId = `add-word-status-${Date.now()}`;
    const contextHintStr = hint ? (currentAppLang.toLowerCase().includes("vi") ? ` với ngữ cảnh *"${hint}"*` : ` with context *"${hint}"*`) : "";

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
        cfg: configToUse,
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
        const targetWordStr = sense?.word || data.word || rawWordInput;

        const finalMatch = words.find((w) => w.word.trim().toLowerCase() === targetWordStr.trim().toLowerCase());
        if (finalMatch) {
          const remainingActions = getRemainingWordActions(chatMessages, words, targetWordStr, currentAppLang);
          setChatMessages((prev) => {
            const filtered = prev.filter((m) => m.id !== statusMsgId);
            return [
              ...filtered,
              {
                id: `sys-exists-${Date.now()}`,
                role: "assistant",
                content: t("chat_word_already_in_collection", currentAppLang, { word: finalMatch.word }),
                timestamp: new Date().toISOString(),
                suggestedActions: remainingActions,
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
          learned: false,
          starred: false,
          createdAt: new Date().toISOString(),
          lastReviewed: null,
          strength: 0,
        };

        const updatedWords = [newWordObj, ...words];

        setWords((prev) => {
          const exists = prev.some((w) => w.word.trim().toLowerCase() === targetWordStr.trim().toLowerCase());
          if (exists) return prev;
          const updated = [newWordObj, ...prev];
          saveAllWordsToDB(updated).catch((e) => console.error("IndexedDB add word save error:", e));
          return updated;
        });

        const remainingActions = getRemainingWordActions(chatMessages, updatedWords, targetWordStr, currentAppLang);

        setChatMessages((prev) => {
          const filtered = prev.filter((m) => m.id !== statusMsgId);
          return [
            ...filtered,
            {
              id: `sys-added-word-${Date.now()}`,
              role: "assistant",
              content: t("chat_word_added_success", currentAppLang, {
                word: targetWordStr,
                pronunciation: pronunciationVal,
                partOfSpeech: partOfSpeechVal,
                translation: translationVal,
                definition: definitionVal,
                exampleSection: (exampleVal ? `\n- **${t("label_example", currentAppLang)}**: "${exampleVal}"` : "") + (exampleTranslationVal ? `\n- **${t("label_example_translation", currentAppLang)}**: "${exampleTranslationVal}"` : "")
              }),
              timestamp: new Date().toISOString(),
              suggestedActions: remainingActions,
              provider: data.provider,
              model: data.model,
              responseTimeMs: data.responseTimeMs,
            },
          ];
        });
        setConversationalState("adding_word");
      }
    } catch (err: any) {
      console.error(err);
      setChatMessages((prev) => prev.filter((m) => m.id !== statusMsgId));
      handleAiApiError(err, configToUse, (newConfig) => {
        handleConversationalAddWord(wordText, hint, newConfig);
      });
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
      handleQuizAnswer(text.trim());
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
        setChatMessages((prev) => [
          ...prev,
          {
            id: `sys-exit-adding-${Date.now()}`,
            role: "assistant",
            content: t("chat_exited_word_adding", currentAppLang),
            timestamp: new Date().toISOString(),
          },
        ]);
        return;
      }

      await handleConversationalAddWord(text.trim(), undefined, configToUse);
      return;
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

    setIsTyping(true);

    try {
      const payloadMessages = chatMessages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const lastPayloadMsg = payloadMessages[payloadMessages.length - 1];
      if (!lastPayloadMsg || lastPayloadMsg.role !== "user" || lastPayloadMsg.content !== text.trim()) {
        payloadMessages.push({ role: "user", content: text.trim() });
      }

      const result = await sendChatMessageService({
        messages: payloadMessages,
        targetLanguage,
        nativeLanguage,
        llmConfig: configToUse,
      });

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
      console.error("Chat error:", err);
      handleAiApiError(err, configToUse, (newConfig) => {
        handleSendChatMessage(text, newConfig);
      });
    } finally {
      setIsTyping(false);
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

    setIsTyping(true);

    try {
      const res = await analyzeImageVocabService({
        imageDataUrl,
        customPrompt,
        targetLanguage,
        nativeLanguage,
        llmConfig: configToUse,
      });

      const items = res.vocabularyItems || [];
      const actions: any[] = [];
      const formattedItems: string[] = [];

      items.forEach((item: any, idx: number) => {
        const isAlreadySaved = words.some((existing) => existing.word.toLowerCase().trim() === item.word.toLowerCase().trim());
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
            action: "add_word",
            payload: { word: item.word, hint: item.definition },
          });
        }
      });

      const unsavedItems = items.filter((item) => !words.some((e) => e.word.toLowerCase().trim() === item.word.toLowerCase().trim()));

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
      console.error("Image analysis error:", err);
      const rawMsg = err?.userMessage || err?.message || (typeof err === "string" ? err : "Failed to analyze image for vocabulary.");
      const currentAppLang = appLanguage || localStorage.getItem("vocab_learner_app_lang") || nativeLanguage || "Vietnamese";

      setChatMessages((prev) => {
        const filtered = prev.filter((m) => m.id !== statusMsgId);
        return [
          ...filtered,
          {
            id: `err-img-${Date.now()}`,
            role: "assistant",
            content: t("chat_error_generate_vocab_from_image", currentAppLang, { error: rawMsg }),
            timestamp: new Date().toISOString(),
            suggestedActions: [
              {
                label: t("action_retry_analyze_image", currentAppLang),
                action: "retry_analyze_image",
                payload: {
                  imageDataUrl,
                  customPrompt,
                },
              },
            ],
          },
        ];
      });
    } finally {
      setIsTyping(false);
    }
  };

  const handleAddMultipleWords = async (candidateWords: any[]) => {
    if (!candidateWords || !Array.isArray(candidateWords) || candidateWords.length === 0) return;

    const currentAppLang = appLanguage || localStorage.getItem("vocab_learner_app_lang") || nativeLanguage || "Vietnamese";

    const newWordsToAdd: Word[] = [];
    const skippedNames: string[] = [];

    candidateWords.forEach((c: any) => {
      const targetWord = (c.word || "").trim();
      if (!targetWord) return;

      const exists = words.some((w) => w.word.toLowerCase().trim() === targetWord.toLowerCase());
      if (exists) {
        skippedNames.push(targetWord);
        return;
      }

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
        learned: false,
        starred: false,
        createdAt: new Date().toISOString(),
        lastReviewed: null,
        strength: 0,
      };

      newWordsToAdd.push(wordObj);
    });

    if (newWordsToAdd.length === 0) {
      setChatMessages((prev) => [
        ...prev,
        {
          id: `sys-batch-skipped-${Date.now()}`,
          role: "assistant",
          content: t("chat_batch_all_skipped", currentAppLang, { words: skippedNames.join(", ") }),
          timestamp: new Date().toISOString(),
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
    setConversationalState("adding_word");
  };

  const handleSelectDefinition = async (word: string, senseIndex: number, translation: string) => {
    if (!pendingWordSenses || pendingWordSenses.word !== word) return;

    const currentAppLang = appLanguage || localStorage.getItem("vocab_learner_app_lang") || nativeLanguage || "Vietnamese";

    const sense = pendingWordSenses.senses[senseIndex];
    if (!sense) return;

    const targetWord = (sense.word || word).trim();
    const existingMatch = words.find((w) => w.word.trim().toLowerCase() === targetWord.toLowerCase());
    if (existingMatch) {
      const remainingActions = getRemainingWordActions(chatMessages, words, targetWord, currentAppLang);
      setChatMessages((prev) => [
        ...prev,
        {
          id: `sys-exists-${Date.now()}`,
          role: "assistant",
          content: t("chat_word_already_in_collection", currentAppLang, { word: existingMatch.word }),
          timestamp: new Date().toISOString(),
          suggestedActions: remainingActions,
        },
      ]);
      setPendingWordSenses(null);
      setConversationalState("adding_word");
      return;
    }

    setIsTyping(true);
    const statusMsgId = `add-word-selected-status-${Date.now()}`;

    const finalTranslation =
      translation && translation !== "undefined" ? translation : sense.translation && sense.translation !== "undefined" ? sense.translation : targetWord;
    const newUserMsg: ChatMessage = {
      id: `user-select-def-${Date.now()}`,
      role: "user",
      content: t("chat_user_selected_add_word", currentAppLang, { word: targetWord, translation: finalTranslation }),
      timestamp: new Date().toISOString(),
    };

    setChatMessages((prev) => [
      ...prev,
      newUserMsg,
      {
        id: statusMsgId,
        role: "assistant",
        content: t("chat_saving_custom_card", currentAppLang, { word: targetWord }),
        timestamp: new Date().toISOString(),
      },
    ]);

    try {
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
        learned: false,
        starred: false,
        createdAt: new Date().toISOString(),
        lastReviewed: null,
        strength: 0,
      };

      const updatedWords = [newWord, ...words];

      setWords((prev) => {
        const updated = [newWord, ...prev];
        saveAllWordsToDB(updated).catch((e) => console.error(e));
        return updated;
      });

      const remainingActions = getRemainingWordActions(chatMessages, updatedWords, targetWord, currentAppLang);

      setChatMessages((prev) => {
        const filtered = prev.filter((m) => m.id !== statusMsgId);
        return [
          ...filtered,
          {
            id: `sys-add-${Date.now()}`,
            role: "assistant",
            content: t("chat_word_added_success", currentAppLang, {
              word: newWord.word,
              pronunciation: newWord.pronunciation || '',
              partOfSpeech: newWord.partOfSpeech,
              translation: newWord.translation,
              definition: newWord.definition,
              exampleSection: newWord.example ? `\n- **${t("label_example", currentAppLang)}**: "${newWord.example}"` : ""
            }),
            timestamp: new Date().toISOString(),
            suggestedActions: remainingActions,
          },
        ];
      });

      setPendingWordSenses(null);
      setConversationalState("adding_word");
    } catch (err: any) {
      console.error(err);
      setChatMessages((prev) => {
        const filtered = prev.filter((m) => m.id !== statusMsgId);
        return [
          ...filtered,
          {
            id: `sys-add-err-${Date.now()}`,
            role: "assistant",
            content: t("chat_fail_add_word_sense", currentAppLang, { error: err.message || (currentAppLang.toLowerCase().includes("vi") ? "Lỗi không xác định" : "Unknown error") }),
            timestamp: new Date().toISOString(),
          },
        ];
      });
    } finally {
      setIsTyping(false);
    }
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
    setIsTyping(true);
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
      const existingWordSet = new Set(words.map((w) => w.word.trim().toLowerCase()));
      const res = await generateRandomWordsService({
        topic: topic,
        targetLanguage,
        nativeLanguage,
        count,
        cfg: configToUse,
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

      const newUniqueWords = generatedList.filter((item: any) => item?.word && !existingWordSet.has(item.word.trim().toLowerCase()));

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
        };
        generatedWords.push(newWord);
      });

      const wordsListMarkdown = generatedWords
        .map(
          (w, idx) =>
            `${idx + 1}. **${w.word}** \`${w.pronunciation}\` (${w.partOfSpeech}) - **${w.translation}**\n   *Def:* ${w.definition}${
              w.example ? `\n   *Ex:* "${w.example}" (${w.exampleTranslation || ""})` : ""
            }`
        )
        .join("\n\n");

      const suggestedActions: any[] = [
        {
          label: t("action_add_all_topic_words", currentAppLang, { count: String(generatedWords.length) }),
          action: "add_multiplewords",
          payload: { words: generatedWords },
        },
        ...generatedWords.map((w) => ({
          label: t("action_confirm_add", currentAppLang, { word: w.word, translation: w.translation }),
          action: "confirm_save_word",
          payload: w,
        })),
        {
          label: t("action_generate_more_topic_words", currentAppLang, { topic }),
          action: "send_message",
          payload: { message: topic },
        },
      ];

      setChatMessages((prev) => {
        const filtered = prev.filter((m) => m.id !== statusMsgId);
        return [
          ...filtered,
          {
            id: `gen-words-success-${Date.now()}`,
            role: "assistant",
            content: t("chat_generate_topic_words_success", currentAppLang, { topic, count: String(generatedWords.length), wordsListMarkdown }),
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
      handleAiApiError(err, configToUse, (newConfig) => {
        handleConversationalGenerateWords(topic, count, newConfig);
      });
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
    setIsTyping(true);
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
        llmConfig: configToUse,
      });

      const replies = res.suggestedReplies || [];
      const candidates = res.vocabularyCandidates || [];

      const actions: any[] = [];

      if (candidates && candidates.length > 0) {
        candidates.forEach((cand) => {
          if (cand.word) {
            const reason = cand.reason || (currentAppLang.toLowerCase().includes("vi") ? "Từ vựng đề xuất" : "Suggested vocabulary");
            actions.push({
              label: t("chat_suggest_reply_label", currentAppLang, { word: cand.word, reason }),
              action: "add_word",
              payload: { word: cand.word, hint: cand.reason || cand.translation },
            });
          }
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

      if (candidates && candidates.length > 0) {
        contentMarkdown += t("chat_useful_conversation_vocab_header", currentAppLang);
        candidates.forEach((c) => {
          contentMarkdown += `- **${c.word}**: *${c.translation}* — ${c.reason}\n`;
        });
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
            provider: res.provider,
            model: res.model,
            responseTimeMs: res.responseTimeMs,
          },
        ];
      });
    } catch (err: any) {
      console.error("Suggest Casual Reply Error:", err);
      const rawMsg = err?.userMessage || err?.message || (typeof err === "string" ? err : "Failed to suggest casual reply.");
      setChatMessages((prev) => {
        const filtered = prev.filter((m) => m.id !== statusMsgId);
        return [
          ...filtered,
          {
            id: `err-reply-${Date.now()}`,
            role: "assistant",
            content: t("chat_error_suggest_reply", currentAppLang, { error: rawMsg }),
            timestamp: new Date().toISOString(),
            suggestedActions: [
              {
                label: t("action_retry_suggest_reply", currentAppLang),
                action: "retry_suggest_reply",
                payload: {
                  imageDataUrl,
                  customPrompt,
                },
              },
            ],
          },
        ];
      });
    } finally {
      setIsTyping(false);
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
    setIsTyping(true);
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
        llmConfig: configToUse,
      });

      const fixedSentence = res.fixedSentence || userText;
      const explanation = res.explanation || "";
      const candidates = res.vocabularyCandidates || [];

      const actions: any[] = [];

      actions.push({
        label: t("action_copy_fixed_sentence", currentAppLang),
        action: "copy_text",
        payload: { text: fixedSentence },
      });

      if (candidates && candidates.length > 0) {
        candidates.forEach((cand) => {
          if (cand.word) {
            const reason = cand.reason || (currentAppLang.toLowerCase().includes("vi") ? "Từ vựng đề xuất" : "Candidate vocabulary");
            actions.push({
              label: t("chat_suggest_reply_label", currentAppLang, { word: cand.word, reason }),
              action: "add_word",
              payload: { word: cand.word, hint: cand.reason },
            });
          }
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

      if (candidates && candidates.length > 0) {
        contentMarkdown += t("chat_recommended_vocabulary_candidates_header", currentAppLang);
        candidates.forEach((c) => {
          contentMarkdown += `- **${c.word}**: *${c.reason}*\n`;
        });
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
            provider: res.provider,
            model: res.model,
            responseTimeMs: res.responseTimeMs,
          },
        ];
      });
    } catch (err: any) {
      console.error("Fix Grammar Error:", err);
      setChatMessages((prev) => prev.filter((m) => m.id !== statusMsgId));
      handleAiApiError(err, configToUse, () => {
        handleConversationalFixGrammar(userText);
      });
    } finally {
      setIsTyping(false);
    }
  };

  const handleViewFlashcard = async (overrideConfig?: LLMConfig) => {
    const configToUse = overrideConfig || llmConfig;
    setActiveQuiz(null);
    setConversationalState("none");
    setChatMessages([]);

    const activeWords = await getEffectiveWords();
    const currentAppLang = appLanguage || localStorage.getItem("vocab_learner_app_lang") || nativeLanguage || "Vietnamese";

    if (activeWords.length === 0) {
      const noWordsMsg: ChatMessage = {
        id: `flashcard-no-words-${Date.now()}`,
        role: "assistant",
        content: t("chat_empty_collection_flashcard_warning", currentAppLang),
        timestamp: new Date().toISOString(),
      };
      setChatMessages([noWordsMsg]);
      return;
    }

    const candidateWord = getCandidateWordForFlashcard(activeWords);
    if (!candidateWord) {
      const noCandidateMsg: ChatMessage = {
        id: `flashcard-no-candidates-${Date.now()}`,
        role: "assistant",
        content: t("chat_no_words_found_flashcard_warning", currentAppLang),
        timestamp: new Date().toISOString(),
      };
      setChatMessages([noCandidateMsg]);
      return;
    }

    setIsTyping(true);

    try {
      const flashcardContent = await generateFlashcardContentService({
        word: candidateWord,
        targetLanguage,
        nativeLanguage,
        llmConfig: configToUse,
      });

      const prevStrength = candidateWord.strength ?? 0;
      const calcNewStrength = Math.min(100, prevStrength + 10);
      const strengthGained = calcNewStrength - prevStrength;

      setWords((prevWords) => {
        const updatedWords = prevWords.map((w) => {
          if (w.id === candidateWord.id) {
            return recordStrengthHistory(
              w, 
              calcNewStrength, 
              'flashcard_review', 
              `Studied Flashcard (+${strengthGained}% strength gained)`
            );
          }
          return w;
        });
        saveAllWordsToDB(updatedWords).catch((e) => console.error("IndexedDB flashcard word save error:", e));
        return updatedWords;
      });

      const keywordText = flashcardContent.imageKeyword || candidateWord.imageKeyword || candidateWord.word;

      const vocabActions = (flashcardContent.suggestedVocabulary || []).map((vocab: any) => ({
        label: t("action_confirm_add", currentAppLang, { word: vocab.word, translation: vocab.translation }),
        action: "add_word",
        payload: { word: vocab.word, hint: vocab.definition },
      }));

      const flashcardMsg: ChatMessage = {
        id: `flashcard-msg-${Date.now()}`,
        role: "assistant",
        content: t("chat_flashcard_title", currentAppLang, {
          word: flashcardContent.word,
          partOfSpeech: flashcardContent.partOfSpeech || candidateWord.partOfSpeech,
          pronunciation: flashcardContent.pronunciation || candidateWord.pronunciation || "",
          definition: flashcardContent.definition,
          translation: flashcardContent.translation
        }),
        timestamp: new Date().toISOString(),
        audioWord: flashcardContent.word,
        quizSpeechText: `${flashcardContent.word}. ${flashcardContent.definition}`,
        imageKeyword: keywordText,
        flashcardData: {
          wordId: candidateWord.id,
          word: flashcardContent.word,
          pronunciation: flashcardContent.pronunciation || candidateWord.pronunciation,
          partOfSpeech: flashcardContent.partOfSpeech || candidateWord.partOfSpeech,
          definition: flashcardContent.definition,
          translation: flashcardContent.translation,
          category: flashcardContent.category || candidateWord.category || "General",
          context: flashcardContent.context || candidateWord.context || candidateWord.definition,
          extraExampleSentences: flashcardContent.extraExampleSentences,
          usageNotes: flashcardContent.usageNotes,
          imageKeyword: keywordText,
          suggestedVocabulary: flashcardContent.suggestedVocabulary,
          previousStrength: prevStrength,
          newStrength: calcNewStrength,
          strengthGained: strengthGained
        },
        provider: flashcardContent.provider,
        model: flashcardContent.model,
        responseTimeMs: flashcardContent.responseTimeMs,
        suggestedActions: [...vocabActions, { label: t("action_next_flashcard", currentAppLang), action: "view_flashcard" }],
      };

      setChatMessages([flashcardMsg]);
    } catch (e: any) {
      console.error("Error generating flash card:", e);
      handleAiApiError(e, configToUse, (newConfig) => handleViewFlashcard(newConfig));
    } finally {
      setIsTyping(false);
    }
  };

  const handleClearChatHistory = () => {
    setActiveQuiz(null);
    setConversationalState("none");
    setPendingTopicSubject("");
    setPendingWordSenses(null);
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

  return {
    chatMessages,
    setChatMessages,
    isTyping,
    setIsTyping,
    conversationalState,
    setConversationalState,
    pendingTopicSubject,
    setPendingTopicSubject,
    pendingWordSenses,
    setPendingWordSenses,
    activeQuiz,
    setActiveQuiz,
    startChatQuiz,
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
    handleViewFlashcard,
    handleClearChatHistory,
  };
}
