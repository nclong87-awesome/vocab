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
  targetLanguage: string;
  nativeLanguage?: string;
  nativeLanguages?: string[];
}

export const WORD_LIBRARY_SETS: WordLibrarySet[] = [
  /* -------------------------------------------------------------------------- */
  /* English Target Libraries (Universal & Vietnamese-tailored)                */
  /* -------------------------------------------------------------------------- */
  {
    id: "ielts-band8-vi",
    name: "IELTS Band 8 Vocabulary (Song Ngữ Anh - Việt)",
    url: "https://gist.github.com/nclong87-awesome/ef16a9a0d59412d3bdd13fbc5b5b152b#file-ielts_band8_vocabulary-json",
    description: "Từ vựng Band 8 IELTS - 10 từ vựng cốt lõi...",
    category: "core",
    categoryLabel: "Core English (Anh - Việt)",
    itemCount: 10,
    level: "B2 - C1",
    tags: ["IELTS", "Song Ngữ", "Anh - Việt", "Band 8", "Advanced"],
    author: "AI Studio",
    targetLanguage: "English",
    nativeLanguages: ["Vietnamese"]
  }
];

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
 * Returns word library sets filtered to only those matching target and native languages
 */
export function getWordLibrarySets(
  targetLanguage?: string,
  nativeLanguage?: string
): WordLibrarySet[] {
  return WORD_LIBRARY_SETS.filter((set) => {
    // Check target language match
    const targetMatch = targetLanguage
      ? isLanguageMatch(set.targetLanguage, targetLanguage)
      : true;

    // Check native language match
    const nativeMatch = nativeLanguage
      ? isLanguageMatch(set.nativeLanguages || set.nativeLanguage, nativeLanguage)
      : true;

    return targetMatch && nativeMatch;
  });
}

export function getWordLibrarySetById(id: string): WordLibrarySet | undefined {
  return WORD_LIBRARY_SETS.find(set => set.id === id);
}

/**
 * Fetches and parses word array from a library set URL.
 * Supports GitHub Gists (web and raw URLs) as well as direct HTTP JSON endpoints.
 */
export async function fetchWordLibrarySetData(url: string): Promise<any[]> {
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
      return Array.isArray(parsed) ? parsed : (parsed.words || parsed.items || []);
    }
  }

  // Direct JSON fetch (GitHub Raw URL, Worker, S3, or Web URL)
  const res = await fetch(cleanUrl);
  if (!res.ok) {
    throw new Error(`Failed to download library data (HTTP ${res.status})`);
  }
  const data = await res.json();
  return Array.isArray(data) ? data : (data.words || data.items || []);
}
