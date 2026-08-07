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

  // 6. Escape control characters inside string literals
  text = escapeControlCharsInStrings(text);

  // 7. Strip single line or multiline JS/JSON comments
  text = text.replace(/\/\*[\s\S]*?\*\//g, "");

  // 8. Fix missing commas and trailing commas
  text = fixMissingCommas(text);

  // 9. Check if valid now
  try {
    JSON.parse(text);
    return text;
  } catch {
    // Continue
  }

  // 10. Attempt jsonrepair on current text
  try {
    const repaired = jsonrepair(text);
    JSON.parse(repaired);
    return repaired;
  } catch {
    // Continue
  }

  // 11. Attempt auto-closing truncated JSON
  try {
    const truncatedFixed = fixTruncatedJson(text);
    const repairedTruncated = jsonrepair(truncatedFixed);
    JSON.parse(repairedTruncated);
    return repairedTruncated;
  } catch {
    // Continue
  }

  // 12. Attempt jsonrepair directly on raw original input
  try {
    const repairedRaw = jsonrepair(rawText);
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
 * If parsing fails after all repairs, returns fallbackDefault or throws a descriptive error if no fallback is provided.
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
      if (fallbackDefault !== undefined) {
        console.warn("[cleanAndParseJson] Failed to parse JSON even after repair. Using fallback default.", err);
        return fallbackDefault;
      }
      throw new Error(`Invalid JSON response from AI model: ${err?.message || "Syntax error"}`);
    }
  }
}
