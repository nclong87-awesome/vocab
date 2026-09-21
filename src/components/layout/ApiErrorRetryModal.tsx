import { useState, useEffect, useRef } from "react";
import { AlertTriangle, ShieldAlert, X, RefreshCw } from "lucide-react";
import { t } from "../../config/i18n";

export interface ApiErrorRetryModalProps {
  isOpen: boolean;
  errorMessage: string;
  failedModel?: string;
  retryAttempt?: number;
  maxRetries?: number;
  appLanguage?: string;
  onRetry: () => void;
  onClose: () => void;
}

export default function ApiErrorRetryModal({
  isOpen,
  errorMessage,
  failedModel = "9flare/pro/gpt-5.6-luna",
  retryAttempt = 2,
  maxRetries = 3,
  appLanguage,
  onRetry,
  onClose,
}: ApiErrorRetryModalProps) {
  const [countdown, setCountdown] = useState(3);
  const [isPaused, setIsPaused] = useState(false);
  const timerRef = useRef<any>(null);

  const currentAppLang =
    appLanguage ||
    (typeof window !== "undefined" ? localStorage.getItem("vocab_learner_app_lang") : null) ||
    "en";

  // Reset countdown whenever modal opens with fresh attempt
  useEffect(() => {
    if (isOpen) {
      setCountdown(3);
      setIsPaused(false);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  }, [isOpen, retryAttempt, failedModel]);

  // Countdown timer effect
  useEffect(() => {
    if (!isOpen || isPaused) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    timerRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }
          // Auto trigger retry when reaches 0s
          setTimeout(() => {
            onRetry();
          }, 50);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isOpen, isPaused, onRetry]);

  if (!isOpen) return null;

  const togglePause = () => {
    setIsPaused((prev) => !prev);
  };

  const handleRetryNow = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    onRetry();
  };

  const handleClose = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    onClose();
  };

  // Format error message using current language translations
  let formattedError = errorMessage || t("api_error_fallback", currentAppLang);
  if (formattedError.includes("Timeout 30s") || formattedError.includes("30 seconds") || formattedError.includes("30 giây")) {
    formattedError = t("api_error_timeout_desc", currentAppLang, { model: failedModel });
  } else if (formattedError.includes("HTTP 401") || formattedError.includes("Unauthorized")) {
    const prefix = t("api_error_model_failed_prefix", currentAppLang, { model: failedModel });
    formattedError = `${prefix}: HTTP 401: Unauthorized.`;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-fade-in select-none"
      id="api-error-retry-modal"
    >
      <div className="relative w-full max-w-[390px] sm:max-w-[430px] bg-white rounded-3xl shadow-2xl p-5 sm:p-6 border border-slate-100 overflow-hidden flex flex-col">
        {/* Top red accent line */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-rose-500 via-red-500 to-rose-600" />

        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-3.5">
          {/* Warning Icon Container */}
          <div className="w-11 h-11 rounded-2xl bg-rose-50 border border-rose-100 flex items-center justify-center text-rose-500 shrink-0">
            <AlertTriangle className="w-5 h-5 stroke-[2.3]" />
          </div>

          {/* Title & Model Badge */}
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-bold text-stone-900 leading-tight">
              {t("api_error_modal_title", currentAppLang)}
            </h3>
            <div className="mt-1.5 inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg bg-rose-50/70 border border-rose-200 text-rose-700 text-xs font-mono font-medium max-w-full truncate">
              <ShieldAlert className="w-3.5 h-3.5 text-rose-500 shrink-0" />
              <span className="truncate">{failedModel}</span>
            </div>
          </div>

          {/* Close button */}
          <button
            type="button"
            onClick={handleClose}
            className="text-stone-400 hover:text-stone-600 p-1 rounded-lg hover:bg-stone-100 transition-colors cursor-pointer"
            title={t("api_error_close", currentAppLang)}
          >
            <X className="w-4 h-4 stroke-[2.5]" />
          </button>
        </div>

        {/* Body Cards */}
        <div className="flex flex-col gap-2.5 mb-1">
          {/* Card 1: Error details */}
          <div className="p-3.5 rounded-2xl bg-rose-50/60 border border-rose-200/80 text-xs text-rose-950 font-normal leading-relaxed break-words font-sans">
            {formattedError}
          </div>

          {/* Card 2: Circuit Breaker isolation status */}
          <div className="p-3.5 rounded-2xl bg-stone-50 border border-stone-200/80 text-xs text-stone-700 leading-relaxed flex items-start gap-2.5">
            <span className="w-2 h-2 rounded-full bg-rose-400 mt-1.5 shrink-0" />
            <span>
              <strong className="font-semibold text-stone-900">
                {t("api_error_circuit_breaker", currentAppLang)}:
              </strong>{" "}
              {t("api_error_circuit_breaker_desc", currentAppLang)}
            </span>
          </div>

          {/* Card 3: Automated retry countdown */}
          <div className="p-3 rounded-2xl bg-amber-50/70 border border-amber-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500 shrink-0" />
              <span className="text-xs sm:text-sm font-semibold text-stone-800">
                {t("api_error_auto_retry", currentAppLang, {
                  attempt: String(retryAttempt),
                  max: String(maxRetries),
                })}
              </span>
            </div>
            <div className="px-3 py-1 bg-white border border-amber-300 rounded-xl font-bold text-amber-900 text-sm shadow-2xs">
              {countdown}s
            </div>
          </div>
        </div>

        {/* Footer Buttons */}
        <div className="flex gap-3 mt-4">
          <button
            type="button"
            onClick={togglePause}
            className="flex-1 py-2.5 px-4 rounded-2xl border border-stone-300 bg-white hover:bg-stone-50 active:scale-98 text-stone-700 text-xs sm:text-sm font-semibold transition-all cursor-pointer text-center"
          >
            {isPaused
              ? t("api_error_resume_countdown", currentAppLang)
              : t("api_error_pause_countdown", currentAppLang)}
          </button>

          <button
            type="button"
            onClick={handleRetryNow}
            className="flex-1 py-2.5 px-4 rounded-2xl bg-rose-600 hover:bg-rose-700 active:scale-98 text-white text-xs sm:text-sm font-bold transition-all shadow-sm flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className="w-4 h-4" />
            <span>{t("api_error_retry_now", currentAppLang)}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
