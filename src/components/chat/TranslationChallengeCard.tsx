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
  onAddMultipleWords?: (words: any[]) => void;
  showToast?: (msg: string) => void;
}

export default function TranslationChallengeCard({
  challenge,
  evaluation,
  provider,
  model,
  responseTimeMs,
  words = [],
  onAddWord,
  onAddMultipleWords,
  showToast,
}: TranslationChallengeCardProps) {
  const [showVocabHints, setShowVocabHints] = useState(false);
  const [addedWordKeys, setAddedWordKeys] = useState<Record<string, boolean>>({});

  const activeProvider = provider || challenge?.provider || evaluation?.provider;
  const activeModel = model || challenge?.model || evaluation?.model;
  const activeResponseTimeMs = responseTimeMs ?? challenge?.responseTimeMs ?? evaluation?.responseTimeMs;

  const handleAddSingleWord = (item: ChallengeSuggestedVocab | { word: string; translation: string; hint?: string; partOfSpeech?: string }) => {
    const wordKey = item.word.toLowerCase();
    if (addedWordKeys[wordKey] || isWordInCollection(words, item.word)) return;

    if (onAddWord) {
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
    if (!onAddMultipleWords) return;
    const itemsToAdd = vocabList.filter(
      (v) => !addedWordKeys[v.word.toLowerCase()] && !isWordInCollection(words, v.word)
    );
    if (itemsToAdd.length === 0) return;

    const formattedWords = itemsToAdd.map((v) => ({
      word: v.word,
      translation: v.translation,
      definition: v.definition || `Key term from translation challenge`,
      partOfSpeech: v.partOfSpeech || "expression",
      category: "Challenge Practice",
      learned: false,
      starred: false,
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
                    className="px-2.5 py-1 bg-stone-50 border border-stone-200 rounded-lg flex items-center gap-2"
                  >
                    <span className="font-bold text-stone-900">{kw.word}</span>
                    <span className="text-stone-500">({kw.translation})</span>
                    {onAddWord && (
                      <button
                        type="button"
                        onClick={() => handleAddSingleWord(kw)}
                        disabled={inCol}
                        className="ml-1 text-amber-600 hover:text-amber-800 disabled:text-stone-300 transition-colors cursor-pointer"
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="p-3 bg-stone-50 border border-stone-200/70 rounded-xl space-y-1">
            <span className="text-[10px] font-bold text-stone-500 uppercase tracking-wider font-mono block">
              Your Submission
            </span>
            <p className="text-xs sm:text-sm font-medium text-stone-800 break-words">
              "{evaluation.userTranslation}"
            </p>
          </div>

          <div className="p-3 bg-emerald-50/80 border border-emerald-200/80 rounded-xl space-y-1">
            <span className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider font-mono block">
              Ideal Target Translation
            </span>
            <p className="text-xs sm:text-sm font-bold text-emerald-950 break-words">
              "{evaluation.correctedSentence}"
            </p>
          </div>
        </div>

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
              {onAddMultipleWords && !allVocabAdded && (
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
                    className="p-2.5 bg-stone-50 border border-stone-200/80 rounded-xl flex items-center justify-between gap-2"
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

                    {onAddWord && (
                      <button
                        type="button"
                        onClick={() => handleAddSingleWord(v)}
                        disabled={inCol}
                        className={`px-2 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1 transition-all cursor-pointer shrink-0 ${
                          inCol
                            ? "bg-emerald-100 text-emerald-800 opacity-80"
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
