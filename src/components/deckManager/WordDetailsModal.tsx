import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { X, BookOpen } from "lucide-react";
import { Word, TTSConfig, LLMConfig } from "../../types";
import { speakText, DEFAULT_TTS_CONFIG } from "../../utils/ttsService";
import { autofillWordService } from "../../services/llmClientService";
import { useModalBackNavigation } from "../../hooks/useModalBackNavigation";
import WordCard from "./WordCard";

interface WordDetailsModalProps {
  word: Word | null;
  isOpen?: boolean;
  onClose: () => void;
  onUpdateWord?: (updatedWord: Word) => void;
  onToggleStar?: (wordId: string) => void;
  onToggleLearned?: (wordId: string) => void;
  onDeleteWord?: (wordId: string) => void;
  speakWord?: (text: string) => void;
  handleRegenerateWord?: (word: Word) => void;
  regeneratingWordId?: string | null;
  regeneratedSuccessWordId?: string | null;
  ttsConfig?: TTSConfig;
  llmConfig?: LLMConfig;
  targetLanguage?: string;
  nativeLanguage?: string;
  appLanguage?: string;
}

export default function WordDetailsModal({
  word,
  isOpen = true,
  onClose,
  onUpdateWord,
  onToggleStar,
  onToggleLearned,
  onDeleteWord,
  speakWord: customSpeakWord,
  handleRegenerateWord: customHandleRegenerateWord,
  regeneratingWordId: customRegeneratingWordId,
  regeneratedSuccessWordId: customRegeneratedSuccessWordId,
  ttsConfig = DEFAULT_TTS_CONFIG,
  llmConfig,
  targetLanguage = "English",
  nativeLanguage,
  appLanguage
}: WordDetailsModalProps) {
  useModalBackNavigation(Boolean(isOpen && word), onClose);

  const [internalRegeneratingId, setInternalRegeneratingId] = useState<string | null>(null);
  const [internalSuccessId, setInternalSuccessId] = useState<string | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  if (!isOpen || !word) return null;

  const defaultSpeakWord = (text: string) => {
    speakText(text, ttsConfig, llmConfig, targetLanguage);
  };

  const handleSpeak = customSpeakWord || defaultSpeakWord;

  const handleRegenerate = async (targetWord: Word) => {
    if (customHandleRegenerateWord) {
      customHandleRegenerateWord(targetWord);
      return;
    }

    setInternalRegeneratingId(targetWord.id);
    setInternalSuccessId(null);

    try {
      const resolvedNative = nativeLanguage || 
        (typeof window !== "undefined" ? localStorage.getItem("vocab_learner_native_lang") || undefined : undefined) || 
        (appLanguage === "vi" ? "Vietnamese" : undefined);

      const details = await autofillWordService({
        word: targetWord.word,
        category: targetWord.category,
        context: targetWord.context,
        hint: targetWord.context || targetWord.category,
        targetLanguage: targetLanguage || "English",
        nativeLanguage: resolvedNative,
        cfg: llmConfig
      });

      const updatedWord: Word = {
        ...targetWord,
        pronunciation: details.pronunciation || targetWord.pronunciation,
        definition: details.definition || targetWord.definition,
        translation: details.translation || targetWord.translation,
        example: details.example || targetWord.example,
        exampleTranslation: details.exampleTranslation || targetWord.exampleTranslation
      };

      if (onUpdateWord) {
        onUpdateWord(updatedWord);
      }
      setInternalSuccessId(targetWord.id);
      setTimeout(() => setInternalSuccessId(null), 3000);
    } catch (err: any) {
      console.error("Failed to re-generate word details in modal:", err);
      alert("Unable to re-generate word details. Please verify your AI settings.");
    } finally {
      setInternalRegeneratingId(null);
    }
  };

  const handleDeleteWord = (wordId: string) => {
    if (onDeleteWord) {
      onDeleteWord(wordId);
    }
    onClose();
  };

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-stone-900/70 backdrop-blur-xs overflow-y-auto"
      onClick={onClose}
      id="word-details-modal-backdrop"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 10 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className="bg-white border border-stone-200 rounded-2xl shadow-2xl max-w-xl w-full overflow-hidden my-auto max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
        id="word-details-modal-container"
      >
        {/* Modal Header */}
        <div className="bg-stone-900 text-white p-4 sm:p-4.5 flex items-center justify-between gap-3 border-b border-stone-800 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-amber-400 text-stone-950 flex items-center justify-center font-bold text-xs shrink-0 shadow-2xs">
              <BookOpen className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold tracking-wide uppercase text-amber-300">
                  Word Details
                </h3>
                <span className="text-[10px] font-mono bg-stone-800 text-stone-300 px-2 py-0.5 rounded-full border border-stone-700">
                  Collection Entry
                </span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg bg-stone-800 text-stone-400 hover:text-white hover:bg-stone-700 transition-all cursor-pointer shrink-0"
            title="Close"
            id="word-details-modal-close-btn"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body: WordCard from Collection */}
        <div className="p-3.5 sm:p-5 overflow-y-auto flex-1 bg-stone-50/40">
          <WordCard
            word={word}
            speakWord={handleSpeak}
            handleRegenerateWord={handleRegenerate}
            regeneratingWordId={customRegeneratingWordId || internalRegeneratingId}
            regeneratedSuccessWordId={customRegeneratedSuccessWordId || internalSuccessId}
            onToggleStar={onToggleStar || (() => {})}
            onToggleLearned={onToggleLearned || (() => {})}
            onDeleteWord={handleDeleteWord}
            brokenImageIds={new Set()}
            handleImageError={() => {}}
            onUpdateWord={onUpdateWord}
            llmConfig={llmConfig}
          />
        </div>

        {/* Modal Footer */}
        <div className="bg-stone-50 border-t border-stone-200 p-3 sm:p-4 flex items-center justify-between text-xs text-stone-500 shrink-0">
          <span className="text-[11px] text-stone-500 font-sans">
            Word details from your personal vocabulary collection
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-stone-900 hover:bg-stone-800 text-white font-bold text-xs rounded-lg transition-all cursor-pointer shrink-0 ml-2"
          >
            Close
          </button>
        </div>
      </motion.div>
    </motion.div>,
    document.body
  );
}
