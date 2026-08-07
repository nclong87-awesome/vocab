import { useState, useMemo, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Search, X, ArrowUpDown, LayoutGrid } from "lucide-react";
import { LLMConfig, LLMProvider } from "../../types";
import { QuickActionsModelConfig, getQuickActionItems, getRotatedDefaultModel } from "./quickActionsConfig";

interface QuickActionsSectionProps {
  targetLanguage: string;
  nativeLanguage: string;
  llmConfig: LLMConfig;
  actionCounts: Record<string, number>;
  handleIncrementActionCount: (actionId: string) => void;
  handleResetActionCounts: () => void;
  onSendMessage: (text: string) => Promise<void>;
  onClearHistory: () => void;
  onAddWord: (word?: string, hint?: string) => void;
  onStartQuiz: () => void;
  onFixGrammar: () => void;
  onViewFlashcard?: () => void;
  onSuggestCasualReplyPrompt?: () => void;
  onSwitchProvider?: (provider: LLMProvider, model?: string) => void;
  showToast: (msg: string) => void;
  scrollToBottom: (behavior?: ScrollBehavior) => void;
  focusInput: () => void;
  setIsPhotoModalOpen: (open: boolean) => void;
  setSelectedImage: (img: { dataUrl: string; name: string } | null) => void;
}

export default function QuickActionsSection({
  targetLanguage,
  nativeLanguage,
  llmConfig,
  actionCounts,
  handleIncrementActionCount,
  handleResetActionCounts,
  onSendMessage,
  onClearHistory,
  onAddWord,
  onStartQuiz,
  onFixGrammar,
  onViewFlashcard,
  onSuggestCasualReplyPrompt,
  onSwitchProvider,
  showToast,
  scrollToBottom,
  focusInput,
  setIsPhotoModalOpen,
  setSelectedImage,
}: QuickActionsSectionProps) {
  const [isActionsPanelOpen, setIsActionsPanelOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<"all" | "writing" | "study" | "vocab" | "chat">("all");
  const [actionSearchQuery, setActionSearchQuery] = useState("");
  const [sortMode, setSortMode] = useState<"most_used" | "default">("most_used");
  const dockScrollRef = useRef<HTMLDivElement>(null);

  const quickActionItems = useMemo(() => {
    const allQuickActionItems = getQuickActionItems().map((item) => ({
      ...item,
      onClick: () => {
        handleIncrementActionCount(item.id);
        if (item.id !== "suggest_reply") {
          setSelectedImage(null);
        }

        if (llmConfig?.provider !== "auto" && item.defaultModels && item.defaultModels.length > 0) {
          const match = getRotatedDefaultModel(item.defaultModels);
          if (match) {
            if (onSwitchProvider) {
              onSwitchProvider(match.provider, match.model);
              showToast(`🔄 Rotated session model to ${match.provider.toUpperCase()}: ${match.model}`);
            }
          }
        }

        item.getAction({
          targetLanguage,
          nativeLanguage,
          onFixGrammar,
          onStartQuiz,
          onGenerateByTopic: () => {}, // empty as fallback
          onAddWord,
          onSendMessage,
          onClearHistory,
          onViewFlashcard,
          onSuggestCasualReplyPrompt: () => {
            setIsPhotoModalOpen(true);
            onSuggestCasualReplyPrompt?.();
          },
        });
        setIsActionsPanelOpen(false);
        scrollToBottom("smooth");
        focusInput();
      }
    }));
    return [...allQuickActionItems].sort((a, b) => {
      if (sortMode === "most_used") {
        const countA = actionCounts[a.id] || 0;
        const countB = actionCounts[b.id] || 0;
        if (countB !== countA) {
          return countB - countA;
        }
      }
      return a.defaultIndex - b.defaultIndex;
    });
  }, [sortMode, actionCounts, llmConfig, targetLanguage, nativeLanguage, onSwitchProvider]);

  const filteredActionItems = quickActionItems.filter((item) => {
    const matchesCategory = selectedCategory === "all" || item.category === selectedCategory;
    const matchesSearch = actionSearchQuery.trim() === "" || 
      item.title.toLowerCase().includes(actionSearchQuery.toLowerCase()) ||
      item.description.toLowerCase().includes(actionSearchQuery.toLowerCase()) ||
      item.label.toLowerCase().includes(actionSearchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  return (
    <>
      {/* Expanded Quick Actions Panel */}
      <AnimatePresence>
        {isActionsPanelOpen && (
          <motion.div
            initial={{ opacity: 0, y: 15, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 15, scale: 0.98 }}
            transition={{ duration: 0.2 }}
            className="bg-stone-50/95 backdrop-blur-md border-t border-stone-200 p-3.5 space-y-3 z-30 shadow-md"
            id="quick-actions-expanded-panel"
          >
            {/* Header with Search & Close */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-1 border-b border-stone-200/80">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-lg bg-stone-900 text-amber-400 flex items-center justify-center font-bold text-xs shadow-2xs">
                    ⚡
                  </div>
                  <h4 className="text-xs sm:text-sm font-bold text-stone-900 flex items-center gap-1.5">
                    Quick AI Actions
                    <span className="bg-stone-200 text-stone-700 text-[10px] font-bold px-2 py-0.5 rounded-full font-mono">
                      {quickActionItems.length}
                    </span>
                  </h4>
                </div>
                <button
                  type="button"
                  onClick={() => setIsActionsPanelOpen(false)}
                  className="sm:hidden w-7 h-7 rounded-lg bg-stone-200/70 hover:bg-stone-300 text-stone-700 flex items-center justify-center text-xs transition-colors cursor-pointer"
                  title="Close actions panel"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Search Box */}
              <div className="flex items-center gap-2 flex-1 max-w-md">
                <div className="relative flex-1">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400" />
                  <input
                    type="text"
                    value={actionSearchQuery}
                    onChange={(e) => setActionSearchQuery(e.target.value)}
                    placeholder="Search actions (e.g. grammar, quiz, topic)..."
                    className="w-full bg-white text-stone-900 text-xs border border-stone-200 focus:border-stone-400 rounded-lg pl-8 pr-7 py-1.5 focus:ring-0 transition-colors font-medium placeholder:text-stone-400"
                  />
                  {actionSearchQuery && (
                    <button
                      type="button"
                      onClick={() => setActionSearchQuery("")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-700"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => setIsActionsPanelOpen(false)}
                  className="hidden sm:flex w-7 h-7 rounded-lg bg-stone-200/70 hover:bg-stone-300 text-stone-700 items-center justify-center text-xs transition-colors cursor-pointer shrink-0"
                  title="Close actions panel"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Default AI Model Config Widget for Quick Actions */}
            <QuickActionsModelConfig llmConfig={llmConfig} onToast={showToast} />

            {/* Category Filter Pills & Sort Options */}
            <div className="flex flex-wrap items-center justify-between gap-2 pb-0.5">
              <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none py-0.5">
                {[
                  { id: "all", label: "All Actions" },
                  { id: "writing", label: "✍️ Writing & Polish" },
                  { id: "study", label: "🧠 Quiz & Study" },
                  { id: "vocab", label: "📚 Vocabulary" },
                  { id: "chat", label: "💬 Chat Session" }
                ].map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setSelectedCategory(cat.id as any)}
                    className={`px-2.5 py-1 rounded-md text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                      selectedCategory === cat.id
                        ? "bg-stone-900 text-white shadow-xs"
                        : "bg-white hover:bg-stone-100 text-stone-600 border border-stone-200/80"
                    }`}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSortMode(prev => prev === "most_used" ? "default" : "most_used")}
                  className={`px-2.5 py-1 rounded-md text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer border ${
                    sortMode === "most_used"
                      ? "bg-amber-100 hover:bg-amber-200 text-amber-950 border-amber-300 shadow-2xs"
                      : "bg-white hover:bg-stone-100 text-stone-700 border-stone-200"
                  }`}
                  title={sortMode === "most_used" ? "Sorting by Most Used. Click for Default Order." : "Sorting by Default Order. Click for Most Used."}
                >
                  <ArrowUpDown className="w-3.5 h-3.5" />
                  <span>{sortMode === "most_used" ? "🔥 Sort: Most Used" : "📋 Sort: Default"}</span>
                </button>

                <button
                  type="button"
                  onClick={handleResetActionCounts}
                  className="text-[11px] font-semibold text-stone-500 hover:text-stone-800 hover:bg-stone-200/60 px-2 py-1 rounded-md transition-colors cursor-pointer"
                  title="Reset usage counters for all actions"
                >
                  Reset Counts
                </button>
              </div>
            </div>

            {/* Grid of Action Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-[220px] overflow-y-auto pr-1">
              {filteredActionItems.length > 0 ? (
                filteredActionItems.map((item) => {
                  const count = actionCounts[item.id] || 0;

                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={item.onClick}
                      className="bg-white hover:bg-amber-50/50 border border-stone-200 hover:border-amber-300/80 p-2.5 rounded-xl text-left transition-all duration-150 hover:shadow-2xs cursor-pointer group flex flex-col justify-between gap-1.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-lg bg-stone-100 group-hover:bg-amber-100 flex items-center justify-center shrink-0 transition-colors">
                            {item.icon}
                          </div>
                          <div>
                            <h5 className="text-xs font-bold text-stone-900 group-hover:text-stone-950 flex items-center gap-1">
                              {item.label}
                            </h5>
                            <span className="text-[10px] text-stone-400 font-semibold uppercase tracking-wider block">
                              {item.categoryLabel}
                            </span>
                          </div>
                        </div>

                        {count > 0 && (
                          <span className="bg-stone-100 group-hover:bg-amber-200/80 text-stone-600 group-hover:text-amber-950 text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-md shrink-0">
                            {count}x
                          </span>
                        )}
                      </div>

                      <p className="text-[11px] text-stone-500 group-hover:text-stone-700 leading-snug line-clamp-2">
                        {item.description}
                      </p>
                    </button>
                  );
                })
              ) : (
                <div className="col-span-full py-6 text-center text-xs text-stone-500 font-medium">
                  No quick actions found for "{actionSearchQuery}"
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Primary Quick Action Dock */}
      <div className="bg-stone-50/80 border-t border-stone-200 px-2 py-1.5 flex items-center gap-1.5 shrink-0 relative" id="quick-actions-dock">
        <span className="text-[10px] text-stone-400 font-bold uppercase tracking-wider shrink-0 ml-1 mr-0.5 select-none hidden sm:inline">
          Quick:
        </span>
        <div 
          ref={dockScrollRef}
          className="flex-1 flex items-center gap-1.5 overflow-x-auto scrollbar-none py-0.5 px-0.5"
        >
          {quickActionItems.map((item) => {
            const count = actionCounts[item.id] || 0;

            return (
              <button
                key={item.id}
                onClick={item.onClick}
                className={`${item.className} relative group`}
                title={`${item.title}${count > 0 ? ` (Used ${count} time${count === 1 ? '' : 's'})` : ''}`}
                id={`quick-action-btn-${item.id}`}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        {/* Toggle All Actions Panel Button */}
        <button
          type="button"
          onClick={() => setIsActionsPanelOpen(prev => !prev)}
          className={`ml-1 px-2.5 py-1.5 rounded-full text-xs font-bold border transition-all flex items-center gap-1.5 cursor-pointer shrink-0 shadow-2xs ${
            isActionsPanelOpen
              ? "bg-amber-400 text-stone-950 border-amber-500 shadow-xs"
              : "bg-stone-900 hover:bg-stone-800 text-amber-300 border-stone-900 hover:scale-102"
          }`}
          title="View all quick AI actions in grid"
          id="toggle-quick-actions-grid-btn"
        >
          <LayoutGrid className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">
            {isActionsPanelOpen ? "Close Grid" : "All Actions"}
          </span>
          <span className="bg-stone-800 text-amber-300 text-[10px] font-mono px-1.5 py-0.2 rounded-full">
            {quickActionItems.length}
          </span>
        </button>
      </div>
    </>
  );
}
