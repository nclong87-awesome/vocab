import { LLMProviderOption } from "../types";

/**
 * Configuration file for LLM Providers.
 * Easily modify, add, or remove providers here.
 */
export const PROVIDER_OPTIONS: LLMProviderOption[] = [
  {
    id: "chatjimmy",
    name: "ChatJimmy AI",
    tagline: "ChatJimmy Free API (https://chatjimmy.ai)",
    defaultModel: "gemma2-27B",
    models: ["llama3.1-8B", "llama3.3-70B", "qwen2.5-72B", "gemma2-27B"],
    defaultBaseUrl: "https://sparkling-sky-f790.nclong87.workers.dev/api/chat",
    requiresKey: false
  },
  {
    id: "ollama",
    name: "Ollama",
    tagline: "Ollama Cloud API (https://ollama.com/v1)",
    defaultModel: "gemma4:31b",
    models: ["gemma4:31b","gpt-oss:20b","nemotron-3-nano:30b-cloud"],
    defaultBaseUrl: "https://rough-meadow-47c1.nclong87.workers.dev/v1",
    requiresKey: false
  },
  {
    id: "openai",
    name: "OpenAI",
    tagline: "GPT series models",
    defaultModel: "gpt-5.4-mini",
    models: ["gpt-4o-mini", "gpt-4.1-mini", "gpt-5.4-mini"],
    defaultBaseUrl: "https://api.openai.com/v1",
    requiresKey: true
  },
  {
    id: "github",
    name: "GitHub Models",
    tagline: "Inference API via GitHub Personal Access Token",
    defaultModel: "openai/gpt-4o",
    models: ["cohere/cohere-command-a", "openai/gpt-4o", "openai/gpt-4.1"],
    defaultBaseUrl: "https://models.github.ai/inference/",
    requiresKey: true
  },
  {
    id: "gemini",
    name: "Google Gemini",
    tagline: "Fast & highly structured intelligence",
    defaultModel: "gemini-3.6-flash",
    models: ["gemini-3.5-flash-lite",  "gemini-3.6-flash-lite", "gemini-3.5-flash", "gemini-3.6-flash"],
    tts_models: ["gemini-2.5-flash-preview-tts","gemini-3.1-flash-tts-preview"],

    requiresKey: false
  },
  {
    id: "9flare",
    name: "9Flare",
    tagline: "High performance API gateway",
    defaultModel: "pro/claude-haiku-4-5",
    models: ["pro/minimax-m2.5", "pro/claude-haiku-4-5", "pro/glm-5", ],
    defaultBaseUrl: "https://9flare.com/api/v1",
    requiresKey: true
  },
  {
    id: "custom",
    name: "Custom / Local Endpoint",
    tagline: "vLLM, LMStudio, or private proxy",
    defaultModel: "custom",
    models: ["custom"],
    defaultBaseUrl: "http://localhost:11434/v1",

    requiresKey: false
  }
];

export default PROVIDER_OPTIONS;
