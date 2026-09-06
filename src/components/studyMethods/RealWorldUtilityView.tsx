import React, { useState, useEffect } from "react";
import { 
  Tag, 
  Sparkles, 
  Printer, 
  Volume2, 
  ShoppingCart, 
  CheckSquare, 
  Smartphone, 
  RotateCcw 
} from "lucide-react";
import { Word, StickyNoteItem, RealWorldUtilityList, TTSConfig, LLMConfig } from "../../types";
import { 
  generateStickyNotesService, 
  generateRealWorldListService 
} from "../../services/studyMethodsService";
import { speakText } from "../../utils/ttsService";

interface RealWorldUtilityViewProps {
  words: Word[];
  targetLanguage: string;
  nativeLanguage: string;
  appLanguage?: string;
  ttsConfig?: TTSConfig;
  llmConfig?: LLMConfig;
  onUpdateWords?: (updated: Word[]) => void;
}

export default function RealWorldUtilityView({
  words,
  targetLanguage,
  nativeLanguage,
  appLanguage: _appLanguage = "Vietnamese",
  ttsConfig,
  llmConfig,
  onUpdateWords: _onUpdateWords
}: RealWorldUtilityViewProps) {
  const [activeTab, setActiveTab] = useState<"sticky" | "grocery" | "todo" | "device">("sticky");

  // Sticky Notes State
  const [stickyNotes, setStickyNotes] = useState<StickyNoteItem[]>([]);
  const [isGeneratingSticky, setIsGeneratingSticky] = useState(false);
  const [selectedRoomTheme, setSelectedRoomTheme] = useState("Kitchen & Dining");

  // Utility Lists State
  const [utilityList, setUtilityList] = useState<RealWorldUtilityList | null>(null);
  const [isGeneratingList, setIsGeneratingList] = useState(false);

  useEffect(() => {
    // Generate initial sticky notes from words
    if (words.length > 0 && stickyNotes.length === 0) {
      handleGenerateStickyNotes();
    }
  }, [words]);

  const speak = (text: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!text) return;
    speakText(text, ttsConfig, llmConfig, targetLanguage);
  };

  const handleGenerateStickyNotes = async () => {
    setIsGeneratingSticky(true);
    try {
      const candidates = words.slice(0, 12);
      const notes = await generateStickyNotesService({
        words: candidates,
        targetLanguage,
        nativeLanguage,
        roomTheme: selectedRoomTheme,
        cfg: llmConfig
      });
      setStickyNotes(notes);
    } catch (e) {
      console.error("Sticky notes generation failed:", e);
    } finally {
      setIsGeneratingSticky(false);
    }
  };

  const handleGenerateUtilityList = async (type: "grocery" | "todo" | "device_ui") => {
    setIsGeneratingList(true);
    try {
      const list = await generateRealWorldListService({
        type,
        targetWords: words.slice(0, 8),
        targetLanguage,
        nativeLanguage,
        cfg: llmConfig
      });
      setUtilityList(list);
    } catch (e) {
      console.error("Utility list generation failed:", e);
    } finally {
      setIsGeneratingList(false);
    }
  };

  const handleToggleItemCheck = (idx: number) => {
    if (!utilityList) return;
    const updated = {
      ...utilityList,
      items: utilityList.items.map((item, i) => i === idx ? { ...item, checked: !item.checked } : item)
    };
    setUtilityList(updated);
  };

  const handlePrintStickyNotes = () => {
    window.print();
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="bg-white border border-stone-200 p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-md bg-rose-100 text-rose-900 flex items-center justify-center font-bold text-xs font-serif">
              5
            </span>
            <h3 className="text-lg font-bold text-stone-900">Physical Environment & Real-World Utility</h3>
            <span className="text-xs px-2 py-0.5 rounded-full bg-rose-50 text-rose-800 border border-rose-200 font-semibold">
              Labeling Objects & Functional Immersion
            </span>
          </div>
          <p className="text-xs sm:text-sm text-stone-600 max-w-2xl leading-relaxed">
            Bridge digital learning into the physical world. Generate cuttable Post-it sticky notes for household items, 
            supermarket grocery checklists in {targetLanguage}, and device UI glossaries.
          </p>
        </div>

        {/* Sub-tab Navigation */}
        <div className="flex bg-stone-100 p-1 rounded-lg border border-stone-200 shrink-0 self-start md:self-center">
          <button
            type="button"
            onClick={() => setActiveTab("sticky")}
            className={`px-3 py-1.5 text-xs font-bold rounded-md flex items-center gap-1.5 transition-all cursor-pointer ${
              activeTab === "sticky" ? "bg-white text-stone-950 shadow-xs" : "text-stone-600 hover:text-stone-950"
            }`}
          >
            <Tag className="w-3.5 h-3.5 text-rose-600" />
            <span>Sticky Notes Sheet</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab("grocery");
              handleGenerateUtilityList("grocery");
            }}
            className={`px-3 py-1.5 text-xs font-bold rounded-md flex items-center gap-1.5 transition-all cursor-pointer ${
              activeTab === "grocery" ? "bg-white text-stone-950 shadow-xs" : "text-stone-600 hover:text-stone-950"
            }`}
          >
            <ShoppingCart className="w-3.5 h-3.5 text-amber-600" />
            <span>Grocery List</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab("todo");
              handleGenerateUtilityList("todo");
            }}
            className={`px-3 py-1.5 text-xs font-bold rounded-md flex items-center gap-1.5 transition-all cursor-pointer ${
              activeTab === "todo" ? "bg-white text-stone-950 shadow-xs" : "text-stone-600 hover:text-stone-950"
            }`}
          >
            <CheckSquare className="w-3.5 h-3.5 text-emerald-600" />
            <span>Daily To-Do</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab("device");
              handleGenerateUtilityList("device_ui");
            }}
            className={`px-3 py-1.5 text-xs font-bold rounded-md flex items-center gap-1.5 transition-all cursor-pointer ${
              activeTab === "device" ? "bg-white text-stone-950 shadow-xs" : "text-stone-600 hover:text-stone-950"
            }`}
          >
            <Smartphone className="w-3.5 h-3.5 text-sky-600" />
            <span>Phone UI Cheat-Sheet</span>
          </button>
        </div>
      </div>

      {/* Tab 1: Printable Sticky Notes Sheet */}
      {activeTab === "sticky" && (
        <div className="space-y-4">
          {/* Sticky Notes Controls */}
          <div className="bg-white border border-stone-200 p-4 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
            <div className="flex items-center gap-3">
              <label className="text-xs font-bold text-stone-700">Room Focus:</label>
              <select
                value={selectedRoomTheme}
                onChange={(e) => setSelectedRoomTheme(e.target.value)}
                className="text-xs font-semibold p-1.5 rounded-lg border border-stone-200 bg-white"
              >
                <option value="Kitchen & Dining">Kitchen & Dining (Microwave, Fridge, Coffee Maker)</option>
                <option value="Living Room & Workspace">Living Room & Workspace (Desk, Monitor, Sofa)</option>
                <option value="Bathroom & Mirror">Bathroom & Vanity (Mirror, Shower, Sink)</option>
                <option value="Bedroom & Closet">Bedroom & Wardrobe (Bed, Closet, Lamp)</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={isGeneratingSticky}
                onClick={handleGenerateStickyNotes}
                className="px-3 py-1.5 rounded-lg bg-white border border-stone-200 hover:bg-stone-50 text-stone-800 text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                <span>Regenerate Labels</span>
              </button>

              <button
                type="button"
                onClick={handlePrintStickyNotes}
                className="px-4 py-1.5 rounded-lg bg-stone-900 hover:bg-black text-amber-300 font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer shadow-xs"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Print Sticky Sheets</span>
              </button>
            </div>
          </div>

          {/* Printable Sticky Notes Grid (A4 / Letter 2x3 Grid Layout) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 print:grid-cols-2 print:gap-6 print:m-0">
            {stickyNotes.map((note) => (
              <div
                key={note.id}
                className="p-5 rounded-2xl border-2 border-dashed border-amber-300 bg-gradient-to-br from-amber-50 via-yellow-50 to-amber-50 shadow-xs relative flex flex-col justify-between gap-3 text-stone-900 group"
              >
                {/* Sticky Tape Graphic Accent */}
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 w-16 h-5 bg-yellow-200/80 border border-yellow-300/60 rounded-xs shadow-2xs rotate-1" />

                <div className="pt-2 space-y-2">
                  {/* Affix Location Tag */}
                  <div className="flex items-center justify-between text-[10px] font-mono font-bold text-amber-900 uppercase">
                    <span className="bg-amber-200/80 px-2 py-0.5 rounded-full">
                      📍 {note.roomAffixLocation}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => speak(note.word, e)}
                      className="p-1 text-amber-800 hover:text-amber-950 print:hidden"
                    >
                      <Volume2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Target Word Display */}
                  <div className="text-center py-2 space-y-0.5">
                    <h4 className="text-2xl font-black font-serif text-stone-950 tracking-tight">
                      {note.word}
                    </h4>
                    <p className="text-xs font-mono text-stone-500 font-semibold">
                      {note.pronunciation || ""} • {note.partOfSpeech}
                    </p>
                    <p className="text-sm font-serif font-bold text-amber-950 pt-1">
                      "{note.translation}"
                    </p>
                  </div>

                  {/* Micro-Context Sentence */}
                  <p className="text-xs font-serif italic text-stone-700 text-center bg-white/60 p-2 rounded-lg border border-amber-200/60 leading-relaxed">
                    "{note.contextSentence}"
                  </p>
                </div>

                {/* Practical Tip */}
                {note.tips && (
                  <p className="text-[10px] text-amber-800/90 text-center font-mono border-t border-amber-200/60 pt-2">
                    💡 {note.tips}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab 2, 3, 4: Real-World Utility Lists (Grocery, To-Do, Device UI) */}
      {activeTab !== "sticky" && (
        <div className="max-w-2xl mx-auto bg-white border border-stone-200 rounded-2xl p-6 sm:p-8 space-y-5 shadow-xs">
          {utilityList ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-stone-100">
                <div>
                  <h4 className="text-base font-bold text-stone-900">{utilityList.title}</h4>
                  <p className="text-xs text-stone-500">
                    Authentic real-world language immersion list in {targetLanguage}
                  </p>
                </div>

                <button
                  type="button"
                  disabled={isGeneratingList}
                  onClick={() => handleGenerateUtilityList(utilityList.type as any)}
                  className="p-2 rounded-lg border border-stone-200 hover:bg-stone-50 text-stone-600 text-xs font-semibold flex items-center gap-1 cursor-pointer disabled:opacity-50"
                >
                  <RotateCcw className={`w-3.5 h-3.5 ${isGeneratingList ? "animate-spin" : ""}`} />
                  <span>{isGeneratingList ? "Generating..." : "Refresh"}</span>
                </button>
              </div>

              {/* Items Checklist */}
              <div className="space-y-2">
                {utilityList.items.map((item, idx) => (
                  <div
                    key={idx}
                    onClick={() => handleToggleItemCheck(idx)}
                    className={`p-3 rounded-xl border text-xs flex items-center justify-between gap-3 cursor-pointer transition-all ${
                      item.checked
                        ? "bg-emerald-50/70 border-emerald-200 text-emerald-950 line-through opacity-70"
                        : "bg-stone-50/50 hover:bg-stone-50 border-stone-200 text-stone-900"
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <input
                        type="checkbox"
                        checked={Boolean(item.checked)}
                        onChange={() => {}}
                        className="rounded border-stone-300 text-emerald-600 focus:ring-0 cursor-pointer"
                      />
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-sm font-serif">{item.targetText}</span>
                          {item.phonetic && (
                            <span className="text-[10px] font-mono text-stone-400">({item.phonetic})</span>
                          )}
                        </div>
                        <p className="text-[11px] text-stone-500 font-serif">"{item.nativeText}"</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {item.category && (
                        <span className="text-[10px] font-mono bg-stone-200/60 px-2 py-0.5 rounded text-stone-600">
                          {item.category}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={(e) => speak(item.targetText, e)}
                        className="p-1 text-stone-400 hover:text-stone-900"
                      >
                        <Volume2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="py-12 text-center space-y-2 border border-dashed border-stone-200 rounded-xl">
              <ShoppingCart className="w-8 h-8 text-stone-300 mx-auto" />
              <p className="text-xs text-stone-500 font-medium">Generating real-world list...</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
