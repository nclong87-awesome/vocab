import { Word, QuizQuestion } from "../types";
import { fetchWithTimeout, getStoredAccessCode } from "../utils";
import { areWordsEquivalent, isNoun } from "./wordNormalization";

// Helper function to detect if text contains native language characters (e.g., Vietnamese, CJK when learning English/Spanish/etc.)
export function containsNonTargetLanguage(text: string, targetLanguage?: string): boolean {
  if (!text) return true;
  // Check for Vietnamese diacritics
  const vietnameseRegex = /[àáâãèéêìíòóôõùúýăđĩũơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỷỹỵ]/i;
  if (vietnameseRegex.test(text)) return true;
  
  // Check for CJK characters if target language is English/European
  const cjkRegex = /[\u3000-\u303F\u3040-\u309F\u30A0-\u30FF\uFF00-\uFFEF\u4E00-\u9FAF]/;
  if ((!targetLanguage || targetLanguage === "English" || targetLanguage === "Spanish" || targetLanguage === "French" || targetLanguage === "German") && cjkRegex.test(text)) {
    return true;
  }

  return false;
}

// Helper function to extract a clean image search term from word properties (strictly for nouns)
export function getImageSearchTerm(word: Word): string {
  if (word.partOfSpeech && !isNoun(word.partOfSpeech)) return "";
  return word.word;
}

// Helper function to generate relevant visual concept keywords (strictly for nouns)
export function getImageKeyword(word: Word | string): string {
  if (typeof word === 'object' && word !== null && word.partOfSpeech && !isNoun(word.partOfSpeech)) {
    return "";
  }
  if (typeof word === 'string') {
    // If it's a string, clean it up if it has a comma (e.g. "apple, fruit" -> "apple")
    if (word.includes(",")) {
      return word.split(",")[0].trim();
    }
    return word;
  }
  if (word.imageKeyword) {
    return word.imageKeyword;
  }
  // Fallback: use word.word, clean up any trailing context or commas
  const term = word.word;
  if (term.includes(",")) {
    return term.split(",")[0].trim();
  }
  return term;
}

// Helper function to generate 3 Cloudflare Worker candidate query URLs for a word or keyword
export function getWorkerThreeImageUrls(word: string | Word): string[] {
  const keyword = getImageKeyword(word);
  if (!keyword || !keyword.trim()) return [];
  const cleanKey = keyword.includes(",") ? keyword.split(",")[0].trim() : keyword.trim();
  const encoded = encodeURIComponent(cleanKey);
  return [
    `https://image.nclong87.workers.dev?query=${encoded}`,
    `https://image.nclong87.workers.dev?query=${encodeURIComponent(cleanKey + " photo")}`,
    `https://image.nclong87.workers.dev?query=${encodeURIComponent(cleanKey + " illustration")}`
  ];
}

// Helper function to fetch image URL from Cloudflare Worker endpoint using keyword query
export async function fetchWorkerImageUrl(keyword: string, fallbackLockIndex: number = 1): Promise<string> {
  if (!keyword) return "";

  const cleanKey = keyword.includes(",") ? keyword.split(",")[0].trim() : keyword.trim();
  const effectiveProxyKey = getStoredAccessCode();

  try {
    const workerUrl = `https://image.nclong87.workers.dev?query=${encodeURIComponent(cleanKey)}`;
    const headers: Record<string, string> = {};
    if (effectiveProxyKey) {
      headers["X-Proxy-Key"] = effectiveProxyKey;
    }
    const directRes = await fetchWithTimeout(workerUrl, {
      method: "GET",
      headers
    });
    if (directRes.ok) {
      const text = await directRes.text();
      let url = text.trim();
      if (url.startsWith("{")) {
        try {
          const p = JSON.parse(url);
          url = p.url || p.imageUrl || p.image || p.src || (Array.isArray(p.images) ? p.images[0] : "") || (Array.isArray(p.results) ? p.results[0]?.url : "") || url;
        } catch (e) {}
      }
      if (url && (url.startsWith("http://") || url.startsWith("https://"))) {
        return url;
      }
    }
  } catch (e) {
    console.warn("Direct image worker call failed:", e);
  }

  // Fallback to reliable topic image endpoint if worker endpoint returns unauthorized or empty
  return `https://loremflickr.com/400/400/${encodeURIComponent(cleanKey.toLowerCase())}?lock=${fallbackLockIndex}`;
}

export async function fetchThreeCandidateImageUrls(word: string | Word): Promise<string[]> {
  const keyword = getImageKeyword(word);
  if (!keyword || !keyword.trim()) return [];
  const cleanKey = keyword.includes(",") ? keyword.split(",")[0].trim() : keyword.trim();

  const queries = [
    cleanKey,
    `${cleanKey} photo`,
    `${cleanKey} illustration`
  ];

  const results = await Promise.all(
    queries.map((q, idx) => fetchWorkerImageUrl(q, idx + 1))
  );

  return results.filter(Boolean);
}

// Helper to generate confusing sound-alike, particle-shift, or morphological distractors
export function generateConfusers(w: string): string[] {
  const confusers: string[] = [];

  // 1. Phrasal verb & particle shifts for multi-word phrases
  if (w.includes(" ")) {
    const particleMap: Record<string, string[]> = {
      "off": ["out", "down", "up", "away", "back", "in"],
      "out": ["in", "up", "down", "off", "away", "over"],
      "up": ["down", "out", "in", "off", "over", "away"],
      "down": ["up", "off", "out", "over", "away"],
      "in": ["out", "up", "down", "off", "into"],
      "on": ["off", "in", "out", "up", "over"],
      "away": ["off", "out", "back", "down"],
      "over": ["out", "up", "down", "through"],
      "through": ["over", "out", "by", "down"],
      "back": ["away", "off", "out", "down", "up"],
      "it down": ["it up", "it out", "it off", "it away"],
      "it up": ["it down", "it out", "it off"],
      "it out": ["it in", "it up", "it down"],
      "it off": ["it on", "it out", "it down"],
    };

    for (const [particle, replacements] of Object.entries(particleMap)) {
      const regex = new RegExp(`\\b${particle}\\b`, 'gi');
      if (regex.test(w)) {
        for (const rep of replacements) {
          confusers.push(w.replace(regex, rep));
        }
      }
    }

    // Verb phrase starters
    const phrasePrefixMap: Record<string, string[]> = {
      "lower": ["raise", "ease", "curb", "boost", "elevate"],
      "reduce": ["increase", "lower", "sustain", "boost"],
      "increase": ["reduce", "lower", "limit", "stabilize"],
      "take": ["make", "give", "have", "hold"],
      "give": ["take", "bring", "hand", "hold"],
      "make": ["take", "have", "do", "keep"],
      "keep": ["make", "hold", "stay", "remain"],
      "bring": ["take", "carry", "send", "pull"],
    };

    for (const [prefix, replacements] of Object.entries(phrasePrefixMap)) {
      const regex = new RegExp(`^${prefix}\\b`, 'gi');
      if (regex.test(w)) {
        for (const rep of replacements) {
          confusers.push(w.replace(regex, rep));
        }
      }
    }
  }

  // 2. Single word morphological / phonetic confusers
  confusers.push(
    w.replace(/ie/gi, 'ei'),
    w.replace(/ei/gi, 'ie'),
    w.replace(/tion/gi, 'sion'),
    w.replace(/sion/gi, 'tion'),
    w.replace(/c/gi, 's'),
    w.replace(/s/gi, 'c'),
    w.replace(/ll/gi, 'l'),
    w.replace(/l/gi, 'll'),
    w.replace(/m/gi, 'n'),
    w.replace(/n/gi, 'm'),
    w.replace(/p/gi, 'b'),
    w.replace(/b/gi, 'p'),
    w.replace(/t/gi, 'd'),
    w.replace(/d/gi, 't'),
    w + "e",
    w.endsWith('e') ? w.slice(0, -1) : w + "s",
    w + "ing",
    w + "ed",
    w + "ly",
    w + "er",
    w.replace(/[aeiou]/i, (v) => v === 'a' ? 'e' : v === 'e' ? 'a' : v === 'i' ? 'e' : v === 'o' ? 'u' : 'o'),
    w.replace(/[aeiou]/ig, 'a'),
    w.replace(/[aeiou]/ig, 'e'),
    w.replace(/[aeiou]/ig, 'i'),
    w.replace(/[aeiou]/ig, 'o'),
    w.replace(/[aeiou]/ig, 'u')
  );

  return Array.from(new Set(confusers)).filter(c => c.toLowerCase() !== w.toLowerCase() && c.trim().length > 1);
}

export interface ConfuserPairInfo {
  rival: string;
  rule: string;
  exampleWithBlank?: string;
}

export interface ExtractedCompanionItem {
  word: string;
  translation?: string;
  definition?: string;
  partOfSpeech?: string;
  hint?: string;
  pairedWith?: string;
}

export const COMMON_PHRASAL_VERB_PATTERNS: Array<{
  pattern: RegExp;
  canonical: string;
  definition: string;
  translationMap?: Record<string, string>;
}> = [
  {
    pattern: /\b(?:laugh|laughed|laughing|laughs)\s+(?:it|them|this|that|things)?\s*off\b/i,
    canonical: "laugh it off",
    definition: "To dismiss an embarrassing, awkward, or difficult situation with laughter",
    translationMap: { Vietnamese: "cười xòa, xem nhẹ chuyện khó xử", Spanish: "tomarlo a risa, quitarle importancia", French: "en rire, dédramatiser" }
  },
  {
    pattern: /\b(?:trip|tripped|tripping|trips)\s+on\b/i,
    canonical: "trip on",
    definition: "To catch one's foot on something and stumble or lose balance",
    translationMap: { Vietnamese: "vấp phải", Spanish: "tropezar con", French: "trébucher sur" }
  },
  {
    pattern: /\b(?:brush|brushed|brushing|brushes)\s+(?:it|them|this|that|things)?\s*off\b/i,
    canonical: "brush it off",
    definition: "To treat something dismissively or ignore criticism or setbacks",
    translationMap: { Vietnamese: "bỏ ngoài tai, phớt lờ", Spanish: "descartar, no dar importancia", French: "passer outre" }
  },
  {
    pattern: /\b(?:shrug|shrugged|shrugging|shrugs)\s+(?:it|them|this|that|things)?\s*off\b/i,
    canonical: "shrug it off",
    definition: "To dismiss something as unimportant or treat it casually",
    translationMap: { Vietnamese: "nhún vai cho qua, xem nhẹ", Spanish: "encogerse de hombros", French: "hausser les épaules" }
  },
  {
    pattern: /\b(?:look|looked|looking|looks)\s+forward\s+to\b/i,
    canonical: "look forward to",
    definition: "To await something eagerly or with anticipation",
    translationMap: { Vietnamese: "trông mong, mong đợi", Spanish: "esperar con ansias", French: "avoir hâte de" }
  },
  {
    pattern: /\b(?:take|took|taken|taking|takes)\s+into\s+account\b/i,
    canonical: "take into account",
    definition: "To consider or remember a fact when making an evaluation",
    translationMap: { Vietnamese: "tính đến, xem xét đến", Spanish: "tener en cuenta", French: "prendre en compte" }
  },
  {
    pattern: /\b(?:break|broke|broken|breaking|breaks)\s+down\b/i,
    canonical: "break down",
    definition: "To stop functioning, collapse emotionally, or analyze in detail",
    translationMap: { Vietnamese: "hỏng hóc, suy sụp, phân tích nhỏ", Spanish: "desglosar, averiarse", French: "décomposer, tomber en panne" }
  },
  {
    pattern: /\b(?:figure|figured|figuring|figures)\s+out\b/i,
    canonical: "figure out",
    definition: "To understand, solve, or deduce a solution",
    translationMap: { Vietnamese: "hiểu ra, tìm ra cách", Spanish: "averiguar, descifrar", French: "comprendre, trouver" }
  },
  {
    pattern: /\b(?:find|found|finding|finds)\s+out\b/i,
    canonical: "find out",
    definition: "To discover or learn information",
    translationMap: { Vietnamese: "phát hiện, tìm ra", Spanish: "enterarse, descubrir", French: "découvrir" }
  },
  {
    pattern: /\b(?:give|gave|given|giving|gives)\s+up\b/i,
    canonical: "give up",
    definition: "To cease an effort, surrender, or quit doing something",
    translationMap: { Vietnamese: "từ bỏ, bỏ cuộc", Spanish: "rendirse, darse por vencido", French: "abandonner" }
  },
  {
    pattern: /\b(?:carry|carried|carrying|carries)\s+out\b/i,
    canonical: "carry out",
    definition: "To perform, execute, or implement a task or plan",
    translationMap: { Vietnamese: "tiến hành, thực hiện", Spanish: "llevar a cabo", French: "mener à bien" }
  },
  {
    pattern: /\b(?:turn|turned|turning|turns)\s+out\b/i,
    canonical: "turn out",
    definition: "To happen in a particular way or prove to be the case",
    translationMap: { Vietnamese: "hóa ra, kết cục là", Spanish: "resultar", French: "s'avérer" }
  },
  {
    pattern: /\b(?:call|called|calling|calls)\s+off\b/i,
    canonical: "call off",
    definition: "To cancel an event, meeting, or plan",
    translationMap: { Vietnamese: "hủy bỏ", Spanish: "cancelar", French: "annuler" }
  },
  {
    pattern: /\b(?:put|putting|puts)\s+off\b/i,
    canonical: "put off",
    definition: "To delay or postpone an action or meeting",
    translationMap: { Vietnamese: "trì hoãn", Spanish: "posponer", French: "reporter" }
  },
  {
    pattern: /\b(?:cheer|cheered|cheering|cheers)\s+(?:(?:someone|him|her|them|me|us)\s+)?up\b/i,
    canonical: "cheer up",
    definition: "To make someone feel happier or less discouraged",
    translationMap: { Vietnamese: "cổ vũ, làm vui lên", Spanish: "animar", French: "remonter le moral" }
  },
  {
    pattern: /\b(?:come|came|coming|comes)\s+across\b/i,
    canonical: "come across",
    definition: "To encounter or discover by chance",
    translationMap: { Vietnamese: "tình cờ gặp", Spanish: "toparse con", French: "tomber sur" }
  },
  {
    pattern: /\b(?:get|got|getting|gets)\s+along\s+with\b/i,
    canonical: "get along with",
    definition: "To have a harmonious relationship with someone",
    translationMap: { Vietnamese: "hòa thuận với", Spanish: "llevarse bien con", French: "s'entendre avec" }
  },
  {
    pattern: /\b(?:run|ran|running|runs)\s+into\b/i,
    canonical: "run into",
    definition: "To meet someone unexpectedly or collide with something",
    translationMap: { Vietnamese: "tình cờ gặp gỡ, va phải", Spanish: "tropezar con", French: "rencontrer par hasard" }
  },
  {
    pattern: /\b(?:stand|stood|standing|stands)\s+out\b/i,
    canonical: "stand out",
    definition: "To be distinctly noticeable or prominent",
    translationMap: { Vietnamese: "nổi bật", Spanish: "destacar", French: "se démarquer" }
  },
  {
    pattern: /\b(?:show|showed|shown|showing|shows)\s+off\b/i,
    canonical: "show off",
    definition: "To display boastfully or draw attention to oneself",
    translationMap: { Vietnamese: "khoe khoang", Spanish: "presumir", French: "frimer" }
  },
  {
    pattern: /\b(?:set|setting|sets)\s+up\b/i,
    canonical: "set up",
    definition: "To establish, assemble, or configure something",
    translationMap: { Vietnamese: "thiết lập, cài đặt", Spanish: "establecer, configurar", French: "mettre en place" }
  },
  {
    pattern: /\b(?:point|pointed|pointing|points)\s+out\b/i,
    canonical: "point out",
    definition: "To draw attention to a notable fact or detail",
    translationMap: { Vietnamese: "chỉ ra, lưu ý", Spanish: "señalar", French: "faire remarquer" }
  },
  {
    pattern: /\b(?:get|got|getting|gets)\s+over\b/i,
    canonical: "get over",
    definition: "To recover from an illness, difficulty, or emotional shock",
    translationMap: { Vietnamese: "vượt qua, nguôi ngoai", Spanish: "superar", French: "se remettre de" }
  },
  {
    pattern: /\b(?:calm|calmed|calming|calms)\s+down\b/i,
    canonical: "calm down",
    definition: "To become less agitated, anxious, or angry",
    translationMap: { Vietnamese: "bình tĩnh lại", Spanish: "calmarse", French: "se calmer" }
  },
  {
    pattern: /\b(?:carry|carried|carrying|carries)\s+on\b/i,
    canonical: "carry on",
    definition: "To continue with an activity despite setbacks",
    translationMap: { Vietnamese: "tiếp tục tiến bước", Spanish: "continuar", French: "continuer" }
  },
  {
    pattern: /\b(?:hold|held|holding|holds)\s+on\b/i,
    canonical: "hold on",
    definition: "To wait for a short time or endure difficult circumstances",
    translationMap: { Vietnamese: "chờ một chút, giữ vững", Spanish: "esperar, aguantar", French: "attendre, tenir bon" }
  },
  {
    pattern: /\b(?:bring|brought|bringing|brings)\s+up\b/i,
    canonical: "bring up",
    definition: "To mention a topic or raise a child",
    translationMap: { Vietnamese: "đề cập tới, nuôi nấng", Spanish: "mencionar, criar", French: "évoquer, élever" }
  },
  {
    pattern: /\b(?:cut|cutting|cuts)\s+down\s+on\b/i,
    canonical: "cut down on",
    definition: "To reduce the amount or consumption of something",
    translationMap: { Vietnamese: "cắt giảm bớt", Spanish: "reducir el consumo de", French: "réduire la consommation de" }
  },
  {
    pattern: /\b(?:fall|fell|fallen|falling|falls)\s+for\b/i,
    canonical: "fall for",
    definition: "To be deceived by a trick or fall in love with someone",
    translationMap: { Vietnamese: "bị lừa, xiêu lòng vì", Spanish: "enamorarse de, caer en la trampa", French: "se laisser séduire par, se faire avoir" }
  },
  {
    pattern: /\b(?:keep|kept|keeping|keeps)\s+up\s+with\b/i,
    canonical: "keep up with",
    definition: "To move or progress at the same rate as someone or something",
    translationMap: { Vietnamese: "theo kịp, bắt kịp", Spanish: "mantenerse al día con", French: "suivre le rythme" }
  },
  {
    pattern: /\b(?:catch|caught|catching|catches)\s+up\s+with\b/i,
    canonical: "catch up with",
    definition: "To reach someone or something ahead, or discuss recent events",
    translationMap: { Vietnamese: "đuổi kịp, hàn huyên", Spanish: "alcanzar a, ponerse al día con", French: "rattraper" }
  },
  {
    pattern: /\b(?:make|made|making|makes)\s+up\s+for\b/i,
    canonical: "make up for",
    definition: "To compensate for something missing, lost, or flawed",
    translationMap: { Vietnamese: "bù đắp cho", Spanish: "compensar", French: "compenser" }
  },
  {
    pattern: /\b(?:look|looked|looking|looks)\s+into\b/i,
    canonical: "look into",
    definition: "To investigate or examine a matter thoroughly",
    translationMap: { Vietnamese: "nghiên cứu, xem xét, điều tra", Spanish: "investigar", French: "examiner, enquêter" }
  },
  {
    pattern: /\b(?:look|looked|looking|looks)\s+after\b/i,
    canonical: "look after",
    definition: "To take care of or supervise someone or something",
    translationMap: { Vietnamese: "chăm sóc, trông nom", Spanish: "cuidar de", French: "s'occuper de" }
  },
  {
    pattern: /\b(?:work|worked|working|works)\s+out\b/i,
    canonical: "work out",
    definition: "To exercise physically or find a successful resolution",
    translationMap: { Vietnamese: "tập luyện, tiến triển êm đẹp", Spanish: "entrenar, resolverse bien", French: "s'entraîner, s'arranger" }
  },
  {
    pattern: /\b(?:end|ended|ending|ends)\s+up\b/i,
    canonical: "end up",
    definition: "To reach a particular state, place, or situation eventually",
    translationMap: { Vietnamese: "rốt cuộc là, kết cục là", Spanish: "terminar, acabar por", French: "finir par" }
  }
];

/**
 * Extracts high-value phrasal verbs, collocations, or multi-word expressions
 * from a context sentence so they can be suggested to the learner.
 */
export function extractPhrasalVerbsAndCollocationsFromSentence(
  sentence: string,
  targetWord: string,
  existingWords: string[] = [],
  nativeLanguage: string = "Vietnamese"
): ExtractedCompanionItem[] {
  if (!sentence) return [];
  const results: ExtractedCompanionItem[] = [];
  const existingSet = new Set(existingWords.map(w => w.toLowerCase().trim()));
  existingSet.add(targetWord.toLowerCase().trim());

  // 1. Check known high-value phrasal verbs & idioms
  for (const item of COMMON_PHRASAL_VERB_PATTERNS) {
    if (item.pattern.test(sentence)) {
      const canonicalLower = item.canonical.toLowerCase();
      if (!existingSet.has(canonicalLower)) {
        existingSet.add(canonicalLower);
        const trans = item.translationMap?.[nativeLanguage] || item.translationMap?.["Vietnamese"] || "";
        results.push({
          word: item.canonical,
          translation: trans,
          definition: item.definition,
          partOfSpeech: "phrasal verb",
          hint: "Phrasal verb from context sentence",
          pairedWith: targetWord
        });
      }
    }
  }

  // 2. Preposition collocation with targetWord itself (e.g. "embarrassed about", "liaise with")
  const escapedTarget = targetWord.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const prepMatch = sentence.match(new RegExp(`\\b(${escapedTarget})\\s+(with|to|for|on|in|about|from|at|into|up|out|down|of|off|by|between|against)\\b`, "i"));
  if (prepMatch && prepMatch[0]) {
    const colloc = prepMatch[0].trim();
    if (!existingSet.has(colloc.toLowerCase())) {
      existingSet.add(colloc.toLowerCase());
      results.push({
        word: colloc,
        translation: "",
        definition: `Collocation with "${targetWord}"`,
        partOfSpeech: "collocation",
        hint: "Appears in context sentence",
        pairedWith: targetWord
      });
    }
  }

  return results;
}

/**
 * Synthesizes a plausible context sentence with a target word if no example exists.
 */
export function getDefaultContextSentence(word: string, partOfSpeech?: string): string {
  const clean = (word || "").trim();
  const lower = clean.toLowerCase();
  const pos = (partOfSpeech || "").toLowerCase().trim();

  if (pos === "adverb" || lower.endsWith("ly")) {
    return `She ${clean} finishes her tasks on schedule, rarely missing any deadline.`;
  }
  if (pos === "verb") {
    return `The team must ${clean} the necessary requirements before launching.`;
  }
  if (pos === "adjective") {
    return `The speaker provided a very ${clean} explanation for the audience.`;
  }
  if (pos === "noun") {
    return `The committee examined the ${clean} carefully before deciding.`;
  }
  return `The team needed to ${clean} the procedure accurately.`;
}

/**
 * Verifies whether a question or sentence string contains an actual substantive context sentence,
 * rather than just a generic instructional prompt or an empty blank placeholder.
 */
export function isQuestionSentenceValid(text: string): boolean {
  if (!text || typeof text !== "string") return false;
  // Strip out boilerplate instructions, punctuation, and blanks
  const stripped = text
    .replace(/⚔️\s*Confuser Duel\s*(?:\(Contrast Match\))?:?/gi, "")
    .replace(/Choose the (?:word|term) that (?:accurately|best)?\s*(?:fits|matches)[^:\n]*:?/gi, "")
    .replace(/Fill in the blank (?:for the sentence)?:?/gi, "")
    .replace(/Which word matches[^:\n]*:?/gi, "")
    .replace(/Please select the (?:correct )?word:?/gi, "")
    .replace(/\[blank\]|\[BLANK\]|\(\s*_{2,}\s*\)|\(_+\)|_{2,}|\.{3,}/gi, "")
    .replace(/["“”'()]/g, "")
    .trim();

  // If stripped text has fewer than 3 words, or matches vague templates like "given nuance"
  const words = stripped.split(/\s+/).filter((w) => w.length > 0);
  if (words.length < 3) return false;
  if (/^(?:the\s+)?given\s+nuance\.?$/i.test(stripped)) return false;
  if (/^(?:the\s+)?context\.?$/i.test(stripped)) return false;
  return true;
}

/**
 * Ensures that a fill-in-the-blank question or Confuser Duel question string
 * contains a visible blank (______). If the target word is present in the sentence,
 * it replaces the target word (or its inflected forms) with ______.
 * If no target word or blank placeholder is present, it automatically inserts ______.
 */
export function ensureQuestionHasBlank(
  questionText: string,
  targetWord: string,
  fallbackSentence?: string,
  partOfSpeech?: string
): string {
  const cleanTarget = (targetWord || "").trim();

  // If questionText is empty or lacks an actual context sentence (e.g. only contains generic instructions like "Choose the word that best matches the given nuance (_____).")
  if (!questionText || !isQuestionSentenceValid(questionText)) {
    let baseSentence = "";
    if (fallbackSentence && isQuestionSentenceValid(fallbackSentence)) {
      baseSentence = fallbackSentence;
    } else {
      const lowerT = cleanTarget.toLowerCase();
      if (CURATED_CONFUSER_PAIRS[lowerT]?.exampleWithBlank) {
        baseSentence = CURATED_CONFUSER_PAIRS[lowerT].exampleWithBlank!;
      } else {
        baseSentence = getDefaultContextSentence(cleanTarget, partOfSpeech);
      }
    }

    const cleanBase = baseSentence.replace(/^["“]|["”]$/g, "").trim();
    const sentenceWithBlank = ensureQuestionHasBlank(cleanBase, cleanTarget);
    const cleanFinalSentence = sentenceWithBlank.replace(/^["“]|["”]$/g, "").trim();
    return `Choose the word that accurately fits the context to break the confusion:\n"${cleanFinalSentence}"`;
  }

  // 1. Standardize existing blank placeholders (e.g. [blank], (_____), ..., _____) to ______
  let sanitized = questionText.replace(/\[blank\]|\[BLANK\]|\(\s*_{2,}\s*\)|\(_+\)|_{2,}|\.{3,}/gi, "______");

  // If ______ is already in the sanitized question, return it
  if (sanitized.includes("______")) {
    return sanitized;
  }

  if (!cleanTarget) {
    return sanitized + " ______";
  }

  // 2. Try to replace target word or its inflected variations in sanitized text
  const escapedTarget = cleanTarget.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regexWithSuffixes = new RegExp(`\\b${escapedTarget}(?:s|es|ed|ing|d)?\\b`, "gi");

  if (regexWithSuffixes.test(sanitized)) {
    return sanitized.replace(regexWithSuffixes, "______");
  }

  // Also try stem matching if target ends in 'e' or 'y'
  let stem = escapedTarget;
  if (cleanTarget.endsWith("e")) {
    stem = escapedTarget.slice(0, -1);
  } else if (cleanTarget.endsWith("y")) {
    stem = escapedTarget.slice(0, -1) + "(?:y|ies|ied)";
  }
  const stemRegex = new RegExp(`\\b${stem}(?:ing|ed|es|s)?\\b`, "gi");
  if (stemRegex.test(sanitized)) {
    return sanitized.replace(stemRegex, "______");
  }

  // 3. Failsafe: No blank indicator and target word was omitted or not matched.
  if (/"\s*$/i.test(sanitized)) {
    return sanitized.replace(/"\s*$/i, " ______\"");
  } else if (/\.\s*$/i.test(sanitized)) {
    return sanitized.replace(/\.\s*$/i, " ______.");
  } else {
    return sanitized + " ______";
  }
}

export const CURATED_CONFUSER_PAIRS: Record<string, ConfuserPairInfo> = {
  "normally": {
    rival: "especially",
    rule: "'Normally' means usually, typically, or under standard circumstances; 'Especially' means particularly, exceptionally, or to an outstanding degree.",
    exampleWithBlank: "We ______ finish work by five o'clock, but today we stayed late for a release."
  },
  "especially": {
    rival: "normally",
    rule: "'Especially' means particularly or in an exceptional manner; 'Normally' means according to standard routine or typical custom.",
    exampleWithBlank: "She loves outdoor sports in summer, ______ hiking and kayaking in the mountains."
  },
  "tract": {
    rival: "track",
    rule: "'Tract' (with a 't') is an area or plot of land, or a system of body organs; 'Track' (with a 'k') is a path, course, or railway line.",
    exampleWithBlank: "The farmer owns a large ______ of fertile agricultural land."
  },
  "track": {
    rival: "tract",
    rule: "'Track' is a path, trail, or course; 'Tract' is an expanse or plot of land.",
    exampleWithBlank: "The athletic team ran several laps around the newly paved running ______."
  },
  "affect": {
    rival: "effect",
    rule: "'Affect' is typically a VERB (to influence or produce a change in), whereas 'Effect' is typically a NOUN (the result or consequence).",
    exampleWithBlank: "The unexpected policy update will directly ______ our project timeline."
  },
  "effect": {
    rival: "affect",
    rule: "'Effect' is typically a NOUN (the result or consequence), whereas 'Affect' is a VERB (to produce a change in).",
    exampleWithBlank: "Scientists are researching the environmental ______ of industrial carbon emissions."
  },
  "accept": {
    rival: "except",
    rule: "'Accept' means to receive or agree to something; 'Except' means excluding, apart from, or other than.",
    exampleWithBlank: "She was honored to ______ the prestigious award on behalf of the foundation."
  },
  "except": {
    rival: "accept",
    rule: "'Except' denotes an exclusion or exception; 'Accept' means to receive with consent or approval.",
    exampleWithBlank: "All team members attended the briefing ______ Marcus, who was traveling."
  },
  "borrow": {
    rival: "lend",
    rule: "'Borrow' means to take or receive temporarily from someone else; 'Lend' means to give or grant temporary use to someone.",
    exampleWithBlank: "Could I please ______ your portable microphone for the afternoon session?"
  },
  "lend": {
    rival: "borrow",
    rule: "'Lend' means to grant temporary use to someone; 'Borrow' means to obtain temporary use from someone.",
    exampleWithBlank: "The college library will ______ up to five reference laptops each semester."
  },
  "advice": {
    rival: "advise",
    rule: "'Advice' (with a 'c') is an uncountable NOUN (recommendations); 'Advise' (with an 's') is a VERB (to counsel or guide).",
    exampleWithBlank: "The senior mentor offered invaluable career ______ to the incoming fellows."
  },
  "advise": {
    rival: "advice",
    rule: "'Advise' (with an 's') is a VERB meaning to recommend or counsel; 'Advice' (with a 'c') is the NOUN.",
    exampleWithBlank: "Physicians strongly ______ drinking plenty of electrolytes during endurance runs."
  },
  "compliment": {
    rival: "complement",
    rule: "'Compliment' (with an 'i') is praise or admiration; 'Complement' (with an 'e') completes or pairs harmoniously with something.",
    exampleWithBlank: "The keynote speaker received a sincere ______ on the clarity of her slides."
  },
  "complement": {
    rival: "compliment",
    rule: "'Complement' (with an 'e') means to enhance, complete, or pair well with; 'Compliment' (with an 'i') means praise.",
    exampleWithBlank: "The crisp citrus dressing was chosen to ______ the flavor of fresh smoked salmon."
  },
  "principal": {
    rival: "principle",
    rule: "'Principal' refers to the head of an institution or a primary capital sum; 'Principle' is an ethical standard, moral rule, or scientific law.",
    exampleWithBlank: "The ______ reason for restructuring was to improve cross-functional collaboration."
  },
  "principle": {
    rival: "principal",
    rule: "'Principle' refers to a core ethical standard or rule; 'Principal' refers to a chief leader or main amount.",
    exampleWithBlank: "She made it a guiding ______ never to compromise privacy for convenient features."
  },
  "sensible": {
    rival: "sensitive",
    rule: "'Sensible' means possessing practical wisdom, prudence, and sound judgment; 'Sensitive' means easily affected emotionally or physically delicate.",
    exampleWithBlank: "Allocating an emergency contingency reserve was a very ______ business decision."
  },
  "sensitive": {
    rival: "sensible",
    rule: "'Sensitive' describes emotional empathy, responsiveness, or delicate sensors; 'Sensible' means practical and reasonable.",
    exampleWithBlank: "The optical sensor is remarkably ______ and registers minuscule light variations."
  },
  "stationary": {
    rival: "stationery",
    rule: "'Stationary' (with an 'a') means motionless or standing still; 'Stationery' (with an 'e' like envelope) means writing materials and paper.",
    exampleWithBlank: "Commuters grew restless as the electric train remained ______ between stations."
  },
  "stationery": {
    rival: "stationary",
    rule: "'Stationery' (with 'er' like paper) refers to writing materials; 'Stationary' (with an 'a') means unmoving or fixed.",
    exampleWithBlank: "The firm ordered luxury embossed ______ for executive correspondence."
  },
  "loose": {
    rival: "lose",
    rule: "'Loose' (rhymes with goose) means not tight, slack, or unfastened; 'Lose' (rhymes with choose) means to misplace or suffer defeat.",
    exampleWithBlank: "The mechanic quickly tightened the ______ screw before road testing the vehicle."
  },
  "lose": {
    rival: "loose",
    rule: "'Lose' is a VERB meaning to misplace, fail to retain, or suffer loss; 'Loose' is an ADJECTIVE meaning unconstrained.",
    exampleWithBlank: "Be cautious not to ______ your digital transit pass while sightseeing."
  },
  "desert": {
    rival: "dessert",
    rule: "'Desert' (one 's') is an arid barren territory (or to abandon); 'Dessert' (two 's's for sweet treats) is a course eaten after dinner.",
    exampleWithBlank: "Endemic cacti have adapted to conserve moisture in the harsh ______ climate."
  },
  "dessert": {
    rival: "desert",
    rule: "'Dessert' (double 's' for sweet treats) is the sweet course concluding a meal; 'Desert' (single 's') is dry wasteland.",
    exampleWithBlank: "We enjoyed warm berry cobbler paired with pistachio ice cream for ______."
  },
  "historic": {
    rival: "historical",
    rule: "'Historic' means famous, momentous, or making history; 'Historical' refers generally to anything situated in or related to past events.",
    exampleWithBlank: "The peace accord was hailed across continents as a ______ diplomatic breakthrough."
  },
  "historical": {
    rival: "historic",
    rule: "'Historical' means related to the study or records of the past; 'Historic' denotes an event of monumental historical importance.",
    exampleWithBlank: "The museum preserves centuries of valuable ______ artifacts and documents."
  },
  "economic": {
    rival: "economical",
    rule: "'Economic' relates to the economy, commerce, or monetary systems; 'Economical' means thrifty, cost-effective, or avoiding waste.",
    exampleWithBlank: "The central bank released its quarterly report on national ______ recovery."
  },
  "economical": {
    rival: "economic",
    rule: "'Economical' means frugal, cheap to operate, or minimizing expense; 'Economic' pertains to macro-financial systems.",
    exampleWithBlank: "Carpooling with colleagues proved significantly more ______ than driving solo."
  },
  "lie": {
    rival: "lay",
    rule: "'Lie' is intransitive (to recline yourself, no direct object); 'Lay' is transitive (to put something down, requires an object).",
    exampleWithBlank: "After traveling across time zones, all I wanted was to ______ down and sleep."
  },
  "lay": {
    rival: "lie",
    rule: "'Lay' requires a direct object (to place something down); 'Lie' is what a person does on their own without an object.",
    exampleWithBlank: "Please ______ the porcelain dinner plates carefully on the dining table."
  },
  "raise": {
    rival: "rise",
    rule: "'Raise' is transitive (to lift something up, takes an object); 'Rise' is intransitive (to move upward by itself, no object).",
    exampleWithBlank: "Participants were asked to ______ their badges if they needed technical support."
  },
  "rise": {
    rival: "raise",
    rule: "'Rise' is intransitive (something ascends by itself, e.g. the sun, temperature); 'Raise' requires an agent lifting something.",
    exampleWithBlank: "At dawn, gentle vapor begins to ______ from the surface of the mountain lake."
  },
  "wander": {
    rival: "wonder",
    rule: "'Wander' (with an 'a') means to stroll or move without destination; 'Wonder' (with an 'o') means to ponder, feel curiosity, or marvel.",
    exampleWithBlank: "On weekend mornings, we like to ______ through the vibrant farmers market."
  },
  "wonder": {
    rival: "wander",
    rule: "'Wonder' means to speculate, be curious, or feel amazement; 'Wander' means physical roaming or strolling.",
    exampleWithBlank: "Astronomers continue to ______ about the uncharted boundaries of distant galaxies."
  },
  "breath": {
    rival: "breathe",
    rule: "'Breath' (noun, rhymes with death) is the air taken in; 'Breathe' (verb, rhymes with seethe) is the physical act of respiration.",
    exampleWithBlank: "Take a deep, steady ______ before delivering your introductory remarks."
  },
  "breathe": {
    rival: "breath",
    rule: "'Breathe' is the active VERB (to inhale and exhale); 'Breath' is the singular NOUN.",
    exampleWithBlank: "Stepping into the crisp pine forest allowed the campers to ______ fresh air."
  },
  "discreet": {
    rival: "discrete",
    rule: "'Discreet' (double 'e' together = prudent and tactful); 'Discrete' (separated 'e's = distinct, separate, individual).",
    exampleWithBlank: "The executive assistant handled sensitive company inquiries in a very ______ manner."
  },
  "discrete": {
    rival: "discreet",
    rule: "'Discrete' means detached, individual, and separate; 'Discreet' means tactful, cautious, and confidential.",
    exampleWithBlank: "The modular system divides complex computing operations into ______ microservices."
  },
  "assure": {
    rival: "ensure",
    rule: "'Assure' is spoken to a PERSON to relieve anxiety or remove doubts; 'Ensure' means to guarantee an outcome or make certain.",
    exampleWithBlank: "The flight attendant hastened to ______ the nervous traveler that turbulence was normal."
  },
  "ensure": {
    rival: "assure",
    rule: "'Ensure' means to make sure an outcome or standard happens; 'Assure' is directed to a person to instill confidence.",
    exampleWithBlank: "Run automated test suites regularly to ______ that system deployments remain stable."
  },
  "allusion": {
    rival: "illusion",
    rule: "'Allusion' is an indirect literary, artistic, or historical reference; 'Illusion' is an optical deception, trick, or false impression.",
    exampleWithBlank: "The novelist wove a subtle ______ to Shakespeare's tragic plays into the dialogue."
  },
  "illusion": {
    rival: "allusion",
    rule: "'Illusion' is an optical trick or deceptive appearance; 'Allusion' is a brief indirect reference.",
    exampleWithBlank: "Clever mirror placement gives the small studio apartment the ______ of expansive space."
  },
  "emigrate": {
    rival: "immigrate",
    rule: "'Emigrate' (from) means to depart your homeland; 'Immigrate' (to/into) means to enter and settle in a new country.",
    exampleWithBlank: "Seeking new academic opportunities, his family decided to ______ from Norway."
  },
  "immigrate": {
    rival: "emigrate",
    rule: "'Immigrate' means to move into a foreign country to settle permanently; 'Emigrate' means to leave one's home country.",
    exampleWithBlank: "She completed her postgraduate studies before applying to ______ to New Zealand."
  },
  "conscious": {
    rival: "conscience",
    rule: "'Conscious' is an ADJECTIVE meaning awake, alert, and aware; 'Conscience' is a NOUN for one's moral sense of right and wrong.",
    exampleWithBlank: "The paramedic verified that the driver was fully ______ and aware of his surroundings."
  },
  "conscience": {
    rival: "conscious",
    rule: "'Conscience' is the internal moral compass guiding ethical choices; 'Conscious' means awake and sensory-aware.",
    exampleWithBlank: "He made a sizable charitable donation to ease his troubled ______."
  },
  "collaborate": {
    rival: "corroborate",
    rule: "'Collaborate' means to work together jointly; 'Corroborate' means to confirm, support, or authenticate with evidence.",
    exampleWithBlank: "Graphic designers and copywriters must ______ closely on launch campaigns."
  },
  "corroborate": {
    rival: "collaborate",
    rule: "'Corroborate' means to verify or authenticate with evidence; 'Collaborate' means to partner or work together.",
    exampleWithBlank: "Independent sensor telemetry was able to ______ the pilot's incident report."
  }
};

/**
 * Generate a Confuser Duel (Contrast Match) question for a word.
 * Designed specifically for unlearning words, false friends, and close rivals.
 */
export function generateDuelQuestionForWord(word: Word, _targetLanguage?: string): QuizQuestion {
  const cleanWord = (word.word || "").trim().toLowerCase();
  
  // 1. Check curated high-frequency confuser pairs
  let confuserWord = "";
  let contrastRule = "";
  let exampleWithBlank = "";

  if (CURATED_CONFUSER_PAIRS[cleanWord]) {
    const pair = CURATED_CONFUSER_PAIRS[cleanWord];
    confuserWord = pair.rival;
    contrastRule = pair.rule;
    exampleWithBlank = pair.exampleWithBlank || "";
  } else {
    // Check if cleanWord is a rival in any curated pair
    for (const [key, pair] of Object.entries(CURATED_CONFUSER_PAIRS)) {
      if (pair.rival.toLowerCase() === cleanWord) {
        confuserWord = key;
        contrastRule = pair.rule;
        break;
      }
    }
  }

  // 2. Fallback to dynamic confuser generation if not found in curated dictionary
  if (!confuserWord) {
    const dynamicConfusers = generateConfusers(word.word);
    if (dynamicConfusers.length > 0) {
      confuserWord = dynamicConfusers[0];
    } else {
      confuserWord = word.word.endsWith('e') ? word.word.slice(0, -1) : `${word.word}s`;
    }
    contrastRule = `Target '${word.word}' vs rival '${confuserWord}': notice the exact semantic distinction, part of speech, and context to unlearn any confusion.`;
  }

  // 3. Build the duel sentence with blank
  let sentenceText = exampleWithBlank;
  if (!sentenceText) {
    if (word.example) {
      sentenceText = ensureQuestionHasBlank(word.example, word.word);
    } else {
      sentenceText = `Choose the precise term: "The team needed to ______ the process accurately."`;
    }
  } else {
    sentenceText = ensureQuestionHasBlank(sentenceText, word.word);
  }

  // Clean trailing/leading quotes in sentenceText before wrapping
  const cleanSentence = sentenceText.replace(/^["“]|["”]$/g, "").trim();
  const questionText = ensureQuestionHasBlank(
    `⚔️ Confuser Duel (Contrast Match):\nChoose the word that accurately fits the context to break the confusion:\n"${cleanSentence}"`,
    word.word
  );

  // Contrast options: Target word vs Rival confuser (shuffled)
  const options = [word.word, confuserWord].sort(() => 0.5 - Math.random());

  const qSuggestions: any[] = Array.isArray(word.suggestedWords) && word.suggestedWords.length > 0
    ? word.suggestedWords.slice(0, 3).map((item: any) => ({
        word: typeof item === "string" ? item : (item.word || ""),
        translation: typeof item === "object" ? (item.translation || "") : "",
        definition: typeof item === "object" ? (item.definition || "") : "",
        hint: typeof item === "object" ? (item.hint || `Based on "${word.word}"`) : `Based on "${word.word}"`,
        partOfSpeech: typeof item === "object" ? item.partOfSpeech : undefined,
        pairedWith: word.word
      }))
    : [];

  if (confuserWord && !qSuggestions.some(s => s.word.toLowerCase() === confuserWord.toLowerCase())) {
    let cleanRivalDef = "";
    if (contrastRule) {
      const escapedRival = confuserWord.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const m = contrastRule.match(
        new RegExp(`(?:while|whereas)?\\s*(?:a|an)?\\s*['"]?${escapedRival}['"]?\\s*(?:refers to|means|is defined as|denotes|is)\\s*([^.;]+)`, "i")
      );
      if (m && m[1]) {
        cleanRivalDef = m[1].trim();
      } else {
        cleanRivalDef = contrastRule;
      }
    }
    qSuggestions.unshift({
      word: confuserWord,
      translation: "",
      definition: cleanRivalDef,
      partOfSpeech: word.partOfSpeech,
      pairedWith: word.word
    });
  }

  const blankPlaceholderRegex = /\[blank\]|\[BLANK\]|\(\s*_{2,}\s*\)|\(_+\)|_{2,}|\.{3,}/gi;
  let duelSentence = (word.example || sentenceText).replace(blankPlaceholderRegex, word.word);
  let duelSentenceTranslation = word.exampleTranslation;
  if (duelSentenceTranslation && blankPlaceholderRegex.test(duelSentenceTranslation)) {
    const primaryTrans = (word.translation || "").split(/[;,\/]/)[0].trim() || word.translation || word.word;
    duelSentenceTranslation = duelSentenceTranslation.replace(blankPlaceholderRegex, primaryTrans);
  }

  if (duelSentence && word.word && qSuggestions.length < 3) {
    const extracted = extractPhrasalVerbsAndCollocationsFromSentence(
      duelSentence,
      word.word,
      qSuggestions.map(s => s.word)
    );
    for (const item of extracted) {
      if (qSuggestions.length >= 3) break;
      if (!qSuggestions.some(s => s.word.toLowerCase() === item.word.toLowerCase())) {
        qSuggestions.push(item);
      }
    }
  }

  return {
    id: `duel-${word.id}-${Math.random().toString(36).substring(2, 7)}`,
    wordId: word.id,
    word: word.word,
    type: 'duel',
    question: questionText,
    options,
    correctAnswer: word.word,
    hint: `Contrast Duel: '${word.word}' vs '${confuserWord}'. Pay attention to the subtle semantic boundary!`,
    sentence: duelSentence,
    sentenceTranslation: duelSentenceTranslation,
    confuserWord,
    contrastRule,
    suggestedWords: qSuggestions.slice(0, 3)
  };
}

/**
 * Generate a full suite of Confuser Duel questions for the given words.
 */
export function generateConfuserDuelQuestions(wordList: Word[], targetLanguage?: string): QuizQuestion[] {
  if (!wordList || wordList.length === 0) return [];
  // Strictly deduplicate by word text/equivalence so no word is tested twice
  const uniqueWords: Word[] = [];
  for (const w of wordList) {
    if (!uniqueWords.some((uw) => uw.id === w.id || areWordsEquivalent(uw.word, w.word))) {
      uniqueWords.push(w);
    }
  }
  return uniqueWords.slice(0, 3).map((word) => generateDuelQuestionForWord(word, targetLanguage));
}

// Rule-based Quiz Question Generator with strict distractor logic & target-language restrictions
export function generateQuizQuestions(wordList: Word[], targetLanguage?: string): QuizQuestion[] {
  if (!wordList || wordList.length === 0) return [];
  
  // Strictly deduplicate by word text/equivalence so no word is tested twice
  const uniqueWords: Word[] = [];
  for (const w of wordList) {
    if (!uniqueWords.some((uw) => uw.id === w.id || areWordsEquivalent(uw.word, w.word))) {
      uniqueWords.push(w);
    }
  }

  // Cap to a maximum of 3 questions
  const allWords = uniqueWords.slice(0, 3);
  const generated: QuizQuestion[] = [];

  // Guarantee at least one picture/image-based question ONLY if at least one candidate is a noun
  const nounIndices = allWords
    .map((w, idx) => ({ idx, isNoun: isNoun(w.partOfSpeech) }))
    .filter((item) => item.isNoun)
    .map((item) => item.idx);
  const pictureQuestionIndex = nounIndices.length > 0
    ? nounIndices[Math.floor(Math.random() * nounIndices.length)]
    : -1;

  allWords.forEach((word, index) => {
    const wordIsNoun = isNoun(word.partOfSpeech);
    const types: ('definition' | 'sentence' | 'listening' | 'picture')[] = [
      'definition', 
      'sentence',
      'listening',
      ...(wordIsNoun ? ['picture' as const] : [])
    ];
    let type = (index === pictureQuestionIndex && wordIsNoun) ? 'picture' : types[Math.floor(Math.random() * types.length)];

    // If definition contains native non-target language, avoid definition type to preserve target language restriction
    if (type === 'definition' && containsNonTargetLanguage(word.definition, targetLanguage)) {
      type = word.example ? 'sentence' : 'listening';
    }

    // Safety check: picture question type is strictly forbidden for non-nouns
    if (type === 'picture' && !wordIsNoun) {
      type = word.example ? 'sentence' : 'definition';
    }

    let options: string[] = [];
    let correctAnswer = "";
    let questionText = "";
    let hintText = word.pronunciation;
    let imageUrl: string | undefined = undefined;
    let imageKeyword: string | undefined = undefined;

    // Generate tricky confuser distractors without pulling wrong answers from other words in the collection
    const confusers = generateConfusers(word.word).sort(() => 0.5 - Math.random());

    if (type === 'definition') {
      correctAnswer = word.word;
      questionText = `Which word matches the following definition?\n"${word.definition}"`;
      
      const uniqueDistractors = Array.from(new Set(confusers)).filter(w => w.toLowerCase() !== correctAnswer.toLowerCase()).slice(0, 3);
      options = [correctAnswer, ...uniqueDistractors].sort(() => 0.5 - Math.random());
    }
    else if (type === 'listening') {
      correctAnswer = word.word;
      questionText = `Listen to the audio clip and select the correct matching word:`;
      
      const uniqueDistractors = Array.from(new Set(confusers)).filter(w => w.toLowerCase() !== correctAnswer.toLowerCase()).slice(0, 3);
      options = [correctAnswer, ...uniqueDistractors].sort(() => 0.5 - Math.random());
    }
    else if (type === 'picture' && wordIsNoun) {
      correctAnswer = word.word;
      questionText = `Which word matches the visual concept shown below?`;
      imageKeyword = getImageKeyword(word);

      const existingWordImages = [
        ...(word.imageUrls || []),
        ...(word.imageUrl ? [word.imageUrl] : [])
      ].map(u => String(u || "").trim()).filter(Boolean);

      if (existingWordImages.length > 0) {
        imageUrl = existingWordImages[Math.floor(Math.random() * existingWordImages.length)];
      } else {
        imageUrl = `https://image.nclong87.workers.dev?query=${encodeURIComponent(imageKeyword)}`;
      }

      const uniqueDistractors = Array.from(new Set(confusers)).filter(w => w.toLowerCase() !== correctAnswer.toLowerCase()).slice(0, 3);
      options = [correctAnswer, ...uniqueDistractors].sort(() => 0.5 - Math.random());
    }
    else {
      // sentence type
      correctAnswer = word.word;
      const baseSentence = (word.example && isQuestionSentenceValid(word.example))
        ? word.example
        : getDefaultContextSentence(word.word, word.partOfSpeech);
      const hiddenSentence = ensureQuestionHasBlank(baseSentence, word.word);
      questionText = ensureQuestionHasBlank(`Fill in the blank for the sentence:\n"${hiddenSentence.replace(/^["“]|["”]$/g, "").trim()}"`, word.word);
      
      const uniqueDistractors = Array.from(new Set(confusers)).filter(w => w.toLowerCase() !== correctAnswer.toLowerCase()).slice(0, 3);
      options = [correctAnswer, ...uniqueDistractors].sort(() => 0.5 - Math.random());
    }

    const qSuggestions: any[] = Array.isArray(word.suggestedWords) && word.suggestedWords.length > 0
      ? word.suggestedWords.slice(0, 3).map((item: any) => ({
          word: typeof item === "string" ? item : (item.word || ""),
          translation: typeof item === "object" ? (item.translation || "") : "",
          definition: typeof item === "object" ? (item.definition || "") : "",
          hint: typeof item === "object" ? (item.hint || `Based on "${word.word}"`) : `Based on "${word.word}"`,
          partOfSpeech: typeof item === "object" ? item.partOfSpeech : undefined,
          pairedWith: word.word
        }))
      : [];

    if (word.example && word.word && qSuggestions.length < 3) {
      const extracted = extractPhrasalVerbsAndCollocationsFromSentence(
        word.example,
        word.word,
        qSuggestions.map(s => s.word)
      );
      for (const item of extracted) {
        if (qSuggestions.length >= 3) break;
        if (!qSuggestions.some(s => s.word.toLowerCase() === item.word.toLowerCase())) {
          qSuggestions.push(item);
        }
      }
    }

    const blankPlaceholderRegex = /\[blank\]|\[BLANK\]|\(\s*_{2,}\s*\)|\(_+\)|_{2,}|\.{3,}/gi;
    let fallbackSentence = word.example ? word.example.replace(blankPlaceholderRegex, word.word) : undefined;
    let fallbackSentenceTranslation = word.exampleTranslation;
    if (fallbackSentenceTranslation && blankPlaceholderRegex.test(fallbackSentenceTranslation)) {
      const primaryTrans = (word.translation || "").split(/[;,\/]/)[0].trim() || word.translation || word.word;
      fallbackSentenceTranslation = fallbackSentenceTranslation.replace(blankPlaceholderRegex, primaryTrans);
    }

    generated.push({
      id: `q-${word.id}-${Math.random().toString(36).substring(2, 7)}`,
      wordId: word.id,
      word: word.word,
      partOfSpeech: word.partOfSpeech,
      type,
      question: questionText,
      options,
      correctAnswer,
      hint: hintText,
      sentence: fallbackSentence,
      sentenceTranslation: fallbackSentenceTranslation,
      imageKeyword: wordIsNoun ? imageKeyword : undefined,
      imageUrl: wordIsNoun ? imageUrl : undefined,
      imageUrls: wordIsNoun ? word.imageUrls : undefined,
      suggestedWords: qSuggestions.slice(0, 3)
    });
  });

  const randomized = generated.sort(() => 0.5 - Math.random());
  return randomized.slice(0, 3);
}
