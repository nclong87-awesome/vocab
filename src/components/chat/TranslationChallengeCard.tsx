import { useState } from "react";
import { 
  Target, 
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

  // 1. RENDER CHALLENGE PROMPT CARD
  if (challenge && !evaluation) {
    return (
      <div className="w-full p-4 sm:p-5 bg-gradient-to-br from-amber-50/80 via-amber-50/20 to-white border border-amber-200/90 rounded-2xl shadow-xs space-y-3.5">
        {/* Header Badge */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="p-1.5 bg-amber-500 text-white rounded-lg shadow-2xs">
              <Target className="w-4 h-4" />
            </span>
            <span className="font-bold text-xs sm:text-sm text-stone-900 tracking-tight">
              Personalized Translation Challenge
            </span>
          </div>
          {challenge.topicContext && (
            <span className="px-2.5 py-0.5 bg-amber-100/90 text-amber-900 border border-amber-300/80 rounded-full text-[11px] font-semibold">
              {challenge.topicContext}
            </span>
          )}
        </div>

        {/* Challenge Sentence Box */}
        <div className="p-3.5 bg-white border border-amber-200/70 rounded-xl shadow-2xs space-y-1.5">
          <div className="text-[10px] font-bold text-amber-800 uppercase tracking-wider font-mono">
            Translate into {challenge.targetLanguage || "English"}:
          </div>
          <p className="text-base sm:text-lg font-bold text-stone-900 leading-snug">
            "{challenge.nativeSentence}"
          </p>
        </div>

        {/* Featured Target Word from User Collection */}
        {challenge.targetWordFromCollection && (
          <div className="p-3 bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent border border-amber-300/80 rounded-xl flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="p-1.5 bg-amber-600 text-white rounded-lg shadow-2xs shrink-0">
                <Target className="w-4 h-4" />
              </span>
              <div className="min-w-0">
                <div className="text-xs text-amber-950 font-bold flex items-center gap-1.5 flex-wrap">
                  <span>Target Word from Collection:</span>
                  <span className="px-2 py-0.5 bg-amber-100 border border-amber-300 rounded-md font-mono text-amber-900">
                    {challenge.targetWordFromCollection.word}
                  </span>
                  {challenge.targetWordFromCollection.translation && (
                    <span className="text-stone-500 font-normal">
                      ({challenge.targetWordFromCollection.translation})
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-amber-800/90 leading-tight mt-0.5">
                  Incorporate this specific word in your response to augment its strength by <strong className="font-bold text-amber-950">+30 points</strong>!
                </p>
              </div>
            </div>
            {typeof challenge.targetWordFromCollection.strength === "number" && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 bg-white border border-amber-200 rounded-lg text-xs shrink-0 shadow-2xs">
                <span className="text-[10px] text-stone-500 uppercase font-mono">Strength:</span>
                <span className="font-bold text-amber-800">{challenge.targetWordFromCollection.strength}%</span>
              </div>
            )}
          </div>
        )}

        {/* Profile Match & Hints Toggle */}
        <div className="flex items-center justify-between gap-2 pt-0.5 flex-wrap text-xs text-stone-600">
          {challenge.personalityNote && (
            <div className="flex items-center gap-1.5 text-stone-600 text-[11px]">
              <Sparkles className="w-3.5 h-3.5 text-amber-600 shrink-0" />
              <span>{challenge.personalityNote}</span>
            </div>
          )}

          {challenge.keyTargetWords && challenge.keyTargetWords.length > 0 && (
            <button
              type="button"
              onClick={() => setShowVocabHints(!showVocabHints)}
              className="text-[11px] font-semibold text-amber-800 hover:text-amber-950 flex items-center gap-1 transition-colors cursor-pointer ml-auto"
            >
              <Lightbulb className="w-3.5 h-3.5 text-amber-600" />
              <span>{showVocabHints ? "Hide Vocab Hints" : "Show Key Vocab Hints"}</span>
              {showVocabHints ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
          )}
        </div>

        {/* Collapsible Key Target Words Hints */}
        {showVocabHints && challenge.keyTargetWords && (
          <div className="p-3 bg-white/90 border border-amber-200/70 rounded-xl space-y-2 text-xs">
            <span className="font-bold text-stone-800 block text-[11px] uppercase tracking-wider font-mono">
              Key Target Vocabulary:
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
                    title={inCol ? "Saved in collection" : "Click to temporarily add to collection as incomplete word"}
                    className={`px-2.5 py-1 rounded-lg flex items-center gap-2 border transition-all ${
                      inCol
                        ? "bg-emerald-50 border-emerald-200 text-emerald-800 cursor-default"
                        : "bg-stone-50 hover:bg-amber-50/70 border-stone-200 hover:border-amber-300 cursor-pointer active:scale-95"
                    }`}
                  >
                    <span className="font-bold text-stone-900">{kw.word}</span>
                    <span className="text-stone-500">({kw.translation})</span>
                    {(onAddIncompleteWord || onAddWord) && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAddSingleWord(kw);
                        }}
                        disabled={inCol}
                        className="ml-1 text-amber-600 hover:text-amber-800 disabled:text-emerald-700 transition-colors cursor-pointer"
                        title={inCol ? "Saved" : "Add to collection (incomplete)"}
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

        {/* AI Response Metadata (Provider, Model, Response Time) */}
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
              You used the target word <strong className="font-bold font-mono">"{evaluation.targetWordUsed}"</strong> from your words collection in your response.
              {typeof evaluation.targetWordPrevStrength === "number" && typeof evaluation.targetWordNewStrength === "number" && (
                <span className="block text-[11px] font-medium text-emerald-800 mt-0.5">
                  Memory strength augmented: {evaluation.targetWordPrevStrength}% → <strong className="font-bold text-emerald-950">{evaluation.targetWordNewStrength}%</strong> (+30 points)
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
