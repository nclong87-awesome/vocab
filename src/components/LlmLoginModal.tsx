import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Key, 
  Cpu, 
  CheckCircle2, 
  AlertCircle, 
  Loader2, 
  Eye, 
  EyeOff, 
  Globe, 
  Lock, 
  X,
  Sparkles,
  ArrowRight,
  ArrowLeft,
  ShieldCheck,
  Server,
  Globe2,
  BookOpen,
  Check
} from "lucide-react";
import { LLMConfig, LLMProvider } from "../types";
import { PROVIDER_OPTIONS } from "../config/llmProviders";

export interface LanguageOption {
  code: string;
  name: string;
  nativeName: string;
  flag: string;
}

export const ONBOARDING_LANGUAGES: LanguageOption[] = [
  { code: "English", name: "English", nativeName: "English", flag: "🇬🇧" },
  { code: "Spanish", name: "Spanish", nativeName: "Español", flag: "🇪🇸" },
  { code: "French", name: "French", nativeName: "Français", flag: "🇫🇷" },
  { code: "German", name: "German", nativeName: "Deutsch", flag: "🇩🇪" },
  { code: "Vietnamese", name: "Vietnamese", nativeName: "Tiếng Việt", flag: "🇻🇳" },
  { code: "Japanese", name: "Japanese", nativeName: "日本語", flag: "🇯🇵" },
  { code: "Chinese", name: "Chinese", nativeName: "中文", flag: "🇨🇳" },
  { code: "Italian", name: "Italian", nativeName: "Italiano", flag: "🇮🇹" },
  { code: "Portuguese", name: "Portuguese", nativeName: "Português", flag: "🇵🇹" },
  { code: "Korean", name: "Korean", nativeName: "한국어", flag: "🇰🇷" },
  { code: "Russian", name: "Russian", nativeName: "Русский", flag: "🇷🇺" },
  { code: "Dutch", name: "Dutch", nativeName: "Nederlands", flag: "🇳🇱" },
  { code: "Arabic", name: "Arabic", nativeName: "العربية", flag: "🇸🇦" },
];

interface LlmLoginModalProps {
  isOpen: boolean;
  currentConfig: LLMConfig;
  initialNativeLanguage?: string;
  initialTargetLanguage?: string;
  onSaveConfig: (config: LLMConfig) => void;
  onSaveOnboarding?: (languages: { nativeLanguage: string; targetLanguage: string }, config: LLMConfig) => void;
  onClose?: () => void;
  canDismiss?: boolean;
  defaultStep?: number;
}

export default function LlmLoginModal({
  isOpen,
  currentConfig,
  initialNativeLanguage,
  initialTargetLanguage,
  onSaveConfig,
  onSaveOnboarding,
  onClose,
  canDismiss = false,
  defaultStep = 1
}: LlmLoginModalProps) {
  const [step, setStep] = useState<number>(defaultStep);

  // Language state
  const [nativeLanguage, setNativeLanguage] = useState<string>(
    initialNativeLanguage || localStorage.getItem("vocab_learner_native_lang") || "English"
  );
  const [targetLanguage, setTargetLanguage] = useState<string>(
    initialTargetLanguage || localStorage.getItem("vocab_learner_target_lang") || "Spanish"
  );
  const [customNative, setCustomNative] = useState<string>("");
  const [customTarget, setCustomTarget] = useState<string>("");

  // LLM Config state
  const [provider, setProvider] = useState<LLMProvider>(currentConfig.provider || "ollama");
  const [model, setModel] = useState<string>(currentConfig.model || "gemma4:31b");
  const [customModel, setCustomModel] = useState<string>("");
  const [isCustomModelMode, setIsCustomModelMode] = useState<boolean>(false);
  const [apiKey, setApiKey] = useState<string>(currentConfig.apiKey || "");
  const [baseUrl, setBaseUrl] = useState<string>(currentConfig.baseUrl || "");
  const [showApiKey, setShowApiKey] = useState<boolean>(false);

  const [testingStatus, setTestingStatus] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [testMessage, setTestMessage] = useState<string>("");

  useEffect(() => {
    if (isOpen) {
      setStep(canDismiss ? 3 : 1);
      setProvider(currentConfig.provider || "ollama");
      setModel(currentConfig.model || "gemma4:31b");
      setApiKey(currentConfig.apiKey || "");
      setBaseUrl(currentConfig.baseUrl || "");
      setTestingStatus("idle");
      setTestMessage("");
      
      const storedNative = initialNativeLanguage || localStorage.getItem("vocab_learner_native_lang") || "English";
      const storedTarget = initialTargetLanguage || localStorage.getItem("vocab_learner_target_lang") || "Spanish";
      setNativeLanguage(storedNative);
      setTargetLanguage(storedTarget);
    }
  }, [isOpen, currentConfig, canDismiss, initialNativeLanguage, initialTargetLanguage]);

  if (!isOpen) return null;

  const currentProviderMeta = PROVIDER_OPTIONS.find(p => p.id === provider) || PROVIDER_OPTIONS[0];

  const handleProviderSelect = (pId: LLMProvider) => {
    const meta = PROVIDER_OPTIONS.find(p => p.id === pId);
    setProvider(pId);
    if (meta) {
      setModel(meta.defaultModel);
      setBaseUrl(meta.defaultBaseUrl || "");
      setIsCustomModelMode(false);
    }
    setTestingStatus("idle");
    setTestMessage("");
  };

  const handleTestConnection = async () => {
    const activeModel = isCustomModelMode ? customModel.trim() : model;
    if (!activeModel) {
      setTestingStatus("error");
      setTestMessage("Please select or enter a valid model name.");
      return;
    }

    if (currentProviderMeta.requiresKey && !apiKey.trim()) {
      setTestingStatus("error");
      setTestMessage(`An API Key is required for ${currentProviderMeta.name}.`);
      return;
    }

    setTestingStatus("testing");
    setTestMessage("Verifying LLM provider connection...");

    try {
      const response = await fetch("/api/test-llm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          llmConfig: {
            provider,
            model: activeModel,
            apiKey: apiKey.trim(),
            baseUrl: baseUrl.trim(),
            isLoggedIn: true
          }
        })
      });

      const data = await response.json();
      if (response.ok && data.success) {
        setTestingStatus("success");
        setTestMessage("Connection verified! Model responded successfully.");
      } else {
        setTestingStatus("error");
        setTestMessage(data.error || "Failed to establish connection with provider.");
      }
    } catch (err: any) {
      setTestingStatus("error");
      setTestMessage(err.message || "Network error testing connection.");
    }
  };

  const finalNativeLang = nativeLanguage === "Custom" ? customNative.trim() || "English" : nativeLanguage;
  const finalTargetLang = targetLanguage === "Custom" ? customTarget.trim() || "Spanish" : targetLanguage;

  const handleCompleteSetup = (e: React.FormEvent) => {
    e.preventDefault();
    const activeModel = isCustomModelMode ? customModel.trim() : model;

    if (!activeModel) {
      setTestingStatus("error");
      setTestMessage("Please select or enter a model.");
      return;
    }

    if (currentProviderMeta.requiresKey && !apiKey.trim()) {
      setTestingStatus("error");
      setTestMessage(`API key is required to log in with ${currentProviderMeta.name}.`);
      return;
    }

    const newConfig: LLMConfig = {
      provider,
      model: activeModel,
      apiKey: apiKey.trim(),
      baseUrl: baseUrl.trim(),
      isLoggedIn: true
    };

    if (onSaveOnboarding) {
      onSaveOnboarding(
        { nativeLanguage: finalNativeLang, targetLanguage: finalTargetLang },
        newConfig
      );
    } else {
      onSaveConfig(newConfig);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-2.5 sm:p-4 bg-stone-950/80 backdrop-blur-sm overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 10 }}
        transition={{ duration: 0.2 }}
        className="bg-white border border-stone-200 shadow-2xl max-w-2xl w-full my-auto max-h-[92vh] sm:max-h-[88vh] flex flex-col overflow-hidden"
        id="onboarding-llm-modal"
      >
        {/* Header Bar */}
        <div className="bg-stone-900 text-white p-4 sm:p-5 flex justify-between items-start border-b border-stone-800 shrink-0">
          <div>
            <div className="inline-flex items-center gap-1.5 text-xs font-semibold bg-stone-800 text-stone-300 px-2.5 py-0.5 mb-1.5 border border-stone-700">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" /> Welcome to Vocab AI Setup
            </div>
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
              {step === 1 && "What language do you speak?"}
              {step === 2 && "What language do you want to learn?"}
              {step === 3 && "Connect Your AI Model Engine"}
            </h2>
            <p className="text-stone-400 text-xs mt-0.5 font-serif italic leading-relaxed">
              {step === 1 && "Select your native or primary language to customize translations and explanations."}
              {step === 2 && "Select your target language. AI will curate personalized flashcards and pronunciation guides."}
              {step === 3 && "Connect your LLM provider to power instant AI vocabulary generation and interactive quizzes."}
            </p>
          </div>
          {canDismiss && onClose && (
            <button 
              onClick={onClose}
              className="p-1.5 text-stone-400 hover:text-white transition-colors ml-2 shrink-0 cursor-pointer"
              title="Close Modal"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Stepper Navigation Header */}
        <div className="bg-stone-100 border-b border-stone-200 px-3 sm:px-6 py-2 flex items-center justify-between text-xs shrink-0 overflow-x-auto">
          <button
            type="button"
            onClick={() => setStep(1)}
            className={`flex items-center gap-1.5 font-semibold text-xs px-2.5 py-1 transition-all cursor-pointer ${
              step === 1
                ? "bg-stone-900 text-white shadow-xs"
                : "text-stone-600 hover:text-stone-900 hover:bg-stone-200/60"
            }`}
          >
            <span className="w-4 h-4 rounded-full bg-stone-700 text-white flex items-center justify-center text-[10px] font-mono">1</span>
            <span>Current: <strong className="font-extrabold">{finalNativeLang}</strong></span>
          </button>

          <span className="text-stone-300 font-bold">➔</span>

          <button
            type="button"
            onClick={() => setStep(2)}
            className={`flex items-center gap-1.5 font-semibold text-xs px-2.5 py-1 transition-all cursor-pointer ${
              step === 2
                ? "bg-stone-900 text-white shadow-xs"
                : "text-stone-600 hover:text-stone-900 hover:bg-stone-200/60"
            }`}
          >
            <span className="w-4 h-4 rounded-full bg-stone-700 text-white flex items-center justify-center text-[10px] font-mono">2</span>
            <span>Learning: <strong className="font-extrabold">{finalTargetLang}</strong></span>
          </button>

          <span className="text-stone-300 font-bold">➔</span>

          <button
            type="button"
            onClick={() => setStep(3)}
            className={`flex items-center gap-1.5 font-semibold text-xs px-2.5 py-1 transition-all cursor-pointer ${
              step === 3
                ? "bg-stone-900 text-white shadow-xs"
                : "text-stone-600 hover:text-stone-900 hover:bg-stone-200/60"
            }`}
          >
            <span className="w-4 h-4 rounded-full bg-stone-700 text-white flex items-center justify-center text-[10px] font-mono">3</span>
            <span>LLM Login</span>
          </button>
        </div>

        {/* STEP 1: SELECT NATIVE LANGUAGE */}
        {step === 1 && (
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 md:p-8 space-y-6">
            <div className="space-y-3">
              <label className="text-xs font-semibold text-stone-900 flex items-center gap-2">
                <Globe2 className="w-4 h-4 text-stone-900" /> Choose Your Primary / Native Language
              </label>

              <div className="grid grid-cols-2 min-[480px]:grid-cols-3 sm:grid-cols-4 gap-2.5">
                {ONBOARDING_LANGUAGES.map((lang) => {
                  const isSelected = nativeLanguage === lang.code;
                  return (
                    <button
                      key={lang.code}
                      type="button"
                      onClick={() => setNativeLanguage(lang.code)}
                      className={`p-3 border text-left transition-all cursor-pointer flex items-center justify-between ${
                        isSelected 
                          ? "bg-stone-900 text-white border-stone-900 shadow-sm"
                          : "bg-stone-50 hover:bg-stone-100 text-stone-800 border-stone-200"
                      }`}
                    >
                      <div className="flex items-center gap-2 overflow-hidden">
                        <span className="text-xl shrink-0">{lang.flag}</span>
                        <div className="truncate">
                          <div className="font-bold text-xs">{lang.name}</div>
                          <div className={`text-[10px] font-serif italic line-clamp-1 ${isSelected ? "text-stone-300" : "text-stone-500"}`}>
                            {lang.nativeName}
                          </div>
                        </div>
                      </div>
                      {isSelected && <Check className="w-4 h-4 text-white shrink-0 ml-1" />}
                    </button>
                  );
                })}

                {/* Custom language option */}
                <button
                  type="button"
                  onClick={() => setNativeLanguage("Custom")}
                  className={`p-3 border text-left transition-all cursor-pointer flex items-center justify-between ${
                    nativeLanguage === "Custom"
                      ? "bg-stone-900 text-white border-stone-900"
                      : "bg-stone-50 hover:bg-stone-100 text-stone-800 border-stone-200"
                  }`}
                >
                  <div>
                    <div className="font-bold text-xs">Other Language</div>
                    <div className="text-[10px] text-stone-400 italic">Type custom</div>
                  </div>
                  {nativeLanguage === "Custom" && <Check className="w-4 h-4 text-white shrink-0" />}
                </button>
              </div>

              {nativeLanguage === "Custom" && (
                <div className="pt-2">
                  <input
                    type="text"
                    value={customNative}
                    onChange={(e) => setCustomNative(e.target.value)}
                    placeholder="Enter your language name (e.g., Polish, Swedish, Thai...)"
                    className="w-full bg-stone-50 border border-stone-300 p-3 text-xs text-stone-900 font-medium focus:outline-none focus:border-stone-900"
                  />
                </div>
              )}
            </div>

            <div className="pt-4 border-t border-stone-200 flex justify-end">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="px-6 py-2.5 bg-stone-900 hover:bg-black text-white font-semibold text-xs flex items-center gap-2 cursor-pointer transition-all shadow-sm"
              >
                Next: Choose Target Language <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* STEP 2: SELECT TARGET LANGUAGE TO LEARN */}
        {step === 2 && (
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 md:p-8 space-y-6">
            {/* Visual Language Pairing Banner */}
            <div className="bg-stone-900 text-white p-4 border border-stone-800 flex items-center justify-between">
              <div>
                <span className="text-xs font-semibold text-stone-400 block">Language Pair Configuration</span>
                <p className="text-sm font-bold text-white mt-0.5">
                  Native Language: <span className="text-amber-300">{finalNativeLang}</span> ➔ Learning: <span className="text-emerald-300">{finalTargetLang}</span>
                </p>
              </div>
              <BookOpen className="w-6 h-6 text-stone-400 shrink-0" />
            </div>

            <div className="space-y-3">
              <label className="text-xs font-semibold text-stone-900 flex items-center gap-2">
                <Globe className="w-4 h-4 text-stone-900" /> Choose Language You Want to Learn
              </label>

              <div className="grid grid-cols-2 min-[480px]:grid-cols-3 sm:grid-cols-4 gap-2.5">
                {ONBOARDING_LANGUAGES.map((lang) => {
                  const isSelected = targetLanguage === lang.code;
                  return (
                    <button
                      key={lang.code}
                      type="button"
                      onClick={() => setTargetLanguage(lang.code)}
                      className={`p-3 border text-left transition-all cursor-pointer flex items-center justify-between ${
                        isSelected 
                          ? "bg-stone-900 text-white border-stone-900 shadow-sm"
                          : "bg-stone-50 hover:bg-stone-100 text-stone-800 border-stone-200"
                      }`}
                    >
                      <div className="flex items-center gap-2 overflow-hidden">
                        <span className="text-xl shrink-0">{lang.flag}</span>
                        <div className="truncate">
                          <div className="font-bold text-xs">{lang.name}</div>
                          <div className={`text-[10px] font-serif italic line-clamp-1 ${isSelected ? "text-stone-300" : "text-stone-500"}`}>
                            {lang.nativeName}
                          </div>
                        </div>
                      </div>
                      {isSelected && <Check className="w-4 h-4 text-white shrink-0 ml-1" />}
                    </button>
                  );
                })}

                {/* Custom target language option */}
                <button
                  type="button"
                  onClick={() => setTargetLanguage("Custom")}
                  className={`p-3 border text-left transition-all cursor-pointer flex items-center justify-between ${
                    targetLanguage === "Custom"
                      ? "bg-stone-900 text-white border-stone-900"
                      : "bg-stone-50 hover:bg-stone-100 text-stone-800 border-stone-200"
                  }`}
                >
                  <div>
                    <div className="font-bold text-xs">Other Language</div>
                    <div className="text-[10px] text-stone-400 italic">Type custom</div>
                  </div>
                  {targetLanguage === "Custom" && <Check className="w-4 h-4 text-white shrink-0" />}
                </button>
              </div>

              {targetLanguage === "Custom" && (
                <div className="pt-2">
                  <input
                    type="text"
                    value={customTarget}
                    onChange={(e) => setCustomTarget(e.target.value)}
                    placeholder="Enter target language name (e.g., Finnish, Greek, Hindi...)"
                    className="w-full bg-stone-50 border border-stone-300 p-3 text-xs text-stone-900 font-medium focus:outline-none focus:border-stone-900"
                  />
                </div>
              )}
            </div>

            <div className="pt-4 border-t border-stone-200 flex justify-between items-center">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="px-4 py-2.5 border border-stone-300 hover:border-stone-900 bg-stone-50 text-stone-800 font-semibold text-xs flex items-center gap-1.5 cursor-pointer transition-all"
              >
                <ArrowLeft className="w-4 h-4" /> Back to Native Language
              </button>

              <button
                type="button"
                onClick={() => setStep(3)}
                className="px-6 py-2.5 bg-stone-900 hover:bg-black text-white font-semibold text-xs flex items-center gap-2 cursor-pointer transition-all shadow-sm"
              >
                Next: Connect LLM Engine <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* STEP 3: LOGIN WITH LLM PROVIDER */}
        {step === 3 && (
          <form onSubmit={handleCompleteSetup} className="flex-1 overflow-y-auto p-4 sm:p-6 md:p-8 space-y-5">
            {/* Summary Tag */}
            <div className="bg-stone-50 p-3 border border-stone-200 flex items-center justify-between text-xs">
              <span className="font-medium text-stone-600">
                Setup Target: <strong className="text-stone-900 font-bold">{finalTargetLang}</strong> (for {finalNativeLang} speakers)
              </span>
              <button
                type="button"
                onClick={() => setStep(2)}
                className="text-[11px] font-bold text-stone-800 hover:underline cursor-pointer"
              >
                Change Languages
              </button>
            </div>

            {/* Select Provider */}
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-stone-900 flex items-center gap-2">
                <Server className="w-3.5 h-3.5 text-stone-900" /> 1. Select LLM Provider
              </label>
              <div className="grid grid-cols-1 min-[420px]:grid-cols-2 md:grid-cols-3 gap-2 sm:gap-2.5">
                {PROVIDER_OPTIONS.map((p) => {
                  const isSelected = provider === p.id;
                  return (
                    <button
                      type="button"
                      key={p.id}
                      onClick={() => handleProviderSelect(p.id)}
                      className={`p-2.5 sm:p-3 border text-left transition-all cursor-pointer flex flex-col justify-between ${
                        isSelected 
                          ? "bg-stone-900 text-white border-stone-900 shadow-xs" 
                          : "bg-stone-50 text-stone-800 border-stone-200 hover:bg-stone-100 hover:border-stone-400"
                      }`}
                    >
                      <div>
                        <div className="font-bold text-xs tracking-tight">{p.name}</div>
                        <div className={`text-[10px] mt-0.5 font-serif italic line-clamp-1 ${isSelected ? "text-stone-300" : "text-stone-500"}`}>
                          {p.tagline}
                        </div>
                      </div>
                      {isSelected && (
                        <div className="mt-1.5 self-end">
                          <CheckCircle2 className="w-3.5 h-3.5 text-white" />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Model Selection */}
            <div className="space-y-1.5">
              <div className="flex justify-between items-center gap-2">
                <label className="text-xs font-semibold text-stone-900 flex items-center gap-2">
                  <Cpu className="w-3.5 h-3.5 text-stone-900" /> 2. Model Selection
                </label>
                <button
                  type="button"
                  onClick={() => setIsCustomModelMode(!isCustomModelMode)}
                  className="text-[11px] font-medium text-stone-600 hover:text-stone-950 underline underline-offset-2 shrink-0"
                >
                  {isCustomModelMode ? "Select Preset" : "Enter Custom Model String"}
                </button>
              </div>

              {isCustomModelMode ? (
                <input
                  type="text"
                  value={customModel}
                  onChange={(e) => setCustomModel(e.target.value)}
                  placeholder="e.g. gpt-4o-2024-08-06 or llama3:70b"
                  className="w-full bg-stone-50 border border-stone-300 p-2.5 text-xs text-stone-900 font-mono focus:outline-none focus:border-stone-900"
                />
              ) : (
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="w-full bg-stone-50 border border-stone-300 p-2.5 text-xs text-stone-900 font-medium focus:outline-none focus:border-stone-900 cursor-pointer"
                >
                  {currentProviderMeta.models.map((m) => (
                    <option key={m} value={m}>
                      {m} {m === currentProviderMeta.defaultModel ? "(Recommended Default)" : ""}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* API Key */}
            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <label className="text-xs font-semibold text-stone-900 flex items-center gap-2">
                  <Key className="w-3.5 h-3.5 text-stone-900" /> 3. API Key
                </label>
                <span className="text-[10px] text-stone-400 font-mono">
                  {currentProviderMeta.requiresKey ? "Required" : "Optional for local"}
                </span>
              </div>

              <div className="relative">
                <input
                  type={showApiKey ? "text" : "password"}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={
                    provider === "gemini" 
                      ? "AIzaSy..." 
                      : provider === "openai" 
                      ? "sk-proj-..." 
                      : provider === "anthropic" 
                      ? "sk-ant-..." 
                      : "Enter your API key..."
                  }
                  className="w-full bg-stone-50 border border-stone-300 p-2.5 pr-10 text-xs text-stone-900 font-mono focus:outline-none focus:border-stone-900"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-800"
                  title={showApiKey ? "Hide Key" : "Show Key"}
                >
                  {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Custom Base URL */}
            {(provider === "custom" || provider === "openrouter" || provider === "ollama" || baseUrl !== "") && (
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-stone-900 flex items-center gap-2">
                  <Globe className="w-3.5 h-3.5 text-stone-900" /> Endpoint Base URL
                </label>
                <input
                  type="text"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="e.g. http://localhost:11434/v1 or https://my-proxy.com/v1"
                  className="w-full bg-stone-50 border border-stone-300 p-2.5 text-xs text-stone-900 font-mono focus:outline-none focus:border-stone-900"
                />
              </div>
            )}

            {/* Connection Test Banner / Status */}
            {testingStatus !== "idle" && (
              <div className={`p-3 text-xs flex items-center gap-3 border ${
                testingStatus === "testing" 
                  ? "bg-stone-100 border-stone-300 text-stone-800"
                  : testingStatus === "success"
                  ? "bg-emerald-50 border-emerald-300 text-emerald-900"
                  : "bg-red-50 border-red-300 text-red-900"
              }`}>
                {testingStatus === "testing" && <Loader2 className="w-4 h-4 animate-spin text-stone-700 shrink-0" />}
                {testingStatus === "success" && <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0" />}
                {testingStatus === "error" && <AlertCircle className="w-4 h-4 text-red-700 shrink-0" />}
                <span className="font-medium leading-normal">{testMessage}</span>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex flex-col-reverse sm:flex-row justify-between items-stretch sm:items-center gap-2.5 pt-3 border-t border-stone-200 shrink-0">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="px-4 py-2 border border-stone-300 hover:border-stone-900 bg-stone-50 text-stone-800 font-semibold text-xs flex items-center gap-1 cursor-pointer transition-all"
                >
                  <ArrowLeft className="w-3.5 h-3.5" /> Back
                </button>

                <button
                  type="button"
                  onClick={handleTestConnection}
                  disabled={testingStatus === "testing"}
                  className="px-4 py-2 border border-stone-300 hover:border-stone-900 bg-stone-50 hover:bg-stone-100 text-stone-900 font-semibold text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                >
                  {testingStatus === "testing" ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> Testing...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3.5 h-3.5 text-amber-500" /> Test Connection
                    </>
                  )}
                </button>
              </div>

              <button
                type="submit"
                className="px-6 py-2.5 bg-stone-900 hover:bg-black text-white font-semibold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer shadow-xs hover:shadow-sm"
              >
                Complete Setup & Start <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </form>
        )}
      </motion.div>
    </div>
  );
}
