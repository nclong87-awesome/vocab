import React, { useState, useEffect } from "react";
import { 
  Cloud, 
  X, 
  Check, 
  Sliders, 
  AlertCircle
} from "lucide-react";

interface CloudSyncConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaveAndSync: (token: string, gistId: string) => void;
  onOpenSettings: () => void;
}

export default function CloudSyncConfigModal({
  isOpen,
  onClose,
  onSaveAndSync,
  onOpenSettings
}: CloudSyncConfigModalProps) {
  const [token, setToken] = useState(() => localStorage.getItem("github_gist_token") || "");
  const [gistId, setGistId] = useState(() => localStorage.getItem("github_gist_id") || "");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setToken(localStorage.getItem("github_gist_token") || "");
      setGistId(localStorage.getItem("github_gist_id") || "");
      setErrorMsg(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const isPat = Boolean(token.trim() && (token.trim().startsWith("ghp_") || token.trim().startsWith("github_pat_")));

    if (!isPat && !gistId.trim()) {
      setErrorMsg("Gist ID is required when using the default Worker proxy.");
      return;
    }

    if (token.trim()) {
      localStorage.setItem("github_gist_token", token.trim());
    } else {
      localStorage.removeItem("github_gist_token");
    }

    if (gistId.trim()) {
      localStorage.setItem("github_gist_id", gistId.trim());
    }

    onSaveAndSync(token.trim(), gistId.trim());
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-950/60 backdrop-blur-xs animate-in fade-in duration-200"
      onClick={onClose}
      id="cloud-sync-config-modal"
    >
      <div 
        className="bg-white border-2 border-stone-900 max-w-lg w-full shadow-2xl overflow-hidden flex flex-col my-auto"
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
                Configure Cloud Sync
              </h3>
              <p className="text-xs text-stone-400 font-normal mt-0.5">
                Connect your private GitHub Gist to enable 1-click cloud sync across devices.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-stone-400 hover:text-white hover:bg-stone-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {errorMsg && (
            <div className="p-3 bg-red-50 border border-red-300 text-red-900 text-xs font-semibold flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div className="space-y-1">
            <label className="block text-xs font-bold text-stone-900">
              GitHub Personal Access Token <span className="text-stone-400 font-normal">(Optional)</span>
            </label>
            <input
              type="password"
              value={token}
              onChange={(e) => {
                setToken(e.target.value);
                setErrorMsg(null);
              }}
              placeholder="Leave blank for default Gist"
              className="w-full bg-stone-50 border border-stone-300 p-2.5 text-xs font-mono font-medium text-stone-900 focus:outline-none focus:border-stone-900 focus:bg-white transition-all"
            />
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-bold text-stone-900">
              Gist ID {!token.trim().startsWith("ghp_") && !token.trim().startsWith("github_pat_") && <span className="text-red-500">*</span>}
            </label>
            <p className="text-[11px] text-stone-500">
              {token.trim().startsWith("ghp_") || token.trim().startsWith("github_pat_")
                ? "Leave blank to automatically create a new private Gist backup using your PAT."
                : "Required when using default Gist."}
            </p>
            <input
              type="text"
              value={gistId}
              onChange={(e) => {
                setGistId(e.target.value);
                setErrorMsg(null);
              }}
              placeholder="e.g. 64abc123def456..."
              className="w-full bg-stone-50 border border-stone-300 p-2.5 text-xs font-mono font-medium text-stone-900 focus:outline-none focus:border-stone-900 focus:bg-white transition-all"
            />
          </div>

          <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-stone-200">
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenSettings();
              }}
              className="text-xs text-stone-600 hover:text-stone-950 font-semibold underline underline-offset-2 flex items-center gap-1 self-start sm:self-auto cursor-pointer"
            >
              <Sliders className="w-3.5 h-3.5 text-stone-700" />
              <span>Open Full Settings</span>
            </button>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 sm:flex-none px-4 py-2 bg-stone-100 hover:bg-stone-200 border border-stone-300 text-stone-800 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>

              <button
                type="submit"
                className="flex-1 sm:flex-none px-4 py-2 bg-stone-900 hover:bg-black text-white text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
              >
                <Check className="w-4 h-4 text-emerald-400" />
                <span>Save & Sync</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
