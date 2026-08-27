import React, { useState, useMemo } from "react";
import { AnimatePresence, motion } from "motion/react";
import { 
  BookOpen, 
  Search, 
  X, 
  Volume2, 
  Check, 
  Download, 
  RefreshCw, 
  Plus,
  Globe2
} from "lucide-react";
import { WordLibrarySet } from "../../config/wordLibraries";
import { Word, LLMConfig, TTSConfig } from "../../types";
import { speakText, getLanguageCode } from "../../utils/ttsService";
import { t } from "../../config/i18n";

export interface LibraryWordItem {
  word: string;
  pronunciation?: string;
  partOfSpeech?: string;
  definition?: string;
  translation?: string;
  example?: string;
  exampleTranslation?: string;
  category?: string;
  context?: string;
}

interface LibraryWordListModalProps {
  isOpen: boolean;
  onClose: () => void;
  librarySet: WordLibrarySet | null;
  wordsList: LibraryWordItem[];
  isLoading: boolean;
  error: string | null;
  isImported: boolean;
  isImportLoading: boolean;
  onImportClick: (set: WordLibrarySet) => void;
  targetLanguage: string;
  nativeLanguage: string;
  appLanguage?: string;
  wordsInCollection?: Word[];
  onAddSingleWord?: (wordItem: LibraryWordItem) => void;
  ttsConfig?: TTSConfig;
  llmConfig?: LLMConfig;
}

export const LibraryWordListModal: React.FC<LibraryWordListModalProps> = ({
  isOpen,
  onClose,
  librarySet,
  wordsList,
  isLoading,
  error,
  isImported,
  isImportLoading,
  onImportClick,
  targetLanguage,
  nativeLanguage,
  appLanguage = "en",
  wordsInCollection = [],
  onAddSingleWord,
  ttsConfig,
  llmConfig,
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [addedSingleWords, setAddedSingleWords] = useState<Set<string>>(new Set());

  // Handle ESC key press
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Reset search when modal opens/changes set
  React.useEffect(() => {
    if (isOpen) {
      setSearchQuery("");
    }
  }, [isOpen, librarySet?.id]);

  const filteredWords = useMemo(() => {
    if (!searchQuery.trim()) return wordsList;
    const q = searchQuery.toLowerCase().trim();
    return wordsList.filter((item) => {
      return (
        item.word.toLowerCase().includes(q) ||
        (item.translation || "").toLowerCase().includes(q) ||
        (item.definition || "").toLowerCase().includes(q) ||
        (item.pronunciation || "").toLowerCase().includes(q) ||
        (item.example || "").toLowerCase().includes(q)
      );
    });
  }, [wordsList, searchQuery]);

  const handleSpeak = (wordText: string) => {
    if (!wordText) return;
    speakText(wordText, ttsConfig, llmConfig, getLanguageCode(targetLanguage));
  };

  const handleAddWord = (item: LibraryWordItem) => {
    if (onAddSingleWord) {
      onAddSingleWord(item);
      setAddedSingleWords((prev) => new Set(prev).add(item.word.toLowerCase()));
    }
  };

  if (!isOpen || !librarySet) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-stone-950/60 backdrop-blur-xs">
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 10 }}
          transition={{ duration: 0.18 }}
          className="bg-white rounded-2xl border border-stone-200 shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden text-stone-900"
          id="library-word-list-modal"
        >
          {/* Modal Header */}
          <div className="p-4 sm:p-5 border-b border-stone-200 bg-stone-50/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-sky-100 border border-sky-200 text-sky-700 flex items-center justify-center shrink-0 shadow-3xs">
                <BookOpen className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-base sm:text-lg font-extrabold text-stone-950 truncate">
                    {librarySet.name}
                  </h3>
                  {librarySet.level && (
                    <span className="text-[10.5px] font-bold px-2 py-0.5 rounded-md bg-stone-200/80 text-stone-800 border border-stone-300/80">
                      {librarySet.level}
                    </span>
                  )}
                  {librarySet.categoryLabel && (
                    <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-md bg-sky-100 text-sky-850 border border-sky-200">
                      {librarySet.categoryLabel}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs text-stone-500 mt-1 flex-wrap">
                  <span className="inline-flex items-center gap-1 font-medium text-stone-700">
                    <Globe2 className="w-3.5 h-3.5 text-stone-400" />
                    {targetLanguage} ↔ {nativeLanguage}
                  </span>
                  <span>•</span>
                  <span className="font-mono font-bold text-stone-700">
                    {wordsList.length > 0 ? wordsList.length : (librarySet.itemCount || "150")} {t("word_count", appLanguage)}
                  </span>
                  {librarySet.author && (
                    <>
                      <span>•</span>
                      <span className="italic">By {librarySet.author}</span>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Header Right Action & Close */}
            <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
              {isImported ? (
                <div className="inline-flex items-center gap-1 px-3 py-1.5 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-lg text-xs font-bold">
                  <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                  <span>{t("library_btn_imported", appLanguage)}</span>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => onImportClick(librarySet)}
                  disabled={isImportLoading}
                  className="inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 bg-stone-900 hover:bg-stone-800 active:bg-stone-950 text-white text-xs font-bold rounded-lg shadow-2xs hover:scale-102 transition-all cursor-pointer"
                >
                  {isImportLoading ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Download className="w-3.5 h-3.5" />
                  )}
                  <span>{t("library_btn_import", appLanguage)} Package</span>
                </button>
              )}

              <button
                type="button"
                onClick={onClose}
                className="w-8 h-8 rounded-lg bg-stone-200/80 hover:bg-stone-300 text-stone-700 flex items-center justify-center transition-colors cursor-pointer"
                title="Close modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Description & Search Bar */}
          <div className="p-3.5 sm:p-4 border-b border-stone-200 bg-white space-y-3">
            {librarySet.description && (
              <p className="text-xs sm:text-sm text-stone-600 leading-relaxed">
                {librarySet.description}
              </p>
            )}

            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t("library_modal_search_words", appLanguage) || "Search words in package by spelling, translation, or definition..."}
                  className="w-full pl-9 pr-8 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs sm:text-sm text-stone-900 placeholder:text-stone-400 focus:outline-hidden focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 focus:bg-white transition-all font-medium"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 p-0.5 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <div className="text-xs text-stone-500 font-medium px-2 whitespace-nowrap hidden sm:block">
                Showing <span className="font-bold text-stone-900">{filteredWords.length}</span> / {wordsList.length}
              </div>
            </div>
          </div>

          {/* Words List Container */}
          <div className="flex-1 overflow-y-auto p-3 sm:p-5 space-y-3 bg-stone-50/50 min-h-[250px] max-h-[550px]">
            {isLoading ? (
              <div className="py-16 text-center space-y-3">
                <RefreshCw className="w-7 h-7 mx-auto animate-spin text-sky-600" />
                <p className="text-xs sm:text-sm font-semibold text-stone-700">
                  Loading vocabulary words for "{librarySet.name}"...
                </p>
                <p className="text-xs text-stone-400">Fetching definitions, pronunciations, and examples</p>
              </div>
            ) : error ? (
              <div className="py-12 px-4 text-center bg-rose-50 border border-rose-200 rounded-xl space-y-2 text-rose-800">
                <p className="text-xs font-bold">Failed to load word list</p>
                <p className="text-xs">{error}</p>
              </div>
            ) : filteredWords.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {filteredWords.map((item, idx) => {
                  const lowerWord = item.word.toLowerCase();
                  const isSavedInCollection = wordsInCollection.some(
                    (w) => w.word.toLowerCase() === lowerWord
                  ) || addedSingleWords.has(lowerWord);

                  return (
                    <div
                      key={idx}
                      className="bg-white p-3.5 rounded-xl border border-stone-200/90 shadow-2xs hover:border-stone-300 transition-all flex flex-col justify-between gap-2.5"
                    >
                      <div className="space-y-1.5">
                        {/* Word Title Row */}
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-base font-bold text-stone-950 font-serif">
                                {item.word}
                              </span>
                              {item.partOfSpeech && (
                                <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.2 rounded bg-stone-100 text-stone-600 border border-stone-200/80 font-mono">
                                  {item.partOfSpeech}
                                </span>
                              )}
                              {item.pronunciation && (
                                <span className="text-xs text-stone-500 font-mono">
                                  /{item.pronunciation.replace(/^\/|\/$/g, "")}/
                                </span>
                              )}
                            </div>

                            {/* Native Translation */}
                            {item.translation && (
                              <p className="text-xs font-bold text-amber-900 mt-1">
                                "{item.translation}"
                              </p>
                            )}
                          </div>

                          {/* Audio TTS Button */}
                          <button
                            type="button"
                            onClick={() => handleSpeak(item.word)}
                            className="p-1.5 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-lg border border-stone-200 transition-transform hover:scale-105 active:scale-95 cursor-pointer shrink-0"
                            title={`Listen to pronunciation of "${item.word}"`}
                          >
                            <Volume2 className="w-4 h-4" />
                          </button>
                        </div>

                        {/* Definition */}
                        {item.definition && (
                          <p className="text-xs text-stone-600 leading-relaxed pt-0.5">
                            {item.definition}
                          </p>
                        )}

                        {/* Example sentence & translation */}
                        {item.example && (
                          <div className="mt-1.5 p-2 bg-stone-50 rounded-lg border border-stone-200/60 text-[11.5px] space-y-0.5">
                            <p className="text-stone-800 italic font-serif">
                              "{item.example}"
                            </p>
                            {item.exampleTranslation && (
                              <p className="text-stone-500 text-[11px]">
                                {item.exampleTranslation}
                              </p>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Card Footer Status */}
                      <div className="pt-2 border-t border-stone-100 flex items-center justify-between gap-2 text-[11px]">
                        {item.category && (
                          <span className="text-stone-400 font-mono text-[10px]">
                            {item.category}
                          </span>
                        )}

                        <div className="ml-auto">
                          {isSavedInCollection ? (
                            <span className="inline-flex items-center gap-1 font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md text-[10.5px]">
                              <Check className="w-3 h-3 stroke-[2.5]" />
                              <span>{t("library_imported_badge", appLanguage)}</span>
                            </span>
                          ) : onAddSingleWord ? (
                            <button
                              type="button"
                              onClick={() => handleAddWord(item)}
                              className="inline-flex items-center gap-1 font-bold text-stone-900 bg-stone-100 hover:bg-stone-200 active:bg-stone-300 border border-stone-200 px-2.5 py-1 rounded-md text-[11px] transition-all cursor-pointer shadow-3xs hover:scale-102"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              <span>{t("add_word_btn", appLanguage)}</span>
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="py-12 text-center text-stone-500 space-y-2">
                <BookOpen className="w-8 h-8 mx-auto text-stone-300" />
                <p className="text-xs font-semibold">No words match "{searchQuery}"</p>
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="text-xs font-bold text-sky-600 hover:underline cursor-pointer"
                >
                  Clear search filter
                </button>
              </div>
            )}
          </div>

          {/* Modal Footer */}
          <div className="p-3.5 sm:p-4 border-t border-stone-200 bg-stone-50/80 flex items-center justify-between text-xs text-stone-500">
            <span>
              Showing <span className="font-bold text-stone-900">{filteredWords.length}</span> of {wordsList.length} words
            </span>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 bg-white hover:bg-stone-100 border border-stone-200 rounded-xl font-bold text-stone-700 transition-colors cursor-pointer"
              >
                Close
              </button>
              {!isImported && (
                <button
                  type="button"
                  onClick={() => onImportClick(librarySet)}
                  disabled={isImportLoading}
                  className="px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-xl font-bold shadow-2xs transition-all cursor-pointer flex items-center gap-1.5"
                >
                  {isImportLoading ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Download className="w-3.5 h-3.5" />
                  )}
                  <span>Import Package ({wordsList.length || librarySet.itemCount || 150} words)</span>
                </button>
              )}
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

export default LibraryWordListModal;
