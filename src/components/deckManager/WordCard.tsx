import React, { useState, useEffect, useMemo } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Volume2, RefreshCw, CheckCircle, Trash2, History, Languages, Image as ImageIcon, Plus, X, ExternalLink, Sparkles, Loader2 } from "lucide-react";
import { Word, LLMConfig } from "../../types";
import { fetchWorkerImageUrl } from "../../utils/quizGenerator";
import { generateImageSearchQueryService } from "../../services/llmClientService";
import StrengthHistoryModal from "../analytics/StrengthHistoryModal";
import MemoryStrengthBar from "../common/MemoryStrengthBar";

interface WordCardProps {
  key?: React.Key;
  word: Word;
  speakWord: (text: string) => void;
  handleRegenerateWord: (word: Word) => void;
  regeneratingWordId: string | null;
  regeneratedSuccessWordId: string | null;
  onToggleStar: (wordId: string) => void;
  onToggleLearned: (wordId: string) => void;
  onDeleteWord: (wordId: string) => void;
  brokenImageIds: Set<string>;
  handleImageError: (wordId: string) => void;
  onUpdateWord?: (updatedWord: Word) => void;
  llmConfig?: LLMConfig;
}

function WordCard({
  word: initialWord,
  speakWord,
  handleRegenerateWord,
  regeneratingWordId,
  regeneratedSuccessWordId,
  onToggleStar: _onToggleStar,
  onToggleLearned: _onToggleLearned,
  onDeleteWord,
  brokenImageIds: _brokenImageIds,
  handleImageError: _handleImageError,
  onUpdateWord,
  llmConfig
}: WordCardProps) {
  const [localWord, setLocalWord] = useState<Word | null>(null);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [showTranslation, setShowTranslation] = useState(false);
  const [newImageUrlInput, setNewImageUrlInput] = useState("");
  const [showAddImageInput, setShowAddImageInput] = useState(false);
  const [selectedPreviewImage, setSelectedPreviewImage] = useState<string | null>(null);
  const [generatingSlotIndex, setGeneratingSlotIndex] = useState<number | null>(null);

  useEffect(() => {
    setLocalWord(initialWord);
  }, [initialWord]);

  const word = localWord || initialWord;

  const allImageUrls = useMemo<string[]>(() => {
    const list = [...(word.imageUrls || []), ...(word.imageUrl ? [word.imageUrl] : [])];
    return Array.from(new Set(list.map((u) => String(u || "").trim()).filter(Boolean)));
  }, [word.imageUrls, word.imageUrl]);

  const handleModalWordUpdate = (updated: Word) => {
    setLocalWord(updated);
    if (onUpdateWord) {
      onUpdateWord(updated);
    }
  };

  const handleAddImageUrl = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = newImageUrlInput.trim();
    if (!trimmed) return;
    const updatedList: string[] = Array.from(new Set([...allImageUrls, trimmed]));
    const updatedWord: Word = {
      ...word,
      imageUrls: updatedList,
      imageUrl: updatedList[0] || undefined
    };
    handleModalWordUpdate(updatedWord);
    setNewImageUrlInput("");
    setShowAddImageInput(false);
  };

  const handleRemoveImageUrl = (urlToRemove: string) => {
    const updatedList: string[] = allImageUrls.filter((u) => u !== urlToRemove);
    const updatedWord: Word = {
      ...word,
      imageUrls: updatedList,
      imageUrl: updatedList[0] || undefined,
    };
    handleModalWordUpdate(updatedWord);
  };

  const handleGenerateSlotQuery = async (slotIndex: number) => {
    setGeneratingSlotIndex(slotIndex);
    try {
      // 1. Generate query parameter using LLM
      const queryTerm = await generateImageSearchQueryService({
        word: word.word,
        definition: word.definition,
        context: word.context,
        partOfSpeech: word.partOfSpeech,
        placeholderIndex: slotIndex + 1,
        cfg: llmConfig,
      });

      // 2. Fetch resulting URL from image.nclong87.workers.dev
      const fetchedUrl = await fetchWorkerImageUrl(queryTerm, slotIndex + 1);
      const resultingUrl = fetchedUrl || `https://image.nclong87.workers.dev?query=${encodeURIComponent(queryTerm)}`;

      // 3. Save resulting URL to that placeholder slot
      const currentList = [...allImageUrls];
      while (currentList.length <= slotIndex) {
        currentList.push("");
      }
      currentList[slotIndex] = resultingUrl;
      const nextList = currentList.filter(Boolean);

      const updatedWord: Word = {
        ...word,
        imageUrls: nextList,
        imageUrl: nextList[0] || undefined,
      };

      handleModalWordUpdate(updatedWord);
    } catch (err) {
      console.error(`Failed to generate query for placeholder #${slotIndex + 1}:`, err);
    } finally {
      setGeneratingSlotIndex(null);
    }
  };

  const handleResolveImageUrl = (oldUrl: string, resolvedUrl: string) => {
    if (!oldUrl || !resolvedUrl || oldUrl === resolvedUrl) return;
    const currentList = allImageUrls.length > 0 ? allImageUrls : [oldUrl];
    const nextList = currentList.map((u) => (u === oldUrl ? resolvedUrl : u));
    if (JSON.stringify(nextList) === JSON.stringify(currentList)) return;
    const updatedWord: Word = {
      ...word,
      imageUrls: nextList,
      imageUrl: nextList[0] || resolvedUrl,
    };
    handleModalWordUpdate(updatedWord);
  };

  return (
    <>
      <div 
        className={`p-5 transition-all duration-300 flex flex-col justify-between space-y-4 rounded-xl border ${
          word.learned
            ? "border-emerald-200/80 bg-emerald-50/10 shadow-[0_1px_3px_rgba(16,185,129,0.02)]"
            : "border-stone-200/80 bg-white shadow-2xs"
        } hover:-translate-y-0.5 hover:border-stone-350 hover:shadow-xs group relative`}
      >
        {/* Card Header & Controls */}
        <div className="space-y-2.5 border-b border-stone-100 pb-3">
          {/* Top Row: Word Title & Action Bar */}
          <div className="flex items-start justify-between gap-2.5">
            <div className="flex items-center gap-2 min-w-0 flex-1 flex-wrap">
              <h4 className="text-lg font-bold text-stone-900 tracking-tight leading-snug break-words max-w-full">{word.word}</h4>
            </div>

            {/* Action Buttons Bar */}
            <div className="flex items-center gap-0.5 bg-stone-50/80 p-0.5 border border-stone-200/80 rounded-lg shrink-0 shadow-2xs">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  speakWord(word.word);
                }}
                className="p-1.5 rounded-md text-stone-500 hover:text-stone-950 hover:bg-stone-100 transition-all cursor-pointer"
                title="Listen Pronunciation"
              >
                <Volume2 className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowHistoryModal(true);
                }}
                className="p-1.5 rounded-md text-amber-700 hover:text-amber-950 hover:bg-amber-100/80 transition-all cursor-pointer"
                title="View Strength History"
              >
                <History className="w-3.5 h-3.5 text-amber-600" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleRegenerateWord(word);
                }}
                disabled={regeneratingWordId === word.id}
                className="p-1.5 rounded-md text-stone-400 hover:text-amber-600 hover:bg-white transition-all cursor-pointer disabled:opacity-50"
                title="Re-generate details with AI"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${regeneratingWordId === word.id ? "animate-spin text-amber-600" : ""}`} />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteWord(word.id);
                }}
                className="p-1.5 rounded-md text-stone-400 hover:text-red-600 hover:bg-white transition-all cursor-pointer"
                title="Delete Entry"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Meta Tags Row: Pronunciation, Part of Speech, Category */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {word.pronunciation && (
              <span className="text-[10px] font-mono text-stone-600 bg-stone-100/80 border border-stone-200/80 px-2 py-0.5 rounded">
                {word.pronunciation}
              </span>
            )}
            <span className="text-[10px] font-bold uppercase font-mono bg-stone-900 text-white px-2 py-0.5 rounded tracking-wider">
              {word.partOfSpeech || "noun"}
            </span>
            {word.category && (
              <span className="text-[10px] font-medium bg-amber-50 text-amber-900 border border-amber-200/70 px-2 py-0.5 rounded flex items-center gap-1">
                <span>🏷️</span>
                <span>{word.category}</span>
              </span>
            )}
          </div>
        </div>

        {/* Card Body Content */}
        <div className="space-y-3 flex-1">
          {/* Success message badge after regeneration */}
          {regeneratedSuccessWordId === word.id && (
            <div className="p-2 bg-emerald-50 border border-emerald-200 text-emerald-800 text-[10px] font-bold flex items-center gap-1.5 rounded-lg">
              <CheckCircle className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <span>AI details updated successfully!</span>
            </div>
          )}

          {/* Meaning Highlight Block */}
          <div className="bg-amber-50/30 border border-amber-200/60 p-3 rounded-lg space-y-1">
            <span className="text-[9px] font-bold uppercase text-amber-800 tracking-wider block">Meaning</span>
            <p className="text-sm font-bold text-stone-850 leading-tight">{word.translation}</p>
          </div>

          {/* Domain / Context Description */}
          {word.context && (
            <div className="text-[11px] text-stone-700 bg-stone-50 border border-stone-200/80 p-3 rounded-lg space-y-1">
              <span className="font-mono font-bold uppercase text-[9px] text-stone-400 tracking-wider block">Usage Context</span>
              <p className="text-[11px] leading-relaxed text-stone-700 font-sans">{word.context}</p>
            </div>
          )}

          {/* Definition Text */}
          {word.definition && (
            <div className="space-y-1 pt-1">
              <span className="text-[9px] font-mono font-bold uppercase text-stone-400 tracking-wider block">Definition</span>
              <p className="text-xs text-stone-750 font-serif italic leading-relaxed">
                "{word.definition}"
              </p>
            </div>
          )}

          {word.example && (
            <div className="bg-stone-50 border border-stone-150 p-3 rounded-lg space-y-1.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[9px] font-mono font-bold uppercase tracking-wider text-stone-400 block">Context Example</span>
                <div className="flex items-center gap-1.5 shrink-0">
                  {word.exampleTranslation && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowTranslation(prev => !prev);
                      }}
                      className={`p-1 rounded border transition-colors flex items-center justify-center cursor-pointer ${
                        showTranslation
                          ? "bg-amber-100 text-amber-900 border-amber-300"
                          : "bg-white hover:bg-stone-100 text-stone-500 hover:text-stone-800 border-stone-200"
                      }`}
                      title={showTranslation ? "Hide translation" : "Show translation"}
                    >
                      <Languages className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      speakWord(word.example!);
                    }}
                    className="p-1 rounded border border-stone-200 bg-white hover:bg-stone-100 text-stone-500 hover:text-stone-800 transition-colors flex items-center justify-center cursor-pointer"
                    title="Listen to example sentence"
                  >
                    <Volume2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <p className="font-serif italic text-stone-800 leading-relaxed">"{word.example}"</p>
              {word.exampleTranslation && showTranslation && (
                <p className="text-[11px] text-stone-500 font-sans leading-normal border-t border-stone-100 pt-1 mt-1">
                  {word.exampleTranslation}
                </p>
              )}
            </div>
          )}

          {/* Word Images Section (imageUrls & 3 Placeholders) */}
          <div className="bg-stone-50/80 border border-stone-200/80 p-3 rounded-lg space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[9px] font-mono font-bold uppercase tracking-wider text-stone-500 flex items-center gap-1.5">
                <ImageIcon className="w-3 h-3 text-stone-400" />
                Word Images ({Math.max(3, allImageUrls.length)})
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowAddImageInput(prev => !prev);
                }}
                className="text-[10px] font-medium text-amber-700 hover:text-amber-900 hover:bg-amber-100/70 px-2 py-0.5 rounded transition-all cursor-pointer flex items-center gap-1"
                title="Add Image URL"
              >
                <Plus className="w-3 h-3" />
                <span>{showAddImageInput ? "Cancel" : "Add Image URL"}</span>
              </button>
            </div>

            {/* Input form to add a new image URL */}
            {showAddImageInput && (
              <form onSubmit={handleAddImageUrl} onClick={(e) => e.stopPropagation()} className="flex items-center gap-2 pt-1">
                <input
                  type="url"
                  placeholder="Paste image URL (e.g. https://example.com/photo.jpg)"
                  value={newImageUrlInput}
                  onChange={(e) => setNewImageUrlInput(e.target.value)}
                  className="flex-1 text-xs bg-white border border-stone-300 rounded px-2 py-1 text-stone-800 placeholder:text-stone-400 focus:outline-hidden focus:border-amber-500"
                />
                <button
                  type="submit"
                  disabled={!newImageUrlInput.trim()}
                  className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-bold text-xs rounded cursor-pointer transition-colors"
                >
                  Save
                </button>
              </form>
            )}

            {/* Display stored image URLs gallery or 3 Placeholders */}
            <div className="grid grid-cols-3 gap-1.5 sm:gap-2 pt-1">
              {Array.from({ length: Math.max(3, allImageUrls.length) }).map((_, idx) => {
                const imgUrl = allImageUrls[idx];
                const isGenerating = generatingSlotIndex === idx;

                if (imgUrl) {
                  return (
                    <WordCardImageItem
                      key={`slot-${idx}-${imgUrl}`}
                      imgUrl={imgUrl}
                      wordText={word.word}
                      index={idx}
                      onPreview={(src) => setSelectedPreviewImage(src)}
                      onRemove={(src) => handleRemoveImageUrl(src)}
                      onResolveUrl={handleResolveImageUrl}
                      onRegenerateSlot={() => handleGenerateSlotQuery(idx)}
                      isGenerating={isGenerating}
                    />
                  );
                }

                // Empty Placeholder slot - Entire card is clickable touch target for mobile
                return (
                  <button
                    key={`placeholder-${idx}`}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (generatingSlotIndex === null) {
                        handleGenerateSlotQuery(idx);
                      }
                    }}
                    disabled={generatingSlotIndex !== null}
                    className="relative rounded-xl border border-dashed border-stone-300/90 bg-white/90 aspect-square flex flex-col items-center justify-center p-1.5 sm:p-2 text-center transition-all hover:border-amber-400 hover:bg-amber-50/40 active:bg-amber-100/40 group/placeholder cursor-pointer disabled:opacity-50 select-none outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50"
                    title={`Click to generate image with AI for Placeholder #${idx + 1}`}
                  >
                    {isGenerating ? (
                      <div className="flex flex-col items-center justify-center space-y-1">
                        <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 text-amber-600 animate-spin" />
                        <span className="text-[8.5px] sm:text-[9.5px] font-bold text-amber-800 uppercase tracking-tight">
                          Querying...
                        </span>
                      </div>
                    ) : (
                      <>
                        <span className="absolute top-1 left-1.5 text-[8.5px] sm:text-[9.5px] font-mono font-semibold text-stone-400 group-hover/placeholder:text-amber-700 transition-colors">
                          #{idx + 1}
                        </span>

                        <div className="flex flex-col items-center justify-center gap-0.5 sm:gap-1 mt-1 sm:mt-0">
                          <div className="p-1 sm:p-1.5 rounded-full bg-amber-50/80 group-hover/placeholder:bg-amber-100 text-amber-700 transition-colors border border-amber-200/60 shadow-3xs">
                            <Sparkles className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-amber-600 group-hover/placeholder:scale-110 transition-transform" />
                          </div>
                          <span className="text-[9.5px] sm:text-[10.5px] font-bold text-stone-700 group-hover/placeholder:text-amber-900 leading-tight">
                            AI Query
                          </span>
                        </div>
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Card Footer Status & Memory Strength */}
        <div className="pt-3 border-t border-stone-100 flex items-center gap-2 text-[11px] min-w-0">
          <span className={`shrink-0 font-semibold px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-full text-[10px] flex items-center gap-1.5 ${
            word.learned 
              ? "bg-emerald-50 text-emerald-800 border border-emerald-200/70" 
              : "bg-amber-50/80 text-amber-900 border border-amber-200/70"
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${word.learned ? "bg-emerald-500" : "bg-amber-500"}`} />
            <span className="truncate">{word.learned ? "Mastered" : "Learning"}</span>
          </span>

          <MemoryStrengthBar
            strength={word.strength || 0}
            onClick={() => setShowHistoryModal(true)}
          />

          {word.starred && (
            <span className="shrink-0 text-amber-700 font-bold flex items-center gap-1 text-[10px] uppercase tracking-wide bg-amber-50 border border-amber-200/70 px-2 py-1 rounded-md">
              ★
            </span>
          )}
        </div>
      </div>

      <AnimatePresence>
        {showHistoryModal && (
          <StrengthHistoryModal
            word={word}
            onClose={() => setShowHistoryModal(false)}
            onUpdateWord={handleModalWordUpdate}
          />
        )}
        {selectedPreviewImage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSelectedPreviewImage(null)}
            className="fixed inset-0 z-50 bg-stone-900/80 backdrop-blur-xs flex items-center justify-center p-4 cursor-pointer"
          >
            <div className="relative max-w-3xl max-h-[85vh] bg-black rounded-xl overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                onClick={() => setSelectedPreviewImage(null)}
                className="absolute top-3 right-3 z-10 p-1.5 rounded-full bg-stone-900/80 text-white hover:bg-stone-800 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
              <img
                src={selectedPreviewImage}
                alt={`${word.word} full view`}
                className="max-w-full max-h-[85vh] object-contain"
                referrerPolicy="no-referrer"
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

export default React.memo(WordCard);

interface WordCardImageItemProps {
  imgUrl: string;
  wordText: string;
  index: number;
  onPreview: (src: string) => void;
  onRemove: (src: string) => void;
  onResolveUrl?: (oldUrl: string, resolvedUrl: string) => void;
  onRegenerateSlot?: () => void;
  isGenerating?: boolean;
}

function WordCardImageItem({ imgUrl, wordText, index, onPreview, onRemove, onResolveUrl, onRegenerateSlot, isGenerating }: WordCardImageItemProps) {
  const [resolvedSrc, setResolvedSrc] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [failed, setFailed] = useState<boolean>(false);

  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);
    setFailed(false);

    if (!imgUrl) {
      setFailed(true);
      setIsLoading(false);
      return;
    }

    if (!imgUrl.includes("image.nclong87.workers.dev")) {
      setResolvedSrc(imgUrl);
      setIsLoading(false);
      return;
    }

    const match = imgUrl.match(/query=([^&]+)/);
    const queryTerm = match ? decodeURIComponent(match[1]) : wordText;

    fetchWorkerImageUrl(queryTerm, index + 1).then((url) => {
      if (isMounted) {
        if (url) {
          setResolvedSrc(url);
          if (onResolveUrl) {
            onResolveUrl(imgUrl, url);
          }
        } else {
          setFailed(true);
        }
        setIsLoading(false);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [imgUrl, wordText, index, onResolveUrl]);

  if (failed) {
    return (
      <div className="relative group/img rounded-lg overflow-hidden border border-stone-200 aspect-square bg-stone-100 flex flex-col items-center justify-center p-1 text-center">
        <ImageIcon className="w-4 h-4 text-stone-400 mb-1" />
        <span className="text-[9px] text-stone-400 italic">Error</span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove(imgUrl);
          }}
          className="absolute top-1 right-1 text-stone-400 hover:text-red-500 p-0.5 rounded cursor-pointer"
          title="Remove Image"
        >
          <X className="w-3 h-3 text-stone-500" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative group/img rounded-lg overflow-hidden border border-stone-200 aspect-square bg-stone-100 hover:shadow-xs transition-all">
      {isLoading || isGenerating ? (
        <div className="w-full h-full flex items-center justify-center bg-stone-100 text-stone-400 animate-pulse">
          <Loader2 className="w-4 h-4 animate-spin text-amber-600" />
        </div>
      ) : (
        <img
          src={resolvedSrc}
          alt={`${wordText} visual clue ${index + 1}`}
          className="w-full h-full object-cover cursor-pointer hover:scale-105 transition-transform"
          referrerPolicy="no-referrer"
          onClick={(e) => {
            e.stopPropagation();
            onPreview(resolvedSrc || imgUrl);
          }}
          onError={() => {
            setFailed(true);
          }}
        />
      )}

      {/* Index Badge */}
      <span className="absolute bottom-1 left-1 px-1.5 py-0.2 bg-stone-900/75 text-white text-[9px] font-mono font-bold rounded backdrop-blur-xs select-none shadow-3xs">
        #{index + 1}
      </span>

      <div className="absolute top-1 right-1 opacity-100 sm:opacity-0 sm:group-hover/img:opacity-100 transition-opacity flex items-center gap-1 bg-stone-900/75 p-0.5 rounded-md backdrop-blur-xs shadow-2xs">
        {onRegenerateSlot && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRegenerateSlot();
            }}
            disabled={isGenerating}
            className="text-white hover:text-amber-300 p-0.5 rounded cursor-pointer disabled:opacity-50"
            title="Generate new image query with AI"
          >
            <Sparkles className="w-3 h-3 text-amber-300" />
          </button>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onPreview(resolvedSrc || imgUrl);
          }}
          className="text-white hover:text-amber-300 p-0.5 rounded cursor-pointer"
          title="Expand Image"
        >
          <ExternalLink className="w-3 h-3" />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove(imgUrl);
          }}
          className="text-white hover:text-red-400 p-0.5 rounded cursor-pointer"
          title="Remove Image URL"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

