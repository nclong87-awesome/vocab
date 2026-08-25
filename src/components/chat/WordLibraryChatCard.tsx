import React, { useState, useEffect, useMemo } from "react";
import { 
  BookOpen, 
  Check, 
  Download, 
  RefreshCw,
  Search,
  Sparkles,
  X
} from "lucide-react";
import { getWordLibrarySets, fetchWordLibrarySetData, WordLibrarySet } from "../../config/wordLibraries";
import { getImportedLibraryIdsFromDB, saveImportedLibraryIdToDB } from "../../db/indexedDB";
import { t } from "../../config/i18n";
import { getLanguageFlag } from "../../config/languages";

interface WordLibraryChatCardProps {
  targetLanguage?: string;
  nativeLanguage?: string;
  appLanguage?: string;
  showToast?: (msg: string) => void;
  onAddMultipleWords?: (words: any[]) => void;
  onGenerateByTopic?: () => void;
}

export const WordLibraryChatCard: React.FC<WordLibraryChatCardProps> = ({
  targetLanguage,
  nativeLanguage,
  appLanguage = "en",
  showToast,
  onAddMultipleWords,
  onGenerateByTopic,
}) => {
  const [importedIds, setImportedIds] = useState<string[]>([]);
  const [isActionLoading, setIsActionLoading] = useState<Record<string, boolean>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");

  const effectiveTarget = targetLanguage || localStorage.getItem("vocab_learner_target_lang") || "English";
  const effectiveNative = nativeLanguage || localStorage.getItem("vocab_learner_native_lang") || "Vietnamese";

  const loadImportedIds = async () => {
    try {
      const ids = await getImportedLibraryIdsFromDB();
      setImportedIds(ids);
    } catch (err) {
      console.error("Failed to load imported library IDs in Chat Card:", err);
    }
  };

  useEffect(() => {
    void loadImportedIds();
  }, []);

  useEffect(() => {
    const handleUpdate = () => {
      void loadImportedIds();
    };
    window.addEventListener("vocab-library-imported", handleUpdate);
    window.addEventListener("vocab-db-updated", handleUpdate);
    return () => {
      window.removeEventListener("vocab-library-imported", handleUpdate);
      window.removeEventListener("vocab-db-updated", handleUpdate);
    };
  }, []);

  const handleImportClick = async (set: WordLibrarySet) => {
    if (importedIds.includes(set.id)) return;

    setIsActionLoading((prev) => ({ ...prev, [set.id]: true }));
    try {
      // 1. Fetch library items from URL
      let rawItems: any[] = [];
      try {
        rawItems = await fetchWordLibrarySetData(set.url);
      } catch (fetchErr) {
        console.error("Failed to fetch library set data from URL:", fetchErr);
        showToast?.(`Failed to download vocabulary set "${set.name}". Please check network connection.`);
        setIsActionLoading((prev) => ({ ...prev, [set.id]: false }));
        return;
      }

      if (!rawItems || rawItems.length === 0) {
        showToast?.(`No words found in "${set.name}".`);
        setIsActionLoading((prev) => ({ ...prev, [set.id]: false }));
        return;
      }

      // 2. Format items for vocabulary collection
      const parsedWords = rawItems
        .map((item: any) => {
          const wordText = (item.word || "").trim();
          if (!wordText) return null;
          return {
            word: wordText,
            pronunciation: item.pronunciation || undefined,
            partOfSpeech: item.partOfSpeech || "noun",
            definition: item.definition || item.meaning || "",
            translation: item.translation || item.meaning || item.definition || wordText,
            example: item.example || undefined,
            exampleTranslation: item.exampleTranslation || item.example_translation || undefined,
            category: item.category || set.categoryLabel || set.name || "Library",
            context: item.context || item.description || undefined,
          };
        })
        .filter(Boolean);

      if (parsedWords.length > 0 && onAddMultipleWords) {
        await onAddMultipleWords(parsedWords);
      }

      // 3. Mark library ID as imported in DB
      const updated = await saveImportedLibraryIdToDB(set.id);
      setImportedIds(updated);

      const msg = t("library_toast_imported", appLanguage, { name: set.name });
      showToast?.(msg || `Successfully imported ${parsedWords.length} words from "${set.name}"!`);
    } catch (err) {
      console.error("Error importing library set:", err);
      showToast?.("Failed to import word library.");
    } finally {
      setIsActionLoading((prev) => ({ ...prev, [set.id]: false }));
    }
  };

  // Only get word library sets that match the user's target language and native language
  const languageMatchedSets = useMemo(() => {
    return getWordLibrarySets(effectiveTarget, effectiveNative);
  }, [effectiveTarget, effectiveNative]);

  // Extract available categories within the language-matched libraries
  const categories = useMemo(() => {
    const cats = new Set<string>();
    languageMatchedSets.forEach((s) => {
      if (s.category) cats.add(s.category);
    });
    return Array.from(cats);
  }, [languageMatchedSets]);

  // Filter by category and search query
  const filteredSets = useMemo(() => {
    return languageMatchedSets.filter((s) => {
      if (selectedCategory !== "all" && s.category !== selectedCategory) {
        return false;
      }
      const q = searchQuery.trim().toLowerCase();
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q) ||
        (s.description || "").toLowerCase().includes(q) ||
        (s.tags || []).some((t) => t.toLowerCase().includes(q)) ||
        (s.level || "").toLowerCase().includes(q) ||
        (s.author || "").toLowerCase().includes(q)
      );
    });
  }, [languageMatchedSets, selectedCategory, searchQuery]);

  const totalCount = languageMatchedSets.length;
  const importedCount = languageMatchedSets.filter((s) => importedIds.includes(s.id)).length;

  const targetFlag = getLanguageFlag(effectiveTarget);
  const nativeFlag = getLanguageFlag(effectiveNative);

  return (
    <div 
      id="chat-word-libraries-card"
      className="mt-3.5 space-y-3 rounded-2xl bg-stone-50/90 border border-stone-200/90 p-3.5 sm:p-4 text-stone-900 shadow-2xs"
    >
      {/* Header Info */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-2.5 border-b border-stone-200/80">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-sky-100 border border-sky-200 text-sky-700 flex items-center justify-center shrink-0 shadow-3xs">
            <BookOpen className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-bold text-stone-950">
                {t("library_modal_title", appLanguage)}
              </span>
              {/* Language Pair Filter Badge */}
              <div 
                className="inline-flex items-center gap-1 text-[10.5px] font-semibold px-2 py-0.5 rounded-md bg-stone-200/80 text-stone-800 border border-stone-300/80 select-none shadow-3xs"
                title={`Filtered for Target: ${effectiveTarget}, Native: ${effectiveNative}`}
              >
                <span>{targetFlag} {effectiveTarget}</span>
                <span className="text-stone-400 font-bold">←</span>
                <span>{nativeFlag} {effectiveNative}</span>
              </div>
            </div>
            <p className="text-[11px] text-stone-500 mt-0.5">
              {t("library_modal_desc", appLanguage)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
          <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-sky-50 text-sky-800 border border-sky-200/70 shadow-3xs">
            {importedCount}/{totalCount} {t("library_btn_imported", appLanguage)}
          </span>
        </div>
      </div>

      {/* Category Pills (if more than 1 category exists) */}
      {categories.length > 1 && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar text-xs">
          <button
            type="button"
            onClick={() => setSelectedCategory("all")}
            className={`px-2.5 py-1 rounded-lg font-semibold text-[11px] transition-all cursor-pointer whitespace-nowrap shadow-3xs ${
              selectedCategory === "all"
                ? "bg-stone-900 text-white"
                : "bg-white text-stone-600 hover:text-stone-900 border border-stone-200/80 hover:bg-stone-100"
            }`}
          >
            {t("library_filter_all", appLanguage)} ({totalCount})
          </button>
          {categories.map((cat) => {
            const count = languageMatchedSets.filter((s) => s.category === cat).length;
            const filterKey = `library_filter_${cat}` as any;
            const label = t(filterKey, appLanguage) || cat;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                className={`px-2.5 py-1 rounded-lg font-semibold text-[11px] transition-all cursor-pointer whitespace-nowrap shadow-3xs ${
                  selectedCategory === cat
                    ? "bg-stone-900 text-white"
                    : "bg-white text-stone-600 hover:text-stone-900 border border-stone-200/80 hover:bg-stone-100"
                }`}
              >
                {label} ({count})
              </button>
            );
          })}
        </div>
      )}

      {/* Filter / Search input */}
      <div className="relative">
        <Search className="w-3.5 h-3.5 text-stone-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t("library_search_placeholder", appLanguage)}
          className="w-full pl-8 pr-7 py-1.5 bg-white border border-stone-200 rounded-lg text-xs text-stone-800 placeholder-stone-400 focus:outline-hidden focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 transition-all"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 p-0.5 cursor-pointer"
            title="Clear search"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* List of Word Sets */}
      {filteredSets.length > 0 ? (
        <div className="space-y-2.5 max-h-[420px] overflow-y-auto pr-1">
          {filteredSets.map((libSet) => {
            const isImported = importedIds.includes(libSet.id);
            const isLoading = Boolean(isActionLoading[libSet.id]);

            return (
              <div
                key={libSet.id}
                id={`chat-lib-card-${libSet.id}`}
                className={`p-3 sm:p-3.5 rounded-xl border transition-all text-xs ${
                  isImported
                    ? "bg-white/85 border-stone-200/80 opacity-90 shadow-3xs"
                    : "bg-white border-stone-200 hover:border-stone-300 shadow-2xs"
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2.5">
                  {/* Left details */}
                  <div className="space-y-1.5 flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-bold text-stone-900 text-xs sm:text-sm">
                        {libSet.name}
                      </span>
                      {libSet.level && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.2 rounded bg-stone-100 text-stone-700 border border-stone-200/80">
                          {libSet.level}
                        </span>
                      )}
                      {libSet.categoryLabel && (
                        <span className="text-[10px] font-medium px-1.5 py-0.2 rounded bg-sky-50 text-sky-800 border border-sky-200/50">
                          {libSet.categoryLabel}
                        </span>
                      )}
                      {libSet.itemCount && (
                        <span className="text-[10.5px] text-stone-500 font-mono">
                          • {libSet.itemCount.toLocaleString()} words
                        </span>
                      )}
                      {isImported && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.2 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                          <Check className="w-2.5 h-2.5 stroke-[2.5]" />
                          {t("library_imported_badge", appLanguage)}
                        </span>
                      )}
                    </div>

                    {libSet.description && (
                      <p className="text-stone-600 text-[11.5px] leading-relaxed">
                        {libSet.description}
                      </p>
                    )}

                    {/* Tags & Author */}
                    <div className="flex items-center gap-2 flex-wrap pt-0.5">
                      {libSet.author && (
                        <span className="text-[10px] text-stone-400 italic">
                          By {libSet.author}
                        </span>
                      )}
                      {libSet.tags && libSet.tags.length > 0 && (
                        <div className="flex items-center gap-1 flex-wrap">
                          {libSet.tags.map((tag) => (
                            <span 
                              key={tag}
                              className="text-[9.5px] px-1.5 py-0.2 rounded-md bg-stone-100/80 text-stone-600 border border-stone-200/60"
                            >
                              #{tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right button */}
                  <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-start gap-1.5 shrink-0 pt-1.5 sm:pt-0">
                    {isImported ? (
                      <button
                        type="button"
                        id={`chat-lib-imported-btn-${libSet.id}`}
                        disabled
                        className="inline-flex items-center justify-center gap-1 px-3 py-1.5 bg-stone-100 text-stone-400 border border-stone-200/80 text-xs font-semibold rounded-lg cursor-not-allowed select-none"
                        title="This word library has already been imported into your database."
                      >
                        <Check className="w-3.5 h-3.5 text-emerald-600 stroke-[2.5]" />
                        <span>{t("library_btn_imported", appLanguage)}</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        id={`chat-lib-import-btn-${libSet.id}`}
                        onClick={() => void handleImportClick(libSet)}
                        disabled={isLoading}
                        className="inline-flex items-center justify-center gap-1 px-3 py-1.5 bg-stone-900 hover:bg-stone-800 active:bg-stone-950 text-white text-xs font-bold rounded-lg shadow-2xs hover:scale-102 active:scale-98 transition-all cursor-pointer"
                        title={`Import "${libSet.name}"`}
                      >
                        {isLoading ? (
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Download className="w-3.5 h-3.5" />
                        )}
                        <span>{t("library_btn_import", appLanguage)}</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Empty State */
        <div className="py-6 px-4 text-center rounded-xl bg-white border border-stone-200/80 space-y-2.5 shadow-3xs">
          <div className="w-10 h-10 mx-auto rounded-xl bg-stone-100 text-stone-500 flex items-center justify-center text-lg shadow-3xs">
            📚
          </div>
          <div>
            <h4 className="text-xs font-bold text-stone-900">
              {searchQuery ? "No matching libraries found" : `No libraries found for ${effectiveTarget}`}
            </h4>
            <p className="text-[11px] text-stone-500 mt-1 max-w-sm mx-auto">
              {searchQuery
                ? `No word packages match "${searchQuery}" for ${effectiveTarget} (Native: ${effectiveNative}).`
                : `Currently displaying libraries matched to Target: ${effectiveTarget} and Native: ${effectiveNative}.`}
            </p>
          </div>

          <div className="flex items-center justify-center gap-2 pt-1">
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="px-3 py-1.5 text-xs font-semibold text-stone-700 bg-stone-100 hover:bg-stone-200 rounded-lg transition-colors cursor-pointer"
              >
                Clear search
              </button>
            )}
            {onGenerateByTopic && (
              <button
                type="button"
                onClick={onGenerateByTopic}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-stone-900 hover:bg-stone-800 rounded-lg shadow-2xs transition-transform hover:scale-102 cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                <span>Generate Words for {effectiveTarget}</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
