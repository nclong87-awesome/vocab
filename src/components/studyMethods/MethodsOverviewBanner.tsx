import { useState } from "react";
import { Brain, Compass, HelpCircle, ChevronDown, ChevronUp, CheckCircle2 } from "lucide-react";
import { StudyMethodTab } from "../../types";

interface MethodsOverviewBannerProps {
  activeTab: StudyMethodTab;
  onSelectTab: (tab: StudyMethodTab) => void;
  appLanguage?: string;
}

export default function MethodsOverviewBanner({
  activeTab,
  onSelectTab
}: MethodsOverviewBannerProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const methodsList = [
    {
      id: "goldlist" as StudyMethodTab,
      name: "The Goldlist Method",
      badge: "Subconscious Memory",
      effort: "Low (Calm)",
      bestFor: "Large word volumes without testing stress",
      icon: "🌟",
      color: "border-amber-400 bg-amber-50/70 text-amber-950",
      description: "Write 20-25 words calmly into a Headlist. Wait 14 days for the subconscious mind to absorb them. Distill the 70% unremembered into next-tier notebooks."
    },
    {
      id: "immersion" as StudyMethodTab,
      name: "Contextual Immersion & Dual Reader",
      badge: "Comprehensible Input",
      effort: "Medium (Engaging)",
      bestFor: "Natural fluency & reading in context",
      icon: "📖",
      color: "border-sky-400 bg-sky-50/70 text-sky-950",
      description: "Read AI-graded stories containing 95% comprehensible phrasing and 5% target words. Click words for instant lookups and mine emotional sentences."
    },
    {
      id: "palace" as StudyMethodTab,
      name: "Mnemonics & The Memory Palace",
      badge: "Method of Loci",
      effort: "High (Creative)",
      bestFor: "Difficult or abstract terms",
      icon: "🏰",
      color: "border-indigo-400 bg-indigo-50/70 text-indigo-950",
      description: "Anchor phonetic sound-alikes to absurd, vivid mental images placed at spatial stations in familiar rooms (e.g. Living Room Sofa, Kitchen Fridge)."
    },
    {
      id: "wrap" as StudyMethodTab,
      name: "Deep Processing & WRAP Studio",
      badge: "Active Production",
      effort: "High (Mental)",
      bestFor: "Moving words from passive to active speech",
      icon: "⚡",
      color: "border-emerald-400 bg-emerald-50/70 text-emerald-950",
      description: "Write, Repeat, Associate with personal memories, and Picture. Create original sentences with real-time AI feedback and play conversational missions."
    },
    {
      id: "physical" as StudyMethodTab,
      name: "Physical Environment & Real-World Lists",
      badge: "Daily Utility",
      effort: "Low (Passive)",
      bestFor: "Household items, daily routines & groceries",
      icon: "🏷️",
      color: "border-rose-400 bg-rose-50/70 text-rose-950",
      description: "Generate printable Post-It sticky notes to label physical objects, create target-language grocery shopping lists, and master device UI settings."
    }
  ];

  return (
    <div className="bg-white border border-stone-200 shadow-xs mb-4">
      {/* Header Banner */}
      <div className="p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-stone-100 bg-gradient-to-r from-stone-900 via-stone-850 to-stone-900 text-white">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded-full bg-amber-400 text-stone-950 text-[10px] font-bold uppercase tracking-wider font-mono">
              Science-Backed Learning
            </span>
            <span className="text-xs text-stone-300 font-medium">Beyond Brute-Force Flashcards</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            <span>Modern Vocabulary Mastery Lab</span>
          </h2>
          <p className="text-xs sm:text-sm text-stone-300 max-w-2xl leading-relaxed">
            Flashcard drilling isolates words and can induce testing fatigue. Choose any of these 5 evidence-based cognitive strategies to encode words into deep, permanent memory.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setIsExpanded(prev => !prev)}
          className="self-start md:self-center px-3 py-1.5 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-200 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer border border-stone-700 shrink-0"
        >
          <HelpCircle className="w-3.5 h-3.5 text-amber-400" />
          <span>{isExpanded ? "Hide Comparison Matrix" : "Why These Methods Work"}</span>
          {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Quick Navigation Tabs */}
      <div className="grid grid-cols-2 sm:grid-cols-5 divide-x divide-y sm:divide-y-0 divide-stone-200 bg-stone-50/50">
        {methodsList.map((m) => {
          const isCurrent = activeTab === m.id;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => onSelectTab(m.id)}
              className={`p-3 text-left transition-all cursor-pointer flex flex-col justify-between gap-1 group relative ${
                isCurrent 
                  ? "bg-white shadow-xs" 
                  : "hover:bg-stone-100/80 text-stone-600"
              }`}
            >
              {isCurrent && (
                <div className="absolute top-0 left-0 right-0 h-1 bg-stone-900" />
              )}
              <div className="flex items-center justify-between gap-1">
                <span className="text-lg select-none">{m.icon}</span>
                <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded font-semibold ${
                  isCurrent ? "bg-stone-900 text-white" : "bg-stone-200/70 text-stone-600"
                }`}>
                  {m.effort}
                </span>
              </div>
              <div>
                <h4 className={`text-xs font-bold leading-tight ${isCurrent ? "text-stone-950" : "text-stone-700 group-hover:text-stone-950"}`}>
                  {m.name}
                </h4>
                <p className="text-[10px] text-stone-400 line-clamp-1 mt-0.5">
                  {m.badge}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Expanded Educational Matrix */}
      {isExpanded && (
        <div className="p-4 sm:p-6 bg-stone-50 border-t border-stone-200 space-y-4 text-xs text-stone-700 animate-in fade-in duration-200">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white p-3.5 border border-stone-200 rounded-lg space-y-1.5">
              <h5 className="font-bold text-stone-900 flex items-center gap-1.5 text-xs">
                <Brain className="w-4 h-4 text-amber-600" /> Why Flashcards Feel Boring
              </h5>
              <p className="text-stone-600 leading-relaxed">
                Brute-force testing triggers evaluation anxiety and relies on shallow rote recall. Without rich contextual, emotional, or spatial anchors, words feel isolated and quickly slip from memory.
              </p>
            </div>

            <div className="bg-white p-3.5 border border-stone-200 rounded-lg space-y-1.5">
              <h5 className="font-bold text-stone-900 flex items-center gap-1.5 text-xs">
                <Compass className="w-4 h-4 text-sky-600" /> The Multi-Track Solution
              </h5>
              <p className="text-stone-600 leading-relaxed">
                Polyglots mix low-stress gestation (Goldlist) with contextual reading (Immersion), spatial loci (Memory Palace), active writing (WRAP), and environmental cues (Sticky Notes).
              </p>
            </div>

            <div className="bg-white p-3.5 border border-stone-200 rounded-lg space-y-1.5">
              <h5 className="font-bold text-stone-900 flex items-center gap-1.5 text-xs">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" /> Recommended Strategy
              </h5>
              <p className="text-stone-600 leading-relaxed">
                Use <strong>Goldlist</strong> for 20+ words weekly, <strong>Stories</strong> for reading fluency, <strong>Memory Palace</strong> for the 10% hardest words, and <strong>WRAP</strong> to speak naturally!
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
