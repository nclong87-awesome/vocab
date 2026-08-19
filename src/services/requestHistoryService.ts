import { ApiRequestLog } from "../types";
import { saveApiRequestLogToDB, getApiRequestLogsFromDB, clearApiRequestLogsFromDB } from "../db/indexedDB";

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

  if (combined.includes("status\": \"connected\"") || combined.includes("test assistant") || combined.includes("connection successful")) {
    return "Connection Test";
  }
  if (combined.includes("fix grammar") || combined.includes("polish sentence") || combined.includes("language coach") || combined.includes("fixedsentence")) {
    return "Grammar Polish";
  }
  if (combined.includes("quiz") || combined.includes("generate multiple choice") || combined.includes("quizquestion")) {
    return "AI Quiz";
  }
  if (combined.includes("provide detailed vocabulary learning material") || combined.includes("autofill") || combined.includes("suggestedwords")) {
    return "Autofill Word";
  }
  if (combined.includes("sense detection") || combined.includes("multiple senses") || combined.includes("checkworddefinitions") || combined.includes("senses\": [")) {
    return "Sense Lookup";
  }
  if (combined.includes("practical vocabulary words") || combined.includes("topic") || combined.includes("generaterandomwords")) {
    return "Topic Vocabulary";
  }
  if (combined.includes("image") || combined.includes("photo") || combined.includes("visual")) {
    return "Image Analysis";
  }
  if (combined.includes("casual reply") || combined.includes("suggestcasualreply")) {
    return "Casual Reply";
  }
  if (combined.includes("flashcard") || combined.includes("flashcards")) {
    return "Flashcards";
  }
  if (combined.includes("overallassessment") || combined.includes("performance") || combined.includes("coach")) {
    return "Performance Coach";
  }
  if (combined.includes("chat") || combined.includes("conversation") || combined.includes("assistant")) {
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
    responseTimeMs: Math.max(1, Math.round(params.responseTimeMs || 0)),
    status: params.status,
    statusCode: params.statusCode ?? (params.status === "success" ? 200 : 500),
    errorMessage: params.errorMessage
  };

  await saveApiRequestLogToDB(entry);
}

export async function getRecentApiLogs(limit = 100): Promise<ApiRequestLog[]> {
  return await getApiRequestLogsFromDB(limit);
}

export async function clearAllApiLogs(): Promise<void> {
  await clearApiRequestLogsFromDB();
}
