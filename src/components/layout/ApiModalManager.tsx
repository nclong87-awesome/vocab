import { useState, useEffect, useCallback, useRef } from "react";
import { LLMConfig } from "../../types";
import ApiCallProgressModal from "./ApiCallProgressModal";
import ApiErrorRetryModal from "./ApiErrorRetryModal";
import { lockModel, recordModelFailure } from "../../utils/autoModeManager";
import { t } from "../../config/i18n";
import { extractCleanErrorMessage } from "../../utils/llmHelpers";
import {
  subscribeLlmRequestStart,
  subscribeLlmRequestEnd,
  subscribeLlmApiError,
  subscribeCloseLlmModals,
  publishCentralModalVisibility,
  LlmRequestStartEvent,
  LlmApiErrorEvent
} from "../../utils/llmEvents";
import {
  subscribeEnrichmentProgress,
  isEnrichmentQueueRunning,
  cancelBatchEnrichment,
  BatchEnrichmentProgress
} from "../../services/backgroundEnrichmentService";

export interface ApiModalManagerProps {
  llmConfig?: LLMConfig;
  appLanguage?: string;
}

/**
 * Determines whether an action is part of the interactive chat experience
 * (where the chat interface already has its own inline typing/progress indicator).
 */
export function isChatAction(action?: string): boolean {
  if (!action) return false;
  const act = action.toLowerCase().trim();
  return (
    act === "chat" ||
    act === "send_message" ||
    act === "chat_message" ||
    act === "ask_ai" ||
    act === "word_chat" ||
    act === "challenge_ask_ai" ||
    act === "challenge ask ai" ||
    act === "suggest_casual_reply" ||
    act === "fix_grammar" ||
    act === "chat_quiz" ||
    act === "quick_chat" ||
    act.startsWith("chat") ||
    act.includes("chat") ||
    act.includes("ask ai") ||
    act.includes("ask_ai")
  );
}

/**
 * Determines whether an action is a non-interactive background worker task
 * (such as silent image search keyword generation)
 * which should never display an intrusive modal or disrupt active foreground requests.
 */
export function isBackgroundAction(action?: string): boolean {
  if (!action) return false;
  const act = action.toLowerCase().trim();
  return (
    act === "background" ||
    act === "image_query" ||
    act === "background_image_query" ||
    act.startsWith("background_image")
  );
}

export default function ApiModalManager({ llmConfig, appLanguage }: ApiModalManagerProps) {
  // Progress modal state
  const [progressState, setProgressState] = useState<{
    isOpen: boolean;
    action: string;
    provider: string;
    model: string;
    requestId?: string | number;
    onCancel?: () => void;
  }>({
    isOpen: false,
    action: "generateChallenge",
    provider: "groq",
    model: "openai/gpt-oss-120b",
  });

  // Error retry modal state
  const [errorState, setErrorState] = useState<{
    isOpen: boolean;
    errorId?: string;
    errorMessage: string;
    failedModel: string;
    retryAttempt: number;
    maxRetries: number;
    onRetry?: (newConfig?: LLMConfig) => void;
    onClose?: () => void;
  }>({
    isOpen: false,
    errorMessage: "",
    failedModel: "9flare/pro/gpt-5.6-luna",
    retryAttempt: 2,
    maxRetries: 3,
  });

  const onCancelRef = useRef<(() => void) | undefined>(undefined);
  onCancelRef.current = progressState.onCancel;

  // Synchronize central progress modal visibility with global state
  // so inline progress indicators in chat and floating toasts can hide while this modal is open
  useEffect(() => {
    publishCentralModalVisibility(progressState.isOpen || errorState.isOpen);
  }, [progressState.isOpen, errorState.isOpen]);

  useEffect(() => {
    return () => {
      publishCentralModalVisibility(false);
    };
  }, []);

  const timeoutWatchdogRef = useRef<NodeJS.Timeout | null>(null);
  const retryCloseTimerRef = useRef<NodeJS.Timeout | null>(null);
  const activeRequestRef = useRef<LlmRequestStartEvent | null>(null);
  const lastRetryFnRef = useRef<((newConfig?: LLMConfig) => void) | undefined>(undefined);

  // Trigger timeout handling when an LLM call exceeds 30 seconds
  const handleTimeout = useCallback((overrideData?: LlmRequestStartEvent) => {
    if (timeoutWatchdogRef.current) {
      clearTimeout(timeoutWatchdogRef.current);
      timeoutWatchdogRef.current = null;
    }

    const currentReq = overrideData || activeRequestRef.current;
    const providerName = currentReq?.provider || progressState.provider || "groq";
    const modelName = currentReq?.model || progressState.model || "openai/gpt-oss-120b";

    // 1. Abort the hanging request and any active enrichment queue
    if (onCancelRef.current) {
      try {
        onCancelRef.current();
      } catch (e) {
        console.error("[ApiModalManager] Error cancelling timed-out request:", e);
      }
    }
    cancelBatchEnrichment();

    // 2. Lock failing model via Circuit Breaker
    try {
      recordModelFailure(providerName, modelName, "API Request Timed Out (30s)", 30000);
      lockModel(
        providerName,
        modelName,
        3600000,
        `API Request Timed Out (30s): Model ${modelName} did not respond within 30 seconds.`
      );
    } catch (e) {
      console.warn("[ApiModalManager] Failed to lock model:", e);
    }

    // 3. Close the progress modal
    setProgressState((prev) => ({ ...prev, isOpen: false }));

    const currentAppLang =
      appLanguage ||
      (typeof window !== "undefined" ? localStorage.getItem("vocab_learner_app_lang") : null) ||
      "en";

    // 4. Open the Error & Retry Countdown Modal
    setErrorState({
      isOpen: true,
      errorMessage: t("api_error_timeout_desc", currentAppLang, { model: modelName }),
      failedModel: modelName,
      retryAttempt: 2,
      maxRetries: 3,
      onRetry: () => {
        setErrorState((prev) => ({ ...prev, isOpen: false }));
        if (lastRetryFnRef.current) {
          lastRetryFnRef.current();
        }
      },
      onClose: () => {
        setErrorState((prev) => ({ ...prev, isOpen: false }));
      }
    });
  }, [progressState.provider, progressState.model, appLanguage]);

  // Listen to request start, end, and error events
  useEffect(() => {
    const unsubStart = subscribeLlmRequestStart((data: LlmRequestStartEvent) => {
      // Do not open foreground progress modal for background or chat actions (chat has inline typing indicator)
      if (isBackgroundAction(data.action) || isChatAction(data.action)) {
        return;
      }

      // Clear any prior watchdog timer
      if (timeoutWatchdogRef.current) {
        clearTimeout(timeoutWatchdogRef.current);
      }
      if (retryCloseTimerRef.current) {
        clearTimeout(retryCloseTimerRef.current);
        retryCloseTimerRef.current = null;
      }

      activeRequestRef.current = data;

      // Close error modal if one was open
      setErrorState((prev) => ({ ...prev, isOpen: false }));

      // Open central progress modal for active request
      setProgressState({
        isOpen: true,
        action: data.action || "chat",
        provider: data.provider,
        model: data.model,
        requestId: data.timestamp || Date.now(),
        onCancel: data.onCancel,
      });

      // Start strict 30-second watchdog timer
      timeoutWatchdogRef.current = setTimeout(() => {
        handleTimeout(data);
      }, 30000);
    });

    const unsubEnd = subscribeLlmRequestEnd((data) => {
      if (isBackgroundAction(data.action) || isChatAction(data.action)) {
        return;
      }

      if (timeoutWatchdogRef.current) {
        clearTimeout(timeoutWatchdogRef.current);
        timeoutWatchdogRef.current = null;
      }

      if (data.success) {
        if (retryCloseTimerRef.current) {
          clearTimeout(retryCloseTimerRef.current);
          retryCloseTimerRef.current = null;
        }
        lastRetryFnRef.current = null;

        // When enriching incomplete words, keep the progress dialog open
        // until there are no remaining words in the queue!
        if (isEnrichmentQueueRunning()) {
          return;
        }

        setProgressState((prev) => ({ ...prev, isOpen: false }));
        setErrorState((prev) => ({ ...prev, isOpen: false }));
      }
    });

    // Subscribe to enrichment progress: close modal once queue completely finishes
    const unsubEnrich = subscribeEnrichmentProgress((p: BatchEnrichmentProgress) => {
      if (!p.isRunning) {
        setProgressState((prev) => {
          if (
            prev.isOpen &&
            (prev.action === "enrich_incomplete_words" ||
              prev.action === "enrich_word" ||
              prev.action.toLowerCase().includes("enrich"))
          ) {
            return { ...prev, isOpen: false };
          }
          return prev;
        });
      }
    });

    const unsubError = subscribeLlmApiError((data: LlmApiErrorEvent) => {
      // Background worker errors should be handled by their respective services without blocking the screen
      if (isBackgroundAction(data.action)) {
        return;
      }
      if (timeoutWatchdogRef.current) {
        clearTimeout(timeoutWatchdogRef.current);
        timeoutWatchdogRef.current = null;
      }
      // CRITICAL: Cancel any pending retry-close timeout so it doesn't dismiss this new error!
      if (retryCloseTimerRef.current) {
        clearTimeout(retryCloseTimerRef.current);
        retryCloseTimerRef.current = null;
      }

      lastRetryFnRef.current = data.onRetry;

      // Close progress modal
      setProgressState((prev) => ({ ...prev, isOpen: false }));

      // Open error retry modal with unique errorId so countdown and retrying flags reset
      setErrorState({
        isOpen: true,
        errorId: `err-${Date.now()}-${Math.random()}`,
        errorMessage: extractCleanErrorMessage(data.errorMessage),
        failedModel: data.model,
        retryAttempt: data.retryAttempt ?? 1,
        maxRetries: data.maxRetries ?? 3,
        onRetry: data.onRetry,
        onClose: () => {
          cancelBatchEnrichment();
          if (data.onCancel) {
            data.onCancel();
          }
        },
      });
    });

    const unsubClose = subscribeCloseLlmModals(() => {
      if (timeoutWatchdogRef.current) {
        clearTimeout(timeoutWatchdogRef.current);
        timeoutWatchdogRef.current = null;
      }
      if (retryCloseTimerRef.current) {
        clearTimeout(retryCloseTimerRef.current);
        retryCloseTimerRef.current = null;
      }
      lastRetryFnRef.current = null;
      setProgressState((prev) => ({ ...prev, isOpen: false }));
      setErrorState((prev) => ({ ...prev, isOpen: false }));
    });

    return () => {
      if (timeoutWatchdogRef.current) {
        clearTimeout(timeoutWatchdogRef.current);
      }
      if (retryCloseTimerRef.current) {
        clearTimeout(retryCloseTimerRef.current);
      }
      unsubStart();
      unsubEnd();
      unsubEnrich();
      unsubError();
      unsubClose();
    };
  }, [handleTimeout]);

  const handleCancelProgress = useCallback(() => {
    if (timeoutWatchdogRef.current) {
      clearTimeout(timeoutWatchdogRef.current);
      timeoutWatchdogRef.current = null;
    }
    if (retryCloseTimerRef.current) {
      clearTimeout(retryCloseTimerRef.current);
      retryCloseTimerRef.current = null;
    }
    lastRetryFnRef.current = null;
    if (onCancelRef.current) {
      try {
        onCancelRef.current();
      } catch (e) {
        console.error("Error cancelling LLM request:", e);
      }
    }
    cancelBatchEnrichment();
    setProgressState((prev) => ({ ...prev, isOpen: false }));
    setErrorState((prev) => ({ ...prev, isOpen: false }));
  }, []);

  const handleRetryError = useCallback(() => {
    const retryFn = errorState.onRetry || lastRetryFnRef.current;
    const currentErrorId = errorState.errorId;
    lastRetryFnRef.current = null; // Consume immediately to prevent duplicate invocations
    if (retryCloseTimerRef.current) {
      clearTimeout(retryCloseTimerRef.current);
      retryCloseTimerRef.current = null;
    }
    // Give a brief visual transition window so the user sees the active retrying state.
    // If the retry request starts or errors out, retryCloseTimerRef will be cancelled.
    // Only close if the modal is still presenting this exact error.
    retryCloseTimerRef.current = setTimeout(() => {
      setErrorState((prev) => {
        if (prev.errorId === currentErrorId) {
          return { ...prev, isOpen: false };
        }
        return prev;
      });
      retryCloseTimerRef.current = null;
    }, 600);

    if (retryFn) {
      retryFn();
    }
  }, [errorState.onRetry, errorState.errorId]);

  const handleCloseError = useCallback(() => {
    if (retryCloseTimerRef.current) {
      clearTimeout(retryCloseTimerRef.current);
      retryCloseTimerRef.current = null;
    }
    lastRetryFnRef.current = null;
    cancelBatchEnrichment();
    if (errorState.onClose) {
      errorState.onClose();
    }
    setErrorState((prev) => ({ ...prev, isOpen: false }));
  }, [errorState.onClose]);

  return (
    <>
      {/* Progress Dialog when Calling API */}
      <ApiCallProgressModal
        isOpen={progressState.isOpen}
        action={progressState.action}
        provider={progressState.provider}
        model={progressState.model}
        requestId={progressState.requestId}
        llmConfig={llmConfig}
        appLanguage={appLanguage}
        onCancel={handleCancelProgress}
        onTimeout={handleTimeout}
      />

      {/* Error & Automated Countdown Retry Dialog */}
      <ApiErrorRetryModal
        key={errorState.errorId || `api-err-${errorState.retryAttempt}`}
        isOpen={errorState.isOpen}
        errorId={errorState.errorId}
        errorMessage={errorState.errorMessage}
        failedModel={errorState.failedModel}
        retryAttempt={errorState.retryAttempt}
        maxRetries={errorState.maxRetries}
        appLanguage={appLanguage}
        onRetry={handleRetryError}
        onClose={handleCloseError}
      />
    </>
  );
}
