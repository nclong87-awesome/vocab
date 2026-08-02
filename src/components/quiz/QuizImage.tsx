import React, { useState, useEffect } from "react";
import { HelpCircle, Sparkles, ImageIcon, Loader2 } from "lucide-react";
import { fetchWorkerImageUrl, getImagePrompt } from "../../utils/quizGenerator";

interface QuizImageProps {
  src?: string;
  alt?: string;
  word?: string;
  className?: string;
}

export function QuizImage({ src, alt, word, className = "" }: QuizImageProps) {
  const [imgSrc, setImgSrc] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    setFailed(false);

    async function loadVisualClue() {
      // If src is already a direct valid image URL (e.g. Unsplash or direct HTTP image)
      if (src && src.trim().length > 0 && (src.startsWith("http://") || src.startsWith("https://")) && !src.includes("pollinations.ai")) {
        if (isMounted) {
          setImgSrc(src);
        }
        return;
      }

      // Construct prompt from word or src
      const promptToUse = word
        ? getImagePrompt(word)
        : (src && !src.startsWith("http") ? src : "a clear realistic photograph for vocabulary learning");

      const resolvedUrl = await fetchWorkerImageUrl(promptToUse);
      if (isMounted) {
        if (resolvedUrl) {
          setImgSrc(resolvedUrl);
        } else {
          setFailed(true);
          setLoading(false);
        }
      }
    }

    loadVisualClue();

    return () => {
      isMounted = false;
    };
  }, [src, word]);

  return (
    <div className={`relative w-full min-h-[220px] flex items-center justify-center bg-stone-100 overflow-hidden ${className}`}>
      {/* Image Loading Placeholder Overlay */}
      {loading && !failed && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-stone-100 border border-stone-200 p-6 text-center animate-pulse min-h-[220px]">
          <div className="relative mb-3 flex items-center justify-center">
            <div className="w-12 h-12 bg-stone-200 rounded-full flex items-center justify-center text-stone-500">
              <ImageIcon className="w-6 h-6 text-stone-600" />
            </div>
            <Loader2 className="w-10 h-10 text-amber-500 animate-spin absolute" />
          </div>
          <div className="space-y-1">
            <span className="text-xs font-bold text-stone-900 tracking-widest uppercase font-mono block">
              Loading Image...
            </span>
            <span className="text-[11px] text-stone-500 font-serif italic block">
              {word ? `Preparing visual clue for "${word}"` : "Preparing visual clue for quiz question"}
            </span>
          </div>
          <div className="mt-3 inline-flex items-center gap-1.5 px-2.5 py-1 bg-amber-50 border border-amber-200/80 rounded-none text-[10px] font-mono font-bold text-amber-900">
            <Sparkles className="w-3 h-3 text-amber-600 animate-spin" />
            <span>AI Visual Rendering</span>
          </div>
        </div>
      )}
      
      {!failed && imgSrc ? (
        <img
          src={imgSrc}
          alt={alt || "Quiz clue image"}
          referrerPolicy="no-referrer"
          onLoad={() => setLoading(false)}
          onError={() => {
            setFailed(true);
            setLoading(false);
          }}
          className={`w-full h-full object-cover transition-opacity duration-300 hover:scale-105 ${
            loading ? "opacity-0" : "opacity-100"
          }`}
        />
      ) : (
        <div className="w-full min-h-[220px] flex flex-col items-center justify-center bg-stone-100 text-stone-400 p-6 text-center">
          <HelpCircle className="w-8 h-8 text-stone-400 mb-2" />
          <span className="text-xs font-bold font-mono text-stone-700 uppercase">
            Visual Clue: {word || "Quiz Question"}
          </span>
          <span className="text-[11px] text-stone-500 font-serif italic mt-1">Image clue preview unavailable</span>
        </div>
      )}
    </div>
  );
}

export default QuizImage;
