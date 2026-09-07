import { 
  Word, 
  LLMConfig, 
  ImmersionStory, 
  ImmersionStoryParagraph,
  ImmersionStoryWord,
  MinedSentence 
} from "../types";
import { cleanAndParseJson } from "../utils/jsonSanitizer";
import { callLLMClientSideWithMeta, getOverrideConfig } from "./llmClientService";
import { notifyLlmRequestStartFromConfig } from "../utils/llmEvents";

// Helper for LLM prompt completions with metadata
async function sendLlmRequestWithMeta(params: {
  prompt: string;
  systemInstruction?: string;
  schemaDescription?: string;
  llmConfig?: LLMConfig;
  action?: string;
}): Promise<{ text: string; provider: string; model: string; responseTimeMs: number }> {
  const effectiveConfig = getOverrideConfig(params.llmConfig);
  notifyLlmRequestStartFromConfig(effectiveConfig);
  const startTime = performance.now();
  const res = await callLLMClientSideWithMeta(
    params.prompt,
    params.systemInstruction || "You are an expert language learning assistant.",
    params.schemaDescription || "JSON object",
    effectiveConfig,
    undefined,
    { action: params.action }
  );
  const duration = res.responseTimeMs || Math.round(performance.now() - startTime);
  return {
    text: res.text,
    provider: res.provider,
    model: res.model,
    responseTimeMs: duration
  };
}

// LocalStorage Keys
const MINED_SENTENCES_STORAGE_KEY = "vocab_mined_sentences_v1";

interface DictionaryItem {
  pattern: RegExp;
  word: string;
  partOfSpeech: "phrasal verb" | "verb + prep" | "adj + prep" | "noun";
  definition: string;
  translationMap?: Record<string, string>;
}

const PHRASAL_VERBS_DICTIONARY: DictionaryItem[] = [
  {
    pattern: /\b(?:carry|carried|carrying|carries)\s+out\b/i,
    word: "carry out",
    partOfSpeech: "phrasal verb",
    definition: "To perform, conduct, or complete an experiment or task",
    translationMap: { Vietnamese: "tiến hành, thực hiện", Spanish: "llevar a cabo", French: "mener à bien" }
  },
  {
    pattern: /\b(?:figure|figured|figuring|figures)\s+out\b/i,
    word: "figure out",
    partOfSpeech: "phrasal verb",
    definition: "To solve, understand, or find a solution through thinking",
    translationMap: { Vietnamese: "tìm ra, hiểu ra", Spanish: "averiguar, descifrar", French: "comprendre, trouver" }
  },
  {
    pattern: /\b(?:find|found|finding|finds)\s+out\b/i,
    word: "find out",
    partOfSpeech: "phrasal verb",
    definition: "To discover or learn new information or a fact",
    translationMap: { Vietnamese: "phát hiện, tìm ra", Spanish: "descubrir, enterarse", French: "découvrir" }
  },
  {
    pattern: /\b(?:bring|brought|bringing|brings)\s+about\b/i,
    word: "bring about",
    partOfSpeech: "phrasal verb",
    definition: "To cause something to happen or result in a change",
    translationMap: { Vietnamese: "gây ra, mang lại", Spanish: "provocar, ocasionar", French: "provoquer, amener" }
  },
  {
    pattern: /\b(?:look|looked|looking|looks)\s+into\b/i,
    word: "look into",
    partOfSpeech: "phrasal verb",
    definition: "To investigate, examine, or explore a problem",
    translationMap: { Vietnamese: "nghiên cứu, xem xét kỹ", Spanish: "investigar", French: "examiner" }
  },
  {
    pattern: /\b(?:come|came|coming|comes)\s+across\b/i,
    word: "come across",
    partOfSpeech: "phrasal verb",
    definition: "To find or meet unexpectedly or by chance",
    translationMap: { Vietnamese: "tình cờ bắt gặp", Spanish: "tropezar con", French: "tomber sur" }
  },
  {
    pattern: /\b(?:set|setting|sets)\s+up\b/i,
    word: "set up",
    partOfSpeech: "phrasal verb",
    definition: "To establish, assemble, or prepare an apparatus or organization",
    translationMap: { Vietnamese: "thiết lập, dựng lên", Spanish: "establecer, montar", French: "mettre en place" }
  },
  {
    pattern: /\b(?:point|pointed|pointing|points)\s+out\b/i,
    word: "point out",
    partOfSpeech: "phrasal verb",
    definition: "To draw attention to a notable fact or detail",
    translationMap: { Vietnamese: "chỉ ra, vạch ra", Spanish: "señalar", French: "souligner" }
  },
  {
    pattern: /\b(?:break|broke|broken|breaking|breaks)\s+through\b/i,
    word: "break through",
    partOfSpeech: "phrasal verb",
    definition: "To make a major advance or overcome a barrier",
    translationMap: { Vietnamese: "đột phá, vượt qua", Spanish: "abrirse paso", French: "percer" }
  },
  {
    pattern: /\b(?:turn|turned|turning|turns)\s+out\b/i,
    word: "turn out",
    partOfSpeech: "phrasal verb",
    definition: "To prove to be the case or have a particular result",
    translationMap: { Vietnamese: "hóa ra, thành ra", Spanish: "resultar", French: "s'avérer" }
  },
  {
    pattern: /\b(?:give|gave|given|giving|gives)\s+up\b/i,
    word: "give up",
    partOfSpeech: "phrasal verb",
    definition: "To stop trying or cease pursuing an effort",
    translationMap: { Vietnamese: "từ bỏ, buông xuôi", Spanish: "rendirse", French: "abandonner" }
  },
  {
    pattern: /\b(?:carry|carried|carrying|carries)\s+on\b/i,
    word: "carry on",
    partOfSpeech: "phrasal verb",
    definition: "To continue an activity despite difficulties",
    translationMap: { Vietnamese: "tiếp tục duy trì", Spanish: "continuar", French: "continuer" }
  }
];

const VERB_ADJ_PREP_DICTIONARY: DictionaryItem[] = [
  {
    pattern: /\bexcited about\b/i,
    word: "excited about",
    partOfSpeech: "adj + prep",
    definition: "Feeling enthusiastic and eager about something",
    translationMap: { Vietnamese: "hào hứng, phấn khởi về", Spanish: "entusiasmado por", French: "enthousiaste à propos de" }
  },
  {
    pattern: /\binterested in\b/i,
    word: "interested in",
    partOfSpeech: "adj + prep",
    definition: "Wanting to know or learn more about something",
    translationMap: { Vietnamese: "quan tâm, hứng thú với", Spanish: "interesado en", French: "intéressé par" }
  },
  {
    pattern: /\b(?:listen|listened|listening|listens)\s+to\b/i,
    word: "listen to",
    partOfSpeech: "verb + prep",
    definition: "To pay attentive hearing to sounds, advice, or evidence",
    translationMap: { Vietnamese: "lắng nghe", Spanish: "escuchar a", French: "écouter" }
  },
  {
    pattern: /\b(?:focus|focused|focusing|focuses)\s+on\b/i,
    word: "focus on",
    partOfSpeech: "verb + prep",
    definition: "To direct intense attention or effort toward a goal",
    translationMap: { Vietnamese: "tập trung vào", Spanish: "enfocarse en", French: "se concentrer sur" }
  },
  {
    pattern: /\b(?:rely|relied|relying|relies)\s+on\b/i,
    word: "rely on",
    partOfSpeech: "verb + prep",
    definition: "To trust, depend upon, or count on evidence or someone",
    translationMap: { Vietnamese: "trông cậy vào, dựa vào", Spanish: "confiar en", French: "compter sur" }
  },
  {
    pattern: /\b(?:depend|depended|depending|depends)\s+on\b/i,
    word: "depend on",
    partOfSpeech: "verb + prep",
    definition: "To be conditioned by or contingent upon something",
    translationMap: { Vietnamese: "phụ thuộc vào", Spanish: "depender de", French: "dépendre de" }
  },
  {
    pattern: /\b(?:speak|spoke|spoken|speaking|speaks)\s+to\b/i,
    word: "speak to",
    partOfSpeech: "verb + prep",
    definition: "To communicate verbally with someone or address a subject",
    translationMap: { Vietnamese: "nói chuyện với, đề cập tới", Spanish: "hablar con", French: "parler à" }
  },
  {
    pattern: /\binform(?:ed|ing|s)?\s+(?:[a-zA-Z]+\s+)?about\b/i,
    word: "inform about",
    partOfSpeech: "verb + prep",
    definition: "To provide facts or details about a topic",
    translationMap: { Vietnamese: "thông báo, báo tin về", Spanish: "informar sobre", French: "informer de" }
  },
  {
    pattern: /\bworr(?:ied|y|ies)\s+about\b/i,
    word: "worry about",
    partOfSpeech: "verb + prep",
    definition: "To feel anxious or concerned regarding something",
    translationMap: { Vietnamese: "lo lắng về", Spanish: "preocuparse por", French: "s'inquiéter de" }
  },
  {
    pattern: /\b(?:participate|participated|participating|participates)\s+in\b/i,
    word: "participate in",
    partOfSpeech: "verb + prep",
    definition: "To take part or join in an event or experiment",
    translationMap: { Vietnamese: "tham gia vào", Spanish: "participar en", French: "participer à" }
  },
  {
    pattern: /\b(?:work|worked|working|works)\s+on\b/i,
    word: "work on",
    partOfSpeech: "verb + prep",
    definition: "To spend effort striving to develop or improve something",
    translationMap: { Vietnamese: "làm việc, nghiên cứu về", Spanish: "trabajar en", French: "travailler sur" }
  },
  {
    pattern: /\bproud of\b/i,
    word: "proud of",
    partOfSpeech: "adj + prep",
    definition: "Feeling deep satisfaction as a result of one's own or others' achievements",
    translationMap: { Vietnamese: "tự hào về", Spanish: "orgulloso de", French: "fier de" }
  },
  {
    pattern: /\bcapable of\b/i,
    word: "capable of",
    partOfSpeech: "adj + prep",
    definition: "Having the ability, capacity, or qualities required for something",
    translationMap: { Vietnamese: "có khả năng làm", Spanish: "capaz de", French: "capable de" }
  },
  {
    pattern: /\b(?:contribute|contributed|contributing|contributes)\s+to\b/i,
    word: "contribute to",
    partOfSpeech: "verb + prep",
    definition: "To help cause, bring about, or add to a discovery or outcome",
    translationMap: { Vietnamese: "đóng góp vào", Spanish: "contribuir a", French: "contribuer à" }
  }
];

const THEMATIC_NOUNS_DICTIONARY: DictionaryItem[] = [
  {
    pattern: /\bbreakthroughs?\b/i,
    word: "breakthrough",
    partOfSpeech: "noun",
    definition: "A sudden, dramatic, and important discovery or development",
    translationMap: { Vietnamese: "bước đột phá", Spanish: "avance decisivo", French: "percée" }
  },
  {
    pattern: /\bmilestones?\b/i,
    word: "milestone",
    partOfSpeech: "noun",
    definition: "An action or event marking a significant stage in development",
    translationMap: { Vietnamese: "cột mốc quan trọng", Spanish: "hito", French: "étape importante" }
  },
  {
    pattern: /\bdiscover(?:y|ies)\b/i,
    word: "discovery",
    partOfSpeech: "noun",
    definition: "The act or process of finding something previously unknown",
    translationMap: { Vietnamese: "sự phát minh, khám phá", Spanish: "descubrimiento", French: "découverte" }
  },
  {
    pattern: /\bperseverance\b/i,
    word: "perseverance",
    partOfSpeech: "noun",
    definition: "Persistence in doing something despite difficulty or delay in achieving success",
    translationMap: { Vietnamese: "sự kiên trì, bền bỉ", Spanish: "perseverancia", French: "persévérance" }
  },
  {
    pattern: /\bcuriosity\b/i,
    word: "curiosity",
    partOfSpeech: "noun",
    definition: "A strong desire to know or learn something",
    translationMap: { Vietnamese: "sự tò mò, ham hiểu biết", Spanish: "curiosidad", French: "curiosité" }
  },
  {
    pattern: /\bexperiments?\b/i,
    word: "experiment",
    partOfSpeech: "noun",
    definition: "A scientific procedure undertaken to make a discovery or test a hypothesis",
    translationMap: { Vietnamese: "cuộc thí nghiệm", Spanish: "experimento", French: "expérience" }
  },
  {
    pattern: /\blaborator(?:y|ies)\b/i,
    word: "laboratory",
    partOfSpeech: "noun",
    definition: "A room or building equipped for scientific experiments and research",
    translationMap: { Vietnamese: "phòng thí nghiệm", Spanish: "laboratorio", French: "laboratoire" }
  },
  {
    pattern: /\bevidences?\b/i,
    word: "evidence",
    partOfSpeech: "noun",
    definition: "The available body of facts or information indicating whether a belief is true",
    translationMap: { Vietnamese: "bằng chứng, chứng cứ", Spanish: "evidencia, pruebas", French: "preuve" }
  },
  {
    pattern: /\bhypothes(?:is|es)\b/i,
    word: "hypothesis",
    partOfSpeech: "noun",
    definition: "A proposed explanation made on the basis of limited evidence as a starting point",
    translationMap: { Vietnamese: "giả thuyết", Spanish: "hipótesis", French: "hypothèse" }
  },
  {
    pattern: /\banomal(?:y|ies)\b/i,
    word: "anomaly",
    partOfSpeech: "noun",
    definition: "Something that deviates from what is standard, normal, or expected",
    translationMap: { Vietnamese: "hiện tượng bất thường, dị thường", Spanish: "anomalía", French: "anomalie" }
  },
  {
    pattern: /\binnovation\b/i,
    word: "innovation",
    partOfSpeech: "noun",
    definition: "The action or process of innovating new methods, ideas, or products",
    translationMap: { Vietnamese: "sự đổi mới, sáng tạo", Spanish: "innovación", French: "innovation" }
  },
  {
    pattern: /\bachievements?\b/i,
    word: "achievement",
    partOfSpeech: "noun",
    definition: "A thing done successfully typically by effort, courage, or skill",
    translationMap: { Vietnamese: "thành tựu, thành tích", Spanish: "logro", French: "accomplissement" }
  }
];

export function extractStoryCollocations(
  paragraphs: ImmersionStoryParagraph[],
  nativeLanguage: string = "Vietnamese",
  _targetLanguage: string = "English"
): ImmersionStoryWord[] {
  const fullText = (paragraphs || []).map(p => p.targetText || "").join(" ");
  if (!fullText) return [];

  const found: ImmersionStoryWord[] = [];
  const added = new Set<string>();

  const findFirstFromDict = (dict: DictionaryItem[]) => {
    for (const item of dict) {
      if (item.pattern.test(fullText)) {
        if (!added.has(item.word.toLowerCase())) {
          added.add(item.word.toLowerCase());
          const translation = item.translationMap?.[nativeLanguage] || item.translationMap?.["Vietnamese"] || item.definition;
          found.push({
            word: item.word,
            targetInStory: item.word,
            translation,
            definition: item.definition,
            partOfSpeech: item.partOfSpeech
          });
          return true;
        }
      }
    }
    return false;
  };

  // 1. Prioritize exactly ONE phrasal verb
  findFirstFromDict(PHRASAL_VERBS_DICTIONARY);

  // 2. Prioritize exactly ONE verb or adjective followed by a preposition
  findFirstFromDict(VERB_ADJ_PREP_DICTIONARY);

  // 3. Prioritize exactly ONE key noun
  findFirstFromDict(THEMATIC_NOUNS_DICTIONARY);

  // If any slot is still missing, fill from remaining entries across all 3 dictionaries
  const allDicts = [...PHRASAL_VERBS_DICTIONARY, ...VERB_ADJ_PREP_DICTIONARY, ...THEMATIC_NOUNS_DICTIONARY];
  for (const item of allDicts) {
    if (found.length >= 3) break;
    if (item.pattern.test(fullText) && !added.has(item.word.toLowerCase())) {
      added.add(item.word.toLowerCase());
      const translation = item.translationMap?.[nativeLanguage] || item.translationMap?.["Vietnamese"] || item.definition;
      found.push({
        word: item.word,
        targetInStory: item.word,
        translation,
        definition: item.definition,
        partOfSpeech: item.partOfSpeech
      });
    }
  }

  return found;
}

export async function generateImmersionStoryService(params: {
  targetWords: Word[];
  topic?: string;
  genre?: string;
  difficulty?: "beginner" | "intermediate" | "advanced";
  targetLanguage: string;
  nativeLanguage: string;
  cfg?: LLMConfig;
}): Promise<ImmersionStory> {
  const { 
    targetWords, 
    topic, 
    genre = "Historical Non-Fiction (Real Events & Figures)", 
    difficulty = "intermediate", 
    targetLanguage, 
    nativeLanguage, 
    cfg 
  } = params;

  // Use strictly 5 candidate words for focused contextual immersion
  const candidateSlice = targetWords.slice(0, 5);
  const wordListFormatted = candidateSlice.map(w => `"${w.word}" (${w.translation || w.definition})`).join(", ");

  const topicDirective = (!topic || topic.trim() === "" || topic.toLowerCase().startsWith("auto"))
    ? `TOPIC SELECTION DIRECTIVE (AUTONOMOUS - TECH & DIGITAL CULTURE HISTORY):
- Autonomously choose an engaging, factually documented REAL tech history event, internet milestone, open-source software release, digital culture moment, or modern innovation (e.g. the 2006 launch of jQuery 1.0 by John Resig, the invention of the World Wide Web at CERN, the creation of VisiCalc spreadsheet, the invention of QWERTY, early indie game development, or Wikipedia's founding) that best and most naturally connects with the target vocabulary words.
- STRICTLY AVOID well-known traditional textbook historical figures (DO NOT use Marie Curie, Alexander Fleming, Einstein, Newton, or Wright Brothers). Focus instead on modern technology history, web development milestones, digital culture, and software innovations!
- Set the "topic" field in the output JSON to the name of this chosen tech/digital milestone.`
    : `TOPIC DIRECTIVE:
- Ground the narrative accurately in the real tech/digital culture history context of: "${topic}".`;

  const nonFictionDirectives = `
NON-FICTION ACCURACY DIRECTIVES (CRITICAL):
- This narrative MUST be strictly grounded in REAL, ACCURATELY DOCUMENTED historical events, biographical facts, scientific discoveries, or real people.
- DO NOT invent fake historical characters, fictitious events, or counter-factual timelines.
- Recount genuine biographical moments, milestones, or discoveries while naturally integrating the target vocabulary words.
`;

  const prompt = `Write a concise, engaging narrative based on real historical events or real figures (strictly 2 to 3 short paragraphs, around 80-140 words total) in ${targetLanguage} that naturally integrates the following ${candidateSlice.length} target vocabulary words:
Target Vocabulary to emphasize (exactly ${candidateSlice.length} words): [${wordListFormatted}]

Comprehensible Input & Length Constraints:
- Length: Keep the story short, concise, and easy to read (strictly 2 to 3 short paragraphs, 80-140 words total). Avoid overly long or verbose narratives.
- Difficulty Level: ${difficulty} (aim for ~90-95% comprehensible phrasing with natural syntax).
- Genre: ${genre}
${topicDirective}
- Provide an accurate paragraph-by-paragraph parallel translation in ${nativeLanguage}.
- Focus on natural repetition and rich context for the target words.

CRITICAL SUGGESTED WORDS REQUIREMENT:
During the process of generating suggested words (the "suggestedWords" array with exactly 3 items), strictly prioritize the inclusion of:
1. EXACTLY ONE Phrasal Verb (e.g., "carry out", "look into", "figure out", "bring about", "find out", "set up", "turn out", "break through") with "partOfSpeech": "phrasal verb"
2. EXACTLY ONE Verb or Adjective followed by a Preposition (e.g., "excited about", "rely on", "interested in", "focus on", "listen to", "depend on", "participate in", "worry about", "proud of") with "partOfSpeech": "verb + prep" or "adj + prep"
3. EXACTLY ONE Noun (a key thematic, scientific, or domain noun from the story, e.g., "breakthrough", "milestone", "curiosity", "laboratory", "perseverance", "evidence", "hypothesis") with "partOfSpeech": "noun"
Ensure the story text naturally incorporates all three of these items so learners see them used in context!

${nonFictionDirectives}
Return JSON in this EXACT schema:
{
  "title": "Story title in ${targetLanguage}",
  "titleTranslation": "Story title translated in ${nativeLanguage}",
  "topic": "Name of the real historical event or figure chosen",
  "genre": "${genre}",
  "difficulty": "${difficulty}",
  "targetWords": [
    {
      "word": "original base word",
      "targetInStory": "exact form used in story text",
      "translation": "translation in ${nativeLanguage}",
      "definition": "simple definition in ${targetLanguage}",
      "partOfSpeech": "noun/verb/adjective/etc",
      "pronunciation": "/phonetic/"
    }
  ],
  "suggestedWords": [
    {
      "word": "phrasal verb (e.g. 'carry out' or 'figure out')",
      "targetInStory": "exact phrase as appeared in the story text",
      "translation": "translation in ${nativeLanguage}",
      "definition": "definition of the phrasal verb",
      "partOfSpeech": "phrasal verb",
      "pronunciation": "/phonetic/"
    },
    {
      "word": "verb or adjective + preposition (e.g. 'excited about' or 'rely on')",
      "targetInStory": "exact phrase as appeared in the story text",
      "translation": "translation in ${nativeLanguage}",
      "definition": "definition of this preposition collocation",
      "partOfSpeech": "verb + prep or adj + prep",
      "pronunciation": "/phonetic/"
    },
    {
      "word": "thematic noun (e.g. 'breakthrough' or 'laboratory')",
      "targetInStory": "exact noun as appeared in the story text",
      "translation": "translation in ${nativeLanguage}",
      "definition": "definition of the noun",
      "partOfSpeech": "noun",
      "pronunciation": "/phonetic/"
    }
  ],
  "paragraphs": [
    {
      "id": "p1",
      "targetText": "Paragraph 1 in ${targetLanguage}...",
      "nativeText": "Paragraph 1 translation in ${nativeLanguage}..."
    }
  ]
}`;

  const systemInstruction = `You are an expert language pedagogue specializing in Stephen Krashen's Comprehensible Input and contextual immersion storytelling. Output ONLY valid JSON matching the requested schema. Keep stories brief, concise (2-3 short paragraphs), strictly focused on real historical events/figures and the candidate vocabulary words. When generating the 3 suggested words, strictly prioritize: 1 phrasal verb, 1 verb or adjective followed by a preposition, and 1 noun. Remain strictly factual and accurate without fabricating untrue events or characters.`;

  try {
    const rawRes = await sendLlmRequestWithMeta({
      prompt,
      systemInstruction,
      schemaDescription: "ImmersionStory JSON",
      llmConfig: cfg,
      action: "Generate Immersion Story"
    });

    const parsed = cleanAndParseJson(rawRes.text);
    const resolvedTopic = parsed.topic || topic || "Historical Discovery";
    const paragraphsList: ImmersionStoryParagraph[] = parsed.paragraphs || [
      {
        id: "p1",
        targetText: `A remarkable moment in history unfolded during ${resolvedTopic}.`,
        nativeText: `Một khoảnh khắc đáng nhớ trong lịch sử đã diễn ra trong ${resolvedTopic}.`
      }
    ];

    let extractedSuggestions = (parsed.suggestedWords && Array.isArray(parsed.suggestedWords))
      ? parsed.suggestedWords.slice(0, 3).map((sw: any) => ({
          word: sw.word || "",
          targetInStory: sw.targetInStory || sw.word || "",
          translation: sw.translation || "",
          definition: sw.definition || "",
          partOfSpeech: sw.partOfSpeech || "collocation",
          pronunciation: sw.pronunciation || undefined
        })).filter((sw: any) => Boolean(sw.word))
      : [];

    if (extractedSuggestions.length === 0) {
      extractedSuggestions = extractStoryCollocations(paragraphsList, nativeLanguage, targetLanguage);
    }

    return {
      id: `story_${Date.now()}`,
      title: parsed.title || "Historical Non-Fiction Story",
      titleTranslation: parsed.titleTranslation || "Truyện lịch sử có thật",
      topic: resolvedTopic,
      genre: parsed.genre || genre,
      difficulty: parsed.difficulty || difficulty,
      targetLanguage,
      nativeLanguage,
      targetWords: (parsed.targetWords && Array.isArray(parsed.targetWords) && parsed.targetWords.length > 0)
        ? parsed.targetWords.slice(0, 5)
        : candidateSlice.map(w => ({ word: w.word, targetInStory: w.word, translation: w.translation, definition: w.definition })),
      suggestedWords: extractedSuggestions,
      paragraphs: paragraphsList,
      provider: rawRes.provider,
      model: rawRes.model,
      responseTimeMs: rawRes.responseTimeMs,
      createdAt: new Date().toISOString()
    };
  } catch (error: any) {
    console.error("Story generation failed:", error);
    throw new Error(error?.message || "Failed to generate immersion story from LLM.");
  }
}

// Mined Sentences Local Persistence
export function getStoredMinedSentences(): MinedSentence[] {
  try {
    const raw = localStorage.getItem(MINED_SENTENCES_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveMinedSentence(mined: Omit<MinedSentence, "id" | "createdAt">): MinedSentence {
  const existing = getStoredMinedSentences();
  const newItem: MinedSentence = {
    ...mined,
    id: `mined_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    createdAt: new Date().toISOString()
  };
  localStorage.setItem(MINED_SENTENCES_STORAGE_KEY, JSON.stringify([newItem, ...existing]));
  return newItem;
}

export function deleteMinedSentence(id: string): void {
  const existing = getStoredMinedSentences();
  localStorage.setItem(MINED_SENTENCES_STORAGE_KEY, JSON.stringify(existing.filter(i => i.id !== id)));
}
