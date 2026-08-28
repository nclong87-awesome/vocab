import { Word, QuizQuestion } from "../types";
import { fetchWithTimeout, getStoredAccessCode } from "../utils";

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

// Helper function to extract a clean image search term from word properties
export function getImageSearchTerm(word: Word): string {
  return word.word;
}

// Helper function to generate relevant visual concept keywords
export function getImageKeyword(word: Word | string): string {
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

// Rule-based Quiz Question Generator with strict distractor logic & target-language restrictions
export function generateQuizQuestions(wordList: Word[], targetLanguage?: string): QuizQuestion[] {
  if (!wordList || wordList.length === 0) return [];
  
  const allWords = wordList;
  const generated: QuizQuestion[] = [];

  // Guarantee at least one picture/image-based question in the generated quiz
  const pictureQuestionIndex = Math.floor(Math.random() * allWords.length);

  allWords.forEach((word, index) => {
    const types: ('definition' | 'sentence' | 'listening' | 'picture')[] = [
      'definition', 
      'sentence',
      'listening',
      'picture'
    ];
    let type = index === pictureQuestionIndex ? 'picture' : types[Math.floor(Math.random() * types.length)];

    // If definition contains native non-target language, avoid definition type to preserve target language restriction
    if (type === 'definition' && containsNonTargetLanguage(word.definition, targetLanguage)) {
      type = word.example ? 'sentence' : 'listening';
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
    else if (type === 'picture') {
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
      const regex = new RegExp(`\\b${word.word}\\b`, "i");
      const hiddenSentence = word.example ? word.example.replace(regex, "______") : `Please select the correct word: ${word.word}`;
      questionText = `Fill in the blank for the sentence:\n"${hiddenSentence}"`;
      
      const uniqueDistractors = Array.from(new Set(confusers)).filter(w => w.toLowerCase() !== correctAnswer.toLowerCase()).slice(0, 3);
      options = [correctAnswer, ...uniqueDistractors].sort(() => 0.5 - Math.random());
    }

    generated.push({
      id: `q-${word.id}-${Math.random().toString(36).substring(2, 7)}`,
      wordId: word.id,
      word: word.word,
      type,
      question: questionText,
      options,
      correctAnswer,
      hint: hintText,
      sentence: word.example,
      sentenceTranslation: word.exampleTranslation,
      imageKeyword,
      imageUrl,
      imageUrls: word.imageUrls
    });
  });

  // Collect up to 3 unique companion/suggested words across all questions in the quiz, prioritizing distractors actually used in the quiz options
  const seenKeys = new Set<string>();
  const top3Suggestions: any[] = [];

  // 1. First, extract interesting options/distractors used in the generated quiz questions
  for (const q of generated) {
    const rawOpts = Array.isArray(q.options) ? q.options : [];
    const targetLower = (q.word || "").toLowerCase().trim();
    for (const opt of rawOpts) {
      const optStr = String(opt || "").trim();
      if (!optStr) continue;
      const optLower = optStr.toLowerCase();
      if (optLower === targetLower || seenKeys.has(optLower)) continue;
      seenKeys.add(optLower);
      top3Suggestions.push({
        word: optStr,
        translation: "",
        hint: `Option used in quiz question for "${q.word}"`,
        pairedWith: q.word
      });
      if (top3Suggestions.length >= 3) break;
    }
    if (top3Suggestions.length >= 3) break;
  }

  // 2. If under 3, fallback to wordList suggestedWords
  if (top3Suggestions.length < 3) {
    for (const w of wordList) {
      if (Array.isArray(w.suggestedWords)) {
        for (const item of w.suggestedWords) {
          const wordText = typeof item === "string" ? item.trim() : (item.word || "").trim();
          if (!wordText) continue;
          const key = wordText.toLowerCase();
          if (seenKeys.has(key) || key === w.word.toLowerCase()) continue;
          seenKeys.add(key);

          top3Suggestions.push({
            word: wordText,
            translation: typeof item === "object" ? (item.translation || "") : "",
            hint: typeof item === "object" ? (item.hint || `Frequently appears with ${w.word}`) : `Frequently appears with ${w.word}`,
            pairedWith: w.word
          });
          if (top3Suggestions.length >= 3) break;
        }
      }
      if (top3Suggestions.length >= 3) break;
    }
  }

  const randomized = generated.sort(() => 0.5 - Math.random());
  if (randomized.length > 0 && top3Suggestions.length > 0) {
    randomized[0].suggestedWords = top3Suggestions;
  }

  return randomized;
}
