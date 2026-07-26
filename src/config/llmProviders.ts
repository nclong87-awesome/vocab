import { LLMProviderOption } from "../types";

/**
 * Configuration file for LLM Providers.
 * Easily modify, add, or remove providers here.
 */
export const PROVIDER_OPTIONS: LLMProviderOption[] = [
  {
    id: "ollama",
    name: "Ollama",
    tagline: "Local & cloud open-weights models",
    defaultModel: "gemma4:31b",
    models: ["gemma4:31b", "gpt-oss:20b", "nemotron-3-nano:30b-cloud"],
    defaultBaseUrl: "https://ollama.com/v1",
    requiresKey: false
  },
  {
    id: "openai",
    name: "OpenAI",
    tagline: "GPT series models",
    defaultModel: "gpt-5.4-mini",
    models: ["gpt-5.4-mini", "gpt-4o-mini", "gpt-4.1-mini"],
    defaultBaseUrl: "https://api.openai.com/v1",
    requiresKey: true
  },
  {
    id: "github",
    name: "GitHub Models",
    tagline: "Inference API via GitHub Personal Access Token",
    defaultModel: "openai/gpt-4o",
    models: ["openai/gpt-4o", "openai/gpt-4.1", "cohere/cohere-command-a"],
    defaultBaseUrl: "https://models.inference.ai.azure.com",
    requiresKey: true
  },
  {
    id: "gemini",
    name: "Google Gemini",
    tagline: "Fast & highly structured intelligence",
    defaultModel: "gemini-2.5-flash",
    models: ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-3.5-flash"],
    requiresKey: true
  },
  {
    id: "9flare",
    name: "9Flare",
    tagline: "High performance API gateway",
    defaultModel: "pro/minimax-m2.5",
    models: ["pro/minimax-m2.5", "pro/claude-haiku-4-5", "pro/glm-5"],
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
