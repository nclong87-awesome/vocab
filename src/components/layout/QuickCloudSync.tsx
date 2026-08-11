import { useState, useEffect, useCallback, useRef } from "react";
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

  const checkInProgressRef = useRef<boolean>(false);
  const isSyncingRef = useRef<boolean>(false);

  // Perform quiet background sync check without triggering toast messages
  const performQuietBackgroundCheck = useCallback(async (token: string, gistId: string, force = false) => {
    if (checkInProgressRef.current) {
      return; // Already checking, skip duplicate concurrent call
    }

    if (!force) {
      const lastCheck = Number(localStorage.getItem("last_gist_sync_check") || "0");
      const minimumInterval = 10 * 1000; // 10 seconds throttle for automatic background checks
      if (Date.now() - lastCheck < minimumInterval) {
        return;
      }
    }

    try {
      checkInProgressRef.current = true;
      setIsCheckingSync(true);
      const localData = await exportIndexedDBDatabase();
      const remoteData = await syncFromGist(token, gistId);

      localStorage.setItem("last_gist_sync_check", String(Date.now()));

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
      }
    } catch (e: any) {
      console.error("Cloud sync check failed:", e);
    } finally {
      checkInProgressRef.current = false;
      setIsCheckingSync(false);
    }
  }, []);

  // Check sync status on app launch / mount
  useEffect(() => {
    const token = localStorage.getItem("github_gist_token") || "";
    const gistId = localStorage.getItem("github_gist_id") || "";
    const isConfigured = Boolean(token.trim() || gistId.trim());

    if (!isConfigured) {
      setSyncStatus("unconfigured");
      return;
    }

    if (!gistId && token) {
      // Has PAT token but no Gist ID yet -> needs initial sync
      setSyncStatus("has-changes");
      return;
    }

    // Schedule background check shortly after mount so initial UI renders smoothly
    const timer = setTimeout(() => {
      performQuietBackgroundCheck(token, gistId, true);
    }, 300);

    return () => clearTimeout(timer);
  }, [performQuietBackgroundCheck]);

  // Listen to local database updates (e.g. adding words, taking quizzes) to recheck sync status
  useEffect(() => {
    let checkTimer: NodeJS.Timeout | null = null;
    const handleDBUpdate = () => {
      if (isSyncingRef.current || checkInProgressRef.current) {
        return; // Skip DB update events caused by active sync/check operations
      }
      const token = localStorage.getItem("github_gist_token") || "";
      const gistId = localStorage.getItem("github_gist_id") || "";
      if (token.trim() || gistId.trim()) {
        if (checkTimer) clearTimeout(checkTimer);
        checkTimer = setTimeout(() => {
          performQuietBackgroundCheck(token, gistId, true);
        }, 1200);
      }
    };

    window.addEventListener("vocab-db-updated", handleDBUpdate);
    return () => {
      if (checkTimer) clearTimeout(checkTimer);
      window.removeEventListener("vocab-db-updated", handleDBUpdate);
    };
  }, [performQuietBackgroundCheck]);

  // Listen to tab focus (visibility change) for throttled background recheck (e.g. if 5+ minutes passed)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        const token = localStorage.getItem("github_gist_token") || "";
        const gistId = localStorage.getItem("github_gist_id") || "";
        if (!gistId) return;

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

    setIsCheckingSync(true);
    showToast("info", "Checking remote cloud backup...");

    try {
      const localData = await exportIndexedDBDatabase();

      const isPat = Boolean(token && (token.startsWith("ghp_") || token.startsWith("github_pat_")));

      if (!gistId) {
        if (!isPat) {
          // Worker proxy requires a Gist ID
          setIsCheckingSync(false);
          setShowConfigModal(true);
          showToast("info", "Please configure an existing Gist ID to use Cloud Sync with default Worker proxy.");
          return;
        }

        // Token is a direct PAT -> Create initial cloud backup via GitHub API POST
        showToast("info", "Creating initial cloud backup...");
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

    console.log("[Sync UI] [handleConfirmMerge] Triggered merge action.", {
      hasGistToken: Boolean(token),
      gistId,
      localWordsCount: comparisonData?.localData?.stores?.words?.length || 0,
      remoteWordsCount: comparisonData?.remoteData?.stores?.words?.length || 0,
    });

    try {
      isSyncingRef.current = true;
      setIsSyncing(true);
      showToast("info", "Applying auto-merged changes to local & cloud...");

      // 1. Save merged data to local IndexedDB
      console.log("[Sync UI] [handleConfirmMerge] Step 1: Importing merged data to local IndexedDB...");
      await importIndexedDBDatabase(mergeResult.mergedData);
      console.log("[Sync UI] [handleConfirmMerge] Step 1 Completed: Local IndexedDB import resolved.");

      // 2. Save merged data to GitHub Gist
      const jsonString = JSON.stringify(sanitizeDataForCloudSync(mergeResult.mergedData));
      console.log("[Sync UI] [handleConfirmMerge] Step 2: dispatching cloud syncToGist request...");
      const newGistId = await syncToGist(token, jsonString, gistId);
      console.log("[Sync UI] [handleConfirmMerge] Step 2 Completed: Cloud syncToGist promise successfully resolved with Gist ID:", newGistId);

      if (!gistId && newGistId) {
        localStorage.setItem("github_gist_id", newGistId);
      }

      // 3. Update UI state IMMEDIATELY upon successful promise resolution
      console.log("[Sync UI] [handleConfirmMerge] Updating UI state immediately.");
      setSyncStatus("in-sync");
      setPendingCount(0);
      localStorage.setItem("last_gist_sync_check", String(Date.now()));
      setShowConfirmModal(false);
      showToast("success", "🎉 Auto-Merge Success! Local & Cloud fully synchronized.");

      // Reload Vocabulary data state concurrently in the background
      if (onReloadData) {
        console.log("[Sync UI] [handleConfirmMerge] Dispatching background onReloadData...");
        onReloadData()
          .then(() => console.log("[Sync UI] [handleConfirmMerge] Background onReloadData completed."))
          .catch(err => console.error("[Sync UI] [handleConfirmMerge] Background onReloadData failed:", err));
      }
    } catch (error: any) {
      console.error("[Sync UI] [handleConfirmMerge] Error occurred during merge:", error);
      showToast("error", `Merge failed: ${error.message || "Error saving merged backup"}`);
    } finally {
      setIsSyncing(false);
      setTimeout(() => {
        isSyncingRef.current = false;
      }, 1000);
    }
  };

  // Manual Option A: Sync Local to Cloud Only
  const handleSyncLocalToCloud = async () => {
    const token = localStorage.getItem("github_gist_token") || "";
    const gistId = localStorage.getItem("github_gist_id") || "";

    console.log("[Sync UI] [handleSyncLocalToCloud] Triggered local to cloud override.", {
      hasGistToken: Boolean(token),
      gistId
    });

    try {
      isSyncingRef.current = true;
      setIsSyncing(true);
      showToast("info", "Uploading local database to cloud...");

      const localData = await exportIndexedDBDatabase();
      const jsonString = JSON.stringify(sanitizeDataForCloudSync(localData));

      console.log("[Sync UI] [handleSyncLocalToCloud] Dispatching syncToGist with local database...");
      const newGistId = await syncToGist(token, jsonString, gistId);
      console.log("[Sync UI] [handleSyncLocalToCloud] syncToGist promise resolved with Gist ID:", newGistId);

      if (!gistId && newGistId) {
        localStorage.setItem("github_gist_id", newGistId);
      }

      // Update UI state immediately upon successful promise resolution
      console.log("[Sync UI] [handleSyncLocalToCloud] Updating UI state immediately.");
      setSyncStatus("in-sync");
      setPendingCount(0);
      localStorage.setItem("last_gist_sync_check", String(Date.now()));
      setShowConfirmModal(false);
      showToast("success", "Cloud backup overwritten with local database!");
    } catch (error: any) {
      console.error("[Sync UI] [handleSyncLocalToCloud] Error during local to cloud upload:", error);
      showToast("error", `Upload failed: ${error.message || "Error syncing to Gist"}`);
    } finally {
      setIsSyncing(false);
      setTimeout(() => {
        isSyncingRef.current = false;
      }, 1000);
    }
  };

  // Manual Option B: Overwrite Local from Cloud Only
  const handleOverwriteLocalFromCloud = async () => {
    if (!comparisonData?.remoteData) return;

    console.log("[Sync UI] [handleOverwriteLocalFromCloud] Triggered cloud to local overwrite.", {
      remoteWordsCount: comparisonData.remoteData?.stores?.words?.length || 0
    });

    try {
      isSyncingRef.current = true;
      setIsSyncing(true);
      showToast("info", "Overwriting local database from cloud backup...");

      console.log("[Sync UI] [handleOverwriteLocalFromCloud] Importing cloud backup to local IndexedDB...");
      await importIndexedDBDatabase(comparisonData.remoteData);
      console.log("[Sync UI] [handleOverwriteLocalFromCloud] Local IndexedDB import resolved.");

      // Update UI state immediately upon successful promise resolution
      console.log("[Sync UI] [handleOverwriteLocalFromCloud] Updating UI state immediately.");
      setSyncStatus("in-sync");
      setPendingCount(0);
      localStorage.setItem("last_gist_sync_check", String(Date.now()));
      setShowConfirmModal(false);
      showToast("success", "Local database overwritten & restored from cloud!");

      // Dispatch vocabulary reload and schedule page reload
      if (onReloadData) {
        console.log("[Sync UI] [handleOverwriteLocalFromCloud] Dispatching background onReloadData...");
        onReloadData()
          .then(() => console.log("[Sync UI] [handleOverwriteLocalFromCloud] Background onReloadData completed."))
          .catch(err => console.error("[Sync UI] [handleOverwriteLocalFromCloud] Background onReloadData failed:", err));
      }

      setTimeout(() => {
        console.log("[Sync UI] [handleOverwriteLocalFromCloud] Reloading page to apply restored database...");
        window.location.reload();
      }, 1200);
    } catch (error: any) {
      console.error("[Sync UI] [handleOverwriteLocalFromCloud] Error during restore:", error);
      showToast("error", `Restore failed: ${error.message || "Error importing backup"}`);
    } finally {
      setIsSyncing(false);
      setTimeout(() => {
        isSyncingRef.current = false;
      }, 1000);
    }
  };

  // Save config from Modal
  const handleSaveConfigAndSync = (_savedToken: string, _savedGistId: string) => {
    setShowConfigModal(false);
    setTimeout(() => {
      handleTriggerSync();
    }, 200);
  };

  const token = localStorage.getItem("github_gist_token") || "";
  const gistId = localStorage.getItem("github_gist_id") || "";
  const isConfigured = Boolean(token.trim() || gistId.trim());

  let dotColorClass = "bg-stone-300";
  let buttonBorderBgClass = "bg-stone-50 hover:bg-stone-100 border-stone-200/90 text-stone-900";
  let titleText = "Configure Cloud Sync";

  if (!isConfigured) {
    dotColorClass = "bg-stone-300";
    buttonBorderBgClass = "bg-stone-50 hover:bg-stone-100 border-stone-200/90 text-stone-700";
    titleText = "Click to set up Cloud Sync (GitHub Gist or Worker Proxy)";
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
  } else {
    dotColorClass = "bg-amber-400 animate-pulse";
    buttonBorderBgClass = "bg-stone-50 hover:bg-stone-100 border-stone-200/90 text-stone-900";
    titleText = "Cloud Sync active. Checking cloud status...";
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
