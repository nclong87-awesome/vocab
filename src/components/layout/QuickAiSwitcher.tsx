import React, { useState, useRef, useEffect } from "react";
import { 
  Key, 
  ChevronDown, 
  Zap, 
  Check, 
  Sparkles, 
  Sliders, 
  CheckCircle2, 
  AlertCircle,
  Cpu,
  BookmarkCheck,
  Server
} from "lucide-react";
import { LLMConfig, LLMProvider, SavedProvidersMap } from "../../types";
import { PROVIDER_OPTIONS } from "../../config/llmProviders";
import { getSavedProvidersMap, switchActiveProvider } from "../../utils/llmHelpers";

interface QuickAiSwitcherProps {
  llmConfig: LLMConfig;
  onSwitchProvider: (providerId: LLMProvider, modelOverride?: string) => void;
  onOpenLlmModal: (providerId?: LLMProvider) => void;
  compact?: boolean;
}

function getShortProviderName(name: string): string {
  if (name.includes("ChatJimmy") || name.includes("chatjimmy")) return "ChatJimmy";
  if (name.includes("Gemini")) return "Gemini";
  if (name.includes("GitHub")) return "GitHub";
  if (name.includes("Custom")) return "Custom";
  if (name.includes("Ollama")) return "Ollama";
  if (name.includes("OpenAI")) return "OpenAI";
  if (name.includes("9Flare")) return "9Flare";
  return name.split(" ")[0];
}

export default function QuickAiSwitcher({
  llmConfig,
  onSwitchProvider,
  onOpenLlmModal,
  compact = false
}: QuickAiSwitcherProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const activeProviderMeta = PROVIDER_OPTIONS.find(p => p.id === llmConfig.provider) || PROVIDER_OPTIONS[0];
  const savedMap = getSavedProvidersMap(llmConfig);

  // Close popover when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  const handleProviderClick = (pId: LLMProvider) => {
    const targetMeta = PROVIDER_OPTIONS.find(p => p.id === pId) || PROVIDER_OPTIONS[0];
    const saved = savedMap[pId];
    const hasCredentials = Boolean(saved && (saved.apiKey || !targetMeta.requiresKey));

    onSwitchProvider(pId);

    if (targetMeta.requiresKey && (!saved || !saved.apiKey)) {
      onOpenLlmModal(pId);
      setIsOpen(false);
    } else {
      setToastMessage(`Switched to ${targetMeta.name}`);
      setTimeout(() => setToastMessage(null), 2500);
      setIsOpen(false);
    }
  };

  const handleModelSelect = (newModel: string) => {
    onSwitchProvider(llmConfig.provider, newModel);
    setToastMessage(`Model updated to ${newModel}`);
    setTimeout(() => setToastMessage(null), 2500);
  };

  const isConnected = llmConfig.isLoggedIn || !activeProviderMeta.requiresKey;

  return (
    <div className="relative inline-block text-left shrink-0" ref={dropdownRef} id="quick-ai-switcher">
      
      {/* Active AI Engine Badge / Quick Switcher Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-1 sm:gap-2 px-1.5 py-1 sm:px-3 sm:py-1.5 border text-[11px] sm:text-xs font-medium tracking-normal transition-all cursor-pointer shadow-2xs shrink-0 ${
          isOpen
            ? "bg-stone-900 text-white border-stone-950 ring-2 ring-stone-900/20"
            : "bg-stone-50 hover:bg-stone-100 border-stone-200 text-stone-900"
        }`}
        title="Quick AI Provider Switcher (Click to switch AI model or provider)"
        id="llm-auth-badge"
      >
        <span 
          className={`w-2 h-2 rounded-full shrink-0 ${
            isConnected ? "bg-emerald-500 animate-pulse" : "bg-amber-500"
          }`} 
        />
        <Zap className={`w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0 ${isOpen ? "text-amber-400 fill-current" : "text-stone-700"}`} />
        
        <span className="font-bold sm:hidden truncate max-w-[60px]">
          {getShortProviderName(activeProviderMeta.name)}
        </span>
        
        <span className="font-bold hidden sm:inline">
          {activeProviderMeta.name}
        </span>
        
        <span className="text-[10px] opacity-75 font-mono hidden sm:inline">
          ({llmConfig.model})
        </span>

        <ChevronDown className={`w-3 h-3 sm:w-3.5 sm:h-3.5 opacity-60 transition-transform duration-200 shrink-0 ${isOpen ? "rotate-180 text-amber-400" : ""}`} />
      </button>

      {/* Floating Toast Notification */}
      {toastMessage && (
        <div className="fixed top-16 left-3 right-3 sm:left-auto sm:right-auto sm:absolute sm:top-full sm:mt-1 z-50 bg-stone-900 text-white text-[11px] font-semibold px-2.5 py-1.5 border border-stone-800 shadow-md flex items-center justify-center sm:justify-start gap-1.5 whitespace-nowrap animate-in fade-in slide-in-from-top-1">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Quick Switch Dropdown Popover */}
      {isOpen && (
        <>
          {/* Backdrop on mobile */}
          <div 
            className="fixed inset-0 bg-stone-950/40 backdrop-blur-2xs z-40 sm:hidden"
            onClick={() => setIsOpen(false)}
          />

          <div className="fixed top-16 left-3 right-3 sm:absolute sm:top-full sm:left-auto sm:right-0 sm:mt-2 w-auto sm:w-96 max-w-full bg-white border border-stone-300 shadow-2xl z-50 animate-in fade-in slide-in-from-top-2 overflow-hidden">
            
            {/* Active Engine Summary Header */}
            <div className="bg-stone-900 text-white p-3.5 border-b border-stone-800">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`w-2.5 h-2.5 rounded-full ${isConnected ? "bg-emerald-500 animate-pulse" : "bg-amber-500"}`} />
                  <span className="text-xs font-bold text-white uppercase tracking-wider">Active AI Engine</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setIsOpen(false);
                    onOpenLlmModal(llmConfig.provider);
                  }}
                  className="text-[10px] font-bold text-amber-300 hover:text-amber-200 underline underline-offset-2 flex items-center gap-1 cursor-pointer"
                >
                  <Sliders className="w-3 h-3" />
                  <span>Manage Keys</span>
                </button>
              </div>

              <div className="mt-2 flex items-center justify-between text-xs">
                <span className="font-bold text-white text-sm">{activeProviderMeta.name}</span>
                <span className="font-mono text-[11px] text-stone-300 bg-stone-800 px-2 py-0.5 border border-stone-700">
                  {llmConfig.model}
                </span>
              </div>
            </div>

            {/* Quick Model Selector Dropdown for Active Provider */}
            <div className="p-3 bg-stone-50 border-b border-stone-200 space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-wider text-stone-500 flex items-center gap-1">
                <Cpu className="w-3 h-3 text-stone-700" />
                <span>Select Model for {activeProviderMeta.name}</span>
              </label>
              <select
                value={llmConfig.model}
                onChange={(e) => handleModelSelect(e.target.value)}
                className="w-full bg-white border border-stone-300 p-2 text-xs font-medium text-stone-900 focus:outline-none focus:border-stone-900 cursor-pointer"
              >
                {activeProviderMeta.models.map((m) => (
                  <option key={m} value={m}>
                    {m} {m === activeProviderMeta.defaultModel ? "(Recommended)" : ""}
                  </option>
                ))}
              </select>
            </div>

            {/* List of Available AI Providers for Quick 1-Click Switch */}
            <div className="p-3 space-y-2 max-h-60 sm:max-h-72 overflow-y-auto">
              <div className="text-[10px] font-bold uppercase tracking-wider text-stone-500 flex items-center justify-between">
                <span>Quick 1-Click AI Switcher</span>
                <span className="text-[9px] font-mono font-normal text-stone-400">
                  {PROVIDER_OPTIONS.length} Providers Available
                </span>
              </div>

              <div className="grid grid-cols-1 gap-1.5">
                {PROVIDER_OPTIONS.map((p) => {
                  const isActive = llmConfig.provider === p.id;
                  const saved = savedMap[p.id];
                  const isSaved = Boolean(saved && (saved.apiKey || !p.requiresKey));

                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handleProviderClick(p.id)}
                      className={`w-full text-left p-2.5 border text-xs flex items-center justify-between transition-all cursor-pointer ${
                        isActive
                          ? "bg-stone-900 text-white border-stone-950 shadow-xs"
                          : isSaved
                          ? "bg-amber-50/60 hover:bg-amber-100/80 text-stone-900 border-amber-200"
                          : "bg-white hover:bg-stone-100 text-stone-800 border-stone-200"
                      }`}
                    >
                      <div className="flex items-center gap-2 overflow-hidden">
                        <Zap className={`w-3.5 h-3.5 shrink-0 ${
                          isActive ? "text-amber-400 fill-current" : isSaved ? "text-amber-600" : "text-stone-400"
                        }`} />
                        
                        <div className="truncate">
                          <div className="font-bold flex items-center gap-1.5 text-xs">
                            <span>{p.name}</span>
                            {isActive && (
                              <span className="text-[9px] font-bold bg-emerald-500 text-white px-1.5 py-0.2">
                                ACTIVE
                              </span>
                            )}
                            {!isActive && isSaved && (
                              <span className="text-[9px] font-bold bg-amber-200 text-amber-900 px-1.5 py-0.2 border border-amber-300">
                                SAVED
                              </span>
                            )}
                          </div>
                          <div className={`text-[10px] font-mono truncate ${isActive ? "text-stone-300" : "text-stone-500"}`}>
                            {saved ? saved.model : p.defaultModel}
                          </div>
                        </div>
                      </div>

                      <div className="shrink-0 ml-2">
                        {isActive ? (
                          <Check className="w-4 h-4 text-emerald-400" />
                        ) : (
                          <span className={`text-[10px] font-bold px-2 py-0.5 border ${
                            isSaved 
                              ? "bg-stone-900 text-white border-stone-950 hover:bg-black" 
                              : "bg-stone-100 text-stone-700 border-stone-300 hover:bg-stone-200"
                          }`}>
                            {isSaved ? "Switch" : p.requiresKey ? "Key" : "Free"}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Footer Action Button */}
            <div className="p-2.5 bg-stone-100 border-t border-stone-200 text-center">
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  onOpenLlmModal();
                }}
                className="w-full py-1.5 px-3 bg-stone-900 hover:bg-black text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer"
              >
                <Key className="w-3.5 h-3.5 text-amber-400" />
                <span>Full AI Credentials Settings</span>
              </button>
            </div>

          </div>
        </>
      )}

    </div>
  );
}
