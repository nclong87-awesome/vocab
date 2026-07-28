import React, { useState } from "react";
import { 
  Cloud, 
  Upload, 
  Download, 
  X, 
  HardDrive, 
  Calendar, 
  BookOpen, 
  Layers,
  Sparkles,
  Plus,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  CheckCircle2
} from "lucide-react";
import { MergeResult } from "../../utils/cloudSyncMerge";

interface CloudSyncConfirmModalProps {
  isOpen: boolean;
  localData: any;
  remoteData: any;
  mergeResult: MergeResult | null;
  isSyncing: boolean;
  onConfirmMerge: () => void;
  onSyncLocalToCloud: () => void;
  onOverwriteLocalFromCloud: () => void;
  onCancel: () => void;
}

export default function CloudSyncConfirmModal({
  isOpen,
  localData,
  remoteData,
  mergeResult,
  isSyncing,
  onConfirmMerge,
  onSyncLocalToCloud,
  onOverwriteLocalFromCloud,
  onCancel
}: CloudSyncConfirmModalProps) {
  const [showOverrideOptions, setShowOverrideOptions] = useState(false);

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

  const diff = mergeResult?.diffDetails;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-2.5 sm:p-4 bg-stone-950/60 backdrop-blur-xs animate-in fade-in duration-200"
      onClick={onCancel}
      id="cloud-sync-confirm-modal"
    >
      <div 
        className="bg-white border-2 border-stone-900 max-w-xl w-full shadow-2xl overflow-hidden flex flex-col my-auto max-h-[90vh] sm:max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-stone-900 text-white p-3.5 sm:p-5 border-b border-stone-800 flex items-start sm:items-center justify-between gap-2.5">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <div className="p-1.5 sm:p-2 bg-stone-800 border border-stone-700 text-amber-400 shrink-0">
              <Cloud className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm sm:text-base font-bold tracking-tight text-white leading-snug">
                Cloud Sync & Auto-Merge
              </h3>
              <p className="text-[11px] sm:text-xs text-stone-400 font-normal mt-0.5 leading-snug">
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

        {/* Content Body */}
        <div className="p-3.5 sm:p-5 space-y-4 sm:space-y-5 overflow-y-auto">
          {/* Main Proposed Auto-Merge Banner */}
          <div className="p-3 sm:p-4 bg-amber-50/90 border-2 border-amber-300 text-stone-900 space-y-2.5 sm:space-y-3">
            <div className="flex items-center justify-between gap-2 border-b border-amber-200 pb-2">
              <div className="flex items-center gap-1.5 text-amber-950 font-bold text-[11px] sm:text-xs uppercase tracking-wider font-mono">
                <Sparkles className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-amber-600 shrink-0" />
                <span>Proposed Auto-Merge Details</span>
              </div>
              {diff?.totalMergedWordsCount !== undefined && (
                <span className="text-[9px] sm:text-[10px] font-bold bg-amber-200 text-amber-900 px-1.5 py-0.5 font-mono shrink-0">
                  Total: {diff.totalMergedWordsCount} Words
                </span>
              )}
            </div>

            {/* Merge Diff List */}
            <div className="space-y-2 text-xs">
              {/* New Local Words (Push) */}
              {diff && diff.newLocalWords.length > 0 && (
                <div className="space-y-1 bg-white p-2 sm:p-2.5 border border-amber-200">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-emerald-800 flex items-center gap-1 text-[11px] sm:text-xs">
                      <Plus className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      New Local Words to Push (+{diff.newLocalWords.length})
                    </span>
                    <span className="text-[9px] sm:text-[10px] text-stone-500 font-mono">Local → Cloud</span>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {diff.newLocalWords.map(w => (
                      <span key={w.id} className="text-[10px] sm:text-[11px] font-semibold bg-emerald-50 text-emerald-900 border border-emerald-200 px-1.5 sm:px-2 py-0.5 font-serif">
                        {w.word}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* New Remote Words (Pull) */}
              {diff && diff.newRemoteWords.length > 0 && (
                <div className="space-y-1 bg-white p-2 sm:p-2.5 border border-amber-200">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-blue-800 flex items-center gap-1 text-[11px] sm:text-xs">
                      <Download className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                      New Remote Words to Pull (+{diff.newRemoteWords.length})
                    </span>
                    <span className="text-[9px] sm:text-[10px] text-stone-500 font-mono">Cloud → Local</span>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {diff.newRemoteWords.map(w => (
                      <span key={w.id} className="text-[10px] sm:text-[11px] font-semibold bg-blue-50 text-blue-900 border border-blue-200 px-1.5 sm:px-2 py-0.5 font-serif">
                        {w.word}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Updated Words / Mastery */}
              {diff && diff.updatedWords.length > 0 && (
                <div className="space-y-1 bg-white p-2 sm:p-2.5 border border-amber-200">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-amber-900 flex items-center gap-1 text-[11px] sm:text-xs">
                      <RefreshCw className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                      Updated Word Mastery & Status ({diff.updatedWords.length})
                    </span>
                  </div>
                  <div className="space-y-1 mt-1">
                    {diff.updatedWords.map((u, idx) => (
                      <div key={idx} className="text-[10px] sm:text-[11px] text-stone-800 flex items-center justify-between border-b border-stone-100 last:border-none py-0.5">
                        <strong className="font-serif font-bold">{u.word}:</strong>
                        <span className="text-[9px] sm:text-[10px] text-stone-600 italic">{u.changes.join(", ")}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Stats Merge Summary */}
              {diff && diff.statsChanged && diff.statsSummary && (
                <div className="bg-white p-2 sm:p-2.5 border border-amber-200 flex items-center justify-between text-[10px] sm:text-[11px] text-stone-800 font-mono">
                  <span>📊 Stats Merged:</span>
                  <div className="flex items-center gap-1.5 sm:gap-2 font-bold text-stone-900">
                    <span>Quizzes: {diff.statsSummary.quizzesMerged}</span>
                    <span>•</span>
                    <span>Streak: {diff.statsSummary.streakMerged}d</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Device Comparison Overview Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-3">
            {/* Local Data Card */}
            <div className="border border-stone-200 bg-stone-50/50 p-3 sm:p-3.5 space-y-1.5">
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
            <div className="border border-blue-200 bg-blue-50/40 p-3 sm:p-3.5 space-y-1.5">
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

          {/* Collapsible Direct Overwrite Choices */}
          <div className="pt-1 border-t border-stone-200">
            <button
              type="button"
              onClick={() => setShowOverrideOptions(prev => !prev)}
              className="text-xs font-bold text-stone-600 hover:text-stone-900 flex items-center gap-1 py-1 cursor-pointer"
            >
              <span>Manual Direct Overwrite Options</span>
              {showOverrideOptions ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>

            {showOverrideOptions && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2 pt-2 border-t border-stone-100 animate-in fade-in">
                <button
                  type="button"
                  onClick={onSyncLocalToCloud}
                  disabled={isSyncing}
                  className="p-2.5 sm:p-3 bg-stone-100 hover:bg-stone-200 text-stone-900 border border-stone-300 text-xs font-semibold text-left transition-colors cursor-pointer flex items-center gap-2"
                >
                  <Upload className="w-4 h-4 text-stone-700 shrink-0" />
                  <div>
                    <div className="font-bold">Push Local Only</div>
                    <div className="text-[10px] text-stone-500 font-normal">Overwrite Cloud Backup</div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={onOverwriteLocalFromCloud}
                  disabled={isSyncing}
                  className="p-2.5 sm:p-3 bg-stone-100 hover:bg-stone-200 text-stone-900 border border-stone-300 text-xs font-semibold text-left transition-colors cursor-pointer flex items-center gap-2"
                >
                  <Download className="w-4 h-4 text-stone-700 shrink-0" />
                  <div>
                    <div className="font-bold">Download Cloud Only</div>
                    <div className="text-[10px] text-stone-500 font-normal">Overwrite Local Device</div>
                  </div>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-3 sm:p-4 bg-stone-100 border-t border-stone-200 flex flex-col sm:flex-row items-center justify-between gap-2">
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
