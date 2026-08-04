interface AudioEqualizerProps {
  active?: boolean;
}

export default function AudioEqualizer({ active = false }: AudioEqualizerProps) {
  if (!active) return null;
  return (
    <span className="inline-flex items-end gap-0.5 h-3.5 px-1 py-0.5 bg-amber-400/20 border border-amber-400/40 rounded-xs shrink-0 select-none">
      <span className="w-0.5 bg-amber-600 animate-[bounce_0.6s_infinite_100ms] h-full" />
      <span className="w-0.5 bg-amber-600 animate-[bounce_0.6s_infinite_300ms] h-2/3" />
      <span className="w-0.5 bg-amber-600 animate-[bounce_0.6s_infinite_200ms] h-full" />
      <span className="w-0.5 bg-amber-600 animate-[bounce_0.6s_infinite_400ms] h-1/2" />
    </span>
  );
}
