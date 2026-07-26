import React, { useState, useEffect } from "react";
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
  Lightbulb,
  Sparkles,
  Volume2,
  VolumeX,
  Star,
  Brain,
  Target,
  BookOpen,
  Layers
} from "lucide-react";
import { Word, Deck, QuizQuestion, TTSConfig, LLMConfig } from "../types";
import { speakText as speakTextService, DEFAULT_TTS_CONFIG } from "../utils/ttsService";

interface QuizViewProps {
  deck: Deck | null;
  onFinishQuiz: (score: number, total: number, correctWordIds?: string[], incorrectWordIds?: string[]) => void;
  onToggleStar?: (wordId: string) => void;
  onGoBack: () => void;
  ttsConfig?: TTSConfig;
  llmConfig?: LLMConfig;
}

// Helper function to generate questions for a deck
function generateQuizQuestions(deck: Deck): QuizQuestion[] {
  if (!deck || deck.words.length < 2) return [];
  const generated: QuizQuestion[] = [];
  const allWords = deck.words;

  allWords.forEach((word) => {
    const types: ('translation' | 'definition' | 'sentence' | 'listening')[] = [
      'translation', 
      'definition', 
      'sentence',
      'listening'
    ];
    const type = types[Math.floor(Math.random() * types.length)];

    let options: string[] = [];
    let correctAnswer = "";
    let questionText = "";
    let hintText = word.pronunciation;

    if (type === 'translation') {
      correctAnswer = word.translation;
      questionText = `What is the meaning of the word "${word.word}"?`;
      const potentialWrongs = allWords.filter(w => w.id !== word.id).map(w => w.translation);
      const shuffledWrongs = potentialWrongs.sort(() => 0.5 - Math.random()).slice(0, 3);
      options = [correctAnswer, ...shuffledWrongs].sort(() => 0.5 - Math.random());
    } 
    else if (type === 'definition') {
      correctAnswer = word.word;
      questionText = `Which word matches the following definition?\n"${word.definition}"`;
      const potentialWrongs = allWords.filter(w => w.id !== word.id).map(w => w.word);
      const shuffledWrongs = potentialWrongs.sort(() => 0.5 - Math.random()).slice(0, 3);
      options = [correctAnswer, ...shuffledWrongs].sort(() => 0.5 - Math.random());
    }
    else if (type === 'listening') {
      const isWordMatch = Math.random() > 0.4;
      if (isWordMatch) {
        correctAnswer = word.word;
        questionText = `Listen to the audio clip and select the correct matching word:`;
        const potentialWrongs = allWords.filter(w => w.id !== word.id).map(w => w.word);
        const shuffledWrongs = potentialWrongs.sort(() => 0.5 - Math.random()).slice(0, 3);
        
        // Add confusing sound-alike or morphological distractor variations if deck is small
        const confusers = [
          word.word + "s",
          word.word + "ing",
          word.word.slice(0, Math.max(1, word.word.length - 1)) + "ed",
          "un" + word.word,
          "re" + word.word
        ];
        for (const conf of confusers) {
          if (shuffledWrongs.length >= 3) break;
          if (conf !== correctAnswer && !shuffledWrongs.includes(conf)) {
            shuffledWrongs.push(conf);
          }
        }
        options = [correctAnswer, ...shuffledWrongs].sort(() => 0.5 - Math.random());
      } else {
        correctAnswer = word.translation;
        questionText = `Listen carefully to the spoken word and select its correct translation:`;
        const potentialWrongs = allWords.filter(w => w.id !== word.id).map(w => w.translation);
        const shuffledWrongs = potentialWrongs.sort(() => 0.5 - Math.random()).slice(0, 3);
        options = [correctAnswer, ...shuffledWrongs].sort(() => 0.5 - Math.random());
      }
    }
    else {
      correctAnswer = word.word;
      const regex = new RegExp(`\\b${word.word}\\b`, "i");
      const hiddenSentence = word.example.replace(regex, "______");
      questionText = `Fill in the blank for the sentence:\n"${hiddenSentence}"\n\n(${word.exampleTranslation})`;
      const potentialWrongs = allWords.filter(w => w.id !== word.id).map(w => w.word);
      const shuffledWrongs = potentialWrongs.sort(() => 0.5 - Math.random()).slice(0, 3);
      options = [correctAnswer, ...shuffledWrongs].sort(() => 0.5 - Math.random());
    }

    generated.push({
      id: `q-${word.id}`,
      wordId: word.id,
      word: word.word,
      type,
      question: questionText,
      options,
      correctAnswer,
      hint: hintText
    });
  });

  return generated.sort(() => 0.5 - Math.random());
}

export default function QuizView({
  deck,
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
  const [autoPlayAudio, setAutoPlayAudio] = useState(ttsConfig?.autoPlayAudioInQuiz ?? false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [starFeedback, setStarFeedback] = useState<string | null>(null);

  // Advanced speak helper using configured TTS service
  const speakText = (text: string, customLang?: string) => {
    const cleanText = text
      .replace(/______/g, "blank")
      .replace(/\n\n/g, ". ")
      .replace(/\n/g, ", ");

    const targetLang = deck?.targetLanguage;
    let langCode = "en-US";
    if (customLang) {
      langCode = customLang;
    } else if (targetLang === "Spanish") {
      langCode = "es-ES";
    } else if (targetLang === "French") {
      langCode = "fr-FR";
    } else if (targetLang === "German") {
      langCode = "de-DE";
    } else if (targetLang === "Japanese") {
      langCode = "ja-JP";
    } else if (targetLang === "Chinese") {
      langCode = "zh-CN";
    }

    speakTextService(
      cleanText,
      ttsConfig,
      llmConfig,
      langCode,
      () => setIsSpeaking(true),
      () => setIsSpeaking(false)
    );
  };

  // Generate the quiz when deck is available
  useEffect(() => {
    if (!deck || deck.words.length < 2) return;
    const generated = generateQuizQuestions(deck);
    setQuestions(generated);
    setCurrentQuestionIdx(0);
    setSelectedAnswer(null);
    setTypedAnswer("");
    setIsAnswered(false);
    setScore(0);
    setShowSummary(false);
    setWrongAnswersList([]);
  }, [deck]);

  // Auto-read question or spoken word when switching questions
  useEffect(() => {
    if (questions.length > 0 && currentQuestionIdx < questions.length && !showSummary) {
      const currQ = questions[currentQuestionIdx];
      if (currQ) {
        if (currQ.type === 'listening') {
          const timer = setTimeout(() => {
            speakText(currQ.word);
          }, 350);
          return () => clearTimeout(timer);
        } else if (autoPlayAudio) {
          const timer = setTimeout(() => {
            speakText(currQ.question);
          }, 300);
          return () => clearTimeout(timer);
        }
      }
    }
  }, [currentQuestionIdx, autoPlayAudio, showSummary, questions]);

  if (!deck || deck.words.length < 2 || questions.length === 0) {
    if (deck && deck.words.length >= 2 && questions.length === 0) {
      return (
        <div className="bg-white p-12 border border-stone-200 text-center space-y-6 max-w-md mx-auto rounded-none">
          <div className="w-8 h-8 border-2 border-stone-900 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs text-stone-500 font-serif italic">Preparing practice quiz...</p>
        </div>
      );
    }

    return (
      <div className="bg-white p-12 border border-stone-200 text-center space-y-6 max-w-md mx-auto rounded-none" id="no-words-for-quiz">
        <AlertCircle className="w-16 h-16 text-stone-300 mx-auto" />
        <h3 className="text-sm font-bold text-stone-900 uppercase tracking-widest">Lacking Vocabulary Items</h3>
        <p className="text-xs text-stone-400 font-serif italic">"A deck needs at least 2 words to generate an interactive practice quiz."</p>
        <button 
          onClick={onGoBack}
          className="px-6 py-3 bg-stone-900 text-white font-bold text-xs uppercase tracking-widest hover:bg-black transition-colors cursor-pointer rounded-none"
        >
          Go Back
        </button>
      </div>
    );
  }

  const currentQuestion = questions[currentQuestionIdx];

  const handleOptionSelect = (option: string) => {
    if (isAnswered) return;
    setSelectedAnswer(option);
  };

  const handleVerify = () => {
    if (isAnswered) return;
    
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

    // Auto voice feedback upon answer verification
    if (autoPlayAudio) {
      setTimeout(() => {
        if (isCorrect) {
          speakText(`Correct! ${currentQuestion.correctAnswer}`);
        } else {
          speakText(`Incorrect. The answer is ${currentQuestion.correctAnswer}`);
        }
      }, 250);
    }
  };

  const handleNext = () => {
    setSelectedAnswer(null);
    setTypedAnswer("");
    setIsAnswered(false);

    if (currentQuestionIdx < questions.length - 1) {
      setCurrentQuestionIdx(prev => prev + 1);
    } else {
      setShowSummary(true);
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
    if (!onToggleStar || !deck) return;
    const missedWordIds = wrongAnswersList
      .map(item => item.question?.wordId)
      .filter(Boolean) as string[];

    let starredCount = 0;
    missedWordIds.forEach(id => {
      const wordObj = deck.words.find(w => w.id === id);
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

  if (showSummary && deck) {
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
                "Performance analysis for deck: {deck.name}. Study performance and learning strategies below."
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
                    <div className="flex items-center gap-2 text-stone-900 font-bold text-xs uppercase tracking-wider">
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
                  <span className="text-[11px] font-bold text-stone-500 uppercase tracking-widest">
                    Detailed Item Breakdown ({wrongAnswersList.length})
                  </span>
                  <span className="text-[10px] text-stone-400 italic">
                    Click audio to listen • Click star to prioritize
                  </span>
                </div>

                <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
                  {wrongAnswersList.map((item, idx) => {
                    const matchingWordObj = deck.words.find(w => w.id === item.question?.wordId);
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
                              <span className="text-[9px] text-stone-500 font-bold uppercase tracking-widest bg-stone-200 px-1.5 py-0.5">
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
                            <span className="text-[9px] font-bold uppercase tracking-wider text-red-500 block mb-0.5">Your Choice:</span>
                            <span className="line-through font-semibold">{item.wrongPicked || "(No input)"}</span>
                          </div>

                          <div className="bg-emerald-50/50 p-2 border border-emerald-100 text-emerald-950 font-mono">
                            <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-600 block mb-0.5">Correct Target:</span>
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
                            {item.question.type === 'translation' && (
                              <span>Associate <strong>{item.question.word}</strong> directly with its translation <strong>"{matchingWordObj?.translation}"</strong> using image associations.</span>
                            )}
                            {item.question.type === 'sentence' && (
                              <span>Read the full example sentence out loud 2 times with <strong>{item.question.word}</strong> inserted in context.</span>
                            )}
                            {item.question.type === 'listening' && (
                              <span>Listen to <strong>{item.question.word}</strong> repeatedly using the audio button and repeat the pronunciation aloud until comfortable.</span>
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
                  onClick={() => {
                    if (deck && deck.words.length >= 2) {
                      const generated = generateQuizQuestions(deck);
                      setQuestions(generated);
                      setCurrentQuestionIdx(0);
                      setSelectedAnswer(null);
                      setTypedAnswer("");
                      setIsAnswered(false);
                      setScore(0);
                      setShowSummary(false);
                      setWrongAnswersList([]);
                    }
                  }}
                  className="flex-1 py-3 border border-stone-300 hover:border-stone-900 bg-stone-50 text-stone-800 font-bold text-xs uppercase tracking-widest rounded-none transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4" /> Full Quiz Retake
                </button>
              </>
            ) : (
              <button
                onClick={() => {
                  if (deck && deck.words.length >= 2) {
                    const generated = generateQuizQuestions(deck);
                    setQuestions(generated);
                    setCurrentQuestionIdx(0);
                    setSelectedAnswer(null);
                    setTypedAnswer("");
                    setIsAnswered(false);
                    setScore(0);
                    setShowSummary(false);
                    setWrongAnswersList([]);
                  }
                }}
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
  const wordDetails = deck?.words?.find(w => w.id === currentQuestion?.wordId);

  return (
    <div className="max-w-2xl mx-auto space-y-6" id="quiz-question-view">
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
          
          <span className="text-xs font-mono font-bold text-stone-900 bg-stone-50 border border-stone-200 px-2.5 py-1 rounded-none shrink-0">
            Question {currentQuestionIdx + 1} of {questions.length}
          </span>
        </div>

        {/* Title & Score & Voice Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
          <div>
            <h3 className="text-lg sm:text-xl font-bold tracking-tight text-stone-900">
              {deck.name.toLowerCase().includes("practice") ? deck.name : `${deck.name} Practice`}
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
                  window.speechSynthesis?.cancel();
                  setIsSpeaking(false);
                } else if (currentQuestion) {
                  speakText(currentQuestion.question);
                }
              }}
              className={`px-2.5 py-1.5 border text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 cursor-pointer transition-all whitespace-nowrap ${
                isSpeaking 
                  ? "bg-amber-100 border-amber-400 text-amber-900 animate-pulse" 
                  : "bg-white border-stone-200 text-stone-800 hover:border-stone-900"
              }`}
              title="Listen to question"
            >
              <Volume2 className="w-3.5 h-3.5 text-stone-900 shrink-0" />
              <span>{isSpeaking ? "Speaking" : "Read"}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                const nextVal = !autoPlayAudio;
                setAutoPlayAudio(nextVal);
                if (!nextVal && window.speechSynthesis) {
                  window.speechSynthesis.cancel();
                  setIsSpeaking(false);
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
          <span className="text-[10px] font-bold tracking-widest text-stone-800 bg-stone-50 border border-stone-200 px-3 py-1 uppercase font-mono rounded-none">
            {currentQuestion.type === 'translation' && "Meaning Quiz"}
            {currentQuestion.type === 'definition' && "Definition Match"}
            {currentQuestion.type === 'sentence' && "Context Filler"}
            {currentQuestion.type === 'spelling' && "Spelling Challenge"}
            {currentQuestion.type === 'listening' && "Listening Skill"}
          </span>
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
            onClick={() => speakText(currentQuestion.type === 'listening' ? currentQuestion.word : currentQuestion.question)}
            className="p-2.5 bg-stone-50 border border-stone-200 hover:border-stone-900 hover:bg-stone-100 text-stone-800 transition-all cursor-pointer shrink-0"
            title="Read aloud"
          >
            <Volume2 className="w-4 h-4 text-stone-900" />
          </button>
        </div>

        {/* Dedicated Listening Audio Card */}
        {currentQuestion.type === 'listening' && (
          <div className="bg-amber-50/70 border border-amber-200 p-4 sm:p-6 flex flex-col sm:flex-row items-center justify-between gap-4 my-2">
            <div className="flex items-center gap-3 w-full sm:w-auto">
              <button
                type="button"
                onClick={() => speakText(currentQuestion.word)}
                className={`w-12 h-12 sm:w-14 sm:h-14 rounded-none bg-stone-900 text-amber-400 hover:bg-stone-800 transition-all flex items-center justify-center cursor-pointer shrink-0 ${
                  isSpeaking ? "animate-pulse ring-2 ring-amber-400" : ""
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
                <p className="text-xs text-stone-600 mt-0.5 font-serif italic">
                  {isSpeaking ? "Playing audio..." : "Tap button to replay spoken word"}
                </p>
              </div>
            </div>
            
            <button
              type="button"
              onClick={() => speakText(currentQuestion.word)}
              className="w-full sm:w-auto px-4 py-2.5 bg-stone-900 hover:bg-stone-800 text-amber-400 font-bold text-[10px] uppercase tracking-widest flex items-center justify-center gap-1.5 cursor-pointer transition-all shrink-0"
            >
              <Volume2 className="w-3.5 h-3.5" /> Replay Sound
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
                  onChange={(e) => setTypedAnswer(e.target.value)}
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
                  onClick={() => speakText(currentQuestion.word)}
                  className="p-3 bg-stone-50 border border-stone-200 hover:border-stone-900 text-stone-900 transition-all cursor-pointer shrink-0"
                  title="Listen word to spell"
                >
                  <Volume2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ) : (
            /* Multiple Choice Buttons */
            <div className="grid grid-cols-1 gap-3">
              {currentQuestion.options?.map((option, idx) => {
                const isSelected = selectedAnswer === option;
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
                          speakText(option);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.stopPropagation();
                            speakText(option);
                          }
                        }}
                        className="p-1 text-stone-400 hover:text-stone-900 hover:bg-stone-200/60 rounded-none transition-all cursor-pointer"
                        title="Speak option aloud"
                      >
                        <Volume2 className="w-3.5 h-3.5" />
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

        {/* Dynamic Verification Feedback Block */}
        <AnimatePresence>
          {isAnswered && (
            <motion.div 
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              className="p-5 rounded-none flex items-start gap-4 border bg-stone-50 border-stone-200 text-stone-800 justify-between"
            >
              <div className="flex items-start gap-4">
                {(currentQuestion.type === 'spelling' 
                  ? typedAnswer.toLowerCase().trim() === currentQuestion.correctAnswer.toLowerCase().trim()
                  : selectedAnswer === currentQuestion.correctAnswer) ? (
                  <>
                    <Check className="w-5 h-5 text-stone-900 shrink-0 mt-0.5 stroke-[3]" />
                    <div className="space-y-1">
                      <h5 className="font-bold text-[10px] uppercase tracking-widest text-stone-900">Correct Response</h5>
                      <p className="text-xs text-stone-500 font-serif italic mt-1">
                        "{wordDetails?.word}" matches the definition: "{wordDetails?.definition}".
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <X className="w-5 h-5 text-stone-400 shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <h5 className="font-bold text-[10px] uppercase tracking-widest text-stone-400">Incorrect Response</h5>
                      <p className="text-xs text-stone-500 font-serif italic mt-1">
                        The correct match is: <strong className="font-bold text-stone-900">"{currentQuestion.correctAnswer}"</strong>.
                      </p>
                    </div>
                  </>
                )}
              </div>

              <button
                type="button"
                onClick={() => speakText(`The answer is ${currentQuestion.correctAnswer}. ${wordDetails?.definition || ""}`)}
                className="p-2 bg-white border border-stone-200 hover:border-stone-900 text-stone-800 transition-all cursor-pointer shrink-0"
                title="Speak answer and definition"
              >
                <Volume2 className="w-4 h-4" />
              </button>
            </motion.div>
          )}
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
