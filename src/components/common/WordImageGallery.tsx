import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { 
  Image as ImageIcon, 
  Plus, 
  X, 
  ExternalLink, 
  Sparkles, 
  Loader2, 
  ArrowLeft, 
  ChevronLeft, 
  ChevronRight, 
  Sun, 
  Moon 
} from "lucide-react";
import { Word, LLMConfig } from "../../types";
import { fetchWorkerImageUrl, getImageKeyword } from "../../utils/quizGenerator";
import { generateImageSearchQueryService } from "../../services/llmClientService";
import { useModalBackNavigation } from "../../hooks/useModalBackNavigation";
import { isNoun } from "../../utils/wordNormalization";

export interface WordImageGalleryProps {
  word: Partial<Word> & { word: string; definition?: string; context?: string; partOfSpeech?: string; imageUrls?: string[]; imageUrl?: string; imageKeyword?: string };
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
  const [selectedPreviewIndex, setSelectedPreviewIndex] = useState<number | null>(null);
  const [backdropMode, setBackdropMode] = useState<"light" | "dark">("light");
  const [generatingSlotIndex, setGeneratingSlotIndex] = useState<number | null>(null);
  const [lightboxResolvedSrc, setLightboxResolvedSrc] = useState<string>("");
  const [isLightboxLoading, setIsLightboxLoading] = useState<boolean>(false);
  const [lightboxError, setLightboxError] = useState<boolean>(false);

  const touchStartXRef = useRef<number | null>(null);

  // Sync internal state with props
  useEffect(() => {
    const rawList = propImageUrls !== undefined 
      ? propImageUrls 
      : [...(word.imageUrls || []), ...(word.imageUrl ? [word.imageUrl] : [])];
    const cleaned = Array.from(new Set(rawList.map((u) => String(u || "").trim()).filter(Boolean)));
    setInternalImageUrls(cleaned);
  }, [propImageUrls, word.imageUrls, word.imageUrl]);

  // Handle auto-loading initial candidate image for newly added words (Strictly for Nouns & Only 1 Image)
  useEffect(() => {
    if (!autoLoadInitialImages || !word.word) return;

    // RULE 1: Apply only to nouns
    if (word.partOfSpeech && !isNoun(word.partOfSpeech)) {
      return;
    }

    const existing = propImageUrls !== undefined 
      ? propImageUrls 
      : [...(word.imageUrls || []), ...(word.imageUrl ? [word.imageUrl] : [])];
    const cleanedExisting = Array.from(new Set(existing.map((u) => String(u || "").trim()).filter(Boolean)));

    // If we already have images, do not re-fetch
    if (cleanedExisting.length > 0) return;

    let isMounted = true;
    setIsInitialLoading(true);

    const loadSingleCandidateImage = async () => {
      try {
        // RULE 2 & 3: Optimize the query prompt for this single noun image
        let queryTerm = word.imageKeyword?.trim() || "";

        if (!queryTerm) {
          queryTerm = await generateImageSearchQueryService({
            word: word.word,
            definition: word.definition,
            context: word.context,
            partOfSpeech: word.partOfSpeech,
            placeholderIndex: 1,
            cfg: llmConfig,
          });
        }

        if (!queryTerm) {
          const keyword = getImageKeyword(word.word) || word.word;
          queryTerm = keyword && keyword.includes(",") ? keyword.split(",")[0].trim() : (keyword ? keyword.trim() : "");
        }

        // Fetch exactly ONE image URL
        const resolvedUrl = await fetchWorkerImageUrl(queryTerm, 1);
        if (!isMounted) return;

        const finalUrl = resolvedUrl || `https://image.nclong87.workers.dev?query=${encodeURIComponent(queryTerm)}`;
        setInternalImageUrls([finalUrl]);
        if (onImagesChange) {
          onImagesChange([finalUrl]);
        }
      } catch (e) {
        console.warn("Error fetching single candidate image for noun:", e);
        if (!isMounted) return;
        const cleanKey = word.word.includes(",") ? word.word.split(",")[0].trim() : word.word.trim();
        const fallbackUrl = `https://loremflickr.com/400/400/${encodeURIComponent(cleanKey.toLowerCase())}?lock=1`;
        setInternalImageUrls([fallbackUrl]);
        if (onImagesChange) {
          onImagesChange([fallbackUrl]);
        }
      } finally {
        if (isMounted) {
          setIsInitialLoading(false);
        }
      }
    };

    loadSingleCandidateImage();

    return () => {
      isMounted = false;
    };
  }, [autoLoadInitialImages, word.word, word.partOfSpeech, word.definition, word.context, word.imageKeyword, llmConfig]);

  const allImageUrls = useMemo<string[]>(() => {
    return internalImageUrls;
  }, [internalImageUrls]);

  const validImageUrls = useMemo<string[]>(() => {
    return internalImageUrls.filter(Boolean);
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

  const handleOpenPreview = useCallback((src: string, index: number) => {
    setSelectedPreviewImage(src);
    setSelectedPreviewIndex(index);
    setLightboxResolvedSrc(src);
    setIsLightboxLoading(!src || src.includes("image.nclong87.workers.dev"));
    setLightboxError(false);
  }, []);

  const handleClosePreview = useCallback(() => {
    setSelectedPreviewImage(null);
    setSelectedPreviewIndex(null);
    setLightboxResolvedSrc("");
  }, []);

  // Back-button navigation hook: intercepts browser/hardware back button to close ONLY this image lightbox
  useModalBackNavigation(
    Boolean(selectedPreviewImage),
    handleClosePreview,
    "word-image-preview-modal"
  );

  // Carousel navigation between images
  const handlePrevImage = useCallback(() => {
    if (validImageUrls.length <= 1) return;
    setSelectedPreviewIndex((prev) => {
      const curr = prev !== null ? prev : 0;
      const next = (curr - 1 + validImageUrls.length) % validImageUrls.length;
      const nextSrc = validImageUrls[next];
      setSelectedPreviewImage(nextSrc);
      setLightboxResolvedSrc(nextSrc);
      setIsLightboxLoading(!nextSrc || nextSrc.includes("image.nclong87.workers.dev"));
      setLightboxError(false);
      return next;
    });
  }, [validImageUrls]);

  const handleNextImage = useCallback(() => {
    if (validImageUrls.length <= 1) return;
    setSelectedPreviewIndex((prev) => {
      const curr = prev !== null ? prev : 0;
      const next = (curr + 1) % validImageUrls.length;
      const nextSrc = validImageUrls[next];
      setSelectedPreviewImage(nextSrc);
      setLightboxResolvedSrc(nextSrc);
      setIsLightboxLoading(!nextSrc || nextSrc.includes("image.nclong87.workers.dev"));
      setLightboxError(false);
      return next;
    });
  }, [validImageUrls]);

  // Keyboard navigation shortcuts
  useEffect(() => {
    if (!selectedPreviewImage) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleClosePreview();
      } else if (e.key === "ArrowLeft") {
        handlePrevImage();
      } else if (e.key === "ArrowRight") {
        handleNextImage();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedPreviewImage, handleClosePreview, handlePrevImage, handleNextImage]);

  // Touch swipe detection for mobile
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartXRef.current = e.touches[0].clientX;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartXRef.current === null) return;
    const deltaX = e.changedTouches[0].clientX - touchStartXRef.current;
    touchStartXRef.current = null;
    if (Math.abs(deltaX) > 40) {
      if (deltaX > 0) {
        handlePrevImage();
      } else {
        handleNextImage();
      }
    }
  };

  // Resolve worker URL in lightbox if needed
  useEffect(() => {
    if (!selectedPreviewImage) return;

    if (!selectedPreviewImage.includes("image.nclong87.workers.dev")) {
      setLightboxResolvedSrc(selectedPreviewImage);
      setIsLightboxLoading(false);
      return;
    }

    let isMounted = true;
    setIsLightboxLoading(true);
    setLightboxError(false);

    const match = selectedPreviewImage.match(/query=([^&]+)/);
    const queryTerm = match ? decodeURIComponent(match[1]) : (word.word || "");
    const slotIdx = (selectedPreviewIndex !== null ? selectedPreviewIndex : 0) + 1;

    fetchWorkerImageUrl(queryTerm, slotIdx).then((url) => {
      if (isMounted) {
        if (url) {
          setLightboxResolvedSrc(url);
          handleResolveImageUrl(selectedPreviewImage, url);
        } else {
          setLightboxError(true);
        }
        setIsLightboxLoading(false);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [selectedPreviewImage, selectedPreviewIndex, word.word]);

  const currentAppLang = (typeof window !== "undefined" && (localStorage.getItem("vocab_learner_app_lang") || "en")) || "en";
  const isVi = currentAppLang === "vi";

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
        <div className={minSlots === 1 ? "grid grid-cols-1 max-w-[180px] sm:max-w-[200px] gap-1.5 sm:gap-2 pt-1" : "grid grid-cols-3 gap-1.5 sm:gap-2 pt-1"}>
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
        <div className={totalSlotsCount === 1 ? "grid grid-cols-1 max-w-[180px] sm:max-w-[200px] gap-1.5 sm:gap-2 pt-1" : "grid grid-cols-3 gap-1.5 sm:gap-2 pt-1"}>
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
                  onPreview={(src, previewIdx) => handleOpenPreview(src, previewIdx)}
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

      {/* Lightbox Modal with Back Navigation & Clean Mobile Layout */}
      {typeof document !== "undefined" && createPortal(
        <AnimatePresence>
          {selectedPreviewImage && (
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label="Image preview"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={handleClosePreview}
              className={`fixed inset-0 z-[9999] flex flex-col justify-between p-2 sm:p-4 select-none cursor-pointer transition-colors duration-300 ${
                backdropMode === "light"
                  ? "bg-stone-900/40 sm:bg-stone-900/45 backdrop-blur-md"
                  : "bg-stone-950/85 backdrop-blur-md"
              }`}
              style={{
                paddingTop: "max(0.75rem, env(safe-area-inset-top))",
                paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))",
              }}
            >
              {/* Top Bar Navigation */}
              <header
                onClick={(e) => e.stopPropagation()}
                className="flex items-center justify-between gap-2 px-2 sm:px-4 py-2 w-full max-w-4xl mx-auto z-20 cursor-default"
              >
                {/* Back button */}
                <button
                  type="button"
                  onClick={handleClosePreview}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer active:scale-95 shadow-md ${
                    backdropMode === "light"
                      ? "bg-white/95 text-stone-800 hover:bg-stone-100 border border-stone-200"
                      : "bg-stone-900/90 text-stone-100 hover:bg-stone-800 border border-stone-700"
                  }`}
                  aria-label={isVi ? "Quay lại" : "Back"}
                  title={isVi ? "Quay lại (Esc)" : "Back (Esc)"}
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>{isVi ? "Quay lại" : "Back"}</span>
                </button>

                {/* Word title & counter */}
                <div className="flex flex-col items-center min-w-0 px-2 text-center">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`text-xs sm:text-sm font-bold truncate max-w-[150px] sm:max-w-xs ${
                        backdropMode === "light" ? "text-white drop-shadow-sm" : "text-white"
                      }`}
                    >
                      {word.word}
                    </span>
                    {selectedPreviewIndex !== null && validImageUrls.length > 0 && (
                      <span
                        className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-md ${
                          backdropMode === "light"
                            ? "bg-amber-400/90 text-amber-950 border border-amber-300"
                            : "bg-amber-950/80 text-amber-300 border border-amber-700/60"
                        }`}
                      >
                        {selectedPreviewIndex + 1}/{validImageUrls.length}
                      </span>
                    )}
                  </div>
                  {word.translation && (
                    <span
                      className={`text-[10px] truncate max-w-[180px] sm:max-w-xs ${
                        backdropMode === "light" ? "text-stone-200 drop-shadow-2xs" : "text-stone-400"
                      }`}
                    >
                      {word.translation}
                    </span>
                  )}
                </div>

                {/* Actions: Theme Toggle, Open Original, Close */}
                <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => setBackdropMode((m) => (m === "light" ? "dark" : "light"))}
                    className={`p-2 rounded-full transition-all cursor-pointer active:scale-95 shadow-md ${
                      backdropMode === "light"
                        ? "bg-white/95 text-stone-700 hover:bg-stone-100 border border-stone-200"
                        : "bg-stone-900/90 text-stone-300 hover:bg-stone-800 border border-stone-700"
                    }`}
                    title={backdropMode === "light" ? "Dark backdrop mode" : "Light backdrop mode"}
                    aria-label="Toggle background theme"
                  >
                    {backdropMode === "light" ? (
                      <Moon className="w-4 h-4 text-stone-700" />
                    ) : (
                      <Sun className="w-4 h-4 text-amber-400" />
                    )}
                  </button>

                  {lightboxResolvedSrc && !lightboxError && (
                    <a
                      href={lightboxResolvedSrc}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`p-2 rounded-full transition-all cursor-pointer active:scale-95 shadow-md ${
                        backdropMode === "light"
                          ? "bg-white/95 text-stone-700 hover:bg-stone-100 border border-stone-200"
                          : "bg-stone-900/90 text-stone-300 hover:bg-stone-800 border border-stone-700"
                      }`}
                      title={isVi ? "Mở ảnh gốc trong tab mới" : "Open full resolution in new tab"}
                      aria-label="Open image in new tab"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  )}

                  <button
                    type="button"
                    onClick={handleClosePreview}
                    className={`p-2 rounded-full transition-all cursor-pointer active:scale-95 shadow-md ${
                      backdropMode === "light"
                        ? "bg-white/95 text-stone-700 hover:text-stone-900 hover:bg-stone-100 border border-stone-200"
                        : "bg-stone-900/90 text-stone-300 hover:text-white hover:bg-stone-800 border border-stone-700"
                    }`}
                    title={isVi ? "Đóng" : "Close"}
                    aria-label="Close"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </header>

              {/* Main Image Stage */}
              <div
                className="flex-1 flex items-center justify-center p-2 sm:p-4 relative min-h-0 w-full"
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
              >
                {/* Prev Button */}
                {validImageUrls.length > 1 && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handlePrevImage();
                    }}
                    className={`absolute left-2 sm:left-6 z-20 p-2.5 sm:p-3 rounded-full transition-all cursor-pointer active:scale-90 shadow-xl ${
                      backdropMode === "light"
                        ? "bg-white/90 hover:bg-white text-stone-800 border border-stone-200/80"
                        : "bg-stone-900/80 hover:bg-stone-900 text-white border border-stone-700"
                    }`}
                    aria-label="Previous image"
                    title="Previous image"
                  >
                    <ChevronLeft className="w-5 h-5 sm:w-6 sm:h-6" />
                  </button>
                )}

                {/* Centered Image (No black box!) */}
                <motion.div
                  key={lightboxResolvedSrc || selectedPreviewImage}
                  initial={{ scale: 0.94, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.94, opacity: 0 }}
                  transition={{ duration: 0.18, ease: "easeOut" }}
                  onClick={(e) => e.stopPropagation()}
                  className="relative max-w-full max-h-full flex items-center justify-center cursor-default"
                >
                  {isLightboxLoading && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center z-10">
                      <Loader2 className="w-8 h-8 text-amber-500 animate-spin mb-2" />
                      <span className="text-xs font-semibold text-white/90 drop-shadow-md font-mono">
                        {isVi ? "Đang tải ảnh..." : "Loading image..."}
                      </span>
                    </div>
                  )}

                  {lightboxError ? (
                    <div className="p-8 rounded-2xl bg-white/90 dark:bg-stone-900/90 shadow-2xl flex flex-col items-center justify-center text-center max-w-sm">
                      <ImageIcon className="w-10 h-10 text-stone-400 mb-2" />
                      <span className="text-xs font-semibold text-stone-700 dark:text-stone-300">
                        {isVi ? "Không thể tải ảnh xem trước" : "Unable to load image preview"}
                      </span>
                    </div>
                  ) : (
                    <img
                      src={lightboxResolvedSrc}
                      alt={`${word.word} full preview`}
                      className={`max-w-[92vw] sm:max-w-2xl md:max-w-3xl max-h-[66vh] sm:max-h-[74vh] object-contain rounded-2xl shadow-2xl transition-all ${
                        backdropMode === "light"
                          ? "ring-1 ring-stone-900/10 shadow-stone-900/30"
                          : "ring-1 ring-white/15 shadow-black/80"
                      } ${isLightboxLoading ? "opacity-0" : "opacity-100"}`}
                      referrerPolicy="no-referrer"
                      onLoad={() => setIsLightboxLoading(false)}
                      onError={() => {
                        setIsLightboxLoading(false);
                        setLightboxError(true);
                      }}
                    />
                  )}
                </motion.div>

                {/* Next Button */}
                {validImageUrls.length > 1 && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleNextImage();
                    }}
                    className={`absolute right-2 sm:right-6 z-20 p-2.5 sm:p-3 rounded-full transition-all cursor-pointer active:scale-90 shadow-xl ${
                      backdropMode === "light"
                        ? "bg-white/90 hover:bg-white text-stone-800 border border-stone-200/80"
                        : "bg-stone-900/80 hover:bg-stone-900 text-white border border-stone-700"
                    }`}
                    aria-label="Next image"
                    title="Next image"
                  >
                    <ChevronRight className="w-5 h-5 sm:w-6 sm:h-6" />
                  </button>
                )}
              </div>

              {/* Bottom Footer: Dots and dismiss hint */}
              <footer
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-md mx-auto flex flex-col items-center gap-2 pb-1 sm:pb-2 px-4 z-20 cursor-default"
              >
                {validImageUrls.length > 1 && (
                  <div className="flex items-center gap-2 py-1 px-3 rounded-full backdrop-blur-md shadow-xs bg-black/25 dark:bg-white/15">
                    {validImageUrls.map((_, dotIdx) => (
                      <button
                        key={`dot-${dotIdx}`}
                        type="button"
                        onClick={() => {
                          setSelectedPreviewIndex(dotIdx);
                          setSelectedPreviewImage(validImageUrls[dotIdx]);
                          setLightboxResolvedSrc(validImageUrls[dotIdx]);
                          setIsLightboxLoading(!validImageUrls[dotIdx] || validImageUrls[dotIdx].includes("image.nclong87.workers.dev"));
                          setLightboxError(false);
                        }}
                        className={`h-2 rounded-full transition-all cursor-pointer ${
                          selectedPreviewIndex === dotIdx
                            ? "w-6 bg-amber-400 shadow-xs"
                            : "w-2 bg-white/50 hover:bg-white/80"
                        }`}
                        aria-label={`Go to image #${dotIdx + 1}`}
                      />
                    ))}
                  </div>
                )}

                <p className="text-[11px] font-medium tracking-tight text-center text-white/80 drop-shadow-xs">
                  {isVi
                    ? "Nhấn quay lại hoặc chạm bên ngoài hình để đóng"
                    : "Press Back or tap outside image to close"}
                </p>
              </footer>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
};

export interface WordCardImageItemProps {
  imgUrl: string;
  wordText: string;
  index: number;
  onPreview: (src: string, index: number) => void;
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
            onPreview(resolvedSrc || imgUrl, index);
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
            onPreview(resolvedSrc || imgUrl, index);
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
