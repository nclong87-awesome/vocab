import { LLMProviderOption } from "../types";

/**
 * Configuration file for LLM Providers.
 * Easily modify, add, or remove providers here.
 */
export const PROVIDER_OPTIONS: LLMProviderOption[] = [
  {
    id: "openai",
    name: "OpenAI",
    tagline: "GPT series models",
    defaultModel: "gpt-5.4-mini",
    models: ["gpt-4o-mini", "gpt-4.1-mini", "gpt-5.4-mini"],
    defaultBaseUrl: "https://openai.nclong87.workers.dev/v1",
    directBaseUrl: "https://api.openai.com/v1",
    requiresKey: false
  },
  {
    id: "groq",
    name: "Groq",
    tagline: "Ultra-fast Llama 3 & DeepSeek inference",
    defaultModel: "openai/gpt-oss-20b",
    models: [
      "openai/gpt-oss-120b", 
      "openai/gpt-oss-20b", 
      "groq/compound"
    ],
    defaultBaseUrl: "https://groq.nclong87.workers.dev/openai/v1",
    directBaseUrl: "https://api.groq.com/openai/v1",
    requiresKey: false
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    tagline: "Unified API gateway for 100+ AI models",
    defaultModel: "openai/gpt-oss-20b",
    models: [
      "openrouter/free", 
      "google/gemma-4-26b-a4b-it", 
      "google/gemma-4-31b-it", 
      "openai/gpt-oss-20b"
    ],
    defaultBaseUrl: "https://openrouter.nclong87.workers.dev/api/v1",
    directBaseUrl: "https://openrouter.ai/api/v1",
    requiresKey: false
  },
  {
    id: "chatjimmy",
    name: "ChatJimmy AI",
    tagline: "ChatJimmy Free API (https://chatjimmy.ai)",
    defaultModel: "llama3.1-8B",
    models: ["llama3.1-8B"],
    defaultBaseUrl: "https://chatjimmy.nclong87.workers.dev/api/chat",
    directBaseUrl: "https://chatjimmy.ai/api/chat",
    requiresKey: false
  },
  {
    id: "ollama",
    name: "Ollama",
    tagline: "Ollama Cloud API (https://ollama.com/v1)",
    defaultModel: "gemma4:31b",
    models: ["gemma4:31b","gpt-oss:20b","nemotron-3-nano:30b-cloud"],
    defaultBaseUrl: "https://ollama.nclong87.workers.dev/v1",
    directBaseUrl: "https://ollama.com/v1",
    requiresKey: false
  },
  {
    id: "gemini",
    name: "Google Gemini",
    tagline: "Fast & highly structured intelligence",
    defaultModel: "gemini-3.6-flash",
    models: ["gemini-3.5-flash-lite",  "gemini-3.6-flash-lite", "gemini-3.5-flash", "gemini-3.6-flash"],
    tts_models: ["gemini-2.5-flash-preview-tts","gemini-3.1-flash-tts-preview"],
    defaultBaseUrl: "https://gemini.nclong87.workers.dev/v1beta",
    directBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    requiresKey: false
  },
  {
    id: "9flare",
    name: "9Flare",
    tagline: "High performance API gateway",
    defaultModel: "pro/claude-haiku-4-5",
    models: ["pro/minimax-m2.5", "pro/claude-haiku-4-5", "pro/glm-5", ],
    defaultBaseUrl: "https://9flare.nclong87.workers.dev/api/v1",
    directBaseUrl: "https://9flare.com/api/v1",
    requiresKey: false
  },
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

export default PROVIDER_OPTIONS;
