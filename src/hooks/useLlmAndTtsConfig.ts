import { useState, useCallback } from "react";
import { LLMConfig, TTSConfig, LLMProvider } from "../types";
import { getDefaultLLMConfig } from "../config/llmProviders";
import { DEFAULT_TTS_CONFIG } from "../utils/ttsService";
import { switchActiveProvider, sanitizeLlmConfig } from "../utils/llmHelpers";
import { lockModel } from "../utils/autoModeManager";
import { publishLlmApiError } from "../utils/llmEvents";
import {
  getLLMConfigFromLocalStorage,
  saveLLMConfigToLocalStorage,
  getTTSConfigFromLocalStorage,
  saveTTSConfigToLocalStorage
} from "../db/indexedDB";
import { DEFAULT_PROVIDER_ID } from "../config/llmProviders";

export function useLlmAndTtsConfig() {
  const [llmConfig, setLlmConfig] = useState<LLMConfig>(() =>
    getLLMConfigFromLocalStorage(getDefaultLLMConfig())
  );
  const [ttsConfig, setTtsConfig] = useState<TTSConfig>(() =>
    getTTSConfigFromLocalStorage(DEFAULT_TTS_CONFIG)
  );
  const [isLlmModalOpen, setIsLlmModalOpen] = useState<boolean>(false);
  const [isOnboardingModalOpen, setIsOnboardingModalOpen] = useState<boolean>(false);

  const [aiErrorModal, setAiErrorModal] = useState<{
    isOpen: boolean;
    errorMessage: string;
    failedProvider: LLMProvider;
    retryAction: ((newConfig: LLMConfig) => void) | null;
  }>({
    isOpen: false,
    errorMessage: "",
    failedProvider: DEFAULT_PROVIDER_ID,
    retryAction: null
  });

  const handleAiApiError = useCallback((
    err: any, 
    currentConfig: LLMConfig, 
    retryAction: (newConfig: LLMConfig) => void
  ) => {
    const rawMsg = err?.userMessage || err?.message || (typeof err === "string" ? err : "Failed to communicate with AI provider.");
    const provider = err?.provider || currentConfig.provider || "groq";
    const model = err?.model || currentConfig.model || "9flare/pro/gpt-5.6-luna";

    if (provider && model) {
      lockModel(provider, model, 3600000, rawMsg);
    }

    publishLlmApiError({
      errorMessage: rawMsg,
      provider,
      model,
      retryAttempt: 2,
      maxRetries: 3,
      onRetry: (newConfig) => {
        retryAction(newConfig || currentConfig);
      }
    });

    setAiErrorModal({
      isOpen: false,
      errorMessage: rawMsg,
      failedProvider: provider as LLMProvider,
      retryAction
    });
  }, []);

  const handleConfirmSwitchAndRetry = useCallback((newProvider: LLMProvider) => {
    const retryFn = aiErrorModal.retryAction;

    const updatedConfig = switchActiveProvider(llmConfig, newProvider);
    setLlmConfig(updatedConfig);
    saveLLMConfigToLocalStorage(updatedConfig);

    setAiErrorModal({
      isOpen: false,
      errorMessage: "",
      failedProvider: "groq",
      retryAction: null
    });

    if (retryFn) {
      setTimeout(() => {
        retryFn(updatedConfig);
      }, 50);
    }
  }, [aiErrorModal.retryAction, llmConfig]);

  const handleSaveTTSConfig = useCallback((newConfig: TTSConfig) => {
    setTtsConfig(newConfig);
    saveTTSConfigToLocalStorage(newConfig);
  }, []);

  const handleSaveLlmConfig = useCallback((newConfig: LLMConfig) => {
    const sanitized = sanitizeLlmConfig(newConfig);
    setLlmConfig(sanitized);
    saveLLMConfigToLocalStorage(sanitized);
    setIsLlmModalOpen(false);
  }, []);

  const handleSwitchProviderQuick = useCallback((providerId: LLMProvider, modelOverride?: string) => {
    let switched = switchActiveProvider(llmConfig, providerId);
    if (modelOverride) {
      switched = sanitizeLlmConfig({ ...switched, model: modelOverride });
    }
    setLlmConfig(switched);
    saveLLMConfigToLocalStorage(switched);
  }, [llmConfig]);

  const handleOpenLlmModal = useCallback((initialProvider?: LLMProvider) => {
    if (initialProvider && initialProvider !== llmConfig.provider) {
      const switched = switchActiveProvider(llmConfig, initialProvider);
      setLlmConfig(switched);
      saveLLMConfigToLocalStorage(switched);
    }
    setIsLlmModalOpen(true);
  }, [llmConfig]);

  return {
    llmConfig,
    setLlmConfig,
    ttsConfig,
    setTtsConfig,
    isLlmModalOpen,
    setIsLlmModalOpen,
    isOnboardingModalOpen,
    setIsOnboardingModalOpen,
    aiErrorModal,
    setAiErrorModal,
    handleAiApiError,
    handleConfirmSwitchAndRetry,
    handleSaveTTSConfig,
    handleSaveLlmConfig,
    handleSwitchProviderQuick,
    handleOpenLlmModal,
  };
}
