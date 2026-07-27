import React, { useState } from "react";
import { 
  Cloud, 
  RefreshCw, 
  CheckCircle2, 
  AlertTriangle, 
  Upload, 
  Download,
  ArrowUpRight
} from "lucide-react";
import { exportIndexedDBDatabase, importIndexedDBDatabase } from "../../db/indexedDB";
import { syncToGist, syncFromGist } from "../../services/githubGistService";
import CloudSyncConfirmModal from "./CloudSyncConfirmModal";
import CloudSyncConfigModal from "./CloudSyncConfigModal";

interface QuickCloudSyncProps {
  onReloadData?: () => Promise<void>;
  onOpenSettings?: () => void;
}

export default function QuickCloudSync({ onReloadData, onOpenSettings }: QuickCloudSyncProps) {
  const [isCheckingSync, setIsCheckingSync] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  
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

  const showToast = (type: "success" | "error" | "info", text: string, duration = 3500) => {
    setSyncToast({ type, text });
    setTimeout(() => {
      setSyncToast(prev => (prev?.text === text ? null : prev));
    }, duration);
  };

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
        // Token exists but no Gist ID yet -> Upload initial local database to cloud or prompt
        showToast("info", "No Gist ID found. Uploading initial cloud backup...");
        const jsonString = JSON.stringify(localData);
        const newGistId = await syncToGist(token, jsonString);
        localStorage.setItem("github_gist_id", newGistId);
        showToast("success", "Created new GitHub Gist backup & synced cloud!");
        return;
      }

      // Fetch remote data from Gist
      const remoteData = await syncFromGist(token, gistId);

      // Compare local vs remote decks and stats
      const localDecksStr = JSON.stringify(localData.stores?.decks || []);
      const remoteDecksStr = JSON.stringify(remoteData.stores?.decks || []);
      const localStatsStr = JSON.stringify(localData.stores?.stats || []);
      const remoteStatsStr = JSON.stringify(remoteData.stores?.stats || []);

      const isIdentical = (localDecksStr === remoteDecksStr) && (localStatsStr === remoteStatsStr);

      if (isIdentical) {
        showToast("success", "In Sync: Local database matches cloud backup!");
      } else {
        // Differences found -> Show confirmation modal with choices
        setComparisonData({ localData, remoteData });
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

  // Choice A: Sync Local to Cloud
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
      const jsonString = JSON.stringify(localData);

      const newGistId = await syncToGist(token, jsonString, gistId);
      if (!gistId && newGistId) {
        localStorage.setItem("github_gist_id", newGistId);
      }

      setShowConfirmModal(false);
      showToast("success", "Cloud backup updated successfully with local changes!");
    } catch (error: any) {
      console.error("Failed to sync local to cloud:", error);
      showToast("error", `Upload failed: ${error.message || "Error syncing to Gist"}`);
    } finally {
      setIsSyncing(false);
    }
  };

  // Choice B: Overwrite Local from Cloud
  const handleOverwriteLocalFromCloud = async () => {
    if (!comparisonData?.remoteData) return;

    try {
      setIsSyncing(true);
      await importIndexedDBDatabase(comparisonData.remoteData);

      if (onReloadData) {
        await onReloadData();
      }

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
  const handleSaveConfigAndSync = (savedToken: string, savedGistId: string) => {
    setShowConfigModal(false);
    setTimeout(() => {
      handleTriggerSync();
    }, 200);
  };

  const hasToken = Boolean(localStorage.getItem("github_gist_token"));

  return (
    <div className="relative inline-block text-left shrink-0" id="quick-cloud-sync-container">
      {/* Quick Cloud Sync Trigger Button */}
      <button
        type="button"
        onClick={handleTriggerSync}
        disabled={isCheckingSync || isSyncing}
        className={`flex items-center gap-1 sm:gap-1.5 px-1.5 py-1 sm:px-3 sm:py-1.5 border text-[11px] sm:text-xs font-medium tracking-normal transition-all cursor-pointer shadow-2xs shrink-0 ${
          isCheckingSync || isSyncing
            ? "bg-stone-900 text-white border-stone-900 opacity-90"
            : "bg-stone-50 hover:bg-stone-100 border-stone-200 text-stone-900"
        }`}
        title={hasToken ? "Sync latest data with Cloud (GitHub Gist)" : "Configure Cloud Sync (GitHub Gist)"}
        id="quick-cloud-sync-btn"
      >
        <span 
          className={`w-2 h-2 rounded-full shrink-0 ${
            hasToken ? "bg-emerald-500 animate-pulse" : "bg-stone-300"
          }`} 
        />

        {isCheckingSync || isSyncing ? (
          <RefreshCw className="w-3 h-3 sm:w-3.5 sm:h-3.5 animate-spin text-amber-400 shrink-0" />
        ) : (
          <Cloud className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-stone-700 shrink-0" />
        )}

        <span className="font-bold hidden sm:inline">
          {isCheckingSync ? "Checking..." : isSyncing ? "Syncing..." : "Cloud Sync"}
        </span>

        <span className="font-bold sm:hidden">Sync</span>
      </button>

      {/* Floating Toast Notification */}
      {syncToast && (
        <div className={`fixed top-16 left-3 right-3 sm:left-auto sm:right-auto sm:absolute sm:top-full sm:right-0 sm:mt-1 z-50 text-[11px] font-semibold px-3 py-2 border shadow-lg flex items-center justify-center sm:justify-start gap-2 whitespace-nowrap animate-in fade-in slide-in-from-top-1 ${
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

      {/* Sync Conflict Confirmation Modal */}
      <CloudSyncConfirmModal
        isOpen={showConfirmModal}
        localData={comparisonData?.localData}
        remoteData={comparisonData?.remoteData}
        isSyncing={isSyncing}
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
