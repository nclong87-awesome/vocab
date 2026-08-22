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
  Globe2,
  Mail,
  Copy,
  AlertCircle
} from "lucide-react";
import { SUPPORTED_LANGUAGES, getLanguageFlag } from "../config/languages";
import { useModalBackNavigation } from "../hooks/useModalBackNavigation";

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
  useModalBackNavigation(isOpen, onClose);

  const [step, setStep] = useState<1 | 2>(1);

  // Form State
  const [accessCode, setAccessCode] = useState<string>(initialProxyKey);
  const [showAccessCode, setShowAccessCode] = useState<boolean>(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [copiedEmail, setCopiedEmail] = useState<boolean>(false);

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
      setValidationError(null);
      setCopiedEmail(false);
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

  const handleNextStep = () => {
    if (!accessCode.trim()) {
      setValidationError("An Access Code is required to keep using the app.");
      return;
    }
    setValidationError(null);
    setStep(2);
  };

  const handleFinish = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!accessCode.trim()) {
      setStep(1);
      setValidationError("An Access Code is required to keep using the app.");
      return;
    }
    onCompleteOnboarding({
      accessCode: accessCode.trim(),
      targetLanguage: finalTargetLang,
      nativeLanguage: finalNativeLang,
      appLanguage: finalAppLang
    });
  };

  const allowDismiss = canDismiss && Boolean(accessCode.trim());

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
        <div className="bg-stone-900 text-white p-3.5 sm:p-5 relative border-b border-stone-800 shrink-0">
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider bg-amber-400/10 text-amber-400 border border-amber-400/30 px-2.5 py-0.5 rounded-full">
              <Sparkles className="w-3 h-3 text-amber-400 shrink-0" /> Welcome Onboarding
            </span>
            {allowDismiss && onClose && (
              <button
                type="button"
                onClick={onClose}
                className="p-1 text-stone-400 hover:text-white transition-colors cursor-pointer rounded-lg hover:bg-stone-800"
                title="Close Onboarding"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <h2 className="text-lg sm:text-xl font-black text-white tracking-tight">
            {step === 1 ? "Enter Access Code" : "Choose Languages"}
          </h2>
          <p className="text-stone-300 text-xs mt-0.5 font-serif italic">
            {step === 1 
              ? "An access code is required to keep using the app." 
              : "Select target and native languages."}
          </p>

          {/* Stepper Progress Bar */}
          <div className="flex items-center gap-2 mt-2.5 pt-2 border-t border-stone-800">
            <button
              type="button"
              onClick={() => setStep(1)}
              className={`flex-1 py-1 px-2.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 border ${
                step === 1
                  ? "bg-amber-400 text-stone-950 border-amber-400 shadow-xs"
                  : "bg-stone-800 text-stone-300 border-stone-700 hover:bg-stone-700"
              }`}
            >
              <span className="w-3.5 h-3.5 rounded-full bg-stone-950 text-white text-[9px] flex items-center justify-center font-mono">1</span>
              <span>Access Code</span>
            </button>

            <span className="text-stone-600 text-xs">➔</span>

            <button
              type="button"
              onClick={handleNextStep}
              className={`flex-1 py-1 px-2.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 border ${
                step === 2
                  ? "bg-amber-400 text-stone-950 border-amber-400 shadow-xs"
                  : "bg-stone-800 text-stone-300 border-stone-700 hover:bg-stone-700"
              }`}
            >
              <span className="w-3.5 h-3.5 rounded-full bg-stone-950 text-white text-[9px] flex items-center justify-center font-mono">2</span>
              <span>Languages</span>
            </button>
          </div>
        </div>

        {/* STEP 1: ACCESS CODE (PROXY KEY) */}
        {step === 1 && (
          <div className="p-3.5 sm:p-5 space-y-3.5">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold uppercase tracking-wider text-stone-800 flex items-center gap-1">
                  <Key className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                  Access Code <span className="text-red-500 font-bold">*</span>
                </label>
                {accessCode.trim() ? (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 border border-emerald-200 rounded">
                    <ShieldCheck className="w-3 h-3" /> Ready
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-800 bg-amber-100 px-1.5 py-0.5 border border-amber-300 rounded">
                    <Lock className="w-3 h-3" /> Required
                  </span>
                )}
              </div>

              <div className="relative">
                <input
                  type={showAccessCode ? "text" : "password"}
                  value={accessCode}
                  onChange={(e) => {
                    setAccessCode(e.target.value);
                    if (e.target.value.trim()) {
                      setValidationError(null);
                    }
                  }}
                  placeholder="Enter your access code..."
                  autoFocus
                  className={`w-full bg-stone-50 border ${
                    validationError ? "border-red-500 bg-red-50/20 focus:border-red-600" : "border-stone-300 focus:border-stone-900 focus:bg-white"
                  } p-2.5 pr-9 rounded-xl text-xs font-mono text-stone-900 focus:outline-none transition-all shadow-2xs`}
                />
                <button
                  type="button"
                  onClick={() => setShowAccessCode(!showAccessCode)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-800 p-1 cursor-pointer"
                  title={showAccessCode ? "Hide Access Code" : "Show Access Code"}
                >
                  {showAccessCode ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>

              {validationError && (
                <div className="text-xs text-red-600 font-bold flex items-center gap-1 pt-0.5">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>{validationError}</span>
                </div>
              )}
            </div>

            {/* Access Code Request Box */}
            <div className="p-3 bg-amber-50/90 border border-amber-200 rounded-xl text-xs space-y-2 shadow-2xs">
              <div className="flex items-center justify-between text-amber-950 font-bold text-xs">
                <span className="flex items-center gap-1">
                  <Lock className="w-3.5 h-3.5 text-amber-700 shrink-0" /> Need an Access Code?
                </span>
                <span className="text-[10px] text-amber-900 font-mono">nclong87@gmail.com</span>
              </div>

              <div className="flex items-center gap-2">
                <a
                  href="mailto:nclong87@gmail.com?subject=Access%20Code%20Request%20-%20Vocab%20AI&body=Hi%2C%20I%20would%20like%20to%20request%20an%20access%20code%20to%20use%20the%20Vocab%20AI%20app.%0A%0AMy%20Email%3A%20"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 py-2 px-3 bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white font-extrabold text-xs rounded-lg transition-all flex items-center justify-center gap-1.5 no-underline shadow-2xs cursor-pointer"
                >
                  <Mail className="w-3.5 h-3.5 shrink-0" />
                  <span>Request Code via Email</span>
                </a>

                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText("nclong87@gmail.com");
                    setCopiedEmail(true);
                    setTimeout(() => setCopiedEmail(false), 2500);
                  }}
                  className="px-2.5 py-2 bg-amber-100 hover:bg-amber-200/90 border border-amber-300 text-amber-950 font-bold text-xs rounded-lg transition-all flex items-center justify-center gap-1 shrink-0 cursor-pointer"
                  title="Copy email address"
                >
                  {copiedEmail ? (
                    <span className="text-emerald-800 flex items-center gap-1">
                      <Check className="w-3.5 h-3.5 text-emerald-600" /> Copied
                    </span>
                  ) : (
                    <span className="flex items-center gap-1">
                      <Copy className="w-3.5 h-3.5 text-amber-800" /> Copy Email
                    </span>
                  )}
                </button>
              </div>
            </div>

            <div className="pt-1">
              <button
                type="button"
                onClick={handleNextStep}
                className="w-full py-2.5 bg-stone-900 hover:bg-stone-800 text-white font-bold text-xs rounded-xl transition-all cursor-pointer shadow-md flex items-center justify-center gap-2"
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
