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
    targetLanguage: "english",
    nativeLanguage: "vietnamese",
    url: "https://gist.githubusercontent.com/nclong87-awesome/6a5e3f4505055b969d636b461bc8bc85/raw/0-libraries.json"
  },
  {
    targetLanguage: "chinese",
    nativeLanguage: "vietnamese",
    url: "https://gist.githubusercontent.com/nclong87-awesome/b6727d9676bae1041f8dff23c1d29ccf/raw/0-libraries.json"
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
      const idxSource = source as WordLibraryIndexSource;
      const targetMatch = targetLanguage
        ? isLanguageMatch(idxSource.targetLanguage, targetLanguage)
        : true;
      const nativeMatch = nativeLanguage
        ? isLanguageMatch(idxSource.nativeLanguages || idxSource.nativeLanguage, nativeLanguage)
        : true;
      return targetMatch && nativeMatch;
    });

    const resolvedSets: WordLibrarySet[] = [];
    const seenIds = new Set<string>();

    for (const source of matchedSources) {
      // If the source item is already a fully formed WordLibrarySet with an id and name
      if (source.id && source.name) {
        if (!seenIds.has(source.id)) {
          seenIds.add(source.id);
          resolvedSets.push(source as WordLibrarySet);
        }
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
          const setId = item.id || `gist-lib-${idx}`;
          if (seenIds.has(setId)) return;
          seenIds.add(setId);

          const libSet: WordLibrarySet = {
            id: setId,
            name: item.name || "Word Library",
            url: item.url || source.url,
            description: item.description || undefined,
            category: item.category || "core",
            categoryLabel: item.categoryLabel || undefined,
            itemCount: typeof item.itemCount === "number" ? item.itemCount : (Array.isArray(item.words) ? item.words.length : undefined),
            level: item.level || undefined,
            tags: Array.isArray(item.tags) ? item.tags : undefined,
            author: item.author || "AI Studio",
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
 * Returns word library sets (from cache or explicit sets)
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

  // Check all cached entries across all keys
  const allCachedSets: WordLibrarySet[] = [];
  const seenIds = new Set<string>();
  for (const list of librarySetsCache.values()) {
    for (const set of list) {
      if (!seenIds.has(set.id)) {
        seenIds.add(set.id);
        allCachedSets.push(set);
      }
    }
  }

  if (allCachedSets.length > 0) {
    return allCachedSets;
  }

  // Fallback to any explicit fully-formed WordLibrarySet entries in WORD_LIBRARY_SETS
  return WORD_LIBRARY_SETS.filter((set): set is WordLibrarySet => {
    if (!set.id || !set.name) return false;
    return true;
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
 * Fetches directly from the given URL (e.g., raw Gist URL, S3, Worker, or direct JSON file endpoint).
 */
export async function fetchWordLibrarySetData(url: string): Promise<any> {
  let cleanUrl = (url || "").trim();
  if (!cleanUrl) return [];

  // Convert Gist web links (gist.github.com/user/gistId) to direct raw endpoint if not raw
  if (cleanUrl.includes("gist.github.com") && !cleanUrl.includes("gist.githubusercontent.com") && !cleanUrl.includes("/raw")) {
    cleanUrl = cleanUrl.replace(/\/$/, "") + "/raw";
  }

  // Convert gist.github.com/.../raw to direct CDN gist.githubusercontent.com/.../raw
  if (cleanUrl.includes("gist.github.com/") && cleanUrl.includes("/raw/")) {
    cleanUrl = cleanUrl.replace("gist.github.com/", "gist.githubusercontent.com/");
  }

  const res = await fetch(cleanUrl);
  if (!res.ok) {
    throw new Error(`Failed to download library data (HTTP ${res.status})`);
  }
  const data = await res.json();
  return data;
}
