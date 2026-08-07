import { useState, useCallback } from "react";
import { LLMConfig, TTSConfig, LLMProvider } from "../types";
import { getDefaultLLMConfig } from "../config/llmProviders";
import { DEFAULT_TTS_CONFIG } from "../utils/ttsService";
import { switchActiveProvider } from "../utils/llmHelpers";
import { lockModel } from "../utils/autoModeManager";
import { saveLLMConfigToDB, saveTTSConfigToDB } from "../db/indexedDB";
import { DEFAULT_PROVIDER_ID } from "../config/llmProviders";

export function useLlmAndTtsConfig() {
  const [llmConfig, setLlmConfig] = useState<LLMConfig>(getDefaultLLMConfig());
  const [ttsConfig, setTtsConfig] = useState<TTSConfig>(DEFAULT_TTS_CONFIG);
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
    const provider = currentConfig.provider || "groq";

    if (provider === "auto" || currentConfig.model === "auto") {
      console.warn("[Auto Mode] Suppressing dialog modal in Auto Mode. Automatically selecting another model candidate...", rawMsg);
      
      if (err?.provider && err?.model) {
        lockModel(err.provider, err.model, 3600000, rawMsg);
      }

      if (rawMsg.includes("All AI models in Auto Mode failed") || rawMsg.includes("locked out")) {
        setAiErrorModal({
          isOpen: true,
          errorMessage: "All AI models in Auto Mode are currently unavailable. Please check your network connection or API settings.",
          failedProvider: "auto",
          retryAction
        });
        return;
      }

      const updatedConfig: LLMConfig = {
        ...currentConfig,
        provider: "auto",
        model: "auto"
      };

      if (retryAction) {
        setTimeout(() => {
          retryAction(updatedConfig);
        }, 1000);
      }
      return;
    }

    setAiErrorModal({
      isOpen: true,
      errorMessage: rawMsg,
      failedProvider: provider,
      retryAction
    });
  }, []);

  const handleConfirmSwitchAndRetry = useCallback((newProvider: LLMProvider) => {
    const retryFn = aiErrorModal.retryAction;

    const updatedConfig = switchActiveProvider(llmConfig, newProvider);
    setLlmConfig(updatedConfig);
    saveLLMConfigToDB(updatedConfig).catch(e => console.error("Error saving updated LLM config:", e));

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
    saveTTSConfigToDB(newConfig).catch(e => console.error("IndexedDB TTS save error:", e));
  }, []);

  const handleSaveLlmConfig = useCallback((newConfig: LLMConfig) => {
    setLlmConfig(newConfig);
    saveLLMConfigToDB(newConfig).catch(e => console.error("IndexedDB config save error:", e));
    try {
      localStorage.setItem("vocab_learner_llm_config", JSON.stringify(newConfig));
    } catch (e) {
      console.error("Failed to save LLM config to localStorage", e);
    }
    setIsLlmModalOpen(false);
  }, []);

  const handleSwitchProviderQuick = useCallback((providerId: LLMProvider, modelOverride?: string) => {
    let switched = switchActiveProvider(llmConfig, providerId);
    if (modelOverride) {
      switched = { ...switched, model: modelOverride };
    }
    setLlmConfig(switched);
    saveLLMConfigToDB(switched).catch(e => console.error("IndexedDB config save error:", e));
    try {
      localStorage.setItem("vocab_learner_llm_config", JSON.stringify(switched));
    } catch (e) {
      console.error("Failed to save LLM config to localStorage", e);
    }
  }, [llmConfig]);

  const handleOpenLlmModal = useCallback((initialProvider?: LLMProvider) => {
    if (initialProvider && initialProvider !== llmConfig.provider) {
      const switched = switchActiveProvider(llmConfig, initialProvider);
      setLlmConfig(switched);
      saveLLMConfigToDB(switched).catch(e => console.error("IndexedDB config save error:", e));
      try {
        localStorage.setItem("vocab_learner_llm_config", JSON.stringify(switched));
      } catch (e) {
        console.error("Failed to save LLM config to localStorage", e);
      }
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
