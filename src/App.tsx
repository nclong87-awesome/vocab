import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";

import { ChatMessage, LLMConfig } from "./types";
import { saveLLMConfigToDB } from "./db/indexedDB";
import { stopSpeech, unlockAudioElement } from "./utils/ttsService";
import { recalculateWordsMemoryDecay } from "./utils/spacedRepetition";
import { DEFAULT_TTS_CONFIG } from "./utils/ttsService";
import { getDefaultLLMConfig } from "./config/llmProviders";
import { t } from "./config/i18n";
import { getStoredAccessCode, setStoredAccessCode } from "./utils";

import { 
  getAllWordsFromDB, 
  saveAllWordsToDB, 
  getStatsFromDB, 
  getLLMConfigFromDB, 
  getTTSConfigFromDB
} from "./db/indexedDB";

import ChatView from "./components/ChatView";
import CollectionManager from "./components/CollectionManager";
import SettingsView from "./components/SettingsView";
import AnalyticsDashboard from "./components/AnalyticsDashboard";
import LlmLoginModal from "./components/LlmLoginModal";
import OnboardingModal from "./components/OnboardingModal";

import AppHeader from "./components/layout/AppHeader";
import MobileSideDrawer from "./components/layout/MobileSideDrawer";
import AiErrorFallbackModal from "./components/layout/AiErrorFallbackModal";

import { useLanguages } from "./hooks/useLanguages";
import { useLlmAndTtsConfig } from "./hooks/useLlmAndTtsConfig";
import { useVocabulary } from "./hooks/useVocabulary";
import { useChat } from "./hooks/useChat";

export default function App() {
  const [currentView, setCurrentView] = useState<"chatview" | "manage" | "analytics" | "settings" >("chatview");
  const [sidePanelTab, setSidePanelTab] = useState<"collection" | "analytics" | "settings">("collection");
  const [isSidePanelOpen, setIsSidePanelOpen] = useState(false);
  const [isDataLoaded, setIsDataLoaded] = useState(false);

  // Custom hooks for sub-systems
  const {
    targetLanguage,
    setTargetLanguage,
    nativeLanguage,
    setNativeLanguage,
    appLanguage,
    setAppLanguage,
    handleSelectLanguages,
  } = useLanguages();

  const {
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
  } = useLlmAndTtsConfig();

  const {
    words,
    setWords,
    stats,
    setStats,
    handleToggleStar,
    handleToggleLearned,
    handleAddCustomWord,
    handleDeleteWord,
    handleUpdateWords,
    handleFinishQuiz,
  } = useVocabulary();

  const {
    chatMessages,
    setChatMessages,
    isTyping,
    conversationalState,
    startChatQuiz,
    handleSendChatMessage,
    handleSelectDefinition,
    handleConversationalAddWordOrPrompt,
    handleConversationalGenerateWordsPrompt,
    handlePromptSuggestCasualReply,
    handleSuggestCasualReply,
    handlePromptFixGrammar,
    handleViewFlashcard,
    handleClearChatHistory,
    handleAnalyzeImageVocab,
    handleAddMultipleWords,
  } = useChat({
    words,
    setWords,
    stats,
    llmConfig,
    targetLanguage,
    nativeLanguage,
    appLanguage,
    handleAiApiError,
    handleFinishQuiz,
  });

  // Global Interaction Listener to unlock audio context and handle user input
  useEffect(() => {
    const handleInteraction = (e: Event) => {
      unlockAudioElement();

      const target = e.target as HTMLElement;
      if (!target) return;

      if (e.type === "keydown") {
        const keyboardEvt = e as KeyboardEvent;
        if (keyboardEvt.key === "Escape") {
          stopSpeech();
        }
        return;
      }

      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.closest("input") ||
        target.closest("textarea")
      ) {
        stopSpeech();
      }
    };

    window.addEventListener("click", handleInteraction, { capture: true, passive: true });
    window.addEventListener("keydown", handleInteraction, { capture: true, passive: true });
    window.addEventListener("touchstart", handleInteraction, { capture: true, passive: true });

    return () => {
      window.removeEventListener("click", handleInteraction, { capture: true });
      window.removeEventListener("keydown", handleInteraction, { capture: true });
      window.removeEventListener("touchstart", handleInteraction, { capture: true });
    };
  }, []);

  // Complete Onboarding Handler
  const handleCompleteOnboarding = useCallback(async (data: {
    accessCode: string;
    targetLanguage: string;
    nativeLanguage: string;
    appLanguage: string;
  }) => {
    handleSelectLanguages(data.targetLanguage, data.nativeLanguage, data.appLanguage);

    const newAccessCode = data.accessCode.trim();
    setStoredAccessCode(newAccessCode);

    setLlmConfig((prevConfig) => {
      const updatedConfig: LLMConfig = {
        ...prevConfig,
      };

      saveLLMConfigToDB(updatedConfig);
      return updatedConfig;
    });

    try {
      localStorage.setItem("vocab_learner_onboarding_completed", "true");
    } catch (e) {
      console.error("Failed to save onboarding completion state", e);
    }

    const welcomeMsg: ChatMessage = {
      id: `welcome-msg-${Date.now()}`,
      role: "assistant",
      content: t("chat_welcome_msg", data.appLanguage || data.nativeLanguage, { target: data.targetLanguage, native: data.nativeLanguage }),
      timestamp: new Date().toISOString(),
    };
    setChatMessages([welcomeMsg]);
    try {
      localStorage.setItem("vocab_learner_chat_history", JSON.stringify([welcomeMsg]));
    } catch (e) {
      // ignore
    }

    setIsOnboardingModalOpen(false);
  }, [handleSelectLanguages, setLlmConfig, setChatMessages, setIsOnboardingModalOpen]);

  // Save Onboarding (Languages + LLM Config)
  const handleSaveOnboarding = useCallback((
    userData: { email: string; nativeLanguage: string; targetLanguage: string },
    newConfig: LLMConfig
  ) => {
    setLlmConfig(newConfig);
    saveLLMConfigToDB(newConfig).catch(e => console.error("IndexedDB config save error:", e));
    try {
      localStorage.setItem("vocab_learner_llm_config", JSON.stringify(newConfig));
      if (userData.email) {
        localStorage.setItem("vocab_learner_user_email", userData.email);
      }
      if (userData.nativeLanguage) {
        localStorage.setItem("vocab_learner_native_lang", userData.nativeLanguage);
      }
      if (userData.targetLanguage) {
        localStorage.setItem("vocab_learner_target_lang", userData.targetLanguage);
      }
    } catch (e) {
      console.error("Failed to save onboarding settings to localStorage", e);
    }

    if (userData.targetLanguage && userData.nativeLanguage) {
      setTargetLanguage(userData.targetLanguage);
      setNativeLanguage(userData.nativeLanguage);
    }

    setIsLlmModalOpen(false);
  }, [setLlmConfig, setTargetLanguage, setNativeLanguage, setIsLlmModalOpen]);

  // Unified setter to map old page views to side panel operations
  const handleSetView = (view: "chatview" | "manage" | "analytics" | "settings") => {
    if (view === "manage") {
      setSidePanelTab("collection");
      setIsSidePanelOpen(true);
    } else if (view === "analytics") {
      setSidePanelTab("analytics");
      setIsSidePanelOpen(true);
    } else if (view === "settings") {
      setSidePanelTab("settings");
      setIsSidePanelOpen(true);
    } else {
      setCurrentView(view);
    }
  };

  // Initialize and load from IndexedDB on mount
  const reloadAllDataFromDB = async () => {
    try {
      const loadedWords = await getAllWordsFromDB();
      const { updatedWords, decayedCount } = recalculateWordsMemoryDecay(loadedWords);
      setWords(updatedWords);
      if (decayedCount > 0) {
        saveAllWordsToDB(updatedWords).catch((e) => console.error("IndexedDB memory decay save error:", e));
      }

      const loadedStats = await getStatsFromDB({
        totalQuizzesTaken: 0,
        totalCorrectAnswers: 0,
        streak: { count: 0, lastActiveDate: "", history: [] },
      });
      setStats(loadedStats);

      const defaultConfig = getDefaultLLMConfig();
      const loadedConfig = await getLLMConfigFromDB(defaultConfig);

      const activeConfig: LLMConfig = {
        ...loadedConfig,
        provider: loadedConfig.provider,
        model: loadedConfig.model,
        isLoggedIn: loadedConfig.isLoggedIn,
      };

      setLlmConfig(activeConfig);
      await saveLLMConfigToDB(activeConfig);

      if (
        !activeConfig.isLoggedIn &&
        activeConfig.provider !== "groq" &&
        activeConfig.provider !== "openrouter" &&
        activeConfig.provider !== "openai" &&
        activeConfig.provider !== "gemini" &&
        activeConfig.provider !== "ollama"
      ) {
        setIsLlmModalOpen(true);
      }

      const loadedTTS = await getTTSConfigFromDB(DEFAULT_TTS_CONFIG);
      setTtsConfig(loadedTTS);

      const refreshedTarget = localStorage.getItem("vocab_learner_target_lang") || "English";
      const refreshedNative = localStorage.getItem("vocab_learner_native_lang") || "Vietnamese";
      const refreshedApp = localStorage.getItem("vocab_learner_app_lang") || refreshedNative;
      setTargetLanguage(refreshedTarget);
      setNativeLanguage(refreshedNative);
      setAppLanguage(refreshedApp);

      const onboardingCompleted = localStorage.getItem("vocab_learner_onboarding_completed") === "true";
      const hasProxyKey = Boolean(getStoredAccessCode());
      if (!onboardingCompleted || !hasProxyKey) {
        setIsOnboardingModalOpen(true);
      }

      const storedChat = localStorage.getItem("vocab_learner_chat_history");
      if (storedChat) {
        try {
          const parsed = JSON.parse(storedChat);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setChatMessages(parsed);
          }
        } catch (e) {
          // ignore
        }
      } else {
        setChatMessages([
          {
            id: "welcome-msg",
            role: "assistant",
            content: t("chat_welcome_msg", refreshedApp, { target: refreshedTarget, native: refreshedNative }),
            timestamp: new Date().toISOString(),
          },
        ]);
      }
    } catch (e) {
      console.error("IndexedDB load error:", e);
      setWords([]);
    } finally {
      setIsDataLoaded(true);
    }
  };

  useEffect(() => {
    reloadAllDataFromDB();
  }, []);

  useEffect(() => {
    if (isDataLoaded && (!llmConfig.isLoggedIn || !llmConfig.provider)) {
      setIsLlmModalOpen(true);
    }
  }, [llmConfig.isLoggedIn, llmConfig.provider, isDataLoaded, setIsLlmModalOpen]);

  const renderSidePanelContent = () => {
    return (
      <div className="flex flex-col h-full overflow-hidden" id="side-panel-wrapper">
        <div className="flex-1 overflow-y-auto p-2.5 sm:p-4" id="side-panel-content-body">
          {sidePanelTab === "collection" && (
            <CollectionManager
              words={words}
              llmConfig={llmConfig}
              ttsConfig={ttsConfig}
              onAddWord={handleAddCustomWord}
              onDeleteWord={handleDeleteWord}
              onToggleStar={handleToggleStar}
              onToggleLearned={handleToggleLearned}
              onUpdateWords={handleUpdateWords}
              targetLanguage={targetLanguage}
              nativeLanguage={nativeLanguage}
              appLanguage={appLanguage}
              onLlmApiError={handleAiApiError}
            />
          )}

          {sidePanelTab === "analytics" && (
            <AnalyticsDashboard
              words={words}
              stats={stats}
              llmConfig={llmConfig}
              ttsConfig={ttsConfig}
              onStartPracticeWeakWords={() => {
                setCurrentView("chatview");
              }}
              onToggleLearnedWord={(wordId) => handleToggleLearned(wordId)}
              onToggleStarWord={(wordId) => handleToggleStar(wordId)}
              onNavigateToView={(view) => handleSetView(view)}
              appLanguage={appLanguage}
              onLlmApiError={handleAiApiError}
            />
          )}

          {sidePanelTab === "settings" && (
            <SettingsView
              ttsConfig={ttsConfig}
              llmConfig={llmConfig}
              onSaveTTSConfig={handleSaveTTSConfig}
              onSaveLLMConfig={handleSaveLlmConfig}
              onOpenLlmModal={handleOpenLlmModal}
              onOpenOnboarding={() => setIsOnboardingModalOpen(true)}
              onReloadData={reloadAllDataFromDB}
              targetLanguage={targetLanguage}
              nativeLanguage={nativeLanguage}
              appLanguage={appLanguage}
              onSelectLanguages={handleSelectLanguages}
            />
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="h-dvh w-full bg-stone-50/40 text-stone-900 flex flex-col antialiased border-0 overflow-hidden">
      {/* Visual Top Header */}
      <AppHeader
        currentView={currentView}
        setCurrentView={handleSetView}
        setIsLlmModalOpen={setIsLlmModalOpen}
        llmConfig={llmConfig}
        stats={stats}
        onSwitchProvider={handleSwitchProviderQuick}
        onOpenLlmModal={handleOpenLlmModal}
        targetLanguage={targetLanguage}
        nativeLanguage={nativeLanguage}
        appLanguage={appLanguage}
        onSelectLanguages={handleSelectLanguages}
        onReloadData={reloadAllDataFromDB}
        sidePanelTab={sidePanelTab}
        isSidePanelOpen={isSidePanelOpen}
      />

      {/* Main Viewport Container */}
      <main className="flex-1 min-h-0 w-full max-w-7xl mx-auto p-2 sm:p-4 md:p-5 flex flex-col overflow-hidden">
        <div className="flex flex-col flex-1 min-h-0 h-full overflow-hidden">
          {/* Main workspace section */}
          <div className="flex flex-col min-w-0 flex-1 min-h-0 h-full overflow-hidden">
            <AnimatePresence mode="wait">
              <motion.div
                key={currentView}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="w-full flex flex-col flex-1 min-h-0 h-full"
              >
                {currentView === "chatview" && (
                  <ChatView
                    messages={chatMessages}
                    isTyping={isTyping}
                    onSendMessage={handleSendChatMessage}
                    onAddWord={handleConversationalAddWordOrPrompt}
                    onGenerateByTopic={handleConversationalGenerateWordsPrompt}
                    onStartQuiz={startChatQuiz}
                    onFixGrammar={handlePromptFixGrammar}
                    onViewFlashcard={handleViewFlashcard}
                    onSelectDefinition={handleSelectDefinition}
                    onClearHistory={handleClearChatHistory}
                    onSwitchProvider={handleSwitchProviderQuick}
                    targetLanguage={targetLanguage}
                    nativeLanguage={nativeLanguage}
                    appLanguage={appLanguage}
                    ttsConfig={ttsConfig}
                    llmConfig={llmConfig}
                    words={words}
                    onUpdateWords={handleUpdateWords}
                    onAnalyzeImageVocab={handleAnalyzeImageVocab}
                    onAddMultipleWords={handleAddMultipleWords}
                    onSuggestCasualReplyPrompt={handlePromptSuggestCasualReply}
                    onSuggestCasualReply={handleSuggestCasualReply}
                    conversationalState={conversationalState}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </main>

      {/* Mobile Drawer Slide Panel */}
      <MobileSideDrawer isOpen={isSidePanelOpen} onClose={() => setIsSidePanelOpen(false)} title={sidePanelTab}>
        {renderSidePanelContent()}
      </MobileSideDrawer>

      {/* LLM Login Modal */}
      <LlmLoginModal
        isOpen={isLlmModalOpen}
        currentConfig={llmConfig}
        onSaveConfig={handleSaveLlmConfig}
        onSaveOnboarding={handleSaveOnboarding}
        onClose={() => setIsLlmModalOpen(false)}
        canDismiss={Boolean(llmConfig.isLoggedIn && llmConfig.provider)}
      />

      {/* Onboarding Setup & Access Code Modal */}
      <OnboardingModal
        isOpen={isOnboardingModalOpen}
        initialProxyKey={getStoredAccessCode()}
        initialTargetLanguage={targetLanguage}
        initialNativeLanguage={nativeLanguage}
        initialAppLanguage={appLanguage}
        onCompleteOnboarding={handleCompleteOnboarding}
        onClose={() => setIsOnboardingModalOpen(false)}
        canDismiss={
          localStorage.getItem("vocab_learner_onboarding_completed") === "true" && 
          Boolean(getStoredAccessCode())
        }
      />

      {/* AI Error & Provider Switch Fallback Modal */}
      <AiErrorFallbackModal
        isOpen={aiErrorModal.isOpen}
        errorMessage={aiErrorModal.errorMessage}
        currentProvider={aiErrorModal.failedProvider}
        llmConfig={llmConfig}
        onConfirmSwitchAndRetry={handleConfirmSwitchAndRetry}
        onClose={() => setAiErrorModal((prev) => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
}
