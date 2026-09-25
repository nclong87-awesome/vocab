import { ChallengeData, ChallengeKeyWord, ChallengeTurnResult, ChallengeSuggestedVocab, UserPersonalityProfile, Word, LLMConfig } from "../types";
import { fetchWithTimeout, safeParseResponseJson, isStaticHost } from "../utils";
import { callLLMClientSideWithMeta, cleanJsonResponse, getOverrideConfig } from "./llmClientService";
import { logApiRequest } from "./requestHistoryService";
import { notifyLlmRequestStartFromConfig, publishLlmRequestEnd } from "../utils/llmEvents";
import { getTranslationChallengeCandidateWords, isWordPracticedToday } from "../utils/spacedRepetition";
import { findWordInCollection, hasUserIncorporatedWord } from "../utils/wordNormalization";
import { getPreferredModelsForLanguage } from "../config/llmProviders";

export interface GenerateChallengeParams {
  nativeLanguage?: string;
  targetLanguage?: string;
  personalityProfile?: UserPersonalityProfile | null;
  words?: Word[];
  recentSentences?: string[];
  llmConfig?: LLMConfig;
}

export interface ChallengeTurnParams {
  challenge: ChallengeData;
  userMessage: string;
  chatHistory?: Array<{ sender: "user" | "agent"; text: string }>;
  nativeLanguage?: string;
  targetLanguage?: string;
  llmConfig?: LLMConfig;
}

function buildVietnameseChallengePrompt(params: GenerateChallengeParams, randomSeed: string): {
  prompt: string;
  candidateCollectionWords: Word[];
} {
  const targetLanguage = params.targetLanguage || "English";
  const profile = params.personalityProfile;
  const archetype = profile?.archetype || "Pragmatic Professional";
  const rawInterests = profile?.detectedInterests && profile.detectedInterests.length > 0
    ? profile.detectedInterests
    : ["Du lịch & Ẩm thực", "Công nghệ & Lập trình", "Đời sống thường nhật & Sở thích"];
  const interests = rawInterests.join(", ");
  const traits = (profile?.archetypeTraits && profile.archetypeTraits.length > 0
    ? profile.archetypeTraits
    : ["Thực tế", "Thực dụng", "Quan tâm đến sắc thái tự nhiên"]).join(", ");

  let vocabAnchorSection = "";
  let candidateCollectionWords: Word[] = [];
  if (params.words && params.words.length > 0) {
    const validWords = params.words.filter((w) => w.completed !== false);
    candidateCollectionWords = getTranslationChallengeCandidateWords(validWords, {
      maxCandidates: 18,
    });
    if (candidateCollectionWords.length > 0) {
      const displayedCandidates = [...candidateCollectionWords].sort(() => Math.random() - 0.5);
      vocabAnchorSection = `
DANH SÁCH TỪ VỰNG TIẾNG ANH ỨNG VIÊN TRONG BỘ SƯU TẬP CỦA HỌC VIÊN:
${displayedCandidates.map((w) => `- "${w.word}" (nghĩa: ${w.translation || w.definition || "từ mục tiêu"}) [Độ ghi nhớ: ${w.strength ?? 0}%]`).join("\n")}

QUY TẮC BẮT BUỘC KHI CHỌN TỪ:
1. Bạn PHẢI chọn CHÍNH XÁC một từ tiếng Anh từ danh sách ứng viên trên làm "targetWordFromCollection" (sao chép đúng từng ký tự của từ đó).
2. TUYỆT ĐỐI KHÔNG tự bịa ra từ bên ngoài danh sách ứng viên này.
3. TỰ DO CHỌN NGỮ CẢNH: Chọn bất kỳ từ nào trong danh sách mà bạn có thể sáng tạo một chủ đề/ngữ cảnh tự nhiên và thú vị (khám phá nhiều từ khác nhau trên danh sách).
4. Ưu tiên các từ có độ ghi nhớ (Strength) còn thấp hoặc chưa luyện tập hôm nay để giúp học viên củng cố từ vựng.
5. Câu tiếng Việt ('nativeSentence') BẮT BUỘC phải thể hiện rõ ý nghĩa của từ vựng tiếng Anh này (dưới dạng tiếng Việt tự nhiên), để khi dịch sang tiếng Anh, học viên sẽ phải nhớ và sử dụng từ này!
6. Cung cấp thêm 3-6 từ/cụm từ tiếng Anh hữu ích liên quan trong "keyTargetWords" làm gợi ý từ vựng cho học viên.`;
    }
  }

  if (!vocabAnchorSection) {
    vocabAnchorSection = `
QUY TẮC CHỌN TỪ:
1. Chọn 1 từ vựng tiếng Anh hữu ích, phong phú làm từ mục tiêu ("targetWordFromCollection").
2. Câu tiếng Việt ('nativeSentence') BẮT BUỘC phải thể hiện rõ ý nghĩa của từ này một cách tự nhiên.
3. Cung cấp các từ liên quan hữu ích trong "keyTargetWords".`;
  }

  const prompt = `Hãy tạo một thử thách dịch thuật (Translation Challenge) dành cho học viên học tiếng Anh có tiếng mẹ đẻ là tiếng Việt.

HẠT GIỐNG ĐA DẠNG: ${randomSeed}

TỰ DO TUYỆT ĐỐI VỀ CHỦ ĐỀ & NGỮ CẢNH (TOTAL TOPIC FREEDOM):
Bạn có toàn quyền TỰ DO lựa chọn BẤT KỲ chủ đề và ngữ cảnh phong phú, độc đáo nào!
Không bị gò bó trong bất kỳ khuôn mẫu nào: bạn có thể tự do lấy cảm hứng từ khoa học, công nghệ, vũ trụ, nghệ thuật, âm nhạc, điện ảnh, sách báo, du lịch khám phá, văn hóa thế giới, ẩm thực độc đáo, thiên nhiên kỳ thú, triết lý sống nhẹ nhàng, thể thao, sở thích cá nhân, các tình huống giao tiếp đời thực, tình bạn, các tình huống bất ngờ hay những mẩu đối thoại hóm hỉnh thường ngày.
Hãy chủ động đa dạng hóa chủ đề tối đa giữa các thử thách để người học luôn cảm thấy hào hứng và bất ngờ!

THÔNG TIN HỌC VIÊN:
- Tiếng mẹ đẻ (Native Language): Tiếng Việt
- Ngôn ngữ cần học (Target Language): ${targetLanguage}
- Phong cách học: ${archetype}
- Đặc điểm: ${traits}
- Sở thích tham khảo: ${interests}
${vocabAnchorSection}

YÊU CẦU CỐT LÕI (TUYỆT ĐỐI TUÂN THỦ):

1. SÁNG TẠO CÂU TIẾNG VIỆT TỰ NHIÊN THUẦN TÚY (NATIVE-FIRST):
- 'nativeSentence' phải là 100% tiếng Việt tự nhiên, như người Việt nói chuyện thực tế hoặc chia sẻ suy nghĩ.
- Dùng từ ngữ tự nhiên, giàu biểu cảm, các hư từ/thán từ khẩu ngữ nếu phù hợp ngữ cảnh (ví dụ: "nhé", "cơ", "đấy", "ghê", "suýt nữa", "thôi", "ạ"...).
- TUYỆT ĐỐI KHÔNG DỊCH NGƯỢC TỪ CÂU TIẾNG ANH SANG. Hãy tư duy trực tiếp bằng tiếng Việt bản ngữ từ đầu!
- TUYỆT ĐỐI KHÔNG chèn từ tiếng Anh, từ mượn tiếng Anh chưa Việt hóa hay từ mục tiêu vào trong 'nativeSentence'.
- Độ dài: chính xác từ 6 đến 14 từ tiếng Việt. Ngắn gọn, súc tích, gãy gọn, không viết câu ghép rườm rà 3-4 vế.

2. KHÔNG CẦN TẠO BẢN DỊCH MẪU ('idealTranslation') TRONG BƯỚC NÀY:
- Để tránh tư duy bị gò bó hoặc câu tiếng Việt bị "mùi dịch máy", bạn KHÔNG cần cung cấp trường 'idealTranslation' ở đây. Bản dịch chuẩn sẽ được hệ thống tạo riêng ở bước đánh giá phản hồi khi học viên nộp bài.

3. NHÃN CHỦ ĐỀ ĐA DẠNG & ĐỘC ĐÁO (TOPIC CONTEXT):
- Bạn hoàn toàn tự do sáng tạo nhãn chủ đề 2–4 từ tiếng Việt (hoặc song ngữ) phản ánh chính xác lát cắt nội dung bạn đã chọn, ví dụ: "Kính thiên văn nghiệp dư", "Hương vị trà đào", "Chuyến bay đêm", "Thuật toán tối ưu", "Cơn mưa rào bất chợt", "Kỷ niệm tuổi thơ", "Triển lãm tranh sơn dầu", "Cắm trại ven hồ", "Kỹ năng sinh tồn"...
- Hãy sáng tạo nhãn chủ đề thật phong phú và đa dạng! Ghi vào trường "topicContext".

4. TỪ VỰNG MỤC TIÊU & TỪ KHÓA HỮU ÍCH:
- Ghi rõ từ tiếng Anh đã chọn từ danh sách ứng viên vào "targetWordFromCollection" kèm nghĩa tiếng Việt và gợi ý ngắn.
- Cung cấp danh sách 3–6 từ/cụm từ tiếng Anh hữu ích liên quan đến câu này trong "keyTargetWords" (để học viên có thể xem gợi ý từ vựng nếu cần). Mỗi mục gồm { "word": "english_word", "translation": "nghĩa tiếng việt", "hint": "loại từ hoặc gợi ý" }.

5. LỜI NHẮN NGỮ CẢNH (PERSONALITY NOTE):
- Viết 1 câu ngắn gọn bằng tiếng Việt giải thích lý do tình huống và từ vựng này hữu ích trong giao tiếp thực tế.

ĐỊNH DẠNG ĐẦU RA (CHỈ TRẢ VỀ JSON THUẦN, KHÔNG DÙNG MARKDOWN BACKTICKS):
{
  "nativeSentence": "Câu tiếng Việt tự nhiên 100%, 6-14 từ, giàu biểu cảm và tự nhiên",
  "topicContext": "Nhãn chủ đề 2-4 từ do bạn tự do sáng tạo",
  "targetWordFromCollection": {
    "word": "từ tiếng Anh chọn từ danh sách ứng viên",
    "translation": "nghĩa tiếng Việt tương ứng trong câu",
    "hint": "gợi ý ngắn gọn về ngữ cảnh"
  },
  "keyTargetWords": [
    { "word": "từ_tiếng_anh", "translation": "nghĩa_tiếng_việt", "hint": "gợi_ý" }
  ],
  "personalityNote": "Lời khuyên ngắn gọn về ngữ cảnh"
}`;

  return { prompt, candidateCollectionWords };
}

function buildChallengePrompt(params: GenerateChallengeParams, randomSeed: string): {
  prompt: string;
  candidateCollectionWords: Word[];
} {
  const nativeLanguage = params.nativeLanguage || "Vietnamese";
  const isVietnameseNative = nativeLanguage.toLowerCase().includes("vi");
  if (isVietnameseNative) {
    return buildVietnameseChallengePrompt(params, randomSeed);
  }

  const targetLanguage = params.targetLanguage || "English";
  const profile = params.personalityProfile;
  const archetype = profile?.archetype || "Pragmatic Professional";
  const rawInterests = profile?.detectedInterests && profile.detectedInterests.length > 0
    ? profile.detectedInterests
    : ["Travel & Dining", "Physics", "programming", "Daily Life & Hobbies"];
  const interests = rawInterests.join(", ");
  const traits = (profile?.archetypeTraits && profile.archetypeTraits.length > 0
    ? profile.archetypeTraits
    : ["Goal-Oriented", "Career-Driven", "Nuance-Sensitive"]).join(", ");
  const modality = profile?.learningPreferences?.primaryModality || "contextual_examples";

  // Grounding in user vocabulary words: endeavor to select the single most suitable word from collection
  let vocabAnchorSection = "";
  let candidateCollectionWords: Word[] = [];
  if (params.words && params.words.length > 0) {
    const validWords = params.words.filter((w) => w.completed !== false);
    candidateCollectionWords = getTranslationChallengeCandidateWords(validWords, {
      maxCandidates: 18,
    });
    if (candidateCollectionWords.length > 0) {
      // Present candidates in a randomized order to prevent the model from always anchoring to the first item
      const displayedCandidates = [...candidateCollectionWords].sort(() => Math.random() - 0.5);
      vocabAnchorSection = `
USER'S WORDS COLLECTION CANDIDATES (FROM DATABASE):
${displayedCandidates.map((w) => `- "${w.word}" (${w.translation || w.definition || "target term"}) [Strength: ${w.strength ?? 0}%]`).join("\n")}

WORD SELECTION RULES:
1. STRICT CONSTRAINT: You MUST select targetWordFromCollection EXCLUSIVELY and VERBATIM from the "USER'S WORDS COLLECTION CANDIDATES" list above.
2. ABSOLUTE PROHIBITION: Under NO circumstances should you select, invent, or output any word outside this candidate list. Do NOT invent new words, and do NOT use placeholder/example words.
3. Carefully evaluate all candidate words and select the SINGLE MOST SUITABLE word from the candidate list that fits naturally into any engaging topic or scenario you freely choose.
4. Explore different words across the candidate list rather than always selecting the first word.
5. Prefer words with lower strength when they fit equally well (to give weaker words a chance to grow).
6. The selected candidate word’s exact native meaning MUST appear explicitly and unmistakably in the nativeSentence so the learner is forced to produce that exact candidate word.
7. Output the chosen candidate word in the "targetWordFromCollection" field with the exact "word" string copied verbatim from the candidate list.
8. If other collection words fit naturally as synonyms or related vocabulary, include them in "keyTargetWords".`;
    }
  }

  if (!vocabAnchorSection) {
    vocabAnchorSection = `
WORD SELECTION RULES:
1. Select the SINGLE MOST SUITABLE word that fits naturally into your chosen topic.
2. Explore varied vocabulary to keep practice fresh and dynamic.
3. The selected word’s exact native meaning MUST appear explicitly and unmistakably in the nativeSentence so the learner is forced to produce the target word.
4. Output the selected word in the "targetWordFromCollection" field.
5. If other related vocabulary fits naturally as synonyms or related vocabulary, include them in "keyTargetWords".`;
  }

  const prompt = `Generate a single personalized translation challenge for a language learner based on real-world sentences.

DIVERSITY SEED: ${randomSeed}

TOTAL FREEDOM OF TOPICS & CONTEXT (HIGH DIVERSITY):
You have complete freedom to choose ANY captivating, authentic, and diverse topic or scenario across human life and thought: science, technology, arts, travel, dining, outdoor exploration, sports, cinema, literature, personal musings, daily encounters, friendships, culture, nature, creative hobbies, unexpected surprises, or lighthearted humor. Keep topics varied and dynamic across challenges.

LEARNER CONTEXT:
- Native Language: ${nativeLanguage}
- Target Language: ${targetLanguage}
- Learner Archetype: ${archetype}
- Learner Traits: ${traits}
- Topics/Interests: ${interests}
- Primary Learning Modality: ${modality}
${vocabAnchorSection}

CRITICAL MANDATES (MUST FOLLOW ALL):

1. REAL-WORLD SITUATIONAL & TOPIC DIVERSITY
Freely explore diverse topics and human experiences across science, nature, travel, food, friendships, creativity, sports, daily life, culture, philosophy, and unexpected encounters. Actively invent unique, original conversational angles.

2. TOPIC LABEL (HIGH DIVERSITY REQUIRED)
Freely create a vivid, specific, and unique 2–4 word topic label in "topicContext" describing your chosen scenario.

3. SENTENCE LENGTH & STYLE
- nativeSentence: exactly 6–14 words.
- Concise, punchy, natural spoken ${nativeLanguage}.
- No multi-clause complexity.
- DIVERSE SENTENCE STRUCTURES: Vary sentence types across challenges (e.g. enthusiastic reaction, casual question, mild complaint, cheerful suggestion, narrative recount, spontaneous observation). Avoid repetitive sentence openers.

4. LANGUAGE PURITY (ZERO TOLERANCE)
- nativeSentence must be 100% ${nativeLanguage}.
- Absolutely no ${targetLanguage} words, loanwords, or untranslated target terms.
- Express every concept in natural ${nativeLanguage}.

5. TARGET WORD PRESENCE
The exact native meaning of the chosen candidate target word MUST appear clearly in nativeSentence.
For example, if your chosen candidate word means "sự phân biệt" or "dệt vải", nativeSentence must explicitly contain that exact native meaning so the user is tested on that exact candidate vocabulary item. Never borrow external words or examples.

6. 1-TO-1 SEMANTIC EQUIVALENCE
nativeSentence and idealTranslation must be exact bidirectional translations.
No added actions, no dropped clauses, no false-friend verbs.

7. IDEAL TRANSLATION
- Concise, polished, natural modern ${targetLanguage}.
- Must contain the exact selected targetWordFromCollection chosen from the candidate list.

8. KEY TARGET WORDS (5–8 items)
Provide a rich list of useful words and natural synonyms from the sentence.
Prefer collection words whenever they fit.
Always include the primary target word.
Format each as: { "word": "...", "translation": "...", "hint": "..." }

9. PERSONALITY NOTE
Short explanation of why this scenario + vocabulary suits a ${archetype?.toLowerCase() || "pragmatic"}, ${traits ? traits.toLowerCase().split(",")[0]?.trim() || "goal-oriented" : "goal-oriented"} learner.

OUTPUT FORMAT (STRICT RAW JSON ONLY — no markdown, no extra text):
{
  "nativeSentence": "Concise sentence in ${nativeLanguage} (6-14 words, ZERO ${targetLanguage})",
  "idealTranslation": "Concise ideal translation in ${targetLanguage}",
  "topicContext": "Freely chosen 2-4 word topic label",
  "targetWordFromCollection": {
    "word": "EXACT word chosen strictly and verbatim from the USER'S WORDS COLLECTION CANDIDATES above",
    "translation": "native meaning of this chosen candidate word",
    "hint": "brief context hint"
  },
  "keyTargetWords": [
    { "word": "${targetLanguage === "English" ? "english_word" : "target_word"}", "translation": "${nativeLanguage.toLowerCase()}", "hint": "synonym / pos / note" }
  ],
  "personalityNote": "Short profile-alignment explanation"
}`;

  return { prompt, candidateCollectionWords };
}

/**
 * Resolves the identified target word from the collection against the user's words array.
 */
function resolveTargetWordFromCollection(
  parsed: any,
  words?: Word[],
  candidateWords: Word[] = []
): ChallengeData["targetWordFromCollection"] {
  if (!words || words.length === 0) return undefined;

  const rawWord = parsed.targetWordFromCollection?.word ||
    (typeof parsed.targetWordFromCollection === "string" ? parsed.targetWordFromCollection : undefined) ||
    parsed.targetWord?.word ||
    parsed.featuredWord?.word;

  let matched: Word | undefined = rawWord ? findWordInCollection(words, rawWord) : undefined;

  // If not directly matched, check keyTargetWords against collection
  if (!matched && Array.isArray(parsed.keyTargetWords)) {
    for (const kw of parsed.keyTargetWords) {
      if (kw?.word) {
        const found = findWordInCollection(words, kw.word);
        if (found) {
          matched = found;
          break;
        }
      }
    }
  }

  // If still not matched, check candidate collection words against ideal translation
  if (!matched && candidateWords.length > 0 && parsed.idealTranslation) {
    for (const cand of candidateWords) {
      if (hasUserIncorporatedWord(parsed.idealTranslation, cand.word)) {
        matched = cand;
        break;
      }
    }
  }

  // If still not matched, check candidate collection words against native sentence (using native translation)
  if (!matched && candidateWords.length > 0 && parsed.nativeSentence) {
    for (const cand of candidateWords) {
      if (cand.translation && parsed.nativeSentence.toLowerCase().includes(cand.translation.toLowerCase().trim())) {
        matched = cand;
        break;
      }
    }
  }

  // Final check: if candidateWords was provided, candidateWords was already checked.
  // Otherwise, check validWords from collection that are eligible for practice (not practiced today and not non-due mastered)
  if (!matched && candidateWords.length === 0 && parsed.idealTranslation) {
    const validWords = words.filter((w) => w.completed !== false && !isWordPracticedToday(w));
    for (const w of validWords.slice(0, 15)) {
      if (hasUserIncorporatedWord(parsed.idealTranslation, w.word)) {
        matched = w;
        break;
      }
    }
  }

  if (matched) {
    const isDirectMatch = rawWord && matched.word.toLowerCase() === rawWord.toLowerCase();
    return {
      id: matched.id,
      word: matched.word,
      translation: matched.translation || (isDirectMatch ? parsed.targetWordFromCollection?.translation : undefined),
      definition: matched.definition,
      hint: (isDirectMatch ? parsed.targetWordFromCollection?.hint : undefined) || matched.translation || matched.definition,
      strength: matched.strength ?? 0,
    };
  }

  return undefined;
}

/**
 * Sanitizes the native sentence to ensure target words (in targetLanguage, e.g. English)
 * are not accidentally left untranslated as loanwords in the native sentence (e.g. Vietnamese).
 */
export function sanitizeNativeSentence(
  nativeSentence: string,
  targetWord?: { word: string; translation?: string },
  keyTargetWords?: Array<{ word: string; translation?: string }>
): string {
  if (!nativeSentence || typeof nativeSentence !== "string") return nativeSentence;
  let result = nativeSentence;

  const pairsToReplace: Array<{ word: string; translation: string }> = [];

  if (targetWord?.word && targetWord?.translation) {
    pairsToReplace.push({ word: targetWord.word.trim(), translation: targetWord.translation.trim() });
  }

  if (Array.isArray(keyTargetWords)) {
    for (const kw of keyTargetWords) {
      if (kw?.word && kw?.translation) {
        pairsToReplace.push({ word: kw.word.trim(), translation: kw.translation.trim() });
      }
    }
  }

  for (const { word, translation } of pairsToReplace) {
    if (!word || !translation || word.toLowerCase() === translation.toLowerCase()) continue;
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`\\b${escaped}\\b`, "gi");
    if (regex.test(result)) {
      result = result.replace(regex, (matched) => {
        if (matched[0] === matched[0].toUpperCase() && matched[0] !== matched[0].toLowerCase()) {
          return translation.charAt(0).toUpperCase() + translation.slice(1);
        }
        return translation.toLowerCase();
      });
    }
  }

  return result;
}

/**
 * Enriches and deduplicates key target words (vocab clues):
 * - Guarantees the primary featured target word from the collection is included as the top clue.
 * - Adds all AI-generated clues (synonyms and alternate valid translations).
 * - Scans user's words collection for any words appearing in the idealTranslation or candidate collection words and appends them.
 */
export function enrichKeyTargetWords(
  rawKeyWords: any[],
  targetWord?: ChallengeData["targetWordFromCollection"],
  words?: Word[],
  idealTranslation?: string,
  candidateWords: Word[] = []
): ChallengeKeyWord[] {
  const result: ChallengeKeyWord[] = [];
  const seen = new Set<string>();

  const addClue = (word: string, translation: string, hint?: string) => {
    const trimmed = (word || "").trim();
    if (!trimmed) return;
    const lower = trimmed.toLowerCase();
    if (seen.has(lower)) return;
    seen.add(lower);
    result.push({
      word: trimmed,
      translation: (translation || "").trim(),
      hint: hint?.trim() || undefined,
    });
  };

  // 1. Featured target word always prioritized first if available
  if (targetWord?.word) {
    addClue(targetWord.word, targetWord.translation || targetWord.definition || "", targetWord.hint || "Featured target word");
  }

  // 2. Add AI-generated clues (rich variety with synonyms and alternative translations)
  if (Array.isArray(rawKeyWords)) {
    for (const kw of rawKeyWords) {
      if (kw?.word) {
        addClue(kw.word, kw.translation || "", kw.hint);
      }
    }
  }

  // 3. Check candidate collection words and entire collection to see if any match words in the ideal translation
  const pool = candidateWords.length > 0 ? candidateWords : (words || []);
  if (pool.length > 0 && idealTranslation) {
    for (const w of pool) {
      if (w?.word && hasUserIncorporatedWord(idealTranslation, w.word)) {
        addClue(w.word, w.translation || w.definition || "", "From your collection");
      }
    }
  }

  return result;
}

/**
 * Client-side LLM call using Cloudflare Workers / direct provider for translation challenge generation
 */
async function generateChallengeClientSide(params: GenerateChallengeParams, randomSeed: string): Promise<ChallengeData> {
  const effectiveConfig = getOverrideConfig(params.llmConfig);
  const nativeLanguage = params.nativeLanguage || "Vietnamese";
  const preferredModels = getPreferredModelsForLanguage(nativeLanguage);
  effectiveConfig.preferredModels = preferredModels;
  effectiveConfig.language = nativeLanguage;
  effectiveConfig.nativeLanguage = nativeLanguage;
  effectiveConfig.onlyReliableModels = true;

  const isVietnameseNative = nativeLanguage.toLowerCase().includes("vi");
  const targetLanguage = params.targetLanguage || "English";
  const { prompt, candidateCollectionWords } = buildChallengePrompt(params, randomSeed);

  const systemInstruction = isVietnameseNative
    ? `Bạn là chuyên gia ngôn ngữ và huấn luyện viên dịch thuật tiếng Việt bản ngữ. Nhiệm vụ của bạn là tạo ra câu tiếng Việt tự nhiên, đời thường, sống động và đậm chất văn hóa giao tiếp thực tế hàng ngày (6-14 từ), không bị ảnh hưởng bởi văn phong dịch máy tiếng Anh, và chứa đựng ý nghĩa của từ vựng tiếng Anh mục tiêu được chọn từ danh sách học viên. Trả về JSON thuần tuý không kèm idealTranslation.`
    : `You are an AI Translation Practice & Challenge Coach creating concise, highly diverse, real-world translation challenges across vibrant daily life, travel, dining, leisure, social, and cultural contexts. Ensure high scenario originality and sentence variety; actively avoid repetitive tropes, clichés, or boilerplate structures. Always output strictly raw valid JSON without markdown formatting. MANDATORY: The 'nativeSentence' MUST be 100% in ${nativeLanguage} with ZERO ${targetLanguage} loanwords or untranslated target terms, MUST explicitly contain the exact native translation of the selected targetWordFromCollection chosen strictly and verbatim from the candidate list (never invent external words or use placeholder examples like 'push back'), and MUST have strict 1-to-1 semantic equivalence with 'idealTranslation' without missing or dropped clauses. Concise (6-14 words). Actively avoid defaulting to corporate office or business management scenarios.`;

  const schemaDescription = isVietnameseNative
    ? `JSON object with nativeSentence, topicContext, targetWordFromCollection object, keyTargetWords array, and personalityNote string.`
    : `JSON object with nativeSentence, idealTranslation, topicContext, targetWordFromCollection object, keyTargetWords array, and personalityNote string.`;

  const startTime = performance.now();
  const resWithMeta = await callLLMClientSideWithMeta(
    prompt,
    systemInstruction,
    schemaDescription,
    effectiveConfig,
    undefined,
    { action: "generateChallenge" }
  );
  const cleaned = cleanJsonResponse(resWithMeta.text);
  const parsed = JSON.parse(cleaned);

  if (!parsed || !parsed.nativeSentence || (!isVietnameseNative && !parsed.idealTranslation)) {
    throw new Error("Invalid payload structure returned from AI model for translation challenge");
  }

  const duration = resWithMeta.responseTimeMs || Math.round(performance.now() - startTime);
  const targetWordFromCollection = resolveTargetWordFromCollection(parsed, params.words, candidateCollectionWords);

  const keyTargetWords = enrichKeyTargetWords(
    parsed.keyTargetWords,
    targetWordFromCollection,
    params.words,
    parsed.idealTranslation,
    candidateCollectionWords
  );

  const sanitizedSentence = sanitizeNativeSentence(
    parsed.nativeSentence,
    targetWordFromCollection,
    keyTargetWords
  );

  return {
    id: `challenge-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    nativeSentence: sanitizedSentence,
    targetLanguage,
    nativeLanguage,
    topicContext: parsed.topicContext || "Daily Conversation",
    idealTranslation: parsed.idealTranslation,
    targetWordFromCollection,
    keyTargetWords,
    personalityNote: parsed.personalityNote,
    createdAt: new Date().toISOString(),
    provider: resWithMeta.provider,
    model: resWithMeta.model,
    responseTimeMs: duration,
  };
}

/**
 * Generate a new personalized translation challenge via backend API or Cloudflare Worker LLM
 */
export async function generateChallenge(params: GenerateChallengeParams): Promise<ChallengeData> {
  const randomSeed = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  const effectiveConfig = getOverrideConfig(params.llmConfig);
  const effectiveParams = { ...params, llmConfig: effectiveConfig };

  notifyLlmRequestStartFromConfig(effectiveConfig, "generateChallenge");

  // 1. Static host environment (e.g. GitHub Pages): use Cloudflare Worker / client-side LLM directly
  if (isStaticHost()) {
    return generateChallengeClientSide(effectiveParams, randomSeed);
  }

  // 2. Full-stack host environment: try Express backend with automatic fallback to Cloudflare Worker LLM
  try {
    const res = await fetchWithTimeout("/api/generate-challenge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(effectiveParams)
    });

    const data = await safeParseResponseJson(res);

    if (res.ok && data && data.nativeSentence) {
      let targetWord: ChallengeData["targetWordFromCollection"] = undefined;
      if (effectiveParams.words && effectiveParams.words.length > 0) {
        if (data.targetWordFromCollection?.id && effectiveParams.words.some((w) => w.id === data.targetWordFromCollection.id)) {
          targetWord = data.targetWordFromCollection;
        } else {
          targetWord = resolveTargetWordFromCollection(data, effectiveParams.words);
        }
      } else {
        targetWord = data.targetWordFromCollection;
      }

      const keyTargetWords = enrichKeyTargetWords(
        data.keyTargetWords,
        targetWord,
        effectiveParams.words,
        data.idealTranslation
      );

      const sanitizedSentence = sanitizeNativeSentence(
        data.nativeSentence,
        targetWord,
        keyTargetWords
      );

      const duration = data.responseTimeMs || 0;
      logApiRequest({
        provider: data.provider || "auto",
        model: data.model || "auto",
        prompt: `Generate translation challenge for ${effectiveParams.targetLanguage || "English"} (Native: ${effectiveParams.nativeLanguage || "Vietnamese"})`,
        systemInstruction: "AI Translation Practice & Challenge Coach",
        response: JSON.stringify(data),
        responseTimeMs: duration,
        status: "success",
        statusCode: 200,
        action: "Translation Challenge"
      }).catch(() => undefined);

      publishLlmRequestEnd({
        provider: data.provider,
        model: data.model,
        action: "generateChallenge",
        success: true,
        timestamp: Date.now()
      });

      return {
        id: `challenge-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        nativeSentence: sanitizedSentence,
        targetLanguage: effectiveParams.targetLanguage || "English",
        nativeLanguage: effectiveParams.nativeLanguage || "Vietnamese",
        topicContext: data.topicContext || "Personalized Practice",
        idealTranslation: data.idealTranslation,
        targetWordFromCollection: targetWord,
        keyTargetWords,
        personalityNote: data.personalityNote,
        createdAt: new Date().toISOString(),
        provider: data.provider,
        model: data.model,
        responseTimeMs: data.responseTimeMs,
      };
    }
    throw new Error(data?.error || `Server returned status ${res.status}`);
  } catch (err: any) {
    console.warn("Backend /api/generate-challenge endpoint unavailable, falling back to Cloudflare Worker / client-side LLM:", err);
    return generateChallengeClientSide(effectiveParams, randomSeed);
  }
}

/**
 * Checks whether user message is an empty submission / give-up attempt
 */
export function isEmptySubmissionMessage(msg?: string): boolean {
  if (!msg || !msg.trim()) return true;
  const lower = msg.trim().toLowerCase();
  return (
    lower === "(no answer provided)" ||
    lower === "(submit empty answer)" ||
    lower === "submit empty answer" ||
    lower === "submit empty" ||
    lower.includes("submit empty") ||
    lower === "skip" ||
    lower === "give up" ||
    lower === "reveal answer" ||
    lower === "bỏ qua" ||
    lower === "xem đáp án"
  );
}

/**
 * Detects whether a user submission looks like an accidental/incomplete sentence fragment.
 * E.g., user accidentally pressed Enter mid-sentence while typing.
 */
export function isIncompleteSubmission(userMessage: string, challenge: ChallengeData): boolean {
  if (!userMessage || !userMessage.trim()) return false;
  if (isEmptySubmissionMessage(userMessage)) return false;

  const text = userMessage.trim();

  // If text ends with sentence-ending punctuation, user likely intended it as a complete sentence
  if (/[.?!…]$/.test(text)) {
    return false;
  }

  const userWords = text.split(/\s+/).filter(Boolean);
  const idealWords = (challenge.idealTranslation || challenge.nativeSentence || "").split(/\s+/).filter(Boolean);

  // Case 1: Ideal translation is a full sentence (5+ words), but user submitted only 1-2 words
  if (idealWords.length >= 5 && userWords.length <= 2) {
    return true;
  }

  // Case 2: Ideal translation is 25+ chars long, but user submitted < 12 chars
  if ((challenge.idealTranslation || "").length >= 25 && text.length < 12) {
    return true;
  }

  // Case 3: Ends with trailing conjunctions/prepositions/auxiliaries indicating an unfinished phrase
  const trailingConnectives = [
    "the", "a", "an", "is", "are", "was", "were", "to", "in", "at", "of", "for", "with",
    "that", "this", "and", "or", "because", "if", "when", "while", "as", "how", "what",
    "will", "would", "should", "could", "can", "may", "might"
  ];
  const lastWord = userWords[userWords.length - 1]?.toLowerCase();
  if (idealWords.length >= 4 && lastWord && trailingConnectives.includes(lastWord)) {
    return true;
  }

  return false;
}

/**
 * Creates an incomplete submission turn result prompting the user to complete their answer
 */
export function createIncompleteSubmissionResponse(params: ChallengeTurnParams): ChallengeTurnResult {
  const { userMessage, nativeLanguage = "Vietnamese" } = params;
  const isVietnameseNative = nativeLanguage.toLowerCase().includes("vi");
  const draft = userMessage.trim();
  const shortDraft = draft.length > 25 ? draft.slice(0, 25) + "…" : draft;

  return {
    intent: "incomplete",
    agentReply: isVietnameseNative
      ? `⚠️ **Phát hiện câu trả lời chưa hoàn thành**\n\nCó vẻ như bạn đã gửi câu khi chưa gõ xong *(bạn có bấm nhầm phím Enter không? 😉)*\n\n**Bản nháp của bạn:** *"${draft}"*\n\n👉 Hãy tiếp tục gõ bản dịch hoàn chỉnh bên dưới hoặc bấm nút để điền lại bản nháp!`
      : `⚠️ **Incomplete Answer Detected**\n\nIt looks like your answer was sent before you finished typing *(did you press Enter by mistake? 😉)*\n\n**Your draft:** *"${draft}"*\n\n👉 Please type your full translation below or tap the button to repopulate your draft!`,
    suggestedActions: [
      {
        label: `✏️ Repopulate draft: "${shortDraft}"`,
        action: "repopulate_input",
        payload: { text: draft }
      },
      { label: isVietnameseNative ? "🏳️ Xem đáp án & bỏ qua" : "🏳️ Reveal answer & skip", action: "submit_empty_challenge" },
      { label: isVietnameseNative ? "🏆 Tổng quan luyện tập" : "🏆 Practice overview", action: "start_practice" }
    ],
    provider: "local",
    model: "instant-detection",
    responseTimeMs: 15,
  };
}

/**
 * Creates a complete evaluation for an empty submission showing ideal translation and target word
 */
export function createEmptySubmissionEvaluation(params: ChallengeTurnParams): ChallengeTurnResult {
  const { challenge, nativeLanguage = "Vietnamese" } = params;
  const isVietnameseNative = nativeLanguage.toLowerCase().includes("vi");
  const targetCol = challenge.targetWordFromCollection;
  const targetWord = targetCol?.word || (challenge.keyTargetWords?.[0]?.word || "");

  const suggestedVocabulary: ChallengeSuggestedVocab[] = [];
  if (targetCol) {
    suggestedVocabulary.push({
      word: targetCol.word,
      translation: targetCol.translation || "",
      definition: targetCol.definition || "",
      hint: targetCol.hint || "Featured target word from collection",
      partOfSpeech: "target word",
      askedByUser: false,
    });
  }
  if (Array.isArray(challenge.keyTargetWords)) {
    for (const kw of challenge.keyTargetWords) {
      if (kw?.word && (!targetCol || kw.word.toLowerCase() !== targetCol.word.toLowerCase())) {
        suggestedVocabulary.push({
          word: kw.word,
          translation: kw.translation || "",
          definition: "",
          hint: kw.hint || "Key vocabulary from challenge",
          partOfSpeech: kw.hint || "",
          askedByUser: false,
        });
      }
    }
  }

  return {
    intent: "submission",
    evaluation: {
      score: 0,
      scoreLabel: isVietnameseNative ? "Xem đáp án & Học tập! 💡" : "Review & Learn! 💡",
      userTranslation: "(No answer provided)",
      incorporatedTargetWord: false,
      targetWordUsed: targetWord,
      whatWentWell: isVietnameseNative
        ? "Bạn đã chủ động xem đáp án mẫu để củng cố cách diễn đạt và ghi nhớ từ vựng mục tiêu."
        : "You took this opportunity to review the sentence structure and learn the target vocabulary.",
      areasForImprovement: isVietnameseNative
        ? `Hãy ghi nhớ cách dùng từ vựng "${targetWord}" trong câu mẫu: "${challenge.idealTranslation}".`
        : `Study the ideal translation: "${challenge.idealTranslation}" and practice incorporating the target word "${targetWord}" into future sentences.`,
      correctedSentence: challenge.idealTranslation,
      suggestedVocabulary,
    },
    provider: "local",
    model: "instant-evaluation",
    responseTimeMs: 50,
  };
}

/**
 * Client-side LLM call using Cloudflare Workers / direct provider for evaluating challenge turn
 */
async function processChallengeTurnClientSide(params: ChallengeTurnParams): Promise<ChallengeTurnResult> {
  const { challenge, userMessage, chatHistory = [], nativeLanguage = "Vietnamese", targetLanguage = "English", llmConfig } = params;
  const isVietnameseNative = nativeLanguage.toLowerCase().includes("vi");
  const isEmptySub = isEmptySubmissionMessage(userMessage);

  if (isEmptySub && challenge.idealTranslation) {
    return createEmptySubmissionEvaluation(params);
  }

  if (isIncompleteSubmission(userMessage, challenge)) {
    return createIncompleteSubmissionResponse(params);
  }

  const nativeSentence = challenge.nativeSentence;
  const idealTranslation = challenge.idealTranslation;
  const rawClues = (challenge.keyTargetWords || []).map((kw: any) => kw.word?.trim()).filter(Boolean);
  const formattedClues = rawClues.length > 0 ? rawClues.map((w: string) => `"${w}"`).join(", ") : "(None)";
  const keyTargetWords = JSON.stringify(challenge.keyTargetWords || []);
  const targetWord = challenge.targetWordFromCollection?.word || "";

  const formattedHistory = chatHistory.map((m: any) => `${m.sender.toUpperCase()}: ${m.text}`).join("\n");

  let prompt = "";
  let systemInstruction = "";
  let schemaDescription = "";

  if (isVietnameseNative) {
    prompt = `Đánh giá thử thách dịch thuật (Translation Challenge) từ tiếng Việt sang ${targetLanguage}.

THÔNG TIN THỬ THÁCH:
- Câu tiếng Việt gốc: "${nativeSentence}"
- Từ vựng mục tiêu từ bộ sưu tập: "${targetWord}"
${idealTranslation ? `- Bản dịch tham khảo trước đó: "${idealTranslation}"` : `- Chưa có bản dịch mẫu (BẠN BẮT BUỘC TẠO CÂU DỊCH CHUẨN TỰ NHIÊN NHẤT TRONG "correctedSentence")`}
- Danh sách từ gợi ý (Vocabulary Clues): [${formattedClues}]
- Chi tiết từ gợi ý: ${keyTargetWords}
- Ngôn ngữ đích: ${targetLanguage}
- Tiếng mẹ đẻ: Tiếng Việt

LỊCH SỬ HỘI THOẠI TRƯỚC ĐÓ:
${formattedHistory || "(Không có)"}

${isEmptySub
  ? "HỌC VIÊN YÊU CẦU: Học viên đã bấm 'Xem đáp án & bỏ qua' mà không nhập câu trả lời."
  : `BẢN DỊCH HỌC VIÊN NỘP:\n"${userMessage}"`
}

NHIỆM VỤ ĐÁNH GIÁ:
1. TẠO CÂU DỊCH MẪU CHUẨN XÁC, TỰ NHIÊN NHẤT ("correctedSentence"):
   - Dịch câu tiếng Việt gốc sang ${targetLanguage} một cách tự nhiên, chuẩn mực, giàu tính khẩu ngữ đời thường của người bản xứ ${targetLanguage}.
   - Câu dịch mẫu BẮT BUỘC phải chứa từ vựng mục tiêu "${targetWord}" (hoặc dạng biến cách/thì phù hợp của từ đó).

2. ĐÁNH GIÁ VÀ PHẢN HỒI (NẾU HỌC VIÊN NỘP BÀI):
   - ĐÁNH GIÁ LINH HOẠT VỚI NHIỀU CÁCH DIỄN ĐẠT & TỪ ĐỒNG NGHĨA: Real-life language có nhiều cách nói tương đương. Hãy công nhận và cho điểm cao nếu học viên dùng từ đồng nghĩa tự nhiên hoặc cấu trúc khác mà truyền tải trọn vẹn, tự nhiên ý nghĩa câu tiếng Việt.
   - Chấm điểm độ chính xác (0 đến 100).
   - Gán scoreLabel: "Xuất sắc! 🌟" (90-100), "Làm tốt lắm! 👏" (75-89), "Khá tốt! 👍" (60-74), "Cần luyện tập thêm! 💪" (<60).
   
   - QUY TẮC CHÍNH XÁC CHO "incorporatedTargetWord" (TỪ VỰNG MỤC TIÊU):
     + Gán "incorporatedTargetWord": true NẾU VÀ CHỈ NẾU câu của học viên thực sự sử dụng từ vựng mục tiêu "${targetWord}" (chấp nhận cả các dạng chia thì, số nhiều/số ít, tiền tố/hậu tố, trạng từ -ly, phrasal verb tách rời, biến thể dấu gạch nối / khoảng trắng như "cost-effective" / "cost effective", cũng như các biến thể nhỏ về mạo từ và sở hữu cách trong cụm từ như có hoặc không có "a", "an", "the", hoặc dùng sở hữu cách "my", "his", "her", "their"... ví dụ: chấp nhận "pursue PhD" hoặc "pursue his PhD" khi từ mục tiêu là "pursue a PhD").
     + BẮT BUỘC gán "incorporatedTargetWord": false NẾU học viên KHÔNG dùng từ/cụm từ "${targetWord}" (ví dụ: dùng từ đồng nghĩa khác hoàn toàn như 'affordable' thay cho 'cost-effective' hay 'drop by' thay cho 'come over', hoặc không nhắc đến, hoặc bỏ trống/bỏ qua).
     + Khi "incorporatedTargetWord" là false: TUYỆT ĐỐI KHÔNG khen trong "whatWentWell" rằng học viên đã dùng "${targetWord}". Thay vào đó, hãy khen ngợi từ đồng nghĩa/cấu trúc tự nhiên họ đã dùng trong "whatWentWell", và trong "areasForImprovement" hãy gợi ý cách lồng ghép từ mục tiêu "${targetWord}".
     + Khi "incorporatedTargetWord" là true: Hãy ghi nhận và khen ngợi cách dùng chuẩn xác của từ mục tiêu "${targetWord}" trong "whatWentWell" (nếu có thiếu sót nhỏ về mạo từ như thiếu "a", vẫn có thể nhắc nhở nhẹ trong "areasForImprovement" nhưng vẫn tính "incorporatedTargetWord": true).

   - QUY TẮC CHÍNH XÁC CHO "incorporatedVocabClues" (CÁC TỪ GỢI Ý ĐÃ DÙNG):
     + Danh sách các từ gợi ý trong thử thách này: [${formattedClues}].
     + Rà soát kỹ lưỡng câu dịch của học viên xem học viên có sử dụng bất kỳ từ nào trong danh sách gợi ý trên không (chấp nhận các dạng chia thì/ngữ pháp/dấu nối tương đương).
     + Trả về mảng "incorporatedVocabClues" chứa chính xác tên các từ gợi ý mà học viên ĐÃ THỰC SỰ SỬ DỤNG (ví dụ: ["service", "print"]).
     + Nếu học viên KHÔNG sử dụng từ gợi ý nào trong danh sách trên (hoặc bỏ qua/xem đáp án), BẮT BUỘC trả về mảng rỗng: [].
     + TUYỆT ĐỐI KHÔNG đưa từ vào "incorporatedVocabClues" nếu học viên không hề viết từ đó trong bản dịch của họ.

   - "whatWentWell": Lời khen ngợi chi tiết, thân thiện bằng TIẾNG VIỆT (chỉ ra cụm từ dùng hay, ngữ pháp chuẩn).
   - "areasForImprovement": Góp ý xây dựng bằng TIẾNG VIỆT giải thích rõ ràng về giới từ, thì, sắc thái tự nhiên hoặc lưu ý để câu mượt mà hơn.
   - "suggestedVocabulary": Danh sách 3-5 từ vựng/cụm từ hay trong câu kèm nghĩa tiếng Việt.

3. NẾU HỌC VIÊN BỎ QUA / XEM ĐÁP ÁN:
   - score: 0, scoreLabel: "Xem đáp án & Học tập! 💡", userTranslation: "(No answer provided)", incorporatedTargetWord: false, incorporatedVocabClues: [].
   - "whatWentWell": Lời động viên bằng tiếng Việt.
   - "areasForImprovement": Giải thích ngắn gọn bằng tiếng Việt về cách dùng từ "${targetWord}" trong câu dịch mẫu "${targetLanguage}".

TRẢ VỀ JSON THUẦN:
{
  "intent": "submission",
  "evaluation": {
    "score": 85,
    "scoreLabel": "Làm tốt lắm! 👏",
    "userTranslation": "${isEmptySub ? "(No answer provided)" : "bản dịch của học viên"}",
    "incorporatedTargetWord": false,
    "targetWordUsed": "${targetWord}",
    "incorporatedVocabClues": ["word1"],
    "whatWentWell": "Lời khen cụ thể bằng tiếng Việt...",
    "areasForImprovement": "Góp ý chi tiết bằng tiếng Việt...",
    "correctedSentence": "Câu dịch tiếng Anh chuẩn tự nhiên nhất",
    "suggestedVocabulary": [
      {
        "word": "word",
        "translation": "nghĩa tiếng Việt",
        "definition": "định nghĩa",
        "partOfSpeech": "loại từ",
        "hint": "gợi ý ngữ cảnh",
        "example": "câu ví dụ",
        "exampleTranslation": "dịch ví dụ",
        "askedByUser": false
      }
    ]
  }
} `;

    systemInstruction = `Bạn là chuyên gia đánh giá thử thách dịch thuật tiếng Việt sang ${targetLanguage}. Tạo câu dịch mẫu tự nhiên nhất ("correctedSentence") có chứa từ vựng mục tiêu "${targetWord}", đánh giá linh hoạt bản dịch của học viên, và đưa ra nhận xét bằng tiếng Việt chi tiết, dễ hiểu. Đánh giá "incorporatedTargetWord" (true nếu học viên thực sự dùng từ mục tiêu hoặc biến thể ngữ pháp/mạo từ/sở hữu cách hợp lý) và "incorporatedVocabClues" (danh sách các từ gợi ý mà học viên đã dùng). Trả về JSON thuần.`;
    schemaDescription = `JSON object with intent: "submission" and evaluation object containing correctedSentence, score, scoreLabel, whatWentWell, areasForImprovement, incorporatedTargetWord (boolean), targetWordUsed (string), incorporatedVocabClues (string array of used clues), and suggestedVocabulary.`;
  } else {
    prompt = `Evaluate a language learner's translation attempt during a Translation Challenge.

CHALLENGE DETAILS:
- Native Sentence (${nativeLanguage}): "${nativeSentence}"
- Ideal Target Translation (${targetLanguage}): "${idealTranslation || "(Not pre-computed - please generate the optimal natural translation)"}"
- Designated Vocabulary Clues: [${formattedClues}]
- Key Target Words Details: ${keyTargetWords}
- Featured Target Word from Collection: "${targetWord}"
- Target Language: ${targetLanguage}
- Native Language: ${nativeLanguage}

CONVERSATION HISTORY SO FAR:
${formattedHistory || "(No prior messages in this challenge session)"}

${isEmptySub
  ? "LEARNER REQUEST: Learner chose to reveal answer / skip without entering a translation."
  : `LATEST USER SUBMISSION:\n"${userMessage}"`
}

TASK:
1. Check if the user's submission is an incomplete fragment (e.g. accidentally pressed Enter before finishing the sentence).
   If it is clearly an incomplete sentence fragment, set intent: "incomplete" and provide agentReply in ${nativeLanguage} or simple English noting that their answer looks incomplete.

2. Otherwise, treat as a complete translation attempt (intent: "submission"):
   - GENERATE THE OPTIMAL TARGET TRANSLATION ("correctedSentence"):
     Create a concise, idiomatic, natural modern ${targetLanguage} translation incorporating the target word "${targetWord}".
   - Evaluate their translation against the native sentence and optimal translation.
   - FLEXIBILITY FOR MULTIPLE CORRECT TRANSLATIONS & SYNONYMS:
     Real-world language has multiple valid ways to express the same thought. Acknowledge and credit valid alternative vocabulary, natural synonyms, and different correct grammatical structures.
   - Calculate an overall accuracy score from 0 to 100. If skipped/empty: score 0, scoreLabel: "Review & Learn! 💡".
   
   - STRICT CHECK FOR "incorporatedTargetWord" (FEATURED TARGET WORD):
     + Set "incorporatedTargetWord": true IF AND ONLY IF the learner actually included the featured target word "${targetWord}" or its valid grammatical inflections / forms (e.g. past tense, gerund, plural, adverbial forms like -ly, separable phrasal verb particles, hyphen/space compound variants like "cost-effective" / "cost effective", as well as minor variations in articles and possessives in phrases such as omitting or substituting "a", "an", "the", or possessives "his", "her", "my", "their" — e.g. accepting "pursue PhD" or "pursue his PhD" when the target is "pursue a PhD").
     + Set "incorporatedTargetWord": false IF the learner used an entirely different synonym (e.g. "affordable" instead of "${targetWord}"), omitted it, or skipped.
     + When "incorporatedTargetWord" is false: Never claim in "whatWentWell" that the user used "${targetWord}". Instead, praise their natural synonym/phrasing in "whatWentWell" and suggest how to apply "${targetWord}" in "areasForImprovement".
     + When "incorporatedTargetWord" is true: Acknowledge and praise their correct use of "${targetWord}" in "whatWentWell" (if there is a minor article omission such as missing "a", note it constructively in "areasForImprovement" while still counting "incorporatedTargetWord": true).

   - STRICT CHECK FOR "incorporatedVocabClues" (CLUE WORDS ACTUALLY USED):
     + Designated Vocabulary Clues for this challenge: [${formattedClues}].
     + Inspect the learner's submitted translation carefully. Identify any words from the designated clues list above that the learner actually wrote or incorporated (including their inflectional or hyphen/space forms).
     + Return an array of the exact clue word strings that the learner incorporated, e.g. ["service", "print"].
     + If the learner did NOT incorporate any of the designated clues, return an empty array: [].
     + Do NOT hallucinate or include any clue words in "incorporatedVocabClues" that do not appear in the learner's text.

   - List "whatWentWell" and "areasForImprovement".
   - Provide "suggestedVocabulary": an array of 3-5 vocabulary items containing key terms from the challenge.

3. IF LEARNER SKIPS / REVEALS ANSWER:
   - score: 0, scoreLabel: "Review & Learn! 💡", userTranslation: "(No answer provided)", incorporatedTargetWord: false, incorporatedVocabClues: [].

Return STRICTLY raw JSON matching:
{
  "intent": "submission" | "incomplete",
  "agentReply": "Helpful reply if intent is incomplete",
  "evaluation": {
    "score": 85,
    "scoreLabel": "Great Job! 👏",
    "userTranslation": "learner's submitted translation text",
    "incorporatedTargetWord": false,
    "targetWordUsed": "${targetWord}",
    "incorporatedVocabClues": ["word1", "word2"],
    "whatWentWell": "Praise paragraph...",
    "areasForImprovement": "Improvement paragraph...",
    "correctedSentence": "Optimal target translation",
    "suggestedVocabulary": [
      {
        "word": "word",
        "translation": "translation",
        "definition": "definition",
        "partOfSpeech": "part_of_speech",
        "hint": "context hint",
        "example": "example sentence",
        "exampleTranslation": "example translation",
        "askedByUser": false
      }
    ]
  }
}`;

    systemInstruction = `You are an AI Translation Challenge Evaluation Coach. Evaluate translation attempts in strict JSON output. Determine whether the learner incorporated the designated target word ("incorporatedTargetWord", accepting minor article/possessive variations) and which clue words they incorporated ("incorporatedVocabClues").`;
    schemaDescription = `JSON object with intent ("submission" | "incomplete"), agentReply if incomplete, and evaluation object containing score, scoreLabel, userTranslation, incorporatedTargetWord (boolean), targetWordUsed (string), incorporatedVocabClues (string array), whatWentWell, areasForImprovement, correctedSentence, and suggestedVocabulary.`;
  }

  const startTime = performance.now();
  const effectiveConfig = getOverrideConfig(llmConfig);
  const preferredModels = getPreferredModelsForLanguage(nativeLanguage);
  effectiveConfig.preferredModels = preferredModels;
  effectiveConfig.language = nativeLanguage;
  effectiveConfig.nativeLanguage = nativeLanguage;
  effectiveConfig.onlyReliableModels = true;

  const resWithMeta = await callLLMClientSideWithMeta(
    prompt,
    systemInstruction,
    schemaDescription,
    effectiveConfig,
    undefined,
    { action: "processChallengeTurn" }
  );
  const cleaned = cleanJsonResponse(resWithMeta.text);
  const parsed = JSON.parse(cleaned);

  if (!parsed || !parsed.intent) {
    throw new Error("Invalid challenge turn structure returned from AI model.");
  }

  if (parsed.evaluation) {
    parsed.evaluation.userTranslation = parsed.evaluation.userTranslation?.trim() || userMessage.trim();
    if (targetWord) {
      if (isEmptySub) {
        parsed.evaluation.incorporatedTargetWord = false;
      } else {
        // Rely directly on LLM evaluation (no validation gate)
        parsed.evaluation.incorporatedTargetWord = Boolean(parsed.evaluation.incorporatedTargetWord);
      }
      parsed.evaluation.targetWordUsed = parsed.evaluation.targetWordUsed || targetWord;
    }

    if (isEmptySub) {
      parsed.evaluation.incorporatedVocabClues = [];
    } else if (Array.isArray(parsed.evaluation.incorporatedVocabClues)) {
      // Rely directly on LLM evaluation for mentioned clues
      parsed.evaluation.incorporatedVocabClues = parsed.evaluation.incorporatedVocabClues
        .filter((w: any) => typeof w === "string" && w.trim().length > 0)
        .map((w: string) => w.trim());
    } else {
      parsed.evaluation.incorporatedVocabClues = [];
    }
  }

  const duration = resWithMeta.responseTimeMs || Math.round(performance.now() - startTime);

  return {
    ...parsed,
    provider: resWithMeta.provider,
    model: resWithMeta.model,
    responseTimeMs: duration,
  } as ChallengeTurnResult;
}

/**
 * Process a turn in the interactive challenge via backend API or Cloudflare Worker LLM
 */
export async function processChallengeTurn(params: ChallengeTurnParams): Promise<ChallengeTurnResult> {
  // 1. Static host environment (e.g. GitHub Pages): use Cloudflare Worker / client-side LLM directly
  if (isStaticHost()) {
    return processChallengeTurnClientSide(params);
  }

  // 2. Full-stack host environment: try Express backend with automatic fallback to Cloudflare Worker LLM
  try {
    const res = await fetchWithTimeout("/api/challenge-turn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params)
    });

    const data = await safeParseResponseJson(res);

    if (res.ok && data && data.intent) {
      if (data.evaluation) {
        const isEmptySub = params.userMessage.trim() === "" || params.userMessage.trim() === "🔍";
        data.evaluation.userTranslation = data.evaluation.userTranslation?.trim() || params.userMessage.trim();
        const targetWord = params.challenge.targetWordFromCollection?.word;
        if (targetWord) {
          if (isEmptySub) {
            data.evaluation.incorporatedTargetWord = false;
          } else {
            // Rely directly on LLM evaluation (no validation gate)
            data.evaluation.incorporatedTargetWord = Boolean(data.evaluation.incorporatedTargetWord);
          }
          data.evaluation.targetWordUsed = data.evaluation.targetWordUsed || targetWord;
        }

        if (isEmptySub) {
          data.evaluation.incorporatedVocabClues = [];
        } else if (Array.isArray(data.evaluation.incorporatedVocabClues)) {
          // Rely directly on LLM evaluation for mentioned clues
          data.evaluation.incorporatedVocabClues = data.evaluation.incorporatedVocabClues
            .filter((w: any) => typeof w === "string" && w.trim().length > 0)
            .map((w: string) => w.trim());
        } else {
          data.evaluation.incorporatedVocabClues = [];
        }
      }

      logApiRequest({
        provider: data.provider || "auto",
        model: data.model || "auto",
        prompt: `Evaluate translation attempt for "${params.challenge.nativeSentence}": "${params.userMessage}"`,
        systemInstruction: "AI Translation Challenge Evaluation Coach",
        response: JSON.stringify(data),
        responseTimeMs: data.responseTimeMs || 0,
        status: "success",
        statusCode: 200,
        action: "Challenge Evaluation"
      }).catch(() => undefined);

      publishLlmRequestEnd({
        provider: data.provider,
        model: data.model,
        action: "processChallengeTurn",
        success: true,
        timestamp: Date.now()
      });

      return data as ChallengeTurnResult;
    }
    throw new Error(data?.error || `Server returned status ${res.status}`);
  } catch (err: any) {
    console.warn("Backend /api/challenge-turn endpoint unavailable, falling back to Cloudflare Worker / client-side LLM:", err);
    return processChallengeTurnClientSide(params);
  }
}

