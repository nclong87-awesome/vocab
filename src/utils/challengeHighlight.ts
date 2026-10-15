import { ChallengeData, Word } from "../types";

/**
 * Strips markdown emphasis markers like **text**, __text__, or <mark>text</mark>
 * while capturing any enclosed target word.
 */
export function stripMarkdownMarkers(text: string): { cleanText: string; extractedMarker?: string } {
  if (!text) return { cleanText: "" };

  let extractedMarker: string | undefined;

  // Check for **word** or __word__ or <mark>word</mark>
  const boldMatch = text.match(/\*\*(.+?)\*\*|__(.+?)__|(?:\<mark\>)(.+?)(?:\<\/mark\>)/i);
  if (boldMatch) {
    extractedMarker = (boldMatch[1] || boldMatch[2] || boldMatch[3] || "").trim();
  }

  const cleanText = text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/<mark>(.+?)<\/mark>/gi, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();

  return { cleanText, extractedMarker };
}

/**
 * Cleans a candidate string: removes leading/trailing quotes, parentheses, punctuation.
 */
export function cleanCandidateString(str?: string): string {
  if (!str) return "";
  return str
    .replace(/^["'“”‘’«»`(\s]+|["'“”‘’«»`),\s.!?]+$/g, "")
    .trim();
}

/**
 * Normalizes text for accent-tolerant matching (strips diacritics).
 */
export function stripAccents(str: string): string {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

/**
 * Extracts multiple meaningful candidate phrases from a translation or hint string.
 * E.g., "neo đậu, neo thuyền (hàng hải)" -> ["neo thuyền", "neo đậu"]
 */
export function extractCandidatePhrases(rawText?: string): string[] {
  if (!rawText) return [];

  const candidates: string[] = [];
  const seen = new Set<string>();

  const addCandidate = (val?: string) => {
    if (!val) return;
    const cleaned = cleanCandidateString(val);
    if (!cleaned || cleaned.length < 2) return;
    const lower = cleaned.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      candidates.push(cleaned);
    }
  };

  // Add the full cleaned string first
  addCandidate(rawText);

  // Remove content inside parentheses and try
  const withoutParens = rawText.replace(/\([^)]*\)/g, " ").trim();
  if (withoutParens && withoutParens !== rawText) {
    addCandidate(withoutParens);
  }

  // Split on commas, semicolons, slashes, pipes, or newlines
  const parts = rawText.split(/[,;\/|\n\t]/);
  for (const part of parts) {
    addCandidate(part);
    const subPartNoParens = part.replace(/\([^)]*\)/g, " ").trim();
    if (subPartNoParens && subPartNoParens !== part) {
      addCandidate(subPartNoParens);
    }
  }

  // Sort longest candidates first to avoid false-positive subword collisions (e.g. "neo đậu" before "neo")
  return candidates.sort((a, b) => b.length - a.length);
}

/**
 * Finds a candidate substring inside the sentence with case-insensitivity.
 * Falls back to accent-insensitive matching if direct search fails.
 */
export function findSubstringInSentence(
  sentence: string,
  candidate: string
): { start: number; end: number; match: string } | null {
  if (!sentence || !candidate) return null;

  const target = cleanCandidateString(candidate);
  if (!target || target.length < 2) return null;

  const lowerSentence = sentence.toLowerCase();
  const lowerTarget = target.toLowerCase();

  // 1. Exact case-insensitive substring match
  const directIdx = lowerSentence.indexOf(lowerTarget);
  if (directIdx !== -1) {
    return {
      start: directIdx,
      end: directIdx + target.length,
      match: sentence.substring(directIdx, directIdx + target.length),
    };
  }

  // 2. Diacritic-tolerant matching (useful for Vietnamese or French/Spanish accents)
  const normSentence = stripAccents(sentence);
  const normTarget = stripAccents(target);
  const normIdx = normSentence.indexOf(normTarget);
  if (normIdx !== -1) {
    // Return the slice from the original sentence corresponding to that length
    return {
      start: normIdx,
      end: normIdx + target.length,
      match: sentence.substring(normIdx, normIdx + target.length),
    };
  }

  return null;
}

export interface HighlightResolutionResult {
  cleanSentence: string;
  highlightWord: string | null;
  startIndex: number;
  endIndex: number;
  source: "markdown" | "llm_explicit" | "collection_translation" | "words_deck" | "key_target_words" | "none";
}

/**
 * Resolves which word or phrase in nativeSentence should be highlighted,
 * adhering to the priority order:
 * 1. Markdown syntax in the sentence (**word** or <mark>word</mark>)
 * 2. LLM-provided explicit `targetWordInNativeSentence`
 * 3. `targetWordFromCollection.nativeWordInSentence`
 * 4. Fallback: `targetWordFromCollection.translation`
 * 5. Fallback: Matching word in user collection deck (`word.translation`)
 * 6. Fallback: `keyTargetWords` translations
 */
export function resolveTargetHighlight(
  sentence?: string,
  challenge?: Partial<ChallengeData> | null,
  words?: Word[]
): HighlightResolutionResult {
  if (!sentence) {
    return {
      cleanSentence: "",
      highlightWord: null,
      startIndex: -1,
      endIndex: -1,
      source: "none",
    };
  }

  // Step 1: Check markdown markers in sentence
  const { cleanText, extractedMarker } = stripMarkdownMarkers(sentence);
  if (extractedMarker) {
    const found = findSubstringInSentence(cleanText, extractedMarker);
    if (found) {
      return {
        cleanSentence: cleanText,
        highlightWord: found.match,
        startIndex: found.start,
        endIndex: found.end,
        source: "markdown",
      };
    }
  }

  // Step 2: Explicit targetWordInNativeSentence from LLM
  const explicitLlmTarget = cleanCandidateString(
    challenge?.targetWordInNativeSentence ||
    challenge?.targetWordFromCollection?.nativeWordInSentence
  );
  if (explicitLlmTarget) {
    const found = findSubstringInSentence(cleanText, explicitLlmTarget);
    if (found) {
      return {
        cleanSentence: cleanText,
        highlightWord: found.match,
        startIndex: found.start,
        endIndex: found.end,
        source: "llm_explicit",
      };
    }
  }

  // Step 3: Fallback to targetWordFromCollection translation
  const targetColTranslation = challenge?.targetWordFromCollection?.translation;
  if (targetColTranslation) {
    const candidates = extractCandidatePhrases(targetColTranslation);
    for (const cand of candidates) {
      const found = findSubstringInSentence(cleanText, cand);
      if (found) {
        return {
          cleanSentence: cleanText,
          highlightWord: found.match,
          startIndex: found.start,
          endIndex: found.end,
          source: "collection_translation",
        };
      }
    }
  }

  // Step 4: Fallback to collection words matching targetWordFromCollection
  const targetEnglishWord = challenge?.targetWordFromCollection?.word?.toLowerCase().trim();
  if (targetEnglishWord && Array.isArray(words) && words.length > 0) {
    const matchedWord = words.find(
      (w) => w.word.toLowerCase().trim() === targetEnglishWord || (challenge?.targetWordFromCollection?.id && w.id === challenge.targetWordFromCollection.id)
    );
    if (matchedWord) {
      const colCandidates = [
        ...extractCandidatePhrases(matchedWord.translation),
        ...extractCandidatePhrases(matchedWord.definition),
      ];
      if (Array.isArray(matchedWord.senses)) {
        for (const sense of matchedWord.senses) {
          colCandidates.push(...extractCandidatePhrases(sense.translation));
        }
      }
      colCandidates.sort((a, b) => b.length - a.length);

      for (const cand of colCandidates) {
        const found = findSubstringInSentence(cleanText, cand);
        if (found) {
          return {
            cleanSentence: cleanText,
            highlightWord: found.match,
            startIndex: found.start,
            endIndex: found.end,
            source: "words_deck",
          };
        }
      }
    }
  }

  // Step 5: Fallback to keyTargetWords
  if (Array.isArray(challenge?.keyTargetWords) && challenge.keyTargetWords.length > 0) {
    // Prioritize the clue matching targetEnglishWord if present
    const clues = [...challenge.keyTargetWords].sort((a, b) => {
      const aMatches = targetEnglishWord && a.word.toLowerCase().trim() === targetEnglishWord;
      const bMatches = targetEnglishWord && b.word.toLowerCase().trim() === targetEnglishWord;
      if (aMatches && !bMatches) return -1;
      if (!aMatches && bMatches) return 1;
      return 0;
    });

    for (const clue of clues) {
      const clueCandidates = extractCandidatePhrases(clue.translation);
      for (const cand of clueCandidates) {
        const found = findSubstringInSentence(cleanText, cand);
        if (found) {
          return {
            cleanSentence: cleanText,
            highlightWord: found.match,
            startIndex: found.start,
            endIndex: found.end,
            source: "key_target_words",
          };
        }
      }
    }
  }

  return {
    cleanSentence: cleanText,
    highlightWord: null,
    startIndex: -1,
    endIndex: -1,
    source: "none",
  };
}

export interface SentenceSegment {
  text: string;
  isHighlight: boolean;
}

/**
 * Breaks a sentence into segments before, inside, and after the highlight
 * for straightforward React rendering.
 */
export function getHighlightedSentenceSegments(
  sentence?: string,
  challenge?: Partial<ChallengeData> | null,
  words?: Word[]
): {
  cleanSentence: string;
  highlightWord: string | null;
  segments: SentenceSegment[];
} {
  const { cleanSentence, highlightWord, startIndex, endIndex } = resolveTargetHighlight(
    sentence,
    challenge,
    words
  );

  if (!highlightWord || startIndex === -1 || endIndex <= startIndex) {
    return {
      cleanSentence,
      highlightWord: null,
      segments: [{ text: cleanSentence, isHighlight: false }],
    };
  }

  const before = cleanSentence.substring(0, startIndex);
  const highlighted = cleanSentence.substring(startIndex, endIndex);
  const after = cleanSentence.substring(endIndex);

  const segments: SentenceSegment[] = [];
  if (before) segments.push({ text: before, isHighlight: false });
  segments.push({ text: highlighted, isHighlight: true });
  if (after) segments.push({ text: after, isHighlight: false });

  return {
    cleanSentence,
    highlightWord: highlighted,
    segments,
  };
}
