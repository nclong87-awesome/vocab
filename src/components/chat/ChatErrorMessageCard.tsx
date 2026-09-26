import { useState, useEffect, useRef } from "react";
import { Clock, RefreshCw, X, AlertTriangle } from "lucide-react";
import { ChatMessage, LLMConfig } from "../../types";
import { t } from "../../config/i18n";
import { extractCleanErrorMessage } from "../../utils/llmHelpers";

interface ChatErrorMessageCardProps {
  msg: ChatMessage;
  appLanguage?: string;
  llmConfig: LLMConfig;
  onRetry: () => void;
  onCancel?: () => void;
}

export default function ChatErrorMessageCard({
  msg,
  appLanguage,
  llmConfig,
  onRetry,
  onCancel,
}: ChatErrorMessageCardProps) {
  const currentAppLang = appLanguage || localStorage.getItem("vocab_learner_app_lang") || "vi";
  const isAutoMode = llmConfig.provider === "auto" || llmConfig.model === "auto";

  const isTimeout = Boolean(
    msg.errorInfo?.isTimeout ||
    msg.content?.toLowerCase().includes("timeout") ||
    msg.content?.toLowerCase().includes("timed out")
  );

  const isExternallyDisabled = msg.errorInfo?.canRetry === false;
  const isExternallyRetrying = Boolean((msg.errorInfo as any)?.isRetrying);
  const isMaxReached = Boolean(
    msg.errorInfo?.retryAttempt &&
    msg.errorInfo?.maxRetries &&
    msg.errorInfo.retryAttempt >= msg.errorInfo.maxRetries
  );

  const [countdown, setCountdown] = useState(5);
  const [isCancelled, setIsCancelled] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const onRetryRef = useRef(onRetry);
  onRetryRef.current = onRetry;
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  // Trigger retry when button manually clicked or countdown reaches 0
  const handleTriggerRetry = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setIsRetrying(true);
    onRetryRef.current();
  };

  const handleCancelCountdown = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setIsCancelled(true);
    if (onCancelRef.current) {
      onCancelRef.current();
    }
  };

  const activeRetrying = isRetrying || isExternallyRetrying;
  const activeCancelled = isCancelled || isExternallyDisabled;

  // Automated 5-second countdown timer for retrying failed requests
  useEffect(() => {
    if (activeCancelled || activeRetrying || isMaxReached) {
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
          handleTriggerRetry();
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
  }, [activeCancelled, activeRetrying, isMaxReached]);

  const errorTitle = isTimeout
    ? t("chat_error_timeout_title", currentAppLang)
    : t("chat_error_title", currentAppLang);

  const displayModel = msg.model || msg.errorInfo?.model;
  const displayProvider = msg.provider || msg.errorInfo?.provider;

  return (
    <div className="w-full max-w-2xl mx-auto my-2 rounded-2xl border border-rose-200/90 bg-gradient-to-b from-rose-50/90 to-amber-50/50 p-4 sm:p-5 shadow-sm text-stone-800 transition-all">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-2.5">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-rose-100 flex items-center justify-center text-rose-600 shrink-0">
            {isTimeout ? (
              <Clock className="w-4 h-4 text-rose-600 animate-pulse" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-rose-600" />
            )}
          </div>
          <div>
            <h4 className="font-semibold text-rose-950 text-sm sm:text-base leading-tight">
              {errorTitle}
            </h4>
            {(displayProvider || displayModel) && (
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-rose-100/80 text-rose-800 border border-rose-200/60">
                  {displayProvider ? `${displayProvider}: ` : ""}{displayModel || "AI Model"}
                </span>
                {isAutoMode && (
                  <span className="text-[11px] font-medium text-amber-700 bg-amber-100/70 px-1.5 py-0.5 rounded">
                    Auto Mode
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Timestamp */}
        {msg.timestamp && (
          <span className="text-[11px] text-stone-400 shrink-0">
            {new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
      </div>

      {/* Error Message Details */}
      <div className="text-xs sm:text-sm text-stone-700 bg-white/70 rounded-xl p-3 border border-rose-100/80 mb-3.5 leading-relaxed break-words font-mono">
        {extractCleanErrorMessage(msg.errorInfo?.message || msg.content) || "An error occurred while communicating with the AI service."}
      </div>

      {/* Countdown & Action Bar */}
      <div className="pt-2 border-t border-rose-100/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        {/* Left status */}
        <div className="flex flex-col gap-0.5">
          {activeRetrying ? (
            <div className="flex items-center gap-2 text-rose-700 text-xs sm:text-sm font-medium">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              <span>{t("chat_error_retrying_now", currentAppLang)}</span>
            </div>
          ) : isMaxReached ? (
            <span className="text-xs sm:text-sm font-medium text-rose-900">
              {t("chat_error_max_reached", currentAppLang, { max: String(msg.errorInfo?.maxRetries || 3) })}
            </span>
          ) : activeCancelled ? (
            <span className="text-xs text-stone-500 italic">
              {t("chat_error_retry_cancelled", currentAppLang)}
            </span>
          ) : (
            <div className="flex flex-col">
              <div className="flex items-center gap-2 text-xs sm:text-sm font-semibold text-amber-900">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                </span>
                <span>
                  {t("chat_error_auto_retry_countdown", currentAppLang, { seconds: String(countdown) })}
                </span>
              </div>
              {isAutoMode && (
                <span className="text-[11px] text-stone-500 mt-0.5">
                  {t("chat_error_auto_mode_switch_note", currentAppLang)}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Right buttons */}
        <div className="flex items-center gap-2 shrink-0">
          {!activeRetrying && (
            <>
              <button
                type="button"
                onClick={handleTriggerRetry}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 active:scale-95 text-white text-xs sm:text-sm font-medium shadow-sm transition-all cursor-pointer"
                title="Retry now"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>{t("chat_error_try_again_now", currentAppLang)}</span>
              </button>

              {!activeCancelled && !isMaxReached && (
                <button
                  type="button"
                  onClick={handleCancelCountdown}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-white hover:bg-stone-100 border border-stone-200 text-stone-600 text-xs sm:text-sm font-medium transition-all cursor-pointer"
                  title="Dismiss error"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>{t("chat_error_cancel_retry", currentAppLang)}</span>
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
