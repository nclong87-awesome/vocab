import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Sparkles, 
  Flame, 
  BookOpen, 
  CheckCircle, 
  GraduationCap, 
  Plus, 
  Compass, 
  Globe2, 
  ArrowRight,
  Trash2,
  Calendar
} from "lucide-react";
import { Deck, UserStats, Word } from "../types";
import QuizView from "./QuizView";

interface DashboardProps {
  stats: UserStats;
  decks: Deck[];
  todayPracticeDeck: Deck;
  onSelectDeck: (deckId: string) => void;
  onSelectTab: (tab: "learn" | "quiz" | "decks") => void;
  onGenerateDeck: (topic: string, targetLanguage: string, nativeLanguage: string, quantity: number) => Promise<void>;
  onDeleteDeck: (deckId: string) => void;
  isLoading: boolean;
  loadingMessage: string;
  onFinishQuiz: (score: number, total: number, correctWordIds?: string[], incorrectWordIds?: string[]) => void;
}

const PRESET_TOPICS = [
  { label: "Travel & Airport", emoji: "✈️", topic: "Airport transit, lodging, exploring cities, and dining out" },
  { label: "Business English", emoji: "💼", topic: "Professional business vocabulary, corporate meetings, negotiations, and leadership" },
  { label: "Tech & Artificial Intelligence", emoji: "🤖", topic: "Modern artificial intelligence, coding, technology, web dev, and cybersecurity" },
  { label: "Everyday Slang & Idioms", emoji: "💬", topic: "Informal street expressions, idioms, and causal slang used by native speakers" },
  { label: "Culinary & Dining", emoji: "🍳", topic: "Gourmet terms, cooking methods, kitchen tools, and restaurant interactions" },
  { label: "Academic / TOEFL High-Scoring", emoji: "🎓", topic: "Advanced vocabulary for university lectures, TOEFL preparation, and research" },
];

const LANGUAGES = [
  { code: "English", name: "English" },
  { code: "Spanish", name: "Spanish (Español)" },
  { code: "French", name: "French (Français)" },
  { code: "German", name: "German (Deutsch)" },
  { code: "Italian", name: "Italian (Italiano)" },
  { code: "Vietnamese", name: "Vietnamese (Tiếng Việt)" },
  { code: "Japanese", name: "Japanese (日本語)" },
  { code: "Korean", name: "Korean (한국어)" },
  { code: "Chinese", name: "Chinese (中文)" },
];

export default function Dashboard({
  stats,
  decks,
  todayPracticeDeck,
  onSelectDeck,
  onSelectTab,
  onGenerateDeck,
  onDeleteDeck,
  isLoading,
  loadingMessage,
  onFinishQuiz,
}: DashboardProps) {
  const [customTopic, setCustomTopic] = useState("");
  const [targetLanguage, setTargetLanguage] = useState("English");
  const [nativeLanguage, setNativeLanguage] = useState("Spanish");
  const [quantity, setQuantity] = useState(8);

  // Today's practice quiz states
  const [isQuizActive, setIsQuizActive] = useState(false);
  const [completedToday, setCompletedToday] = useState<boolean>(() => {
    const today = new Date().toISOString().split("T")[0];
    return localStorage.getItem("last_completed_daily_quiz_date") === today;
  });
  const [sessionScore, setSessionScore] = useState<{ score: number; total: number } | null>(null);

  const handleDailyQuizFinish = (score: number, total: number, correctWordIds?: string[], incorrectWordIds?: string[]) => {
    const today = new Date().toISOString().split("T")[0];
    localStorage.setItem("last_completed_daily_quiz_date", today);
    setCompletedToday(true);
    setIsQuizActive(false);
    setSessionScore({ score, total });
    onFinishQuiz(score, total, correctWordIds, incorrectWordIds);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const topic = customTopic.trim();
    if (!topic) return;
    onGenerateDeck(topic, targetLanguage, nativeLanguage, quantity);
    setCustomTopic("");
  };

  const handlePresetClick = (topic: string) => {
    onGenerateDeck(topic, targetLanguage, nativeLanguage, quantity);
  };

  // Helper to check study calendar history
  const getPastSevenDays = () => {
    const days = [];
    const date = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(date);
      d.setDate(date.getDate() - i);
      const str = d.toISOString().split("T")[0];
      days.push({
        dateStr: str,
        dayName: d.toLocaleDateString(undefined, { weekday: "short" }),
        dayNum: d.getDate(),
        studied: stats.streak.history.includes(str)
      });
    }
    return days;
  };

  const pastSevenDays = getPastSevenDays();

  return (
    <div className="space-y-12" id="dashboard-container">
      {/* Loading Overlay */}
      <AnimatePresence>
        {isLoading && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-stone-950/90 backdrop-blur-sm z-50 flex flex-col items-center justify-center p-6 text-center"
            id="loading-overlay"
          >
            <div className="relative mb-8">
              <motion.div 
                animate={{ rotate: 360 }}
                transition={{ repeat: Infinity, duration: 4, ease: "linear" }}
                className="w-24 h-24 border-t border-stone-100 flex items-center justify-center"
              />
              <Sparkles className="absolute inset-0 m-auto text-stone-100 w-8 h-8 animate-pulse" />
            </div>
            <motion.h3 
              initial={{ y: 10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="text-lg font-bold tracking-widest text-white uppercase mb-3 font-sans"
            >
              Curating Vocabulary material
            </motion.h3>
            <motion.p 
              initial={{ y: 10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.4 }}
              className="text-stone-400 max-w-sm text-xs font-mono tracking-widest uppercase"
            >
              {loadingMessage}
            </motion.p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Dynamic Today's Practice Session Module */}
      {isQuizActive ? (
        <div className="bg-white border border-stone-200 p-8 md:p-12 relative" id="active-daily-quiz-container">
          <div className="flex justify-between items-center border-b border-stone-100 pb-4 mb-6">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-stone-900 text-white text-[10px] font-bold tracking-widest uppercase">
              <Sparkles className="w-3 h-3 animate-pulse" /> Active Session
            </div>
            <button 
              onClick={() => setIsQuizActive(false)}
              className="text-[10px] font-bold uppercase tracking-widest text-stone-400 hover:text-stone-900 transition-colors"
            >
              Cancel Practice
            </button>
          </div>
          <QuizView 
            deck={todayPracticeDeck}
            onFinishQuiz={handleDailyQuizFinish}
            onGoBack={() => setIsQuizActive(false)}
          />
        </div>
      ) : (
        <div className="bg-white border border-stone-200 p-8 md:p-12 relative overflow-hidden" id="hero-banner">
          <div className="relative z-10 grid grid-cols-1 md:grid-cols-12 gap-8 items-stretch">
            
            {/* Left Content Column */}
            <div className="md:col-span-8 flex flex-col justify-between space-y-6">
              <div className="space-y-4">
                <div className="inline-flex items-center gap-2 px-3 py-1 bg-stone-100 text-stone-800 text-[10px] font-bold tracking-widest uppercase border border-stone-200">
                  <Calendar className="w-3.5 h-3.5 text-stone-900" /> Today's Focus Session • {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}
                </div>
                
                {completedToday ? (
                  <div className="space-y-4" id="daily-completed-message">
                    <h1 className="text-4xl font-extralight tracking-tight text-stone-950 leading-tight">
                      Today's Practice <br />
                      <span className="font-bold text-stone-900">Completed!</span>
                    </h1>
                    <p className="text-stone-500 max-w-lg text-sm font-serif italic leading-relaxed">
                      "Congratulations! You completed today's vocabulary memory check. Your streak is secure and your recall is sharpening. Come back tomorrow for new customized material."
                    </p>
                    {sessionScore && (
                      <div className="inline-flex items-center gap-3 bg-stone-50 border border-stone-200 px-4 py-2.5">
                        <span className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">Score:</span>
                        <span className="text-sm font-bold text-stone-950 font-mono">{sessionScore.score} / {sessionScore.total} Correct</span>
                      </div>
                    )}
                    <div className="pt-2">
                      <button 
                        onClick={() => setIsQuizActive(true)}
                        className="px-6 py-3 border border-stone-200 hover:border-stone-900 bg-white transition-colors text-stone-900 font-bold text-xs uppercase tracking-widest cursor-pointer rounded-none animate-fade-in"
                        id="btn-retake-quiz"
                      >
                        Retake Daily Quiz
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4" id="daily-pending-message">
                    <h1 className="text-4xl font-extralight tracking-tight text-stone-950 leading-tight">
                      Today's Vocabulary <br />
                      <span className="font-bold">Practice Quiz</span>
                    </h1>
                    <p className="text-stone-500 max-w-lg text-sm font-serif italic leading-relaxed">
                      "Challenge your memory with {todayPracticeDeck?.words.length || 0} priority words compiled from your target languages. Finish the quiz to secure your daily streak."
                    </p>
                    
                    {/* Word Preview List */}
                    <div className="pt-2">
                      <span className="block text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-3">Words in today's session:</span>
                      <div className="flex flex-wrap gap-2 max-w-xl">
                        {todayPracticeDeck?.words.map((word) => (
                          <span 
                            key={word.id} 
                            className="px-3 py-1.5 bg-stone-50 border border-stone-200 text-xs text-stone-700 font-medium tracking-tight hover:border-stone-900 hover:text-stone-950 transition-all cursor-default"
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
                        className="px-8 py-4 bg-stone-900 hover:bg-black transition-all text-white font-bold text-xs uppercase tracking-widest flex items-center gap-3 cursor-pointer rounded-none shadow-sm hover:shadow"
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
            <div className="md:col-span-4 bg-stone-50 p-8 border border-stone-200 flex flex-col justify-between items-center text-center relative" id="streak-panel">
              <div className="my-auto space-y-4">
                <div className="relative inline-block">
                  <Flame className={`w-14 h-14 mx-auto transition-transform duration-300 hover:scale-105 ${stats.streak.count > 0 ? "text-stone-950" : "text-stone-300"}`} />
                </div>
                <div>
                  <div className="text-5xl font-extralight tracking-tight text-stone-950">{stats.streak.count} Day{stats.streak.count === 1 ? "" : "s"}</div>
                  <p className="text-[10px] text-stone-400 mt-2.5 uppercase font-bold tracking-widest">Active Study Streak</p>
                </div>
              </div>
              
              <div className="w-full pt-4 border-t border-stone-200/60 flex justify-between items-center text-[9px] font-mono font-bold text-stone-400 uppercase tracking-wider">
                <span>Completed today:</span>
                <span className={completedToday ? "text-stone-900 font-black" : "text-stone-300 font-medium"}>
                  {completedToday ? "YES ✓" : "PENDING ◯"}
                </span>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* Stats Blocks */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4" id="stats-grid">
        <div className="bg-white p-6 border border-stone-200 flex items-center gap-4">
          <div className="p-2.5 bg-stone-50 text-stone-900 border border-stone-200">
            <BookOpen className="w-5 h-5" />
          </div>
          <div>
            <div className="text-2xl font-extralight tracking-tight text-stone-950">{stats.totalWordsStudied}</div>
            <div className="text-[10px] text-stone-400 uppercase tracking-widest font-bold">Words Studied</div>
          </div>
        </div>

        <div className="bg-white p-6 border border-stone-200 flex items-center gap-4">
          <div className="p-2.5 bg-stone-50 text-stone-900 border border-stone-200">
            <CheckCircle className="w-5 h-5" />
          </div>
          <div>
            <div className="text-2xl font-extralight tracking-tight text-stone-950">{stats.totalWordsMastered}</div>
            <div className="text-[10px] text-stone-400 uppercase tracking-widest font-bold">Mastered</div>
          </div>
        </div>

        <div className="bg-white p-6 border border-stone-200 flex items-center gap-4">
          <div className="p-2.5 bg-stone-50 text-stone-900 border border-stone-200">
            <GraduationCap className="w-5 h-5" />
          </div>
          <div>
            <div className="text-2xl font-extralight tracking-tight text-stone-950">{stats.totalQuizzesTaken}</div>
            <div className="text-[10px] text-stone-400 uppercase tracking-widest font-bold">Quizzes Taken</div>
          </div>
        </div>

        <div className="bg-white p-6 border border-stone-200 flex items-center gap-4">
          <div className="w-full">
            <div className="text-[10px] text-stone-400 uppercase font-bold mb-2 tracking-widest">Activity Calendar</div>
            <div className="flex gap-2 justify-between">
              {pastSevenDays.map((day, idx) => (
                <div 
                  key={idx} 
                  className="flex flex-col items-center flex-1" 
                  title={`${day.dateStr}: ${day.studied ? "Studied" : "No activity"}`}
                >
                  <div className={`w-2 h-2 ${day.studied ? "bg-stone-900" : "bg-stone-200"}`} />
                  <span className="text-[9px] text-stone-400 font-bold mt-1.5 uppercase">{day.dayName[0]}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Decks Column */}
        <div className="lg:col-span-7 space-y-6" id="dashboard-left-column">
          <div className="flex justify-between items-center border-b border-stone-200 pb-4">
            <h2 className="text-xs font-black uppercase tracking-widest text-stone-950 flex items-center gap-2">
              Collection Decks
            </h2>
            <button 
              onClick={() => onSelectTab("decks")} 
              className="text-[10px] font-bold uppercase tracking-widest text-stone-400 hover:text-stone-950 flex items-center gap-1 cursor-pointer"
            >
              Add Custom Deck <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="space-y-6">
            {decks.length === 0 ? (
              <div className="bg-white border border-stone-200 p-12 text-center text-stone-500">
                <Compass className="w-12 h-12 text-stone-300 mx-auto mb-4" />
                <p className="font-bold text-stone-800 uppercase tracking-wider text-xs">No decks available</p>
                <p className="text-xs text-stone-400 mt-2 font-serif italic">"Design custom learning lists on the right panel to begin."</p>
              </div>
            ) : (
              decks.map((deck) => {
                const totalWords = deck.words.length;
                const masteredWords = deck.words.filter(w => w.learned).length;
                const percentMastered = totalWords > 0 ? Math.round((masteredWords / totalWords) * 100) : 0;

                return (
                  <div 
                    key={deck.id}
                    className="group bg-white p-8 border border-stone-200 hover:border-stone-900 transition-all duration-300 relative"
                    id={`deck-card-${deck.id}`}
                  >
                    <div className="flex justify-between items-start">
                      <div className="space-y-2 pr-6">
                        <div className="flex flex-wrap items-center gap-3">
                          <span className="px-2.5 py-0.5 border border-stone-200 text-stone-500 bg-stone-50 text-[9px] font-bold uppercase tracking-widest">
                            {deck.isCustom ? "Custom" : "Standard"}
                          </span>
                          <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-stone-400 flex items-center gap-1">
                            <Globe2 className="w-3.5 h-3.5" /> 
                            {deck.targetLanguage} ↔ {deck.nativeLanguage}
                          </span>
                        </div>
                        <h3 className="text-xl font-bold text-stone-900 group-hover:text-stone-700 transition-colors pt-1">
                          {deck.name}
                        </h3>
                        <p className="text-xs text-stone-400 font-serif italic max-w-lg leading-relaxed">
                          {deck.description}
                        </p>
                      </div>

                      <div className="flex items-center gap-2">
                        {deck.id.startsWith("custom-") && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if(confirm(`Are you sure you want to delete deck "${deck.name}"?`)) {
                                onDeleteDeck(deck.id);
                              }
                            }}
                            className="p-1.5 text-stone-300 hover:text-stone-900 hover:bg-stone-100 transition-all cursor-pointer"
                            title="Delete Deck"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="mt-8 grid grid-cols-1 sm:grid-cols-12 gap-4 items-center pt-6 border-t border-stone-100">
                      <div className="sm:col-span-5 flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-stone-500">
                        <GraduationCap className="w-4 h-4 text-stone-900" />
                        <span>{totalWords} Words</span>
                        <span className="text-stone-200">•</span>
                        <span className="text-stone-900">{masteredWords} mastered</span>
                      </div>

                      <div className="sm:col-span-4 flex items-center gap-3 w-full">
                        <div className="h-[2px] bg-stone-100 flex-1 overflow-hidden">
                          <div 
                            className="h-full bg-stone-900 transition-all duration-500" 
                            style={{ width: `${percentMastered}%` }}
                          />
                        </div>
                        <span className="text-[10px] font-mono font-bold text-stone-500 w-8 text-right">
                          {percentMastered}%
                        </span>
                      </div>

                      <div className="sm:col-span-3 flex gap-2 justify-end">
                        <button
                          onClick={() => onSelectDeck(deck.id)}
                          className="px-4 py-2 border border-stone-200 hover:border-stone-900 bg-white transition-colors text-stone-900 text-[10px] font-bold uppercase tracking-widest cursor-pointer"
                        >
                          Learn
                        </button>
                        <button
                          onClick={() => {
                            onSelectDeck(deck.id);
                            onSelectTab("quiz");
                          }}
                          className="px-4 py-2 bg-stone-900 hover:bg-black transition-colors text-white text-[10px] font-bold uppercase tracking-widest cursor-pointer"
                        >
                          Quiz
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* AI Generator Column */}
        <div className="lg:col-span-5" id="dashboard-right-column">
          <div 
            className="bg-white border border-stone-200 p-8 space-y-8 sticky top-6"
            id="ai-deck-builder"
          >
            <div className="flex items-center gap-3 pb-4 border-b border-stone-100">
              <div className="p-2.5 bg-stone-50 text-stone-900 border border-stone-200">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-xs uppercase tracking-widest text-stone-950">AI Deck Generator</h3>
                <p className="text-[10px] text-stone-400 uppercase tracking-wider font-bold mt-0.5">Let Gemini curate unique study decks</p>
              </div>
            </div>

            {/* Language Selection */}
            <div className="grid grid-cols-2 gap-4 text-[10px] uppercase tracking-widest font-bold">
              <div>
                <label className="block text-stone-400 mb-2">Target Language</label>
                <select 
                  value={targetLanguage} 
                  onChange={(e) => setTargetLanguage(e.target.value)}
                  className="w-full border border-stone-200 bg-stone-50 px-3 py-2.5 font-bold text-stone-800 outline-none focus:border-stone-950 focus:bg-white transition-all cursor-pointer text-xs"
                  id="select-target-lang"
                >
                  {LANGUAGES.map(lang => (
                    <option key={lang.code} value={lang.code}>{lang.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-stone-400 mb-2">Native Language</label>
                <select 
                  value={nativeLanguage} 
                  onChange={(e) => setNativeLanguage(e.target.value)}
                  className="w-full border border-stone-200 bg-stone-50 px-3 py-2.5 font-bold text-stone-800 outline-none focus:border-stone-950 focus:bg-white transition-all cursor-pointer text-xs"
                  id="select-native-lang"
                >
                  {LANGUAGES.map(lang => (
                    <option key={lang.code} value={lang.code}>{lang.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Quantity */}
            <div className="text-[10px] uppercase tracking-widest font-bold">
              <label className="block text-stone-400 mb-2">Deck Size</label>
              <div className="flex gap-2">
                {[5, 8, 12].map((num) => (
                  <button
                    key={num}
                    type="button"
                    onClick={() => setQuantity(num)}
                    className={`flex-1 py-2 border text-center font-bold transition-all text-xs cursor-pointer ${
                      quantity === num 
                        ? "border-stone-950 bg-stone-950 text-white" 
                        : "border-stone-200 bg-stone-50 text-stone-400 hover:border-stone-400 hover:text-stone-900"
                    }`}
                  >
                    {num} Words
                  </button>
                ))}
              </div>
            </div>

            {/* Custom Topic Form */}
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="text-[10px] uppercase tracking-widest font-bold">
                <label className="block text-stone-400 mb-2">Custom Topic</label>
                <div className="relative">
                  <input
                    type="text"
                    value={customTopic}
                    onChange={(e) => setCustomTopic(e.target.value)}
                    placeholder="e.g., Medical jargon, Bakery terminology"
                    className="w-full border border-stone-200 bg-stone-50 pl-3 pr-12 py-3 font-semibold text-stone-800 outline-none focus:border-stone-950 focus:bg-white transition-all text-xs"
                    id="input-custom-topic"
                  />
                  <button
                    type="submit"
                    disabled={!customTopic.trim() || isLoading}
                    className="absolute right-1.5 top-1.5 p-2 bg-stone-900 hover:bg-black disabled:bg-stone-100 disabled:text-stone-300 text-white transition-colors cursor-pointer"
                    id="btn-submit-topic"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </form>

            {/* Preset Topics */}
            <div className="space-y-4">
              <label className="block text-[10px] uppercase tracking-widest font-bold text-stone-400">Or Select a Preset Theme</label>
              <div className="space-y-2.5 max-h-64 overflow-y-auto pr-1" id="presets-container">
                {PRESET_TOPICS.map((preset, idx) => (
                  <button
                    key={idx}
                    onClick={() => handlePresetClick(preset.label)}
                    disabled={isLoading}
                    className="w-full text-left p-4 border border-stone-100 bg-stone-50 hover:bg-stone-100 hover:border-stone-300 transition-all flex items-start gap-4 cursor-pointer group"
                  >
                    <span className="text-xl bg-white p-2 border border-stone-200 shadow-none transition-transform group-hover:scale-110">{preset.emoji}</span>
                    <div className="space-y-1">
                      <div className="text-xs font-bold text-stone-900 group-hover:text-black">
                        {preset.label}
                      </div>
                      <div className="text-[10px] text-stone-400 leading-tight font-serif italic">
                        {preset.topic}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
