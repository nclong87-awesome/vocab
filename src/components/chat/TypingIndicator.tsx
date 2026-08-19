import { useState, useEffect } from "react";
import { Clock, X } from "lucide-react";
import { LLMConfig } from "../../types";
import { getAllModelStatuses, getNextAutoCandidate } from "../../utils/autoModeManager";

interface TypingIndicatorProps {
  llmConfig: LLMConfig;
  onCancel?: () => void;
}

export default function TypingIndicator({ llmConfig, onCancel }: TypingIndicatorProps) {
  // Resolve active provider and model
  let provider = llmConfig.provider;
  let model = llmConfig.model;
  if (provider === "auto") {
    try {
      const nextCand = getNextAutoCandidate(llmConfig);
      provider = nextCand.provider;
      model = nextCand.model;
    } catch (e) {
      // fallback
    }
  }

  // Find the model status to get the average response time
  const statuses = getAllModelStatuses(llmConfig);
  const match = statuses.find((s) => s.provider === provider && s.model === model);
  const avgTimeMs = match?.avgResponseTimeMs ?? match?.lastResponseTimeMs ?? 20000; // default 20s as requested

  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    const startTime = Date.now();
    const interval = setInterval(() => {
      setElapsedMs(Date.now() - startTime);
    }, 100);
    return () => clearInterval(interval);
  }, []);

  const progress = Math.min(99, (elapsedMs / avgTimeMs) * 100);
  const remainingSeconds = Math.max(0, (avgTimeMs - elapsedMs) / 1000);
  
  // Format the model name nicely
  const displayModel = model || "AI Assistant";

  return (
    <div 
      className="flex flex-col mr-auto w-full max-w-[340px] bg-stone-50 border border-stone-200/80 rounded-2xl rounded-tl-none p-3.5 shadow-sm animate-chat-msg relative overflow-hidden group" 
      id="typing-indicator-container"
    >
      {/* Subtle warm animated gradient accent line at the very top of the card */}
      <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-amber-400 via-amber-500 to-amber-600 opacity-90 animate-pulse" />

      {/* Header Row: Model details, active spinner, and Cancel button */}
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          {/* Pulsing indicator & model label */}
          <div className="relative flex items-center justify-center w-5 h-5 shrink-0">
            <span className="absolute inline-flex h-full w-full rounded-full bg-amber-400/30 opacity-75 animate-ping"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500"></span>
          </div>
          <div className="min-w-0">
            <h4 className="text-xs font-bold text-stone-800 font-mono truncate leading-none mb-1">
              {displayModel}
            </h4>
            <p className="text-[10px] text-stone-400 font-semibold font-sans leading-none">
              generating response...
            </p>
          </div>
        </div>

        {/* Small Elegant Cancel Button */}
        {onCancel && (
          <button
            onClick={onCancel}
            type="button"
            className="flex items-center gap-1 px-2 py-1 text-[10px] font-bold text-stone-500 hover:text-stone-800 hover:border-stone-300 bg-stone-100/80 hover:bg-stone-200/60 rounded-lg border border-stone-200/60 transition-all cursor-pointer shadow-2xs select-none"
            title="Cancel Generation"
          >
            <X className="w-3 h-3 stroke-[2.5]" />
            <span>Cancel</span>
          </button>
        )}
      </div>

      {/* Body: Slimmed and refined progress indicators */}
      <div className="space-y-2.5">
        {/* Progress bar line */}
        <div className="w-full bg-stone-200/70 h-1.5 rounded-full overflow-hidden">
          <div 
            className="bg-gradient-to-r from-amber-400 via-amber-500 to-amber-600 h-1.5 rounded-full transition-all duration-100 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Info / Metadata row */}
        <div className="flex items-center justify-between text-[10px] text-stone-500 font-mono select-none">
          <span className="flex items-center gap-1 font-medium text-stone-600">
            <Clock className="w-3.5 h-3.5 text-stone-400 shrink-0" />
            <span>{Math.round(elapsedMs / 1000)}s elapsed</span>
          </span>
          <span className="text-[11px] font-bold text-stone-700">
            {Math.round(progress)}%
          </span>
          <span className="text-stone-400 font-medium">
            {remainingSeconds > 0 
              ? `~${remainingSeconds.toFixed(1)}s left` 
              : "just a moment..."}
          </span>
        </div>
      </div>
    </div>
  );
}
