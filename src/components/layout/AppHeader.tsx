import { useState, useEffect } from "react";
import { Sliders } from "lucide-react";
import { LLMConfig, LLMProvider, UserStats } from "../../types";
import QuickAiSwitcher from "./QuickAiSwitcher";
import QuickLanguageSwitcher from "./QuickLanguageSwitcher";
import QuickCloudSync from "./QuickCloudSync";
import { t } from "../../config/i18n";

interface AppHeaderProps {
  currentView: "chatview" | "manage" | "analytics" | "settings";
  setCurrentView: (view: "chatview" | "manage" | "analytics" | "settings") => void;
  setIsLlmModalOpen: (open: boolean) => void;
  llmConfig: LLMConfig;
  stats: UserStats;
  onSwitchProvider: (providerId: LLMProvider, modelOverride?: string) => void;
  onOpenLlmModal: (providerId?: LLMProvider) => void;
  targetLanguage?: string;
  nativeLanguage?: string;
  appLanguage?: string;
  onSelectLanguages?: (targetLang: string, nativeLang: string, appLang?: string) => void;
  onReloadData?: () => Promise<void>;
  sidePanelTab?: "collection" | "analytics" | "settings";
  isSidePanelOpen?: boolean;
}

export default function AppHeader({
  currentView: _currentView,
  setCurrentView,
  setIsLlmModalOpen: _setIsLlmModalOpen,
  llmConfig,
  stats: _stats,
  onSwitchProvider,
  onOpenLlmModal,
  targetLanguage = "English",
  nativeLanguage = "Vietnamese",
  appLanguage = nativeLanguage || "Vietnamese",
  onSelectLanguages,
  onReloadData,
  sidePanelTab = "collection",
  isSidePanelOpen = false
}: AppHeaderProps) {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window !== "undefined") {
      return window.matchMedia("(max-width: 1023px)").matches;
    }
    return false;
  });

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 1023px)");
    
    // Set initial value in case of mount timing differences
    setIsMobile(mediaQuery.matches);

    const listener = (e: MediaQueryListEvent) => {
      setIsMobile(e.matches);
    };

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener("change", listener);
    } else {
      mediaQuery.addListener(listener);
    }

    return () => {
      if (mediaQuery.removeEventListener) {
        mediaQuery.removeEventListener("change", listener);
      } else {
        mediaQuery.removeListener(listener);
      }
    };
  }, []);

  // Sub-renderers to keep the JSX dry and clean
  const renderLogo = () => (
    <div 
      onClick={() => {
        setCurrentView("chatview");
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
        <p className="text-[10px] sm:text-[11px] text-stone-500 font-normal tracking-normal mt-0.5 hidden sm:block">{t("ai_coach_title", appLanguage)}</p>
      </div>
    </div>
  );

  const renderSwitchers = () => (
    <div className="flex items-center gap-1 sm:gap-2 shrink-0 min-w-0">
      {onSelectLanguages && (
        <QuickLanguageSwitcher
          targetLanguage={targetLanguage}
          nativeLanguage={nativeLanguage}
          appLanguage={appLanguage}
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
        {t("nav_collection", appLanguage)}
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
        <span>{t("nav_analytics", appLanguage)}</span>
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
        <span>{t("nav_settings", appLanguage)}</span>
      </button>
    </div>
  );

  return (
    <header className="bg-white border-b border-stone-200 py-1.5 sm:py-2.5 md:py-3 px-2 sm:px-6 md:px-8 sticky top-0 z-40 shrink-0" id="main-header">
      <div className="max-w-7xl mx-auto">
        
        {!isMobile ? (
          /* Desktop Header Layout (>= lg) */
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-6 xl:gap-8">
              {renderLogo()}
              <div className="h-4 w-px bg-stone-200" />
              <div className="text-xs font-medium">
                {renderNavLinks()}
              </div>
            </div>
            {renderSwitchers()}
          </div>
        ) : (
          /* Mobile & Tablet Header Layout (< lg, including iPad portrait) */
          <div className="flex flex-col gap-1.5">
            {/* Row 1: Logo (left) & Switchers (right) - NO overflow clipping so dropdown popovers can extend vertically */}
            <div className="flex items-center justify-between gap-1 sm:gap-2 min-w-0 w-full">
              {renderLogo()}
              {renderSwitchers()}
            </div>
            {/* Row 2: Nav Links */}
            <div className="flex items-center justify-start sm:justify-center gap-4 sm:gap-6 text-xs font-medium tracking-normal pt-1 border-t border-stone-100 overflow-x-auto scrollbar-none">
              {renderNavLinks()}
            </div>
          </div>
        )}

      </div>
    </header>
  );
}
