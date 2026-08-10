import { useState, useEffect, useCallback } from "react";
import { 
  Cloud, 
  RefreshCw, 
  CheckCircle2, 
  AlertTriangle
} from "lucide-react";
import { exportIndexedDBDatabase, importIndexedDBDatabase } from "../../db/indexedDB";
import { syncToGist, syncFromGist } from "../../services/githubGistService";
import { autoMergeLocalAndRemote, sanitizeDataForCloudSync, MergeResult } from "../../utils/cloudSyncMerge";
import CloudSyncConfirmModal from "./CloudSyncConfirmModal";
import CloudSyncConfigModal from "./CloudSyncConfigModal";

interface QuickCloudSyncProps {
  onReloadData?: () => Promise<void>;
  onOpenSettings?: () => void;
}

export default function QuickCloudSync({ onReloadData, onOpenSettings }: QuickCloudSyncProps) {
  const [isCheckingSync, setIsCheckingSync] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<"unconfigured" | "in-sync" | "has-changes">("unconfigured");
  const [pendingCount, setPendingCount] = useState<number>(0);
  
  // Toast Notification state
  const [syncToast, setSyncToast] = useState<{
    type: "success" | "error" | "info";
    text: string;
  } | null>(null);

  // Modals state
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [comparisonData, setComparisonData] = useState<{
    localData: any;
    remoteData: any;
  } | null>(null);
  const [mergeResult, setMergeResult] = useState<MergeResult | null>(null);

  const showToast = (type: "success" | "error" | "info", text: string, duration = 3500) => {
    setSyncToast({ type, text });
    setTimeout(() => {
      setSyncToast(prev => (prev?.text === text ? null : prev));
    }, duration);
  };

  // Perform quiet background sync check without triggering toast messages
  const performQuietBackgroundCheck = useCallback(async (token: string, gistId: string) => {
    try {
      setIsCheckingSync(true);
      const localData = await exportIndexedDBDatabase();
      const remoteData = await syncFromGist(token, gistId, { isUserAction: false });

      const localWords = localData.stores?.words || [];
      const remoteWords = remoteData.stores?.words || [];

      if (localWords.length === 0 && remoteWords.length > 0) {
        setSyncStatus("has-changes");
        setPendingCount(remoteWords.length);
        return;
      }

      const calculatedMerge = autoMergeLocalAndRemote(localData, remoteData);
      if (calculatedMerge.hasChanges) {
        setSyncStatus("has-changes");
        const count =
          calculatedMerge.diffDetails.newLocalWords.length +
          calculatedMerge.diffDetails.newRemoteWords.length +
          calculatedMerge.diffDetails.deletedWordsToSync.length +
          calculatedMerge.diffDetails.updatedWords.length +
          (calculatedMerge.diffDetails.statsChanged ? 1 : 0);
        setPendingCount(count);
      } else {
        setSyncStatus("in-sync");
        setPendingCount(0);
        localStorage.setItem("last_gist_sync_check", String(Date.now()));
      }
    } catch (e) {
      console.warn("Background cloud sync check skipped or failed:", e);
    } finally {
      setIsCheckingSync(false);
    }
  }, []);

  // Check sync status on app launch / mount
  useEffect(() => {
    const token = localStorage.getItem("github_gist_token") || "";
    const gistId = localStorage.getItem("github_gist_id") || "";

    if (!token) {
      setSyncStatus("unconfigured");
      return;
    }

    if (!gistId) {
      setSyncStatus("has-changes");
      return;
    }

    // Schedule background check 1.2s after mount so initial UI renders smoothly
    const timer = setTimeout(() => {
      performQuietBackgroundCheck(token, gistId);
    }, 1200);

    return () => clearTimeout(timer);
  }, [performQuietBackgroundCheck]);

  // Listen to local database updates (e.g. adding words, taking quizzes) to immediately mark unsynced changes
  useEffect(() => {
    const handleDBUpdate = () => {
      const token = localStorage.getItem("github_gist_token") || "";
      if (token) {
        setSyncStatus("has-changes");
      }
    };

    window.addEventListener("vocab-db-updated", handleDBUpdate);
    return () => {
      window.removeEventListener("vocab-db-updated", handleDBUpdate);
    };
  }, []);

  // Listen to tab focus (visibility change) for throttled background recheck (e.g. if 5+ minutes passed)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        const token = localStorage.getItem("github_gist_token") || "";
        const gistId = localStorage.getItem("github_gist_id") || "";
        if (!token || !gistId) return;

        const lastCheck = Number(localStorage.getItem("last_gist_sync_check") || "0");
        const fiveMinutes = 5 * 60 * 1000;

        if (Date.now() - lastCheck > fiveMinutes) {
          performQuietBackgroundCheck(token, gistId);
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [performQuietBackgroundCheck]);

  // Quick Sync Button Handler
  const handleTriggerSync = async () => {
    const token = localStorage.getItem("github_gist_token") || "";
    const gistId = localStorage.getItem("github_gist_id") || "";

    if (!token) {
      setShowConfigModal(true);
      return;
    }

    setIsCheckingSync(true);
    showToast("info", "Checking remote cloud backup...");

    try {
      const localData = await exportIndexedDBDatabase();

      if (!gistId) {
        // Token exists but no Gist ID yet -> Upload initial local database to cloud
        showToast("info", "No Gist ID found. Uploading initial cloud backup...");
        const jsonString = JSON.stringify(sanitizeDataForCloudSync(localData));
        const newGistId = await syncToGist(token, jsonString);
        localStorage.setItem("github_gist_id", newGistId);
        setSyncStatus("in-sync");
        setPendingCount(0);
        localStorage.setItem("last_gist_sync_check", String(Date.now()));
        showToast("success", "Created new GitHub Gist backup & synced cloud!");
        return;
      }

      // Fetch remote data from Gist
      const remoteData = await syncFromGist(token, gistId);

      const localWords = localData.stores?.words || [];
      const remoteWords = remoteData.stores?.words || [];

      if (localWords.length === 0 && remoteWords.length > 0) {
        // Local database is empty, remote has backup -> Automatically restore from cloud without conflict popup
        showToast("info", "Local database is empty. Restoring from cloud backup...");
        await importIndexedDBDatabase(remoteData);
        if (onReloadData) {
          await onReloadData();
        }
        setSyncStatus("in-sync");
        setPendingCount(0);
        localStorage.setItem("last_gist_sync_check", String(Date.now()));
        showToast("success", "Local database restored from cloud backup!");
        setTimeout(() => {
          window.location.reload();
        }, 1200);
        return;
      }

      // Perform Auto-Merge calculation
      const calculatedMerge = autoMergeLocalAndRemote(localData, remoteData);

      if (!calculatedMerge.hasChanges) {
        setSyncStatus("in-sync");
        setPendingCount(0);
        localStorage.setItem("last_gist_sync_check", String(Date.now()));
        showToast("success", "In Sync: Local database matches cloud backup!");
      } else {
        // Real changes/differences detected -> Show auto-merge confirmation modal with diff details
        setComparisonData({ localData, remoteData });
        setMergeResult(calculatedMerge);
        setShowConfirmModal(true);
        setSyncToast(null);
      }
    } catch (error: any) {
      console.error("Quick Cloud Sync Error:", error);
      showToast("error", `Sync check failed: ${error.message || "Failed to reach GitHub Gist"}`);
    } finally {
      setIsCheckingSync(false);
    }
  };

  // Primary Action: Confirm & Apply Auto-Merge
  const handleConfirmMerge = async () => {
    if (!mergeResult?.mergedData) return;

    const token = localStorage.getItem("github_gist_token") || "";
    const gistId = localStorage.getItem("github_gist_id") || "";

    if (!token) {
      setShowConfirmModal(false);
      setShowConfigModal(true);
      return;
    }

    try {
      setIsSyncing(true);
      showToast("info", "Applying auto-merged changes to local & cloud...");

      // 1. Save merged data to local IndexedDB
      await importIndexedDBDatabase(mergeResult.mergedData);

      // 2. Save merged data to GitHub Gist
      const jsonString = JSON.stringify(sanitizeDataForCloudSync(mergeResult.mergedData));
      const newGistId = await syncToGist(token, jsonString, gistId);
      if (!gistId && newGistId) {
        localStorage.setItem("github_gist_id", newGistId);
      }

      // 3. Reload UI state
      if (onReloadData) {
        await onReloadData();
      }

      setSyncStatus("in-sync");
      setPendingCount(0);
      localStorage.setItem("last_gist_sync_check", String(Date.now()));

      setShowConfirmModal(false);
      showToast("success", "🎉 Auto-Merge Success! Local & Cloud fully synchronized.");
    } catch (error: any) {
      console.error("Failed to apply auto-merge:", error);
      showToast("error", `Merge failed: ${error.message || "Error saving merged backup"}`);
    } finally {
      setIsSyncing(false);
    }
  };

  // Manual Option A: Sync Local to Cloud Only
  const handleSyncLocalToCloud = async () => {
    const token = localStorage.getItem("github_gist_token") || "";
    const gistId = localStorage.getItem("github_gist_id") || "";

    if (!token) {
      setShowConfirmModal(false);
      setShowConfigModal(true);
      return;
    }

    try {
      setIsSyncing(true);
      const localData = await exportIndexedDBDatabase();
      const jsonString = JSON.stringify(sanitizeDataForCloudSync(localData));

      const newGistId = await syncToGist(token, jsonString, gistId);
      if (!gistId && newGistId) {
        localStorage.setItem("github_gist_id", newGistId);
      }

      setSyncStatus("in-sync");
      setPendingCount(0);
      localStorage.setItem("last_gist_sync_check", String(Date.now()));

      setShowConfirmModal(false);
      showToast("success", "Cloud backup overwritten with local database!");
    } catch (error: any) {
      console.error("Failed to sync local to cloud:", error);
      showToast("error", `Upload failed: ${error.message || "Error syncing to Gist"}`);
    } finally {
      setIsSyncing(false);
    }
  };

  // Manual Option B: Overwrite Local from Cloud Only
  const handleOverwriteLocalFromCloud = async () => {
    if (!comparisonData?.remoteData) return;

    try {
      setIsSyncing(true);
      await importIndexedDBDatabase(comparisonData.remoteData);

      if (onReloadData) {
        await onReloadData();
      }

      setSyncStatus("in-sync");
      setPendingCount(0);
      localStorage.setItem("last_gist_sync_check", String(Date.now()));

      setShowConfirmModal(false);
      showToast("success", "Local database overwritten & restored from cloud!");
      setTimeout(() => {
        window.location.reload();
      }, 1200);
    } catch (error: any) {
      console.error("Failed to restore local from cloud:", error);
      showToast("error", `Restore failed: ${error.message || "Error importing backup"}`);
    } finally {
      setIsSyncing(false);
    }
  };

  // Save config from Modal
  const handleSaveConfigAndSync = (_savedToken: string, _savedGistId: string) => {
    setShowConfigModal(false);
    setTimeout(() => {
      handleTriggerSync();
    }, 200);
  };

  const hasToken = Boolean(localStorage.getItem("github_gist_token"));

  let dotColorClass = "bg-stone-300";
  let buttonBorderBgClass = "bg-stone-50 hover:bg-stone-100 border-stone-200/90 text-stone-900";
  let titleText = "Configure Cloud Sync (GitHub Gist)";

  if (!hasToken) {
    dotColorClass = "bg-stone-300";
    buttonBorderBgClass = "bg-stone-50 hover:bg-stone-100 border-stone-200/90 text-stone-700";
    titleText = "Click to set up Cloud Sync (GitHub Gist)";
  } else if (isCheckingSync) {
    dotColorClass = "bg-amber-400 animate-pulse";
    buttonBorderBgClass = "bg-amber-50/70 border-amber-200 text-amber-900";
    titleText = "Checking cloud backup...";
  } else if (isSyncing) {
    dotColorClass = "bg-amber-500 animate-pulse";
    buttonBorderBgClass = "bg-amber-50 border-amber-300 text-amber-950";
    titleText = "Syncing data with cloud...";
  } else if (syncStatus === "has-changes") {
    dotColorClass = "bg-amber-500 animate-pulse ring-2 ring-amber-300/80";
    buttonBorderBgClass = "bg-amber-50/90 hover:bg-amber-100/90 border-amber-300/90 text-amber-950 font-semibold";
    titleText = pendingCount > 0 
      ? `${pendingCount} change${pendingCount > 1 ? "s" : ""} between local & cloud database. Click to sync.`
      : "Changes detected between local & cloud database. Click to sync.";
  } else if (syncStatus === "in-sync") {
    dotColorClass = "bg-emerald-500";
    buttonBorderBgClass = "bg-stone-50 hover:bg-stone-100 border-stone-200/90 text-stone-900";
    titleText = "In Sync: Local database matches cloud backup";
  }

  return (
    <div className="relative inline-block text-left shrink-0" id="quick-cloud-sync-container">
      {/* Quick Cloud Sync Trigger Button */}
      <button
        type="button"
        onClick={handleTriggerSync}
        disabled={isCheckingSync || isSyncing}
        className={`flex items-center gap-1 sm:gap-1.5 px-1.5 py-1 sm:px-2.5 sm:py-1.5 rounded-lg border text-xs font-semibold transition-all cursor-pointer shadow-2xs shrink-0 relative ${buttonBorderBgClass}`}
        title={titleText}
        id="quick-cloud-sync-btn"
      >
        <span className={`w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full shrink-0 transition-all ${dotColorClass}`} />

        {isCheckingSync || isSyncing ? (
          <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-500 shrink-0" />
        ) : (
          <Cloud className={`w-3.5 h-3.5 shrink-0 ${
            syncStatus === "has-changes" ? "text-amber-700" : syncStatus === "in-sync" ? "text-stone-800" : "text-stone-500"
          }`} />
        )}

        <span className="font-bold hidden sm:inline">
          {isCheckingSync ? "Checking..." : isSyncing ? "Syncing..." : "Cloud Sync"}
        </span>

        <span className="font-bold sm:hidden">Sync</span>

        {/* Small pulse ping dot when there are unsynced changes */}
        {syncStatus === "has-changes" && !isCheckingSync && !isSyncing && (
          <span className="flex h-2 w-2 relative -ml-0.5 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
          </span>
        )}
      </button>

      {/* Floating Toast Notification */}
      {syncToast && (
        <div className={`fixed top-16 left-3 right-3 sm:left-auto sm:right-auto sm:absolute sm:top-full sm:right-0 sm:mt-1.5 z-50 text-xs font-semibold px-3 py-2 rounded-xl border shadow-xl flex items-center justify-center sm:justify-start gap-2 whitespace-nowrap animate-in fade-in slide-in-from-top-1 ${
          syncToast.type === "success" 
            ? "bg-stone-900 text-white border-stone-800"
            : syncToast.type === "error"
            ? "bg-red-900 text-white border-red-800"
            : "bg-stone-900 text-amber-300 border-stone-800"
        }`}>
          {syncToast.type === "success" && <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />}
          {syncToast.type === "error" && <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />}
          {syncToast.type === "info" && <RefreshCw className="w-4 h-4 text-amber-400 animate-spin shrink-0" />}
          <span>{syncToast.text}</span>
        </div>
      )}

      {/* Sync Conflict Confirmation Modal with Auto-Merge */}
      <CloudSyncConfirmModal
        isOpen={showConfirmModal}
        localData={comparisonData?.localData}
        remoteData={comparisonData?.remoteData}
        mergeResult={mergeResult}
        isSyncing={isSyncing}
        onConfirmMerge={handleConfirmMerge}
        onSyncLocalToCloud={handleSyncLocalToCloud}
        onOverwriteLocalFromCloud={handleOverwriteLocalFromCloud}
        onCancel={() => setShowConfirmModal(false)}
      />

      {/* Cloud Sync Credentials Configuration Modal */}
      <CloudSyncConfigModal
        isOpen={showConfigModal}
        onClose={() => setShowConfigModal(false)}
        onSaveAndSync={handleSaveConfigAndSync}
        onOpenSettings={() => {
          if (onOpenSettings) onOpenSettings();
        }}
      />
    </div>
  );
}
