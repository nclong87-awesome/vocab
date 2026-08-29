import { getProviderBadgeStyle, formatResponseTime } from "../../utils/llmHelpers";

export interface LlmResponseMetadataProps {
  provider?: string;
  model?: string;
  responseTimeMs?: number;
  className?: string;
}

export function LlmResponseMetadata({
  provider,
  model,
  responseTimeMs,
  className = ""
}: LlmResponseMetadataProps) {
  if (!provider && !model && responseTimeMs === undefined) {
    return null;
  }

  return (
    <div className={`mt-3 pt-2 border-t border-stone-100 flex items-center justify-between text-[11px] select-none gap-1.5 flex-nowrap whitespace-nowrap min-w-0 w-full overflow-hidden ${className}`}>
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
          <span className="font-mono text-[10.5px] text-stone-600 font-medium bg-stone-50 px-1.5 py-0.5 rounded border border-stone-200/60 truncate min-w-0 max-w-[130px] sm:max-w-[220px]" title={model}>
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
