import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { AlertCircle, RefreshCw, Check, X, Bot } from "lucide-react";
import { LLMConfig, LLMProvider } from "../../types";
import { PROVIDER_OPTIONS } from "../../config/llmProviders";
import { getProviderDisplayName } from "../../utils/llmHelpers";
import { isModelLocked } from "../../utils/autoModeManager";
import { getStoredAccessCode } from "../../utils";

interface AiErrorFallbackModalProps {
  isOpen: boolean;
  onClose: () => void;
  errorMessage: string;
  currentProvider: LLMProvider;
  llmConfig: LLMConfig;
  onConfirmSwitchAndRetry: (newProvider: LLMProvider) => void;
}

export default function AiErrorFallbackModal({
  isOpen,
  onClose,
  errorMessage,
  currentProvider,
  llmConfig,
  onConfirmSwitchAndRetry
}: AiErrorFallbackModalProps) {
  // Filter out current failed provider and providers where all models are locked
  const alternativeProviders = PROVIDER_OPTIONS.filter(p => {
    if (p.id === currentProvider) return false;
    if (p.id === "auto") return true;
    return p.models.some(m => !isModelLocked(p.id, m));
  });

  // Default selected provider to the first available alternative
  const [selectedProvider, setSelectedProvider] = useState<LLMProvider>(() => {
    return alternativeProviders[0]?.id || "groq";
  });

  // Whenever modal opens or currentProvider changes, reset selectedProvider to first available option
  useEffect(() => {
    if (isOpen) {
      const filtered = PROVIDER_OPTIONS.filter(p => {
        if (p.id === currentProvider) return false;
        if (p.id === "auto") return true;
        return p.models.some(m => !isModelLocked(p.id, m));
      });
      if (filtered.length > 0) {
        setSelectedProvider(filtered[0].id);
      }
    }
  }, [isOpen, currentProvider]);

  if (!isOpen) return null;

  const currentProviderName = getProviderDisplayName(currentProvider);

  const handleConfirm = () => {
    onConfirmSwitchAndRetry(selectedProvider);
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-xs">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          transition={{ duration: 0.2 }}
          className="bg-white border border-stone-200 rounded-2xl shadow-xl max-w-lg w-full overflow-hidden flex flex-col"
        >
          {/* Header */}
          <div className="p-4 sm:p-5 bg-amber-50/80 border-b border-amber-200/80 flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-100 border border-amber-300 flex items-center justify-center shrink-0 text-amber-800 shadow-2xs">
                <AlertCircle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-stone-900">
                  AI Provider Connection Failed
                </h3>
                <p className="text-xs text-stone-600 font-medium mt-0.5">
                  <span className="font-semibold text-amber-900">{currentProviderName}</span> returned an error.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-lg bg-stone-200/60 hover:bg-stone-200 text-stone-600 flex items-center justify-center transition-colors cursor-pointer shrink-0"
              title="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Body */}
          <div className="p-4 sm:p-5 space-y-4 max-h-[70vh] overflow-y-auto">
            {/* Error Message Box */}
            <div className="p-3 bg-red-50/80 border border-red-200 rounded-xl space-y-1">
              <span className="text-[10px] font-bold text-red-900 uppercase tracking-wider block font-mono">
                Error Details:
              </span>
              <p className="text-xs text-red-950 leading-relaxed font-mono break-words">
                {errorMessage || "Failed to communicate with AI provider."}
              </p>
            </div>

            {/* Provider Picker Header */}
            <div>
              <label className="text-xs font-bold text-stone-900 block mb-1.5">
                Select another AI provider (excluding {currentProviderName}):
              </label>
              <p className="text-xs text-stone-500 mb-3">
                Choose an alternative AI provider below to automatically switch your active provider and re-trigger your request.
              </p>

              {/* Provider List Options */}
              <div className="space-y-2">
                {alternativeProviders.map((provider) => {
                  const isSelected = selectedProvider === provider.id;
                  const savedProfile = llmConfig.savedProviders?.[provider.id];
                  const hasKeyOrWorker = !provider.requiresKey || Boolean(savedProfile?.apiKey) || Boolean(getStoredAccessCode());

                  return (
                    <button
                      key={provider.id}
                      type="button"
                      onClick={() => setSelectedProvider(provider.id)}
                      className={`w-full text-left p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                        isSelected
                          ? "bg-amber-50/70 border-amber-400 ring-1 ring-amber-400/50 shadow-2xs"
                          : "bg-white border-stone-200 hover:border-stone-300 hover:bg-stone-50/60"
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-xs font-bold ${
                          isSelected ? "bg-amber-600 text-white" : "bg-stone-100 text-stone-700"
                        }`}>
                          <Bot className="w-4 h-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <h4 className="text-xs sm:text-sm font-bold text-stone-900 truncate">
                              {provider.name}
                            </h4>
                            {hasKeyOrWorker && (
                              <span className="px-1.5 py-0.2 text-[9px] font-bold bg-emerald-100 text-emerald-800 rounded border border-emerald-200">
                                Ready
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-stone-500 truncate mt-0.5">
                            {provider.tagline}
                          </p>
                        </div>
                      </div>

                      <div className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 ${
                        isSelected
                          ? "bg-stone-900 border-stone-900 text-amber-400"
                          : "border-stone-300 bg-white"
                      }`}>
                        {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="p-4 sm:p-5 bg-stone-50 border-t border-stone-200 flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-stone-300 bg-white hover:bg-stone-100 text-stone-700 text-xs font-semibold transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              className="px-4 py-2 rounded-xl bg-stone-900 hover:bg-stone-800 text-amber-400 text-xs font-bold transition-all shadow-2xs hover:scale-102 flex items-center gap-1.5 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>OK</span>
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
