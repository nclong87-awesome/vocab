import { Word, QuizQuestion } from "../types";

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
  if (typeof word === 'string') return word;
  return word.category ? `${word.word}, ${word.category}` : word.word;
}

// Helper function to fetch image URL from Cloudflare Worker endpoint using keyword query
export async function fetchWorkerImageUrl(keyword: string, proxyKey?: string): Promise<string> {
  if (!keyword) return "";

  let effectiveProxyKey = proxyKey || "";
  if (!effectiveProxyKey) {
    try {
      const rawConfig = localStorage.getItem("vocab_learner_llm_config");
      if (rawConfig) {
        const parsed = JSON.parse(rawConfig);
        effectiveProxyKey = parsed.proxyKey || "";
        if (!effectiveProxyKey && parsed.savedProviders) {
          const found = Object.values(parsed.savedProviders).find((p: any) => Boolean(p?.proxyKey)) as any;
          if (found) effectiveProxyKey = found.proxyKey;
        }
      }
    } catch (e) {}
  }
  if (!effectiveProxyKey) {
    effectiveProxyKey = localStorage.getItem("llm_proxy_key") || localStorage.getItem("proxy_key") || "";
  }

  try {
    const res = await fetch("/api/generate-image", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(effectiveProxyKey ? { "X-Proxy-Key": effectiveProxyKey } : {})
      },
      body: JSON.stringify({ query: keyword, proxyKey: effectiveProxyKey })
    });
    if (res.ok) {
      const data = await res.json();
      if (data.imageUrl) return data.imageUrl;
    }
  } catch (err) {
    // server API call failed
  }

  try {
    const workerUrl = `https://image.nclong87.workers.dev?query=${encodeURIComponent(keyword)}`;
    const headers: Record<string, string> = {};
    if (effectiveProxyKey) {
      headers["X-Proxy-Key"] = effectiveProxyKey;
    }
    const directRes = await fetch(workerUrl, {
      method: "GET",
      headers
    });
    if (directRes.ok) {
      const text = await directRes.text();
      let url = text.trim();
      if (url.startsWith("{")) {
        try {
          const p = JSON.parse(url);
          url = p.url || p.imageUrl || p.image || url;
        } catch (e) {}
      }
      if (url && (url.startsWith("http://") || url.startsWith("https://"))) {
        return url;
      }
    }
  } catch (e) {
    console.warn("Direct image worker call failed:", e);
  }

  return "";
}

// Helper to generate confusing sound-alike or misspelling distractors
export function generateConfusers(w: string): string[] {
  return Array.from(new Set([
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
    w.replace(/[aeiou]/i, (v) => v === 'a' ? 'e' : v === 'e' ? 'a' : v === 'i' ? 'e' : v === 'o' ? 'u' : 'o'),
    w.replace(/[aeiou]/ig, 'a'),
    w.replace(/[aeiou]/ig, 'e'),
    w.replace(/[aeiou]/ig, 'i'),
    w.replace(/[aeiou]/ig, 'o'),
    w.replace(/[aeiou]/ig, 'u')
  ])).filter(c => c.toLowerCase() !== w.toLowerCase() && c.length > 1);
}

// Rule-based Quiz Question Generator with strict distractor logic & target-language restrictions
export function generateQuizQuestions(wordList: Word[], targetLanguage?: string): QuizQuestion[] {
  if (!wordList || wordList.length === 0) return [];
  
  // If only 1 word in collection, generate confusers to create distractors
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

    if (type === 'definition') {
      correctAnswer = word.word;
      questionText = `Which word matches the following definition?\n"${word.definition}"`;
      
      // Sort words by length similarity to make distractors challenging
      let potentialWrongs = allWords
        .filter(w => w.id !== word.id)
        .sort((a, b) => Math.abs(a.word.length - word.word.length) - Math.abs(b.word.length - word.word.length))
        .map(w => w.word);
        
      let distractors = potentialWrongs.slice(0, 6).sort(() => 0.5 - Math.random());
      
      if (distractors.length < 3) {
        distractors = [...distractors, ...generateConfusers(word.word)].sort(() => 0.5 - Math.random());
      }
      
      const uniqueDistractors = Array.from(new Set(distractors)).filter(w => w !== correctAnswer).slice(0, 3);
      options = [correctAnswer, ...uniqueDistractors].sort(() => 0.5 - Math.random());
    }
    else if (type === 'listening') {
      correctAnswer = word.word;
      questionText = `Listen to the audio clip and select the correct matching word:`;
      
      // Phonetic and morphological variations for listening
      const confusers = generateConfusers(word.word).sort(() => 0.5 - Math.random());
      const potentialWrongsFromCollection = allWords.filter(w => w.id !== word.id).map(w => w.word).sort(() => 0.5 - Math.random());
      
      const mixedWrongs = [...confusers, ...potentialWrongsFromCollection];
      const uniqueDistractors = Array.from(new Set(mixedWrongs)).filter(w => w !== correctAnswer).slice(0, 3);
      
      options = [correctAnswer, ...uniqueDistractors].sort(() => 0.5 - Math.random());
    }
    else if (type === 'picture') {
      correctAnswer = word.word;
      questionText = `Which word matches the visual concept shown below?`;
      imageKeyword = getImageKeyword(word);
      imageUrl = `https://image.nclong87.workers.dev?query=${encodeURIComponent(imageKeyword)}`;

      let potentialWrongs = allWords
        .filter(w => w.id !== word.id)
        .sort((a, b) => Math.abs(a.word.length - word.word.length) - Math.abs(b.word.length - word.word.length))
        .map(w => w.word);
        
      let distractors = potentialWrongs.slice(0, 6).sort(() => 0.5 - Math.random());
      
      if (distractors.length < 3) {
        distractors = [...distractors, ...generateConfusers(word.word)].sort(() => 0.5 - Math.random());
      }
      
      const uniqueDistractors = Array.from(new Set(distractors)).filter(w => w !== correctAnswer).slice(0, 3);
      options = [correctAnswer, ...uniqueDistractors].sort(() => 0.5 - Math.random());
    }
    else {
      // sentence type
      correctAnswer = word.word;
      const regex = new RegExp(`\\b${word.word}\\b`, "i");
      const hiddenSentence = word.example ? word.example.replace(regex, "______") : `Please select the correct word: ${word.word}`;
      questionText = `Fill in the blank for the sentence:\n"${hiddenSentence}"`;
      
      let potentialWrongs = allWords.filter(w => w.id !== word.id).map(w => w.word);
      let distractors = potentialWrongs.sort(() => 0.5 - Math.random());
      
      if (distractors.length < 3) {
        distractors = [...distractors, ...generateConfusers(word.word)].sort(() => 0.5 - Math.random());
      }
      
      const uniqueDistractors = Array.from(new Set(distractors)).filter(w => w !== correctAnswer).slice(0, 3);
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
      imageKeyword,
      imageUrl
    });
  });

  return generated.sort(() => 0.5 - Math.random());
}
