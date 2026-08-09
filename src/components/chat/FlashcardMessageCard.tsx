import { useState } from "react";
import { Volume2, Sparkles, Lightbulb, Clock, TrendingUp, CheckCircle, RotateCcw } from "lucide-react";
import { FlashcardData, TTSConfig, LLMConfig, Word } from "../../types";
import { speakText, getLanguageCode } from "../../utils/ttsService";
import { recordStrengthHistory } from "../../utils/strengthHistoryHelpers";
import { saveAllWordsToDB } from "../../db/indexedDB";
import QuizImage from "../quiz/QuizImage";

interface FlashcardMessageCardProps {
  data: FlashcardData;
  targetLanguage: string;
  nativeLanguage: string;
  ttsConfig: TTSConfig;
  llmConfig: LLMConfig;
  provider?: string;
  model?: string;
  responseTimeMs?: number;
  words?: Word[];
  onUpdateWords?: (updatedWords: Word[]) => void;
  showToast?: (msg: string) => void;
}

export default function FlashcardMessageCard({
  data,
  targetLanguage,
  nativeLanguage,
  ttsConfig,
  llmConfig,
  provider,
  model,
  responseTimeMs,
  words,
  onUpdateWords,
  showToast
}: FlashcardMessageCardProps) {
  const [speakingText, setSpeakingText] = useState<string | null>(null);

  if (!data) return null;

  const targetWord = words?.find(
    (w) => (data.wordId && w.id === data.wordId) || w.word.trim().toLowerCase() === data.word.trim().toLowerCase()
  );

  const currentStrength = targetWord ? (targetWord.strength ?? 0) : (data.newStrength ?? 10);
  const prevStrength = data.previousStrength ?? Math.max(0, currentStrength - 10);
  const strengthGained = data.strengthGained ?? Math.max(0, currentStrength - prevStrength);

  const handlePracticeRecall = (delta: number) => {
    if (!targetWord || !onUpdateWords) return;

    const oldStrength = targetWord.strength ?? 0;
    const newStrength = Math.max(0, Math.min(100, oldStrength + delta));
    const actualDelta = newStrength - oldStrength;
    const note = actualDelta >= 0 
      ? `Flashcard Practice (+${actualDelta}%)`
      : `Flashcard Practice (${actualDelta}%)`;

    const updatedWord = recordStrengthHistory(targetWord, newStrength, 'flashcard_review', note);
    const updatedWords = (words || []).map((w) => (w.id === targetWord.id ? updatedWord : w));

    onUpdateWords(updatedWords);
    saveAllWordsToDB(updatedWords).catch((e) => console.error("Error saving updated strength:", e));

    if (showToast) {
      showToast(`Updated memory strength for "${targetWord.word}": ${newStrength}% (${actualDelta >= 0 ? '+' : ''}${actualDelta}%)`);
    }
  };

  const handleSpeak = (textToSpeak: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const langCode = getLanguageCode(targetLanguage);
    speakText(
      textToSpeak,
      ttsConfig,
      llmConfig,
      langCode,
      () => setSpeakingText(textToSpeak),
      () => setSpeakingText(null)
    );
  };

  return (
    <div className="bg-white border border-stone-200/90 rounded-2xl overflow-hidden my-2 max-w-full font-sans transition-all">
      {/* Top Header Banner */}
      <div className="bg-stone-900 text-white px-4 py-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-6 h-6 rounded-lg bg-amber-400 text-stone-950 flex items-center justify-center font-bold text-xs shrink-0 shadow-2xs">
            🃏
          </div>
          <span className="text-xs font-bold tracking-wide uppercase text-amber-300 truncate">
            AI Word Flash Card
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {data.category && (
            <span className="bg-stone-800 text-amber-200 border border-stone-700 text-[10px] font-semibold px-2.5 py-0.5 rounded-full">
              🏷️ {data.category}
            </span>
          )}
        </div>
      </div>

      {/* Main Flashcard Body */}
      <div className="p-3 sm:p-4 space-y-3.5">
        {/* Word Title & Pronunciation & Primary Speaker */}
        <div className="flex items-start justify-between gap-3 border-b border-stone-100 pb-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-2xl sm:text-3xl font-extrabold text-stone-900 tracking-tight">
                {data.word}
              </h3>
              {data.partOfSpeech && (
                <span className="px-2 py-0.5 text-xs font-bold uppercase tracking-wider bg-amber-100 text-amber-900 border border-amber-200 rounded-md">
                  {data.partOfSpeech}
                </span>
              )}
            </div>

            {data.pronunciation && (
              <p className="text-xs sm:text-sm font-mono font-semibold text-amber-700 mt-1">
                {data.pronunciation}
              </p>
            )}
          </div>

          {/* Primary Speaker Button */}
          <button
            type="button"
            onClick={(e) => handleSpeak(data.word, e)}
            className={`p-3 rounded-xl transition-all cursor-pointer shadow-2xs flex items-center justify-center shrink-0 ${
              speakingText === data.word
                ? "bg-amber-400 text-stone-950 scale-105 ring-2 ring-amber-400/50 animate-pulse"
                : "bg-stone-900 hover:bg-stone-800 text-white hover:scale-105"
            }`}
            title={`Listen to "${data.word}" pronunciation`}
          >
            <Volume2 className="w-5 h-5" />
          </button>
        </div>

        {/* Flashcard Strength Gain & Memory Gauge Banner */}
        <div className="bg-stone-900 text-white p-3.5 rounded-xl border border-stone-800 shadow-xs space-y-2.5">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-emerald-400 text-stone-950 flex items-center justify-center font-black text-xs shrink-0 shadow-2xs">
                <TrendingUp className="w-4.5 h-4.5 text-stone-950" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-stone-300">
                    Flashcard Memory Strength
                  </span>
                  <span className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-extrabold font-mono px-2 py-0.5 rounded-full flex items-center gap-1">
                    <span>+{strengthGained > 0 ? strengthGained : 10}% Gained</span>
                  </span>
                </div>
                <p className="text-xs text-stone-300 mt-0.5">
                  Current word strength: <span className="font-mono font-bold text-emerald-400">{Math.round(currentStrength)}%</span>
                </p>
              </div>
            </div>

            {/* Strength Gauge Bar */}
            <div className="w-full sm:w-36 bg-stone-800 rounded-full h-2 overflow-hidden border border-stone-700/60">
              <div
                className="bg-emerald-400 h-full rounded-full transition-all duration-500"
                style={{ width: `${Math.max(0, Math.min(100, currentStrength))}%` }}
              />
            </div>
          </div>

          {/* Interactive Recall Practice Rating Buttons */}
          {targetWord && onUpdateWords && (
            <div className="pt-2 border-t border-stone-800/80 flex items-center gap-2">
              <button
                type="button"
                onClick={() => handlePracticeRecall(10)}
                className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold py-1.5 px-3 rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1.5 shadow-2xs"
              >
                <CheckCircle className="w-3.5 h-3.5" />
                Got it! (+10% Strength)
              </button>
              <button
                type="button"
                onClick={() => handlePracticeRecall(-10)}
                className="flex-1 bg-stone-800 hover:bg-stone-700 text-stone-300 text-xs font-semibold py-1.5 px-3 rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1.5"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Needs Practice (-10%)
              </button>
            </div>
          )}
        </div>

        {/* Translation & Target Language Definition */}
        <div className="space-y-2 bg-stone-50/80 p-3.5 rounded-xl border border-stone-100">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-stone-400 block mb-0.5">
              Native Translation ({nativeLanguage}):
            </span>
            <p className="text-base sm:text-lg font-bold text-stone-900">
              "{data.translation}"
            </p>
          </div>

          <div className="pt-1 border-t border-stone-200/60">
            <span className="text-[10px] font-bold uppercase tracking-wider text-stone-400 block mb-0.5">
              Definition ({targetLanguage}):
            </span>
            <p className="text-xs sm:text-sm text-stone-700 font-medium leading-relaxed">
              {data.definition}
            </p>
          </div>
        </div>

        {/* Visual Concept Image (if present) */}
        {(data.imageUrl || data.imageKeyword) && (
          <div className="rounded-xl overflow-hidden border border-stone-200/80 shadow-2xs bg-stone-50">
            {data.imageUrl && (data.imageUrl.startsWith("http") || data.imageUrl.startsWith("data:") || data.imageUrl.startsWith("blob:")) ? (
              <img
                src={data.imageUrl}
                alt={data.word}
                className="w-full h-48 sm:h-56 object-cover rounded-xl"
              />
            ) : (
              <QuizImage imageKeyword={data.imageKeyword || data.word} word={data.word} alt={data.word} />
            )}
          </div>
        )}

        {/* Extra Contextual Example Sentences */}
        {data.extraExampleSentences && data.extraExampleSentences.length > 0 && (
          <div className="space-y-2.5 pt-1">
            <div className="flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-amber-500" />
              <h4 className="text-xs font-bold text-stone-900 uppercase tracking-wider">
                Contextual Example Sentences ({data.category || "Contextual"}):
              </h4>
            </div>

            <div className="space-y-2">
              {data.extraExampleSentences.map((item, idx) => (
                <div
                  key={idx}
                  className="bg-white border border-stone-200/80 hover:border-amber-300 rounded-xl p-3 space-y-1.5 transition-all shadow-2xs group"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs sm:text-sm font-semibold text-stone-900 leading-snug flex-1">
                      {item.sentence}
                    </p>
                    <button
                      type="button"
                      onClick={(e) => handleSpeak(item.sentence, e)}
                      className={`p-1.5 rounded-lg transition-colors cursor-pointer shrink-0 ${
                        speakingText === item.sentence
                          ? "bg-amber-400 text-stone-950"
                          : "bg-stone-100 hover:bg-stone-200 text-stone-700"
                      }`}
                      title="Listen to example sentence"
                    >
                      <Volume2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {item.contextCategoryNote && (
                    <span className="inline-block bg-amber-50 text-amber-900 border border-amber-200/70 text-[10px] font-bold px-2 py-0.5 rounded-md">
                      📌 {item.contextCategoryNote}
                    </span>
                  )}

                  <p className="text-xs text-stone-600 font-medium italic">
                    "{item.translation}"
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Nuance & Usage Notes Box */}
        {data.usageNotes && (
          <div className="bg-amber-50/70 border border-amber-200/80 rounded-xl p-3 flex items-start gap-2.5">
            <Lightbulb className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-900 block">
                Nuance & Usage Tip:
              </span>
              <p className="text-xs text-stone-800 leading-relaxed font-medium">
                {data.usageNotes}
              </p>
            </div>
          </div>
        )}

        {/* Suggested Vocabulary from Examples */}
        {data.suggestedVocabulary && data.suggestedVocabulary.length > 0 && (
          <div className="space-y-2.5 pt-1">
            <div className="flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-amber-500" />
              <h4 className="text-xs font-bold text-stone-900 uppercase tracking-wider">
                Suggested Vocabulary from Examples:
              </h4>
            </div>

            <div className="grid grid-cols-1 gap-2">
              {data.suggestedVocabulary.map((item, idx) => (
                <div
                  key={idx}
                  className="bg-stone-50 border border-stone-200/80 hover:border-amber-300 rounded-xl p-3 space-y-1 transition-all shadow-2xs group"
                >
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-stone-900 text-sm">
                        {item.word}
                      </span>
                      {item.partOfSpeech && (
                        <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-stone-200 text-stone-800 rounded">
                          {item.partOfSpeech}
                        </span>
                      )}
                      <span className="text-xs text-stone-500 font-semibold">
                        — {item.translation}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => handleSpeak(item.word, e)}
                      className={`p-1 rounded transition-colors cursor-pointer shrink-0 ${
                        speakingText === item.word
                          ? "bg-amber-400 text-stone-950"
                          : "bg-stone-100 hover:bg-stone-200 text-stone-600"
                      }`}
                      title="Listen to word"
                    >
                      <Volume2 className="w-3 h-3" />
                    </button>
                  </div>
                  {item.definition && (
                    <p className="text-xs text-stone-600 leading-normal font-medium">
                      {item.definition}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* AI Response Metadata (Provider, Model, Response Time) */}
        {(provider || model || responseTimeMs !== undefined) && (
          <div className="mt-3 pt-2 border-t border-stone-100 flex items-center justify-between text-[11px] text-stone-400 font-medium select-none">
            <div className="flex items-center gap-1.5 flex-wrap">
              {provider && (
                <span className="capitalize font-semibold text-stone-600 bg-stone-100 px-1.5 py-0.5 rounded text-[10.5px]">
                  {provider}
                </span>
              )}
              {model && (
                <span className="font-mono text-[10.5px] text-stone-500">
                  {model}
                </span>
              )}
            </div>
            {responseTimeMs !== undefined && (
              <div className="flex items-center gap-1 text-stone-400 shrink-0 text-[11px] font-mono" title="AI Response Time">
                <Clock className="w-3 h-3 text-stone-400" />
                <span>{(responseTimeMs / 1000).toFixed(2)}s</span>
              </div>
            )}
          </div>
        )}

        {/* Action Controls Footer */}
        <div className="flex items-center gap-2 pt-2 border-t border-stone-100 flex-wrap">
          <button
            type="button"
            onClick={(e) => handleSpeak(data.word, e)}
            className="flex-1 bg-stone-100 hover:bg-stone-200 text-stone-900 font-bold text-xs py-2 px-3 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5"
          >
            <Volume2 className="w-3.5 h-3.5" /> Speak Word
          </button>
        </div>
      </div>
    </div>
  );
}
