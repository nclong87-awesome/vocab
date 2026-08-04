import React, { useState, useEffect } from "react";
import { motion } from "motion/react";
import { 
  Key, 
  Globe, 
  Sparkles, 
  Check, 
  ArrowRight, 
  Eye, 
  EyeOff, 
  ShieldCheck, 
  Search, 
  X, 
  
  
  Lock,
  Globe2
} from "lucide-react";
import { SUPPORTED_LANGUAGES,  getLanguageFlag } from "../config/languages";

interface OnboardingModalProps {
  isOpen: boolean;
  initialProxyKey?: string;
  initialTargetLanguage?: string;
  initialNativeLanguage?: string;
  initialAppLanguage?: string;
  onCompleteOnboarding: (data: {
    accessCode: string;
    targetLanguage: string;
    nativeLanguage: string;
    appLanguage: string;
  }) => void;
  onClose?: () => void;
  canDismiss?: boolean;
}

export default function OnboardingModal({
  isOpen,
  initialProxyKey = "",
  initialTargetLanguage = "English",
  initialNativeLanguage = "Vietnamese",
  initialAppLanguage = "Vietnamese",
  onCompleteOnboarding,
  onClose,
  canDismiss = false
}: OnboardingModalProps) {
  const [step, setStep] = useState<1 | 2>(1);

  // Form State
  const [accessCode, setAccessCode] = useState<string>(initialProxyKey);
  const [showAccessCode, setShowAccessCode] = useState<boolean>(false);

  const [targetLanguage, setTargetLanguage] = useState<string>(initialTargetLanguage);
  const [nativeLanguage, setNativeLanguage] = useState<string>(initialNativeLanguage);
  const [appLanguage, setAppLanguage] = useState<string>(initialAppLanguage);

  const [customTarget, setCustomTarget] = useState<string>("");
  const [customNative, setCustomNative] = useState<string>("");

  const [searchQuery, setSearchQuery] = useState<string>("");

  useEffect(() => {
    if (isOpen) {
      setAccessCode(initialProxyKey || "");
      setTargetLanguage(initialTargetLanguage || "English");
      setNativeLanguage(initialNativeLanguage || "Vietnamese");
      setAppLanguage(initialAppLanguage || initialNativeLanguage || "Vietnamese");
      setStep(1);
    }
  }, [isOpen, initialProxyKey, initialTargetLanguage, initialNativeLanguage, initialAppLanguage]);

  if (!isOpen) return null;

  const finalTargetLang = targetLanguage === "Custom" ? customTarget.trim() || "English" : targetLanguage;
  const finalNativeLang = nativeLanguage === "Custom" ? customNative.trim() || "Vietnamese" : nativeLanguage;
  const finalAppLang = appLanguage || finalNativeLang;

  const filteredLanguages = SUPPORTED_LANGUAGES.filter(lang => 
    lang.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    lang.nativeName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    lang.code.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleFinish = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    onCompleteOnboarding({
      accessCode: accessCode.trim(),
      targetLanguage: finalTargetLang,
      nativeLanguage: finalNativeLang,
      appLanguage: finalAppLang
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-stone-950/80 backdrop-blur-md overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 12 }}
        transition={{ duration: 0.22, ease: "easeOut" }}
        className="bg-white border border-stone-200 shadow-2xl max-w-xl w-full my-auto flex flex-col overflow-hidden rounded-2xl"
        id="onboarding-modal"
      >
        {/* Header Section */}
        <div className="bg-stone-900 text-white p-5 sm:p-6 relative border-b border-stone-800 shrink-0">
          <div className="flex items-center justify-between gap-3 mb-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider bg-amber-400/10 text-amber-400 border border-amber-400/30 px-2.5 py-1 rounded-full">
              <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" /> Welcome Onboarding
            </span>
            {canDismiss && onClose && (
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 text-stone-400 hover:text-white transition-colors cursor-pointer rounded-lg hover:bg-stone-800"
                title="Close Onboarding"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>

          <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight">
            {step === 1 ? "Enter Access Code" : "Choose Languages"}
          </h2>
          <p className="text-stone-300 text-xs sm:text-sm mt-1 leading-relaxed font-serif italic">
            {step === 1 
              ? "Provide your access code to set up your AI Proxy Key for unlimited AI language features." 
              : "Select the language you want to study and your native language for clear explanations."}
          </p>

          {/* Stepper Progress Bar */}
          <div className="flex items-center gap-2 mt-4 pt-3 border-t border-stone-800">
            <button
              type="button"
              onClick={() => setStep(1)}
              className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-2 border ${
                step === 1
                  ? "bg-amber-400 text-stone-950 border-amber-400 shadow-xs"
                  : "bg-stone-800 text-stone-300 border-stone-700 hover:bg-stone-700"
              }`}
            >
              <span className="w-4 h-4 rounded-full bg-stone-950 text-white text-[10px] flex items-center justify-center font-mono">1</span>
              <span>Access Code</span>
            </button>

            <span className="text-stone-600 text-xs">➔</span>

            <button
              type="button"
              onClick={() => setStep(2)}
              className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-2 border ${
                step === 2
                  ? "bg-amber-400 text-stone-950 border-amber-400 shadow-xs"
                  : "bg-stone-800 text-stone-300 border-stone-700 hover:bg-stone-700"
              }`}
            >
              <span className="w-4 h-4 rounded-full bg-stone-950 text-white text-[10px] flex items-center justify-center font-mono">2</span>
              <span>Languages</span>
            </button>
          </div>
        </div>

        {/* STEP 1: ACCESS CODE (PROXY KEY) */}
        {step === 1 && (
          <div className="p-5 sm:p-6 space-y-5">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold uppercase tracking-wider text-stone-800 flex items-center gap-1.5">
                  <Key className="w-4 h-4 text-amber-600 shrink-0" />
                  Access Code (Proxy Key)
                </label>
                {accessCode.trim() ? (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 border border-emerald-200 rounded-md">
                    <ShieldCheck className="w-3 h-3" /> Ready
                  </span>
                ) : (
                  <span className="text-[10px] font-semibold text-stone-400">
                    Optional / Can be set later
                  </span>
                )}
              </div>

              <div className="relative">
                <input
                  type={showAccessCode ? "text" : "password"}
                  value={accessCode}
                  onChange={(e) => setAccessCode(e.target.value)}
                  placeholder="Enter your access code..."
                  autoFocus
                  className="w-full bg-stone-50 border border-stone-300 focus:border-stone-900 focus:bg-white p-3 pr-10 rounded-xl text-sm font-mono text-stone-900 focus:outline-none transition-all shadow-2xs"
                />
                <button
                  type="button"
                  onClick={() => setShowAccessCode(!showAccessCode)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-800 p-1 cursor-pointer"
                  title={showAccessCode ? "Hide Access Code" : "Show Access Code"}
                >
                  {showAccessCode ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>

              <p className="text-xs text-stone-500 leading-relaxed pt-1">
                Your Access Code is stored securely as your <span className="font-semibold text-stone-800">Proxy Key</span> to authorize AI model completions.
              </p>
            </div>

            <div className="p-3.5 bg-amber-50/80 border border-amber-200/80 rounded-xl text-xs text-amber-900 space-y-1">
              <div className="font-bold flex items-center gap-1.5 text-amber-950">
                <Lock className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                No Access Code?
              </div>
              <p className="text-amber-800/90 leading-relaxed text-[11px]">
                You can leave this blank and proceed with free default AI models or configure direct API keys (Groq, OpenAI, Gemini, etc.) anytime in Settings.
              </p>
            </div>

            <div className="pt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="w-full sm:w-auto px-5 py-3 bg-stone-900 hover:bg-stone-800 text-white font-bold text-xs rounded-xl transition-all cursor-pointer shadow-md flex items-center justify-center gap-2"
              >
                <span>Next: Choose Languages</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* STEP 2: TARGET & NATIVE LANGUAGES */}
        {step === 2 && (
          <form onSubmit={handleFinish} className="p-5 sm:p-6 space-y-5">
            
            {/* Target Language Selection */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold uppercase tracking-wider text-stone-800 flex items-center gap-1.5">
                  <Globe className="w-4 h-4 text-blue-600 shrink-0" />
                  Target Language (What you want to learn)
                </label>
                <span className="text-xs font-extrabold text-blue-700 bg-blue-50 px-2 py-0.5 border border-blue-200 rounded-md">
                  {getLanguageFlag(finalTargetLang)} {finalTargetLang}
                </span>
              </div>

              {/* Language Search */}
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter target languages..."
                  className="w-full bg-stone-50 border border-stone-200 focus:border-stone-900 pl-8 pr-8 py-2 rounded-lg text-xs text-stone-900 focus:outline-none"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-700 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Grid of Languages */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-48 overflow-y-auto p-1 bg-stone-50/70 border border-stone-200 rounded-xl">
                {filteredLanguages.map((lang) => {
                  const isSelected = targetLanguage === lang.code;
                  return (
                    <button
                      key={`onboarding-target-${lang.code}`}
                      type="button"
                      onClick={() => setTargetLanguage(lang.code)}
                      className={`p-2 rounded-lg text-left transition-all cursor-pointer flex items-center justify-between border ${
                        isSelected
                          ? "bg-stone-900 text-white border-stone-900 shadow-xs"
                          : "bg-white hover:bg-stone-100 text-stone-800 border-stone-200/90"
                      }`}
                    >
                      <div className="flex items-center gap-2 overflow-hidden">
                        <span className="text-base shrink-0">{lang.flag}</span>
                        <div className="truncate">
                          <div className="font-bold text-[11px] truncate">{lang.name}</div>
                          <div className={`text-[9px] truncate ${isSelected ? "text-stone-300" : "text-stone-400"}`}>
                            {lang.nativeName}
                          </div>
                        </div>
                      </div>
                      {isSelected && <Check className="w-3.5 h-3.5 text-amber-400 shrink-0 ml-1" />}
                    </button>
                  );
                })}

                {/* Custom language option */}
                <button
                  type="button"
                  onClick={() => setTargetLanguage("Custom")}
                  className={`p-2 rounded-lg text-left transition-all cursor-pointer flex items-center justify-between border ${
                    targetLanguage === "Custom"
                      ? "bg-stone-900 text-white border-stone-900"
                      : "bg-white hover:bg-stone-100 text-stone-800 border-stone-200/90"
                  }`}
                >
                  <div className="font-bold text-[11px]">Other / Custom</div>
                  {targetLanguage === "Custom" && <Check className="w-3.5 h-3.5 text-amber-400 shrink-0" />}
                </button>
              </div>

              {targetLanguage === "Custom" && (
                <input
                  type="text"
                  value={customTarget}
                  onChange={(e) => setCustomTarget(e.target.value)}
                  placeholder="Enter target language name (e.g. Swedish, Latin)..."
                  className="w-full bg-stone-50 border border-stone-300 p-2.5 rounded-lg text-xs font-semibold text-stone-900 focus:outline-none focus:border-stone-900"
                />
              )}
            </div>

            {/* Native Language Selection */}
            <div className="space-y-2 pt-1 border-t border-stone-100">
              <label className="text-xs font-bold uppercase tracking-wider text-stone-800 flex items-center gap-1.5">
                <Globe2 className="w-4 h-4 text-emerald-600 shrink-0" />
                Your Native Language (for translations)
              </label>

              <select
                value={nativeLanguage}
                onChange={(e) => {
                  setNativeLanguage(e.target.value);
                  setAppLanguage(e.target.value);
                }}
                className="w-full bg-stone-50 border border-stone-300 p-2.5 rounded-xl text-xs font-semibold text-stone-900 focus:outline-none focus:border-stone-900"
              >
                {SUPPORTED_LANGUAGES.map((lang) => (
                  <option key={`onboarding-native-${lang.code}`} value={lang.code}>
                    {lang.flag} {lang.name} ({lang.nativeName})
                  </option>
                ))}
                <option value="Custom">Other / Custom</option>
              </select>

              {nativeLanguage === "Custom" && (
                <input
                  type="text"
                  value={customNative}
                  onChange={(e) => setCustomNative(e.target.value)}
                  placeholder="Enter native language name..."
                  className="w-full bg-stone-50 border border-stone-300 p-2 rounded-lg text-xs font-semibold text-stone-900 focus:outline-none focus:border-stone-900 mt-1"
                />
              )}
            </div>

            {/* Action Buttons */}
            <div className="pt-3 flex items-center justify-between gap-3 border-t border-stone-200">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="px-4 py-2.5 border border-stone-300 hover:bg-stone-100 text-stone-700 font-bold text-xs rounded-xl transition-all cursor-pointer"
              >
                Back
              </button>

              <button
                type="submit"
                className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs rounded-xl transition-all cursor-pointer shadow-md flex items-center gap-2"
              >
                <Sparkles className="w-4 h-4 text-amber-300" />
                <span>Complete Setup & Start</span>
              </button>
            </div>
          </form>
        )}
      </motion.div>
    </div>
  );
}
