import React from "react";
import { Key, Sliders } from "lucide-react";
import { LLMConfig, UserStats } from "../../types";

interface AppHeaderProps {
  currentView: "dashboard" | "learn" | "quiz" | "manage" | "analytics" | "settings";
  setCurrentView: (view: "dashboard" | "learn" | "quiz" | "manage" | "analytics" | "settings") => void;
  setSelectedDeckId: (deckId: string | null) => void;
  setIsLlmModalOpen: (open: boolean) => void;
  llmConfig: LLMConfig;
  stats: UserStats;
}

export default function AppHeader({
  currentView,
  setCurrentView,
  setSelectedDeckId,
  setIsLlmModalOpen,
  llmConfig,
  stats
}: AppHeaderProps) {
  return (
    <header className="bg-white border-b border-stone-200 py-3.5 px-3.5 sm:py-5 sm:px-8 sticky top-0 z-40" id="main-header">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 sm:gap-6">
        
        {/* Top Header Row: Logo & AI Model Badge */}
        <div className="flex items-center justify-between gap-4">
          {/* Logo / Title */}
          <div 
            onClick={() => {
              setCurrentView("dashboard");
              setSelectedDeckId(null);
            }} 
            className="flex items-center gap-3.5 cursor-pointer group"
            id="brand-logo"
          >
            <div className="w-9 h-9 bg-stone-900 text-white flex items-center justify-center font-black text-lg tracking-tight transition-transform duration-300 group-hover:scale-105 shrink-0">
              V
            </div>
            <div>
              <h1 className="text-sm sm:text-base font-bold text-stone-900 tracking-tight leading-none flex items-center gap-2">
                Vocab
                <span className="text-[9px] border border-stone-900 text-stone-900 font-semibold px-1.5 py-0.5 rounded-none tracking-normal">Pro</span>
              </h1>
              <p className="text-[11px] text-stone-500 font-normal tracking-normal mt-0.5">Clean Minimalist Learning Coach</p>
            </div>
          </div>

          {/* Select AI Model Button (Top Right) */}
          <button
            onClick={() => setIsLlmModalOpen(true)}
            className="flex items-center gap-2 px-3 py-1.5 bg-stone-50 hover:bg-stone-100 border border-stone-200 text-stone-900 text-xs font-medium tracking-normal transition-all cursor-pointer shadow-2xs shrink-0"
            title="Click to configure LLM Provider & API Key"
            id="llm-auth-badge"
          >
            <span className={`w-2 h-2 rounded-full ${llmConfig.isLoggedIn ? "bg-emerald-500 animate-pulse" : "bg-red-500"}`} />
            <Key className="w-3 h-3 text-stone-700" />
            <span>{llmConfig.isLoggedIn ? `${llmConfig.provider.charAt(0).toUpperCase() + llmConfig.provider.slice(1)}` : "AI Model Login"}</span>
            <span className="text-[10px] text-stone-500 font-normal hidden lg:inline">({llmConfig.model})</span>
          </button>
        </div>

        {/* Navigation Links & Quick Stats */}
        <div className="flex items-center justify-between sm:justify-start gap-4 sm:gap-8 text-xs font-medium tracking-normal pt-2.5 md:pt-0 border-t md:border-t-0 border-stone-100">
          <div className="flex items-center gap-4 sm:gap-8">
            <button
              onClick={() => {
                setCurrentView("dashboard");
                setSelectedDeckId(null);
              }}
              className={`transition-colors cursor-pointer ${
                currentView === "dashboard" ? "text-stone-950 font-bold underline underline-offset-4 decoration-2" : "text-stone-500 hover:text-stone-950"
              }`}
            >
              Practice
            </button>
            
            <button
              onClick={() => {
                setCurrentView("manage");
              }}
              className={`transition-colors cursor-pointer ${
                currentView === "manage" ? "text-stone-950 font-bold underline underline-offset-4 decoration-2" : "text-stone-500 hover:text-stone-950"
              }`}
            >
              Collection
            </button>

            <button
              onClick={() => {
                setCurrentView("analytics");
              }}
              className={`transition-colors cursor-pointer flex items-center gap-1 ${
                currentView === "analytics" ? "text-stone-950 font-bold underline underline-offset-4 decoration-2" : "text-stone-500 hover:text-stone-950"
              }`}
              id="nav-analytics-btn"
            >
              <span>Analytics</span>
            </button>

            <button
              onClick={() => {
                setCurrentView("settings");
              }}
              className={`transition-colors cursor-pointer flex items-center gap-1.5 ${
                currentView === "settings" ? "text-stone-950 font-bold underline underline-offset-4 decoration-2" : "text-stone-500 hover:text-stone-950"
              }`}
              id="nav-settings-btn"
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>Settings</span>
            </button>
          </div>

          {/* Quick stats highlight */}
          <div className="hidden md:flex items-center gap-3 pl-4 border-l border-stone-200">
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
        </div>

      </div>
    </header>
  );
}
