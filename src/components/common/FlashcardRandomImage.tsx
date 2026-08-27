import { useState, useEffect, useMemo } from "react";
import { ImageIcon, Loader2, Maximize2, RefreshCw } from "lucide-react";
import { fetchWorkerImageUrl } from "../../utils/quizGenerator";

interface FlashcardRandomImageProps {
  images?: string[];
  imageUrl?: string;
  imageUrls?: string[];
  wordText: string;
  className?: string;
  imageClassName?: string;
  onPreviewImage?: (url: string) => void;
  showRefreshButton?: boolean;
}

/**
 * Extracts all non-empty unique image URLs from imageUrls array and single imageUrl
 */
export function getWordImageUrls(
  images?: string[],
  imageUrl?: string,
  imageUrls?: string[]
): string[] {
  const combined = [
    ...(images || []),
    ...(imageUrls || []),
    ...(imageUrl ? [imageUrl] : [])
  ];
  return Array.from(new Set(combined.map((u) => String(u || "").trim()).filter(Boolean)));
}

export default function FlashcardRandomImage({
  images,
  imageUrl,
  imageUrls,
  wordText,
  className = "",
  imageClassName = "",
  onPreviewImage,
  showRefreshButton = true
}: FlashcardRandomImageProps) {
  const allImages = useMemo(() => {
    return getWordImageUrls(images, imageUrl, imageUrls);
  }, [images, imageUrl, imageUrls]);

  const [selectedRawUrl, setSelectedRawUrl] = useState<string | null>(null);
  const [resolvedSrc, setResolvedSrc] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [failed, setFailed] = useState<boolean>(false);

  // Pick a random image from available images when list of images or word changes
  const pickRandomImage = () => {
    if (allImages.length === 0) {
      setSelectedRawUrl(null);
      return;
    }
    const randomIndex = Math.floor(Math.random() * allImages.length);
    setSelectedRawUrl(allImages[randomIndex]);
  };

  useEffect(() => {
    pickRandomImage();
  }, [wordText, allImages.length, JSON.stringify(allImages)]);

  // Resolve direct URL if worker query URL
  useEffect(() => {
    let isMounted = true;
    if (!selectedRawUrl) {
      setResolvedSrc("");
      setLoading(false);
      setFailed(false);
      return;
    }

    setLoading(true);
    setFailed(false);

    if (!selectedRawUrl.includes("image.nclong87.workers.dev")) {
      setResolvedSrc(selectedRawUrl);
      setLoading(false);
      return;
    }

    const match = selectedRawUrl.match(/query=([^&]+)/);
    const queryTerm = match ? decodeURIComponent(match[1]) : wordText;

    fetchWorkerImageUrl(queryTerm, 1).then((url) => {
      if (isMounted) {
        if (url) {
          setResolvedSrc(url);
        } else {
          setFailed(true);
        }
        setLoading(false);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [selectedRawUrl, wordText]);

  if (!selectedRawUrl || allImages.length === 0) {
    return null;
  }

  if (failed) {
    return null;
  }

  const handleContainerClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onPreviewImage && resolvedSrc) {
      onPreviewImage(resolvedSrc);
    }
  };

  const handlePickNextRandom = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (allImages.length > 1) {
      // Pick a different random image if possible
      let nextIndex = Math.floor(Math.random() * allImages.length);
      if (allImages[nextIndex] === selectedRawUrl && allImages.length > 1) {
        nextIndex = (nextIndex + 1) % allImages.length;
      }
      setSelectedRawUrl(allImages[nextIndex]);
    }
  };

  return (
    <div
      onClick={handleContainerClick}
      className={`relative rounded-xl overflow-hidden border border-stone-200/90 bg-stone-100/90 group/flashcard-img transition-all ${
        onPreviewImage ? "cursor-pointer hover:shadow-md" : ""
      } ${className}`}
    >
      {/* Loading overlay */}
      {loading && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-stone-100/90 backdrop-blur-2xs p-4 text-center">
          <Loader2 className="w-5 h-5 text-amber-500 animate-spin mb-1" />
          <span className="text-[10px] font-mono text-stone-500 font-medium">Loading image...</span>
        </div>
      )}

      {resolvedSrc && (
        <img
          src={resolvedSrc}
          alt={`${wordText} flashcard visual`}
          className={`w-full h-full object-cover transition-transform duration-300 group-hover/flashcard-img:scale-103 ${imageClassName}`}
          referrerPolicy="no-referrer"
          onLoad={() => setLoading(false)}
          onError={() => setLoading(false)}
        />
      )}

      {/* Floating badges & controls */}
      <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover/flashcard-img:opacity-100 transition-opacity z-20">
        {allImages.length > 1 && showRefreshButton && (
          <button
            type="button"
            onClick={handlePickNextRandom}
            className="p-1 rounded-lg bg-stone-900/80 hover:bg-black text-amber-300 transition-colors shadow-2xs backdrop-blur-xs cursor-pointer"
            title={`Randomize image (${allImages.length} available)`}
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        )}
        {onPreviewImage && (
          <button
            type="button"
            onClick={handleContainerClick}
            className="p-1 rounded-lg bg-stone-900/80 hover:bg-black text-white transition-colors shadow-2xs backdrop-blur-xs cursor-pointer"
            title="Expand Image"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Multiple images indicator pill */}
      {allImages.length > 1 && (
        <div className="absolute bottom-2 left-2 z-10 pointer-events-none">
          <span className="px-2 py-0.5 rounded-full text-[9.5px] font-mono font-semibold bg-stone-900/75 text-amber-300 backdrop-blur-xs shadow-2xs flex items-center gap-1">
            <ImageIcon className="w-2.5 h-2.5" />
            <span>Random visual ({allImages.length})</span>
          </span>
        </div>
      )}
    </div>
  );
}
