import { useState, useEffect, useCallback } from "react";
import { Zap, X, Cpu, Clock, Compass, Sparkles, CheckCircle2 } from "lucide-react";
import { LLMConfig } from "../../types";
import { getAllModelStatuses } from "../../utils/autoModeManager";
import { PROVIDER_OPTIONS } from "../../config/llmProviders";
import { t } from "../../config/i18n";
import {
  subscribeEnrichmentProgress,
  cancelBatchEnrichment,
  BatchEnrichmentProgress
} from "../../services/backgroundEnrichmentService";

export interface ApiCallProgressModalProps {
  isOpen: boolean;
  action?: string;
  provider?: string;
  model?: string;
  llmConfig?: LLMConfig;
  appLanguage?: string;
  onCancel?: () => void;
  onTimeout?: () => void;
  requestId?: string | number;
}

export default function ApiCallProgressModal({
  isOpen,
  action = "generateChallenge",
  provider,
  model,
  llmConfig,
  appLanguage,
  onCancel,
  onTimeout,
  requestId,
}: ApiCallProgressModalProps) {
  const [elapsedMs, setElapsedMs] = useState(0);
  const [enrichmentProgress, setEnrichmentProgress] = useState<BatchEnrichmentProgress>({
    isRunning: false,
    total: 0,
    processed: 0,
    completedCount: 0,
    multipleDefCount: 0,
    errorCount: 0,
  });
  const [justCompletedEnrichment, setJustCompletedEnrichment] = useState(false);

  const currentAppLang =
    appLanguage ||
    (typeof window !== "undefined" ? localStorage.getItem("vocab_learner_app_lang") : null) ||
    "en";

  // Subscribe to background vocabulary auto-enrichment progress
  useEffect(() => {
    return subscribeEnrichmentProgress((p) => {
      setEnrichmentProgress((prev) => {
        if (prev.isRunning && !p.isRunning && p.completedCount > 0) {
          setJustCompletedEnrichment(true);
          const timer = setTimeout(() => setJustCompletedEnrichment(false), 2600);
          return { ...p, _timer: timer } as any;
        }
        return p;
      });
    });
  }, []);

  // Reset or run elapsed timer while modal is open, with hard 30s safety timeout
  useEffect(() => {
    if (!isOpen) {
      setElapsedMs(0);
      return;
    }

    setElapsedMs(0);
    const startTime = Date.now();
    let timedOut = false;

    const interval = setInterval(() => {
      const currentElapsed = Date.now() - startTime;
      if (currentElapsed >= 30000) {
        setElapsedMs(30000);
        clearInterval(interval);
        if (!timedOut) {
          timedOut = true;
          if (onTimeout) {
            onTimeout();
          }
        }
      } else {
        setElapsedMs(currentElapsed);
      }
    }, 100);

    return () => clearInterval(interval);
  }, [isOpen, provider, model, requestId, onTimeout]);

  const handleStopEnrichment = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    cancelBatchEnrichment();
  }, []);

  if (!isOpen) return null;

  // Format provider
  const rawProvider = provider || llmConfig?.provider || "groq";
  const provMeta = PROVIDER_OPTIONS.find((p) => p.id === rawProvider);
  const displayProvider = provMeta?.name
    ? provMeta.name.replace(/\s*\(Default\)/i, "").trim().toUpperCase()
    : rawProvider.toUpperCase();

  // Format model
  const displayModel = model || llmConfig?.model || "openai/gpt-oss-120b";

  // Calculate expected response time from historical rolling stats
  const statuses = getAllModelStatuses(llmConfig);
  const match = statuses.find((s) => s.provider === rawProvider && s.model === displayModel);
  const avgTimeMs = match?.avgResponseTimeMs ?? match?.lastResponseTimeMs ?? 20000;
  const expectedSeconds = Math.round(avgTimeMs / 1000);

  // Clamped progress (0 - 99%)
  const progress = Math.min(99, Math.max(0, (elapsedMs / avgTimeMs) * 100));
  const remainingSeconds = Math.max(0, (avgTimeMs - elapsedMs) / 1000);

  // SVG circle calculations
  const radius = 62;
  const circumference = 2 * Math.PI * radius; // ~389.55
  const strokeDashoffset = circumference * (1 - progress / 100);

  const enrichmentPercent =
    enrichmentProgress.total > 0
      ? Math.min(100, Math.round((enrichmentProgress.processed / enrichmentProgress.total) * 100))
      : 0;

  const displayActionName =
    action === "enrich_incomplete_words"
      ? "enrichIncompleteWords"
      : action === "enrich_word"
      ? "enrichWord"
      : action;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in select-none"
      id="api-call-progress-modal"
    >
      <div className="relative w-full max-w-[370px] sm:max-w-[400px] bg-white rounded-3xl shadow-2xl p-5 sm:p-6 border border-slate-100 overflow-hidden flex flex-col items-center">
        {/* Top gradient glowing accent border */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500" />

        {/* Top Header Row */}
        <div className="w-full flex items-center justify-between gap-2 mb-2">
          {/* Action name with solid blue dot */}
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-600 shrink-0" />
            <span className="font-mono text-xs sm:text-sm font-semibold text-stone-800 tracking-tight truncate">
              {displayActionName}
            </span>
          </div>

          {/* Provider badge & close button */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full border border-amber-400/80 bg-amber-50 text-amber-600 font-bold text-[11px] tracking-wider uppercase">
              <Zap className="w-3 h-3 fill-amber-500 text-amber-500" />
              <span>{displayProvider}</span>
            </div>

            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                className="text-stone-400 hover:text-stone-700 p-1 rounded-lg hover:bg-stone-100 transition-colors cursor-pointer"
                title={t("api_progress_cancel", currentAppLang)}
              >
                <X className="w-4 h-4 stroke-[2.5]" />
              </button>
            )}
          </div>
        </div>

        {/* Circular Progress Gauge */}
        <div className="my-2 sm:my-3 flex flex-col items-center justify-center relative">
          <svg className="w-40 h-40 sm:w-44 sm:h-44 transform -rotate-90" viewBox="0 0 160 160">
            {/* Background ring */}
            <circle
              cx="80"
              cy="80"
              r={radius}
              stroke="#f1f5f9"
              strokeWidth="11"
              fill="none"
            />
            {/* Active progress arc */}
            <circle
              cx="80"
              cy="80"
              r={radius}
              stroke="#4f46e5"
              strokeWidth="11"
              fill="none"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
              className="transition-all duration-150 ease-out"
            />
          </svg>

          {/* Inside gauge info */}
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="text-3xl sm:text-4xl font-extrabold text-stone-900 tracking-tight">
              {Math.round(progress)}%
            </span>
            <span className="text-xs sm:text-sm font-medium text-stone-500 mt-0.5">
              {t("api_progress_elapsed", currentAppLang, {
                seconds: String(Math.min(30, Math.floor(elapsedMs / 1000))),
              })}
            </span>
          </div>
        </div>

        {/* Horizontal separator */}
        <div className="w-full border-t border-slate-100 my-2.5" />

        {/* Bottom Details Section */}
        <div className="flex flex-col items-center gap-1.5 w-full text-center">
          {/* Model Chip */}
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-slate-50 border border-slate-200/80 text-xs font-mono font-medium text-stone-700 max-w-full">
            <Cpu className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
            <span className="truncate">{displayModel}</span>
          </div>

          {/* Remaining & Expected Time */}
          <div className="flex items-center gap-1.5 text-xs text-stone-600 font-medium">
            <Clock className="w-3.5 h-3.5 text-stone-400 shrink-0" />
            <span>
              {remainingSeconds > 0
                ? t("api_progress_remaining", currentAppLang, {
                    remaining: remainingSeconds.toFixed(1),
                    expected: String(expectedSeconds),
                  })
                : t("api_progress_finalizing", currentAppLang, {
                    expected: String(expectedSeconds),
                  })}
            </span>
          </div>

          {/* Smart routing label */}
          <div className="flex items-center gap-1.5 text-xs text-indigo-600 font-medium">
            <Compass className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
            <span>{t("api_progress_smart_routing", currentAppLang)}</span>
          </div>
        </div>

        {/* Background Enrichment Sub-Task Bar (Unified Coexistence) */}
        {enrichmentProgress.isRunning && (
          <div className="w-full mt-3 pt-2.5 border-t border-slate-100 animate-fade-in text-left">
            <div className="bg-amber-50/70 border border-amber-200/60 rounded-xl p-2.5 space-y-1.5 shadow-3xs">
              <div className="flex items-center justify-between text-[11px] font-medium text-amber-950">
                <div className="flex items-center gap-1.5 min-w-0">
                  <Sparkles className="w-3.5 h-3.5 text-amber-600 shrink-0 animate-pulse" />
                  <span className="font-semibold truncate">
                    {t("auto_enrich_background_active", currentAppLang) || "Background Auto-Enrichment"}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="font-mono text-[10px] font-bold text-amber-800">
                    {enrichmentProgress.processed}/{enrichmentProgress.total} ({enrichmentPercent}%)
                  </span>
                  <button
                    type="button"
                    onClick={handleStopEnrichment}
                    className="text-stone-400 hover:text-rose-600 hover:bg-amber-100/80 p-0.5 rounded transition-colors cursor-pointer"
                    title={t("auto_enrich_stop", currentAppLang) || "Stop background enrichment"}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Linear Progress Bar */}
              <div className="w-full bg-amber-200/60 rounded-full h-1 overflow-hidden">
                <div
                  className="bg-amber-500 h-1 rounded-full transition-all duration-300"
                  style={{ width: `${enrichmentPercent}%` }}
                />
              </div>

              {/* Sub-text: Current word being enriched */}
              {enrichmentProgress.currentWordText && (
                <p className="text-[10px] text-amber-800/80 truncate">
                  {t("auto_enrich_background_running_word", currentAppLang, {
                    word: enrichmentProgress.currentWordText,
                  }) || `Enriching: "${enrichmentProgress.currentWordText}"`}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Briefly show completion if it finished while modal was open */}
        {!enrichmentProgress.isRunning && justCompletedEnrichment && (
          <div className="w-full mt-3 pt-2.5 border-t border-slate-100 animate-fade-in text-left">
            <div className="bg-emerald-50 border border-emerald-200/60 rounded-xl p-2 flex items-center justify-between text-[11px] text-emerald-900 font-medium shadow-3xs">
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span>{t("auto_enrich_background_complete", currentAppLang) || "Background enrichment finished"}</span>
              </div>
              <span className="font-mono text-[10px] font-bold text-emerald-700">
                {enrichmentProgress.completedCount} done
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
