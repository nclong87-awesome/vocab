import { useState, useMemo } from "react";
import { 
  Cloud, 
  Download, 
  X, 
  HardDrive, 
  Calendar, 
  BookOpen, 
  Layers,
  Sparkles,
  Plus,
  RefreshCw,
  CheckCircle2,
  Trash2,
  BrainCircuit,
  ChevronDown,
  ChevronUp,
  Search,
  SlidersHorizontal
} from "lucide-react";
import { MergeResult } from "../../utils/cloudSyncMerge";
import { useModalBackNavigation } from "../../hooks/useModalBackNavigation";

interface CloudSyncConfirmModalProps {
  isOpen: boolean;
  localData: any;
  remoteData: any;
  mergeResult: MergeResult | null;
  isSyncing: boolean;
  onConfirmMerge: () => void;
  onOverwriteLocalFromCloud: () => void;
  onCancel: () => void;
}

type DetailTab = "all" | "local" | "remote" | "updated" | "deleted";

const MAX_PREVIEW_CHIPS = 40;

export default function CloudSyncConfirmModal({
  isOpen,
  localData,
  remoteData,
  mergeResult,
  isSyncing,
  onConfirmMerge,
  onOverwriteLocalFromCloud,
  onCancel
}: CloudSyncConfirmModalProps) {
  useModalBackNavigation(isOpen, onCancel);

  // By default, details are collapsed so summary renders instantly without lagging on large word counts
  const [showDetails, setShowDetails] = useState(false);
  const [activeTab, setActiveTab] = useState<DetailTab>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [expandedSections, setExpandedSections] = useState<{
    local: boolean;
    remote: boolean;
    deleted: boolean;
    updated: boolean;
  }>({
    local: false,
    remote: false,
    deleted: false,
    updated: false
  });

  const diff = mergeResult?.diffDetails;
  const newLocalCount = diff?.newLocalWords?.length || 0;
  const newRemoteCount = diff?.newRemoteWords?.length || 0;
  const deletedCount = diff?.deletedWordsToSync?.length || 0;
  const updatedCount = diff?.updatedWords?.length || 0;
  const statsChanged = Boolean(diff?.statsChanged && diff?.statsSummary);
  const profileChanged = Boolean(
    diff?.personalityProfileDiff && 
    diff.personalityProfileDiff.action !== "none" && 
    diff.personalityProfileDiff.action !== "identical"
  );

  const totalWordChanges = newLocalCount + newRemoteCount + deletedCount + updatedCount;

  // Filtered lists for the detailed changes view when expanded
  const normalizedSearch = searchTerm.trim().toLowerCase();

  const filteredLocalWords = useMemo(() => {
    if (!diff?.newLocalWords) return [];
    if (!normalizedSearch) return diff.newLocalWords;
    return diff.newLocalWords.filter(w => 
      w.word.toLowerCase().includes(normalizedSearch) || 
      (w.translation && w.translation.toLowerCase().includes(normalizedSearch))
    );
  }, [diff?.newLocalWords, normalizedSearch]);

  const filteredRemoteWords = useMemo(() => {
    if (!diff?.newRemoteWords) return [];
    if (!normalizedSearch) return diff.newRemoteWords;
    return diff.newRemoteWords.filter(w => 
      w.word.toLowerCase().includes(normalizedSearch) || 
      (w.translation && w.translation.toLowerCase().includes(normalizedSearch))
    );
  }, [diff?.newRemoteWords, normalizedSearch]);

  const filteredDeletedWords = useMemo(() => {
    if (!diff?.deletedWordsToSync) return [];
    if (!normalizedSearch) return diff.deletedWordsToSync;
    return diff.deletedWordsToSync.filter(w => 
      w.word.toLowerCase().includes(normalizedSearch)
    );
  }, [diff?.deletedWordsToSync, normalizedSearch]);

  const filteredUpdatedWords = useMemo(() => {
    if (!diff?.updatedWords) return [];
    if (!normalizedSearch) return diff.updatedWords;
    return diff.updatedWords.filter(u => 
      u.word.toLowerCase().includes(normalizedSearch) || 
      u.changes.some(c => c.toLowerCase().includes(normalizedSearch))
    );
  }, [diff?.updatedWords, normalizedSearch]);

  if (!isOpen || !localData || !remoteData) return null;

  const localWordsCount = localData.stores?.words?.length || 0;
  const localStats = localData.stores?.stats?.[0]?.data;
  const localDate = localData.exportedAt 
    ? new Date(localData.exportedAt).toLocaleString() 
    : "Just now";

  const remoteWordsCount = remoteData.stores?.words?.length || 0;
  const remoteStats = remoteData.stores?.stats?.[0]?.data;
  const remoteDate = remoteData.exportedAt 
    ? new Date(remoteData.exportedAt).toLocaleString() 
    : "Unknown date";

  // Extract learner personality profile archetypes if present
  const localProfileSetting = localData?.stores?.settings?.find((s: any) => s && s.key === "user_personality_profile");
  let localArchetype: string | null = null;
  if (localProfileSetting?.value) {
    try {
      localArchetype = JSON.parse(localProfileSetting.value)?.archetype || null;
    } catch {}
  }

  const remoteProfileSetting = remoteData?.stores?.settings?.find((s: any) => s && s.key === "user_personality_profile");
  let remoteArchetype: string | null = null;
  if (remoteProfileSetting?.value) {
    try {
      remoteArchetype = JSON.parse(remoteProfileSetting.value)?.archetype || null;
    } catch {}
  }

  const toggleSectionExpand = (section: "local" | "remote" | "deleted" | "updated") => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-2.5 sm:p-4 bg-stone-950/60 backdrop-blur-xs animate-in fade-in duration-200"
      onClick={onCancel}
      id="cloud-sync-confirm-modal"
    >
      <div 
        className="bg-white border-2 border-stone-900 max-w-xl w-full shadow-2xl overflow-hidden flex flex-col my-auto max-h-[92vh] sm:max-h-[88vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-stone-900 text-white p-3.5 sm:p-4 border-b border-stone-800 flex items-start sm:items-center justify-between gap-2.5 shrink-0">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <div className="p-1.5 sm:p-2 bg-stone-800 border border-stone-700 text-amber-400 shrink-0">
              <Cloud className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm sm:text-base font-bold tracking-tight text-white leading-snug">
                Cloud Sync & Auto-Merge
              </h3>
              <p className="text-[11px] sm:text-xs text-stone-400 font-normal mt-0.5 leading-snug truncate">
                Differences detected between local device & cloud backup.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onCancel}
            className="p-1.5 text-stone-400 hover:text-white hover:bg-stone-800 transition-colors cursor-pointer shrink-0"
            title="Close modal"
          >
            <X className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>
        </div>

        {/* Scrollable Content Body */}
        <div className="p-3.5 sm:p-5 space-y-4 overflow-y-auto min-h-0 flex-1">
          
          {/* Summary Section (Always displayed first, ultra fast & lightweight) */}
          <div className="p-3.5 sm:p-4 bg-amber-50/90 border-2 border-amber-300 text-stone-900 space-y-3">
            {/* Summary Title & Total Result */}
            <div className="flex items-center justify-between gap-2 border-b border-amber-200 pb-2.5">
              <div className="flex items-center gap-1.5 text-amber-950 font-bold text-xs uppercase tracking-wider font-mono">
                <Sparkles className="w-4 h-4 text-amber-600 shrink-0" />
                <span>Auto-Merge Summary</span>
              </div>
              {diff?.totalMergedWordsCount !== undefined && (
                <span className="text-[10px] sm:text-xs font-bold bg-amber-200 text-amber-900 px-2 py-0.5 font-mono shrink-0 border border-amber-300/80">
                  Total: {diff.totalMergedWordsCount} Words
                </span>
              )}
            </div>

            {/* Quick Metrics Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-2 gap-2 text-xs">
              {/* Push: Local to Cloud */}
              <div className={`p-2.5 border transition-all ${newLocalCount > 0 ? "bg-emerald-50/90 border-emerald-300 text-emerald-950" : "bg-stone-50 border-stone-200 text-stone-500 opacity-60"}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold flex items-center gap-1 text-[11px] sm:text-xs">
                    <Plus className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    New to Push
                  </span>
                  <span className="text-[9px] font-mono text-stone-500">Local → Cloud</span>
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-base sm:text-lg font-bold font-mono">+{newLocalCount}</span>
                  <span className="text-[10px] text-stone-600 font-sans">words</span>
                </div>
              </div>

              {/* Pull: Cloud to Local */}
              <div className={`p-2.5 border transition-all ${newRemoteCount > 0 ? "bg-blue-50/90 border-blue-300 text-blue-950" : "bg-stone-50 border-stone-200 text-stone-500 opacity-60"}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold flex items-center gap-1 text-[11px] sm:text-xs">
                    <Download className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                    New to Pull
                  </span>
                  <span className="text-[9px] font-mono text-stone-500">Cloud → Local</span>
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-base sm:text-lg font-bold font-mono">+{newRemoteCount}</span>
                  <span className="text-[10px] text-stone-600 font-sans">words</span>
                </div>
              </div>

              {/* Updated Mastery */}
              <div className={`p-2.5 border transition-all ${updatedCount > 0 ? "bg-amber-100/70 border-amber-300 text-amber-950" : "bg-stone-50 border-stone-200 text-stone-500 opacity-60"}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold flex items-center gap-1 text-[11px] sm:text-xs">
                    <RefreshCw className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                    Mastery Updates
                  </span>
                  <span className="text-[9px] font-mono text-stone-500">Highest Score</span>
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-base sm:text-lg font-bold font-mono">{updatedCount}</span>
                  <span className="text-[10px] text-stone-600 font-sans">words updated</span>
                </div>
              </div>

              {/* Deletions or Sync status */}
              <div className={`p-2.5 border transition-all ${deletedCount > 0 ? "bg-rose-50/90 border-rose-300 text-rose-950" : "bg-stone-50 border-stone-200 text-stone-500 opacity-60"}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold flex items-center gap-1 text-[11px] sm:text-xs">
                    <Trash2 className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                    Deletions Synced
                  </span>
                  <span className="text-[9px] font-mono text-stone-500">Both Sides</span>
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-base sm:text-lg font-bold font-mono">-{deletedCount}</span>
                  <span className="text-[10px] text-stone-600 font-sans">words</span>
                </div>
              </div>
            </div>

            {/* Extra Sync Metadata (Stats & Personality Profile) */}
            {(statsChanged || profileChanged) && (
              <div className="space-y-1.5 pt-2 border-t border-amber-200/80 text-[11px]">
                {statsChanged && diff?.statsSummary && (
                  <div className="flex items-center justify-between bg-white/80 p-2 border border-amber-200 text-stone-800 font-mono">
                    <span className="flex items-center gap-1 text-stone-700 font-sans font-semibold">
                      <Layers className="w-3.5 h-3.5 text-amber-700" />
                      Study Stats Combined:
                    </span>
                    <span className="font-bold text-stone-900">
                      Quizzes: {diff.statsSummary.quizzesMerged} • Streak: {diff.statsSummary.streakMerged}d
                    </span>
                  </div>
                )}

                {profileChanged && diff?.personalityProfileDiff && (
                  <div className="flex items-center justify-between bg-white/80 p-2 border border-amber-200 text-stone-800 font-mono">
                    <span className="flex items-center gap-1 text-stone-700 font-sans font-semibold">
                      <BrainCircuit className="w-3.5 h-3.5 text-amber-700" />
                      AI Learner Persona:
                    </span>
                    <span className="font-bold text-amber-900 bg-amber-200/80 px-1.5 py-0.5 text-[10px]">
                      {diff.personalityProfileDiff.chosenArchetype || "Updated"}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Toggle Button for Detailed Changes */}
            {totalWordChanges > 0 && (
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => setShowDetails(!showDetails)}
                  className="w-full py-2 px-3 bg-white hover:bg-amber-100/60 border border-amber-300 text-amber-950 text-xs font-bold transition-colors cursor-pointer flex items-center justify-between group"
                  id="toggle-sync-details-btn"
                >
                  <span className="flex items-center gap-1.5">
                    <SlidersHorizontal className="w-3.5 h-3.5 text-amber-700" />
                    <span>{showDetails ? "Hide Detailed Changes" : `View Detailed Changes (${totalWordChanges} items)`}</span>
                  </span>
                  <div className="flex items-center gap-1 text-[11px] text-amber-800 font-mono group-hover:translate-y-0.5 transition-transform">
                    <span>{showDetails ? "Collapse" : "Expand"}</span>
                    {showDetails ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </div>
                </button>
              </div>
            )}
          </div>

          {/* Detailed Changes Section (Only rendered & expanded when user clicks) */}
          {showDetails && totalWordChanges > 0 && (
            <div className="space-y-3 p-3 sm:p-3.5 bg-stone-50 border-2 border-stone-300 animate-in fade-in slide-in-from-top-2 duration-200">
              {/* Details Header & Search Bar */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-stone-200 pb-2.5">
                <div className="flex items-center gap-1.5 text-stone-900 font-bold text-xs uppercase tracking-wider font-mono">
                  <span>Detailed Changes</span>
                  <span className="text-[10px] bg-stone-200 text-stone-800 px-1.5 py-0.2 font-sans font-normal">
                    {totalWordChanges} total
                  </span>
                </div>

                {/* Filter Search Input */}
                <div className="relative flex-1 sm:max-w-xs">
                  <Search className="w-3.5 h-3.5 text-stone-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search changed words..."
                    className="w-full pl-8 pr-7 py-1 text-xs bg-white border border-stone-300 focus:outline-none focus:border-stone-800"
                  />
                  {searchTerm && (
                    <button
                      type="button"
                      onClick={() => setSearchTerm("")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-700 p-0.5"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>

              {/* Category Filter Tabs */}
              <div className="flex items-center gap-1 overflow-x-auto pb-1 text-[11px] font-medium">
                <button
                  type="button"
                  onClick={() => setActiveTab("all")}
                  className={`px-2.5 py-1 border transition-colors cursor-pointer whitespace-nowrap ${
                    activeTab === "all"
                      ? "bg-stone-900 text-white border-stone-900 font-bold"
                      : "bg-white text-stone-700 border-stone-300 hover:bg-stone-100"
                  }`}
                >
                  All ({totalWordChanges})
                </button>
                {newLocalCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setActiveTab("local")}
                    className={`px-2.5 py-1 border transition-colors cursor-pointer whitespace-nowrap ${
                      activeTab === "local"
                        ? "bg-emerald-800 text-white border-emerald-800 font-bold"
                        : "bg-emerald-50 text-emerald-900 border-emerald-200 hover:bg-emerald-100"
                    }`}
                  >
                    Local to Push (+{newLocalCount})
                  </button>
                )}
                {newRemoteCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setActiveTab("remote")}
                    className={`px-2.5 py-1 border transition-colors cursor-pointer whitespace-nowrap ${
                      activeTab === "remote"
                        ? "bg-blue-800 text-white border-blue-800 font-bold"
                        : "bg-blue-50 text-blue-900 border-blue-200 hover:bg-blue-100"
                    }`}
                  >
                    Cloud to Pull (+{newRemoteCount})
                  </button>
                )}
                {updatedCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setActiveTab("updated")}
                    className={`px-2.5 py-1 border transition-colors cursor-pointer whitespace-nowrap ${
                      activeTab === "updated"
                        ? "bg-amber-800 text-white border-amber-800 font-bold"
                        : "bg-amber-50 text-amber-900 border-amber-200 hover:bg-amber-100"
                    }`}
                  >
                    Updated ({updatedCount})
                  </button>
                )}
                {deletedCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setActiveTab("deleted")}
                    className={`px-2.5 py-1 border transition-colors cursor-pointer whitespace-nowrap ${
                      activeTab === "deleted"
                        ? "bg-rose-800 text-white border-rose-800 font-bold"
                        : "bg-rose-50 text-rose-900 border-rose-200 hover:bg-rose-100"
                    }`}
                  >
                    Deleted (-{deletedCount})
                  </button>
                )}
              </div>

              {/* Detail Lists */}
              <div className="space-y-2.5 text-xs max-h-64 overflow-y-auto pr-1">
                {/* 1. New Local Words */}
                {(activeTab === "all" || activeTab === "local") && filteredLocalWords.length > 0 && (
                  <div className="bg-white p-2.5 border border-emerald-200 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-emerald-800 flex items-center gap-1 text-[11px] sm:text-xs">
                        <Plus className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        New Local Words to Push ({filteredLocalWords.length})
                      </span>
                      <span className="text-[9px] text-stone-500 font-mono">Local → Cloud</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {(expandedSections.local 
                        ? filteredLocalWords 
                        : filteredLocalWords.slice(0, MAX_PREVIEW_CHIPS)
                      ).map(w => (
                        <span key={w.id} className="text-[10px] sm:text-[11px] font-semibold bg-emerald-50 text-emerald-900 border border-emerald-200 px-1.5 py-0.5 font-serif" title={w.translation || ""}>
                          {w.word}
                        </span>
                      ))}
                    </div>
                    {filteredLocalWords.length > MAX_PREVIEW_CHIPS && (
                      <button
                        type="button"
                        onClick={() => toggleSectionExpand("local")}
                        className="text-[10px] text-emerald-800 font-bold hover:underline cursor-pointer pt-1"
                      >
                        {expandedSections.local 
                          ? "▲ Show fewer words" 
                          : `▼ Show all +${filteredLocalWords.length - MAX_PREVIEW_CHIPS} more words...`}
                      </button>
                    )}
                  </div>
                )}

                {/* 2. New Remote Words */}
                {(activeTab === "all" || activeTab === "remote") && filteredRemoteWords.length > 0 && (
                  <div className="bg-white p-2.5 border border-blue-200 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-blue-800 flex items-center gap-1 text-[11px] sm:text-xs">
                        <Download className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                        New Remote Words to Pull ({filteredRemoteWords.length})
                      </span>
                      <span className="text-[9px] text-stone-500 font-mono">Cloud → Local</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {(expandedSections.remote 
                        ? filteredRemoteWords 
                        : filteredRemoteWords.slice(0, MAX_PREVIEW_CHIPS)
                      ).map(w => (
                        <span key={w.id} className="text-[10px] sm:text-[11px] font-semibold bg-blue-50 text-blue-900 border border-blue-200 px-1.5 py-0.5 font-serif" title={w.translation || ""}>
                          {w.word}
                        </span>
                      ))}
                    </div>
                    {filteredRemoteWords.length > MAX_PREVIEW_CHIPS && (
                      <button
                        type="button"
                        onClick={() => toggleSectionExpand("remote")}
                        className="text-[10px] text-blue-800 font-bold hover:underline cursor-pointer pt-1"
                      >
                        {expandedSections.remote 
                          ? "▲ Show fewer words" 
                          : `▼ Show all +${filteredRemoteWords.length - MAX_PREVIEW_CHIPS} more words...`}
                      </button>
                    )}
                  </div>
                )}

                {/* 3. Updated Words */}
                {(activeTab === "all" || activeTab === "updated") && filteredUpdatedWords.length > 0 && (
                  <div className="bg-white p-2.5 border border-amber-200 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-amber-900 flex items-center gap-1 text-[11px] sm:text-xs">
                        <RefreshCw className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                        Updated Word Mastery & Status ({filteredUpdatedWords.length})
                      </span>
                    </div>
                    <div className="space-y-1">
                      {(expandedSections.updated 
                        ? filteredUpdatedWords 
                        : filteredUpdatedWords.slice(0, 20)
                      ).map((u, idx) => (
                        <div key={idx} className="text-[10px] sm:text-[11px] text-stone-800 flex items-center justify-between border-b border-stone-100 last:border-none py-0.5">
                          <strong className="font-serif font-bold text-stone-900">{u.word}:</strong>
                          <span className="text-[9px] sm:text-[10px] text-stone-600 italic truncate max-w-[240px]">{u.changes.join(", ")}</span>
                        </div>
                      ))}
                    </div>
                    {filteredUpdatedWords.length > 20 && (
                      <button
                        type="button"
                        onClick={() => toggleSectionExpand("updated")}
                        className="text-[10px] text-amber-900 font-bold hover:underline cursor-pointer pt-1"
                      >
                        {expandedSections.updated 
                          ? "▲ Show fewer updates" 
                          : `▼ Show all +${filteredUpdatedWords.length - 20} more updates...`}
                      </button>
                    )}
                  </div>
                )}

                {/* 4. Deleted Words */}
                {(activeTab === "all" || activeTab === "deleted") && filteredDeletedWords.length > 0 && (
                  <div className="bg-white p-2.5 border border-rose-200 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-rose-800 flex items-center gap-1 text-[11px] sm:text-xs">
                        <Trash2 className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                        Removed Words Synced ({filteredDeletedWords.length})
                      </span>
                      <span className="text-[9px] text-stone-500 font-mono">Cloud & Local</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {(expandedSections.deleted 
                        ? filteredDeletedWords 
                        : filteredDeletedWords.slice(0, MAX_PREVIEW_CHIPS)
                      ).map(w => (
                        <span key={w.id} className="text-[10px] sm:text-[11px] font-semibold bg-rose-50 text-rose-900 border border-rose-200 px-1.5 py-0.5 font-serif line-through decoration-rose-500">
                          {w.word}
                        </span>
                      ))}
                    </div>
                    {filteredDeletedWords.length > MAX_PREVIEW_CHIPS && (
                      <button
                        type="button"
                        onClick={() => toggleSectionExpand("deleted")}
                        className="text-[10px] text-rose-800 font-bold hover:underline cursor-pointer pt-1"
                      >
                        {expandedSections.deleted 
                          ? "▲ Show fewer words" 
                          : `▼ Show all +${filteredDeletedWords.length - MAX_PREVIEW_CHIPS} more words...`}
                      </button>
                    )}
                  </div>
                )}

                {/* No matching results when searching */}
                {searchTerm && 
                 filteredLocalWords.length === 0 && 
                 filteredRemoteWords.length === 0 && 
                 filteredUpdatedWords.length === 0 && 
                 filteredDeletedWords.length === 0 && (
                  <div className="p-4 text-center text-stone-500 text-xs italic bg-white border border-stone-200">
                    No changed words match "{searchTerm}"
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Device Comparison Overview Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-3">
            {/* Local Data Card */}
            <div className="border border-stone-200 bg-stone-50/70 p-3 sm:p-3.5 space-y-1.5">
              <div className="flex items-center justify-between border-b border-stone-200 pb-1.5">
                <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-stone-900 flex items-center gap-1">
                  <HardDrive className="w-3.5 h-3.5 text-stone-700" />
                  Local Device
                </span>
                <span className="text-[9px] font-bold bg-stone-200 text-stone-800 px-1.5 py-0.5">
                  This Browser
                </span>
              </div>

              <div className="space-y-1 text-xs text-stone-700 font-medium">
                <div className="flex items-center justify-between">
                  <span className="text-stone-500 flex items-center gap-1">
                    <BookOpen className="w-3 h-3" /> Words:
                  </span>
                  <strong className="font-bold text-stone-950">{localWordsCount}</strong>
                </div>

                {localStats && (
                  <div className="flex items-center justify-between">
                    <span className="text-stone-500 flex items-center gap-1">
                      <Layers className="w-3 h-3" /> Quizzes:
                    </span>
                    <strong className="font-bold text-stone-950">{localStats.totalQuizzesTaken || 0}</strong>
                  </div>
                )}

                {localArchetype && (
                  <div className="flex items-center justify-between">
                    <span className="text-stone-500 flex items-center gap-1">
                      <BrainCircuit className="w-3 h-3 text-amber-600" /> Persona:
                    </span>
                    <strong className="font-bold text-stone-950 truncate max-w-[140px]">{localArchetype}</strong>
                  </div>
                )}

                <div className="flex items-start justify-between gap-1 pt-1 border-t border-stone-200 text-[10px]">
                  <span className="text-stone-400 flex items-center gap-1 shrink-0">
                    <Calendar className="w-3 h-3" /> Saved:
                  </span>
                  <span className="font-mono text-stone-600 text-right text-[9px] sm:text-[10px] truncate">
                    {localDate}
                  </span>
                </div>
              </div>
            </div>

            {/* Cloud Data Card */}
            <div className="border border-blue-200 bg-blue-50/50 p-3 sm:p-3.5 space-y-1.5">
              <div className="flex items-center justify-between border-b border-blue-200 pb-1.5">
                <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-blue-950 flex items-center gap-1">
                  <Cloud className="w-3.5 h-3.5 text-blue-700" />
                  Cloud Backup
                </span>
                <span className="text-[9px] font-bold bg-blue-200 text-blue-900 px-1.5 py-0.5">
                  GitHub Gist
                </span>
              </div>

              <div className="space-y-1 text-xs text-stone-700 font-medium">
                <div className="flex items-center justify-between">
                  <span className="text-stone-500 flex items-center gap-1">
                    <BookOpen className="w-3 h-3" /> Words:
                  </span>
                  <strong className="font-bold text-stone-950">{remoteWordsCount}</strong>
                </div>

                {remoteStats && (
                  <div className="flex items-center justify-between">
                    <span className="text-stone-500 flex items-center gap-1">
                      <Layers className="w-3 h-3" /> Quizzes:
                    </span>
                    <strong className="font-bold text-stone-950">{remoteStats.totalQuizzesTaken || 0}</strong>
                  </div>
                )}

                {remoteArchetype && (
                  <div className="flex items-center justify-between">
                    <span className="text-stone-500 flex items-center gap-1">
                      <BrainCircuit className="w-3 h-3 text-blue-600" /> Persona:
                    </span>
                    <strong className="font-bold text-stone-950 truncate max-w-[140px]">{remoteArchetype}</strong>
                  </div>
                )}

                <div className="flex items-start justify-between gap-1 pt-1 border-t border-blue-200 text-[10px]">
                  <span className="text-stone-400 flex items-center gap-1 shrink-0">
                    <Calendar className="w-3 h-3" /> Saved:
                  </span>
                  <span className="font-mono text-stone-600 text-right text-[9px] sm:text-[10px] truncate">
                    {remoteDate}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Primary Action Button: Confirm & Apply Auto-Merge */}
          <button
            type="button"
            onClick={onConfirmMerge}
            disabled={isSyncing}
            className="w-full text-left p-3.5 sm:p-4 bg-stone-900 hover:bg-black text-white border-2 border-stone-950 transition-all cursor-pointer group shadow-md space-y-1.5 disabled:opacity-50"
            id="confirm-cloud-auto-merge-btn"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className="p-1.5 sm:p-2 bg-amber-400 text-stone-950 shrink-0 font-bold">
                  <CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5" />
                </div>
                <span className="text-xs sm:text-sm font-bold text-white tracking-tight font-sans truncate">
                  Confirm & Apply Auto-Merge
                </span>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-[9px] sm:text-[10px] bg-amber-400 text-stone-950 px-1.5 py-0.5 font-bold uppercase font-mono">
                  Recommended
                </span>
                <Sparkles className="w-4 h-4 text-amber-400 shrink-0 group-hover:rotate-12 transition-transform" />
              </div>
            </div>

            <p className="text-[11px] sm:text-xs text-stone-300 font-normal leading-tight pl-0.5">
              Combine local and cloud database cleanly without losing any records
            </p>
          </button>

          {/* Manual Overwrite Options */}
          <div className="pt-2 border-t border-stone-200">
            <button
              type="button"
              onClick={onOverwriteLocalFromCloud}
              disabled={isSyncing}
              className="w-full p-2.5 sm:p-3 bg-stone-50 hover:bg-stone-100 text-stone-900 border border-stone-300 text-xs font-semibold text-left transition-colors cursor-pointer flex items-center gap-2.5"
              id="download-cloud-only-btn"
            >
              <Download className="w-4 h-4 text-stone-700 shrink-0" />
              <div>
                <div className="font-bold text-stone-950">Download Cloud Only</div>
                <div className="text-[10px] text-stone-500 font-normal">Overwrite local device data directly with the latest cloud backup</div>
              </div>
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="p-3 sm:p-4 bg-stone-100 border-t border-stone-200 flex flex-col sm:flex-row items-center justify-between gap-2 shrink-0">
          <span className="text-[10px] sm:text-[11px] text-stone-500 italic text-center sm:text-left">
            Auto-merge seamlessly synchronizes both local IndexedDB & GitHub Gist.
          </span>

          <button
            type="button"
            onClick={onCancel}
            disabled={isSyncing}
            className="w-full sm:w-auto px-4 py-2 bg-white hover:bg-stone-200 border border-stone-300 text-stone-800 text-xs font-semibold transition-colors cursor-pointer text-center"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

