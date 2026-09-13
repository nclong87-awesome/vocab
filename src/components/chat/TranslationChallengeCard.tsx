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
  ChevronUp
} from "lucide-react";
import { ChallengeData, ChallengeEvaluation, Word, ChallengeSuggestedVocab } from "../../types";
import { isWordInCollection } from "../../utils/wordNormalization";
import LlmResponseMetadata from "./LlmResponseMetadata";

interface TranslationChallengeCardProps {
  challenge?: ChallengeData;
  evaluation?: ChallengeEvaluation;
  appLanguage?: string;
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

  const activeProvider = provider || challenge?.provider || evaluation?.provider;
  const activeModel = model || challenge?.model || evaluation?.model;
  const activeResponseTimeMs = responseTimeMs ?? challenge?.responseTimeMs ?? evaluation?.responseTimeMs;

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
      <div className="w-full p-4 sm:p-5 bg-white border border-stone-200/90 rounded-2xl shadow-xs space-y-4">
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
          <span className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider font-mono">
            Translate into {challenge.targetLanguage || "English"}:
          </span>
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
                    <span className="font-medium text-stone-800">{kw.word}</span>
                    <span className="text-stone-500">({kw.translation})</span>
                    {(onAddIncompleteWord || onAddWord) && (
                      <button
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

        {/* AI Response Metadata */}
        <LlmResponseMetadata
          provider={activeProvider}
          model={activeModel}
          responseTimeMs={activeResponseTimeMs}
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

    return (
      <div className="w-full p-4 sm:p-5 bg-white border border-stone-200/90 rounded-2xl shadow-xs space-y-3.5">
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
          <div className={`px-3 py-1 rounded-xl border text-xs sm:text-sm font-black flex items-center gap-1.5 shadow-2xs ${scoreColorClass}`}>
            <span>{evaluation.score}</span>
            <span className="text-[10px] opacity-80">/100</span>
          </div>
        </div>

        {/* Translation Comparison Block */}
        {(() => {
          const userSub = evaluation.userTranslation?.trim();
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

              <div className="p-3 bg-emerald-50/80 border border-emerald-200/80 rounded-xl space-y-1">
                <span className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider font-mono block">
                  Ideal Target Translation
                </span>
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
              <span className="px-2.5 py-0.5 bg-emerald-600 text-white text-[11px] font-black rounded-full shadow-2xs">
                +30 Strength Points
              </span>
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
                  type="button"
                  onClick={() => handleAddAllVocab(evaluation.suggestedVocabulary)}
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
                        <span className="font-bold text-xs text-stone-900 truncate">{v.word}</span>
                        {v.partOfSpeech && (
                          <span className="text-[10px] text-stone-400 font-mono">({v.partOfSpeech})</span>
                        )}
                      </div>
                      <p className="text-[11px] text-stone-600 truncate">{v.translation}</p>
                    </div>

                    {(onAddIncompleteWord || onAddWord) && (
                      <button
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

        {/* AI Response Metadata (Provider, Model, Response Time) */}
        <LlmResponseMetadata
          provider={activeProvider}
          model={activeModel}
          responseTimeMs={activeResponseTimeMs}
        />
      </div>
    );
  }

  return null;
}

