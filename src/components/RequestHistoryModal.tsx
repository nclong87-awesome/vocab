import { useState, useEffect, useMemo } from "react";
import { 
  X, 
  Search, 
  CheckCircle2, 
  XCircle, 
  Trash2, 
  RotateCcw, 
  Copy, 
  Check, 
  Code, 
  MessageSquare, 
  FileText, 
  Activity,
  ArrowRight
} from "lucide-react";
import { ApiRequestLog } from "../types";
import { getRecentApiLogs, clearAllApiLogs } from "../services/requestHistoryService";

interface RequestHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialSelectedLogId?: string;
}

export default function RequestHistoryModal({
  isOpen,
  onClose,
  initialSelectedLogId
}: RequestHistoryModalProps) {
  const [logs, setLogs] = useState<ApiRequestLog[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "success" | "error">("all");
  const [selectedProvider, setSelectedProvider] = useState<string>("all");
  const [selectedLog, setSelectedLog] = useState<ApiRequestLog | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"response" | "prompt" | "system" | "meta">("response");
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // Load logs on open
  const loadLogs = async () => {
    setIsLoading(true);
    try {
      const data = await getRecentApiLogs(100);
      setLogs(data);
      if (initialSelectedLogId) {
        const target = data.find(item => item.id === initialSelectedLogId);
        if (target) setSelectedLog(target);
      }
    } catch (err) {
      console.warn("Failed to load API logs:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadLogs();
      const handleUpdate = () => loadLogs();
      window.addEventListener("vocab-api-logs-updated", handleUpdate);
      return () => window.removeEventListener("vocab-api-logs-updated", handleUpdate);
    } else {
      setSelectedLog(null);
      setShowClearConfirm(false);
    }
  }, [isOpen, initialSelectedLogId]);

  const handleClearHistory = async () => {
    await clearAllApiLogs();
    setLogs([]);
    setSelectedLog(null);
    setShowClearConfirm(false);
  };

  const handleCopy = (text: string, fieldName: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedField(fieldName);
    setTimeout(() => setCopiedField(null), 2000);
  };

  // Extract unique providers for filter
  const uniqueProviders = useMemo(() => {
    const set = new Set<string>();
    logs.forEach(l => {
      if (l.provider) set.add(l.provider);
    });
    return Array.from(set);
  }, [logs]);

  // Filtered logs
  const filteredLogs = useMemo(() => {
    return logs.filter(log => {
      if (statusFilter !== "all" && log.status !== statusFilter) {
        return false;
      }
      if (selectedProvider !== "all" && log.provider !== selectedProvider) {
        return false;
      }
      if (!searchQuery.trim()) return true;

      const q = searchQuery.toLowerCase();
      const promptMatch = (log.prompt || "").toLowerCase().includes(q);
      const respMatch = (log.response || "").toLowerCase().includes(q);
      const modelMatch = (log.model || "").toLowerCase().includes(q);
      const actionMatch = (log.action || "").toLowerCase().includes(q);
      const providerMatch = (log.provider || "").toLowerCase().includes(q);
      const errMatch = (log.errorMessage || "").toLowerCase().includes(q);

      return promptMatch || respMatch || modelMatch || actionMatch || providerMatch || errMatch;
    });
  }, [logs, statusFilter, selectedProvider, searchQuery]);

  if (!isOpen) return null;

  // Format relative timestamp
  const formatTime = (isoString: string) => {
    try {
      const date = new Date(isoString);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return isoString;
    }
  };

  const formatDate = (isoString: string) => {
    try {
      const date = new Date(isoString);
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    } catch {
      return "";
    }
  };

  // Helper to format JSON if response is valid JSON
  const formatPayload = (raw: string) => {
    if (!raw) return "";
    try {
      const parsed = JSON.parse(raw);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return raw;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-stone-950/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div 
        className="bg-white rounded-2xl border border-stone-200/90 shadow-2xl w-full max-w-5xl h-[92vh] max-h-[850px] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200"
        id="request-history-modal"
      >
        
        {/* Header */}
        <div className="bg-stone-50 px-4 sm:px-6 py-3.5 border-b border-stone-200 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-stone-900 text-white flex items-center justify-center shrink-0 shadow-xs">
              <Activity className="w-5 h-5 text-amber-400" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-bold text-stone-900 tracking-tight leading-none truncate">
                  LLM Request & Response History
                </h2>
                <span className="bg-stone-200/80 text-stone-700 text-[11px] font-bold px-2 py-0.5 rounded-full">
                  {logs.length}/100
                </span>
              </div>
              <p className="text-xs text-stone-500 mt-0.5 truncate">
                Inspect the last 100 LLM calls with response times, statuses, and full payloads stored in IndexedDB.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={loadLogs}
              disabled={isLoading}
              className="p-2 text-stone-600 hover:text-stone-900 hover:bg-stone-200/70 rounded-lg transition-colors cursor-pointer"
              title="Refresh logs"
              id="refresh-logs-button"
            >
              <RotateCcw className={`w-4 h-4 ${isLoading ? "animate-spin text-amber-500" : ""}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 text-stone-400 hover:text-stone-700 hover:bg-stone-200/70 rounded-lg transition-colors cursor-pointer"
              title="Close modal"
              id="close-history-modal-button"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Toolbar Filter Area */}
        <div className="px-3 sm:px-6 py-2.5 bg-white border-b border-stone-200/80 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 shrink-0">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 flex-1 min-w-0">
            {/* Search Input */}
            <div className="relative w-full sm:max-w-xs md:max-w-sm">
              <Search className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search logs (prompt, model, action...)"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-7 py-1.5 text-xs bg-stone-50 border border-stone-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-500 focus:bg-white transition-all placeholder:text-stone-400"
                id="search-logs-input"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Filter Pills and Dropdown */}
            <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
              {/* Status Filter Pills */}
              <div className="flex items-center bg-stone-100 p-0.5 rounded-lg border border-stone-200/80 text-xs shrink-0 max-w-full overflow-x-auto">
                <button
                  type="button"
                  onClick={() => setStatusFilter("all")}
                  className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer whitespace-nowrap ${
                    statusFilter === "all" ? "bg-white text-stone-900 shadow-2xs font-semibold" : "text-stone-600 hover:text-stone-900"
                  }`}
                >
                  All ({logs.length})
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter("success")}
                  className={`px-2 py-1 rounded-md font-medium transition-colors cursor-pointer flex items-center gap-1 whitespace-nowrap ${
                    statusFilter === "success" ? "bg-white text-emerald-700 shadow-2xs font-semibold" : "text-stone-600 hover:text-emerald-700"
                  }`}
                >
                  <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                  <span>Success</span>
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter("error")}
                  className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer flex items-center gap-1 whitespace-nowrap ${
                    statusFilter === "error" ? "bg-white text-rose-700 shadow-2xs font-semibold" : "text-stone-600 hover:text-rose-700"
                  }`}
                >
                  <XCircle className="w-3 h-3 text-rose-500" />
                  <span>Errors</span>
                </button>
              </div>

              {/* Provider Filter */}
              {uniqueProviders.length > 1 && (
                <select
                  value={selectedProvider}
                  onChange={(e) => setSelectedProvider(e.target.value)}
                  className="bg-stone-50 border border-stone-200 text-stone-700 text-xs font-medium rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-amber-500 cursor-pointer shrink-0"
                  id="filter-provider-select"
                >
                  <option value="all">All Providers</option>
                  {uniqueProviders.map(p => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {/* Action buttons (Clear History) */}
          <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
            {showClearConfirm ? (
              <div className="flex items-center gap-1.5 bg-rose-50 border border-rose-200 px-2 py-1 rounded-lg animate-in fade-in">
                <span className="text-xs text-rose-800 font-medium">Clear all {logs.length} logs?</span>
                <button
                  type="button"
                  onClick={handleClearHistory}
                  className="px-2 py-0.5 bg-rose-600 text-white rounded text-xs font-bold hover:bg-rose-700 cursor-pointer"
                >
                  Yes, Clear
                </button>
                <button
                  type="button"
                  onClick={() => setShowClearConfirm(false)}
                  className="px-1.5 py-0.5 text-stone-600 hover:bg-stone-200 rounded text-xs cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            ) : (
              logs.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowClearConfirm(true)}
                  className="px-2.5 py-1 text-xs font-medium text-stone-600 hover:text-rose-600 hover:bg-rose-50 border border-stone-200 rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer"
                  title="Clear history from IndexedDB"
                  id="clear-logs-button"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Clear History</span>
                </button>
              )
            )}
          </div>
        </div>

        {/* Main Body: Single/Split Layout (Minimalist List + Expandable Inspector) */}
        <div className="flex-1 flex min-h-0 overflow-hidden">
          
          {/* Requests List Column */}
          <div className={`w-full ${selectedLog ? "hidden md:flex md:w-5/12 lg:w-4/12 border-r border-stone-200/80" : "flex"} flex-col bg-stone-50/50 overflow-y-auto`}>
            {filteredLogs.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
                <div className="w-12 h-12 rounded-2xl bg-stone-100 flex items-center justify-center text-stone-400 mb-3">
                  <Activity className="w-6 h-6" />
                </div>
                <h4 className="text-sm font-semibold text-stone-800">No requests found</h4>
                <p className="text-xs text-stone-500 mt-1 max-w-xs">
                  {logs.length === 0 
                    ? "Invocations from Chat, Flashcards, AI Quizzes, and Vocabulary lookups will be logged here automatically."
                    : "No requests match the active filter or search query."}
                </p>
              </div>
            ) : (
              <div className="divide-y divide-stone-200/70">
                {filteredLogs.map((log) => {
                  const isSelected = selectedLog?.id === log.id;
                  const isSuccess = log.status === "success";
                  const duration = log.responseTimeMs;
                  const isFast = duration < 3000;
                  const isMedium = duration >= 3000 && duration < 8000;

                  return (
                    <button
                      key={log.id}
                      type="button"
                      onClick={() => setSelectedLog(prev => prev?.id === log.id ? null : log)}
                      className={`w-full text-left transition-all cursor-pointer flex flex-col justify-center relative ${
                        selectedLog 
                          ? "p-2.5 sm:p-3 gap-1.5" 
                          : "p-3 sm:px-5 sm:py-3.5 gap-1.5 sm:gap-2"
                      } ${
                        isSelected 
                          ? "bg-amber-50/80 border-l-4 border-l-amber-500 shadow-2xs" 
                          : "hover:bg-white"
                      }`}
                      id={`log-entry-${log.id}`}
                    >
                      {/* Top Row: Status badge, Action, Latency, Time */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          {isSuccess ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200/90 px-1.5 py-0.5 rounded">
                              <CheckCircle2 className="w-2.5 h-2.5 text-emerald-600 shrink-0" />
                              <span>200 OK</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-700 bg-rose-50 border border-rose-200/90 px-1.5 py-0.5 rounded">
                              <XCircle className="w-2.5 h-2.5 text-rose-600 shrink-0" />
                              <span>{log.statusCode || "ERR"}</span>
                            </span>
                          )}

                          <span className="text-[11px] font-bold text-stone-900 uppercase tracking-wider truncate bg-stone-100 px-1.5 py-0.5 rounded">
                            {log.action || "LLM"}
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <span 
                            className={`text-[11px] font-mono font-semibold px-1.5 py-0.5 rounded border ${
                              isFast 
                                ? "text-emerald-700 bg-emerald-50/60 border-emerald-200/60" 
                                : isMedium 
                                ? "text-amber-700 bg-amber-50/60 border-amber-200/60" 
                                : "text-orange-700 bg-orange-50/60 border-orange-200/60"
                            }`}
                            title="Response Time (ms)"
                          >
                            {log.responseTimeMs.toLocaleString()} ms
                          </span>
                          <span className="text-[10px] text-stone-600 font-medium">
                            {selectedLog ? formatTime(log.timestamp) : `${formatDate(log.timestamp)} ${formatTime(log.timestamp)}`}
                          </span>
                        </div>
                      </div>

                      {/* Bottom Row: Provider and Model */}
                      <div className="flex items-center justify-between text-[11px] text-stone-600">
                        <div className="flex items-center gap-1.5 truncate">
                          <span className="font-semibold text-stone-800 shrink-0">{log.provider}</span>
                          <span className="text-stone-300">•</span>
                          <span className="font-mono text-[10px] text-stone-500 truncate">{log.model}</span>
                        </div>
                        {!selectedLog && (
                          <span className="text-[10px] text-stone-400 font-medium shrink-0 ml-2 hidden sm:inline">
                            Click to inspect response →
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Response & Request Inspector Column (shown when selectedLog is active) */}
          {selectedLog && (
            <div className="flex-1 flex flex-col bg-white overflow-hidden animate-in fade-in duration-150">
              <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                
                {/* Inspector Header */}
                <div className="p-3.5 sm:p-4 bg-stone-50 border-b border-stone-200 flex items-center justify-between gap-3 shrink-0">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <button
                      type="button"
                      onClick={() => setSelectedLog(null)}
                      className="md:hidden p-1.5 text-stone-600 hover:bg-stone-200 rounded-lg cursor-pointer"
                      title="Back to list"
                    >
                      <ArrowRight className="w-4 h-4 rotate-180" />
                    </button>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full border ${
                          selectedLog.status === "success" 
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200" 
                            : "bg-rose-50 text-rose-700 border-rose-200"
                        }`}>
                          {selectedLog.status === "success" ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                          <span>{selectedLog.status === "success" ? `200 OK` : `Status ${selectedLog.statusCode || "ERR"}`}</span>
                        </span>

                        <span className="font-bold text-stone-900 text-xs sm:text-sm">
                          {selectedLog.action || "LLM Request"}
                        </span>

                        <span className="text-xs font-mono font-bold text-stone-700 bg-stone-200/80 px-2 py-0.5 rounded">
                          {selectedLog.responseTimeMs.toLocaleString()} ms
                        </span>
                      </div>

                      <div className="flex items-center gap-2 text-xs text-stone-500 mt-1 flex-wrap">
                        <span><strong>Provider:</strong> {selectedLog.provider}</span>
                        <span>•</span>
                        <span><strong>Model:</strong> {selectedLog.model}</span>
                        <span>•</span>
                        <span>{formatDate(selectedLog.timestamp)} {formatTime(selectedLog.timestamp)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleCopy(JSON.stringify(selectedLog, null, 2), "full_json")}
                      className="px-2.5 py-1.5 text-xs font-semibold text-stone-700 hover:text-stone-900 bg-white hover:bg-stone-100 border border-stone-200 rounded-lg flex items-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
                      title="Copy full JSON record"
                    >
                      {copiedField === "full_json" ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                      <span className="hidden sm:inline">{copiedField === "full_json" ? "Copied JSON" : "Copy Log JSON"}</span>
                    </button>

                    {/* Prominent Close Details Button */}
                    <button
                      type="button"
                      onClick={() => setSelectedLog(null)}
                      className="p-1.5 text-stone-500 hover:text-stone-900 hover:bg-stone-200/80 rounded-lg transition-colors cursor-pointer"
                      title="Close details section"
                      id="close-details-pane-btn"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Inspector Tabs */}
                <div className="flex items-center bg-stone-100/80 px-4 border-b border-stone-200 gap-1 shrink-0 overflow-x-auto">
                  <button
                    type="button"
                    onClick={() => setActiveTab("response")}
                    className={`px-3 py-2 text-xs font-bold border-b-2 transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                      activeTab === "response" 
                        ? "border-amber-500 text-stone-900 bg-white shadow-2xs" 
                        : "border-transparent text-stone-600 hover:text-stone-900"
                    }`}
                  >
                    <MessageSquare className="w-3.5 h-3.5 text-amber-600" />
                    <span>Response</span>
                    {selectedLog.status === "error" && (
                      <span className="w-2 h-2 rounded-full bg-rose-500" />
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveTab("prompt")}
                    className={`px-3 py-2 text-xs font-bold border-b-2 transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                      activeTab === "prompt" 
                        ? "border-amber-500 text-stone-900 bg-white shadow-2xs" 
                        : "border-transparent text-stone-600 hover:text-stone-900"
                    }`}
                  >
                    <FileText className="w-3.5 h-3.5 text-stone-600" />
                    <span>Prompt / Request</span>
                  </button>

                  {(selectedLog.systemInstruction || selectedLog.schemaDescription) && (
                    <button
                      type="button"
                      onClick={() => setActiveTab("system")}
                      className={`px-3 py-2 text-xs font-bold border-b-2 transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                        activeTab === "system" 
                          ? "border-amber-500 text-stone-900 bg-white shadow-2xs" 
                          : "border-transparent text-stone-600 hover:text-stone-900"
                      }`}
                    >
                      <Code className="w-3.5 h-3.5 text-stone-600" />
                      <span>System & Schema</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => setActiveTab("meta")}
                    className={`px-3 py-2 text-xs font-bold border-b-2 transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                      activeTab === "meta" 
                        ? "border-amber-500 text-stone-900 bg-white shadow-2xs" 
                        : "border-transparent text-stone-600 hover:text-stone-900"
                    }`}
                  >
                    <Activity className="w-3.5 h-3.5 text-stone-600" />
                    <span>Metadata</span>
                  </button>
                </div>

                {/* Tab Content Area */}
                <div className="flex-1 p-4 sm:p-5 overflow-y-auto font-mono text-xs bg-stone-900 text-stone-100">
                  
                  {activeTab === "response" && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-sans font-bold text-stone-400 uppercase tracking-wider">
                            Model Response Payload
                          </span>
                          {selectedLog.status === "error" && (
                            <span className="bg-rose-950 text-rose-300 border border-rose-800 text-[10px] font-bold px-2 py-0.5 rounded">
                              Error Output
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => handleCopy(selectedLog.response, "response")}
                          className="text-stone-400 hover:text-white flex items-center gap-1 text-[11px] font-sans font-medium px-2 py-1 rounded bg-stone-800 hover:bg-stone-700 transition-colors cursor-pointer"
                        >
                          {copiedField === "response" ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                          <span>{copiedField === "response" ? "Copied" : "Copy Response"}</span>
                        </button>
                      </div>

                      {selectedLog.errorMessage && (
                        <div className="p-3 bg-rose-950/80 border border-rose-800 text-rose-200 rounded-lg font-sans text-xs space-y-1">
                          <div className="font-bold flex items-center gap-1.5 text-rose-300">
                            <XCircle className="w-4 h-4" />
                            <span>Error Reason:</span>
                          </div>
                          <p className="leading-relaxed">{selectedLog.errorMessage}</p>
                        </div>
                      )}

                      <pre className="whitespace-pre-wrap break-all leading-relaxed bg-stone-950 p-3.5 rounded-xl border border-stone-800 text-stone-200 overflow-x-auto text-[11px] select-text">
                        {formatPayload(selectedLog.response) || "(Empty response payload)"}
                      </pre>
                    </div>
                  )}

                  {activeTab === "prompt" && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-sans font-bold text-stone-400 uppercase tracking-wider">
                          User Prompt / Query
                        </span>
                        <button
                          type="button"
                          onClick={() => handleCopy(selectedLog.prompt, "prompt")}
                          className="text-stone-400 hover:text-white flex items-center gap-1 text-[11px] font-sans font-medium px-2 py-1 rounded bg-stone-800 hover:bg-stone-700 transition-colors cursor-pointer"
                        >
                          {copiedField === "prompt" ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                          <span>{copiedField === "prompt" ? "Copied" : "Copy Prompt"}</span>
                        </button>
                      </div>

                      <pre className="whitespace-pre-wrap break-all leading-relaxed bg-stone-950 p-3.5 rounded-xl border border-stone-800 text-stone-200 overflow-x-auto text-[11px] select-text">
                        {selectedLog.prompt || "(No prompt content)"}
                      </pre>
                    </div>
                  )}

                  {activeTab === "system" && (
                    <div className="space-y-4">
                      {selectedLog.systemInstruction && (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-sans font-bold text-stone-400 uppercase tracking-wider">
                              System Instruction
                            </span>
                            <button
                              type="button"
                              onClick={() => handleCopy(selectedLog.systemInstruction || "", "sys")}
                              className="text-stone-400 hover:text-white flex items-center gap-1 text-[11px] font-sans font-medium px-2 py-1 rounded bg-stone-800 hover:bg-stone-700 transition-colors cursor-pointer"
                            >
                              {copiedField === "sys" ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                              <span>{copiedField === "sys" ? "Copied" : "Copy System"}</span>
                            </button>
                          </div>
                          <pre className="whitespace-pre-wrap break-all leading-relaxed bg-stone-950 p-3.5 rounded-xl border border-stone-800 text-stone-300 overflow-x-auto text-[11px] select-text">
                            {selectedLog.systemInstruction}
                          </pre>
                        </div>
                      )}

                      {selectedLog.schemaDescription && (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-sans font-bold text-stone-400 uppercase tracking-wider">
                              Schema Description / JSON Structure
                            </span>
                            <button
                              type="button"
                              onClick={() => handleCopy(selectedLog.schemaDescription || "", "schema")}
                              className="text-stone-400 hover:text-white flex items-center gap-1 text-[11px] font-sans font-medium px-2 py-1 rounded bg-stone-800 hover:bg-stone-700 transition-colors cursor-pointer"
                            >
                              {copiedField === "schema" ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                              <span>{copiedField === "schema" ? "Copied" : "Copy Schema"}</span>
                            </button>
                          </div>
                          <pre className="whitespace-pre-wrap break-all leading-relaxed bg-stone-950 p-3.5 rounded-xl border border-stone-800 text-stone-300 overflow-x-auto text-[11px] select-text">
                            {selectedLog.schemaDescription}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}

                  {activeTab === "meta" && (
                    <div className="space-y-3 font-sans text-xs">
                      <h4 className="text-[11px] font-bold text-stone-400 uppercase tracking-wider">
                        Call Execution Details
                      </h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        <div className="p-3 bg-stone-950 border border-stone-800 rounded-xl space-y-1">
                          <div className="text-[10px] text-stone-500 uppercase tracking-wide">Request ID</div>
                          <div className="font-mono text-stone-300 text-xs truncate">{selectedLog.id}</div>
                        </div>

                        <div className="p-3 bg-stone-950 border border-stone-800 rounded-xl space-y-1">
                          <div className="text-[10px] text-stone-500 uppercase tracking-wide">Timestamp</div>
                          <div className="font-mono text-stone-300 text-xs">{selectedLog.timestamp}</div>
                        </div>

                        <div className="p-3 bg-stone-950 border border-stone-800 rounded-xl space-y-1">
                          <div className="text-[10px] text-stone-500 uppercase tracking-wide">Provider</div>
                          <div className="font-semibold text-stone-200 text-xs">{selectedLog.provider}</div>
                        </div>

                        <div className="p-3 bg-stone-950 border border-stone-800 rounded-xl space-y-1">
                          <div className="text-[10px] text-stone-500 uppercase tracking-wide">Model</div>
                          <div className="font-mono text-stone-300 text-xs">{selectedLog.model}</div>
                        </div>

                        <div className="p-3 bg-stone-950 border border-stone-800 rounded-xl space-y-1">
                          <div className="text-[10px] text-stone-500 uppercase tracking-wide">Latency / Duration</div>
                          <div className="font-bold text-amber-400 text-xs">{selectedLog.responseTimeMs.toLocaleString()} ms</div>
                        </div>

                        <div className="p-3 bg-stone-950 border border-stone-800 rounded-xl space-y-1">
                          <div className="text-[10px] text-stone-500 uppercase tracking-wide">HTTP Status Code</div>
                          <div className={`font-bold text-xs ${selectedLog.status === "success" ? "text-emerald-400" : "text-rose-400"}`}>
                            {selectedLog.statusCode || (selectedLog.status === "success" ? 200 : 500)} ({selectedLog.status})
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                </div>
              </div>
            </div>
          )}

        </div>

      </div>
    </div>
  );
}
