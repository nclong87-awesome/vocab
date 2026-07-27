import React from "react";
import { BookOpen, CheckCircle, GraduationCap } from "lucide-react";
import { UserStats } from "../../types";

interface StatsGridProps {
  stats: UserStats;
  pastSevenDays: Array<{
    dateStr: string;
    dayName: string;
    dayNum: number;
    studied: boolean;
  }>;
}

export default function StatsGrid({ stats, pastSevenDays }: StatsGridProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4" id="stats-grid">
      <div className="bg-white p-3.5 sm:p-6 border border-stone-200 flex items-center gap-3 sm:gap-4">
        <div className="p-2 sm:p-2.5 bg-stone-50 text-stone-900 border border-stone-200">
          <BookOpen className="w-4 h-4 sm:w-5 sm:h-5" />
        </div>
        <div>
          <div className="text-xl sm:text-2xl font-bold tracking-tight text-stone-950">{stats.totalWordsStudied}</div>
          <div className="text-xs text-stone-500 font-medium">Words Studied</div>
        </div>
      </div>

      <div className="bg-white p-3.5 sm:p-6 border border-stone-200 flex items-center gap-3 sm:gap-4">
        <div className="p-2 sm:p-2.5 bg-stone-50 text-stone-900 border border-stone-200">
          <CheckCircle className="w-4 h-4 sm:w-5 sm:h-5" />
        </div>
        <div>
          <div className="text-xl sm:text-2xl font-bold tracking-tight text-stone-950">{stats.totalWordsMastered}</div>
          <div className="text-xs text-stone-500 font-semibold">Mastered</div>
        </div>
      </div>

      <div className="bg-white p-3.5 sm:p-6 border border-stone-200 flex items-center gap-4">
        <div className="p-2 sm:p-2.5 bg-stone-50 text-stone-900 border border-stone-200">
          <GraduationCap className="w-4 h-4 sm:w-5 sm:h-5" />
        </div>
        <div>
          <div className="text-xl sm:text-2xl font-bold tracking-tight text-stone-950">{stats.totalQuizzesTaken}</div>
          <div className="text-xs text-stone-500 font-semibold">Quizzes Taken</div>
        </div>
      </div>

      <div className="bg-white p-3.5 sm:p-6 border border-stone-200 flex items-center gap-4">
        <div className="w-full">
          <div className="text-xs text-stone-500 font-semibold mb-2">Activity Calendar</div>
          <div className="flex gap-2 justify-between">
            {pastSevenDays.map((day, idx) => (
              <div 
                key={idx} 
                className="flex flex-col items-center flex-1" 
                title={`${day.dateStr}: ${day.studied ? "Studied" : "No activity"}`}
              >
                <div className={`w-2 h-2 ${day.studied ? "bg-stone-900" : "bg-stone-200"}`} />
                <span className="text-[10px] text-stone-500 font-bold mt-1.5">{day.dayName[0]}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
