import React, { useState } from "react";
import { AnimatePresence } from "motion/react";
import { Volume2, RefreshCw, History, Timer, CheckCircle2, MessageSquare } from "lucide-react";
import { Word, LLMConfig, TTSConfig } from "../../types";
import { getDaysSinceLastReview, getNextReviewInfo } from "../../utils/spacedRepetition";
import StrengthHistoryModal from "./StrengthHistoryModal";
import MemoryStrengthBar from "../common/MemoryStrengthBar";
import WordChatModal from "../chat/WordChatModal";

interface WordAnalyticsCardProps {
  key?: React.Key;
  word: Word;
  speakingWordId: string | null;
  onSpeakWord: (wordText: string, wordId: string) => void;
  onToggleStarWord?: (wordId: string) => void;
  onToggleLearnedWord?: (wordId: string) => void;
  onUpdateWord?: (updatedWord: Word) => void;
  llmConfig?: LLMConfig;
  ttsConfig?: TTSConfig;
  targetLanguage?: string;
  nativeLanguage?: string;
  words?: Word[];
  onAddWord?: (word: string, hint?: string) => void;
}

function WordAnalyticsCard({
  word: initialWord,
  speakingWordId,
  onSpeakWord,
  onToggleStarWord: _onToggleStarWord,
  onToggleLearnedWord: _onToggleLearnedWord,
  onUpdateWord,
  llmConfig,
  ttsConfig,
  targetLanguage = "English",
  nativeLanguage = "Vietnamese",
  words,
  onAddWord
}: WordAnalyticsCardProps) {
  const [localWord, setLocalWord] = useState<Word | null>(null);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [showChatModal, setShowChatModal] = useState(false);

  const word = localWord || initialWord;

  const isMastered = word.learned || word.strength >= 80;
  const strengthLevel = word.strength ?? 0;
  const daysSinceReview = getDaysSinceLastReview(word);
  const isMemoryDecayed = daysSinceReview >= 5 || (word.lastReviewed !== null && strengthLevel < 80 && daysSinceReview >= 1);
  const reviewInfo = getNextReviewInfo(word);

  const handleModalWordUpdate = (updated: Word) => {
    setLocalWord(updated);
    if (onUpdateWord) {
      onUpdateWord(updated);
    }
  };

  return (
    <>
      <div 
        className={`p-5 space-y-4 relative flex flex-col justify-between transition-all duration-300 rounded-xl border ${
          isMemoryDecayed 
            ? "border-amber-300/80 bg-amber-50/15 shadow-[0_1px_3px_rgba(245,158,11,0.03)] hover:border-amber-400 hover:shadow-xs" 
            : isMastered 
              ? "border-emerald-200/80 bg-emerald-50/10 shadow-[0_1px_3px_rgba(16,185,129,0.02)] hover:border-emerald-300 hover:shadow-xs" 
              : "border-stone-200/80 bg-white shadow-2xs hover:border-stone-300 hover:shadow-xs"
        } hover:-translate-y-0.5`}
      >
        {/* Top Word Header */}
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h4 className="text-lg font-bold text-stone-900 tracking-tight flex flex-wrap items-center gap-2">
                <span className="truncate">{word.word}</span>
                {isMemoryDecayed && (
                  <span className="inline-flex items-center gap-1 text-[9px] font-bold text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full font-mono shrink-0" title={`Last reviewed ${daysSinceReview} day(s) ago. Refresher recommended!`}>
                    <RefreshCw className="w-2.5 h-2.5 text-amber-600 animate-spin-slow" />
                    <span>{daysSinceReview > 0 ? `${daysSinceReview}d ago` : "Refresher"}</span>
                  </span>
                )}
                {!isMemoryDecayed && (
                  <span 
                    className={`inline-flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded-full font-mono shrink-0 border cursor-pointer ${
                      reviewInfo.isDue
                        ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                        : "bg-stone-50 text-stone-600 border-stone-200"
                    }`}
                    onClick={() => setShowHistoryModal(true)}
                    title={reviewInfo.isDue ? "Eligible for quiz & review now" : `Next review scheduled ${reviewInfo.formattedCountdown}`}
                  >
                    {reviewInfo.isDue ? (
                      <>
                        <CheckCircle2 className="w-2.5 h-2.5 text-emerald-600" />
                        <span>Due</span>
                      </>
                    ) : (
                      <>
                        <Timer className="w-2.5 h-2.5 text-stone-500" />
                        <span>{reviewInfo.formattedCountdown}</span>
                      </>
                    )}
                  </span>
                )}
              </h4>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {/* Ask AI Button */}
              <button
                onClick={() => setShowChatModal(true)}
                className="p-2 rounded-lg border border-indigo-200/80 bg-indigo-50/50 text-indigo-700 hover:text-indigo-950 hover:bg-indigo-100 hover:border-indigo-300 transition-all cursor-pointer shadow-3xs flex items-center gap-1"
                title="Ask AI about this word"
              >
                <MessageSquare className="w-3.5 h-3.5 text-indigo-600" />
              </button>

              {/* Audio Pronunciation Button */}
              <button
                onClick={() => onSpeakWord(word.word, word.id)}
                className={`p-2 rounded-lg border border-stone-200/80 bg-white text-stone-600 hover:text-stone-900 hover:border-stone-300 transition-all cursor-pointer shadow-3xs ${
                  speakingWordId === word.id ? "bg-amber-50 text-amber-900 border-amber-300 animate-pulse" : ""
                }`}
                title="Listen Pronunciation"
              >
                <Volume2 className="w-3.5 h-3.5" />
              </button>

              {/* Strength History Button */}
              <button
                onClick={() => setShowHistoryModal(true)}
                className="p-2 rounded-lg border border-amber-200/80 bg-amber-50/50 text-amber-800 hover:text-amber-950 hover:bg-amber-100 hover:border-amber-300 transition-all cursor-pointer shadow-3xs flex items-center gap-1"
                title="View word's strength history"
              >
                <History className="w-3.5 h-3.5 text-amber-600" />
              </button>
            </div>
          </div>

          {/* Pronunciation & Part of speech */}
          <div className="flex items-center gap-2 text-xs text-stone-500 font-mono">
            {word.pronunciation && (
              <span className="text-stone-400">/{word.pronunciation}/</span>
            )}
            {word.pronunciation && word.partOfSpeech && (
              <span className="text-stone-300">•</span>
            )}
            {word.partOfSpeech && (
              <span className="text-[10px] bg-stone-100 text-stone-600 font-bold px-2 py-0.5 rounded font-sans tracking-wide">
                {word.partOfSpeech}
              </span>
            )}
          </div>
        </div>

        {/* Definitions & Translations */}
        <div className="space-y-2.5 pt-2.5 border-t border-stone-100">
          <p className="text-stone-700 font-serif italic text-xs leading-relaxed">
            "{word.definition}"
          </p>
          
          {word.translation && (
            <div className="text-xs bg-stone-50/50 p-2 border border-stone-100 rounded-lg">
              <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wider block mb-0.5">Translation</span>
              <p className="font-semibold text-stone-800 text-xs">{word.translation}</p>
            </div>
          )}

          {word.example && (
            <div className="p-2.5 bg-stone-50 border border-stone-200/60 rounded-lg mt-2 text-[11px] text-stone-600 font-mono">
              <span className="text-[9px] font-bold text-stone-400 uppercase tracking-wider block mb-1">Context</span>
              <p className="leading-normal font-sans italic text-stone-700">"{word.example}"</p>
            </div>
          )}
        </div>

        {/* Card Footer Status & Memory Strength */}
        <div className="pt-3 border-t border-stone-100 flex items-center gap-2 text-[11px] mt-auto min-w-0">
          <span className={`shrink-0 font-semibold px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-full text-[10px] flex items-center gap-1.5 ${
            isMastered 
              ? "bg-emerald-50 text-emerald-800 border border-emerald-200/70" 
              : "bg-amber-50/80 text-amber-900 border border-amber-200/70"
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isMastered ? "bg-emerald-500" : "bg-amber-500"}`} />
            <span className="truncate">{isMastered ? "Mastered" : "Learning"}</span>
          </span>

          <MemoryStrengthBar
            strength={strengthLevel}
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
      </AnimatePresence>

      <AnimatePresence>
        {showChatModal && (
          <WordChatModal
            word={word}
            isOpen={showChatModal}
            onClose={() => setShowChatModal(false)}
            targetLanguage={targetLanguage}
            nativeLanguage={nativeLanguage}
            ttsConfig={ttsConfig}
            llmConfig={llmConfig}
            onAddWord={onAddWord ? (w) => onAddWord(w.word || "", w.definition || w.translation) : undefined}
            onUpdateWord={handleModalWordUpdate}
            words={words}
          />
        )}
      </AnimatePresence>
    </>
  );
}

export default React.memo(WordAnalyticsCard);
