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
  explicitAction?: string,
  response?: string
): string {
  if (explicitAction) return explicitAction;

  const combined = `${prompt || ""} ${systemInstruction || ""} ${schemaDescription || ""}`.toLowerCase();
  const resp = (response || "").toLowerCase();

  // 1. Connection test
  if (
    combined.includes('status": "connected"') || 
    combined.includes("test assistant") || 
    combined.includes("connection successful") ||
    combined.includes("/api/test-llm")
  ) {
    return "Connection Test";
  }

  // 2. Translation Challenge & Practice
  // 2.1 Challenge Turn Evaluation
  if (
    combined.includes("evaluate a language learner's translation attempt") ||
    combined.includes("/api/challenge-turn") ||
    combined.includes("challenge-turn") ||
    combined.includes("challenge turn") ||
    combined.includes("incorporatedtargetword") ||
    combined.includes("translation challenge evaluation coach") ||
    combined.includes("evaluation coach") ||
    resp.includes("incorporatedtargetword") ||
    (resp.includes("correctnessscore") && resp.includes("feedback"))
  ) {
    return "Challenge Evaluation";
  }

  // 2.2 Challenge Ask AI Tutor / Q&A
  if (
    combined.includes("translation challenge tutor") ||
    combined.includes("active translation challenge") ||
    combined.includes("post-challenge review mode") ||
    combined.includes("challenge context:") ||
    combined.includes("ask-ai-challenge")
  ) {
    return "Challenge Ask AI";
  }

  // 2.3 Translation Challenge Generation
  if (
    combined.includes("translation challenge") ||
    combined.includes("/api/generate-challenge") ||
    combined.includes("generate-challenge") ||
    combined.includes("translation practice") ||
    combined.includes("translation-challenge") ||
    (combined.includes("nativesentence") && combined.includes("idealtranslation")) ||
    combined.includes("targetwordfromcollection") ||
    resp.includes("nativesentence") ||
    resp.includes("idealtranslation") ||
    resp.includes("targetwordfromcollection")
  ) {
    return "Translation Challenge";
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
    resp.includes("quizquestion") ||
    (combined.includes("quiz") && !combined.includes("chat"))
  ) {
    return "AI Quiz";
  }

  // 4. Grammar Polish
  if (
    combined.includes("fix grammar") || 
    combined.includes("polish sentence") || 
    combined.includes("fixedsentence") ||
    combined.includes("fix-grammar") ||
    combined.includes("/api/fix-grammar") ||
    resp.includes("fixedsentence") ||
    (combined.includes("language coach") && (combined.includes("polish") || combined.includes("grammar") || combined.includes("spelling") || combined.includes("flow")))
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
    combined.includes("image-analysis") ||
    combined.includes("analyze-image-vocab") ||
    resp.includes("vocabularycandidates") ||
    resp.includes("imagedescription")
  ) {
    return "Image Analysis";
  }

  // 6. Visual Search Query Optimization
  if (
    combined.includes("visual search query") ||
    combined.includes("photographic search query") ||
    combined.includes("visual search query optimizer")
  ) {
    return "Visual Search Query";
  }

  // 7. Sense Detection / Multiple Definition Senses
  if (
    combined.includes("detect-word-senses") ||
    combined.includes("check-word-definitions") ||
    combined.includes("/api/check-word-definitions") ||
    combined.includes("sense detection") || 
    combined.includes("multiple senses") || 
    combined.includes("checkworddefinitions") || 
    combined.includes('senses": [') ||
    combined.includes("hasmultiplesenses") ||
    resp.includes("hasmultiplesenses")
  ) {
    return "Sense Lookup";
  }

  // 8. Topic Vocabulary / Random Words Generation
  if (
    combined.includes("generate-topic-words") ||
    combined.includes("generaterandomwords") ||
    combined.includes("practical vocabulary words") || 
    combined.includes("words related to the topic") ||
    combined.includes("generate random words") ||
    combined.includes("generate-random-words") ||
    combined.includes("/api/generate-random-words") ||
    combined.includes("generate-words-by-topic")
  ) {
    return "Topic Vocabulary";
  }

  // 9. Casual Reply Suggestions
  if (
    combined.includes("suggest-casual-reply") ||
    combined.includes("/api/suggest-casual-reply") ||
    combined.includes("suggest-reply") ||
    combined.includes("casual reply") || 
    combined.includes("suggestcasualreply") ||
    combined.includes("suggest natural casual replies") ||
    resp.includes("suggestedreplies")
  ) {
    return "Casual Reply";
  }

  // 10. Learner Profiling & Performance Coach / Analytics
  if (
    combined.includes("analyze-personality-profile") ||
    combined.includes("/api/analyze-personality-profile") ||
    combined.includes("user personality") ||
    combined.includes("learner profiling") ||
    combined.includes("learner archetype") ||
    resp.includes("archetype")
  ) {
    return "Learner Profiling";
  }

  if (
    combined.includes("overallassessment") || 
    combined.includes("analyze-performance") ||
    combined.includes("/api/analyze-performance") ||
    combined.includes("performance coach") || 
    combined.includes("vocabulary analyst") ||
    combined.includes("student performance data")
  ) {
    return "Performance Coach";
  }

  // 11. Autofill Word / Dictionary Lookup
  if (
    combined.includes("autofill-word") ||
    combined.includes("/api/autofill-word") ||
    combined.includes("provide detailed vocabulary learning material") || 
    combined.includes("multilingual dictionary database engine") ||
    combined.includes("detailed vocabulary learning material") ||
    combined.includes("autofill") ||
    combined.includes("dictionary lookup")
  ) {
    return "Autofill Word";
  }

  // 12. Contextual JIT Action Chips
  if (
    combined.includes("suggested-actions") ||
    combined.includes("/api/suggested-actions") ||
    combined.includes("interactive suggested actions") ||
    combined.includes("personalized suggested action prompts") ||
    combined.includes("jit suggested actions")
  ) {
    return "JIT Action Chips";
  }

  // 13. Chat Message
  if (
    combined.includes("/api/chat") ||
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
  const action = detectActionCategory(
    params.prompt, 
    params.systemInstruction, 
    params.schemaDescription, 
    params.action,
    params.response
  );
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
  const rawLogs = await getApiRequestLogsFromDB(maxLimit);
  let hasCorrections = false;

  const sanitizedLogs = rawLogs.map(log => {
    // If log was previously miscategorized (e.g. Translation Challenge labeled as Grammar Polish) or generic, re-detect
    const currentAction = log.action;
    const shouldRecheck = !currentAction || 
      currentAction === "Grammar Polish" || 
      currentAction === "LLM Query" || 
      currentAction === "LLM Request" ||
      currentAction === "LLM";

    if (shouldRecheck) {
      const detected = detectActionCategory(
        log.prompt, 
        log.systemInstruction, 
        log.schemaDescription, 
        undefined, 
        log.response
      );
      if (detected && detected !== currentAction) {
        hasCorrections = true;
        return { ...log, action: detected };
      }
    }
    return log;
  });

  if (hasCorrections) {
    Promise.all(sanitizedLogs.map(l => saveApiRequestLogToDB(l))).catch(() => undefined);
  }

  return sanitizedLogs;
}

export async function clearAllApiLogs(): Promise<void> {
  await clearApiRequestLogsFromDB();
}
