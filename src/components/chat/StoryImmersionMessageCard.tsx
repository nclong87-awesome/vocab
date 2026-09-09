import React, { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  BookOpen, 
  Sparkles, 
  Volume2, 
  Languages, 
  BookmarkPlus, 
  BookmarkCheck, 
  RefreshCw, 
  Trash2,
  Check,
  ChevronDown,
  ChevronUp,
  Cpu,
  Plus
} from "lucide-react";
import { Word, ImmersionStory, MinedSentence, ImmersionStoryWord, TTSConfig, LLMConfig } from "../../types";
import { 
  generateImmersionStoryService, 
  extractStoryCollocations,
  getStoredMinedSentences, 
  saveMinedSentence, 
  deleteMinedSentence 
} from "../../services/immersionStoryService";
import { getOverrideConfig } from "../../services/llmClientService";
import { speakText } from "../../utils/ttsService";
import WordReviewedBanner from "./WordReviewedBanner";
import WordChatModal from "./WordChatModal";
import StrengthHistoryModal from "../analytics/StrengthHistoryModal";
import LlmResponseMetadata from "./LlmResponseMetadata";

interface StoryImmersionMessageCardProps {
  story: ImmersionStory;
  targetLanguage: string;
  nativeLanguage: string;
  appLanguage?: string;
  ttsConfig?: TTSConfig;
  llmConfig?: LLMConfig;
  provider?: string;
  model?: string;
  responseTimeMs?: number;
  words?: Word[];
  onUpdateWords?: (updated: Word[]) => void;
  onAddWord?: (wordOrData: any, hint?: string) => void;
  onAddMultipleWords?: (words: any[]) => void;
  showToast?: (msg: string) => void;
}

export default function StoryImmersionMessageCard({
  story: initialStory,
  targetLanguage,
  nativeLanguage,
  appLanguage: _appLanguage = "Vietnamese",
  ttsConfig,
  llmConfig,
  provider,
  model,
  responseTimeMs,
  words = [],
  onUpdateWords: _onUpdateWords,
  onAddWord,
  showToast
}: StoryImmersionMessageCardProps) {
  const [currentStory, setCurrentStory] = useState<ImmersionStory>(initialStory);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showDualTranslation, setShowDualTranslation] = useState(true);
  const [activeStoryTab, setActiveStoryTab] = useState<"reader" | "mined">("reader");
  const [minedSentences, setMinedSentences] = useState<MinedSentence[]>([]);
  const [selectedWordLookup, setSelectedWordLookup] = useState<ImmersionStoryWord | null>(null);
  const [minedSuccessIds, setMinedSuccessIds] = useState<Set<string>>(new Set());
  const [showParameters, setShowParameters] = useState(false);
  const [selectedHistoryWord, setSelectedHistoryWord] = useState<Word | null>(null);
  const [selectedChatWord, setSelectedChatWord] = useState<Word | null>(null);
  const [currentProvider, setCurrentProvider] = useState<string | undefined>(initialStory.provider || provider);
  const [currentModel, setCurrentModel] = useState<string | undefined>(initialStory.model || model);
  const [currentResponseTimeMs, setCurrentResponseTimeMs] = useState<number | undefined>(initialStory.responseTimeMs ?? responseTimeMs);

  useEffect(() => {
    if (initialStory.provider || provider !== undefined) setCurrentProvider(initialStory.provider || provider);
    if (initialStory.model || model !== undefined) setCurrentModel(initialStory.model || model);
    if (initialStory.responseTimeMs !== undefined || responseTimeMs !== undefined) {
      setCurrentResponseTimeMs(initialStory.responseTimeMs ?? responseTimeMs);
    }
  }, [initialStory, provider, model, responseTimeMs]);

  // Generation Controls for Regeneration
  const [selectedTopic, setSelectedTopic] = useState(initialStory.topic || "");
  const [selectedGenre, setSelectedGenre] = useState(initialStory.genre || "Auto");
  const [selectedDifficulty, setSelectedDifficulty] = useState<"beginner" | "intermediate" | "advanced">(
    (initialStory.difficulty as any) || "intermediate"
  );
  const [selectedWordIds, setSelectedWordIds] = useState<Set<string>>(() => {
    const existingWords = new Set<string>();
    if (initialStory.targetWords) {
      initialStory.targetWords.forEach(tw => {
        const found = words.find(w => w.word.toLowerCase() === tw.word.toLowerCase());
        if (found) existingWords.add(found.id);
      });
    }
    return existingWords;
  });

  useEffect(() => {
    setCurrentStory(initialStory);
  }, [initialStory]);

  useEffect(() => {
    setMinedSentences(getStoredMinedSentences());
  }, []);

  // Map target words to the exact paragraph sections where they appear
  const paragraphWordMap = useMemo(() => {
    const map = new Map<string, Word[]>();
    const allParagraphs = currentStory.paragraphs || [];
    const storyTargetWords = currentStory.targetWords || [];
    const assignedToAny = new Set<string>();

    allParagraphs.forEach((p) => {
      const pCombined = `${p.targetText || ""} ${p.nativeText || ""}`.toLowerCase();
      const matched: Word[] = [];

      storyTargetWords.forEach((tw) => {
        const wLower = tw.word.toLowerCase();
        const inStoryLower = (tw.targetInStory || "").toLowerCase();

        const isMatch =
          (inStoryLower && pCombined.includes(inStoryLower)) ||
          pCombined.includes(wLower) ||
          (wLower.length > 3 && pCombined.includes(wLower.slice(0, -1))) ||
          wLower.split(/[\s-]+/).filter(t => t.length > 2).every(t => pCombined.includes(t));

        if (isMatch) {
          assignedToAny.add(wLower);
          const foundInCollection = words.find(cw => cw.word.toLowerCase() === wLower);
          const wordObj: Word = foundInCollection || {
            id: `story_tw_${tw.word}`,
            word: tw.word,
            translation: tw.translation || "",
            definition: tw.definition || "",
            partOfSpeech: tw.partOfSpeech || "",
            pronunciation: tw.pronunciation || undefined,
            example: undefined,
            exampleTranslation: undefined,
            starred: false,
            strength: 0,
            learned: false,
            createdAt: new Date().toISOString(),
            lastReviewed: new Date().toISOString(),
            strengthHistory: []
          };
          matched.push(wordObj);
        }
      });

      map.set(p.id, matched);
    });

    // Handle any orphaned target words that might not have strictly matched string tokens
    const unassigned = storyTargetWords.filter(tw => !assignedToAny.has(tw.word.toLowerCase()));
    if (unassigned.length > 0 && allParagraphs.length > 0) {
      unassigned.forEach((tw, uIdx) => {
        const targetP = allParagraphs[uIdx % allParagraphs.length];
        const existing = map.get(targetP.id) || [];
        const foundInCollection = words.find(cw => cw.word.toLowerCase() === tw.word.toLowerCase());
        const wordObj: Word = foundInCollection || {
          id: `story_tw_${tw.word}`,
          word: tw.word,
          translation: tw.translation || "",
          definition: tw.definition || "",
          partOfSpeech: tw.partOfSpeech || "",
          pronunciation: tw.pronunciation || undefined,
          example: undefined,
          exampleTranslation: undefined,
          starred: false,
          strength: 0,
          learned: false,
          createdAt: new Date().toISOString(),
          lastReviewed: new Date().toISOString(),
          strengthHistory: []
        };
        existing.push(wordObj);
        map.set(targetP.id, existing);
      });
    }

    return map;
  }, [currentStory, words]);

  const speak = (text: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!text) return;
    speakText(text, ttsConfig, llmConfig, targetLanguage);
  };

  const suggestedWordsList = useMemo(() => {
    if (currentStory.suggestedWords && currentStory.suggestedWords.length > 0) {
      return currentStory.suggestedWords.slice(0, 3);
    }
    if (currentStory.paragraphs && currentStory.paragraphs.length > 0) {
      return extractStoryCollocations(currentStory.paragraphs, nativeLanguage, targetLanguage);
    }
    return [];
  }, [currentStory, nativeLanguage, targetLanguage]);

  const handleAddSuggestedWord = (sw: ImmersionStoryWord) => {
    if (onAddWord) {
      onAddWord({
        word: sw.word,
        translation: sw.translation || "",
        definition: sw.definition || "",
        partOfSpeech: sw.partOfSpeech || "collocation",
        pronunciation: sw.pronunciation || undefined,
        example: `From story "${currentStory.title}"`,
        starred: false,
        learned: false
      });
      showToast?.(`Added "${sw.word}" collocation to vocabulary list!`);
    }
  };

  const handleGenerateNewStory = async () => {
    setIsGenerating(true);
    setSelectedWordLookup(null);
    const startTime = performance.now();
    try {
      const targetWordsObj = words.filter(w => selectedWordIds.has(w.id));
      const effectiveConfig = getOverrideConfig(llmConfig);
      const newStory = await generateImmersionStoryService({
        targetWords: targetWordsObj.length > 0 ? targetWordsObj : words.slice(0, 5),
        topic: selectedTopic,
        genre: selectedGenre,
        difficulty: selectedDifficulty,
        targetLanguage,
        nativeLanguage,
        cfg: effectiveConfig
      });
      const durationMs = newStory.responseTimeMs || Math.round(performance.now() - startTime);
      setCurrentStory(newStory);
      setCurrentProvider(newStory.provider || effectiveConfig?.provider);
      setCurrentModel(newStory.model || effectiveConfig?.model);
      setCurrentResponseTimeMs(durationMs);
      setShowParameters(false);
      showToast?.("New immersion story generated successfully!");
    } catch (e) {
      console.error("Story generation failed:", e);
      showToast?.("Failed to generate story. Please try again.");
    } finally {
      setIsGenerating(false);
    }
  };

  // One-click sentence mining
  const handleMineSentence = (sentence: string, translation: string, paragraphId: string) => {
    if (!sentence) return;
    const targetWordsList = currentStory?.targetWords?.map(w => w.word) || [];
    const saved = saveMinedSentence({
      targetSentence: sentence,
      translation: translation || "",
      sourceStoryTitle: currentStory?.title || "Story Immersion",
      minedWords: targetWordsList,
      userNotes: `Mined from: ${currentStory?.topic || "Reading"}`
    });
    setMinedSentences(prev => [saved, ...prev]);
    setMinedSuccessIds(prev => new Set(prev).add(paragraphId));
    showToast?.("Sentence mined to collection!");
    setTimeout(() => {
      setMinedSuccessIds(prev => {
        const next = new Set(prev);
        next.delete(paragraphId);
        return next;
      });
    }, 2500);
  };

  const handleDeleteMined = (id: string) => {
    deleteMinedSentence(id);
    setMinedSentences(prev => prev.filter(i => i.id !== id));
    showToast?.("Mined sentence removed");
  };

  return (
    <div className="w-full bg-white border border-stone-200/90 rounded-2xl overflow-hidden shadow-xs space-y-0" id="story-immersion-card">
      {/* Top Header & Strategy Banner (Matches Screenshot) */}
      <div className="bg-white border-b border-stone-200 p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-6 h-6 rounded-md bg-sky-100 text-sky-900 flex items-center justify-center font-bold text-xs font-serif">
              2
            </span>
            <h3 className="text-base sm:text-lg font-bold text-stone-900">
              Contextual Immersion & Dual Reader
            </h3>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-sky-50 text-sky-800 border border-sky-200 font-semibold">
              Comprehensible Input & Sentence Mining
            </span>
          </div>
          <p className="text-xs sm:text-sm text-stone-600 max-w-2xl leading-relaxed">
            Encounters words "in the wild." Language acquisition is 4x faster with Comprehensible Input (~95% comprehensible text embedding target words). 
            Click any word for instant dictionary definition and "mine" memorable sentences into your collection.
          </p>
        </div>

        {/* Story Tab Switcher */}
        <div className="flex bg-stone-100 p-1 rounded-lg border border-stone-200 shrink-0 self-start md:self-center">
          <button
            type="button"
            onClick={() => setActiveStoryTab("reader")}
            className={`px-3 py-1.5 text-xs font-bold rounded-md flex items-center gap-1.5 transition-all cursor-pointer ${
              activeStoryTab === "reader" ? "bg-white text-stone-950 shadow-xs" : "text-stone-600 hover:text-stone-950"
            }`}
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>Story Reader</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveStoryTab("mined")}
            className={`px-3 py-1.5 text-xs font-bold rounded-md flex items-center gap-1.5 transition-all cursor-pointer ${
              activeStoryTab === "mined" ? "bg-white text-stone-950 shadow-xs" : "text-stone-600 hover:text-stone-950"
            }`}
          >
            <BookmarkCheck className="w-3.5 h-3.5 text-sky-600" />
            <span>Mined Sentences ({minedSentences.length})</span>
          </button>
        </div>
      </div>

      {/* Story Parameters Toggle Bar */}
      <div className="bg-stone-50/70 border-b border-stone-200/80 px-4 py-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setShowParameters(prev => !prev)}
          className="text-xs font-bold text-stone-700 hover:text-stone-950 flex items-center gap-1.5 cursor-pointer"
        >
          <Sparkles className="w-3.5 h-3.5 text-sky-600" />
          <span className="uppercase tracking-wider font-mono text-[11px]">Story Parameters</span>
          {showParameters ? <ChevronUp className="w-3.5 h-3.5 text-stone-400" /> : <ChevronDown className="w-3.5 h-3.5 text-stone-400" />}
        </button>

        <div className="flex items-center gap-2 text-[11px] text-stone-500 font-mono">
          {(provider || model) && (
            <span className="hidden sm:inline-flex items-center gap-1 bg-stone-100 px-2 py-0.5 rounded text-[10px]">
              <Cpu className="w-3 h-3 text-stone-400" />
              {model || provider}
              {responseTimeMs ? ` (${responseTimeMs}ms)` : ""}
            </span>
          )}
        </div>
      </div>

      {/* Collapsible Story Parameters Drawer */}
      <AnimatePresence>
        {showParameters && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden bg-white border-b border-stone-200 p-4 sm:p-5"
          >
            <div className="max-w-2xl space-y-4">
              {/* Topic suggestions */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-semibold text-stone-700">Topic / Premise</label>
                  <span className="text-[11px] text-stone-500 italic">Leave blank for AI to invent a fresh, creative premise</span>
                </div>
                <input
                  type="text"
                  value={selectedTopic}
                  onChange={(e) => setSelectedTopic(e.target.value)}
                  placeholder="Auto-invented by AI based on vocabulary (or enter any setting, character, or theme)"
                  className="w-full text-xs px-3 py-2 rounded-lg border border-stone-200 focus:border-stone-900 outline-none"
                />
              </div>

              {/* Genre and Difficulty */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-stone-700 mb-1">Genre</label>
                  <select
                    value={selectedGenre}
                    onChange={(e) => setSelectedGenre(e.target.value)}
                    className="w-full text-xs p-2 rounded-lg border border-stone-200 bg-white"
                  >
                    <option value="Auto">✨ Auto (AI-Curated for Words)</option>
                    <option value="Slice of Life & Everyday">☕ Slice of Life & Everyday</option>
                    <option value="Creative Fiction & Adventure">🌟 Creative Fiction & Adventure</option>
                    <option value="Travel & Cultural Discovery">✈️ Travel & Culture</option>
                    <option value="Mystery & Intrigue">🔍 Mystery & Intrigue</option>
                    <option value="Humor & Lighthearted">😄 Humor & Lighthearted</option>
                    <option value="Historical Non-Fiction (Real Events & Figures)">📜 Real Events & Inspiring Milestones</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-stone-700 mb-1">Level</label>
                  <select
                    value={selectedDifficulty}
                    onChange={(e) => setSelectedDifficulty(e.target.value as any)}
                    className="w-full text-xs p-2 rounded-lg border border-stone-200 bg-white"
                  >
                    <option value="beginner">Beginner</option>
                    <option value="intermediate">Intermediate</option>
                    <option value="advanced">Advanced</option>
                  </select>
                </div>
              </div>

              {/* Target Words Picker */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <label className="font-semibold text-stone-700">Target Words ({selectedWordIds.size})</label>
                  <button
                    type="button"
                    onClick={() => {
                      const next = words.filter(w => !w.learned || w.starred).slice(0, 5);
                      setSelectedWordIds(new Set(next.map(w => w.id)));
                    }}
                    className="text-[10px] text-sky-700 font-bold hover:underline cursor-pointer"
                  >
                    Auto-Pick 5
                  </button>
                </div>
                <div className="max-h-36 overflow-y-auto space-y-1 border border-stone-100 rounded-lg p-1.5 text-xs">
                  {words.slice(0, 24).map((w) => {
                    const isChecked = selectedWordIds.has(w.id);
                    return (
                      <div
                        key={w.id}
                        onClick={() => {
                          setSelectedWordIds(prev => {
                            const next = new Set(prev);
                            if (next.has(w.id)) next.delete(w.id);
                            else next.add(w.id);
                            return next;
                          });
                        }}
                        className={`p-1.5 rounded flex items-center justify-between cursor-pointer ${
                          isChecked ? "bg-sky-50 text-sky-950 font-bold" : "hover:bg-stone-50 text-stone-600"
                        }`}
                      >
                        <span className="truncate">{w.word}</span>
                        <span className="text-[10px] text-stone-400 font-normal truncate max-w-[120px]">
                          {w.translation}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Regenerate Button */}
              <button
                type="button"
                disabled={isGenerating}
                onClick={handleGenerateNewStory}
                className="w-full py-2.5 rounded-lg bg-stone-900 hover:bg-black text-amber-300 font-bold text-xs flex items-center justify-center gap-2 shadow-xs cursor-pointer disabled:opacity-50 transition-all"
              >
                {isGenerating ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin text-amber-400" />
                    <span>Writing Graded Story...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 text-amber-400" />
                    <span>Generate Immersion Story</span>
                  </>
                )}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Surface */}
      {activeStoryTab === "reader" ? (
        <div className="p-4 sm:p-6 space-y-5">
          {/* Story Top Bar */}
          <div className="p-4 sm:p-5 border border-stone-200 rounded-xl bg-stone-50/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-lg sm:text-xl font-bold text-stone-950 font-serif">
                  {currentStory.title}
                </h3>
                <span className="text-[10px] font-mono font-bold bg-sky-100 text-sky-900 px-2 py-0.5 rounded capitalize">
                  {currentStory.difficulty}
                </span>
              </div>
              <p className="text-xs text-stone-500 font-serif italic mt-0.5">
                "{currentStory.titleTranslation}" • {currentStory.genre}
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setShowDualTranslation(prev => !prev)}
                className={`px-3 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                  showDualTranslation
                    ? "bg-sky-50 text-sky-900 border-sky-300"
                    : "bg-white text-stone-600 border-stone-200 hover:bg-stone-50"
                }`}
                title="Toggle side-by-side native language parallel translation"
              >
                <Languages className="w-3.5 h-3.5" />
                <span>{showDualTranslation ? "Dual Text: ON" : "Dual Text: OFF"}</span>
              </button>
            </div>
          </div>

          {/* Story Body Paragraphs */}
          <div className="space-y-4">
            {currentStory.paragraphs && currentStory.paragraphs.map((p) => {
              const isMined = minedSuccessIds.has(p.id);
              const paragraphWords = paragraphWordMap.get(p.id) || [];

              return (
                <div
                  key={p.id}
                  className="p-4 sm:p-5 rounded-xl border border-stone-200/90 hover:border-stone-300 bg-stone-50/30 transition-all space-y-3 group"
                >
                  {/* Target Language Paragraph */}
                  <div className="flex items-start justify-between gap-4">
                    <p className="text-sm sm:text-base text-stone-900 font-serif leading-relaxed flex-1">
                      {p.targetText}
                    </p>
                    <div className="flex items-center gap-1.5 opacity-80 group-hover:opacity-100 transition-opacity shrink-0">
                      <button
                        type="button"
                        onClick={() => speak(p.targetText)}
                        className="p-1.5 rounded-lg bg-white border border-stone-200 hover:bg-stone-100 text-stone-600 transition-colors cursor-pointer shadow-2xs"
                        title="Listen paragraph narration"
                      >
                        <Volume2 className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleMineSentence(p.targetText, p.nativeText, p.id)}
                        className={`p-1.5 rounded-lg border transition-all cursor-pointer shadow-2xs ${
                          isMined
                            ? "bg-emerald-600 text-white border-emerald-600"
                            : "bg-white hover:bg-sky-50 text-stone-600 hover:text-sky-700 border-stone-200"
                        }`}
                        title="Mine sentence into personal notebook"
                      >
                        {isMined ? <Check className="w-4 h-4" /> : <BookmarkPlus className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  {/* Dual Translation Paragraph */}
                  {showDualTranslation && (
                    <p className="text-xs sm:text-sm text-stone-500 font-serif italic border-t border-stone-200/60 pt-2 leading-relaxed">
                      {p.nativeText}
                    </p>
                  )}

                  {/* Target Word(s) in this Section */}
                  {paragraphWords.length > 0 && (
                    <div className="pt-1 space-y-2 border-t border-stone-200/50 mt-2">
                      {paragraphWords.map((tw) => (
                        <WordReviewedBanner
                          key={tw.id || tw.word}
                          word={tw}
                          prefixLabel="Word Reviewed:"
                          onPlayAudio={(text) => speak(text)}
                          onAskAi={(w) => setSelectedChatWord(w)}
                          onViewHistory={(w) => setSelectedHistoryWord(w)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Suggested Collocations (Word + Preposition) from the Story */}
          {suggestedWordsList.length > 0 && (
            <div className="p-4 sm:p-5 rounded-xl border border-sky-200/80 bg-sky-50/30 space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-sky-600" />
                  <div>
                    <h4 className="text-xs sm:text-sm font-bold text-stone-900">
                      Suggested Collocations (Word + Preposition)
                    </h4>
                    <p className="text-[11px] text-stone-500 font-sans">
                      Useful combinations from the story (e.g., <span className="italic font-medium text-stone-700">excited about</span>, <span className="italic font-medium text-stone-700">speak to</span>)
                    </p>
                  </div>
                </div>
                <span className="text-[10px] font-mono font-bold bg-sky-100 text-sky-800 px-2 py-0.5 rounded-full shrink-0">
                  {suggestedWordsList.length} collocations
                </span>
              </div>

              <div className="space-y-1.5">
                {suggestedWordsList.map((sw, idx) => {
                  const inCollection = words.some(w => w.word.toLowerCase() === sw.word.toLowerCase());
                  const cleanMeaning = (sw.translation || sw.definition || "").trim().replace(/^["“]|["”]$/g, "");
                  return (
                    <div
                      key={sw.word + idx}
                      className="px-3 py-2 bg-white rounded-lg border border-sky-100/90 shadow-2xs flex items-center justify-between gap-2.5"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-bold text-stone-900 text-sm font-sans">{sw.word}</span>
                          {sw.partOfSpeech && (
                            <span className="text-[9px] font-mono font-medium px-1.5 py-0.2 rounded bg-sky-50 text-sky-700 uppercase shrink-0 border border-sky-100">
                              {sw.partOfSpeech}
                            </span>
                          )}
                        </div>
                        {cleanMeaning && (
                          <div className="text-xs text-stone-600 mt-0.5 leading-snug break-words">
                            {cleanMeaning}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => speak(sw.word)}
                          className="p-1.5 rounded-lg border border-stone-200/70 text-stone-500 hover:text-stone-800 hover:bg-stone-100 transition-colors cursor-pointer"
                          title="Listen pronunciation"
                        >
                          <Volume2 className="w-3.5 h-3.5" />
                        </button>
                        
                        {inCollection ? (
                          <span className="text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200/80 px-2.5 py-1 rounded-lg font-semibold flex items-center gap-1">
                            <Check className="w-3 h-3 stroke-[2.5]" /> In Vocab
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleAddSuggestedWord(sw)}
                            className="px-2.5 py-1.5 rounded-lg bg-stone-900 hover:bg-stone-800 text-white text-[11px] font-medium flex items-center gap-1 transition-all cursor-pointer shadow-2xs active:scale-95"
                            title="Add to your vocabulary collection"
                          >
                            <Plus className="w-3 h-3 stroke-[2.5]" /> Add
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ) : (
        /* Mined Sentences Tab */
        <div className="p-4 sm:p-6 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-stone-100">
            <div>
              <h4 className="text-sm font-bold text-stone-900 flex items-center gap-2">
                <BookmarkCheck className="w-4 h-4 text-sky-600" /> Mined Sentence Collection
              </h4>
              <p className="text-xs text-stone-500">
                Memorable contextual sentences mined directly from your reading immersion sessions.
              </p>
            </div>
            <span className="text-xs font-mono font-bold bg-stone-100 text-stone-700 px-2.5 py-1 rounded-full">
              {minedSentences.length} sentences
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {minedSentences.map((m) => (
              <div
                key={m.id}
                className="p-4 rounded-xl border border-stone-200 bg-stone-50/40 hover:bg-stone-50 transition-all space-y-2 relative group"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs sm:text-sm font-serif font-bold text-stone-900 leading-snug">
                    "{m.targetSentence}"
                  </p>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => speak(m.targetSentence)}
                      className="p-1 text-stone-400 hover:text-stone-900 transition-colors cursor-pointer"
                      title="Listen audio"
                    >
                      <Volume2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteMined(m.id)}
                      className="p-1 text-stone-300 hover:text-rose-600 transition-colors cursor-pointer"
                      title="Delete mined sentence"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <p className="text-xs text-stone-500 italic font-serif">
                  "{m.translation}"
                </p>

                <div className="flex items-center justify-between pt-1 border-t border-stone-200/60 text-[10px] text-stone-400 font-mono">
                  <span>Source: {m.sourceStoryTitle || "Immersion"}</span>
                  <span>{new Date(m.createdAt).toLocaleDateString()}</span>
                </div>
              </div>
            ))}

            {minedSentences.length === 0 && (
              <div className="col-span-full py-12 text-center space-y-2 border border-dashed border-stone-200 rounded-xl">
                <BookmarkPlus className="w-8 h-8 text-stone-300 mx-auto" />
                <p className="text-xs text-stone-500 font-medium">No sentences mined yet.</p>
                <p className="text-[11px] text-stone-400">
                  Read immersion stories and click the bookmark icon on any paragraph to mine it here!
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* AI Metadata Footer */}
      <LlmResponseMetadata
        provider={currentProvider || provider || llmConfig?.provider}
        model={currentModel || model || llmConfig?.model}
        responseTimeMs={currentResponseTimeMs !== undefined ? currentResponseTimeMs : responseTimeMs}
        className="px-4 py-2 bg-stone-50/80 border-t border-stone-100"
      />

      {/* Word Quick Lookup Popover Modal */}
      <AnimatePresence>
        {selectedWordLookup && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="fixed inset-0 z-50 bg-stone-900/40 backdrop-blur-2xs flex items-center justify-center p-4"
          >
            <div className="bg-white rounded-2xl max-w-sm w-full p-5 space-y-3 shadow-xl border border-stone-200">
              <div className="flex items-start justify-between gap-2 pb-2 border-b border-stone-100">
                <div>
                  <h4 className="text-lg font-bold text-stone-950 font-serif">
                    {selectedWordLookup.word}
                  </h4>
                  <span className="text-xs font-mono text-stone-400">
                    {selectedWordLookup.pronunciation || ""} • {selectedWordLookup.partOfSpeech || "vocabulary"}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedWordLookup(null)}
                  className="text-stone-400 hover:text-stone-700 text-sm font-bold cursor-pointer"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-stone-400 font-mono">
                  Meaning:
                </span>
                <p className="text-sm font-bold text-stone-900 font-serif italic">
                  "{selectedWordLookup.translation}"
                </p>
                {selectedWordLookup.definition && (
                  <p className="text-xs text-stone-600 pt-1 leading-relaxed">
                    {selectedWordLookup.definition}
                  </p>
                )}
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-stone-100">
                <button
                  type="button"
                  onClick={() => speak(selectedWordLookup.word)}
                  className="px-3 py-1.5 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-800 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <Volume2 className="w-3.5 h-3.5 text-stone-600" />
                  <span>Listen</span>
                </button>

                {onAddWord && (
                  <button
                    type="button"
                    onClick={() => {
                      onAddWord(selectedWordLookup.word, selectedWordLookup.translation);
                      setSelectedWordLookup(null);
                    }}
                    className="px-3 py-1.5 rounded-lg bg-stone-900 hover:bg-black text-amber-300 text-xs font-bold cursor-pointer"
                  >
                    Add to Collection
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* Strength History Modal */}
      {selectedHistoryWord && (
        <StrengthHistoryModal
          word={selectedHistoryWord}
          onClose={() => setSelectedHistoryWord(null)}
        />
      )}

      {/* Ask AI Word Chat Modal */}
      {selectedChatWord && (
        <WordChatModal
          word={selectedChatWord}
          onClose={() => setSelectedChatWord(null)}
          targetLanguage={targetLanguage}
          nativeLanguage={nativeLanguage}
          llmConfig={llmConfig}
          ttsConfig={ttsConfig}
        />
      )}
    </div>
  );
}
