import { useState } from "react";
import { 
  Languages, 
  Sparkles, 
  CheckCircle2, 
  AlertCircle, 
  Plus, 
  Check, 
  Lightbulb, 
  Brain,
  ChevronDown,
  ChevronUp,
  Volume2,
  Square
} from "lucide-react";
import { ChallengeData, ChallengeEvaluation, Word, ChallengeSuggestedVocab, TTSConfig, LLMConfig } from "../../types";
import { isWordInCollection } from "../../utils/wordNormalization";
import { speakText, stopSpeech, buildEssentialChallengeAudioText } from "../../utils/ttsService";
import LlmResponseMetadata from "./LlmResponseMetadata";
import TranslationChallengeAskAiModal from "./TranslationChallengeAskAiModal";

interface TranslationChallengeCardProps {
  challenge?: ChallengeData;
  evaluation?: ChallengeEvaluation;
  appLanguage?: string;
  targetLanguage?: string;
  nativeLanguage?: string;
  ttsConfig?: TTSConfig;
  llmConfig?: LLMConfig;
  provider?: string;
  model?: string;
  responseTimeMs?: number;
  words?: Word[];
  onAddWord?: (wordText?: string, hint?: string, extraData?: Partial<Word>) => void;
  onAddIncompleteWord?: (wordData: Partial<Word>) => void;
  onAddMultipleWords?: (words: any[]) => void;
  showToast?: (msg: string) => void;
}

export default function TranslationChallengeCard({
  challenge,
  evaluation,
  appLanguage: _appLanguage,
  targetLanguage = "English",
  nativeLanguage: _nativeLanguage,
  ttsConfig,
  llmConfig,
  provider,
  model,
  responseTimeMs,
  words = [],
  onAddWord,
  onAddIncompleteWord,
  onAddMultipleWords,
  showToast,
}: TranslationChallengeCardProps) {
  const [showVocabHints, setShowVocabHints] = useState(false);
  const [addedWordKeys, setAddedWordKeys] = useState<Record<string, boolean>>({});
  const [isPlayingEssentialAudio, setIsPlayingEssentialAudio] = useState(false);
  const [playingItemKey, setPlayingItemKey] = useState<string | null>(null);
  const [isAskAiModalOpen, setIsAskAiModalOpen] = useState(false);

  const activeProvider = provider || challenge?.provider || evaluation?.provider;
  const activeModel = model || challenge?.model || evaluation?.model;
  const activeResponseTimeMs = responseTimeMs ?? challenge?.responseTimeMs ?? evaluation?.responseTimeMs;

  const handlePlayEssentialAudio = () => {
    if (!evaluation) return;

    if (isPlayingEssentialAudio) {
      stopSpeech();
      setIsPlayingEssentialAudio(false);
      return;
    }

    stopSpeech();
    setPlayingItemKey(null);

    const targetWordText = evaluation.targetWordUsed || challenge?.targetWordFromCollection?.word;
    const audioText = buildEssentialChallengeAudioText(
      evaluation.score,
      evaluation.scoreLabel,
      evaluation.correctedSentence,
      targetWordText
    );

    speakText(
      audioText,
      ttsConfig,
      llmConfig,
      targetLanguage || "English",
      () => setIsPlayingEssentialAudio(true),
      () => setIsPlayingEssentialAudio(false)
    ).catch(() => setIsPlayingEssentialAudio(false));
  };

  const handlePlayText = (text: string, customLang?: string, itemKey?: string) => {
    if (!text?.trim()) return;

    if (playingItemKey === itemKey && itemKey) {
      stopSpeech();
      setPlayingItemKey(null);
      return;
    }

    stopSpeech();
    setIsPlayingEssentialAudio(false);

    if (itemKey) setPlayingItemKey(itemKey);

    speakText(
      text,
      ttsConfig,
      llmConfig,
      customLang || targetLanguage || "English",
      () => {
        if (itemKey) setPlayingItemKey(itemKey);
      },
      () => {
        if (itemKey) setPlayingItemKey((current) => (current === itemKey ? null : current));
      }
    ).catch(() => {
      if (itemKey) setPlayingItemKey((current) => (current === itemKey ? null : current));
    });
  };

  const handleAddSingleWord = (
    item:
      | ChallengeSuggestedVocab
      | { word: string; translation: string; hint?: string; partOfSpeech?: string; definition?: string }
  ) => {
    const wordKey = item.word.toLowerCase();
    if (addedWordKeys[wordKey] || isWordInCollection(words, item.word)) return;

    if (onAddIncompleteWord) {
      onAddIncompleteWord({
        word: item.word.trim(),
        translation: item.translation || "",
        definition: (item as any).definition || item.translation || `Key term from translation challenge`,
        partOfSpeech: item.partOfSpeech || "expression",
        category: "Challenge Practice",
        completed: false,
        context: challenge?.nativeSentence
          ? `From challenge: "${challenge.nativeSentence}"`
          : evaluation?.correctedSentence
          ? `From challenge: "${evaluation.correctedSentence}"`
          : undefined,
      });
      setAddedWordKeys((prev) => ({ ...prev, [wordKey]: true }));
    } else if (onAddWord) {
      onAddWord(item.word, (item as any).hint || item.translation, {
        translation: item.translation,
        definition: (item as any).definition || `Key term from translation challenge`,
        partOfSpeech: item.partOfSpeech || "expression",
        category: "Challenge Practice",
      });
      setAddedWordKeys((prev) => ({ ...prev, [wordKey]: true }));
      showToast?.(`Added "${item.word}" to your collection!`);
    }
  };

  const handleAddAllVocab = (vocabList: ChallengeSuggestedVocab[]) => {
    const itemsToAdd = vocabList.filter(
      (v) => !addedWordKeys[v.word.toLowerCase()] && !isWordInCollection(words, v.word)
    );
    if (itemsToAdd.length === 0) return;

    if (onAddIncompleteWord) {
      itemsToAdd.forEach((v) => {
        onAddIncompleteWord({
          word: v.word.trim(),
          translation: v.translation || "",
          definition: v.definition || v.translation || `Key term from translation challenge`,
          partOfSpeech: v.partOfSpeech || "expression",
          category: "Challenge Practice",
          completed: false,
          context: evaluation?.correctedSentence
            ? `From challenge: "${evaluation.correctedSentence}"`
            : undefined,
        });
      });
      const newKeys = { ...addedWordKeys };
      itemsToAdd.forEach((v) => {
        newKeys[v.word.toLowerCase()] = true;
      });
      setAddedWordKeys(newKeys);
      return;
    }

    if (onAddMultipleWords) {
      const formattedWords = itemsToAdd.map((v) => ({
        word: v.word,
        translation: v.translation,
        definition: v.definition || `Key term from translation challenge`,
        partOfSpeech: v.partOfSpeech || "expression",
        category: "Challenge Practice",
        learned: false,
        starred: false,
        completed: false,
        createdAt: new Date().toISOString(),
        lastReviewed: null,
        strength: 0,
      }));

      onAddMultipleWords(formattedWords);

      const newKeys = { ...addedWordKeys };
      itemsToAdd.forEach((v) => {
        newKeys[v.word.toLowerCase()] = true;
      });
      setAddedWordKeys(newKeys);
      showToast?.(`Added ${itemsToAdd.length} words to your collection!`);
    }
  };

  // 1. RENDER CHALLENGE PROMPT CARD (Clean & simplified, no target word revealed)
  if (challenge && !evaluation) {
    return (
      <div id="challenge-prompt-card" className="w-full p-4 sm:p-5 bg-white border border-stone-200/90 rounded-2xl shadow-xs space-y-4">
        {/* Header Badge & Topic Context */}
        <div className="flex items-center justify-between gap-2 flex-wrap pb-1 border-b border-stone-100">
          <div className="flex items-center gap-2">
            <span className="p-1.5 bg-stone-900 text-amber-400 rounded-lg shadow-2xs">
              <Languages className="w-4 h-4" />
            </span>
            <span className="font-bold text-xs sm:text-sm text-stone-900 tracking-tight">
              Translation Challenge
            </span>
          </div>
          {challenge.topicContext && (
            <span className="px-2.5 py-0.5 bg-stone-100 text-stone-700 border border-stone-200 rounded-full text-[11px] font-medium">
              {challenge.topicContext}
            </span>
          )}
        </div>

        {/* Challenge Prompt Sentence */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider font-mono">
              Translate into {challenge.targetLanguage || "English"}:
            </span>
            <button
              id="btn-play-prompt-sentence"
              type="button"
              onClick={() => handlePlayText(challenge.nativeSentence, challenge.nativeLanguage || "Vietnamese", "prompt-sentence")}
              className="p-1 text-stone-400 hover:text-stone-700 hover:bg-stone-100 rounded-lg transition-colors cursor-pointer"
              title="Listen sentence"
            >
              {playingItemKey === "prompt-sentence" ? (
                <Square className="w-3.5 h-3.5 text-amber-600 fill-amber-600 animate-pulse" />
              ) : (
                <Volume2 className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
          <p className="text-base sm:text-lg font-semibold text-stone-900 leading-relaxed font-sans">
            "{challenge.nativeSentence}"
          </p>
        </div>

        {/* Optional Context & Hints */}
        <div className="pt-1 flex items-center justify-between gap-2 flex-wrap text-xs text-stone-600">
          {challenge.personalityNote ? (
            <div className="flex items-center gap-1.5 text-stone-500 text-xs">
              <Sparkles className="w-3.5 h-3.5 text-amber-500 shrink-0" />
              <span className="line-clamp-2">{challenge.personalityNote}</span>
            </div>
          ) : <div />}

          {challenge.keyTargetWords && challenge.keyTargetWords.length > 0 && (
            <button
              id="btn-toggle-vocab-hints"
              type="button"
              onClick={() => setShowVocabHints(!showVocabHints)}
              className="text-[11px] font-medium text-stone-600 hover:text-stone-900 flex items-center gap-1 transition-colors cursor-pointer ml-auto py-1 px-2 rounded-md hover:bg-stone-100"
            >
              <Lightbulb className="w-3.5 h-3.5 text-amber-500" />
              <span>{showVocabHints ? "Hide Hints" : "Vocab Hints"}</span>
              {showVocabHints ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
          )}
        </div>

        {/* Collapsible Key Target Words Hints */}
        {showVocabHints && challenge.keyTargetWords && (
          <div className="p-3 bg-stone-50 border border-stone-200/80 rounded-xl space-y-2 text-xs">
            <span className="font-semibold text-stone-700 block text-[11px] uppercase tracking-wider font-mono">
              Vocab Clues:
            </span>
            <div className="flex flex-wrap gap-2">
              {challenge.keyTargetWords.map((kw, i) => {
                const inCol = isWordInCollection(words, kw.word) || addedWordKeys[kw.word.toLowerCase()];
                const isPlayingKw = playingItemKey === `kw-${i}`;
                return (
                  <div
                    key={i}
                    onClick={() => {
                      if (!inCol) handleAddSingleWord(kw);
                    }}
                    title={inCol ? "Saved in collection" : "Click to add to collection"}
                    className={`px-2.5 py-1 rounded-lg flex items-center gap-2 border transition-all ${
                      inCol
                        ? "bg-emerald-50 border-emerald-200 text-emerald-800 cursor-default"
                        : "bg-white hover:bg-stone-100 border-stone-200 hover:border-stone-300 cursor-pointer active:scale-95"
                    }`}
                  >
                    <button
                      id={`btn-play-clue-${i}`}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handlePlayText(kw.word, challenge.targetLanguage || "English", `kw-${i}`);
                      }}
                      className="text-stone-400 hover:text-stone-800 p-0.5 rounded cursor-pointer transition-colors"
                      title={`Listen "${kw.word}"`}
                    >
                      {isPlayingKw ? (
                        <Square className="w-3 h-3 text-amber-600 fill-amber-600 animate-pulse" />
                      ) : (
                        <Volume2 className="w-3 h-3" />
                      )}
                    </button>
                    <span className="font-medium text-stone-800">{kw.word}</span>
                    <span className="text-stone-500">({kw.translation})</span>
                    {(onAddIncompleteWord || onAddWord) && (
                      <button
                        id={`btn-add-clue-${i}`}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAddSingleWord(kw);
                        }}
                        disabled={inCol}
                        className="ml-1 text-stone-500 hover:text-stone-800 disabled:text-emerald-700 transition-colors cursor-pointer"
                        title={inCol ? "Saved" : "Add to collection"}
                      >
                        {inCol ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Plus className="w-3.5 h-3.5" />}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Ask AI Support Button */}
        <div className="pt-1">
          <button
            id="btn-ask-ai-challenge-prompt"
            type="button"
            onClick={() => setIsAskAiModalOpen(true)}
            className="w-full sm:w-auto px-4 py-2 bg-indigo-600 hover:bg-indigo-700 active:scale-98 text-white font-bold text-xs sm:text-sm rounded-xl transition-all cursor-pointer shadow-3xs flex items-center justify-center gap-2"
          >
            <Sparkles className="w-4 h-4" />
            <span>Ask AI about this question</span>
          </button>
        </div>

        {/* AI Response Metadata */}
        <LlmResponseMetadata
          provider={activeProvider}
          model={activeModel}
          responseTimeMs={activeResponseTimeMs}
        />

        {/* Translation Challenge Ask AI Support Modal */}
        <TranslationChallengeAskAiModal
          isOpen={isAskAiModalOpen}
          onClose={() => setIsAskAiModalOpen(false)}
          challenge={challenge}
          evaluation={evaluation}
          nativeLanguage={_nativeLanguage}
          targetLanguage={targetLanguage}
          appLanguage={_appLanguage}
          ttsConfig={ttsConfig}
          llmConfig={llmConfig}
          onAddIncompleteWord={onAddIncompleteWord}
          onAddWord={onAddWord}
          showToast={showToast}
        />
      </div>
    );
  }

  // 2. RENDER EVALUATION RESULT CARD
  if (evaluation) {
    const isHighScore = evaluation.score >= 85;
    const scoreColorClass = isHighScore 
      ? "bg-emerald-500 text-white border-emerald-600" 
      : evaluation.score >= 70 
      ? "bg-amber-500 text-white border-amber-600" 
      : "bg-orange-500 text-white border-orange-600";

    const allVocabAdded = evaluation.suggestedVocabulary?.every(
      (v) => addedWordKeys[v.word.toLowerCase()] || isWordInCollection(words, v.word)
    );

    const targetWordText = evaluation.targetWordUsed || challenge?.targetWordFromCollection?.word;

    return (
      <div id="challenge-evaluation-card" className="w-full p-4 sm:p-5 bg-white border border-stone-200/90 rounded-2xl shadow-xs space-y-3.5">
        {/* Top Header & Score Banner */}
        <div className="flex items-center justify-between gap-3 pb-2 border-b border-stone-100 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="p-1.5 bg-stone-900 text-amber-400 rounded-lg">
              <Sparkles className="w-4 h-4" />
            </span>
            <div>
              <h4 className="font-bold text-sm sm:text-base text-stone-900 leading-tight">
                Challenge Feedback
              </h4>
              <p className="text-xs text-stone-500">{evaluation.scoreLabel}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Essential Audio Feedback Playback Button (Score + Ideal Translation + Target Word) */}
            <button
              id="btn-play-essential-challenge-feedback"
              type="button"
              onClick={handlePlayEssentialAudio}
              className={`px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer shadow-3xs hover:scale-102 active:scale-98 ${
                isPlayingEssentialAudio
                  ? "bg-amber-500 text-white border-amber-600 animate-pulse"
                  : "bg-stone-50 hover:bg-stone-100 text-stone-700 border-stone-200"
              }`}
              title="Play essential feedback (Score, Ideal translation, and Target word)"
            >
              {isPlayingEssentialAudio ? (
                <>
                  <Square className="w-3.5 h-3.5 fill-current" />
                  <span>Stop Audio</span>
                </>
              ) : (
                <>
                  <Volume2 className="w-3.5 h-3.5 text-amber-600" />
                  <span>Listen Feedback</span>
                </>
              )}
            </button>

            {/* Score Badge */}
            <div className={`px-3 py-1 rounded-xl border text-xs sm:text-sm font-black flex items-center gap-1.5 shadow-2xs ${scoreColorClass}`}>
              <span>{evaluation.score}</span>
              <span className="text-[10px] opacity-80">/100</span>
            </div>
          </div>
        </div>

        {/* Translation Comparison Block */}
        {(() => {
          const userSub = evaluation.userTranslation?.trim();
          const isPlayingIdeal = playingItemKey === "ideal-sentence";

          return (
            <div className={`grid grid-cols-1 ${userSub ? "md:grid-cols-2" : ""} gap-3`}>
              {userSub && (
                <div className="p-3 bg-stone-50 border border-stone-200/70 rounded-xl space-y-1">
                  <span className="text-[10px] font-bold text-stone-500 uppercase tracking-wider font-mono block">
                    Your Submission
                  </span>
                  <p className="text-xs sm:text-sm font-medium text-stone-800 break-words">
                    "{userSub}"
                  </p>
                </div>
              )}

              <div className="p-3 bg-emerald-50/80 border border-emerald-200/80 rounded-xl space-y-1 relative group">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider font-mono block">
                    Ideal Target Translation
                  </span>
                  <button
                    id="btn-play-ideal-translation"
                    type="button"
                    onClick={() => handlePlayText(evaluation.correctedSentence, targetLanguage || "English", "ideal-sentence")}
                    className="p-1 rounded-md text-emerald-700 hover:text-emerald-950 hover:bg-emerald-100/70 transition-colors cursor-pointer"
                    title="Listen to ideal translation"
                  >
                    {isPlayingIdeal ? (
                      <Square className="w-3.5 h-3.5 fill-emerald-800 text-emerald-800 animate-pulse" />
                    ) : (
                      <Volume2 className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
                <p className="text-xs sm:text-sm font-bold text-emerald-950 break-words">
                  "{evaluation.correctedSentence}"
                </p>
              </div>
            </div>
          );
        })()}

        {/* Target Word Incorporation Celebration Banner */}
        {evaluation.incorporatedTargetWord && evaluation.targetWordUsed && (
          <div className="p-3.5 bg-gradient-to-r from-emerald-500/10 via-emerald-500/5 to-teal-50/50 border border-emerald-300 rounded-xl shadow-2xs space-y-1.5">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="p-1.5 bg-emerald-600 text-white rounded-lg shadow-2xs">
                  <Sparkles className="w-4 h-4" />
                </span>
                <span className="font-bold text-xs sm:text-sm text-emerald-950">
                  Target Word Successfully Incorporated!
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  id="btn-play-target-word-incorporated"
                  type="button"
                  onClick={() => handlePlayText(evaluation.targetWordUsed!, targetLanguage || "English", "target-word-inc")}
                  className="p-1 rounded-md text-emerald-800 hover:text-emerald-950 hover:bg-emerald-100 transition-colors cursor-pointer"
                  title={`Pronounce "${evaluation.targetWordUsed}"`}
                >
                  {playingItemKey === "target-word-inc" ? (
                    <Square className="w-3.5 h-3.5 fill-emerald-800 text-emerald-800 animate-pulse" />
                  ) : (
                    <Volume2 className="w-3.5 h-3.5" />
                  )}
                </button>
                <span className="px-2.5 py-0.5 bg-emerald-600 text-white text-[11px] font-black rounded-full shadow-2xs">
                  +30 Strength Points
                </span>
              </div>
            </div>
            <p className="text-xs text-emerald-900 leading-relaxed">
              You incorporated <strong className="font-bold font-mono">"{evaluation.targetWordUsed}"</strong> from your collection in your translation.
              {typeof evaluation.targetWordPrevStrength === "number" && typeof evaluation.targetWordNewStrength === "number" && (
                <span className="block text-[11px] font-medium text-emerald-800 mt-0.5">
                  Memory strength augmented: {evaluation.targetWordPrevStrength}% → <strong className="font-bold text-emerald-950">{evaluation.targetWordNewStrength}%</strong>
                </span>
              )}
            </p>
          </div>
        )}

        {/* Target Word Feedback Banner (When NOT Incorporated) */}
        {!evaluation.incorporatedTargetWord && targetWordText && (
          <div className="p-3.5 bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-orange-50/50 border border-amber-300 rounded-xl shadow-2xs space-y-1.5">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="p-1.5 bg-amber-600 text-white rounded-lg shadow-2xs">
                  <Lightbulb className="w-4 h-4" />
                </span>
                <span className="font-bold text-xs sm:text-sm text-amber-950">
                  Featured Target Word: "{targetWordText}"
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  id="btn-play-target-word-featured"
                  type="button"
                  onClick={() => handlePlayText(targetWordText, targetLanguage || "English", "target-word-feat")}
                  className="p-1 rounded-md text-amber-800 hover:text-amber-950 hover:bg-amber-100 transition-colors cursor-pointer"
                  title={`Pronounce "${targetWordText}"`}
                >
                  {playingItemKey === "target-word-feat" ? (
                    <Square className="w-3.5 h-3.5 fill-amber-800 text-amber-800 animate-pulse" />
                  ) : (
                    <Volume2 className="w-3.5 h-3.5" />
                  )}
                </button>
                <span className="px-2.5 py-0.5 bg-amber-600 text-white text-[11px] font-black rounded-full shadow-2xs">
                  +10 Points • Marked Learned
                </span>
              </div>
            </div>
            <p className="text-xs text-amber-900 leading-relaxed">
              The featured word from your collection was <strong className="font-bold font-mono">"{targetWordText}"</strong>
              {(challenge?.targetWordFromCollection?.translation || challenge?.targetWordFromCollection?.definition) && (
                <span> ({challenge.targetWordFromCollection.translation || challenge.targetWordFromCollection.definition})</span>
              )}. Even though it was not included in your answer, it has been marked as learned (+10 strength points) to rotate your study queue and prevent repetition in subsequent challenges.
              {typeof evaluation.targetWordPrevStrength === "number" && typeof evaluation.targetWordNewStrength === "number" && (
                <span className="block text-[11px] font-medium text-amber-800 mt-0.5">
                  Memory strength updated: {evaluation.targetWordPrevStrength}% → <strong className="font-bold text-amber-950">{evaluation.targetWordNewStrength}%</strong>
                </span>
              )}
            </p>
          </div>
        )}

        {/* Insights Section */}
        <div className="space-y-2 text-xs">
          {evaluation.whatWentWell && (
            <div className="p-3 bg-emerald-50/50 border border-emerald-100 rounded-xl flex items-start gap-2 text-emerald-950">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <strong className="font-bold block text-emerald-900">What Went Well:</strong>
                <span>{evaluation.whatWentWell}</span>
              </div>
            </div>
          )}

          {evaluation.areasForImprovement && (
            <div className="p-3 bg-amber-50/50 border border-amber-100 rounded-xl flex items-start gap-2 text-amber-950">
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <strong className="font-bold block text-amber-900">Areas for Improvement:</strong>
                <span>{evaluation.areasForImprovement}</span>
              </div>
            </div>
          )}
        </div>

        {/* Mined Suggested Vocabulary Grid */}
        {evaluation.suggestedVocabulary && evaluation.suggestedVocabulary.length > 0 && (
          <div className="pt-2 space-y-2.5 border-t border-stone-100">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-stone-800 flex items-center gap-1.5">
                <Brain className="w-3.5 h-3.5 text-amber-600" />
                <span>Featured Challenge Vocabulary</span>
              </span>
              {(onAddIncompleteWord || onAddMultipleWords) && !allVocabAdded && (
                <button
                  id="btn-add-all-challenge-vocab"
                  type="button"
                  onClick={() => handleAddAllVocab(evaluation.suggestedVocabulary!)}
                  className="px-2.5 py-1 bg-amber-500 hover:bg-amber-600 active:scale-95 text-white text-[11px] font-bold rounded-lg transition-all cursor-pointer flex items-center gap-1 shadow-2xs"
                >
                  <Plus className="w-3 h-3" />
                  <span>Add All ({evaluation.suggestedVocabulary.length})</span>
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {evaluation.suggestedVocabulary.map((v, idx) => {
                const inCol = isWordInCollection(words, v.word) || addedWordKeys[v.word.toLowerCase()];
                const isPlayingVocab = playingItemKey === `vocab-${idx}`;
                return (
                  <div
                    key={idx}
                    onClick={() => {
                      if (!inCol) handleAddSingleWord(v);
                    }}
                    title={inCol ? "Saved in collection" : "Click to temporarily add to collection as incomplete word"}
                    className={`p-2.5 border rounded-xl flex items-center justify-between gap-2 transition-all ${
                      inCol
                        ? "bg-stone-50/90 border-stone-200/80 cursor-default"
                        : "bg-stone-50 hover:bg-amber-50/70 border-stone-200/80 hover:border-amber-300 cursor-pointer active:scale-[0.99]"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <button
                          id={`btn-play-vocab-${idx}`}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handlePlayText(v.word, targetLanguage || "English", `vocab-${idx}`);
                          }}
                          className="text-stone-400 hover:text-stone-800 p-0.5 rounded cursor-pointer transition-colors"
                          title={`Pronounce "${v.word}"`}
                        >
                          {isPlayingVocab ? (
                            <Square className="w-3 h-3 text-amber-600 fill-amber-600 animate-pulse" />
                          ) : (
                            <Volume2 className="w-3 h-3" />
                          )}
                        </button>
                        <span className="font-bold text-xs text-stone-900 truncate">{v.word}</span>
                        {v.partOfSpeech && (
                          <span className="text-[10px] text-stone-400 font-mono">({v.partOfSpeech})</span>
                        )}
                      </div>
                      <p className="text-[11px] text-stone-600 truncate">{v.translation}</p>
                    </div>

                    {(onAddIncompleteWord || onAddWord) && (
                      <button
                        id={`btn-add-vocab-${idx}`}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAddSingleWord(v);
                        }}
                        disabled={inCol}
                        className={`px-2 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1 transition-all cursor-pointer shrink-0 ${
                          inCol
                            ? "bg-emerald-100 text-emerald-800 opacity-80 cursor-default"
                            : "bg-stone-900 hover:bg-stone-800 text-amber-400 shadow-2xs active:scale-95"
                        }`}
                      >
                        {inCol ? (
                          <>
                            <Check className="w-3 h-3 text-emerald-700" />
                            <span>Saved</span>
                          </>
                        ) : (
                          <>
                            <Plus className="w-3 h-3" />
                            <span>Add</span>
                          </>
                        )}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Ask AI Support Button */}
        <div className="pt-1">
          <button
            id="btn-ask-ai-challenge-eval"
            type="button"
            onClick={() => setIsAskAiModalOpen(true)}
            className="w-full sm:w-auto px-4 py-2 bg-indigo-600 hover:bg-indigo-700 active:scale-98 text-white font-bold text-xs sm:text-sm rounded-xl transition-all cursor-pointer shadow-3xs flex items-center justify-center gap-2"
          >
            <Sparkles className="w-4 h-4" />
            <span>Ask AI about this question</span>
          </button>
        </div>

        {/* AI Response Metadata (Provider, Model, Response Time) */}
        <LlmResponseMetadata
          provider={activeProvider}
          model={activeModel}
          responseTimeMs={activeResponseTimeMs}
        />

        {/* Translation Challenge Ask AI Support Modal */}
        <TranslationChallengeAskAiModal
          isOpen={isAskAiModalOpen}
          onClose={() => setIsAskAiModalOpen(false)}
          challenge={challenge}
          evaluation={evaluation}
          nativeLanguage={_nativeLanguage}
          targetLanguage={targetLanguage}
          appLanguage={_appLanguage}
          ttsConfig={ttsConfig}
          llmConfig={llmConfig}
          onAddIncompleteWord={onAddIncompleteWord}
          onAddWord={onAddWord}
          showToast={showToast}
        />
      </div>
    );
  }

  return null;
}
