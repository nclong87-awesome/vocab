import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Volume2, 
  Plus, 
  Trash2, 
  Eye, 
  Wand2, 
  Maximize2 
} from "lucide-react";
import { Word, MemoryPalace, PalaceStation, TTSConfig, LLMConfig } from "../../types";
import { 
  getStoredMemoryPalaces, 
  assignWordToStation, 
  clearStationWord, 
  generateKeywordMnemonicService 
} from "../../services/studyMethodsService";
import { speakText, stopSpeech } from "../../utils/ttsService";

interface MemoryPalaceViewProps {
  words: Word[];
  targetLanguage: string;
  nativeLanguage: string;
  appLanguage?: string;
  ttsConfig?: TTSConfig;
  llmConfig?: LLMConfig;
  onUpdateWords?: (updated: Word[]) => void;
}

export default function MemoryPalaceView({
  words,
  targetLanguage,
  nativeLanguage,
  appLanguage: _appLanguage = "Vietnamese",
  ttsConfig,
  llmConfig,
  onUpdateWords: _onUpdateWords
}: MemoryPalaceViewProps) {
  const [palaces, setPalaces] = useState<MemoryPalace[]>([]);
  const [activePalaceId, setActivePalaceId] = useState<string>("palace_cozy_home");
  const [selectedStation, setSelectedStation] = useState<PalaceStation | null>(null);
  const [isWalkthroughMode, setIsWalkthroughMode] = useState(false);
  const [walkthroughIndex, setWalkthroughIndex] = useState(0);
  const [isGeneratingMnemonic, setIsGeneratingMnemonic] = useState(false);
  const [isAssigningWord, setIsAssigningWord] = useState(false);
  const [wordToAssign, setWordToAssign] = useState<Word | null>(null);
  const [revealRecallMeaning, setRevealRecallMeaning] = useState(false);

  useEffect(() => {
    const list = getStoredMemoryPalaces();
    setPalaces(list);
    if (list.length > 0 && !activePalaceId) {
      setActivePalaceId(list[0].id);
    }
  }, [activePalaceId]);

  const activePalace = palaces.find(p => p.id === activePalaceId) || palaces[0] || null;

  const speak = (text: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!text) return;
    speakText(text, ttsConfig, llmConfig, targetLanguage);
  };

  const handleOpenAssignModal = (station: PalaceStation) => {
    setSelectedStation(station);
    setIsAssigningWord(true);
    // Suggest first unassigned or starred word
    const assignedIds = new Set(activePalace?.stations.map(s => s.wordId).filter(Boolean));
    const firstFree = words.find(w => !assignedIds.has(w.id)) || words[0] || null;
    setWordToAssign(firstFree);
  };

  const handleGenerateAndAssignMnemonic = async () => {
    if (!activePalace || !selectedStation || !wordToAssign) return;

    setIsGeneratingMnemonic(true);
    try {
      const mnemonic = await generateKeywordMnemonicService({
        word: wordToAssign,
        targetLanguage,
        nativeLanguage,
        cfg: llmConfig
      });

      const updated = assignWordToStation(activePalace.id, selectedStation.id, wordToAssign, mnemonic);
      setPalaces(updated);
      setIsAssigningWord(false);
      setSelectedStation(null);
    } catch (e) {
      console.error("Failed to generate mnemonic:", e);
    } finally {
      setIsGeneratingMnemonic(false);
    }
  };

  const handleClearStation = (stationId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!activePalace) return;
    const updated = clearStationWord(activePalace.id, stationId);
    setPalaces(updated);
  };

  // Walkthrough tour logic
  const occupiedStations = activePalace?.stations.filter(s => s.word) || [];

  const handleStartWalkthrough = () => {
    if (occupiedStations.length === 0) return;
    setWalkthroughIndex(0);
    setRevealRecallMeaning(false);
    setIsWalkthroughMode(true);
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="bg-white border border-stone-200 p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-md bg-indigo-100 text-indigo-900 flex items-center justify-center font-bold text-xs font-serif">
              3
            </span>
            <h3 className="text-lg font-bold text-stone-900">Mnemonics & The Memory Palace</h3>
            <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-800 border border-indigo-200 font-semibold">
              Keyword Method & Method of Loci
            </span>
          </div>
          <p className="text-xs sm:text-sm text-stone-600 max-w-2xl leading-relaxed">
            Ancient Greek orators used spatial memory to memorize thousands of terms. 
            Pair difficult words with phonetic sound-alikes + absurd mental imagery, then place them in familiar rooms.
          </p>
        </div>

        <button
          type="button"
          disabled={occupiedStations.length === 0}
          onClick={handleStartWalkthrough}
          className="px-4 py-2.5 rounded-lg bg-stone-900 hover:bg-black text-amber-300 font-bold text-xs flex items-center gap-2 transition-all cursor-pointer shadow-xs disabled:opacity-40 shrink-0 self-start md:self-center"
        >
          <Maximize2 className="w-4 h-4 text-amber-400" />
          <span>Walk Through Palace ({occupiedStations.length} Anchors)</span>
        </button>
      </div>

      {/* Palace Environment Switcher Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
        {palaces.map((p) => {
          const isCurrent = p.id === activePalace?.id;
          const assignedCount = p.stations.filter(s => s.word).length;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => setActivePalaceId(p.id)}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold border flex items-center gap-2 transition-all cursor-pointer shrink-0 ${
                isCurrent
                  ? "bg-indigo-50 text-indigo-950 border-indigo-300 shadow-xs"
                  : "bg-white hover:bg-stone-50 text-stone-600 border-stone-200"
              }`}
            >
              <span>{p.theme === "home" ? "🏡" : p.theme === "cafe" ? "☕" : "🏛️"}</span>
              <span>{p.name}</span>
              <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full ${
                isCurrent ? "bg-indigo-200/80 text-indigo-950" : "bg-stone-100 text-stone-500"
              }`}>
                {assignedCount}/{p.stations.length}
              </span>
            </button>
          );
        })}
      </div>

      {/* Interactive Palace Stations Grid */}
      {activePalace && (
        <div className="space-y-4">
          <div className="flex items-center justify-between text-xs text-stone-500 px-1">
            <span>{activePalace.description}</span>
            <span className="font-mono">{occupiedStations.length} of {activePalace.stations.length} stations anchored</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {activePalace.stations.map((station) => {
              const isOccupied = Boolean(station.word);
              return (
                <div
                  key={station.id}
                  onClick={() => !isOccupied && handleOpenAssignModal(station)}
                  className={`p-4 rounded-2xl border transition-all relative flex flex-col justify-between gap-3 ${
                    isOccupied
                      ? "bg-white border-indigo-200 shadow-xs hover:border-indigo-400"
                      : "bg-stone-50/50 border-dashed border-stone-200 hover:border-stone-400 cursor-pointer"
                  }`}
                >
                  {/* Station Header */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xl p-2 rounded-xl bg-stone-100/80">{station.icon}</span>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-mono font-bold text-stone-400">
                            Station #{station.order}
                          </span>
                        </div>
                        <h4 className="text-xs font-bold text-stone-900 line-clamp-1">
                          {station.name}
                        </h4>
                      </div>
                    </div>

                    {isOccupied && (
                      <button
                        type="button"
                        onClick={(e) => handleClearStation(station.id, e)}
                        className="text-stone-300 hover:text-rose-600 transition-colors p-1"
                        title="Remove word from station"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {/* Station Body Content */}
                  {isOccupied ? (
                    <div className="space-y-2 bg-indigo-50/30 p-3 rounded-xl border border-indigo-100/60">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-base font-black text-stone-950 font-serif">
                            {station.word}
                          </span>
                          <button
                            type="button"
                            onClick={(e) => speak(station.word || "", e)}
                            className="p-1 text-stone-400 hover:text-stone-900"
                          >
                            <Volume2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <span className="text-xs font-serif font-bold text-indigo-900">
                          "{station.translation}"
                        </span>
                      </div>

                      {/* Absurd Mnemonic Story */}
                      {station.mnemonic && (
                        <div className="text-xs space-y-1 pt-1 border-t border-indigo-100/60">
                          <div className="flex items-center gap-1 text-[11px] text-indigo-800 font-semibold font-mono">
                            <span>🔑 Sound-alike:</span>
                            <span className="underline">{station.mnemonic.keywordSoundAlike}</span>
                          </div>
                          <p className="text-[11px] text-stone-600 italic leading-relaxed">
                            "{station.mnemonic.vividImageryStory}"
                          </p>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="py-4 text-center space-y-1">
                      <Plus className="w-5 h-5 text-stone-400 mx-auto" />
                      <p className="text-xs text-stone-500 font-medium">Empty Station</p>
                      <span className="text-[10px] text-indigo-600 font-bold hover:underline">
                        + Anchor Vocabulary Word
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Modal: Assign Word & Generate Absurd Mnemonic */}
      <AnimatePresence>
        {isAssigningWord && selectedStation && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-stone-900/60 backdrop-blur-xs flex items-center justify-center p-4"
          >
            <div className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl border border-stone-200">
              <div className="flex items-center justify-between pb-2 border-b border-stone-100">
                <div className="flex items-center gap-2">
                  <span className="text-xl">{selectedStation.icon}</span>
                  <div>
                    <h3 className="text-base font-bold text-stone-900">
                      Anchor Word at: {selectedStation.name}
                    </h3>
                    <p className="text-xs text-stone-500">
                      AI will generate a phonetic sound-alike & absurd mental movie
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsAssigningWord(false)}
                  className="text-stone-400 hover:text-stone-700 text-sm font-bold p-1 cursor-pointer"
                >
                  ✕
                </button>
              </div>

              {/* Word Selector */}
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-stone-700">
                  Select Word to Anchor
                </label>
                <select
                  value={wordToAssign?.id || ""}
                  onChange={(e) => {
                    const found = words.find(w => w.id === e.target.value) || null;
                    setWordToAssign(found);
                  }}
                  className="w-full text-xs p-2 rounded-lg border border-stone-200 bg-white"
                >
                  {words.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.word} — {w.translation} ({w.partOfSpeech})
                    </option>
                  ))}
                </select>
              </div>

              {wordToAssign && (
                <div className="p-3 bg-indigo-50/50 rounded-xl border border-indigo-100 text-xs space-y-1">
                  <div className="flex items-center justify-between font-bold text-stone-900">
                    <span className="font-serif text-sm">{wordToAssign.word}</span>
                    <span className="text-indigo-800">"{wordToAssign.translation}"</span>
                  </div>
                  {wordToAssign.definition && (
                    <p className="text-stone-500 italic text-[11px]">{wordToAssign.definition}</p>
                  )}
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-2 pt-3 border-t border-stone-100">
                <button
                  type="button"
                  onClick={() => setIsAssigningWord(false)}
                  className="px-4 py-2 rounded-lg border border-stone-200 text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!wordToAssign || isGeneratingMnemonic}
                  onClick={handleGenerateAndAssignMnemonic}
                  className="px-5 py-2 rounded-lg bg-stone-900 hover:bg-black text-amber-300 font-bold text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {isGeneratingMnemonic ? (
                    <>
                      <Wand2 className="w-3.5 h-3.5 animate-spin text-amber-400" />
                      <span>Inventing Absurd Mnemonic...</span>
                    </>
                  ) : (
                    <>
                      <Wand2 className="w-3.5 h-3.5 text-amber-400" />
                      <span>Generate Mnemonic & Place</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modal: Interactive Walkthrough Tour (Method of Loci Step-by-Step) */}
      <AnimatePresence>
        {isWalkthroughMode && occupiedStations.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-stone-950/85 backdrop-blur-md flex items-center justify-center p-4"
          >
            <div className="bg-white rounded-3xl max-w-lg w-full p-6 sm:p-8 space-y-6 shadow-2xl border border-stone-200 text-center relative">
              <button
                type="button"
                onClick={() => {
                  stopSpeech();
                  setIsWalkthroughMode(false);
                }}
                className="absolute top-4 right-4 text-stone-400 hover:text-stone-900 text-lg font-bold p-1 cursor-pointer"
              >
                ✕
              </button>

              {/* Station Step Indicator */}
              <div className="space-y-1">
                <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-indigo-700 bg-indigo-50 px-2.5 py-1 rounded-full">
                  Step {walkthroughIndex + 1} of {occupiedStations.length} • Memory Palace Walk
                </span>
                <h3 className="text-base sm:text-lg font-bold text-stone-900 pt-1 flex items-center justify-center gap-2">
                  <span>{occupiedStations[walkthroughIndex]?.icon}</span>
                  <span>{occupiedStations[walkthroughIndex]?.name}</span>
                </h3>
              </div>

              {/* Spatial Anchor Card */}
              {occupiedStations[walkthroughIndex] && (
                <div className="py-6 space-y-4 border-y border-stone-100">
                  <div className="text-3xl sm:text-4xl font-black text-stone-950 font-serif">
                    {occupiedStations[walkthroughIndex].word}
                  </div>

                  <div className="flex items-center justify-center gap-2">
                    <button
                      type="button"
                      onClick={() => speak(occupiedStations[walkthroughIndex].word || "")}
                      className="p-2 rounded-full bg-indigo-100 hover:bg-indigo-200 text-indigo-950 transition-colors cursor-pointer"
                    >
                      <Volume2 className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setRevealRecallMeaning(prev => !prev)}
                      className="px-3 py-1.5 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-800 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                    >
                      <Eye className="w-3.5 h-3.5 text-stone-600" />
                      <span>{revealRecallMeaning ? "Hide Meaning" : "Check Recall Meaning"}</span>
                    </button>
                  </div>

                  {/* Absurd Mnemonic Story Anchor */}
                  {occupiedStations[walkthroughIndex].mnemonic && (
                    <div className="bg-indigo-50/50 p-4 rounded-2xl border border-indigo-100 text-xs text-left space-y-2">
                      <div className="flex items-center gap-1.5 text-indigo-900 font-bold font-mono">
                        <span>🔑 Keyword Cue:</span>
                        <span className="underline">{occupiedStations[walkthroughIndex].mnemonic?.keywordSoundAlike}</span>
                      </div>
                      <p className="text-stone-700 font-serif italic text-xs leading-relaxed">
                        "{occupiedStations[walkthroughIndex].mnemonic?.vividImageryStory}"
                      </p>
                    </div>
                  )}

                  {/* Revealed Meaning */}
                  {revealRecallMeaning && (
                    <div className="text-xl font-bold font-serif text-indigo-900 animate-in fade-in">
                      "{occupiedStations[walkthroughIndex].translation}"
                    </div>
                  )}
                </div>
              )}

              {/* Bottom Nav */}
              <div className="flex items-center justify-between text-xs font-semibold">
                <button
                  type="button"
                  disabled={walkthroughIndex === 0}
                  onClick={() => {
                    setWalkthroughIndex(prev => prev - 1);
                    setRevealRecallMeaning(false);
                  }}
                  className="px-4 py-2 rounded-lg border border-stone-200 hover:bg-stone-50 disabled:opacity-30 cursor-pointer"
                >
                  Previous Station
                </button>

                {walkthroughIndex < occupiedStations.length - 1 ? (
                  <button
                    type="button"
                    onClick={() => {
                      setWalkthroughIndex(prev => prev + 1);
                      setRevealRecallMeaning(false);
                    }}
                    className="px-5 py-2 rounded-lg bg-stone-900 text-amber-300 hover:bg-black font-bold cursor-pointer"
                  >
                    Next Station →
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setIsWalkthroughMode(false)}
                    className="px-5 py-2 rounded-lg bg-emerald-700 text-white hover:bg-emerald-800 font-bold cursor-pointer"
                  >
                    Complete Palace Walk! 🎉
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
