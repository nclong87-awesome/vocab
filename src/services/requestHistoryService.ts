import { ApiRequestLog } from "../types";
import { saveApiRequestLogToDB, getApiRequestLogsFromDB, clearApiRequestLogsFromDB } from "../db/indexedDB";
import { PROVIDER_OPTIONS } from "../config/llmProviders";

/**
 * Calculates the dynamic maximum number of API history entries to retain in IndexedDB.
 * Minimum is 100 entries, or 15 times the total number of available models across providers.
 */
export function getMaxApiLogsLimit(): number {
  const totalModelsCount = PROVIDER_OPTIONS.reduce((acc, provider) => {
    if (provider.id === "auto") return acc;
    return acc + (provider.models ? provider.models.length : 0);
  }, 0);
  return Math.max(100, totalModelsCount * 15);
}

/**
 * Detects the functional action category of an LLM prompt.
 */
export function detectActionCategory(
  prompt: string, 
  systemInstruction?: string, 
  schemaDescription?: string,
  explicitAction?: string
): string {
  if (explicitAction) return explicitAction;

  const combined = `${prompt || ""} ${systemInstruction || ""} ${schemaDescription || ""}`.toLowerCase();

  // 1. Connection test
  if (
    combined.includes('status": "connected"') || 
    combined.includes("test assistant") || 
    combined.includes("connection successful") ||
    combined.includes("/api/test-llm")
  ) {
    return "Connection Test";
  }

  // 2. Flashcards (prioritized above generic dictionary/vocab matching)
  if (
    combined.includes("flashcard") || 
    combined.includes("flashcards") || 
    combined.includes("generate interactive study flashcards") ||
    combined.includes("study flashcard") ||
    combined.includes("study card for") ||
    combined.includes("/api/generate-flashcard") ||
    combined.includes("/api/generate-flashcards")
  ) {
    return "Flashcards";
  }

  // 3. AI Quiz
  if (
    combined.includes("generate-quiz") ||
    combined.includes("/api/generate-quiz") ||
    combined.includes("quizquestion") || 
    combined.includes("assessment specializing") || 
    combined.includes("quiz question") ||
    combined.includes("generate multiple choice") ||
    combined.includes("distractor") ||
    (combined.includes("quiz") && !combined.includes("chat"))
  ) {
    return "AI Quiz";
  }

  // 4. Grammar Polish
  if (
    combined.includes("fix grammar") || 
    combined.includes("polish sentence") || 
    combined.includes("language coach") || 
    combined.includes("fixedsentence") ||
    combined.includes("fix-grammar") ||
    combined.includes("/api/fix-grammar")
  ) {
    return "Grammar Polish";
  }

  // 5. Image Analysis
  if (
    combined.includes("image-vocab") || 
    combined.includes("analyze this image") || 
    combined.includes("analyze photographs and visual media") || 
    combined.includes("analyze the attached conversation screenshot") ||
    combined.includes("imagedescription") ||
    combined.includes("computer vision") ||
    combined.includes("image-analysis")
  ) {
    return "Image Analysis";
  }

  // 6. Sense Detection / Multiple Definition Senses
  if (
    combined.includes("detect-word-senses") ||
    combined.includes("check-word-definitions") ||
    combined.includes("sense detection") || 
    combined.includes("multiple senses") || 
    combined.includes("checkworddefinitions") || 
    combined.includes('senses": [') ||
    combined.includes("hasmultiplesenses")
  ) {
    return "Sense Lookup";
  }

  // 7. Topic Vocabulary / Random Words Generation
  if (
    combined.includes("generate-topic-words") ||
    combined.includes("generaterandomwords") ||
    combined.includes("practical vocabulary words") || 
    combined.includes("words related to the topic") ||
    combined.includes("generate random words") ||
    combined.includes("generate-words-by-topic")
  ) {
    return "Topic Vocabulary";
  }

  // 8. Casual Reply Suggestions
  if (
    combined.includes("suggest-casual-reply") ||
    combined.includes("suggest-reply") ||
    combined.includes("casual reply") || 
    combined.includes("suggestcasualreply") ||
    combined.includes("suggest natural casual replies")
  ) {
    return "Casual Reply";
  }

  // 9. Performance Coach / Analytics
  if (
    combined.includes("overallassessment") || 
    combined.includes("analyze-performance") ||
    combined.includes("performance coach") || 
    combined.includes("vocabulary analyst") ||
    combined.includes("student performance data")
  ) {
    return "Performance Coach";
  }

  // 10. Autofill Word / Dictionary Lookup
  if (
    combined.includes("autofill-word") ||
    combined.includes("provide detailed vocabulary learning material") || 
    combined.includes("multilingual dictionary database engine") ||
    combined.includes("detailed vocabulary learning material") ||
    combined.includes("autofill") ||
    combined.includes("dictionary lookup")
  ) {
    return "Autofill Word";
  }

  // 11. Chat Message
  if (
    combined.includes("chat") || 
    combined.includes("conversation") || 
    combined.includes("assistant") ||
    combined.includes("suggestedactions")
  ) {
    return "Chat Message";
  }

  return "LLM Query";
}

/**
 * Records an API request and response log into IndexedDB (max 100 entries).
 */
export async function logApiRequest(params: {
  provider: string;
  model: string;
  prompt: string;
  systemInstruction?: string;
  schemaDescription?: string;
  response: string;
  rawResponse?: string;
  responseTimeMs: number;
  status: 'success' | 'error';
  statusCode?: number;
  errorMessage?: string;
  action?: string;
}): Promise<void> {
  const action = detectActionCategory(params.prompt, params.systemInstruction, params.schemaDescription, params.action);
  const id = `req_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const timestamp = new Date().toISOString();

  const entry: ApiRequestLog = {
    id,
    timestamp,
    provider: params.provider || "auto",
    model: params.model || "auto",
    action,
    prompt: params.prompt || "",
    systemInstruction: params.systemInstruction,
    schemaDescription: params.schemaDescription,
    response: params.response || "",
    rawResponse: params.rawResponse !== undefined ? params.rawResponse : (params.status === "error" ? undefined : params.response),
    responseTimeMs: Math.max(1, Math.round(params.responseTimeMs || 0)),
    status: params.status,
    statusCode: params.statusCode ?? (params.status === "success" ? 200 : 500),
    errorMessage: params.errorMessage
  };

  await saveApiRequestLogToDB(entry);
}

export async function getRecentApiLogs(limit?: number): Promise<ApiRequestLog[]> {
  const maxLimit = typeof limit === "number" ? limit : getMaxApiLogsLimit();
  return await getApiRequestLogsFromDB(maxLimit);
}

export async function clearAllApiLogs(): Promise<void> {
  await clearApiRequestLogsFromDB();
}
