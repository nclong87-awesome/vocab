import { jsonrepair } from "jsonrepair";

/**
 * Fix unescaped control characters inside double-quoted string literals in JSON
 */
function escapeControlCharsInStrings(str: string): string {
  return str.replace(/"([^"\\]*(?:\\.[^"\\]*)*)"/g, (match) => {
    return match
      .replace(/\r?\n/g, "\\n")
      .replace(/\r/g, "\\r")
      .replace(/\t/g, "\\t");
  });
}

/**
 * Normalizes invalid or illegal backslash escape sequences in JSON text.
 * In JSON standard (RFC 8259), the only valid escape characters after a backslash are:
 * ", \, /, b, f, n, r, t, or uXXXX.
 * LLMs often output markdown-escaped lists (\1., \2., \*, \., \-, \(, etc.) or literal slashes without escaping.
 */
function fixIllegalEscapeSequences(str: string): string {
  // Replace illegal escape sequences inside string literals:
  // e.g. \1 -> 1, \2 -> 2, \* -> *, \. -> ., \( -> (, \] -> ]
  // We match backslash followed by any character that is NOT ", \, /, b, f, n, r, t, or u
  return str.replace(/\\([^"\\/bfnrtu])/gi, (_match, char) => {
    // If it's a digit (like \1, \2) or markdown character (\*, \-, \+, \., \_), unescape it
    return char;
  });
}

/**
 * Fixes mistakenly escaped boundary quotes where the LLM accidentally escaped the closing quote
 * e.g. `\"*\", "vocabularyCandidates":` -> `\"*\", "vocabularyCandidates":` where trailing `\"` before `,` should be `"`
 */
function fixMistakenlyEscapedBoundaryQuotes(str: string): string {
  let result = str;
  // Match patterns like `\"*, "key":` or `\"*,  \n  "` where `\"` was placed right before a comma or property key
  result = result.replace(/\\"\s*,\s*(["}\]])/g, '", $1');
  result = result.replace(/\\"\s*\n\s*,\s*(["}\]])/g, '"\n, $1');
  result = result.replace(/\\"\s*:\s*/g, '": ');
  return result;
}

/**
 * Attempts to auto-close truncated JSON string (missing closing quotes, brackets, braces)
 */
function fixTruncatedJson(str: string): string {
  let cleaned = str.trim();

  // If ends with a trailing comma or colon, remove it
  cleaned = cleaned.replace(/[\s,:]+$/, "");

  // Count open vs closed quotes
  let inString = false;
  let escaped = false;
  const stack: string[] = [];

  for (let i = 0; i < cleaned.length; i++) {
    const char = cleaned[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === "{" || char === "[") {
        stack.push(char);
      } else if (char === "}") {
        if (stack.length > 0 && stack[stack.length - 1] === "{") {
          stack.pop();
        }
      } else if (char === "]") {
        if (stack.length > 0 && stack[stack.length - 1] === "[") {
          stack.pop();
        }
      }
    }
  }

  // Close unclosed string
  if (inString) {
    cleaned += '"';
  }

  // Strip any trailing key/colon left at end of string
  cleaned = cleaned.replace(/,\s*"[^"]*"\s*:\s*$/g, "");
  cleaned = cleaned.replace(/,\s*$/g, "");

  // Close remaining open brackets/braces in reverse order
  while (stack.length > 0) {
    const opening = stack.pop();
    if (opening === "{") {
      cleaned += "}";
    } else if (opening === "[") {
      cleaned += "]";
    }
  }

  return cleaned;
}

/**
 * Normalizes missing commas between adjacent JSON objects or elements.
 * e.g. `{ "a": 1 } { "b": 2 }` -> `{ "a": 1 }, { "b": 2 }`
 */
function fixMissingCommas(str: string): string {
  let result = str;

  // Between closing brace/bracket or primitive value and next opening brace/bracket or quote
  result = result.replace(/(\}|\]|"(?:\\.|[^"\\])*"|\b(?:true|false|null|\d+(?:\.\d+)?))\s*\n?\s*(\{|\[|"(?:\\.|[^"\\])*")/g, (match, p1, p2) => {
    // Avoid inserting comma if match already contains a comma or colon separator
    if (match.includes(",")) return match;
    return `${p1}, ${p2}`;
  });

  // Remove trailing commas before closing braces/brackets
  result = result.replace(/,\s*([\}\]])/g, "$1");

  return result;
}

/**
 * Fallback regex extractor for grammar/polish response structures when strict JSON syntax fails
 */
export function extractGrammarPolishFallback(rawText: string): any | null {
  try {
    if (!rawText || !rawText.includes("fixedSentence") && !rawText.includes("vocabularyCandidates")) {
      return null;
    }

    const fixedSentenceMatch = rawText.match(/"fixedSentence"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    const fixedSentence = fixedSentenceMatch ? fixedSentenceMatch[1].replace(/\\"/g, '"').replace(/\\n/g, "\n") : "";

    // Extract explanation: anything between "explanation": " and "vocabularyCandidates" or next key
    let explanation = "";
    const explanationMatch = rawText.match(/"explanation"\s*:\s*"([\s\S]*?)(?:(?:"\s*,\s*"vocabularyCandidates")|(?:"\s*,\s*"[a-zA-Z]+"\s*:)|(?:",?\s*\}))/);
    if (explanationMatch) {
      explanation = explanationMatch[1].replace(/\\"/g, '"').replace(/\\n/g, "\n").replace(/\\([1-9]|\*)/g, "$1");
    }

    // Extract vocabulary candidates array if present
    const vocabList: any[] = [];
    const vocabBlockMatch = rawText.match(/"vocabularyCandidates"\s*:\s*(\[\s*[\s\S]*?\s*\])/);
    if (vocabBlockMatch) {
      try {
        const cleanedVocab = cleanJsonResponse(vocabBlockMatch[1]);
        const parsed = JSON.parse(cleanedVocab);
        if (Array.isArray(parsed)) {
          vocabList.push(...parsed);
        }
      } catch {
        // Individual item regex extraction
        const itemMatches = [...vocabBlockMatch[1].matchAll(/\{\s*"word"\s*:\s*"([^"]+)"\s*,\s*"definition"\s*:\s*"([^"]+)"\s*,\s*"translation"\s*:\s*"([^"]+)"(?:\s*,\s*"reason"\s*:\s*"([^"]+)")?\s*\}/g)];
        for (const m of itemMatches) {
          vocabList.push({
            word: m[1],
            definition: m[2],
            translation: m[3],
            reason: m[4] || ""
          });
        }
      }
    }

    if (fixedSentence || explanation || vocabList.length > 0) {
      return {
        fixedSentence: fixedSentence || "Polished sentence",
        explanation: explanation || "Grammar and phrasing breakdown",
        vocabularyCandidates: vocabList
      };
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Cleans and repairs a raw text response from an LLM into valid JSON string format.
 */
export function cleanJsonResponse(rawText: string): string {
  if (!rawText) return "";
  let text = String(rawText).trim();

  // Strip <think>...</think> tags if present from chain-of-thought models
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

  // 1. Return immediately if already strictly valid JSON
  try {
    JSON.parse(text);
    return text;
  } catch {
    // Proceed with cleaning steps
  }

  // 2. Replace smart/curly quotes
  text = text.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");

  // 3. Strip Markdown code blocks (e.g. ```json ... ```)
  if (text.includes("```")) {
    const codeBlockMatch = text.match(/```(?:json|javascript|js)?\s*([\s\S]*?)\s*```/i);
    if (codeBlockMatch && codeBlockMatch[1]?.trim()) {
      text = codeBlockMatch[1].trim();
    } else {
      text = text.replace(/```(?:json|javascript|js)?\s*/gi, "").replace(/\s*```/g, "").trim();
    }
  }

  // 4. Extract outer JSON payload ({...} or [...])
  const firstSquare = text.indexOf("[");
  const lastSquare = text.lastIndexOf("]");
  const firstCurly = text.indexOf("{");
  const lastCurly = text.lastIndexOf("}");

  let startIdx = -1;
  let endIdx = -1;

  if (firstSquare !== -1 && (firstCurly === -1 || firstSquare < firstCurly)) {
    startIdx = firstSquare;
    endIdx = lastSquare;
  } else if (firstCurly !== -1) {
    startIdx = firstCurly;
    endIdx = lastCurly;
  }

  if (startIdx !== -1) {
    if (endIdx !== -1 && endIdx > startIdx) {
      text = text.substring(startIdx, endIdx + 1).trim();
    } else {
      text = text.substring(startIdx).trim();
    }
  }

  // 5. Try parsing after boundary extraction
  try {
    JSON.parse(text);
    return text;
  } catch {
    // Continue
  }

  // 6. Fix illegal escape sequences (e.g. \1., \2., \*, \.)
  text = fixIllegalEscapeSequences(text);

  // 7. Fix mistakenly escaped boundary quotes (e.g. \"*\", "key":)
  text = fixMistakenlyEscapedBoundaryQuotes(text);

  // 8. Escape control characters inside string literals
  text = escapeControlCharsInStrings(text);

  // 9. Strip single line or multiline JS/JSON comments
  text = text.replace(/\/\*[\s\S]*?\*\//g, "");

  // 10. Fix missing commas and trailing commas
  text = fixMissingCommas(text);

  // 11. Check if valid now
  try {
    JSON.parse(text);
    return text;
  } catch {
    // Continue
  }

  // 12. Attempt jsonrepair on current text
  try {
    const repaired = jsonrepair(text);
    JSON.parse(repaired);
    return repaired;
  } catch {
    // Continue
  }

  // 13. Attempt auto-closing truncated JSON
  try {
    const truncatedFixed = fixTruncatedJson(text);
    const repairedTruncated = jsonrepair(truncatedFixed);
    JSON.parse(repairedTruncated);
    return repairedTruncated;
  } catch {
    // Continue
  }

  // 14. Attempt jsonrepair directly on raw original input with escape fixes
  try {
    const cleanedRaw = fixMistakenlyEscapedBoundaryQuotes(fixIllegalEscapeSequences(rawText));
    const repairedRaw = jsonrepair(cleanedRaw);
    JSON.parse(repairedRaw);
    return repairedRaw;
  } catch {
    // Continue
  }

  // Return best effort cleaned string
  return text;
}

/**
 * Cleans, repairs, and safely parses a raw LLM text response into a JavaScript object or array.
 * If parsing fails after all repairs, checks schema fallbacks or returns fallbackDefault.
 */
export function cleanAndParseJson<T = any>(rawText: string, fallbackDefault?: T): T {
  const cleaned = cleanJsonResponse(rawText);
  try {
    return JSON.parse(cleaned) as T;
  } catch (err: any) {
    // Final desperate repair attempt with jsonrepair force
    try {
      const repaired = jsonrepair(cleaned);
      return JSON.parse(repaired) as T;
    } catch {
      // Check if this is a grammar/polish payload that can be salvaged via regex extraction
      const grammarFallback = extractGrammarPolishFallback(rawText) || extractGrammarPolishFallback(cleaned);
      if (grammarFallback) {
        return grammarFallback as T;
      }

      if (fallbackDefault !== undefined) {
        console.warn("[cleanAndParseJson] Failed to parse JSON even after repair. Using fallback default.", err);
        return fallbackDefault;
      }
      throw new Error(`Invalid JSON response from AI model: ${err?.message || "Syntax error"}`);
    }
  }
}

/**
 * Safely extracts an array of word objects from any AI payload structure.
 * Handles top-level arrays `[ ... ]`, object properties `{ words: [ ... ] }`, `{ data: [ ... ] }`, `{ items: [ ... ] }`,
 * or object maps with numeric keys `{ "0": { ... }, "1": { ... } }`.
 */
export function extractWordsFromPayload(data: any): any[] {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.words)) return data.words;
  if (Array.isArray(data.data)) return data.data;
  if (Array.isArray(data.items)) return data.items;
  if (Array.isArray(data.vocabulary)) return data.vocabulary;
  if (Array.isArray(data.vocabularyCandidates)) return data.vocabularyCandidates;
  if (Array.isArray(data.candidates)) return data.candidates;
  if (Array.isArray(data.list)) return data.list;
  if (Array.isArray(data.result)) return data.result;

  if (typeof data === "object" && data !== null) {
    // Check if data is an object map created by spreading an array ({ "0": { word: ... }, "1": ... })
    const numericKeys = Object.keys(data).filter((k) => !isNaN(Number(k)));
    if (numericKeys.length > 0) {
      const arr = numericKeys
        .sort((a, b) => Number(a) - Number(b))
        .map((k) => data[k])
        .filter((item) => item && typeof item === "object");
      if (arr.length > 0) return arr;
    }

    // Check if any key contains an array of objects with 'word' or 'term' or 'definition'
    for (const key of Object.keys(data)) {
      const val = data[key];
      if (Array.isArray(val) && val.length > 0) {
        if (typeof val[0] === "object" && val[0] !== null && ("word" in val[0] || "term" in val[0] || "definition" in val[0])) {
          return val;
        }
      }
    }
  }

  return [];
}

/**
 * Unescapes literal escape sequences (e.g. \n, \", \t) in text strings
 */
export function unescapeStringContent(str: string): string {
  if (!str) return "";
  let res = str;
  // Replace literal escaped newlines with actual newlines
  res = res.replace(/\\n/g, "\n");
  res = res.replace(/\\r/g, "");
  res = res.replace(/\\t/g, "  ");
  // Replace literal escaped quotes with regular quotes
  res = res.replace(/\\"/g, '"');
  res = res.replace(/\\'/g, "'");
  // Normalize redundant line breaks
  res = res.replace(/\n{3,}/g, "\n\n");
  return res.trim();
}

/**
 * Intelligently joins string chunks/tokens from an LLM array response into coherent Markdown paragraphs
 */
function joinStringChunks(chunks: (string | number)[]): string {
  let combined = "";
  for (let idx = 0; idx < chunks.length; idx++) {
    const rawChunk = String(chunks[idx]);
    if (rawChunk === "") continue;

    if (idx === 0 || combined === "") {
      combined = rawChunk;
      continue;
    }

    const prev = combined;
    const prevEndsWithWs = /[\s\n]$/.test(prev);
    const chunkStartsWithWs = /^[\s\n]/.test(rawChunk);
    const chunkStartsWithPunct = /^[,.:;!?')\]}\/]/.test(rawChunk);
    const chunkIsApostropheContinuation = /^['’][a-zA-Z]/.test(rawChunk);

    if (prevEndsWithWs || chunkStartsWithWs || chunkStartsWithPunct || chunkIsApostropheContinuation) {
      combined += rawChunk;
    } else {
      if (prev.endsWith("\n") || rawChunk.startsWith("\n")) {
        combined += rawChunk;
      } else {
        combined += " " + rawChunk;
      }
    }
  }

  return unescapeStringContent(combined);
}

/**
 * Transforms any raw LLM response (whether plain text, JSON object, array of strings, or markdown-wrapped JSON)
 * into clean, beautifully formatted Markdown.
 */
export function formatLlmResponseText(rawText: string): string {
  if (!rawText) return "";
  let trimmed = String(rawText).trim();

  // Strip <think>...</think> reasoning tags
  trimmed = trimmed.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

  // Strip outer markdown code blocks if the whole content is inside ```json ... ``` or ``` ... ```
  if (trimmed.startsWith("```")) {
    const codeBlockMatch = trimmed.match(/^```(?:json|javascript|js)?\s*([\s\S]*?)\s*```$/i);
    if (codeBlockMatch && codeBlockMatch[1]?.trim()) {
      trimmed = codeBlockMatch[1].trim();
    }
  }

  // Check if text starts with [ or { and could be JSON
  const isArrayLike = trimmed.startsWith("[") && (trimmed.endsWith("]") || trimmed.includes("]"));
  const isObjectLike = trimmed.startsWith("{") && (trimmed.endsWith("}") || trimmed.includes("}"));

  if (isArrayLike || isObjectLike) {
    try {
      const parsed = cleanAndParseJson(trimmed);

      // Case 1: Array of items (e.g. array of token strings, or list of objects)
      if (Array.isArray(parsed)) {
        // 1a. Array of primitive strings / numbers / tokens
        if (parsed.every((item) => typeof item === "string" || typeof item === "number")) {
          return joinStringChunks(parsed);
        }

        // 1b. Array of objects (e.g. list of vocabulary terms or points)
        if (parsed.every((item) => typeof item === "object" && item !== null)) {
          const formattedList = parsed.map((item, idx) => {
            if (item.word || item.term) {
              const w = item.word || item.term;
              const t = item.translation || item.definition || item.meaning || "";
              const ex = item.example ? `\n> *Example:* ${item.example}` : "";
              return `${idx + 1}. **${w}**${t ? ` — ${t}` : ""}${ex}`;
            }
            if (item.title || item.heading) {
              const h = item.title || item.heading;
              const desc = item.description || item.content || item.text || "";
              return `**${h}**\n${desc}`;
            }
            return Object.entries(item)
              .map(([k, v]) => `**${k.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase())}:** ${typeof v === "object" ? JSON.stringify(v) : v}`)
              .join("\n");
          });
          return formattedList.join("\n\n");
        }
      }

      // Case 2: Object representation
      if (typeof parsed === "object" && parsed !== null) {
        // Direct single message property wrapper
        if (parsed.text && typeof parsed.text === "string" && !parsed.translation && !parsed.explanation) {
          return formatLlmResponseText(parsed.text);
        }
        if (parsed.message && typeof parsed.message === "string" && !parsed.translation && !parsed.explanation) {
          return formatLlmResponseText(parsed.message);
        }
        if (parsed.response && typeof parsed.response === "string" && !parsed.translation && !parsed.explanation) {
          return formatLlmResponseText(parsed.response);
        }
        if (parsed.answer && typeof parsed.answer === "string" && !parsed.translation && !parsed.explanation) {
          return formatLlmResponseText(parsed.answer);
        }
        if (parsed.content && typeof parsed.content === "string" && !parsed.translation && !parsed.explanation) {
          return formatLlmResponseText(parsed.content);
        }
        if (parsed.output && typeof parsed.output === "string" && !parsed.translation && !parsed.explanation) {
          return formatLlmResponseText(parsed.output);
        }
        if (parsed.reply && typeof parsed.reply === "string" && !parsed.translation && !parsed.explanation) {
          return formatLlmResponseText(parsed.reply);
        }

        // Structured language explanation schema
        const parts: string[] = [];

        if (parsed.greeting || parsed.greetingMessage) {
          parts.push(parsed.greeting || parsed.greetingMessage);
        }
        if (parsed.translation) {
          parts.push(`**Translation:** ${parsed.translation}`);
        }
        if (parsed.meaning || parsed.definition) {
          parts.push(`**Meaning:** ${parsed.meaning || parsed.definition}`);
        }
        if (parsed.partOfSpeech || parsed.part_of_speech) {
          parts.push(`**Part of Speech / Nuance:** ${parsed.partOfSpeech || parsed.part_of_speech}`);
        }
        if (parsed.explanation || parsed.breakdown || parsed.details) {
          parts.push(`**Explanation:**\n${parsed.explanation || parsed.breakdown || parsed.details}`);
        }
        if (parsed.example || parsed.exampleSentence || parsed.examples) {
          const ex = parsed.example || parsed.exampleSentence || (Array.isArray(parsed.examples) ? parsed.examples.join("\n- ") : parsed.examples);
          parts.push(`**Example:**\n${ex}`);
        }
        if (parsed.exampleTranslation || parsed.example_translation) {
          parts.push(`*Example Translation:* ${parsed.exampleTranslation || parsed.example_translation}`);
        }
        if (parsed.hint || parsed.clue) {
          parts.push(`💡 **Hint:** ${parsed.hint || parsed.clue}`);
        }
        if (parsed.alternatives || parsed.alternativeTranslations) {
          const alts = Array.isArray(parsed.alternatives || parsed.alternativeTranslations)
            ? (parsed.alternatives || parsed.alternativeTranslations).map((a: any) => `- ${typeof a === "object" ? (a.translation || a.text || JSON.stringify(a)) : a}`).join("\n")
            : (parsed.alternatives || parsed.alternativeTranslations);
          parts.push(`**Alternatives:**\n${alts}`);
        }
        if (parsed.closing || parsed.followUp || parsed.question) {
          parts.push(parsed.closing || parsed.followUp || parsed.question);
        }

        if (parts.length > 0) {
          return parts.join("\n\n");
        }

        return Object.entries(parsed)
          .map(([key, val]) => `**${key.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}:** ${typeof val === "object" ? JSON.stringify(val) : val}`)
          .join("\n\n");
      }
    } catch {
      // Regex fallback if JSON parsing failed but string is a string array format: ["...", "..."]
      const stringMatches = [...trimmed.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(m => m[1]);
      if (stringMatches.length >= 2 && trimmed.startsWith("[")) {
        return joinStringChunks(stringMatches);
      }
    }
  }

  // Handle literal escaped newlines or quotes in regular text
  return unescapeStringContent(trimmed);
}

