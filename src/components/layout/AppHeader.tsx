import React from "react";
import { Sliders } from "lucide-react";
import { LLMConfig, LLMProvider, UserStats } from "../../types";
import QuickAiSwitcher from "./QuickAiSwitcher";
import QuickLanguageSwitcher from "./QuickLanguageSwitcher";
import QuickCloudSync from "./QuickCloudSync";

interface AppHeaderProps {
  currentView: "dashboard" | "learn" | "quiz" | "manage" | "analytics" | "settings";
  setCurrentView: (view: "dashboard" | "learn" | "quiz" | "manage" | "analytics" | "settings") => void;
  setIsLlmModalOpen: (open: boolean) => void;
  llmConfig: LLMConfig;
  stats: UserStats;
  onSwitchProvider: (providerId: LLMProvider, modelOverride?: string) => void;
  onOpenLlmModal: (providerId?: LLMProvider) => void;
  targetLanguage?: string;
  nativeLanguage?: string;
  onSelectLanguages?: (targetLang: string, nativeLang: string) => void;
  onReloadData?: () => Promise<void>;
  sidePanelTab?: "collection" | "analytics" | "settings";
  isSidePanelOpen?: boolean;
}

export default function AppHeader({
  currentView,
  setCurrentView,
  setIsLlmModalOpen,
  llmConfig,
  stats,
  onSwitchProvider,
  onOpenLlmModal,
  targetLanguage = "English",
  nativeLanguage = "Vietnamese",
  onSelectLanguages,
  onReloadData,
  sidePanelTab = "collection",
  isSidePanelOpen = false
}: AppHeaderProps) {
  // Sub-renderers to keep the JSX dry and clean
  const renderLogo = () => (
    <div 
      onClick={() => {
        setCurrentView("dashboard");
      }} 
      className="flex items-center gap-1 sm:gap-2 cursor-pointer group shrink-0"
      id="brand-logo"
    >
      <div className="w-6 h-6 sm:w-9 sm:h-9 bg-stone-900 text-white flex items-center justify-center font-black text-xs sm:text-lg tracking-tight transition-transform duration-300 group-hover:scale-105 shrink-0">
        V
      </div>
      <div>
        <h1 className="text-xs sm:text-base font-bold text-stone-900 tracking-tight leading-none flex items-center gap-0.5 sm:gap-1.5">
          Vocab
        </h1>
        <p className="text-[10px] sm:text-[11px] text-stone-500 font-normal tracking-normal mt-0.5 hidden sm:block">AI Study Companion</p>
      </div>
    </div>
  );

  const renderSwitchers = () => (
    <div className="flex items-center gap-1 sm:gap-2 shrink-0 min-w-0">
      {onSelectLanguages && (
        <QuickLanguageSwitcher
          targetLanguage={targetLanguage}
          nativeLanguage={nativeLanguage}
          onSelectLanguages={onSelectLanguages}
        />
      )}
      
      <QuickAiSwitcher 
        llmConfig={llmConfig}
        onSwitchProvider={onSwitchProvider}
        onOpenLlmModal={onOpenLlmModal}
      />

      <QuickCloudSync 
        onReloadData={onReloadData}
        onOpenSettings={() => setCurrentView("settings")}
      />
    </div>
  );

  const renderNavLinks = () => (
    <div className="flex items-center gap-4 sm:gap-8">
      <button
        onClick={() => {
          setCurrentView("manage");
        }}
        className={`transition-colors cursor-pointer font-semibold ${
          isSidePanelOpen && sidePanelTab === "collection" ? "text-stone-950 font-bold underline underline-offset-4 decoration-2" : "text-stone-500 hover:text-stone-950"
        }`}
      >
        Collection
      </button>

      <button
        onClick={() => {
          setCurrentView("analytics");
        }}
        className={`transition-colors cursor-pointer flex items-center gap-1 font-semibold ${
          isSidePanelOpen && sidePanelTab === "analytics" ? "text-stone-950 font-bold underline underline-offset-4 decoration-2" : "text-stone-500 hover:text-stone-950"
        }`}
        id="nav-analytics-btn"
      >
        <span>Analytics</span>
      </button>

      <button
        onClick={() => {
          setCurrentView("settings");
        }}
        className={`transition-colors cursor-pointer flex items-center gap-1.5 font-semibold ${
          isSidePanelOpen && sidePanelTab === "settings" ? "text-stone-950 font-bold underline underline-offset-4 decoration-2" : "text-stone-500 hover:text-stone-950"
        }`}
        id="nav-settings-btn"
      >
        <Sliders className="w-3.5 h-3.5" />
        <span>Settings</span>
      </button>
    </div>
  );

  const renderStreak = () => (
    <div className="flex items-center gap-3 pl-4 border-l border-stone-200">
      <span className="text-xs text-stone-500 font-medium">Streak</span>
      <div className="flex gap-1">
        {Array.from({ length: 5 }).map((_, i) => (
          <div 
            key={i} 
            className={`w-4 h-1 transition-all ${
              i < stats.streak.count ? "bg-stone-900" : "bg-stone-200"
            }`}
          />
        ))}
      </div>
    </div>
  );

  return (
    <header className="bg-white border-b border-stone-200 py-2.5 px-2.5 sm:py-5 sm:px-8 sticky top-0 z-40" id="main-header">
      <div className="max-w-7xl mx-auto">
        
        {/* Mobile Header Layout (< md) */}
        <div className="flex flex-col gap-2.5 sm:gap-4">
          {/* Row 1: Logo (left) & Switchers (right) */}
          <div className="flex items-center justify-between gap-1 sm:gap-3 flex-nowrap min-w-0 w-full">
            {renderLogo()}
            {renderSwitchers()}
          </div>
          {/* Row 2: Nav Links */}
          <div className="flex items-center justify-between gap-4 text-xs font-medium tracking-normal pt-2 border-t border-stone-100">
            {renderNavLinks()}
          </div>
        </div>

      </div>
    </header>
  );
}
