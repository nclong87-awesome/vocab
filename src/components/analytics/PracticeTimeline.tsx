import { useState, useMemo } from "react";
import { AnimatePresence } from "motion/react";
import {
  Calendar as CalendarIcon,
  Clock,
  Timer,
  CheckCircle2,
  Play,
  Volume2,
  Star,
  Search,
  BarChart3,
  Flame,
  History
} from "lucide-react";
import { Word } from "../../types";
import { getNextReviewInfo } from "../../utils/spacedRepetition";
import StrengthHistoryModal from "./StrengthHistoryModal";
import MemoryStrengthBar from "../common/MemoryStrengthBar";

interface PracticeTimelineProps {
  words: Word[];
  speakingWordId: string | null;
  onSpeakWord: (wordText: string, wordId: string) => void;
  onToggleStarWord?: (wordId: string) => void;
  onToggleLearnedWord?: (wordId: string) => void;
  onUpdateWord?: (updatedWord: Word) => void;
  onStartPractice?: (targetWords: Word[]) => void;
}

export type TimelineViewMode = "calendar" | "timeline";
export type HorizonFilter = "all" | "due" | "today" | "week" | "later" | "starred";

interface WordWithReview {
  word: Word;
  reviewInfo: ReturnType<typeof getNextReviewInfo>;
  targetDate: Date;
  daysFromNow: number; // 0 for today/due, 1 for tomorrow, etc.
  timeSlot: "due" | "morning" | "afternoon" | "evening" | "night";
}

export default function PracticeTimeline({
  words,
  speakingWordId,
  onSpeakWord,
  onToggleStarWord,
  onUpdateWord,
  onStartPractice
}: PracticeTimelineProps) {
  const [viewMode, setViewMode] = useState<TimelineViewMode>("calendar");
  const [horizonFilter, setHorizonFilter] = useState<HorizonFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDayOffset, setSelectedDayOffset] = useState<number | null>(null);
  const [inspectingWord, setInspectingWord] = useState<Word | null>(null);

  const now = useMemo(() => new Date(), []);

  // Process all words with scheduling info
  const processedWords = useMemo<WordWithReview[]>(() => {
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

    return words.map((word) => {
      const reviewInfo = getNextReviewInfo(word, now);
      const targetDate = new Date(reviewInfo.nextReviewDate);

      // Calculate calendar day offset from today (0 = today or past due, 1 = tomorrow, etc.)
      let daysFromNow = 0;
      if (reviewInfo.isDue) {
        daysFromNow = 0;
      } else {
        const startOfTarget = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate()).getTime();
        daysFromNow = Math.max(0, Math.round((startOfTarget - startOfToday) / (1000 * 60 * 60 * 24)));
      }

      // Time slot
      const hours = targetDate.getHours();
      let timeSlot: WordWithReview["timeSlot"] = "morning";
      if (reviewInfo.isDue) {
        timeSlot = "due";
      } else if (hours >= 5 && hours < 12) {
        timeSlot = "morning";
      } else if (hours >= 12 && hours < 17) {
        timeSlot = "afternoon";
      } else if (hours >= 17 && hours < 22) {
        timeSlot = "evening";
      } else {
        timeSlot = "night";
      }

      return {
        word,
        reviewInfo,
        targetDate,
        daysFromNow,
        timeSlot
      };
    });
  }, [words, now]);

  // Key Aggregated Metrics
  const metrics = useMemo(() => {
    const dueNow = processedWords.filter((w) => w.reviewInfo.isDue);
    const dueToday = processedWords.filter((w) => w.daysFromNow === 0);
    const dueTomorrow = processedWords.filter((w) => w.daysFromNow === 1);
    const dueThisWeek = processedWords.filter((w) => w.daysFromNow >= 0 && w.daysFromNow <= 7);
    const dueLater = processedWords.filter((w) => w.daysFromNow > 7);

    // Calculate average review interval (in days)
    const totalIntervalHours = processedWords.reduce((acc, w) => acc + w.reviewInfo.intervalHours, 0);
    const avgIntervalDays = processedWords.length > 0 ? (totalIntervalHours / processedWords.length / 24).toFixed(1) : "0";

    return {
      dueNow,
      dueToday,
      dueTomorrow,
      dueThisWeek,
      dueLater,
      avgIntervalDays
    };
  }, [processedWords]);

  // 14-Day Calendar Matrix Calculation
  const calendarDays = useMemo(() => {
    const days = [];
    for (let offset = 0; offset < 14; offset++) {
      const d = new Date(now);
      d.setDate(d.getDate() + offset);

      const dayWords = processedWords.filter((w) => w.daysFromNow === offset);
      const isToday = offset === 0;
      const isTomorrow = offset === 1;

      days.push({
        offset,
        date: d,
        dayName: isToday
          ? "Today"
          : isTomorrow
          ? "Tomorrow"
          : d.toLocaleDateString("en-US", { weekday: "short" }),
        formattedDate: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        words: dayWords,
        dueCount: dayWords.length,
        hasOverdue: isToday && metrics.dueNow.length > 0
      });
    }
    return days;
  }, [processedWords, now, metrics.dueNow.length]);

  const maxDayCount = useMemo(() => {
    return Math.max(1, ...calendarDays.map((d) => d.dueCount));
  }, [calendarDays]);

  // Filtered Words for the view
  const displayWords = useMemo(() => {
    let list = processedWords;

    // Apply Day Selector filter (if calendar day selected)
    if (selectedDayOffset !== null) {
      list = list.filter((w) => w.daysFromNow === selectedDayOffset);
    }

    // Apply Horizon filter
    if (horizonFilter === "due") {
      list = list.filter((w) => w.reviewInfo.isDue);
    } else if (horizonFilter === "today") {
      list = list.filter((w) => w.daysFromNow === 0);
    } else if (horizonFilter === "week") {
      list = list.filter((w) => w.daysFromNow <= 7);
    } else if (horizonFilter === "later") {
      list = list.filter((w) => w.daysFromNow > 7);
    } else if (horizonFilter === "starred") {
      list = list.filter((w) => w.word.starred);
    }

    // Apply Search Query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (item) =>
          item.word.word.toLowerCase().includes(q) ||
          item.word.definition.toLowerCase().includes(q) ||
          item.word.translation.toLowerCase().includes(q) ||
          (item.word.partOfSpeech && item.word.partOfSpeech.toLowerCase().includes(q))
      );
    }

    // Sort by scheduled review date ascending (soonest first)
    return list.sort((a, b) => {
      // Due now words first
      if (a.reviewInfo.isDue !== b.reviewInfo.isDue) {
        return a.reviewInfo.isDue ? -1 : 1;
      }
      return a.targetDate.getTime() - b.targetDate.getTime();
    });
  }, [processedWords, selectedDayOffset, horizonFilter, searchQuery]);

  const handleStartPracticeDue = () => {
    const targetWords = metrics.dueNow.length > 0 ? metrics.dueNow.map((w) => w.word) : processedWords.slice(0, 10).map((w) => w.word);
    if (onStartPractice && targetWords.length > 0) {
      onStartPractice(targetWords);
    }
  };

  const formatTargetFull = (date: Date) => {
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true
    });
  };

  return (
    <div className="space-y-6" id="practice-timeline-container">
      {/* Overview Cards & Practice Action Banner */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3.5">
        {/* Due Now Action Card */}
        <div className="md:col-span-2 bg-stone-900 text-white p-5 rounded-2xl flex flex-col justify-between shadow-sm relative overflow-hidden">
          <div className="space-y-2 z-10">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 bg-amber-400 text-stone-950 px-2.5 py-0.5 text-[9px] font-black uppercase tracking-wider rounded-md">
                <Flame className="w-3 h-3 text-stone-950" />
                <span>Immediate Practice</span>
              </span>
              <span className="text-xs font-mono text-amber-400 font-bold">
                {metrics.dueNow.length} {metrics.dueNow.length === 1 ? "word" : "words"} ready
              </span>
            </div>

            <h3 className="text-xl font-bold tracking-tight text-stone-100">
              {metrics.dueNow.length > 0
                ? `${metrics.dueNow.length} Words Eligible for Review`
                : "All Vocabulary Current"}
            </h3>
            <p className="text-xs text-stone-300 font-serif italic max-w-md leading-relaxed">
              {metrics.dueNow.length > 0
                ? "These words have reached their spaced repetition review milestone. Practicing now reinforces long-term memory."
                : "Great job! All your words are spaced out ahead. You can still do an early practice refresher anytime."}
            </p>
          </div>

          <div className="pt-4 mt-2 border-t border-stone-800 flex items-center justify-between gap-3 z-10">
            <div className="text-[11px] text-stone-400 font-mono">
              Avg. Interval: <strong className="text-white">{metrics.avgIntervalDays} days</strong>
            </div>

            {onStartPractice && (
              <button
                onClick={handleStartPracticeDue}
                className="px-4 py-2 bg-amber-400 hover:bg-amber-300 active:scale-95 text-stone-950 font-bold text-xs rounded-xl transition-all flex items-center gap-1.5 cursor-pointer shadow-sm"
                id="start-timeline-practice-btn"
              >
                <Play className="w-3.5 h-3.5 fill-stone-950" />
                <span>{metrics.dueNow.length > 0 ? "Practice Due Words" : "Practice Flashcards"}</span>
              </button>
            )}
          </div>
        </div>

        {/* Next 24 Hours */}
        <button
          onClick={() => {
            setHorizonFilter("today");
            setSelectedDayOffset(null);
          }}
          className={`p-4 border text-left transition-all rounded-2xl space-y-2 cursor-pointer ${
            horizonFilter === "today"
              ? "bg-amber-50/50 border-amber-400 ring-2 ring-amber-400/20 shadow-xs"
              : "bg-white border-stone-200/80 hover:border-amber-300 shadow-3xs"
          }`}
        >
          <div className="flex justify-between items-center text-stone-500">
            <span className="text-[10px] font-bold uppercase tracking-wider text-amber-800">Due Today</span>
            <Clock className="w-3.5 h-3.5 text-amber-600" />
          </div>
          <div className="text-2xl font-bold text-stone-900 tracking-tight">{metrics.dueToday.length}</div>
          <p className="text-[11px] text-stone-500 font-serif italic">
            Scheduled within the next 24 hours
          </p>
        </button>

        {/* Due This Week */}
        <button
          onClick={() => {
            setHorizonFilter("week");
            setSelectedDayOffset(null);
          }}
          className={`p-4 border text-left transition-all rounded-2xl space-y-2 cursor-pointer ${
            horizonFilter === "week"
              ? "bg-indigo-50/50 border-indigo-400 ring-2 ring-indigo-400/20 shadow-xs"
              : "bg-white border-stone-200/80 hover:border-indigo-300 shadow-3xs"
          }`}
        >
          <div className="flex justify-between items-center text-stone-500">
            <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-800">Next 7 Days</span>
            <CalendarIcon className="w-3.5 h-3.5 text-indigo-600" />
          </div>
          <div className="text-2xl font-bold text-stone-900 tracking-tight">{metrics.dueThisWeek.length}</div>
          <p className="text-[11px] text-stone-500 font-serif italic">
            Scheduled for review this week
          </p>
        </button>
      </div>

      {/* Main Timeline Card Container */}
      <div className="bg-white border border-stone-200/80 p-5 sm:p-6 space-y-6 rounded-2xl shadow-3xs">
        {/* Header with View Toggle & Filters */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-stone-100 pb-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Timer className="w-4 h-4 text-amber-600" />
              <h3 className="text-base sm:text-lg font-bold text-stone-900 tracking-tight">
                Review Forecast & Spaced Timeline
              </h3>
            </div>
            <p className="text-xs text-stone-500 font-serif italic">
              Dynamic eligibility schedule based on retention streaks and memory strength.
            </p>
          </div>

          {/* View Mode Toggle */}
          <div className="flex items-center gap-1 bg-stone-100 p-1 rounded-xl shrink-0 border border-stone-200/60 self-start sm:self-auto">
            <button
              onClick={() => setViewMode("calendar")}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                viewMode === "calendar"
                  ? "bg-white text-stone-900 shadow-2xs"
                  : "text-stone-600 hover:text-stone-900"
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5" />
              <span>14-Day Calendar</span>
            </button>
            <button
              onClick={() => setViewMode("timeline")}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                viewMode === "timeline"
                  ? "bg-white text-stone-900 shadow-2xs"
                  : "text-stone-600 hover:text-stone-900"
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>Timeline Feed</span>
            </button>
          </div>
        </div>

        {/* 14-DAY CALENDAR MATRIX & DENSITY CHART */}
        {viewMode === "calendar" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-stone-700 uppercase tracking-wider text-[10px]">
                14-Day Review Load Distribution
              </span>
              <span className="text-[10px] text-stone-400 font-mono">
                Click any day column to filter vocabulary
              </span>
            </div>

            {/* Calendar Days Matrix */}
            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2">
              {calendarDays.map((day) => {
                const isSelected = selectedDayOffset === day.offset;
                const barHeightPercent = Math.max(12, Math.round((day.dueCount / maxDayCount) * 100));

                return (
                  <button
                    key={day.offset}
                    onClick={() => {
                      setSelectedDayOffset(isSelected ? null : day.offset);
                      setHorizonFilter("all");
                    }}
                    className={`p-3 rounded-xl border text-left transition-all duration-200 cursor-pointer flex flex-col justify-between h-28 relative ${
                      isSelected
                        ? "bg-stone-900 text-white border-stone-900 shadow-md ring-2 ring-stone-900/20 scale-[1.02]"
                        : day.offset === 0 && day.hasOverdue
                        ? "bg-amber-50/70 border-amber-300/80 hover:border-amber-400 text-stone-900"
                        : day.dueCount > 0
                        ? "bg-stone-50/70 border-stone-200/80 hover:border-stone-350 text-stone-900"
                        : "bg-white border-stone-200/50 opacity-65 hover:opacity-100 text-stone-700"
                    }`}
                  >
                    {/* Top Day Info */}
                    <div className="flex items-start justify-between">
                      <div>
                        <span className={`text-[10px] font-bold block ${isSelected ? "text-stone-300" : "text-stone-500"}`}>
                          {day.dayName}
                        </span>
                        <span className="text-xs font-mono font-semibold">{day.formattedDate}</span>
                      </div>
                      {day.offset === 0 && day.hasOverdue && !isSelected && (
                        <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping" />
                      )}
                    </div>

                    {/* Mini Density Bar & Word Count */}
                    <div className="space-y-1.5 mt-auto">
                      <div className="flex items-baseline justify-between">
                        <span className={`text-base font-bold font-mono ${
                          isSelected ? "text-amber-400" : day.dueCount > 0 ? "text-stone-900" : "text-stone-400"
                        }`}>
                          {day.dueCount}
                        </span>
                        <span className={`text-[9px] font-semibold ${isSelected ? "text-stone-400" : "text-stone-400"}`}>
                          {day.dueCount === 1 ? "word" : "words"}
                        </span>
                      </div>

                      {/* Visual Bar Indicator */}
                      <div className={`w-full h-1.5 rounded-full overflow-hidden ${isSelected ? "bg-stone-800" : "bg-stone-200"}`}>
                        <div
                          className={`h-full rounded-full transition-all ${
                            isSelected
                              ? "bg-amber-400"
                              : day.offset === 0 && day.hasOverdue
                              ? "bg-amber-500"
                              : day.dueCount > 0
                              ? "bg-stone-700"
                              : "bg-transparent"
                          }`}
                          style={{ width: `${barHeightPercent}%` }}
                        />
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Selected Day Status Strip */}
            {selectedDayOffset !== null && (
              <div className="p-3 bg-stone-100 border border-stone-200 rounded-xl flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-stone-900">
                    Filtered to: {calendarDays[selectedDayOffset]?.dayName} ({calendarDays[selectedDayOffset]?.formattedDate})
                  </span>
                  <span className="text-stone-500 font-mono text-[11px]">
                    • {calendarDays[selectedDayOffset]?.dueCount} words scheduled
                  </span>
                </div>
                <button
                  onClick={() => setSelectedDayOffset(null)}
                  className="text-stone-600 hover:text-stone-950 font-bold text-[11px] underline cursor-pointer"
                >
                  Clear day filter
                </button>
              </div>
            )}
          </div>
        )}

        {/* Tab Horizon & Filter Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-100 pt-4">
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              onClick={() => {
                setHorizonFilter("all");
                setSelectedDayOffset(null);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                horizonFilter === "all" && selectedDayOffset === null
                  ? "bg-stone-900 text-white shadow-3xs"
                  : "bg-stone-100 text-stone-600 hover:bg-stone-200"
              }`}
            >
              All Scheduled ({processedWords.length})
            </button>

            <button
              onClick={() => {
                setHorizonFilter("due");
                setSelectedDayOffset(null);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                horizonFilter === "due"
                  ? "bg-amber-500 text-stone-950 font-bold shadow-3xs"
                  : "bg-amber-50 text-amber-900 hover:bg-amber-100"
              }`}
            >
              Due Now ({metrics.dueNow.length})
            </button>

            <button
              onClick={() => {
                setHorizonFilter("today");
                setSelectedDayOffset(null);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                horizonFilter === "today"
                  ? "bg-stone-800 text-white shadow-3xs"
                  : "bg-stone-100 text-stone-600 hover:bg-stone-200"
              }`}
            >
              Today ({metrics.dueToday.length})
            </button>

            <button
              onClick={() => {
                setHorizonFilter("week");
                setSelectedDayOffset(null);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                horizonFilter === "week"
                  ? "bg-stone-800 text-white shadow-3xs"
                  : "bg-stone-100 text-stone-600 hover:bg-stone-200"
              }`}
            >
              This Week ({metrics.dueThisWeek.length})
            </button>

            <button
              onClick={() => {
                setHorizonFilter("later");
                setSelectedDayOffset(null);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                horizonFilter === "later"
                  ? "bg-stone-800 text-white shadow-3xs"
                  : "bg-stone-100 text-stone-600 hover:bg-stone-200"
              }`}
            >
              Later (8d+) ({metrics.dueLater.length})
            </button>

            <button
              onClick={() => {
                setHorizonFilter("starred");
                setSelectedDayOffset(null);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                horizonFilter === "starred"
                  ? "bg-amber-400 text-stone-950 font-bold shadow-3xs"
                  : "bg-stone-100 text-stone-600 hover:bg-stone-200"
              }`}
            >
              ★ Starred
            </button>
          </div>

          {/* Search Box */}
          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search timeline words..."
              className="w-full pl-8 pr-3 py-1.5 bg-stone-50 border border-stone-200 text-xs text-stone-900 placeholder:text-stone-400 outline-none focus:border-stone-400 focus:bg-white transition-all rounded-lg"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-900 text-xs"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Word Timeline Cards Grid */}
        {displayWords.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5" id="timeline-words-grid">
            {displayWords.map(({ word, reviewInfo, targetDate }) => {
              const isDue = reviewInfo.isDue;

              return (
                <div
                  key={word.id}
                  className={`p-4 rounded-xl border flex flex-col justify-between space-y-3 transition-all duration-200 ${
                    isDue
                      ? "bg-amber-50/20 border-amber-300/80 shadow-3xs hover:border-amber-400"
                      : "bg-white border-stone-200/80 hover:border-stone-350 shadow-2xs"
                  } hover:-translate-y-0.5`}
                >
                  {/* Top Word & Scheduled Time Pill */}
                  <div className="space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-1.5 flex-wrap">
                          <h4 className="text-base font-bold text-stone-900 tracking-tight truncate max-w-full">
                            {word.word}
                          </h4>
                          {word.partOfSpeech && (
                            <span className="text-[9px] font-mono text-stone-400 uppercase">
                              {word.partOfSpeech}
                            </span>
                          )}
                        </div>
                        {word.translation && (
                          <p className="text-xs text-stone-700 font-bold line-clamp-1">
                            {word.translation}
                          </p>
                        )}
                      </div>

                      {/* Schedule Badge */}
                      <span
                        className={`inline-flex items-center gap-1 text-[9px] font-mono font-bold px-2 py-0.5 rounded-full shrink-0 border ${
                          isDue
                            ? "bg-emerald-50 text-emerald-800 border-emerald-300"
                            : "bg-stone-50 text-stone-700 border-stone-200"
                        }`}
                        title={`Scheduled: ${formatTargetFull(targetDate)}`}
                      >
                        {isDue ? (
                          <>
                            <CheckCircle2 className="w-2.5 h-2.5 text-emerald-600" />
                            <span>Due Now</span>
                          </>
                        ) : (
                          <>
                            <Clock className="w-2.5 h-2.5 text-stone-500" />
                            <span>{reviewInfo.formattedCountdown}</span>
                          </>
                        )}
                      </span>
                    </div>

                    {/* Definition snippet */}
                    {word.definition && (
                      <p className="text-[11px] text-stone-500 font-serif italic line-clamp-2 leading-relaxed">
                        "{word.definition}"
                      </p>
                    )}
                  </div>

                  {/* Footer Meta & Controls */}
                  <div className="pt-2.5 border-t border-stone-100 flex items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <MemoryStrengthBar
                        strength={word.strength ?? 0}
                        onClick={() => setInspectingWord(word)}
                      />
                      <span className="text-[9px] font-mono text-stone-400 shrink-0">
                        {reviewInfo.intervalHours >= 24
                          ? `${Math.round(reviewInfo.intervalHours / 24)}d interval`
                          : `${reviewInfo.intervalHours}h interval`}
                      </span>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {onToggleStarWord && (
                        <button
                          onClick={() => onToggleStarWord(word.id)}
                          className={`p-1.5 rounded-lg border border-stone-200 bg-white hover:border-amber-400 transition-all cursor-pointer ${
                            word.starred ? "text-amber-500 bg-amber-50" : "text-stone-400 hover:text-amber-500"
                          }`}
                          title={word.starred ? "Starred" : "Star word"}
                        >
                          <Star className={`w-3 h-3 ${word.starred ? "fill-amber-400 text-amber-500" : ""}`} />
                        </button>
                      )}

                      <button
                        onClick={() => onSpeakWord(word.word, word.id)}
                        className={`p-1.5 rounded-lg border border-stone-200 bg-white text-stone-600 hover:text-stone-900 hover:border-stone-300 transition-all cursor-pointer ${
                          speakingWordId === word.id ? "bg-amber-50 text-amber-900 border-amber-300" : ""
                        }`}
                        title="Listen Pronunciation"
                      >
                        <Volume2 className="w-3 h-3" />
                      </button>

                      <button
                        onClick={() => setInspectingWord(word)}
                        className="p-1.5 rounded-lg border border-stone-200 bg-stone-50 text-stone-600 hover:text-stone-950 hover:bg-stone-100 transition-all cursor-pointer"
                        title="Inspect Strength & Timeline History"
                      >
                        <History className="w-3 h-3 text-stone-600" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="p-10 text-center bg-stone-50/50 border border-stone-200/60 rounded-xl space-y-2">
            <CalendarIcon className="w-7 h-7 text-stone-400 mx-auto" />
            <h4 className="font-bold text-xs text-stone-900">No scheduled words match this filter</h4>
            <p className="text-xs text-stone-500 font-serif italic max-w-sm mx-auto">
              {horizonFilter === "due"
                ? "All words are on track with no overdue reviews!"
                : "Try selecting another time range or clearing the search query."}
            </p>
          </div>
        )}
      </div>

      {/* Strength History Modal */}
      <AnimatePresence>
        {inspectingWord && (
          <StrengthHistoryModal
            word={inspectingWord}
            onClose={() => setInspectingWord(null)}
            onUpdateWord={(updated) => {
              setInspectingWord(updated);
              if (onUpdateWord) onUpdateWord(updated);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
