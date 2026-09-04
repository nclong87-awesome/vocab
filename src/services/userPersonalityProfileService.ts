import { UserPersonalityProfile, Word, UserStats, LLMConfig, LearnerArchetype } from "../types";
import { getAllUserInquiries } from "./userInquiryService";
import {
  getUserPersonalityProfileFromDB,
  saveUserPersonalityProfileToDB,
  getAllWordsFromDB,
  getStatsFromDB,
  getLLMConfigFromLocalStorage
} from "../db/indexedDB";
import { getDefaultLLMConfig } from "../config/llmProviders";
import { fetchWithTimeout, isStaticHost } from "../utils";
import { logApiRequest } from "./requestHistoryService";
import { notifyLlmRequestStartFromConfig } from "../utils/llmEvents";
import { sanitizeModel } from "./llmClientService";

export interface BuildDigestParams {
  words: Word[];
  stats?: UserStats;
  targetLanguage?: string;
  nativeLanguage?: string;
}

export interface ActivityDigestData {
  digestText: string;
  inquiries: ReturnType<typeof getAllUserInquiries>;
  totalWords: number;
  quizzesTaken: number;
  accuracy: number;
  streak: number;
  topCategories: Array<{ category: string; count: number }>;
}

/**
 * Builds a compact, token-efficient digest (~800-1200 tokens) of user learning activity
 * consolidating both Main Chat and "Ask AI" in-situ queries.
 */
export function buildUserActivityDigest(params: BuildDigestParams): ActivityDigestData {
  const { words, stats, targetLanguage = "English", nativeLanguage = "Vietnamese" } = params;
  const inquiries = getAllUserInquiries();

  // Compute category breakdown
  const categoryCounts: Record<string, number> = {};
  words.forEach(w => {
    const cat = (w.category || "General").trim();
    categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
  });

  const topCategories = Object.entries(categoryCounts)
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const totalWords = words.length;
  const quizzesTaken = stats?.totalQuizzesTaken || 0;
  const totalCorrect = stats?.totalCorrectAnswers || 0;
  const accuracy = quizzesTaken > 0
    ? Math.min(100, Math.round((totalCorrect / Math.max(1, quizzesTaken * 5)) * 100))
    : 0;
  const streak = stats?.streak?.count || 0;

  // Breakdown of inquiry sources
  const askAiCount = inquiries.filter(i => i.source === "ask_ai_dialog" || i.word).length;
  const mainChatCount = inquiries.length - askAiCount;

  const digestLines: string[] = [
    `Learner Profile Context: Target [${targetLanguage}], Native [${nativeLanguage}]`,
    `Vocabulary Corpus: ${totalWords} words across themes: ${topCategories.map(c => `${c.category} (${c.count})`).join(", ") || "General"}`,
    `Study Discipline: ${quizzesTaken} quizzes completed, ${accuracy}% accuracy, active streak of ${streak} days.`,
    `Inquiry Interaction Breakdown: ${inquiries.length} total logged queries (${askAiCount} deep word-level 'Ask AI' inquiries, ${mainChatCount} conversational inquiries).`
  ];

  return {
    digestText: digestLines.join("\n"),
    inquiries,
    totalWords,
    quizzesTaken,
    accuracy,
    streak,
    topCategories
  };
}

/**
 * Generates an intelligent, deterministic fallback profile when offline or when no LLM response is available.
 */
export function generateFallbackPersonalityProfile(params: BuildDigestParams): UserPersonalityProfile {
  const { words, targetLanguage = "English", nativeLanguage = "Vietnamese" } = params;
  const inquiries = getAllUserInquiries();

  // Heuristic archetype estimation
  const allText = inquiries.map(i => i.question.toLowerCase()).join(" ");
  let archetype: LearnerArchetype = "Curious Explorer";
  let summary = `Dedicated learner actively mastering ${targetLanguage} with an inquiry-driven mindset.`;
  let traits = ["Curious", "Context-First", "Persistent"];

  if (allText.includes("business") || allText.includes("email") || allText.includes("formal") || allText.includes("meeting")) {
    archetype = "Pragmatic Professional";
    summary = `Focused on practical, professional, and career-advancing application of ${targetLanguage}.`;
    traits = ["Goal-Oriented", "Career-Driven", "Nuance-Sensitive"];
  } else if (allText.includes("difference") || allText.includes("vs") || allText.includes("grammar") || allText.includes("rule")) {
    archetype = "Meticulous Perfectionist";
    summary = `Analytical learner committed to precision, subtle grammatical distinctions, and exact usage.`;
    traits = ["Precision-Oriented", "Detail-Focused", "Systematic"];
  } else if (allText.includes("slang") || allText.includes("talk") || allText.includes("conversation") || allText.includes("say")) {
    archetype = "Casual Conversationalist";
    summary = `Enthusiastic communicator seeking natural flow, idiomatic expressions, and real-life speaking confidence.`;
    traits = ["Interactive", "Natural Flow", "Idiom-Focused"];
  }

  const categoryNames = Array.from(new Set(words.map(w => w.category).filter(Boolean))).slice(0, 4) as string[];

  return {
    version: 1,
    lastUpdated: Date.now(),
    interactionCountAnalyzed: inquiries.length,
    confidenceScore: Math.min(85, Math.max(30, 35 + inquiries.length * 4)),
    archetype,
    archetypeSummary: summary,
    archetypeTraits: traits,
    learningPreferences: {
      primaryModality: "contextual_examples",
      explanationDepth: "punchy_concise",
      formalityPreference: archetype === "Pragmatic Professional" ? "business_casual" : "relaxed_slang",
      challengeAttitude: "fast_paced_gamified"
    },
    detectedInterests: categoryNames.length > 0 ? categoryNames : ["Everyday Communication", "Practical Phrasing"],
    frequentQuestionTypes: ["nuance_comparison", "collocations"],
    diagnostics: {
      strengths: [
        "Consistent inquiry habits across vocabulary cards",
        "Demonstrates active curiosity in real-world contexts"
      ],
      blindSpots: [
        "Reinforce dependent prepositions and natural verb collocations"
      ],
      actionableAdvice: `Continue asking comparative questions when adding new ${targetLanguage} words to cement natural nuance.`
    },
    tailoredSystemPromptPatch: `Provide punchy, practical examples in ${targetLanguage} with clear ${nativeLanguage} nuance notes. Always emphasize natural prepositions and collocations.`
  };
}

/**
 * Retrieves the currently saved profile from IndexedDB.
 */
export async function getStoredUserPersonalityProfile(): Promise<UserPersonalityProfile | null> {
  return getUserPersonalityProfileFromDB();
}

export interface AnalyzePersonalityProfileParams {
  words: Word[];
  stats?: UserStats;
  targetLanguage?: string;
  nativeLanguage?: string;
  llmConfig?: LLMConfig;
  signal?: AbortSignal;
}

/**
 * Triggers full LLM analysis of the user's personality and learning profile.
 * Saves the resulting profile to IndexedDB and returns it.
 */
export async function analyzeAndSavePersonalityProfile(
  params: AnalyzePersonalityProfileParams
): Promise<UserPersonalityProfile> {
  const { words, stats, targetLanguage = "English", nativeLanguage = "Vietnamese", llmConfig, signal } = params;
  notifyLlmRequestStartFromConfig(llmConfig);
  const startTime = performance.now();

  const digestData = buildUserActivityDigest({ words, stats, targetLanguage, nativeLanguage });

  if (isStaticHost()) {
    // If running in static host mode without Node backend, return the client-side adaptive profile
    const fallback = generateFallbackPersonalityProfile({ words, stats, targetLanguage, nativeLanguage });
    await saveUserPersonalityProfileToDB(fallback);
    return fallback;
  }

  try {
    const res = await fetchWithTimeout("/api/analyze-personality-profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        activityDigest: digestData.digestText,
        inquiries: digestData.inquiries,
        totalWords: digestData.totalWords,
        quizzesTaken: digestData.quizzesTaken,
        accuracy: digestData.accuracy,
        streak: digestData.streak,
        topCategories: digestData.topCategories,
        targetLanguage,
        nativeLanguage,
        llmConfig
      }),
      signal
    });

    if (res.ok) {
      const data: UserPersonalityProfile = await res.json();
      const duration = (data as any).responseTimeMs || Math.round(performance.now() - startTime);
      const prov = (data as any).provider || llmConfig?.provider || "gemini";
      const mod = (data as any).model || sanitizeModel(llmConfig?.provider || "gemini", llmConfig?.model);

      logApiRequest({
        provider: prov,
        model: mod,
        prompt: `Analyze User Personality Profile for ${targetLanguage} (${digestData.inquiries.length} inquiries)`,
        systemInstruction: "User Personality & Learner Profiling Engine",
        response: JSON.stringify(data),
        responseTimeMs: duration,
        status: "success",
        statusCode: 200,
        action: "Learner Profiling"
      }).catch(() => undefined);

      await saveUserPersonalityProfileToDB(data);
      syncMilestoneMarkersOnProfileSaved();
      return data;
    }

    const errData = await res.json().catch(() => null);
    throw new Error(errData?.error || `Server responded with ${res.status}`);
  } catch (err: any) {
    console.warn("Failed to generate personality profile via LLM, using intelligent fallback:", err);
    const fallback = generateFallbackPersonalityProfile({ words, stats, targetLanguage, nativeLanguage });
    await saveUserPersonalityProfileToDB(fallback);
    syncMilestoneMarkersOnProfileSaved();
    return fallback;
  }
}

/* -------------------------------------------------------------------------- */
/* AUTOMATIC BACKGROUND MILESTONE TRIGGER (15 INTERACTIONS)                    */
/* -------------------------------------------------------------------------- */

export const PROFILE_AUTOREFRESH_MILESTONE_INTERVAL = 15;
export const PROFILE_AUTOREFRESH_COOLDOWN_MS = 2 * 60 * 1000; // 2 minutes between auto-refreshes

const KEY_TOTAL_INTERACTIONS = "vocab_learner_total_interaction_count";
const KEY_LAST_MILESTONE = "vocab_learner_last_profile_milestone_count";
const KEY_LAST_REFRESH_TIMESTAMP = "vocab_learner_last_milestone_refresh_timestamp";

let isAutoRefreshingInProgress = false;
let autoRefreshTimeout: any = null;

function syncMilestoneMarkersOnProfileSaved(): void {
  if (typeof localStorage === "undefined") return;
  try {
    let currentTotal = parseInt(localStorage.getItem(KEY_TOTAL_INTERACTIONS) || "", 10);
    if (isNaN(currentTotal) || currentTotal < 0) {
      currentTotal = Math.max(0, getAllUserInquiries().length);
      localStorage.setItem(KEY_TOTAL_INTERACTIONS, String(currentTotal));
    }
    localStorage.setItem(KEY_LAST_MILESTONE, String(currentTotal));
    localStorage.setItem(KEY_LAST_REFRESH_TIMESTAMP, String(Date.now()));
  } catch {
    // ignore
  }
}

export interface InteractionMilestoneProgress {
  totalInteractions: number;
  lastAnalyzedTotal: number;
  interactionsSinceLastMilestone: number;
  threshold: number;
  progressPercent: number;
  isRefreshing: boolean;
  lastRefreshTimestamp: number;
}

/**
 * Returns current progress toward the 15-interaction profile auto-refresh milestone.
 */
export function getMilestoneProgress(): InteractionMilestoneProgress {
  if (typeof window === "undefined" || typeof localStorage === "undefined") {
    return {
      totalInteractions: 0,
      lastAnalyzedTotal: 0,
      interactionsSinceLastMilestone: 0,
      threshold: PROFILE_AUTOREFRESH_MILESTONE_INTERVAL,
      progressPercent: 0,
      isRefreshing: isAutoRefreshingInProgress,
      lastRefreshTimestamp: 0
    };
  }

  let total = parseInt(localStorage.getItem(KEY_TOTAL_INTERACTIONS) || "", 10);
  if (isNaN(total) || total < 0) {
    total = Math.max(0, getAllUserInquiries().length);
    localStorage.setItem(KEY_TOTAL_INTERACTIONS, String(total));
  }

  let lastMilestone = parseInt(localStorage.getItem(KEY_LAST_MILESTONE) || "", 10);
  if (isNaN(lastMilestone) || lastMilestone < 0) {
    lastMilestone = Math.max(0, total);
    localStorage.setItem(KEY_LAST_MILESTONE, String(lastMilestone));
  }

  const delta = Math.max(0, total - lastMilestone);
  const threshold = PROFILE_AUTOREFRESH_MILESTONE_INTERVAL;
  const progressPercent = Math.min(100, Math.round((delta / threshold) * 100));
  const lastRefreshTimestamp = parseInt(localStorage.getItem(KEY_LAST_REFRESH_TIMESTAMP) || "0", 10);

  return {
    totalInteractions: total,
    lastAnalyzedTotal: lastMilestone,
    interactionsSinceLastMilestone: delta,
    threshold,
    progressPercent,
    isRefreshing: isAutoRefreshingInProgress,
    lastRefreshTimestamp
  };
}

/**
 * Resets the milestone counter offset to the current total interactions.
 */
export function resetMilestoneProgress(): void {
  if (typeof localStorage === "undefined") return;
  const total = parseInt(localStorage.getItem(KEY_TOTAL_INTERACTIONS) || "0", 10);
  localStorage.setItem(KEY_LAST_MILESTONE, String(total));
}

/**
 * Checks if a background milestone refresh is currently running.
 */
export function isMilestoneRefreshInProgress(): boolean {
  return isAutoRefreshingInProgress;
}

export type LearningInteractionType = "inquiry" | "quiz" | "word_learned" | "flashcard_review";

/**
 * Records a learning interaction (question, quiz completion, word mastered, flashcard review).
 * Automatically evaluates the 15-interaction threshold and triggers non-blocking background profiling.
 */
export function recordLearningInteraction(
  type: LearningInteractionType,
  meta?: any
): void {
  try {
    if (typeof window === "undefined" || typeof localStorage === "undefined") return;

    let currentTotal = parseInt(localStorage.getItem(KEY_TOTAL_INTERACTIONS) || "", 10);
    if (isNaN(currentTotal) || currentTotal < 0) {
      currentTotal = Math.max(0, getAllUserInquiries().length);
    }
    currentTotal += 1;
    localStorage.setItem(KEY_TOTAL_INTERACTIONS, String(currentTotal));

    let lastMilestone = parseInt(localStorage.getItem(KEY_LAST_MILESTONE) || "", 10);
    if (isNaN(lastMilestone) || lastMilestone < 0) {
      lastMilestone = Math.max(0, currentTotal - 1);
      localStorage.setItem(KEY_LAST_MILESTONE, String(lastMilestone));
    }

    const delta = currentTotal - lastMilestone;

    window.dispatchEvent(
      new CustomEvent("vocab-interaction-recorded", {
        detail: {
          type,
          meta,
          totalInteractions: currentTotal,
          lastMilestone,
          interactionsSinceLastMilestone: delta,
          threshold: PROFILE_AUTOREFRESH_MILESTONE_INTERVAL
        }
      })
    );

    if (delta >= PROFILE_AUTOREFRESH_MILESTONE_INTERVAL) {
      if (autoRefreshTimeout) clearTimeout(autoRefreshTimeout);
      autoRefreshTimeout = setTimeout(() => {
        triggerAutoMilestoneProfileRefresh().catch(err => {
          console.warn("Background auto milestone profile refresh caught error:", err);
        });
      }, 500);
    }
  } catch (err) {
    console.warn("Failed to record learning interaction:", err);
  }
}

/**
 * Background auto-refresh handler executed when reaching the 15-interaction milestone.
 * Operates non-blockingly and notifies the UI upon completion.
 */
export async function triggerAutoMilestoneProfileRefresh(
  options?: { force?: boolean }
): Promise<UserPersonalityProfile | null> {
  if (isAutoRefreshingInProgress) {
    return null;
  }

  const now = Date.now();
  const lastRefreshTime = parseInt(localStorage.getItem(KEY_LAST_REFRESH_TIMESTAMP) || "0", 10);
  if (!options?.force && now - lastRefreshTime < PROFILE_AUTOREFRESH_COOLDOWN_MS) {
    return null;
  }

  isAutoRefreshingInProgress = true;

  try {
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("vocab-profile-auto-refresh-start", {
          detail: { timestamp: now, threshold: PROFILE_AUTOREFRESH_MILESTONE_INTERVAL }
        })
      );
    }

    const words = await getAllWordsFromDB();
    const stats = await getStatsFromDB({
      totalQuizzesTaken: 0,
      totalCorrectAnswers: 0,
      streak: { count: 0, lastActiveDate: "", history: [] }
    });
    const llmConfig = getLLMConfigFromLocalStorage(getDefaultLLMConfig());
    const targetLanguage = localStorage.getItem("vocab_learner_target_lang") || "English";
    const nativeLanguage = localStorage.getItem("vocab_learner_native_lang") || "Vietnamese";

    const updatedProfile = await analyzeAndSavePersonalityProfile({
      words,
      stats,
      targetLanguage,
      nativeLanguage,
      llmConfig
    });

    const currentTotal = parseInt(localStorage.getItem(KEY_TOTAL_INTERACTIONS) || "0", 10);
    localStorage.setItem(KEY_LAST_MILESTONE, String(currentTotal));
    localStorage.setItem(KEY_LAST_REFRESH_TIMESTAMP, String(Date.now()));

    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("vocab-profile-auto-refresh-complete", {
          detail: {
            profile: updatedProfile,
            totalInteractions: currentTotal,
            archetype: updatedProfile.archetype
          }
        })
      );

      const toastMessage = nativeLanguage === "Vietnamese"
        ? `🧠 Hồ sơ phong cách học tập đã tự động cập nhật sau 15 tương tác (${updatedProfile.archetype})!`
        : `🧠 Learner profile automatically refreshed after 15 learning interactions (${updatedProfile.archetype})!`;

      window.dispatchEvent(
        new CustomEvent("vocab-show-toast", {
          detail: { message: toastMessage }
        })
      );
    }

    return updatedProfile;
  } catch (err) {
    console.warn("Background milestone auto-refresh error:", err);
    return null;
  } finally {
    isAutoRefreshingInProgress = false;
  }
}

