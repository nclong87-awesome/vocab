import { LLMConfig, LLMProvider, LLMProviderOption } from "../types";

/**
 * Default AI Provider ID.
 * To change the default provider across the app, simply update DEFAULT_PROVIDER_ID here!
 */
export const DEFAULT_PROVIDER_ID: LLMProvider = "auto";

/**
 * Configuration file for LLM Providers.
 * Easily modify, add, or remove providers here.
 */
export const PROVIDER_OPTIONS: LLMProviderOption[] = [
  {
    id: "auto",
    name: "Auto Mode (Default)",
    tagline: "Rotates models automatically & switches on error",
    defaultModel: "auto",
    models: ["auto"],
    requiresKey: false
  },
  {
    id: "groq",
    name: "Groq",
    tagline: "Ultra-fast Llama 3 & DeepSeek inference",
    defaultModel: "openai/gpt-oss-120b",
    models: [
      "openai/gpt-oss-120b", 
      "openai/gpt-oss-20b", 
      "openai/gpt-oss-safeguard-20b",
    ],
    visionModels: ["qwen/qwen3.6-27b"],
    defaultBaseUrl: "https://groq.nclong87.workers.dev/openai/v1",
    directBaseUrl: "https://api.groq.com/openai/v1",
    requiresKey: false
  },
  // {
  //   id: "openrouter",
  //   name: "OpenRouter",
  //   tagline: "Unified API gateway for 100+ AI models",
  //   defaultModel: "poolside/laguna-xs-2.1:free",
  //   models: [
  //     "poolside/laguna-xs-2.1:free",
  //     "nvidia/nemotron-3-super-120b-a12b:free",
  //     "nvidia/nemotron-3-nano-30b-a3b:free",
  //     "google/gemma-4-26b-a4b-it:free",
  //     "openai/gpt-oss-20b:free"
  //   ],
  //   defaultBaseUrl: "https://openrouter.nclong87.workers.dev/api/v1",
  //   directBaseUrl: "https://openrouter.ai/api/v1",
  //   requiresKey: false
  // },
  {
    id: "gemini",
    name: "Google Gemini",
    tagline: "Fast & highly structured intelligence",
    defaultModel: "gemini-3.6-flash",
    models: [
      "gemini-3.5-flash-lite", 
      "gemini-3.5-flash", 
      "gemini-3.6-flash"
    ],
    tts_models: ["gemini-3.6-flash", "gemini-3.5-flash"],
    defaultBaseUrl: "https://gemini.nclong87.workers.dev/v1beta",
    directBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    requiresKey: false
  },
  {
    id: "ollama",
    name: "Ollama",
    tagline: "Ollama Cloud API (https://ollama.com/v1)",
    defaultModel: "gemma4:31b",
    models: [
      "gemma4:31b",
      "gpt-oss:20b",
      "nemotron-3-nano:30b-cloud"
    ],
    defaultBaseUrl: "https://ollama.nclong87.workers.dev/v1",
    directBaseUrl: "https://ollama.com/v1",
    requiresKey: false
  },
  {
    id: "9flare",
    name: "9Flare",
    tagline: "High performance API gateway",
    defaultModel: "pro/claude-haiku-4-5",
    models: [
      // "pro/minimax-m2.5", 
      "pro/claude-haiku-4-5", 
      "pro/gpt-5.6-luna",
      // "pro/gpt-5-mini",
      // "pro/glm-5"
    ],
    visionModels: ["pro/gpt-5.6-luna"],
    defaultBaseUrl: "https://9flare.nclong87.workers.dev/api/v1",
    directBaseUrl: "https://9flare.com/api/v1",
    requiresKey: false
  },
  {
    id: "cloudflare",
    name: "Cloudflare Workers AI",
    tagline: "Serverless inference at the edge",
    defaultModel: "@cf/aisingapore/gemma-sea-lion-v4-27b-it",
    models: [
      "@cf/aisingapore/gemma-sea-lion-v4-27b-it",
      // "@cf/ibm-granite/granite-4.0-h-micro"
    ],
    defaultBaseUrl: "https://cloudflare.nclong87.workers.dev",
    directBaseUrl: "https://api.cloudflare.com/client/v4/accounts/12345678/ai/run",
    requiresKey: false
  },
  // {
  //   id: "openai",
  //   name: "OpenAI",
  //   tagline: "GPT series models",
  //   defaultModel: "gpt-5.6-luna",
  //   models: ["gpt-5.6-luna"],
  //   visionModels: ["gpt-5.6-luna"],
  //   defaultBaseUrl: "https://openai.nclong87.workers.dev/v1",
  //   directBaseUrl: "https://api.openai.com/v1",
  //   requiresKey: false
  // },
  {
    id: "custom",
    name: "Custom / Local Endpoint",
    tagline: "vLLM, LMStudio, or private proxy",
    defaultModel: "custom",
    models: ["custom"],
    defaultBaseUrl: "http://localhost:11434/v1",
    directBaseUrl: "http://localhost:11434/v1",
    requiresKey: false
  }
];

/**
 * Gets the default LLMConfig based on DEFAULT_PROVIDER_ID.
 */
export function getDefaultLLMConfig(): LLMConfig {
  const defaultMeta = PROVIDER_OPTIONS.find(p => p.id === DEFAULT_PROVIDER_ID) || PROVIDER_OPTIONS[0];
  return {
    provider: defaultMeta.id,
    model: defaultMeta.defaultModel,
    apiKey: "",
    baseUrl: defaultMeta.defaultBaseUrl || "",
    isLoggedIn: true
  };
}

export const RELIABLE_MODELS: string[] = [
  "openai/gpt-oss-120b", 
  "openai/gpt-oss-20b", 
  "llama-3.3-70b-versatile",
  "nvidia/nemotron-3-super-120b-a12b:free",
  "gemini-3.5-flash-lite", 
  "gemini-3.5-flash", 
  "gemini-3.6-flash",
  "gemma4:31b",
  "pro/claude-haiku-4-5",
  "pro/gpt-5.6-luna",
  "@cf/aisingapore/gemma-sea-lion-v4-27b-it"
];

export const getRotatedVisionModel = () : { provider: LLMProvider; model: string } | null => {
  const visionModels = PROVIDER_OPTIONS.flatMap(p => (p.visionModels || []).map(m => ({ provider: p.id, model: m })));
  if (visionModels.length === 0) return null;

  const lastUsedModel = localStorage.getItem("last_used_vision_model");
  let nextIndex = 0;
  if (lastUsedModel) {
    const lastIndex = visionModels.findIndex(m => `${m.provider}/${m.model}` === lastUsedModel);
    nextIndex = (lastIndex + 1) % visionModels.length;
  }
  const nextModel = visionModels[nextIndex];
  localStorage.setItem("last_used_vision_model", `${nextModel.provider}/${nextModel.model}`);
  return nextModel;
}

export default PROVIDER_OPTIONS;
