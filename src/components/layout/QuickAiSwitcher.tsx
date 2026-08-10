import  { useState, useRef, useEffect } from "react";
import { 
  Key, 
  ChevronDown, 
  Zap, 
  Check, 
  
  Sliders, 
  CheckCircle2, 
  Cpu,
  X,
  Server,
  RotateCcw
} from "lucide-react";
import { LLMConfig, LLMProvider } from "../../types";
import { PROVIDER_OPTIONS } from "../../config/llmProviders";
import { getSavedProvidersMap } from "../../utils/llmHelpers";
import { getLockedModels, isModelLocked, clearAllLocks, resetAllModelStates } from "../../utils/autoModeManager";

interface QuickAiSwitcherProps {
  llmConfig: LLMConfig;
  onSwitchProvider: (providerId: LLMProvider, modelOverride?: string) => void;
  onOpenLlmModal: (providerId?: LLMProvider) => void;
  compact?: boolean;
}

function getShortProviderName(name: string): string {
  if (name.includes("Auto")) return "Auto";
  if (name.includes("Gemini")) return "Gemini";
  if (name.includes("Custom")) return "Custom";
  if (name.includes("Ollama")) return "Ollama";
  if (name.includes("OpenAI")) return "OpenAI";
  if (name.includes("Groq")) return "Groq";
  if (name.includes("OpenRouter")) return "OpenRouter";
  if (name.includes("9Flare")) return "9Flare";
  return name.split(" ")[0];
}

export default function QuickAiSwitcher({
  llmConfig,
  onSwitchProvider,
  onOpenLlmModal,
  compact: _compact = false
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

    onSwitchProvider(pId);

    if (pId === 'custom' && (!saved || (!saved.baseUrl && !saved.apiKey))) {
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
      
      {/* Active AI Engine Badge / Quick Switcher Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-1 sm:gap-1.5 px-1.5 py-1 sm:px-2.5 sm:py-1.5 rounded-lg border text-xs font-semibold transition-all cursor-pointer shadow-2xs shrink-0 ${
          isOpen
            ? "bg-stone-900 text-white border-stone-950 ring-2 ring-stone-900/15"
            : "bg-stone-50 hover:bg-stone-100 border-stone-200/90 text-stone-900"
        }`}
        title="Quick AI Provider Switcher (Click to switch AI model or provider)"
        id="llm-auth-badge"
      >
        <span 
          className={`w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full shrink-0 ${
            isConnected ? "bg-emerald-500 animate-pulse" : "bg-amber-500"
          }`} 
        />
        <Zap className={`w-3.5 h-3.5 shrink-0 ${isOpen ? "text-amber-400 fill-current" : "text-stone-700"}`} />
        
        <span className="font-bold sm:hidden truncate max-w-[50px] xs:max-w-[70px] text-xs">
          {getShortProviderName(activeProviderMeta.name)}
        </span>
        
        <span className="font-bold hidden sm:inline text-xs">
          {activeProviderMeta.name}
        </span>
        
        <span className="text-[10px] opacity-70 font-mono hidden xl:inline">
          ({llmConfig.model})
        </span>

        <ChevronDown className={`w-3.5 h-3.5 opacity-60 transition-transform duration-200 shrink-0 ${isOpen ? "rotate-180 text-amber-400" : ""}`} />
      </button>

      {/* Floating Toast Notification */}
      {toastMessage && (
        <div className="fixed top-16 left-3 right-3 sm:left-auto sm:right-auto sm:absolute sm:top-full sm:mt-1.5 z-50 bg-stone-900 text-white text-xs font-semibold px-3 py-2 rounded-xl border border-stone-800 shadow-xl flex items-center justify-center sm:justify-start gap-2 whitespace-nowrap animate-in fade-in slide-in-from-top-1">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Quick Switch Dropdown Popover */}
      {isOpen && (
        <>
          {/* Mobile backdrop */}
          <div 
            className="fixed inset-0 bg-stone-950/40 backdrop-blur-2xs z-40 sm:hidden"
            onClick={() => setIsOpen(false)}
          />

          <div className="fixed top-16 left-3 right-3 sm:absolute sm:top-full sm:left-auto sm:right-0 sm:mt-2 w-auto sm:w-[420px] max-w-[calc(100vw-1.5rem)] bg-white rounded-2xl border border-stone-200/90 shadow-2xl shadow-stone-900/15 z-50 animate-in fade-in slide-in-from-top-2 duration-200 overflow-hidden">
            
            {/* Popover Header */}
            <div className="bg-stone-50/90 px-4 py-3 border-b border-stone-200/80 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 border border-amber-200/80 flex items-center justify-center shrink-0 shadow-2xs">
                  <Zap className="w-4 h-4 fill-current text-amber-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-bold text-stone-900 tracking-tight leading-none truncate">
                    AI Engine & Models
                  </h3>
                  <div className="flex items-center gap-2 mt-1 min-w-0">
                    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${
                      isConnected 
                        ? "bg-emerald-50 text-emerald-700 border border-emerald-200/80" 
                        : "bg-amber-50 text-amber-700 border border-amber-200/80"
                    }`}>
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isConnected ? "bg-emerald-500 animate-pulse" : "bg-amber-500"}`} />
                      {isConnected ? "Ready" : "Key Needed"}
                    </span>
                    <p className="text-[11px] text-stone-500 truncate hidden xs:block">
                      Switch model or manage keys
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setIsOpen(false);
                    onOpenLlmModal(llmConfig.provider);
                  }}
                  className="px-2.5 py-1 text-xs font-semibold text-stone-700 hover:text-stone-900 bg-white hover:bg-stone-100 border border-stone-200/90 rounded-lg flex items-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
                  title="Manage API Keys"
                >
                  <Sliders className="w-3.5 h-3.5 text-stone-500" />
                  <span>Keys</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="p-1.5 text-stone-400 hover:text-stone-700 hover:bg-stone-200/60 rounded-lg transition-colors cursor-pointer"
                  title="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Active AI Engine Card */}
            <div className="p-3.5 m-3 bg-stone-900 text-white rounded-xl shadow-sm border border-stone-800 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider bg-stone-800 px-2 py-0.5 rounded-md border border-stone-700/80">
                    Active Engine
                  </span>
                  <span className="font-bold text-white text-sm">{activeProviderMeta.name}</span>
                </div>
                <span className="font-mono text-[11px] text-stone-300 bg-stone-800/90 px-2 py-0.5 rounded-md border border-stone-700/80">
                  {llmConfig.model}
                </span>
              </div>

              {/* Model Dropdown Selector */}
              {activeProviderMeta.id === "auto" ? (
                <div className="text-[11px] text-stone-300 bg-stone-800/70 p-2.5 rounded-lg border border-stone-700/60 leading-relaxed space-y-1.5">
                  <div className="font-semibold text-amber-400 flex items-center justify-between">
                    <span className="flex items-center gap-1">
                      <Zap className="w-3.5 h-3.5 fill-current" />
                      <span>Auto Mode: Priority Routing Active</span>
                    </span>
                    <span className="text-[10px] bg-emerald-900/80 text-emerald-300 border border-emerald-700 px-1.5 py-0.5 rounded font-bold">
                      Tier 1 → Tier 4
                    </span>
                  </div>
                  <p className="text-stone-300 text-[11px] leading-snug">
                    Priority routes queries to <strong className="text-emerald-400">Tier 1 (Fast &lt;10s)</strong> models first. Slow models are demoted to <strong className="text-orange-400">Tier 4</strong> as emergency backups so your requests never fail.
                  </p>
                  {Object.keys(getLockedModels()).length > 0 && (
                    <div className="pt-1.5 border-t border-stone-700/80 flex items-center justify-between">
                      <span className="text-amber-300 text-[10px] font-medium">
                        ⚠️ {Object.keys(getLockedModels()).length} model(s) locked
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          clearAllLocks();
                          setToastMessage("Cleared all model lockouts!");
                          setTimeout(() => setToastMessage(null), 2500);
                        }}
                        className="text-[10px] font-bold text-amber-400 hover:text-white underline cursor-pointer"
                      >
                        Reset Locks
                      </button>
                    </div>
                  )}
                </div>
              ) : (() => {
                const unlockedModels = activeProviderMeta.models.filter(m => !isModelLocked(activeProviderMeta.id, m));
                return (
                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-stone-300 flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <Cpu className="w-3.5 h-3.5 text-amber-400" />
                        <span>Select Model:</span>
                      </span>
                      <span className="text-[10px] text-stone-400">{unlockedModels.length} available</span>
                    </label>
                    {unlockedModels.length > 0 ? (
                      <select
                        value={unlockedModels.includes(llmConfig.model) ? llmConfig.model : unlockedModels[0]}
                        onChange={(e) => handleModelSelect(e.target.value)}
                        className="w-full bg-stone-800/90 text-white border border-stone-700 rounded-xl px-3 py-2 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-amber-400 cursor-pointer transition-colors"
                      >
                        {unlockedModels.map((m) => (
                          <option key={m} value={m}>
                            {m} {m === activeProviderMeta.defaultModel ? "★ Recommended" : ""}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div className="p-2.5 text-[11px] text-amber-300 bg-stone-800/80 rounded-lg border border-stone-700/80 flex items-center justify-between gap-2">
                        <span>⚠️ All models for this provider are currently locked.</span>
                        <button
                          type="button"
                          onClick={() => {
                            clearAllLocks();
                            setToastMessage("Cleared all model locks!");
                            setTimeout(() => setToastMessage(null), 2500);
                          }}
                          className="text-[10px] font-bold text-amber-400 hover:text-white underline cursor-pointer shrink-0"
                        >
                          Reset Locks
                        </button>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>

            {/* Provider Selection Header */}
            <div className="px-3.5 pt-1 pb-1.5 flex items-center justify-between">
              <span className="text-xs font-bold text-stone-500 uppercase tracking-wider flex items-center gap-1.5">
                <Server className="w-3.5 h-3.5 text-stone-400" />
                <span>Switch Provider</span>
              </span>
              <span className="text-[10px] font-mono text-stone-400">
                {PROVIDER_OPTIONS.filter(p => p.id === "auto" || p.models.some(m => !isModelLocked(p.id, m))).length} Options Available
              </span>
            </div>

            {/* List of Available Providers */}
            <div className="px-3 pb-2 space-y-2 max-h-[240px] overflow-y-auto">
              {PROVIDER_OPTIONS.map((p) => {
                const isActive = llmConfig.provider === p.id;
                const saved = savedMap[p.id];
                const isSaved = Boolean(saved && (saved.apiKey || !p.requiresKey));
                const allModelsLocked = p.id !== "auto" && p.models.length > 0 && p.models.every(m => isModelLocked(p.id, m));

                if (allModelsLocked && !isActive) {
                  return null;
                }

                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handleProviderClick(p.id)}
                    className={`w-full text-left p-3 rounded-xl border text-xs flex items-center justify-between transition-all cursor-pointer ${
                      isActive
                        ? "bg-stone-100 border-stone-900 text-stone-950 ring-1 ring-stone-900/10 shadow-2xs"
                        : isSaved
                        ? "bg-amber-50/40 hover:bg-amber-100/70 text-stone-900 border-amber-200/90"
                        : "bg-stone-50/70 hover:bg-stone-100/90 text-stone-800 border-stone-200/80"
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0 pr-2">
                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                        isActive 
                          ? "bg-stone-900 text-amber-400" 
                          : isSaved 
                          ? "bg-amber-100 text-amber-700" 
                          : "bg-stone-200/70 text-stone-500"
                      }`}>
                        <Zap className={`w-3.5 h-3.5 ${isActive ? "fill-current" : ""}`} />
                      </div>
                      
                      <div className="min-w-0">
                        <div className="font-bold flex items-center gap-2 text-xs leading-tight">
                          <span className="truncate">{p.name}</span>
                          {isActive && (
                            <span className="text-[9px] font-bold bg-emerald-500 text-white px-1.5 py-0.2 rounded-md shrink-0">
                              ACTIVE
                            </span>
                          )}
                          {!isActive && isSaved && (
                            <span className="text-[9px] font-bold bg-amber-200/90 text-amber-900 px-1.5 py-0.2 rounded-md border border-amber-300/80 shrink-0">
                              SAVED
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] font-mono text-stone-500 truncate mt-0.5">
                          {p.tagline || (saved ? saved.model : p.defaultModel)}
                        </div>
                      </div>
                    </div>

                    <div className="shrink-0 ml-2">
                      {isActive ? (
                        <div className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center">
                          <Check className="w-3.5 h-3.5" />
                        </div>
                      ) : (
                        <span className="text-[11px] font-semibold px-2.5 py-1 rounded-lg border bg-stone-900 text-white border-stone-950 hover:bg-black transition-colors">
                          {p.id === 'custom' && (!saved || (!saved.baseUrl && !saved.apiKey)) ? "Configure" : "Switch"}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Footer Action Buttons */}
            <div className="p-3 bg-stone-50/90 border-t border-stone-200/80 space-y-2 text-center">
              <button
                type="button"
                onClick={() => {
                  resetAllModelStates();
                  setToastMessage("All model states & metrics reset!");
                  setTimeout(() => setToastMessage(null), 2500);
                }}
                className="w-full py-2 px-3 bg-rose-50 hover:bg-rose-100 text-rose-700 hover:text-rose-800 border border-rose-200 text-xs font-semibold rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-2xs"
                title="Reset all models' response times, metrics, failure logs, and locks"
              >
                <RotateCcw className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                <span>Reset All Model States</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  onOpenLlmModal();
                }}
                className="w-full py-2.5 px-4 bg-stone-900 hover:bg-black text-white text-xs font-bold rounded-xl flex items-center justify-center gap-2 transition-all shadow-xs cursor-pointer"
              >
                <Key className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span>Full AI Credentials & Endpoint Settings</span>
              </button>
            </div>

          </div>
        </>
      )}

    </div>
  );
}

