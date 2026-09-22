import { useState, useEffect } from "react";
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
  action?: string;
  isAutoMode?: boolean;
  onCancel?: () => void;
}

export interface LlmRequestEndEvent {
  provider?: string;
  model?: string;
  action?: string;
  success: boolean;
  error?: any;
  timestamp?: number;
}

export interface LlmApiErrorEvent {
  errorMessage: string;
  provider: string;
  model: string;
  action?: string;
  retryAttempt?: number;
  maxRetries?: number;
  onRetry?: (newConfig?: LLMConfig) => void;
  onCancel?: () => void;
}

type LlmStartEventListener = (data: LlmRequestStartEvent) => void;
type LlmEndEventListener = (data: LlmRequestEndEvent) => void;
type LlmErrorEventListener = (data: LlmApiErrorEvent) => void;
type LlmCloseEventListener = () => void;

const startListeners = new Set<LlmStartEventListener>();
const endListeners = new Set<LlmEndEventListener>();
const errorListeners = new Set<LlmErrorEventListener>();
const closeListeners = new Set<LlmCloseEventListener>();

/**
 * Publish an event when an LLM request is about to be sent to the AI worker.
 */
export function publishLlmRequestStart(data: LlmRequestStartEvent): void {
  if (!data || !data.provider || !data.model) return;
  startListeners.forEach((listener) => {
    try {
      listener(data);
    } catch (e) {
      console.error("[llmEvents] Start listener error:", e);
    }
  });
}

/**
 * Publish an event when an LLM request completes (success or failure).
 */
export function publishLlmRequestEnd(data: LlmRequestEndEvent): void {
  if (!data) return;
  endListeners.forEach((listener) => {
    try {
      listener(data);
    } catch (e) {
      console.error("[llmEvents] End listener error:", e);
    }
  });
}

/**
 * Publish an event when an LLM API error occurs that can be retried with circuit breaker.
 */
export function publishLlmApiError(data: LlmApiErrorEvent): void {
  if (!data) return;
  errorListeners.forEach((listener) => {
    try {
      listener(data);
    } catch (e) {
      console.error("[llmEvents] Error listener error:", e);
    }
  });
}

/**
 * Close all active LLM modal dialogs.
 */
export function publishCloseLlmModals(): void {
  closeListeners.forEach((listener) => {
    try {
      listener();
    } catch (e) {
      console.error("[llmEvents] Close listener error:", e);
    }
  });
}

/**
 * Helper to resolve candidate/model from config and publish start event.
 */
export function notifyLlmRequestStartFromConfig(llmConfig?: LLMConfig, action?: string, onCancel?: () => void): { provider: string; model: string } {
  let provider = llmConfig?.provider || "auto";
  let model = llmConfig?.model || "auto";
  const isAutoMode = provider === "auto" || model === "auto";

  if (isAutoMode) {
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

  const payload: LlmRequestStartEvent = { provider, model, timestamp: Date.now(), action, isAutoMode, onCancel };
  publishLlmRequestStart(payload);
  return { provider, model };
}

/**
 * Subscribe to LLM request start events. Returns an unsubscribe function.
 */
export function subscribeLlmRequestStart(listener: LlmStartEventListener): () => void {
  startListeners.add(listener);
  return () => {
    startListeners.delete(listener);
  };
}

/**
 * Subscribe to LLM request end events. Returns an unsubscribe function.
 */
export function subscribeLlmRequestEnd(listener: LlmEndEventListener): () => void {
  endListeners.add(listener);
  return () => {
    endListeners.delete(listener);
  };
}

/**
 * Subscribe to LLM API error events. Returns an unsubscribe function.
 */
export function subscribeLlmApiError(listener: LlmErrorEventListener): () => void {
  errorListeners.add(listener);
  return () => {
    errorListeners.delete(listener);
  };
}

/**
 * Subscribe to close all LLM modals events. Returns an unsubscribe function.
 */
export function subscribeCloseLlmModals(listener: LlmCloseEventListener): () => void {
  closeListeners.add(listener);
  return () => {
    closeListeners.delete(listener);
  };
}

let centralProgressModalOpen = false;
type CentralModalVisibilityListener = (isOpen: boolean) => void;
const centralModalVisibilityListeners = new Set<CentralModalVisibilityListener>();

/**
 * Check if the central API call progress modal is currently open.
 */
export function isCentralModalOpen(): boolean {
  return centralProgressModalOpen;
}

/**
 * Broadcast when the central API call progress modal opens or closes.
 */
export function publishCentralModalVisibility(isOpen: boolean): void {
  if (centralProgressModalOpen === isOpen) return;
  centralProgressModalOpen = isOpen;
  centralModalVisibilityListeners.forEach((listener) => {
    try {
      listener(isOpen);
    } catch (e) {
      console.error("[llmEvents] Central modal visibility listener error:", e);
    }
  });
}

/**
 * Subscribe to central modal visibility changes.
 */
export function subscribeCentralModalVisibility(listener: CentralModalVisibilityListener): () => void {
  centralModalVisibilityListeners.add(listener);
  // Immediately call with current status
  try {
    listener(centralProgressModalOpen);
  } catch (e) {
    console.error("[llmEvents] Central modal visibility initial call error:", e);
  }
  return () => {
    centralModalVisibilityListeners.delete(listener);
  };
}

/**
 * React hook to reactively track whether the central API progress modal is open.
 */
export function useCentralModalOpen(): boolean {
  const [isOpen, setIsOpen] = useState<boolean>(centralProgressModalOpen);

  useEffect(() => {
    return subscribeCentralModalVisibility((open) => {
      setIsOpen(open);
    });
  }, []);

  return isOpen;
}

