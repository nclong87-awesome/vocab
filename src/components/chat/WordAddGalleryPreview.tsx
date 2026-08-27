import React, { useState, useEffect } from "react";
import { Image as ImageIcon, X, ZoomIn, RefreshCw, Loader2 } from "lucide-react";
import { Word } from "../../types";
import { fetchWorkerImageUrl, getImageKeyword } from "../../utils/quizGenerator";

interface WordAddGalleryPreviewProps {
  word: Partial<Word> & { word: string };
  onImagesChange?: (updatedUrls: string[]) => void;
  className?: string;
}

export const WordAddGalleryPreview: React.FC<WordAddGalleryPreviewProps> = ({
  word,
  onImagesChange,
  className = "",
}) => {
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [previewModalUrl, setPreviewModalUrl] = useState<string | null>(null);
  const [failedIndices, setFailedIndices] = useState<Set<number>>(new Set());

  const wordName = word.word || "Word";

  const loadWorkerImages = async (targetWord: string, existingUrls?: string[]) => {
    setIsLoading(true);
    setFailedIndices(new Set());

    // If existingUrls already has resolved non-worker direct URLs, use them directly
    if (existingUrls && existingUrls.length > 0 && !existingUrls.some(u => u.includes("image.nclong87.workers.dev"))) {
      setImageUrls(existingUrls);
      setIsLoading(false);
      return;
    }

    const keyword = getImageKeyword(targetWord) || targetWord;
    const cleanKey = keyword.includes(",") ? keyword.split(",")[0].trim() : keyword.trim();

    const queries = [
      cleanKey,
      `${cleanKey} photo`,
      `${cleanKey} illustration`
    ];

    try {
      const resolvedList = await Promise.all(
        queries.map((q, idx) => fetchWorkerImageUrl(q, idx + 1))
      );
      const validUrls = resolvedList.filter(Boolean);
      setImageUrls(validUrls);
      if (onImagesChange) {
        onImagesChange(validUrls);
      }
    } catch (e) {
      console.warn("Error fetching candidate worker images:", e);
      const fallbackList = [
        `https://loremflickr.com/400/400/${encodeURIComponent(cleanKey.toLowerCase())}?lock=1`,
        `https://loremflickr.com/400/400/${encodeURIComponent(cleanKey.toLowerCase())}?lock=2`,
        `https://loremflickr.com/400/400/${encodeURIComponent(cleanKey.toLowerCase())}?lock=3`,
      ];
      setImageUrls(fallbackList);
      if (onImagesChange) {
        onImagesChange(fallbackList);
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    let isMounted = true;
    if (word.word) {
      loadWorkerImages(word.word, word.imageUrls).then(() => {
        if (!isMounted) return;
      });
    }
    return () => {
      isMounted = false;
    };
  }, [word.word, word.imageUrls]);

  const handleRemoveImage = (indexToRemove: number) => {
    const updated = imageUrls.filter((_, idx) => idx !== indexToRemove);
    setImageUrls(updated);
    setFailedIndices((prev) => {
      const next = new Set<number>();
      Array.from(prev).forEach((fIdx) => {
        if (fIdx < indexToRemove) next.add(fIdx);
        else if (fIdx > indexToRemove) next.add(fIdx - 1);
      });
      return next;
    });
    if (onImagesChange) {
      onImagesChange(updated);
    }
  };

  const handleRegenerateWorker = () => {
    if (word.word) {
      loadWorkerImages(word.word);
    }
  };

  return (
    <div className={`mt-2.5 mb-3 rounded-2xl bg-amber-50/90 border border-amber-200/90 p-3 sm:p-3.5 shadow-2xs ${className}`}>
      {/* Header Info */}
      <div className="flex items-center justify-between gap-2 pb-2 mb-2.5 border-b border-amber-200/80">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-amber-200/80 text-amber-900 flex items-center justify-center shrink-0 shadow-3xs font-bold text-xs">
            {isLoading ? (
              <Loader2 className="w-3.5 h-3.5 text-amber-800 animate-spin" />
            ) : (
              <ImageIcon className="w-3.5 h-3.5 text-amber-800" />
            )}
          </div>
          <div>
            <h5 className="text-xs font-bold text-stone-900 flex items-center gap-1.5">
              <span>Candidate Images ({imageUrls.length})</span>
              <span className="text-[10px] font-mono bg-amber-100 text-amber-900 border border-amber-300/60 px-1.5 py-0.2 rounded-full">
                image.nclong87.workers.dev
              </span>
            </h5>
            <p className="text-[11px] text-amber-900/80">
              Click <strong className="text-red-700">✕</strong> to remove any image that is not relevant to <span className="font-bold">"{wordName}"</span>.
            </p>
          </div>
        </div>

        {!isLoading && imageUrls.length < 3 && (
          <button
            type="button"
            onClick={handleRegenerateWorker}
            className="px-2 py-1 bg-white hover:bg-amber-100/80 border border-amber-300/80 rounded-lg text-[10.5px] font-bold text-amber-900 flex items-center gap-1 shadow-3xs transition-all cursor-pointer shrink-0"
            title="Reload 3 worker images"
          >
            <RefreshCw className="w-3 h-3 text-amber-700" />
            <span className="hidden sm:inline">Reset 3 Images</span>
          </button>
        )}
      </div>

      {/* Grid of 3 candidate images */}
      {isLoading ? (
        <div className="grid grid-cols-3 gap-2 sm:gap-2.5">
          {[1, 2, 3].map((num) => (
            <div
              key={num}
              className="rounded-xl border border-amber-200/90 aspect-square bg-white/80 flex flex-col items-center justify-center p-2 text-center animate-pulse"
            >
              <Loader2 className="w-5 h-5 text-amber-600 animate-spin mb-1" />
              <span className="text-[10px] font-bold text-stone-500 uppercase font-mono">Loading #{num}...</span>
            </div>
          ))}
        </div>
      ) : imageUrls.length > 0 ? (
        <div className="grid grid-cols-3 gap-2 sm:gap-2.5">
          {imageUrls.map((url, idx) => {
            const hasFailed = failedIndices.has(idx);

            return (
              <div
                key={`${url}-${idx}`}
                className="group relative rounded-xl overflow-hidden border border-amber-200/90 aspect-square bg-stone-100 shadow-2xs transition-all hover:border-amber-400"
              >
                {!hasFailed ? (
                  <img
                    src={url}
                    alt={`${wordName} visual option ${idx + 1}`}
                    referrerPolicy="no-referrer"
                    onError={() => {
                      setFailedIndices((prev) => new Set(prev).add(idx));
                    }}
                    className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center bg-stone-200/70 p-2 text-center">
                    <ImageIcon className="w-5 h-5 text-stone-400 mb-1" />
                    <span className="text-[10px] font-bold text-stone-500 uppercase font-mono">Image #{idx + 1}</span>
                    <span className="text-[9px] text-stone-400 italic">Preview error</span>
                  </div>
                )}

                {/* Number Badge */}
                <span className="absolute bottom-1 left-1 px-1.5 py-0.2 bg-stone-900/75 text-white text-[9px] font-mono font-bold rounded backdrop-blur-xs select-none shadow-3xs">
                  #{idx + 1}
                </span>

                {/* Quick Expand Button */}
                {!hasFailed && (
                  <button
                    type="button"
                    onClick={() => setPreviewModalUrl(url)}
                    className="absolute bottom-1 right-1 p-1 bg-stone-900/75 hover:bg-stone-900 text-white rounded-md opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer shadow-3xs"
                    title="View full size"
                  >
                    <ZoomIn className="w-3 h-3" />
                  </button>
                )}

                {/* Remove / Delete Image Button */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemoveImage(idx);
                  }}
                  className="absolute top-1 right-1 w-6 h-6 bg-stone-900/80 hover:bg-red-600 text-white rounded-full flex items-center justify-center transition-all cursor-pointer shadow-md hover:scale-110 active:scale-95 z-10"
                  title={`Remove image #${idx + 1}`}
                >
                  <X className="w-3.5 h-3.5 stroke-[2.5]" />
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="py-4 px-3 text-center bg-white/70 border border-dashed border-amber-300 rounded-xl space-y-1.5">
          <p className="text-xs font-semibold text-amber-950">
            All candidate images removed.
          </p>
          <p className="text-[11px] text-stone-500">
            "{wordName}" will be saved without images, or you can click below to reload images.
          </p>
          <button
            type="button"
            onClick={handleRegenerateWorker}
            className="mt-1 px-3 py-1 bg-stone-900 hover:bg-stone-800 text-amber-400 font-bold text-xs rounded-lg transition-all cursor-pointer shadow-2xs inline-flex items-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Restore 3 Images</span>
          </button>
        </div>
      )}

      {/* Lightbox Modal */}
      {previewModalUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/80 backdrop-blur-xs p-4"
          onClick={() => setPreviewModalUrl(null)}
        >
          <div className="relative max-w-lg w-full bg-stone-900 rounded-2xl p-2 overflow-hidden shadow-2xl">
            <button
              type="button"
              onClick={() => setPreviewModalUrl(null)}
              className="absolute top-3 right-3 p-1.5 bg-stone-800 hover:bg-red-600 text-white rounded-full transition-colors cursor-pointer shadow-lg z-10"
            >
              <X className="w-4 h-4 stroke-[2.5]" />
            </button>
            <img
              src={previewModalUrl}
              alt="Full view"
              className="w-full max-h-[75vh] object-contain rounded-xl"
              referrerPolicy="no-referrer"
            />
          </div>
        </div>
      )}
    </div>
  );
};
