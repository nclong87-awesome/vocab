import React, { useState, useEffect, useMemo } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Image as ImageIcon, Plus, X, ExternalLink, Sparkles, Loader2 } from "lucide-react";
import { Word, LLMConfig } from "../../types";
import { fetchWorkerImageUrl, getImageKeyword } from "../../utils/quizGenerator";
import { generateImageSearchQueryService } from "../../services/llmClientService";

export interface WordImageGalleryProps {
  word: Partial<Word> & { word: string; definition?: string; context?: string; partOfSpeech?: string; imageUrls?: string[]; imageUrl?: string };
  imageUrls?: string[];
  onImagesChange?: (updatedUrls: string[]) => void;
  llmConfig?: LLMConfig;
  className?: string;
  title?: string;
  titlePrefix?: string;
  autoLoadInitialImages?: boolean;
  showAddUrlButton?: boolean;
  minSlots?: number;
}

export const WordImageGallery: React.FC<WordImageGalleryProps> = ({
  word,
  imageUrls: propImageUrls,
  onImagesChange,
  llmConfig,
  className = "",
  title,
  titlePrefix,
  autoLoadInitialImages = false,
  showAddUrlButton = true,
  minSlots = 3,
}) => {
  const [internalImageUrls, setInternalImageUrls] = useState<string[]>([]);
  const [isInitialLoading, setIsInitialLoading] = useState<boolean>(false);
  const [showAddImageInput, setShowAddImageInput] = useState<boolean>(false);
  const [newImageUrlInput, setNewImageUrlInput] = useState<string>("");
  const [selectedPreviewImage, setSelectedPreviewImage] = useState<string | null>(null);
  const [generatingSlotIndex, setGeneratingSlotIndex] = useState<number | null>(null);

  // Sync internal state with props
  useEffect(() => {
    const rawList = propImageUrls !== undefined 
      ? propImageUrls 
      : [...(word.imageUrls || []), ...(word.imageUrl ? [word.imageUrl] : [])];
    const cleaned = Array.from(new Set(rawList.map((u) => String(u || "").trim()).filter(Boolean)));
    setInternalImageUrls(cleaned);
  }, [propImageUrls, word.imageUrls, word.imageUrl]);

  // Handle auto-loading initial candidate images for new words (e.g. in Chat)
  useEffect(() => {
    if (!autoLoadInitialImages || !word.word) return;

    const existing = propImageUrls !== undefined 
      ? propImageUrls 
      : [...(word.imageUrls || []), ...(word.imageUrl ? [word.imageUrl] : [])];
    const cleanedExisting = Array.from(new Set(existing.map((u) => String(u || "").trim()).filter(Boolean)));

    // If we already have images, do not re-fetch
    if (cleanedExisting.length > 0) return;

    let isMounted = true;
    setIsInitialLoading(true);

    const keyword = getImageKeyword(word.word) || word.word;
    const cleanKey = keyword.includes(",") ? keyword.split(",")[0].trim() : keyword.trim();

    const queries = [
      cleanKey,
      `${cleanKey} photo`,
      `${cleanKey} illustration`
    ];

    Promise.all(queries.map((q, idx) => fetchWorkerImageUrl(q, idx + 1)))
      .then((resolvedList) => {
        if (!isMounted) return;
        const validUrls = resolvedList.filter(Boolean) as string[];
        if (validUrls.length > 0) {
          setInternalImageUrls(validUrls);
          if (onImagesChange) {
            onImagesChange(validUrls);
          }
        }
      })
      .catch((e) => {
        console.warn("Error fetching initial candidate images:", e);
        if (!isMounted) return;
        const fallbackList = [
          `https://loremflickr.com/400/400/${encodeURIComponent(cleanKey.toLowerCase())}?lock=1`,
          `https://loremflickr.com/400/400/${encodeURIComponent(cleanKey.toLowerCase())}?lock=2`,
          `https://loremflickr.com/400/400/${encodeURIComponent(cleanKey.toLowerCase())}?lock=3`,
        ];
        setInternalImageUrls(fallbackList);
        if (onImagesChange) {
          onImagesChange(fallbackList);
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsInitialLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [autoLoadInitialImages, word.word]);

  const allImageUrls = useMemo<string[]>(() => {
    return internalImageUrls;
  }, [internalImageUrls]);

  const handleUpdateUrls = (nextList: string[]) => {
    setInternalImageUrls(nextList);
    if (onImagesChange) {
      onImagesChange(nextList);
    }
  };

  const handleAddImageUrl = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = newImageUrlInput.trim();
    if (!trimmed) return;
    const updatedList: string[] = Array.from(new Set([...allImageUrls, trimmed]));
    handleUpdateUrls(updatedList);
    setNewImageUrlInput("");
    setShowAddImageInput(false);
  };

  const handleRemoveImageUrl = (urlToRemove: string) => {
    const updatedList: string[] = allImageUrls.filter((u) => u !== urlToRemove);
    handleUpdateUrls(updatedList);
  };

  const handleGenerateSlotQuery = async (slotIndex: number) => {
    if (generatingSlotIndex !== null) return;
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

      handleUpdateUrls(nextList);
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
    handleUpdateUrls(nextList);
  };

  const totalSlotsCount = Math.max(minSlots, allImageUrls.length);
  const displayTitle = title || (titlePrefix ? `${titlePrefix} (${totalSlotsCount})` : `Word Images (${totalSlotsCount})`);

  return (
    <div className={`bg-stone-50/80 border border-stone-200/80 p-3 rounded-lg space-y-2 ${className}`}>
      {/* Header Info */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[9px] font-mono font-bold uppercase tracking-wider text-stone-500 flex items-center gap-1.5 min-w-0">
          <ImageIcon className="w-3 h-3 text-stone-400 shrink-0" />
          <span className="truncate">{displayTitle}</span>
        </span>

        {showAddUrlButton && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setShowAddImageInput((prev) => !prev);
            }}
            className="text-[10px] font-medium text-amber-700 hover:text-amber-900 hover:bg-amber-100/70 px-2 py-0.5 rounded transition-all cursor-pointer flex items-center gap-1 shrink-0"
            title="Add Image URL"
          >
            <Plus className="w-3 h-3" />
            <span>{showAddImageInput ? "Cancel" : "Add Image URL"}</span>
          </button>
        )}
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
            className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-bold text-xs rounded cursor-pointer transition-colors shrink-0"
          >
            Save
          </button>
        </form>
      )}

      {/* Slots Grid */}
      {isInitialLoading ? (
        <div className="grid grid-cols-3 gap-1.5 sm:gap-2 pt-1">
          {Array.from({ length: minSlots }).map((_, idx) => (
            <div
              key={idx}
              className="rounded-xl border border-dashed border-stone-300/90 aspect-square bg-white/80 flex flex-col items-center justify-center p-2 text-center animate-pulse"
            >
              <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 text-amber-600 animate-spin mb-1" />
              <span className="text-[9px] font-bold text-stone-500 uppercase font-mono">Loading #{idx + 1}...</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-1.5 sm:gap-2 pt-1">
          {Array.from({ length: totalSlotsCount }).map((_, idx) => {
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
      )}

      {/* Lightbox Modal */}
      <AnimatePresence>
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
    </div>
  );
};

export interface WordCardImageItemProps {
  imgUrl: string;
  wordText: string;
  index: number;
  onPreview: (src: string) => void;
  onRemove: (src: string) => void;
  onResolveUrl?: (oldUrl: string, resolvedUrl: string) => void;
  onRegenerateSlot?: () => void;
  isGenerating?: boolean;
}

export function WordCardImageItem({
  imgUrl,
  wordText,
  index,
  onPreview,
  onRemove,
  onResolveUrl,
  onRegenerateSlot,
  isGenerating,
}: WordCardImageItemProps) {
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

export default WordImageGallery;
