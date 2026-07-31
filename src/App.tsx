import { useState, useEffect, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";

import { Word, WordSense, UserStats, LLMConfig, TTSConfig, LLMProvider, ChatMessage } from "./types";
import { DEFAULT_WORDS } from "./defaultWords";
import { calculateNewStreak } from "./utils";
import { switchActiveProvider } from "./utils/llmHelpers";
import { sendChatMessageService, autofillWordService, checkWordDefinitionsService, generateRandomWordsService, generateAiQuizQuestionsService, fixGrammarService } from "./services/llmClientService";
import { generateQuizQuestions } from "./utils/quizGenerator";
import { QuizQuestion } from "./types";
import { 
  getAllWordsFromDB, 
  saveAllWordsToDB, 
  saveWordToDB,
  deleteWordFromDB,
  getStatsFromDB, 
  saveStatsToDB, 
  getLLMConfigFromDB, 
  saveLLMConfigToDB,
  getTTSConfigFromDB,
  saveTTSConfigToDB
} from "./db/indexedDB";
import { DEFAULT_TTS_CONFIG, stopSpeech } from "./utils/ttsService";
import { recalculateWordsMemoryDecay, getDaysSinceLastReview, getQuizCandidateWords } from "./utils/spacedRepetition";
import { getCertificateTopics, getGeneralTopics } from "./config/topicSuggestions";

import ChatView from "./components/ChatView";
import FlashcardsView from "./components/FlashcardsView";
import QuizView from "./components/QuizView";
import CollectionManager from "./components/CollectionManager";
import SettingsView from "./components/SettingsView";
import AnalyticsDashboard from "./components/AnalyticsDashboard";
import LlmLoginModal from "./components/LlmLoginModal";

import AppHeader from "./components/layout/AppHeader";
import MobileSideDrawer from "./components/layout/MobileSideDrawer";

export default function App() {
  const [words, setWords] = useState<Word[]>([]);
  const [currentView, setCurrentView] = useState<"dashboard" | "learn" | "quiz" | "manage" | "analytics" | "settings">("dashboard");
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("");
  
  // LLM Provider Login Config state
  const [llmConfig, setLlmConfig] = useState<LLMConfig>({
    provider: "chatjimmy",
    model: "llama3.1-8B",
    apiKey: "",
    baseUrl: "https://chatjimmy.ai/api/chat",
    isLoggedIn: true
  });

  // TTS Config state
  const [ttsConfig, setTtsConfig] = useState<TTSConfig>(DEFAULT_TTS_CONFIG);

  const [isLlmModalOpen, setIsLlmModalOpen] = useState<boolean>(false);

  // Global Language Preferences
  const [targetLanguage, setTargetLanguage] = useState<string>(() => {
    return localStorage.getItem("vocab_learner_target_lang") || "English";
  });
  const [nativeLanguage, setNativeLanguage] = useState<string>(() => {
    return localStorage.getItem("vocab_learner_native_lang") || "Vietnamese";
  });
  const [appLanguage, setAppLanguage] = useState<string>(() => {
    const storedApp = localStorage.getItem("vocab_learner_app_lang");
    if (storedApp) return storedApp;
    // Default set to the user's native language
    return localStorage.getItem("vocab_learner_native_lang") || "Vietnamese";
  });

  const handleSelectLanguages = useCallback((targetLang: string, nativeLang: string, appLang?: string) => {
    setTargetLanguage(targetLang);
    setNativeLanguage(nativeLang);
    const newAppLang = appLang || nativeLang;
    setAppLanguage(newAppLang);
    try {
      localStorage.setItem("vocab_learner_target_lang", targetLang);
      localStorage.setItem("vocab_learner_native_lang", nativeLang);
      localStorage.setItem("vocab_learner_app_lang", newAppLang);
    } catch (e) {
      console.error("Failed to save language preferences to localStorage", e);
    }
  }, []);

  const [stats, setStats] = useState<UserStats>({
    totalWordsStudied: 0,
    totalWordsMastered: 0,
    totalQuizzesTaken: 0,
    totalCorrectAnswers: 0,
    streak: { count: 0, lastActiveDate: "", history: [] }
  });

  // Global Interaction Listener to stop TTS immediately on user inputs
  useEffect(() => {
    const handleInteraction = (e: Event) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' || 
        target.tagName === 'TEXTAREA' || 
        target.tagName === 'BUTTON' ||
        target.closest('button') ||
        target.closest('input')
      ) {
        stopSpeech();
      }
    };

    window.addEventListener('click', handleInteraction, true);
    window.addEventListener('keydown', handleInteraction, true);
    window.addEventListener('touchstart', handleInteraction, true);

    return () => {
      window.removeEventListener('click', handleInteraction, true);
      window.removeEventListener('keydown', handleInteraction, true);
      window.removeEventListener('touchstart', handleInteraction, true);
    };
  }, []);

  const [isDataLoaded, setIsDataLoaded] = useState(false);

  // Chat messaging states
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(() => {
    try {
      const stored = localStorage.getItem("vocab_learner_chat_history");
      if (stored) return JSON.parse(stored);
    } catch (e) {
      console.error(e);
    }
    return [
      {
        id: "welcome-msg",
        role: "assistant",
        content: `¡Hola! Welcome to your interactive AI Language Coach. I'm here to help you master **${targetLanguage}** from your native language **${nativeLanguage}**.\n\nYou can chat with me, ask me to translate phrases, explain grammar rules, or introduce new words.\n\nTry asking me: *'What are some common idioms in ${targetLanguage}?'* or click one of the quick actions below to start learning!`,
        timestamp: new Date().toISOString()
      }
    ];
  });

  const [isTyping, setIsTyping] = useState(false);

  // Conversational state for prompting word addition & grammar fixing
  const [conversationalState, setConversationalState] = useState<"none" | "adding_word" | "generating_topic_subject" | "generating_topic_count" | "fixing_grammar">("none");
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

  // Start the conversational in-chat quiz
  const startChatQuiz = async () => {
    setActiveQuiz(null);
    setConversationalState("none");
    setPendingWordSenses(null);
    setPendingTopicSubject("");

    if (words.length === 0) {
      const noWordsMsg: ChatMessage = {
        id: `quiz-no-words-${Date.now()}`,
        role: "assistant",
        content: `📝 **You don't have any words in your collection yet!**\n\nTo start a quiz, please add some words manually using the **+ Add Word** button or simply type a word in the chat and ask me to help you add it!`,
        timestamp: new Date().toISOString()
      };
      setChatMessages([noWordsMsg]);
      return;
    }

    const quizWords = getQuizCandidateWords(words, { maxCandidates: 5, cooldownHours: 12 });
    if (quizWords.length < 2) {
      const noCandidateMsg: ChatMessage = {
        id: `quiz-no-candidates-${Date.now()}`,
        role: "assistant",
        content: `🎉 **No words to practice today!**\n\nYou have already reviewed your eligible vocabulary items recently. There are no words due for practice right now.\n\nPlease come back later or add new words to your collection to keep practicing!`,
        timestamp: new Date().toISOString()
      };
      setChatMessages([noCandidateMsg]);
      return;
    }

    setIsTyping(true);

    try {
      const generatedQuestions = await generateAiQuizQuestionsService({
        words: quizWords,
        targetLanguage,
        nativeLanguage,
        llmConfig,
        stats
      });

      const firstQ = generatedQuestions[0];

      setActiveQuiz({
        questions: generatedQuestions,
        currentIndex: 0,
        score: 0,
        correctIds: [],
        incorrectIds: []
      });

      const introMsg: ChatMessage = {
        id: `quiz-start-${Date.now()}`,
        role: "assistant",
        content: `🎬 **Let's start today's interactive quiz!**\n\nI generated **${generatedQuestions.length}** questions adhering to target language rules and distractor logic.\n\n---\n\n### Question 1 of ${generatedQuestions.length}:\n**${firstQ.question}**`,
        timestamp: new Date().toISOString(),
        audioWord: firstQ.type === 'listening' ? firstQ.word : undefined,
        quizSpeechText: (firstQ.type === 'listening' || firstQ.type === 'spelling') ? firstQ.word : firstQ.question,
        imageUrl: firstQ.imageUrl,
        suggestedActions: firstQ.options?.map(opt => ({
          label: opt,
          action: "quiz_answer",
          payload: { answer: opt, wordId: firstQ.wordId }
        })) || [
          { label: firstQ.correctAnswer, action: "quiz_answer", payload: { answer: firstQ.correctAnswer, wordId: firstQ.wordId } }
        ]
      };

      setChatMessages([introMsg]);
    } catch (e) {
      console.error("Error starting chat quiz:", e);
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
      const targetWordObj = words.find(w => w.id === currentQ.wordId || w.word.toLowerCase() === currentQ.word.toLowerCase());

      const normalizedUser = userAnswer.toLowerCase().trim();
      const normalizedCorrect = currentQ.correctAnswer.toLowerCase().trim();
      
      // Determine if user's response is correct (supports exact match, letter match, or prefix match)
      let isCorrect = normalizedUser === normalizedCorrect || (targetWordObj && normalizedUser === targetWordObj.word.toLowerCase().trim());
      
      if (!isCorrect && currentQ.options && currentQ.options.length > 0) {
        const correctIdx = currentQ.options.findIndex(opt => opt.toLowerCase().trim() === normalizedCorrect);
        if (correctIdx !== -1) {
          const letters = ["a", "b", "c", "d", "e"];
          const correctLetter = letters[correctIdx];
          
          // Check if user answered with the letter (e.g., "a" or "a)") or if the answer starts with the letter/prefix (e.g. "a) hesitant")
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
        feedback = `🎉 **Correct!**\n\nThe answer to "${currentQ.question.split('\n')[0]}" is **"${currentQ.correctAnswer}"**.`;
        if (targetWordObj) {
          feedback += `\n\n*Word*: **${targetWordObj.word}** (${targetWordObj.partOfSpeech})\n*Pronunciation*: \`${targetWordObj.pronunciation || ''}\`\n*Translation*: "${targetWordObj.translation}"`;
        }
      } else {
        feedback = `❌ **Incorrect!**\n\nCorrect answer: **"${currentQ.correctAnswer}"** (your answer: "${userAnswer}").`;
        if (targetWordObj) {
          feedback += `\n\n*Word*: **${targetWordObj.word}** (${targetWordObj.partOfSpeech})\n*Pronunciation*: \`${targetWordObj.pronunciation || ''}\`\n*Translation*: "${targetWordObj.translation}"`;
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
          incorrectIds: newIncorrectIds
        });

        const nextMsg: ChatMessage = {
          id: `quiz-next-${Date.now()}`,
          role: "assistant",
          content: `${feedback}\n\n---\n\n### Question ${nextIndex + 1} of ${activeQuiz.questions.length}:\n**${nextQ.question}**`,
          timestamp: new Date().toISOString(),
          audioWord: nextQ.type === 'listening' ? nextQ.word : undefined,
          // Prioritize answer feedback first; otherwise autoplay jumps straight to the next question.
          quizSpeechText: isCorrect
            ? `Correct! The answer is ${currentQ.correctAnswer}`
            : `Incorrect! Correct answer: ${currentQ.correctAnswer}`,
          nextQuestionSpeechText: (nextQ.type === 'listening' || nextQ.type === 'spelling') ? nextQ.word : nextQ.question,
          imageUrl: nextQ.imageUrl,
          suggestedActions: nextQ.options?.map(opt => ({
            label: opt,
            action: "quiz_answer",
            payload: { answer: opt, wordId: nextQ.wordId }
          })) || [
            { label: nextQ.correctAnswer, action: "quiz_answer", payload: { answer: nextQ.correctAnswer, wordId: nextQ.wordId } }
          ]
        };

        setChatMessages(prev => [...prev, nextMsg]);
      } else {
        // End quiz session
        const totalQs = activeQuiz.questions.length;
        setActiveQuiz(null);

        handleFinishQuiz(newScore, totalQs, newCorrectIds, newIncorrectIds);

        const finishedMsg: ChatMessage = {
          id: `quiz-end-${Date.now()}`,
          role: "assistant",
          content: `${feedback}\n\n---\n\n🏆 **Quiz Completed!**\n\nYou scored **${newScore} out of ${totalQs}** (${Math.round((newScore / totalQs) * 100)}%).\n\nI have updated your statistics and adjusted word learning strength values! All set.\n\nWhat would you like to learn next?`,
          timestamp: new Date().toISOString(),
          suggestedActions: [
            { label: "Start Today's Quiz", action: "start_quiz" },
            { label: "Common Idioms & Phrases", action: "common_phrases" }
          ]
        };

        setChatMessages(prev => [...prev, finishedMsg]);
      }
      setIsTyping(false);
    }, 600);
  };

  // Side Panel state (Collection, Analytics, Settings)
  const [sidePanelTab, setSidePanelTab] = useState<"collection" | "analytics" | "settings">("collection");
  const [isSidePanelOpen, setIsSidePanelOpen] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem("vocab_learner_chat_history", JSON.stringify(chatMessages));
    } catch (e) {
      console.error(e);
    }
  }, [chatMessages, targetLanguage, nativeLanguage]);

  // Unified setter to map old page views to side panel operations
  const handleSetView = (view: "dashboard" | "learn" | "quiz" | "manage" | "analytics" | "settings") => {
    if (view === "manage") {
      setSidePanelTab("collection");
      setIsSidePanelOpen(true);
    } else if (view === "analytics") {
      setSidePanelTab("analytics");
      setIsSidePanelOpen(true);
    } else if (view === "settings") {
      setSidePanelTab("settings");
      setIsSidePanelOpen(true);
    } else {
      setCurrentView(view);
    }
  };

  // Send message to AI Tutor
  const handleSendChatMessage = async (text: string) => {
    if (!text.trim()) return;

    const newUserMessage: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: "user",
      content: text,
      timestamp: new Date().toISOString()
    };

    setChatMessages(prev => [...prev, newUserMessage]);

    if (activeQuiz) {
      handleQuizAnswer(text.trim());
      return;
    }

    if (conversationalState === "adding_word") {
      setConversationalState("none");
      await handleConversationalAddWord(text.trim());
      return;
    }

    if (conversationalState === "generating_topic_subject") {
      const topic = text.trim();
      setPendingTopicSubject(topic);
      setConversationalState("generating_topic_count");
      const countMsg: ChatMessage = {
        id: `gen-count-prompt-${Date.now()}`,
        role: "assistant",
        content: `🔢 **How many vocabulary words would you like to generate for "${topic}"?**\n\nPlease select or type a number below (default is 5):`,
        timestamp: new Date().toISOString(),
        suggestedActions: [
          { label: "Generate 5 words", action: "send_message", payload: { message: "5" } },
          { label: "Generate 10 words", action: "send_message", payload: { message: "10" } },
          { label: "Generate 15 words", action: "send_message", payload: { message: "15" } }
        ]
      };
      setChatMessages(prev => [...prev, countMsg]);
      return;
    }

    if (conversationalState === "generating_topic_count") {
      setConversationalState("none");
      const count = parseInt(text.trim(), 10) || 5;
      await handleConversationalGenerateWords(pendingTopicSubject, count);
      return;
    }

    if (conversationalState === "fixing_grammar") {
      setConversationalState("none");
      await handleConversationalFixGrammar(text.trim());
      return;
    }

    setIsTyping(true);

    try {
      const payloadMessages = [...chatMessages, newUserMessage].map(m => ({
        role: m.role,
        content: m.content
      }));

      const result = await sendChatMessageService({
        messages: payloadMessages,
        targetLanguage,
        nativeLanguage,
        llmConfig
      });

      const newAssistantMessage: ChatMessage = {
        id: `msg-${Date.now() + 1}`,
        role: "assistant",
        content: result.text || "I was unable to formulate a response.",
        timestamp: new Date().toISOString(),
        suggestedActions: result.suggestedActions || []
      };

      setChatMessages(prev => [...prev, newAssistantMessage]);
    } catch (err: any) {
      console.error("Chat error:", err);
      setChatMessages(prev => [
        ...prev,
        {
          id: `msg-err-${Date.now()}`,
          role: "assistant",
          content: `⚠️ **Oops, I hit a snag communicating with the AI!**\n\n*Error details:* ${err.message || "Failed to reach LLM provider"}.\n\nPlease check your internet connection or verify your API key settings in the Settings side panel.`,
          timestamp: new Date().toISOString()
        }
      ]);
    } finally {
      setIsTyping(false);
    }
  };

  // Add individual word directly from chat suggestions (or conversational input)
  const handleConversationalAddWord = async (wordText: string, hint?: string) => {
    const normalizedWordText = wordText.trim().toLowerCase();
    const existingMatch = words.find(w => w.word.trim().toLowerCase() === normalizedWordText);
    if (existingMatch) {
      setChatMessages(prev => [
        ...prev,
        {
          id: `sys-exists-${Date.now()}`,
          role: "assistant",
          content: `ℹ️ **"${existingMatch.word}" is already in your vocabulary collection!**\n\n- **Translation**: ${existingMatch.translation}\n- **Definition**: *${existingMatch.definition}*\n\nSkipped adding duplicate entry.`,
          timestamp: new Date().toISOString()
        }
      ]);
      return;
    }

    setIsTyping(true);
    const statusMsgId = `add-word-status-${Date.now()}`;
    const contextHintStr = hint ? ` with context *"${hint}"*` : "";

    setChatMessages(prev => [
      ...prev,
      {
        id: statusMsgId,
        role: "assistant",
        content: `🔍 *Consulting dictionary, translating, and generating definition for **"${wordText}"**${contextHintStr}...*`,
        timestamp: new Date().toISOString()
      }
    ]);

    try {
      // Check if word has multiple distinct meanings or generate exact definition with context hint
      const data = await checkWordDefinitionsService({
        word: wordText,
        hint: hint,
        targetLanguage,
        nativeLanguage,
        llmConfig
      });

      // Filter valid senses that contain a definition or translation
      const validSenses = (data.senses || []).filter((s: any) => s && (s.definition || s.translation));

      // IF NO DEFINITION FOUND OR GENERATED -> DO NOT ADD TO DB
      if (data.notFound || validSenses.length === 0) {
        setChatMessages(prev => {
          const filtered = prev.filter(m => m.id !== statusMsgId);
          return [
            ...filtered,
            {
              id: `sys-not-found-${Date.now()}`,
              role: "assistant",
              content: `⚠️ **No valid definition found for "${wordText}"**${hint ? ` with context *"${hint}"*` : ""}.\n\nThis entry was **not** added to your collection.`,
              timestamp: new Date().toISOString()
            }
          ];
        });
        return;
      }

      if (data.hasMultipleSenses && validSenses.length > 1) {
        setPendingWordSenses({
          word: wordText,
          senses: validSenses
        });

        const actions = validSenses.map((sense: any, idx: number) => {
          const partOfSpeech = sense.partOfSpeech || "word";
          const translation = sense.translation && sense.translation !== "undefined" ? sense.translation : "";
          const translationPart = translation ? `${translation}: ` : "";
          const shortDef = sense.definition 
            ? (sense.definition.slice(0, 45) + (sense.definition.length > 45 ? "..." : ""))
            : "";
          return {
            label: `[${partOfSpeech}] ${translationPart}${shortDef}`,
            action: "select_definition",
            payload: { 
              word: wordText, 
              senseIndex: idx, 
              translation: translation || data.translation || wordText 
            }
          };
        });

        setChatMessages(prev => {
          const filtered = prev.filter(m => m.id !== statusMsgId);
          return [
            ...filtered,
            {
              id: `sense-disambig-${Date.now()}`,
              role: "assistant",
              content: `🤔 **"${wordText}"** has several common meanings in **${targetLanguage}**. Which definition would you like to add?`,
              timestamp: new Date().toISOString(),
              suggestedActions: actions
            }
          ];
        });
      } else {
        // Only 1 definition found (exact definition matching context hint)
        const sense = validSenses[0];
        
        const pronunciationVal = sense?.pronunciation || data.pronunciation || "/.../";
        const partOfSpeechVal = sense?.partOfSpeech || data.partOfSpeech || "expression";
        const definitionVal = sense?.definition || data.definition;
        const translationVal = sense?.translation || data.translation;
        const exampleVal = sense?.example || data.example || undefined;
        const exampleTranslationVal = sense?.exampleTranslation || data.exampleTranslation || undefined;

        if (!definitionVal || !translationVal) {
          setChatMessages(prev => {
            const filtered = prev.filter(m => m.id !== statusMsgId);
            return [
              ...filtered,
              {
                id: `sys-not-found-${Date.now()}`,
                role: "assistant",
                content: `⚠️ **No valid definition found for "${wordText}"**${hint ? ` with context *"${hint}"*` : ""}.\n\nThis entry was **not** added to your collection.`,
                timestamp: new Date().toISOString()
              }
            ];
          });
          return;
        }

        const categoryVal = sense?.category || data.category || "General";
        const contextVal = sense?.context || data.context || hint || definitionVal;
        const targetWordStr = data.word || wordText;

        const finalMatch = words.find(w => w.word.trim().toLowerCase() === targetWordStr.trim().toLowerCase());
        if (finalMatch) {
          setChatMessages(prev => {
            const filtered = prev.filter(m => m.id !== statusMsgId);
            return [
              ...filtered,
              {
                id: `sys-exists-${Date.now()}`,
                role: "assistant",
                content: `ℹ️ **"${finalMatch.word}" is already in your vocabulary collection!**\n\nSkipped adding duplicate entry.`,
                timestamp: new Date().toISOString()
              }
            ];
          });
          return;
        }

        const newWord: Word = {
          id: `ai-word-${Date.now()}`,
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
          strength: 0
        };

        setWords(prev => {
          if (prev.some(w => w.word.trim().toLowerCase() === newWord.word.trim().toLowerCase())) {
            return prev;
          }
          const updated = [newWord, ...prev];
          saveAllWordsToDB(updated).catch(e => console.error(e));
          return updated;
        });

        setChatMessages(prev => {
          const filtered = prev.filter(m => m.id !== statusMsgId);
          return [
            ...filtered,
            {
              id: `sys-add-${Date.now()}`,
              role: "assistant",
              content: `🎉 **Successfully added "${newWord.word}" to your collection!**\n\n- **Translation**: ${newWord.translation}\n- **Pronunciation**: \`${newWord.pronunciation}\`\n- **Definition**: *${newWord.definition}*${newWord.example ? `\n- **Example**: "${newWord.example}"` : ""}${newWord.exampleTranslation ? `\n- **Example Translation**: "${newWord.exampleTranslation}"` : ""}\n\nI generated the exact definition for this word context and saved it to your database collection!`,
              timestamp: new Date().toISOString()
            }
          ];
        });
      }
    } catch (err: any) {
      console.error(err);
      setChatMessages(prev => {
        const filtered = prev.filter(m => m.id !== statusMsgId);
        return [
          ...filtered,
          {
            id: `sys-add-err-${Date.now()}`,
            role: "assistant",
            content: `⚠️ **Failed to add word:** ${err.message || "Unknown error"}. Nothing was added to your database collection.`,
            timestamp: new Date().toISOString()
          }
        ];
      });
    } finally {
      setIsTyping(false);
    }
  };

  // Handle selected definition sense for a multi-definition word
  const handleSelectDefinition = async (word: string, senseIndex: number, translation: string) => {
    if (!pendingWordSenses || pendingWordSenses.word !== word) return;
    
    const sense = pendingWordSenses.senses[senseIndex];
    if (!sense) return;

    const existingMatch = words.find(w => w.word.trim().toLowerCase() === word.trim().toLowerCase());
    if (existingMatch) {
      setChatMessages(prev => [
        ...prev,
        {
          id: `sys-exists-${Date.now()}`,
          role: "assistant",
          content: `ℹ️ **"${existingMatch.word}" is already in your vocabulary collection!**\n\nSkipped adding duplicate entry.`,
          timestamp: new Date().toISOString()
        }
      ]);
      setPendingWordSenses(null);
      return;
    }

    setIsTyping(true);
    const statusMsgId = `add-word-selected-status-${Date.now()}`;
    
    // Add user selection message to chat
    const finalTranslation = translation && translation !== "undefined" ? translation : (sense.translation && sense.translation !== "undefined" ? sense.translation : word);
    const partOfSpeech = sense.partOfSpeech || "word";
    const newUserMsg: ChatMessage = {
      id: `user-select-def-${Date.now()}`,
      role: "user",
      content: `I want to add the definition: "${finalTranslation}" (${partOfSpeech})`,
      timestamp: new Date().toISOString()
    };

    setChatMessages(prev => [
      ...prev,
      newUserMsg,
      {
        id: statusMsgId,
        role: "assistant",
        content: `🔍 *Generating a custom card for **"${word}"** specifying this meaning...*`,
        timestamp: new Date().toISOString()
      }
    ]);

    try {
      const newWord: Word = {
        id: `ai-word-${Date.now()}`,
        word: word,
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
        strength: 0
      };

      setWords(prev => {
        const updated = [newWord, ...prev];
        saveAllWordsToDB(updated).catch(e => console.error(e));
        return updated;
      });

      setChatMessages(prev => {
        const filtered = prev.filter(m => m.id !== statusMsgId);
        return [
          ...filtered,
          {
            id: `sys-add-${Date.now()}`,
            role: "assistant",
            content: `🎉 **Successfully added "${newWord.word}" to your collection!**\n\n- **Translation**: ${newWord.translation}\n- **Pronunciation**: \`${newWord.pronunciation}\`\n- **Definition**: *${newWord.definition}*\n- **Example**: "${newWord.example || ""}"\n- **Example Translation**: "${newWord.exampleTranslation || ""}"\n\nI've designed a custom visual card and added it to your collection! You can study it anytime in the **My Words** panel on the right.`,
            timestamp: new Date().toISOString()
          }
        ];
      });

      setPendingWordSenses(null);
    } catch (err: any) {
      console.error(err);
      setChatMessages(prev => {
        const filtered = prev.filter(m => m.id !== statusMsgId);
        return [
          ...filtered,
          {
            id: `sys-add-err-${Date.now()}`,
            role: "assistant",
            content: `⚠️ **Failed to add word sense:** ${err.message || "Unknown error"}. Please check your settings and try again.`,
            timestamp: new Date().toISOString()
          }
        ];
      });
    } finally {
      setIsTyping(false);
    }
  };

  // Unified conversational word addition or direct addition
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
        timestamp: new Date().toISOString()
      };
      setChatMessages([addWordMsg]);
    }
  };

  // Trigger topic based vocabulary generation from Chat Quick Actions
  const handleConversationalGenerateWordsPrompt = () => {
    setActiveQuiz(null);
    setPendingWordSenses(null);
    setConversationalState("generating_topic_subject");

    const certTopics = getCertificateTopics(targetLanguage);
    const genTopics = getGeneralTopics();

    const certList = certTopics.map(t => `- **${t.name}** (${t.badge}): ${t.description}`).join("\n");
    const genList = genTopics.map(t => `- **${t.name}**: ${t.description}`).join("\n");

    const promptMsg: ChatMessage = {
      id: `gen-topic-prompt-${Date.now()}`,
      role: "assistant",
      content: `🎨 **Generate Vocabulary by Topic/Subject**\n\nChoose a topic below or **type any custom topic** you want to study!\n\n🏆 **Popular ${targetLanguage} Exam / Certificate Topics:**\n${certList}\n\n💡 **General Topics:**\n${genList}\n\n👇 *Select a topic below or type your own topic in the chat!*`,
      timestamp: new Date().toISOString(),
      suggestedActions: [
        ...certTopics.map(t => ({
          label: `🏆 ${t.name}`,
          action: "send_message",
          payload: { message: t.name }
        })),
        ...genTopics.map(t => ({
          label: `🎨 ${t.name}`,
          action: "send_message",
          payload: { message: t.name }
        }))
      ]
    };
    setChatMessages([promptMsg]);
  };

  const handleConversationalGenerateWords = async (topic: string, count: number) => {
    setIsTyping(true);
    const statusMsgId = `gen-words-status-${Date.now()}`;
    setChatMessages(prev => [
      ...prev,
      {
        id: statusMsgId,
        role: "assistant",
        content: `🔍 *Generating ${count} new, unique vocabulary words in **${targetLanguage}** about **"${topic}"**...*`,
        timestamp: new Date().toISOString()
      }
    ]);

    try {
      const existingWordSet = new Set(words.map(w => w.word.trim().toLowerCase()));
      const res = await generateRandomWordsService({
        topic: topic,
        targetLanguage,
        nativeLanguage,
        count: count + 5, // Ask for extra to ensure unique after filtering
        existingWords: Array.from(existingWordSet),
        llmConfig
      });

      const generatedList = res.words || [];
      const newUniqueWords = generatedList
        .filter((item: any) => item?.word && !existingWordSet.has(item.word.trim().toLowerCase()))
        .slice(0, count);

      if (newUniqueWords.length === 0) {
        setChatMessages(prev => {
          const filtered = prev.filter(m => m.id !== statusMsgId);
          return [
            ...filtered,
            {
              id: `gen-words-empty-${Date.now()}`,
              role: "assistant",
              content: `⚠️ I tried to generate vocabulary words for **"${topic}"**, but I didn't find any new words that aren't already in your collection. Try a different topic or clear some existing words!`,
              timestamp: new Date().toISOString()
            }
          ];
        });
        return;
      }

      // Add to vocabulary list
      const addedWords: Word[] = [];
      newUniqueWords.forEach((item: any, idx: number) => {
        const newWord: Word = {
          id: `ai-word-${Date.now()}-${idx}`,
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
          strength: 0
        };
        addedWords.push(newWord);
      });

      setWords(prev => {
        const updated = [...addedWords, ...prev];
        saveAllWordsToDB(updated).catch(e => console.error("IndexedDB save generated words error:", e));
        return updated;
      });

      // Format response listing the generated words
      const wordsListMarkdown = addedWords
        .map((w, idx) => `${idx + 1}. **${w.word}** (${w.partOfSpeech}) - *${w.translation}*\n   *Def:* ${w.definition}${w.example ? `\n   *Ex:* "${w.example}" (${w.exampleTranslation})` : ""}`)
        .join("\n\n");

      setChatMessages(prev => {
        const filtered = prev.filter(m => m.id !== statusMsgId);
        return [
          ...filtered,
          {
            id: `gen-words-success-${Date.now()}`,
            role: "assistant",
            content: `✨ **Successfully generated and added ${addedWords.length} words on the topic "${topic}" to your collection!**\n\n${wordsListMarkdown}`,
            timestamp: new Date().toISOString(),
            suggestedActions: [
              { label: "Start Quiz", action: "start_quiz" }
            ]
          }
        ];
      });
    } catch (err: any) {
      console.error("Failed to generate words from topic:", err);
      setChatMessages(prev => {
        const filtered = prev.filter(m => m.id !== statusMsgId);
        return [
          ...filtered,
          {
            id: `gen-words-fail-${Date.now()}`,
            role: "assistant",
            content: `❌ **Unable to generate words for "${topic}".**\n\n*Error details:* ${err.message || "Please verify your AI connection or API key in Settings."}`,
            timestamp: new Date().toISOString()
          }
        ];
      });
    } finally {
      setIsTyping(false);
    }
  };

  // Trigger Fix Grammar & Polish flow from Chat Quick Actions
  const handlePromptFixGrammar = () => {
    setActiveQuiz(null);
    setPendingWordSenses(null);
    setConversationalState("fixing_grammar");
    const promptMsg: ChatMessage = {
      id: `fix-grammar-prompt-${Date.now()}`,
      role: "assistant",
      content: `✍️ **Fix Grammar & Polish Sentence**\n\nEnter or paste any sentence below in **${targetLanguage}** (or **${nativeLanguage}**).\n\nI will fix grammar & spelling, improve clarity and readability, suggest natural word choices, and identify candidate vocabulary to add to your collection!`,
      timestamp: new Date().toISOString()
    };
    setChatMessages([promptMsg]);
  };

  const handleConversationalFixGrammar = async (userText: string) => {
    setIsTyping(true);
    const statusMsgId = `fix-grammar-status-${Date.now()}`;
    setChatMessages(prev => [
      ...prev,
      {
        id: statusMsgId,
        role: "assistant",
        content: `✍️ *Analyzing sentence, fixing grammar, and identifying candidate vocabulary...*`,
        timestamp: new Date().toISOString()
      }
    ]);

    try {
      const res = await fixGrammarService({
        userText,
        targetLanguage,
        nativeLanguage,
        llmConfig
      });

      const fixedSentence = res.fixedSentence || userText;
      const explanation = res.explanation || "";
      const candidates = res.vocabularyCandidates || [];

      // Construct suggested actions
      const actions: any[] = [];

      // 1. Copy fixed sentence to clipboard
      actions.push({
        label: "📋 Copy Fixed Sentence",
        action: "copy_text",
        payload: { text: fixedSentence }
      });

      // 2. Add vocabulary candidate words to collection
      if (candidates && candidates.length > 0) {
        candidates.forEach(cand => {
          if (cand.word) {
            actions.push({
              label: `➕ Add "${cand.word}" to collection (${cand.reason || "Candidate vocabulary"})`,
              action: "add_word",
              payload: { word: cand.word, hint: cand.reason }
            });
          }
        });
      }

      // 3. Fix another sentence
      actions.push({
        label: "✍️ Fix Another Sentence",
        action: "fix_another"
      });

      let contentMarkdown = `### ✨ Polished Sentence:\n> **"${fixedSentence}"**\n\n`;
      if (explanation) {
        contentMarkdown += `${explanation}\n\n`;
      }

      if (candidates && candidates.length > 0) {
        contentMarkdown += `---\n### 📚 Recommended Vocabulary Candidates:\n`;
        candidates.forEach(c => {
          contentMarkdown += `- **${c.word}**: *${c.reason}*\n`;
        });
      }

      setChatMessages(prev => {
        const filtered = prev.filter(m => m.id !== statusMsgId);
        return [
          ...filtered,
          {
            id: `sys-grammar-res-${Date.now()}`,
            role: "assistant",
            content: contentMarkdown.trim(),
            timestamp: new Date().toISOString(),
            fixedSentence: fixedSentence,
            suggestedActions: actions
          }
        ];
      });
    } catch (err: any) {
      console.error("Fix Grammar Error:", err);
      setChatMessages(prev => {
        const filtered = prev.filter(m => m.id !== statusMsgId);
        return [
          ...filtered,
          {
            id: `sys-grammar-err-${Date.now()}`,
            role: "assistant",
            content: `⚠️ **Failed to analyze sentence:** ${err.message || "Unknown error"}. Please check your AI configuration in Settings.`,
            timestamp: new Date().toISOString()
          }
        ];
      });
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
        timestamp: new Date().toISOString()
      }
    ];
    setChatMessages(initialWelcome);
    localStorage.removeItem("vocab_learner_chat_history");
  };

  // Initialize and load from IndexedDB on mount
  const reloadAllDataFromDB = async () => {
    try {
      const loadedWords = await getAllWordsFromDB();
      
      // Recalculate word strength based on spaced repetition memory decay (e.g. max strength words not reviewed in days)
      const { updatedWords, decayedCount } = recalculateWordsMemoryDecay(loadedWords);
      setWords(updatedWords);
      if (decayedCount > 0) {
        saveAllWordsToDB(updatedWords).catch(e => console.error("IndexedDB memory decay save error:", e));
      }

      const loadedStats = await getStatsFromDB({
        totalWordsStudied: 0,
        totalWordsMastered: 0,
        totalQuizzesTaken: 0,
        totalCorrectAnswers: 0,
        streak: { count: 0, lastActiveDate: "", history: [] }
      });
      setStats(loadedStats);

      const loadedConfig = await getLLMConfigFromDB({
        provider: "chatjimmy",
        model: "llama3.1-8B",
        apiKey: "",
        baseUrl: "https://chatjimmy.ai/api/chat",
        isLoggedIn: true
      });

      const sanitizedProvider = loadedConfig.provider || "chatjimmy";
      let sanitizedModel = loadedConfig.model || (sanitizedProvider === "chatjimmy" ? "llama3.1-8B" : sanitizedProvider === "ollama" ? "gemma4:31b" : "gemini-3.6-flash");
      const validGeminiModels = [
        "gemini-3.6-flash",
        "gemini-3.6-flash-lite",
        "gemini-3.5-flash",
        "gemini-3.5-flash-lite",
        "gemini-2.5-flash",
        "gemini-2.5-pro",
        "gemini-2.5-flash-lite",
        "gemini-2.0-flash",
        "gemini-1.5-flash"
      ];
      if (sanitizedProvider === "gemini" && (sanitizedModel === "gemini-2.5-flash" || !validGeminiModels.includes(sanitizedModel))) {
        sanitizedModel = "gemini-3.6-flash";
      }

      const activeConfig: LLMConfig = {
        ...loadedConfig,
        provider: sanitizedProvider as any,
        model: sanitizedModel,
        isLoggedIn: loadedConfig.isLoggedIn || sanitizedProvider === "gemini" || sanitizedProvider === "chatjimmy" || sanitizedProvider === "ollama"
      };

      setLlmConfig(activeConfig);
      await saveLLMConfigToDB(activeConfig);

      if (!activeConfig.isLoggedIn && activeConfig.provider !== "gemini" && activeConfig.provider !== "chatjimmy" && activeConfig.provider !== "ollama") {
        setIsLlmModalOpen(true);
      }

      const loadedTTS = await getTTSConfigFromDB(DEFAULT_TTS_CONFIG);
      setTtsConfig(loadedTTS);
    } catch (e) {
      console.error("IndexedDB load error:", e);
      setWords(DEFAULT_WORDS);
    } finally {
      setIsDataLoaded(true);
    }
  };

  useEffect(() => {
    reloadAllDataFromDB();
  }, []);

  useEffect(() => {
    if (isDataLoaded && (!llmConfig.isLoggedIn || !llmConfig.provider)) {
      setIsLlmModalOpen(true);
    }
  }, [llmConfig.isLoggedIn, llmConfig.provider, isDataLoaded]);

  const handleSaveTTSConfig = (newConfig: TTSConfig) => {
    setTtsConfig(newConfig);
    saveTTSConfigToDB(newConfig).catch(e => console.error("IndexedDB TTS save error:", e));
  };

  // Save words to IndexedDB when changed
  const saveWordsToStorage = useCallback((updatedWords: Word[]) => {
    setWords(updatedWords);
    saveAllWordsToDB(updatedWords).catch(e => console.error("IndexedDB word save error:", e));
  }, []);

  // Word interactions (starred state)
  const handleToggleStar = useCallback((wordId: string) => {
    setWords(prevWords => {
      const updatedWords = prevWords.map(w => {
        if (w.id === wordId) {
          const updated = { ...w, starred: !w.starred };
          saveWordToDB(updated).catch(e => console.error("IndexedDB star save error:", e));
          return updated;
        }
        return w;
      });
      return updatedWords;
    });
  }, []);

  // Word mastery interaction
  const handleToggleLearned = useCallback((wordId: string) => {
    let updatedWordsList: Word[] = [];
    setWords(prevWords => {
      updatedWordsList = prevWords.map(w => {
        if (w.id === wordId) {
          const isNowMastered = !w.learned;
          const updated = {
            ...w,
            learned: isNowMastered,
            lastReviewed: new Date().toISOString(),
            strength: isNowMastered ? 4 : 0
          };
          saveWordToDB(updated).catch(e => console.error("IndexedDB learned save error:", e));
          return updated;
        }
        return w;
      });
      return updatedWordsList;
    });

    setStats(prevStats => {
      const updatedStreak = calculateNewStreak(prevStats.streak);
      const totalMasteredCount = updatedWordsList.filter(w => w.learned).length;
      const totalStudiedCount = updatedWordsList.filter(w => w.lastReviewed !== null).length;
      const newStats = {
        ...prevStats,
        totalWordsMastered: totalMasteredCount,
        totalWordsStudied: totalStudiedCount,
        streak: updatedStreak
      };
      saveStatsToDB(newStats).catch(e => console.error("IndexedDB stats save error:", e));
      return newStats;
    });
  }, []);

  // Open LLM Modal with optional target provider
  const handleOpenLlmModal = (initialProvider?: LLMProvider) => {
    if (initialProvider && initialProvider !== llmConfig.provider) {
      const switched = switchActiveProvider(llmConfig, initialProvider);
      setLlmConfig(switched);
      saveLLMConfigToDB(switched).catch(e => console.error("IndexedDB config save error:", e));
      try {
        localStorage.setItem("vocab_learner_llm_config", JSON.stringify(switched));
      } catch (e) {
        console.error("Failed to save LLM config to localStorage", e);
      }
    }
    setIsLlmModalOpen(true);
  };

  // Quick switch active LLM provider or model
  const handleSwitchProviderQuick = useCallback((providerId: LLMProvider, modelOverride?: string) => {
    let switched = switchActiveProvider(llmConfig, providerId);
    if (modelOverride) {
      switched = { ...switched, model: modelOverride };
    }
    setLlmConfig(switched);
    saveLLMConfigToDB(switched).catch(e => console.error("IndexedDB config save error:", e));
    try {
      localStorage.setItem("vocab_learner_llm_config", JSON.stringify(switched));
    } catch (e) {
      console.error("Failed to save LLM config to localStorage", e);
    }
  }, [llmConfig]);

  // Save LLM Config
  const handleSaveLlmConfig = (newConfig: LLMConfig) => {
    setLlmConfig(newConfig);
    saveLLMConfigToDB(newConfig).catch(e => console.error("IndexedDB config save error:", e));
    try {
      localStorage.setItem("vocab_learner_llm_config", JSON.stringify(newConfig));
    } catch (e) {
      console.error("Failed to save LLM config to localStorage", e);
    }
    setIsLlmModalOpen(false);
  };

  // Save Onboarding (Languages + LLM Config)
  const handleSaveOnboarding = (
    userData: { email: string; nativeLanguage: string; targetLanguage: string },
    newConfig: LLMConfig
  ) => {
    setLlmConfig(newConfig);
    saveLLMConfigToDB(newConfig).catch(e => console.error("IndexedDB config save error:", e));
    try {
      localStorage.setItem("vocab_learner_llm_config", JSON.stringify(newConfig));
      if (userData.email) {
        localStorage.setItem("vocab_learner_user_email", userData.email);
      }
      if (userData.nativeLanguage) {
        localStorage.setItem("vocab_learner_native_lang", userData.nativeLanguage);
      }
      if (userData.targetLanguage) {
        localStorage.setItem("vocab_learner_target_lang", userData.targetLanguage);
      }
    } catch (e) {
      console.error("Failed to save onboarding settings to localStorage", e);
    }

    if (userData.targetLanguage && userData.nativeLanguage) {
      setTargetLanguage(userData.targetLanguage);
      setNativeLanguage(userData.nativeLanguage);
    }

    setIsLlmModalOpen(false);
  };

  // Add custom manual word
  const handleAddCustomWord = useCallback((
    wordData: Omit<Word, "id" | "learned" | "strength" | "createdAt" | "lastReviewed"> & {
      createdAt?: string;
      lastReviewed?: string | null;
    }
  ) => {
    const normalizedTarget = wordData.word.trim().toLowerCase();
    setWords(prev => {
      const exists = prev.some(w => w.word.trim().toLowerCase() === normalizedTarget);
      if (exists) {
        console.warn(`Word "${wordData.word}" already exists in collection. Skipping duplicate.`);
        return prev;
      }
      const newWord: Word = {
        ...wordData,
        id: `manual-word-${Date.now()}`,
        learned: false,
        starred: wordData.starred || false,
        createdAt: new Date().toISOString(),
        lastReviewed: null,
        strength: 0
      };
      const updated = [newWord, ...prev];
      saveAllWordsToDB(updated).catch(e => console.error("IndexedDB add word save error:", e));
      return updated;
    });
  }, []);

  // Delete individual word
  const handleDeleteWord = useCallback((wordId: string) => {
    const targetWord = words.find(w => w.id === wordId);
    setWords(prev => prev.filter(w => w.id !== wordId));
    deleteWordFromDB(wordId, targetWord?.word).catch(e => console.error("IndexedDB delete word save error:", e));
  }, [words]);

  // Update words list
  const handleUpdateWords = useCallback((updatedWords: Word[]) => {
    setWords(updatedWords);
    saveAllWordsToDB(updatedWords).catch(e => console.error("IndexedDB update words error:", e));
  }, []);

  // Memoize Today's Practice words (applying recency cooldown to avoid repeating recently quizzed words)
  const todayPracticeWords = useMemo((): Word[] => {
    return getQuizCandidateWords(words, { maxCandidates: 10, cooldownHours: 12 });
  }, [words]);

  // Quiz completion handler
  const handleFinishQuiz = useCallback((
    score: number, 
    total: number, 
    correctWordIds?: string[], 
    incorrectWordIds?: string[]
  ) => {
    let updatedWordsList: Word[] = [];
    setWords(prevWords => {
      let updatedWords = [...prevWords];
      if (correctWordIds || incorrectWordIds) {
        updatedWords = updatedWords.map(word => {
          const originalId = word.id;
          const virtualId = `today-${word.id}`;
          
          if (correctWordIds?.includes(originalId) || correctWordIds?.includes(virtualId)) {
            const newStrength = Math.min(4, word.strength + 1);
            return {
              ...word,
              strength: newStrength,
              learned: newStrength >= 3 ? true : word.learned,
              lastReviewed: new Date().toISOString()
            };
          }
          if (incorrectWordIds?.includes(originalId) || incorrectWordIds?.includes(virtualId)) {
            const newStrength = Math.max(0, word.strength - 1);
            return {
              ...word,
              strength: newStrength,
              lastReviewed: new Date().toISOString()
            };
          }
          return word;
        });
        saveAllWordsToDB(updatedWords).catch(e => console.error("IndexedDB quiz words save error:", e));
      }
      updatedWordsList = updatedWords;
      return updatedWords;
    });

    setStats(prevStats => {
      const updatedStreak = calculateNewStreak(prevStats.streak);
      const totalMasteredCount = updatedWordsList.filter(w => w.learned).length;
      const totalStudiedCount = updatedWordsList.filter(w => w.lastReviewed !== null).length;

      const newStats = {
        ...prevStats,
        totalQuizzesTaken: prevStats.totalQuizzesTaken + 1,
        totalCorrectAnswers: prevStats.totalCorrectAnswers + score,
        totalWordsMastered: totalMasteredCount > 0 ? totalMasteredCount : prevStats.totalWordsMastered,
        totalWordsStudied: totalStudiedCount > 0 ? totalStudiedCount : prevStats.totalWordsStudied,
        streak: updatedStreak
      };
      saveStatsToDB(newStats).catch(e => console.error("IndexedDB stats save error:", e));
      return newStats;
    });
  }, []);

  const renderSidePanelContent = () => {
    return (
      <div className="flex flex-col h-full overflow-hidden" id="side-panel-wrapper">
        {/* Scrollable View Content */}
        <div className="flex-1 overflow-y-auto p-2.5 sm:p-4" id="side-panel-content-body">
          {sidePanelTab === "collection" && (
            <CollectionManager 
              words={words}
              llmConfig={llmConfig}
              ttsConfig={ttsConfig}
              onAddWord={handleAddCustomWord}
              onDeleteWord={handleDeleteWord}
              onToggleStar={handleToggleStar}
              onToggleLearned={handleToggleLearned}
              onUpdateWords={handleUpdateWords}
              targetLanguage={targetLanguage}
              nativeLanguage={nativeLanguage}
            />
          )}

          {sidePanelTab === "analytics" && (
            <AnalyticsDashboard 
              words={words}
              stats={stats}
              llmConfig={llmConfig}
              ttsConfig={ttsConfig}
              onStartPracticeWeakWords={(weakWords) => {
                setCurrentView("quiz");
              }}
              onToggleLearnedWord={(wordId) => handleToggleLearned(wordId)}
              onToggleStarWord={(wordId) => handleToggleStar(wordId)}
              onNavigateToView={(view) => handleSetView(view)}
            />
          )}

          {sidePanelTab === "settings" && (
            <SettingsView 
              ttsConfig={ttsConfig}
              llmConfig={llmConfig}
              onSaveTTSConfig={handleSaveTTSConfig}
              onSaveLLMConfig={handleSaveLlmConfig}
              onOpenLlmModal={handleOpenLlmModal}
              onReloadData={reloadAllDataFromDB}
              targetLanguage={targetLanguage}
              nativeLanguage={nativeLanguage}
              appLanguage={appLanguage}
              onSelectLanguages={handleSelectLanguages}
            />
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="h-dvh w-full bg-stone-50/40 text-stone-900 flex flex-col antialiased border-0 overflow-hidden">
      
      {/* Visual Top Header */}
      <AppHeader
        currentView={currentView}
        setCurrentView={handleSetView}
        setIsLlmModalOpen={setIsLlmModalOpen}
        llmConfig={llmConfig}
        stats={stats}
        onSwitchProvider={handleSwitchProviderQuick}
        onOpenLlmModal={handleOpenLlmModal}
        targetLanguage={targetLanguage}
        nativeLanguage={nativeLanguage}
        appLanguage={appLanguage}
        onSelectLanguages={handleSelectLanguages}
        onReloadData={reloadAllDataFromDB}
        sidePanelTab={sidePanelTab}
        isSidePanelOpen={isSidePanelOpen}
      />

      {/* Main Viewport Container */}
      <main className="flex-1 min-h-0 w-full max-w-7xl mx-auto p-2 sm:p-4 md:p-5 flex flex-col overflow-hidden">
        <div className="flex flex-col flex-1 min-h-0 h-full overflow-hidden">
          
          {/* Main workspace section */}
          <div className="flex flex-col min-w-0 flex-1 min-h-0 h-full overflow-hidden">
            <AnimatePresence mode="wait">
              <motion.div
                key={currentView}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="w-full flex flex-col flex-1 min-h-0 h-full"
              >
                {currentView === "dashboard" && (
                  <ChatView
                    messages={chatMessages}
                    isTyping={isTyping}
                    onSendMessage={handleSendChatMessage}
                    onAddWord={handleConversationalAddWordOrPrompt}
                    onGenerateByTopic={handleConversationalGenerateWordsPrompt}
                    onStartQuiz={startChatQuiz}
                    onFixGrammar={handlePromptFixGrammar}
                    onSelectDefinition={handleSelectDefinition}
                    onClearHistory={handleClearChatHistory}
                    targetLanguage={targetLanguage}
                    nativeLanguage={nativeLanguage}
                    ttsConfig={ttsConfig}
                    llmConfig={llmConfig}
                    words={words}
                  />
                )}

                {currentView === "learn" && (
                  <FlashcardsView
                    words={words}
                    targetLanguage={targetLanguage}
                    onToggleStar={handleToggleStar}
                    onToggleLearned={handleToggleLearned}
                    onGoBack={() => handleSetView("dashboard")}
                    onStartQuiz={startChatQuiz}
                    ttsConfig={ttsConfig}
                    llmConfig={llmConfig}
                  />
                )}

                {currentView === "quiz" && (
                  <QuizView
                    words={todayPracticeWords}
                    targetLanguage={targetLanguage}
                    nativeLanguage={nativeLanguage}
                    appLanguage={appLanguage}
                    stats={stats}
                    onFinishQuiz={handleFinishQuiz}
                    onToggleStar={handleToggleStar}
                    onGoBack={() => handleSetView("dashboard")}
                    ttsConfig={ttsConfig}
                    llmConfig={llmConfig}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </main>

      {/* Mobile Drawer Slide Panel */}
      <MobileSideDrawer
        isOpen={isSidePanelOpen}
        onClose={() => setIsSidePanelOpen(false)}
        title={sidePanelTab}
      >
        {renderSidePanelContent()}
      </MobileSideDrawer>

      {/* LLM Login & Onboarding Modal */}
      <LlmLoginModal
        isOpen={isLlmModalOpen}
        currentConfig={llmConfig}
        onSaveConfig={handleSaveLlmConfig}
        onSaveOnboarding={handleSaveOnboarding}
        onClose={() => setIsLlmModalOpen(false)}
        canDismiss={Boolean(llmConfig.isLoggedIn && llmConfig.provider)}
      />

    </div>
  );
}

