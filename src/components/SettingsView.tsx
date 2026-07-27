import React, { useState, useEffect, useRef } from "react";
import { 
  Volume2, 
  VolumeX, 
  Settings, 
  Sparkles, 
  Cpu, 
  Check, 
  Radio, 
  Sliders, 
  Key, 
  RefreshCw, 
  Play, 
  Square, 
  Server, 
  Bot,
  Globe,
  Database,
  ArrowRight,
  Download,
  Upload,
  HardDrive,
  AlertTriangle,
  Trash2,
  FileJson,
  CheckCircle2,
  Zap,
  BookmarkCheck,
  ShieldCheck,
  ExternalLink,
  Cloud
} from "lucide-react";
import { TTSConfig, TTSEngine, LLMConfig, LLMProvider, SavedProviderConfig } from "../types";
import { PROVIDER_OPTIONS } from "../config/llmProviders";
import { getSavedProvidersMap, switchActiveProvider, removeProviderProfile } from "../utils/llmHelpers";
import { testLlmConnection } from "../services/llmClientService";
import { speakText, stopSpeech, DEFAULT_TTS_CONFIG } from "../utils/ttsService";
import { 
  exportIndexedDBDatabase, 
  importIndexedDBDatabase, 
  resetIndexedDBDatabase 
} from "../db/indexedDB";
import { syncToGist, syncFromGist } from "../services/githubGistService";

import { SUPPORTED_LANGUAGES } from "../config/languages";

interface SettingsViewProps {
  ttsConfig: TTSConfig;
  llmConfig: LLMConfig;
  onSaveTTSConfig: (newConfig: TTSConfig) => void;
  onSaveLLMConfig?: (newConfig: LLMConfig) => void;
  onOpenLlmModal: (initialProvider?: LLMProvider) => void;
  onReloadData?: () => Promise<void>;
  targetLanguage?: string;
  nativeLanguage?: string;
  onSelectLanguages?: (targetLang: string, nativeLang: string, applyToDecks?: boolean) => void;
}

export default function SettingsView({
  ttsConfig,
  llmConfig,
  onSaveTTSConfig,
  onSaveLLMConfig,
  onOpenLlmModal,
  onReloadData,
  targetLanguage = "English",
  nativeLanguage = "Spanish",
  onSelectLanguages
}: SettingsViewProps) {
  const [config, setConfig] = useState<TTSConfig>(ttsConfig);
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [testText, setTestText] = useState("Hello! Welcome to Vocabulary Learner. Audio pronunciation speeds up memory retention.");
  const [isTesting, setIsTesting] = useState(false);
  const [saveSuccessMessage, setSaveSuccessMessage] = useState(false);

  // Language Preferences State
  const [selectedTargetLang, setSelectedTargetLang] = useState<string>(targetLanguage);
  const [selectedNativeLang, setSelectedNativeLang] = useState<string>(nativeLanguage);
  const [langSaveSuccess, setLangSaveSuccess] = useState<string | null>(null);

  useEffect(() => {
    setSelectedTargetLang(targetLanguage);
  }, [targetLanguage]);

  useEffect(() => {
    setSelectedNativeLang(nativeLanguage);
  }, [nativeLanguage]);

  const handleSaveLanguagePreferences = (applyToDecks: boolean = false) => {
    if (onSelectLanguages) {
      onSelectLanguages(selectedTargetLang, selectedNativeLang, applyToDecks);
      setLangSaveSuccess(applyToDecks ? "Default languages updated and applied to all decks!" : "Global default language preferences updated!");
      setTimeout(() => setLangSaveSuccess(null), 3000);
    }
  };

  // LLM Test state
  const [testingLlm, setTestingLlm] = useState(false);
  const [llmTestResult, setLlmTestResult] = useState<{ success: boolean; msg: string } | null>(null);

  // IndexedDB Import / Export State
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [dbStatusMessage, setDbStatusMessage] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);

  // GitHub Gist Sync State
  const [gistToken, setGistToken] = useState(() => localStorage.getItem("github_gist_token") || "");
  const [gistId, setGistId] = useState(() => localStorage.getItem("github_gist_id") || "");
  const [isCloudSyncing, setIsCloudSyncing] = useState(false);

  const handleGistTokenChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setGistToken(e.target.value);
    localStorage.setItem("github_gist_token", e.target.value);
  };

  const handleGistIdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setGistId(e.target.value);
    localStorage.setItem("github_gist_id", e.target.value);
  };

  const handleSyncToCloud = async () => {
    if (!gistToken) {
      setDbStatusMessage({ type: "error", text: "GitHub Personal Access Token is required for Gist sync" });
      return;
    }

    try {
      setIsCloudSyncing(true);
      setDbStatusMessage({ type: "info", text: "Checking remote version..." });
      
      let remoteWarning = "";
      if (gistId) {
        try {
          const remoteData = await syncFromGist(gistToken, gistId);
          if (remoteData && remoteData.exportedAt) {
            const remoteDate = new Date(remoteData.exportedAt).toLocaleString();
            const remoteWordCount = remoteData.stores?.words?.length || 0;
            
            const localData = await exportIndexedDBDatabase();
            const localWordCount = localData.stores.words.length;
            
            remoteWarning = `Remote Backup (${remoteDate}):\n- ${remoteWordCount} words\n\nLocal Database:\n- ${localWordCount} words\n\nAre you sure you want to overwrite the remote backup?`;
          }
        } catch (e) {
          console.warn("Could not fetch remote backup for comparison", e);
        }
      }
      
      const confirmMsg = remoteWarning || "Are you sure you want to backup your database to GitHub Gist? This will overwrite the existing backup if a Gist ID is provided.";
      if (!window.confirm(confirmMsg)) {
        setIsCloudSyncing(false);
        setDbStatusMessage(null);
        return;
      }

      setDbStatusMessage({ type: "info", text: "Generating backup and syncing to GitHub Gist..." });
      
      const dbData = await exportIndexedDBDatabase();
      const jsonString = JSON.stringify(dbData);
      
      const newGistId = await syncToGist(gistToken, jsonString, gistId);
      if (!gistId) {
        setGistId(newGistId);
        localStorage.setItem("github_gist_id", newGistId);
      }
      
      setDbStatusMessage({ type: "success", text: "Backup successfully synced to GitHub Gist!" });
    } catch (error: any) {
      console.error("Cloud Sync Error", error);
      setDbStatusMessage({ type: "error", text: `Failed to sync to cloud: ${error.message}` });
    } finally {
      setIsCloudSyncing(false);
    }
  };

  const handleSyncFromCloud = async () => {
    if (!gistToken || !gistId) {
      setDbStatusMessage({ type: "error", text: "Token and Gist ID are required to restore from GitHub Gist" });
      return;
    }

    try {
      setIsCloudSyncing(true);
      setDbStatusMessage({ type: "info", text: "Downloading backup from GitHub Gist..." });
      
      const data = await syncFromGist(gistToken, gistId);
      
      if (data && data.exportedAt) {
        const remoteDate = new Date(data.exportedAt).toLocaleString();
        const remoteWordCount = data.stores?.words?.length || 0;
        
        const localData = await exportIndexedDBDatabase();
        const localWordCount = localData.stores.words.length;
        
        const confirmMsg = `Remote Backup (${remoteDate}):\n- ${remoteWordCount} words\n\nLocal Database:\n- ${localWordCount} words\n\nAre you sure you want to overwrite your local database with this remote backup?`;
        if (!window.confirm(confirmMsg)) {
          setIsCloudSyncing(false);
          setDbStatusMessage(null);
          return;
        }
      } else {
        if (!window.confirm("Are you sure you want to restore from GitHub Gist? This will overwrite your local database.")) {
          setIsCloudSyncing(false);
          setDbStatusMessage(null);
          return;
        }
      }
      
      setDbStatusMessage({ type: "info", text: "Restoring database..." });
      await importIndexedDBDatabase(data);
      
      setDbStatusMessage({ type: "success", text: "Successfully restored database from GitHub Gist!" });
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } catch (error: any) {
      console.error("Cloud Restore Error", error);
      setDbStatusMessage({ type: "error", text: `Failed to restore from cloud: ${error.message}` });
    } finally {
      setIsCloudSyncing(false);
    }
  };

  // LLM Multi-Provider Handlers
  const savedProvidersMap = getSavedProvidersMap(llmConfig);

  const handleSwitchProvider = (pId: LLMProvider) => {
    const newConfig = switchActiveProvider(llmConfig, pId);
    if (onSaveLLMConfig) {
      onSaveLLMConfig(newConfig);
    }
  };

  const handleRemoveProvider = (pId: LLMProvider) => {
    const newConfig = removeProviderProfile(llmConfig, pId);
    if (onSaveLLMConfig) {
      onSaveLLMConfig(newConfig);
    }
  };

  const handleTestActiveLLM = async () => {
    setTestingLlm(true);
    setLlmTestResult(null);
    try {
      const data = await testLlmConnection(config);
      if (data.success) {
        setLlmTestResult({ success: true, msg: "Active model test passed! Responded successfully." });
      } else {
        setLlmTestResult({ success: false, msg: data.error || "Connection test failed." });
      }
    } catch (err: any) {
      setLlmTestResult({ success: false, msg: err.message || "Failed to reach model." });
    } finally {
      setTestingLlm(false);
    }
  };
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Load system voices for browser TTS
  useEffect(() => {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      const updateVoices = () => {
        const voices = window.speechSynthesis.getVoices();
        setAvailableVoices(voices);
      };

      updateVoices();
      window.speechSynthesis.onvoiceschanged = updateVoices;
    }
  }, []);

  // Update internal state if prop updates
  useEffect(() => {
    setConfig(ttsConfig);
  }, [ttsConfig]);

  const handleTestAudio = async () => {
    if (isTesting) {
      stopSpeech();
      setIsTesting(false);
      return;
    }

    setIsTesting(true);
    await speakText(
      testText,
      config,
      llmConfig,
      undefined,
      () => setIsTesting(true),
      () => setIsTesting(false)
    );
  };

  const handleSave = () => {
    onSaveTTSConfig(config);
    setSaveSuccessMessage(true);
    setTimeout(() => setSaveSuccessMessage(false), 3000);
  };

  // Export IndexedDB Database to JSON file
  const handleExportDB = async () => {
    try {
      setIsExporting(true);
      setDbStatusMessage({ type: "info", text: "Generating IndexedDB database backup..." });
      
      const dbData = await exportIndexedDBDatabase();
      const jsonString = JSON.stringify(dbData, null, 2);
      const blob = new Blob([jsonString], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `vocab_learner_indexeddb_backup_${timestamp}.json`;
      
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      const wordCount = dbData.stores.words ? dbData.stores.words.length : 0;
      setDbStatusMessage({
        type: "success",
        text: `Export successful! Database backup downloaded (${wordCount} words, version ${dbData.version}).`
      });
    } catch (err: any) {
      console.error("Export IndexedDB failed:", err);
      setDbStatusMessage({
        type: "error",
        text: `Failed to export IndexedDB: ${err.message || "Unknown error"}`
      });
    } finally {
      setIsExporting(false);
    }
  };

  // Import JSON file into IndexedDB
  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    setDbStatusMessage({ type: "info", text: "Reading backup file..." });

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const content = e.target?.result as string;
        const parsed = JSON.parse(content);

        setDbStatusMessage({ type: "info", text: "Restoring database into IndexedDB..." });
        const result = await importIndexedDBDatabase(parsed);

        if (onReloadData) {
          await onReloadData();
        }

        setDbStatusMessage({
          type: "success",
          text: `IndexedDB restored successfully! Loaded ${result.recordCounts.words} words into local storage.`
        });
      } catch (err: any) {
        console.error("Import IndexedDB failed:", err);
        setDbStatusMessage({
          type: "error",
          text: `Import failed: ${err.message || "Invalid JSON or corrupt backup file."}`
        });
      } finally {
        setIsImporting(false);
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }
    };

    reader.onerror = () => {
      setDbStatusMessage({ type: "error", text: "Error reading selected JSON file." });
      setIsImporting(false);
    };

    reader.readAsText(file);
  };

  // Reset database state & modal
  const [showResetConfirmModal, setShowResetConfirmModal] = useState(false);
  const [resetMode, setResetMode] = useState<"defaults" | "empty">("defaults");
  const [isResetting, setIsResetting] = useState(false);

  // Reset database execution
  const handleConfirmReset = async () => {
    try {
      setIsResetting(true);
      setDbStatusMessage({ type: "info", text: "Resetting vocabulary decks database..." });

      if (resetMode === "defaults") {
        await resetIndexedDBDatabase();
      } else {
        // Clear all decks completely
        const { clearAllWordsFromDB } = await import("../db/indexedDB");
        await clearAllWordsFromDB();
      }

      // Clear any cached localStorage backups
      try {
        localStorage.removeItem("vocab_learner_decks_backup");
        localStorage.removeItem("vocab_learner_stats_backup");
      } catch (e) {
        // ignore storage quota errors
      }

      if (onReloadData) {
        await onReloadData();
      }

      setDbStatusMessage({
        type: "success",
        text: resetMode === "defaults" 
          ? "Successfully reset vocabulary data to default starter decks." 
          : "Successfully cleared all decks and vocabulary data."
      });
      setShowResetConfirmModal(false);
    } catch (err: any) {
      console.error("Reset DB error:", err);
      setDbStatusMessage({
        type: "error",
        text: `Reset failed: ${err.message || "Unknown error"}`
      });
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8" id="settings-view">
      {/* Header Banner */}
      <div className="bg-white border border-stone-200 p-6 sm:p-8 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-stone-900 text-white">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl sm:text-2xl font-bold text-stone-900 tracking-tight">
                Settings & Voice Engine
              </h2>
              <p className="text-xs sm:text-sm text-stone-500 font-normal mt-0.5">
                Configure Text-to-Speech AI Models, speech pitch, speed, and learning preferences
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-stone-800 bg-stone-100 border border-stone-200 px-3 py-1.5 flex items-center gap-1.5">
              <Volume2 className="w-3.5 h-3.5 text-stone-900" />
              Active TTS: <strong className="text-stone-900 capitalize">{config.engine}</strong>
            </span>
          </div>
        </div>
      </div>

      {/* Save Toast Notification */}
      {saveSuccessMessage && (
        <div className="bg-emerald-900 text-white p-4 flex items-center justify-between text-xs font-semibold tracking-normal animate-in fade-in slide-in-from-top-2">
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4 text-emerald-400 stroke-[3]" />
            <span>Settings saved successfully! Updated preferences are now active.</span>
          </div>
        </div>
      )}

      {/* Language & Translation Preferences Card */}
      <div className="bg-white border border-stone-200 p-6 sm:p-8 space-y-6">
        <div className="border-b border-stone-100 pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-stone-900 flex items-center gap-2">
              <Globe className="w-4 h-4 text-blue-600" />
              Language & Explanation Preferences
            </h3>
            <p className="text-xs text-stone-500 mt-0.5">
              Set your global Target Language (what you want to learn) and Native/Explanation Language.
            </p>
          </div>

          <span className="text-xs font-semibold px-2.5 py-1 bg-stone-100 border border-stone-200 text-stone-700 self-start sm:self-auto">
            Used for AI Curations & Quizzes
          </span>
        </div>

        {langSaveSuccess && (
          <div className="bg-emerald-900 text-white p-3.5 text-xs font-semibold flex items-center gap-2 animate-in fade-in">
            <Check className="w-4 h-4 text-emerald-400 stroke-[3]" />
            <span>{langSaveSuccess}</span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Target Language */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-stone-900 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-blue-500" />
              Target Language (Language to Learn)
            </label>
            <select
              value={selectedTargetLang}
              onChange={(e) => setSelectedTargetLang(e.target.value)}
              className="w-full border border-stone-300 bg-stone-50 p-3 text-xs font-bold text-stone-900 outline-none focus:border-stone-900 cursor-pointer"
            >
              {SUPPORTED_LANGUAGES.map((lang) => (
                <option key={`target-${lang.code}`} value={lang.code}>
                  {lang.flag} {lang.name} ({lang.nativeName})
                </option>
              ))}
            </select>
            <p className="text-[11px] text-stone-500 font-serif italic">
              Vocabulary words, examples, and quizzes will be generated in this language.
            </p>
          </div>

          {/* Native Language */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-stone-900 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              User Native Language (Explanations & Translations)
            </label>
            <select
              value={selectedNativeLang}
              onChange={(e) => setSelectedNativeLang(e.target.value)}
              className="w-full border border-stone-300 bg-stone-50 p-3 text-xs font-bold text-stone-900 outline-none focus:border-stone-900 cursor-pointer"
            >
              {SUPPORTED_LANGUAGES.map((lang) => (
                <option key={`native-${lang.code}`} value={lang.code}>
                  {lang.flag} {lang.name} ({lang.nativeName})
                </option>
              ))}
            </select>
            <p className="text-[11px] text-stone-500 font-serif italic">
              Definitions, example translations, and hints will be explained in this language.
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="pt-2 border-t border-stone-100 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[11px] text-stone-500">
            Current Defaults: <strong className="text-stone-900">{selectedTargetLang}</strong> (Target) → <strong className="text-stone-900">{selectedNativeLang}</strong> (Native)
          </p>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleSaveLanguagePreferences(true)}
              className="px-3.5 py-2 border border-stone-300 bg-stone-100 hover:bg-stone-200 text-stone-800 text-xs font-bold transition-all cursor-pointer"
              title="Batch update all existing deck target and native languages to these selections"
            >
              Apply to All Existing Decks
            </button>

            <button
              type="button"
              onClick={() => handleSaveLanguagePreferences(false)}
              className="px-4 py-2 bg-stone-900 hover:bg-black text-white text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-2xs"
            >
              <Check className="w-3.5 h-3.5 text-emerald-400" />
              <span>Save Language Defaults</span>
            </button>
          </div>
        </div>
      </div>

      {/* Section 1: AI Model Engine Multi-Provider Connections */}
      <div className="bg-white border border-stone-200 p-6 sm:p-8 space-y-6">
        <div className="border-b border-stone-100 pb-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-stone-900 flex items-center gap-2">
              <Bot className="w-4 h-4 text-stone-800" />
              AI Model Provider Connections & Key Storage
            </h3>
            <p className="text-xs text-stone-500 mt-0.5">
              Connect and store credentials for multiple LLM providers (Ollama, OpenAI, GitHub Models, Google Gemini, 9Flare, Custom). Switch engines dynamically anytime.
            </p>
          </div>

          <button
            type="button"
            onClick={() => onOpenLlmModal()}
            className="px-4 py-2 bg-stone-900 hover:bg-black text-white text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer shadow-2xs shrink-0 self-start md:self-auto"
          >
            <Key className="w-3.5 h-3.5" />
            <span>Add / Edit Provider Credentials</span>
          </button>
        </div>

        {/* Active Engine Highlight Box */}
        <div className="bg-stone-50 border border-stone-200 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 pb-3">
            <div className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full ${llmConfig.isLoggedIn ? "bg-emerald-500 animate-pulse" : "bg-red-500"}`} />
              <span className="text-xs font-bold uppercase tracking-wider text-stone-500">Active AI Engine:</span>
              <span className="text-sm font-black text-stone-900 capitalize flex items-center gap-1.5">
                {PROVIDER_OPTIONS.find(p => p.id === llmConfig.provider)?.name || llmConfig.provider}
                <span className="text-xs font-mono font-medium text-stone-600 bg-white border border-stone-200 px-2 py-0.5">
                  {llmConfig.model}
                </span>
              </span>
            </div>

            <button
              type="button"
              onClick={handleTestActiveLLM}
              disabled={testingLlm}
              className="px-3 py-1.5 bg-white hover:bg-stone-100 border border-stone-300 text-stone-900 text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-all shadow-2xs"
            >
              {testingLlm ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-stone-600" />
                  <span>Testing Active Engine...</span>
                </>
              ) : (
                <>
                  <Zap className="w-3.5 h-3.5 text-amber-500 fill-current" />
                  <span>Test Active Connection</span>
                </>
              )}
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
            <div>
              <span className="text-[10px] uppercase font-bold text-stone-400 block">API Key Status</span>
              <span className="font-mono text-stone-800 font-semibold">
                {llmConfig.apiKey ? `••••••••${llmConfig.apiKey.slice(-4)}` : "No Key Required / Using Server Default"}
              </span>
            </div>

            <div>
              <span className="text-[10px] uppercase font-bold text-stone-400 block">Custom Base URL</span>
              <span className="font-mono text-stone-800 font-semibold truncate block">
                {llmConfig.baseUrl || "Default API Gateway"}
              </span>
            </div>

            <div>
              <span className="text-[10px] uppercase font-bold text-stone-400 block">Total Saved Profiles</span>
              <span className="font-semibold text-stone-800">
                {Object.keys(savedProvidersMap).length} Provider Credentials Stored
              </span>
            </div>
          </div>

          {llmTestResult && (
            <div className={`p-2.5 text-xs font-semibold flex items-center gap-2 border ${
              llmTestResult.success ? "bg-emerald-50 border-emerald-300 text-emerald-900" : "bg-red-50 border-red-300 text-red-900"
            }`}>
              {llmTestResult.success ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /> : <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />}
              <span>{llmTestResult.msg}</span>
            </div>
          )}
        </div>

        {/* Provider Cards Grid */}
        <div className="space-y-3">
          <h4 className="text-xs font-bold uppercase tracking-wider text-stone-500">
            Stored AI Engine Profiles ({PROVIDER_OPTIONS.length} Supported Providers)
          </h4>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {PROVIDER_OPTIONS.map((p) => {
              const isActive = llmConfig.provider === p.id;
              const saved = savedProvidersMap[p.id];
              const isSaved = Boolean(saved && (saved.apiKey || !p.requiresKey));

              return (
                <div
                  key={p.id}
                  className={`p-4 border flex flex-col justify-between space-y-3 transition-all ${
                    isActive 
                      ? "bg-stone-900 text-white border-stone-900 shadow-sm" 
                      : isSaved 
                      ? "bg-amber-50/40 border-amber-200 text-stone-900" 
                      : "bg-white border-stone-200 text-stone-800"
                  }`}
                >
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-xs tracking-tight">{p.name}</span>
                      {isActive ? (
                        <span className="text-[10px] font-bold bg-emerald-500 text-white px-2 py-0.5 flex items-center gap-1">
                          <Zap className="w-2.5 h-2.5 fill-current" />
                          ACTIVE
                        </span>
                      ) : isSaved ? (
                        <span className="text-[10px] font-bold bg-amber-200 text-amber-900 border border-amber-300 px-2 py-0.5 flex items-center gap-1">
                          <BookmarkCheck className="w-2.5 h-2.5" />
                          SAVED
                        </span>
                      ) : (
                        <span className="text-[10px] font-medium text-stone-400">Not Saved</span>
                      )}
                    </div>
                    <p className={`text-[11px] font-serif italic line-clamp-1 ${isActive ? "text-stone-300" : "text-stone-500"}`}>
                      {p.tagline}
                    </p>
                  </div>

                  <div className={`p-2 text-[11px] font-mono border space-y-0.5 ${
                    isActive ? "bg-stone-800 border-stone-700 text-stone-200" : "bg-white/80 border-stone-200 text-stone-700"
                  }`}>
                    <div className="flex justify-between">
                      <span className="opacity-60">Model:</span>
                      <span className="font-bold">{saved ? saved.model : p.defaultModel}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="opacity-60">Key:</span>
                      <span>
                        {saved?.apiKey 
                          ? `••••${saved.apiKey.slice(-4)}` 
                          : p.requiresKey ? "None" : "Free / Local"}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 pt-1">
                    {!isActive && isSaved && (
                      <button
                        type="button"
                        onClick={() => handleSwitchProvider(p.id)}
                        className="flex-1 py-1.5 px-2 bg-amber-900 hover:bg-amber-950 text-white text-[11px] font-bold flex items-center justify-center gap-1 transition-all cursor-pointer"
                        title="Switch to this provider profile"
                      >
                        <Zap className="w-3 h-3 text-amber-400 fill-current" />
                        <span>Switch</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => onOpenLlmModal(p.id)}
                      className={`py-1.5 px-2.5 text-[11px] font-bold flex items-center justify-center gap-1 transition-all cursor-pointer ${
                        isActive 
                          ? "w-full bg-white text-stone-900 hover:bg-stone-100" 
                          : isSaved 
                          ? "bg-white border border-stone-300 text-stone-900 hover:bg-stone-100" 
                          : "w-full bg-stone-900 hover:bg-black text-white"
                      }`}
                    >
                      <Key className="w-3 h-3" />
                      <span>{isSaved ? "Edit" : "Configure"}</span>
                    </button>

                    {isSaved && !isActive && (
                      <button
                        type="button"
                        onClick={() => handleRemoveProvider(p.id)}
                        className="p-1.5 bg-white hover:bg-red-50 border border-stone-200 hover:border-red-300 text-stone-400 hover:text-red-600 transition-all cursor-pointer"
                        title="Remove stored credentials for this provider"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Section 2: IndexedDB Database Management (Import & Export) */}
      <div className="bg-white border border-stone-200 p-6 sm:p-8 space-y-6">
        <div className="border-b border-stone-100 pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-bold text-stone-900 flex items-center gap-2">
              <Database className="w-4 h-4 text-stone-800" />
              IndexedDB Database Backup & Restore
            </h3>
            <p className="text-xs text-stone-500 mt-0.5">
              Manage local browser storage, export full database backups to JSON, or restore previous backups.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono font-bold bg-stone-100 text-stone-800 px-2.5 py-1 border border-stone-200 flex items-center gap-1.5">
              <HardDrive className="w-3.5 h-3.5 text-stone-600" />
              VocabLearnerDB (v1)
            </span>
          </div>
        </div>

        {/* Database Action Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Export Database Card */}
          <div className="border border-stone-200 p-5 bg-stone-50/50 flex flex-col justify-between space-y-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-stone-900 font-bold text-xs">
                <Download className="w-4 h-4 text-stone-800" />
                <span>Export IndexedDB Database</span>
              </div>
              <p className="text-xs text-stone-600">
                Download a complete JSON snapshot containing all custom vocabulary decks, word cards, study statistics, and app settings.
              </p>
            </div>

            <button
              type="button"
              onClick={handleExportDB}
              disabled={isExporting}
              className="w-full py-2.5 px-4 bg-stone-900 hover:bg-black text-white text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer shadow-2xs"
            >
              {isExporting ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Exporting JSON...</span>
                </>
              ) : (
                <>
                  <FileJson className="w-3.5 h-3.5" />
                  <span>Export Database JSON</span>
                </>
              )}
            </button>
          </div>

          {/* Import Database Card */}
          <div className="border border-stone-200 p-5 bg-stone-50/50 flex flex-col justify-between space-y-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-stone-900 font-bold text-xs">
                <Upload className="w-4 h-4 text-stone-800" />
                <span>Import IndexedDB Backup</span>
              </div>
              <p className="text-xs text-stone-600">
                Restore a previously exported `.json` database file to load custom decks and study history into local browser storage.
              </p>
            </div>

            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                onChange={handleFileSelect}
                className="hidden"
                id="indexeddb-file-input"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isImporting}
                className="w-full py-2.5 px-4 bg-stone-100 hover:bg-stone-200 border border-stone-300 text-stone-900 text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer shadow-2xs"
              >
                {isImporting ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Restoring Database...</span>
                  </>
                ) : (
                  <>
                    <Upload className="w-3.5 h-3.5" />
                    <span>Select JSON File to Restore</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Cloud Sync Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
          <div className="md:col-span-2 border border-stone-200 p-5 bg-stone-50/50 flex flex-col justify-between space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-stone-900 font-bold text-xs">
                  <Cloud className="w-4 h-4 text-stone-800" />
                  <span>GitHub Gist Cloud Sync</span>
                </div>
              </div>
              <p className="text-xs text-stone-600">
                Sync your database backup securely to a private GitHub Gist to easily restore it on other devices.
                You can create a Personal Access Token (classic) with the <code className="bg-stone-200 px-1 py-0.5 rounded">gist</code> scope at <a href="https://github.com/settings/tokens/new" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">GitHub Settings</a>.
              </p>
            </div>
            
            <div className="space-y-3">
              <div>
                <label className="block text-[10px] font-bold text-stone-500 uppercase tracking-wider mb-1">
                  GitHub Personal Access Token
                </label>
                <input
                  type="password"
                  value={gistToken}
                  onChange={handleGistTokenChange}
                  placeholder="ghp_..."
                  className="w-full bg-white border border-stone-200 p-2 text-xs font-medium text-stone-800 focus:outline-none focus:border-stone-400 focus:ring-1 focus:ring-stone-400 transition-all placeholder:text-stone-400"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-stone-500 uppercase tracking-wider mb-1">
                  Gist ID (Leave blank to create a new Gist)
                </label>
                <input
                  type="text"
                  value={gistId}
                  onChange={handleGistIdChange}
                  placeholder="Gist ID (e.g. 64abc123...)"
                  className="w-full bg-white border border-stone-200 p-2 text-xs font-mono font-medium text-stone-800 focus:outline-none focus:border-stone-400 focus:ring-1 focus:ring-stone-400 transition-all placeholder:text-stone-400"
                />
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <button
                type="button"
                onClick={handleSyncToCloud}
                disabled={isCloudSyncing || isExporting || isImporting || !gistToken}
                className="flex-1 py-2.5 px-4 bg-stone-900 hover:bg-black text-white text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer shadow-2xs disabled:opacity-50"
              >
                <Upload className="w-3.5 h-3.5" />
                Backup to Cloud
              </button>
              <button
                type="button"
                onClick={handleSyncFromCloud}
                disabled={isCloudSyncing || isExporting || isImporting || !gistToken || !gistId}
                className="flex-1 py-2.5 px-4 bg-stone-100 hover:bg-stone-200 border border-stone-300 text-stone-900 text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer shadow-2xs disabled:opacity-50"
              >
                <Download className="w-3.5 h-3.5" />
                Restore from Cloud
              </button>
            </div>
          </div>
        </div>

        {/* Status Alert Banner */}
        {dbStatusMessage && (
          <div className={`p-4 border text-xs font-medium flex items-start gap-3 transition-all ${
            dbStatusMessage.type === "success" 
              ? "bg-emerald-50 border-emerald-300 text-emerald-900" 
              : dbStatusMessage.type === "error"
              ? "bg-red-50 border-red-300 text-red-900"
              : "bg-blue-50 border-blue-300 text-blue-900"
          }`}>
            {dbStatusMessage.type === "success" && <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />}
            {dbStatusMessage.type === "error" && <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />}
            {dbStatusMessage.type === "info" && <RefreshCw className="w-4 h-4 text-blue-600 animate-spin shrink-0 mt-0.5" />}
            <span className="flex-1">{dbStatusMessage.text}</span>
          </div>
        )}

        {/* Danger Zone: Reset Vocabularies & Decks Data */}
        <div className="pt-4 border-t border-red-100 bg-red-50/50 p-5 border border-red-200 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-red-900 font-bold text-xs">
                <AlertTriangle className="w-4 h-4 text-red-600" />
                <span>Reset Vocabularies Data & Decks</span>
              </div>
              <p className="text-xs text-red-700 font-normal">
                Wipe all custom decks, generated decks, and study history. Reset database to default starter decks or clear completely.
              </p>
            </div>

            <button
              type="button"
              onClick={() => setShowResetConfirmModal(true)}
              className="px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white font-semibold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer shadow-xs shrink-0"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Reset Vocabulary Data</span>
            </button>
          </div>
        </div>
      </div>

      {/* Section 3: Text-to-Speech (TTS) Engine Selection */}
      <div className="bg-white border border-stone-200 p-6 sm:p-8 space-y-6">
        <div className="border-b border-stone-100 pb-4">
          <h3 className="text-base font-bold text-stone-900 flex items-center gap-2">
            <Cpu className="w-4 h-4 text-stone-700" />
            Select Text-to-Speech (TTS) Engine
          </h3>
          <p className="text-xs text-stone-500 mt-1">
            Choose between offline browser speech synthesis or server-side AI voice models.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Browser TTS */}
          <button
            type="button"
            onClick={() => setConfig({ ...config, engine: 'browser' })}
            className={`p-4 text-left border transition-all cursor-pointer flex flex-col justify-between space-y-3 ${
              config.engine === 'browser'
                ? "border-stone-900 bg-stone-900 text-white shadow-sm"
                : "border-stone-200 bg-white text-stone-800 hover:border-stone-400"
            }`}
          >
            <div className="flex justify-between items-start">
              <div className={`p-1.5 ${config.engine === 'browser' ? "bg-stone-800 text-amber-400" : "bg-stone-100 text-stone-800"}`}>
                <Globe className="w-4 h-4" />
              </div>
              <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 ${
                config.engine === 'browser' ? "bg-amber-400 text-stone-950" : "bg-stone-100 text-stone-600"
              }`}>
                Default
              </span>
            </div>

            <div>
              <h4 className="font-bold text-xs tracking-normal">Browser Native</h4>
              <p className={`text-[11px] mt-1 ${config.engine === 'browser' ? "text-stone-300" : "text-stone-500"}`}>
                Instant & offline system speech synthesis. Zero latency.
              </p>
            </div>
          </button>

          {/* Gemini AI Audio TTS */}
          <button
            type="button"
            onClick={() => setConfig({ ...config, engine: 'gemini' })}
            className={`p-4 text-left border transition-all cursor-pointer flex flex-col justify-between space-y-3 ${
              config.engine === 'gemini'
                ? "border-stone-900 bg-stone-900 text-white shadow-sm"
                : "border-stone-200 bg-white text-stone-800 hover:border-stone-400"
            }`}
          >
            <div className="flex justify-between items-start">
              <div className={`p-1.5 ${config.engine === 'gemini' ? "bg-stone-800 text-amber-400" : "bg-stone-100 text-stone-800"}`}>
                <Sparkles className="w-4 h-4" />
              </div>
              <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 ${
                config.engine === 'gemini' ? "bg-amber-400 text-stone-950" : "bg-stone-100 text-stone-600"
              }`}>
                AI Voice
              </span>
            </div>

            <div>
              <h4 className="font-bold text-xs tracking-normal">Gemini AI TTS</h4>
              <p className={`text-[11px] mt-1 ${config.engine === 'gemini' ? "text-stone-300" : "text-stone-500"}`}>
                Natural AI human speech via Gemini prebuilt audio voices.
              </p>
            </div>
          </button>

          {/* OpenAI TTS */}
          <button
            type="button"
            onClick={() => setConfig({ ...config, engine: 'openai' })}
            className={`p-4 text-left border transition-all cursor-pointer flex flex-col justify-between space-y-3 ${
              config.engine === 'openai'
                ? "border-stone-900 bg-stone-900 text-white shadow-sm"
                : "border-stone-200 bg-white text-stone-800 hover:border-stone-400"
            }`}
          >
            <div className="flex justify-between items-start">
              <div className={`p-1.5 ${config.engine === 'openai' ? "bg-stone-800 text-amber-400" : "bg-stone-100 text-stone-800"}`}>
                <Bot className="w-4 h-4" />
              </div>
              <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 ${
                config.engine === 'openai' ? "bg-amber-400 text-stone-950" : "bg-stone-100 text-stone-600"
              }`}>
                Studio
              </span>
            </div>

            <div>
              <h4 className="font-bold text-xs tracking-normal">OpenAI Speech</h4>
              <p className={`text-[11px] mt-1 ${config.engine === 'openai' ? "text-stone-300" : "text-stone-500"}`}>
                Studio quality audio with tts-1 & tts-1-hd voice models.
              </p>
            </div>
          </button>

          {/* Custom Webhook API */}
          <button
            type="button"
            onClick={() => setConfig({ ...config, engine: 'custom' })}
            className={`p-4 text-left border transition-all cursor-pointer flex flex-col justify-between space-y-3 ${
              config.engine === 'custom'
                ? "border-stone-900 bg-stone-900 text-white shadow-sm"
                : "border-stone-200 bg-white text-stone-800 hover:border-stone-400"
            }`}
          >
            <div className="flex justify-between items-start">
              <div className={`p-1.5 ${config.engine === 'custom' ? "bg-stone-800 text-amber-400" : "bg-stone-100 text-stone-800"}`}>
                <Server className="w-4 h-4" />
              </div>
              <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 ${
                config.engine === 'custom' ? "bg-amber-400 text-stone-950" : "bg-stone-100 text-stone-600"
              }`}>
                Custom
              </span>
            </div>

            <div>
              <h4 className="font-bold text-xs tracking-normal">Custom Endpoint</h4>
              <p className={`text-[11px] mt-1 ${config.engine === 'custom' ? "text-stone-300" : "text-stone-500"}`}>
                Connect self-hosted speech services or external ElevenLabs proxy.
              </p>
            </div>
          </button>
        </div>

        {/* Engine Specific Configuration Options */}
        <div className="bg-stone-50 border border-stone-200 p-5 space-y-5">
          {/* Browser Voice Options */}
          {config.engine === 'browser' && (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h4 className="text-xs font-bold text-stone-900">
                  Browser System Voice Selection
                </h4>
                <span className="text-[10px] text-stone-500 font-mono">
                  {availableVoices.length} voices found
                </span>
              </div>

              <div>
                <select
                  value={config.voiceURI || ""}
                  onChange={(e) => setConfig({ ...config, voiceURI: e.target.value })}
                  className="w-full p-2.5 bg-white border border-stone-300 text-xs font-medium text-stone-900 rounded-none focus:outline-none focus:border-stone-900"
                >
                  <option value="">Default System Voice</option>
                  {availableVoices.map((v) => (
                    <option key={v.voiceURI} value={v.voiceURI}>
                      {v.name} ({v.lang})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">
                    Speech Rate: {config.speed.toFixed(1)}x
                  </label>
                  <input
                    type="range"
                    min="0.5"
                    max="2.0"
                    step="0.1"
                    value={config.speed}
                    onChange={(e) => setConfig({ ...config, speed: parseFloat(e.target.value) })}
                    className="w-full accent-stone-900 cursor-pointer"
                  />
                  <div className="flex justify-between text-[10px] text-stone-500 font-mono mt-0.5">
                    <span>0.5x Slow</span>
                    <span>1.0x Normal</span>
                    <span>2.0x Fast</span>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">
                    Voice Pitch: {config.pitch.toFixed(1)}
                  </label>
                  <input
                    type="range"
                    min="0.5"
                    max="1.5"
                    step="0.1"
                    value={config.pitch}
                    onChange={(e) => setConfig({ ...config, pitch: parseFloat(e.target.value) })}
                    className="w-full accent-stone-900 cursor-pointer"
                  />
                  <div className="flex justify-between text-[10px] text-stone-500 font-mono mt-0.5">
                    <span>0.5 Low</span>
                    <span>1.0 Medium</span>
                    <span>1.5 High</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Gemini AI Audio Voice Options */}
          {config.engine === 'gemini' && (
            <div className="space-y-4">
              <h4 className="text-xs font-bold text-stone-900 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                Gemini AI Voice Configuration
              </h4>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">
                    Prebuilt AI Voice Persona
                  </label>
                  <select
                    value={config.voice || "Puck"}
                    onChange={(e) => setConfig({ ...config, voice: e.target.value })}
                    className="w-full p-2.5 bg-white border border-stone-300 text-xs font-medium text-stone-900 rounded-none focus:outline-none focus:border-stone-900"
                  >
                    <option value="Puck">Puck (Enthusiastic & Clear)</option>
                    <option value="Charon">Charon (Deep & Resonant)</option>
                    <option value="Kore">Kore (Warm & Melodic)</option>
                    <option value="Fenrir">Fenrir (Strong & Expressive)</option>
                    <option value="Aoede">Aoede (Soft & Precise)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">
                    Gemini Model Alias
                  </label>
                  <select
                    value={config.model || "gemini-3.6-flash"}
                    onChange={(e) => setConfig({ ...config, model: e.target.value })}
                    className="w-full p-2.5 bg-white border border-stone-300 text-xs font-medium text-stone-900 rounded-none focus:outline-none focus:border-stone-900"
                  >
                    <option value="gemini-3.6-flash">gemini-3.6-flash (Recommended)</option>
                    {PROVIDER_OPTIONS.find(p => p.id === "gemini")?.tts_models?.filter(m => m !== "gemini-3.6-flash").map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  Custom Gemini API Key (Optional Override)
                </label>
                <input
                  type="password"
                  value={config.apiKey || ""}
                  onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
                  placeholder="Leave blank to use default system/login API key"
                  className="w-full p-2.5 bg-white border border-stone-300 text-xs font-mono text-stone-900 rounded-none focus:outline-none focus:border-stone-900"
                />
                <p className="text-[11px] text-stone-500 mt-1">
                  If left empty, Gemini TTS uses your active LLM login key or server environment key.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  Playback Speed: {config.speed.toFixed(1)}x
                </label>
                <input
                  type="range"
                  min="0.5"
                  max="1.8"
                  step="0.1"
                  value={config.speed}
                  onChange={(e) => setConfig({ ...config, speed: parseFloat(e.target.value) })}
                  className="w-full accent-stone-900 cursor-pointer"
                />
              </div>
            </div>
          )}

          {/* OpenAI TTS Options */}
          {config.engine === 'openai' && (
            <div className="space-y-4">
              <h4 className="text-xs font-bold text-stone-900">
                OpenAI Speech Model Options
              </h4>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">
                    Speech Voice Persona
                  </label>
                  <select
                    value={config.voice || "alloy"}
                    onChange={(e) => setConfig({ ...config, voice: e.target.value })}
                    className="w-full p-2.5 bg-white border border-stone-300 text-xs font-medium text-stone-900 rounded-none focus:outline-none focus:border-stone-900"
                  >
                    <option value="alloy">Alloy (Neutral & Versatile)</option>
                    <option value="echo">Echo (Warm & Grounded)</option>
                    <option value="fable">Fable (Narrative & Expressive)</option>
                    <option value="onyx">Onyx (Deep & Authoritative)</option>
                    <option value="nova">Nova (Energetic & Friendly)</option>
                    <option value="shimmer">Shimmer (Clear & Bright)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">
                    OpenAI Audio Model
                  </label>
                  <select
                    value={config.model || "tts-1"}
                    onChange={(e) => setConfig({ ...config, model: e.target.value })}
                    className="w-full p-2.5 bg-white border border-stone-300 text-xs font-medium text-stone-900 rounded-none focus:outline-none focus:border-stone-900"
                  >
                    <option value="tts-1">tts-1 (Fast & High Quality)</option>
                    <option value="tts-1-hd">tts-1-hd (Ultra HD Quality)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  OpenAI API Key
                </label>
                <input
                  type="password"
                  value={config.apiKey || ""}
                  onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
                  placeholder="sk-proj-..."
                  className="w-full p-2.5 bg-white border border-stone-300 text-xs font-mono text-stone-900 rounded-none focus:outline-none focus:border-stone-900"
                />
              </div>
            </div>
          )}

          {/* Custom Endpoint Options */}
          {config.engine === 'custom' && (
            <div className="space-y-4">
              <h4 className="text-xs font-bold text-stone-900">
                Custom Webhook / TTS Proxy Endpoint
              </h4>

              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  Endpoint URL
                </label>
                <input
                  type="url"
                  value={config.customEndpoint || ""}
                  onChange={(e) => setConfig({ ...config, customEndpoint: e.target.value })}
                  placeholder="https://my-tts-proxy.example.com/api/speak"
                  className="w-full p-2.5 bg-white border border-stone-300 text-xs font-mono text-stone-900 rounded-none focus:outline-none focus:border-stone-900"
                />
                <p className="text-[11px] text-stone-500 mt-1">
                  Accepts POST requests with JSON payload &#123; text, voice, model &#125; returning audio arrayBuffer or base64 audio URL.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">
                    Voice / Persona Name
                  </label>
                  <input
                    type="text"
                    value={config.voice || ""}
                    onChange={(e) => setConfig({ ...config, voice: e.target.value })}
                    placeholder="e.g. Rachel, Adam, CustomVoice"
                    className="w-full p-2.5 bg-white border border-stone-300 text-xs font-mono text-stone-900 rounded-none focus:outline-none focus:border-stone-900"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">
                    API Authorization Token
                  </label>
                  <input
                    type="password"
                    value={config.apiKey || ""}
                    onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
                    placeholder="Bearer token or secret key"
                    className="w-full p-2.5 bg-white border border-stone-300 text-xs font-mono text-stone-900 rounded-none focus:outline-none focus:border-stone-900"
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Section 4: Interactive Voice Tester Studio */}
      <div className="bg-white border border-stone-200 p-6 sm:p-8 space-y-4">
        <div className="border-b border-stone-100 pb-3 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-stone-900 flex items-center gap-2">
              <Volume2 className="w-4 h-4 text-stone-800" />
              Test Voice Studio
            </h3>
            <p className="text-xs text-stone-500 mt-0.5">
              Listen to a sample text using the currently selected voice settings
            </p>
          </div>
          <span className="text-xs font-mono font-medium text-stone-500 capitalize">
            {config.engine}
          </span>
        </div>

        <div className="space-y-3">
          <textarea
            value={testText}
            onChange={(e) => setTestText(e.target.value)}
            rows={2}
            className="w-full p-3 bg-stone-50 border border-stone-200 text-xs text-stone-900 font-medium focus:outline-none focus:border-stone-900 rounded-none"
            placeholder="Type sample text to test pronunciation..."
          />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={handleTestAudio}
              className={`px-5 py-2.5 text-xs font-semibold flex items-center gap-2 cursor-pointer transition-all ${
                isTesting 
                  ? "bg-amber-400 text-stone-950 animate-pulse" 
                  : "bg-stone-900 text-white hover:bg-stone-800"
              }`}
            >
              {isTesting ? (
                <>
                  <Square className="w-3.5 h-3.5 fill-current" />
                  <span>Stop Audio</span>
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>Test Voice Model</span>
                </>
              )}
            </button>

            <span className="text-xs font-medium text-stone-500">
              {isTesting ? "Playing speech..." : "Click button to test output"}
            </span>
          </div>
        </div>
      </div>

      {/* Section 5: Quiz Audio Preference */}
      <div className="bg-white border border-stone-200 p-6 space-y-4">
        <div>
          <h3 className="text-sm font-bold text-stone-900 flex items-center gap-2">
            <Volume2 className="w-4 h-4 text-stone-800" />
            Quiz Session Audio
          </h3>
          <p className="text-xs text-stone-500 mt-1">
            Automatically pronounce questions when transitioning between quiz items
          </p>
        </div>

        <button
          type="button"
          onClick={() => setConfig({ ...config, autoPlayAudioInQuiz: !config.autoPlayAudioInQuiz })}
          className={`p-3 border text-xs font-semibold flex items-center justify-between cursor-pointer transition-all ${
            config.autoPlayAudioInQuiz 
              ? "bg-stone-900 border-stone-900 text-white" 
              : "bg-white border-stone-200 text-stone-600 hover:border-stone-400"
          }`}
        >
          <div className="flex items-center gap-2">
            {config.autoPlayAudioInQuiz ? <Volume2 className="w-4 h-4 text-amber-400" /> : <VolumeX className="w-4 h-4" />}
            <span>Auto-Play Quiz Voice: {config.autoPlayAudioInQuiz ? "Enabled" : "Disabled"}</span>
          </div>
          <div className={`w-3 h-3 rounded-full ${config.autoPlayAudioInQuiz ? "bg-amber-400" : "bg-stone-300"}`} />
        </button>
      </div>



      {/* Reset Confirmation Modal */}
      {showResetConfirmModal && (
        <div className="fixed inset-0 bg-stone-900/70 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-stone-200 p-6 sm:p-8 w-full max-w-md space-y-5 shadow-2xl animate-in fade-in zoom-in-95">
            <div className="flex justify-between items-start pb-3 border-b border-stone-100">
              <div className="flex items-center gap-2 text-red-600 font-bold text-sm">
                <AlertTriangle className="w-5 h-5" />
                <span>Confirm Reset Data</span>
              </div>
              <button
                type="button"
                onClick={() => setShowResetConfirmModal(false)}
                disabled={isResetting}
                className="text-stone-400 hover:text-stone-900 p-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs text-stone-600">
              <p className="font-semibold text-stone-900">
                Are you sure you want to reset your vocabulary data?
              </p>
              <p>
                This will delete custom decks, AI-generated decks, and saved study statistics stored in browser IndexedDB.
              </p>

              <div className="space-y-2 pt-2">
                <label className="block text-xs font-semibold text-stone-900">Choose Reset Mode:</label>
                
                <label className={`flex items-start gap-3 p-3 border cursor-pointer transition-all ${
                  resetMode === 'defaults' ? "bg-stone-50 border-stone-900 text-stone-900" : "border-stone-200 bg-white"
                }`}>
                  <input
                    type="radio"
                    name="resetMode"
                    checked={resetMode === 'defaults'}
                    onChange={() => setResetMode('defaults')}
                    className="mt-0.5 accent-stone-900"
                  />
                  <div>
                    <span className="font-bold block text-xs">Restore Default Starter Decks</span>
                    <span className="text-[11px] text-stone-500 font-normal">
                      Replaces custom data with original starter decks (Spanish, French, Food, Tech).
                    </span>
                  </div>
                </label>

                <label className={`flex items-start gap-3 p-3 border cursor-pointer transition-all ${
                  resetMode === 'empty' ? "bg-red-50/50 border-red-500 text-red-950" : "border-stone-200 bg-white"
                }`}>
                  <input
                    type="radio"
                    name="resetMode"
                    checked={resetMode === 'empty'}
                    onChange={() => setResetMode('empty')}
                    className="mt-0.5 accent-red-600"
                  />
                  <div>
                    <span className="font-bold block text-xs text-red-900">Completely Clear All Decks</span>
                    <span className="text-[11px] text-stone-500 font-normal">
                      Removes all decks and leaves your deck workshop completely blank.
                    </span>
                  </div>
                </label>
              </div>
            </div>

            <div className="flex gap-2 justify-end pt-3 border-t border-stone-100">
              <button
                type="button"
                onClick={() => setShowResetConfirmModal(false)}
                disabled={isResetting}
                className="px-4 py-2 text-xs font-semibold text-stone-600 hover:text-stone-900 cursor-pointer disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmReset}
                disabled={isResetting}
                className="px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white font-semibold text-xs flex items-center gap-2 transition-all cursor-pointer shadow-xs disabled:opacity-40"
              >
                {isResetting ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Resetting...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Confirm Reset</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Save Settings Action Bar */}
      <div className="bg-stone-900 text-white p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div>
          <h4 className="font-bold text-base">Save Voice & Audio Preferences</h4>
          <p className="text-xs text-stone-300 mt-0.5">
            Applies chosen speech synthesis engine across practice quizzes, flashcards, and deck collection
          </p>
        </div>

        <button
          type="button"
          onClick={handleSave}
          className="w-full sm:w-auto px-8 py-3 bg-white text-stone-950 font-bold text-xs hover:bg-amber-400 transition-all cursor-pointer shadow-md shrink-0 flex items-center justify-center gap-2"
        >
          <Check className="w-4 h-4 stroke-[3]" />
          <span>Save Settings</span>
        </button>
      </div>
    </div>
  );
}
