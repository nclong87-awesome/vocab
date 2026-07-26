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
  ShieldCheck,
  Server
} from "lucide-react";
import { LLMConfig, LLMProvider } from "../types";

interface LlmLoginModalProps {
  isOpen: boolean;
  currentConfig: LLMConfig;
  onSaveConfig: (config: LLMConfig) => void;
  onClose?: () => void;
  canDismiss?: boolean;
}

const PROVIDER_OPTIONS: {
  id: LLMProvider;
  name: string;
  tagline: string;
  defaultModel: string;
  models: string[];
  defaultBaseUrl?: string;
  requiresKey: boolean;
}[] = [
  {
    id: "gemini",
    name: "Google Gemini",
    tagline: "Fast & highly structured intelligence",
    defaultModel: "gemini-2.5-flash",
    models: ["gemini-2.5-flash", "gemini-1.5-flash", "gemini-2.0-flash", "gemini-1.5-pro"],
    requiresKey: true
  },
  {
    id: "openai",
    name: "OpenAI",
    tagline: "Industry standard GPT series models",
    defaultModel: "gpt-4o-mini",
    models: ["gpt-4o-mini", "gpt-4o", "gpt-3.5-turbo", "o3-mini"],
    defaultBaseUrl: "https://api.openai.com/v1",
    requiresKey: true
  },
  {
    id: "anthropic",
    name: "Anthropic Claude",
    tagline: "High precision linguistic reasoning",
    defaultModel: "claude-3-5-haiku-20241022",
    models: ["claude-3-5-haiku-20241022", "claude-3-5-sonnet-20241022"],
    defaultBaseUrl: "https://api.anthropic.com",
    requiresKey: true
  },
  {
    id: "groq",
    name: "Groq LPU",
    tagline: "Ultra fast open weights inference",
    defaultModel: "llama-3.3-70b-versatile",
    models: ["llama-3.3-70b-versatile", "mixtral-8x7b-32768", "gemma2-9b-it"],
    defaultBaseUrl: "https://api.groq.com/openai/v1",
    requiresKey: true
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    tagline: "Unified API gateway for all LLMs",
    defaultModel: "meta-llama/llama-3.3-70b-instruct",
    models: [
      "meta-llama/llama-3.3-70b-instruct", 
      "deepseek/deepseek-r1", 
      "google/gemini-2.5-flash", 
      "anthropic/claude-3.5-haiku"
    ],
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    requiresKey: true
  },
  {
    id: "custom",
    name: "Custom / Local Endpoint",
    tagline: "Ollama, vLLM, LMStudio, or private proxy",
    defaultModel: "llama3",
    models: ["llama3", "mistral", "qwen2.5", "custom"],
    defaultBaseUrl: "http://localhost:11434/v1",
    requiresKey: false
  }
];

export default function LlmLoginModal({
  isOpen,
  currentConfig,
  onSaveConfig,
  onClose,
  canDismiss = false
}: LlmLoginModalProps) {
  const [provider, setProvider] = useState<LLMProvider>(currentConfig.provider || "gemini");
  const [model, setModel] = useState<string>(currentConfig.model || "gemini-2.5-flash");
  const [customModel, setCustomModel] = useState<string>("");
  const [isCustomModelMode, setIsCustomModelMode] = useState<boolean>(false);
  const [apiKey, setApiKey] = useState<string>(currentConfig.apiKey || "");
  const [baseUrl, setBaseUrl] = useState<string>(currentConfig.baseUrl || "");
  const [showApiKey, setShowApiKey] = useState<boolean>(false);

  const [testingStatus, setTestingStatus] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [testMessage, setTestMessage] = useState<string>("");

  useEffect(() => {
    if (isOpen) {
      setProvider(currentConfig.provider || "gemini");
      setModel(currentConfig.model || "gemini-2.5-flash");
      setApiKey(currentConfig.apiKey || "");
      setBaseUrl(currentConfig.baseUrl || "");
      setTestingStatus("idle");
      setTestMessage("");
    }
  }, [isOpen, currentConfig]);

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

  const handleSubmit = (e: React.FormEvent) => {
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

    onSaveConfig({
      provider,
      model: activeModel,
      apiKey: apiKey.trim(),
      baseUrl: baseUrl.trim(),
      isLoggedIn: true
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-950/70 backdrop-blur-sm overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={{ duration: 0.2 }}
        className="bg-white border border-stone-200 shadow-2xl max-w-2xl w-full overflow-hidden my-8"
        id="llm-login-modal"
      >
        {/* Header Bar */}
        <div className="bg-stone-900 text-white p-4 sm:p-6 flex justify-between items-start border-b border-stone-800">
          <div>
            <div className="inline-flex items-center gap-2 text-[10px] font-bold tracking-widest uppercase bg-stone-800 text-stone-300 px-2.5 py-1 mb-2">
              <Lock className="w-3 h-3 text-stone-300" /> Authentication Required
            </div>
            <h2 className="text-xl sm:text-2xl font-semibold tracking-tight text-white">
              Log In with LLM Provider
            </h2>
            <p className="text-stone-400 text-xs mt-1 font-serif italic">
              Connect your preferred AI model engine to generate custom vocabulary lists, pronunciations, and translations.
            </p>
          </div>
          {canDismiss && onClose && (
            <button 
              onClick={onClose}
              className="p-1.5 text-stone-400 hover:text-white transition-colors"
              title="Close Settings"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Content Form */}
        <form onSubmit={handleSubmit} className="p-4 sm:p-6 md:p-8 space-y-4 sm:space-y-6">
          
          {/* Step 1: Select Provider */}
          <div className="space-y-3">
            <label className="block text-xs font-semibold text-stone-900 flex items-center gap-2">
              <Server className="w-3.5 h-3.5 text-stone-900" /> 1. Select LLM Provider
            </label>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5">
              {PROVIDER_OPTIONS.map((p) => {
                const isSelected = provider === p.id;
                return (
                  <button
                    type="button"
                    key={p.id}
                    onClick={() => handleProviderSelect(p.id)}
                    className={`p-3.5 border text-left transition-all cursor-pointer flex flex-col justify-between ${
                      isSelected 
                        ? "bg-stone-900 text-white border-stone-900 shadow-sm" 
                        : "bg-stone-50 text-stone-800 border-stone-200 hover:bg-stone-100 hover:border-stone-400"
                    }`}
                  >
                    <div>
                      <div className="font-bold text-xs tracking-tight">{p.name}</div>
                      <div className={`text-[10px] mt-1 font-serif italic line-clamp-1 ${isSelected ? "text-stone-300" : "text-stone-500"}`}>
                        {p.tagline}
                      </div>
                    </div>
                    {isSelected && (
                      <div className="mt-2 self-end">
                        <CheckCircle2 className="w-3.5 h-3.5 text-white" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Step 2: Select or Enter Model */}
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <label className="text-xs font-semibold text-stone-900 flex items-center gap-2">
                <Cpu className="w-3.5 h-3.5 text-stone-900" /> 2. Model Selection
              </label>
              <button
                type="button"
                onClick={() => setIsCustomModelMode(!isCustomModelMode)}
                className="text-xs font-medium text-stone-600 hover:text-stone-950 underline underline-offset-2"
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
                className="w-full bg-stone-50 border border-stone-300 p-3 text-xs text-stone-900 font-mono focus:outline-none focus:border-stone-900"
              />
            ) : (
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full bg-stone-50 border border-stone-300 p-3 text-xs text-stone-900 font-medium focus:outline-none focus:border-stone-900 cursor-pointer"
              >
                {currentProviderMeta.models.map((m) => (
                  <option key={m} value={m}>
                    {m} {m === currentProviderMeta.defaultModel ? "(Recommended Default)" : ""}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Step 3: API Key */}
          <div className="space-y-2">
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
                className="w-full bg-stone-50 border border-stone-300 p-3 pr-10 text-xs text-stone-900 font-mono focus:outline-none focus:border-stone-900"
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
            <p className="text-[10px] text-stone-500 italic">
              Your API key is saved locally in your browser storage and never transmitted to external unauthorized servers.
            </p>
          </div>

          {/* Step 4: Custom Base URL (if custom or desired) */}
          {(provider === "custom" || provider === "openrouter" || baseUrl !== "") && (
            <div className="space-y-2 pt-1">
              <label className="text-xs font-semibold text-stone-900 flex items-center gap-2">
                <Globe className="w-3.5 h-3.5 text-stone-900" /> Endpoint Base URL
              </label>
              <input
                type="text"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="e.g. http://localhost:11434/v1 or https://my-proxy.com/v1"
                className="w-full bg-stone-50 border border-stone-300 p-3 text-xs text-stone-900 font-mono focus:outline-none focus:border-stone-900"
              />
            </div>
          )}

          {/* Connection Test Banner / Status */}
          {testingStatus !== "idle" && (
            <div className={`p-3.5 text-xs flex items-center gap-3 border ${
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
          <div className="flex flex-col sm:flex-row justify-between items-center gap-3 pt-4 border-t border-stone-200">
            <button
              type="button"
              onClick={handleTestConnection}
              disabled={testingStatus === "testing"}
              className="w-full sm:w-auto px-5 py-3 border border-stone-300 hover:border-stone-900 bg-stone-50 hover:bg-stone-100 text-stone-900 font-semibold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer"
            >
              {testingStatus === "testing" ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Testing...
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5" /> Test Connection
                </>
              )}
            </button>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              {canDismiss && onClose && (
                <button
                  type="button"
                  onClick={onClose}
                  className="w-full sm:w-auto px-5 py-3 border border-stone-200 text-stone-600 hover:text-stone-900 font-medium text-xs transition-colors cursor-pointer text-center"
                >
                  Cancel
                </button>
              )}
              <button
                type="submit"
                className="w-full sm:w-auto px-8 py-3 bg-stone-900 hover:bg-black text-white font-semibold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer shadow-sm hover:shadow"
              >
                Log In & Save <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>

        </form>
      </motion.div>
    </div>
  );
}
