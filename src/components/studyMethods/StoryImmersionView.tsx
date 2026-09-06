import React, { useState, useEffect } from "react";
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
  Check
} from "lucide-react";
import { Word, ImmersionStory, MinedSentence, ImmersionStoryWord, TTSConfig, LLMConfig } from "../../types";
import { 
  generateImmersionStoryService, 
  getStoredMinedSentences, 
  saveMinedSentence, 
  deleteMinedSentence 
} from "../../services/studyMethodsService";
import { speakText } from "../../utils/ttsService";

interface StoryImmersionViewProps {
  words: Word[];
  targetLanguage: string;
  nativeLanguage: string;
  appLanguage?: string;
  ttsConfig?: TTSConfig;
  llmConfig?: LLMConfig;
  onUpdateWords?: (updated: Word[]) => void;
  onAddWord?: (wordOrData: any, hint?: string) => void;
}

export default function StoryImmersionView({
  words,
  targetLanguage,
  nativeLanguage,
  appLanguage: _appLanguage = "Vietnamese",
  ttsConfig,
  llmConfig,
  onUpdateWords: _onUpdateWords,
  onAddWord
}: StoryImmersionViewProps) {
  const [currentStory, setCurrentStory] = useState<ImmersionStory | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showDualTranslation, setShowDualTranslation] = useState(true);
  const [activeStoryTab, setActiveStoryTab] = useState<"reader" | "mined">("reader");
  const [minedSentences, setMinedSentences] = useState<MinedSentence[]>([]);
  const [selectedWordLookup, setSelectedWordLookup] = useState<ImmersionStoryWord | null>(null);
  const [minedSuccessIds, setMinedSuccessIds] = useState<Set<string>>(new Set());

  // Generation Controls
  const [selectedTopic, setSelectedTopic] = useState("Daily Coffee Encounter");
  const [selectedGenre, setSelectedGenre] = useState("Slice of Life");
  const [selectedDifficulty, setSelectedDifficulty] = useState<"beginner" | "intermediate" | "advanced">("intermediate");
  const [selectedWordIds, setSelectedWordIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    setMinedSentences(getStoredMinedSentences());
  }, []);

  // Initialize selected target words with unstudied or starred words
  useEffect(() => {
    if (words.length > 0 && selectedWordIds.size === 0) {
      const candidates = words.filter(w => !w.learned || w.starred).slice(0, 6);
      setSelectedWordIds(new Set(candidates.map(w => w.id)));
    }
  }, [words, selectedWordIds.size]);

  const speak = (text: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!text) return;
    speakText(text, ttsConfig, llmConfig, targetLanguage);
  };

  const handleGenerateStory = async () => {
    setIsGenerating(true);
    setSelectedWordLookup(null);
    try {
      const targetWordsObj = words.filter(w => selectedWordIds.has(w.id));
      const story = await generateImmersionStoryService({
        targetWords: targetWordsObj.length > 0 ? targetWordsObj : words.slice(0, 6),
        topic: selectedTopic,
        genre: selectedGenre,
        difficulty: selectedDifficulty,
        targetLanguage,
        nativeLanguage,
        cfg: llmConfig
      });
      setCurrentStory(story);
    } catch (e) {
      console.error("Story generation failed:", e);
    } finally {
      setIsGenerating(false);
    }
  };

  // One-click sentence mining
  const handleMineSentence = (sentence: string, translation: string, paragraphId: string) => {
    if (!sentence) return;
    const targetWordsList = currentStory?.targetWords.map(w => w.word) || [];
    const saved = saveMinedSentence({
      targetSentence: sentence,
      translation: translation || "",
      sourceStoryTitle: currentStory?.title || "Story Immersion",
      minedWords: targetWordsList,
      userNotes: `Mined from topic: ${currentStory?.topic || "Reading"}`
    });
    setMinedSentences(prev => [saved, ...prev]);
    setMinedSuccessIds(prev => new Set(prev).add(paragraphId));
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
  };

  return (
    <div className="space-y-6">
      {/* Top Header & Strategy */}
      <div className="bg-white border border-stone-200 p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-md bg-sky-100 text-sky-900 flex items-center justify-center font-bold text-xs font-serif">
              2
            </span>
            <h3 className="text-lg font-bold text-stone-900">Contextual Immersion & Dual Reader</h3>
            <span className="text-xs px-2 py-0.5 rounded-full bg-sky-50 text-sky-800 border border-sky-200 font-semibold">
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

      {activeStoryTab === "reader" ? (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Left Controls / Topic Generator */}
          <div className="lg:col-span-1 space-y-4">
            <div className="bg-white border border-stone-200 p-4 rounded-xl space-y-4">
              <h4 className="text-xs font-bold uppercase tracking-wider text-stone-900 font-mono flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-sky-600" /> Story Parameters
              </h4>

              {/* Topic suggestions */}
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-stone-700">Topic / Scenario</label>
                <input
                  type="text"
                  value={selectedTopic}
                  onChange={(e) => setSelectedTopic(e.target.value)}
                  placeholder="e.g. Travel, Coffee shop, Mystery"
                  className="w-full text-xs px-3 py-2 rounded-lg border border-stone-200 focus:border-stone-900 outline-none"
                />
                <div className="flex flex-wrap gap-1 pt-1">
                  {[
                    "Coffee Shop Talk",
                    "Airport Lost Luggage",
                    "Tech Startup Office",
                    "Weekend Hiking Trip",
                    "Cozy Dinner Party"
                  ].map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setSelectedTopic(t)}
                      className="text-[10px] bg-stone-100 hover:bg-stone-200 text-stone-700 px-2 py-0.5 rounded cursor-pointer"
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              {/* Genre and Difficulty */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-semibold text-stone-700 mb-1">Genre</label>
                  <select
                    value={selectedGenre}
                    onChange={(e) => setSelectedGenre(e.target.value)}
                    className="w-full text-xs p-1.5 rounded-lg border border-stone-200 bg-white"
                  >
                    <option value="Slice of Life">Slice of Life</option>
                    <option value="Mystery">Mystery</option>
                    <option value="Comedy">Comedy</option>
                    <option value="Sci-Fi Adventure">Sci-Fi</option>
                    <option value="Workplace Drama">Workplace</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-stone-700 mb-1">Level</label>
                  <select
                    value={selectedDifficulty}
                    onChange={(e) => setSelectedDifficulty(e.target.value as any)}
                    className="w-full text-xs p-1.5 rounded-lg border border-stone-200 bg-white"
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
                      const next = words.filter(w => !w.learned || w.starred).slice(0, 6);
                      setSelectedWordIds(new Set(next.map(w => w.id)));
                    }}
                    className="text-[10px] text-sky-700 font-bold hover:underline"
                  >
                    Auto-Pick 6
                  </button>
                </div>
                <div className="max-h-36 overflow-y-auto space-y-1 border border-stone-100 rounded-lg p-1.5 text-xs">
                  {words.slice(0, 30).map((w) => {
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
                        <span className="text-[10px] text-stone-400 font-normal truncate max-w-[80px]">
                          {w.translation}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Generate Button */}
              <button
                type="button"
                disabled={isGenerating}
                onClick={handleGenerateStory}
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
          </div>

          {/* Right Reading Surface */}
          <div className="lg:col-span-3 space-y-4">
            {currentStory ? (
              <div className="bg-white border border-stone-200 rounded-2xl overflow-hidden shadow-xs">
                {/* Story Top Bar */}
                <div className="p-4 sm:p-5 border-b border-stone-100 bg-stone-50/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg sm:text-xl font-bold text-stone-950 font-serif">
                        {currentStory.title}
                      </h3>
                      <span className="text-[10px] font-mono font-bold bg-sky-100 text-sky-900 px-2 py-0.5 rounded">
                        {currentStory.difficulty}
                      </span>
                    </div>
                    <p className="text-xs text-stone-500 font-serif italic mt-0.5">
                      "{currentStory.titleTranslation}" • {currentStory.genre}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
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

                {/* Target Words Pill Strip */}
                <div className="px-4 py-2.5 bg-amber-50/40 border-b border-amber-100 flex items-center gap-2 overflow-x-auto scrollbar-none">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-amber-800 font-mono shrink-0">
                    Highlighted Target Words:
                  </span>
                  {currentStory.targetWords.map((tw) => (
                    <button
                      key={tw.word}
                      type="button"
                      onClick={() => setSelectedWordLookup(tw)}
                      className="px-2 py-0.5 bg-white hover:bg-amber-100 text-stone-900 border border-amber-200 text-xs rounded-full font-bold transition-colors cursor-pointer shrink-0 flex items-center gap-1"
                    >
                      <span>{tw.word}</span>
                      <span className="text-[10px] text-stone-400 font-normal">({tw.translation})</span>
                    </button>
                  ))}
                </div>

                {/* Story Body Paragraphs */}
                <div className="p-5 sm:p-8 space-y-6">
                  {currentStory.paragraphs.map((p) => {
                    const isMined = minedSuccessIds.has(p.id);
                    return (
                      <div
                        key={p.id}
                        className="p-4 rounded-xl border border-stone-100 hover:border-stone-300 bg-stone-50/30 transition-all space-y-3 group"
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
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="bg-white border border-stone-200 rounded-2xl p-12 text-center space-y-3">
                <BookOpen className="w-12 h-12 text-sky-400 mx-auto" />
                <h4 className="text-base font-bold text-stone-900">Contextual Story Surface Ready</h4>
                <p className="text-xs text-stone-500 max-w-md mx-auto">
                  Select your desired scenario or pick target vocabulary on the left, then click <strong>Generate Immersion Story</strong>.
                </p>
                <button
                  type="button"
                  onClick={handleGenerateStory}
                  className="px-5 py-2.5 rounded-lg bg-stone-900 text-amber-300 font-bold text-xs inline-flex items-center gap-2 cursor-pointer shadow-xs"
                >
                  <Sparkles className="w-4 h-4 text-amber-400" /> Start Reading Story
                </button>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Mined Sentences Tab */
        <div className="bg-white border border-stone-200 rounded-2xl p-4 sm:p-6 space-y-4">
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
                      className="p-1 text-stone-400 hover:text-stone-900 transition-colors"
                      title="Listen audio"
                    >
                      <Volume2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteMined(m.id)}
                      className="p-1 text-stone-300 hover:text-rose-600 transition-colors"
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
                  className="text-stone-400 hover:text-stone-700 text-sm font-bold"
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
    </div>
  );
}
