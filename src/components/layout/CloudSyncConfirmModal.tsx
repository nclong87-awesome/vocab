import React from "react";
import { 
  Cloud, 
  Upload, 
  Download, 
  AlertTriangle, 
  X, 
  HardDrive, 
  Calendar, 
  BookOpen, 
  Layers,
  ArrowRight
} from "lucide-react";

interface CloudSyncConfirmModalProps {
  isOpen: boolean;
  localData: any;
  remoteData: any;
  isSyncing: boolean;
  onSyncLocalToCloud: () => void;
  onOverwriteLocalFromCloud: () => void;
  onCancel: () => void;
}

export default function CloudSyncConfirmModal({
  isOpen,
  localData,
  remoteData,
  isSyncing,
  onSyncLocalToCloud,
  onOverwriteLocalFromCloud,
  onCancel
}: CloudSyncConfirmModalProps) {
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

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-950/60 backdrop-blur-xs animate-in fade-in duration-200"
      onClick={onCancel}
      id="cloud-sync-confirm-modal"
    >
      <div 
        className="bg-white border-2 border-stone-900 max-w-xl w-full shadow-2xl overflow-hidden flex flex-col my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-stone-900 text-white p-5 border-b border-stone-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-stone-800 border border-stone-700 text-amber-400">
              <Cloud className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold tracking-tight text-white flex items-center gap-2">
                Cloud Sync Conflict Detected
              </h3>
              <p className="text-xs text-stone-400 font-normal mt-0.5">
                Differences found between your local browser data and cloud backup.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onCancel}
            className="p-1.5 text-stone-400 hover:text-white hover:bg-stone-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-6 max-h-[80vh] overflow-y-auto">
          {/* Informational Alert */}
          <div className="p-3.5 bg-amber-50 border border-amber-200 text-amber-900 text-xs font-medium flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <p>
              Please choose how you would like to resolve the differences. You can either push your local changes to the cloud or overwrite your local data with the cloud backup.
            </p>
          </div>

          {/* Comparison Cards Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Local Data Card */}
            <div className="border-2 border-stone-200 bg-stone-50/50 p-4 space-y-3 relative">
              <div className="flex items-center justify-between border-b border-stone-200 pb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-stone-900 flex items-center gap-1.5">
                  <HardDrive className="w-4 h-4 text-stone-700" />
                  Local Database
                </span>
                <span className="text-[10px] font-bold bg-stone-200 text-stone-800 px-2 py-0.5">
                  This Device
                </span>
              </div>

              <div className="space-y-1.5 text-xs text-stone-700 font-medium">
                <div className="flex items-center justify-between">
                  <span className="text-stone-500 flex items-center gap-1">
                    <BookOpen className="w-3.5 h-3.5" /> Total Words:
                  </span>
                  <strong className="font-bold text-stone-950">{localWordsCount}</strong>
                </div>

                {localStats && (
                  <div className="flex items-center justify-between">
                    <span className="text-stone-500 flex items-center gap-1">
                      <Layers className="w-3.5 h-3.5" /> Quizzes Taken:
                    </span>
                    <strong className="font-bold text-stone-950">{localStats.totalQuizzesTaken || 0}</strong>
                  </div>
                )}

                {localStats && (
                  <div className="flex items-center justify-between">
                    <span className="text-stone-500 flex items-center gap-1">
                      <Layers className="w-3.5 h-3.5" /> Streak:
                    </span>
                    <strong className="font-bold text-stone-950">{localStats.streak?.count || 0} days</strong>
                  </div>
                )}

                <div className="flex items-start justify-between gap-1 pt-1 border-t border-stone-200 text-[11px]">
                  <span className="text-stone-400 flex items-center gap-1">
                    <Calendar className="w-3 h-3" /> Updated:
                  </span>
                  <span className="font-mono text-stone-600 text-right text-[10px]">
                    {localDate}
                  </span>
                </div>
              </div>
            </div>

            {/* Cloud Data Card */}
            <div className="border-2 border-blue-200 bg-blue-50/40 p-4 space-y-3 relative">
              <div className="flex items-center justify-between border-b border-blue-200 pb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-blue-950 flex items-center gap-1.5">
                  <Cloud className="w-4 h-4 text-blue-700" />
                  Cloud Backup
                </span>
                <span className="text-[10px] font-bold bg-blue-200 text-blue-900 px-2 py-0.5">
                  GitHub Gist
                </span>
              </div>

              <div className="space-y-1.5 text-xs text-stone-700 font-medium">
                <div className="flex items-center justify-between">
                  <span className="text-stone-500 flex items-center gap-1">
                    <BookOpen className="w-3.5 h-3.5" /> Total Words:
                  </span>
                  <strong className="font-bold text-stone-950">{remoteWordsCount}</strong>
                </div>

                {remoteStats && (
                  <div className="flex items-center justify-between">
                    <span className="text-stone-500 flex items-center gap-1">
                      <Layers className="w-3.5 h-3.5" /> Quizzes Taken:
                    </span>
                    <strong className="font-bold text-stone-950">{remoteStats.totalQuizzesTaken || 0}</strong>
                  </div>
                )}

                {remoteStats && (
                  <div className="flex items-center justify-between">
                    <span className="text-stone-500 flex items-center gap-1">
                      <Layers className="w-3.5 h-3.5" /> Streak:
                    </span>
                    <strong className="font-bold text-stone-950">{remoteStats.streak?.count || 0} days</strong>
                  </div>
                )}

                <div className="flex items-start justify-between gap-1 pt-1 border-t border-blue-200 text-[11px]">
                  <span className="text-stone-400 flex items-center gap-1">
                    <Calendar className="w-3 h-3" /> Updated:
                  </span>
                  <span className="font-mono text-stone-600 text-right text-[10px]">
                    {remoteDate}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Action Choice Buttons */}
          <div className="space-y-3 pt-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-stone-500">
              Select Sync Action:
            </h4>

            {/* Choice A: Sync Local to Cloud */}
            <button
              type="button"
              onClick={onSyncLocalToCloud}
              disabled={isSyncing}
              className="w-full text-left p-4 bg-stone-900 hover:bg-black text-white border-2 border-stone-950 transition-all cursor-pointer group shadow-sm flex items-center justify-between gap-3 disabled:opacity-50"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 bg-stone-800 border border-stone-700 text-amber-400 shrink-0 group-hover:scale-105 transition-transform">
                  <Upload className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-sm font-bold text-white flex items-center gap-2">
                    <span>Sync Local Changes to Cloud</span>
                    <span className="text-[10px] bg-amber-400 text-stone-950 px-2 py-0.2 font-bold uppercase">
                      Upload
                    </span>
                  </div>
                  <p className="text-xs text-stone-300 mt-0.5">
                    Overwrite cloud backup with your latest local database ({localWordsCount} words)
                  </p>
                </div>
              </div>
              <ArrowRight className="w-5 h-5 text-stone-400 group-hover:text-white group-hover:translate-x-1 transition-all shrink-0" />
            </button>

            {/* Choice B: Overwrite Local from Cloud */}
            <button
              type="button"
              onClick={onOverwriteLocalFromCloud}
              disabled={isSyncing}
              className="w-full text-left p-4 bg-stone-50 hover:bg-stone-100 text-stone-900 border-2 border-stone-300 transition-all cursor-pointer group shadow-2xs flex items-center justify-between gap-3 disabled:opacity-50"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 bg-stone-200 border border-stone-300 text-stone-800 shrink-0 group-hover:scale-105 transition-transform">
                  <Download className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-sm font-bold text-stone-950 flex items-center gap-2">
                    <span>Overwrite Local from Cloud</span>
                    <span className="text-[10px] bg-stone-200 text-stone-800 px-2 py-0.2 font-bold uppercase">
                      Download
                    </span>
                  </div>
                  <p className="text-xs text-stone-600 mt-0.5">
                    Download cloud backup and replace local data ({remoteWordsCount} words)
                  </p>
                </div>
              </div>
              <ArrowRight className="w-5 h-5 text-stone-400 group-hover:text-stone-900 group-hover:translate-x-1 transition-all shrink-0" />
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 bg-stone-100 border-t border-stone-200 flex items-center justify-between">
          <span className="text-[11px] text-stone-500 italic">
            Note: Overwriting cannot be undone. Make sure you select the correct action.
          </span>

          <button
            type="button"
            onClick={onCancel}
            disabled={isSyncing}
            className="px-4 py-2 bg-white hover:bg-stone-200 border border-stone-300 text-stone-800 text-xs font-semibold transition-colors cursor-pointer"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
