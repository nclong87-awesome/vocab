import React from "react";
import { Calendar, ArrowRight, Flame, Sparkles } from "lucide-react";
import { Deck } from "../../types";
import QuizView from "../QuizView";

interface TodayFocusHeroProps {
  isQuizActive: boolean;
  setIsQuizActive: (active: boolean) => void;
  completedToday: boolean;
  sessionScore: { score: number; total: number } | null;
  todayPracticeDeck: Deck;
  onDailyQuizFinish: (score: number, total: number, correctWordIds?: string[], incorrectWordIds?: string[]) => void;
  streakCount: number;
}

export default function TodayFocusHero({
  isQuizActive,
  setIsQuizActive,
  completedToday,
  sessionScore,
  todayPracticeDeck,
  onDailyQuizFinish,
  streakCount
}: TodayFocusHeroProps) {
  if (isQuizActive) {
    return (
      <div className="bg-white border border-stone-200 p-3.5 sm:p-6 md:p-10 relative" id="active-daily-quiz-container">
        <div className="flex justify-between items-center border-b border-stone-100 pb-4 mb-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-stone-900 text-white text-xs font-medium">
            <Sparkles className="w-3.5 h-3.5 animate-pulse" /> Active Session
          </div>
          <button 
            onClick={() => setIsQuizActive(false)}
            className="text-xs font-medium text-stone-500 hover:text-stone-900 transition-colors cursor-pointer"
          >
            Cancel Practice
          </button>
        </div>
        <QuizView 
          deck={todayPracticeDeck}
          onFinishQuiz={onDailyQuizFinish}
          onGoBack={() => setIsQuizActive(false)}
        />
      </div>
    );
  }

  return (
    <div className="bg-white border border-stone-200 p-4 sm:p-8 md:p-12 relative overflow-hidden" id="hero-banner">
      <div className="relative z-10 grid grid-cols-1 md:grid-cols-12 gap-8 items-stretch">
        
        {/* Left Content Column */}
        <div className="md:col-span-8 flex flex-col justify-between space-y-6">
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-stone-100 text-stone-800 text-xs font-medium border border-stone-200">
              <Calendar className="w-3.5 h-3.5 text-stone-900" /> Today's Focus Session • {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}
            </div>
            
            {completedToday ? (
              <div className="space-y-4" id="daily-completed-message">
                <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-stone-950 leading-tight">
                  Today's Practice <br />
                  <span className="font-bold text-stone-900">Completed!</span>
                </h1>
                <p className="text-stone-600 max-w-lg text-sm font-serif italic leading-relaxed">
                  "Congratulations! You completed today's vocabulary memory check. Your streak is secure and your recall is sharpening. Come back tomorrow for new customized material."
                </p>
                {sessionScore && (
                  <div className="inline-flex items-center gap-3 bg-stone-50 border border-stone-200 px-4 py-2.5">
                    <span className="text-xs font-medium text-stone-500">Score:</span>
                    <span className="text-sm font-bold text-stone-950 font-mono">{sessionScore.score} / {sessionScore.total} Correct</span>
                  </div>
                )}
                <div className="pt-2">
                  <button 
                    onClick={() => setIsQuizActive(true)}
                    className="px-6 py-3 border border-stone-200 hover:border-stone-900 bg-white transition-colors text-stone-900 font-bold text-xs cursor-pointer rounded-none animate-fade-in"
                    id="btn-retake-quiz"
                  >
                    Retake Daily Quiz
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4" id="daily-pending-message">
                <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-stone-950 leading-tight">
                  Today's Vocabulary <br />
                  <span className="font-bold">Practice Quiz</span>
                </h1>
                <p className="text-stone-600 max-w-lg text-sm font-serif italic leading-relaxed">
                  "Challenge your memory with {todayPracticeDeck?.words.length || 0} priority words compiled from your target languages. Finish the quiz to secure your daily streak."
                </p>
                
                {/* Word Preview List */}
                <div className="pt-2">
                  <span className="block text-xs font-medium text-stone-500 mb-3">Words in today's session:</span>
                  <div className="flex flex-wrap gap-2 max-w-xl">
                    {todayPracticeDeck?.words.map((word) => (
                      <span 
                        key={word.id} 
                        className="px-3 py-1.5 bg-stone-50 border border-stone-200 text-xs text-stone-800 font-semibold tracking-tight hover:border-stone-900 hover:text-stone-950 transition-all cursor-default"
                        title={`${word.partOfSpeech}: ${word.translation}`}
                      >
                        {word.word}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="pt-4">
                  <button 
                    onClick={() => setIsQuizActive(true)}
                    className="px-8 py-4 bg-stone-900 hover:bg-black transition-all text-white font-bold text-xs flex items-center gap-3 cursor-pointer rounded-none shadow-sm hover:shadow"
                    id="btn-start-daily-quiz"
                  >
                    Start Today's Quiz <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
        
        {/* Right Streak Column */}
        <div className="md:col-span-4 bg-stone-50 p-4 sm:p-8 border border-stone-200 flex flex-col justify-between items-center text-center relative" id="streak-panel">
          <div className="my-auto space-y-4">
            <div className="relative inline-block">
              <Flame className={`w-14 h-14 mx-auto transition-transform duration-300 hover:scale-105 ${streakCount > 0 ? "text-stone-950" : "text-stone-300"}`} />
            </div>
            <div>
              <div className="text-5xl font-bold tracking-tight text-stone-950">{streakCount} Day{streakCount === 1 ? "" : "s"}</div>
              <p className="text-xs text-stone-500 mt-2.5 font-medium">Active Study Streak</p>
            </div>
          </div>
          
          <div className="w-full pt-4 border-t border-stone-200/60 flex justify-between items-center text-xs text-stone-500 font-medium">
            <span>Completed today:</span>
            <span className={completedToday ? "text-stone-900 font-bold" : "text-stone-400 font-medium"}>
              {completedToday ? "Yes ✓" : "Pending ◯"}
            </span>
          </div>
        </div>

      </div>
    </div>
  );
}
