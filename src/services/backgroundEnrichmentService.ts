import { Word, WordSense, LLMConfig } from "../types";
import { checkWordDefinitionsService } from "./llmClientService";
import {
  normalizeWordCategory,
  normalizeWordPartOfSpeech,
  isPhrasalVerb,
  isNoun
} from "../utils/wordNormalization";

const AUTO_ENRICH_STORAGE_KEY = "vocab_learner_auto_enrich_enabled";

/**
 * Returns whether background auto-enrichment is enabled (default true).
 */
export function getAutoEnrichmentSetting(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const val = localStorage.getItem(AUTO_ENRICH_STORAGE_KEY);
    return val === null ? true : val === "true";
  } catch {
    return true;
  }
}

/**
 * Sets whether background auto-enrichment is enabled.
 */
export function setAutoEnrichmentSetting(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(AUTO_ENRICH_STORAGE_KEY, enabled ? "true" : "false");
    window.dispatchEvent(new CustomEvent("vocab-auto-enrich-setting-changed", { detail: { enabled } }));
  } catch {
    // Ignore storage quota or access errors
  }
}

export interface EnrichmentResult {
  updatedWord: Word;
  hasMultipleDefinitions: boolean;
  definitionCount: number;
  error?: string;
}

export interface BatchEnrichmentProgress {
  isRunning: boolean;
  total: number;
  processed: number;
  completedCount: number;
  multipleDefCount: number;
  errorCount: number;
  currentWordText?: string;
}

type ProgressListener = (progress: BatchEnrichmentProgress) => void;
const progressListeners = new Set<ProgressListener>();

let currentProgress: BatchEnrichmentProgress = {
  isRunning: false,
  total: 0,
  processed: 0,
  completedCount: 0,
  multipleDefCount: 0,
  errorCount: 0
};

export function subscribeEnrichmentProgress(listener: ProgressListener): () => void {
  progressListeners.add(listener);
  listener(currentProgress);
  return () => {
    progressListeners.delete(listener);
  };
}

function notifyProgress(progress: BatchEnrichmentProgress) {
  currentProgress = { ...progress };
  progressListeners.forEach((l) => {
    try {
      l(currentProgress);
    } catch (e) {
      console.error("[Enrichment Service] Listener error:", e);
    }
  });
}

/**
 * Enriches a single incomplete word using the AI lookup engine.
 * RULE:
 * - If only 1 definition exists, it is marked as completed (completed = true).
 * - If there is MORE than 1 definition (multiple senses), it is strictly marked as incompleted (completed = false)
 *   and the candidate senses are attached so the user can easily select their desired meaning.
 */
export async function enrichSingleWord(
  word: Word,
  options: {
    targetLanguage: string;
    nativeLanguage: string;
    llmConfig?: LLMConfig;
    signal?: AbortSignal;
  }
): Promise<EnrichmentResult> {
  const { targetLanguage, nativeLanguage, llmConfig, signal } = options;

  // If word is already flagged with multiple definitions, prevent automatic enrichment
  if (
    word.hasMultipleDefinitions &&
    word.senses &&
    word.senses.length > 1
  ) {
    return {
      updatedWord: word,
      hasMultipleDefinitions: true,
      definitionCount: word.senses.length
    };
  }

  const wordText = word.word.trim();
  const hintText = word.context || word.definition || word.translation || undefined;

  try {
    const data = await checkWordDefinitionsService({
      word: wordText,
      hint: hintText,
      targetLanguage,
      nativeLanguage,
      cfg: llmConfig,
      signal
    });

    if (signal?.aborted) {
      throw new Error("Aborted");
    }

    const rawSenses = Array.isArray(data?.senses) ? data.senses : [];
    const validSenses: WordSense[] = rawSenses.filter(
      (s: any) => Boolean(s && (s.definition || s.translation))
    );

    // Check if word has more than 1 definition / sense
    const hasMoreThanOneDefinition = Boolean(
      (data?.hasMultipleSenses && validSenses.length > 1) || validSenses.length > 1
    );

    if (hasMoreThanOneDefinition) {
      // RULE: More than 1 definition -> mark as INCOMPLETED (completed: false)
      const primarySense = validSenses[0];
      const rawPos = primarySense?.partOfSpeech || data?.partOfSpeech || word.partOfSpeech || "word";
      const rawCat = primarySense?.category || data?.category || word.category || "General";
      const isPv = isPhrasalVerb(wordText, rawPos, rawCat);
      const normPos = normalizeWordPartOfSpeech(rawPos, wordText, rawCat);
      const normCat = isPv ? normalizeWordCategory(rawCat, wordText, normPos) : rawCat;

      const updatedWord: Word = {
        ...word,
        completed: false, // Explicitly marked as incompleted because multiple definitions require user disambiguation
        hasMultipleDefinitions: true,
        senses: validSenses,
        enrichmentStatus: "has_multiple_definitions",
        pronunciation: primarySense?.pronunciation || data?.pronunciation || word.pronunciation || undefined,
        partOfSpeech: normPos,
        category: normCat,
        suggestedWords: primarySense?.suggestedWords || data?.suggestedWords || word.suggestedWords
      };

      return {
        updatedWord,
        hasMultipleDefinitions: true,
        definitionCount: validSenses.length
      };
    }

    // Exactly 1 definition (or single matching sense)
    const singleSense = validSenses[0];
    const targetWordStr = singleSense?.word || data?.word || wordText;
    const rawPos = singleSense?.partOfSpeech || data?.partOfSpeech || word.partOfSpeech || "noun";
    const rawCat = singleSense?.category || data?.category || word.category || "General";
    const isPv = isPhrasalVerb(targetWordStr, rawPos, rawCat);
    const normPos = normalizeWordPartOfSpeech(rawPos, targetWordStr, rawCat);
    const normCat = isPv ? normalizeWordCategory(rawCat, targetWordStr, normPos) : rawCat;

    const defVal = singleSense?.definition || data?.definition || word.definition;
    const transVal = singleSense?.translation || data?.translation || word.translation;

    if (!defVal && !transVal) {
      // No definition found
      const updatedWord: Word = {
        ...word,
        completed: false,
        hasMultipleDefinitions: false,
        enrichmentStatus: "error",
        enrichmentError: "No definition found"
      };
      return {
        updatedWord,
        hasMultipleDefinitions: false,
        definitionCount: 0,
        error: "No definition found"
      };
    }

    // Unambiguous single definition: Auto-complete the word!
    const exampleVal = singleSense?.example || data?.example || word.example;
    const exampleTranslationVal = singleSense?.exampleTranslation || data?.exampleTranslation || word.exampleTranslation;
    const pronunciationVal = singleSense?.pronunciation || data?.pronunciation || word.pronunciation || "/.../";
    const contextVal = singleSense?.context || data?.context || word.context || defVal;
    const suggestedWordsVal = singleSense?.suggestedWords || data?.suggestedWords || word.suggestedWords;
    const imageKeywordVal = isNoun(normPos) ? (singleSense?.imageKeyword || data?.imageKeyword || word.imageKeyword) : undefined;
    const imageUrlsVal = isNoun(normPos) ? (singleSense?.imageUrls || data?.imageUrls || word.imageUrls) : undefined;
    const imageUrlVal = isNoun(normPos) ? (singleSense?.imageUrl || data?.imageUrl || word.imageUrl) : undefined;

    const updatedWord: Word = {
      ...word,
      word: targetWordStr,
      pronunciation: pronunciationVal,
      partOfSpeech: normPos,
      category: normCat,
      definition: defVal || "",
      translation: transVal || "",
      example: exampleVal || undefined,
      exampleTranslation: exampleTranslationVal || undefined,
      context: contextVal || undefined,
      suggestedWords: suggestedWordsVal || undefined,
      imageKeyword: imageKeywordVal,
      imageUrls: imageUrlsVal,
      imageUrl: imageUrlVal,
      completed: true, // Marked as completed because it has only 1 definition
      hasMultipleDefinitions: false,
      senses: validSenses.length > 0 ? validSenses : undefined,
      enrichmentStatus: "completed",
      enrichmentError: undefined
    };

    return {
      updatedWord,
      hasMultipleDefinitions: false,
      definitionCount: 1
    };
  } catch (err: any) {
    if (signal?.aborted) throw err;
    const errMsg = err?.userMessage || err?.message || "Enrichment failed";
    const updatedWord: Word = {
      ...word,
      completed: false,
      enrichmentStatus: "error",
      enrichmentError: errMsg
    };
    return {
      updatedWord,
      hasMultipleDefinitions: false,
      definitionCount: 0,
      error: errMsg
    };
  }
}

let activeQueueAbortController: AbortController | null = null;

/**
 * Stops any currently running batch enrichment queue.
 */
export function cancelBatchEnrichment(): void {
  if (activeQueueAbortController) {
    activeQueueAbortController.abort();
    activeQueueAbortController = null;
  }
  notifyProgress({
    ...currentProgress,
    isRunning: false
  });
}

/**
 * Sequentially enriches an array of incomplete words in the background.
 * Calls onWordUpdated after each word is processed, persisting progress immediately.
 */
export async function enrichIncompleteWordsQueue(
  incompleteWords: Word[],
  options: {
    targetLanguage: string;
    nativeLanguage: string;
    llmConfig?: LLMConfig;
    onWordUpdated: (updatedWord: Word, res: EnrichmentResult) => void;
    onComplete?: (summary: { total: number; completedCount: number; multipleDefCount: number; errorCount: number }) => void;
  }
): Promise<void> {
  if (incompleteWords.length === 0) return;

  // Cancel any existing run
  cancelBatchEnrichment();

  // RULE: Prevent automatic enhancement for words that already have multiple definitions identified.
  // Those words require manual review by the user.
  const enrichableWords = incompleteWords.filter(
    (w) => !(w.hasMultipleDefinitions === true || (w.senses && w.senses.length > 1) || w.enrichmentStatus === "has_multiple_definitions")
  );

  const existingMultiDefCount = incompleteWords.length - enrichableWords.length;

  if (enrichableWords.length === 0) {
    notifyProgress({
      isRunning: false,
      total: incompleteWords.length,
      processed: incompleteWords.length,
      completedCount: 0,
      multipleDefCount: existingMultiDefCount,
      errorCount: 0,
      currentWordText: undefined
    });
    options.onComplete?.({
      total: incompleteWords.length,
      completedCount: 0,
      multipleDefCount: existingMultiDefCount,
      errorCount: 0
    });
    return;
  }

  const controller = new AbortController();
  activeQueueAbortController = controller;

  const total = enrichableWords.length;
  let processed = 0;
  let completedCount = 0;
  let multipleDefCount = existingMultiDefCount;
  let errorCount = 0;

  notifyProgress({
    isRunning: true,
    total,
    processed: 0,
    completedCount: 0,
    multipleDefCount,
    errorCount: 0,
    currentWordText: enrichableWords[0]?.word
  });

  for (const word of enrichableWords) {
    if (controller.signal.aborted) break;

    notifyProgress({
      isRunning: true,
      total,
      processed,
      completedCount,
      multipleDefCount,
      errorCount,
      currentWordText: word.word
    });

    try {
      const res = await enrichSingleWord(word, {
        targetLanguage: options.targetLanguage,
        nativeLanguage: options.nativeLanguage,
        llmConfig: options.llmConfig,
        signal: controller.signal
      });

      if (controller.signal.aborted) break;

      processed++;
      if (res.hasMultipleDefinitions) {
        multipleDefCount++;
      } else if (res.updatedWord.completed) {
        completedCount++;
      } else {
        errorCount++;
      }

      options.onWordUpdated(res.updatedWord, res);

      notifyProgress({
        isRunning: true,
        total,
        processed,
        completedCount,
        multipleDefCount,
        errorCount,
        currentWordText: processed < total ? enrichableWords[processed]?.word : undefined
      });

      // Brief delay between calls to be courteous to AI rate limits
      await new Promise((resolve) => setTimeout(resolve, 250));
    } catch (err: any) {
      if (controller.signal.aborted) break;
      processed++;
      errorCount++;
      notifyProgress({
        isRunning: true,
        total,
        processed,
        completedCount,
        multipleDefCount,
        errorCount
      });
    }
  }

  notifyProgress({
    isRunning: false,
    total,
    processed,
    completedCount,
    multipleDefCount,
    errorCount,
    currentWordText: undefined
  });

  activeQueueAbortController = null;
  options.onComplete?.({
    total: incompleteWords.length,
    completedCount,
    multipleDefCount,
    errorCount
  });
}
