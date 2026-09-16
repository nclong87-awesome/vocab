import { getProviderBadgeStyle, formatResponseTime } from "../../utils/llmHelpers";

export interface LlmResponseMetadataProps {
  provider?: string;
  model?: string;
  responseTimeMs?: number;
  className?: string;
  dark?: boolean;
}

export function LlmResponseMetadata({
  provider,
  model,
  responseTimeMs,
  className = "",
  dark = false
}: LlmResponseMetadataProps) {
  if (!provider && !model && responseTimeMs === undefined) {
    return null;
  }

  return (
    <div className={`mt-3 pt-2 border-t ${dark ? "border-stone-750 text-stone-300" : "border-stone-100 text-stone-600"} flex items-center justify-between text-[11px] select-none gap-1.5 flex-nowrap whitespace-nowrap min-w-0 w-full overflow-hidden ${className}`}>
      <div className="flex items-center gap-1.5 flex-nowrap min-w-0 overflow-hidden shrink">
        {provider && (() => {
          const style = getProviderBadgeStyle(provider);
          return (
            <span className={`text-[10px] px-2 py-0.5 rounded-md border shadow-2xs font-semibold shrink-0 ${style.bg} ${style.text} ${style.border}`}>
              {style.label}
            </span>
          );
        })()}
        {model && (
          <span className={`font-mono text-[10.5px] font-medium px-1.5 py-0.5 rounded border truncate min-w-0 max-w-[130px] sm:max-w-[220px] ${
            dark 
              ? "text-stone-200 bg-stone-800/90 border-stone-700/80" 
              : "text-stone-600 bg-stone-50 border-stone-200/60"
          }`} title={model}>
            {model}
          </span>
        )}
      </div>
      {responseTimeMs !== undefined && (() => {
        const rt = formatResponseTime(responseTimeMs);
        return (
          <div 
            className={`flex items-center gap-1 shrink-0 text-[10.5px] px-2 py-0.5 rounded-md border shadow-2xs font-mono ${rt.style}`}
            title={`AI Response Time: ${responseTimeMs}ms (${rt.badgeText})`}
          >
            <span>{rt.icon}</span>
            <span>{rt.text}</span>
          </div>
        );
      })()}
    </div>
  );
}

export default LlmResponseMetadata;
