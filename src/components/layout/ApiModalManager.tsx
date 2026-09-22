import { useState, useEffect, useCallback, useRef } from "react";
import { LLMConfig } from "../../types";
import ApiCallProgressModal from "./ApiCallProgressModal";
import ApiErrorRetryModal from "./ApiErrorRetryModal";
import { lockModel, recordModelFailure } from "../../utils/autoModeManager";
import { t } from "../../config/i18n";
import {
  subscribeLlmRequestStart,
  subscribeLlmRequestEnd,
  subscribeLlmApiError,
  subscribeCloseLlmModals,
  publishCentralModalVisibility,
  LlmRequestStartEvent,
  LlmApiErrorEvent
} from "../../utils/llmEvents";

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

export default function ApiModalManager({ llmConfig, appLanguage }: ApiModalManagerProps) {
  // Progress modal state
  const [progressState, setProgressState] = useState<{
    isOpen: boolean;
    action: string;
    provider: string;
    model: string;
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
  // so inline progress indicators in chat can hide while this modal is open
  useEffect(() => {
    publishCentralModalVisibility(progressState.isOpen);
  }, [progressState.isOpen]);

  useEffect(() => {
    return () => {
      publishCentralModalVisibility(false);
    };
  }, []);

  const timeoutWatchdogRef = useRef<NodeJS.Timeout | null>(null);
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

    // 1. Abort the hanging request
    if (onCancelRef.current) {
      try {
        onCancelRef.current();
      } catch (e) {
        console.error("[ApiModalManager] Error cancelling timed-out request:", e);
      }
    }

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
      // Clear any prior watchdog timer
      if (timeoutWatchdogRef.current) {
        clearTimeout(timeoutWatchdogRef.current);
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
        onCancel: data.onCancel,
      });

      // Start strict 30-second watchdog timer
      timeoutWatchdogRef.current = setTimeout(() => {
        handleTimeout(data);
      }, 30000);
    });

    const unsubEnd = subscribeLlmRequestEnd((data) => {
      if (timeoutWatchdogRef.current) {
        clearTimeout(timeoutWatchdogRef.current);
        timeoutWatchdogRef.current = null;
      }

      if (data.success) {
        setProgressState((prev) => ({ ...prev, isOpen: false }));
      }
    });

    const unsubError = subscribeLlmApiError((data: LlmApiErrorEvent) => {
      if (timeoutWatchdogRef.current) {
        clearTimeout(timeoutWatchdogRef.current);
        timeoutWatchdogRef.current = null;
      }

      lastRetryFnRef.current = data.onRetry;

      // Close progress modal
      setProgressState((prev) => ({ ...prev, isOpen: false }));

      // Open error retry modal
      setErrorState({
        isOpen: true,
        errorMessage: data.errorMessage,
        failedModel: data.model,
        retryAttempt: data.retryAttempt ?? 1,
        maxRetries: data.maxRetries ?? 3,
        onRetry: data.onRetry,
        onClose: data.onCancel,
      });
    });

    const unsubClose = subscribeCloseLlmModals(() => {
      if (timeoutWatchdogRef.current) {
        clearTimeout(timeoutWatchdogRef.current);
        timeoutWatchdogRef.current = null;
      }
      setProgressState((prev) => ({ ...prev, isOpen: false }));
      setErrorState((prev) => ({ ...prev, isOpen: false }));
    });

    return () => {
      if (timeoutWatchdogRef.current) {
        clearTimeout(timeoutWatchdogRef.current);
      }
      unsubStart();
      unsubEnd();
      unsubError();
      unsubClose();
    };
  }, [handleTimeout]);

  const handleCancelProgress = useCallback(() => {
    if (timeoutWatchdogRef.current) {
      clearTimeout(timeoutWatchdogRef.current);
      timeoutWatchdogRef.current = null;
    }
    if (onCancelRef.current) {
      try {
        onCancelRef.current();
      } catch (e) {
        console.error("Error cancelling LLM request:", e);
      }
    }
    setProgressState((prev) => ({ ...prev, isOpen: false }));
  }, []);

  const handleRetryError = useCallback(() => {
    const retryFn = errorState.onRetry || lastRetryFnRef.current;
    if (retryFn) {
      retryFn();
    }
    // Give a brief visual transition window so the user sees the active retrying state
    // rather than the modal vanishing abruptly. The next request start event will also close it cleanly.
    setTimeout(() => {
      setErrorState((prev) => ({ ...prev, isOpen: false }));
    }, 600);
  }, [errorState.onRetry]);

  const handleCloseError = useCallback(() => {
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
        llmConfig={llmConfig}
        appLanguage={appLanguage}
        onCancel={handleCancelProgress}
        onTimeout={handleTimeout}
      />

      {/* Error & Automated Countdown Retry Dialog */}
      <ApiErrorRetryModal
        isOpen={errorState.isOpen}
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
