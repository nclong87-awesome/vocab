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

/**
 * Ensures that a fill-in-the-blank question or Confuser Duel question string
 * contains a visible blank (______). If the target word is present in the sentence,
 * it replaces the target word (or its inflected forms) with ______.
 * If no target word or blank placeholder is present, it automatically inserts ______.
 */
export function ensureQuestionHasBlank(questionText: string, targetWord: string): string {
  if (!questionText) {
    return `Choose the word that accurately fits the context to break the confusion:\n"The team must ______ the necessary requirements."`;
  }

  // 1. Standardize existing blank placeholders (e.g. [blank], (_____), ..., _____) to ______
  let sanitized = questionText.replace(/\[blank\]|\[BLANK\]|\(\s*_{2,}\s*\)|\(_+\)|_{2,}|\.{3,}/gi, "______");

  // If ______ is already in the sanitized question, return it
  if (sanitized.includes("______")) {
    return sanitized;
  }

  const cleanTarget = (targetWord || "").trim();
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

  const duelSentence = word.example || sentenceText.replace("______", word.word);
  if (duelSentence && word.word && qSuggestions.length < 3) {
    const escapedTarget = word.word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const prepMatch = duelSentence.match(new RegExp(`\\b(${escapedTarget})\\s+(with|to|for|on|in|about|from|at|into|up|out|down|of|off|by|between|against)\\b`, "i"));
    if (prepMatch && prepMatch[0]) {
      const colloc = prepMatch[0].trim();
      if (!qSuggestions.some(s => s.word.toLowerCase() === colloc.toLowerCase())) {
        qSuggestions.push({
          word: colloc,
          translation: "",
          definition: `Common collocation with "${word.word}"`,
          hint: `Appears in context sentence`,
          partOfSpeech: "collocation",
          pairedWith: word.word
        });
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
    sentenceTranslation: word.exampleTranslation,
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
    const types: ('definition' | 'sentence' | 'listening' | 'picture' | 'duel')[] = [
      'definition', 
      'sentence',
      'listening',
      ...(wordIsNoun ? ['picture' as const] : []),
      'duel'
    ];
    let type = (index === pictureQuestionIndex && wordIsNoun) ? 'picture' : types[Math.floor(Math.random() * types.length)];

    // If type is duel, generate a Confuser Duel question directly
    if (type === 'duel') {
      const duelQ = generateDuelQuestionForWord(word, targetLanguage);
      generated.push({
        ...duelQ,
        partOfSpeech: word.partOfSpeech,
      });
      return;
    }

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
      const hiddenSentence = word.example
        ? ensureQuestionHasBlank(word.example, word.word)
        : `Please select the correct word: ______`;
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
      const escapedTarget = word.word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const prepMatch = word.example.match(new RegExp(`\\b(${escapedTarget})\\s+(with|to|for|on|in|about|from|at|into|up|out|down|of|off|by|between|against)\\b`, "i"));
      if (prepMatch && prepMatch[0]) {
        const colloc = prepMatch[0].trim();
        if (!qSuggestions.some(s => s.word.toLowerCase() === colloc.toLowerCase())) {
          qSuggestions.push({
            word: colloc,
            translation: "",
            definition: `Common collocation with "${word.word}"`,
            hint: `Appears in context sentence`,
            partOfSpeech: "collocation",
            pairedWith: word.word
          });
        }
      }
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
      sentence: word.example,
      sentenceTranslation: word.exampleTranslation,
      imageKeyword: wordIsNoun ? imageKeyword : undefined,
      imageUrl: wordIsNoun ? imageUrl : undefined,
      imageUrls: wordIsNoun ? word.imageUrls : undefined,
      suggestedWords: qSuggestions.slice(0, 3)
    });
  });

  const randomized = generated.sort(() => 0.5 - Math.random());
  return randomized.slice(0, 3);
}
