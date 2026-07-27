export interface LanguageOption {
  code: string;
  name: string;
  nativeName: string;
  flag: string;
}

export const SUPPORTED_LANGUAGES: LanguageOption[] = [
  { code: "English", name: "English", nativeName: "English", flag: "🇬🇧" },
  { code: "Spanish", name: "Spanish", nativeName: "Español", flag: "🇪🇸" },
  { code: "French", name: "French", nativeName: "Français", flag: "🇫🇷" },
  { code: "German", name: "German", nativeName: "Deutsch", flag: "🇩🇪" },
  { code: "Vietnamese", name: "Vietnamese", nativeName: "Tiếng Việt", flag: "🇻🇳" },
  { code: "Japanese", name: "Japanese", nativeName: "日本語", flag: "🇯🇵" },
  { code: "Chinese", name: "Chinese", nativeName: "中文", flag: "🇨🇳" },
  { code: "Italian", name: "Italian", nativeName: "Italiano", flag: "🇮🇹" },
  { code: "Portuguese", name: "Portuguese", nativeName: "Português", flag: "🇵🇹" },
  { code: "Korean", name: "Korean", nativeName: "한국어", flag: "🇰🇷" },
  { code: "Russian", name: "Russian", nativeName: "Русский", flag: "🇷🇺" },
  { code: "Dutch", name: "Dutch", nativeName: "Nederlands", flag: "🇳🇱" },
  { code: "Arabic", name: "Arabic", nativeName: "العربية", flag: "🇸🇦" },
  { code: "Hindi", name: "Hindi", nativeName: "हिन्दी", flag: "🇮🇳" },
  { code: "Turkish", name: "Turkish", nativeName: "Türkçe", flag: "🇹🇷" },
  { code: "Polish", name: "Polish", nativeName: "Polski", flag: "🇵🇱" },
  { code: "Swedish", name: "Swedish", nativeName: "Svenska", flag: "🇸🇪" },
  { code: "Greek", name: "Greek", nativeName: "Ελληνικά", flag: "🇬🇷" },
  { code: "Thai", name: "Thai", nativeName: "ไทย", flag: "🇹🇭" },
  { code: "Indonesian", name: "Indonesian", nativeName: "Bahasa Indonesia", flag: "🇮🇩" }
];

export function getLanguageFlag(langName: string): string {
  const match = SUPPORTED_LANGUAGES.find(
    l => l.code.toLowerCase() === langName.toLowerCase() || l.name.toLowerCase() === langName.toLowerCase()
  );
  return match ? match.flag : "🌐";
}
