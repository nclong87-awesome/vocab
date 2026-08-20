import { LLMConfig } from "../types";
import { getNextAutoCandidate } from "./autoModeManager";
import { PROVIDER_OPTIONS } from "../config/llmProviders";

function sanitizeModelName(provider: string, model?: string): string {
  if (provider === "auto") return "auto";
  if (!model) {
    const provMeta = PROVIDER_OPTIONS.find((p) => p.id === provider);
    return provMeta?.defaultModel || "default";
  }
  return model;
}

export interface LlmRequestStartEvent {
  provider: string;
  model: string;
  timestamp?: number;
}

type LlmEventListener = (data: LlmRequestStartEvent) => void;

const listeners = new Set<LlmEventListener>();

/**
 * Publish an event when an LLM request is about to be sent to the AI worker.
 */
export function publishLlmRequestStart(data: LlmRequestStartEvent): void {
  if (!data || !data.provider || !data.model) return;
  listeners.forEach((listener) => {
    try {
      listener(data);
    } catch (e) {
      console.error("[llmEvents] Listener error:", e);
    }
  });
}

/**
 * Helper to resolve candidate/model from config and publish start event.
 */
export function notifyLlmRequestStartFromConfig(llmConfig?: LLMConfig): { provider: string; model: string } {
  let provider = llmConfig?.provider || "auto";
  let model = llmConfig?.model || "auto";

  if (provider === "auto" || model === "auto") {
    try {
      const cand = getNextAutoCandidate(llmConfig, undefined, false);
      provider = cand.provider;
      model = cand.model;
    } catch (e) {
      provider = "gemini";
      model = "gemini-2.5-flash";
    }
  } else {
    model = sanitizeModelName(provider, model);
  }

  const payload = { provider, model, timestamp: Date.now() };
  publishLlmRequestStart(payload);
  return { provider, model };
}

/**
 * Subscribe to LLM request start events. Returns an unsubscribe function.
 */
export function subscribeLlmRequestStart(listener: LlmEventListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
