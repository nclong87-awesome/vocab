interface MemoryStrengthBarProps {
  strength: number;
  onClick?: () => void;
  className?: string;
  title?: string;
}

export default function MemoryStrengthBar({
  strength,
  onClick,
  className = "",
  title,
}: MemoryStrengthBarProps) {
  const safeStrength = Math.max(0, Math.min(100, Math.round(strength || 0)));
  const barColor =
    safeStrength >= 80
      ? "bg-emerald-500"
      : safeStrength >= 40
      ? "bg-amber-500"
      : "bg-rose-500";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 min-w-0 flex items-center justify-between gap-2 sm:gap-2.5 cursor-pointer hover:bg-stone-50 px-2.5 sm:px-3 py-1 rounded-full border border-stone-200/90 bg-white transition-colors shadow-2xs overflow-hidden ${className}`}
      title={title || `Memory Strength: ${safeStrength}%. Click for strength history.`}
    >
      <span className="text-[9px] font-bold text-stone-400 uppercase tracking-wider shrink-0">
        STRENGTH
      </span>
      <div className="h-1.5 flex-1 min-w-[1rem] bg-stone-100 rounded-full overflow-hidden">
        <div
          className={`h-full transition-all duration-500 rounded-full ${barColor}`}
          style={{ width: `${safeStrength}%` }}
        />
      </div>
      <span className="text-[10px] font-mono font-bold text-stone-700 shrink-0 tabular-nums">
        {safeStrength}%
      </span>
    </button>
  );
}
