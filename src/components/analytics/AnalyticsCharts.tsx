import React from "react";
import { BarChart2, TrendingUp } from "lucide-react";
import { 
  BarChart as RechartsBarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  Tooltip, 
  ResponsiveContainer, 
  Cell 
} from "recharts";

interface AnalyticsChartsProps {
  strengthDistribution: Array<{
    level: string;
    label: string;
    count: number;
    color: string;
  }>;
  deckPerformanceData: Array<{
    name: string;
    fullName: string;
    total: number;
    mastered: number;
    improving: number;
    masteryPercent: number;
  }>;
}

export default function AnalyticsCharts({ strengthDistribution, deckPerformanceData }: AnalyticsChartsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6" id="analytics-charts-section">
      {/* Familiarity Level Distribution Chart */}
      <div className="bg-white p-6 border border-stone-200 space-y-4 rounded-none">
        <div className="flex items-center justify-between border-b border-stone-100 pb-3">
          <div>
            <h3 className="font-bold text-sm text-stone-950 flex items-center gap-2">
              <BarChart2 className="w-4 h-4 text-stone-900" />
              Word Familiarity Distribution
            </h3>
            <p className="text-[11px] text-stone-500 font-serif italic">Breakdown of words by mastery strength level (0-4)</p>
          </div>
        </div>

        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <RechartsBarChart data={strengthDistribution} margin={{ top: 10, right: 10, left: -20, bottom: 20 }}>
              <XAxis dataKey="level" tick={{ fontSize: 10 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
              <Tooltip 
                formatter={(value: any, name: any, item: any) => [`${value} words`, item.payload.label]}
                contentStyle={{ backgroundColor: "#1c1917", color: "#ffffff", border: "none", fontSize: "12px" }}
              />
              <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                {strengthDistribution.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Bar>
            </RechartsBarChart>
          </ResponsiveContainer>
        </div>

        {/* Strength Level Legend */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-2 border-t border-stone-100 text-[10px]">
          {strengthDistribution.map((item, idx) => (
            <div key={idx} className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-none shrink-0" style={{ backgroundColor: item.color }} />
              <span className="text-stone-700 font-medium">{item.level}: {item.label} ({item.count})</span>
            </div>
          ))}
        </div>
      </div>

      {/* Deck Mastery Percentage Chart */}
      <div className="bg-white p-6 border border-stone-200 space-y-4 rounded-none">
        <div className="flex items-center justify-between border-b border-stone-100 pb-3">
          <div>
            <h3 className="font-bold text-sm text-stone-950 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-stone-900" />
              Mastery by Vocabulary Deck
            </h3>
            <p className="text-[11px] text-stone-500 font-serif italic">Percentage of mastered words per collection</p>
          </div>
        </div>

        <div className="h-64 w-full">
          {deckPerformanceData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <RechartsBarChart data={deckPerformanceData} layout="vertical" margin={{ top: 5, right: 20, left: 30, bottom: 5 }}>
                <XAxis type="number" domain={[0, 100]} unit="%" tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={80} />
                <Tooltip 
                  formatter={(value: any, name: any, item: any) => [
                    `${value}% Mastered (${item.payload.mastered}/${item.payload.total} words)`, 
                    item.payload.fullName
                  ]}
                  contentStyle={{ backgroundColor: "#1c1917", color: "#ffffff", border: "none", fontSize: "12px" }}
                />
                <Bar dataKey="masteryPercent" fill="#10b981" radius={[0, 2, 2, 0]} />
              </RechartsBarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-xs text-stone-400 italic">
              No decks created yet
            </div>
          )}
        </div>

        <div className="pt-2 border-t border-stone-100 text-[11px] text-stone-500 font-serif italic text-right">
          Mastery requires strength level 3 or manual learned flag
        </div>
      </div>
    </div>
  );
}
