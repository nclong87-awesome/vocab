import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { 
  X, 
  History, 
  TrendingUp, 
  Calendar, 
  Clock, 
  Info,
  Timer,
  CheckCircle2
} from "lucide-react";
import { Word } from "../../types";
import { getEffectiveStrengthHistory } from "../../utils/strengthHistoryHelpers";
import { getDaysSinceLastReview, getNextReviewInfo } from "../../utils/spacedRepetition";

interface StrengthHistoryModalProps {
  word: Word;
  onClose: () => void;
  onUpdateWord?: (updatedWord: Word) => void;
}

export default function StrengthHistoryModal({
  word,
  onClose
}: StrengthHistoryModalProps) {
  const [hoveredEntryId, setHoveredEntryId] = useState<string | null>(null);

  // Close modal on Escape key press
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const historyEntries = getEffectiveStrengthHistory(word);
  const currentStrength = word.strength ?? 0;
  const daysSincePractice = getDaysSinceLastReview(word);
  const estimatedDecay = daysSincePractice * 10;
  const reviewInfo = getNextReviewInfo(word);
  
  // Calculate peak and lowest strength from history
  const strengths = historyEntries.map(e => e.strength);
  const peakStrength = strengths.length > 0 ? Math.max(...strengths) : currentStrength;
  const lowestStrength = strengths.length > 0 ? Math.min(...strengths) : currentStrength;

  // Prepare SVG Chart Points
  const chartWidth = 500;
  const chartHeight = 160;
  const paddingX = 35;
  const paddingY = 20;
  const innerWidth = chartWidth - paddingX * 2;
  const innerHeight = chartHeight - paddingY * 2;

  const points = historyEntries.map((entry, index) => {
    const x = historyEntries.length > 1
      ? paddingX + (index / (historyEntries.length - 1)) * innerWidth
      : paddingX + innerWidth / 2;
    // Y-axis inverted: 100% at top (paddingY), 0% at bottom (chartHeight - paddingY)
    const y = chartHeight - paddingY - (entry.strength / 100) * innerHeight;
    return { x, y, entry };
  });

  // Construct SVG Path String for line
  const linePathD = points.length > 0
    ? points.reduce((acc, p, i) => `${acc} ${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`, "")
    : "";

  // Construct Closed Area Path String for gradient fill
  const areaPathD = points.length > 0
    ? `${linePathD} L ${points[points.length - 1].x.toFixed(1)} ${(chartHeight - paddingY).toFixed(1)} L ${points[0].x.toFixed(1)} ${(chartHeight - paddingY).toFixed(1)} Z`
    : "";

  // Format date cleanly
  const formatDate = (isoStr: string) => {
    try {
      const d = new Date(isoStr);
      if (isNaN(d.getTime())) return isoStr;
      return d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      });
    } catch {
      return isoStr;
    }
  };

  const getReasonBadge = (reason: string) => {
    switch (reason) {
      case "created":
        return <span className="bg-stone-100 text-stone-700 border border-stone-200 px-1.5 py-0.5 rounded text-[9px] font-bold">Created</span>;
      case "quiz_correct":
        return <span className="bg-emerald-50 text-emerald-800 border border-emerald-200 px-1.5 py-0.5 rounded text-[9px] font-bold">Quiz Correct</span>;
      case "quiz_incorrect":
        return <span className="bg-rose-50 text-rose-800 border border-rose-200 px-1.5 py-0.5 rounded text-[9px] font-bold">Quiz Incorrect</span>;
      case "mastered":
        return <span className="bg-emerald-100 text-emerald-900 border border-emerald-300 px-1.5 py-0.5 rounded text-[9px] font-bold">Mastered</span>;
      case "unmastered":
        return <span className="bg-stone-100 text-stone-800 border border-stone-300 px-1.5 py-0.5 rounded text-[9px] font-bold">Re-learning</span>;
      case "memory_decay":
        return <span className="bg-amber-50 text-amber-900 border border-amber-200 px-1.5 py-0.5 rounded text-[9px] font-bold">Memory Decay</span>;
      case "flashcard_review":
      case "flashcard":
        return <span className="bg-indigo-50 text-indigo-800 border border-indigo-200 px-1.5 py-0.5 rounded text-[9px] font-bold">Flashcard</span>;
      case "manual_adjust":
      default:
        return <span className="bg-stone-100 text-stone-700 border border-stone-200 px-1.5 py-0.5 rounded text-[9px] font-bold">Updated</span>;
    }
  };

  return createPortal(
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-2.5 sm:p-4 bg-stone-900/70 backdrop-blur-xs overflow-y-auto"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className="bg-white border border-stone-200 rounded-2xl shadow-2xl max-w-xl w-full overflow-hidden my-auto max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-stone-900 text-white p-4 sm:p-5 flex items-start justify-between gap-3 border-b border-stone-800 shrink-0">
          <div className="space-y-1 min-w-0 pr-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="inline-flex items-center gap-1 bg-amber-400 text-stone-950 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider rounded">
                <History className="w-2.5 h-2.5" />
                <span>Strength History</span>
              </span>
              {word.partOfSpeech && (
                <span className="text-[9px] font-mono font-bold bg-stone-800 text-stone-300 px-1.5 py-0.5 rounded uppercase">
                  {word.partOfSpeech}
                </span>
              )}
            </div>
            <h3 className="text-lg sm:text-xl font-bold tracking-tight text-white flex items-center gap-2 flex-wrap">
              <span className="truncate">{word.word}</span>
              {word.pronunciation && (
                <span className="text-xs font-mono font-normal text-stone-400">/{word.pronunciation}/</span>
              )}
            </h3>
            {word.translation && (
              <p className="text-xs text-stone-300 font-serif italic line-clamp-1">
                "{word.translation}"
              </p>
            )}
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-stone-800 text-stone-400 hover:text-white hover:bg-stone-700 transition-all cursor-pointer shrink-0"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-3.5 sm:p-5 space-y-4 overflow-y-auto flex-1">
          
          {/* Key Metrics Summary Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-2.5">
            <div className="bg-stone-50 border border-stone-200/80 p-2.5 sm:p-3 rounded-xl space-y-0.5">
              <span className="text-[8px] sm:text-[9px] font-bold text-stone-400 uppercase tracking-wider block">Current</span>
              <div className="flex items-baseline gap-1">
                <span className={`text-base sm:text-lg font-bold tracking-tight ${
                  currentStrength >= 80 ? 'text-emerald-600' : currentStrength >= 40 ? 'text-amber-600' : 'text-rose-600'
                }`}>
                  {Math.round(currentStrength)}%
                </span>
                <span className="text-[9px] font-semibold text-stone-500">
                  {word.learned ? "Mastered" : "Learning"}
                </span>
              </div>
            </div>

            <div className="bg-stone-50 border border-stone-200/80 p-2.5 sm:p-3 rounded-xl space-y-0.5">
              <span className="text-[8px] sm:text-[9px] font-bold text-stone-400 uppercase tracking-wider block">Last Practiced</span>
              <div className="flex items-baseline gap-1">
                <span className="text-base sm:text-lg font-bold text-stone-900 tracking-tight">
                  {daysSincePractice === 0 ? "Today" : `${daysSincePractice}d ago`}
                </span>
                {daysSincePractice > 0 && (
                  <span className="text-[9px] font-bold text-rose-600">(-{estimatedDecay}%)</span>
                )}
              </div>
            </div>

            <div className="bg-stone-50 border border-stone-200/80 p-2.5 sm:p-3 rounded-xl space-y-0.5">
              <span className="text-[8px] sm:text-[9px] font-bold text-stone-400 uppercase tracking-wider block">Peak / Lowest</span>
              <div className="flex items-baseline gap-1">
                <span className="text-sm sm:text-base font-bold text-stone-900 tracking-tight">{Math.round(peakStrength)}%</span>
                <span className="text-xs text-stone-400">/</span>
                <span className="text-xs font-bold text-stone-600">{Math.round(lowestStrength)}%</span>
              </div>
            </div>

            <div className="bg-stone-50 border border-stone-200/80 p-2.5 sm:p-3 rounded-xl space-y-0.5">
              <span className="text-[8px] sm:text-[9px] font-bold text-stone-400 uppercase tracking-wider block">History Events</span>
              <div className="flex items-baseline gap-1">
                <span className="text-base sm:text-lg font-bold text-stone-900 tracking-tight">{historyEntries.length}</span>
                <span className="text-[9px] font-semibold text-stone-400">entries</span>
              </div>
            </div>
          </div>

          {/* Next Review Schedule Banner */}
          <div className={`p-3 rounded-xl border flex items-center justify-between gap-3 text-xs ${
            reviewInfo.isDue 
              ? "bg-emerald-50/70 border-emerald-200/80 text-emerald-950" 
              : "bg-amber-50/50 border-amber-200/80 text-amber-950"
          }`}>
            <div className="flex items-center gap-2 min-w-0">
              {reviewInfo.isDue ? (
                <div className="p-1.5 bg-emerald-100 text-emerald-700 rounded-lg shrink-0">
                  <CheckCircle2 className="w-4 h-4" />
                </div>
              ) : (
                <div className="p-1.5 bg-amber-100 text-amber-800 rounded-lg shrink-0">
                  <Timer className="w-4 h-4" />
                </div>
              )}
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-[11px] uppercase tracking-wide">
                    {reviewInfo.isDue ? "Eligible for Quiz & Review" : "Next Scheduled Practice"}
                  </span>
                  <span className={`px-1.5 py-0.2 rounded text-[9px] font-bold ${
                    reviewInfo.isDue ? "bg-emerald-200/70 text-emerald-900" : "bg-amber-200/70 text-amber-900"
                  }`}>
                    {reviewInfo.formattedCountdown}
                  </span>
                </div>
                <p className="text-[10px] text-stone-600 font-mono mt-0.5">
                  {formatDate(reviewInfo.nextReviewDate)} (Adaptive interval: {reviewInfo.intervalHours >= 24 ? `${Math.round(reviewInfo.intervalHours / 24)}d` : `${reviewInfo.intervalHours}h`})
                </p>
              </div>
            </div>
          </div>

          {/* Interactive Chart Container */}
          <div className="bg-stone-900 text-white p-3 sm:p-4 rounded-xl space-y-2 relative overflow-hidden shadow-xs">
            <div className="flex items-center justify-between gap-2 border-b border-stone-800 pb-2">
              <div className="flex items-center gap-1.5">
                <TrendingUp className="w-3.5 h-3.5 text-amber-400" />
                <h4 className="text-[11px] font-bold uppercase tracking-wider text-stone-200">Strength Retention Curve</h4>
              </div>
              <span className="text-[9px] text-stone-400 font-mono">0% - 100%</span>
            </div>

            {/* SVG Line Chart */}
            <div className="w-full">
              <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="w-full h-auto select-none">
                <defs>
                  <linearGradient id="strengthGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.4" />
                    <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.0" />
                  </linearGradient>
                </defs>

                {/* Y-axis Horizontal Grid Lines & Labels */}
                {[0, 25, 50, 75, 100].map((val) => {
                  const y = chartHeight - paddingY - (val / 100) * innerHeight;
                  return (
                    <g key={val}>
                      <line
                        x1={paddingX}
                        y1={y}
                        x2={chartWidth - paddingX}
                        y2={y}
                        stroke="#334155"
                        strokeDasharray="3 3"
                        strokeWidth="1"
                      />
                      <text
                        x={paddingX - 6}
                        y={y + 3}
                        fill="#94a3b8"
                        fontSize="8"
                        fontFamily="monospace"
                        textAnchor="end"
                      >
                        {val}%
                      </text>
                    </g>
                  );
                })}

                {/* Filled Gradient Area */}
                {areaPathD && (
                  <path d={areaPathD} fill="url(#strengthGradient)" />
                )}

                {/* Connecting Trend Line */}
                {linePathD && (
                  <path
                    d={linePathD}
                    fill="none"
                    stroke="#fbbf24"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )}

                {/* Data Points */}
                {points.map(({ x, y, entry }, idx) => {
                  const isHovered = hoveredEntryId === entry.id;
                  const pointColor = entry.strength >= 80 ? "#10b981" : entry.strength >= 40 ? "#fbbf24" : "#f43f5e";

                  return (
                    <g key={entry.id || idx}>
                      {/* Interactive hover circle area */}
                      <circle
                        cx={x}
                        cy={y}
                        r="12"
                        fill="transparent"
                        className="cursor-pointer"
                        onMouseEnter={() => setHoveredEntryId(entry.id)}
                        onMouseLeave={() => setHoveredEntryId(null)}
                        onClick={() => setHoveredEntryId(entry.id === hoveredEntryId ? null : entry.id)}
                      />
                      {/* Outer ring */}
                      <circle
                        cx={x}
                        cy={y}
                        r={isHovered ? 6 : 3.5}
                        fill="#0f172a"
                        stroke={pointColor}
                        strokeWidth={isHovered ? 2.5 : 1.5}
                        className="transition-all duration-200 cursor-pointer"
                      />
                      
                      {/* Strength Score Text label above node if hovered or first/last */}
                      {(isHovered || idx === points.length - 1 || idx === 0) && (
                        <text
                          x={x}
                          y={y - 8}
                          fill={pointColor}
                          fontSize="8"
                          fontWeight="bold"
                          fontFamily="sans-serif"
                          textAnchor="middle"
                        >
                          {Math.round(entry.strength)}%
                        </text>
                      )}
                    </g>
                  );
                })}
              </svg>
            </div>

            {/* Hover Tooltip / Status Footer (Fixed Height to prevent layout shift on hover) */}
            <div className="h-10 border-t border-stone-800 pt-1.5 flex items-center justify-between text-xs">
              {hoveredEntryId ? (() => {
                const active = historyEntries.find(e => e.id === hoveredEntryId);
                if (!active) return null;
                return (
                  <div className="w-full flex items-center justify-between gap-2 text-stone-100 text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[10px] font-bold text-amber-400 font-mono shrink-0">
                        {formatDate(active.timestamp)}
                      </span>
                      <p className="text-[10px] text-stone-300 font-sans truncate">
                        {active.note || "Strength updated"}
                      </p>
                    </div>
                    <span className="text-[10px] font-bold font-mono text-amber-400 shrink-0">
                      {Math.round(active.strength)}%
                    </span>
                  </div>
                );
              })() : (
                <div className="w-full flex items-center justify-between text-[10px] text-stone-400 font-mono">
                  <span className="flex items-center gap-1.5">
                    <Info className="w-3 h-3 text-amber-500/80" />
                    <span>Hover over chart point or timeline item to inspect</span>
                  </span>
                  <span className="text-[9px] text-stone-500">{historyEntries.length} entries</span>
                </div>
              )}
            </div>
          </div>

          {/* Chronological History Event Log */}
          <div className="space-y-2">
            <div className="flex items-center justify-between border-b border-stone-100 pb-1.5">
              <h4 className="text-[11px] font-bold uppercase tracking-wider text-stone-900 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-stone-500" />
                <span>Review & Practice Timeline ({historyEntries.length})</span>
              </h4>
              <span className="text-[9px] text-stone-400 italic font-serif">Newest first</span>
            </div>

            <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
              {[...historyEntries].reverse().map((entry) => {
                const isPositive = (entry.delta ?? 0) >= 0;
                return (
                  <div
                    key={entry.id}
                    className={`p-2.5 rounded-xl border flex items-center justify-between gap-2 text-xs transition-colors ${
                      hoveredEntryId === entry.id
                        ? "bg-amber-50/60 border-amber-300 shadow-xs"
                        : "bg-white border-stone-200/80 hover:border-stone-300"
                    }`}
                    onMouseEnter={() => setHoveredEntryId(entry.id)}
                    onMouseLeave={() => setHoveredEntryId(null)}
                  >
                    <div className="space-y-0.5 min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {getReasonBadge(entry.reason)}
                        <span className="text-[9px] font-mono text-stone-400 flex items-center gap-1">
                          <Calendar className="w-2.5 h-2.5 text-stone-300" />
                          <span>{formatDate(entry.timestamp)}</span>
                        </span>
                      </div>
                      <p className="text-[10px] sm:text-[11px] text-stone-700 font-sans font-medium line-clamp-1">
                        {entry.note || "Strength updated"}
                      </p>
                    </div>

                    <div className="text-right shrink-0 space-y-0.5">
                      <div className="text-xs font-bold text-stone-900 font-mono">
                        {Math.round(entry.strength)}%
                      </div>
                      {entry.delta !== undefined && entry.delta !== 0 && (
                        <span className={`text-[9px] font-bold font-mono block ${
                          isPositive ? "text-emerald-600" : "text-rose-600"
                        }`}>
                          {isPositive ? `+${Math.round(entry.delta)}%` : `${Math.round(entry.delta)}%`}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

        </div>

        {/* Modal Footer */}
        <div className="bg-stone-50 border-t border-stone-200 p-3 sm:p-4 flex items-center justify-between text-xs text-stone-500 shrink-0">
          <div className="flex items-center gap-1 text-[10px] sm:text-[11px]">
            <Info className="w-3.5 h-3.5 text-amber-600 shrink-0" />
            <span className="line-clamp-1">Strength decreases by 10 points per day without practice (1 day = -10 points). Practicing in quizzes or flashcards restores strength.</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-stone-900 hover:bg-stone-800 text-white font-bold text-xs rounded-lg transition-all cursor-pointer shrink-0 ml-2"
          >
            Done
          </button>
        </div>
      </motion.div>
    </motion.div>,
    document.body
  );
}

