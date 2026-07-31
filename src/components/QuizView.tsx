import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Trophy, 
  HelpCircle, 
  Check, 
  X, 
  ArrowRight, 
  RotateCcw, 
  ArrowLeft,
  Award,
  AlertCircle,
  CheckCircle,
  Lightbulb,
  Sparkles,
  Volume2,
  VolumeX,
  Star,
  Brain,
  Target,
  BookOpen,
  Layers,
  Image as ImageIcon,
  Loader2
} from "lucide-react";
import { Word, QuizQuestion, TTSConfig, LLMConfig, UserStats } from "../types";
import { speakText as speakTextService, stopSpeech, DEFAULT_TTS_CONFIG, getLanguageCode } from "../utils/ttsService";
import { generateQuizQuestions, containsNonTargetLanguage, getImageSearchTerm } from "../utils/quizGenerator";
import { generateAiQuizQuestionsService } from "../services/llmClientService";

import AudioEqualizer from "./quiz/AudioEqualizer";
import QuizImage from "./quiz/QuizImage";
export { QuizImage };

interface QuizViewProps {
  words: Word[];
  targetLanguage?: string;
  nativeLanguage?: string;
  stats?: UserStats;
  onFinishQuiz: (score: number, total: number, correctWordIds?: string[], incorrectWordIds?: string[]) => void;
  onToggleStar?: (wordId: string) => void;
  onGoBack: () => void;
  ttsConfig?: TTSConfig;
  llmConfig?: LLMConfig;
}

export default function QuizView({
  words,
  targetLanguage = "English",
  nativeLanguage = "Vietnamese",
  stats,
  onFinishQuiz,
  onToggleStar,
  onGoBack,
  ttsConfig = DEFAULT_TTS_CONFIG,
  llmConfig
}: QuizViewProps) {
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [currentQuestionIdx, setCurrentQuestionIdx] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [typedAnswer, setTypedAnswer] = useState("");
  const [isAnswered, setIsAnswered] = useState(false);
  const [score, setScore] = useState(0);
  const [showSummary, setShowSummary] = useState(false);
  const [wrongAnswersList, setWrongAnswersList] = useState<{ question: QuizQuestion; wrongPicked: string }[]>([]);
  const [autoPlayAudio, setAutoPlayAudio] = useState(ttsConfig?.autoPlayAudioInQuiz ?? true);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const isSpeaking = Boolean(speakingId);
  const [starFeedback, setStarFeedback] = useState<string | null>(null);
  const questionHeaderRef = useRef<HTMLDivElement>(null);
  const feedbackRef = useRef<HTMLDivElement>(null);

  // Auto scroll to feedback result centered in viewport when answered
  useEffect(() => {
    if (isAnswered) {
      const timer = setTimeout(() => {
        if (feedbackRef.current) {
          feedbackRef.current.scrollIntoView({
            behavior: "smooth",
            block: "center"
          });
        }
      }, 80);
      return () => clearTimeout(timer);
    }
  }, [isAnswered]);

  // Sync autoPlayAudio with parent ttsConfig updates
  useEffect(() => {
    if (ttsConfig?.autoPlayAudioInQuiz !== undefined) {
      setAutoPlayAudio(ttsConfig.autoPlayAudioInQuiz);
    }
  }, [ttsConfig?.autoPlayAudioInQuiz]);

  // Auto scroll to header of new question on mobile/desktop when switching questions
  useEffect(() => {
    if (questions.length > 0 && !showSummary) {
      const scrollToHeader = () => {
        const headerEl = questionHeaderRef.current || document.getElementById("quiz-question-view") || document.getElementById("quiz-header");
        if (headerEl) {
          const headerOffset = 80;
          const elementPosition = headerEl.getBoundingClientRect().top;
          const offsetPosition = elementPosition + window.pageYOffset - headerOffset;
          window.scrollTo({
            top: Math.max(0, offsetPosition),
            behavior: "smooth"
          });
        }
      };

      const timer = setTimeout(scrollToHeader, 60);
      return () => clearTimeout(timer);
    }
  }, [currentQuestionIdx, showSummary, questions.length]);

  // Advanced speak helper using configured TTS service with synchronized visual feedback ID tracking
  const speakText = (text: string, customLang?: string, audioId?: string, options?: { forceBrowser?: boolean }) => {
    const id = audioId || "default";
    const langCode = customLang || getLanguageCode(targetLanguage);
    const resolvedTtsConfig = options?.forceBrowser ? { ...ttsConfig, engine: "browser" as const } : ttsConfig;

    speakTextService(
      text,
      resolvedTtsConfig,
      llmConfig,
      langCode,
      () => setSpeakingId(id),
      () => setSpeakingId(prev => (prev === id ? null : prev))
    );
  };

  // Helper to initialize or re-generate quiz session with AI or rule-based fallback
  const createNewQuizSession = async (customWords?: Word[]) => {
    const targetWords = customWords || words;
    if (!targetWords || targetWords.length < 2) return;

    // Fast local rule-based generation first for immediate UI responsiveness
    const instantQuestions = generateQuizQuestions(targetWords, targetLanguage);
    setQuestions(instantQuestions);
    setCurrentQuestionIdx(0);
    setSelectedAnswer(null);
    setTypedAnswer("");
    setIsAnswered(false);
    setScore(0);
    setShowSummary(false);
    setWrongAnswersList([]);

    // If AI is configured, enhance questions using the AI service asynchronously
    if (llmConfig?.isLoggedIn) {
      try {
        const aiQuestions = await generateAiQuizQuestionsService({
          words: targetWords,
          targetLanguage,
          nativeLanguage,
          llmConfig,
          stats
        });
        if (aiQuestions && aiQuestions.length > 0) {
          setQuestions(aiQuestions);
        }
      } catch (e) {
        console.warn("AI quiz generation failed, using rule-based fallback:", e);
      }
    }
  };

  // Generate or restore the quiz when words are available
  useEffect(() => {
    if (!words || words.length < 2) return;

    let restored = false;
    try {
      const raw = localStorage.getItem("vocab_learner_active_quiz_session");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (
          parsed &&
          Array.isArray(parsed.questions) &&
          parsed.questions.length > 0 &&
          typeof parsed.currentQuestionIdx === "number" &&
          parsed.currentQuestionIdx < parsed.questions.length
        ) {
          setQuestions(parsed.questions);
          setCurrentQuestionIdx(parsed.currentQuestionIdx);
          setScore(parsed.score || 0);
          setWrongAnswersList(parsed.wrongAnswersList || []);
          setSelectedAnswer(null);
          setTypedAnswer("");
          setIsAnswered(false);
          setShowSummary(false);
          restored = true;
        }
      }
    } catch (e) {
      console.error("Error reading saved quiz session", e);
    }

    if (!restored) {
      createNewQuizSession();
    }
  }, [words]);

  // Auto-save active quiz session to localStorage on question/score progress
  useEffect(() => {
    if (words && words.length > 0 && questions.length > 0 && !showSummary) {
      try {
        const session = {
          questions,
          currentQuestionIdx,
          score,
          wrongAnswersList,
          savedAt: new Date().toISOString()
        };
        localStorage.setItem("vocab_learner_active_quiz_session", JSON.stringify(session));
      } catch (e) {
        console.error("Failed to auto-save active quiz session", e);
      }
    }
  }, [words, questions, currentQuestionIdx, score, wrongAnswersList, showSummary]);

  // Start fresh handler
  const handleStartFresh = () => {
    localStorage.removeItem("vocab_learner_active_quiz_session");
    createNewQuizSession();
  };

  // Auto-read question or spoken word when switching questions
  useEffect(() => {
    // Do not auto-read a question while another clip (notably feedback) is still speaking.
    if (questions.length > 0 && currentQuestionIdx < questions.length && !showSummary && !isAnswered && !isSpeaking) {
      const currQ = questions[currentQuestionIdx];
      if (currQ) {
        if (currQ.type === 'listening') {
          const timer = setTimeout(() => {
            speakText(currQ.word);
          }, 350);
          return () => clearTimeout(timer);
        } else if (currQ.type === 'spelling' && autoPlayAudio) {
          const timer = setTimeout(() => {
            speakText(currQ.word);
          }, 300);
          return () => clearTimeout(timer);
        } else if (autoPlayAudio) {
          const timer = setTimeout(() => {
            speakText(currQ.question);
          }, 300);
          return () => clearTimeout(timer);
        }
      }
    }
  }, [currentQuestionIdx, autoPlayAudio, showSummary, questions, isAnswered, isSpeaking]);

  if (!words || words.length < 2 || questions.length === 0) {
    if (words && words.length >= 2 && questions.length === 0) {
      return (
        <div className="bg-white p-12 border border-stone-200 text-center space-y-6 max-w-md mx-auto rounded-none">
          <div className="w-8 h-8 border-2 border-stone-900 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs text-stone-500 font-serif italic">Preparing practice quiz...</p>
        </div>
      );
    }

    return (
      <div className="bg-white p-8 sm:p-12 border border-stone-200 text-center space-y-6 max-w-md mx-auto rounded-none shadow-2xs" id="no-words-for-quiz">
        <div className="w-16 h-16 bg-stone-50 border border-stone-200 rounded-full flex items-center justify-center mx-auto text-stone-800">
          <CheckCircle className="w-8 h-8 text-stone-900" />
        </div>
        <div className="space-y-2">
          <h3 className="text-base font-bold text-stone-900">No Words to Practice Today</h3>
          <p className="text-xs text-stone-600 font-serif italic leading-relaxed">
            "You have reviewed all eligible vocabulary items recently! There are no words due for practice right now. Please come back later or add new words to keep practicing."
          </p>
        </div>
        <div className="pt-2">
          <button 
            onClick={onGoBack}
            className="px-6 py-3 bg-stone-900 text-white font-bold text-xs uppercase tracking-wider hover:bg-black transition-colors cursor-pointer rounded-none"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  const currentQuestion = questions[currentQuestionIdx];

  const handleOptionSelect = (option: string) => {
    if (isAnswered) return;
    // Stop reading question or audio immediately when user selects an option
    stopSpeech();
    setSpeakingId(null);
    setSelectedAnswer(option);
  };

  const handleVerify = () => {
    if (isAnswered) return;
    stopSpeech();
    setSpeakingId(null);
    
    let isCorrect = false;

    if (currentQuestion.type === 'spelling') {
      const userSpelling = typedAnswer.toLowerCase().trim();
      const actualSpelling = currentQuestion.correctAnswer.toLowerCase().trim();
      isCorrect = userSpelling === actualSpelling;
    } else {
      isCorrect = selectedAnswer === currentQuestion.correctAnswer;
    }

    if (isCorrect) {
      setScore(prev => prev + 1);
    } else {
      setWrongAnswersList(prev => [
        ...prev, 
        { 
          question: currentQuestion, 
          wrongPicked: currentQuestion.type === 'spelling' ? (typedAnswer || "[No response]") : (selectedAnswer || "[No response]") 
        }
      ]);
    }

    setIsAnswered(true);

    // Build concise feedback audio phrase for clear speech synthesis
    const feedbackAudioMessage = isCorrect
      ? "Correct!"
      : `Incorrect! Correct answer: "${currentQuestion.correctAnswer}"`;

    // Speak immediately in the same user gesture; delayed calls can be blocked by autoplay policies.
    if (autoPlayAudio) {
      speakText(feedbackAudioMessage, "en-US", "feedback", { forceBrowser: true });
    }
  };

  const handleNext = () => {
    setSelectedAnswer(null);
    setTypedAnswer("");
    setIsAnswered(false);

    if (currentQuestionIdx < questions.length - 1) {
      setCurrentQuestionIdx(prev => prev + 1);
      setTimeout(() => {
        const headerEl = questionHeaderRef.current || document.getElementById("quiz-question-view");
        if (headerEl) {
          const headerOffset = 80;
          const elementPosition = headerEl.getBoundingClientRect().top;
          const offsetPosition = elementPosition + window.pageYOffset - headerOffset;
          window.scrollTo({ top: Math.max(0, offsetPosition), behavior: "smooth" });
        }
      }, 30);
    } else {
      setShowSummary(true);
      try {
        localStorage.removeItem("vocab_learner_active_quiz_session");
      } catch (e) {
        console.error("Error removing session storage", e);
      }
      const incorrectWordIds = wrongAnswersList.map(item => item.question?.wordId).filter(Boolean) as string[];
      const correctWordIds = questions
        .filter(q => q?.wordId && !incorrectWordIds.includes(q.wordId))
        .map(q => q.wordId);
      onFinishQuiz(score, questions.length, correctWordIds, incorrectWordIds);
    }
  };

  // Handler to launch a retry quiz consisting ONLY of missed questions
  const handleRetryMissedQuestions = () => {
    if (wrongAnswersList.length === 0) return;
    const missedQuestionsOnly = wrongAnswersList.map(item => item.question);
    const shuffledMissed = [...missedQuestionsOnly].sort(() => 0.5 - Math.random());
    setQuestions(shuffledMissed);
    setCurrentQuestionIdx(0);
    setScore(0);
    setIsAnswered(false);
    setSelectedAnswer(null);
    setTypedAnswer("");
    setWrongAnswersList([]);
    setShowSummary(false);
  };

  // Handler to star all missed words
  const handleStarAllMissed = () => {
    if (!onToggleStar || !words) return;
    const missedWordIds = wrongAnswersList
      .map(item => item.question?.wordId)
      .filter(Boolean) as string[];

    let starredCount = 0;
    missedWordIds.forEach(id => {
      const wordObj = words.find(w => w.id === id);
      if (wordObj && !wordObj.starred) {
        onToggleStar(id);
        starredCount++;
      }
    });

    setStarFeedback(
      starredCount > 0 
        ? `Starred ${starredCount} word${starredCount === 1 ? "" : "s"} for priority practice!`
        : "All missed words are already starred!"
    );
    setTimeout(() => setStarFeedback(null), 3500);
  };

  // Play audio helper
  const playWordAudio = (wordText: string) => {
    speakText(wordText);
  };

  if (showSummary && words) {
    const successRate = Math.round((score / questions.length) * 100);
    const perfectScore = score === questions.length;

    return (
      <div className="max-w-3xl mx-auto space-y-8" id="quiz-summary-view">
        <motion.div 
          initial={{ scale: 0.98, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="bg-white border border-stone-200 p-4 sm:p-8 md:p-12 space-y-5 sm:space-y-8 rounded-none shadow-2xs"
        >
          {/* Trophy & Header Display */}
          <div className="text-center space-y-3">
            <div className="relative inline-block">
              <div className="w-20 h-20 bg-stone-50 border border-stone-200 rounded-full flex items-center justify-center text-stone-900 mx-auto">
                <Trophy className="w-10 h-10" />
              </div>
              {perfectScore && (
                <Sparkles className="absolute -top-1 -right-1 text-amber-500 w-6 h-6 animate-pulse" />
              )}
            </div>

            <div className="space-y-1">
              <h2 className="text-2xl font-bold tracking-tight text-stone-900">Quiz Completed</h2>
              <p className="text-xs text-stone-500 font-serif italic max-w-md mx-auto">
                "Performance analysis complete. Study performance and learning strategies below."
              </p>
            </div>
          </div>

          {/* Core Results Block */}
          <div className="grid grid-cols-2 gap-4 max-w-md mx-auto">
            <div className="bg-stone-50 p-6 border border-stone-200 rounded-none text-center">
              <div className="text-3xl font-bold tracking-tight text-stone-950">{score} / {questions.length}</div>
              <span className="text-xs font-semibold text-stone-500 mt-1.5 block">Correct Answers</span>
            </div>
            <div className="bg-stone-50 p-6 border border-stone-200 rounded-none text-center">
              <div className={`text-3xl font-bold tracking-tight ${successRate >= 80 ? "text-emerald-700" : successRate >= 50 ? "text-amber-700" : "text-stone-900"}`}>
                {successRate}%
              </div>
              <span className="text-xs font-semibold text-stone-500 mt-1.5 block">Accuracy Rate</span>
            </div>
          </div>

          {/* Perfect Score Celebration */}
          {perfectScore && (
            <div className="bg-emerald-50 border border-emerald-200 p-6 text-center space-y-2">
              <div className="flex items-center justify-center gap-2 text-emerald-800 font-bold text-sm">
                <Sparkles className="w-4 h-4 text-emerald-600" />
                <span>Flawless 100% Performance!</span>
              </div>
              <p className="text-xs text-emerald-700 font-serif italic">
                You demonstrated complete recall mastery for all words in this test session. Re-verify in 24 hours to lock in long-term memory.
              </p>
            </div>
          )}

          {/* Targeted Strategies & Wrong Answers Analysis */}
          {wrongAnswersList.length > 0 && (
            <div className="space-y-8 pt-6 border-t border-stone-200 text-left">
              {/* Quick Actions Header */}
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-stone-900 text-white p-4">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2 text-xs font-semibold">
                    <AlertCircle className="w-4 h-4 text-amber-400" />
                    <span>{wrongAnswersList.length} Word{wrongAnswersList.length === 1 ? "" : "s"} Needing Focus</span>
                  </div>
                  <p className="text-[11px] text-stone-300 font-serif italic">
                    Review your errors below using targeted cognitive retention techniques.
                  </p>
                </div>

                <div className="flex flex-wrap gap-2 w-full sm:w-auto">
                  <button
                    onClick={handleRetryMissedQuestions}
                    className="flex-1 sm:flex-initial px-3 py-2 bg-amber-400 hover:bg-amber-300 text-stone-950 font-bold text-xs rounded-none transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                    title="Start mini-quiz with only missed items"
                  >
                    <Target className="w-3.5 h-3.5" />
                    <span>Retry Missed Only</span>
                  </button>

                  {onToggleStar && (
                    <button
                      onClick={handleStarAllMissed}
                      className="flex-1 sm:flex-initial px-3 py-2 bg-stone-800 hover:bg-stone-700 text-stone-200 font-semibold text-xs border border-stone-700 rounded-none transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                      title="Add all missed words to starred collection"
                    >
                      <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
                      <span>Star All Missed</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Toast Feedback */}
              {starFeedback && (
                <motion.div 
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold p-3 text-center"
                >
                  ✓ {starFeedback}
                </motion.div>
              )}

              {/* 4 Good Learning Strategies Grid */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Brain className="w-4 h-4 text-stone-900" />
                  <h3 className="text-sm font-bold text-stone-900">
                    Strategies to Learn from Wrong Answers
                  </h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {/* Strategy 1: Immediate Retry */}
                  <div className="bg-stone-50 p-4 border border-stone-200 rounded-none space-y-2">
                    <div className="flex items-center gap-2 text-stone-900 font-bold text-xs">
                      <RotateCcw className="w-4 h-4 text-stone-800" />
                      <span>1. Immediate Spaced Retrieval</span>
                    </div>
                    <p className="text-xs text-stone-600 leading-relaxed">
                      Re-testing failed items immediately forces working memory to rebuild neural pathways before decay sets in.
                    </p>
                    <button
                      onClick={handleRetryMissedQuestions}
                      className="text-[11px] font-bold text-stone-900 underline hover:text-amber-700 cursor-pointer flex items-center gap-1"
                    >
                      Launch Retry Quiz Now <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>

                  {/* Strategy 2: Vocal Shadowing */}
                  <div className="bg-stone-50 p-4 border border-stone-200 rounded-none space-y-2">
                    <div className="flex items-center gap-2 text-stone-900 font-bold text-xs">
                      <Volume2 className="w-4 h-4 text-stone-800" />
                      <span>2. Auditory & Vocal Shadowing</span>
                    </div>
                    <p className="text-xs text-stone-600 leading-relaxed">
                      Listen to the audio pronunciation for each word below and repeat it out loud 3 times with exaggerated pitch and stress.
                    </p>
                  </div>

                  {/* Strategy 3: Contrastive Analysis */}
                  <div className="bg-stone-50 p-4 border border-stone-200 rounded-none space-y-2">
                    <div className="flex items-center gap-2 text-stone-900 font-bold text-xs">
                      <Lightbulb className="w-4 h-4 text-stone-800" />
                      <span>3. Contrast Wrong vs. Correct</span>
                    </div>
                    <p className="text-xs text-stone-600 leading-relaxed">
                      Examine why you selected your wrong answer. Identifying why false associations happen prevents repeating the same trap.
                    </p>
                  </div>

                  {/* Strategy 4: Contextual Sentence Anchoring */}
                  <div className="bg-stone-50 p-4 border border-stone-200 rounded-none space-y-2">
                    <div className="flex items-center gap-2 text-stone-900 font-bold text-xs">
                      <BookOpen className="w-4 h-4 text-stone-800" />
                      <span>4. Sentence Anchoring</span>
                    </div>
                    <p className="text-xs text-stone-600 leading-relaxed">
                      Construct 2 original sentences using each missed target word, linking them to real routines or personal memories.
                    </p>
                  </div>
                </div>
              </div>

              {/* Detailed Wrong Answers Review List */}
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-stone-600">
                    Detailed Item Breakdown ({wrongAnswersList.length})
                  </span>
                  <span className="text-[10px] text-stone-400 italic">
                    Click audio to listen • Click star to prioritize
                  </span>
                </div>

                <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
                  {wrongAnswersList.map((item, idx) => {
                    const matchingWordObj = words.find(w => w.id === item.question?.wordId);
                    const isStarred = matchingWordObj?.starred;

                    return (
                      <div 
                        key={idx} 
                        className="bg-stone-50 p-4 border border-stone-200 rounded-none text-xs space-y-3 hover:border-stone-400 transition-all"
                      >
                        <div className="flex justify-between items-start gap-3">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-stone-950 text-base">{item.question.word}</span>
                              <span className="text-xs text-stone-600 font-semibold bg-stone-200 px-2 py-0.5">
                                {matchingWordObj?.partOfSpeech || "word"}
                              </span>
                            </div>
                            <p className="text-stone-700 font-serif italic text-xs">
                              "{matchingWordObj?.definition || item.question.correctAnswer}"
                            </p>
                            {matchingWordObj?.translation && (
                              <p className="text-[11px] text-stone-500 font-sans">
                                Translation: <span className="font-medium text-stone-800">{matchingWordObj.translation}</span>
                              </p>
                            )}
                          </div>

                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => playWordAudio(item.question.word)}
                              className="p-2 border border-stone-200 hover:border-stone-900 text-stone-600 hover:text-stone-950 bg-white rounded-none transition-all cursor-pointer"
                              title="Listen Pronunciation"
                            >
                              <Volume2 className="w-4 h-4" />
                            </button>

                            {onToggleStar && item.question?.wordId && (
                              <button
                                onClick={() => onToggleStar(item.question.wordId)}
                                className={`p-2 border ${isStarred ? "border-amber-400 bg-amber-50 text-amber-600" : "border-stone-200 hover:border-stone-900 bg-white text-stone-400 hover:text-stone-900"} rounded-none transition-all cursor-pointer`}
                                title={isStarred ? "Remove Star" : "Star Word for Study"}
                              >
                                <Star className={`w-4 h-4 ${isStarred ? "fill-amber-400 text-amber-500" : ""}`} />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Answers comparison */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 border-t border-stone-200 text-[11px]">
                          <div className="bg-red-50/50 p-2 border border-red-100 text-red-900 font-mono">
                            <span className="text-xs font-semibold text-red-600 block mb-0.5">Your Choice:</span>
                            <span className="line-through font-semibold">{item.wrongPicked || "(No input)"}</span>
                          </div>

                          <div className="bg-emerald-50/50 p-2 border border-emerald-100 text-emerald-950 font-mono">
                            <span className="text-xs font-semibold text-emerald-700 block mb-0.5">Correct Target:</span>
                            <span className="font-bold text-emerald-900">{item.question.correctAnswer}</span>
                          </div>
                        </div>

                        {/* Specific Learning Strategy Tip */}
                        <div className="bg-white p-2.5 border border-stone-200 text-[11px] text-stone-600 flex items-start gap-2">
                          <Lightbulb className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                          <div>
                            <span className="font-bold text-stone-900">Custom Memory Tip: </span>
                            {item.question.type === 'spelling' && (
                              <span>Write out <strong>{item.question.word}</strong> by hand 3 times, paying close attention to silent letters or double consonants.</span>
                            )}
                            {item.question.type === 'definition' && (
                              <span>Anchor <strong>{item.question.word}</strong> to its definition by creating a vivid visual story or keyword mnemonic.</span>
                            )}
                            {item.question.type === 'sentence' && (
                              <span>Read the full example sentence out loud 2 times with <strong>{item.question.word}</strong> inserted in context.</span>
                            )}
                            {item.question.type === 'listening' && (
                              <span>Listen to <strong>{item.question.word}</strong> repeatedly using the audio button and repeat the pronunciation aloud until comfortable.</span>
                            )}
                            {item.question.type === 'picture' && (
                              <span>Associate the visual image directly with <strong>{item.question.word}</strong> to build intuitive, visual pathways to the target vocabulary.</span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Action Row */}
          <div className="flex flex-col sm:flex-row gap-3 pt-6 border-t border-stone-200">
            {wrongAnswersList.length > 0 ? (
              <>
                <button
                  onClick={handleRetryMissedQuestions}
                  className="flex-1 py-3 bg-amber-400 hover:bg-amber-300 text-stone-950 font-bold text-xs uppercase tracking-widest rounded-none transition-all flex items-center justify-center gap-2 cursor-pointer shadow-2xs"
                >
                  <Target className="w-4 h-4" /> Retry Missed Questions ({wrongAnswersList.length})
                </button>
                <button
                  onClick={() => createNewQuizSession()}
                  className="flex-1 py-3 border border-stone-300 hover:border-stone-900 bg-stone-50 text-stone-800 font-bold text-xs uppercase tracking-widest rounded-none transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4" /> Full Quiz Retake
                </button>
              </>
            ) : (
              <button
                onClick={() => createNewQuizSession()}
                className="flex-1 py-3 border border-stone-200 hover:border-stone-900 bg-stone-50 text-stone-800 font-bold text-xs uppercase tracking-widest rounded-none transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" /> Retake Practice Quiz
              </button>
            )}

            <button
              onClick={onGoBack}
              className="flex-1 py-3 bg-stone-900 hover:bg-black text-white font-bold text-xs uppercase tracking-widest rounded-none transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              Finish Study <Check className="w-4 h-4 stroke-[3]" />
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  const isLastQuestion = currentQuestionIdx === questions.length - 1;
  const wordDetails = words?.find(w => w.id === currentQuestion?.wordId);

  return (
    <div className="max-w-2xl mx-auto space-y-6 scroll-mt-16 sm:scroll-mt-20" id="quiz-question-view" ref={questionHeaderRef}>
      {/* Quiz Progress header */}
      <div className="space-y-3" id="quiz-header">
        {/* Top Navigation & Progress */}
        <div className="flex items-center justify-between gap-2">
          <button 
            onClick={onGoBack}
            className="inline-flex items-center gap-1.5 text-[10px] font-bold text-stone-400 hover:text-stone-900 uppercase tracking-widest transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-3 h-3" /> Back to Study
          </button>
          
          <div className="flex items-center gap-2">
            <button
              onClick={handleStartFresh}
              className="inline-flex items-center gap-1 text-[10px] font-bold text-stone-400 hover:text-red-700 uppercase tracking-wider transition-colors cursor-pointer"
              title="Discard current progress and start a fresh quiz"
              id="btn-quiz-start-fresh"
            >
              <RotateCcw className="w-3 h-3" /> Start Fresh
            </button>
            <span className="text-xs font-mono font-bold text-stone-900 bg-stone-50 border border-stone-200 px-2.5 py-1 rounded-none shrink-0">
              Question {currentQuestionIdx + 1} of {questions.length}
            </span>
          </div>
        </div>

        {/* Title & Score & Voice Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
          <div>
            <h3 className="text-lg sm:text-xl font-bold tracking-tight text-stone-900">
              Vocabulary Practice
            </h3>
            <p className="text-[10px] text-stone-500 uppercase font-bold tracking-widest mt-0.5">
              Score: {score}/{currentQuestionIdx}
            </p>
          </div>

          {/* Voice Toolbar */}
          <div className="flex items-center gap-2 self-start sm:self-auto shrink-0 flex-wrap">
            <button
              type="button"
              onClick={() => {
                if (isSpeaking) {
                  stopSpeech();
                  setSpeakingId(null);
                } else if (currentQuestion) {
                  speakText(currentQuestion.question, undefined, "question");
                }
              }}
              className={`px-2.5 py-1.5 border text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 cursor-pointer transition-all whitespace-nowrap ${
                speakingId === "question" 
                  ? "bg-amber-100 border-amber-400 text-amber-900 font-extrabold shadow-2xs" 
                  : "bg-white border-stone-200 text-stone-800 hover:border-stone-900"
              }`}
              title="Listen to question"
            >
              <Volume2 className={`w-3.5 h-3.5 shrink-0 ${speakingId === "question" ? "text-amber-800 animate-pulse" : "text-stone-900"}`} />
              <span>{speakingId === "question" ? "Speaking..." : "Read"}</span>
              <AudioEqualizer active={speakingId === "question"} />
            </button>

            <button
              type="button"
              onClick={() => {
                const nextVal = !autoPlayAudio;
                setAutoPlayAudio(nextVal);
                if (!nextVal) {
                  stopSpeech();
                  setSpeakingId(null);
                }
              }}
              className={`px-2.5 py-1.5 border text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 cursor-pointer transition-all whitespace-nowrap ${
                autoPlayAudio 
                  ? "bg-stone-900 border-stone-900 text-white" 
                  : "bg-white border-stone-200 text-stone-500 hover:text-stone-900"
              }`}
              title="Auto-read questions as they appear"
            >
              {autoPlayAudio ? <Volume2 className="w-3.5 h-3.5 text-amber-400 shrink-0" /> : <VolumeX className="w-3.5 h-3.5 shrink-0" />}
              <span>Auto-Voice: {autoPlayAudio ? "ON" : "OFF"}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="h-[2px] bg-stone-100 overflow-hidden rounded-none">
        <div 
          className="h-full bg-stone-900 transition-all duration-300"
          style={{ width: `${((currentQuestionIdx) / questions.length) * 100}%` }}
        />
      </div>

      {/* Question Card */}
      <motion.div 
        key={currentQuestion.id}
        initial={{ opacity: 0, x: 10 }}
        animate={{ opacity: 1, x: 0 }}
        className="bg-white border border-stone-200 p-4 sm:p-8 md:p-10 space-y-5 sm:space-y-8 rounded-none"
      >
        {/* Type Icon */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-bold tracking-widest text-stone-800 bg-stone-50 border border-stone-200 px-3 py-1 uppercase font-mono rounded-none">
              {currentQuestion.type === 'definition' && "Definition Match"}
              {currentQuestion.type === 'sentence' && "Context Filler"}
              {currentQuestion.type === 'spelling' && "Spelling Challenge"}
              {currentQuestion.type === 'listening' && "Listening Skill"}
              {currentQuestion.type === 'picture' && "Visual Picture Match"}
            </span>
            {llmConfig?.isLoggedIn && (
              <span className="text-[10px] font-bold tracking-wider text-amber-900 bg-amber-50 border border-amber-200 px-2.5 py-1 uppercase font-mono flex items-center gap-1 rounded-none" title="AI calibrated using your study stats & word strength">
                <Sparkles className="w-3 h-3 text-amber-600 shrink-0" />
                Stats-Adapted AI
              </span>
            )}
          </div>
          {currentQuestion.hint && (
            <div className="text-xs text-stone-500 font-mono italic">
              Pronunciation: {currentQuestion.hint}
            </div>
          )}
        </div>

        {/* Question Text with Speaker Button */}
        <div className="flex items-start justify-between gap-4">
          <h4 className="text-xl md:text-2xl font-semibold tracking-tight text-stone-950 whitespace-pre-wrap leading-relaxed font-serif flex-1">
            {currentQuestion.question}
          </h4>
          <button
            onClick={() => speakText(currentQuestion.type === 'listening' ? currentQuestion.word : currentQuestion.question, undefined, "question")}
            className={`p-2.5 border transition-all cursor-pointer shrink-0 flex items-center gap-1.5 ${
              speakingId === "question"
                ? "bg-amber-100 border-amber-400 text-amber-900 shadow-2xs"
                : "bg-stone-50 border-stone-200 hover:border-stone-900 hover:bg-stone-100 text-stone-800"
            }`}
            title="Read aloud"
          >
            <Volume2 className={`w-4 h-4 ${speakingId === "question" ? "animate-pulse text-amber-800" : "text-stone-900"}`} />
            <AudioEqualizer active={speakingId === "question"} />
          </button>
        </div>

        {/* Dedicated Picture Question Image */}
        {(currentQuestion.type === 'picture' || currentQuestion.imageUrl) && (
          <div className="relative w-full max-w-md mx-auto aspect-video sm:aspect-[4/3] bg-stone-100 border border-stone-200 overflow-hidden group shadow-2xs my-2">
            <QuizImage 
              src={currentQuestion.imageUrl} 
              alt={`Visual clue for ${currentQuestion.word}`} 
              word={currentQuestion.word}
            />
          </div>
        )}

        {/* Dedicated Listening Audio Card */}
        {currentQuestion.type === 'listening' && (
          <div className={`border p-4 sm:p-6 flex flex-col sm:flex-row items-center justify-between gap-4 my-2 transition-all ${
            speakingId === "listening" ? "bg-amber-100/90 border-amber-400 ring-2 ring-amber-300/80 shadow-xs" : "bg-amber-50/70 border-amber-200"
          }`}>
            <div className="flex items-center gap-3 w-full sm:w-auto">
              <button
                type="button"
                onClick={() => speakText(currentQuestion.word, undefined, "listening")}
                className={`w-12 h-12 sm:w-14 sm:h-14 rounded-none bg-stone-900 text-amber-400 hover:bg-stone-800 transition-all flex items-center justify-center cursor-pointer shrink-0 ${
                  speakingId === "listening" ? "animate-pulse ring-4 ring-amber-400/80 bg-stone-950 scale-105" : ""
                }`}
                title="Play audio clip"
              >
                <Volume2 className="w-6 h-6 sm:w-7 sm:h-7" />
              </button>
              <div>
                <h5 className="font-bold text-xs uppercase tracking-widest text-stone-900 flex items-center gap-1.5">
                  <Volume2 className="w-3.5 h-3.5 text-amber-600" />
                  Audio Pronunciation
                </h5>
                <p className="text-xs text-stone-600 mt-0.5 font-serif italic flex items-center gap-1.5">
                  {speakingId === "listening" ? (
                    <>
                      <span className="font-bold text-amber-900">Playing sound clip...</span>
                      <AudioEqualizer active={true} />
                    </>
                  ) : (
                    "Tap button to replay spoken word"
                  )}
                </p>
              </div>
            </div>
            
            <button
              type="button"
              onClick={() => speakText(currentQuestion.word, undefined, "listening")}
              className={`w-full sm:w-auto px-4 py-2.5 font-bold text-[10px] uppercase tracking-widest flex items-center justify-center gap-1.5 cursor-pointer transition-all shrink-0 ${
                speakingId === "listening"
                  ? "bg-amber-400 text-stone-950 border border-amber-500 shadow-2xs"
                  : "bg-stone-900 hover:bg-stone-800 text-amber-400"
              }`}
            >
              <Volume2 className="w-3.5 h-3.5" />
              <span>{speakingId === "listening" ? "Playing..." : "Replay Sound"}</span>
              <AudioEqualizer active={speakingId === "listening"} />
            </button>
          </div>
        )}

        {/* Quiz Answer Body */}
        <div className="space-y-3 pt-2">
          {currentQuestion.type === 'spelling' ? (
            /* Spelling Input Field */
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  disabled={isAnswered}
                  value={typedAnswer}
                  onFocus={() => {
                    stopSpeech();
                    setSpeakingId(null);
                  }}
                  onChange={(e) => {
                    stopSpeech();
                    setSpeakingId(null);
                    setTypedAnswer(e.target.value);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && typedAnswer.trim() && !isAnswered) {
                      handleVerify();
                    }
                  }}
                  placeholder="Type spelling in lowercase..."
                  className="flex-1 border border-stone-200 bg-stone-50 rounded-none px-4 py-3 font-semibold text-stone-900 outline-none focus:border-stone-950 focus:bg-white transition-all text-xs font-mono tracking-widest uppercase"
                />
                <button
                  type="button"
                  onClick={() => speakText(currentQuestion.word, undefined, "spelling")}
                  className={`p-3 border transition-all cursor-pointer shrink-0 flex items-center gap-1.5 ${
                    speakingId === "spelling"
                      ? "bg-amber-100 border-amber-400 text-amber-900"
                      : "bg-stone-50 border-stone-200 hover:border-stone-900 text-stone-900"
                  }`}
                  title="Listen word to spell"
                >
                  <Volume2 className={`w-4 h-4 ${speakingId === "spelling" ? "animate-pulse text-amber-800" : ""}`} />
                  <AudioEqualizer active={speakingId === "spelling"} />
                </button>
              </div>
            </div>
          ) : (
            /* Multiple Choice Buttons */
            <div className="grid grid-cols-1 gap-3">
              {currentQuestion.options?.map((option, idx) => {
                const isSelected = selectedAnswer === option;
                const isOptionSpeaking = speakingId === `option-${idx}`;
                let btnStyles = "border-stone-200 bg-stone-50 hover:bg-stone-100 text-stone-800";
                
                if (isAnswered) {
                  if (option === currentQuestion.correctAnswer) {
                    // Correct answer
                    btnStyles = "border-stone-900 bg-stone-50 text-stone-950 font-bold";
                  } else if (isSelected) {
                    // Wrong choice selected
                    btnStyles = "border-stone-200 bg-stone-50 text-stone-400 line-through font-semibold";
                  } else {
                    btnStyles = "opacity-40 border-stone-100 bg-stone-50 text-stone-400";
                  }
                } else if (isSelected) {
                  btnStyles = "border-stone-900 bg-stone-50 text-stone-950 font-bold";
                }

                if (isOptionSpeaking) {
                  btnStyles += " ring-2 ring-amber-400 bg-amber-50/80 border-amber-400";
                }

                return (
                  <button
                    key={idx}
                    disabled={isAnswered}
                    onClick={() => handleOptionSelect(option)}
                    className={`w-full text-left p-4 rounded-none border transition-all text-xs md:text-sm flex items-center justify-between group cursor-pointer ${btnStyles}`}
                  >
                    <span className="flex-1 mr-2">{option}</span>
                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation();
                          speakText(option, undefined, `option-${idx}`);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.stopPropagation();
                            speakText(option, undefined, `option-${idx}`);
                          }
                        }}
                        className={`p-1.5 border transition-all cursor-pointer flex items-center gap-1 ${
                          isOptionSpeaking
                            ? "bg-amber-200/80 border-amber-400 text-amber-950 font-bold"
                            : "text-stone-400 hover:text-stone-900 hover:bg-stone-200/60 border-transparent"
                        }`}
                        title="Speak option aloud"
                      >
                        <Volume2 className={`w-3.5 h-3.5 ${isOptionSpeaking ? "animate-pulse text-amber-800" : ""}`} />
                        <AudioEqualizer active={isOptionSpeaking} />
                      </span>
                      {isAnswered && option === currentQuestion.correctAnswer && (
                        <Check className="w-4 h-4 text-stone-900 stroke-[3]" />
                      )}
                      {isAnswered && isSelected && option !== currentQuestion.correctAnswer && (
                        <X className="w-4 h-4 text-stone-400" />
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Dynamic Verification Feedback Block with Synchronized Visual Feedback */}
        <AnimatePresence>
          {isAnswered && (() => {
            const isAnswerCorrect = currentQuestion.type === 'spelling' 
              ? typedAnswer.toLowerCase().trim() === currentQuestion.correctAnswer.toLowerCase().trim()
              : selectedAnswer === currentQuestion.correctAnswer;
            const chosenVal = (currentQuestion.type === 'spelling' ? typedAnswer.trim() : (selectedAnswer || "")).trim() || "no response";
            const feedbackTextToSpeak = isAnswerCorrect
              ? "Correct!"
              : `Incorrect! Correct answer: "${currentQuestion.correctAnswer}"`;
            const isFeedbackSpeaking = speakingId === "feedback";

            return (
              <motion.div 
                ref={feedbackRef}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
                className={`p-5 rounded-none flex flex-col sm:flex-row sm:items-start gap-4 border transition-all duration-300 justify-between ${
                  isFeedbackSpeaking 
                    ? "bg-amber-50/90 border-amber-400 ring-2 ring-amber-300/90 shadow-2xs" 
                    : "bg-stone-50 border-stone-200 text-stone-800"
                }`}
              >
                <div className="flex flex-col gap-2 flex-1">
                  {isFeedbackSpeaking && (
                    <div className="px-3 py-1 bg-amber-200/70 border border-amber-300 text-amber-950 text-[11px] font-bold flex items-center justify-between rounded-none mb-1">
                      <div className="flex items-center gap-2">
                        <Volume2 className="w-3.5 h-3.5 text-amber-800 animate-pulse" />
                        <span>🔊 Voice Feedback Playing...</span>
                      </div>
                      <AudioEqualizer active={true} />
                    </div>
                  )}

                  <div className="flex items-start gap-3">
                    {isAnswerCorrect ? (
                      <>
                        <Check className="w-5 h-5 text-stone-900 shrink-0 mt-0.5 stroke-[3]" />
                        <div className="space-y-1">
                          <h5 className="font-bold text-[10px] uppercase tracking-widest text-stone-900">Correct Response</h5>
                          <p className="text-xs text-stone-700 font-medium">
                            You chose <strong className="font-bold text-stone-950">"{chosenVal}"</strong> — It's correct!
                          </p>
                          <p className="text-xs text-stone-500 font-serif italic mt-0.5">
                            {currentQuestion.type === 'picture' 
                              ? `"${wordDetails?.word}" (${wordDetails?.translation}) matches the visual concept.`
                              : `"${wordDetails?.word}" matches the definition: "${wordDetails?.definition}".`}
                          </p>
                        </div>
                      </>
                    ) : (
                      <>
                        <X className="w-5 h-5 text-stone-400 shrink-0 mt-0.5" />
                        <div className="space-y-1">
                          <h5 className="font-bold text-[10px] uppercase tracking-widest text-stone-500">Incorrect Response</h5>
                          <p className="text-xs text-stone-700 font-medium">
                            You chose <span className="line-through text-stone-500">"{chosenVal}"</span> — It's incorrect.
                          </p>
                          <p className="text-xs text-stone-600 font-serif italic mt-0.5">
                            The correct answer is: <strong className="font-bold text-stone-950">"{currentQuestion.correctAnswer}"</strong>.
                          </p>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => speakText(feedbackTextToSpeak, "en-US", "feedback", { forceBrowser: true })}
                  className={`p-2 border transition-all cursor-pointer shrink-0 flex items-center gap-1.5 text-xs font-semibold ${
                    isFeedbackSpeaking
                      ? "bg-amber-400 text-stone-950 border-amber-500 shadow-2xs font-bold"
                      : "bg-white border-stone-200 hover:border-stone-900 text-stone-800"
                  }`}
                  title="Speak feedback result aloud"
                >
                  <Volume2 className={`w-4 h-4 ${isFeedbackSpeaking ? "animate-pulse text-stone-950" : "text-stone-900"}`} />
                  <span className="hidden sm:inline text-[10px] uppercase tracking-wider font-mono">
                    {isFeedbackSpeaking ? "Speaking..." : "Replay"}
                  </span>
                  <AudioEqualizer active={isFeedbackSpeaking} />
                </button>
              </motion.div>
            );
          })()}
        </AnimatePresence>

        {/* Action button row */}
        <div className="flex justify-between items-center pt-6 border-t border-stone-100">
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-stone-400">
            <Lightbulb className="w-4 h-4" />
            <span>Spaced repetition analysis enabled.</span>
          </div>

          {!isAnswered ? (
            <button
              onClick={handleVerify}
              disabled={currentQuestion.type === 'spelling' ? !typedAnswer.trim() : !selectedAnswer}
              className="px-6 py-3 bg-stone-900 hover:bg-black disabled:bg-stone-50 disabled:text-stone-300 disabled:border-stone-200 border border-stone-900 text-white font-bold text-xs uppercase tracking-widest rounded-none cursor-pointer"
            >
              Verify Answer
            </button>
          ) : (
            <button
              onClick={handleNext}
              className="px-6 py-3 bg-stone-900 hover:bg-black text-white font-bold text-xs uppercase tracking-widest rounded-none transition-colors flex items-center gap-1 cursor-pointer"
            >
              {isLastQuestion ? "Finish Quiz" : "Next Question"} <ArrowRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
}
