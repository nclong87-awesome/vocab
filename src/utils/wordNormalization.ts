import pluralize from "pluralize";
import { Word } from "../types";

const singularCache = new Map<string, string>();
const pluralCache = new Map<string, string>();
const equivalentCache = new Map<string, boolean>();

/**
 * Normalizes a word for loose vocabulary comparison.
 * Trims whitespace, converts to lowercase, and converts to singular form.
 */
export function normalizeWordForComparison(word?: string | null): string {
  if (!word || typeof word !== "string") return "";
  const cleaned = word.trim().toLowerCase();
  if (!cleaned) return "";

  const cached = singularCache.get(cleaned);
  if (cached !== undefined) return cached;

  let singular = cleaned;
  try {
    singular = pluralize.singular(cleaned) || cleaned;
  } catch {
    singular = cleaned;
  }
  singularCache.set(cleaned, singular);
  return singular;
}

/**
 * Gets the plural form of a word for comparison, with caching.
 */
export function getPluralForComparison(word: string): string {
  const cached = pluralCache.get(word);
  if (cached !== undefined) return cached;
  let p = word;
  try {
    p = pluralize.plural(word) || word;
  } catch {
    p = word;
  }
  pluralCache.set(word, p);
  return p;
}

/**
 * Checks if two words are equivalent in vocabulary context.
 * Considers exact case-insensitive matches, as well as singular/plural variants
 * (e.g. "benchmark" and "benchmarks", "apple" and "apples", "criteria" and "criterion").
 */
export function areWordsEquivalent(word1?: string | null, word2?: string | null): boolean {
  if (!word1 || !word2) return false;
  const w1 = word1.trim().toLowerCase();
  const w2 = word2.trim().toLowerCase();

  // 1. Exact case-insensitive match
  if (w1 === w2) return true;
  if (!w1 || !w2) return false;

  const cacheKey = w1 < w2 ? `${w1}|||${w2}` : `${w2}|||${w1}`;
  const cached = equivalentCache.get(cacheKey);
  if (cached !== undefined) return cached;

  let result = false;
  // 2. Normalized singular comparison
  const s1 = normalizeWordForComparison(w1);
  const s2 = normalizeWordForComparison(w2);
  if (s1 && s2 && s1 === s2) {
    result = true;
  } else {
    // 3. Plural check
    try {
      const p1 = getPluralForComparison(w1);
      const p2 = getPluralForComparison(w2);
      if (p1 && p2 && p1 === p2) result = true;
      else if (p1 === w2 || p2 === w1 || s1 === w2 || s2 === w1) result = true;
    } catch {
      result = false;
    }
  }

  equivalentCache.set(cacheKey, result);
  return result;
}

/**
 * Finds a matching word in the user's collection, taking into account
 * singular and plural forms (e.g. searching "benchmarks" will find "benchmark" or vice-versa).
 */
export function findWordInCollection(words: Word[], targetWord?: string | null): Word | undefined {
  if (!words || !Array.isArray(words) || words.length === 0 || !targetWord) return undefined;
  const targetClean = targetWord.trim().toLowerCase();
  if (!targetClean) return undefined;

  // Fast path 1: Exact string match (no pluralize needed)
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w.word && w.word.trim().toLowerCase() === targetClean) {
      return w;
    }
  }

  // Fast path 2: Normalized singular match
  const targetSingular = normalizeWordForComparison(targetClean);
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w.word) {
      const wSingular = normalizeWordForComparison(w.word);
      if (wSingular === targetSingular) {
        return w;
      }
    }
  }

  // Fast path 3: Full equivalence check
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (areWordsEquivalent(w.word, targetClean)) {
      return w;
    }
  }

  return undefined;
}

/**
 * Checks if a word (or its singular/plural form) already exists in the collection.
 */
export function isWordInCollection(words: Word[], targetWord?: string | null): boolean {
  return Boolean(findWordInCollection(words, targetWord));
}

/**
 * Checks if a word is marked as incomplete (temporarily added from suggestions, pending completion, or missing details like pronunciation or example).
 */
export function isIncompleteWord(word?: Partial<Word> | null): boolean {
  if (!word) return true;
  if (word.completed === false) return true;
  if (!word.pronunciation || word.pronunciation === "/.../" || word.pronunciation === "/ ... /" || !word.pronunciation.trim()) return true;
  if (!word.definition || !word.definition.trim()) return true;
  if (!word.translation || !word.translation.trim()) return true;
  if (!word.example || !word.example.trim()) return true;
  return false;
}

/**
 * Checks if a word is fully completed.
 */
export function isCompletedWord(word?: Partial<Word> | null): boolean {
  if (!word) return false;
  return !isIncompleteWord(word);
}

/**
 * Checks if a given part-of-speech string indicates that the word is a noun.
 * Supports standard English POS tags ("noun", "proper noun", "countable noun", "n.", "n"),
 * compound phrases ("noun, verb"), and common multilingual variants.
 */
export function isNoun(partOfSpeech?: string | null): boolean {
  if (!partOfSpeech || typeof partOfSpeech !== "string") return false;
  const pos = partOfSpeech.trim().toLowerCase();
  if (pos === "n" || pos === "n.") return true;
  if (
    pos.includes("noun") ||
    pos.includes("danh từ") ||
    pos.includes("sustantivo") ||
    pos.includes("substantiv") ||
    pos.includes("nom") ||
    pos.includes("명사") ||
    pos.includes("名詞") ||
    pos.includes("名词")
  ) {
    return true;
  }
  return false;
}

/**
 * Checks if a word, part-of-speech string, or category indicates a phrasal verb.
 * Detects explicit tags/POS ("phrasal verb", "cụm động từ", etc.),
 * multi-word verb phrases with known particles (e.g. "laugh it off", "look forward to", "break down"),
 * or category tags matching phrasal verbs.
 */
export function isPhrasalVerb(
  word?: string | null,
  partOfSpeech?: string | null,
  category?: string | null
): boolean {
  if (partOfSpeech && typeof partOfSpeech === "string") {
    const pos = partOfSpeech.trim().toLowerCase();
    if (
      pos.includes("phrasal verb") ||
      pos.includes("phrasal") ||
      pos.includes("cụm động từ") ||
      pos.includes("verbo frasal") ||
      pos.includes("verbe à particule") ||
      pos === "pv"
    ) {
      return true;
    }
  }

  if (category && typeof category === "string") {
    const cat = category.trim().toLowerCase();
    if (
      cat.includes("phrasal verb") ||
      cat.includes("phrasal") ||
      cat.includes("cụm động từ")
    ) {
      return true;
    }
  }

  if (word && typeof word === "string") {
    const trimmed = word.trim().toLowerCase();
    // Common English phrasal verb particles
    const particleRegex = /\b(off|out|up|down|in|on|away|over|through|back|into|around|along|across|by|for)\b/i;
    if (particleRegex.test(trimmed) && trimmed.includes(" ")) {
      const parts = trimmed.split(/\s+/);
      // Typical phrasal verbs have between 2 and 4 tokens (e.g. "look into", "laugh it off", "look forward to")
      if (parts.length >= 2 && parts.length <= 4) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Normalizes word category to explicitly include 'Phrasal Verbs' if detected.
 */
export function normalizeWordCategory(
  category?: string | null,
  word?: string | null,
  partOfSpeech?: string | null
): string {
  if (isPhrasalVerb(word, partOfSpeech, category)) {
    if (!category || category === "General" || category === "Vocabulary" || category === "word" || category.trim() === "") {
      return "Phrasal Verbs";
    }
    if (/phrasal/i.test(category)) {
      return "Phrasal Verbs";
    }
    return category;
  }
  return category || "General";
}

/**
 * Normalizes part-of-speech string to 'phrasal verb' if the word is recognized as a phrasal verb.
 */
export function normalizeWordPartOfSpeech(
  partOfSpeech?: string | null,
  word?: string | null,
  category?: string | null
): string {
  if (isPhrasalVerb(word, partOfSpeech, category)) {
    if (
      !partOfSpeech ||
      partOfSpeech === "word" ||
      partOfSpeech === "verb" ||
      partOfSpeech === "expression" ||
      partOfSpeech === "phrase" ||
      partOfSpeech.trim() === ""
    ) {
      return "phrasal verb";
    }
  }
  return partOfSpeech || "word";
}

/**
 * Common English irregular verbs and their inflected forms (past, past participle, 3rd person, gerund).
 */
const IRREGULAR_VERBS: Record<string, string[]> = {
  be: ["is", "am", "are", "was", "were", "been", "being"],
  bear: ["bore", "borne", "bearing", "bears"],
  beat: ["beat", "beaten", "beating", "beats"],
  become: ["became", "become", "becoming", "becomes"],
  begin: ["began", "begun", "beginning", "begins"],
  bend: ["bent", "bending", "bends"],
  bet: ["bet", "betting", "bets"],
  bite: ["bit", "bitten", "biting", "bites"],
  blow: ["blew", "blown", "blowing", "blows"],
  break: ["broke", "broken", "breaking", "breaks"],
  bring: ["brought", "bringing", "brings"],
  build: ["built", "building", "builds"],
  burn: ["burnt", "burned", "burning", "burns"],
  buy: ["bought", "buying", "buys"],
  catch: ["caught", "catching", "catches"],
  choose: ["chose", "chosen", "choosing", "chooses"],
  come: ["came", "come", "coming", "comes"],
  cost: ["cost", "costing", "costs"],
  cut: ["cut", "cutting", "cuts"],
  deal: ["dealt", "dealing", "deals"],
  dig: ["dug", "digging", "digs"],
  do: ["did", "done", "doing", "does"],
  draw: ["drew", "drawn", "drawing", "draws"],
  dream: ["dreamt", "dreamed", "dreaming", "dreams"],
  drink: ["drank", "drunk", "drinking", "drinks"],
  drive: ["drove", "driven", "driving", "drives"],
  drop: ["dropped", "dropping", "drops"],
  eat: ["ate", "eaten", "eating", "eats"],
  fall: ["fell", "fallen", "falling", "falls"],
  feed: ["fed", "feeding", "feeds"],
  feel: ["felt", "feeling", "feels"],
  fight: ["fought", "fighting", "fights"],
  find: ["found", "finding", "finds"],
  fit: ["fitted", "fit", "fitting", "fits"],
  fly: ["flew", "flown", "flying", "flies"],
  forbid: ["forbade", "forbidden", "forbidding", "forbids"],
  forget: ["forgot", "forgotten", "forgetting", "forgets"],
  forgive: ["forgave", "forgiven", "forgiving", "forgives"],
  freeze: ["froze", "frozen", "freezing", "freezes"],
  get: ["got", "gotten", "getting", "gets"],
  give: ["gave", "given", "giving", "gives"],
  go: ["went", "gone", "going", "goes"],
  grow: ["grew", "grown", "growing", "grows"],
  hang: ["hung", "hanged", "hanging", "hangs"],
  have: ["had", "having", "has"],
  hear: ["heard", "hearing", "hears"],
  hide: ["hid", "hidden", "hiding", "hides"],
  hit: ["hit", "hitting", "hits"],
  hold: ["held", "holding", "holds"],
  hurt: ["hurt", "hurting", "hurts"],
  keep: ["kept", "keeping", "keeps"],
  know: ["knew", "known", "knowing", "knows"],
  lay: ["laid", "laying", "lays"],
  lead: ["led", "leading", "leads"],
  leave: ["left", "leaving", "leaves"],
  lend: ["lent", "lending", "lends"],
  let: ["let", "letting", "lets"],
  lie: ["lay", "lain", "lying", "lies"],
  lose: ["lost", "losing", "loses"],
  make: ["made", "making", "makes"],
  mean: ["meant", "meaning", "means"],
  meet: ["met", "meeting", "meets"],
  pay: ["paid", "paying", "pays"],
  put: ["put", "putting", "puts"],
  quit: ["quit", "quitting", "quits"],
  read: ["read", "reading", "reads"],
  ride: ["rode", "ridden", "riding", "rides"],
  ring: ["rang", "rung", "ringing", "rings"],
  rise: ["rose", "risen", "rising", "rises"],
  run: ["ran", "run", "running", "runs"],
  say: ["said", "saying", "says"],
  see: ["saw", "seen", "seeing", "sees"],
  seek: ["sought", "seeking", "seeks"],
  sell: ["sold", "selling", "sells"],
  send: ["sent", "sending", "sends"],
  set: ["set", "setting", "sets"],
  shake: ["shook", "shaken", "shaking", "shakes"],
  shine: ["shone", "shining", "shines"],
  shoot: ["shot", "shooting", "shoots"],
  show: ["showed", "shown", "showing", "shows"],
  shut: ["shut", "shutting", "shuts"],
  sing: ["sang", "sung", "singing", "sings"],
  sink: ["sank", "sunk", "sinking", "sinks"],
  sit: ["sat", "sitting", "sits"],
  sleep: ["slept", "sleeping", "sleeps"],
  slide: ["slid", "sliding", "slides"],
  speak: ["spoke", "spoken", "speaking", "speaks"],
  spend: ["spent", "spending", "spends"],
  spin: ["spun", "spinning", "spins"],
  stand: ["stood", "standing", "stands"],
  steal: ["stole", "stolen", "stealing", "steals"],
  stick: ["stuck", "sticking", "sticks"],
  strike: ["struck", "striking", "strikes"],
  sweep: ["swept", "sweeping", "sweeps"],
  swim: ["swam", "swum", "swimming", "swims"],
  swing: ["swung", "swinging", "swings"],
  take: ["took", "taken", "taking", "takes"],
  teach: ["taught", "teaching", "teaches"],
  tear: ["tore", "torn", "tearing", "tears"],
  tell: ["told", "telling", "tells"],
  think: ["thought", "thinking", "thinks"],
  throw: ["threw", "thrown", "throwing", "throws"],
  understand: ["understood", "understanding", "understands"],
  wake: ["woke", "woken", "waking", "wakes"],
  wear: ["wore", "worn", "wearing", "wears"],
  win: ["won", "winning", "wins"],
  withdraw: ["withdrew", "withdrawn", "withdrawing", "withdraws"],
  write: ["wrote", "written", "writing", "writes"],
};

/**
 * Returns common grammatical inflections of a single word/verb.
 */
function getWordInflections(word: string): string[] {
  const w = word.trim().toLowerCase();
  if (!w || w.length < 2) return [w];

  const forms = new Set<string>([w]);

  // Check irregular verb dictionary
  if (IRREGULAR_VERBS[w]) {
    for (const f of IRREGULAR_VERBS[w]) {
      forms.add(f);
    }
  }

  // CVC doubling consonants (e.g. drop -> dropped, dropping; plan -> planned, planning)
  const isCvc = /^[bcdfghjklmnpqrstvwxyz][aeiou][bcdfghjklmnprstvz]$/i.test(w) ||
    /^(?:.*[bcdfghjklmnpqrstvwxyz])?[aeiou][bcdfghjklmnprstvz]$/i.test(w);
  const lastChar = w[w.length - 1];

  if (isCvc && w.length <= 6 && !["w", "x", "y"].includes(lastChar)) {
    forms.add(`${w}${lastChar}ed`);
    forms.add(`${w}${lastChar}ing`);
  }

  // Regular verb rules
  if (w.endsWith("e")) {
    forms.add(`${w}d`);
    forms.add(`${w.slice(0, -1)}ing`);
    forms.add(`${w}s`);
  } else if (w.endsWith("y") && w.length > 2 && !/[aeiou]y$/i.test(w)) {
    forms.add(`${w.slice(0, -1)}ied`);
    forms.add(`${w.slice(0, -1)}ies`);
    forms.add(`${w}ing`);
  } else if (/(?:s|x|z|ch|sh)$/i.test(w)) {
    forms.add(`${w}es`);
    forms.add(`${w}ed`);
    forms.add(`${w}ing`);
  } else {
    forms.add(`${w}s`);
    forms.add(`${w}ed`);
    forms.add(`${w}ing`);
  }

  return Array.from(forms).filter(Boolean);
}

/**
 * Strips dictionary annotations, leading "to", or parenthetical notes from target word.
 * e.g. "(to) drop by" -> "drop by", "drop by (sb)" -> "drop by", "drop by / drop in" -> ["drop by", "drop in"]
 */
function extractTargetWordCandidates(targetWord: string): string[] {
  if (!targetWord) return [];
  const raw = targetWord.trim().toLowerCase();

  // Split by slash if user collection has "term1 / term2"
  const segments = raw.includes("/") ? raw.split("/").map((s) => s.trim()) : [raw];
  const candidates = new Set<string>();

  for (const seg of segments) {
    if (!seg) continue;
    // Strip leading "(to) " or "to "
    let cleaned = seg.replace(/^(?:\(to\)|to)\s+/i, "");
    // Strip parenthetical notes like "(someone)", "(sth)", "(phr. v.)"
    cleaned = cleaned.replace(/\([^)]*\)/g, " ").replace(/\[[^\]]*\]/g, " ").trim();
    // Collapse extra whitespace
    cleaned = cleaned.replace(/\s+/g, " ");
    if (cleaned) {
      candidates.add(cleaned);
    }
  }

  return Array.from(candidates);
}

/**
 * Checks if a user's response text incorporates a specific target word,
 * handling case insensitivity, punctuation, word boundaries, plural/singular forms,
 * and common verb inflections (e.g. "dropped", "dropping", "drops", "streamlined", "streamlining").
 * Also accurately handles phrasal verbs, irregular verbs, and separable particles (e.g. "pick the documents up").
 */
export function hasUserIncorporatedWord(text?: string | null, targetWord?: string | null): boolean {
  if (!text || !targetWord) return false;
  const t = text.trim().toLowerCase();
  if (!t) return false;

  const candidates = extractTargetWordCandidates(targetWord);
  if (candidates.length === 0) return false;

  for (const cand of candidates) {
    // 1. Direct whole-word regex check with non-word boundary matching
    const escaped = cand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const boundaryRegex = new RegExp(`(?:^|[^a-zA-Z0-9_-])${escaped}(?:$|[^a-zA-Z0-9_-])`, "i");
    if (boundaryRegex.test(t)) return true;

    // 2. Multi-word phrase or phrasal verb check (e.g. "drop by", "look into", "pick up")
    if (cand.includes(" ")) {
      const parts = cand.split(/\s+/).filter(Boolean);
      if (parts.length >= 2) {
        const headWord = parts[0];
        const tailWords = parts.slice(1);
        const headForms = getWordInflections(headWord);

        const tailEscaped = tailWords.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
        const headEscapedPattern = headForms.map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");

        // 2a. Contiguous match (e.g. "dropped by", "dropping by", "drops by", "looking into")
        const contiguousRegex = new RegExp(
          `(?:^|[^a-zA-Z0-9_-])(?:${headEscapedPattern})\\s+${tailEscaped}(?:$|[^a-zA-Z0-9_-])`,
          "i"
        );
        if (contiguousRegex.test(t)) return true;

        // 2b. Separable phrasal verb match with up to 4 words in between (e.g. "picked the documents up")
        if (tailWords.length === 1) {
          const singleParticle = tailWords[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const separableRegex = new RegExp(
            `\\b(?:${headEscapedPattern})\\b(?:\\s+[^\\s.,!?;:()]+){1,4}\\s+\\b${singleParticle}\\b`,
            "i"
          );
          if (separableRegex.test(t)) return true;
        }
      }
      continue;
    }

    // 3. Single-word inflections (regular and irregular)
    const allForms = getWordInflections(cand);
    const singular = normalizeWordForComparison(cand);
    const plural = getPluralForComparison(cand);
    if (singular) allForms.push(singular);
    if (plural) allForms.push(plural);

    for (const form of allForms) {
      const escForm = form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp(`(?:^|[^a-zA-Z0-9_-])${escForm}(?:$|[^a-zA-Z0-9_-])`, "i").test(t)) {
        return true;
      }
    }

    // 4. Token-by-token check with grammatical inflections and equivalence
    const tokens = t.replace(/[^\w\s-]/g, " ").split(/\s+/).filter(Boolean);
    for (const token of tokens) {
      if (areWordsEquivalent(token, cand)) return true;
      if (singular && normalizeWordForComparison(token) === singular) return true;
      if (allForms.includes(token)) return true;
    }
  }

  return false;
}

/**
 * Sanitizes "whatWentWell" feedback if the model hallucinated that the user incorporated
 * the target word when in fact they did not.
 */
export function sanitizeEvaluationWhatWentWell(
  whatWentWell?: string | null,
  targetWord?: string | null,
  incorporatedTargetWord?: boolean
): string {
  if (!whatWentWell) return "";
  if (incorporatedTargetWord || !targetWord) return whatWentWell;

  const tw = targetWord.trim();
  const escapedTw = tw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let result = whatWentWell;

  // Regexes matching false target word praise in Vietnamese
  result = result.replace(
    new RegExp(`(?:Bạn\\s+đã\\s+sử\\s+dụng\\s+(?:thành\\s+công\\s+)?(?:từ\\s+vựng\\s+mục\\s+tiêu|cụm\\s+từ\\s+mục\\s+tiêu|từ)\\s+['"]?${escapedTw}['"]?[^,.]*[,.]?\\s*)`, "gi"),
    "Bạn đã truyền tải ý nghĩa câu một cách tự nhiên và dễ hiểu. "
  );

  // Regexes matching false target word praise in English
  result = result.replace(
    new RegExp(`(?:You\\s+(?:successfully\\s+)?(?:incorporated|used)\\s+(?:the\\s+target\\s+word|the\\s+phrase|the\\s+word)?\\s*['"]?${escapedTw}['"]?[^,.]*[,.]?\\s*)`, "gi"),
    "You expressed the meaning naturally and clearly. "
  );

  return result.trim();
}
