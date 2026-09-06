import React, { useState, useEffect, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  BookOpen, 
  Sparkles, 
  Clock, 
  Volume2, 
  Plus, 
  BookMarked,
  CheckCircle2,
  Trash2
} from "lucide-react";
import { Word, GoldlistNotebook, TTSConfig, LLMConfig } from "../../types";
import { 
  getStoredGoldlistNotebooks, 
  saveGoldlistNotebooks, 
  createNewGoldlistNotebook, 
  processDistillation 
} from "../../services/studyMethodsService";
import { speakText, stopSpeech } from "../../utils/ttsService";

interface GoldlistMethodViewProps {
  words: Word[];
  targetLanguage: string;
  nativeLanguage: string;
  appLanguage?: string;
  ttsConfig?: TTSConfig;
  llmConfig?: LLMConfig;
  onUpdateWords?: (updated: Word[]) => void;
}

export default function GoldlistMethodView({
  words,
  targetLanguage,
  nativeLanguage,
  appLanguage: _appLanguage = "Vietnamese",
  ttsConfig,
  llmConfig,
  onUpdateWords: _onUpdateWords
}: GoldlistMethodViewProps) {
  const [notebooks, setNotebooks] = useState<GoldlistNotebook[]>([]);
  const [activeNotebookId, setActiveNotebookId] = useState<string | null>(null);
  const [isCalmMode, setIsCalmMode] = useState(false);
  const [calmCurrentWordIndex, setCalmCurrentWordIndex] = useState(0);
  const [isDistilling, setIsDistilling] = useState(false);
  const [distillationTierIndex, setDistillationTierIndex] = useState<number>(0);
  const [retainedWordIds, setRetainedWordIds] = useState<Set<string>>(new Set());
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [selectedWordIdsForNew, setSelectedWordIdsForNew] = useState<Set<string>>(new Set());
  const [newNotebookTitle, setNewNotebookTitle] = useState("");

  const refreshNotebooks = useCallback(() => {
    const list = getStoredGoldlistNotebooks();
    setNotebooks(list);
    if (list && list.length > 0 && !activeNotebookId && list[0]?.id) {
      setActiveNotebookId(list[0].id);
    }
  }, [activeNotebookId]);

  useEffect(() => {
    refreshNotebooks();
  }, [refreshNotebooks]);

  const activeNotebook = useMemo(() => {
    return (notebooks && notebooks.find(n => n.id === activeNotebookId)) || notebooks?.[0] || null;
  }, [notebooks, activeNotebookId]);

  // Words available to add to a new Headlist (unstudied or starred words)
  const candidateWords = useMemo(() => {
    return words.filter(w => !w.learned || w.starred);
  }, [words]);

  const handleSelectWordToggle = (id: string) => {
    setSelectedWordIdsForNew(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 25) next.add(id); // Goldlist recommendation: 20-25 terms
      return next;
    });
  };

  const handleCreateNotebook = () => {
    const selectedWords = words.filter(w => selectedWordIdsForNew.has(w.id));
    if (selectedWords.length === 0) return;

    const newBook = createNewGoldlistNotebook(
      selectedWords,
      targetLanguage,
      nativeLanguage,
      newNotebookTitle.trim() || undefined
    );

    refreshNotebooks();
    setActiveNotebookId(newBook.id);
    setIsCreatingNew(false);
    setSelectedWordIdsForNew(new Set());
    setNewNotebookTitle("");
  };

  const handleAutoSelectBatch = (count: number = 20) => {
    const selected = new Set<string>();
    for (const w of candidateWords) {
      if (selected.size >= count) break;
      selected.add(w.id);
    }
    setSelectedWordIdsForNew(selected);
  };

  const handleDeleteNotebook = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = notebooks.filter(n => n.id !== id);
    saveGoldlistNotebooks(updated);
    setNotebooks(updated);
    if (activeNotebookId === id) {
      setActiveNotebookId(updated[0]?.id || null);
    }
  };

  const speak = (text: string) => {
    if (!text) return;
    speakText(text, ttsConfig, llmConfig, targetLanguage);
  };

  // Start Distillation Check
  const handleStartDistillation = (tierIndex: number) => {
    setDistillationTierIndex(tierIndex);
    setRetainedWordIds(new Set());
    setIsDistilling(true);
  };

  const handleToggleRetainedWord = (wordId: string) => {
    setRetainedWordIds(prev => {
      const next = new Set(prev);
      if (next.has(wordId)) next.delete(wordId);
      else next.add(wordId);
      return next;
    });
  };

  const handleCompleteDistillation = () => {
    if (!activeNotebook) return;
    const updated = processDistillation(activeNotebook.id, distillationTierIndex, Array.from(retainedWordIds));
    if (updated) {
      refreshNotebooks();
    }
    setIsDistilling(false);
  };

  return (
    <div className="space-y-6">
      {/* Top Header & Overview */}
      <div className="bg-white border border-stone-200 p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-md bg-amber-100 text-amber-900 flex items-center justify-center font-bold text-xs font-serif">
              1
            </span>
            <h3 className="text-lg font-bold text-stone-900">The Goldlist Method</h3>
            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200 font-semibold">
              Subconscious Long-Term Retention
            </span>
          </div>
          <p className="text-xs sm:text-sm text-stone-600 max-w-2xl leading-relaxed">
            Developed by polyglot David James: Write a Headlist of 20–25 words, read aloud calmly once, then wait 14 days. 
            Without stress or testing, your subconscious mind naturally retains ~30%. Distill the remaining 70% into the next tier.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setIsCreatingNew(true);
            handleAutoSelectBatch(20);
          }}
          className="px-4 py-2.5 rounded-lg bg-stone-900 hover:bg-stone-850 text-amber-300 hover:text-amber-200 font-bold text-xs flex items-center gap-2 transition-all cursor-pointer shadow-xs shrink-0 self-start md:self-center"
        >
          <Plus className="w-4 h-4" />
          <span>New Goldlist Headlist</span>
        </button>
      </div>

      {/* Main Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Notebooks Sidebar */}
        <div className="lg:col-span-1 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold uppercase tracking-wider text-stone-500 font-mono">
              Your Goldlists ({notebooks.length})
            </h4>
          </div>

          <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
            {notebooks.map((b) => {
              const isSelected = b.id === activeNotebook?.id;
              const completedCount = b.tiers.filter(t => t.testedAt).length;
              return (
                <div
                  key={b.id}
                  onClick={() => setActiveNotebookId(b.id)}
                  className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between gap-2 group ${
                    isSelected
                      ? "bg-amber-50/70 border-amber-300 shadow-xs"
                      : "bg-white hover:bg-stone-50 border-stone-200"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <BookMarked className={`w-4 h-4 ${isSelected ? "text-amber-700" : "text-stone-400"}`} />
                      <h5 className="text-xs font-bold text-stone-900 line-clamp-1">{b.title}</h5>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => handleDeleteNotebook(b.id, e)}
                      className="opacity-0 group-hover:opacity-100 text-stone-400 hover:text-rose-600 transition-opacity p-1"
                      title="Delete notebook"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="flex items-center justify-between text-[10px] text-stone-500 font-mono">
                    <span>{b.headlistWords.length} words</span>
                    <span>{completedCount}/{b.tiers.length} Tiers</span>
                    <span className={`px-1.5 py-0.5 rounded font-semibold ${
                      b.status === "completed" ? "bg-emerald-100 text-emerald-800" : "bg-stone-100 text-stone-700"
                    }`}>
                      {b.status === "completed" ? "Mastered" : `Tier ${b.tiers.length - 1}`}
                    </span>
                  </div>
                </div>
              );
            })}

            {notebooks.length === 0 && (
              <div className="p-6 text-center border border-dashed border-stone-300 rounded-xl space-y-2 bg-stone-50/50">
                <BookOpen className="w-8 h-8 text-stone-400 mx-auto" />
                <p className="text-xs text-stone-500 font-medium">No Goldlists created yet.</p>
                <button
                  type="button"
                  onClick={() => {
                    setIsCreatingNew(true);
                    handleAutoSelectBatch(20);
                  }}
                  className="text-xs text-stone-900 font-bold underline cursor-pointer"
                >
                  Create your first Headlist
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Notebook Content / Active Tier Display */}
        <div className="lg:col-span-3 space-y-5">
          {activeNotebook ? (
            <div className="bg-white border border-stone-200 rounded-xl overflow-hidden shadow-xs">
              {/* Notebook Header Bar */}
              <div className="p-4 sm:p-5 border-b border-stone-100 bg-stone-50/70 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base sm:text-lg font-bold text-stone-950">{activeNotebook.title}</h3>
                    <span className="text-[10px] font-mono font-bold bg-amber-100 text-amber-900 px-2 py-0.5 rounded">
                      Created {new Date(activeNotebook.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="text-xs text-stone-500 mt-0.5">
                    {activeNotebook.headlistWords.length} terms in Headlist • {activeNotebook.targetLanguage} ↔ {activeNotebook.nativeLanguage}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setCalmCurrentWordIndex(0);
                      setIsCalmMode(true);
                    }}
                    className="px-3 py-1.5 rounded-lg bg-white border border-stone-200 hover:bg-stone-50 text-stone-800 text-xs font-bold flex items-center gap-1.5 shadow-2xs transition-all cursor-pointer"
                    title="Calmly read and listen to the words once without testing"
                  >
                    <Volume2 className="w-3.5 h-3.5 text-amber-600" />
                    <span>Calm Imprint Mode</span>
                  </button>
                </div>
              </div>

              {/* Tiers & Distillations Timeline */}
              <div className="p-4 sm:p-6 space-y-6">
                {activeNotebook.tiers.map((tier, tIdx) => {
                  const tierWordObjects = tier.wordIds.map(id => activeNotebook.headlistWords.find(w => w.id === id)).filter(Boolean) as Word[];
                  const now = new Date();
                  const gestationDate = new Date(tier.gestationUntilDate);
                  const daysLeft = Math.ceil((gestationDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
                  const isGestationDone = daysLeft <= 0;

                  return (
                    <div 
                      key={tier.tierNumber} 
                      className={`border rounded-xl p-4 sm:p-5 space-y-4 transition-all ${
                        tIdx === activeNotebook.tiers.length - 1
                          ? "border-amber-300 bg-amber-50/20 shadow-2xs"
                          : "border-stone-200 bg-stone-50/30 opacity-90"
                      }`}
                    >
                      {/* Tier Header */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-stone-200/80">
                        <div className="flex items-center gap-2.5">
                          <span className="w-7 h-7 rounded-lg bg-stone-900 text-amber-400 flex items-center justify-center font-bold text-xs font-mono shadow-2xs">
                            {tier.tierNumber === 0 ? "H" : `D${tier.tierNumber}`}
                          </span>
                          <div>
                            <h4 className="text-sm font-bold text-stone-900">{tier.title}</h4>
                            <span className="text-[11px] text-stone-500 font-mono">
                              {tierWordObjects.length} terms ({Math.round((tierWordObjects.length / activeNotebook.headlistWords.length) * 100)}% of headlist)
                            </span>
                          </div>
                        </div>

                        {/* Status / Distill Button */}
                        <div className="flex items-center gap-2">
                          {tier.testedAt ? (
                            <div className="flex items-center gap-1.5 text-emerald-800 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-md text-xs font-semibold">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>Tested: {tier.retainedWordIds?.length || 0} Retained ({Math.round(((tier.retainedWordIds?.length || 0) / tierWordObjects.length) * 100)}%)</span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <div className="flex items-center gap-1 text-xs font-mono text-stone-600 bg-white border border-stone-200 px-2.5 py-1 rounded-md">
                                <Clock className="w-3.5 h-3.5 text-amber-600" />
                                <span>{isGestationDone ? "14-day Gestation Complete" : `${daysLeft} days gestation left`}</span>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleStartDistillation(tIdx)}
                                className="px-3 py-1 rounded-md bg-stone-900 hover:bg-black text-amber-300 text-xs font-bold flex items-center gap-1 shadow-xs transition-all cursor-pointer"
                                title="Test subconscious memory and distill remaining ~70%"
                              >
                                <Sparkles className="w-3.5 h-3.5" />
                                <span>Distill (Recall Test)</span>
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Words Grid inside Tier */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                        {tierWordObjects.map((w, wIdx) => {
                          const isRetained = tier.retainedWordIds?.includes(w.id);
                          return (
                            <div
                              key={w.id}
                              className={`p-2.5 rounded-lg border text-xs flex items-center justify-between gap-2 transition-colors ${
                                isRetained
                                  ? "bg-emerald-50/80 border-emerald-200 text-emerald-950"
                                  : "bg-white border-stone-200 text-stone-800"
                              }`}
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[10px] font-mono text-stone-400 font-bold">{wIdx + 1}.</span>
                                  <span className="font-bold truncate">{w.word}</span>
                                </div>
                                <p className="text-[11px] text-stone-500 truncate">{w.translation}</p>
                              </div>
                              <button
                                type="button"
                                onClick={() => speak(w.word)}
                                className="p-1 text-stone-400 hover:text-stone-900 transition-colors"
                                title="Listen audio"
                              >
                                <Volume2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="bg-white border border-stone-200 rounded-xl p-12 text-center space-y-3">
              <BookOpen className="w-12 h-12 text-stone-400 mx-auto" />
              <h4 className="text-base font-bold text-stone-900">Select or Create a Goldlist Notebook</h4>
              <p className="text-xs text-stone-500 max-w-md mx-auto">
                The Goldlist method replaces stressful testing with relaxed 14-day cycles. Create a list of 20–25 words to begin.
              </p>
              <button
                type="button"
                onClick={() => {
                  setIsCreatingNew(true);
                  handleAutoSelectBatch(20);
                }}
                className="px-5 py-2.5 rounded-lg bg-stone-900 text-amber-300 font-bold text-xs inline-flex items-center gap-2 cursor-pointer"
              >
                <Plus className="w-4 h-4" /> Create Headlist
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Modal: Create New Goldlist Headlist */}
      <AnimatePresence>
        {isCreatingNew && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-stone-900/60 backdrop-blur-xs flex items-center justify-center p-4"
          >
            <div className="bg-white rounded-2xl max-w-xl w-full p-5 sm:p-6 space-y-4 shadow-2xl border border-stone-200 max-h-[90vh] flex flex-col">
              <div className="flex items-center justify-between pb-2 border-b border-stone-100">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-900 flex items-center justify-center font-bold font-serif text-sm">
                    G
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-stone-900">Create New Goldlist Headlist</h3>
                    <p className="text-xs text-stone-500">Pick 20–25 terms for relaxed 14-day subconscious retention</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsCreatingNew(false)}
                  className="text-stone-400 hover:text-stone-700 text-sm font-bold p-1 cursor-pointer"
                >
                  ✕
                </button>
              </div>

              {/* Title input */}
              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  Notebook Title (Optional)
                </label>
                <input
                  type="text"
                  value={newNotebookTitle}
                  onChange={(e) => setNewNotebookTitle(e.target.value)}
                  placeholder="e.g. Goldlist #1 (Core Vocabulary)"
                  className="w-full text-xs px-3 py-2 rounded-lg border border-stone-200 focus:border-stone-900 outline-none"
                />
              </div>

              {/* Word Selection Bar */}
              <div className="flex items-center justify-between text-xs pt-1">
                <span className="font-semibold text-stone-700">
                  Selected: <strong className="text-stone-950 font-mono text-sm">{selectedWordIdsForNew.size}</strong> / 25 recommended
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleAutoSelectBatch(20)}
                    className="text-xs text-amber-700 hover:text-amber-900 font-bold cursor-pointer"
                  >
                    Select Next 20
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedWordIdsForNew(new Set())}
                    className="text-xs text-stone-500 hover:text-stone-800 cursor-pointer"
                  >
                    Clear
                  </button>
                </div>
              </div>

              {/* Words Checkable List */}
              <div className="flex-1 overflow-y-auto space-y-1.5 border border-stone-100 rounded-xl p-2 max-h-64 divide-y divide-stone-100">
                {candidateWords.map((w) => {
                  const isChecked = selectedWordIdsForNew.has(w.id);
                  return (
                    <div
                      key={w.id}
                      onClick={() => handleSelectWordToggle(w.id)}
                      className={`p-2 rounded-lg text-xs flex items-center justify-between gap-3 cursor-pointer transition-colors ${
                        isChecked ? "bg-amber-50 text-amber-950 font-semibold" : "hover:bg-stone-50 text-stone-700"
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {}}
                          className="rounded border-stone-300 text-stone-900 focus:ring-0 cursor-pointer"
                        />
                        <span className="font-bold">{w.word}</span>
                        <span className="text-stone-400 font-normal truncate">({w.translation})</span>
                      </div>
                      <span className="text-[10px] font-mono text-stone-400 shrink-0">{w.partOfSpeech}</span>
                    </div>
                  );
                })}
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-stone-100">
                <button
                  type="button"
                  onClick={() => setIsCreatingNew(false)}
                  className="px-4 py-2 rounded-lg border border-stone-200 hover:bg-stone-100 text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={selectedWordIdsForNew.size === 0}
                  onClick={handleCreateNotebook}
                  className="px-5 py-2 rounded-lg bg-stone-900 hover:bg-black text-amber-300 font-bold text-xs disabled:opacity-50 transition-all cursor-pointer"
                >
                  Create Headlist ({selectedWordIdsForNew.size} words)
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modal: Calm Imprinting Mode (Step-by-step relaxed reading with audio) */}
      <AnimatePresence>
        {isCalmMode && activeNotebook && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-stone-950/80 backdrop-blur-sm flex items-center justify-center p-4"
          >
            <div className="bg-white rounded-3xl max-w-xl w-full p-6 sm:p-8 space-y-6 shadow-2xl border border-stone-200 text-center relative">
              <button
                type="button"
                onClick={() => {
                  stopSpeech();
                  setIsCalmMode(false);
                }}
                className="absolute top-4 right-4 text-stone-400 hover:text-stone-900 text-lg font-bold p-1 cursor-pointer"
              >
                ✕
              </button>

              <div className="space-y-1">
                <span className="text-[11px] font-mono uppercase tracking-widest text-amber-700 bg-amber-50 px-2.5 py-1 rounded-full font-bold">
                  Calm Subconscious Imprinting
                </span>
                <p className="text-xs text-stone-500 font-serif italic pt-1">
                  Read aloud once calmly and slowly, listen to the pronunciation, then move on without trying to force memorization.
                </p>
              </div>

              {/* Word Display */}
              {activeNotebook.headlistWords[calmCurrentWordIndex] && (
                <div className="py-6 space-y-4 border-y border-stone-100">
                  <div className="text-3xl sm:text-4xl font-black text-stone-950 font-serif">
                    {activeNotebook.headlistWords[calmCurrentWordIndex].word}
                  </div>
                  <p className="text-xs font-mono text-stone-400">
                    {activeNotebook.headlistWords[calmCurrentWordIndex].pronunciation || ""} • {activeNotebook.headlistWords[calmCurrentWordIndex].partOfSpeech}
                  </p>
                  <p className="text-lg text-amber-900 font-serif font-bold">
                    "{activeNotebook.headlistWords[calmCurrentWordIndex].translation}"
                  </p>
                  {activeNotebook.headlistWords[calmCurrentWordIndex].example && (
                    <p className="text-xs text-stone-600 max-w-md mx-auto italic">
                      "{activeNotebook.headlistWords[calmCurrentWordIndex].example}"
                    </p>
                  )}

                  <button
                    type="button"
                    onClick={() => speak(activeNotebook.headlistWords[calmCurrentWordIndex].word)}
                    className="p-3 rounded-full bg-amber-100 hover:bg-amber-200 text-amber-950 transition-colors mx-auto cursor-pointer shadow-xs"
                    title="Listen pronunciation"
                  >
                    <Volume2 className="w-5 h-5" />
                  </button>
                </div>
              )}

              {/* Bottom Nav */}
              <div className="flex items-center justify-between text-xs font-semibold text-stone-600">
                <button
                  type="button"
                  disabled={calmCurrentWordIndex === 0}
                  onClick={() => {
                    const next = calmCurrentWordIndex - 1;
                    setCalmCurrentWordIndex(next);
                    speak(activeNotebook.headlistWords[next]?.word);
                  }}
                  className="px-4 py-2 rounded-lg border border-stone-200 hover:bg-stone-50 disabled:opacity-30 cursor-pointer"
                >
                  Previous
                </button>

                <span className="font-mono text-xs text-stone-400">
                  {calmCurrentWordIndex + 1} of {activeNotebook.headlistWords.length}
                </span>

                {calmCurrentWordIndex < activeNotebook.headlistWords.length - 1 ? (
                  <button
                    type="button"
                    onClick={() => {
                      const next = calmCurrentWordIndex + 1;
                      setCalmCurrentWordIndex(next);
                      speak(activeNotebook.headlistWords[next]?.word);
                    }}
                    className="px-5 py-2 rounded-lg bg-stone-900 text-amber-300 hover:bg-black font-bold cursor-pointer"
                  >
                    Next Word
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      stopSpeech();
                      setIsCalmMode(false);
                    }}
                    className="px-5 py-2 rounded-lg bg-emerald-700 text-white hover:bg-emerald-800 font-bold cursor-pointer"
                  >
                    Done! Close Notebook
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modal: Distillation Tester (Check subconscious recall after gestation) */}
      <AnimatePresence>
        {isDistilling && activeNotebook && activeNotebook.tiers[distillationTierIndex] && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-stone-900/60 backdrop-blur-xs flex items-center justify-center p-4"
          >
            <div className="bg-white rounded-2xl max-w-xl w-full p-6 space-y-4 shadow-2xl border border-stone-200 max-h-[90vh] flex flex-col">
              <div className="flex items-center justify-between pb-2 border-b border-stone-100">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-amber-600" />
                  <div>
                    <h3 className="text-base font-bold text-stone-900">Distillation Recall Check</h3>
                    <p className="text-xs text-stone-500">Check off the words you effortlessly recognize. The rest (~70%) will distill into the next tier.</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsDistilling(false)}
                  className="text-stone-400 hover:text-stone-700 text-sm font-bold p-1 cursor-pointer"
                >
                  ✕
                </button>
              </div>

              {/* Progress Summary */}
              <div className="bg-amber-50/80 p-3 rounded-xl border border-amber-200/80 flex items-center justify-between text-xs text-amber-950 font-semibold">
                <span>Retained: {retainedWordIds.size} words</span>
                <span>To Distill to Next Tier: {activeNotebook.tiers[distillationTierIndex].wordIds.length - retainedWordIds.size} words</span>
              </div>

              {/* Words Check List */}
              <div className="flex-1 overflow-y-auto space-y-1.5 border border-stone-100 rounded-xl p-2 max-h-72 divide-y divide-stone-100">
                {activeNotebook.tiers[distillationTierIndex].wordIds.map(id => {
                  const w = activeNotebook.headlistWords.find(item => item.id === id);
                  if (!w) return null;
                  const isChecked = retainedWordIds.has(w.id);
                  return (
                    <div
                      key={w.id}
                      onClick={() => handleToggleRetainedWord(w.id)}
                      className={`p-2.5 rounded-lg text-xs flex items-center justify-between gap-3 cursor-pointer transition-colors ${
                        isChecked ? "bg-emerald-50 text-emerald-950 font-bold" : "hover:bg-stone-50 text-stone-700"
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {}}
                          className="rounded border-stone-300 text-emerald-600 focus:ring-0 cursor-pointer"
                        />
                        <span className="font-bold">{w.word}</span>
                        <span className="text-stone-400 font-normal">→ {w.translation}</span>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          speak(w.word);
                        }}
                        className="p-1 text-stone-400 hover:text-stone-900"
                      >
                        <Volume2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-stone-100">
                <button
                  type="button"
                  onClick={() => setIsDistilling(false)}
                  className="px-4 py-2 rounded-lg border border-stone-200 text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleCompleteDistillation}
                  className="px-5 py-2 rounded-lg bg-stone-900 hover:bg-black text-amber-300 font-bold text-xs cursor-pointer shadow-xs"
                >
                  Complete Distillation ({retainedWordIds.size} Retained / {activeNotebook.tiers[distillationTierIndex].wordIds.length - retainedWordIds.size} Distilled)
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
