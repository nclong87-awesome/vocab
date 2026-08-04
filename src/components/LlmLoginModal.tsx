import React, { useState, useEffect } from "react";
import { motion } from "motion/react";
import { 
  Key, 
  Cpu, 
  CheckCircle2, 
  AlertCircle, 
  Loader2, 
  Eye, 
  EyeOff, 
  Globe, 
  
  X,
  Sparkles,
  ArrowRight,
  ArrowLeft,
  ShieldCheck,
  Server,
  Globe2,
  BookOpen,
  Check,
  Zap,
  BookmarkCheck
} from "lucide-react";
import { LLMConfig, LLMProvider, SavedProviderConfig, SavedProvidersMap } from "../types";
import { PROVIDER_OPTIONS, DEFAULT_PROVIDER_ID } from "../config/llmProviders";
import { getSavedProvidersMap } from "../utils/llmHelpers";
import { testLlmConnection } from "../services/llmClientService";

import { SUPPORTED_LANGUAGES, LanguageOption } from "../config/languages";

export const ONBOARDING_LANGUAGES: LanguageOption[] = SUPPORTED_LANGUAGES;

interface LlmLoginModalProps {
  isOpen: boolean;
  currentConfig: LLMConfig;
  initialNativeLanguage?: string;
  initialTargetLanguage?: string;
  onSaveConfig: (config: LLMConfig) => void;
  onSaveOnboarding?: (userData: { email: string; nativeLanguage: string; targetLanguage: string }, config: LLMConfig) => void;
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

  // Email state
  const [email, setEmail] = useState<string>(
    localStorage.getItem("vocab_learner_user_email") || ""
  );

  // Language state
  const [nativeLanguage, setNativeLanguage] = useState<string>(
    initialNativeLanguage || localStorage.getItem("vocab_learner_native_lang") || "Vietnamese"
  );
  const [targetLanguage, setTargetLanguage] = useState<string>(
    initialTargetLanguage || localStorage.getItem("vocab_learner_target_lang") || "Spanish"
  );
  const [customNative, setCustomNative] = useState<string>("");
  const [customTarget, setCustomTarget] = useState<string>("");

  // Saved Providers Profiles Map
  const [savedProfiles, setSavedProfiles] = useState<SavedProvidersMap>({});

  // LLM Config state
  const [provider, setProvider] = useState<LLMProvider>(currentConfig.provider || DEFAULT_PROVIDER_ID);
  const [model, setModel] = useState<string>(currentConfig.model || "openai/gpt-oss-120b");
  const [customModel, setCustomModel] = useState<string>("");
  const [isCustomModelMode, setIsCustomModelMode] = useState<boolean>(false);
  const [useProxy, setUseProxy] = useState<boolean>(currentConfig.useProxy !== undefined ? currentConfig.useProxy : true);
  const [apiKey, setApiKey] = useState<string>(currentConfig.apiKey || "");
  const [proxyKey, setProxyKey] = useState<string>(currentConfig.proxyKey || "");
  const [baseUrl, setBaseUrl] = useState<string>(currentConfig.baseUrl || "");
  const [showApiKey, setShowApiKey] = useState<boolean>(false);

  const [testingStatus, setTestingStatus] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [testMessage, setTestMessage] = useState<string>("");

  useEffect(() => {
    if (isOpen) {
      setStep(canDismiss ? 2 : 1);

      const profiles = getSavedProvidersMap(currentConfig);
      setSavedProfiles(profiles);

      const sharedProxy = currentConfig.proxyKey || Object.values(profiles).find(p => Boolean(p?.proxyKey))?.proxyKey || "";

      const activeP = currentConfig.provider || DEFAULT_PROVIDER_ID;
      setProvider(activeP);

      const activeSaved = profiles[activeP];
      const initialUseProxy = activeSaved?.useProxy !== undefined 
        ? activeSaved.useProxy 
        : (currentConfig.useProxy !== undefined ? currentConfig.useProxy : true);
      setUseProxy(initialUseProxy);

      if (activeSaved) {
        setModel(activeSaved.model || currentConfig.model || "openai/gpt-oss-120b");
        setApiKey(activeSaved.apiKey || currentConfig.apiKey || "");
        setProxyKey(activeSaved.proxyKey || sharedProxy || currentConfig.proxyKey || "");
        setBaseUrl(activeSaved.baseUrl || currentConfig.baseUrl || "");
      } else {
        setModel(currentConfig.model || "openai/gpt-oss-120b");
        setApiKey(currentConfig.apiKey || "");
        setProxyKey(sharedProxy || currentConfig.proxyKey || "");
        setBaseUrl(currentConfig.baseUrl || "");
      }

      setTestingStatus("idle");
      setTestMessage("");
      
      const storedNative = initialNativeLanguage || localStorage.getItem("vocab_learner_native_lang") || "Vietnamese";
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
    setTestingStatus("idle");
    setTestMessage("");

    // Auto-fill from saved profile if available, preserving single shared proxyKey
    const saved = savedProfiles[pId];
    const sharedProxy = proxyKey || currentConfig.proxyKey || Object.values(savedProfiles).find(p => Boolean(p?.proxyKey))?.proxyKey || "";

    const savedUseProxy = saved?.useProxy !== undefined ? saved.useProxy : useProxy;
    setUseProxy(savedUseProxy);

    if (saved) {
      setApiKey(saved.apiKey || "");
      setProxyKey(saved.proxyKey || sharedProxy);
      
      const defaultDirectUrl = meta?.directBaseUrl || meta?.defaultBaseUrl || "";
      const isWorkerUrl = saved.baseUrl && saved.baseUrl.includes("workers.dev");
      
      if (!savedUseProxy) {
        setBaseUrl(saved.baseUrl && !isWorkerUrl ? saved.baseUrl : defaultDirectUrl);
      } else {
        setBaseUrl(saved.baseUrl !== undefined ? saved.baseUrl : (meta?.defaultBaseUrl || ""));
      }
      
      if (meta && meta.models.includes(saved.model)) {
        setModel(saved.model);
        setIsCustomModelMode(false);
      } else {
        setModel(saved.model || meta?.defaultModel || "");
        setCustomModel(saved.model || "");
        setIsCustomModelMode(meta ? !meta.models.includes(saved.model) : false);
      }
    } else if (meta) {
      setModel(meta.defaultModel);
      setApiKey("");
      setProxyKey(sharedProxy);
      setBaseUrl(savedUseProxy ? (meta.defaultBaseUrl || "") : (meta.directBaseUrl || meta.defaultBaseUrl || ""));
      setIsCustomModelMode(false);
    }
  };

  const handleTestConnection = async () => {
    const activeModel = isCustomModelMode ? customModel.trim() : model;
    if (!activeModel) {
      setTestingStatus("error");
      setTestMessage("Please select or enter a valid model name.");
      return;
    }

    if (!useProxy && currentProviderMeta.requiresKey && !apiKey.trim()) {
      setTestingStatus("error");
      setTestMessage(`An API Key is required for ${currentProviderMeta.name}.`);
      return;
    }

    setTestingStatus("testing");
    setTestMessage("Verifying LLM provider connection...");

    const sharedProxy = proxyKey.trim() || currentConfig.proxyKey || Object.values(savedProfiles).find(p => Boolean(p?.proxyKey))?.proxyKey || "";
    const effectiveBaseUrl = useProxy 
      ? (currentProviderMeta.defaultBaseUrl || baseUrl.trim() || "")
      : baseUrl.trim();

    try {
      const data = await testLlmConnection({
        provider,
        model: activeModel,
        apiKey: useProxy ? "" : apiKey.trim(),
        proxyKey: proxyKey.trim() || sharedProxy,
        baseUrl: effectiveBaseUrl,
        useProxy,
        isLoggedIn: true,
        savedProviders: savedProfiles
      });

      if (data.success) {
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

  const finalNativeLang = nativeLanguage === "Custom" ? customNative.trim() || "Vietnamese" : nativeLanguage;
  const finalTargetLang = targetLanguage === "Custom" ? customTarget.trim() || "Spanish" : targetLanguage;

  const handleCompleteSetup = (e: React.FormEvent) => {
    e.preventDefault();
    const activeModel = isCustomModelMode ? customModel.trim() : model;

    if (!activeModel) {
      setTestingStatus("error");
      setTestMessage("Please select or enter a model.");
      return;
    }

    if (!useProxy && currentProviderMeta.requiresKey && !apiKey.trim()) {
      setTestingStatus("error");
      setTestMessage(`API key is required to log in with ${currentProviderMeta.name}.`);
      return;
    }

    const effectiveProxyKey = proxyKey.trim();
    const effectiveApiKey = useProxy ? "" : apiKey.trim();
    const effectiveBaseUrl = useProxy 
      ? (currentProviderMeta.defaultBaseUrl || baseUrl.trim() || "")
      : baseUrl.trim();

    // Propagate single shared proxyKey and useProxy to ALL stored provider profiles
    const updatedSavedProfiles: SavedProvidersMap = { ...savedProfiles };
    for (const k of Object.keys(updatedSavedProfiles)) {
      if (updatedSavedProfiles[k]) {
        updatedSavedProfiles[k] = {
          ...updatedSavedProfiles[k],
          proxyKey: effectiveProxyKey,
          useProxy
        };
      }
    }

    updatedSavedProfiles[provider] = {
      provider,
      model: activeModel,
      apiKey: effectiveApiKey,
      proxyKey: effectiveProxyKey,
      baseUrl: effectiveBaseUrl,
      useProxy,
      isLoggedIn: true,
      lastUsedAt: new Date().toISOString()
    };

    const newConfig: LLMConfig = {
      provider,
      model: activeModel,
      apiKey: effectiveApiKey,
      proxyKey: effectiveProxyKey,
      baseUrl: effectiveBaseUrl,
      useProxy,
      isLoggedIn: true,
      savedProviders: updatedSavedProfiles
    };

    if (onSaveOnboarding) {
      onSaveOnboarding(
        { email: email.trim(), nativeLanguage: finalNativeLang, targetLanguage: finalTargetLang },
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
              {step === 1 && "Profile & Language Setup"}
              {step === 2 && "Connect Your AI Model Engine"}
            </h2>
            <p className="text-stone-400 text-xs mt-0.5 font-serif italic leading-relaxed">
              {step === 1 && "Provide your email and select your languages to personalize your learning experience."}
              {step === 2 && "Connect your LLM provider to power instant AI vocabulary generation and interactive quizzes."}
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
            <span>Profile & Languages</span>
          </button>

          <span className="text-stone-300 font-bold">➔</span>

          <button
            type="button"
            onClick={() => {
              if (email.trim() && finalNativeLang && finalTargetLang) {
                setStep(2);
              }
            }}
            disabled={!email.trim() || !finalNativeLang || !finalTargetLang}
            className={`flex items-center gap-1.5 font-semibold text-xs px-2.5 py-1 transition-all cursor-pointer ${
              step === 2
                ? "bg-stone-900 text-white shadow-xs"
                : (!email.trim() || !finalNativeLang || !finalTargetLang)
                ? "text-stone-400 cursor-not-allowed opacity-60"
                : "text-stone-600 hover:text-stone-900 hover:bg-stone-200/60"
            }`}
          >
            <span className="w-4 h-4 rounded-full bg-stone-700 text-white flex items-center justify-center text-[10px] font-mono">2</span>
            <span>LLM Login</span>
          </button>
        </div>

        {/* STEP 1: PROFILE AND LANGUAGES */}
        {step === 1 && (
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 md:p-8 space-y-6">
            
            {/* Email Field */}
            <div className="space-y-3">
              <label className="text-xs font-semibold text-stone-900 flex items-center gap-2">
                Email Address <span className="text-red-500">*</span>
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full bg-stone-50 border border-stone-300 p-3 text-xs text-stone-900 font-medium focus:outline-none focus:border-stone-900"
              />
            </div>

            {/* Native Language */}
            <div className="space-y-3">
              <label className="text-xs font-semibold text-stone-900 flex items-center gap-2">
                <Globe2 className="w-4 h-4 text-stone-900" /> Primary / Native Language
              </label>

              <div className="grid grid-cols-2 min-[480px]:grid-cols-3 sm:grid-cols-4 gap-2.5">
                {ONBOARDING_LANGUAGES.map((lang) => {
                  const isSelected = nativeLanguage === lang.code;
                  return (
                    <button
                      key={`native-lang-${lang.code}`}
                      type="button"
                      onClick={() => setNativeLanguage(lang.code)}
                      className={`p-2 border text-left transition-all cursor-pointer flex items-center justify-between ${
                        isSelected 
                          ? "bg-stone-900 text-white border-stone-900 shadow-sm"
                          : "bg-stone-50 hover:bg-stone-100 text-stone-800 border-stone-200"
                      }`}
                    >
                      <div className="flex items-center gap-2 overflow-hidden">
                        <span className="text-lg shrink-0">{lang.flag}</span>
                        <div className="truncate">
                          <div className="font-bold text-[11px]">{lang.name}</div>
                        </div>
                      </div>
                      {isSelected && <Check className="w-3.5 h-3.5 text-white shrink-0 ml-1" />}
                    </button>
                  );
                })}

                {/* Custom language option */}
                <button
                  type="button"
                  onClick={() => setNativeLanguage("Custom")}
                  className={`p-2 border text-left transition-all cursor-pointer flex items-center justify-between ${
                    nativeLanguage === "Custom"
                      ? "bg-stone-900 text-white border-stone-900"
                      : "bg-stone-50 hover:bg-stone-100 text-stone-800 border-stone-200"
                  }`}
                >
                  <div className="font-bold text-[11px]">Other</div>
                  {nativeLanguage === "Custom" && <Check className="w-3.5 h-3.5 text-white shrink-0" />}
                </button>
              </div>

              {nativeLanguage === "Custom" && (
                <div className="pt-2">
                  <input
                    type="text"
                    value={customNative}
                    onChange={(e) => setCustomNative(e.target.value)}
                    placeholder="Enter your language name (e.g., Polish)"
                    className="w-full bg-stone-50 border border-stone-300 p-2.5 text-xs text-stone-900 font-medium focus:outline-none focus:border-stone-900"
                  />
                </div>
              )}
            </div>

            {/* Target Language */}
            <div className="space-y-3">
              <label className="text-xs font-semibold text-stone-900 flex items-center gap-2">
                <Globe className="w-4 h-4 text-stone-900" /> Language You Want to Learn
              </label>

              <div className="grid grid-cols-2 min-[480px]:grid-cols-3 sm:grid-cols-4 gap-2.5">
                {ONBOARDING_LANGUAGES.map((lang) => {
                  const isSelected = targetLanguage === lang.code;
                  return (
                    <button
                      key={`target-lang-${lang.code}`}
                      type="button"
                      onClick={() => setTargetLanguage(lang.code)}
                      className={`p-2 border text-left transition-all cursor-pointer flex items-center justify-between ${
                        isSelected 
                          ? "bg-stone-900 text-white border-stone-900 shadow-sm"
                          : "bg-stone-50 hover:bg-stone-100 text-stone-800 border-stone-200"
                      }`}
                    >
                      <div className="flex items-center gap-2 overflow-hidden">
                        <span className="text-lg shrink-0">{lang.flag}</span>
                        <div className="truncate">
                          <div className="font-bold text-[11px]">{lang.name}</div>
                        </div>
                      </div>
                      {isSelected && <Check className="w-3.5 h-3.5 text-white shrink-0 ml-1" />}
                    </button>
                  );
                })}

                {/* Custom target language option */}
                <button
                  type="button"
                  onClick={() => setTargetLanguage("Custom")}
                  className={`p-2 border text-left transition-all cursor-pointer flex items-center justify-between ${
                    targetLanguage === "Custom"
                      ? "bg-stone-900 text-white border-stone-900"
                      : "bg-stone-50 hover:bg-stone-100 text-stone-800 border-stone-200"
                  }`}
                >
                  <div className="font-bold text-[11px]">Other</div>
                  {targetLanguage === "Custom" && <Check className="w-3.5 h-3.5 text-white shrink-0" />}
                </button>
              </div>

              {targetLanguage === "Custom" && (
                <div className="pt-2">
                  <input
                    type="text"
                    value={customTarget}
                    onChange={(e) => setCustomTarget(e.target.value)}
                    placeholder="Enter target language name (e.g., Finnish)"
                    className="w-full bg-stone-50 border border-stone-300 p-2.5 text-xs text-stone-900 font-medium focus:outline-none focus:border-stone-900"
                  />
                </div>
              )}
            </div>

            <div className="pt-4 border-t border-stone-200 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  if (email.trim() && finalNativeLang && finalTargetLang) {
                    setStep(2);
                  } else {
                    alert("Please enter your email and select both languages.");
                  }
                }}
                disabled={!email.trim() || !finalNativeLang || !finalTargetLang}
                className={`px-6 py-2.5 font-semibold text-xs flex items-center gap-2 transition-all shadow-sm ${
                  !email.trim() || !finalNativeLang || !finalTargetLang
                    ? "bg-stone-300 text-stone-500 cursor-not-allowed"
                    : "bg-stone-900 hover:bg-black text-white cursor-pointer"
                }`}
              >
                Next: Connect LLM Engine <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* STEP 2: LOGIN WITH LLM PROVIDER */}
        {step === 2 && (
          <form onSubmit={handleCompleteSetup} className="flex-1 overflow-y-auto p-4 sm:p-6 md:p-8 space-y-5">
            {/* Summary Tag */}
            <div className="bg-stone-50 p-3 border border-stone-200 flex items-center justify-between text-xs">
              <span className="font-medium text-stone-600">
                Setup Target: <strong className="text-stone-900 font-bold">{finalTargetLang}</strong> (for {finalNativeLang} speakers)
              </span>
              <button
                type="button"
                onClick={() => setStep(1)}
                className="text-[11px] font-bold text-stone-800 hover:underline cursor-pointer"
              >
                Change Languages
              </button>
            </div>

            {/* Quick Switch Saved Engine Profiles Bar */}
            {Object.keys(savedProfiles).length > 0 && (
              <div className="bg-amber-50/60 border border-amber-200/80 p-3 space-y-1.5">
                <div className="flex items-center gap-1.5 text-[11px] font-bold text-amber-900 uppercase tracking-wider">
                  <BookmarkCheck className="w-3.5 h-3.5 text-amber-700" />
                  <span>Stored AI Engine Profiles</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(Object.values(savedProfiles) as SavedProviderConfig[]).map((sp, idx) => {
                    const isCurrent = provider === sp.provider;
                    const meta = PROVIDER_OPTIONS.find(p => p.id === sp.provider);
                    return (
                      <button
                        key={`saved-profile-${sp.provider}-${idx}`}
                        type="button"
                        onClick={() => handleProviderSelect(sp.provider)}
                        className={`px-2.5 py-1 text-xs font-semibold flex items-center gap-1.5 border transition-all cursor-pointer ${
                          isCurrent 
                            ? "bg-amber-900 text-white border-amber-950 shadow-xs" 
                            : "bg-white hover:bg-amber-100/70 text-amber-950 border-amber-300"
                        }`}
                      >
                        <Zap className="w-3 h-3 text-amber-400 fill-current" />
                        <span>{meta?.name || sp.provider}</span>
                        <span className="opacity-75 font-mono text-[10px]">({sp.model})</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Select Provider */}
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-stone-900 flex items-center gap-2">
                <Server className="w-3.5 h-3.5 text-stone-900" /> 1. Select LLM Provider
              </label>
              <div className="grid grid-cols-1 min-[420px]:grid-cols-2 md:grid-cols-3 gap-2 sm:gap-2.5">
                {PROVIDER_OPTIONS.map((p, idx) => {
                  const isSelected = provider === p.id;
                  const saved = savedProfiles[p.id];
                  const isSaved = Boolean(saved && (saved.apiKey || !p.requiresKey));
                  return (
                    <button
                      type="button"
                      key={`provider-option-${p.id}-${idx}`}
                      onClick={() => handleProviderSelect(p.id)}
                      className={`p-2.5 sm:p-3 border text-left transition-all cursor-pointer flex flex-col justify-between relative ${
                        isSelected 
                          ? "bg-stone-900 text-white border-stone-900 shadow-xs" 
                          : "bg-stone-50 text-stone-800 border-stone-200 hover:bg-stone-100 hover:border-stone-400"
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between gap-1">
                          <span className="font-bold text-xs tracking-tight">{p.name}</span>
                          {isSaved && !isSelected && (
                            <span className="text-[9px] font-bold bg-amber-100 text-amber-900 px-1.5 py-0.5 border border-amber-300">
                              Saved
                            </span>
                          )}
                        </div>
                        <div className={`text-[10px] mt-0.5 font-serif italic line-clamp-1 ${isSelected ? "text-stone-300" : "text-stone-500"}`}>
                          {p.tagline}
                        </div>
                      </div>

                      <div className="mt-2 flex items-center justify-between">
                        <span className={`text-[10px] font-mono ${isSelected ? "text-stone-300" : "text-stone-500"}`}>
                          {saved ? saved.model : p.defaultModel}
                        </span>
                        {isSelected && (
                          <CheckCircle2 className="w-3.5 h-3.5 text-white shrink-0 ml-1" />
                        )}
                      </div>
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
                  {currentProviderMeta.models.map((m, idx) => (
                    <option key={`model-${m}-${idx}`} value={m}>
                      {m} {m === currentProviderMeta.defaultModel ? "(Recommended Default)" : ""}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* 3. Connection Method Toggle (Use Proxy vs Direct API Key) */}
            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <label className="text-xs font-semibold text-stone-900 flex items-center gap-2">
                  <ShieldCheck className="w-3.5 h-3.5 text-stone-900" /> 3. Connection Method
                </label>
                <span className="text-[10px] text-stone-500 font-mono">
                  {useProxy ? "Proxy Gateway (Default)" : "Direct Provider API Key"}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 bg-stone-100 p-1 border border-stone-200">
                <button
                  type="button"
                  onClick={() => {
                    setUseProxy(true);
                    if (currentProviderMeta?.defaultBaseUrl) {
                      setBaseUrl(currentProviderMeta.defaultBaseUrl);
                    }
                  }}
                  className={`py-2 px-3 text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                    useProxy
                      ? "bg-stone-900 text-white shadow-xs"
                      : "text-stone-600 hover:text-stone-900 hover:bg-stone-200/60"
                  }`}
                >
                  <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />
                  <span>Use Proxy (Default)</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setUseProxy(false);
                    const defaultDirectUrl = currentProviderMeta.directBaseUrl || currentProviderMeta.defaultBaseUrl || "";
                    if (!baseUrl || baseUrl.includes("workers.dev") || baseUrl === currentProviderMeta.defaultBaseUrl) {
                      setBaseUrl(defaultDirectUrl);
                    }
                  }}
                  className={`py-2 px-3 text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                    !useProxy
                      ? "bg-stone-900 text-white shadow-xs"
                      : "text-stone-600 hover:text-stone-900 hover:bg-stone-200/60"
                  }`}
                >
                  <Key className="w-3.5 h-3.5 text-amber-400" />
                  <span>Direct API Key</span>
                </button>
              </div>
            </div>

            {/* Conditional Input: Proxy Secret (if Proxy is ON) OR API Key (if Proxy is OFF) */}
            {useProxy ? (
              /* Proxy Secret (X-Proxy-Key) */
              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <label className="text-xs font-semibold text-stone-900 flex items-center gap-2">
                    <ShieldCheck className="w-3.5 h-3.5 text-stone-900" /> Proxy Secret (X-Proxy-Key)
                  </label>
                  <span className="text-[10px] text-stone-400 font-mono">
                    Optional (Sent in X-Proxy-Key header)
                  </span>
                </div>
                <input
                  type="password"
                  value={proxyKey}
                  onChange={(e) => setProxyKey(e.target.value)}
                  placeholder="Enter proxy secret for Cloudflare worker..."
                  className="w-full bg-stone-50 border border-stone-300 p-2.5 text-xs text-stone-900 font-mono focus:outline-none focus:border-stone-900"
                />
              </div>
            ) : (
              /* API Key */
              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <label className="text-xs font-semibold text-stone-900 flex items-center gap-2">
                    <Key className="w-3.5 h-3.5 text-stone-900" /> API Key
                  </label>
                  <span className="text-[10px] text-stone-400 font-mono">
                    {currentProviderMeta.id === "ollama" ? "Optional (default key)" : currentProviderMeta.requiresKey ? "Required" : "Optional for local"}
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
                        : provider === "groq"
                        ? "gsk_..."
                        : provider === "openrouter"
                        ? "sk-or-v1-..."
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
            )}

            {/* Endpoint Base URL (Only shown when Direct API mode is active) */}
            {!useProxy && (
              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <label className="text-xs font-semibold text-stone-900 flex items-center gap-2">
                    <Globe className="w-3.5 h-3.5 text-stone-900" /> Endpoint Base URL
                  </label>
                  <span className="text-[10px] text-stone-500 font-mono">
                    OpenAI-compatible API Base URL
                  </span>
                </div>
                <input
                  type="text"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder={currentProviderMeta.directBaseUrl || currentProviderMeta.defaultBaseUrl || "https://api.openai.com/v1"}
                  className="w-full bg-stone-50 text-stone-900 border border-stone-300 p-2.5 text-xs font-mono focus:outline-none focus:border-stone-900 transition-all"
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
                  onClick={() => setStep(1)}
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
