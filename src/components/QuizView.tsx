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
  Volume2
} from "lucide-react";
import { Word, Deck, QuizQuestion } from "../types";

interface QuizViewProps {
  deck: Deck | null;
  onFinishQuiz: (score: number, total: number, correctWordIds?: string[], incorrectWordIds?: string[]) => void;
  onGoBack: () => void;
}

export default function QuizView({
  deck,
  onFinishQuiz,
  onGoBack
}: QuizViewProps) {
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [currentQuestionIdx, setCurrentQuestionIdx] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [typedAnswer, setTypedAnswer] = useState("");
  const [isAnswered, setIsAnswered] = useState(false);
  const [score, setScore] = useState(0);
  const [showSummary, setShowSummary] = useState(false);
  const [wrongAnswersList, setWrongAnswersList] = useState<{ question: QuizQuestion; wrongPicked: string }[]>([]);

  // Generate the quiz when deck is available
  useEffect(() => {
    if (!deck || deck.words.length < 2) return;

    const generated: QuizQuestion[] = [];
    const allWords = deck.words;

    allWords.forEach((word) => {
      // Pick a random question type: 'translation' | 'definition' | 'sentence' | 'spelling'
      const types: ('translation' | 'definition' | 'sentence' | 'spelling')[] = [
        'translation', 
        'definition', 
        'sentence',
        'spelling'
      ];
      const type = types[Math.floor(Math.random() * types.length)];

      // Generate options for multiple choice
      let options: string[] = [];
      let correctAnswer = "";
      let questionText = "";
      let hintText = word.pronunciation;

      if (type === 'translation') {
        correctAnswer = word.translation;
        questionText = `What is the meaning of the word "${word.word}"?`;
        
        // Pick 3 wrong options from other words' translations
        const potentialWrongs = allWords
          .filter(w => w.id !== word.id)
          .map(w => w.translation);
        
        // Shuffle wrong options
        const shuffledWrongs = potentialWrongs.sort(() => 0.5 - Math.random()).slice(0, 3);
        options = [correctAnswer, ...shuffledWrongs].sort(() => 0.5 - Math.random());
      } 
      else if (type === 'definition') {
        correctAnswer = word.word;
        questionText = `Which word matches the following definition?\n"${word.definition}"`;

        // Pick 3 wrong options from other words
        const potentialWrongs = allWords
          .filter(w => w.id !== word.id)
          .map(w => w.word);

        const shuffledWrongs = potentialWrongs.sort(() => 0.5 - Math.random()).slice(0, 3);
        options = [correctAnswer, ...shuffledWrongs].sort(() => 0.5 - Math.random());
      }
      else if (type === 'sentence') {
        correctAnswer = word.word;
        // Hide the word in the example sentence
        const regex = new RegExp(`\\b${word.word}\\b`, "i");
        const hiddenSentence = word.example.replace(regex, "______");
        
        questionText = `Fill in the blank for the sentence:\n"${hiddenSentence}"\n\n(${word.exampleTranslation})`;

        // Pick 3 wrong options from other words
        const potentialWrongs = allWords
          .filter(w => w.id !== word.id)
          .map(w => w.word);

        const shuffledWrongs = potentialWrongs.sort(() => 0.5 - Math.random()).slice(0, 3);
        options = [correctAnswer, ...shuffledWrongs].sort(() => 0.5 - Math.random());
      }
      else {
        // spelling (typing question)
        correctAnswer = word.word.toLowerCase().trim();
        questionText = `Spell the word defined as:\n"${word.definition}"\n\nTranslation: ${word.translation}`;
      }

      generated.push({
        id: `q-${word.id}`,
        wordId: word.id,
        word: word.word,
        type,
        question: questionText,
        options: type !== 'spelling' ? options : undefined,
        correctAnswer,
        hint: hintText
      });
    });

    // Shuffle the entire questions deck
    setQuestions(generated.sort(() => 0.5 - Math.random()));
    setCurrentQuestionIdx(0);
    setSelectedAnswer(null);
    setTypedAnswer("");
    setIsAnswered(false);
    setScore(0);
    setShowSummary(false);
    setWrongAnswersList([]);
  }, [deck]);

  if (!deck || deck.words.length < 2) {
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
  };

  const handleNext = () => {
    setSelectedAnswer(null);
    setTypedAnswer("");
    setIsAnswered(false);

    if (currentQuestionIdx < questions.length - 1) {
      setCurrentQuestionIdx(prev => prev + 1);
    } else {
      setShowSummary(true);
      const incorrectWordIds = wrongAnswersList.map(item => item.question.wordId);
      const correctWordIds = questions
        .filter(q => !incorrectWordIds.includes(q.wordId))
        .map(q => q.wordId);
      onFinishQuiz(score, questions.length, correctWordIds, incorrectWordIds);
    }
  };

  // Play audio helper
  const playWordAudio = (wordText: string) => {
    if (!window.speechSynthesis) return;
    const utterance = new SpeechSynthesisUtterance(wordText);
    utterance.lang = deck.targetLanguage === "English" ? "en-US" : "es-ES";
    window.speechSynthesis.speak(utterance);
  };

  if (showSummary) {
    const successRate = Math.round((score / questions.length) * 100);
    const perfectScore = score === questions.length;

    return (
      <div className="max-w-2xl mx-auto space-y-8" id="quiz-summary-view">
        <motion.div 
          initial={{ scale: 0.98, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="bg-white border border-stone-200 p-12 text-center space-y-8 rounded-none"
        >
          {/* Trophy Display */}
          <div className="relative inline-block">
            <div className="w-20 h-20 bg-stone-50 border border-stone-200 rounded-full flex items-center justify-center text-stone-900 mx-auto">
              <Trophy className="w-10 h-10" />
            </div>
            {perfectScore && (
              <Sparkles className="absolute -top-1 -right-1 text-stone-900 w-6 h-6" />
            )}
          </div>

          <div className="space-y-2">
            <h2 className="text-2xl font-extralight tracking-tight text-stone-900">Quiz Complete</h2>
            <p className="text-xs text-stone-400 font-serif italic max-w-sm mx-auto">
              "You have studied {deck.name}. Review your performance analysis below."
            </p>
          </div>

          {/* Core Results Block */}
          <div className="grid grid-cols-2 gap-4 max-w-sm mx-auto pt-4">
            <div className="bg-stone-50 p-6 border border-stone-200 rounded-none">
              <div className="text-3xl font-extralight tracking-tight text-stone-950">{score} / {questions.length}</div>
              <span className="text-[10px] font-bold text-stone-400 uppercase tracking-widest mt-1.5 block">Correct</span>
            </div>
            <div className="bg-stone-50 p-6 border border-stone-200 rounded-none">
              <div className="text-3xl font-extralight tracking-tight text-stone-950">{successRate}%</div>
              <span className="text-[10px] font-bold text-stone-400 uppercase tracking-widest mt-1.5 block">Accuracy</span>
            </div>
          </div>

          {/* Recap list */}
          {wrongAnswersList.length > 0 && (
            <div className="text-left space-y-4 pt-6 border-t border-stone-200">
              <div className="flex items-center gap-1.5 text-[10px] font-bold text-stone-400 uppercase tracking-widest">
                <AlertCircle className="w-4 h-4 text-stone-900" />
                <span>Review Recommendations ({wrongAnswersList.length} items)</span>
              </div>
              <div className="space-y-3 max-h-60 overflow-y-auto pr-1">
                {wrongAnswersList.map((item, idx) => {
                  const matchingWordObj = deck.words.find(w => w.id === item.question.wordId);
                  return (
                    <div 
                      key={idx} 
                      className="bg-stone-50 p-4 border border-stone-200 rounded-none text-xs flex justify-between items-center"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-stone-900 text-sm">{item.question.word}</span>
                          <span className="text-[9px] text-stone-400 font-bold uppercase tracking-widest">({matchingWordObj?.partOfSpeech})</span>
                        </div>
                        <div className="text-stone-500 font-serif italic">
                          "{matchingWordObj?.definition}"
                        </div>
                        <div className="text-stone-400 text-[10px] font-mono">
                          Answered: <span className="text-stone-800 line-through font-bold">{item.wrongPicked}</span>
                        </div>
                      </div>
                      <button
                        onClick={() => playWordAudio(item.question.word)}
                        className="p-2 border border-stone-200 hover:border-stone-900 text-stone-400 hover:text-stone-900 rounded-none transition-all cursor-pointer"
                        title="Listen Spelling"
                      >
                        <Volume2 className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Action Row */}
          <div className="flex flex-col sm:flex-row gap-3 pt-4">
            <button
              onClick={() => {
                // Reset quiz
                setShowSummary(false);
                setCurrentQuestionIdx(0);
                setScore(0);
                setIsAnswered(false);
                setSelectedAnswer(null);
                setTypedAnswer("");
                setWrongAnswersList([]);
              }}
              className="flex-1 py-3 border border-stone-200 hover:border-stone-900 bg-stone-50 text-stone-800 font-bold text-xs uppercase tracking-widest rounded-none transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" /> Try Again
            </button>
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
  const wordDetails = deck.words.find(w => w.id === currentQuestion.wordId);

  return (
    <div className="max-w-2xl mx-auto space-y-6" id="quiz-question-view">
      {/* Quiz Progress header */}
      <div className="flex justify-between items-center">
        <div>
          <button 
            onClick={onGoBack}
            className="inline-flex items-center gap-1.5 text-[10px] font-bold text-stone-400 hover:text-stone-900 uppercase tracking-widest transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-3 h-3" /> Back to Study
          </button>
          <h3 className="text-xl font-extralight tracking-tight text-stone-900 mt-1">{deck.name} Practice</h3>
        </div>
        <div className="text-right">
          <span className="text-xs font-mono font-bold text-stone-900 bg-stone-50 border border-stone-200 px-3 py-1.5 rounded-none">
            Question {currentQuestionIdx + 1} of {questions.length}
          </span>
          <p className="text-[10px] text-stone-400 mt-2 uppercase font-bold tracking-widest">Score: {score}/{currentQuestionIdx}</p>
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
        className="bg-white border border-stone-200 p-8 md:p-10 space-y-8 rounded-none"
      >
        {/* Type Icon */}
        <div className="flex justify-between items-center">
          <span className="text-[10px] font-bold tracking-widest text-stone-800 bg-stone-50 border border-stone-200 px-3 py-1 uppercase font-mono rounded-none">
            {currentQuestion.type === 'translation' && "Meaning Quiz"}
            {currentQuestion.type === 'definition' && "Definition Match"}
            {currentQuestion.type === 'sentence' && "Context Filler"}
            {currentQuestion.type === 'spelling' && "Spelling Challenge"}
          </span>
          {currentQuestion.hint && (
            <div className="text-xs text-stone-400 font-mono italic">
              Pronunciation: {currentQuestion.hint}
            </div>
          )}
        </div>

        {/* Question Text */}
        <h4 className="text-lg md:text-xl font-extralight tracking-tight text-stone-950 whitespace-pre-wrap leading-relaxed font-serif italic">
          {currentQuestion.question}
        </h4>

        {/* Quiz Answer Body */}
        <div className="space-y-3 pt-2">
          {currentQuestion.type === 'spelling' ? (
            /* Spelling Input Field */
            <div className="space-y-1.5">
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
                className="w-full border border-stone-200 bg-stone-50 rounded-none px-4 py-3 font-semibold text-stone-900 outline-none focus:border-stone-950 focus:bg-white transition-all text-xs font-mono tracking-widest uppercase"
              />
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
                    <span>{option}</span>
                    <div className="flex items-center">
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
              className="p-5 rounded-none flex items-start gap-4 border bg-stone-50 border-stone-200 text-stone-800"
            >
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
