import { useState, useEffect, useRef } from "react";
import { Clock, RefreshCw, X, AlertTriangle } from "lucide-react";
import { ChatMessage, LLMConfig } from "../../types";
import { t } from "../../config/i18n";

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

  const [secondsLeft, setSecondsLeft] = useState(5);
  const [isCancelled, setIsCancelled] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const timerRef = useRef<any>(null);

  // Trigger retry when countdown reaches 0
  const handleTriggerRetry = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setIsRetrying(true);
    onRetry();
  };

  const handleCancelCountdown = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setIsCancelled(true);
    if (onCancel) {
      onCancel();
    }
  };

  useEffect(() => {
    if (isCancelled || isRetrying) return;

    timerRef.current = setInterval(() => {
      setSecondsLeft((prev) => {
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
  }, [isCancelled, isRetrying]);

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
        {msg.errorInfo?.message || msg.content || "An error occurred while communicating with the AI service."}
      </div>

      {/* Countdown & Action Bar */}
      <div className="pt-2 border-t border-rose-100/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        {/* Left status / countdown */}
        <div className="flex flex-col">
          {!isCancelled && !isRetrying && secondsLeft > 0 ? (
            <>
              <div className="flex items-center gap-2">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-500"></span>
                </span>
                <span className="text-xs sm:text-sm font-semibold text-rose-900">
                  {t("chat_error_auto_retry_countdown", currentAppLang, { seconds: String(secondsLeft) })}
                </span>
              </div>
              {isAutoMode && (
                <span className="text-[11px] text-stone-500 mt-0.5 ml-4.5">
                  {t("chat_error_auto_mode_switch_note", currentAppLang)}
                </span>
              )}
            </>
          ) : isRetrying ? (
            <div className="flex items-center gap-2 text-rose-700 text-xs sm:text-sm font-medium">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              <span>{t("chat_error_retrying_now", currentAppLang)}</span>
            </div>
          ) : (
            <span className="text-xs text-stone-500 italic">
              {t("chat_error_retry_cancelled", currentAppLang)}
            </span>
          )}
        </div>

        {/* Right buttons */}
        <div className="flex items-center gap-2 shrink-0">
          {!isCancelled && !isRetrying && secondsLeft > 0 ? (
            <>
              <button
                type="button"
                onClick={handleTriggerRetry}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 active:scale-95 text-white text-xs sm:text-sm font-medium shadow-sm transition-all cursor-pointer"
                title="Retry right now without waiting"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>{t("chat_error_try_again_now", currentAppLang)}</span>
              </button>

              <button
                type="button"
                onClick={handleCancelCountdown}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-white hover:bg-stone-100 border border-stone-200 text-stone-600 text-xs sm:text-sm font-medium transition-all cursor-pointer"
                title="Cancel automatic retry"
              >
                <X className="w-3.5 h-3.5" />
                <span>{t("chat_error_cancel_retry", currentAppLang)}</span>
              </button>
            </>
          ) : !isRetrying ? (
            <button
              type="button"
              onClick={handleTriggerRetry}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-stone-800 hover:bg-stone-900 active:scale-95 text-white text-xs sm:text-sm font-medium shadow-sm transition-all cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>{t("chat_error_retry_btn", currentAppLang)}</span>
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
