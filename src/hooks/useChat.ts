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
import { extractOrGenerateTopicActions } from "../utils/actionExtractor";

interface UseChatProps {
  words: Word[];
  setWords: React.Dispatch<React.SetStateAction<Word[]>>;
  stats: UserStats;
  llmConfig: LLMConfig;
  targetLanguage: string;
  nativeLanguage: string;
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
    return [
      {
        id: "welcome-msg",
        role: "assistant",
        content: `¡Hola! Welcome to your interactive AI Language Coach. I'm here to help you master **${targetLanguage}** from your native language **${nativeLanguage}**.\n\nYou can chat with me, ask me to translate phrases, explain grammar rules, or introduce new words.\n\nTry asking me: *'What are some common idioms in ${targetLanguage}?'* or click one of the quick actions below to start learning!`,
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

    const activeWords = await getEffectiveWords();

    if (activeWords.length === 0) {
      const noWordsMsg: ChatMessage = {
        id: `quiz-no-words-${Date.now()}`,
        role: "assistant",
        content: `📝 **You don't have any words in your collection yet!**\n\nTo start a quiz, please add some words manually using the **+ Add Word** button or simply type a word in the chat and ask me to help you add it!`,
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
        content: `🎉 **No words to practice today!**\n\nYou have already reviewed your eligible vocabulary items recently. There are no words due for practice right now.\n\nPlease come back later or add new words to your collection to keep practicing!`,
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
        content: `🎬 **Let's start today's interactive quiz!**\n\nI generated **${generatedQuestions.length}** questions adhering to target language rules and distractor logic.\n\n---\n\n### Question 1 of ${generatedQuestions.length}:\n**${firstQ.question}**`,
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
        feedback = `🎉 **Correct!**\n\nThe answer to "${currentQ.question.split("\n")[0]}" is **"${currentQ.correctAnswer}"**.`;
        if (targetWordObj) {
          feedback += `\n\n*Word*: **${targetWordObj.word}** (${targetWordObj.partOfSpeech})\n*Pronunciation*: \`${targetWordObj.pronunciation || ""}\`\n*Translation*: "${targetWordObj.translation}"`;
        }
      } else {
        feedback = `❌ **Incorrect!**\n\nCorrect answer: **"${currentQ.correctAnswer}"** (your answer: "${userAnswer}").`;
        if (targetWordObj) {
          feedback += `\n\n*Word*: **${targetWordObj.word}** (${targetWordObj.partOfSpeech})\n*Pronunciation*: \`${targetWordObj.pronunciation || ""}\`\n*Translation*: "${targetWordObj.translation}"`;
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
          content: `${feedback}\n\n---\n\n### Question ${nextIndex + 1} of ${activeQuiz.questions.length}:\n**${nextQ.question}**`,
          timestamp: new Date().toISOString(),
          audioWord: nextQ.type === "listening" ? nextQ.word : undefined,
          quizSpeechText: isCorrect
            ? `Correct! The answer is ${currentQ.correctAnswer}`
            : `Incorrect! Correct answer: ${currentQ.correctAnswer}`,
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
          content: `${feedback}\n\n---\n\n🏆 **Quiz Completed!**\n\nYou scored **${newScore} out of ${totalQs}** (${Math.round(
            (newScore / totalQs) * 100
          )}%).\n\nI have updated your statistics and adjusted word learning strength values! All set.\n\nWhat would you like to learn next?`,
          timestamp: new Date().toISOString(),
          suggestedActions: [
            { label: "Start Today's Quiz", action: "start_quiz" },
            { label: "Common Idioms & Phrases", action: "common_phrases" },
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

    const rawWordInput = wordText.trim();
    const normalizedWordText = rawWordInput.toLowerCase();
    const existingMatch = words.find((w) => w.word.trim().toLowerCase() === normalizedWordText);
    if (existingMatch) {
      setChatMessages((prev) => [
        ...prev,
        {
          id: `sys-exists-${Date.now()}`,
          role: "assistant",
          content: `ℹ️ **"${existingMatch.word}" is already in your vocabulary collection!**\n\n- **Translation**: ${existingMatch.translation}\n- **Definition**: *${existingMatch.definition}*\n\nSkipped adding duplicate entry.\n\n👇 **Type another word below** to add it to your collection!`,
          timestamp: new Date().toISOString(),
        },
      ]);
      setConversationalState("adding_word");
      return;
    }

    setIsTyping(true);
    const statusMsgId = `add-word-status-${Date.now()}`;
    const contextHintStr = hint ? ` with context *"${hint}"*` : "";

    setChatMessages((prev) => [
      ...prev,
      {
        id: statusMsgId,
        role: "assistant",
        content: `🔍 *Consulting dictionary, translating, and generating definition for **"${rawWordInput}"**${contextHintStr}...*`,
        timestamp: new Date().toISOString(),
      },
    ]);

    try {
      const data = await checkWordDefinitionsService({
        word: rawWordInput,
        hint: hint,
        targetLanguage,
        nativeLanguage,
        llmConfig: configToUse,
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
              content: `⚠️ **No valid definition found for "${wordText}"**${hint ? ` with context *"${hint}"*` : ""}.\n\nThis entry was **not** added to your collection.\n\n👇 **Type another word below** to try again!`,
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
              content: `🤔 **"${wordText}"** has several common meanings in **${targetLanguage}**. Which definition would you like to add?`,
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
                content: `⚠️ **No valid definition found for "${wordText}"**${hint ? ` with context *"${hint}"*` : ""}.\n\nThis entry was **not** added to your collection.\n\n👇 **Type another word below** to try again!`,
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
          setChatMessages((prev) => {
            const filtered = prev.filter((m) => m.id !== statusMsgId);
            return [
              ...filtered,
              {
                id: `sys-exists-${Date.now()}`,
                role: "assistant",
                content: `ℹ️ **"${finalMatch.word}" is already in your vocabulary collection!**\n\n👇 **Type another word below** to add it to your collection!`,
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

        setWords((prev) => {
          const exists = prev.some((w) => w.word.trim().toLowerCase() === targetWordStr.trim().toLowerCase());
          if (exists) return prev;
          const updated = [newWordObj, ...prev];
          saveAllWordsToDB(updated).catch((e) => console.error("IndexedDB add word save error:", e));
          return updated;
        });

        setChatMessages((prev) => {
          const filtered = prev.filter((m) => m.id !== statusMsgId);
          return [
            ...filtered,
            {
              id: `sys-added-word-${Date.now()}`,
              role: "assistant",
              content: `🎉 **Successfully added "${targetWordStr}" to your collection!**\n\n### **${targetWordStr}** \`${pronunciationVal}\` (${partOfSpeechVal})\n- **Translation**: ${translationVal}\n- **Definition**: *${definitionVal}*${
                exampleVal ? `\n- **Example**: "${exampleVal}"` : ""
              }${exampleTranslationVal ? `\n- **Example Translation**: "${exampleTranslationVal}"` : ""}\n\n👇 **Type another word below** to translate and add it to your collection!`,
              timestamp: new Date().toISOString(),
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
        proxyKey: llmConfig.proxyKey || "",
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
        setChatMessages((prev) => [
          ...prev,
          {
            id: `sys-exit-adding-${Date.now()}`,
            role: "assistant",
            content: `👍 **Exited word adding mode.** You are back in normal AI chat mode!\n\nFeel free to ask me questions, practice grammar, or pick a topic below.`,
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
      const countMsg: ChatMessage = {
        id: `gen-count-prompt-${Date.now()}`,
        role: "assistant",
        content: `🔢 **How many vocabulary words would you like to generate for "${topic}"?**\n\nPlease select an option below or type any custom number (e.g. 5, 10, 15, 20):`,
        timestamp: new Date().toISOString(),
        suggestedActions: [
          { label: "Generate 5 words", action: "send_message", payload: { message: "5" } },
          { label: "Generate 10 words", action: "send_message", payload: { message: "10" } },
          { label: "Generate 15 words", action: "send_message", payload: { message: "15" } },
          { label: "Generate 20 words", action: "send_message", payload: { message: "20" } },
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
          else if (cleaned.payload?.word) cleaned.label = `Add "${cleaned.payload.word}" to collection`;
          else if (cleaned.word) cleaned.label = `Add "${cleaned.word}" to collection`;
        }
        return cleaned;
      });

      const finalActions = extractOrGenerateTopicActions(
        rawTextContent,
        validActions,
        text,
        targetLanguage,
        nativeLanguage
      );

      const fallbackContent = finalActions.length > 0
        ? `Here are some suggested topics and options for practicing ${targetLanguage}:`
        : "I was unable to formulate a response. Please try asking again or selecting a topic below.";

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

    const userPromptText = customPrompt ? customPrompt : "Analyzed photo for vocabulary";
    setChatMessages((prev) => [
      ...prev,
      {
        id: userMsgId,
        role: "user",
        content: `📷 **Uploaded Photo**: ${userPromptText}`,
        imageUrl: imageDataUrl,
        timestamp: new Date().toISOString(),
      },
      {
        id: statusMsgId,
        role: "assistant",
        content: `📷 *Analyzing your photo to extract vocabulary in ${targetLanguage}...*`,
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
        const statusBadge = isAlreadySaved ? " *(Already in collection)*" : "";

        formattedItems.push(
          `### ${idx + 1}. **${item.word}** \`${item.pronunciation || ""}\`${statusBadge}\n` +
            `- **Translation**: ${item.translation} (${item.partOfSpeech || "item"})\n` +
            `- **Definition**: *${item.definition}*\n` +
            (item.example ? `- **Example**: "${item.example}"\n` : "") +
            (item.context ? `- **In Photo**: *${item.context}*\n` : "")
        );

        if (!isAlreadySaved) {
          actions.push({
            label: `➕ Confirm & Add "${item.word}" (${item.translation})`,
            action: "add_word",
            payload: { word: item.word, hint: item.definition },
          });
        }
      });

      const unsavedItems = items.filter((item) => !words.some((e) => e.word.toLowerCase().trim() === item.word.toLowerCase().trim()));

      if (unsavedItems.length > 1) {
        actions.unshift({
          label: `✨ Add All (${unsavedItems.length}) Discovered Photo Words`,
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
            content: `🔍 **Photo Analysis**: *"${res.imageDescription || "Visual scene"}"*\n\nFound **${items.length}** vocabulary items:\n\n${formattedItems.join("\n")}\n\n*Click below to confirm and add items to your collection:*`,
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

      setChatMessages((prev) => {
        const filtered = prev.filter((m) => m.id !== statusMsgId);
        return [
          ...filtered,
          {
            id: `err-img-${Date.now()}`,
            role: "assistant",
            content: `⚠️ **Unable to generate vocabulary from image.**\n\n*Error*: ${rawMsg}`,
            timestamp: new Date().toISOString(),
            suggestedActions: [
              {
                label: "🔄 Try again analyzing photo",
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
          content: `ℹ️ All candidate words (${skippedNames.join(", ")}) are already saved in your vocabulary collection!`,
          timestamp: new Date().toISOString(),
        },
      ]);
      return;
    }

    setWords((prev) => {
      const updated = [...newWordsToAdd, ...prev];
      saveAllWordsToDB(updated).catch((e) => console.error(e));
      return updated;
    });

    setChatMessages((prev) => [
      ...prev,
      {
        id: `sys-batch-success-${Date.now()}`,
        role: "assistant",
        content: `🎉 **Successfully added ${newWordsToAdd.length} new word(s) to your collection!**\n\n- **Added**: ${newWordsToAdd.map((w) => `**${w.word}** (${w.translation})`).join(", ")}${
          skippedNames.length > 0 ? `\n- *Skipped duplicates*: ${skippedNames.join(", ")}` : ""
        }\n\n👇 **Type another word below** to keep adding to your collection!`,
        timestamp: new Date().toISOString(),
      },
    ]);
    setConversationalState("adding_word");
  };

  const handleSelectDefinition = async (word: string, senseIndex: number, translation: string) => {
    if (!pendingWordSenses || pendingWordSenses.word !== word) return;

    const sense = pendingWordSenses.senses[senseIndex];
    if (!sense) return;

    const targetWord = (sense.word || word).trim();
    const existingMatch = words.find((w) => w.word.trim().toLowerCase() === targetWord.toLowerCase());
    if (existingMatch) {
      setChatMessages((prev) => [
        ...prev,
        {
          id: `sys-exists-${Date.now()}`,
          role: "assistant",
          content: `ℹ️ **"${existingMatch.word}" is already in your vocabulary collection!**\n\n👇 **Type another word below** to add it to your collection!`,
          timestamp: new Date().toISOString(),
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
      content: `I want to add: "${targetWord}" (${finalTranslation})`,
      timestamp: new Date().toISOString(),
    };

    setChatMessages((prev) => [
      ...prev,
      newUserMsg,
      {
        id: statusMsgId,
        role: "assistant",
        content: `🔍 *Saving custom card for **"${targetWord}"** to your collection...*`,
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

      setWords((prev) => {
        const updated = [newWord, ...prev];
        saveAllWordsToDB(updated).catch((e) => console.error(e));
        return updated;
      });

      setChatMessages((prev) => {
        const filtered = prev.filter((m) => m.id !== statusMsgId);
        return [
          ...filtered,
          {
            id: `sys-add-${Date.now()}`,
            role: "assistant",
            content: `🎉 **Successfully added "${newWord.word}" to your collection!**\n\n- **Translation**: ${newWord.translation}\n- **Pronunciation**: \`${newWord.pronunciation}\`\n- **Definition**: *${newWord.definition}*\n${newWord.example ? `- **Example**: "${newWord.example}"\n` : ""}\n👇 **Type another word below** to keep adding to your collection!`,
            timestamp: new Date().toISOString(),
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
            content: `⚠️ **Failed to add word sense:** ${err.message || "Unknown error"}. Please check your settings and try again.`,
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
      const addWordMsg: ChatMessage = {
        id: `add-word-prompt-${Date.now()}`,
        role: "assistant",
        content: `📝 **Add a New Word to Collection**\n\nWhat word or expression would you like to translate and add to your collection?\n\nPlease type the word or phrase in **${targetLanguage}** or **${nativeLanguage}** below!`,
        timestamp: new Date().toISOString(),
      };
      setChatMessages([addWordMsg]);
    }
  };

  const handleConversationalGenerateWordsPrompt = () => {
    setActiveQuiz(null);
    setPendingWordSenses(null);
    setConversationalState("generating_topic_subject");

    const certTopics = getCertificateTopics(targetLanguage);
    const genTopics = getGeneralTopics();

    const certList = certTopics.map((t) => `- **${t.name}** (${t.badge}): ${t.description}`).join("\n");
    const genList = genTopics.map((t) => `- **${t.name}**: ${t.description}`).join("\n");

    const promptMsg: ChatMessage = {
      id: `gen-topic-prompt-${Date.now()}`,
      role: "assistant",
      content: `🎨 **Generate Vocabulary by Topic/Subject**\n\nChoose a topic below or **type any custom topic** you want to study!\n\n🏆 **Popular ${targetLanguage} Exam / Certificate Topics:**\n${certList}\n\n💡 **General Topics:**\n${genList}\n\n👇 *Select a topic below or type your own topic in the chat!*`,
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
    setChatMessages((prev) => [
      ...prev,
      {
        id: statusMsgId,
        role: "assistant",
        content: `🔍 *Generating ${count} new, unique vocabulary words in **${targetLanguage}** about **"${topic}"**...*`,
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
        llmConfig: configToUse,
      });

      const generatedList = res.words || [];
      const newUniqueWords = generatedList.filter((item: any) => item?.word && !existingWordSet.has(item.word.trim().toLowerCase()));

      if (newUniqueWords.length === 0) {
        setChatMessages((prev) => {
          const filtered = prev.filter((m) => m.id !== statusMsgId);
          return [
            ...filtered,
            {
              id: `gen-words-empty-${Date.now()}`,
              role: "assistant",
              content: `⚠️ I tried to generate vocabulary words for **"${topic}"**, but I didn't find any new words that aren't already in your collection. Try a different topic or clear some existing words!`,
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
          label: `✨ Add All (${generatedWords.length}) Words to Collection`,
          action: "add_multiplewords",
          payload: { words: generatedWords },
        },
        ...generatedWords.map((w) => ({
          label: `➕ Add "${w.word}" (${w.translation})`,
          action: "confirm_save_word",
          payload: w,
        })),
        {
          label: `🎨 Generate More Words for "${topic}"`,
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
            content: `✨ **Generated ${generatedWords.length} vocabulary words for topic "${topic}":**\n\n${wordsListMarkdown}\n\n👇 *Click "Add All Words to Collection" below or add individual words to your collection:*`,
            timestamp: new Date().toISOString(),
            suggestedActions: suggestedActions,
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
    const promptMsg: ChatMessage = {
      id: `suggest-reply-prompt-${Date.now()}`,
      role: "assistant",
      content: `💬 **Suggest a Casual Reply**\n\nUpload an image (or screenshot) of a conversation, or enter some text to guide me (or both!).\n\nI will analyze the conversation and your guiding instructions, then return a few suggested replies along with candidate vocabulary words!`,
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

    let userMsgContent = "";
    if (customPrompt) {
      userMsgContent += `Guiding: "${customPrompt}"`;
    }

    setChatMessages((prev) => [
      ...prev,
      {
        id: `user-reply-req-${Date.now()}`,
        role: "user",
        content: userMsgContent || "Suggest a casual reply based on the attached screenshot",
        timestamp: new Date().toISOString(),
        imageUrl: imageDataUrl || undefined,
      },
      {
        id: statusMsgId,
        role: "assistant",
        content: `💬 *Analyzing conversation and suggesting replies...*`,
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
            actions.push({
              label: `➕ Add "${cand.word}" to collection (${cand.reason || "Suggested vocabulary"})`,
              action: "add_word",
              payload: { word: cand.word, hint: cand.reason || cand.translation },
            });
          }
        });
      }

      actions.push({
        label: "💬 Suggest Another Casual Reply",
        action: "suggest_another",
      });

      let contentMarkdown = `### 💬 Suggested Casual Replies:\n\n`;
      if (replies.length === 0) {
        contentMarkdown += `*No direct replies could be formulated. Try providing more text or a clearer screenshot.*\n\n`;
      }

      if (candidates && candidates.length > 0) {
        contentMarkdown += `---\n### 📚 Useful Conversation Vocabulary:\n`;
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
            content: `⚠️ **Unable to generate suggested replies.**\n\n*Error*: ${rawMsg}`,
            timestamp: new Date().toISOString(),
            suggestedActions: [
              {
                label: "🔄 Try again suggesting reply",
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
    const promptMsg: ChatMessage = {
      id: `fix-grammar-prompt-${Date.now()}`,
      role: "assistant",
      content: `✍️ **Fix Grammar & Polish Sentence**\n\nEnter or paste any sentence below in **${targetLanguage}** (or **${nativeLanguage}**).\n\nI will fix grammar & spelling, improve clarity and readability, suggest natural word choices, and identify candidate vocabulary to add to your collection!`,
      timestamp: new Date().toISOString(),
    };
    setChatMessages([promptMsg]);
  };

  const handleConversationalFixGrammar = async (userText: string, overrideConfig?: LLMConfig) => {
    const configToUse = overrideConfig || llmConfig;
    setIsTyping(true);
    const statusMsgId = `fix-grammar-status-${Date.now()}`;
    setChatMessages((prev) => [
      ...prev,
      {
        id: statusMsgId,
        role: "assistant",
        content: `✍️ *Analyzing sentence, fixing grammar, and identifying candidate vocabulary...*`,
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
        label: "📋 Copy Fixed Sentence",
        action: "copy_text",
        payload: { text: fixedSentence },
      });

      if (candidates && candidates.length > 0) {
        candidates.forEach((cand) => {
          if (cand.word) {
            actions.push({
              label: `➕ Add "${cand.word}" to collection (${cand.reason || "Candidate vocabulary"})`,
              action: "add_word",
              payload: { word: cand.word, hint: cand.reason },
            });
          }
        });
      }

      actions.push({
        label: "✍️ Fix Another Sentence",
        action: "fix_another",
      });

      let contentMarkdown = `### ✨ Polished Sentence:\n> **"${fixedSentence}"**\n\n`;
      if (explanation) {
        contentMarkdown += `${explanation}\n\n`;
      }

      if (candidates && candidates.length > 0) {
        contentMarkdown += `---\n### 📚 Recommended Vocabulary Candidates:\n`;
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

    const activeWords = await getEffectiveWords();

    if (activeWords.length === 0) {
      const noWordsMsg: ChatMessage = {
        id: `flashcard-no-words-${Date.now()}`,
        role: "assistant",
        content: `📝 **Your vocabulary collection is empty!**\n\nTo view AI flash cards, please add some words to your collection first using the **+ Add Word** button or ask me to generate words by topic!`,
        timestamp: new Date().toISOString(),
      };
      setChatMessages((prev) => [...prev, noWordsMsg]);
      return;
    }

    const candidateWord = getCandidateWordForFlashcard(activeWords);
    if (!candidateWord) {
      const noCandidateMsg: ChatMessage = {
        id: `flashcard-no-candidates-${Date.now()}`,
        role: "assistant",
        content: `📝 **No vocabulary words found.** Please add words to your collection to view flash cards!`,
        timestamp: new Date().toISOString(),
      };
      setChatMessages((prev) => [...prev, noCandidateMsg]);
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
        label: `➕ Add "${vocab.word}" (${vocab.translation})`,
        action: "add_word",
        payload: { word: vocab.word, hint: vocab.definition },
      }));

      const flashcardMsg: ChatMessage = {
        id: `flashcard-msg-${Date.now()}`,
        role: "assistant",
        content: `🃏 **Word Flash Card: ${flashcardContent.word}**\n\n*${flashcardContent.partOfSpeech || candidateWord.partOfSpeech}* • \`${
          flashcardContent.pronunciation || candidateWord.pronunciation || ""
        }\`\n\n**Definition**: ${flashcardContent.definition}\n**Translation**: "${flashcardContent.translation}"`,
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
        suggestedActions: [...vocabActions, { label: "🃏 Next Flash Card", action: "view_flashcard" }],
      };

      setChatMessages((prev) => [...prev, flashcardMsg]);
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
    const initialWelcome: ChatMessage[] = [
      {
        id: `welcome-msg-${Date.now()}`,
        role: "assistant",
        content: `¡Hola! Welcome to your interactive AI Language Coach. I'm here to help you master **${targetLanguage}** from your native language **${nativeLanguage}**.\n\nYou can chat with me, ask me to translate phrases, explain grammar rules, or introduce new words.\n\nTry asking me: *'What are some common idioms in ${targetLanguage}?'* or click one of the quick actions below to start learning!`,
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
