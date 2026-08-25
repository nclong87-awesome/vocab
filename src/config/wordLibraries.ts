export interface WordLibrarySet {
  id: string;
  name: string;
  url: string;
  description?: string;
  category?: "core" | "academic" | "business" | "exams" | "conversation" | "custom";
  categoryLabel?: string;
  itemCount?: number;
  level?: string;
  tags?: string[];
  author?: string;
  targetLanguage?: string;
  nativeLanguage?: string;
  nativeLanguages?: string[];
}

export interface WordLibraryIndexSource {
  targetLanguage?: string;
  nativeLanguage?: string;
  nativeLanguages?: string[];
  url: string;
  id?: string;
  name?: string;
}

export const WORD_LIBRARY_SETS: (WordLibrarySet | WordLibraryIndexSource)[] = [
  /* -------------------------------------------------------------------------- */
  /* English Target Libraries (Universal & Vietnamese-tailored)                */
  /* -------------------------------------------------------------------------- */
  {
    targetLanguage: "English",
    nativeLanguage: "Vietnamese",
    url: "https://gist.github.com/nclong87-awesome/6a5e3f4505055b969d636b461bc8bc85#file-0-libraries-json"
  }
];

// In-memory cache for resolved library sets per language pair
const librarySetsCache = new Map<string, WordLibrarySet[]>();
const pendingIndexFetches = new Map<string, Promise<WordLibrarySet[]>>();

/**
 * Normalizes language names or language codes into a canonical identifier
 */
export function normalizeLanguage(lang?: string): string {
  if (!lang) return "english";
  const s = lang.trim().toLowerCase();
  if (s.includes("vietnam") || s === "vi" || s === "tiếng việt" || s === "vi-vn") return "vietnamese";
  if (s.includes("eng") || s === "en" || s === "en-us" || s === "en-gb") return "english";
  if (s.includes("japan") || s === "ja" || s === "nihongo" || s === "日本語" || s === "ja-jp") return "japanese";
  if (s.includes("chin") || s === "zh" || s === "mandarin" || s === "中文" || s === "hán ngữ" || s === "zh-cn") return "chinese";
  if (s.includes("korean") || s === "ko" || s === "hangul" || s === "한국어" || s === "ko-kr") return "korean";
  if (s.includes("span") || s === "es" || s === "español" || s === "tây ban nha" || s === "es-es") return "spanish";
  if (s.includes("fren") || s === "fr" || s === "français" || s === "pháp" || s === "fr-fr") return "french";
  if (s.includes("germ") || s === "de" || s === "deutsch" || s === "đức" || s === "de-de") return "german";
  if (s.includes("ital") || s === "it" || s === "italiano" || s === "ý" || s === "it-it") return "italian";
  if (s.includes("port") || s === "pt" || s === "português" || s === "bồ đào nha" || s === "pt-pt" || s === "pt-br") return "portuguese";
  if (s.includes("russ") || s === "ru" || s === "русский" || s === "nga" || s === "ru-ru") return "russian";
  if (s.includes("dutch") || s === "nl" || s === "nederlands" || s === "hà lan") return "dutch";
  if (s.includes("arab") || s === "ar" || s === "العربية" || s === "ả rập") return "arabic";
  if (s.includes("hind") || s === "hi" || s === "हिन्दी" || s === "ấn độ") return "hindi";
  if (s.includes("turk") || s === "tr" || s === "türkçe" || s === "thổ nhĩ kỳ") return "turkish";
  if (s.includes("pol") || s === "pl" || s === "polski" || s === "ba lan") return "polish";
  if (s.includes("swed") || s === "sv" || s === "svenska" || s === "thụy điển") return "swedish";
  if (s.includes("greek") || s === "el" || s === "ελληνικά" || s === "hy lạp") return "greek";
  if (s.includes("thai") || s === "th" || s === "ไทย" || s === "thái") return "thai";
  if (s.includes("indo") || s === "id" || s === "bahasa indonesia") return "indonesian";
  return s;
}

/**
 * Checks if a library set's configured language(s) matches the user's active language
 */
export function isLanguageMatch(
  configuredLangs: string | string[] | undefined,
  userLang: string
): boolean {
  if (!configuredLangs) return true;
  if (!userLang) return true;

  const normUser = normalizeLanguage(userLang);

  if (Array.isArray(configuredLangs)) {
    return configuredLangs.some((l) => {
      if (l === "*" || l.toLowerCase() === "all") return true;
      const normConfig = normalizeLanguage(l);
      return normConfig === normUser;
    });
  }

  if (configuredLangs === "*" || configuredLangs.toLowerCase() === "all") return true;
  const normConfig = normalizeLanguage(configuredLangs);
  return normConfig === normUser;
}

/**
 * Dynamically fetches and resolves library sets from public Gist index URLs.
 */
export async function fetchWordLibrarySets(
  targetLanguage?: string,
  nativeLanguage?: string
): Promise<WordLibrarySet[]> {
  const normTarget = normalizeLanguage(targetLanguage);
  const normNative = normalizeLanguage(nativeLanguage);
  const cacheKey = `${normTarget}_${normNative}`;

  if (pendingIndexFetches.has(cacheKey)) {
    return pendingIndexFetches.get(cacheKey)!;
  }

  const fetchPromise = (async () => {
    const matchedSources = WORD_LIBRARY_SETS.filter((source) => {
      const targetMatch = targetLanguage
        ? isLanguageMatch(source.targetLanguage, targetLanguage)
        : true;
      const nativeMatch = nativeLanguage
        ? isLanguageMatch(source.nativeLanguages || source.nativeLanguage, nativeLanguage)
        : true;
      return targetMatch && nativeMatch;
    });

    const resolvedSets: WordLibrarySet[] = [];

    for (const source of matchedSources) {
      // If the source item is already a fully formed WordLibrarySet with an id and name
      if (source.id && source.name) {
        resolvedSets.push(source as WordLibrarySet);
        continue;
      }

      // Otherwise, fetch the library list manifest from the public Gist URL
      try {
        const rawData = await fetchWordLibrarySetData(source.url);
        let items: any[] = [];
        if (Array.isArray(rawData)) {
          items = rawData;
        } else if (rawData && typeof rawData === "object") {
          items = (rawData as any).libraries || (rawData as any).sets || (rawData as any).items || (rawData as any).words || [];
        }

        items.forEach((item: any, idx: number) => {
          if (!item) return;
          const libSet: WordLibrarySet = {
            id: item.id || `gist-lib-${idx}`,
            name: item.name || "Word Library",
            url: item.url || source.url,
            description: item.description || undefined,
            category: item.category || "core",
            categoryLabel: item.categoryLabel || undefined,
            itemCount: typeof item.itemCount === "number" ? item.itemCount : (Array.isArray(item.words) ? item.words.length : undefined),
            level: item.level || undefined,
            tags: Array.isArray(item.tags) ? item.tags : undefined,
            author: item.author || "AI Studio",
            targetLanguage: item.targetLanguage || source.targetLanguage || targetLanguage || "English",
            nativeLanguage: item.nativeLanguage || source.nativeLanguage || nativeLanguage || "Vietnamese",
            nativeLanguages: item.nativeLanguages || (source.nativeLanguages ? source.nativeLanguages : source.nativeLanguage ? [source.nativeLanguage] : undefined),
          };
          resolvedSets.push(libSet);
        });
      } catch (err) {
        console.error(`Failed to fetch word library index from ${source.url}:`, err);
      }
    }

    librarySetsCache.set(cacheKey, resolvedSets);
    return resolvedSets;
  })();

  pendingIndexFetches.set(cacheKey, fetchPromise);

  try {
    return await fetchPromise;
  } finally {
    pendingIndexFetches.delete(cacheKey);
  }
}

/**
 * Returns word library sets filtered to only those matching target and native languages (from cache or explicit sets)
 */
export function getWordLibrarySets(
  targetLanguage?: string,
  nativeLanguage?: string
): WordLibrarySet[] {
  const normTarget = normalizeLanguage(targetLanguage);
  const normNative = normalizeLanguage(nativeLanguage);
  const cacheKey = `${normTarget}_${normNative}`;

  const cached = librarySetsCache.get(cacheKey);
  if (cached && cached.length > 0) {
    return cached;
  }

  // Fallback to any explicit fully-formed WordLibrarySet entries in WORD_LIBRARY_SETS
  return WORD_LIBRARY_SETS.filter((set): set is WordLibrarySet => {
    if (!set.id || !set.name) return false;
    const targetMatch = targetLanguage ? isLanguageMatch(set.targetLanguage, targetLanguage) : true;
    const nativeMatch = nativeLanguage ? isLanguageMatch(set.nativeLanguages || set.nativeLanguage, nativeLanguage) : true;
    return targetMatch && nativeMatch;
  });
}

export function getWordLibrarySetById(id: string): WordLibrarySet | undefined {
  for (const list of librarySetsCache.values()) {
    const found = list.find(set => set.id === id);
    if (found) return found;
  }
  return WORD_LIBRARY_SETS.find(set => (set as WordLibrarySet).id === id) as WordLibrarySet | undefined;
}

/**
 * Fetches and parses word array or JSON data from a library set URL.
 * Supports GitHub Gists (web and raw URLs) as well as direct HTTP JSON endpoints.
 */
export async function fetchWordLibrarySetData(url: string): Promise<any> {
  const cleanUrl = (url || "").trim();
  if (!cleanUrl) return [];

  // Handle GitHub Gist web links (e.g. https://gist.github.com/user/gistId#file-filename-json)
  if (cleanUrl.includes("gist.github.com") && !cleanUrl.includes("gist.githubusercontent.com")) {
    const gistIdMatch = cleanUrl.match(/gist\.github\.com\/(?:[^\/]+\/)?([a-f0-9]+)/i);
    if (gistIdMatch && gistIdMatch[1]) {
      const gistId = gistIdMatch[1];
      const apiUrl = `https://api.github.com/gists/${gistId}`;
      const res = await fetch(apiUrl, {
        headers: { Accept: "application/vnd.github+json" }
      });

      if (!res.ok) {
        throw new Error(`GitHub Gist API error (HTTP ${res.status})`);
      }

      const gistData = await res.json();
      if (!gistData.files) {
        throw new Error("No files found in Gist");
      }

      let targetFileKey: string | null = null;
      if (cleanUrl.includes("#file-")) {
        const fileHash = cleanUrl.split("#file-")[1]?.toLowerCase() || "";
        const cleanHash = fileHash.replace(/[^a-z0-9]/g, "");
        for (const filename of Object.keys(gistData.files)) {
          if (filename.toLowerCase().replace(/[^a-z0-9]/g, "") === cleanHash) {
            targetFileKey = filename;
            break;
          }
        }
      }

      if (!targetFileKey) {
        const fileKeys = Object.keys(gistData.files);
        targetFileKey = fileKeys.find(k => k.endsWith(".json")) || fileKeys[0];
      }

      const fileObj = gistData.files[targetFileKey];
      if (!fileObj) {
        throw new Error("Target file not found in Gist");
      }

      let contentStr = fileObj.content;
      if (!contentStr && fileObj.raw_url) {
        const rawRes = await fetch(fileObj.raw_url);
        contentStr = await rawRes.text();
      }

      if (!contentStr) {
        throw new Error("Empty content in Gist file");
      }

      const parsed = JSON.parse(contentStr);
      return parsed;
    }
  }

  // Direct JSON fetch (GitHub Raw URL, Worker, S3, or Web URL)
  const res = await fetch(cleanUrl);
  if (!res.ok) {
    throw new Error(`Failed to download library data (HTTP ${res.status})`);
  }
  const data = await res.json();
  return data;
}
